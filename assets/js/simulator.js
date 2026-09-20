/*
 * simulator.js — SO-ARM101 브라우저 시뮬레이터
 * -------------------------------------------------------------------------
 * three.js 가 로드되면 완전한 3D 모드로, 실패하면 의존성 없는 2D 캔버스 모드로
 * 동작합니다. 기구학은 모두 so101-kinematics.js (URDF 원본값) 을 사용합니다.
 */
(function () {
  'use strict';

  var K = window.SO101;
  var THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.js';

  // ------------------------------------------------------------------ 상태
  var state = {
    q: K.POSES.home.q.slice(),          // 팔로워 조인트
    qLeader: K.POSES.home.q.slice(),    // 리더 조인트
    unit: 'deg',
    teleop: false,
    lagMs: 80,
    ikTarget: [0.220, 0.0, 0.150],
    ikDrag: true,
    ikApproach: false,
    grid: true,
    axes: true,
    workspace: false,
    cube: true,
    cameras: false,
    cubeHeld: false,
    cubePos: [0.22, 0.00, 0.020],
    serial: { bus: null, mapper: null, timer: null, busy: false, ticks: [] },
    recording: false,
    frames: [],
    recFps: 30,
    playing: false
  };

  var leaderBuffer = [];   // {t, q} — 지연 추종용

  var el = function (id) { return document.getElementById(id); };
  var THREE = null;
  var view = null;         // 렌더러 어댑터 (3D 또는 2D)

  // =====================================================================
  //  단위 변환
  // =====================================================================

  function fmtJoint(name, rad) {
    switch (state.unit) {
      case 'rad':  return rad.toFixed(4) + ' rad';
      case 'norm': return K.radToNorm(name, rad).toFixed(1);
      case 'tick': return String(K.radToTicks(rad));
      default:     return K.deg(rad).toFixed(1) + '°';
    }
  }

  // =====================================================================
  //  조인트 슬라이더 UI
  // =====================================================================

  function buildSliders(container, getter, setter, compact) {
    container.innerHTML = '';
    K.JOINTS.forEach(function (j, i) {
      var row = document.createElement('div');
      row.className = 'joint-row';
      row.dataset.index = String(i);

      var head = document.createElement('div');
      head.className = 'jr-head';
      head.innerHTML =
        '<span class="jr-name">' + j.name + '</span>' +
        '<span class="jr-ko">' + j.ko + '</span>' +
        '<span class="jr-val"></span>';

      var input = document.createElement('input');
      input.type = 'range';
      input.min = String(j.lower);
      input.max = String(j.upper);
      input.step = '0.001';
      input.value = String(getter()[i]);
      input.addEventListener('input', function () {
        var q = getter().slice();
        q[i] = parseFloat(input.value);
        setter(q);
        syncSliders();
      });

      row.appendChild(head);
      row.appendChild(input);

      if (!compact) {
        var lim = document.createElement('div');
        lim.className = 'jr-limits';
        lim.innerHTML =
          '<span>' + K.deg(j.lower).toFixed(0) + '°</span>' +
          '<span>' + K.deg(j.upper).toFixed(0) + '°</span>';
        row.appendChild(lim);
      }

      container.appendChild(row);
    });
  }

  function syncSliders() {
    updateRows(el('jointSliders'), state.q);
    updateRows(el('leaderSliders'), state.qLeader);

    function updateRows(box, q) {
      if (!box) return;
      box.querySelectorAll('.joint-row').forEach(function (row) {
        var i = parseInt(row.dataset.index, 10);
        var input = row.querySelector('input');
        if (document.activeElement !== input) input.value = String(q[i]);
        row.querySelector('.jr-val').textContent = fmtJoint(K.JOINTS[i].name, q[i]);
      });
    }
  }

  // =====================================================================
  //  프리셋
  // =====================================================================

  function buildPresets() {
    var box = el('presetRow');
    var order = ['rest', 'home', 'ready', 'pick', 'extended', 'zero'];
    box.innerHTML = '';
    order.forEach(function (key, idx) {
      var pose = K.POSES[key];
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = (idx + 1) + '. ' + pose.ko;
      b.addEventListener('click', function () { applyPose(key); });
      box.appendChild(b);
    });
  }

  function applyPose(key) {
    var pose = K.POSES[key];
    if (!pose) return;
    state.q = pose.q.slice();
    state.qLeader = pose.q.slice();
    leaderBuffer.length = 0;
    syncSliders();
    setStatus('프리셋: ' + pose.ko);
  }

  // =====================================================================
  //  상태 표시
  // =====================================================================

  var statusTimer;
  function setStatus(text, kind) {
    var node = el('simStatus');
    node.textContent = text;
    node.style.color = kind === 'error' ? 'var(--danger)'
                     : kind === 'warn' ? 'var(--warn)' : '';
    clearTimeout(statusTimer);
    statusTimer = setTimeout(function () {
      node.textContent = state.recording ? '녹화 중' : '대기';
      node.style.color = '';
    }, 2600);
  }

  function updateReadout(fk) {
    var p = K.matPos(fk.tool);
    var rpy = K.matToRpy(fk.tool);
    el('tcpPos').textContent =
      'x ' + p[0].toFixed(3) + '  y ' + p[1].toFixed(3) + '  z ' + p[2].toFixed(3) + ' m';
    el('tcpRpy').textContent =
      'r ' + K.deg(rpy[0]).toFixed(1) + '  p ' + K.deg(rpy[1]).toFixed(1) +
      '  y ' + K.deg(rpy[2]).toFixed(1) + ' °';
  }

  // =====================================================================
  //  IK
  // =====================================================================

  function solveIk() {
    var opt = { iterations: 140 };
    if (state.ikApproach) {
      opt.approach = [0, 0, -1];
      opt.approachWeight = 0.35;
    }
    var res = K.inverse(state.ikTarget, state.q, opt);
    state.q = res.q;
    if (!state.teleop) state.qLeader = res.q.slice();
    syncSliders();

    el('ikConv').textContent = res.converged ? '성공' : '도달 불가';
    el('ikConv').style.color = res.converged ? 'var(--accent)' : 'var(--danger)';
    el('ikErr').textContent = (res.error * 1000).toFixed(1) + ' mm';
    return res;
  }

  function readIkInputs() {
    state.ikTarget = [
      parseFloat(el('ikX').value) || 0,
      parseFloat(el('ikY').value) || 0,
      parseFloat(el('ikZ').value) || 0
    ];
  }

  function writeIkInputs() {
    el('ikX').value = state.ikTarget[0].toFixed(3);
    el('ikY').value = state.ikTarget[1].toFixed(3);
    el('ikZ').value = state.ikTarget[2].toFixed(3);
  }

  // =====================================================================
  //  텔레오퍼레이션 (지연 추종)
  // =====================================================================

  function stepTeleop(now) {
    if (!state.teleop) return;

    leaderBuffer.push({ t: now, q: state.qLeader.slice() });
    var cutoff = now - state.lagMs;
    var chosen = null;
    while (leaderBuffer.length && leaderBuffer[0].t <= cutoff) {
      chosen = leaderBuffer.shift();
    }
    if (chosen) {
      // 팔로워는 조인트 한계로 클램프된다 — 실제 서보와 같은 제약
      state.q = K.clampToLimits(chosen.q);
    }
    if (leaderBuffer.length > 600) leaderBuffer.splice(0, leaderBuffer.length - 600);

    // 한계 초과 경고
    var over = [];
    K.JOINTS.forEach(function (j, i) {
      if (state.qLeader[i] < j.lower - 1e-6 || state.qLeader[i] > j.upper + 1e-6) {
        over.push(j.name);
      }
    });
    var warn = el('limitWarn');
    if (over.length) {
      warn.hidden = false;
      warn.textContent = '조인트 한계 초과: ' + over.join(', ') +
        ' — 실기에서는 서보 과부하로 이어집니다.';
    } else {
      warn.hidden = true;
    }

    el('jointSliders').querySelectorAll('.joint-row').forEach(function (row) {
      var i = parseInt(row.dataset.index, 10);
      row.classList.toggle('over', over.indexOf(K.JOINTS[i].name) >= 0);
    });
  }

  // =====================================================================
  //  실기 리더 암 연결 (Web Serial)
  // =====================================================================

  function buildServoRows() {
    var tbody = el('servoRows');
    tbody.innerHTML = '';
    K.JOINTS.forEach(function (j, i) {
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' + j.ko + '</td>' +
        '<td>' + j.motorId + '</td>' +
        '<td class="tick">-</td>' +
        '<td class="deg">-</td>' +
        '<td><input type="checkbox"></td>';
      tr.querySelector('input').addEventListener('change', function (e) {
        if (state.serial.mapper) state.serial.mapper.invert[i] = e.target.checked;
      });
      tbody.appendChild(tr);
    });
  }

  function updateServoRows(ticks) {
    var rows = el('servoRows').children;
    for (var i = 0; i < rows.length && i < K.JOINTS.length; i++) {
      var t = ticks[i];
      var cells = rows[i].children;
      rows[i].classList.toggle('stale', t == null);
      cells[2].textContent = (t == null) ? '응답 없음' : String(t);
      cells[2].classList.toggle('live', t != null);
      cells[3].textContent = K.deg(state.qLeader[i]).toFixed(1) + '\u00B0';
    }
  }

  function setSerialUi(connected) {
    el('btnSerial').textContent = connected ? '연결 해제' : '리더 암 연결';
    el('btnSerial').classList.toggle('primary', !connected);
    el('btnZeroCapture').disabled = !connected;
    el('serialBaud').disabled = connected;
    // 실기가 붙어 있는 동안에는 리더 슬라이더를 잠근다
    el('leaderSliders').querySelectorAll('input').forEach(function (inp) {
      inp.disabled = connected;
    });
  }

  async function serialTick() {
    var S = state.serial;
    if (!S.bus || !S.bus.isConnected() || S.busy) return;
    S.busy = true;
    try {
      var ids = K.JOINTS.map(function (j) { return j.motorId; });
      var ticks = await S.bus.readPositions(ids);
      S.ticks = ticks;
      state.qLeader = S.mapper.toRadians(ticks, state.qLeader);
      syncSliders();
      updateServoRows(ticks);

      var st = S.bus.stats;
      el('serialRate').textContent =
        st.lastHz.toFixed(0) + ' Hz  ' +
        (S.bus.useSyncRead ? 'sync' : '개별') +
        (st.timeouts ? '  · 타임아웃 ' + st.timeouts : '');
    } catch (err) {
      console.warn('시리얼 읽기 실패', err);
    } finally {
      S.busy = false;
    }
  }

  async function connectSerial() {
    var S = state.serial;

    if (S.bus && S.bus.isConnected()) {
      clearInterval(S.timer);
      S.timer = null;
      await S.bus.disconnect();
      S.bus = null;
      setSerialUi(false);
      el('serialState').textContent = '미연결';
      el('serialRate').textContent = '-';
      setStatus('리더 암 연결을 해제했습니다');
      return;
    }

    var bus = new window.Feetech.FeetechBus();
    try {
      el('serialState').textContent = '포트 선택 중…';
      await bus.connect(parseInt(el('serialBaud').value, 10));
    } catch (err) {
      el('serialState').textContent = '연결 실패';
      setStatus('연결 실패 — ' + ((err && err.message) ? err.message : err), 'error');
      return;
    }

    S.bus = bus;
    S.mapper = S.mapper || new window.Feetech.LeaderMapper(K.JOINTS);
    setSerialUi(true);
    el('serialState').textContent =
      '연결됨 · ' + (S.mapper.mode === 'calib' ? '캘리브레이션 매핑' : '원시 매핑');

    // 실기가 붙으면 텔레오퍼레이션을 자동으로 켠다
    if (!state.teleop) {
      el('teleopOn').checked = true;
      state.teleop = true;
      leaderBuffer.length = 0;
    }

    var hz = Math.max(5, Math.min(120, parseInt(el('serialHz').value, 10) || 50));
    S.timer = setInterval(serialTick, 1000 / hz);
    setStatus('리더 암 연결됨 — 팔을 움직여 보세요');
  }

  function captureZero() {
    var S = state.serial;
    if (!S.mapper || !S.ticks.length) return;
    S.mapper.useRaw();
    S.mapper.captureZero(S.ticks);
    el('serialState').textContent = '연결됨 · 원시 매핑';
    setStatus('현재 자세를 영점으로 잡았습니다');
  }

  function loadCalibFile(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var json = JSON.parse(String(reader.result));
        state.serial.mapper = state.serial.mapper
          || new window.Feetech.LeaderMapper(K.JOINTS);
        var n = state.serial.mapper.loadCalibration(json);
        el('serialState').textContent =
          (state.serial.bus ? '연결됨 · ' : '미연결 · ') + '캘리브레이션 매핑';
        setStatus('캘리브레이션 적용 — 조인트 ' + n + '개');
      } catch (err) {
        setStatus('캘리브레이션 읽기 실패 — ' + err.message, 'error');
      }
    };
    reader.readAsText(file);
  }

  function initSerialUi() {
    buildServoRows();
    var box = el('serialUnsupported');
    var F = window.Feetech && window.Feetech.FeetechBus;

    if (!F || !F.isSupported()) {
      box.hidden = false;
      box.innerHTML = '이 브라우저는 <b>Web Serial</b> 을 지원하지 않습니다. ' +
        'Chrome · Edge 등 크로미움 계열 브라우저에서 열면 실기 리더 암을 연결할 수 있습니다.';
      el('btnSerial').disabled = true;
    } else if (!F.isSecure()) {
      box.hidden = false;
      box.innerHTML = 'Web Serial 은 <b>https</b> 또는 <b>localhost</b> 에서만 동작합니다. ' +
        '<code>python build.py --serve</code> 로 로컬 서버를 띄워 여세요.';
      el('btnSerial').disabled = true;
    }

    el('btnSerial').addEventListener('click', connectSerial);
    el('btnZeroCapture').addEventListener('click', captureZero);
    el('calibFile').addEventListener('change', function (e) {
      if (e.target.files && e.target.files[0]) loadCalibFile(e.target.files[0]);
      e.target.value = '';
    });

    window.addEventListener('beforeunload', function () {
      if (state.serial.bus) {
        try { state.serial.bus.disconnect(); } catch (e) { /* noop */ }
      }
    });
  }

  // =====================================================================
  //  큐브 파지 (단순 규칙)
  // =====================================================================

  function stepCube(fk) {
    if (!state.cube) return;
    var tool = K.matPos(fk.tool);
    var gripper = state.q[5];
    var closed = gripper < 0.35;

    if (state.cubeHeld) {
      // 툴 끝에서 살짝 앞쪽에 붙어 따라다닌다
      var z = K.matAxisZ(fk.tool);
      state.cubePos = [
        tool[0] + z[0] * 0.022,
        tool[1] + z[1] * 0.022,
        tool[2] + z[2] * 0.022
      ];
      if (!closed) {
        state.cubeHeld = false;
        state.cubePos[2] = Math.max(0.02, state.cubePos[2]);
        // 바닥으로 떨어뜨린다
        state.cubePos = [state.cubePos[0], state.cubePos[1], 0.02];
        setStatus('큐브를 놓았습니다');
      }
    } else if (closed) {
      var d = Math.hypot(tool[0] - state.cubePos[0],
                         tool[1] - state.cubePos[1],
                         tool[2] - state.cubePos[2]);
      if (d < 0.055) {
        state.cubeHeld = true;
        setStatus('큐브를 잡았습니다');
      }
    }
  }

  // =====================================================================
  //  녹화
  // =====================================================================

  var recAcc = 0;

  function stepRecord(dt) {
    if (!state.recording) return;
    recAcc += dt;
    var period = 1000 / state.recFps;
    if (recAcc < period) return;
    recAcc -= period;

    var fk = K.forward(state.q);
    var p = K.matPos(fk.tool);
    state.frames.push({
      t: +(state.frames.length / state.recFps).toFixed(4),
      action: state.qLeader.map(function (v) { return +v.toFixed(5); }),
      state: state.q.map(function (v) { return +v.toFixed(5); }),
      tcp: [+p[0].toFixed(5), +p[1].toFixed(5), +p[2].toFixed(5)]
    });
    updateRecUi();
  }

  function updateRecUi() {
    el('recFrames').textContent = String(state.frames.length);
    el('recDur').textContent = (state.frames.length / state.recFps).toFixed(1) + ' s';
    var has = state.frames.length > 0;
    el('btnPlay').disabled = !has || state.recording;
    el('btnClear').disabled = !has || state.recording;
    el('btnExport').disabled = !has || state.recording;
    el('btnExportCsv').disabled = !has || state.recording;
  }

  function toggleRecord() {
    state.recording = !state.recording;
    var btn = el('btnRec');
    if (state.recording) {
      state.recFps = Math.max(5, Math.min(60, parseInt(el('recFps').value, 10) || 30));
      state.frames = [];
      recAcc = 0;
      btn.textContent = '녹화 정지';
      btn.classList.add('rec');
      setStatus('녹화 시작 (' + state.recFps + ' fps)');
    } else {
      btn.textContent = '녹화 시작';
      btn.classList.remove('rec');
      setStatus('녹화 정지 — ' + state.frames.length + ' 프레임');
    }
    updateRecUi();
  }

  function playback() {
    if (!state.frames.length || state.playing) return;
    state.playing = true;
    var i = 0;
    var period = 1000 / state.recFps;
    setStatus('재생 중');
    var timer = setInterval(function () {
      if (i >= state.frames.length) {
        clearInterval(timer);
        state.playing = false;
        setStatus('재생 완료');
        return;
      }
      state.q = state.frames[i].state.slice();
      state.qLeader = state.frames[i].action.slice();
      syncSliders();
      i++;
    }, period);
  }

  /**
   * 파일로 저장을 시도하고, 동시에 내용을 화면에도 띄웁니다.
   * 공유 링크(Artifact)처럼 페이지가 시작한 다운로드가 차단되는 환경에서도
   * 복사해서 쓸 수 있도록 하기 위한 이중 경로입니다.
   */
  function download(name, text, mime) {
    var saved = false;
    try {
      var blob = new Blob([text], { type: mime || 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      saved = true;
    } catch (e) {
      saved = false;
    }
    showExport(name, text, saved);
  }

  function showExport(name, text, saved) {
    el('exportName').textContent = name;
    el('exportNote').textContent = saved
      ? '브라우저 다운로드를 시작했습니다. 차단되었다면 아래 내용을 복사해 직접 저장하세요.'
      : '이 환경에서는 파일 저장이 차단됩니다. 아래 내용을 복사해 직접 저장하세요.';
    el('exportText').value = text;
    el('exportModal').hidden = false;
  }

  function exportJson() {
    var payload = {
      robot_type: 'so101_follower',
      source: 'SO-ARM101 브라우저 시뮬레이터',
      fps: state.recFps,
      task: el('recTask').value,
      joint_names: K.JOINTS.map(function (j) { return j.name; }),
      units: 'radian',
      num_frames: state.frames.length,
      frames: state.frames
    };
    download('so101_trajectory.json', JSON.stringify(payload, null, 2));
    setStatus('JSON 내보내기 완료');
  }

  function exportCsv() {
    var names = K.JOINTS.map(function (j) { return j.name; });
    var head = ['t']
      .concat(names.map(function (n) { return 'action.' + n; }))
      .concat(names.map(function (n) { return 'state.' + n; }))
      .concat(['tcp_x', 'tcp_y', 'tcp_z']);
    var lines = [head.join(',')];
    state.frames.forEach(function (f) {
      lines.push([f.t].concat(f.action, f.state, f.tcp).join(','));
    });
    download('so101_trajectory.csv', lines.join('\n'), 'text/csv');
    setStatus('CSV 내보내기 완료');
  }

  // =====================================================================
  //  ROS 2 메시지 출력
  // =====================================================================

  var rosTick = 0;

  function updateRosMessages(fk) {
    if (document.querySelector('.tab-body[data-tab="ros"]').classList.contains('active') === false) return;
    if (rosTick++ % 6 !== 0) return;   // 6프레임마다 갱신

    var names = K.JOINTS.map(function (j) { return j.name; });
    var now = Date.now();

    el('msgJointState').textContent = JSON.stringify({
      header: {
        stamp: { sec: Math.floor(now / 1000), nanosec: (now % 1000) * 1e6 },
        frame_id: ''
      },
      name: names,
      position: state.q.map(function (v) { return +v.toFixed(4); }),
      velocity: [],
      effort: []
    }, null, 2);

    el('msgTrajectory').textContent = JSON.stringify({
      joint_names: names,
      points: [{
        positions: state.q.map(function (v) { return +v.toFixed(4); }),
        time_from_start: { sec: 3, nanosec: 0 }
      }]
    }, null, 2);

    var lines = [];
    K.JOINTS.forEach(function (j) {
      var m = fk.links[j.child];
      var p = K.matPos(m);
      var rpy = K.matToRpy(m);
      lines.push(
        pad(j.child, 26) +
        'xyz ' + fx(p[0]) + ' ' + fx(p[1]) + ' ' + fx(p[2]) +
        '   rpy ' + fd(rpy[0]) + ' ' + fd(rpy[1]) + ' ' + fd(rpy[2]));
    });
    var tp = K.matPos(fk.tool);
    var trpy = K.matToRpy(fk.tool);
    lines.push(pad('gripper_frame_link', 26) +
      'xyz ' + fx(tp[0]) + ' ' + fx(tp[1]) + ' ' + fx(tp[2]) +
      '   rpy ' + fd(trpy[0]) + ' ' + fd(trpy[1]) + ' ' + fd(trpy[2]));
    el('msgTf').textContent = lines.join('\n');

    function pad(s, n) { return (s + '                              ').slice(0, n); }
    function fx(v) { return (v >= 0 ? ' ' : '') + v.toFixed(3); }
    function fd(v) { return (v >= 0 ? ' ' : '') + K.deg(v).toFixed(1); }
  }

  function copyRosCommand() {
    var names = K.JOINTS.map(function (j) { return j.name; }).join(', ');
    var pos = state.q.map(function (v) { return v.toFixed(4); }).join(', ');
    var cmd =
      'ros2 topic pub --once /joint_trajectory_controller/joint_trajectory \\\n' +
      '  trajectory_msgs/msg/JointTrajectory \\\n' +
      '  "{joint_names: [' + names + '], points: [{positions: [' + pos +
      '], time_from_start: {sec: 3}}]}"';
    navigator.clipboard.writeText(cmd).then(
      function () { setStatus('명령을 클립보드에 복사했습니다'); },
      function () { setStatus('복사 실패 — 수동으로 선택하세요', 'warn'); });
  }

  // =====================================================================
  //  3D 렌더러 (three.js)
  // =====================================================================

  function createThreeView(container) {
    var scene = new THREE.Scene();
    THREE.Object3D.DEFAULT_UP = new THREE.Vector3(0, 0, 1);

    var camera = new THREE.PerspectiveCamera(42, 1, 0.01, 50);
    camera.up.set(0, 0, 1);

    var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    // ── 조명 ──
    scene.add(new THREE.HemisphereLight(0xdceaff, 0x202a36, 1.5));
    var key = new THREE.DirectionalLight(0xffffff, 2.0);
    key.position.set(0.4, -0.6, 0.9);
    scene.add(key);
    var rim = new THREE.DirectionalLight(0x88bbff, 0.7);
    rim.position.set(-0.5, 0.4, 0.3);
    scene.add(rim);

    // ── 바닥/격자 ──
    var grid = new THREE.GridHelper(1.0, 40, 0x3b5068, 0x222c3a);
    grid.rotation.x = Math.PI / 2;
    scene.add(grid);

    var table = new THREE.Mesh(
      new THREE.PlaneGeometry(1.0, 1.0),
      new THREE.MeshStandardMaterial({
        color: 0x161d27, roughness: 0.95, metalness: 0.0,
        transparent: true, opacity: 0.85
      }));
    table.position.z = -0.001;
    scene.add(table);

    // ── 로봇 ──
    var matPrint = new THREE.MeshStandardMaterial({ color: 0xf0c020, roughness: 0.6, metalness: 0.05 });
    var matServo = new THREE.MeshStandardMaterial({ color: 0x2b3542, roughness: 0.5, metalness: 0.35 });
    var matGhost = new THREE.MeshStandardMaterial({
      color: 0x69c5ff, roughness: 0.5, metalness: 0.1,
      transparent: true, opacity: 0.28, depthWrite: false
    });

    function buildRobot(ghost) {
      var groups = {};
      var root = new THREE.Group();
      K.LINK_ORDER.forEach(function (link) {
        var g = new THREE.Group();
        g.matrixAutoUpdate = false;
        (K.LINK_SHAPES[link] || []).forEach(function (s) {
          var mesh = new THREE.Mesh(
            new THREE.BoxGeometry(s.size[0], s.size[1], s.size[2]),
            ghost ? matGhost : (s.mat === 'servo' ? matServo : matPrint));
          mesh.position.set(s.pos[0], s.pos[1], s.pos[2]);
          g.add(mesh);
        });
        groups[link] = g;
        root.add(g);
      });
      return { root: root, groups: groups };
    }

    var follower = buildRobot(false);
    var leader = buildRobot(true);
    leader.root.visible = false;
    scene.add(follower.root);
    scene.add(leader.root);

    // ── TCP 축 ──
    var axes = new THREE.AxesHelper(0.055);
    axes.matrixAutoUpdate = false;
    scene.add(axes);

    // ── IK 목표 ──
    var targetMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.014, 20, 16),
      new THREE.MeshStandardMaterial({
        color: 0xff5a5a, emissive: 0x551111, roughness: 0.35
      }));
    scene.add(targetMesh);

    // ── 큐브 ──
    var cube = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.04, 0.04),
      new THREE.MeshStandardMaterial({ color: 0x20262e, roughness: 0.75 }));
    scene.add(cube);

    var bin = new THREE.Mesh(
      new THREE.BoxGeometry(0.10, 0.10, 0.045),
      new THREE.MeshStandardMaterial({
        color: 0x2e6b52, roughness: 0.8, transparent: true, opacity: 0.55
      }));
    bin.position.set(0.10, 0.20, 0.022);
    scene.add(bin);

    // ── 작업영역 (도달 가능 부피) ──
    //
    // shoulder_pan 은 팔 전체를 Z축으로 돌리기만 하므로, pan=0 으로 (반지름 r,
    // 높이 z) 단면만 구한 뒤 어깨 회전 범위(±110°)만큼 회전시키면 실제 부피가
    // 그대로 나옵니다. 무작위 점을 흩뿌리는 것보다 형태가 훨씬 잘 보입니다.
    var workspace = null;

    function workspaceProfile(cell, samples) {
      var J = K.JOINTS;
      var maxR = {};
      var topIdx = 0;

      for (var s = 0; s < samples; s++) {
        var q = [0, 0, 0, 0, 0, 0];
        for (var k = 1; k <= 4; k++) {
          q[k] = J[k].lower + Math.random() * (J[k].upper - J[k].lower);
        }
        var p = K.toolPosition(q);
        if (p[2] < 0) continue;               // 테이블 아래는 그리지 않는다
        var zi = Math.floor(p[2] / cell);
        var r = Math.hypot(p[0], p[1]);
        if (!(zi in maxR) || r > maxR[zi]) maxR[zi] = r;
        if (zi > topIdx) topIdx = zi;
      }

      // 비어 있는 높이 행을 메우고 살짝 평활한다
      var raw = [];
      var last = 0;
      for (var i = 0; i <= topIdx; i++) {
        last = (i in maxR) ? maxR[i] : last;
        raw.push(last);
      }
      var prof = raw.map(function (v, i) {
        var a = raw[Math.max(0, i - 1)];
        var b = raw[Math.min(raw.length - 1, i + 1)];
        return (a + v + b) / 3;
      });

      var pts = prof.map(function (r, i) { return [r, i * cell]; });
      pts.push([0, (prof.length - 1) * cell + cell * 0.5]);   // 꼭대기를 닫는다
      return pts;
    }

    function buildWorkspace() {
      if (workspace) return workspace;

      var pts = workspaceProfile(0.012, 60000);
      var SEG = 56;
      var a0 = K.JOINTS[0].lower, a1 = K.JOINTS[0].upper;

      var pos = [];
      var idx = [];

      function vert(r, z, th) {
        pos.push(r * Math.cos(th), r * Math.sin(th), z);
        return pos.length / 3 - 1;
      }
      function angleAt(j) { return a0 + (a1 - a0) * (j / SEG); }

      // 바깥 옆면
      var grid = [];
      for (var i = 0; i < pts.length; i++) {
        var row = [];
        for (var j = 0; j <= SEG; j++) row.push(vert(pts[i][0], pts[i][1], angleAt(j)));
        grid.push(row);
      }
      for (var i2 = 0; i2 + 1 < pts.length; i2++) {
        for (var j2 = 0; j2 < SEG; j2++) {
          idx.push(grid[i2][j2], grid[i2][j2 + 1], grid[i2 + 1][j2 + 1]);
          idx.push(grid[i2][j2], grid[i2 + 1][j2 + 1], grid[i2 + 1][j2]);
        }
      }

      // 바닥 부채꼴
      var hub = vert(0, 0, 0);
      for (var j3 = 0; j3 < SEG; j3++) idx.push(hub, grid[0][j3 + 1], grid[0][j3]);

      // 양쪽 끝 단면 — 회전축(r=0)과 프로파일 사이를 메운다
      [0, SEG].forEach(function (j) {
        var th = angleAt(j);
        var axis = [];
        for (var i = 0; i < pts.length; i++) axis.push(vert(0, pts[i][1], th));
        for (var i = 0; i + 1 < pts.length; i++) {
          if (j === 0) {
            idx.push(axis[i], grid[i][j], grid[i + 1][j]);
            idx.push(axis[i], grid[i + 1][j], axis[i + 1]);
          } else {
            idx.push(axis[i], grid[i + 1][j], grid[i][j]);
            idx.push(axis[i], axis[i + 1], grid[i + 1][j]);
          }
        }
      });

      var geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();

      var shell = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: 0x4ade9a,
        transparent: true,
        opacity: 0.085,
        side: THREE.DoubleSide,
        depthWrite: false
      }));

      // 형태가 읽히도록 윤곽선을 얹는다
      var lines = [];
      function seg(r1, z1, t1, r2, z2, t2) {
        lines.push(r1 * Math.cos(t1), r1 * Math.sin(t1), z1,
                   r2 * Math.cos(t2), r2 * Math.sin(t2), z2);
      }
      // 양 끝 단면의 윤곽
      [0, SEG].forEach(function (j) {
        var th = angleAt(j);
        for (var i = 0; i + 1 < pts.length; i++) {
          seg(pts[i][0], pts[i][1], th, pts[i + 1][0], pts[i + 1][1], th);
        }
        seg(0, 0, th, pts[0][0], pts[0][1], th);
      });
      // 높이별 수평 호
      for (var i3 = 0; i3 < pts.length; i3 += 6) {
        for (var j4 = 0; j4 < SEG; j4++) {
          seg(pts[i3][0], pts[i3][1], angleAt(j4),
              pts[i3][0], pts[i3][1], angleAt(j4 + 1));
        }
      }
      var lineGeo = new THREE.BufferGeometry();
      lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
      var edges = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({
        color: 0x4ade9a, transparent: true, opacity: 0.35, depthWrite: false
      }));

      workspace = new THREE.Group();
      workspace.add(shell);
      workspace.add(edges);
      workspace.visible = false;
      workspace.renderOrder = -1;
      scene.add(workspace);

      var top = pts[pts.length - 2];
      var reach = Math.max.apply(null, pts.map(function (p) { return p[0]; }));

      // 처음 켜면 부피 전체가 화면에 들어오도록 카메라를 물린다
      orbit.dist = Math.max(orbit.dist, 1.55);
      orbit.target.set(0, 0, top[1] * 0.45);
      setStatus('작업영역 — 최대 반경 ' + (reach * 100).toFixed(0) +
                'cm · 최고 높이 ' + (top[1] * 100).toFixed(0) + 'cm');
      return workspace;
    }

    // ── 보조 카메라 ──
    var wristCam = new THREE.PerspectiveCamera(58, 4 / 3, 0.005, 8);
    wristCam.up.set(0, 0, 1);
    var topCam = new THREE.PerspectiveCamera(45, 4 / 3, 0.01, 8);
    topCam.up.set(0, 0, 1);
    topCam.position.set(0.34, -0.30, 0.40);
    topCam.lookAt(0.16, 0, 0.04);

    var camRenderers = null;
    function initCamRenderers() {
      if (camRenderers) return camRenderers;
      try {
        camRenderers = {
          wrist: new THREE.WebGLRenderer({ canvas: el('camWrist'), antialias: true }),
          top: new THREE.WebGLRenderer({ canvas: el('camTop'), antialias: true })
        };
        camRenderers.wrist.setSize(256, 192, false);
        camRenderers.top.setSize(256, 192, false);
      } catch (e) {
        camRenderers = null;
      }
      return camRenderers;
    }

    // ── 궤도 컨트롤 (자체 구현) ──
    var orbit = { yaw: -1.05, pitch: 0.55, dist: 0.72, target: new THREE.Vector3(0.09, 0, 0.12) };

    function applyCamera() {
      var cp = Math.cos(orbit.pitch), sp = Math.sin(orbit.pitch);
      camera.position.set(
        orbit.target.x + orbit.dist * cp * Math.cos(orbit.yaw),
        orbit.target.y + orbit.dist * cp * Math.sin(orbit.yaw),
        orbit.target.z + orbit.dist * sp);
      camera.lookAt(orbit.target);
    }

    var dom = renderer.domElement;
    var drag = null;

    dom.addEventListener('pointerdown', function (e) {
      dom.setPointerCapture(e.pointerId);
      if (state.ikDrag && e.button === 0 && hitTarget(e)) {
        drag = { mode: 'target', x: e.clientX, y: e.clientY };
        return;
      }
      drag = {
        mode: (e.button === 2 || e.shiftKey) ? 'pan' : 'orbit',
        x: e.clientX, y: e.clientY
      };
    });

    dom.addEventListener('pointermove', function (e) {
      if (!drag) {
        dom.style.cursor = (state.ikDrag && hitTarget(e)) ? 'move' : 'grab';
        return;
      }
      var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.x = e.clientX; drag.y = e.clientY;

      if (drag.mode === 'orbit') {
        orbit.yaw -= dx * 0.008;
        orbit.pitch = K.clamp(orbit.pitch + dy * 0.006, -0.35, 1.45);
      } else if (drag.mode === 'pan') {
        var right = new THREE.Vector3().crossVectors(
          camera.getWorldDirection(new THREE.Vector3()), camera.up).normalize();
        var up = new THREE.Vector3().crossVectors(right,
          camera.getWorldDirection(new THREE.Vector3())).normalize();
        orbit.target.addScaledVector(right, -dx * orbit.dist * 0.0016);
        orbit.target.addScaledVector(up, dy * orbit.dist * 0.0016);
      } else if (drag.mode === 'target') {
        dragTarget(e);
      }
    });

    ['pointerup', 'pointercancel'].forEach(function (evt) {
      dom.addEventListener(evt, function () { drag = null; });
    });

    dom.addEventListener('wheel', function (e) {
      e.preventDefault();
      orbit.dist = K.clamp(orbit.dist * (1 + Math.sign(e.deltaY) * 0.1), 0.25, 2.2);
    }, { passive: false });

    dom.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    // ── IK 타깃 픽/드래그 ──
    var raycaster = new THREE.Raycaster();
    var ndc = new THREE.Vector2();

    function toNdc(e) {
      var r = dom.getBoundingClientRect();
      ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
      return ndc;
    }

    function hitTarget(e) {
      raycaster.setFromCamera(toNdc(e), camera);
      return raycaster.intersectObject(targetMesh, false).length > 0;
    }

    var plane = new THREE.Plane();
    var hitPoint = new THREE.Vector3();

    function dragTarget(e) {
      var normal = camera.getWorldDirection(new THREE.Vector3()).negate();
      plane.setFromNormalAndCoplanarPoint(
        normal, new THREE.Vector3(state.ikTarget[0], state.ikTarget[1], state.ikTarget[2]));
      raycaster.setFromCamera(toNdc(e), camera);
      if (raycaster.ray.intersectPlane(plane, hitPoint)) {
        state.ikTarget = [hitPoint.x, hitPoint.y, Math.max(0.005, hitPoint.z)];
        writeIkInputs();
        solveIk();
      }
    }

    // ── 리사이즈 ──
    function resize() {
      var r = container.getBoundingClientRect();
      var w = Math.max(1, r.width), h = Math.max(1, r.height);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    window.addEventListener('resize', resize);
    resize();

    // ── 프레임 갱신 ──
    var m4 = new THREE.Matrix4();

    function setGroups(robot, fk) {
      K.LINK_ORDER.forEach(function (link) {
        var m = fk.links[link];
        if (m && robot.groups[link]) robot.groups[link].matrix.fromArray(m);
      });
    }

    function frame(fk) {
      setGroups(follower, fk);

      leader.root.visible = state.teleop;
      if (state.teleop) setGroups(leader, K.forward(state.qLeader));

      axes.visible = state.axes;
      if (state.axes) axes.matrix.fromArray(fk.tool);

      grid.visible = state.grid;
      table.visible = state.grid;

      targetMesh.visible = state.ikDrag ||
        document.querySelector('.tab-body[data-tab="ik"]').classList.contains('active');
      targetMesh.position.set(state.ikTarget[0], state.ikTarget[1], state.ikTarget[2]);

      cube.visible = state.cube;
      bin.visible = state.cube;
      if (state.cube) cube.position.set(state.cubePos[0], state.cubePos[1], state.cubePos[2]);

      if (state.workspace) buildWorkspace().visible = true;
      else if (workspace) workspace.visible = false;

      applyCamera();
      renderer.render(scene, camera);

      if (state.cameras) {
        var cr = initCamRenderers();
        if (cr) {
          var tp = K.matPos(fk.tool);
          var tz = K.matAxisZ(fk.tool);
          var ty = K.matAxisY(fk.tool);
          wristCam.position.set(
            tp[0] - tz[0] * 0.055 + ty[0] * 0.028,
            tp[1] - tz[1] * 0.055 + ty[1] * 0.028,
            tp[2] - tz[2] * 0.055 + ty[2] * 0.028);
          wristCam.up.set(-ty[0], -ty[1], -ty[2]);
          wristCam.lookAt(tp[0] + tz[0] * 0.12, tp[1] + tz[1] * 0.12, tp[2] + tz[2] * 0.12);
          cr.wrist.render(scene, wristCam);
          cr.top.render(scene, topCam);
        }
      }
      void m4;
    }

    function setView(name) {
      if (name === 'front') { orbit.yaw = -Math.PI / 2; orbit.pitch = 0.05; }
      else if (name === 'side') { orbit.yaw = 0; orbit.pitch = 0.05; }
      else if (name === 'top') { orbit.yaw = -Math.PI / 2; orbit.pitch = 1.42; }
      else { orbit.yaw = -1.05; orbit.pitch = 0.55; }
      orbit.dist = 0.72;
    }

    return { frame: frame, setView: setView, resize: resize, mode: '3d' };
  }

  // =====================================================================
  //  2D 폴백 렌더러
  // =====================================================================

  function createCanvasView(container) {
    var canvas = document.createElement('canvas');
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    container.appendChild(canvas);

    var rc = new window.RobotCanvas(canvas, { yaw: -1.0, pitch: 0.5, zoom: 1.1 });
    var drag = null;

    canvas.addEventListener('pointerdown', function (e) {
      drag = { x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', function (e) {
      if (!drag) return;
      rc.yaw += (e.clientX - drag.x) * 0.008;
      rc.pitch = K.clamp(rc.pitch + (e.clientY - drag.y) * 0.006, -0.3, 1.4);
      drag.x = e.clientX; drag.y = e.clientY;
    });
    ['pointerup', 'pointercancel'].forEach(function (evt) {
      canvas.addEventListener(evt, function () { drag = null; });
    });
    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      rc.zoom = K.clamp(rc.zoom * (1 - Math.sign(e.deltaY) * 0.1), 0.4, 3);
      rc.resize();
    }, { passive: false });

    window.addEventListener('resize', function () { rc.resize(); });

    return {
      mode: '2d',
      resize: function () { rc.resize(); },
      setView: function (name) {
        if (name === 'front') { rc.yaw = -Math.PI / 2; rc.pitch = 0.05; }
        else if (name === 'side') { rc.yaw = 0; rc.pitch = 0.05; }
        else if (name === 'top') { rc.yaw = -Math.PI / 2; rc.pitch = 1.4; }
        else { rc.yaw = -1.0; rc.pitch = 0.5; }
      },
      frame: function (fk) {
        rc.clear();
        if (state.grid) rc.drawGrid(0.3, 0.05);
        if (state.teleop) rc.drawRobot(state.qLeader, { ghost: true, alpha: 0.5 });
        rc.drawRobot(state.q);
        if (state.axes) rc.drawTool(fk);
      }
    };
  }

  // =====================================================================
  //  이벤트 바인딩
  // =====================================================================

  function bindUi() {
    // 탭
    el('tabs').addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-tab]');
      if (!btn) return;
      document.querySelectorAll('#tabs button').forEach(function (b) {
        b.classList.toggle('active', b === btn);
      });
      document.querySelectorAll('.tab-body').forEach(function (body) {
        body.classList.toggle('active', body.dataset.tab === btn.dataset.tab);
      });
    });

    // 단위
    el('unitToggle').addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-unit]');
      if (!btn) return;
      state.unit = btn.dataset.unit;
      el('unitToggle').querySelectorAll('button').forEach(function (b) {
        b.classList.toggle('active', b === btn);
      });
      syncSliders();
    });

    // 뷰 칩
    document.querySelector('.view-chips').addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-view]');
      if (!btn) return;
      document.querySelectorAll('.view-chips button').forEach(function (b) {
        b.classList.toggle('active', b === btn);
      });
      view.setView(btn.dataset.view);
    });

    // 표시 옵션
    var opts = [['optGrid', 'grid'], ['optAxes', 'axes'], ['optWorkspace', 'workspace'],
                ['optCube', 'cube'], ['optCameras', 'cameras']];
    opts.forEach(function (pair) {
      var input = el(pair[0]);
      input.checked = state[pair[1]];
      input.addEventListener('change', function () {
        state[pair[1]] = input.checked;
        if (pair[1] === 'cameras') el('camPanel').hidden = !input.checked;
        if (pair[1] === 'workspace' && input.checked && view.mode === '2d') {
          setStatus('작업영역 표시는 3D 모드에서만 지원합니다', 'warn');
        }
      });
    });

    // 조인트 탭
    el('btnZero').addEventListener('click', function () { applyPose('zero'); });
    el('btnRandom').addEventListener('click', function () {
      state.q = K.JOINTS.map(function (j) {
        return j.lower + Math.random() * (j.upper - j.lower);
      });
      state.qLeader = state.q.slice();
      syncSliders();
      setStatus('무작위 자세');
    });
    el('btnGripToggle').addEventListener('click', toggleGripper);

    // IK 탭
    ['ikX', 'ikY', 'ikZ'].forEach(function (id) {
      el(id).addEventListener('change', function () { readIkInputs(); solveIk(); });
    });
    el('ikDrag').addEventListener('change', function () { state.ikDrag = el('ikDrag').checked; });
    el('ikApproach').addEventListener('change', function () { state.ikApproach = el('ikApproach').checked; });
    el('btnSolve').addEventListener('click', function () { readIkInputs(); solveIk(); });
    el('btnTcpHere').addEventListener('click', function () {
      state.ikTarget = K.toolPosition(state.q);
      writeIkInputs();
      setStatus('목표를 현재 TCP로 이동');
    });

    // 텔레오퍼레이션 탭
    el('teleopOn').addEventListener('change', function () {
      state.teleop = el('teleopOn').checked;
      if (!state.teleop && state.serial.bus && state.serial.bus.isConnected()) {
        setStatus('실기 연결 중에는 추종을 끄면 시뮬 팔이 멈춥니다', 'warn');
      }
      leaderBuffer.length = 0;
      if (state.teleop) state.qLeader = state.q.slice();
      else el('limitWarn').hidden = true;
      syncSliders();
    });
    el('teleopLag').addEventListener('input', function () {
      state.lagMs = parseInt(el('teleopLag').value, 10);
      el('teleopLagVal').textContent = state.lagMs + ' ms';
    });
    el('btnLeaderSync').addEventListener('click', function () {
      state.qLeader = state.q.slice();
      leaderBuffer.length = 0;
      syncSliders();
    });

    // 녹화 탭
    el('btnRec').addEventListener('click', toggleRecord);
    el('btnPlay').addEventListener('click', playback);
    el('btnClear').addEventListener('click', function () {
      state.frames = [];
      updateRecUi();
      setStatus('녹화 데이터 삭제');
    });
    el('btnExport').addEventListener('click', exportJson);
    el('btnExportCsv').addEventListener('click', exportCsv);

    // ROS 탭
    el('btnCopyCmd').addEventListener('click', copyRosCommand);

    // 내보내기 결과 모달
    el('btnExportCopy').addEventListener('click', function () {
      var box = el('exportText');
      box.select();
      var done = function () {
        el('btnExportCopy').textContent = '복사됨';
        setTimeout(function () { el('btnExportCopy').textContent = '전체 복사'; }, 1400);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(box.value).then(done, function () {
          try { document.execCommand('copy'); done(); } catch (e) { /* noop */ }
        });
      } else {
        try { document.execCommand('copy'); done(); } catch (e) { /* noop */ }
      }
    });
    el('btnExportClose').addEventListener('click', function () {
      el('exportModal').hidden = true;
    });
    el('exportModal').addEventListener('click', function (e) {
      if (e.target === el('exportModal')) el('exportModal').hidden = true;
    });

    // 실기 리더 암
    initSerialUi();

    // 도움말
    el('btnHelp').addEventListener('click', function () { el('helpModal').hidden = false; });
    el('btnHelpClose').addEventListener('click', function () { el('helpModal').hidden = true; });
    el('helpModal').addEventListener('click', function (e) {
      if (e.target === el('helpModal')) el('helpModal').hidden = true;
    });

    // 단축키
    document.addEventListener('keydown', function (e) {
      if (e.target.matches('input, textarea, select')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      var order = ['rest', 'home', 'ready', 'pick', 'extended', 'zero'];
      if (e.key >= '1' && e.key <= '6') {
        applyPose(order[parseInt(e.key, 10) - 1]);
      } else if (e.key === 'g' || e.key === 'G') {
        toggleGripper();
      } else if (e.key === 'r' || e.key === 'R') {
        toggleRecord();
      } else if (e.key === 'Escape') {
        el('helpModal').hidden = true;
        el('exportModal').hidden = true;
      }
    });
  }

  function toggleGripper() {
    var j = K.JOINTS[5];
    var open = state.q[5] < (j.lower + j.upper) / 2;
    state.q[5] = open ? j.upper * 0.85 : j.lower + 0.05;
    state.qLeader[5] = state.q[5];
    syncSliders();
    setStatus(open ? '그리퍼 열림' : '그리퍼 닫힘');
  }

  // =====================================================================
  //  메인 루프
  // =====================================================================

  var last = performance.now();

  function loop(now) {
    var dt = now - last;
    last = now;

    stepTeleop(now);
    var fk = K.forward(state.q);
    stepCube(fk);
    stepRecord(dt);
    updateReadout(fk);
    updateRosMessages(fk);

    view.frame(fk);
    requestAnimationFrame(loop);
  }

  // =====================================================================
  //  부팅
  // =====================================================================

  async function boot() {
    buildPresets();
    buildSliders(el('jointSliders'),
      function () { return state.q; },
      function (q) { state.q = q; if (!state.teleop) state.qLeader = q.slice(); },
      false);
    buildSliders(el('leaderSliders'),
      function () { return state.qLeader; },
      function (q) { state.qLeader = q; if (!state.teleop) state.q = q.slice(); },
      true);
    syncSliders();
    writeIkInputs();
    updateRecUi();
    bindUi();

    var container = el('viewport');
    try {
      THREE = await import(THREE_URL);
      view = createThreeView(container);
    } catch (err) {
      console.warn('three.js 로드 실패 — 2D 폴백으로 전환합니다.', err);
      el('fallbackNote').hidden = false;
      el('optWorkspace').disabled = true;
      el('optCameras').disabled = true;
      el('ikDrag').checked = false;
      state.ikDrag = false;
      view = createCanvasView(container);
    }

    requestAnimationFrame(loop);
    setStatus('준비 완료 — ' + (view.mode === '3d' ? '3D 모드' : '2D 모드'));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
