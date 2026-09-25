// routes/customer_entry.js — 워크스페이스 **고객 창구** 관리 (멤버용, 인증 필수)
//
//   설계: docs/CLIENT_ENTRY_DESIGN.md §3-D1(세 번째 scope) · §4.2(창구 화면) · §4.5(설정 카드)
//
// ★ 공개 표면(routes/guest.js)과 **파일을 나눈다** — guest_admin.js 와 같은 이유다.
//   여기는 전부 `authenticateToken` 이다.
// ★ `routes/businesses.js` 에 넣지 않은 이유: 그 파일이 이미 1747줄이다(CLAUDE.md 500줄 기준).
//   같은 접두어(`/api/businesses`)에 라우터를 둘 이상 마운트할 때는 **순서가 계약**이므로
//   server.js 에서 businesses.js **앞**에 붙인다(client_links.js + clients.js 와 같은 패턴).
//   실측으로 businesses.js 에 `/:businessId/:xxx` 2-세그먼트 와일드카드가 없음을 확인했다.
//
// ★ 발급·회수는 **services/guest_link.js 의 같은 함수**를 부른다(대화방·프로젝트 발급과 한 벌).
//   베끼면 갈라진다 — 2026-09-05 에 프로젝트 쪽 회수가 넷을 빠뜨린 전례가 있다.
const express = require('express');
const router = express.Router();
const { Business, GuestLink } = require('../models');
const { authenticateToken } = require('../middleware/auth');
const { attachWorkspaceScope, assertMemberOrAbove, getUserScope } = require('../middleware/access_scope');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { createAuditLog } = require('../services/auditService');
const { normalizeBooking } = require('../services/booking');
const {
  issueOrReuseSharedLink, urlForSharedLink, serializeGuestLink, serializeGuestContact,
  assertGuestLinkIssuable, findLiveSharedLink, revokeGuestLink,
} = require('../services/guest_link');

/**
 * 창구를 **고칠 수 있는 사람** — 한 곳이다 (2026-09-25 Fable 관찰로 정렬).
 *
 * ★ 처음엔 `assertMemberOrAbove`(멤버 이상)였는데 화면은 `disabled={!isOwner}` 였다 —
 *   **화면이 서버보다 좁으면** 서버가 허용하는 것을 사용자는 영영 못 한다(그 반대면 누수다).
 *   memory `feedback_client_stricter_than_server_kills_feature` 계열이고, 정책이 둘로 갈린 것 자체가 결함이다.
 * ★ 좁은 쪽(오너/관리자)으로 맞춘 이유: 이 카드는 **설정 › 권한 탭**에 있고 그 탭의 정책이
 *   「변경은 owner 만, 조회는 모두」다(`PermissionsSettings.tsx` 머리말). 창구는 워크스페이스가
 *   **밖으로 내보이는 얼굴**이라 그 정책에 속한다. 아직 출시 전이라 좁혀도 잃는 기능이 없다.
 * ★ 화면 기준과 **같은 값**이어야 한다 — `WorkspaceSettingsPage.tsx:510`
 *   (`business_role === 'owner' || platform_role === 'platform_admin'`). 여기에 workspace admin 을
 *   더하려면 **두 곳을 같이** 바꾼다(한쪽만 바꾸면 다시 갈라진다).
 */
async function assertEntryAdmin(req, businessId) {
  if (req.user?.platform_role === 'platform_admin') return true;
  const scope = await getUserScope(req.user.id, businessId, req.user.platform_role);
  return !!(scope && (scope.isPlatformAdmin || scope.isOwner));
}

/**
 * 창구 소개 설정의 **정본 모양**. `businesses.permissions.customer_entry` JSON 안에 산다
 * (§4.6 — 새 컬럼·새 표를 만들지 않는다).
 *
 * ★ 읽기도 쓰기도 **이 함수 하나**를 지난다. 라우트마다 손으로 기본값을 적으면 GET 과 PUT 의
 *   기본값이 갈라지고, 그러면 «저장하지 않았는데 값이 바뀌어 보이는» 화면이 된다.
 * ★ 화이트리스트다 — 무엇이 저장되는지 여기 한 곳에서 읽힌다. 모르는 키는 버린다.
 */
const INTRO_MAX = 2000;
const SERVICE_MAX = 6;
function normalizeIntro(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const str = (v, max) => {
    const s = typeof v === 'string' ? v.trim() : '';
    return s ? s.slice(0, max) : '';
  };
  return {
    // 소개 문단 — 창구 «안내» 탭의 본문.
    intro: str(src.intro, INTRO_MAX),
    // 제공 서비스 항목 3~6개. 문자열 배열이고 **빈 항목은 버린다**(빈 칸이 목록에 남으면 고장으로 보인다).
    services: Array.isArray(src.services)
      ? src.services.map((s) => str(s, 120)).filter(Boolean).slice(0, SERVICE_MAX)
      : [],
    // 상담 예약 설정(P2) — 모양은 services/booking.js normalizeBooking **한 곳**이 정한다
    //   (슬롯 계산이 읽는 값과 저장하는 값이 갈라지지 않게).
    booking: normalizeBooking(src.booking),
  };
}

