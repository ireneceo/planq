#!/usr/bin/env node
// 기존 파일 본문 색인 백필 — Cue 가 **예전에 올린 파일도** 내용으로 찾게 한다.
//
//   기본은 dry-run. 실제로 넣으려면 --apply.
//   임베딩 비용이 나가는 작업이라 한 번에 몇 건을 처리할지 --limit 로 정하고,
//   호출 사이에 간격을 둔다(외부 API rate limit + 다른 요청 지연 방지).
//
//   사용:
//     node scripts/backfill-file-index.js --business 5                # 미리보기
//     node scripts/backfill-file-index.js --business 5 --apply --limit 50
//
//   ★ 운영에서는 `dev-backend/scripts/` 아래 경로로 돈다(rsync 는 dev-backend 만 보낸다).
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { sequelize } = require('../config/database');
const { File } = require('../models');
const fileIndex = require('../services/fileIndex');

const argv = process.argv.slice(2);
const flag = (name, def = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true) : def;
};
const APPLY = argv.includes('--apply');
const BUSINESS = flag('business') ? Number(flag('business')) : null;
const LIMIT = Number(flag('limit', 200));
const GAP_MS = Number(flag('gap', 250));

async function main() {
  const where = { deleted_at: null };
  if (BUSINESS) where.business_id = BUSINESS;
  const files = await File.findAll({ where, order: [['created_at', 'DESC']] });

  const buckets = new Map();   // reason → count
  const todo = [];
  for (const f of files) {
    const can = fileIndex.indexability(f);
    const key = can.ok ? 'indexable' : can.reason;
    buckets.set(key, (buckets.get(key) || 0) + 1);
    if (!can.ok) continue;
    // 이미 색인된 것은 건너뛴다 — 물리 파일은 불변이라 다시 뽑을 이유가 없다.
    const existing = await fileIndex.findDocFor(f.id, f.business_id);
    if (existing) { buckets.set('already', (buckets.get('already') || 0) + 1); continue; }
    todo.push(f);
  }

  console.log('── 대상 집계 ──');
  for (const [k, v] of [...buckets.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`);
  console.log(`\n색인할 것: ${todo.length}건 (이번 실행 상한 ${LIMIT})`);

  if (!APPLY) {
    console.log('\n(dry-run — 아무것도 쓰지 않았습니다. 실제 실행은 --apply)');
    todo.slice(0, 15).forEach((f) => console.log(`  · #${f.id} ${f.file_name} (${f.mime_type}, ${f.storage_provider})`));
    return;
  }

  let ok = 0; let skip = 0;
  for (const f of todo.slice(0, LIMIT)) {
    const r = await fileIndex.indexFile(f.id);
    if (r.indexed) { ok += 1; console.log(`  ✅ #${f.id} ${f.file_name} → doc ${r.doc_id} (${r.reason})`); }
    else { skip += 1; console.log(`  ⏭  #${f.id} ${f.file_name} — ${r.reason}`); }
    await new Promise((res) => setTimeout(res, GAP_MS));
  }
  console.log(`\n완료: 색인 ${ok} · 건너뜀 ${skip} · 남은 대상 ${Math.max(0, todo.length - LIMIT)}`);
  console.log('임베딩은 백그라운드로 이어집니다 — kb_chunks 가 채워지는 데 몇 분 더 걸립니다.');
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await sequelize.close().catch(() => {}); });
