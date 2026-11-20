// routes/public_workspace.js — 공개 회사 페이지·회사 찾기 **무인증** API (P3 · 2026-11-20 · docs/WORKSPACE_PUBLIC_PAGE_DESIGN.md §3)
//
//   GET  /api/public/workspaces/:slug            — 공개 페이지 본문(publicPageView)
//   GET  /api/public/directory?category&region&q&page — 회사 찾기 카드 20개씩 + 업종별 개수
//   POST /api/public/workspaces/:slug/inquiries  — 문의 폼(창구 문과 **같은 함수** services/workspaceInquiry.submit)
//   POST /api/public/workspaces/:slug/report     — 이 페이지 신고 → PlanQ 운영팀(contact_inquiries kind='report')
//
// ★ 인증 라우트와 섞지 않는다(파일을 나눈다). 전부 IP 한도.
// ★ «공개인가» 는 services/workspacePage.isPubliclyListed **한 술어** — 없음·꺼짐·승인 대기·내림·자격 없음·전체 스위치 꺼짐은
//   **같은 404 본문**이다(공개를 안 켠 워크스페이스의 존재를 드러내지 않는다 — 열거 방지).
// ★ 응답 모양은 publicPageView/directoryCard 화이트리스트 — 가린 항목·id·owner·plan·permissions 원문은 나가지 않는다.
const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const { Business, ContactInquiry } = require('../models');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const wp = require('../services/workspacePage');
const { submit, InquiryError } = require('../services/workspaceInquiry');

const lim = (name, windowMs, max) => rateLimit({
  windowMs, max, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (r) => `${name}-${ipKeyGenerator(r.ip)}`,
  message: { success: false, message: 'too_many_requests' },
});
const readLimit = lim('pubws-r', 60 * 1000, 60);
// 문의 한도는 창구 문과 **같은 리미터 인스턴스**(저장소 공유) — 두 문을 오가며 한도를 두 배로 쓰지 못하게
const { ipHour: inquiryHour, ipDay: inquiryDay } = require('./guest_inquiry');
const reportLimit = lim('pubws-rep', 60 * 60 * 1000, 3);

const NOT_FOUND = (res) => errorResponse(res, 'not_found', 404);
const langOf = (req) => (req.query.lang === 'en' || (req.body && req.body.locale === 'en') ? 'en' : 'ko');

/** 슬러그로 공개된 워크스페이스 — 아니면 null(부르는 쪽은 같은 404). */
async function listedBySlug(slug) {
  const s = String(slug || '').toLowerCase();
  if (wp.slugProblem(s)) return null;
  const biz = await Business.findOne({ where: { slug: s }, attributes: [...wp.PUBLIC_ATTRS, 'guest_links_enabled'] });
  return (await wp.isPubliclyListed(biz)) ? biz : null;
}

router.get('/workspaces/:slug', readLimit, async (req, res, next) => {
  try {
    const biz = await listedBySlug(req.params.slug);
    if (!biz) return NOT_FOUND(res);
    // 예약·채팅 버튼이 갈 곳 — 살아 있는 창구 링크(게스트 링크가 켜진 워크스페이스만). 없으면 버튼이 없다
    let entryUrl = null;
    if (biz.guest_links_enabled !== false) {
      const { findLiveSharedLink, urlForSharedLink } = require('../services/guest_link');
      const live = await findLiveSharedLink({ businessId: biz.id, scope: 'workspace' });
      entryUrl = live ? urlForSharedLink(live) : null;
    }
    res.set('Cache-Control', 'no-store');
    return successResponse(res, wp.publicPageView(biz, { lang: langOf(req), entryUrl }));
  } catch (err) { next(err); }
});

