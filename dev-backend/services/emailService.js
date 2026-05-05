// PlanQ 이메일 발송 서비스
//
// 7 종 템플릿 모두 공통 layout(emailWrap) 사용 — 헤더(슬로건 로고) + 본문 + 푸터(웹사이트·문의·저작권).
// 모든 메일은 발송 결과를 EmailLog 에 기록 (모니터링 페이지에서 검색·재발송 가능).

const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs');

let transporter = null;

// 로고 PNG 경로 — 인라인 cid 첨부용. 메일 클라이언트 차단·외부 fetch 실패 방지.
// dev: /opt/planq/dev-frontend-build, 운영: /opt/planq/frontend-build (디렉토리명이 달라 후보 모두 시도).
const LOGO_CID = 'planq-logo@platform';
const LOGO_CANDIDATES = [
  process.env.EMAIL_LOGO_PATH,
  path.resolve(__dirname, '..', '..', 'dev-frontend-build', 'email-logo.png'),
  path.resolve(__dirname, '..', '..', 'frontend-build', 'email-logo.png'),
  path.resolve(__dirname, '..', '..', 'dev-frontend', 'public', 'email-logo.png'),
].filter(Boolean);

function getLogoAttachment() {
  const file = LOGO_CANDIDATES.find((p) => { try { return fs.existsSync(p); } catch { return false; } });
  if (!file) return null;
  return {
    filename: 'planq-logo.png',
    path: file,
    cid: LOGO_CID,
    contentDisposition: 'inline',
  };
}

const getTransporter = () => {
  if (transporter) return transporter;
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER) {
    console.warn('SMTP not configured. Email sending disabled.');
    return null;
  }
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD,
    },
    // 외부 SMTP 가 hang 시 cron/요청 무한 대기 방지
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
    pool: true,
    maxConnections: 5,
    maxMessages: 100,
  });
  return transporter;
};

// 모니터링 로그 — best-effort, 실패해도 sendEmail 자체는 영향 X.
async function recordLog(payload) {
  try {
    const { EmailLog } = require('../models');
    await EmailLog.create(payload);
  } catch (e) {
    console.error('[EmailLog]', e.message);
  }
}

// ─── 플랫폼 정보 (DB platform_settings 단일 row + 5분 캐시 + .env fallback) ───
//   PlanQ 플랫폼 운영자(워프로랩) 정보. 사용자/워크스페이스 정보 아님.
//   메모 feedback_prod_equals_dev.md 정책: 운영 정보는 DB+관리자 UI 로, .env 는 시크릿만.
//   첫 배포 후엔 /admin/platform-settings UI 에서 변경, .env 는 fallback 으로만 의미.
const APP_URL = process.env.APP_URL || 'https://dev.planq.kr';
const PLATFORM_DEFAULTS = {
  brand: 'PlanQ',
  tagline: '일이 일이 되지 않게 플랜큐가 도와드립니다.',
  website: APP_URL,
  supportEmail: 'help@planq.kr',
  legalEntity: '워프로랩',
};

let _platformCache = null;
let _platformCacheExpiry = 0;
const PLATFORM_CACHE_TTL_MS = 5 * 60 * 1000;

function invalidatePlatformCache() {
  _platformCache = null;
  _platformCacheExpiry = 0;
}

async function getPlatform() {
  if (_platformCache && _platformCacheExpiry > Date.now()) return _platformCache;
  let row = null;
  try {
    const { PlatformSetting } = require('../models');
    row = await PlatformSetting.findOne({ order: [['id', 'ASC']] });
  } catch (e) {
    // DB 조회 실패 시 .env fallback 으로 graceful (sequelize 미초기화 등)
    console.warn('[emailService] getPlatform DB read failed:', e.message);
  }
  const info = {
    brand: row?.brand || process.env.PLATFORM_BRAND || PLATFORM_DEFAULTS.brand,
    tagline: row?.tagline || process.env.PLATFORM_TAGLINE || PLATFORM_DEFAULTS.tagline,
    website: row?.website || process.env.PLATFORM_WEBSITE || PLATFORM_DEFAULTS.website,
    supportEmail: row?.support_email || process.env.PLATFORM_SUPPORT_EMAIL || PLATFORM_DEFAULTS.supportEmail,
    legalEntity: row?.legal_entity || process.env.PLATFORM_LEGAL_ENTITY || PLATFORM_DEFAULTS.legalEntity,
    copyrightYear: new Date().getFullYear(),
    logoUrl: row?.email_logo_url || process.env.EMAIL_LOGO_URL || `${APP_URL}/email-logo.png`,
  };
  _platformCache = info;
  _platformCacheExpiry = Date.now() + PLATFORM_CACHE_TTL_MS;
  return info;
}

