// 언어별 메일 서명 — 컬럼 3개 추가 (멱등).
//
// ★ 2026-09-18 (Irene: "이메일이 영어일 때랑 한글내용일 때 서명이 따로 붙어야 하는데 다 한글 기본서명이 가네")
//   기존 `signature_html` 계열은 **건드리지 않는다** — 비워두면 그대로 기본 서명을 쓰므로
//   이 마이그레이션만으로는 **어떤 메일의 서명도 바뀌지 않는다.**
//
// 사용: node scripts/migrate-signature-lang.js [--apply]
//   ★ `--apply` 가 없으면 **dry-run** 이다(이 슬롯의 다른 스크립트들과 다르다).
//   운영은 **코드 배포 전에** 실행한다 — 컬럼이 없으면 `EmailAccount.findOne` 이 전 컬럼을
//   SELECT 하다 ER_BAD_FIELD 로 **Q mail 전 라우트가 500** 이 되고, 워크스페이스 컬럼은
//   try/catch 안이라 **500 도 없이 팀 공통 서명이 조용히 사라진다.**
//   `scripts/deploy-planq.sh` 의 sync_database 멱등 슬롯(PM2 reload 앞)에서 자동 실행된다.
//
// ★ 롤백: **코드만 되돌리고 컬럼은 남긴다.** 모델 선언까지 되돌리면 다음 배포의
//   sync-database(Sequelize alter)가 **모델에 없는 컬럼을 DROP** 해 저장된 영문 서명이 파괴된다.
require('dotenv').config();
const { sequelize } = require('../config/database');

const COLS = [
  ['email_accounts', 'signature_html_en', 'signature_html'],
  ['email_account_aliases', 'signature_html_en', 'signature_html'],
  ['businesses', 'mail_signature_html_en', 'mail_signature_html'],
];

(async () => {
  const apply = process.argv.includes('--apply');
  let added = 0, skipped = 0;
  for (const [table, col, after] of COLS) {
    const [[row]] = await sequelize.query(
      `SELECT COUNT(*) n FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      { replacements: [table, col] });
    if (Number(row.n) > 0) { console.log(`  = ${table}.${col} 이미 있음`); skipped++; continue; }
    console.log(`  + ${table}.${col} 추가${apply ? '' : ' (dry-run)'}`);
    if (apply) {
      await sequelize.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${col}\` TEXT NULL AFTER \`${after}\``);
    }
    added++;
  }
  console.log(`\n추가 ${added} · 건너뜀 ${skipped}${apply ? '' : ' — --apply 를 붙여야 실제로 바뀝니다'}`);
  await sequelize.close();
  process.exit(0);
})().catch((e) => { console.error('실패:', e.message); process.exit(1); });