/** 이 워크스페이스의 창구 설정 — 저장된 값 + 기본값. */
function introOf(biz) {
  const p = biz && biz.permissions && typeof biz.permissions === 'object' ? biz.permissions : {};
  return normalizeIntro(p.customer_entry);
}

/** 창구 링크 1건 직렬화 — 관리 화면용. 원문 토큰은 **발급 응답에만** 1회 실린다. */
async function serializeEntryLink(link) {
  if (!link) return null;
  // 확인을 마친 방문자들 — 발급자는 «누가 이 창구로 들어왔는지» 알아야 회수를 판단할 수 있다.
  //   직렬화는 serializeGuestContact 한 함수다(대화방·프로젝트 경로와 같은 것).
  const children = await GuestLink.findAll({
    where: { parent_link_id: link.id, kind: 'personal' },
    order: [['id', 'ASC']],
    limit: 500,
  });
  return {
    ...serializeGuestLink(link),
    // 주소를 **다시 볼 수 있다** — 파생 토큰의 살아 있는 링크만. 회수된 것·옛 난수 링크는 null.
    url: urlForSharedLink(link),
    contacts: children.map(serializeGuestContact),
  };
}

// ── GET /api/businesses/:businessId/customer-entry ─────────────────────────
//   설정 «고객 창구» 카드가 읽는 것 — 링크(있으면) + 소개 설정.
router.get('/:businessId/customer-entry', authenticateToken, attachWorkspaceScope(), async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    if (!(await assertMemberOrAbove(req.user.id, businessId, req.user.platform_role))) {
      return errorResponse(res, 'forbidden', 403);
    }
    const biz = await Business.findByPk(businessId, {
      attributes: ['id', 'name', 'brand_name', 'brand_logo_url', 'guest_links_enabled', 'permissions'],
    });
    if (!biz) return errorResponse(res, 'business_not_found', 404);

    const live = await findLiveSharedLink({ businessId, scope: 'workspace' });
    return successResponse(res, {
      link: await serializeEntryLink(live),
      // ★ 키 이름은 저장 위치(`permissions.customer_entry`)와 같게 둔다 — 전에 `intro` 로 뒀다가
      //   안에 또 `intro` 가 들어가 `data.intro.intro` 가 됐다(화면이 잘못 읽기 좋은 모양이다).
      customer_entry: introOf(biz),
      // 화면이 «왜 발급 버튼이 막혀 있는지» 를 말할 수 있어야 한다 — 눌리게 두고 403 으로
      //   거절하면 사용자에게는 "아무 일도 안 일어남" 이다(CLAUDE.md 외부 발송 절과 같은 규약).
      guest_links_enabled: biz.guest_links_enabled !== false,
    });
  } catch (err) { next(err); }
});

// ── PUT /api/businesses/:businessId/customer-entry ─────────────────────────
//   소개 문단·서비스 항목 저장. 화면은 AutoSaveField 라 **변경 즉시** 온다.
router.put('/:businessId/customer-entry', authenticateToken, attachWorkspaceScope(), async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    // 고치는 사람 판정은 **한 함수**다(위 assertEntryAdmin) — 화면 기준과 같은 값이어야 한다.
    if (!(await assertEntryAdmin(req, businessId))) return errorResponse(res, 'forbidden', 403);
    const biz = await Business.findByPk(businessId);
    if (!biz) return errorResponse(res, 'business_not_found', 404);

    const before = introOf(biz);
    const body = req.body?.intro !== undefined || req.body?.services !== undefined || req.body?.booking !== undefined
      ? req.body
      : (req.body?.customer_entry || {});
    // ★ **보낸 칸만 바꾼다.** 화면의 소개 칸은 {intro, services} 만 보낸다 — 통째로 정규화하면
    //   보내지 않은 예약 설정이 기본값(꺼짐)으로 **조용히 되돌아간다.** 예약 칸도 부분만 보낼 수 있다.
    const merged = { ...before };
    if (body.intro !== undefined) merged.intro = body.intro;
    if (body.services !== undefined) merged.services = body.services;
    if (body.booking !== undefined && body.booking && typeof body.booking === 'object') {
      merged.booking = { ...before.booking, ...body.booking };
    }
    const next = normalizeIntro(merged);
    // 담당 멤버는 **이 워크스페이스의 사람 멤버**만 — 남의 id·AI 멤버·떠난 사람을 저장하면
    //   슬롯 계산이 조용히 오너로 떨어지고, 설정 화면은 그 사람을 담당으로 보여 준다(거짓).
    if (next.booking.member_id) {
      const { BusinessMember } = require('../models');
      const bm = await BusinessMember.findOne({
        where: { business_id: businessId, user_id: next.booking.member_id }, attributes: ['role'],
      });
      if (!bm || bm.role === 'ai') return errorResponse(res, 'invalid_member', 400);
    }
    // ★ 이 컬럼에 사는 **다른 설정(권한 토글)을 보존한다.** 객체를 새로 조립하면 권한이 지워진다 —
    //   `routes/businesses.js` PUT /permissions 가 정확히 그 함정을 겪은 자리다.
    const permissions = {
      ...(biz.permissions && typeof biz.permissions === 'object' ? biz.permissions : {}),
      customer_entry: next,
    };
    await biz.update({ permissions });

    createAuditLog({
      userId: req.user.id, businessId,
      action: 'customer_entry.update', targetType: 'business', targetId: businessId,
      oldValue: before, newValue: next,
    });
    return successResponse(res, { customer_entry: next });
  } catch (err) { next(err); }
});

