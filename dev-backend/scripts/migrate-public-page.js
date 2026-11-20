#!/usr/bin/env node
// 공개 페이지 P3 — 공개 주소(/w/)·회사 찾기(/directory)를 위한 운영 ALTER. 멱등(2회차 no-op).
//
//   설계: docs/WORKSPACE_PUBLIC_PAGE_DESIGN.md §3 · §4 · §6 · §10 P3 (Irene «권고대로»)
//
// ★ **코드 배포 전에** 돌린다 — 모델이 이 칸들을 SELECT 하므로 없으면 워크스페이스 조회 전체가 500.
// ★ 넓히는 변경뿐이다: 새 칸(NULL 또는 기본값 'off')·ENUM 끝 append. 기존 행 값은 한 줄도 바뀌지 않는다
//   (모든 워크스페이스는 'off' — 공개를 켜기 전과 오늘이 같다).
// ★ sync-database.js 에 맡기지 않는다(모델에 없는 컬럼 DROP · ENUM 64키 전례).
//
// 사용:  node scripts/migrate-public-page.js         (적용)
//        node scripts/migrate-public-page.js --dry   (무엇을 할지만 출력)
require('dotenv').config();
const { sequelize } = require('../config/database');

const DRY = process.argv.includes('--dry');
const log = (...a) => console.log('[public-page]', ...a);

async function hasCol(table, col) {
  const [rows] = await sequelize.query(`SHOW COLUMNS FROM ${table} WHERE Field = ?`, { replacements: [col] });
  return rows[0] || null;
}
async function hasIndex(table, name) {
  const [rows] = await sequelize.query(`SHOW INDEX FROM ${table} WHERE Key_name = ?`, { replacements: [name] });
  return rows.length > 0;
}

(async () => {
  try {
    const steps = [];
    const bizCols = [
      ['public_page_status', "ENUM('off','pending','public','blocked') NOT NULL DEFAULT 'off'"],
      ['public_category', 'VARCHAR(32) NULL'],
      ['public_region', 'VARCHAR(32) NULL'],
      ['public_published_at', 'DATETIME NULL'],
      ['public_block_reason', 'VARCHAR(255) NULL'],
    ];
    for (const [c, def] of bizCols) {
      if (!(await hasCol('businesses', c))) steps.push(`ALTER TABLE businesses ADD COLUMN ${c} ${def}`);
    }
    if (!(await hasIndex('businesses', 'businesses_public_status_cat'))) {
      steps.push('CREATE INDEX businesses_public_status_cat ON businesses (public_page_status, public_category)');
    }
    // 전체 끄기 스위치 — 사고 때 모든 /w/·디렉터리·공개 문의 API 를 한 번에 404 로. 기본 열림(승인제라 승인 전엔 아무것도 안 나간다)
    if (!(await hasCol('platform_settings', 'public_pages_enabled'))) {
      steps.push('ALTER TABLE platform_settings ADD COLUMN public_pages_enabled TINYINT(1) NOT NULL DEFAULT 1');
    }
    // 신고 — contact_inquiries.kind 끝에 'report' (PlanQ 운영팀으로 가는 원장)
    const kind = await hasCol('contact_inquiries', 'kind');
    if (kind && !/'report'/.test(String(kind.Type))) {
      steps.push("ALTER TABLE contact_inquiries MODIFY COLUMN kind ENUM('enterprise','general','landing','diagnosis','onboarding_call','report') NOT NULL DEFAULT 'general'");
    }
    if (!steps.length) { log('할 일 없음 (이미 적용됨)'); process.exit(0); }
    for (const sql of steps) {
      log(DRY ? '할 것:' : '적용:', sql);
      if (!DRY) await sequelize.query(sql);
    }
    log(DRY ? `${steps.length}건 (dry)` : `${steps.length}건 적용 ✓`);
    process.exit(0);
  } catch (e) {
    console.error('[public-page] 실패:', e.message);
    process.exit(1);
  }
})();
