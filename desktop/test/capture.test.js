// 회의 소리 녹음 판정(src/capture.js) — Electron 없이 node 로 돈다. node desktop/test/capture.test.js
//   양성 대조군: 통과해야 할 요청 1개가 실제로 통과하는지 먼저 본다(모두 거절하는 판정은 이 시험을 통과하지 못한다).
'use strict';
const assert = require('assert');
const { judgeDisplayMedia, systemAudioSupported } = require('../src/capture');

const good = { platform: 'win32', sameOrigin: true, isMainTopFrame: true, userGesture: true, audioRequested: true };
const cases = [
  ['양성: 윈도우 메인 창·앱 출처·제스처·소리', good, true, undefined],
  ['맥은 시스템 소리 없음', { ...good, platform: 'darwin' }, false, 'unsupported_os'],
  ['리눅스 없음', { ...good, platform: 'linux' }, false, 'unsupported_os'],
  ['다른 출처(XSS 로 띄운 바깥 프레임)', { ...good, sameOrigin: false }, false, 'origin'],
  ['팝아웃·iframe — 메인 창 최상위 아님', { ...good, isMainTopFrame: false }, false, 'not_main_frame'],
  ['사용자 제스처 없음(조용한 스크립트 호출)', { ...good, userGesture: false }, false, 'no_gesture'],
  ['소리 없이 화면만', { ...good, audioRequested: false }, false, 'no_audio'],
  ['빈 요청', {}, false, 'unsupported_os'],
];
let fail = 0;
for (const [name, req, ok, reason] of cases) {
  const v = judgeDisplayMedia(req);
  try {
    assert.strictEqual(v.ok, ok);
    if (!ok) assert.strictEqual(v.reason, reason);
    console.log(`✅ ${name} → ${v.ok ? 'ok' : v.reason}`);
  } catch {
    fail++; console.log(`❌ ${name} → ${JSON.stringify(v)} (기대 ${ok ? 'ok' : reason})`);
  }
}
assert.strictEqual(systemAudioSupported('win32'), true);
assert.strictEqual(systemAudioSupported('darwin'), false);
console.log(fail ? `FAIL ${fail}/${cases.length}` : `PASS ${cases.length}/${cases.length}`);
process.exit(fail ? 1 : 0);
