// services/workspaceInquiry.js — 공개 페이지·창구 **문의 접수** 한 곳 (2026-11-20)
//
//   설계: docs/WORKSPACE_PUBLIC_PAGE_DESIGN.md §5 (Irene 결정 ② 접수 확인 메일 보냄 · ③ 신규 문의함 → 한 번 눌러 고객 등록)
//
// ★ 문은 둘(창구 링크 `/api/guest/:token/inquiries` · P3 공개 주소 `/api/public/workspaces/:slug/inquiries`),
//   **함수는 하나**(submit). 베끼면 스팸 기준이 갈라진다.
// ★ 스팸 판정 기준(§5.2)은 **계약**이다 — 구현 중에 바꾸지 않는다. 바꾸려면 Fable `design`.
//     숨은 칸·3초 안 제출 = 봇 → 200 으로 답하고 저장하지 않는다
//     IP 시간당 3·하루 10(라우트 리미터) · 같은 이메일→같은 워크스페이스 하루 3 → 429
//     워크스페이스 하루 50건 넘음 → 접수는 하되 held + owner 알림 하루 1건
//     링크 3개 이상 · 같은 내용이 24시간 안 3개 워크스페이스 이상 → held(알림 없음)
//   지우지 않고 **보류**한다 — 기계가 틀리면 진짜 손님을 잃는다. 보류 30일 뒤 자동 삭제(purgeOld).
// ★ 그림자 User·대화방·고객 행을 만들지 않는다(§10 하지 말 것). 고객 등록은 사람이 누른다.
// ★ 접수 확인 메일은 고정 문구 · 같은 주소 하루 1통(워크스페이스 무관) · held·봇에는 보내지 않는다.
const crypto = require('crypto');
const { Op } = require('sequelize');

const LIMITS = {
  NAME_MAX: 100, EMAIL_MAX: 200, PHONE_MAX: 40, COMPANY_MAX: 200,
  MSG_MIN: 10, MSG_MAX: 2000,
  MIN_FILL_MS: 3000,          // 폼을 연 지 3초 안 제출 = 봇
  EMAIL_PER_BIZ_DAY: 3,       // 같은 이메일 → 같은 워크스페이스 하루
  BIZ_DAY: 50,                // 워크스페이스 하루 — 넘으면 held
  LINKS_HOLD: 3,              // 본문 링크 3개 이상 = held
  DUP_BIZ_HOLD: 3,            // 같은 내용이 24시간 안 3개 워크스페이스 이상 = held
};
const DAY = 24 * 3600 * 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
/** IP 는 원문을 남기지 않는다 — 하루 바뀌는 비밀을 섞은 해시(한도·판정용). */
function ipHash(ip) {
  const day = new Date().toISOString().slice(0, 10);
  return sha(`${process.env.JWT_SECRET || 'planq'}:${day}:${ip || ''}`);
}
/** 같은 내용 판정 — 공백·대소문자를 접는다(복사해 뿌린 글은 같은 해시가 된다). */
const messageHash = (m) => sha(String(m).toLowerCase().replace(/\s+/g, ' ').trim());
const countLinks = (m) => (String(m).match(/https?:\/\/|www\./gi) || []).length;

class InquiryError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}

/** 이 워크스페이스의 팀 알림 받는 사람 — 오너·관리자(담당 귀속은 고객이 생긴 뒤 saleNotify 가 맡는다). */
async function teamRecipients(businessId) {
  const { BusinessMember } = require('../models');
  const rows = await BusinessMember.findAll({
    where: { business_id: businessId, removed_at: null, role: { [Op.in]: ['owner', 'admin'] } },
    attributes: ['user_id'], raw: true,
  });
  return [...new Set(rows.map((r) => r.user_id).filter(Boolean))];
}

async function notifyTeam(businessId, { action, detail, body, entityId, ioApp }) {
  const { notify } = require('../routes/notifications');
  const ids = await teamRecipients(businessId);
  for (const userId of ids) {
    try {
      await notify({
        userId, businessId, eventKind: 'sale',
        titleSpec: { feature: 'sale', action, detail },
        body: body || null,
        link: `/sale?tab=inbox&inquiry=${entityId}`,
        entityType: 'workspace_inquiry', entityId, ioApp,
      });
    } catch (e) { console.warn('[workspaceInquiry] notify 실패', e.message); }
  }
  return ids.length;
}

