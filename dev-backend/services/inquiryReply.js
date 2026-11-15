// 문의 직접 회신 — PlanQ 가 문의자에게 관리자 글을 보내고 그 결과를 문의 기록(contact_inquiry_replies)에 남기는 **한 문**.
//
// Irene 2026-11-15: «개발에 제대로 되게 할거야» · 설계 docs/INQUIRY_DIRECT_REPLY_DESIGN.md (Fable DESIGN: FIX 6건 반영).
//
// 순서(Fable 1): 문의 행을 FOR UPDATE 로 잠근 트랜잭션 안에서 스팸·같은 본문 60초·문의당 하루 10통 검사 + `sending` 행 생성 → 커밋
//   → SMTP 는 트랜잭션 밖 → 결과로 행 갱신. 동시에 두 번 눌러도 두 번째는 첫 행을 보고 409.
// 문의의 replied_at·replied_by_user_id 는 건드리지 않는다(Fable 3 — 내부 노트 저장이 덮는 칸이다). «회신함» 은 이 표에서 읽는다.
// 성공이면 new → in_progress 만 조건부 UPDATE(Fable 4 — 그사이 다른 관리자가 바꾼 상태를 덮지 않는다).
const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const { ContactInquiry, ContactInquiryReply, User } = require('../models');
const emailService = require('./emailService');
const { writeAudit } = require('./auditService');

const BODY_MAX = 10000;
const DUP_WINDOW_MS = 60 * 1000;
const PER_INQUIRY_DAY = 10;
// 이보다 오래 `sending` 이면 서버가 중간에 멈춘 것 — «결과 확인 안 됨» 으로 보인다(실패 아님 · Fable 2).
const STUCK_MS = 5 * 60 * 1000;

class InquiryReplyError extends Error {
  constructor(code, status) { super(code); this.code = code; this.status = status; }
}

function isValidEmail(s) {
  // 받는 주소 한 개만 — 쉼표·세미콜론·꺾쇠·따옴표가 들면 거절(공개 폼 값이라 «a@x.com,b» 같은 것이 들어올 수 있다 · Fable N2)
  return typeof s === 'string' && /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]{2,}$/.test(s.trim());
}

// 화면에 보이는 상태 — 저장된 status 에 «멈춤» 판정 하나만 더한다. 행은 바꾸지 않는다.
function displayStatus(row, now = Date.now()) {
  if (row.status === 'sending' && now - new Date(row.created_at).getTime() > STUCK_MS) return 'unknown';
  return row.status;
}

function toView(row, now = Date.now()) {
  const j = typeof row.toJSON === 'function' ? row.toJSON() : row;
  return {
    id: j.id,
    inquiry_id: j.inquiry_id,
    to_email: j.to_email,
    subject: j.subject,
    body: j.body,
    locale: j.locale,
    status: displayStatus(j, now),
    error_message: j.error_message || null,
    sent_at: j.sent_at || null,
    created_at: j.created_at,
    sent_by: j.sentBy ? { id: j.sentBy.id, name: j.sentBy.name } : null,
  };
}

async function listReplies(inquiryId) {
  const rows = await ContactInquiryReply.findAll({
    where: { inquiry_id: inquiryId },
    include: [{ model: User, as: 'sentBy', attributes: ['id', 'name'], required: false }],
    order: [['created_at', 'ASC'], ['id', 'ASC']],
  });
  const now = Date.now();
  return rows.map(r => toView(r, now));
}

/**
 * @param {object} p
 * @param {number} p.inquiryId
 * @param {string} p.body          관리자가 쓴 회신 본문
 * @param {number} p.userId        보내는 플랫폼 관리자
 * @param {string} [p.ip]
 * @param {boolean} [p.close]     «보내고 완료로 닫기» — 보낸 것이 확인(sent)됐을 때만 new·in_progress → resolved (Fable 2026-11-15)
 * @returns {Promise<{reply:object, inquiry_status:string, closed:boolean}>}
 */