// 동기 호출 호환 — 캐시된 값이 있으면 반환, 없으면 .env fallback.
// 비동기 호출 못하는 위치 (모듈 초기화 시점 등) 에서 fallback 값 보장.
function getPlatformSync() {
  return _platformCache || {
    brand: process.env.PLATFORM_BRAND || PLATFORM_DEFAULTS.brand,
    tagline: process.env.PLATFORM_TAGLINE || PLATFORM_DEFAULTS.tagline,
    website: process.env.PLATFORM_WEBSITE || PLATFORM_DEFAULTS.website,
    supportEmail: process.env.PLATFORM_SUPPORT_EMAIL || PLATFORM_DEFAULTS.supportEmail,
    legalEntity: process.env.PLATFORM_LEGAL_ENTITY || PLATFORM_DEFAULTS.legalEntity,
    copyrightYear: new Date().getFullYear(),
    logoUrl: process.env.EMAIL_LOGO_URL || `${APP_URL}/email-logo.png`,
  };
}

// 호환 — 기존 PLATFORM 변수 이름 그대로 쓰던 코드를 위해 getter 객체로
const PLATFORM = new Proxy({}, {
  get(_t, prop) { return getPlatformSync()[prop]; },
});

// 모듈 초기화 시 캐시 워밍 (DB 가 떠 있으면 첫 메일 발송부터 DB 값 사용)
setTimeout(() => { getPlatform().catch(() => null); }, 1000);

// HTML 이스케이프
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// ─── 공통 헤더 — 슬로건 로고 (작게, 좌측 정렬, retina 4× 선명) ───
//   PNG 880×394 (실제 파일) → HTML 110px 표시 = 8배 다운샘플링 → 고해상도 디스플레이에서도 매우 선명.
//   cid 인라인 첨부로 외부 fetch 차단·SSL 무관하게 안정 표시.
function emailHeader() {
  return `
    <tr><td align="center" style="padding:24px 28px 18px;background:#FFFFFF;text-align:center;">
      <a href="${PLATFORM.website}" target="_blank" style="text-decoration:none;border:0;outline:none;display:inline-block;">
        <img src="cid:${LOGO_CID}" alt="${escapeHtml(PLATFORM.brand)}" width="110" height="49" style="display:block;border:0;outline:none;text-decoration:none;width:110px;height:49px;max-width:110px;margin:0 auto;" />
      </a>
    </td></tr>
    <tr><td style="height:3px;background:linear-gradient(90deg,#0D9488 0%,#14B8A6 100%);background-color:#0D9488;font-size:0;line-height:0;">&nbsp;</td></tr>`;
}

// ─── 공통 푸터 ───
//   [워크스페이스] 에서 발송된 메일이면 1줄: "이 메일은 [워크스페이스] 에서 발송되었습니다"
//   PlanQ 플랫폼 정보 (운영회사, 운영문의 메일, 저작권) 는 항상 별도 줄에.
//   notificationSettings: 알림설정 링크 표시 여부 (워크스페이스 멤버 알림에만)
function emailFooter(options = {}) {
  const { notificationSettings = false, workspaceName = null } = options;
  return `
    <tr><td style="padding:24px 28px 28px;border-top:1px solid #E2E8F0;background:#F8FAFC;border-bottom-left-radius:14px;border-bottom-right-radius:14px;">
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="font-size:11px;color:#64748B;line-height:1.7;">
        ${workspaceName ? `
        <tr><td align="center" style="padding-bottom:10px;">
          <span style="color:#475569;font-weight:600;">${escapeHtml(workspaceName)}</span> 에서 발송된 메일입니다
        </td></tr>` : ''}
        ${notificationSettings ? `
        <tr><td align="center" style="padding-bottom:10px;color:#94A3B8;">
          알림은 워크스페이스 설정에 따라 발송됩니다 ·
          <a href="${APP_URL}/business/settings/notifications" style="color:#0D9488;text-decoration:underline;">알림 설정 변경</a>
        </td></tr>` : ''}
        <tr><td align="center" style="padding-top:${workspaceName || notificationSettings ? '8' : '0'}px;border-top:${workspaceName || notificationSettings ? '1px solid #E2E8F0' : 'none'};">
          <a href="${PLATFORM.website}" target="_blank" style="color:#0D9488;text-decoration:none;font-weight:600;">${PLATFORM.website.replace(/^https?:\/\//, '')}</a>
          &nbsp;·&nbsp;
          <a href="mailto:${PLATFORM.supportEmail}" style="color:#0D9488;text-decoration:none;">${PLATFORM.supportEmail}</a>
          <span style="color:#CBD5E1;">&nbsp;·&nbsp;</span>
          <span style="color:#94A3B8;">PlanQ 운영팀</span>
        </td></tr>
        <tr><td align="center" style="padding-top:6px;color:#94A3B8;font-size:10px;">
          © ${PLATFORM.copyrightYear} ${escapeHtml(PLATFORM.legalEntity)} · ${escapeHtml(PLATFORM.brand)}. All rights reserved.
        </td></tr>
      </table>
    </td></tr>`;
}

