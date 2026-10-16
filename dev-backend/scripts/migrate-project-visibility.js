// 멤버 프로젝트 가시성 — projects.visibility ENUM('members','workspace') NOT NULL DEFAULT 'members'. 멱등. 2026-10-16.
//   설계 docs/MEMBER_PROJECT_SCOPE_DESIGN.md (Fable). Irene: «관리자 아닌데 모든 프로젝트가 나오고 있어».
//
// 기존 행은 'members'(권고) — 멤버는 참여한 프로젝트만 본다. 옛 동작(모두 보기)으로 남기려면 --existing=workspace.
//   ★ 처음 컬럼을 만들 때만 기존 행 값을 정한다(두 번째 실행은 아무것도 바꾸지 않는다).
// 출력: 이 값으로 «멤버에게서 숨겨지는 (멤버, 프로젝트) 쌍» 수 — 배포 보고에 적는다.
// 롤백: 코드만 되돌리면 옛 동작(열린 문화)이다. 컬럼은 남긴다(모델 선언까지 되돌리면 sync 가 DROP 해 설정이 사라진다).
require('dotenv').config();
const { sequelize } = require('../config/database');

const existingArg = (process.argv.find((a) => a.startsWith('--existing=')) || '').split('=')[1] || 'members';
if (!['members', 'workspace'].includes(existingArg)) { console.error('[migrate-project-visibility] --existing=members|workspace'); process.exit(1); }

async function has() {
  const [rows] = await sequelize.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'projects' AND COLUMN_NAME = 'visibility'`);
  return rows.length > 0;
}

(async () => {
  try {
    if (!(await has())) {
      await sequelize.query("ALTER TABLE projects ADD COLUMN visibility ENUM('members','workspace') NOT NULL DEFAULT 'members'");
      if (existingArg === 'workspace') await sequelize.query("UPDATE projects SET visibility = 'workspace'");
      console.log(`[migrate-project-visibility] projects.visibility 추가 · 기존 행 = ${existingArg}`);
    } else {
      console.log('[migrate-project-visibility] projects.visibility 이미 있음 — skip');
    }
    if (!(await has())) { console.error('[migrate-project-visibility] 검증 실패 — 컬럼 없음'); process.exit(1); }
    // 숨겨지는 쌍: role=member 인 멤버 × 그 워크스페이스의 members 프로젝트 중 project_members 에 없는 것
    const [[hidden]] = await sequelize.query(`
      SELECT COUNT(*) AS pairs, COUNT(DISTINCT bm.user_id) AS members, COUNT(DISTINCT p.id) AS projects
        FROM business_members bm
        JOIN projects p ON p.business_id = bm.business_id AND p.visibility = 'members'
        LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = bm.user_id
       WHERE bm.user_id IS NOT NULL AND bm.removed_at IS NULL AND bm.role = 'member' AND pm.id IS NULL`);
    console.log(`[migrate-project-visibility] 멤버에게서 숨겨지는 쌍 ${hidden.pairs} (멤버 ${hidden.members}명 · 프로젝트 ${hidden.projects}개)`);
    console.log('[migrate-project-visibility] OK');
    await sequelize.close();
    process.exit(0);
  } catch (e) {
    console.error('[migrate-project-visibility] 실패:', e.message);
    process.exit(1);
  }
})();