async function sendInquiryReply({ inquiryId, body, userId, ip, close: closeArg = false }) {
  const close = closeArg === true; // 문자열 'false' 등은 닫지 않는다(Fable 검증 N2)
  const text = String(body == null ? '' : body).replace(/\r\n/g, '\n').trim();
  if (!text) throw new InquiryReplyError('reply_body_required', 400);
  if (text.length > BODY_MAX) throw new InquiryReplyError('reply_body_too_long', 400);

  // ① 잠금 안에서 검사 + 행 만들기
  const { reply, inquiry } = await sequelize.transaction(async (t) => {
    const inq = await ContactInquiry.findByPk(inquiryId, { transaction: t, lock: t.LOCK.UPDATE });
    if (!inq) throw new InquiryReplyError('not_found', 404);
    if (inq.status === 'spam') throw new InquiryReplyError('inquiry_spam', 409);
    const to = String(inq.from_email || '').trim().toLowerCase();
    if (!isValidEmail(to)) throw new InquiryReplyError('invalid_recipient', 400);

    const now = Date.now();
    const dup = await ContactInquiryReply.findOne({
      where: {
        inquiry_id: inq.id, body: text,
        status: { [Op.in]: ['sending', 'sent'] },
        created_at: { [Op.gte]: new Date(now - DUP_WINDOW_MS) },
      },
      attributes: ['id'], transaction: t,
    });
    if (dup) throw new InquiryReplyError('duplicate_reply', 409);

    const dayCount = await ContactInquiryReply.count({
      where: {
        inquiry_id: inq.id,
        status: { [Op.in]: ['sending', 'sent'] },
        created_at: { [Op.gte]: new Date(now - 24 * 60 * 60 * 1000) },
      },
      transaction: t,
    });
    if (dayCount >= PER_INQUIRY_DAY) throw new InquiryReplyError('reply_daily_limit', 429);

    const locale = String(inq.locale || '').toLowerCase().startsWith('en') ? 'en' : 'ko';
    const row = await ContactInquiryReply.create({
      inquiry_id: inq.id,
      sent_by_user_id: userId,
      to_email: to,
      subject: emailService.inquiryReplySubject({ inquiryId: inq.id, locale }),
      body: text,
      locale,
      status: 'sending',
    }, { transaction: t });
    return { reply: row, inquiry: inq };
  });

  // ② 트랜잭션 밖에서 보낸다
  let result;
  try {
    result = await emailService.sendInquiryReplyEmail({
      to: reply.to_email,
      subject: reply.subject,
      body: reply.body,
      originalMessage: inquiry.message,
      inquiredAt: inquiry.created_at,
      locale: reply.locale,
      replyId: reply.id,
      initiatedBy: userId,
    });
  } catch (e) {
    result = { status: 'failed', error: String(e && e.message || 'send_failed').slice(0, 1000) };
  }

  const patch = { status: result.status, error_message: result.status === 'sent' ? null : (result.error || null) };
  if (result.status === 'sent') patch.sent_at = new Date();
  await reply.update(patch);

  let inquiryStatus = inquiry.status;
  let closed = false;
  if (result.status === 'sent') {
    // 닫기는 보낼 때마다 관리자가 고른다(자동 resolved 안 함). 실패·건너뜀이면 상태를 건드리지 않는다.
    //   조건부 UPDATE — 그사이 다른 관리자가 스팸·해결로 바꿨으면 0행(오류 아님).
    if (close) {
      const [n] = await ContactInquiry.update(
        { status: 'resolved' },
        { where: { id: inquiry.id, status: { [Op.in]: ['new', 'in_progress'] } } },
      );
      closed = n > 0;
    }
    if (!closed) {
      await ContactInquiry.update(
        { status: 'in_progress' },
        { where: { id: inquiry.id, status: 'new' } },
      );
    }
    const fresh = await ContactInquiry.findByPk(inquiry.id, { attributes: ['status'] });
    inquiryStatus = fresh ? fresh.status : inquiryStatus;
  }

  // 감사 — 본문 원문은 싣지 않는다(이 표에 있다)
  try {
    await writeAudit({
      userId, action: 'inquiry.reply_send', targetType: 'contact_inquiry', targetId: inquiry.id,
      oldValue: closed ? { inquiry_status: inquiry.status } : undefined,
      newValue: { reply_id: reply.id, status: result.status, to_email: reply.to_email, length: reply.body.length, error: patch.error_message || null, close_requested: !!close, closed, ...(closed ? { inquiry_status: 'resolved' } : {}) },
      ipAddress: ip || null,
    });
  } catch (e) { console.warn('[inquiryReply] audit failed', e.message); }

  const full = await ContactInquiryReply.findByPk(reply.id, {
    include: [{ model: User, as: 'sentBy', attributes: ['id', 'name'], required: false }],
  });
  return { reply: toView(full), inquiry_status: inquiryStatus, closed };
}

module.exports = { sendInquiryReply, listReplies, displayStatus, InquiryReplyError, STUCK_MS, PER_INQUIRY_DAY };
