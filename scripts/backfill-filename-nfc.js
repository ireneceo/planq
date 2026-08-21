#!/usr/bin/env node
// backfill-filename-nfc — 이미 저장된 분해형(NFD) 한글 파일명을 조합형(NFC)으로 통일한다. 운영 #364. 멱등.
//
// 왜 필요한가 (2026-08-21 운영 실측):
//   macOS 는 파일명을 분해형으로 준다 — "스" 가 U+C2A4 한 글자가 아니라 U+1109 + U+1173 두 글자다.
//   눈에는 같은데 바이트가 달라서 **검색이 조용히 실패**한다.
//     사용자가 "스크린샷" 을 치면 → DB LIKE 0건 / 실제로 그 이름인 파일 33건.
//   운영 files 1010건 중 41건이 이 상태였다(전부 맥 스크린샷).
//
//   쓰기측은 services/filename.js 의 decodeOriginalName 이 NFC 로 통일하도록 고쳤다(업로드 5경로 공통).
//   이 스크립트는 **그 전에 이미 쌓인 행**을 정리한다. 쓰기측 수정 없이 이것만 돌리면 같은 결손이 다시 쌓인다.
//
// 사용:
//   node scripts/backfill-filename-nfc.js            # dry-run (무엇이 바뀌는지만 출력)
//   node scripts/backfill-filename-nfc.js --apply    # 실제 반영
//
// 안전:
//   · NFC 로 바꿔도 값이 같은 행은 건드리지 않는다 → 두 번 돌려도 두 번째는 0건(멱등).
//   · 정규화는 표현만 바꾼다. 사람이 읽는 글자는 그대로다.
const APPLY = process.argv.includes('--apply');

const fs = require('fs');
const base = fs.existsSync('/opt/planq/backend/models') ? '/opt/planq/backend' : '/opt/planq/dev-backend';
require(`${base}/node_modules/dotenv`).config({ path: `${base}/.env` });
const { sequelize } = require(`${base}/config/database`);

// 검사 대상 — (테이블, 컬럼). 파일명 외에도 사람이 입력/업로드로 넣는 이름 계열을 같이 훑는다.
const TARGETS = [
  ['files', 'file_name'],
  ['kb_documents', 'title'],
  ['posts', 'title'],
  ['tasks', 'title'],
  ['projects', 'name'],
];

// 조합용 자모(U+1100–U+11FF) 가 하나라도 있으면 분해형이다.
const HAS_JAMO = /[ᄀ-ᇿ]/;

(async () => {
  let totalChanged = 0;
  for (const [table, col] of TARGETS) {
    let rows;
    try {
      [rows] = await sequelize.query(`SELECT id, \`${col}\` AS v FROM \`${table}\` WHERE \`${col}\` IS NOT NULL`);
    } catch (e) {
      console.log(`  ${table}.${col}: 조회 실패 — ${e.message.slice(0, 70)}`);
      continue;
    }
    const targets = rows.filter((r) => {
      const v = String(r.v);
      return HAS_JAMO.test(v) && v.normalize('NFC') !== v;
    });
    console.log(`${table}.${col}: ${rows.length}건 중 정규화 대상 ${targets.length}건`);
    for (const r of targets.slice(0, 5)) {
      console.log(`   #${r.id} ${JSON.stringify(String(r.v).slice(0, 38))} → ${JSON.stringify(String(r.v).normalize('NFC').slice(0, 38))}`);
    }
    if (targets.length > 5) console.log(`   … 외 ${targets.length - 5}건`);
    if (APPLY) {
      for (const r of targets) {
        await sequelize.query(`UPDATE \`${table}\` SET \`${col}\` = :v WHERE id = :id`, {
          replacements: { v: String(r.v).normalize('NFC'), id: r.id },
        });
      }
      if (targets.length) console.log(`   ✅ ${targets.length}건 반영`);
    }
    totalChanged += targets.length;
  }
  console.log(`\n합계 ${totalChanged}건`);
  if (!APPLY) console.log('(dry-run — 실제로 바꾸려면 --apply)');
  process.exit(0);
})().catch((e) => { console.error('[backfill-filename-nfc] 오류:', e.message); process.exit(1); });