// ─── 공통 layout — 헤더 + body + 푸터 ───
//   width 는 모든 템플릿 동일 520 으로 통일.
function emailWrap({ title, body, width = 520, footerOptions = {} }) {
  return `<!DOCTYPE html>
<html lang="ko"><head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <title>${escapeHtml(title || PLATFORM.brand)}</title>
</head>
<body style="margin:0;padding:0;background:#F1F5F9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Apple SD Gothic Neo','Noto Sans KR',sans-serif;color:#0F172A;-webkit-text-size-adjust:none;">
  <div style="display:none;max-height:0;overflow:hidden;color:#F1F5F9;">${escapeHtml(PLATFORM.tagline)}</div>
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#F1F5F9;padding:32px 16px;">
    <tr><td align="center">
      <table width="${width}" cellpadding="0" cellspacing="0" role="presentation" style="background:#FFFFFF;border:1px solid #E2E8F0;border-radius:14px;max-width:${width}px;width:100%;overflow:hidden;">
        ${emailHeader()}
        <tr><td style="padding:28px 28px 36px;">
          ${body}
        </td></tr>
        ${emailFooter(footerOptions)}
      </table>
    </td></tr>
  </table>
</body></html>`;
}

// 공통 CTA 버튼 (table 기반 — Outlook 호환)
function ctaButton(href, label) {
  return `
    <table cellpadding="0" cellspacing="0" role="presentation" style="margin:8px auto 0;">
      <tr><td align="center" bgcolor="#0D9488" style="border-radius:10px;">
        <a href="${href}" target="_blank" style="display:inline-block;padding:13px 28px;background:#0D9488;color:#FFFFFF;text-decoration:none;border-radius:10px;font-size:14px;font-weight:700;line-height:1;">${escapeHtml(label)}</a>
      </td></tr>
    </table>`;
}

// 폴백 링크 박스 — 모든 CTA 아래에 같이 표시
function fallbackLink(url) {
  return `
    <div style="margin-top:18px;padding-top:14px;border-top:1px dashed #E2E8F0;font-size:11px;color:#94A3B8;line-height:1.5;">
      버튼이 동작하지 않으면 아래 링크를 브라우저에 붙여 넣어주세요:<br>
      <span style="color:#64748B;word-break:break-all;">${url}</span>
    </div>`;
}

// 인용 메시지 (사용자 메모) 박스
function quoteBlock(message) {
  if (!message) return '';
  return `
    <div style="margin:14px 0 4px;padding:12px 14px;background:#F8FAFC;border-left:3px solid #14B8A6;border-radius:0 8px 8px 0;font-size:13px;color:#334155;line-height:1.6;white-space:pre-wrap;">${escapeHtml(message)}</div>`;
}

// ═══════════════════════════════════════════════════════════════
// sendEmail — 핵심 발송 함수 + 매트릭스 가드 (옵션) + 로그
// ═══════════════════════════════════════════════════════════════
const sendEmail = async ({
  to, subject, html, attachments, fromName, replyTo,
  template, businessId, relatedEntityType, relatedEntityId, initiatedBy,
}) => {
  const baseLog = {
    to_email: to, subject,
    template: template || null,
    business_id: businessId || null,
    related_entity_type: relatedEntityType || null,
    related_entity_id: relatedEntityId || null,
    initiated_by: initiatedBy || null,
  };

  const transport = getTransporter();
  if (!transport) {
    console.warn(`Email skipped (no SMTP): to=${to}, subject=${subject}`);
    await recordLog({ ...baseLog, status: 'skipped', error_message: 'SMTP not configured' });
    return false;
  }

  const fromAddr = process.env.SMTP_FROM || PLATFORM.supportEmail;
  const from = fromName ? `"${String(fromName).replace(/"/g, '')}" <${fromAddr}>` : `"${PLATFORM.brand}" <${fromAddr}>`;

  // 로고 인라인 첨부 자동 추가 (HTML 에 cid:planq-logo@platform 참조 시)
  const logoAtt = getLogoAttachment();
  const allAtt = [
    ...(logoAtt ? [logoAtt] : []),
    ...(attachments || []),
  ];

  try {
    await transport.sendMail({
      from,
      to,
      subject,
      html,
      ...(allAtt.length > 0 ? { attachments: allAtt } : {}),
      ...(replyTo ? { replyTo } : {}),
    });
    await recordLog({ ...baseLog, status: 'sent' });
    return true;
  } catch (error) {
    console.error('Email send failed:', error.message);
    await recordLog({ ...baseLog, status: 'failed', error_message: String(error.message || '').slice(0, 1000) });
    return false;
  }
};

// ═══════════════════════════════════════════════════════════════
// 1. 초대 메일
// ═══════════════════════════════════════════════════════════════
function inviteEmailHtml({ workspaceName, inviterName, targetName, kind, contextName, inviteUrl }) {
  const roleLine = kind === 'workspace_member'
    ? '에서 팀원으로 초대하셨습니다.'
    : kind === 'workspace_client'
      ? '에 고객으로 초대하셨습니다.'
      : `의 프로젝트 <b>${escapeHtml(contextName || '')}</b> 에 고객으로 초대하셨습니다.`;
  const body = `
    <div style="font-size:14px;color:#64748B;margin-bottom:8px;">안녕하세요${targetName ? ` ${escapeHtml(targetName)}님` : ''},</div>
    <div style="font-size:15px;line-height:1.7;color:#0F172A;margin-bottom:8px;">
      <b>${escapeHtml(inviterName || '')}</b> 님이 <b>${escapeHtml(workspaceName || '')}</b> 워크스페이스${roleLine}
    </div>
    <div style="margin-top:20px;text-align:center;">
      ${ctaButton(inviteUrl, '초대 수락하기')}
    </div>
    <div style="margin-top:18px;font-size:12px;color:#94A3B8;line-height:1.6;">
      이 초대 링크는 <b>30일</b> 동안 유효합니다. 본인이 아니라면 이 메일은 무시해 주세요.
    </div>
    ${fallbackLink(inviteUrl)}`;
  return emailWrap({ title: 'PlanQ 초대', body, footerOptions: { workspaceName } });
}

