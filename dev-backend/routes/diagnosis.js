// 무료 업무체계 자가진단 (#426) — 공개 접수 + 결과 메일 + 관리자 통계.
//
//   POST /api/diagnosis              — 공개(무인증). 답 12개 → 서버가 점수를 센다. 응답에 1시간짜리 claim 키.
//   POST /api/diagnosis/claim        — 공개. 결과를 본 뒤 «메일로 받기» — claim 으로 **같은 응답**에 이메일을 붙인다
//                                       (다시 제출하면 응답이 두 번 세진다). 한 응답에 한 번.
//   GET  /api/diagnosis/admin/stats  — platform_admin. 응답 수 · 층별 평균 · 가장 약한 층·업종·인원 분포.
//   설계 docs/FREE_DIAGNOSIS_DESIGN.md.
//
//   ★ 무인증 표면 — LLM 을 부르지 않는다(결과 문장은 화면에 미리 쓴 문구). IP 제한은 문의 폼과 같은 방식.
//   ★ 이메일을 남기면 결과 메일 1통 + 관리자 문의 인박스(kind='diagnosis'). 같은 주소로 24시간 안에 이미 보냈으면
//     메일은 보내지 않는다(남의 주소를 넣어 스팸 릴레이로 쓰지 못하게 — 문의 폼과 같은 차단).
const crypto = require('crypto');
const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { perUserLimiter } = require('../middleware/costGuard');
const diag = require('../services/diagnosis');

const MSG = '진단 제출이 너무 잦습니다. 잠시 후 다시 시도해 주세요.';
const hourLimiter = perUserLimiter('diagnosis-h', { windowMs: 60 * 60 * 1000, max: 10, message: MSG });
const dayLimiter = perUserLimiter('diagnosis-d', { windowMs: 24 * 60 * 60 * 1000, max: 30, message: MSG });
const claimLimiter = perUserLimiter('diagnosis-claim', { windowMs: 60 * 60 * 1000, max: 5, message: MSG });
const CLAIM_TTL_MS = 60 * 60 * 1000;

const isValidEmail = (s) => typeof s === 'string' && s.length <= 200 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim());
const shortStr = (v, n) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

/** 이메일·동의 검증 → { email, company } | { error } */
function readContact(b) {
  if (b.email === undefined || b.email === null || String(b.email).trim() === '') return { email: null, company: null };
  if (!isValidEmail(String(b.email))) return { error: 'valid_email_required' };
  if (b.consent !== true) return { error: 'consent_required' };
  return { email: String(b.email).trim().toLowerCase(), company: shortStr(b.company, 200) };
}

/** 응답 행에 연락처를 붙인다 — 문의 인박스 1건 + (24시간 안 첫 번째면) 결과 메일 + 관리자 알림. 제출·claim 이 같은 함수. */
async function attachContact(row, { email, company }) {
  const { ContactInquiry, DiagnosisResponse } = require('../models');
  const lang = row.lang === 'en' ? 'en' : 'ko';
  const names = diag.LAYER_NAMES[lang];
  const scores = row.scores || {};
  const lines = diag.LAYERS.map((l) => `${names[l]} ${scores[l]}/4`).join(' · ');
  const inquiry = await ContactInquiry.create({
    kind: 'diagnosis', source: 'diagnosis',
    from_name: (company || email.split('@')[0]).slice(0, 100),
    from_email: email, from_company: company,
    message: `[자가진단 #${row.id}] 합계 ${row.total}/24 · 가장 약한 층 ${diag.LAYER_NAMES.ko[row.weakest]}\n${lines}`
      + `${row.industry ? `\n업종 ${row.industry}` : ''}${row.team_size ? ` · 인원 ${row.team_size}` : ''}`,
    locale: lang, status: 'new',
  });
  await row.update({ email, company, consent_at: new Date(), inquiry_id: inquiry.id, claim_hash: null });
  setImmediate(async () => {
    try {
      const since = new Date(Date.now() - 24 * 3600 * 1000);
      const prior = await DiagnosisResponse.count({ where: { email, id: { [Op.ne]: row.id }, consent_at: { [Op.gte]: since } } });
      if (prior === 0) {
        await require('../services/emailService').sendDiagnosisResultEmail({ to: email, scores, weakest: row.weakest, locale: lang, responseId: row.id });
      }
      const { notifyPlatformAdmins, APP_URL } = require('../services/platformNotify');
      await notifyPlatformAdmins({
        eventKind: 'inquiry',
        title: `자가진단 리드 #${inquiry.id} — ${company || email}`,
        body: inquiry.message.slice(0, 400),
        link: `${APP_URL}/admin/inquiries?inquiry=${inquiry.id}`,
        ctaLabel: '문의 보기', relatedEntityId: inquiry.id,
      });
    } catch (e) { console.warn('[diagnosis notify]', row.id, e.message); }
  });
}

