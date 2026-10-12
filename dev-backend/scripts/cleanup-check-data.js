// [확인용] 시험 데이터 7일 정리 — 개발서버 전용 (2026-10-12, dev-login 계약 ~/dev-server/kit/DEV-LOGIN.md)
//
// 보고 «확인할 곳» 줄이 보여 주는 시험 데이터는 세션이 끝나도 지우지 않는다(Irene 가 나중에 그 화면을 연다).
// 이름이 «[확인용]» 으로 시작하고 7일 지난 것만 여기서 치운다. 부르는 곳은 /개발완료 7단계(백업 뒤) 하나 — 새 cron 을 두지 않는다.
//
// 사용: node scripts/cleanup-check-data.js           # 미리보기(지우지 않음)
//       node scripts/cleanup-check-data.js --apply   # 정리
//
// ★ 운영에서는 돌지 않는다 — NODE_ENV=development ∧ DB 이름이 _dev_db 로 끝날 때만.
// ★ 사람 계정(users)·글 이력(post_revisions)은 건드리지 않는다. 지울 수 없는 행(다른 표가 붙잡음)은 건너뛰고 수를 보고한다.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { sequelize } = require('../config/database');

const APPLY = process.argv.includes('--apply');
const DAYS = 7;
const PREFIX = '[확인용]';

// 표 · 이름 칸 · 방식(soft = deleted_at 찍기 = 앱의 휴지통과 같은 상태 / hard = 행 삭제)
const TARGETS = [
  { table: 'tasks', col: 'title', mode: 'hard' },
  { table: 'calendar_events', col: 'title', mode: 'hard' },
  { table: 'posts', col: 'title', mode: 'soft' },
  { table: 'kb_documents', col: 'title', mode: 'soft' },
  { table: 'businesses', col: 'name', mode: 'soft' },
];

(async () => {
  const db = process.env.DB_NAME || '';
  if (process.env.NODE_ENV !== 'development' || !/_dev_db$/.test(db)) {
    console.error(`[cleanup-check-data] 개발 DB 가 아니라 멈춤 (NODE_ENV=${process.env.NODE_ENV} DB=${db})`);
    process.exit(1);
  }
  let total = 0; let skipped = 0;
  for (const t of TARGETS) {
    const softWhere = t.mode === 'soft' ? ' AND deleted_at IS NULL' : '';
    const [rows] = await sequelize.query(
      `SELECT id FROM \`${t.table}\` WHERE \`${t.col}\` LIKE :p AND created_at < NOW() - INTERVAL ${DAYS} DAY${softWhere}`,
      { replacements: { p: `${PREFIX}%` } },
    );
    if (!rows.length) continue;
    let done = 0;
    if (APPLY) {
      for (const { id } of rows) {
        try {
          if (t.mode === 'soft') await sequelize.query(`UPDATE \`${t.table}\` SET deleted_at = NOW() WHERE id = :id`, { replacements: { id } });
          else await sequelize.query(`DELETE FROM \`${t.table}\` WHERE id = :id`, { replacements: { id } });
          done += 1;
        } catch (e) {
          skipped += 1;
          console.warn(`  건너뜀 ${t.table}#${id}: ${e.parent?.code || e.message}`);
        }
      }
    }
    total += APPLY ? done : rows.length;
    console.log(`${t.table}: ${rows.length}건${APPLY ? ` → ${done}건 ${t.mode === 'soft' ? '휴지통' : '삭제'}` : ' (미리보기)'}`);
  }
  console.log(`[cleanup-check-data] ${APPLY ? '정리' : '대상'} ${total}건${skipped ? ` · 건너뜀 ${skipped}건` : ''} (이름 «${PREFIX}» · ${DAYS}일 지난 것)`);
  await sequelize.close();
})().catch(async (e) => { console.error('[cleanup-check-data]', e.message); try { await sequelize.close(); } catch (_) { /* noop */ } process.exit(1); });