// ── POST /api/businesses/:businessId/customer-entry/link ───────────────────
//   창구 링크 발급 — **멱등**이다. 살아 있는 것이 있으면 그것을 돌려준다(reused).
//   `replace: true` 면 그것을 회수하고 새로 만든다(옛 주소는 즉시 404).
router.post('/:businessId/customer-entry/link', authenticateToken, attachWorkspaceScope(), async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    // ★ 창구 주소를 만들고 교체하는 것은 **오너/플랫폼 관리자**다(위 assertEntryAdmin).
    //   대화방·프로젝트 링크는 멤버도 발급하지만(guest_admin), 창구는 워크스페이스 **하나뿐인**
    //   대외 주소이고 교체하면 이미 배포한 명함·메일의 링크가 전부 죽는다 — 같은 무게가 아니다.
    if (!(await assertEntryAdmin(req, businessId))) return errorResponse(res, 'forbidden', 403);
    // 킬스위치 판정은 **한 함수**다(대화방·프로젝트 발급과 같은 것). 창구는 방이 없으므로
    //   대화방 검사 두 개는 그 함수가 scope 로 건너뛴다.
    const blocked = await assertGuestLinkIssuable(null, businessId, { scope: 'workspace' });
    if (blocked) return errorResponse(res, blocked.code, blocked.status);

    const replace = req.body?.replace === true;
    let r;
    try {
      r = await issueOrReuseSharedLink({
        businessId,
        scope: 'workspace',
        // 창구에는 방이 없다 — 방문자가 이메일을 확인하면 개인 링크마다 생긴다(§4.2).
        conversationId: null,
        projectId: null,
        client: null,
        createdBy: req.user.id,
        // ★ 공유 창구 링크는 **열람 전용으로 강제**한다(§5 P1 실측 항목).
        //   링크를 아는 누구나 글을 쓸 수 있으면 그 글이 «누구의 문의» 인지 없다 —
        //   쓰기는 이메일을 확인한 개인 링크에서, 자기 방에만 한다.
        canWrite: false,
        guestName: null,
        replace,
      });
    } catch (e) {
      if (e.code === 'guest_link_secret_missing') return errorResponse(res, 'guest_link_secret_missing', 500);
      throw e;
    }
    const { link } = r;
    if (!r.reused) {
      createAuditLog({
        userId: req.user.id, businessId,
        action: r.replacedId ? 'guest_link.replace' : 'guest_link.create',
        targetType: 'GuestLink', targetId: link.id,
        oldValue: r.replacedId ? { link_id: r.replacedId } : undefined,
        newValue: { scope: 'workspace', can_write: link.can_write },
      });
    }
    return successResponse(res,
      { ...serializeGuestLink(link), url: r.url, contacts: [] },
      r.reused ? 'reused' : 'issued', r.reused ? 200 : 201);
  } catch (err) { next(err); }
});

// ── DELETE /api/businesses/:businessId/customer-entry/link/:linkId ─────────
//   회수 — 즉시 404 가 된다. 자식(확인을 마친 개인 링크)도 **같이** 닫힌다(revokeGuestLink).
router.delete('/:businessId/customer-entry/link/:linkId', authenticateToken, attachWorkspaceScope(), async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    if (!(await assertEntryAdmin(req, businessId))) return errorResponse(res, 'forbidden', 403);
    // ★ 워크스페이스 + scope 로 좁혀서 찾는다 — id 만 믿으면 남의 워크스페이스 링크를 회수한다.
    const link = await GuestLink.findOne({
      where: {
        id: Number(req.params.linkId) || 0,
        business_id: businessId,
        scope: 'workspace',
        kind: 'shared',
      },
    });
    if (!link) return errorResponse(res, 'not_found', 404);
    const r = await revokeGuestLink(link, { userId: req.user.id });
    if (!r.already) {
      createAuditLog({
        userId: req.user.id, businessId,
        action: 'guest_link.revoke', targetType: 'GuestLink', targetId: link.id,
        oldValue: { scope: 'workspace' },
      });
    }
    return successResponse(res, { revoked: true });
  } catch (err) { next(err); }
});

module.exports = router;
