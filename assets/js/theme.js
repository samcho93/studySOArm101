/*
 * theme.js — 밝게 / 어둡게 / 시스템 설정 따르기
 * -------------------------------------------------------------------------
 * <head> 에서 동기적으로 실행되어 첫 페인트 전에 테마를 적용합니다.
 * 그래야 새로고침할 때 어두운 화면이 번쩍이지 않습니다.
 *
 *   data-theme 없음     → 운영체제 설정을 따름 (기본값)
 *   data-theme="light"  → 항상 밝게
 *   data-theme="dark"   → 항상 어둡게
 *
 * 테마가 바뀌면 document 에 'themechange' 이벤트를 보냅니다.
 * (3D 장면처럼 CSS 밖에서 색을 쓰는 곳이 따라오도록)
 */
(function () {
  'use strict';

  var KEY = 'so-arm101.theme';
  var MODES = ['system', 'light', 'dark'];
  var LABEL = { system: '자동', light: '밝게', dark: '어둡게' };
  var TITLE = {
    system: '테마 — 시스템 설정을 따릅니다 (눌러서 밝게)',
    light: '테마 — 항상 밝게 (눌러서 어둡게)',
    dark: '테마 — 항상 어둡게 (눌러서 자동으로)'
  };

  // 아이콘 버튼용 — data-theme-icon 속성이 붙은 버튼에만 그립니다
  var SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
            'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ' +
            'aria-hidden="true">';
  var ICON = {
    system: SVG + '<rect x="3" y="4.5" width="18" height="12" rx="2"/>' +
            '<path d="M9 20h6M12 16.5V20"/></svg>',
    light:  SVG + '<circle cx="12" cy="12" r="4.2"/>' +
            '<path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2' +
            'M5.2 5.2l1.6 1.6M17.2 17.2l1.6 1.6M18.8 5.2l-1.6 1.6' +
            'M6.8 17.2l-1.6 1.6"/></svg>',
    dark:   SVG + '<path d="M20.5 14.4A8.6 8.6 0 0 1 9.6 3.5' +
            'a8.6 8.6 0 1 0 10.9 10.9z"/></svg>'
  };

  var root = document.documentElement;
  var mode = 'system';

  function read() {
    try {
      var v = localStorage.getItem(KEY);
      return MODES.indexOf(v) >= 0 ? v : 'system';
    } catch (e) {
      return 'system';
    }
  }

  function write(v) {
    try { localStorage.setItem(KEY, v); } catch (e) { /* 프라이빗 모드 등 */ }
  }

  /** 현재 실제로 보이는 테마 */
  function resolved() {
    if (mode !== 'system') return mode;
    return (window.matchMedia &&
            window.matchMedia('(prefers-color-scheme: light)').matches)
      ? 'light' : 'dark';
  }

  function apply(next, persist) {
    mode = MODES.indexOf(next) >= 0 ? next : 'system';
    if (mode === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', mode);
    if (persist) write(mode);
    paint();
    try {
      document.dispatchEvent(new CustomEvent('themechange', {
        detail: { mode: mode, resolved: resolved() }
      }));
    } catch (e) { /* 구형 브라우저 */ }
  }

  function paint() {
    var btns = document.querySelectorAll('[data-theme-toggle]');
    for (var i = 0; i < btns.length; i++) {
      if (btns[i].hasAttribute('data-theme-icon')) {
        btns[i].innerHTML = ICON[mode];
      } else {
        btns[i].textContent = LABEL[mode];
      }
      btns[i].title = TITLE[mode];
      btns[i].setAttribute('aria-label', TITLE[mode]);
    }
  }

  function cycle() {
    apply(MODES[(MODES.indexOf(mode) + 1) % MODES.length], true);
  }

  // 첫 페인트 전에 속성을 붙인다 (DOM 은 아직 없을 수 있다)
  apply(read(), false);

  function ready() {
    paint();
    document.addEventListener('click', function (e) {
      var btn = e.target.closest && e.target.closest('[data-theme-toggle]');
      if (btn) cycle();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ready);
  } else {
    ready();
  }

  // 시스템 설정을 따르는 중이라면 OS 테마 변경에 반응한다
  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: light)');
    var onChange = function () { if (mode === 'system') apply('system', false); };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }

  window.SOTheme = { get: function () { return mode; }, resolved: resolved, set: apply };
})();
