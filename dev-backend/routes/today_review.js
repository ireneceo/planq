// 오늘의 업무 리뷰 (Context Center) — Irene 2026-08-24.
//
// 두 층을 나눈다:
//   ① 확인 필요 = **Action Center** — "내가 지금 행동해야 하는 것" (`/api/dashboard/todo`)
//   ② 오늘의 업무 리뷰 = **Context Center** — "오늘 일을 시작하기 위해 알아야 하는 것" (이 파일)
// 섞으면 둘 다 어정쩡해진다. 여기는 **행동 목록이 아니라 브리핑**이다.
//
// ★ 저장하지 않는다. 날짜별 이력도 남기지 않는다(Irene: "계속 저장되면서 날짜별로 남길 필요도 없잖아").
//   매 호출마다 지금 상태로 계산한다 — 스냅샷 테이블이 없으므로 정합성이 갈릴 일도 없다.
//
// ★★ 2026-08-24 교정 (Irene: "아래 전체 나오는 알림이랑 뭐가 달라?") — 처음 만든 것은 **알림 목록 한 벌
//   더**였다. 리뷰는 할 일을 리스트업하는 자리가 아니라 **업무 대응에 필요한 맥락**을 정리하는 자리다:
//     · 고객·외부와의 소통에서 생긴 이슈 (메일·채팅)
//     · 지금 빠르게 움직여야 하는 것 (마감 임박·지연) — **왜 급한지**까지
//     · 내가 막고 있는 것 / 내가 기다리는 것 (컨펌)
//   그래서 응답을 **엔티티 종류별 목록**(task/email/chat/event)이 아니라 **맥락 블록**으로 낸다.
//   같은 고객·프로젝트에서 온 것은 묶어서 한 줄로 말한다 — 한 줄에 "누가·무엇을·그래서 뭘 해야" 가 있어야
//   대표가 메일함을 다시 열지 않는다.
//
// ★ 집합 술어는 새로 만들지 않는다. 이번 주/오늘 판정은 `services/weekTaskSet` 단일 원천을 쓴다
//   (사본을 만들면 Q Task 화면과 리뷰의 숫자가 갈라진다 — 이 저장소가 여러 번 겪은 실패다).
const express = require('express');
const router = express.Router();
const { Op, literal, fn, col } = require('sequelize');
const { authenticateToken } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const {
  Task, Project, TaskStatusHistory, TaskReviewer, User,
  EmailThread, EmailAccount, Conversation, ConversationParticipant, Message,
  CalendarEvent, BusinessMember, Business, Client,
} = require('../models');
const { myAssignedWeekWhere } = require('../services/weekTaskSet');

// 'YYYY-MM-DD' (서버 로컬 기준). 리뷰는 "오늘" 이 축이라 tz 를 워크스페이스에서 읽는다.
const { dateStrInTz, ymd } = require('../utils/datetime');

const MAX_CHANGES = 12;   // 브리핑이라 길면 안 읽는다 — 상위만
const MAX_FOCUS = 5;

/** 내가 속한 워크스페이스 (member + client). dashboard/todo 와 같은 규칙. */
async function myWorkspaces(userId, oneBusinessId, isPlatformAdmin) {
  if (oneBusinessId) {
    const bm = await BusinessMember.findOne({
      where: { user_id: userId, business_id: oneBusinessId, removed_at: null }, attributes: ['role'],
    });
    const cli = !bm ? await Client.findOne({
      where: { user_id: userId, business_id: oneBusinessId, status: 'active' }, attributes: ['id'],
    }) : null;
    if (!bm && !cli && !isPlatformAdmin) return [];
    const biz = await Business.findByPk(oneBusinessId, { attributes: ['id', 'name', 'brand_name', 'timezone'] });
    return biz ? [{ id: biz.id, name: biz.brand_name || biz.name, tz: biz.timezone || 'Asia/Seoul' }] : [];
  }
  const ms = await BusinessMember.findAll({ where: { user_id: userId, removed_at: null }, attributes: ['business_id'] });
  const ids = [...new Set(ms.map((m) => m.business_id))];
  if (!ids.length) return [];
  const bizs = await Business.findAll({ where: { id: { [Op.in]: ids } }, attributes: ['id', 'name', 'brand_name', 'timezone'] });
  return bizs.map((b) => ({ id: b.id, name: b.brand_name || b.name, tz: b.timezone || 'Asia/Seoul' }));
}

