// 자기참조 정기업무 시리즈 정리 (Fable 설계 게이트 2026-08-30 판정 B)
//
// 배경: `recurrence_parent_id = 자기 자신` 인 행이 운영에 4건 있다 (id 168~171, business 6).
//   cron 의 parent 조회는 `recurrence_parent_id IS NULL` 이라 이 행들은 **영영 제외**된다
//   — 반복 규칙을 달고 있지만 회차가 한 번도 생기지 않는 죽은 시리즈다.
//   동시에 회차 통계에서는 인스턴스로 세어져(=recurrence_parent_id NOT NULL) 숫자를 오염시킨다.
//
// ★ 폭주 지뢰 — `recurrence_parent_id` 만 NULL 로 풀면 그 순간 정상 parent 가 되는데,
//   next_occurrence_at 이 과거(2026-07-28)라 캐치업 루프가 **하루 31건씩** 과거 회차를 쏟아낸다.
//   그래서 세 컬럼(recurrence_rule · recurrence_parent_id · next_occurrence_at)을 **동시에** NULL 로
//   내려 일반 업무로 만든다. 제목·상태·담당자·마감일은 건드리지 않는다.
//
// 안전핀:
//   - 기본은 dry-run. `--apply` 를 줘야 쓴다.
//   - `--apply` 는 `--expect=N` 을 요구한다. 대상 수가 N 과 다르면 **거부** (모르는 데이터에 손대지 않는다).
//   - 자식 회차를 가진 행은 대상에서 제외한다 (실제 부모 노릇을 하고 있다면 다른 판단이 필요하다).
//   - apply 전 대상 행 원본을 backups/ 에 JSON 으로 덤프한다.
// 멱등: 조건 자체가 자기참조라 apply 후 재실행하면 0건.
//
// 사용:
//   node scripts/fix-self-referencing-recurrence.js                    # 미리보기
//   node scripts/fix-self-referencing-recurrence.js --apply --expect=4 # 실제 반영

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Op } = require('sequelize');
const { Task } = require('../models');
const { sequelize } = require('../config/database');

const APPLY = process.argv.includes('--apply');
const expectArg = process.argv.find((a) => a.startsWith('--expect='));
const EXPECT = expectArg ? Number(expectArg.split('=')[1]) : null;

const FIELDS = ['id', 'business_id', 'project_id', 'title', 'status', 'due_date',
  'recurrence_rule', 'recurrence_parent_id', 'next_occurrence_at'];

(async () => {
  const [rows] = await sequelize.query(
    `SELECT ${FIELDS.join(', ')} FROM tasks WHERE recurrence_parent_id = id`,
  );

  if (!rows.length) {
    console.log('자기참조 시리즈 0건 — 할 일 없음.');
    process.exit(0);
  }

  // 자식 회차를 가진 행은 제외 — 실제 부모 노릇을 하고 있다면 단순 해제로 끝날 문제가 아니다.
  const ids = rows.map((r) => r.id);
  const childCounts = await Task.findAll({
    where: { recurrence_parent_id: { [Op.in]: ids }, id: { [Op.notIn]: ids } },
    attributes: ['recurrence_parent_id', [sequelize.fn('COUNT', sequelize.col('id')), 'n']],
    group: ['recurrence_parent_id'],
    raw: true,
  });
  const hasChild = new Set(childCounts.map((c) => c.recurrence_parent_id));

  const targets = rows.filter((r) => !hasChild.has(r.id));
  const skipped = rows.filter((r) => hasChild.has(r.id));

  console.log(`자기참조 시리즈 ${rows.length}건 — 대상 ${targets.length}건 / 자식 있어 제외 ${skipped.length}건`);
  for (const r of targets) {
    console.log(`  #${r.id} biz${r.business_id} "${String(r.title).slice(0, 40)}" `
      + `rule=${r.recurrence_rule} next=${r.next_occurrence_at} due=${r.due_date} status=${r.status}`);
  }
  for (const r of skipped) console.log(`  [제외] #${r.id} — 자식 회차 존재`);

  if (!APPLY) {
    console.log('\n미리보기입니다. 반영하려면: --apply --expect=' + targets.length);
    process.exit(0);
  }

  if (EXPECT === null || !Number.isFinite(EXPECT)) {
    console.error('거부 — --apply 는 --expect=N 이 필요합니다.');
    process.exit(1);
  }
  if (EXPECT !== targets.length) {
    console.error(`거부 — 대상 ${targets.length}건 ≠ --expect=${EXPECT}. 데이터가 예상과 다릅니다.`);
    process.exit(1);
  }

  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const dir = path.join(__dirname, '..', '..', 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `self-ref-recurrence-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify(targets, null, 2));
  console.log('백업:', file);

  const [, affected] = await Task.update(
    { recurrence_rule: null, recurrence_parent_id: null, next_occurrence_at: null },
    { where: { id: { [Op.in]: targets.map((r) => r.id) } } },
  );
  console.log('반영 완료 —', affected ?? targets.length, '건');

  const [after] = await sequelize.query('SELECT COUNT(*) n FROM tasks WHERE recurrence_parent_id = id');
  console.log('남은 자기참조:', after[0].n, '(0 이어야 정상)');
  process.exit(0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