/** 실시간 — 신호만(행 전체를 방에 뿌리지 않는다 · security-detail «실시간 방송은 신호만»). */
function emitSignal(ioApp, businessId, id) {
  try {
    const io = ioApp && (ioApp.get ? ioApp.get('io') : ioApp);
    if (io && io.to) io.to(`business:${businessId}`).emit('inquiry:updated', { id, business_id: businessId });
  } catch { /* 실시간은 덤 — 접수는 이미 끝났다 */ }
}

/**
 * 접수 확인 메일 — 고정 문구 · 같은 주소 하루 1통(워크스페이스 무관, EmailLog 로 판정).
 * 실패해도 던지지 않는다(접수는 이미 성공).
 */
async function sendAck(row, biz) {
  try {
    const { EmailLog } = require('../models');
    const recent = await EmailLog.count({
      where: { template: 'workspace_inquiry_ack', to_email: row.email, created_at: { [Op.gte]: new Date(Date.now() - DAY) } },
    });
    if (recent > 0) return { sent: false, reason: 'daily_cap' };
    const { findLiveSharedLink, urlForSharedLink } = require('./guest_link');
    const live = await findLiveSharedLink({ businessId: biz.id, scope: 'workspace' });
    const wsName = biz.brand_name || biz.name;
    const replyTo = biz.email && EMAIL_RE.test(biz.email) ? biz.email : null;
    const { sendWorkspaceInquiryAckEmail } = require('./emailService');
    const r = await sendWorkspaceInquiryAckEmail({
      to: row.email, locale: row.locale, workspaceName: wsName,
      entryUrl: live ? urlForSharedLink(live) : null,
      fromName: `${wsName} (PlanQ)`.slice(0, 120), replyTo,
      businessId: biz.id, inquiryId: row.id,
    });
    // dev 는 발송이 꺼져 있어 'skipped' 로 남는다 — 장부(EmailLog)에는 남는다
    if (r && (r.status === 'sent' || r.status === 'skipped')) {
      await row.update({ ack_sent_at: new Date() }, { silent: true });
    }
    return { sent: r && r.status === 'sent', status: r && r.status };
  } catch (e) {
    console.warn('[workspaceInquiry] 접수 확인 메일 실패', row && row.id, e.message);
    return { sent: false, reason: 'error' };
  }
}

/**
 * 문의 접수 — 두 문이 같이 부른다.
 * @param {object} p { business(Business 행: id·name·brand_name·email·permissions), via, input, ip, locale, ioApp }
 * @returns {Promise<{ ok:true, id?:number, status?:string, bot?:boolean }>}
 * @throws InquiryError(code, status)
 */
