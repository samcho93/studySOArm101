/*
 * hero.js — 홈 화면의 미니 로봇 뷰어 (자동 데모 + 마우스 드래그 회전)
 * -------------------------------------------------------------------------
 * 두 단계로 뜹니다.
 *
 *   1. 처음에는 의존성 없는 **2D 캔버스**로 바로 그립니다. 받을 게 없으니
 *      첫 화면이 비어 있는 순간이 없습니다.
 *   2. 페이지가 다 뜨면 뒤에서 three.js 와 메시 번들을 받아, 다 되면
 *      **실제 URDF 메시**를 쓰는 WebGL 화면으로 조용히 갈아끼웁니다.
 *
 * 둘 중 어느 쪽이 실패하든 1번 상태로 계속 돕니다.
 */
(function () {
  'use strict';

  var canvas = document.getElementById('heroCanvas');
  if (!canvas || !window.SO101 || !window.RobotCanvas) return;

  var K = window.SO101;
  var THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.js';
  var MESH_URL = 'assets/mesh/so101-meshes.bin';

  // ----------------------------------------------------------------- 상태
  var SEQ = ['rest', 'home', 'ready', 'pick', 'extended', 'home'];
  var DUR = 2200;    // 구간 전환 시간(ms)
  var HOLD = 550;    // 구간 사이 정지(ms)

  var yaw = -0.85, pitch = 0.36;
  var step = 0;
  var t0 = performance.now();
  var q = K.POSES[SEQ[0]].q.slice();
  var dragging = false, userMoved = false;
  var lastX = 0, lastY = 0;

  function ease(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

  function lerpPose(a, b, t) {
    return a.map(function (v, i) { return v + (b[i] - v) * t; });
  }

  // ================================================================= 2D 화면
  function make2d() {
    var view = new window.RobotCanvas(canvas, {
      yaw: yaw, pitch: pitch, zoom: 1.45, target: [0.09, 0, 0.13]
    });
    return {
      draw: function (pose) {
        view.yaw = yaw;
        view.pitch = pitch;
        view.clear();
        view.drawGrid(0.28, 0.04);
        view.drawTool(view.drawRobot(pose));
      },
      resize: function () { view.resize(); },
      syncTheme: function () { view.syncTheme(); },
      hide: function () { canvas.style.display = 'none'; }
    };
  }

  // ================================================================= 3D 화면
  function make3d(THREE, data) {
    var el = document.createElement('canvas');
    el.className = 'hero-gl';
    canvas.parentNode.appendChild(el);

    var scene = new THREE.Scene();
    THREE.Object3D.DEFAULT_UP = new THREE.Vector3(0, 0, 1);

    var camera = new THREE.PerspectiveCamera(34, 1, 0.01, 10);
    camera.up.set(0, 0, 1);

    var renderer = new THREE.WebGLRenderer({ canvas: el, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    var key = new THREE.DirectionalLight(0xffffff, 1.5);
    key.position.set(0.7, -0.9, 1.2);
    scene.add(key);
    var fill = new THREE.DirectionalLight(0xffffff, 0.45);
    fill.position.set(-0.8, 0.5, 0.3);
    scene.add(fill);

    // 메시 번들에는 법선이 없습니다 — flatShading 으로 면 법선을 구합니다
    var matPrint = new THREE.MeshStandardMaterial({
      color: 0xf0c020, roughness: 0.6, metalness: 0.05, flatShading: true });
    var matServo = new THREE.MeshStandardMaterial({
      color: 0x2b3542, roughness: 0.5, metalness: 0.35, flatShading: true });

    var geoms = [];
    function geometryFor(i) {
      if (geoms[i]) return geoms[i];
      var m = data.meshes[i];
      var g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(m.position, 3));
      g.setIndex(new THREE.BufferAttribute(m.index, 1));
      geoms[i] = g;
      return g;
    }

    var groups = {};
    var root = new THREE.Group();
    K.LINK_ORDER.forEach(function (link) {
      var g = new THREE.Group();
      g.matrixAutoUpdate = false;
      (data.links[link] || []).forEach(function (v) {
        var mesh = new THREE.Mesh(geometryFor(v.mesh),
          v.mat === 'servo' ? matServo : matPrint);
        mesh.matrixAutoUpdate = false;
        mesh.matrix.fromArray(K.matFromRpyXyz(v.rpy, v.xyz));
        g.add(mesh);
      });
      groups[link] = g;
      root.add(g);
    });
    scene.add(root);

    var tcp = new THREE.Mesh(
      new THREE.SphereGeometry(0.008, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0x4ade9a }));
    tcp.matrixAutoUpdate = false;
    scene.add(tcp);

    var grid = null;
    function syncTheme() {
      var light = (window.SOTheme ? window.SOTheme.resolved() : 'dark') === 'light';
      if (grid) {
        scene.remove(grid);
        grid.geometry.dispose();
        grid.material.dispose();
      }
      grid = new THREE.GridHelper(0.56, 14,
        light ? 0x9fb3c8 : 0x3b5068,
        light ? 0xd2dcea : 0x232e3c);
      grid.rotation.x = Math.PI / 2;
      scene.add(grid);
    }
    syncTheme();

    function resize() {
      var wrap = canvas.parentNode;
      var w = wrap.clientWidth || 1, h = wrap.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    resize();

    var target = new THREE.Vector3(0.10, 0, 0.13);
    var dist = 0.68;

    return {
      draw: function (pose) {
        var fk = K.forward(pose);
        K.LINK_ORDER.forEach(function (link) {
          var m = fk.links[link];
          if (m && groups[link]) groups[link].matrix.fromArray(m);
        });
        tcp.matrix.fromArray(fk.tool);
        root.updateMatrixWorld(true);

        var cp = Math.cos(pitch), sp = Math.sin(pitch);
        camera.position.set(
          target.x + dist * cp * Math.cos(yaw),
          target.y + dist * cp * Math.sin(yaw),
          target.z + dist * sp);
        camera.lookAt(target);
        renderer.render(scene, camera);
      },
      resize: resize,
      syncTheme: syncTheme,
      hide: function () { el.remove(); }
    };
  }

  // ================================================================= 공통
  var mode = '2d';
  var view = make2d();

  function tick(now) {
    var elapsed = now - t0;
    if (elapsed > DUR + HOLD) {
      t0 = now;
      step = (step + 1) % SEQ.length;
      elapsed = 0;
    }
    var from = K.POSES[SEQ[step]].q;
    var to = K.POSES[SEQ[(step + 1) % SEQ.length]].q;
    q = lerpPose(from, to, ease(Math.min(1, elapsed / DUR)));

    if (!dragging && !userMoved) yaw -= 0.0016;

    view.draw(q);
    requestAnimationFrame(tick);
  }

  // --- 드래그 회전 (덮여 있는 2D 캔버스가 아니라 감싸는 상자에서 받습니다) ---
  var wrap = canvas.parentNode;
  wrap.style.cursor = 'grab';
  wrap.addEventListener('pointerdown', function (e) {
    dragging = true;
    userMoved = true;
    lastX = e.clientX;
    lastY = e.clientY;
    try { wrap.setPointerCapture(e.pointerId); } catch (err) { /* 합성 이벤트 */ }
    wrap.style.cursor = 'grabbing';
  });
  wrap.addEventListener('pointermove', function (e) {
    if (!dragging) return;
    yaw += (e.clientX - lastX) * 0.008;
    pitch = K.clamp(pitch + (e.clientY - lastY) * 0.006, -0.2, 1.3);
    lastX = e.clientX;
    lastY = e.clientY;
  });
  ['pointerup', 'pointercancel'].forEach(function (evt) {
    wrap.addEventListener(evt, function () {
      dragging = false;
      wrap.style.cursor = 'grab';
    });
  });

  document.addEventListener('themechange', function () { view.syncTheme(); });

  var resizeTimer;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { view.resize(); }, 120);
  });

  requestAnimationFrame(tick);

  // 콘솔에서 상태를 들여다볼 때 쓰는 핸들
  window.__hero = {
    state: function () {
      return { yaw: yaw, pitch: pitch, q: q, userMoved: userMoved, mode: mode };
    }
  };

  // ----------------------------------------------------- 실제 메시로 갈아끼우기
  /**
   * 첫 화면을 막지 않으려고 load 이후에 시작합니다.
   * 데이터 절약 모드면 2D 그대로 둡니다 — 여기서만 2MB 가까이 받습니다.
   */
  function upgrade() {
    if (!window.SO101Meshes) return;
    var conn = navigator.connection;
    if (conn && conn.saveData) return;

    Promise.all([
      import(THREE_URL),
      window.SO101Meshes.load(MESH_URL)
    ]).then(function (r) {
      var next = make3d(r[0], r[1]);
      var old = view;
      view = next;
      mode = 'mesh';
      old.hide();
    }).catch(function (err) {
      console.info('홈 미니 뷰어는 2D 로 둡니다 —', err && err.message);
    });
  }

  if (document.readyState === 'complete') setTimeout(upgrade, 200);
  else window.addEventListener('load', function () { setTimeout(upgrade, 200); });
})();
