// 배포별 개발 현황 발행 — docs/dev-status/*.json → dev_status_reports upsert
//
// ★ 위치가 dev-backend/scripts/ 인 이유: 운영에는 git 저장소도 루트 scripts/ 도 없다.
//   배포는 dev-backend/ 만 rsync 로 보낸다. 릴리즈노트 스크립트와 같은 자리다.
//
// 사용:
//   node scripts/publish-dev-status.js <json경로> [--meta '<json>'] [--dry-run]
//
//   --meta 는 배포 스크립트가 이미 알고 있는 사실을 주입한다(사람이 적지 않는다):
//     { commit_to, commit_from, version, deployed_at, backup_dir,
//       closed_feedback_ids:[], kept_open_ids:[], pdf_check, release_note_published, schema_changed }
//
//   키는 commit_to 다. 버전은 며칠씩 안 오르는데 배포는 하루 여러 번 한다 —
//   version 을 키로 잡으면 그날 배포가 1행으로 덮여 이력이 사라진다.
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const SECTION_KEYS = [
  'working_on', 'completed', 'in_progress', 'issues', 'backlog',
  'behavior_changes', 'check_areas', 'migrations', 'blocked_on_human',
  'tooling_health', 'undeployed',
];
const VERIFIED = new Set(['fable_pass', 'opus_only', 'none']);
const SEVERITY = new Set(['low', 'medium', 'high', 'critical']);
const PRIORITY = new Set(['low', 'medium', 'high']);

function die(msg) { console.error(`[dev-status] ${msg}`); process.exit(1); }

// 알 수 없는 값을 조용히 기본값으로 떨어뜨리지 않는다 — 화면이 거짓을 말하게 된다.
// 여기서 막고, 화면은 통과한 값을 그대로 보여준다(CLAUDE.md 상태값 규약).
function validate(sections) {
  const errs = [];
  for (const k of Object.keys(sections)) {
    if (!SECTION_KEYS.includes(k)) errs.push(`알 수 없는 섹션: ${k}`);
    else if (!Array.isArray(sections[k])) errs.push(`${k} 은 배열이어야 합니다`);
  }
  for (const it of sections.completed || []) {
    if (it.verified && !VERIFIED.has(it.verified)) errs.push(`completed.verified 허용값 아님: ${it.verified} (${[...VERIFIED].join('|')})`);
  }
  for (const it of sections.issues || []) {
    if (it.severity && !SEVERITY.has(it.severity)) errs.push(`issues.severity 허용값 아님: ${it.severity}`);
  }
  for (const it of sections.backlog || []) {
    if (it.priority && !PRIORITY.has(it.priority)) errs.push(`backlog.priority 허용값 아님: ${it.priority}`);
  }
  // 본문에 태그가 섞이면 화면에서 텍스트로 보인다(의도). 다만 실수로 HTML 을 붙인 것을 알려준다.
  const flat = JSON.stringify(sections);
  if (/<\s*(script|img|iframe|svg)\b/i.test(flat)) errs.push('본문에 HTML 태그가 있습니다 — 이 화면은 텍스트로만 렌더합니다');
  return errs;
}

(async () => {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  const dry = args.includes('--dry-run');
  const metaRaw = (() => { const i = args.indexOf('--meta'); return i >= 0 ? args[i + 1] : null; })();
  if (!file) die('json 경로가 필요합니다');
  if (!fs.existsSync(file)) die(`파일이 없습니다: ${file}`);

  let doc;
  try { doc = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { die(`json 파싱 실패: ${e.message}`); }

  const meta = metaRaw ? (() => { try { return JSON.parse(metaRaw); } catch (e) { die(`--meta 파싱 실패: ${e.message}`); } })() : {};
  const sections = doc.sections || doc;
  const errs = validate(sections);
  if (errs.length) { errs.forEach((e) => console.error(`  ✗ ${e}`)); die(`검증 실패 ${errs.length}건`); }

  const commit_to = meta.commit_to || doc.commit_to;

  const counts = SECTION_KEYS.map((k) => `${k} ${(sections[k] || []).length}`).join(' · ');
  console.log(`[dev-status] ${commit_to ? String(commit_to).slice(0, 8) : '(커밋 미지정)'} — ${counts}`);
  // ★ --dry-run 은 **내용 검사용**이다. 글을 쓰는 중에는 commit_to 가 없다(커밋 전이라 해시가 없다).
  //   여기서 commit_to 를 요구하면 정작 필요한 때 검사를 못 돌린다.
  if (dry) { console.log('[dev-status] --dry-run: 쓰지 않았습니다'); process.exit(0); }
  if (!commit_to) die('commit_to 가 없습니다 (--meta 또는 json)');

  const { DevStatusReport } = require('../models');
  const payload = {
    commit_to,
    commit_from: meta.commit_from || doc.commit_from || null,
    version: meta.version || doc.version || null,
    deployed_at: meta.deployed_at ? new Date(meta.deployed_at) : new Date(),
    backup_dir: meta.backup_dir || null,
    closed_feedback_ids: meta.closed_feedback_ids || [],
    kept_open_ids: meta.kept_open_ids || [],
    pdf_check: meta.pdf_check || null,
    release_note_published: !!meta.release_note_published,
    schema_changed: !!meta.schema_changed,
    sections,
    author_id: meta.author_id || null,
  };

  // ★ 변경 여부를 JSON.stringify 비교로 판정하지 않는다 — MySQL 이 JSON 키를 재정렬해서
  //   같은 내용도 다르게 보인다(memory feedback_mysql_json_key_reorder). 그냥 덮어쓴다.
  const existing = await DevStatusReport.findOne({ where: { commit_to } });
  if (existing) {
    await existing.update(payload);
    console.log(`[dev-status] 갱신 (id=${existing.id})`);
  } else {
    const row = await DevStatusReport.create(payload);
    console.log(`[dev-status] 생성 (id=${row.id})`);
  }
  process.exit(0);
})().catch((e) => { console.error('[dev-status] 실패:', e.message); process.exit(1); });
