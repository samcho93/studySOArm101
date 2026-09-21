/*
 * so101-meshes.js — so101_new_calib.urdf 의 실제 메시 번들을 읽습니다.
 * -------------------------------------------------------------------------
 * 번들은 scripts/build_meshes.py 가 만듭니다. 구조는 이렇습니다.
 *
 *   "SO101MSH"  8바이트
 *   version     uint32
 *   hdrLen      uint32
 *   header      JSON (utf-8, 4바이트 배수로 채움)
 *   payload     메시마다  uint16 좌표(vcount*3) + uint16 인덱스(icount*3)
 *
 * 좌표는 0.2mm 격자의 정수입니다. 실제 위치는  min + q * unit  입니다.
 * 법선은 들어 있지 않습니다 — flatShading 으로 그리세요.
 *
 * 의존성 없음. window.SO101Meshes 로 노출됩니다.
 */
(function (global) {
  'use strict';

  var MAGIC = 'SO101MSH';
  var cache = null;      // Promise — 한 번만 받습니다

  function str(buf, off, len) {
    var s = '';
    var v = new Uint8Array(buf, off, len);
    for (var i = 0; i < len; i++) s += String.fromCharCode(v[i]);
    return s;
  }

  function parse(buf) {
    if (buf.byteLength < 16 || str(buf, 0, 8) !== MAGIC) {
      throw new Error('메시 번들이 아닙니다');
    }
    var head = new DataView(buf);
    var version = head.getUint32(8, true);
    if (version !== 1) throw new Error('모르는 번들 판(version ' + version + ')');

    var hdrLen = head.getUint32(12, true);
    var json = new TextDecoder().decode(new Uint8Array(buf, 16, hdrLen));
    var meta = JSON.parse(json);
    var base = 16 + hdrLen;
    var unit = meta.unit;

    meta.meshes.forEach(function (m) {
      var q = new Uint16Array(buf, base + m.pos, m.vcount * 3);
      var pos = new Float32Array(m.vcount * 3);
      for (var i = 0; i < pos.length; i += 3) {
        pos[i]     = m.min[0] + q[i]     * unit;
        pos[i + 1] = m.min[1] + q[i + 1] * unit;
        pos[i + 2] = m.min[2] + q[i + 2] * unit;
      }
      m.position = pos;
      // 뷰가 아니라 복사본을 만듭니다 — three.js 가 버퍼를 오래 붙들고 있어도
      // 원본 ArrayBuffer 전체가 메모리에 남지 않도록.
      m.index = new Uint16Array(
        new Uint16Array(buf, base + m.idx, m.icount * 3));
      delete m.pos;
      delete m.idx;
    });

    meta.triangles = meta.meshes.reduce(function (n, m) { return n + m.icount; }, 0);
    return meta;
  }

  function b64ToBuffer(s) {
    var bin = atob(s);
    var u8 = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8.buffer;
  }

  /**
   * base64 사본을 <script> 로 불러옵니다.
   * Artifact 처럼 .bin 을 서빙하지 않는 곳에서만 쓰입니다.
   */
  function loadB64(url) {
    return new Promise(function (resolve, reject) {
      if (global.SO101MeshData) return resolve(global.SO101MeshData);
      var node = document.createElement('script');
      node.src = url;
      node.onload = function () {
        if (global.SO101MeshData) resolve(global.SO101MeshData);
        else reject(new Error('base64 사본이 비어 있습니다'));
      };
      node.onerror = function () {
        reject(new Error('base64 사본도 받지 못했습니다'));
      };
      document.head.appendChild(node);
    });
  }

  /**
   * 번들을 받아 해석합니다. 두 번 부르면 같은 Promise 를 돌려줍니다.
   * `.bin` 을 못 받으면 같은 이름의 `.b64.js` 를 시도합니다.
   *
   * @param {string} url  .bin 주소
   * @returns {Promise<Object>} {unit, meshes:[{name,min,vcount,icount,position,index}],
   *                             links:{링크이름:[{mesh,xyz,rpy,mat}]}, triangles}
   */
  function load(url) {
    if (cache) return cache;
    cache = fetch(url).then(function (r) {
      if (!r.ok) throw new Error(r.status + ' ' + r.statusText);
      return r.arrayBuffer();
    }).catch(function (err) {
      console.info('메시 .bin 을 받지 못해 base64 사본을 시도합니다 —', err.message);
      return loadB64(url.replace(/[.]bin$/, '.b64.js')).then(b64ToBuffer);
    }).then(parse).catch(function (err) {
      cache = null;                 // 실패는 기억하지 않습니다 — 다시 시도 가능
      throw err;
    });
    return cache;
  }

  global.SO101Meshes = { load: load, parse: parse };
})(typeof window !== 'undefined' ? window : globalThis);
