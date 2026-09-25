// services/todo/saleBucket.js — 확인필요의 **영업(Q sale) 버킷**.
//
// routes/dashboard.js 에서 그대로 옮겨왔다(임계 1350줄에 닿아 수집기를 꺼내는 첫 걸음).
// 상한·시각 변환은 services/todo/common.js 한 곳을 쓴다 — 복사하면 버킷마다 숫자가 갈라진다.
//
// 버킷 다섯: ①답 안 한 문의 ②미확인 자동 기록 ③다음 할 일 없음 ④계정 요청
//   ⑤**아직 고객이 아닌 게스트 문의**(2026-09-12 신설 — 아무 배지도 닿지 않던 자리)
const { Op } = require('sequelize');
const { COLLECT_LIMIT, safeToIso } = require('./common');

// ★ 2026-09-14 (Irene: *"확인필요에서 영업 링크 누르면 우측패널이 고객정보 나오는데 상담관리가 안되네.
//   그냥 상담에서 검색해서 해당 상담이 딱 리스트업된 상태가 되게 해줘. 다음 업무를 진행해야 하니까."*)
//
//   2026-09-13 에는 **고객 패널을 열어 달라**고 하셔서 `drawer: {kind:'client'}` 를 붙였는데,
//   그 패널에서는 상담을 처리할 수 없었다(단계 바꾸기·메모·일정이 상담 목록의 행에 있다).
//   그래서 **상담 목록에서 그 건이 걸러진 상태**로 보낸다 — 열자마자 다음 행동을 할 수 있다.
//   검색어는 사람이 보는 이름 그대로다(목록의 검색이 이름·회사·전화·메일에서 찾는다).
//
// ★ 2026-09-16 (Irene: *"확인필요에서 영업리스트 누르면 검색되어서 넘어가는데 리스트에 검색된 형태가 아니야."*)
//   9-14 수정은 **전부 상담 탭**으로 보냈다. 그런데 상담 탭은 정의상
//   *"고객으로 **등록되지 않은** 접점만"* 이다(`services/saleInbox.js` 머리말).
//   아래 ①②③④ 는 모두 **등록된 고객**이므로 그 목록에 **구조적으로 있을 수 없다** —
//   검색어만 칸에 박히고 결과는 0건이 된다. 미등록 문의(⑤)만 상담 탭이 맞다.
//   → 링크가 **자기가 어느 탭에 있는지**를 같이 싣는다. 받는 쪽(SalePage)은 그 탭을 연다.
//   (memory feedback_predicate_must_match_both_sides — 보내는 술어와 목록의 술어가 같아야 한다.)
/**
 * @param {string} nameLike 사람이 보는 이름 — 목록 검색이 이름·회사·전화·메일에서 찾는다
 * @param {'clients'|'inbox'} tab 그 건이 실제로 **들어 있는** 탭
 */
function saleConsultLink(nameLike, tab) {
  const q = String(nameLike || '').trim();
  const t = tab === 'inbox' ? 'inbox' : 'clients';
  return q ? `/sale?tab=${t}&q=${encodeURIComponent(q)}` : `/sale?tab=${t}`;
}

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
    // 상담 예약(창구 P2)과 겹치는 것을 뺀다 — 한 건 = 한 버킷.
    //   ① 대기 중 신청이 있으면 «상담 신청» 버킷이 센다(여기서도 세면 두 번 뜬다)
    //   ③ 앞으로 잡힌 상담이 있으면 «다음 할 일» 이 이미 있는 것이다
    const { clientIdsWithBooking } = require('./bookingBucket');
    const pendingBooking = await clientIdsWithBooking(businessId, ids, ['requested']);
    const upcomingBooking = await clientIdsWithBooking(businessId, ids, ['requested', 'proposed', 'confirmed'], { upcomingOnly: true });

    for (const c of clients) {
      const name = c.display_name || c.company_name || `#${c.id}`;
      const since = c.last_touch_at ? new Date(c.last_touch_at) : new Date(c.created_at);
      const days = Math.floor((now - since.getTime()) / DAY);
      // ① 답 안 한 문의 — 메일에서 온 문의는 Q mail 이 이미 센다(한 항목 = 한 버킷)
      const unanswered = c.sales_stage === 'inquiry' && c.sales_source !== 'email'
        && !repliedTo.has(c.id) && !hasTask.has(c.id) && !pendingBooking.has(c.id) && days >= 1;
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
          link: saleConsultLink(name, 'clients'),
        });
        continue;                       // ③으로 또 세지 않는다
      }
      // ③ 다음 할 일 없음 — 진행 중인데 살아 있는 할 일이 하나도 없다
      if (!hasTask.has(c.id) && !upcomingBooking.has(c.id)) {
        out.push({
          id: `sale-${c.id}-next-action`,
          type: 'sale',
          priority: 'week',
          verb: 'sale_next_action',
          subject: name,
          context: c.company_name && c.display_name ? c.company_name : null,
          dueAt: null,
          createdAt: safeToIso(since),
          link: saleConsultLink(name, 'clients'),
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
      link: saleConsultLink(c ? (c.display_name || c.company_name) : '', 'clients'),
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
        // ★ 2026-09-14 — 여기도 **상담 목록에서 걸러진 상태**로 보낸다(위 saleConsultLink 주석).
        link: saleConsultLink(it.who || it.title || '', 'inbox'),
        // ★ 이건 **아직 고객이 아닌 문의**다 — 고객 패널이 아니라 상담 패널(ClientPanel 의 inquiry 분기)로 연다.
        //   link 만 주면 목록만 열려 "어느 문의였는지" 를 사람이 다시 찾아야 한다.
        //   ref 를 그대로 실어 받는 쪽이 그 행을 집어낼 수 있게 한다(업무·일정과 같은 drawer 계약).
        //   ★ 패널이 그릴 값을 **통째로** 실어 보낸다 — 받는 쪽이 다시 조회하면
        //     같은 문의가 두 화면에서 다르게 보일 자리가 생긴다(그리고 조회가 한 번 더 나간다).
        //     목록(Q sale 상담)이 쓰는 필드와 같은 이름·같은 출처다.
        drawer: {
          kind: 'inquiry',
          id: it.id,
          ref: it.ref,
          inquiry: {
            who: it.who,
            email: it.email,
            company: it.company,
            title: it.title,
            preview: it.preview,
            at: it.at,
            needs_reply: it.needs_reply,
            source: it.source,
            open_path: it.open_path,
            meta: it.meta,
          },
        },
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
        link: saleConsultLink(c.display_name || c.company_name, 'clients'),
      });
    }
  }

  return out;
}

module.exports = { collectSale };