async function sendInviteEmail({ to, workspaceName, inviterName, targetName, kind, contextName, token }) {
  if (!to) return false;
  const inviteUrl = `${APP_URL}/invite/${token}`;
  const subject = kind === 'workspace_member'
    ? `${inviterName || ''}님이 ${workspaceName} 팀에 초대했습니다`
    : `${inviterName || ''}님이 ${workspaceName}${contextName ? ` · ${contextName}` : ''} 에 초대했습니다`;
  return sendEmail({
    to, subject,
    html: inviteEmailHtml({ workspaceName, inviterName, targetName, kind, contextName, inviteUrl }),
    template: 'invite', relatedEntityType: 'invite_token',
  });
}

// ═══════════════════════════════════════════════════════════════
// 2. 문서 공유
// ═══════════════════════════════════════════════════════════════
function postShareEmailHtml({ docTitle, senderName, workspaceName, message, shareUrl }) {
  const body = `
    <div style="font-size:14px;color:#64748B;margin-bottom:6px;">
      <b>${escapeHtml(senderName || '')}</b>${workspaceName ? ` · ${escapeHtml(workspaceName)}` : ''} 님이 문서를 공유했습니다.
    </div>
    <div style="font-size:18px;font-weight:700;color:#0F172A;line-height:1.4;">${escapeHtml(docTitle)}</div>
    ${quoteBlock(message)}
    <div style="margin-top:20px;text-align:center;">
      ${ctaButton(shareUrl, '문서 보기')}
    </div>
    ${fallbackLink(shareUrl)}`;
  return emailWrap({ title: docTitle, body, footerOptions: { workspaceName } });
}

async function sendPostShareEmail({ to, docTitle, senderName, workspaceName, message, shareUrl }) {
  if (!to) return false;
  const subject = `[${PLATFORM.brand}] ${senderName || ''}님이 "${docTitle}" 문서를 공유했습니다`;
  return sendEmail({
    to, subject,
    html: postShareEmailHtml({ docTitle, senderName, workspaceName, message, shareUrl }),
    template: 'post_share', relatedEntityType: 'post',
  });
}

// ═══════════════════════════════════════════════════════════════
// 3. 서명 요청 (외부 서명자)
// ═══════════════════════════════════════════════════════════════
function signatureRequestEmailHtml({ docTitle, senderName, workspaceName, signerName, message, signUrl, expiresAt }) {
  const expireStr = expiresAt ? new Date(expiresAt).toLocaleDateString('ko-KR') : '';
  const body = `
    <div style="font-size:14px;color:#64748B;margin-bottom:6px;">
      안녕하세요${signerName ? ` ${escapeHtml(signerName)}님` : ''}, <b>${escapeHtml(senderName || '')}</b>${workspaceName ? ` · ${escapeHtml(workspaceName)}` : ''} 님이 서명을 요청했습니다.
    </div>
    <div style="font-size:18px;font-weight:700;color:#0F172A;line-height:1.4;">${escapeHtml(docTitle)}</div>
    ${quoteBlock(message)}
    <div style="margin-top:20px;text-align:center;">
      ${ctaButton(signUrl, '문서 검토 및 서명하기')}
    </div>
    <div style="margin-top:18px;padding:12px 14px;background:#FFFBEB;border:1px solid #FDE68A;border-radius:8px;font-size:12px;color:#92400E;line-height:1.6;">
      <b>서명 절차</b><br>
      ① 문서 검토 → ② 이메일 인증 코드 입력 → ③ 서명 → ④ 동의 확인
      ${expireStr ? `<br>이 요청은 <b>${expireStr}</b>까지 유효합니다.` : ''}
    </div>
    ${fallbackLink(signUrl)}`;
  return emailWrap({ title: `서명 요청 — ${docTitle}`, body, footerOptions: { workspaceName } });
}

async function sendSignatureRequestEmail({ to, docTitle, senderName, workspaceName, signerName, message, signUrl, expiresAt }) {
  if (!to) return false;
  const subject = `[${PLATFORM.brand}] 서명 요청 — "${docTitle}"`;
  return sendEmail({
    to, subject,
    html: signatureRequestEmailHtml({ docTitle, senderName, workspaceName, signerName, message, signUrl, expiresAt }),
    template: 'signature_request', relatedEntityType: 'signature',
  });
}

