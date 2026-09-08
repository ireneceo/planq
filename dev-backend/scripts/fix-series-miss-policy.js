#!/usr/bin/env node
// 반복업무 — 회차에 잘못 저장된 "못 한 회차 정책" 을 시리즈(부모)로 올리고, 지난 회차를 정리한다.
//
// Irene 2026-09-08: *"저장하지 말고 넘기기 설정해도 안바뀌고 있어."* / *"지난 회차 다 정리해줘.
//   오늘부터 남아있으면 돼."*
//
// 왜 필요한가
//   `miss_policy` 는 **시리즈 값**인데(정리 엔진 `recurringTaskGenerator.skipMissedOccurrences`
//   가 부모 것만 읽는다), 화면이 열려 있는 **회차 행**에 저장하고 있었다. 그래서 사용자가
//   고른 auto_skip 이 아무도 안 읽는 자리에 쌓였다.
//   코드는 고쳤지만(services/taskSeriesRecurrence), **이미 회차에 찍힌 의도**는 그대로 남는다.
//   그 의도를 부모로 올리고, 그 시리즈의 지난 미수행 회차를 마감한다.
//
// 안전 규칙
//   · 기본은 **dry-run**. 실제 적용은 `--apply`.
//   · 부모를 바꾸는 것은 **자식 중 auto_skip 이 하나라도 있는 시리즈뿐**이다.
//     (사용자가 그 시리즈를 보면서 명시적으로 고른 값이다 — 없는 의도를 지어내지 않는다.)
//   · 마감 대상은 **오늘보다 이전 + not_started** 뿐이다. 오늘·앞으로의 회차는 건드리지 않는다
//     ("오늘부터 남아있으면 돼"). 진행중·컨펌중·보류·완료는 사람이 손댄 것이라 제외.
//   · 마감은 앱과 **같은 함수**(skipMissedOccurrences)로 한다 — 여기서 따로 지우면 이력·상태
//     전이가 앱과 갈라진다.
//
// 사용:
//   node scripts/fix-series-miss-policy.js              # 미리보기
//   node scripts/fix-series-miss-policy.js --apply      # 실제 적용
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const { Task } = require('../models');
const { skipMissedOccurrences } = require('../services/recurringTaskGenerator');

const APPLY = process.argv.includes('--apply');

async function main() {
  // ① 자식에 auto_skip 이 찍힌 시리즈 찾기
  const kids = await Task.findAll({
    where: { recurrence_parent_id: { [Op.ne]: null }, miss_policy: 'auto_skip' },
    attributes: ['id', 'recurrence_parent_id'],
  });
  const parentIds = [...new Set(kids.map((k) => k.recurrence_parent_id))];
  console.log(`회차에 auto_skip 이 찍힌 행 ${kids.length}건 · 그 시리즈 ${parentIds.length}개`);

  const parents = parentIds.length
    ? await Task.findAll({ where: { id: { [Op.in]: parentIds } } })
    : [];

  let raised = 0;
  for (const p of parents) {
    if (p.miss_policy === 'auto_skip') { console.log(`  = #${p.id} 이미 auto_skip — 그대로`); continue; }
    console.log(`  ${APPLY ? '↑' : '·'} #${p.id} "${String(p.title).slice(0, 30)}" ${p.miss_policy} → auto_skip`);
    if (APPLY) { await p.update({ miss_policy: 'auto_skip' }); raised += 1; }
  }

  // ② 지난 미수행 회차 마감 — 앱과 같은 함수로.
  //    dry-run 에서는 **무엇이 대상인지만** 센다(같은 술어: 오늘 이전 + not_started).
  const today = new Date();
  const todayStr = today.toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
  let closed = 0;
  const targets = APPLY ? parents : [];
  for (const p of targets) {
    await p.reload();
    const ids = await skipMissedOccurrences(p, today, null);
    if (ids.length) console.log(`  ✓ #${p.id} — 지난 미수행 ${ids.length}건 마감: ${ids.join(', ')}`);
    closed += ids.length;
  }
  if (!APPLY) {
    for (const p of parents) {
      const n = await Task.count({
        where: {
          [Op.or]: [{ recurrence_parent_id: p.id }, { id: p.id }],
          status: 'not_started',
          due_date: { [Op.lt]: todayStr },
        },
      });
      if (n) { console.log(`  · #${p.id} — 마감 예정 ${n}건`); closed += n; }
    }
  }

  console.log('');
  console.log(APPLY ? '적용 완료' : 'DRY-RUN (아무것도 바꾸지 않았습니다)');
  console.log(`  시리즈 정책 ${APPLY ? '올림' : '올릴 것'} ${APPLY ? raised : parents.filter((p) => p.miss_policy !== 'auto_skip').length}개`);
  console.log(`  지난 미수행 회차 ${APPLY ? '마감' : '마감 예정'} ${closed}건 (기준일 ${todayStr} — 오늘과 이후는 그대로 둡니다)`);
  if (!APPLY) console.log('\n  실제로 적용하려면 같은 명령에 --apply 를 붙이세요.');
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await sequelize.close().catch(() => {}); });
