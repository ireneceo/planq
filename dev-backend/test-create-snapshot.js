// 생성 계열 (D-3 2A) — 동작 스냅샷. 리팩터 전/후 diff 기준.
//
//   생성은 **부수효과가 본체**다. 응답만 비교하면 회귀가 숨는다 →
//   HTTP 응답 + DB 동반 row(reviewer·estimation·audit) + socket 이벤트 + 알림 건수를 함께 박제한다.
//
//     node test-create-snapshot.js before
//     node test-create-snapshot.js after     # 재생 + diff
//
//   Fable 설계(§5)가 지정한 예상 diff(사전 선언):
//     ① task.create 감사 로그 신설 (옛: 0건)
//     ② POST /tasks 의 notify 시그니처 통일 (actorUserId·entityType 추가 → 자기 토스트 억제)
//     ③ qtask 메뉴 권한 게이트 신설 (none/read 멤버 403)
//   그 외 diff 0 이어야 한다.
require('dotenv').config();
const fs = require('fs');
const jwt = require('jsonwebtoken');
const { Op } = require('sequelize');
const { sequelize } = require('./config/database');
const {
  Task, TaskReviewer, TaskComment, TaskCandidate, TaskEstimation,
  Notification, AuditLog, Conversation,
} = require('./models');
const { io: ioClient } = require('/opt/planq/dev-frontend/node_modules/socket.io-client');

const BASE = 'http://localhost:3003';
const BIZ = 3;
const OWNER = 3;      // 김미정 (owner)
const MEMBER = 17;    // 박개발 (member)
const OTHER_BIZ_USER = 5;  // 다른 워크스페이스 사용자 (cannot_assign 유발)
const SNAP = '/tmp/claude-1000/-opt-planq/4188eb8a-451f-439e-9f7b-a80c5dcbde8a/scratchpad';

const mode = process.argv[2] === 'after' ? 'after' : 'before';
const tok = (uid) => jwt.sign({ userId: uid }, process.env.JWT_SECRET, { expiresIn: '15m' });

const log = [];
const created = { tasks: [], candidates: [], comments: [] };
const socketEvents = [];

function norm(v) {
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z?$/.test(v)) return '<ts>';
  return v;
}
// id 는 실행마다 달라진다 — "무엇이" 같아야지 "몇 번" 이 같을 필요는 없다
const KEY_SKIP = new Set(['id']);