// ═══════════════════════════════════════════════════════════════
// 4. 서명 OTP (보안 메일 — 매트릭스 무관)
// ═══════════════════════════════════════════════════════════════
function otpEmailHtml({ docTitle, code }) {
  const body = `
    <div style="font-size:14px;color:#334155;line-height:1.6;text-align:center;">
      <b>${escapeHtml(docTitle)}</b> 서명 본인 확인 인증 코드입니다.
    </div>
    <div style="margin:24px 0 12px;text-align:center;">
      <div style="display:inline-block;padding:18px 36px;background:#F0FDFA;border:1px solid #14B8A6;border-radius:12px;font-size:32px;font-weight:800;letter-spacing:8px;color:#0F766E;font-family:ui-monospace,monospace;">${escapeHtml(code)}</div>
    </div>
    <div style="margin-top:8px;font-size:12px;color:#64748B;line-height:1.6;text-align:center;">
      인증 코드는 <b>5분간</b> 유효합니다.<br>
      본인이 요청하지 않은 경우 이 메일을 무시해 주세요.
    </div>`;
  return emailWrap({ title: `${PLATFORM.brand} 서명 인증`, body });
}

async function sendSignatureOtpEmail({ to, docTitle, code }) {
  if (!to) return false;
  const subject = `[${PLATFORM.brand}] 서명 인증 코드 ${code}`;
  return sendEmail({
    to, subject, html: otpEmailHtml({ docTitle, code }),
    template: 'signature_otp', relatedEntityType: 'signature',
  });
}

// ═══════════════════════════════════════════════════════════════
// 5. 청구서 발송 (외부 client)
// ═══════════════════════════════════════════════════════════════
function invoiceEmailHtml({ invoiceNumber, title, total, currency, dueDate, senderName, workspaceName, message, shareUrl }) {
  const totalStr = currency === 'KRW'
    ? `₩${Number(total).toLocaleString('ko-KR')}`
    : `${currency} ${Number(total).toLocaleString('en-US')}`;
  const dueStr = dueDate ? String(dueDate).slice(0, 10) : '';
  const body = `
    <div style="font-size:14px;color:#64748B;margin-bottom:6px;">
      <b>${escapeHtml(senderName || '')}</b>${workspaceName ? ` · ${escapeHtml(workspaceName)}` : ''} 님이 청구서를 보냈습니다.
    </div>
    <div style="font-size:11px;font-weight:700;color:#64748B;letter-spacing:0.4px;font-family:ui-monospace,monospace;margin-top:12px;">${escapeHtml(invoiceNumber)}</div>
    <div style="font-size:18px;font-weight:700;color:#0F172A;line-height:1.4;margin-top:4px;">${escapeHtml(title)}</div>
    <div style="margin-top:16px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;padding:14px 16px;">
      <div style="font-size:11px;color:#64748B;text-transform:uppercase;letter-spacing:0.4px;font-weight:700;">총액</div>
      <div style="font-size:24px;font-weight:800;color:#0F172A;letter-spacing:-0.3px;margin-top:2px;">${totalStr}</div>
      ${dueStr ? `<div style="font-size:12px;color:#92400E;margin-top:6px;font-weight:500;">결제 기한 ${dueStr}</div>` : ''}
    </div>
    ${quoteBlock(message)}
    <div style="margin-top:20px;text-align:center;">
      ${ctaButton(shareUrl, '청구서 보기 · 입금 안내')}
    </div>
    ${fallbackLink(shareUrl)}`;
  return emailWrap({ title: `청구서 — ${title}`, body, footerOptions: { workspaceName } });
}

async function sendInvoiceEmail({ to, invoiceNumber, title, total, currency, dueDate, senderName, workspaceName, message, shareUrl, attachments, fromName, replyTo }) {
  if (!to) return false;
  const subject = `[${PLATFORM.brand}] 청구서 — ${invoiceNumber} ${title}`;
  return sendEmail({
    to, subject,
    html: invoiceEmailHtml({ invoiceNumber, title, total, currency, dueDate, senderName, workspaceName, message, shareUrl }),
    attachments, fromName, replyTo,
    template: 'invoice', relatedEntityType: 'invoice',
  });
}

// ═══════════════════════════════════════════════════════════════
// 6. 이메일 변경 OTP (보안 메일 — 매트릭스 무관)
// ═══════════════════════════════════════════════════════════════
function verificationCodeEmailHtml({ code, ttlMinutes, userName }) {
  const body = `
    <h1 style="margin:0 0 12px;font-size:20px;color:#0F172A;font-weight:700;">이메일 변경 확인 코드</h1>
    <p style="margin:0 0 16px;font-size:14px;color:#475569;line-height:1.7;">
      ${userName ? escapeHtml(userName) + '님, ' : ''}새 이메일 주소로 변경하기 위한 확인 코드입니다. 아래 코드를 입력해 주세요.
    </p>
    <div style="margin:20px 0 8px;text-align:center;">
      <div style="display:inline-block;padding:18px 36px;background:#F0FDFA;border:1px solid #14B8A6;border-radius:12px;font-size:32px;font-weight:800;letter-spacing:8px;color:#0F766E;font-family:ui-monospace,monospace;">${escapeHtml(code)}</div>
    </div>
    <p style="margin:12px 0 0;font-size:12px;color:#94A3B8;line-height:1.6;">
      이 코드는 ${ttlMinutes}분 동안 유효합니다. 본인이 요청한 게 아니면 이 메일을 무시하세요.
    </p>`;
  return emailWrap({ title: '이메일 변경 확인 코드', body });
}

