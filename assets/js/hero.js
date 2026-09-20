/* hero.js — 홈 화면의 미니 로봇 뷰어 (자동 데모 + 마우스 드래그 회전) */
(function () {
  'use strict';

  var canvas = document.getElementById('heroCanvas');
  if (!canvas || !window.SO101 || !window.RobotCanvas) return;

  var K = window.SO101;
  var view = new window.RobotCanvas(canvas, {
    yaw: -0.85, pitch: 0.36, zoom: 1.45, target: [0.09, 0, 0.13]
  });

  // 데모 시퀀스: 프리셋 사이를 부드럽게 오간다
  var SEQ = ['rest', 'home', 'ready', 'pick', 'extended', 'home'];
  var step = 0;
  var t0 = performance.now();
  var DUR = 2200;   // 구간 전환 시간(ms)
  var HOLD = 550;   // 구간 사이 정지(ms)

  var q = K.POSES[SEQ[0]].q.slice();
  var dragging = false;
  var lastX = 0, lastY = 0;
  var userMoved = false;

  function ease(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

  function lerpPose(a, b, t) {
    return a.map(function (v, i) { return v + (b[i] - v) * t; });
  }

  function tick(now) {
    var elapsed = now - t0;
    var cycle = DUR + HOLD;
    if (elapsed > cycle) {
      t0 = now;
      step = (step + 1) % SEQ.length;
      elapsed = 0;
    }
    var from = K.POSES[SEQ[step]].q;
    var to = K.POSES[SEQ[(step + 1) % SEQ.length]].q;
    var t = Math.min(1, elapsed / DUR);
    q = lerpPose(from, to, ease(t));

    if (!dragging && !userMoved) view.yaw -= 0.0016;

    view.clear();
    view.drawGrid(0.28, 0.04);
    var fk = view.drawRobot(q);
    view.drawTool(fk);

    requestAnimationFrame(tick);
  }

  // --- 드래그 회전 ---
  canvas.style.cursor = 'grab';
  canvas.addEventListener('pointerdown', function (e) {
    dragging = true;
    userMoved = true;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = 'grabbing';
  });
  canvas.addEventListener('pointermove', function (e) {
    if (!dragging) return;
    view.yaw += (e.clientX - lastX) * 0.008;
    view.pitch = K.clamp(view.pitch + (e.clientY - lastY) * 0.006, -0.2, 1.3);
    lastX = e.clientX;
    lastY = e.clientY;
  });
  ['pointerup', 'pointercancel'].forEach(function (evt) {
    canvas.addEventListener(evt, function () {
      dragging = false;
      canvas.style.cursor = 'grab';
    });
  });

  var resizeTimer;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { view.resize(); }, 120);
  });

  requestAnimationFrame(tick);
})();
