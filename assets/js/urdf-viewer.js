/*
 * urdf-viewer.js — 브라우저에서 도는 URDF 뷰어
 * -------------------------------------------------------------------------
 * 설치 없이 URDF 를 읽어 3D 로 그립니다. rerun 의 URDF visualizer 와 같은 일을
 * 하되, 여기서는 **조인트를 직접 움직여 볼 수 있습니다.**
 *
 * URDF 를 가져오는 방법은 세 가지입니다.
 *   1. 내장 모델    — so101-kinematics.js 의 값으로 URDF 를 즉석에서 만듭니다
 *   2. 폴더 열기    — Simulation/SO101 폴더를 고르면 STL 까지 함께 읽습니다
 *   3. 주소 불러오기 — GitHub raw 같은 URL 에서 받아옵니다 (CORS 허용 시)
 *
 * 세 경로 모두 같은 파서·같은 렌더러를 지납니다.
 */
(function () {
  'use strict';

  var K = window.SO101;
  var THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.js';
  var RAW = 'https://raw.githubusercontent.com/TheRobotStudio/SO-ARM100/main/Simulation/';

  var THREE = null;
  var el = function (id) { return document.getElementById(id); };

  var state = {
    model: null,          // 파싱 결과
    q: {},                // 조인트 이름 → 값 (rad 또는 m)
    files: null,          // Map<소문자 파일명, File>
    baseUrl: '',          // 메시 상대 경로의 기준
    sourceLabel: '내장 모델',
    showVisual: true,
    showCollision: false,
    showFrames: false,
    grid: true,
    spin: false,
    selected: null
  };

  var view = null;        // 렌더러 묶음

  // =====================================================================
  //  URDF 파서
  // =====================================================================

  function nums(str, n, dflt) {
    if (!str) return dflt.slice();
    var v = String(str).trim().split(/\s+/).map(Number);
    if (v.length !== n || v.some(isNaN)) return dflt.slice();
    return v;
  }

  /** 자식 중 바로 아래 단계에서만 태그를 찾습니다 (손자까지 섞이지 않게). */
  function kids(node, tag) {
    var out = [];
    for (var i = 0; i < node.children.length; i++) {
      if (node.children[i].tagName === tag) out.push(node.children[i]);
    }
    return out;
  }

  function originOf(node) {
    var o = kids(node, 'origin')[0];
    return {
      xyz: nums(o && o.getAttribute('xyz'), 3, [0, 0, 0]),
      rpy: nums(o && o.getAttribute('rpy'), 3, [0, 0, 0])
    };
  }

  /** <geometry> 한 개를 읽습니다. 모르는 형상이면 null. */
  function geomOf(node) {
    var g = kids(node, 'geometry')[0];
    if (!g) return null;
    var m = kids(g, 'mesh')[0];
    if (m) {
      return {
        kind: 'mesh',
        file: m.getAttribute('filename') || '',
        scale: nums(m.getAttribute('scale'), 3, [1, 1, 1])
      };
    }
    var b = kids(g, 'box')[0];
    if (b) return { kind: 'box', size: nums(b.getAttribute('size'), 3, [0.05, 0.05, 0.05]) };
    var c = kids(g, 'cylinder')[0];
    if (c) {
      return {
        kind: 'cylinder',
        radius: parseFloat(c.getAttribute('radius')) || 0.02,
        length: parseFloat(c.getAttribute('length')) || 0.05
      };
    }
    var s = kids(g, 'sphere')[0];
    if (s) return { kind: 'sphere', radius: parseFloat(s.getAttribute('radius')) || 0.02 };
    return null;
  }

  function colorOf(node, globalMats) {
    var mat = kids(node, 'material')[0];
    if (!mat) return null;
    var c = kids(mat, 'color')[0];
    if (c) return nums(c.getAttribute('rgba'), 4, [0.8, 0.8, 0.8, 1]);
    var ref = mat.getAttribute('name');
    return (ref && globalMats[ref]) || null;
  }

  function parseUrdf(text) {
    var doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) {
      throw new Error('XML 형식이 아닙니다. URDF 파일이 맞는지 확인하세요.');
    }
    var robot = doc.getElementsByTagName('robot')[0];
    if (!robot) throw new Error('<robot> 요소가 없습니다. URDF 파일이 맞는지 확인하세요.');

    // 로봇 단위에 정의된, 이름으로 참조되는 재질
    var globalMats = {};
    kids(robot, 'material').forEach(function (n) {
      var c = kids(n, 'color')[0];
      if (c && n.getAttribute('name')) {
        globalMats[n.getAttribute('name')] = nums(c.getAttribute('rgba'), 4, [0.8, 0.8, 0.8, 1]);
      }
    });

    var links = {};
    var order = [];
    kids(robot, 'link').forEach(function (n) {
      var name = n.getAttribute('name');
      if (!name) return;
      var rec = { name: name, visual: [], collision: [], mass: null };
      var inert = kids(n, 'inertial')[0];
      if (inert) {
        var m = kids(inert, 'mass')[0];
        if (m) rec.mass = parseFloat(m.getAttribute('value'));
      }
      ['visual', 'collision'].forEach(function (kind) {
        kids(n, kind).forEach(function (v) {
          var g = geomOf(v);
          if (!g) return;
          rec[kind].push({
            origin: originOf(v),
            geom: g,
            color: kind === 'visual' ? colorOf(v, globalMats) : null
          });
        });
      });
      links[name] = rec;
      order.push(name);
    });

    var joints = [];
    kids(robot, 'joint').forEach(function (n) {
      var parent = kids(n, 'parent')[0];
      var child = kids(n, 'child')[0];
      if (!parent || !child) return;
      var lim = kids(n, 'limit')[0];
      var mim = kids(n, 'mimic')[0];
      var o = originOf(n);
      var type = n.getAttribute('type') || 'fixed';
      var cont = type === 'continuous';
      var ax = kids(n, 'axis')[0];
      joints.push({
        name: n.getAttribute('name') || ('joint_' + joints.length),
        type: type,
        parent: parent.getAttribute('link'),
        child: child.getAttribute('link'),
        xyz: o.xyz,
        rpy: o.rpy,
        axis: nums(ax && ax.getAttribute('xyz'), 3, [1, 0, 0]),
        lower: lim && lim.getAttribute('lower') != null
          ? parseFloat(lim.getAttribute('lower')) : (cont ? -Math.PI : 0),
        upper: lim && lim.getAttribute('upper') != null
          ? parseFloat(lim.getAttribute('upper')) : (cont ? Math.PI : 0),
        mimic: mim ? {
          joint: mim.getAttribute('joint'),
          multiplier: parseFloat(mim.getAttribute('multiplier') || '1'),
          offset: parseFloat(mim.getAttribute('offset') || '0')
        } : null
      });
    });

    // 어떤 조인트의 자식도 아닌 링크가 루트
    var childSet = {};
    joints.forEach(function (j) { childSet[j.child] = true; });
    var roots = order.filter(function (n) { return !childSet[n]; });
    if (!roots.length) throw new Error('루트 링크를 찾지 못했습니다 (순환 구조?).');

    return {
      name: robot.getAttribute('name') || '(이름 없음)',
      links: links,
      linkOrder: order,
      joints: joints,
      root: roots[0],
      extraRoots: roots.slice(1)
    };
  }

  // =====================================================================
  //  STL 파서 — 바이너리와 ASCII 를 모두 받습니다
  // =====================================================================

  function parseStl(buf) {
    var dv = new DataView(buf);
    // 헤더 80 + 개수 4 + 삼각형당 50 바이트가 정확히 맞으면 바이너리
    if (buf.byteLength >= 84) {
      var tri = dv.getUint32(80, true);
      if (84 + tri * 50 === buf.byteLength) return parseStlBinary(dv, tri);
    }
    return parseStlAscii(new TextDecoder().decode(buf));
  }

  function parseStlBinary(dv, tri) {
    var pos = new Float32Array(tri * 9);
    var nor = new Float32Array(tri * 9);
    var off = 84;
    for (var i = 0; i < tri; i++) {
      var nx = dv.getFloat32(off, true);
      var ny = dv.getFloat32(off + 4, true);
      var nz = dv.getFloat32(off + 8, true);
      for (var v = 0; v < 3; v++) {
        var o = off + 12 + v * 12;
        var k = i * 9 + v * 3;
        pos[k] = dv.getFloat32(o, true);
        pos[k + 1] = dv.getFloat32(o + 4, true);
        pos[k + 2] = dv.getFloat32(o + 8, true);
        nor[k] = nx; nor[k + 1] = ny; nor[k + 2] = nz;
      }
      off += 50;
    }
    return { position: pos, normal: nor };
  }

  function parseStlAscii(text) {
    var pos = [], nor = [], n = [0, 0, 1];
    var re = /facet\s+normal\s+([^\n]*)|vertex\s+([^\n]*)/g, m;
    while ((m = re.exec(text))) {
      if (m[1] != null) {
        n = nums(m[1], 3, [0, 0, 1]);
      } else {
        var v = nums(m[2], 3, [0, 0, 0]);
        pos.push(v[0], v[1], v[2]);
        nor.push(n[0], n[1], n[2]);
      }
    }
    if (!pos.length) throw new Error('STL 에서 삼각형을 찾지 못했습니다.');
    return { position: new Float32Array(pos), normal: new Float32Array(nor) };
  }

  // =====================================================================
  //  메시 가져오기 — 고른 파일에서, 없으면 URL 에서
  // =====================================================================

  var meshCache = {};

  function baseName(p) {
    return String(p).replace(/^package:\/\/[^/]+\//, '').split(/[\\/]/).pop().toLowerCase();
  }

  function fetchMesh(file) {
    if (meshCache[file]) return meshCache[file];
    var p;
    if (state.files && state.files.has(baseName(file))) {
      p = state.files.get(baseName(file)).arrayBuffer();
    } else if (state.baseUrl) {
      var rel = String(file).replace(/^package:\/\/[^/]+\//, '');
      p = fetch(new URL(rel, state.baseUrl).href).then(function (r) {
        if (!r.ok) throw new Error(r.status + ' ' + r.statusText);
        return r.arrayBuffer();
      });
    } else {
      p = Promise.reject(new Error('메시 파일이 없습니다'));
    }
    meshCache[file] = p.then(parseStl);
    return meshCache[file];
  }

  // =====================================================================
  //  내장 모델 — 강좌의 기구학 값으로 URDF 를 즉석에서 만듭니다
  // =====================================================================

  function builtinUrdf() {
    var out = [
      '<?xml version="1.0"?>',
      '<robot name="so101_new_calib (강좌 내장 근사 형상)">',
      '  <material name="3d_printed"><color rgba="1.0 0.82 0.12 1.0"/></material>',
      '  <material name="sts3215"><color rgba="0.17 0.20 0.25 1.0"/></material>'
    ];

    function link(name) {
      out.push('  <link name="' + name + '">');
      (K.LINK_SHAPES[name] || []).forEach(function (s) {
        out.push('    <visual>',
          '      <origin xyz="' + s.pos.join(' ') + '" rpy="0 0 0"/>',
          '      <geometry><box size="' + s.size.join(' ') + '"/></geometry>',
          '      <material name="' + (s.mat === 'servo' ? 'sts3215' : '3d_printed') + '"/>',
          '    </visual>');
      });
      out.push('  </link>');
    }

    K.LINK_ORDER.forEach(link);
    link('gripper_frame_link');

    K.JOINTS.forEach(function (j) {
      out.push('  <joint name="' + j.name + '" type="revolute">',
        '    <parent link="' + j.parent + '"/>',
        '    <child link="' + j.child + '"/>',
        '    <origin xyz="' + j.xyz.join(' ') + '" rpy="' + j.rpy.join(' ') + '"/>',
        '    <axis xyz="0 0 1"/>',
        '    <limit lower="' + j.lower + '" upper="' + j.upper +
        '" effort="10" velocity="3.14"/>',
        '  </joint>');
    });
    out.push('  <joint name="' + K.TOOL.name + '" type="fixed">',
      '    <parent link="' + K.TOOL.parent + '"/>',
      '    <child link="' + K.TOOL.child + '"/>',
      '    <origin xyz="' + K.TOOL.xyz.join(' ') + '" rpy="' + K.TOOL.rpy.join(' ') + '"/>',
      '  </joint>',
      '</robot>');
    return out.join('\n');
  }

  // =====================================================================
  //  3D 장면
  // =====================================================================

  function themeInfo() {
    var css = getComputedStyle(document.documentElement);
    var light = !!(window.SOTheme && window.SOTheme.resolved() === 'light');
    return { grid: (css.getPropertyValue('--border') || '#334').trim(), light: light };
  }

  function createView(container) {
    var scene = new THREE.Scene();
    THREE.Object3D.DEFAULT_UP = new THREE.Vector3(0, 0, 1);

    var camera = new THREE.PerspectiveCamera(42, 1, 0.01, 60);
    camera.up.set(0, 0, 1);

    var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    container.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    var key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(0.6, -0.9, 1.2);
    scene.add(key);
    var fill = new THREE.DirectionalLight(0xffffff, 0.45);
    fill.position.set(-0.8, 0.6, 0.3);
    scene.add(fill);

    var grid = new THREE.GridHelper(1.2, 24);
    grid.rotation.x = Math.PI / 2;
    scene.add(grid);

    var axes = new THREE.AxesHelper(0.1);
    scene.add(axes);

    var robotRoot = new THREE.Group();
    scene.add(robotRoot);

    var frameGroup = new THREE.Group();
    scene.add(frameGroup);

    var orbit = {
      yaw: -0.85, pitch: 0.42, dist: 0.85,
      target: new THREE.Vector3(0.05, 0, 0.12)
    };

    function place() {
      var cp = Math.cos(orbit.pitch), sp = Math.sin(orbit.pitch);
      camera.position.set(
        orbit.target.x + orbit.dist * cp * Math.cos(orbit.yaw),
        orbit.target.y + orbit.dist * cp * Math.sin(orbit.yaw),
        orbit.target.z + orbit.dist * sp);
      camera.lookAt(orbit.target);
    }

    var dom = renderer.domElement;
    var drag = null;
    dom.style.cursor = 'grab';
    dom.addEventListener('pointerdown', function (e) {
      try { dom.setPointerCapture(e.pointerId); } catch (err) { /* 합성 이벤트 */ }
      drag = { x: e.clientX, y: e.clientY, pan: e.shiftKey || e.button === 1 };
      dom.style.cursor = 'grabbing';
    });
    dom.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.x = e.clientX; drag.y = e.clientY;
      if (drag.pan) {
        var right = new THREE.Vector3(-Math.sin(orbit.yaw), Math.cos(orbit.yaw), 0);
        orbit.target.addScaledVector(right, -dx * orbit.dist * 0.0018);
        orbit.target.z += dy * orbit.dist * 0.0018;
      } else {
        orbit.yaw -= dx * 0.008;
        orbit.pitch = Math.max(-1.45, Math.min(1.45, orbit.pitch + dy * 0.008));
      }
      place();
      renderOnce();
    });
    ['pointerup', 'pointercancel'].forEach(function (evt) {
      dom.addEventListener(evt, function () { drag = null; dom.style.cursor = 'grab'; });
    });
    dom.addEventListener('wheel', function (e) {
      e.preventDefault();
      orbit.dist = Math.max(0.08, Math.min(8, orbit.dist * (1 + Math.sign(e.deltaY) * 0.12)));
      place();
      renderOnce();
    }, { passive: false });

    function resize() {
      var w = container.clientWidth || 1, h = container.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }

    function applyTheme() {
      var t = themeInfo();
      grid.material.color.set(t.grid);
      grid.material.transparent = true;
      grid.material.opacity = t.light ? 0.75 : 0.5;
    }

    place(); resize(); applyTheme();

    return {
      scene: scene, camera: camera, renderer: renderer, robotRoot: robotRoot,
      frameGroup: frameGroup, grid: grid, axes: axes, orbit: orbit,
      resize: resize, place: place, applyTheme: applyTheme,
      render: function () { renderer.render(scene, camera); }
    };
  }

  // =====================================================================
  //  모델 → 장면
  // =====================================================================

  var linkGroups = {};
  var linkMeshes = {};
  var pending = 0, failed = [];

  function mat4(rpy, xyz) {
    return new THREE.Matrix4().fromArray(K.matFromRpyXyz(rpy, xyz));
  }

  function makeMaterial(rgba, isCollision) {
    if (isCollision) {
      return new THREE.MeshBasicMaterial({
        color: 0xff6b70, wireframe: true, transparent: true, opacity: 0.6
      });
    }
    var c = rgba || [0.75, 0.76, 0.8, 1];
    return new THREE.MeshStandardMaterial({
      color: new THREE.Color(c[0], c[1], c[2]),
      roughness: 0.55, metalness: 0.08,
      transparent: c[3] < 1, opacity: c[3]
    });
  }

  function primitiveGeometry(g) {
    if (g.kind === 'box') return new THREE.BoxGeometry(g.size[0], g.size[1], g.size[2]);
    if (g.kind === 'sphere') return new THREE.SphereGeometry(g.radius, 24, 16);
    if (g.kind === 'cylinder') {
      var geo = new THREE.CylinderGeometry(g.radius, g.radius, g.length, 28);
      geo.rotateX(Math.PI / 2);          // URDF 원통은 +Z 가 축
      return geo;
    }
    return null;
  }

  function addShape(linkName, shape, isCollision) {
    var group = linkGroups[linkName];
    if (!group) return;
    var local = mat4(shape.origin.rpy, shape.origin.xyz);

    function attach(geo) {
      var mesh = new THREE.Mesh(geo, makeMaterial(shape.color, isCollision));
      mesh.matrixAutoUpdate = false;
      mesh.matrix.copy(local);
      mesh.userData.kind = isCollision ? 'collision' : 'visual';
      mesh.userData.link = linkName;
      mesh.visible = isCollision ? state.showCollision : state.showVisual;
      group.add(mesh);
      (linkMeshes[linkName] = linkMeshes[linkName] || []).push(mesh);
    }

    if (shape.geom.kind !== 'mesh') {
      var geo = primitiveGeometry(shape.geom);
      if (geo) attach(geo);
      return;
    }

    pending++;
    fetchMesh(shape.geom.file).then(function (data) {
      var g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(data.position, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(data.normal, 3));
      var s = shape.geom.scale;
      if (s[0] !== 1 || s[1] !== 1 || s[2] !== 1) g.scale(s[0], s[1], s[2]);
      attach(g);
    }).catch(function (err) {
      if (failed.indexOf(shape.geom.file) < 0) failed.push(shape.geom.file);
      console.warn('메시를 읽지 못했습니다:', shape.geom.file, err);
    }).then(function () {
      if (--pending === 0) onMeshesDone();
    });
  }

  function buildModel(model) {
    var root = view.robotRoot;
    while (root.children.length) root.remove(root.children[0]);
    linkGroups = {}; linkMeshes = {}; failed = []; pending = 0; meshCache = {};

    model.linkOrder.forEach(function (name) {
      var g = new THREE.Group();
      g.matrixAutoUpdate = false;
      linkGroups[name] = g;
    });
    model.joints.forEach(function (j) {
      if (linkGroups[j.parent] && linkGroups[j.child]) {
        linkGroups[j.parent].add(linkGroups[j.child]);
      }
    });
    root.add(linkGroups[model.root]);
    model.extraRoots.forEach(function (n) { if (linkGroups[n]) root.add(linkGroups[n]); });

    model.linkOrder.forEach(function (name) {
      var link = model.links[name];
      link.visual.forEach(function (s) { addShape(name, s, false); });
      link.collision.forEach(function (s) { addShape(name, s, true); });
    });

    applyJoints();
    if (pending === 0) onMeshesDone();
  }

  function shapeCount() {
    var n = 0;
    Object.keys(linkMeshes).forEach(function (k) { n += linkMeshes[k].length; });
    return n;
  }

  function onMeshesDone() {
    var warn = el('meshWarn');
    if (failed.length) {
      warn.hidden = false;
      el('meshWarnList').textContent = failed.slice(0, 5).join(', ') +
        (failed.length > 5 ? ' 외 ' + (failed.length - 5) + '개' : '');
    } else {
      warn.hidden = true;
    }
    // 그릴 형상이 하나도 없으면 링크 좌표계라도 켭니다 — 빈 화면보다 낫습니다
    if (shapeCount() === 0) {
      state.showFrames = true;
      el('optFrames').checked = true;
      updateFrames();
    }
    frameView();
    renderOnce();
  }

  function jointValue(j) {
    if (j.type === 'fixed') return 0;
    if (j.mimic) {
      var src = state.q[j.mimic.joint] || 0;
      return src * j.mimic.multiplier + j.mimic.offset;
    }
    return state.q[j.name] || 0;
  }

  function applyJoints() {
    if (!state.model) return;
    state.model.joints.forEach(function (j) {
      var g = linkGroups[j.child];
      if (!g) return;
      var m = mat4(j.rpy, j.xyz);
      var v = jointValue(j);
      if (j.type === 'revolute' || j.type === 'continuous') {
        var ax = new THREE.Vector3(j.axis[0], j.axis[1], j.axis[2]);
        if (ax.lengthSq() < 1e-12) ax.set(0, 0, 1);
        m.multiply(new THREE.Matrix4().makeRotationAxis(ax.normalize(), v));
      } else if (j.type === 'prismatic') {
        var t = new THREE.Vector3(j.axis[0], j.axis[1], j.axis[2]).normalize()
          .multiplyScalar(v);
        m.multiply(new THREE.Matrix4().makeTranslation(t.x, t.y, t.z));
      }
      g.matrix.copy(m);
    });
    view.robotRoot.updateMatrixWorld(true);
    updateFrames();
    updateReadout();
  }

  /** 링크마다 작은 좌표축을 그립니다. */
  function updateFrames() {
    var g = view.frameGroup;
    while (g.children.length) g.remove(g.children[0]);
    if (!state.showFrames || !state.model) return;
    state.model.linkOrder.forEach(function (name) {
      var lg = linkGroups[name];
      if (!lg) return;
      var ax = new THREE.AxesHelper(0.03);
      ax.matrixAutoUpdate = false;
      ax.matrix.copy(lg.matrixWorld);
      g.add(ax);
    });
  }

  // =====================================================================
  //  패널
  // =====================================================================

  function deg(r) { return r * 180 / Math.PI; }

  /** 베이스에서 말단으로 가는 순서. URDF 는 역순으로 적혀 있기도 합니다. */
  function orderedJoints() {
    var m = state.model;
    if (!m) return [];
    var seen = {}, out = [];
    (function walk(link) {
      m.joints.forEach(function (j) {
        if (j.parent !== link || seen[j.name]) return;
        seen[j.name] = true;
        out.push(j);
        walk(j.child);
      });
    })(m.root);
    m.joints.forEach(function (j) { if (!seen[j.name]) out.push(j); });
    return out;
  }

  function movableJoints() {
    return orderedJoints().filter(function (j) {
      return j.type !== 'fixed' && !j.mimic;
    });
  }

  function fmtVal(v, prismatic) {
    v = parseFloat(v);
    return prismatic ? (v * 1000).toFixed(1) + ' mm' : deg(v).toFixed(1) + '°';
  }

  function buildSliders() {
    var box = el('sliders');
    box.innerHTML = '';
    var list = movableJoints();
    if (!list.length) {
      box.innerHTML = '<p class="hint">움직일 수 있는 조인트가 없습니다.</p>';
      return;
    }
    list.forEach(function (j) {
      var prismatic = j.type === 'prismatic';
      var lo = j.lower, hi = j.upper;
      if (!(hi > lo)) { lo = -Math.PI; hi = Math.PI; }
      var row = document.createElement('div');
      row.className = 'joint-row';
      row.innerHTML =
        '<div class="jr-head"><span class="jr-name"></span>' +
        '<span class="jr-val" data-val></span></div>' +
        '<input type="range" min="' + lo + '" max="' + hi + '" step="0.001">' +
        '<div class="jr-limits"><span>' + fmtVal(lo, prismatic) + '</span>' +
        '<span></span><span>' + fmtVal(hi, prismatic) + '</span></div>';
      row.querySelector('.jr-name').textContent = j.name;
      row.querySelectorAll('.jr-limits span')[1].textContent = j.type;
      var input = row.querySelector('input');
      var out = row.querySelector('[data-val]');
      input.value = state.q[j.name] || 0;
      out.textContent = fmtVal(input.value, prismatic);
      input.addEventListener('input', function () {
        state.q[j.name] = parseFloat(input.value);
        out.textContent = fmtVal(input.value, prismatic);
        applyJoints();
        renderOnce();
      });
      row.addEventListener('mouseenter', function () { highlight(j.child); });
      row.addEventListener('mouseleave', function () { highlight(null); });
      box.appendChild(row);
    });
  }

  function highlight(link) {
    state.selected = link;
    Object.keys(linkMeshes).forEach(function (name) {
      linkMeshes[name].forEach(function (m) {
        if (m.userData.kind !== 'visual' || !m.material.emissive) return;
        m.material.emissive.setHex(name === link ? 0x2c5f42 : 0x000000);
      });
    });
    renderOnce();
  }

  function buildTables() {
    var m = state.model;
    el('robotName').textContent = m.name;
    el('robotSource').textContent = state.sourceLabel;
    el('robotLinks').textContent = String(m.linkOrder.length);
    el('robotJoints').textContent = m.joints.length + ' (가동 ' + movableJoints().length + ')';

    var meshCount = 0, primCount = 0, colCount = 0;
    m.linkOrder.forEach(function (n) {
      m.links[n].visual.forEach(function (s) {
        if (s.geom.kind === 'mesh') meshCount++; else primCount++;
      });
      colCount += m.links[n].collision.length;
    });
    el('robotGeom').textContent = meshCount + ' 메시 / ' + primCount + ' 기본도형';
    el('robotCollision').textContent = colCount + ' 개';

    var tb = el('jointTable');
    tb.innerHTML = '<thead><tr><th>조인트</th><th>종류</th><th>부모 → 자식</th>' +
      '<th>origin xyz (m)</th><th>axis</th><th>한계</th></tr></thead><tbody></tbody>';
    var tbody = tb.querySelector('tbody');
    orderedJoints().forEach(function (j) {
      var tr = document.createElement('tr');
      [j.name, j.type, j.parent + ' → ' + j.child,
        j.xyz.map(function (v) { return v.toFixed(4); }).join(', '),
        j.axis.join(' '),
        j.type === 'fixed' ? '—'
          : deg(j.lower).toFixed(1) + '° … ' + deg(j.upper).toFixed(1) + '°'
      ].forEach(function (text) {
        var td = document.createElement('td');
        td.textContent = text;
        tr.appendChild(td);
      });
      tr.addEventListener('mouseenter', function () { highlight(j.child); });
      tr.addEventListener('mouseleave', function () { highlight(null); });
      tbody.appendChild(tr);
    });

    var tree = el('linkTree');
    tree.innerHTML = '';
    (function walk(name, depth) {
      var link = m.links[name];
      var li = document.createElement('li');
      li.style.marginLeft = (depth * 14) + 'px';
      li.dataset.link = name;
      var b = document.createElement('b');
      b.textContent = name;
      var s = document.createElement('span');
      s.textContent = (link ? link.visual.length : 0) + ' visual · ' +
        (link ? link.collision.length : 0) + ' collision' +
        (link && link.mass ? ' · ' + (link.mass * 1000).toFixed(0) + ' g' : '');
      li.appendChild(b);
      li.appendChild(s);
      li.addEventListener('mouseenter', function () { highlight(name); });
      li.addEventListener('mouseleave', function () { highlight(null); });
      tree.appendChild(li);
      m.joints.filter(function (j) { return j.parent === name; })
        .forEach(function (j) { walk(j.child, depth + 1); });
    })(m.root, 0);
  }

  function updateReadout() {
    var m = state.model;
    if (!m) return;
    var tip = linkGroups[m.tipLink];
    if (!tip) return;
    var p = new THREE.Vector3().setFromMatrixPosition(tip.matrixWorld);
    el('tipName').textContent = m.tipLink;
    el('tipPos').textContent =
      'x ' + p.x.toFixed(4) + '  y ' + p.y.toFixed(4) + '  z ' + p.z.toFixed(4) + ' m';
  }

  /** TCP 프레임이 있으면 그쪽을, 없으면 트리에서 가장 깊은 링크를 씁니다. */
  function pickTip(m) {
    if (m.links['gripper_frame_link']) return 'gripper_frame_link';
    var depth = {}, best = m.root;
    depth[m.root] = 0;
    var changed = true;
    while (changed) {
      changed = false;
      m.joints.forEach(function (j) {
        if (depth[j.parent] != null && depth[j.child] == null) {
          depth[j.child] = depth[j.parent] + 1;
          changed = true;
        }
      });
    }
    Object.keys(depth).forEach(function (n) { if (depth[n] > depth[best]) best = n; });
    return best;
  }

  /** 로봇이 화면에 꽉 차도록 카메라를 맞춥니다. */
  function frameView() {
    var box = new THREE.Box3().setFromObject(view.robotRoot);
    if (box.isEmpty()) {
      // 형상이 없으면 링크 원점들로 범위를 잡습니다
      var p = new THREE.Vector3();
      Object.keys(linkGroups).forEach(function (n) {
        box.expandByPoint(p.setFromMatrixPosition(linkGroups[n].matrixWorld));
      });
      if (box.isEmpty()) return;
      box.expandByScalar(0.05);
    }
    var size = box.getSize(new THREE.Vector3());
    var center = box.getCenter(new THREE.Vector3());
    var r = Math.max(size.x, size.y, size.z) * 0.5 || 0.2;
    view.orbit.target.copy(center);
    view.orbit.dist = r / Math.tan(view.camera.fov * Math.PI / 360) * 1.9;
    view.grid.scale.setScalar(Math.max(1, r / 0.25));
    view.place();
  }

  // =====================================================================
  //  모델 적재
  // =====================================================================

  function status(msg, kind) {
    var n = el('viewerStatus');
    n.textContent = msg;
    n.className = 'vstat' + (kind ? ' ' + kind : '');
  }

  function loadUrdfText(text, label, baseUrl, files) {
    var model;
    try {
      model = parseUrdf(text);
    } catch (e) {
      status(e.message, 'bad');
      return;
    }
    state.model = model;
    state.sourceLabel = label;
    state.baseUrl = baseUrl || '';
    state.files = files || null;
    state.q = {};
    model.tipLink = pickTip(model);
    model.joints.forEach(function (j) {
      if (j.type !== 'fixed') state.q[j.name] = 0;
    });

    el('meshWarn').hidden = true;
    buildModel(model);
    buildSliders();
    buildTables();
    applyJoints();
    renderOnce();
    status(model.name + ' — 링크 ' + model.linkOrder.length +
      '개, 조인트 ' + model.joints.length + '개', 'ok');
  }

  function loadFromFiles(fileList) {
    var files = new Map();
    var urdfs = [];
    Array.prototype.forEach.call(fileList, function (f) {
      files.set(f.name.toLowerCase(), f);
      if (/\.urdf$/i.test(f.name)) urdfs.push(f);
    });
    if (!urdfs.length) {
      status('고른 항목에 .urdf 파일이 없습니다. Simulation/SO101 폴더를 통째로 고르세요.', 'bad');
      return;
    }
    urdfs.sort(function (a, b) {
      var an = /new_calib/i.test(a.name) ? 0 : 1;
      var bn = /new_calib/i.test(b.name) ? 0 : 1;
      return an - bn || a.name.localeCompare(b.name);
    });

    var pickBox = el('urdfPick');
    pickBox.innerHTML = '';
    if (urdfs.length > 1) {
      pickBox.hidden = false;
      urdfs.forEach(function (f, i) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 's-btn' + (i === 0 ? ' primary' : '');
        b.textContent = f.name;
        b.addEventListener('click', function () {
          Array.prototype.forEach.call(pickBox.children, function (c) {
            c.classList.remove('primary');
          });
          b.classList.add('primary');
          readUrdfFile(f, files);
        });
        pickBox.appendChild(b);
      });
    } else {
      pickBox.hidden = true;
    }
    readUrdfFile(urdfs[0], files);
  }

  function readUrdfFile(file, files) {
    status(file.name + ' 읽는 중…');
    file.text().then(function (t) {
      loadUrdfText(t, '내 컴퓨터 · ' + file.name, '', files);
    }).catch(function (e) {
      status('파일을 읽지 못했습니다: ' + e.message, 'bad');
    });
  }

  function loadFromUrl(url) {
    status(url.replace(/^https?:\/\//, '') + ' 받는 중…');
    fetch(url).then(function (r) {
      if (!r.ok) throw new Error(r.status + ' ' + r.statusText);
      return r.text();
    }).then(function (t) {
      loadUrdfText(t, url.replace(/^https?:\/\//, ''), url, null);
    }).catch(function (e) {
      status('받지 못했습니다 (' + e.message + '). 이 페이지가 외부 요청이 막힌 곳이라면 ' +
        '아래 "폴더 열기" 를 쓰세요.', 'bad');
    });
  }

  // =====================================================================
  //  렌더 루프 — 바뀐 프레임만 그립니다
  // =====================================================================

  var dirty = true;
  function renderOnce() { dirty = true; }

  function loop() {
    if (state.spin) {
      view.orbit.yaw += 0.004;
      view.place();
      dirty = true;
    }
    if (dirty) { view.render(); dirty = false; }
    requestAnimationFrame(loop);
  }

  // =====================================================================
  //  시작
  // =====================================================================

  function setMeshVisibility() {
    Object.keys(linkMeshes).forEach(function (name) {
      linkMeshes[name].forEach(function (m) {
        m.visible = m.userData.kind === 'collision' ? state.showCollision : state.showVisual;
      });
    });
  }

  function bindUi() {
    el('btnBuiltin').addEventListener('click', function () {
      el('urdfPick').hidden = true;
      loadUrdfText(builtinUrdf(), '내장 모델 (근사 상자 형상)', '', null);
    });

    ['fileInput', 'dirInput'].forEach(function (id) {
      el(id).addEventListener('change', function (e) {
        if (e.target.files.length) loadFromFiles(e.target.files);
      });
    });

    el('btnUrl').addEventListener('click', function () {
      var u = el('urlInput').value.trim();
      if (u) loadFromUrl(u);
    });
    el('urlInput').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') el('btnUrl').click();
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-url]'), function (b) {
      b.addEventListener('click', function () {
        el('urlInput').value = RAW + b.dataset.url;
        loadFromUrl(el('urlInput').value);
      });
    });

    // 3D 화면에 파일을 끌어다 놓아도 됩니다
    var stage = el('viewport');
    ['dragenter', 'dragover'].forEach(function (evt) {
      stage.addEventListener(evt, function (e) {
        e.preventDefault();
        stage.classList.add('drop');
      });
    });
    ['dragleave', 'drop'].forEach(function (evt) {
      stage.addEventListener(evt, function (e) {
        e.preventDefault();
        stage.classList.remove('drop');
      });
    });
    stage.addEventListener('drop', function (e) {
      if (e.dataTransfer && e.dataTransfer.files.length) loadFromFiles(e.dataTransfer.files);
    });

    function chk(id, key, after) {
      el(id).addEventListener('change', function () {
        state[key] = el(id).checked;
        if (after) after();
        renderOnce();
      });
    }
    chk('optVisual', 'showVisual', setMeshVisibility);
    chk('optCollision', 'showCollision', setMeshVisibility);
    chk('optFrames', 'showFrames', updateFrames);
    chk('optGrid', 'grid', function () {
      view.grid.visible = state.grid;
      view.axes.visible = state.grid;
    });
    chk('optSpin', 'spin');

    el('btnZero').addEventListener('click', function () {
      Object.keys(state.q).forEach(function (k) { state.q[k] = 0; });
      buildSliders(); applyJoints(); renderOnce();
    });
    el('btnRandom').addEventListener('click', function () {
      movableJoints().forEach(function (j) {
        var lo = j.lower, hi = j.upper;
        if (!(hi > lo)) { lo = -1; hi = 1; }
        state.q[j.name] = lo + Math.random() * (hi - lo);
      });
      buildSliders(); applyJoints(); renderOnce();
    });
    el('btnFit').addEventListener('click', function () { frameView(); renderOnce(); });

    Array.prototype.forEach.call(document.querySelectorAll('.tabs button'), function (b) {
      b.addEventListener('click', function () {
        Array.prototype.forEach.call(document.querySelectorAll('.tabs button'), function (x) {
          x.classList.toggle('active', x === b);
        });
        Array.prototype.forEach.call(document.querySelectorAll('.tab-body'), function (x) {
          x.classList.toggle('active', x.id === 'tab-' + b.dataset.tab);
        });
      });
    });

    document.addEventListener('themechange', function () {
      view.applyTheme();
      renderOnce();
    });
    window.addEventListener('resize', function () {
      view.resize();
      renderOnce();
    });
  }

  async function start() {
    try {
      THREE = await import(THREE_URL);
    } catch (err) {
      console.error('three.js 로드 실패', err);
      el('noThree').hidden = false;
      status('3D 엔진(three.js)을 불러오지 못했습니다.', 'bad');
      return;
    }
    view = createView(el('viewport'));
    bindUi();
    loadUrdfText(builtinUrdf(), '내장 모델 (근사 상자 형상)', '', null);
    requestAnimationFrame(loop);
    window.__urdfViewer = { state: state, parseUrdf: parseUrdf, view: view };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