async function sendVerificationCodeEmail({ to, code, ttlMinutes = 10, userName = '' }) {
  if (!to || !code) return false;
  return sendEmail({
    to,
    subject: `[${PLATFORM.brand}] 이메일 변경 코드 ${code}`,
    html: verificationCodeEmailHtml({ code, ttlMinutes, userName }),
    template: 'email_change_otp',
  });
}

// ═══════════════════════════════════════════════════════════════
// 7. PlanQ 결제 안내 (플랜 결제 + Add-on 결제 공용 표준 메일)
//    — 자체 HTML 우회 금지. billing.js / addonBilling.js 모두 이 함수 경유.
// ═══════════════════════════════════════════════════════════════

// PlanQ 결제 계좌 헬퍼 — platform_settings 우선 + .env fallback + placeholder 가드.
//   .env.production.example 의 `<예: 토스뱅크>` 같은 placeholder 가 그대로 복사된 경우
//   미설정으로 간주해서 사용자에게 절대 노출하지 않는다.
function isPlaceholder(v) {
  if (!v) return true;
  const s = String(v).trim();
  if (!s) return true;
  return s.startsWith('<') || s.startsWith('예:') || /^<예/.test(s);
}

async function getPlanqBankInfo() {
  let row = null;
  try {
    const { PlatformSetting } = require('../models');
    row = await PlatformSetting.findOne({ order: [['id', 'ASC']] });
  } catch (e) {
    console.warn('[emailService] getPlanqBankInfo DB read failed:', e.message);
  }
  const name = row?.bank_name || process.env.PLANQ_BILLING_BANK_NAME || null;
  const account = row?.bank_account_number || process.env.PLANQ_BILLING_BANK_ACCOUNT || null;
  const holder = row?.bank_account_holder || process.env.PLANQ_BILLING_BANK_HOLDER || 'PlanQ';
  if (isPlaceholder(name) || isPlaceholder(account)) {
    return { configured: false, name: null, account: null, holder: null };
  }
  return { configured: true, name, account, holder: isPlaceholder(holder) ? 'PlanQ' : holder };
}

function billingInstructionEmailHtml({ kind, workspaceName, itemName, cycle, quantity, daysRemain, amount, currency, paymentId, accountInfo, configured }) {
  const amountStr = currency === 'KRW'
    ? `${Number(amount).toLocaleString('ko-KR')}원`
    : `${currency} ${Number(amount).toLocaleString('en-US')}`;
  const cycleLabel = cycle === 'monthly' ? '월간' : cycle === 'yearly' ? '연간' : '';
  const titleLine = kind === 'addon'
    ? `${escapeHtml(itemName)}${quantity && quantity > 1 ? ` × ${quantity}` : ''} 추가 결제 안내`
    : `${escapeHtml(itemName)}${cycleLabel ? ` ${cycleLabel}` : ''} 결제 안내`;
  const introLine = kind === 'addon'
    ? `<b>${escapeHtml(itemName)}</b>${quantity && quantity > 1 ? ` × ${quantity}` : ''} 추가 신청이 접수됐습니다. 한도는 신청 즉시 적용됐습니다.`
    : `${escapeHtml(workspaceName || '')} 워크스페이스의 ${escapeHtml(itemName)}${cycleLabel ? ` ${cycleLabel}` : ''} 결제 안내입니다.`;
  const noticeLine = kind === 'addon'
    ? '입금이 7일 안에 확인되지 않으면 추가된 한도가 회수됩니다.'
    : '입금 후, PlanQ 워크스페이스 관리자가 결제 확인을 처리하면 즉시 활성화됩니다. 24시간 내 미입금 시 자동 취소됩니다.';
  const accountBlock = configured ? `
    <table cellpadding="0" cellspacing="0" role="presentation" style="width:100%;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;margin-top:14px;">
      <tr><td style="padding:14px 16px;">
        <div style="font-size:11px;color:#64748B;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;">입금 계좌</div>
        <div style="margin-top:6px;font-size:15px;color:#0F172A;font-weight:700;line-height:1.6;">${escapeHtml(accountInfo)}</div>
      </td></tr>
      <tr><td style="padding:0 16px 14px;border-top:1px solid #E2E8F0;">
        <div style="margin-top:10px;font-size:12px;color:#64748B;line-height:1.6;">
          입금자명에 결제번호 <b style="color:#0F172A;">#${paymentId}</b>${workspaceName ? ` 또는 워크스페이스명(<b>${escapeHtml(workspaceName)}</b>)` : ''} 을 함께 적어주세요.
        </div>
      </td></tr>
    </table>` : `
    <div style="margin-top:14px;padding:14px 16px;background:#FEF2F2;border:1px solid #FECACA;border-radius:10px;font-size:13px;color:#B91C1C;line-height:1.7;">
      현재 PlanQ 결제 계좌가 설정돼 있지 않습니다. 잠시 후 PlanQ 운영팀에서 입금 계좌를 별도로 안내드릴 예정입니다. 문의: <a href="mailto:${PLATFORM.supportEmail}" style="color:#B91C1C;font-weight:600;">${PLATFORM.supportEmail}</a>
    </div>`;
  const body = `
    <div style="font-size:18px;font-weight:700;color:#0F172A;line-height:1.4;">${titleLine}</div>
    <div style="margin-top:10px;font-size:14px;color:#475569;line-height:1.7;">${introLine}</div>
    <table cellpadding="0" cellspacing="0" role="presentation" style="width:100%;background:#F0FDFA;border:1px solid #99F6E4;border-radius:10px;margin-top:16px;">
      <tr><td style="padding:14px 16px;">
        <div style="font-size:11px;color:#0F766E;font-weight:700;letter-spacing:0.4px;text-transform:uppercase;">결제 금액${kind === 'addon' && daysRemain ? ` (남은 ${daysRemain}일 일할 적용)` : ''}</div>
        <div style="margin-top:4px;font-size:24px;font-weight:800;color:#0F172A;letter-spacing:-0.3px;">${amountStr}</div>
        <div style="margin-top:4px;font-size:12px;color:#475569;font-family:ui-monospace,monospace;">결제번호 #${paymentId}</div>
      </td></tr>
    </table>
    ${accountBlock}
    <div style="margin-top:16px;font-size:12px;color:#94A3B8;line-height:1.6;">${noticeLine}</div>`;
  return emailWrap({
    title: `결제 안내 — ${itemName}`,
    body,
    footerOptions: { workspaceName },
  });
}

