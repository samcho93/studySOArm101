/*
 * feetech-webserial.js
 * -------------------------------------------------------------------------
 * 브라우저에서 Web Serial API 로 Feetech STS3215 버스 서보의 현재 위치를 읽습니다.
 * SO-ARM101 리더 암을 시뮬레이터에 그대로 연결하기 위한 최소 구현입니다.
 *
 * 읽기 전용입니다 — 토크를 켜거나 위치를 쓰는 명령은 보내지 않습니다.
 * 리더 암은 사람이 손으로 움직이는 입력 장치이므로 이것으로 충분합니다.
 *
 * 프로토콜: Feetech SMS/STS (scservo_sdk 의 PacketHandler(0) 와 동일)
 *   명령 패킷  FF FF  ID  LEN  INST  PARAM…  CHK
 *   응답 패킷  FF FF  ID  LEN  ERR   PARAM…  CHK
 *   LEN  = 파라미터 수 + 2
 *   CHK  = ~(ID + LEN + INST + ΣPARAM) & 0xFF
 *   16비트 값은 리틀엔디언 (하위 바이트 먼저)
 *
 * 의존성 없음. <script src> 로 불러오면 window.Feetech 로 노출됩니다.
 */
(function (global) {
  'use strict';

  // ── STS3215 레지스터 ────────────────────────────────────────────────
  var ADDR_PRESENT_POSITION = 56;   // 0x38, 2바이트
  var INST_READ = 0x02;
  var INST_SYNC_READ = 0x82;
  var BROADCAST_ID = 0xFE;

  var TICKS_PER_REV = 4096;
  var TICK_RAD = (2 * Math.PI) / TICKS_PER_REV;   // 0.00153398 rad
  var CENTER_TICK = 2048;

  function checksum(body) {
    var s = 0;
    for (var i = 0; i < body.length; i++) s += body[i];
    return (~s) & 0xFF;
  }

  function buildRead(id, addr, len) {
    var body = [id, 4, INST_READ, addr, len];
    return new Uint8Array([0xFF, 0xFF].concat(body, [checksum(body)]));
  }

  function buildSyncRead(addr, len, ids) {
    var body = [BROADCAST_ID, ids.length + 4, INST_SYNC_READ, addr, len].concat(ids);
    return new Uint8Array([0xFF, 0xFF].concat(body, [checksum(body)]));
  }

  // =====================================================================
  //  버스
  // =====================================================================

  function FeetechBus() {
    this.port = null;
    this.reader = null;
    this.writer = null;
    this.buf = [];
    this.running = false;
    this._waiters = [];
    this.stats = { reads: 0, timeouts: 0, badChecksum: 0, lastHz: 0 };
    this._syncFails = 0;
    this.useSyncRead = true;
  }

  FeetechBus.isSupported = function () {
    return typeof navigator !== 'undefined' && 'serial' in navigator;
  };

  /** 보안 컨텍스트(https 또는 localhost)에서만 Web Serial 이 동작합니다. */
  FeetechBus.isSecure = function () {
    return typeof global.isSecureContext === 'undefined' || global.isSecureContext;
  };

  FeetechBus.prototype.connect = async function (baudRate) {
    if (!FeetechBus.isSupported()) {
      throw new Error('이 브라우저는 Web Serial 을 지원하지 않습니다.');
    }
    // requestPort 는 반드시 사용자 제스처(클릭) 안에서 호출해야 합니다.
    this.port = await navigator.serial.requestPort();
    await this.port.open({
      baudRate: baudRate || 1000000,
      dataBits: 8,
      stopBits: 1,
      parity: 'none',
      flowControl: 'none',
      bufferSize: 4096
    });
    this.writer = this.port.writable.getWriter();
    this.reader = this.port.readable.getReader();
    this.running = true;
    this.buf.length = 0;
    this._syncFails = 0;
    this._pump();
    return this.port.getInfo ? this.port.getInfo() : {};
  };

  FeetechBus.prototype.disconnect = async function () {
    this.running = false;
    try { if (this.reader) await this.reader.cancel(); } catch (e) { /* noop */ }
    try { if (this.reader) this.reader.releaseLock(); } catch (e) { /* noop */ }
    try { if (this.writer) this.writer.releaseLock(); } catch (e) { /* noop */ }
    try { if (this.port) await this.port.close(); } catch (e) { /* noop */ }
    this.reader = this.writer = this.port = null;
    this._flushWaiters();
  };

  FeetechBus.prototype.isConnected = function () {
    return !!this.port && this.running;
  };

  // ── 수신 펌프 ────────────────────────────────────────────────────────
  FeetechBus.prototype._pump = async function () {
    try {
      while (this.running && this.reader) {
        var res = await this.reader.read();
        if (res.done) break;
        var v = res.value;
        if (v && v.length) {
          for (var i = 0; i < v.length; i++) this.buf.push(v[i]);
          // 버퍼가 밀리면 오래된 바이트를 버린다
          if (this.buf.length > 2048) this.buf.splice(0, this.buf.length - 2048);
          this._flushWaiters();
        }
      }
    } catch (e) {
      // 포트가 닫히면 여기로 빠집니다 — 정상 종료 경로
    }
  };

  FeetechBus.prototype._flushWaiters = function () {
    var ws = this._waiters;
    this._waiters = [];
    for (var i = 0; i < ws.length; i++) ws[i]();
  };

  /** 새 데이터가 들어오거나 timeout 이 될 때까지 기다린다. */
  FeetechBus.prototype._waitData = function (timeoutMs) {
    var self = this;
    return new Promise(function (resolve) {
      var done = false;
      var t = setTimeout(function () {
        if (!done) { done = true; resolve(false); }
      }, timeoutMs);
      self._waiters.push(function () {
        if (!done) { done = true; clearTimeout(t); resolve(true); }
      });
    });
  };

  /**
   * 버퍼에서 상태 패킷 하나를 꺼낸다. id 가 주어지면 그 ID 의 패킷만.
   * @returns {{id:number, err:number, params:number[]}|null}
   */
  FeetechBus.prototype._takePacket = function (id) {
    var b = this.buf;
    for (var i = 0; i + 5 < b.length; i++) {
      if (b[i] !== 0xFF || b[i + 1] !== 0xFF) continue;
      var pid = b[i + 2];
      var len = b[i + 3];
      if (len < 2 || len > 64) continue;
      var total = len + 4;                       // FF FF ID LEN … CHK
      if (i + total > b.length) return null;     // 아직 덜 들어옴

      var body = b.slice(i + 2, i + 3 + len);    // ID LEN ERR PARAM…
      var chk = b[i + 3 + len];
      if (checksum(body) !== chk) {
        this.stats.badChecksum++;
        b.splice(0, i + 2);                      // 깨진 프레임은 버리고 재동기
        i = -1;
        continue;
      }
      if (id != null && pid !== id) {
        b.splice(0, i + total);                  // 다른 ID 응답은 흘려보낸다
        i = -1;
        continue;
      }
      var params = b.slice(i + 5, i + 3 + len);
      b.splice(0, i + total);
      return { id: pid, err: body[2], params: params };
    }
    return null;
  };

  FeetechBus.prototype._request = async function (packet, id, timeoutMs) {
    await this.writer.write(packet);
    var deadline = performance.now() + (timeoutMs || 24);
    for (;;) {
      var pkt = this._takePacket(id);
      if (pkt) return pkt;
      var left = deadline - performance.now();
      if (left <= 0) return null;
      await this._waitData(left);
    }
  };

  /**
   * 서보들의 현재 위치(틱)를 읽습니다.
   * @param {number[]} ids
   * @returns {Promise<Array<number|null>>} ids 와 같은 길이. 실패한 항목은 null.
   */
  FeetechBus.prototype.readPositions = async function (ids) {
    if (!this.isConnected()) return ids.map(function () { return null; });
    var t0 = performance.now();
    var out;

    if (this.useSyncRead) {
      out = await this._syncReadPositions(ids);
      if (out) {
        this._syncFails = 0;
      } else {
        this._syncFails++;
        if (this._syncFails >= 3) this.useSyncRead = false;  // 지원 안 하면 개별 읽기로
        out = await this._individualPositions(ids);
      }
    } else {
      out = await this._individualPositions(ids);
    }

    var dt = performance.now() - t0;
    if (dt > 0) this.stats.lastHz = 1000 / dt;
    this.stats.reads++;
    return out;
  };

  FeetechBus.prototype._syncReadPositions = async function (ids) {
    this.buf.length = 0;
    await this.writer.write(buildSyncRead(ADDR_PRESENT_POSITION, 2, ids));

    var got = {};
    var deadline = performance.now() + 30;
    while (Object.keys(got).length < ids.length) {
      var pkt = this._takePacket(null);
      if (pkt) {
        if (pkt.params.length >= 2) {
          got[pkt.id] = pkt.params[0] | (pkt.params[1] << 8);   // 리틀엔디언
        }
        continue;
      }
      var left = deadline - performance.now();
      if (left <= 0) break;
      await this._waitData(left);
    }

    if (Object.keys(got).length < ids.length) {
      this.stats.timeouts++;
      return null;
    }
    return ids.map(function (id) {
      return got[id] != null ? got[id] : null;
    });
  };

  FeetechBus.prototype._individualPositions = async function (ids) {
    var out = [];
    for (var i = 0; i < ids.length; i++) {
      var pkt = await this._request(
        buildRead(ids[i], ADDR_PRESENT_POSITION, 2), ids[i], 20);
      if (pkt && pkt.params.length >= 2) {
        out.push(pkt.params[0] | (pkt.params[1] << 8));
      } else {
        this.stats.timeouts++;
        out.push(null);
      }
    }
    return out;
  };

  // =====================================================================
  //  틱 → 라디안 매핑
  // =====================================================================

  /**
   * 리더 서보의 원시 틱을 시뮬레이터 조인트 각(rad)으로 바꿉니다.
   *
   * 두 가지 모드
   *   raw   — (틱 − 영점) × 1틱  (+ 방향 반전). 기본값이며 영점은 캡처로 잡습니다.
   *   calib — lerobot-calibrate 가 만든 JSON 의 range_min/max 를 URDF 조인트
   *           한계에 선형 대응시킵니다. 방향까지 맞아 들어가므로 가장 정확합니다.
   */
  function LeaderMapper(joints) {
    this.joints = joints;                 // SO101.JOINTS
    this.mode = 'raw';
    this.zero = joints.map(function () { return CENTER_TICK; });
    this.invert = joints.map(function () { return false; });
    this.calib = null;                    // { name: {range_min, range_max, drive_mode} }
  }

  LeaderMapper.prototype.captureZero = function (ticks) {
    for (var i = 0; i < ticks.length; i++) {
      if (ticks[i] != null) this.zero[i] = ticks[i];
    }
  };

  /** lerobot-calibrate 가 만든 JSON 을 적용합니다. */
  LeaderMapper.prototype.loadCalibration = function (json) {
    var ok = 0;
    var calib = {};
    for (var i = 0; i < this.joints.length; i++) {
      var name = this.joints[i].name;
      var e = json[name];
      if (e && typeof e.range_min === 'number' && typeof e.range_max === 'number'
          && e.range_max > e.range_min) {
        calib[name] = {
          min: e.range_min,
          max: e.range_max,
          drive: e.drive_mode ? 1 : 0
        };
        ok++;
      }
    }
    if (ok === 0) throw new Error('조인트 범위를 찾지 못했습니다. LeRobot 캘리브레이션 JSON 이 맞나요?');
    this.calib = calib;
    this.mode = 'calib';
    return ok;
  };

  LeaderMapper.prototype.useRaw = function () {
    this.mode = 'raw';
    this.calib = null;
  };

  /**
   * @param {Array<number|null>} ticks
   * @param {number[]} fallback 읽기 실패 시 유지할 이전 각도
   * @returns {number[]} 조인트 각 (rad)
   */
  LeaderMapper.prototype.toRadians = function (ticks, fallback) {
    var out = [];
    for (var i = 0; i < this.joints.length; i++) {
      var j = this.joints[i];
      var t = ticks[i];
      if (t == null) { out.push(fallback[i]); continue; }

      var rad;
      if (this.mode === 'calib' && this.calib && this.calib[j.name]) {
        var c = this.calib[j.name];
        var u = (t - c.min) / (c.max - c.min);          // 0~1
        if (c.drive) u = 1 - u;
        rad = j.lower + u * (j.upper - j.lower);
      } else {
        rad = (t - this.zero[i]) * TICK_RAD;
        if (this.invert[i]) rad = -rad;
        // raw 모드에서는 영점이 조인트 중앙이라고 가정합니다
        rad += (j.upper + j.lower) / 2;
      }
      out.push(Math.max(j.lower, Math.min(j.upper, rad)));
    }
    return out;
  };

  global.Feetech = {
    FeetechBus: FeetechBus,
    LeaderMapper: LeaderMapper,
    TICK_RAD: TICK_RAD,
    CENTER_TICK: CENTER_TICK,
    ADDR_PRESENT_POSITION: ADDR_PRESENT_POSITION
  };
})(typeof window !== 'undefined' ? window : globalThis);
