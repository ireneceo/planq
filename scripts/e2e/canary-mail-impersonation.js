// scripts/e2e/canary-mail-impersonation.js — 메일 사칭 판정 카나리 (docs/MAIL_IMPERSONATION_DESIGN.md §8).
//   순수 판정 함수만 — 시드 불필요, 데이터 원복 없음.
//   양성(격리) 8 · 음성(격리 아님) 8 · 판정기 반증 2(이모지 예외·아는 상대 전달을 끊으면 판정이 뒤집히는가) ·
//   실 mailparser 1(인입 입력 만들기가 숨은 글자·Reply-To·링크를 잃지 않는가) · 엔진 연결 1.
require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env' });
const fs = require('fs');
const Module = require('module');
const path = require('path');
const { simpleParser } = require('/opt/planq/dev-backend/node_modules/mailparser');
const SRC = '/opt/planq/dev-backend/services/mailImpersonation.js';
const I = require(SRC);
const T = require('/opt/planq/dev-backend/services/emailTriage');

const KNOWN = new Set(['gitconsulting.group', 'irenewp.com', 'wor-pro.com']);
const POS = [
  ['실측 e-Tax(ZWJ·WJ)', { fromName: 'e-T‍ax（国税電子⁠申告・納税システム）', fromEmail: 'snbzb@snbzb.gmtapublishing.com' }],
  ['실측 ANA(RLO)', { fromName: '‮ブラクジーレイマ ANA‬', fromEmail: 'noreply@mail14.jyherun.com' }],
  ['실측 국세청(RLI+RLO)', { fromName: '⁦‮【 ⁠x⁠a﻿T-e庁税国 】‬⁩', fromEmail: 'noreply@brennanvisuals.com' }],
  ['실측 Amazon(ZWSP·WJ)', { fromName: 'Ama​zon.co.jp デリバリ⁠ー', fromEmail: 'yrzvt@yrzvt.yuancheng56.com' }],
  ['퓨니코드 혼합(xn--pple)', { fromEmail: 'a@xn--pple-43d.com' }],
  ['전체 키릴 аррӏе', { fromEmail: 'a@аррӏе.com' }],
  ['아는 도메인 한 글자(gitconsu1ting)', { fromEmail: 'ceo@gitconsu1ting.group' }],
  ['첨부 이름 RLO', { fromEmail: 'a@b.example', attachmentNames: ['invoice‮fdp.exe'] }],
];
const NEG = [
  ['NOL_CS 끝 ZWJ', { fromName: 'NOL_CS ‍', fromEmail: 'help.nol@nol-universe.com' }, 'none'],
  ['이모지 🐈‍⬛ 제목', { subject: '📚[남의동네책방] 🐈‍⬛ 새벽고양이', fromEmail: 'newsletter@flybook.kr' }, 'none'],
  ['한글 IDN 발신·링크', { fromEmail: '문의@한글도메인.한국', linkHosts: ['한글.한국'] }, 'none'],
  ['일본어 레이블', { fromEmail: 'a@ドコモ.jp' }, 'none'],
  ['Investing.com ← investingmail', { fromName: 'Investing.com', fromEmail: 'news@investingmail.com' }, 'none'],
  ['«irenewp.com Team» ← google', { fromName: 'irenewp.com Team', fromEmail: 'workspace-noreply@google.com' }, 'warn'],
  ['콜드메일 제목 ZWSP 1(단어 안)', { subject: 'Pro​posal for you', fromEmail: 'thomas.le@mindsupernova.io' }, 'warn'],
  ['반송 DSN 링크의 오타 도메인', { fromEmail: 'mailer-daemon@googlemail.com', subject: 'Delivery Status Notification (Failure)', linkHosts: ['irenewp.co'], bounce: true }, 'none'],
];

function variant(transform) {
  const code = transform(fs.readFileSync(SRC, 'utf8'));
  const m = new Module(SRC, null); m.filename = SRC; m.paths = Module._nodeModulePaths(path.dirname(SRC));
  m._compile(code, SRC); return m.exports;
}

