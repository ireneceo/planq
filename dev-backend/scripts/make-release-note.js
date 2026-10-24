#!/usr/bin/env node
// 배포 커밋 범위로 **고객에게 보일 새 소식(릴리즈 노트)** 을 AI 가 써서 파일로 만든다 (2026-10-24).
//
// 왜: 버전·새 소식이 사람 손(«버전 올릴까요?»)에만 걸려 있어 10-04 v1.70.1 뒤 배포 여러 번이
//     고객에게 한 줄도 안 알려졌다. (Irene 2026-10-24: "공지내용을 자동화해야지. 내가 뭘 해? 어떻게?
//     너가 공지를 배포하면 해야지.") → 배포 스크립트(prepare_release_note)가 이 스크립트로 노트를 만들고
//     배포 뒤 그대로 발행한다. 사람 확인 단계 없음.
//
// 지키는 것:
//   - 입력은 커밋 **제목**만, 그중 feat/fix/perf 만. 내부 도구(배포·상황판·가드·관리자 전용 등)는 미리 뺀다.
//   - 결과는 금지어 검사를 통과해야 한다(내부 사정·주소·번호·사람 이름 표식). 걸리면 한 번 다시 쓰게 하고,
//     또 걸리면 실패(exit 1) — 배포는 계속되고 이번 범위는 다음 배포 노트에 다시 실린다.
//   - ko/en 둘 다 채워야 한다(빈 칸이면 실패).
//
// 사용: node scripts/make-release-note.js <from> <to> <version> --out <path> [--repo /opt/planq]
//   exit 0 = 만듦 · 3 = 고객에게 알릴 변경 없음 · 1 = 실패
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { execFileSync } = require('child_process');
const fs = require('fs');
const { callLLM } = require('../services/llm');

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i > -1 ? args[i + 1] : def; };
const [from, to, version] = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
const out = opt('--out', null);
const repo = opt('--repo', '/opt/planq');

if (!from || !to || !version || !out) {
  console.error('사용법: node scripts/make-release-note.js <from> <to> <version> --out <path> [--repo /opt/planq]');
  process.exit(1);
}

