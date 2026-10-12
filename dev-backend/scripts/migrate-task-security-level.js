// 업무 공개 범위·보안등급 — 문서(Q docs)와 같은 두 축. 멱등. 2026-10-12.
//   tasks.vlevel ENUM('L1','L2','L3','L4') NOT NULL DEFAULT 'L3'   — 누가 보나(L1 나만·L2 프로젝트/지정 멤버·L3 워크스페이스·L4 외부)
//   tasks.target_member_ids JSON NULL                              — L2 «특정 멤버» 대상
//   tasks.security_level ENUM('general','internal','confidential') NOT NULL DEFAULT 'general' — 외부 공유 차단 축
//   설계 docs/TASK_SECURITY_LEVEL_DESIGN.md. 기존 행은 L3·general = 지금 보이는 그대로(넓히지도 좁히지도 않는다).
//   재조회로 판정하고 미충족이면 exit 1.
// 롤백: additive 컬럼이라 옛 코드에 무해. **코드만 되돌리고 컬럼은 남긴다**
//   (models/Task.js 선언까지 되돌리면 sync 가 컬럼을 DROP 해 «나만 보기» 업무가 전원에게 다시 보인다).
require('dotenv').config();
const { sequelize } = require('../config/database');
const TAG = '[migrate-task-security-level]';
async function col(name) {
  const [r] = await sequelize.query(`SELECT COLUMN_TYPE t, COLUMN_DEFAULT d, IS_NULLABLE n FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tasks' AND COLUMN_NAME = ?`, { replacements: [name] });
  return r[0] || null;
}
const strip = (d) => String(d).replace(/'/g, '');
(async () => {
  try {
    if (!(await col('vlevel'))) {
      await sequelize.query("ALTER TABLE tasks ADD COLUMN vlevel ENUM('L1','L2','L3','L4') NOT NULL DEFAULT 'L3' AFTER share_expires_at");
      console.log(TAG, 'vlevel 추가');
    } else console.log(TAG, 'vlevel 이미 있음 — skip');
    if (!(await col('target_member_ids'))) {
      await sequelize.query('ALTER TABLE tasks ADD COLUMN target_member_ids JSON NULL AFTER vlevel');
      console.log(TAG, 'target_member_ids 추가');
    } else console.log(TAG, 'target_member_ids 이미 있음 — skip');
    const sec = await col('security_level');
    if (!sec) {
      await sequelize.query("ALTER TABLE tasks ADD COLUMN security_level ENUM('general','internal','confidential') NOT NULL DEFAULT 'general' AFTER target_member_ids");
      console.log(TAG, 'security_level 추가');
    } else if (!/'confidential'/.test(sec.t)) {
      // 개발 서버에만 있던 2값 칸(같은 날 1차 구현) — 끝에 값을 덧붙인다(기존 값 보존).
      await sequelize.query("ALTER TABLE tasks MODIFY COLUMN security_level ENUM('general','internal','confidential') NOT NULL DEFAULT 'general'");
      console.log(TAG, "security_level 에 'confidential' 추가");
    } else console.log(TAG, 'security_level 이미 있음 — skip');

    const v = await col('vlevel'); const tm = await col('target_member_ids'); const s = await col('security_level');
    const ok = v && /'L1'/.test(v.t) && /'L4'/.test(v.t) && v.n === 'NO' && strip(v.d) === 'L3'
      && tm && /json/i.test(tm.t)
      && s && /'confidential'/.test(s.t) && s.n === 'NO' && strip(s.d) === 'general';
    if (!ok) { console.error(TAG, '검증 실패', { v, tm, s }); process.exit(1); }
    console.log(TAG, 'OK', v.t, s.t);
    await sequelize.close(); process.exit(0);
  } catch (e) { console.error(TAG, '실패:', e.message); process.exit(1); }
})();