async function submit({ business, via, input, ip, locale, ioApp }) {
  const { WorkspaceInquiry } = require('../models');
  const { entryOf } = require('./workspacePage');
  if (!business || business.deleted_at) throw new InquiryError('not_found', 404);
  const entry = entryOf(business);
  if (!entry.form.enabled) throw new InquiryError('form_disabled', 403);
  const b = input && typeof input === 'object' ? input : {};

  // ① 봇 — 숨은 칸이 채워졌거나 3초 안에 보냈다. 200 으로 답하고 저장하지 않는다(봇에게 신호를 주지 않는다).
  const elapsed = Number(b.elapsed_ms);
  if (str(b.hp, 200) || !Number.isFinite(elapsed) || elapsed < LIMITS.MIN_FILL_MS) return { ok: true, bot: true };

  // ② 입력 검증 — 틀리면 400(폼 아래에 이유가 보인다 · 조용한 실패 금지)
  const name = str(b.name, LIMITS.NAME_MAX);
  const email = str(b.email, LIMITS.EMAIL_MAX).toLowerCase();
  const message = str(b.message, LIMITS.MSG_MAX);
  if (!name) throw new InquiryError('name_required');
  if (!EMAIL_RE.test(email)) throw new InquiryError('invalid_email');
  if (message.length < LIMITS.MSG_MIN) throw new InquiryError('message_too_short');
  if (b.consent !== true) throw new InquiryError('consent_required');
  const phone = entry.form.ask_phone ? (str(b.phone, LIMITS.PHONE_MAX) || null) : null;
  const company = entry.form.ask_company ? (str(b.company, LIMITS.COMPANY_MAX) || null) : null;
  // 관심 서비스 — 이 워크스페이스에 **지금 있는** 카드만. 이름은 접수 시점 사본으로 남긴다.
  const svc = b.service_id ? entry.services.find((s) => s.id === String(b.service_id)) : null;

  // ③ 같은 이메일 → 같은 워크스페이스 하루 3
  const since = new Date(Date.now() - DAY);
  const sameMail = await WorkspaceInquiry.count({
    where: { business_id: business.id, email, created_at: { [Op.gte]: since } },
  });
  if (sameMail >= LIMITS.EMAIL_PER_BIZ_DAY) throw new InquiryError('too_many_inquiries', 429);

  // ④ 보류 판정 — 링크 많음 · 같은 내용을 여러 워크스페이스에 · 워크스페이스 하루 상한
  const mh = messageHash(message);
  let status = 'new';
  let heldReason = null;
  if (countLinks(message) >= LIMITS.LINKS_HOLD) { status = 'held'; heldReason = 'links'; }
  if (status === 'new') {
    const dup = await WorkspaceInquiry.findAll({
      where: { message_hash: mh, created_at: { [Op.gte]: since }, business_id: { [Op.ne]: business.id } },
      attributes: ['business_id'], group: ['business_id'], raw: true,
    });
    if (dup.length + 1 >= LIMITS.DUP_BIZ_HOLD) { status = 'held'; heldReason = 'duplicate'; }
  }
  let floodStart = false;
  if (status === 'new') {
    const today = await WorkspaceInquiry.count({ where: { business_id: business.id, created_at: { [Op.gte]: since } } });
    if (today >= LIMITS.BIZ_DAY) {
      status = 'held'; heldReason = 'flood';
      // 오너 알림은 하루 1건 — 오늘 이미 flood 로 보류한 것이 있으면 알리지 않는다
      floodStart = (await WorkspaceInquiry.count({
        where: { business_id: business.id, held_reason: 'flood', created_at: { [Op.gte]: since } },
      })) === 0;
    }
  }

  const row = await WorkspaceInquiry.create({
    business_id: business.id, status, via,
    name, email, phone, company, message,
    service_id: svc ? svc.id : null,
    service_name: svc ? svc.name.slice(0, 80) : null,
    locale: locale === 'en' ? 'en' : 'ko',
    ip_hash: ipHash(ip), message_hash: mh, held_reason: heldReason,
  });

  // 감사 — 행위자 없음(무인증 접수). 내용은 남기지 않는다(개인정보 — 원장은 이 표다).
  try {
    const { createAuditLog } = require('./auditService');
    createAuditLog({
      userId: null, businessId: business.id, action: 'inquiry.receive',
      targetType: 'workspace_inquiry', targetId: row.id,
      newValue: { via, status, held_reason: heldReason, service_id: row.service_id },
    });
  } catch { /* 감사 실패가 접수를 막지 않는다 */ }

  emitSignal(ioApp, business.id, row.id);
  if (status === 'new') {
    await notifyTeam(business.id, {
      action: 'sale_new_inquiry', detail: name,
      body: row.service_name || null, entityId: row.id, ioApp,
    });
    await sendAck(row, business);
  } else if (floodStart) {
    await notifyTeam(business.id, { action: 'sale_inquiry_flood', detail: null, body: null, entityId: row.id, ioApp });
  }
  return { ok: true, id: row.id, status };
}

/** 보존 — 보류·스팸 30일 · 고객으로 등록되지 않은 신규·처리 1년(등록됐으면 고객 데이터로 남는다). */
// cronalive-exempt: 보존기간 삭제 — 지운 워크스페이스의 문의도 기간이 지나면 지워야 한다(워크스페이스 삭제 정리와 무관하게)
async function purgeOld(now = new Date()) {
  const { WorkspaceInquiry } = require('../models');
  const d30 = new Date(now.getTime() - 30 * DAY);
  const d365 = new Date(now.getTime() - 365 * DAY);
  const a = await WorkspaceInquiry.destroy({ where: { status: { [Op.in]: ['held', 'spam'] }, created_at: { [Op.lt]: d30 } } });
  const b = await WorkspaceInquiry.destroy({
    where: { status: { [Op.in]: ['new', 'handled'] }, client_id: null, created_at: { [Op.lt]: d365 } },
  });
  return { held_spam: a, stale: b };
}

module.exports = { submit, purgeOld, InquiryError, LIMITS, messageHash, emitSignal, teamRecipients };