async function api(method, path, userId, body) {
  const r = await fetch(BASE + path, {
    method,
    headers: { Authorization: `Bearer ${tok(userId)}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
}

function step(name, res, keys = []) {
  const d = res.body?.data;
  const rec = { step: name, status: res.status, ok: res.body?.success ?? null };
  if (res.status >= 400) rec.message = res.body?.message;
  for (const k of keys) {
    const v = norm(k.split('.').reduce((o, p) => (o == null ? o : o[p]), d));
    rec[k] = KEY_SKIP.has(k) ? (v ? '<id>' : v) : v;
  }
  log.push(rec);
  console.log(`  ${String(res.status).padEnd(3)} ${name}${res.status >= 400 ? ' — ' + (res.body?.message || '') : ''}`);
  return d;
}

async function taskSideEffects(taskId, label) {
  await new Promise((r) => setTimeout(r, 800));   // afterCommit·setImmediate 부수효과 착지 대기
  const [revs, ests, notifs, audits] = await Promise.all([
    TaskReviewer.findAll({ where: { task_id: taskId } }),
    TaskEstimation.findAll({ where: { task_id: taskId } }),
    Notification.count({ where: { link: { [Op.like]: `%task=${taskId}` } } }),
    AuditLog.count({ where: { target_type: 'task', target_id: taskId, action: { [Op.like]: 'task.create%' } } }),
  ]);
  const rec = {
    step: `부수효과 — ${label}`,
    reviewers: revs.map((r) => ({ user: r.user_id, is_client: !!r.is_client })),
    estimations: ests.map((e) => ({ source: e.source, hasValue: Number(e.value) > 0 })),
    notifications: notifs,
    audit_create: audits,
  };
  log.push(rec);
  console.log(`      부수효과 ${label}: reviewer ${rec.reviewers.length} · 예측 ${rec.estimations.length} · 알림 ${notifs} · 감사 ${audits}`);
}

(async () => {
  console.log(`\n═══ 생성 계열 스냅샷 (${mode}) ═══\n`);

  // socket 채집 — business room (task:new · inbox:refresh 계약 검증)
  const sock = ioClient(BASE, { auth: { token: tok(OWNER) }, transports: ['websocket'] });
  await new Promise((r) => { sock.on('connect', r); setTimeout(r, 3000); });
  sock.emit('join:business', BIZ);
  for (const ev of ['task:new', 'comment:new', 'inbox:refresh']) {
    sock.on(ev, (p) => socketEvents.push({ ev, task: p?.id || p?.task_id || null, reason: p?.reason }));
  }

  try {
    // ── ① POST /tasks ────────────────────────────────
    console.log('① POST /api/tasks');
    const own = step('본인 업무 (담당=생성자)', await api('POST', '/api/tasks', OWNER, {
      business_id: BIZ, title: '[스냅샷] 본인 업무 문서 작성',
    }), ['id', 'status', 'source', 'request_by_user_id', 'assignee_id']);
    if (own?.id) { created.tasks.push(own.id); await taskSideEffects(own.id, '본인 업무'); }

    const req1 = step('내부 요청 (담당≠생성자, estimated_hours 는 sanitize)', await api('POST', '/api/tasks', OWNER, {
      business_id: BIZ, title: '[스냅샷] 요청 업무 보고서 작성', assignee_id: MEMBER, estimated_hours: 8,
    }), ['id', 'source', 'request_by_user_id', 'estimated_hours', 'assignee_id']);
    if (req1?.id) { created.tasks.push(req1.id); }

    step('타 워크스페이스 사용자 배정 → 403 cannot_assign', await api('POST', '/api/tasks', OWNER, {
      business_id: BIZ, title: '[스냅샷] 크로스테넌트', assignee_id: OTHER_BIZ_USER,
    }));
    step('title 없음 → 400', await api('POST', '/api/tasks', OWNER, { business_id: BIZ }));
    step('business_id 없음 → 400', await api('POST', '/api/tasks', OWNER, { title: 'x' }));
    step('recurrence 인데 due_date 없음 → 400', await api('POST', '/api/tasks', OWNER, {
      business_id: BIZ, title: '[스냅샷] 정기', recurrence_rule: 'FREQ=WEEKLY',
    }));
    step('recurrence 형식 오류 → 400', await api('POST', '/api/tasks', OWNER, {
      business_id: BIZ, title: '[스냅샷] 정기2', recurrence_rule: 'NOT_A_RULE', due_date: '2026-08-01',
    }));
    step('workstream 무효 → 400', await api('POST', '/api/tasks', OWNER, {
      business_id: BIZ, title: '[스냅샷] ws', workstream_id: 999999,
    }));
    step('비멤버 워크스페이스 → 403', await api('POST', '/api/tasks', MEMBER, {
      business_id: 1, title: '[스냅샷] 남의 워크스페이스',
    }));

    // ── ② ai-create/confirm ─────────────────────────
    console.log('\n② POST /api/tasks/ai-create/confirm (candidates 직접 주입 — LLM 없이 결정론)');
    const conf = step('후보 2건 확정', await api('POST', '/api/tasks/ai-create/confirm', OWNER, {
      business_id: BIZ, base_date: '2026-07-13',
      candidates: [
        { title: '[스냅샷] 확정1 시안 작성', estimated_hours: 4, due_offset_days: 3 },
        { title: '[스냅샷] 확정2 검수 보고서 작성', assignee_user_id: MEMBER, estimated_hours: 6, due_offset_days: 5 },
      ],
    }), ['count']);
    for (const t of (conf?.created || [])) created.tasks.push(t.id);
    if (conf?.created?.[1]?.id) await taskSideEffects(conf.created[1].id, '확정(요청)');
    log.push({
      step: '확정 결과 형태',
      titles: (conf?.created || []).map((t) => t.title),
      sources: (conf?.created || []).map((t) => t.source),
      estimated: (conf?.created || []).map((t) => t.estimated_hours),
    });

    step('무효 담당자 → 403 assignee_not_assignable', await api('POST', '/api/tasks/ai-create/confirm', OWNER, {
      business_id: BIZ, candidates: [{ title: '[스냅샷] 무효', assignee_user_id: OTHER_BIZ_USER }],
    }));
    step('없는 대화 컨텍스트 → 404', await api('POST', '/api/tasks/ai-create/confirm', OWNER, {
      business_id: BIZ, candidates: [{ title: '[스냅샷] ctx' }], context: { conversation_id: 999999 },
    }));
    step('candidates 없음 → 400', await api('POST', '/api/tasks/ai-create/confirm', OWNER, { business_id: BIZ }));

    // ── ③ 댓글 ──────────────────────────────────────
    console.log('\n③ POST /api/tasks/:id/comments');
    const c1 = step('멤버 internal 댓글', await api('POST', `/api/tasks/${own.id}/comments`, MEMBER, {
      content: '진행 상황 공유합니다.', visibility: 'internal',
    }), ['id', 'visibility', 'user_id']);
    if (c1?.id) created.comments.push(c1.id);
    step('content 없음 → 400', await api('POST', `/api/tasks/${own.id}/comments`, MEMBER, { content: '  ' }));
    step('없는 업무 → 404', await api('POST', '/api/tasks/9999999/comments', MEMBER, { content: 'x' }));
    const c2 = step('visibility 미지정 → shared 기본', await api('POST', `/api/tasks/${own.id}/comments`, OWNER, {
      content: '확인했습니다.',
    }), ['visibility']);
    log.push({
      step: '댓글 알림',
      notifications: await Notification.count({ where: { link: { [Op.like]: `%task=${own.id}` } } }),
    });

    // ── ④ 후보 → 업무 승격 (registerCandidate) ───────
    console.log('\n④ 후보 → 업무 승격 (task_extractor.registerCandidate)');
    const conv = await Conversation.findOne({ where: { business_id: BIZ }, attributes: ['id'] });
    const cand = await TaskCandidate.create({
      business_id: BIZ, conversation_id: conv?.id || null,
      title: '[스냅샷] 후보 → 업무', description: '대화에서 추출된 후보',
      status: 'pending', confidence: 0.9,
    });
    created.candidates.push(cand.id);
    const regRes = await api('POST', `/api/projects/task-candidates/${cand.id}/register`, OWNER, { assignee_id: MEMBER });
    const reg = regRes.body?.data || {};
    console.log(`  ${regRes.status} 후보 → 업무 승격 (실 HTTP)`);
    if (reg.task?.id) created.tasks.push(reg.task.id);
    await new Promise((r) => setTimeout(r, 1200));   // afterCommit 부수효과(감사·알림) 착지 대기
    log.push({
      step: '후보 승격',
      status: regRes.status,
      task_source: reg.task?.source,
      request_by: reg.task?.request_by_user_id === OWNER,
      from_candidate: reg.task?.from_candidate_id === cand.id,
      candidate_status: (await TaskCandidate.findByPk(cand.id)).status,
      // bare toJSON 인가 (includes 없음) — 응답 형태 계약
      has_includes: reg.task ? ('assignee' in reg.task) : null,
    });
    await taskSideEffects(reg.task.id, '후보 승격');

    const regAgain = await api('POST', `/api/projects/task-candidates/${cand.id}/register`, OWNER, {});
    step('이미 등록된 후보 재등록 → 400', regAgain);

    // ── socket ──────────────────────────────────────
    await new Promise((r) => setTimeout(r, 1500));
    const byEvent = socketEvents.reduce((m, e) => { m[e.ev] = (m[e.ev] || 0) + 1; return m; }, {});
    log.push({ step: 'socket 이벤트', counts: byEvent, reasons: [...new Set(socketEvents.map((e) => e.reason).filter(Boolean))].sort() });
    console.log(`\n⑤ socket: ${JSON.stringify(byEvent)}`);

  } finally {
    sock.close();
    // 원복
    for (const id of created.tasks) {
      await TaskComment.destroy({ where: { task_id: id } });
      await TaskReviewer.destroy({ where: { task_id: id } });
      await TaskEstimation.destroy({ where: { task_id: id } });
      await Notification.destroy({ where: { link: { [Op.like]: `%task=${id}` } } });
      await AuditLog.destroy({ where: { target_type: 'task', target_id: id } });
    }
    await Task.destroy({ where: { id: created.tasks.length ? created.tasks : [0] } });
    await TaskCandidate.destroy({ where: { id: created.candidates.length ? created.candidates : [0] } });
    const left = await Task.count({ where: { id: created.tasks.length ? created.tasks : [0] } });
    console.log(`\n원복 — 남은 검증 task ${left}건 (0이어야 한다)`);

    const file = `${SNAP}/create-${mode}.json`;
    fs.writeFileSync(file, JSON.stringify(log, null, 2));
    console.log(`스냅샷: ${file}`);

    if (mode === 'after') {
      const bf = `${SNAP}/create-before.json`;
      if (fs.existsSync(bf)) {
        const a = fs.readFileSync(bf, 'utf-8');
        const b = JSON.stringify(log, null, 2);
        if (a === b) console.log('\n✅ 전후 완전 일치 (예상 diff 없음)');
        else {
          console.log('\n⚠️ 차이 (사전 선언한 예상 diff 3건인지 확인):');
          const al = a.split('\n'), bl = b.split('\n');
          for (let i = 0; i < Math.max(al.length, bl.length); i++) {
            if (al[i] !== bl[i]) console.log(`  L${i + 1}\n    before: ${al[i]}\n    after : ${bl[i]}`);
          }
        }
      }
    }
    await sequelize.close();
    process.exit(0);
  }
})();
