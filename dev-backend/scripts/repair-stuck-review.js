#!/usr/bin/env node
// 확인 요청(reviewing) 인데 **컨펌자가 아무도 pending 이 아닌** 업무를 되살린다.
//
// Irene 2026-09-08: *"확인요청 받음 상태인데 왜 수정요청 보내는 란이 안나와?"*
//   *"확인필요에도 상태가 왜 대기야?"*
//
// 어떻게 이렇게 됐나
//   담당자가 **상태 드롭다운**으로 reviewing 을 고르면 여태 status 컬럼만 바뀌고
//   새 라운드의 부수효과(컨펌자 state 리셋 · review_round +1 · `review_submit` 이력)가 빠졌다.
//   그래서 컨펌자 행에는 **지난 라운드의 결정**(revision/approved)이 그대로 남는다:
//     · 컨펌자 화면 → "이미 결정함"(수정요청 칸 없음)
//     · 담당자 화면 → reviewing 이라 본문 잠김
//     · 확인 필요   → '내가 컨펌자(pending)' 수집기가 못 잡아 '보낸 업무요청' 버킷의 **대기** 로 뜬다
//   = 양쪽 다 아무것도 못 하는 상태. (코드는 routes/tasks.js 에서 고쳤다 — 이건 이미 갇힌 행 복구다)
//
// 안전 규칙
//   · 기본 dry-run. `--apply` 로만 적용.
//   · 대상은 **status='reviewing' 인데 pending 컨펌자가 0명** 인 업무뿐이다.
//     (정상 진행 중인 라운드는 pending 이 하나라도 있다 — 건드리지 않는다.)
//   · 컨펌자가 아예 없는 업무는 제외 — 그건 다른 문제고, 여기서 라운드를 열면 안 된다.
//   · 이력을 남긴다. 조용히 고치면 사용자에게는 "왜 갑자기 바뀌었지" 가 된다.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const { Task, TaskReviewer, TaskStatusHistory } = require('../models');

const APPLY = process.argv.includes('--apply');

async function main() {
  const reviewing = await Task.findAll({
    where: { status: 'reviewing' },
    attributes: ['id', 'business_id', 'title', 'review_round', 'assignee_id'],
  });
  const stuck = [];
  for (const t of reviewing) {
    const revs = await TaskReviewer.findAll({ where: { task_id: t.id }, attributes: ['id', 'user_id', 'state'] });
    if (revs.length === 0) continue;                              // 컨펌자 없음 — 다른 문제
    if (revs.some((r) => r.state === 'pending')) continue;        // 정상 진행 중
    stuck.push({ t, revs });
  }

  console.log(`확인 요청 중인 업무 ${reviewing.length}건 · 그중 **갇힌 것** ${stuck.length}건`);
  for (const { t, revs } of stuck) {
    console.log(`  ${APPLY ? '↻' : '·'} #${t.id} "${String(t.title).slice(0, 34)}" round=${t.review_round} `
      + `컨펌자=[${revs.map((r) => `u${r.user_id}:${r.state}`).join(', ')}]`);
  }

  if (!APPLY) {
    console.log('\n(dry-run — 아무것도 바꾸지 않았습니다. 실제 적용은 --apply)');
    return;
  }

  let fixed = 0;
  for (const { t } of stuck) {
    const tx = await sequelize.transaction();
    try {
      await TaskReviewer.update(
        { state: 'pending', reverted_once: false, action_at: null },
        { where: { task_id: t.id }, transaction: tx },
      );
      const nextRound = (t.review_round || 0) + 1;
      await Task.update({ review_round: nextRound }, { where: { id: t.id }, transaction: tx });
      // ★ 이력은 **있었던 일 그대로** 적는다. `review_submit` 으로 적으면 담당자가 그때
      //   제출한 것처럼 보여 원장이 거짓말을 한다 — 실제로 일어난 일은 우리가 한 복구다.
      //   화면의 상태 라벨 분기는 `status_change` 만 읽으므로 새 사건 종류를 만들지도 않는다.
      await TaskStatusHistory.create({
        task_id: t.id,
        event_type: 'status_change',
        from_status: 'reviewing',
        to_status: 'reviewing',
        actor_user_id: null,
        round: nextRound,
        note: '갇힌 컨펌 라운드 복구 — 상태 드롭다운으로 확인 요청되어 지난 라운드의 컨펌 결정이 남아 있었다',
      }, { transaction: tx });
      await tx.commit();
      fixed += 1;
      console.log(`  ✓ #${t.id} — 컨펌자 pending 리셋 · round ${t.review_round} → ${nextRound}`);
    } catch (e) {
      await tx.rollback();
      console.warn(`  ✗ #${t.id} — ${e.message}`);
    }
  }
  console.log(`\n복구 완료 ${fixed}건 / 대상 ${stuck.length}건`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await sequelize.close().catch(() => {}); });
