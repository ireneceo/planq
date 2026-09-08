#!/usr/bin/env node
// 결과물이 **없는** 회차를 지운다 (2026-09-08).
//
// Irene: *"업무 결과물 버전을 넣어달라니까 내가 수정요청으로 남긴게 버전 1로 들어가 있어.
//   이게 뭐야? 결과물은 담당자가 보고할 때 업무결과 정리할 때만 하는 거잖아."* / *"잘못 들어간 건 지워."*
//
// 왜 생겼나: `submitForReview` 가 본문이 비어 있어도 회차를 박제했다. 그래서 확인 요청에
//   쪽지만 남긴 것이 '결과물 v1' 이 됐다(운영 실측 task#319 — body null, note 만 있음).
//   코드는 고쳤다(결과물이 있을 때만 박제). 이 스크립트는 **이미 남은 것**을 걷는다.
//
// 안전 규칙
//   · 기본 dry-run. `--apply` 로만 지운다.
//   · 대상은 **본문도 첨부도 없는** 회차뿐이다. 첨부만 있는 회차는 결과물이다 — 건드리지 않는다.
//   · 지우기 전에 무엇을 지우는지 전부 출력한다(되돌릴 수 없다).
//   · 회차 번호는 다시 매기지 않는다 — 남은 회차의 번호가 바뀌면 다른 곳의 인용이 어긋난다.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { sequelize } = require('../config/database');
const { TaskDeliverableVersion, Task } = require('../models');

const APPLY = process.argv.includes('--apply');
const plain = (v) => String(v || '').replace(/<[^>]*>/g, '').trim();

async function main() {
  const all = await TaskDeliverableVersion.findAll({
    include: [{ model: Task, attributes: ['id', 'title'], required: false }],
    order: [['id', 'ASC']],
  });
  const empty = all.filter((v) => {
    const hasBody = !!plain(v.body);
    const atts = Array.isArray(v.attachment_ids) ? v.attachment_ids : [];
    return !hasBody && atts.length === 0;
  });

  console.log(`전체 회차 ${all.length}건 · 결과물이 없는 회차 ${empty.length}건`);
  for (const v of empty) {
    console.log(`  ${APPLY ? '✗' : '·'} v${v.round} task#${v.task_id} (${(v.Task && v.Task.title) || '?'}) `
      + `| 제출자 u${v.submitted_by} | note: ${String(v.note || '-').slice(0, 40)}`);
  }
  if (!empty.length) { console.log('\n지울 것이 없습니다.'); return; }

  if (!APPLY) {
    console.log('\n(dry-run — 아무것도 지우지 않았습니다. 실제 삭제는 --apply)');
    return;
  }
  const ids = empty.map((v) => v.id);
  const n = await TaskDeliverableVersion.destroy({ where: { id: ids } });
  console.log(`\n삭제 완료 ${n}건 (남은 회차 ${all.length - n}건)`);
  console.log('회차 번호는 다시 매기지 않았습니다 — 남은 번호가 바뀌면 다른 곳의 인용이 어긋납니다.');
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await sequelize.close().catch(() => {}); });
