// 2A 봉합 검증 (red 테스트) — diff-0 이 아니라 **새로 막히는 것**을 확인한다.
//   ① qtask 메뉴 권한: level='none' 인 멤버는 업무를 만들 수 없다 (여태 만들 수 있었다)
//   ② Cue 위임 fail-closed: 위임자 없으면 아무것도 못 만든다 / 위임자가 AI 면 거부(권한 세탁 차단)
//   ③ Cue 가 만든 업무의 책임 주체는 사람 (created_by = 위임자)
//   전량 원복 (권한 row 포함).
require('dotenv').config();
const jwt = require('jsonwebtoken');
const { sequelize } = require('./config/database');
const { Task, BusinessMemberPermission, Business, User, TaskReviewer, Notification, AuditLog } = require('./models');
const { Op } = require('sequelize');
const actions = require('./services/actions/task_actions');

const BASE = 'http://localhost:3003';
const BIZ = 3;
const OWNER = 3;
const MEMBER = 17;
const tok = (uid) => jwt.sign({ userId: uid }, process.env.JWT_SECRET, { expiresIn: '15m' });

let pass = 0, fail = 0;
const madeTasks = [];
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); };

async function api(method, path, userId, body) {
  const r = await fetch(BASE + path, {
    method, headers: { Authorization: `Bearer ${tok(userId)}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
}

(async () => {
  let permRow = null;
  try {
    // ── ① 메뉴 권한 (봉합) ──
    console.log('\n① qtask 메뉴 권한 — level=none 멤버는 업무를 만들 수 없다');
    const before = await api('POST', '/api/tasks', MEMBER, { business_id: BIZ, title: '[red] 권한 있을 때' });
    check('권한 있는 멤버는 생성 200', before.status === 200, `status=${before.status}`);
    if (before.body?.data?.id) madeTasks.push(before.body.data.id);

    permRow = await BusinessMemberPermission.create({
      business_id: BIZ, user_id: MEMBER, menu_key: 'qtask', level: 'none',
    });
    const blocked = await api('POST', '/api/tasks', MEMBER, { business_id: BIZ, title: '[red] 권한 없을 때' });
    check('qtask=none 멤버 → 403 menu_forbidden:qtask',
      blocked.status === 403 && blocked.body?.message === 'menu_forbidden:qtask',
      `status=${blocked.status} msg=${blocked.body?.message}`);

    await permRow.update({ level: 'read' });
    const readOnly = await api('POST', '/api/tasks', MEMBER, { business_id: BIZ, title: '[red] 읽기 전용' });
    check('qtask=read 멤버 → 403 (쓰기 권한 필요)', readOnly.status === 403, `status=${readOnly.status}`);

    await permRow.update({ level: 'write' });
    const restored = await api('POST', '/api/tasks', MEMBER, { business_id: BIZ, title: '[red] 권한 복구 후' });
    check('qtask=write 복구 → 200', restored.status === 200, `status=${restored.status}`);
    if (restored.body?.data?.id) madeTasks.push(restored.body.data.id);

    // owner 는 권한 row 와 무관하게 통과
    const ownerOk = await api('POST', '/api/tasks', OWNER, { business_id: BIZ, title: '[red] owner' });
    check('owner 는 메뉴 권한 무관하게 200', ownerOk.status === 200, `status=${ownerOk.status}`);
    if (ownerOk.body?.data?.id) madeTasks.push(ownerOk.body.data.id);

    // ── ② Cue 위임 fail-closed ──
    console.log('\n② Cue 위임 — 위임자 없이는 아무것도 못 만든다');
    const biz = await Business.findByPk(BIZ, { attributes: ['cue_user_id'] });
    const cueId = biz?.cue_user_id;
    check('워크스페이스에 Cue 계정 존재', !!cueId, `cue_user_id=${cueId}`);

    const noDelegator = await actions.createTask(
      { kind: 'cue', userId: cueId, onBehalfOfUserId: null },
      { businessId: BIZ, title: '[red] 위임자 없는 Cue 생성' },
    );
    check('위임자 없는 Cue → 거부 (cue_delegator_required)',
      !noDelegator.ok && noDelegator.code === 'cue_delegator_required' && noDelegator.http === 403,
      `code=${noDelegator.code}`);

    const aiDelegator = await actions.createTask(
      { kind: 'cue', userId: cueId, onBehalfOfUserId: cueId },   // 위임자가 AI 자신
      { businessId: BIZ, title: '[red] AI→AI 권한 세탁' },
    );
    check('위임자가 AI → 거부 (권한 세탁 차단)',
      !aiDelegator.ok && aiDelegator.code === 'delegator_is_ai',
      `code=${aiDelegator.code}`);

    // ── ③ Cue 가 사람 위임으로 만든 업무 — 책임 주체는 사람 ──
    console.log('\n③ Cue 가 사람 위임으로 만든 업무 — created_by 는 위임자(사람)');
    const byCue = await actions.createTask(
      { kind: 'cue', userId: cueId, onBehalfOfUserId: OWNER },
      { businessId: BIZ, title: '[red] Cue 가 위임받아 만든 업무' },
    );
    check('위임자 있는 Cue → 생성 성공', byCue.ok === true, byCue.ok ? '' : `code=${byCue.code}`);
    if (byCue.ok) {
      madeTasks.push(byCue.data.task.id);
      const t = await Task.findByPk(byCue.data.task.id);
      check('created_by = 위임자(사람)', Number(t.created_by) === OWNER, `created_by=${t.created_by}`);
      check('담당자도 위임자 (assignee 미지정 시)', Number(t.assignee_id) === OWNER, `assignee=${t.assignee_id}`);
      await new Promise((r) => setTimeout(r, 1000));
      const a = await AuditLog.findOne({
        where: { target_type: 'task', target_id: t.id, action: 'task.create' },
        order: [['id', 'DESC']],
      });
      check('감사 로그에 Cue 가 실행했음이 남는다', !!a && a.new_value?.via === 'cue',
        a ? `user_id=${a.user_id} via=${a.new_value?.via}` : '감사 없음');
    }
  } catch (e) {
    fail++; console.error('예외:', e.message, e.stack?.split('\n')[1]);
  } finally {
    if (permRow) await permRow.destroy();
    for (const id of madeTasks) {
      await TaskReviewer.destroy({ where: { task_id: id } });
      await Notification.destroy({ where: { link: { [Op.like]: `%task=${id}` } } });
      await AuditLog.destroy({ where: { target_type: 'task', target_id: id } });
    }
    await Task.destroy({ where: { id: madeTasks.length ? madeTasks : [0] } });
    const left = await Task.count({ where: { id: madeTasks.length ? madeTasks : [0] } });
    const permLeft = await BusinessMemberPermission.count({ where: { business_id: BIZ, user_id: MEMBER, menu_key: 'qtask' } });
    console.log(`\n원복 — 남은 task ${left}건 · 남은 권한 row ${permLeft}건 (둘 다 0이어야 한다)`);
    console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
    await sequelize.close();
    process.exit(fail === 0 && left === 0 && permLeft === 0 ? 0 : 1);
  }
})();
