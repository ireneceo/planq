// 화상 업무설계·사용안내 신청 — 판정·입력 정규화 한 곳 (docs/ONBOARDING_CALL_DESIGN.md · Fable 설계 PASS 2026-10-22).
//
// ★ 노출(/api/plan/:biz/status.onboarding_call)과 접수(POST /api/inquiries 의 로그인+워크스페이스 경로)가
//   **같은 함수(availability)** 를 쓴다. 화면만 숨기고 서버가 받아 주면 술어가 두 벌이 된다.
// ★ 신청은 contact_inquiries 원장의 한 종류(kind='onboarding_call')다. 시간 확정·회의 링크는 플랫폼 관리자가
//   메일로 직접 보낸다 — 자동 예약 엔진(services/booking.js)은 «워크스페이스 → 그 고객» 의 것이라 쓰지 않는다.
const { Op } = require('sequelize');
const { ContactInquiry, BusinessMember } = require('../models');
const planEngine = require('./plan');

const KIND = 'onboarding_call';
const OPEN_STATUSES = ['new', 'in_progress'];
const PARTS = ['morning', 'afternoon', 'evening'];
const TEAM_SIZES = ['solo', '2_5', '6_20', '21_plus'];
const MAX_SLOTS = 3;
const MAX_TEXT = 200;

function validTimezone(tz) {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return null;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz; } catch { return null; }
}

/** 그 시간대의 오늘 날짜 'YYYY-MM-DD' */
function todayIn(tz) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date());
  const get = (t) => parts.find(p => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function cleanText(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
  return s || null;
}

class OnboardingCallError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}

/**
 * 신청 내용 정규화 — 아는 키만 남긴다(화이트리스트). 잘못된 값은 400 코드로 던진다.
 * @returns {{ details: object, timezone: string }}
 */
function normalizeDetails(raw, timezoneRaw) {
  const d = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const timezone = validTimezone(timezoneRaw) || 'Asia/Seoul';
  const today = todayIn(timezone);

  const slotsIn = Array.isArray(d.slots) ? d.slots : [];
  if (slotsIn.length < 1) throw new OnboardingCallError('onboarding_slots_required');
  if (slotsIn.length > MAX_SLOTS) throw new OnboardingCallError('onboarding_slots_too_many');
  const seen = new Set();
  const slots = slotsIn.map((s) => {
    const date = s && typeof s.date === 'string' ? s.date : '';
    const part = s && typeof s.part === 'string' ? s.part : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
      throw new OnboardingCallError('onboarding_slot_invalid');
    }
    if (!PARTS.includes(part)) throw new OnboardingCallError('onboarding_slot_invalid');
    if (date <= today) throw new OnboardingCallError('onboarding_slot_past');
    const key = `${date}|${part}`;
    if (seen.has(key)) throw new OnboardingCallError('onboarding_slot_duplicate');
    seen.add(key);
    return { date, part };
  });

  const teamSize = TEAM_SIZES.includes(d.team_size) ? d.team_size : null;
  return {
    timezone,
    details: {
      slots,
      team_size: teamSize,
      current_tools: cleanText(d.current_tools),
      focus: cleanText(d.focus),
    },
  };
}

/** 관리자 목록이 그대로 읽을 요약 본문 — 정규화한 값으로 서버가 만든다(화면이 보낸 message 를 믿지 않는다). */
function summaryMessage(details, timezone, extra) {
  const lines = [
    `[화상 안내 신청] 희망 시간 (${timezone})`,
    ...details.slots.map((s, i) => `  ${i + 1}. ${s.date} ${({ morning: '오전', afternoon: '오후', evening: '저녁' })[s.part]}`),
  ];
  if (details.team_size) lines.push(`인원: ${details.team_size}`);
  if (details.current_tools) lines.push(`지금 쓰는 도구: ${details.current_tools}`);
  if (details.focus) lines.push(`먼저 맞추고 싶은 일: ${details.focus}`);
  const note = cleanText(extra);
  if (note) lines.push(`메모: ${note}`);
  return lines.join('\n');
}

async function openRequestOf(businessId) {
  return ContactInquiry.findOne({
    where: { business_id: businessId, kind: KIND, status: { [Op.in]: OPEN_STATUSES } },
    attributes: ['id', 'createdAt'],
    order: [['createdAt', 'DESC']],
  });
}

/**
 * 이 워크스페이스·사람에게 «화상 안내 신청» 을 보여 주고 받아도 되는가.
 *   in_trial ∧ ¬exempt ∧ role ∈ {owner, admin} ∧ 열린 신청 0건
 * @returns {{ available: boolean, reason: string|null, requested_at: Date|null, plan: string|null, trial_ends_at: Date|null }}
 */
async function availability(businessId, userId) {
  const bid = Number(businessId);
  const out = { available: false, reason: null, requested_at: null, plan: null, trial_ends_at: null };
  if (!bid || !userId) { out.reason = 'no_scope'; return out; }
  const [bp, member, open] = await Promise.all([
    planEngine.getBusinessPlan(bid),
    BusinessMember.findOne({ where: { business_id: bid, user_id: userId, removed_at: null }, attributes: ['role'] }),
    openRequestOf(bid),
  ]);
  out.plan = bp && bp.plan ? bp.plan.code : null;
  out.trial_ends_at = bp ? bp.trialEndsAt || null : null;
  if (open) out.requested_at = open.createdAt;   // underscored 모델 — 속성 이름은 createdAt(칸 이름은 created_at)
  if (!bp || !bp.inTrial) { out.reason = 'not_trial'; return out; }
  if (bp.exempt) { out.reason = 'exempt'; return out; }
  if (!member || !['owner', 'admin'].includes(member.role)) { out.reason = 'role'; return out; }
  if (open) { out.reason = 'already_requested'; return out; }
  out.available = true;
  return out;
}

module.exports = {
  KIND, OPEN_STATUSES, PARTS, TEAM_SIZES, MAX_SLOTS,
  OnboardingCallError, normalizeDetails, summaryMessage, availability, validTimezone, todayIn,
};
