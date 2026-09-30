/* 구형 WebView 폴리필 (2026-09-30)
 * 운영 크래시: Android WebView Chrome 90(앱 안 브라우저)에서 `Object.hasOwn is not a function` 으로
 * 확인필요 화면이 통째로 죽었다. 우리 코드가 아니라 **번들된 라이브러리**(i18next·react 계열·highlight)가
 * 쓰는 ES2022 함수라 소스 수정으로는 못 막는다. 모듈 스크립트보다 먼저 도는 classic script 로 채운다.
 * (인라인 <script> 는 CSP 에 막힐 수 있어 별도 파일로 둔다.) 있으면 아무것도 하지 않는다.
 */
(function () {
  try {
    if (!Object.hasOwn) {
      Object.defineProperty(Object, 'hasOwn', {
        value: function (o, k) { return Object.prototype.hasOwnProperty.call(Object(o), k); },
        configurable: true, writable: true,
      });
    }
    var at = function (n) {
      n = Math.trunc(n) || 0;
      if (n < 0) n += this.length;
      if (n < 0 || n >= this.length) return undefined;
      return this[n];
    };
    [Array.prototype, String.prototype].forEach(function (p) {
      if (!p.at) Object.defineProperty(p, 'at', { value: at, configurable: true, writable: true });
    });
    if (!Array.prototype.findLast) {
      Object.defineProperty(Array.prototype, 'findLast', {
        value: function (fn, t) { for (var i = this.length - 1; i >= 0; i--) if (fn.call(t, this[i], i, this)) return this[i]; return undefined; },
        configurable: true, writable: true,
      });
    }
    if (!Array.prototype.findLastIndex) {
      Object.defineProperty(Array.prototype, 'findLastIndex', {
        value: function (fn, t) { for (var i = this.length - 1; i >= 0; i--) if (fn.call(t, this[i], i, this)) return i; return -1; },
        configurable: true, writable: true,
      });
    }
    if (typeof window.structuredClone !== 'function') {
      // 완전한 구현이 아니다(JSON 으로 옮길 수 있는 값만) — 없어서 죽는 것보다 낫다
      window.structuredClone = function (v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); };
    }
  } catch (e) { /* 폴리필 실패로 앱을 막지 않는다 */ }
})();
