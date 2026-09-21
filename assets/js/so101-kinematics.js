/*
 * so101-kinematics.js
 * -------------------------------------------------------------------------
 * SO-ARM101(SO-101 follower) 기구학 정의 + 정기구학/역기구학 계산기.
 *
 * 수치는 TheRobotStudio/SO-ARM100 저장소의 so101_new_calib.urdf 에서 그대로
 * 가져왔습니다. (단위: m, rad / 조인트 축은 모두 자기 좌표계의 +Z)
 *
 * 의존성 없음. <script src> 로 불러오면 window.SO101 로 노출됩니다.
 */
(function (global) {
  'use strict';

  // ----------------------------------------------------------------- 로봇 정의

  /** URDF <joint> 체인. parent 프레임 기준 origin(xyz, rpy) 후 axis(+Z) 회전. */
  var JOINTS = [
    {
      name: 'shoulder_pan', ko: '어깨 회전', parent: 'base_link', child: 'shoulder_link',
      xyz: [0.0388353, 0, 0.0624], rpy: [Math.PI, 0, -Math.PI],
      lower: -1.91986, upper: 1.91986, motorId: 1, gear: '1/345'
    },
    {
      name: 'shoulder_lift', ko: '어깨 들기', parent: 'shoulder_link', child: 'upper_arm_link',
      xyz: [-0.0303992, -0.0182778, -0.0542], rpy: [-Math.PI / 2, -Math.PI / 2, 0],
      lower: -1.74533, upper: 1.74533, motorId: 2, gear: '1/345'
    },
    {
      name: 'elbow_flex', ko: '팔꿈치', parent: 'upper_arm_link', child: 'lower_arm_link',
      xyz: [-0.11257, -0.028, 0], rpy: [0, 0, Math.PI / 2],
      lower: -1.69, upper: 1.69, motorId: 3, gear: '1/345'
    },
    {
      name: 'wrist_flex', ko: '손목 굽힘', parent: 'lower_arm_link', child: 'wrist_link',
      xyz: [-0.1349, 0.0052, 0], rpy: [0, 0, -Math.PI / 2],
      lower: -1.65806, upper: 1.65806, motorId: 4, gear: '1/345'
    },
    {
      name: 'wrist_roll', ko: '손목 회전', parent: 'wrist_link', child: 'gripper_link',
      xyz: [0, -0.0611, 0.0181], rpy: [Math.PI / 2, 0.0486795, Math.PI],
      lower: -2.74385, upper: 2.84121, motorId: 5, gear: '1/345'
    },
    {
      name: 'gripper', ko: '그리퍼', parent: 'gripper_link', child: 'moving_jaw_so101_v1_link',
      xyz: [0.0202, 0.0188, -0.0234], rpy: [Math.PI / 2, 0, 0],
      lower: -0.174533, upper: 1.74533, motorId: 6, gear: '1/345'
    }
  ];

  /** 고정 조인트: 그리퍼 TCP(툴 중심점) 프레임. */
  var TOOL = {
    name: 'gripper_frame_joint', parent: 'gripper_link', child: 'gripper_frame_link',
    xyz: [-0.0079, -0.000218121, -0.0981274], rpy: [0, Math.PI, 0]
  };

  /**
   * 링크별 렌더링용 근사 형상. URDF 의 <inertial><origin> (질량중심)을 상자 중심으로
   * 쓰고, 이웃 조인트 거리에 맞춰 크기를 잡았습니다. 실제 STL 메시 대신 사용합니다.
   */
  var LINK_SHAPES = {
    base_link: [
      { type: 'box', size: [0.105, 0.115, 0.055], pos: [0.012, 0, 0.028], mat: 'print' },
      { type: 'box', size: [0.048, 0.055, 0.052], pos: [0.030, 0, 0.060], mat: 'servo' }
    ],
    shoulder_link: [
      { type: 'box', size: [0.070, 0.062, 0.050], pos: [-0.030, 0, -0.028], mat: 'print' },
      { type: 'box', size: [0.050, 0.052, 0.045], pos: [-0.030, -0.014, -0.050], mat: 'servo' }
    ],
    upper_arm_link: [
      { type: 'box', size: [0.150, 0.050, 0.042], pos: [-0.058, -0.014, 0.018], mat: 'print' },
      { type: 'box', size: [0.050, 0.046, 0.052], pos: [-0.112, -0.028, 0.018], mat: 'servo' }
    ],
    lower_arm_link: [
      { type: 'box', size: [0.150, 0.046, 0.040], pos: [-0.070, 0.004, 0.018], mat: 'print' },
      { type: 'box', size: [0.048, 0.046, 0.050], pos: [-0.135, 0.005, 0.018], mat: 'servo' }
    ],
    wrist_link: [
      { type: 'box', size: [0.046, 0.075, 0.046], pos: [0, -0.034, 0.024], mat: 'print' },
      { type: 'box', size: [0.044, 0.048, 0.046], pos: [0, -0.052, 0.024], mat: 'servo' }
    ],
    gripper_link: [
      { type: 'box', size: [0.046, 0.046, 0.048], pos: [0.004, 0, -0.022], mat: 'servo' },
      { type: 'box', size: [0.016, 0.030, 0.070], pos: [-0.008, 0.000, -0.068], mat: 'print' }
    ],
    moving_jaw_so101_v1_link: [
      { type: 'box', size: [0.014, 0.062, 0.034], pos: [-0.002, -0.030, 0.014], mat: 'print' }
    ]
  };

  var LINK_ORDER = ['base_link', 'shoulder_link', 'upper_arm_link', 'lower_arm_link',
    'wrist_link', 'gripper_link', 'moving_jaw_so101_v1_link'];

  /** 화면에 보여 줄 링크 이름 */
  var LINK_LABELS = {
    base_link: '베이스',
    shoulder_link: '어깨',
    upper_arm_link: '상완',
    lower_arm_link: '전완',
    wrist_link: '손목',
    gripper_link: '그리퍼',
    moving_jaw_so101_v1_link: '집게',
    gripper_frame_link: 'TCP'
  };

  /** IK 에 사용할 조인트(그리퍼 제외) */
  var IK_JOINTS = [0, 1, 2, 3, 4];

  /** 자주 쓰는 자세 프리셋 (rad) */
  var POSES = {
    zero:     { ko: '영점(Zero)',       q: [0, 0, 0, 0, 0, 0.6] },
    rest:     { ko: '휴식(Rest)',       q: [0, -1.68, 1.60, 0.75, 0, 0.4] },
    home:     { ko: '홈(Home)',         q: [0, -0.60, 0.90, 0.60, 0, 0.6] },
    ready:    { ko: '준비(Ready)',      q: [0, -0.30, 0.55, 0.95, 0, 1.0] },
    extended: { ko: '펼침(Extended)',   q: [0, 0.35, -0.45, 0.15, 0, 0.3] },
    pick:     { ko: '집기(Pick)',       q: [0.45, 0.10, 0.35, 0.95, 0, 1.4] }
  };

  // -------------------------------------------------------------- 4x4 행렬 유틸
  // 열 우선(column-major) 배열 16개. three.js Matrix4 와 동일한 메모리 배치.

  function matIdentity() {
    return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  }

  function matMul(a, b) {
    var o = new Array(16);
    for (var c = 0; c < 4; c++) {
      for (var r = 0; r < 4; r++) {
        o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] +
                       a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
      }
    }
    return o;
  }

  /** URDF rpy(고정축 X→Y→Z, 즉 R = Rz·Ry·Rx) + 평행이동 */
  function matFromRpyXyz(rpy, xyz) {
    var cr = Math.cos(rpy[0]), sr = Math.sin(rpy[0]);
    var cp = Math.cos(rpy[1]), sp = Math.sin(rpy[1]);
    var cy = Math.cos(rpy[2]), sy = Math.sin(rpy[2]);
    return [
      cy * cp,                  sy * cp,                  -sp,      0,
      cy * sp * sr - sy * cr,   sy * sp * sr + cy * cr,    cp * sr, 0,
      cy * sp * cr + sy * sr,   sy * sp * cr - cy * sr,    cp * cr, 0,
      xyz[0],                   xyz[1],                    xyz[2],  1
    ];
  }

  /** +Z 축 회전 행렬 */
  function matRotZ(a) {
    var c = Math.cos(a), s = Math.sin(a);
    return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  }

  function matPos(m) { return [m[12], m[13], m[14]]; }
  function matAxisX(m) { return [m[0], m[1], m[2]]; }
  function matAxisY(m) { return [m[4], m[5], m[6]]; }
  function matAxisZ(m) { return [m[8], m[9], m[10]]; }

  /** 회전 행렬 → RPY(roll, pitch, yaw) */
  function matToRpy(m) {
    var sp = -m[2];
    sp = Math.max(-1, Math.min(1, sp));
    var pitch = Math.asin(sp);
    var roll, yaw;
    if (Math.abs(sp) > 0.99999) {
      roll = 0;
      yaw = Math.atan2(-m[4], m[5]);
    } else {
      roll = Math.atan2(m[6], m[10]);
      yaw = Math.atan2(m[1], m[0]);
    }
    return [roll, pitch, yaw];
  }

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function deg(r) { return r * 180 / Math.PI; }
  function rad(d) { return d * Math.PI / 180; }

  // ------------------------------------------------------------------ 정기구학

  /**
   * 정기구학. 각 링크의 base_link 기준 4x4 변환을 반환합니다.
   * @param {number[]} q 조인트 각 6개 (rad)
   * @returns {{links:Object, tool:number[], jointFrames:Object}}
   */
  function forward(q) {
    var links = { base_link: matIdentity() };
    var jointFrames = {};
    for (var i = 0; i < JOINTS.length; i++) {
      var j = JOINTS[i];
      var parent = links[j.parent] || matIdentity();
      var origin = matMul(parent, matFromRpyXyz(j.rpy, j.xyz));
      jointFrames[j.name] = origin;
      links[j.child] = matMul(origin, matRotZ(q[i] || 0));
    }
    var tool = matMul(links.gripper_link, matFromRpyXyz(TOOL.rpy, TOOL.xyz));
    links.gripper_frame_link = tool;
    return { links: links, tool: tool, jointFrames: jointFrames };
  }

  /** TCP 위치만 빠르게 */
  function toolPosition(q) { return matPos(forward(q).tool); }

  /** 조인트 한계로 클램프 */
  function clampToLimits(q) {
    return q.map(function (v, i) {
      return JOINTS[i] ? clamp(v, JOINTS[i].lower, JOINTS[i].upper) : v;
    });
  }

  // ------------------------------------------------------------------ 역기구학

  /**
   * 감쇠 최소자승(DLS, Levenberg-Marquardt) 공용 솔버.
   *
   * residual(q) 가 "0에 가까워져야 하는 값들"을 돌려주면, 지정한 조인트만
   * 움직여 그 값을 줄입니다. 조인트 한계는 매 반복마다 클램프합니다.
   *
   * @param {(q:number[])=>number[]} residual
   * @param {number[]} jointIdx  움직여도 되는 조인트 인덱스
   * @param {number[]} qInit
   * @param {Object}   opt  {iterations, lambda, step}
   */
  function solveDls(residual, jointIdx, qInit, opt) {
    opt = opt || {};
    var iterations = opt.iterations || 140;
    var lambda = opt.lambda || 0.06;
    var step = opt.step || 0.6;
    var h = 1e-5;

    var q = (qInit || [0, 0, 0, 0, 0, 0]).slice();
    var n = jointIdx.length;
    if (!n) return { q: q, error: Infinity, converged: false };

    for (var it = 0; it < iterations; it++) {
      var e = residual(q);
      if (Math.hypot(e[0], e[1], e[2]) < 5e-5) break;

      // 수치 야코비안 (rows x n)
      var rows = e.length;
      var J = [];
      for (var r0 = 0; r0 < rows; r0++) J.push(new Array(n).fill(0));
      for (var k = 0; k < n; k++) {
        var qp = q.slice();
        qp[jointIdx[k]] += h;
        var ep = residual(qp);
        for (var r1 = 0; r1 < rows; r1++) J[r1][k] = (ep[r1] - e[r1]) / h;
      }

      var JtJ = [];
      for (var a = 0; a < n; a++) {
        JtJ.push(new Array(n).fill(0));
        for (var b = 0; b < n; b++) {
          var sa = 0;
          for (var rr = 0; rr < rows; rr++) sa += J[rr][a] * J[rr][b];
          JtJ[a][b] = sa + (a === b ? lambda * lambda : 0);
        }
      }
      var Jte = new Array(n).fill(0);
      for (var a2 = 0; a2 < n; a2++) {
        var sb = 0;
        for (var rr2 = 0; rr2 < rows; rr2++) sb += J[rr2][a2] * (-e[rr2]);
        Jte[a2] = sb;
      }

      var dq = solveLinear(JtJ, Jte);
      if (!dq) break;
      // dq = (AᵀA + λ²I)⁻¹ Aᵀe  (A = ∂p/∂q) → 오차를 줄이는 방향이므로 더한다
      for (var k2 = 0; k2 < n; k2++) {
        var ji = jointIdx[k2];
        q[ji] = clamp(q[ji] + step * dq[k2], JOINTS[ji].lower, JOINTS[ji].upper);
      }
    }

    var fin = residual(q);
    var err = Math.hypot(fin[0], fin[1], fin[2]);
    return { q: q, error: err, converged: err < 5e-3 };
  }

  /** 4x4 행렬로 점 하나를 변환 */
  function xformPoint(m, p) {
    return [
      m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
      m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
      m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]
    ];
  }

  /**
   * 그 링크를 움직일 수 있는 조인트들. 사슬이 직선이라 조상 조인트가 전부입니다.
   * 그리퍼 조인트(5)는 물건을 잡는 용도이므로 끌기에서 제외합니다.
   */
  function jointsForLink(name) {
    var ci = (name === 'gripper_frame_link')
      ? LINK_ORDER.length
      : LINK_ORDER.indexOf(name);
    if (ci < 0) return [];
    var n = Math.min(ci, IK_JOINTS.length);
    var out = [];
    for (var i = 0; i < n; i++) out.push(i);
    return out;
  }

  /**
   * TCP 를 목표 위치로 가져가는 역기구학.
   *
   * @param {number[]} target [x,y,z] (m)
   * @param {number[]} qInit  시작 자세
   * @param {Object}   opt    {iterations, lambda, step, approach, approachWeight}
   * @returns {{q:number[], error:number, converged:boolean}}
   */
  function inverse(target, qInit, opt) {
    opt = opt || {};
    var approach = opt.approach || null;
    var aw = opt.approachWeight != null ? opt.approachWeight : 0.35;

    return solveDls(function (qq) {
      var fk = forward(qq);
      var p = matPos(fk.tool);
      var r = [target[0] - p[0], target[1] - p[1], target[2] - p[2]];
      if (approach) {
        var z = matAxisZ(fk.tool);
        r.push(aw * (approach[0] - z[0]));
        r.push(aw * (approach[1] - z[1]));
        r.push(aw * (approach[2] - z[2]));
      }
      return r;
    }, IK_JOINTS, qInit, opt);
  }

  /**
   * 링크 위의 한 점을 목표 위치로 끌어당기는 역기구학.
   * 마우스로 팔을 직접 집어 끌 때 씁니다 — 집은 지점이 마우스를 따라옵니다.
   *
   * @param {string}   linkName   집은 링크
   * @param {number[]} localPoint 링크 좌표계에서 집은 지점
   * @param {number[]} target     목표 위치 (월드)
   * @param {number[]} qInit
   * @param {Object}   opt        {joints, iterations, lambda, step}
   */
  function inverseLink(linkName, localPoint, target, qInit, opt) {
    opt = opt || {};
    var idx = opt.joints || jointsForLink(linkName);
    var lp = localPoint || [0, 0, 0];

    return solveDls(function (qq) {
      var m = forward(qq).links[linkName];
      if (!m) return [0, 0, 0];
      var p = xformPoint(m, lp);
      return [target[0] - p[0], target[1] - p[1], target[2] - p[2]];
    }, idx, qInit, opt);
  }

  /** 가우스 소거법 (작은 정방행렬용) */
  function solveLinear(A, b) {
    var n = b.length;
    var M = A.map(function (row, i) { return row.concat([b[i]]); });
    for (var c = 0; c < n; c++) {
      var piv = c;
      for (var r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
      if (Math.abs(M[piv][c]) < 1e-12) return null;
      var t = M[c]; M[c] = M[piv]; M[piv] = t;
      for (var r2 = c + 1; r2 < n; r2++) {
        var f = M[r2][c] / M[c][c];
        for (var c2 = c; c2 <= n; c2++) M[r2][c2] -= f * M[c][c2];
      }
    }
    var x = new Array(n).fill(0);
    for (var i = n - 1; i >= 0; i--) {
      var s = M[i][n];
      for (var j = i + 1; j < n; j++) s -= M[i][j] * x[j];
      x[i] = s / M[i][i];
    }
    return x;
  }

  // ------------------------------------------------- LeRobot 서보 단위 변환

  /**
   * LeRobot 은 각 조인트를 -100~100(그리퍼는 0~100) 정규화 값으로 다룹니다.
   * 캘리브레이션 range 를 선형 매핑한 근사 변환입니다.
   */
  function radToNorm(name, value) {
    var j = JOINTS.find(function (x) { return x.name === name; });
    if (!j) return 0;
    if (name === 'gripper') return (value - j.lower) / (j.upper - j.lower) * 100;
    var mid = (j.upper + j.lower) / 2;
    var half = (j.upper - j.lower) / 2;
    return (value - mid) / half * 100;
  }

  function normToRad(name, value) {
    var j = JOINTS.find(function (x) { return x.name === name; });
    if (!j) return 0;
    if (name === 'gripper') return j.lower + (value / 100) * (j.upper - j.lower);
    var mid = (j.upper + j.lower) / 2;
    var half = (j.upper - j.lower) / 2;
    return mid + (value / 100) * half;
  }

  /** STS3215 원시 틱(0~4095, 360°) ↔ 라디안 */
  function ticksToRad(ticks) { return (ticks - 2048) * (2 * Math.PI / 4096); }
  function radToTicks(r) { return Math.round(2048 + r * (4096 / (2 * Math.PI))); }

  // ---------------------------------------------------------------- 내보내기

  global.SO101 = {
    JOINTS: JOINTS,
    TOOL: TOOL,
    LINK_SHAPES: LINK_SHAPES,
    LINK_ORDER: LINK_ORDER,
    IK_JOINTS: IK_JOINTS,
    POSES: POSES,
    forward: forward,
    inverse: inverse,
    inverseLink: inverseLink,
    solveDls: solveDls,
    jointsForLink: jointsForLink,
    xformPoint: xformPoint,
    LINK_LABELS: LINK_LABELS,
    toolPosition: toolPosition,
    clampToLimits: clampToLimits,
    matIdentity: matIdentity,
    matMul: matMul,
    matFromRpyXyz: matFromRpyXyz,
    matRotZ: matRotZ,
    matPos: matPos,
    matAxisX: matAxisX,
    matAxisY: matAxisY,
    matAxisZ: matAxisZ,
    matToRpy: matToRpy,
    radToNorm: radToNorm,
    normToRad: normToRad,
    ticksToRad: ticksToRad,
    radToTicks: radToTicks,
    deg: deg,
    rad: rad,
    clamp: clamp
  };
})(typeof window !== 'undefined' ? window : globalThis);