const USER_FACING = /^(feat|fix|perf)(\(|:|!)/i;
// 고객과 상관없는 일 — 범위 이름이나 제목에 이 말이 있으면 넣지 않는다
const INTERNAL = /배포|상황판|가드|guard|god-file|\(훅|hook|e2e|하니스|harness|Fable|게이트|작업기록|개발 현황|dev-status|플랫폼 관리자|관리자 화면|\badmin\b|플랫폼 운영|마이그레이션|migration|백필|backfill|래칫|ratchet|검사기|\btests?\b|SNS 발송|nginx|pm2|\bcron\b/i;
// 보안 계열 — 무엇이 새던/뚫리던 것인지는 공개 글에 쓰지 않는다(무인증 /insights 로 바로 나간다).
//   AI 에 넘기지 않고, 하나라도 있으면 고정 문구 한 항목으로만 알린다 (2026-10-24 Fable FAIL 대조군: 보안 제목 12개 → 6항목이 세부 내용).
const SECURITY = /^(feat|fix|perf)\((보안|security|격리|권한|인증|tenant|멀티테넌트)[^)]*\)|보안|security|유출|노출|누출|새던|새는|남의|다른 워크스페이스|다른 고객|탈취|가로채|토큰|token|비밀|secret|leak|XSS|CSRF|SSRF|injection|IDOR|우회|격리|권한 없|위조|스푸핑|spoof|원문|추정|가늠|건수|삭제(한|된)? ?(메시지|파일|문서)[^,]{0,30}(남|보이)/i;
const SECURITY_ITEM = {
  ko: { title: '보안과 안정성 강화', body: '데이터를 더 안전하게 지키도록 보안과 안정성을 강화했습니다.' },
  en: { title: 'Security and stability improvements', body: 'We strengthened security and stability to keep your data safer.' },
};
const clean = (s) => s.replace(/\s*\(#\d+\)\s*$/, '').trim();

let subjects;
try {
  subjects = execFileSync('git', ['-C', repo, 'log', '--no-merges', '--format=%s', `${from}..${to}`], { encoding: 'utf8' })
    .split('\n').map((s) => s.trim()).filter(Boolean);
} catch (e) {
  console.error('git log 실패:', e.message);
  process.exit(1);
}
const facing = subjects.filter((s) => USER_FACING.test(s) && !INTERNAL.test(s));
const securityCount = facing.filter((s) => SECURITY.test(s)).length;
const picked = facing.filter((s) => !SECURITY.test(s)).map(clean)
  .filter((s, i, a) => a.indexOf(s) === i);
// 새 기능을 앞에 — 입력 상한에 걸려도 기능이 먼저 남는다
picked.sort((a, b) => (/^feat/i.test(b) ? 1 : 0) - (/^feat/i.test(a) ? 1 : 0));

if (picked.length === 0 && securityCount === 0) {
  console.log('고객에게 알릴 변경(feat/fix/perf)이 없어 새 소식을 만들지 않습니다.');
  process.exit(3);
}

// 금지어 — 고객 글에 나오면 안 되는 내부 사정·식별자
const BANNED = [
  /Fable|Opus|Claude Code|Codex|\bGPT\b|OpenAI/i, /상황판|작업방|방 [0-9a-f]{6,}/, /커밋|\bcommits?\b|배포 스크립트|가드|god-file|리팩/i,
  /Sequelize|MySQL|DB 칸|마이그레이션|\bmigrations?\b|라우트|\broutes?\b|엔드포인트|\bendpoints?\b|API 키/i,
  /dev\.planq|localhost|https?:\/\//i, /#\d+|INV-\d|운영 업무|\bws ?\d/i, /@[A-Za-z0-9]/, /\[확인용\]/,
  /취약|vulnerab|\bXSS\b|injection|탈취|가로채|hijack|유출|누출|노출되|노출하|노출이|\bleak|\bexpos|토큰|\btokens?\b|권한 없|without permission|세션을/i,
  /건수를|가늠|추정하기|\b(guess|infer)|삭제(한|된)[^.]{0,30}(남아|남던|남지|보이)|deleted[^.]{0,50}(remain|still|no longer)/i,
  /다른 (워크스페이스|고객|사람|회사|팀)[^.]{0,40}(볼 수|열|보이|접근|읽)|other (workspaces?|customers?|clients?|people|users?)[^.]{0,60}(see|view|access|open|read)/i,
];

const SYSTEM = `너는 B2B 업무 SaaS «PlanQ» 의 새 소식(업데이트 안내) 담당이다. 개발자 커밋 제목 목록을 받아,
PlanQ 를 쓰는 고객(사업자·직원·그 고객)이 읽을 업데이트 안내를 한국어와 영어로 쓴다.

규칙:
- 고객이 화면에서 직접 느끼는 변화만. 비슷한 것은 하나로 묶는다. 항목은 3~10개, 중요한 것(새 기능)부터.
- 작은 버그 수정이 많으면 마지막에 «그 밖의 개선» 항목 하나로 묶어 대표적인 것 2~3개만 말한다.
- 제목: 무엇이 좋아졌는지 한 줄(ko 30자·en 70자 안쪽). 본문: 어디서 무엇을 할 수 있는지 1~2문장(ko 160자·en 320자 안쪽), 쉬운 말.
- 한 항목에 기능을 줄줄이 늘어놓지 않는다 — 고객이 가장 반길 것 2~3개만 말하고 나머지는 뺀다.
- 메뉴 이름은 PlanQ 이름 그대로(Q Talk·Q Task·Q Note·Q File·Q Bill·Q mail·Q sale·Q docs·Q위키·Cue).
- 쓰지 말 것: 사람·회사·고객 이름, 번호(#123, 문서 번호), 내부 도구·개발 용어(커밋·DB·라우트·리팩터링·가드·배포),
  보안·권한·데이터 노출과 관련된 내용 일체(따로 고정 문구로 알린다 — 보안·노출·다른 고객/워크스페이스·토큰 이야기를 쓰지 않는다),
  AI 모델·회사 이름, 플랫폼 관리자 전용 기능, 주소(URL).
- 커밋에 없는 기능을 지어내지 않는다. 확실하지 않으면 뺀다.
- 영어는 한국어와 같은 내용, 자연스러운 제품 안내 문체.

JSON 으로만 답한다:
{"summary":{"ko":"한 줄 요약","en":"one-line summary"},
 "items":[{"ko":{"title":"…","body":"…"},"en":{"title":"…","body":"…"}}]}`;

function problems(spec) {
  const errs = [];
  if (!spec || !Array.isArray(spec.items) || spec.items.length < 1 || spec.items.length > 12) errs.push('items 1~12개가 아님');
  const texts = [];
  for (const [i, it] of (spec?.items || []).entries()) {
    for (const lang of ['ko', 'en']) {
      for (const f of ['title', 'body']) {
        const v = it?.[lang]?.[f];
        if (typeof v !== 'string' || !v.trim()) { errs.push(`items[${i}].${lang}.${f} 비어 있음`); continue; }
        texts.push(v);
        const max = { ko: { title: 45, body: 260 }, en: { title: 100, body: 520 } }[lang][f];
        if (v.length > max) errs.push(`items[${i}].${lang}.${f} 너무 김(${v.length}자 > ${max}) — 줄여라`);
      }
    }
  }
  for (const lang of ['ko', 'en']) {
    const v = spec?.summary?.[lang];
    if (typeof v !== 'string' || !v.trim()) errs.push(`summary.${lang} 비어 있음`); else texts.push(v);
  }
  for (const t of texts) {
    for (const re of BANNED) if (re.test(t)) errs.push(`금지어 ${re} — «${t}»`);
  }
  return errs;
}

(async () => {
  if (picked.length === 0) {
    const only = { version, date: new Date().toISOString().slice(0, 10), _auto: true, _range: `${from.slice(0, 8)}..${to.slice(0, 8)}`,
      summary: { ko: SECURITY_ITEM.ko.body, en: SECURITY_ITEM.en.body }, items: [SECURITY_ITEM] };
    fs.writeFileSync(out, JSON.stringify(only, null, 2) + '\n');
    console.log(`새 소식 v${version} — 보안 커밋 ${securityCount}개만 → 고정 문구 1항목 · ${out}`);
    process.exit(0);
  }
  const list = picked.map((s) => `- ${s}`).join('\n');
  const messages = [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `버전 v${version} 커밋 제목 ${picked.length}개:\n${list}` },
  ];
  let spec = null;
  let errs = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    const r = await callLLM({ purpose: 'release_note', messages, json: true, fallback: '' });
    if (r.fallback || !r.content) { errs = [`AI 호출 실패 (${r.model})`]; break; }
    try { spec = JSON.parse(r.content); } catch { spec = null; }
    errs = spec ? problems(spec) : ['JSON 아님'];
    if (errs.length === 0) break;
    messages.push({ role: 'assistant', content: r.content });
    messages.push({ role: 'user', content: `다음을 고쳐 JSON 전체를 다시 써라:\n${errs.slice(0, 10).map((e) => `- ${e}`).join('\n')}` });
  }
  if (errs.length) {
    console.error('새 소식 만들기 실패:');
    for (const e of errs.slice(0, 10)) console.error(`  - ${e}`);
    process.exit(1);
  }
  const note = {
    version,
    date: new Date().toISOString().slice(0, 10),
    _auto: true,
    _range: `${from.slice(0, 8)}..${to.slice(0, 8)}`,
    summary: { ko: spec.summary.ko.trim(), en: spec.summary.en.trim() },
    items: spec.items.map((it) => ({
      ko: { title: it.ko.title.trim(), body: it.ko.body.trim() },
      en: { title: it.en.title.trim(), body: it.en.body.trim() },
    })).concat(securityCount ? [SECURITY_ITEM] : []),
  };
  fs.writeFileSync(out, JSON.stringify(note, null, 2) + '\n');
  console.log(`새 소식 v${version} — 커밋 ${picked.length}개(+보안 ${securityCount}개 고정 문구) → 항목 ${note.items.length}개 · ${out}`);
  for (const it of note.items) console.log(`  · ${it.ko.title}`);
  process.exit(0);
})().catch((e) => { console.error('오류:', e.message); process.exit(1); });
