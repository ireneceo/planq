#!/usr/bin/env node
// 배포 커밋 범위로 **릴리즈 노트 초안**을 만든다 (2026-09-07).
//
// 왜: `publish_release_note()` 는 `docs/release-notes/v{버전}.json` 을 **사람이 미리 써 둬야만**
//     발행한다. 그런데 버전은 며칠씩 안 오르고 배포는 하루 여러 번이라, 대부분의 배포가
//     아무것도 남기지 않았다 — 그래서 "새 소식" 이 8건에 멈춰 있었다
//     (Irene 2026-09-07: "내용이 빈약한데 자동업데이트 배포하면서 하는 거 아니였어?").
//
// 무엇을: 커밋 제목에서 사용자에게 보일 만한 것만 골라 **미발행 초안**을 만든다.
//   ★ 자동으로 **발행하지 않는다.** 커밋 제목은 개발자 언어라 그대로 내보내면 안 된다.
//     초안이 있으면 사람은 고쳐서 발행하면 되고, 없으면 아무 일도 안 일어난다 — 그 차이가 크다.
//   ★ 영어는 지어내지 않는다. 번역이 없으면 en 은 비워 두고, 발행 전에 사람이 채운다
//     (없는 번역을 기계가 만들어 내보내면 그게 곧 거짓 문구가 된다).
//
// 사용: node scripts/make-release-note-draft.js <from> <to> <version> [--out path]
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = '/opt/planq';
const [from, to, version] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const outIdx = process.argv.indexOf('--out');
const out = outIdx > -1 ? process.argv[outIdx + 1] : null;

if (!to || !version) {
  console.error('사용법: node scripts/make-release-note-draft.js <from> <to> <version> [--out path]');
  process.exit(2);
}

// 사용자에게 보일 것 — feat/fix 만. chore/docs/refactor/test/ops 는 뺀다(내부 사정이다).
const USER_FACING = /^(feat|fix|perf)(\(|:|!)/i;
// 제목에서 접두어와 이슈 참조를 걷어낸다.
const clean = (s) => s
  .replace(/^(feat|fix|perf)(\([^)]*\))?!?:\s*/i, '')
  .replace(/\s*\(#\d+\)\s*$/, '')
  .trim();

let lines = [];
try {
  const range = from ? `${from}..${to}` : `${to}~20..${to}`;
  lines = execSync(`git -C ${ROOT} log --format=%s ${range}`, { encoding: 'utf8' })
    .split('\n').map((s) => s.trim()).filter(Boolean);
} catch (e) {
  console.error('git log 실패:', e.message);
  process.exit(1);
}

const items = lines
  .filter((l) => USER_FACING.test(l))
  .map(clean)
  .filter((t) => t.length > 3)
  // 같은 제목이 여러 커밋에 걸쳐 있으면 한 번만
  .filter((t, i, a) => a.indexOf(t) === i)
  .slice(0, 12)
  .map((title) => ({
    ko: { title, body: '' },   // body 는 사람이 채운다 — 커밋 제목만으로 설명을 지어내지 않는다
    en: { title: '', body: '' },
  }));

if (items.length === 0) {
  console.log('사용자에게 보일 변경(feat/fix/perf)이 없어 초안을 만들지 않습니다.');
  process.exit(3);   // 3 = 만들 것 없음 (배포는 계속된다)
}

const spec = {
  version,
  date: new Date().toISOString().slice(0, 10),
  _draft: true,
  _note: '자동 초안 — 커밋 제목에서 뽑았습니다. 문구를 다듬고 en 을 채운 뒤 --publish 로 발행하세요.',
  items,
};
const target = out || path.join(ROOT, 'docs/release-notes', `v${version}.draft.json`);
fs.writeFileSync(target, JSON.stringify(spec, null, 2) + '\n');
console.log(`초안 ${items.length}건 → ${target}`);
