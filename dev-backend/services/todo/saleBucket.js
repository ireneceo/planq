// services/todo/saleBucket.js — 확인필요의 **영업(Q sale) 버킷**.
//
// routes/dashboard.js 에서 그대로 옮겨왔다(임계 1350줄에 닿아 수집기를 꺼내는 첫 걸음).
// 상한·시각 변환은 services/todo/common.js 한 곳을 쓴다 — 복사하면 버킷마다 숫자가 갈라진다.
//
// 버킷 다섯: ①답 안 한 문의 ②미확인 자동 기록 ③다음 할 일 없음 ④계정 요청
//   ⑤**아직 고객이 아닌 게스트 문의**(2026-09-12 신설 — 아무 배지도 닿지 않던 자리)
const { Op } = require('sequelize');
const { COLLECT_LIMIT, safeToIso } = require('./common');

async function collectSale(businessId, userId, userRole) {
  const { Client, ClientInteraction, GuestLink, Task } = require('../../models');
  const { getMemberMenuLevels } = require('../../middleware/menu_permission');
  const { saleOwnerWhere, IN_PROGRESS } = require('../saleCommon');

  const isManager = userRole === 'owner' || userRole === 'admin';
  if (!isManager) {
    const levels = await getMemberMenuLevels(businessId, userId);
    if (!levels || levels.menus?.qsale === 'none') return [];
  }
  const ownerWhere = await saleOwnerWhere(businessId, userId, { isManager });

  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;
  const out = [];

  // 영업 중인 고객 (진행 단계) — 여기서 ①③을 가른다
  const clients = await Client.findAll({
    where: { business_id: businessId, sales_stage: { [Op.in]: IN_PROGRESS }, ...ownerWhere },
    attributes: ['id', 'display_name', 'company_name', 'sales_stage', 'sales_source', 'last_touch_at', 'created_at'],
    limit: COLLECT_LIMIT,
    order: [['last_touch_at', 'ASC']],
  });
  if (clients.length) {
    const ids = clients.map((c) => c.id);
    // 우리가 먼저 말을 걸었는가 — outbound 상담 기록
    const outbound = await ClientInteraction.findAll({
      where: { business_id: businessId, client_id: { [Op.in]: ids }, deleted_at: null, direction: 'outbound' },
      attributes: ['client_id'], group: ['client_id'], raw: true,
    });
    const repliedTo = new Set(outbound.map((r) => r.client_id));
    // 살아 있는 할 일이 있는가
    const tasks = await Task.findAll({
      where: {
        business_id: businessId, client_id: { [Op.in]: ids },
        status: { [Op.notIn]: ['completed', 'canceled'] },
      },
      attributes: ['client_id'], group: ['client_id'], raw: true,
    });
    const hasTask = new Set(tasks.map((r) => r.client_id));

    for (const c of clients) {
      const name = c.display_name || c.company_name || `#${c.id}`;
      const since = c.last_touch_at ? new Date(c.last_touch_at) : new Date(c.created_at);
      const days = Math.floor((now - since.getTime()) / DAY);
      // ① 답 안 한 문의 — 메일에서 온 문의는 Q mail 이 이미 센다(한 항목 = 한 버킷)
      const unanswered = c.sales_stage === 'inquiry' && c.sales_source !== 'email'
        && !repliedTo.has(c.id) && !hasTask.has(c.id) && days >= 1;
      if (unanswered) {
        out.push({
          id: `sale-${c.id}-first-reply`,
          type: 'sale',
          priority: days >= 3 ? 'urgent' : 'today',
          verb: 'sale_first_reply',
          subject: name,
          context: c.company_name && c.display_name ? c.company_name : null,
          dueAt: null,
          createdAt: safeToIso(since),
          link: `/sale/${c.id}`,
        });
        continue;                       // ③으로 또 세지 않는다
      }
      // ③ 다음 할 일 없음 — 진행 중인데 살아 있는 할 일이 하나도 없다
      if (!hasTask.has(c.id)) {
        out.push({
          id: `sale-${c.id}-next-action`,
          type: 'sale',
          priority: 'week',
          verb: 'sale_next_action',
          subject: name,
          context: c.company_name && c.display_name ? c.company_name : null,
          dueAt: null,
          createdAt: safeToIso(since),
          link: `/sale/${c.id}`,
        });
      }
    }
  }

  // ② 미확인 자동 기록 — 사람이 쓴 기록은 확인할 것이 없다
  const autoRows = await ClientInteraction.findAll({
    where: { business_id: businessId, origin: 'auto', reviewed_at: null, deleted_at: null },
    include: [{
      model: Client,
      attributes: ['id', 'display_name', 'company_name'],
      where: ownerWhere,
      required: true,
    }],
    order: [['occurred_at', 'DESC']],
    limit: COLLECT_LIMIT,
  });
  for (const r of autoRows) {
    const c = r.Client;
    out.push({
      id: `sale-interaction-${r.id}`,
      type: 'sale',
      priority: 'week',
      verb: 'sale_unreviewed',
      subject: c ? (c.display_name || c.company_name || `#${c.id}`) : `#${r.client_id}`,
      context: r.title || null,
      dueAt: null,
      createdAt: safeToIso(r.occurred_at),
      link: `/sale/${r.client_id}`,
    });
  }

  // ★ ⑤ **아직 고객이 아닌 문의** — 고객 레코드가 없어 위 ①③ 에 걸리지 않는다.
  //   여태 이 배지에는 **등록된 고객만** 들어왔다(미등록 문의는 어느 배지에도 없었다 — 상담 목록을
  //   열어 봐야 알았다). 여기서 더하는 것은 **게스트 링크 문의뿐**이다:
  //     · 메일 문의 → Q mail 이 이미 센다(공유 큐)
  //     · 고객 대화방 → Q talk 안읽음이 센다
  //   게스트 링크만 **아무 배지도 닿지 않는다**. 한 항목 = 한 버킷(CLAUDE.md 숫자 배지 계약 3).
  // ★ 무엇이 상담인가는 `services/saleInbox` 한 곳이 정한다 — 여기서 다시 쿼리하면 목록과 숫자가 갈라진다.
  //   담당 귀속(ownerWhere)은 적용할 것이 없다(고객이 없으니 담당자도 없다) — qsale 권한자 모두에게 보인다.
  try {
    const { listUnlinkedTouchpoints } = require('../saleInbox');
    const inbox = await listUnlinkedTouchpoints(businessId, {
      userId, sources: ['guest_link'], needsReply: true, limit: COLLECT_LIMIT,
    });
    for (const it of (inbox.items || [])) {
      out.push({
        id: `sale-inbox-${it.id}`,
        type: 'sale',
        priority: 'today',
        verb: 'sale_inbox_reply',
        subject: it.who || it.title || '—',
        context: it.company?.name || it.title || null,
        dueAt: null,
        createdAt: safeToIso(it.at),
        link: '/sale',
      });
    }
  } catch (e) {
    // 배지 한 줄 때문에 확인필요 전체가 죽지 않게 — 실패는 로그로만(숫자는 그만큼 작아진다)
    console.warn('[collectSale] inbox bucket failed:', e.message);
  }

  // ④ 계정 요청 — 게스트가 눌렀고 아직 초대 전인 고객
  const requested = await GuestLink.findAll({
    where: { business_id: businessId, account_requested_at: { [Op.ne]: null }, client_id: { [Op.ne]: null }, revoked_at: null },
    attributes: ['id', 'client_id', 'account_requested_at', 'requested_email'],
    order: [['account_requested_at', 'DESC']],
    limit: COLLECT_LIMIT,
  });
  if (requested.length) {
    const reqClients = await Client.findAll({
      where: { business_id: businessId, id: { [Op.in]: requested.map((l) => l.client_id) }, status: 'prospect', ...ownerWhere },
      attributes: ['id', 'display_name', 'company_name'],
    });
    const byId = new Map(reqClients.map((c) => [c.id, c]));
    const seen = new Set();
    for (const l of requested) {
      const c = byId.get(l.client_id);
      if (!c || seen.has(c.id)) continue;   // 링크가 여럿이어도 고객당 하나
      seen.add(c.id);
      out.push({
        id: `sale-${c.id}-account-request`,
        type: 'sale',
        priority: 'today',
        verb: 'sale_account_request',
        subject: c.display_name || c.company_name || `#${c.id}`,
        context: l.requested_email || null,
        dueAt: null,
        createdAt: safeToIso(l.account_requested_at),
        link: `/sale/${c.id}`,
      });
    }
  }

  return out;
}

module.exports = { collectSale };