/** 월요일 시작 주 범위 */
function weekRange(todayStr) {
  const d = new Date(`${todayStr}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;               // 월=0
  const mon = new Date(d.getTime() - dow * 86400000);
  const sun = new Date(mon.getTime() + 6 * 86400000);
  return { monday: mon.toISOString().slice(0, 10), sunday: sun.toISOString().slice(0, 10) };
}

// GET /api/dashboard/today-review?business_id=
router.get('/today-review', authenticateToken, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const isPlatformAdmin = req.user.platform_role === 'platform_admin';
    const q = parseInt(req.query.business_id, 10);
    const oneBusinessId = Number.isFinite(q) ? q : null;

    const workspaces = await myWorkspaces(userId, oneBusinessId, isPlatformAdmin);
    if (!workspaces.length) {
      return successResponse(res, { counts: emptyCounts(), changes: [], focus: [], generated_at: new Date() });
    }
    const bizIds = workspaces.map((w) => w.id);
    const tz = workspaces[0].tz;
    const today = dateStrInTz(new Date(), tz);
    const { monday, sunday } = weekRange(today);
    const tomorrow = new Date(new Date(`${today}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10);
    // "어제 이후" = 24시간이 아니라 **어제 0시부터**. 아침에 열었을 때 어제 저녁 일이 빠지면 안 된다.
    const since = new Date(new Date(`${today}T00:00:00Z`).getTime() - 86400000);

    // ── 숫자 ────────────────────────────────────────────────
    const [projectsActive, todayTasks, approvals, dueSoon] = await Promise.all([
      Project.count({ where: { business_id: { [Op.in]: bizIds }, status: { [Op.notIn]: ['completed', 'canceled', 'archived'] } } }),
      // 오늘 처리 필요 = 이번 주 내 담당 집합 중 **마감이 오늘 이하**(지연 포함) 인 활성 업무
      Task.count({
        where: {
          business_id: { [Op.in]: bizIds },
          status: { [Op.notIn]: ['completed', 'canceled', 'on_hold'] },
          [Op.and]: [myAssignedWeekWhere(userId, monday, sunday)],
          due_date: { [Op.lte]: today },
        },
      }),
      // 승인 필요 = 내가 pending 컨펌자인 확인요청 업무
      Task.count({
        where: {
          business_id: { [Op.in]: bizIds },
          status: { [Op.in]: ['reviewing', 'revision_requested'] },
          id: { [Op.in]: literal(`(SELECT task_id FROM task_reviewers WHERE user_id = ${Number(userId)} AND state = 'pending')`) },
        },
      }),
      // 기한 임박 = 오늘·내일 마감 (지연은 위 '오늘 처리 필요' 가 담당)
      Task.count({
        where: {
          business_id: { [Op.in]: bizIds }, assignee_id: userId,
          status: { [Op.notIn]: ['completed', 'canceled', 'on_hold'] },
          due_date: { [Op.between]: [today, tomorrow] },
        },
      }),
    ]);

    // ── 주요 변경 (어제 이후) ────────────────────────────────
    const changes = [];

    // ① 업무 상태 전이 — 내가 담당/작성/컨펌자인 업무
    const hist = await TaskStatusHistory.findAll({
      where: {
        created_at: { [Op.gte]: since },
        task_id: { [Op.in]: literal(`(SELECT id FROM tasks WHERE business_id IN (${bizIds.join(',')}) AND (assignee_id = ${Number(userId)} OR created_by = ${Number(userId)} OR id IN (SELECT task_id FROM task_reviewers WHERE user_id = ${Number(userId)})))`) },
      },
      order: [['created_at', 'DESC']], limit: 40,
      attributes: ['task_id', 'from_status', 'to_status', 'created_at', 'actor_user_id'],
    });
    if (hist.length) {
      const tids = [...new Set(hist.map((h) => h.task_id))];
      const tasks = await Task.findAll({ where: { id: { [Op.in]: tids } }, attributes: ['id', 'title', 'business_id', 'project_id'] });
      const tmap = new Map(tasks.map((t) => [t.id, t]));
      const seen = new Set();
      for (const h of hist) {
        if (seen.has(h.task_id)) continue;      // 업무당 최신 1건만 — 같은 업무의 연쇄 전이는 노이즈
        seen.add(h.task_id);
        const t = tmap.get(h.task_id);
        if (!t) continue;
        changes.push({
          kind: 'task', id: t.id, title: t.title,
          detail_key: 'status', from: h.from_status, to: h.to_status,
          at: h.created_at, link: `/tasks?task=${t.id}`,
        });
      }
    }

    // ② 메일 — 어제 이후 새 메일이 온 스레드 중 답장 대기·확인 권장
    try {
      const accs = await EmailAccount.findAll({
        where: {
          business_id: { [Op.in]: bizIds }, is_active: true,
          [Op.or]: [{ owner_user_id: null }, { owner_user_id: userId }],
        }, attributes: ['id'],
      });
      const accIds = accs.map((a) => a.id);
      if (accIds.length) {
        const threads = await EmailThread.findAll({
          where: {
            account_id: { [Op.in]: accIds },
            last_message_at: { [Op.gte]: since },
            status: { [Op.ne]: 'archived' },
            [Op.or]: [{ reply_needed: true }, { status: 'uncertain' }],
          },
          order: [['last_message_at', 'DESC']], limit: 10,
          attributes: ['id', 'subject', 'last_message_at', 'reply_needed', 'status'],
        });
        threads.forEach((th) => changes.push({
          kind: 'email', id: th.id, title: th.subject || '(제목 없음)',
          detail_key: th.reply_needed ? 'reply_needed' : 'uncertain',
          at: th.last_message_at, link: `/mail?thread=${th.id}`,
        }));
      }
    } catch (e) { /* 메일 미설정 워크스페이스 — 리뷰 전체를 죽이지 않는다 */ }

    // ③ 채팅 — 내가 참여한 대화방에 어제 이후 남의 새 메시지
    try {
      const convIds = (await ConversationParticipant.findAll({
        where: { user_id: userId }, attributes: ['conversation_id'],
      })).map((p) => p.conversation_id);
      if (convIds.length) {
        const rows = await Message.findAll({
          where: { conversation_id: { [Op.in]: convIds }, created_at: { [Op.gte]: since }, sender_id: { [Op.ne]: userId } },
          attributes: ['conversation_id', [fn('COUNT', col('id')), 'n'], [fn('MAX', col('created_at')), 'last_at']],
          group: ['conversation_id'], order: [[literal('last_at'), 'DESC']], limit: 6, raw: true,
        });
        if (rows.length) {
          const convs = await Conversation.findAll({
            where: { id: { [Op.in]: rows.map((r) => r.conversation_id) } }, attributes: ['id', 'title'],
          });
          const cmap = new Map(convs.map((c) => [c.id, c.title]));
          rows.forEach((r) => changes.push({
            kind: 'chat', id: r.conversation_id, title: cmap.get(r.conversation_id) || '대화',
            detail_key: 'new_messages', count: Number(r.n) || 0,
            at: r.last_at, link: `/talk?conv=${r.conversation_id}`,
          }));
        }
      }
    } catch (e) { /* 대화 없음 */ }

    // ④ 일정 — 어제 이후 만들어지거나 바뀐, 오늘 이후의 일정
    try {
      const evs = await CalendarEvent.findAll({
        where: {
          business_id: { [Op.in]: bizIds },
          updated_at: { [Op.gte]: since },
          start_at: { [Op.gte]: new Date(`${today}T00:00:00`) },
        },
        order: [['start_at', 'ASC']], limit: 6,
        attributes: ['id', 'title', 'start_at', 'updated_at', 'created_at'],
      });
      evs.forEach((e) => changes.push({
        kind: 'event', id: e.id, title: e.title,
        detail_key: String(e.created_at) === String(e.updated_at) ? 'event_new' : 'event_changed',
        at: e.updated_at, start_at: e.start_at, link: `/calendar?event=${e.id}`,
      }));
    } catch (e) { /* 캘린더 없음 */ }

    changes.sort((a, b) => new Date(b.at) - new Date(a.at));
    const topChanges = changes.slice(0, MAX_CHANGES);

    // ── 오늘 집중 ────────────────────────────────────────────
    //   "무엇부터" 가 이 블록의 존재 이유다. 승인 대기(남이 나를 기다림) → 오늘·지연 마감 순.
    const focusApprovals = await Task.findAll({
      where: {
        business_id: { [Op.in]: bizIds },
        status: { [Op.in]: ['reviewing', 'revision_requested'] },
        id: { [Op.in]: literal(`(SELECT task_id FROM task_reviewers WHERE user_id = ${Number(userId)} AND state = 'pending')`) },
      },
      order: [['due_date', 'ASC']], limit: MAX_FOCUS,
      attributes: ['id', 'title', 'due_date'],
    });
    const focus = focusApprovals.map((t) => ({
      id: t.id, title: t.title, why: 'approval', due_date: t.due_date, link: `/tasks?task=${t.id}`,
    }));
    if (focus.length < MAX_FOCUS) {
      const rest = await Task.findAll({
        where: {
          business_id: { [Op.in]: bizIds }, assignee_id: userId,
          status: { [Op.notIn]: ['completed', 'canceled', 'on_hold'] },
          due_date: { [Op.lte]: tomorrow },
          id: { [Op.notIn]: focus.length ? focus.map((f) => f.id) : [0] },
        },
        order: [['due_date', 'ASC']], limit: MAX_FOCUS - focus.length,
        attributes: ['id', 'title', 'due_date'],
      });
      rest.forEach((t) => focus.push({
        id: t.id, title: t.title,
        why: t.due_date && ymd(t.due_date) < today ? 'overdue' : 'due_today',
        due_date: t.due_date, link: `/tasks?task=${t.id}`,
      }));
    }

    // ── 맥락 블록으로 재편 ──────────────────────────────────
    //   ① 밖에서 온 것 — 고객·외부와의 소통(메일·채팅). "누가 무엇을 말했나"
    //   ② 지금 급한 것 — 마감 임박·지연. **왜 급한지**(며칠 지났는지/오늘인지)까지 준다
    //   ③ 내가 막고 있는 것 — 나를 기다리는 컨펌. 남의 일이 내 손에서 멈춰 있다
    //   블록이 비면 프론트가 그 블록을 아예 안 그린다 — 빈 제목만 늘어놓지 않는다.
    const inbound = topChanges.filter((c) => c.kind === 'email' || c.kind === 'chat');
    const moved = topChanges.filter((c) => c.kind === 'task' || c.kind === 'event');

    const urgent = focus
      .filter((f) => f.why !== 'approval')
      .map((f) => {
        const d = f.due_date ? ymd(f.due_date) : null;
        const overdueDays = d && d < today
          ? Math.round((new Date(`${today}T00:00:00Z`) - new Date(`${d}T00:00:00Z`)) / 86400000) : 0;
        return { ...f, overdue_days: overdueDays };
      });
    const blocking = focus.filter((f) => f.why === 'approval');

    return successResponse(res, {
      counts: {
        projects_active: projectsActive,
        today_tasks: todayTasks,
        approvals,
        due_soon: dueSoon,
        changes: changes.length,
      },
      blocks: {
        inbound,      // 밖에서 온 것 (메일·채팅)
        urgent,       // 지금 급한 것 (지연·오늘 마감) + overdue_days
        blocking,     // 나를 기다리는 컨펌
        moved,        // 그 사이 움직인 것 (업무 상태·일정) — 참고
      },
      today,
      generated_at: new Date(),
    });
  } catch (err) { next(err); }
});

function emptyCounts() {
  return { projects_active: 0, today_tasks: 0, approvals: 0, due_soon: 0, changes: 0 };
}

module.exports = router;
