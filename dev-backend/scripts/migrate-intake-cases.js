// 접수 양식 → 사건 (2026-11-26, 멱등) — intake_cases 표. 설계 docs/INTAKE_AUTO_CASE_DESIGN.md §6.
//   ★ PM2 reload 전: 새 코드의 응답 목록·[사건 만들기] 가 이 표를 읽는다 — 없으면 그 화면이 500.
//   새 표만(기존 표·행 불변). 롤백은 코드만(표는 남겨도 무해 — 옛 코드는 안 읽는다).
const { sequelize } = require('../config/database');

async function run() {
  const IntakeCase = require('../models/IntakeCase');
  await IntakeCase.sync();   // 없을 때만 만든다(alter 없음)
  const [idx] = await sequelize.query("SHOW INDEX FROM intake_cases WHERE Column_name = 'q_record_row_id' AND Non_unique = 0");
  if (!idx.length) throw new Error('q_record_row_id UNIQUE 가 없다 — 멱등 키 없이 진행하지 않는다');
  console.log('[intake-cases] intake_cases 표 확인 · 행 UNIQUE 있음');
}

run()
  .then(() => process.exit(0))
  .catch((e) => { console.error('[intake-cases] 실패:', e.message); process.exit(1); });
