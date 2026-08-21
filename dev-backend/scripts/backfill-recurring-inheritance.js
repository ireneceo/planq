// 정기업무 회차 상속 백필 (피드백 #348 ⑤)
//
// 배경: services/recurringTaskGenerator.js 가 회차를 만들 때 parent 의 workstream_id(업무그룹)와
//       태그를 복사하지 않아, 이미 생성된 회차가 전부 미분류로 남아 있다
//       (운영 실측 2026-08-20: 반복 인스턴스 28건 전부 workstream NULL).
//       쓰기측(generator)은 같은 사이클에서 고쳤다 — 이 스크립트는 그 이전에 쌓인 행만 채운다.
//
// 멱등: 이미 채워진 행은 건드리지 않는다. 여러 번 실행해도 2회차부터 변경 0건.
// 비파괴: 값을 **채우기만** 한다. 회차에 이미 값이 있으면(사용자가 직접 옮겼을 수 있다) 그대로 둔다.
//         태그도 없는 링크만 추가하고 지우지 않는다.
// start_date 는 백필하지 않는다 — 과거 회차의 날짜를 소급 변경하는 것은 별개 판단이 필요하다.
//
// 사용:
//   node scripts/backfill-recurring-inheritance.js            # 미리보기 (변경 없음)
//   node scripts/backfill-recurring-inheritance.js --apply    # 실제 반영

require('dotenv').config();
const { Op } = require('sequelize');
const { Task, TaskTagLink } = require('../models');

const APPLY = process.argv.includes('--apply');

(async () => {
  const stats = { parents: 0, ws_filled: 0, tag_links_added: 0, instances_scanned: 0 };

  // 시리즈 parent — workstream 또는 태그를 가진 것만 대상
  const parents = await Task.findAll({
    where: { recurrence_rule: { [Op.ne]: null }, recurrence_parent_id: null },
    attributes: ['id', 'business_id', 'title', 'workstream_id'],
  });

  for (const parent of parents) {
    const parentTagLinks = await TaskTagLink.findAll({
      where: { task_id: parent.id }, attributes: ['tag_id'],
    });
    const parentTagIds = parentTagLinks.map((t) => t.tag_id);

    if (!parent.workstream_id && parentTagIds.length === 0) continue;
    stats.parents += 1;

    const instances = await Task.findAll({
      where: { recurrence_parent_id: parent.id, id: { [Op.ne]: parent.id } },
      attributes: ['id', 'workstream_id'],
    });
    stats.instances_scanned += instances.length;
    if (!instances.length) continue;

    // 1) workstream_id — 비어 있는 회차만 채운다
    if (parent.workstream_id) {
      const targets = instances.filter((t) => !t.workstream_id).map((t) => t.id);
      if (targets.length) {
        if (APPLY) {
          await Task.update({ workstream_id: parent.workstream_id }, { where: { id: { [Op.in]: targets } } });
        }
        stats.ws_filled += targets.length;
        console.log(`  parent #${parent.id} "${parent.title}" → workstream ${parent.workstream_id} · 회차 ${targets.length}건`);
      }
    }

    // 2) 태그 — 없는 링크만 추가
    if (parentTagIds.length) {
      const instIds = instances.map((t) => t.id);
      const existing = await TaskTagLink.findAll({
        where: { task_id: { [Op.in]: instIds } }, attributes: ['task_id', 'tag_id'],
      });
      const have = new Set(existing.map((l) => `${l.task_id}:${l.tag_id}`));
      const rows = [];
      for (const id of instIds) {
        for (const tagId of parentTagIds) {
          if (!have.has(`${id}:${tagId}`)) rows.push({ task_id: id, tag_id: tagId });
        }
      }
      if (rows.length) {
        if (APPLY) await TaskTagLink.bulkCreate(rows, { ignoreDuplicates: true });
        stats.tag_links_added += rows.length;
        console.log(`  parent #${parent.id} → 태그 링크 ${rows.length}건`);
      }
    }
  }

  console.log('\n=== 백필 %s ===', APPLY ? '반영' : '미리보기 (--apply 로 실제 반영)');
  console.log('대상 시리즈:', stats.parents, '/ 스캔한 회차:', stats.instances_scanned);
  console.log('workstream 채움:', stats.ws_filled, '건');
  console.log('태그 링크 추가:', stats.tag_links_added, '건');
  process.exit(0);
})().catch((e) => { console.error('backfill failed', e); process.exit(1); });
