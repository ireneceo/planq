/**
 * backfill-conversation-titles — 프로젝트 rename 이 반영되지 않은 옛 대화방 제목을 정정한다 (#150).
 *
 * 배경: 대화방 제목은 생성 시 프로젝트명을 구워 저장한다("{프로젝트명} 고객"). 그런데 rename 라우트가
 *      대화방을 건드리지 않아, 프로젝트 이름을 바꿔도 채팅방은 옛 이름을 계속 보여줬다.
 *      (운영 실사례: 프로젝트 "기율법률사무소" 인데 대화방은 "PlanQ / 기율법률사무소 고객")
 *      라우트는 고쳤으므로 앞으로는 안 어긋난다. 이 스크립트는 **이미 어긋난 것**만 정정한다.
 *
 * 안전 규칙 — 사용자가 직접 지은 제목은 건드리지 않는다. 아래 둘을 **모두** 만족할 때만 정정:
 *   1) 제목이 자동 생성 접미사로 끝난다 (customer→'고객' / internal→'내부')
 *   2) 제목 안에 현재 프로젝트명이 들어 있다 (= 이름 일부만 바뀐 파생 제목)
 *   이미 "{프로젝트명} {접미사}" 인 것은 건너뛴다 → 몇 번 돌려도 결과가 같다(멱등).
 *
 * 사용: node scripts/backfill-conversation-titles.js           # 미리보기 (변경 없음)
 *       node scripts/backfill-conversation-titles.js --apply   # 실제 반영
 */
const { sequelize } = require('../config/database');
const { Conversation } = require('../models');

const SUFFIX = { customer: '고객', internal: '내부' };

async function main() {
  const apply = process.argv.includes('--apply');

  const [rows] = await sequelize.query(`
    SELECT c.id, c.title, c.channel_type, p.name AS project_name
    FROM conversations c
    JOIN projects p ON p.id = c.project_id
    WHERE c.project_id IS NOT NULL
  `);

  const planned = [];
  for (const r of rows) {
    const suffix = SUFFIX[r.channel_type];
    if (!suffix) continue;                                  // 접미사 규칙이 없는 채널은 대상 아님
    const title = (r.title || '').trim();
    const want = `${r.project_name} ${suffix}`;
    if (!title || title === want) continue;                 // 이미 정상 (멱등)
    if (!title.endsWith(suffix)) continue;                  // 규칙 1 — 사용자가 지은 이름
    if (!title.includes(r.project_name)) continue;          // 규칙 2 — 프로젝트명과 무관한 이름
    planned.push({ id: r.id, from: title, to: want });
  }

  console.log(`프로젝트 연결 대화방 ${rows.length}건 중 정정 대상 ${planned.length}건`);
  for (const p of planned) console.log(`  conv ${p.id}: ${JSON.stringify(p.from)} → ${JSON.stringify(p.to)}`);

  if (!planned.length) { console.log('변경할 것 없음.'); return; }
  if (!apply) { console.log('\n(미리보기 — 반영하려면 --apply)'); return; }

  for (const p of planned) {
    await Conversation.update({ title: p.to }, { where: { id: p.id } });
  }
  console.log(`\n${planned.length}건 반영 완료.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