async function sendBillingInstructionEmail({ to, kind, workspaceName, itemName, cycle, quantity, daysRemain, amount, currency = 'KRW', paymentId, businessId }) {
  if (!to) return false;
  if (kind !== 'plan' && kind !== 'addon') throw new Error('invalid_billing_kind');
  const bank = await getPlanqBankInfo();
  const accountInfo = bank.configured
    ? `${bank.name} ${bank.account} (예금주 ${bank.holder})`
    : null;
  const subject = kind === 'addon'
    ? `[${PLATFORM.brand}] ${workspaceName || ''} — ${itemName}${quantity && quantity > 1 ? ` × ${quantity}` : ''} 추가 결제 안내 #${paymentId}`
    : `[${PLATFORM.brand}] ${itemName}${cycle === 'monthly' ? ' 월간' : cycle === 'yearly' ? ' 연간' : ''} 결제 안내 #${paymentId}`;
  return sendEmail({
    to, subject,
    html: billingInstructionEmailHtml({
      kind, workspaceName, itemName, cycle, quantity, daysRemain,
      amount, currency, paymentId,
      accountInfo, configured: bank.configured,
    }),
    template: kind === 'addon' ? 'addon_request' : 'plan_request',
    relatedEntityType: 'payment',
    relatedEntityId: paymentId || null,
    businessId: businessId || null,
  });
}

// ═══════════════════════════════════════════════════════════════
// 8. 문의 접수 자동 회신 (게스트·사용자 모두에게)
//    랜딩 /contact 폼 + 게스트 Cue "문의 남기기" 탭 양쪽에서 호출.
// ═══════════════════════════════════════════════════════════════
function inquiryReceivedEmailHtml({ name, message, inquiryId }) {
  const body = `
    <div style="font-size:18px;font-weight:700;color:#0F172A;line-height:1.4;">${escapeHtml(name || '안녕하세요')}님, 문의가 접수됐습니다</div>
    <div style="margin-top:12px;font-size:14px;color:#475569;line-height:1.7;">
      PlanQ 운영팀이 영업일 기준 <b>24시간 내</b> 회신드릴게요. 접수 번호 <b>#${inquiryId}</b>.
    </div>
    ${message ? `
    <div style="margin-top:16px;padding:12px 14px;background:#F8FAFC;border-left:3px solid #14B8A6;border-radius:0 8px 8px 0;font-size:13px;color:#334155;line-height:1.6;white-space:pre-wrap;">${escapeHtml(message).slice(0, 800)}</div>
    ` : ''}
    <div style="margin-top:18px;font-size:12px;color:#94A3B8;line-height:1.6;">
      이 메일은 자동 발송됐습니다. 추가로 전달할 내용이 있으면 본 메일에 회신해 주세요.
    </div>`;
  return emailWrap({ title: '문의 접수 안내', body });
}

async function sendInquiryReceivedEmail({ to, name, message, inquiryId }) {
  if (!to) return false;
  const subject = `[${PLATFORM.brand}] 문의가 접수됐습니다 #${inquiryId}`;
  return sendEmail({
    to, subject,
    html: inquiryReceivedEmailHtml({ name, message, inquiryId }),
    template: 'inquiry_received', relatedEntityType: 'inquiry', relatedEntityId: inquiryId,
  });
}

