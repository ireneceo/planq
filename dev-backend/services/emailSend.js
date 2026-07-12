// services/emailSend.js — Q Mail 발송 (사이클 N+76 M3-A)
//
// 계정별 transport 로 메일 발송. auth_type 분기:
//   password      → nodemailer SMTP (smtp_* 또는 imap_* 자격 fallback)
//   google_oauth  → nodemailer OAuth2 (access_token, 만료 시 refresh)
//
// RFC 5322 스레딩: In-Reply-To / References 헤더로 받는 쪽 메일 클라이언트에서
// 같은 스레드로 묶이게 한다. From 은 항상 연결된 계정 주소 (PlanQ noreply 아님).
const nodemailer = require('nodemailer');
const { encrypt, decrypt } = require('./encryption');
const gmailOauth = require('./gmail_oauth');

// IMAP host → SMTP host 추정 (smtp_host 미설정 password 계정 fallback)
const IMAP_TO_SMTP = {
  'imap.gmail.com': 'smtp.gmail.com',
  'imap.naver.com': 'smtp.naver.com',
  'imap.daum.net': 'smtp.daum.net',
  'outlook.office365.com': 'smtp.office365.com',
  'imap.mail.me.com': 'smtp.mail.me.com',
};

function deriveSmtpHost(imapHost) {
  if (!imapHost) return null;
  if (IMAP_TO_SMTP[imapHost]) return IMAP_TO_SMTP[imapHost];
  return imapHost.replace(/^imap\./, 'smtp.');
}

// account 의 nodemailer transport 생성 (auth_type 분기). OAuth 토큰 만료 시 갱신 후 저장.
async function buildTransport(account) {
  if (account.auth_type === 'google_oauth') {
    let accessToken = decrypt(account.oauth_access_token_encrypted);
    const expiresAt = account.oauth_expires_at ? new Date(account.oauth_expires_at).getTime() : 0;
    // 만료 60초 전이면 미리 갱신
    if (!accessToken || expiresAt < Date.now() + 60000) {
      const refreshToken = decrypt(account.oauth_refresh_token_encrypted);
      if (!refreshToken) throw new Error('oauth_refresh_token_missing');
      const refreshed = await gmailOauth.refreshAccessToken(refreshToken);
      accessToken = refreshed.access_token;
      await account.update({
        oauth_access_token_encrypted: encrypt(accessToken),
        oauth_expires_at: refreshed.expires_at,
      });
    }
    return nodemailer.createTransport({
      host: 'smtp.gmail.com', port: 465, secure: true,
      auth: { type: 'OAuth2', user: account.imap_username, accessToken },
    });
  }

  // password (앱 비밀번호)
  const host = account.smtp_host || deriveSmtpHost(account.imap_host);
  if (!host) throw new Error('smtp_host_missing');
  const port = account.smtp_port || 587;
  const user = account.smtp_username || account.imap_username;
  const pass = decrypt(account.smtp_password_encrypted || account.imap_password_encrypted);
  if (!pass) throw new Error('smtp_password_missing');
  return nodemailer.createTransport({
    host, port, secure: port === 465,
    auth: { user, pass },
    requireTLS: account.smtp_tls !== false && port !== 465,
  });
}

function joinAddrs(v) {
  if (!v) return undefined;
  const arr = Array.isArray(v) ? v : [v];
  const clean = arr.map(s => String(s).trim()).filter(Boolean);
  return clean.length ? clean.join(', ') : undefined;
}

// 메일 발송. 성공 시 { messageId, accepted, rejected }, 실패 시 throw.
//   attachments: nodemailer 형식 [{ filename, path, contentType }]
async function sendMail(account, { to, cc, bcc, subject, html, text, inReplyTo, references, attachments }) {
  // 수신자 검증 — 가짜/예약TLD/형식불량 주소 차단 (바운스·평판 보호). emailService 게이트 재사용.
  const { emailBlockReason } = require('./emailService');
  const blocked = emailBlockReason([].concat(to || [], cc || [], bcc || []));
  if (blocked && blocked !== 'empty') {
    const e = new Error(`recipient_${blocked}`);
    e.code = 'invalid_recipient';
    throw e;
  }
  const transport = await buildTransport(account);

  // 발신 이름 — 원래 기준은 워크스페이스 메일 설정(businesses.mail_from_name, /business/settings/email).
  //   Q Mail 계정이 그걸 안 보고 자기 display_name(Gmail 연결 시 박힌 구글 프로필 이름)만 쓰는 바람에
  //   회사 대표 메일 답장이 "IRENE WP" 로 나갔다. 설정을 단일 원천으로 되돌린다.
  //   우선순위: 계정별 발신 이름(명시 override) → 워크스페이스 발신 이름 → 브랜드명 → 워크스페이스명.
  //   개인 계정(owner_user_id)은 본인 이름이 기본이므로 계정 값을 그대로 쓴다.
  let fromName = account.display_name || '';
  if (!fromName && account.business_id) {
    try {
      const { Business } = require('../models');
      const biz = await Business.findByPk(account.business_id, {
        attributes: ['mail_from_name', 'brand_name', 'name'],
      });
      fromName = biz?.mail_from_name || biz?.brand_name || biz?.name || '';
    } catch (e) { console.warn('[emailSend] from name fallback', e.message); }
  }
  const from = fromName
    ? `"${String(fromName).replace(/"/g, '')}" <${account.email}>`
    : account.email;

  const info = await transport.sendMail({
    from,
    to: joinAddrs(to),
    ...(joinAddrs(cc) ? { cc: joinAddrs(cc) } : {}),
    ...(joinAddrs(bcc) ? { bcc: joinAddrs(bcc) } : {}),
    subject: subject || '(제목 없음)',
    html,
    ...(text ? { text } : {}),
    ...(inReplyTo ? { inReplyTo } : {}),
    ...(references && references.length ? { references } : {}),
    ...(attachments && attachments.length ? { attachments } : {}),
  });

  return {
    messageId: info.messageId,
    accepted: info.accepted || [],
    rejected: info.rejected || [],
  };
}

module.exports = { sendMail, buildTransport, deriveSmtpHost };