// POST /api/diagnosis — 진단 제출(공개)
router.post('/', hourLimiter, dayLimiter, async (req, res, next) => { // audit-exempt: 익명 공개 제출 — 남길 사람 신원이 없다. 원장은 diagnosis_responses 행 자체(이메일을 남기면 문의 인박스 행도)
  try {
    const b = req.body || {};
    const r = diag.score(b.answers);
    if (!r.ok) return errorResponse(res, r.code, 400);
    const contact = readContact(b);
    if (contact.error) return errorResponse(res, contact.error, 400);
    const claim = contact.email ? null : crypto.randomBytes(24).toString('base64url');
    const { DiagnosisResponse } = require('../models');
    const row = await DiagnosisResponse.create({
      answers: b.answers, scores: r.scores, total: r.total, weakest: r.weakest,
      industry: diag.INDUSTRIES.includes(b.industry) ? b.industry : null,
      team_size: diag.TEAM_SIZES.includes(b.team_size) ? b.team_size : null,
      lang: String(b.lang || '').toLowerCase().startsWith('en') ? 'en' : 'ko',
      source: shortStr(b.source, 100),
      claim_hash: claim ? sha256(claim) : null,
    });
    if (contact.email) await attachContact(row, contact);
    // 응답 최소화 — 점수·밴드·가장 약한 층 + claim(메일 받기용). 내부 id·이메일 없음.
    return successResponse(res, { scores: r.scores, total: r.total, weakest: r.weakest, bands: r.bands, claim }, 'submitted', 201);
  } catch (err) { next(err); }
});

// POST /api/diagnosis/claim — 결과를 본 뒤 메일로 받기(공개)  { claim, email, company?, consent:true }
router.post('/claim', claimLimiter, async (req, res, next) => { // audit-exempt: 익명 공개 — 같은 응답 행에 연락처·동의 시각을 적고 문의 인박스 행을 만든다(그 둘이 기록이다)
  try {
    const b = req.body || {};
    const contact = readContact(b);
    if (contact.error) return errorResponse(res, contact.error, 400);
    if (!contact.email) return errorResponse(res, 'valid_email_required', 400);
    const { DiagnosisResponse } = require('../models');
    const row = await DiagnosisResponse.findOne({
      where: { claim_hash: sha256(String(b.claim || '')), email: null, created_at: { [Op.gte]: new Date(Date.now() - CLAIM_TTL_MS) } },
    });
    if (!row || !b.claim) return errorResponse(res, 'claim_expired', 404);
    await attachContact(row, contact);
    return successResponse(res, { sent: true });
  } catch (err) { next(err); }
});

// GET /api/diagnosis/admin/stats — 관리자 통계
router.get('/admin/stats', authenticateToken, requireRole('platform_admin'), async (req, res, next) => {
  try {
    return successResponse(res, await diag.stats(Number(req.query.days) || 90));
  } catch (err) { next(err); }
});

module.exports = router;
