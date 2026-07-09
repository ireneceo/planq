// scripts/e2e/canary-l1.js — L1(개인) 파일 누출 카나리. c57d672 회귀 감시.
//   회귀 실사례: fileListWhereByLevel 이 legacy visibility 를 독립 OR 로 섞어 vlevel='L1'+옛 visibility='L3'
//   개인파일이 전 멤버에게 노출됐다. 이 스위트는 그 정확한 함수를 실제 scope + 실제 DB 쿼리로 검증한다.
//   HTTP/토큰 불필요 — access_scope 헬퍼(생명선)를 직접 겨냥. INSPECTION_PLAYBOOK §5.
//   ★ 테스트 데이터 try/finally 원복 필수 (feedback_test_data_restore).
require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env' });
const { Op } = require('/opt/planq/dev-backend/node_modules/sequelize');
const m = require('/opt/planq/dev-backend/models');
const { getUserScope, fileListWhereByLevel } = require('/opt/planq/dev-backend/middleware/access_scope');

const BIZ = 5;
const EMAIL = 'health-check@planq.kr';       // 공격자 B (같은 워크스페이스 멤버)
const MARK = 'CANARY_L1_20260709';           // 고정 마커 (Date.now 금지 환경 — 크롤 재실행 시 잔존행은 아래 pre-clean 이 제거)

// 시드 파일 스펙: [설명, uploaderKey('A'|'B'), vlevel, visibility, 기대(B가 봐야 하나)]
const SPECS = [
  ['A의 순수 L1',            'A', 'L1', null, false],   // 타인 개인 → B 안 보임
  ['A의 L1+legacy visL3 트랩', 'A', 'L1', 'L3', false],  // ★ c57d672 회귀 지점 — 절대 누출 금지
  ['A의 L3(대조군)',          'A', 'L3', null, true],    // 워크스페이스 공용 → B 보임 (과잉차단 회귀 감시)
  ['B의 본인 L1',            'B', 'L1', null, true],    // 본인 개인 → B 본인은 보임
];

async function seedFile(uploaderId, vlevel, visibility, idx) {
  return m.File.create({
    business_id: BIZ,
    uploader_id: uploaderId,
    file_name: `${MARK}_${idx}.txt`,
    file_path: `/canary/${MARK}_${idx}.txt`,
    file_size: 12,
    mime_type: 'text/plain',
    vlevel,
    visibility,
  });
}

async function run() {
  const results = [];
  const userB = await m.User.findOne({ where: { email: EMAIL } });
  if (!userB) return [{ route: 'canary-l1', error: `공격자 계정(${EMAIL}) 없음` }];
  const userA = await m.User.findOne({ where: { id: { [Op.ne]: userB.id } }, order: [['id', 'ASC']] });
  if (!userA) return [{ route: 'canary-l1', error: 'A(타 사용자) 없음 — 단일 사용자 DB' }];

  // pre-clean: 이전 실패 잔존 카나리 행 물리 제거 (paranoid=false)
  await m.File.destroy({ where: { file_name: { [Op.like]: `${MARK}%` } }, force: true });

  const seeded = [];
  try {
    for (let i = 0; i < SPECS.length; i++) {
      const [, key, vlevel, vis] = SPECS[i];
      const uid = key === 'A' ? userA.id : userB.id;
      seeded.push({ spec: SPECS[i], row: await seedFile(uid, vlevel, vis, i) });
    }
    // B 의 실제 scope 로 파일 리스트 where 구성 → 카나리 행만 조회
    const scopeB = await getUserScope(userB.id, BIZ);
    const where = fileListWhereByLevel(scopeB);
    const visibleRows = await m.File.findAll({
      where: { [Op.and]: [where, { file_name: { [Op.like]: `${MARK}%` } }] },
      attributes: ['id', 'file_name', 'vlevel', 'visibility', 'uploader_id'],
    });
    const visibleIds = new Set(visibleRows.map((r) => r.id));

    for (const s of seeded) {
      const [desc, , , , expectVisible] = s.spec;
      const actualVisible = visibleIds.has(s.row.id);
      const leak = actualVisible && !expectVisible;      // 봐선 안 되는데 보임 = 누출(치명)
      const overblock = !actualVisible && expectVisible; // 봐야 하는데 안 보임 = 과잉차단(회귀)
      results.push({
        route: desc,
        leaked: leak,
        overblock,
        detail: `기대 ${expectVisible ? '보임' : '숨김'} · 실제 ${actualVisible ? '보임' : '숨김'}` + (leak ? ' ← ❌ 누출' : overblock ? ' ← ⚠️ 과잉차단' : ''),
      });
    }
  } finally {
    // ★ 원복 — 시드 물리 삭제
    await m.File.destroy({ where: { file_name: { [Op.like]: `${MARK}%` } }, force: true }).catch(() => {});
  }
  return results;
}

module.exports = { run, name: 'canary-l1' };

if (require.main === module) {
  run().then((res) => {
    let bad = 0;
    console.log('\n=== L1 개인파일 누출 카나리 (fileListWhereByLevel 직접 검증) ===\n');
    for (const r of res) {
      if (r.error) { console.log(`⚠️ ${r.route} — ${r.error}`); bad++; continue; }
      const status = r.leaked ? '❌ 누출' : (r.overblock ? '⚠️ 과잉차단' : '✅');
      console.log(`${status}  ${r.route} — ${r.detail}`);
      if (r.leaked || r.overblock) bad++;
    }
    console.log(`\n총 문제: ${bad}`);
    process.exit(bad > 0 ? 1 : 0);
  }).catch((e) => { console.error('FATAL', e.message); process.exit(2); });
}