router.get('/directory', readLimit, async (req, res, next) => {
  try {
    if (!(await wp.publicPagesOn())) return NOT_FOUND(res);   // 전체 끄기 — 회사 찾기도 닫는다(Fable N6)
    const { listedBusinesses } = require('../services/seoWorkspacePages');
    const lang = langOf(req);
    const category = wp.CATEGORIES.includes(req.query.category) ? req.query.category : null;
    const region = wp.REGIONS.includes(req.query.region) ? req.query.region : null;
    const qRaw = String(req.query.q || '').trim().slice(0, 40);
    const q = qRaw.length >= 2 ? qRaw : '';
    const page = Math.max(1, Math.min(50, Number(req.query.page) || 1));
    const PER = 20;
    const all = await listedBusinesses();
    // 업종별 개수는 지역·검색어를 건 뒤 업종만 풀고 센다(칩 숫자 = 그 칩을 누르면 나올 수)
    const base = all.filter((b) => (!region || b.public_region === region) && (!q || wp.matchesQuery(b, q)));
    const counts = {};
    for (const b of base) if (b.public_category) counts[b.public_category] = (counts[b.public_category] || 0) + 1;
    const rows = base.filter((b) => !category || b.public_category === category)
      .sort((a, b) => new Date(b.updatedAt || b.public_published_at || 0) - new Date(a.updatedAt || a.public_published_at || 0));
    const slice = rows.slice((page - 1) * PER, page * PER);
    res.set('Cache-Control', 'no-store');
    return successResponse(res, {
      items: slice.map((b) => wp.directoryCard(b, { lang })),
      total: rows.length,
      all_total: all.length,
      counts,
      page, has_more: page * PER < rows.length,
    });
  } catch (err) { next(err); }
});

// audit-exempt: 감사는 접수 함수 안에서 한다 — services/workspaceInquiry.submit 의 createAuditLog(inquiry.receive)
router.post('/workspaces/:slug/inquiries', inquiryHour, inquiryDay, async (req, res, next) => {
  try {
    const biz = await listedBySlug(req.params.slug);
    if (!biz) return NOT_FOUND(res);
    await submit({ business: biz, via: 'public_page', input: req.body, ip: req.ip, locale: req.body && req.body.locale, ioApp: req.app });
    return successResponse(res, { received: true }, 'received', 201);
  } catch (e) {
    if (e instanceof InquiryError) return errorResponse(res, e.code, e.status);
    return next(e);
  }
});

const REPORT_REASONS = ['spam', 'fake', 'inappropriate', 'other'];
// audit-exempt: 원장은 contact_inquiries(kind='report') 행 자체 — 무인증 신고라 행위자가 없다
router.post('/workspaces/:slug/report', reportLimit, async (req, res, next) => {
  try {
    const biz = await listedBySlug(req.params.slug);
    if (!biz) return NOT_FOUND(res);
    const b = req.body || {};
    const reason = REPORT_REASONS.includes(b.reason) ? b.reason : null;
    if (!reason) return errorResponse(res, 'invalid_reason', 400);
    const note = String(b.note || '').trim().slice(0, 300);
    const email = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(b.email || '').trim()) ? String(b.email).trim().slice(0, 200) : 'anonymous@report.planq.kr';
    const row = await ContactInquiry.create({
      kind: 'report', source: 'public_page', business_id: biz.id,
      from_name: '공개 페이지 신고', from_email: email,
      message: `[${reason}] /w/${biz.slug}${note ? `\n${note}` : ''}`,
      locale: langOf(req),
    });
    setImmediate(() => {
      const { notifyPlatformAdmins, APP_URL } = require('../services/platformNotify');
      notifyPlatformAdmins({
        eventKind: 'inquiry',
        title: `공개 페이지 신고 — ${biz.brand_name || biz.name}`,
        body: `사유 ${reason} · /w/${biz.slug}`,
        link: `${APP_URL}/admin/public-pages?status=public`,
        ctaLabel: '공개 페이지 관리',
        relatedEntityId: row.id,
      }).catch(() => null);
    });
    return successResponse(res, { received: true }, 'received', 201);
  } catch (err) { next(err); }
});

module.exports = router;
