// node desktop/test/openLink.test.js — planq://open 판정 시험 (통과·탈락 양쪽)
'use strict';
const assert = require('assert');
const { judgeOpenLink } = require('../src/openLink');
const O = 'https://planq.kr';
const open = (url, u) => `planq://open?url=${encodeURIComponent(url)}${u ? `&u=${u}` : ''}`;
const cases = [
  [open('https://planq.kr/docs?post=123', 7), { path: '/docs?post=123', u: 7 }],
  [open('https://planq.kr/tasks?task=5&ws=6'), { path: '/tasks?task=5&ws=6', u: null }],
  [open('https://planq.kr/projects/p/3#x'), { path: '/projects/p/3#x', u: null }],
  [open('https://planq.kr/business/settings'), { path: '/business/settings', u: null }],
  [open('https://dev.planq.kr/docs?post=1'), null],            // 다른 출처(개발 링크 → 운영 앱)
  [open('https://evil.example/docs'), null],
  [open('https://planq.kr/public/doc/abc'), null],              // 공개 미리보기 = 브라우저
  [open('https://planq.kr/oauth/native-return?code=1'), null],  // oauth 복귀는 open 으로 안 받음
  [open('https://planq.kr/login'), null],
  [open('https://planq.kr/'), null],
  [open('https://planq.kr/docs/%2e%2e/login'), null],
  [open('https://planq.kr/docs/..%2flogin'), null],
  [open('https://planq.kr/docs\\..\\login'), null],
  [open('https://planq.kr/docs/../login'), null],               // 정규화 뒤 /login → 탈락
  [open('https://user:pw@planq.kr/docs'), null],
  [open('https://planq.kr/memo'), null],                         // /me/ 는 /memo 를 삼키지 않는다
  ['planq://oauth/native-return?code=1', null],
  ['planq://open/x?url=' + encodeURIComponent('https://planq.kr/docs'), null],
  ['https://planq.kr/docs', null],
  [open('https://planq.kr/docs', 'abc'), { path: '/docs', u: null }],
  [open('https://planq.kr/talk-popout?x=1'), null],          // 팝아웃 창 주소는 메인 창 화면이 아님
  [open('https://planq.kr/task-popout'), null],
  [open('https://planq.kr/tasks?task=1'), { path: '/tasks?task=1', u: null }],
  [null, null],
];
let n = 0;
for (const [raw, want] of cases) { assert.deepStrictEqual(judgeOpenLink(raw, O), want, String(raw)); n++; }
console.log(`openLink ${n}/${cases.length} 통과`);