// ═══════════════════════════════════════════════════════════════
// 9. 멤버 알림 (generic — 매트릭스 적용 대상)
// ═══════════════════════════════════════════════════════════════
function notificationEmailHtml({ title, body, link, ctaLabel, workspaceName }) {
  const inner = `
    ${workspaceName ? `<div style="font-size:11px;font-weight:700;color:#0D9488;text-transform:uppercase;letter-spacing:0.4px;margin-bottom:8px;">${escapeHtml(workspaceName)}</div>` : ''}
    <div style="font-size:18px;font-weight:700;color:#0F172A;line-height:1.4;">${escapeHtml(title)}</div>
    ${body ? `<div style="margin-top:12px;font-size:14px;color:#475569;line-height:1.7;white-space:pre-wrap;">${escapeHtml(body)}</div>` : ''}
    ${link ? `<div style="margin-top:20px;text-align:center;">${ctaButton(link, ctaLabel || '바로 가기')}</div>` : ''}`;
  return emailWrap({ title, body: inner, footerOptions: { notificationSettings: true, workspaceName } });
}

async function sendNotificationEmail({ to, title, body, link, ctaLabel, workspaceName, businessId, eventKind, recipientUserId, relatedEntityId }) {
  if (!to) return false;
  return sendEmail({
    to,
    subject: workspaceName ? `[${escapeHtml(workspaceName)}] ${title}` : `[${PLATFORM.brand}] ${title}`,
    html: notificationEmailHtml({ title, body, link, ctaLabel, workspaceName }),
    businessId, template: `notify:${eventKind || 'generic'}`,
    relatedEntityType: eventKind || null,
    relatedEntityId: relatedEntityId || null,
    initiatedBy: recipientUserId || null,
  });
}

// ═══════════════════════════════════════════════════════════════
// 9. 비밀번호 재설정 (forgot/reset)
// ═══════════════════════════════════════════════════════════════
function passwordResetEmailHtml({ name, resetUrl, ttlMinutes = 60 }) {
  const body = `
    <div style="font-size:18px;font-weight:700;color:#0F172A;line-height:1.4;">${escapeHtml(name || '안녕하세요')}님, 비밀번호 재설정 안내</div>
    <div style="margin-top:12px;font-size:14px;color:#475569;line-height:1.7;">
      아래 버튼을 눌러 새 비밀번호를 설정해주세요. 본인이 요청하지 않은 경우 이 메일을 무시하세요.
    </div>
    <div style="margin-top:20px;text-align:center;">
      ${ctaButton(resetUrl, '비밀번호 재설정')}
    </div>
    <div style="margin-top:18px;font-size:12px;color:#94A3B8;line-height:1.6;">
      이 링크는 <b>${ttlMinutes}분</b> 동안 유효합니다.
    </div>
    ${fallbackLink(resetUrl)}`;
  return emailWrap({ title: '비밀번호 재설정', body });
}

async function sendPasswordResetEmail({ to, name, resetToken, ttlMinutes = 60 }) {
  if (!to || !resetToken) return false;
  const resetUrl = `${APP_URL}/reset-password/${resetToken}`;
  return sendEmail({
    to, subject: `[${PLATFORM.brand}] 비밀번호 재설정 안내`,
    html: passwordResetEmailHtml({ name, resetUrl, ttlMinutes }),
    template: 'password_reset',
  });
}

// ═══════════════════════════════════════════════════════════════
// 10. 회원가입 이메일 인증 (signup verify)
// ═══════════════════════════════════════════════════════════════
function signupVerifyEmailHtml({ name, verifyUrl, ttlHours = 72 }) {
  const body = `
    <div style="font-size:18px;font-weight:700;color:#0F172A;line-height:1.4;">${escapeHtml(name || '안녕하세요')}님, PlanQ 가입을 환영합니다</div>
    <div style="margin-top:12px;font-size:14px;color:#475569;line-height:1.7;">
      아래 버튼을 눌러 이메일 인증을 완료해주세요. 인증해야 모든 기능을 사용할 수 있습니다.
    </div>
    <div style="margin-top:20px;text-align:center;">
      ${ctaButton(verifyUrl, '이메일 인증하기')}
    </div>
    <div style="margin-top:18px;font-size:12px;color:#94A3B8;line-height:1.6;">
      이 링크는 <b>${ttlHours}시간</b> 동안 유효합니다.
    </div>
    ${fallbackLink(verifyUrl)}`;
  return emailWrap({ title: '이메일 인증 안내', body });
}

async function sendSignupVerifyEmail({ to, name, verifyToken, ttlHours = 72 }) {
  if (!to || !verifyToken) return false;
  const verifyUrl = `${APP_URL}/verify-email/${verifyToken}`;
  return sendEmail({
    to, subject: `[${PLATFORM.brand}] 이메일 인증 안내`,
    html: signupVerifyEmailHtml({ name, verifyUrl, ttlHours }),
    template: 'signup_verify',
  });
}

module.exports = {
  sendEmail,
  sendInviteEmail, sendPostShareEmail, sendSignatureRequestEmail, sendSignatureOtpEmail,
  sendInvoiceEmail, sendVerificationCodeEmail,
  sendBillingInstructionEmail,
  sendInquiryReceivedEmail,
  sendNotificationEmail,
  sendPasswordResetEmail,
  sendSignupVerifyEmail,
  getPlanqBankInfo,
  invalidatePlatformCache,  // admin 라우트가 PUT 후 호출
};