async function run() {
  const out = [];
  const ok = (name, cond, detail = '') => out.push({ name, route: name, fail: cond ? 0 : 1, detail: cond ? `— ${detail || 'OK'}` : `— 실패 ${detail}` });
  for (const [n, c] of POS) {
    const r = I.assess({ knownDomains: KNOWN, ...c });
    ok(`양성: ${n} → 격리`, r && r.level === 'quarantine', r ? r.signals.map((s) => s.code).join(',') : 'null');
  }
  for (const [n, c, want] of NEG) {
    const r = I.assess({ knownDomains: KNOWN, ...c });
    const got = r ? r.level : 'none';
    ok(`음성: ${n} → ${want}`, got === want, got);
  }
  // 반증 ① 이모지 예외를 끄면 🐈‍⬛ 가 신호로 뒤집혀야 한다(판정기가 그 규칙으로 가르고 있다는 증거).
  const noPicto = variant((s) => s.replace("if (cp === 0x200D && (PICTO_RE.test(prev) || PICTO_RE.test(next))) continue;", ''));
  const flip = noPicto.assess({ subject: '📚 🐈‍⬛ 새벽', fromEmail: 'n@flybook.kr' });
  ok('반증: 이모지 예외를 지우면 🐈‍⬛ 가 신호가 된다', !!flip && flip.signals.some((s) => s.code === 'hidden_chars'), flip ? flip.level : 'null');
  // 반증 ② 아는 상대(known) 전달을 끊으면 같은 강신호가 격리로 뒤집혀야 한다.
  const kOn = I.assess({ fromName: '‮홍길동', fromEmail: 'hong@acme.com', known: true });
  const kOff = I.assess({ fromName: '‮홍길동', fromEmail: 'hong@acme.com', known: false });
  ok('반증: 아는 상대는 경고 · 모르는 상대는 격리', kOn.level === 'warn' && kOn.known && kOff.level === 'quarantine', `${kOn.level}/${kOff.level}`);
  // 실 mailparser — 인입 입력이 숨은 글자·Reply-To·링크를 보존한다.
  const enc = (s) => `=?UTF-8?B?${Buffer.from(s).toString('base64')}?=`;
  const parsed = await simpleParser([
    `From: ${enc('Ama​zon⁠ Japan')} <a@shop.example>`, 'To: help@irenewp.com', 'Reply-To: helpdesk.amz@gmail.com',
    `Subject: ${enc('注文‌確⁠認')}`, 'Message-ID: <imp-canary@qa.local>', 'Content-Type: text/html; charset=UTF-8', '',
    '<a href="https://xn--pple-43d.com/login">login</a>'].join('\r\n'));
  const inp = I.inputFromParsed(parsed, { fromEmail: 'a@shop.example', fromName: parsed.from.value[0].name });
  const rp = I.assess(inp);
  const codes = rp ? rp.signals.map((s) => s.code) : [];
  ok('실 mailparser: 숨은 글자·Reply-To 무료메일·링크 혼합 문자를 다 본다',
    codes.includes('hidden_chars') && codes.includes('reply_to_divergent') && codes.includes('mixed_script_label'), codes.join(','));
  // 엔진 연결 — 격리 등급이면 triageInbound 가 아는 상대·회신 판정보다 먼저 스팸(impersonation)으로 보낸다. 끄면 안 보낸다.
  const imp = { level: 'quarantine', signals: [{ code: 'bidi_override', level: 'strong', detail: 'name:U+202E' }] };
  const on = T.triageInbound({ subject: 'Re: 견적', bodyText: '확인 부탁드립니다', fromEmail: 'x@y.example', headers: { 'in-reply-to': '<q@irenewp.com>' }, ownEmails: new Set(['help@irenewp.com']), impersonation: imp });
  const off = T.triageInbound({ subject: 'Re: 견적', bodyText: '확인 부탁드립니다', fromEmail: 'x@y.example', headers: { 'in-reply-to': '<q@irenewp.com>' }, ownEmails: new Set(['help@irenewp.com']), impersonation: imp, off: ['impersonation'] });
  ok('엔진: 격리 등급 → 스팸(impersonation) · 기준 끄면 격리 안 함', on.status === 'spam' && on.criterion === 'impersonation' && off.status !== 'spam', `${on.criterion}/${off.status}`);
  return out;
}

module.exports = { name: 'canary-mail-impersonation', run };
