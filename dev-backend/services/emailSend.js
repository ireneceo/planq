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


// ── 발신 주소 결정 (Send-as) — 단일 원천. 설계: docs/MAIL_ALIAS_AND_VOICE_DESIGN.md §A-4
//   우선순위: ①명시한 별칭(서버가 소유 재검증) ②답장이면 그 메일이 온 주소 ③계정 기본 별칭 ④계정 주소
//   "받은 주소로 답한다" 는 사용자가 기대하는 기본값이다 — 다른 도메인으로 답장이 나가면 사고다.
async function resolveSender(account, { fromAliasId = null, replyToAddresses = null } = {}) {
  const { EmailAccountAlias } = require('../models');
  let aliases = [];
  try {
    aliases = await EmailAccountAlias.findAll({ where: { account_id: account.id }, order: [['is_default', 'DESC'], ['id', 'ASC']] });
  } catch (e) { console.warn('[emailSend] aliases', e.message); }

  // ① 명시 — 이 계정 소유인지 재검증 (클라이언트가 보낸 id 를 믿지 않는다)
  if (fromAliasId) {
    const hit = aliases.find((a) => Number(a.id) === Number(fromAliasId));
    if (!hit) {
      const e = new Error('alias_not_owned');
      e.code = 'alias_not_owned';
      throw e;
    }
    return { email: hit.email, displayName: hit.display_name || null, signatureHtml: hit.signature_html || null };
  }

  // ② 답장 — 받은 주소가 계정/별칭 중 하나면 그 주소로
  if (Array.isArray(replyToAddresses) && replyToAddresses.length) {
    const lower = replyToAddresses.map((a) => String(a || '').toLowerCase());
    const hit = aliases.find((a) => lower.includes(String(a.email).toLowerCase()));
    if (hit) return { email: hit.email, displayName: hit.display_name || null, signatureHtml: hit.signature_html || null };
    // 계정 주소로 온 것이면 계정 주소 그대로 (아래 ④)
  }

  // ③ 기본 별칭
  const def = aliases.find((a) => a.is_default);
  if (def) return { email: def.email, displayName: def.display_name || null, signatureHtml: def.signature_html || null };

  // ④ 계정 주소
  return { email: account.email, displayName: null, signatureHtml: null };
}

// 서명 붙이기 — data-planq-signature 표식으로 중복 삽입을 막는다.
//   서명이 비었거나 계정에서 껐으면 그대로 둔다.
const SIGNATURE_MARK = 'data-planq-signature';
function appendSignature(html, account, aliasSignatureHtml = null) {
  // 별칭 서명이 있으면 그것이 우선 — 도메인이 다르면 브랜드가 다르다
  const raw = aliasSignatureHtml != null ? aliasSignatureHtml : (account && account.signature_html);
  const sig = account && account.signature_enabled !== false ? String(raw || '').trim() : '';
  if (!sig) return html;
  const body = String(html || '');
  if (body.includes(SIGNATURE_MARK)) return body;   // 이미 들어 있음 (초안에서 편집한 경우)
  return `${body}<br><div ${SIGNATURE_MARK}="1" style="margin-top:16px;color:#334155;font-size:13px;">${sig}</div>`;
}

async function sendMail(account, { to, cc, bcc, subject, html, text, inReplyTo, references, attachments, fromAliasId = null, replyToAddresses = null }) {
  // 수신자 검증 — 가짜/예약TLD/형식불량 주소 차단 (바운스·평판 보호). emailService 게이트 재사용.
  const { emailBlockReason } = require('./emailService');
  const blocked = emailBlockReason([].concat(to || [], cc || [], bcc || []));
  if (blocked && blocked !== 'empty') {
    const e = new Error(`recipient_${blocked}`);
    e.code = 'invalid_recipient';
    throw e;
  }
  // dev 서버 발송 정지 — 플랫폼 발송(emailService)과 **같은 문**을 지난다.
  //   여태 Q Mail 계정 발송만 이 문을 비껴가서, dev 에서 답장 버튼을 누르면 연결된 회사 메일 계정으로
  //   **실제 고객에게 진짜 메일이 나갔다** (.env 는 EMAIL_SENDING_ENABLED=false 인데도).
  //   발송만 멈추고 나머지 흐름(outbound 기록·스레드 갱신·규칙 해제)은 그대로 둔다 — dev 에서 답장
  //   흐름을 끝까지 검증할 수 있어야 하기 때문이다. 운영은 미설정(기본 ON)이라 영향 없다.
  if (String(process.env.EMAIL_SENDING_ENABLED ?? 'true').toLowerCase() === 'false') {
    const recipients = [].concat(to || []).map((v) => String(v));
    console.warn(`[emailSend] 발송 정지(이 서버는 발송 안 함): to=${recipients.join(', ')}, subject=${subject}`);
    return {
      messageId: `<suppressed-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@planq.local>`,
      accepted: [],
      rejected: [],
      suppressed: true,
    };
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
  // 발신 주소 — 별칭(Send-as) 반영. 별칭에 표시 이름이 있으면 그것이 우선한다.
  const sender = await resolveSender(account, { fromAliasId, replyToAddresses });
  if (sender.displayName) fromName = sender.displayName;
  const from = fromName
    ? `"${String(fromName).replace(/"/g, '')}" <${sender.email}>`
    : sender.email;

  // 서명 — 계정마다 다르다. 발송 직전 한 곳에서 붙인다(답장·전달·새 메일 3경로가 모두 여기를 지난다).
  //   이미 서명이 들어간 본문(사용자가 편집한 초안)에는 다시 붙이지 않는다 — 표식으로 판별.
  const htmlWithSig = appendSignature(html, account, sender.signatureHtml);

  const info = await transport.sendMail({
    from,
    to: joinAddrs(to),
    ...(joinAddrs(cc) ? { cc: joinAddrs(cc) } : {}),
    ...(joinAddrs(bcc) ? { bcc: joinAddrs(bcc) } : {}),
    subject: subject || '(제목 없음)',
    html: htmlWithSig,
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

module.exports = {
  appendSignature,
  resolveSender, sendMail, buildTransport, deriveSmtpHost };
