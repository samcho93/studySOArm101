/*
 * robot-canvas.js
 * -------------------------------------------------------------------------
 * 의존성 없는 Canvas 2D 기반 SO-ARM101 렌더러.
 * three.js 를 쓸 수 없는 환경(오프라인, 저사양)에서도 로봇을 그립니다.
 * SO101(so101-kinematics.js) 의 변환 결과를 그대로 사용합니다.
 */
(function (global) {
  'use strict';

  var K = global.SO101;

  /** 단위 박스의 8개 꼭짓점 (로컬 좌표) */
  function boxVerts(size, pos) {
    var hx = size[0] / 2, hy = size[1] / 2, hz = size[2] / 2;
    var x = pos[0], y = pos[1], z = pos[2];
    return [
      [x - hx, y - hy, z - hz], [x + hx, y - hy, z - hz],
      [x + hx, y + hy, z - hz], [x - hx, y + hy, z - hz],
      [x - hx, y - hy, z + hz], [x + hx, y - hy, z + hz],
      [x + hx, y + hy, z + hz], [x - hx, y + hy, z + hz]
    ];
  }

  var BOX_FACES = [
    [0, 1, 2, 3], [4, 5, 6, 7],
    [0, 1, 5, 4], [2, 3, 7, 6],
    [1, 2, 6, 5], [0, 3, 7, 4]
  ];

  /** 행렬(열 우선 16)로 점 변환 */
  function xform(m, p) {
    return [
      m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
      m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
      m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]
    ];
  }

  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }
  function norm(v) {
    var l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

  /**
   * 캔버스 뷰어.
   * @param {HTMLCanvasElement} canvas
   * @param {Object} opt {yaw, pitch, zoom, target, palette}
   */
  function RobotCanvas(canvas, opt) {
    opt = opt || {};
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.yaw = opt.yaw != null ? opt.yaw : -0.9;
    this.pitch = opt.pitch != null ? opt.pitch : 0.42;
    this.zoom = opt.zoom || 1;
    this.target = opt.target || [0.06, 0, 0.14];
    this.palette = opt.palette || {
      print: '#f0c020',
      servo: '#2a3340',
      edge: 'rgba(0,0,0,0.35)',
      grid: 'rgba(120,160,200,0.16)',
      ghost: 'rgba(120,200,255,0.30)'
    };
    this.syncTheme();
    this.light = norm([-0.4, -0.7, 0.9]);
    this._resize();
  }

  RobotCanvas.prototype._resize = function () {
    var dpr = global.devicePixelRatio || 1;
    var rect = this.canvas.getBoundingClientRect();
    var w = Math.max(1, Math.round(rect.width || this.canvas.width));
    var h = Math.max(1, Math.round(rect.height || this.canvas.height));
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = w;
    this.h = h;
    this.scale = Math.min(w, h) * 1.55 * this.zoom;
  };

  RobotCanvas.prototype.resize = function () { this._resize(); };

  /** 격자 색을 현재 테마의 CSS 토큰에서 읽어 온다. */
  RobotCanvas.prototype.syncTheme = function () {
    try {
      var css = getComputedStyle(document.documentElement);
      var border = css.getPropertyValue('--border').trim();
      if (border) this.palette.grid = border;
    } catch (e) { /* 계산 스타일을 못 읽는 환경 */ }
  };

  /** 월드 좌표 → 화면 좌표 (직교 투영) */
  RobotCanvas.prototype.project = function (p) {
    var dx = p[0] - this.target[0];
    var dy = p[1] - this.target[1];
    var dz = p[2] - this.target[2];

    var cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    var x1 = dx * cy - dy * sy;
    var y1 = dx * sy + dy * cy;

    var cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    var y2 = y1 * cp - dz * sp;
    var z2 = y1 * sp + dz * cp;

    return {
      x: this.w / 2 + x1 * this.scale,
      y: this.h / 2 + y2 * this.scale,
      depth: z2
    };
  };

  RobotCanvas.prototype.clear = function () {
    this.ctx.clearRect(0, 0, this.w, this.h);
  };

  /** 바닥 격자 */
  RobotCanvas.prototype.drawGrid = function (extent, step) {
    extent = extent || 0.30;
    step = step || 0.05;
    var ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = this.palette.grid;
    ctx.lineWidth = 1;
    for (var v = -extent; v <= extent + 1e-9; v += step) {
      var a = this.project([v, -extent, 0]);
      var b = this.project([v, extent, 0]);
      var c = this.project([-extent, v, 0]);
      var d = this.project([extent, v, 0]);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.stroke();
    }
    ctx.restore();
  };

  /**
   * 로봇을 그립니다.
   * @param {number[]} q 조인트 각 6개
   * @param {Object} o {alpha, ghost}
   */
  RobotCanvas.prototype.drawRobot = function (q, o) {
    o = o || {};
    var fk = K.forward(q);
    var faces = [];
    var self = this;

    K.LINK_ORDER.forEach(function (link) {
      var m = fk.links[link];
      if (!m) return;
      (K.LINK_SHAPES[link] || []).forEach(function (shape) {
        var verts = boxVerts(shape.size, shape.pos).map(function (p) {
          return xform(m, p);
        });
        BOX_FACES.forEach(function (idx) {
          var pts = idx.map(function (i) { return verts[i]; });
          var n = norm(cross(sub(pts[1], pts[0]), sub(pts[2], pts[0])));
          var shade = 0.42 + 0.58 * Math.max(0, dot(n, self.light));
          var proj = pts.map(function (p) { return self.project(p); });
          var depth = proj.reduce(function (s, p) { return s + p.depth; }, 0) / 4;
          faces.push({ proj: proj, depth: depth, mat: shape.mat, shade: shade });
        });
      });
    });

    faces.sort(function (a, b) { return a.depth - b.depth; });

    var ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = o.alpha != null ? o.alpha : 1;
    ctx.lineJoin = 'round';

    faces.forEach(function (f) {
      ctx.beginPath();
      ctx.moveTo(f.proj[0].x, f.proj[0].y);
      for (var i = 1; i < 4; i++) ctx.lineTo(f.proj[i].x, f.proj[i].y);
      ctx.closePath();
      if (o.ghost) {
        ctx.fillStyle = self.palette.ghost;
      } else {
        var base = f.mat === 'servo' ? self.palette.servo : self.palette.print;
        ctx.fillStyle = shadeColor(base, f.shade);
      }
      ctx.fill();
      ctx.strokeStyle = self.palette.edge;
      ctx.lineWidth = 0.6;
      ctx.stroke();
    });
    ctx.restore();

    return fk;
  };

  /** TCP 마커 */
  RobotCanvas.prototype.drawTool = function (fk, color) {
    var p = this.project(K.matPos(fk.tool));
    var ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = color || '#4ade9a';
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  };

  /** #rrggbb 에 밝기 계수 적용 */
  function shadeColor(hex, k) {
    var n = parseInt(hex.slice(1), 16);
    var r = Math.min(255, Math.round(((n >> 16) & 255) * k));
    var g = Math.min(255, Math.round(((n >> 8) & 255) * k));
    var b = Math.min(255, Math.round((n & 255) * k));
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  global.RobotCanvas = RobotCanvas;
})(typeof window !== 'undefined' ? window : globalThis);
