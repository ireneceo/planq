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
const { normalizeDataUris } = require('./emailInlineData');

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

  // ①-a 사용자가 "계정 주소" 를 **명시 선택**한 경우(0). 미지정(null/undefined)과 구분해야 한다 —
  //   0 을 미지정으로 뭉개면 아래 ③ 기본별칭이 사용자의 명시 선택을 덮어쓴다.
  if (fromAliasId !== null && fromAliasId !== undefined && Number(fromAliasId) === 0) {
    return { email: account.email, displayName: null, signatureHtml: null };
  }

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
    // ★ 계정 본주소로 온 메일이면 **여기서 끝낸다**. 아래 ③ 기본별칭으로 흘려보내면
    //   help@ 로 받은 메일에 답장했는데 실제 From 이 support@(기본별칭)로 나간다 —
    //   화면은 help@ 를 표시하므로 **표시≠실발신** 사고가 된다(Fable 실측 확인).
    //   주석은 원래 이 동작을 전제했는데 코드가 ③으로 떨어지고 있었다.
    if (lower.includes(String(account.email).toLowerCase())) {
      return { email: account.email, displayName: null, signatureHtml: null };
    }
  }

  // ③ 기본 별칭
  const def = aliases.find((a) => a.is_default);
  if (def) return { email: def.email, displayName: def.display_name || null, signatureHtml: def.signature_html || null };

  // ④ 계정 주소
  return { email: account.email, displayName: null, signatureHtml: null };
}

// 서명 붙이기 — data-planq-signature 표식으로 중복 삽입을 막는다.
//   서명이 비었거나 계정에서 껐으면 그대로 둔다.
// wire 의 text 파트용 — 인용 머리말이 줄 맨 앞에 오도록 본문을 텍스트로 만든다.
function htmlToTextForWire(html) {
  const { htmlToText } = require('./emailBodyClean');
  return String(htmlToText(html) || '').replace(/\n{3,}/g, '\n\n').trim();
}

const SIGNATURE_MARK = 'data-planq-signature';
// 우선순위: 별칭 서명 > 계정 서명 > **워크스페이스 공통 서명** > 없음.
//   여태 워크스페이스 층이 아예 없어서, 팀 공통 서명을 한 곳에서 관리할 방법이 없었다
//   (Irene: "서명은 왜 개별로인데 회사 공통으로 쓰는 건 없어? 팀공통이 기본 아니야?").
//   계정 서명을 비워두면 자동으로 공통을 쓴다 — 별도 "공통 사용" 스위치가 필요 없고,
//   기존 계정별 서명은 우선순위상 그대로 이기므로 **아무것도 덮어쓰지 않는다**.
//   서명 자체를 끄고 싶으면 기존 signature_enabled=false 그대로.
function appendSignature(html, account, aliasSignatureHtml = null, workspaceSignatureHtml = null) {
  // 별칭 서명이 있으면 그것이 우선 — 도메인이 다르면 브랜드가 다르다
  const firstNonEmpty = (...vals) => {
    for (const v of vals) { const t = String(v || '').trim(); if (t) return t; }
    return '';
  };
  const raw = aliasSignatureHtml != null && String(aliasSignatureHtml).trim()
    ? aliasSignatureHtml
    : firstNonEmpty(account && account.signature_html, workspaceSignatureHtml);
  const sig = account && account.signature_enabled !== false ? String(raw || '').trim() : '';
  if (!sig) return html;
  const body = String(html || '');
  if (body.includes(SIGNATURE_MARK)) return body;   // 이미 들어 있음 (초안에서 편집한 경우)
  return `${body}<br><div ${SIGNATURE_MARK}="1" style="margin-top:16px;color:#334155;font-size:13px;">${sig}</div>`;
}

// 이 발송에 **실제로** 붙을 발신자·서명을 계산한다 (#262).
//   ★ 화면 미리보기와 실발송이 어긋나면 안 되므로 sendMail 이 쓰는 것과 같은 함수여야 한다.
//     그래서 sendMail 본문에서 이 계산을 통째로 절출해 양쪽이 공유한다.
//   source: 어느 층에서 왔는지 — 화면이 "팀 서명인지 개인 서명인지" 를 말해줄 수 있어야 한다
//     (Irene: "서명이 팀서명과 개인서명 뭐가 붙는지도 모르고 알 수도 없어").
async function resolveOutgoingIdentity(account, { fromAliasId = null, replyToAddresses = null } = {}) {
  let fromName = account.display_name || '';
  let workspaceSignature = null;
  if (account.business_id) {
    try {
      const { Business } = require('../models');
      const biz = await Business.findByPk(account.business_id, {
        attributes: ['mail_from_name', 'brand_name', 'name', 'mail_signature_html'],
      });
      if (!fromName) fromName = biz?.mail_from_name || biz?.brand_name || biz?.name || '';
      workspaceSignature = biz?.mail_signature_html || null;
    } catch (e) { console.warn('[emailSend] workspace 설정 조회 실패', e.message); }
  }
  const sender = await resolveSender(account, { fromAliasId, replyToAddresses });
  if (sender.displayName) fromName = sender.displayName;

  // appendSignature 와 **같은 우선순위**로 어느 층이 이길지 판정한다.
  const nonEmpty = (v) => !!String(v || '').trim();
  let source = 'none';
  let signatureHtml = '';
  if (account.signature_enabled === false) {
    source = 'disabled';
  } else if (nonEmpty(sender.signatureHtml)) {
    source = 'alias'; signatureHtml = String(sender.signatureHtml).trim();
  } else if (nonEmpty(account.signature_html)) {
    source = 'account'; signatureHtml = String(account.signature_html).trim();
  } else if (nonEmpty(workspaceSignature)) {
    source = 'workspace'; signatureHtml = String(workspaceSignature).trim();
  }
  return {
    fromName, fromEmail: sender.email,
    signatureSource: source, signatureHtml,
    aliasSignatureHtml: sender.signatureHtml || null, workspaceSignature,
  };
}

async function sendMail(account, { to, cc, bcc, subject, html, text, inReplyTo, references, attachments, fromAliasId = null, replyToAddresses = null, signature = true, quote = null, senderUserId = null }) {
  // 수신자 검증 — 가짜/예약TLD/형식불량 주소 차단 (바운스·평판 보호). emailService 게이트 재사용.
  const { emailBlockReason, MAIL_FONT_STACK } = require('./emailService');
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
  // 발신 이름·주소·서명 — 미리보기 endpoint 와 **같은 함수**로 계산한다 (표시≠실발송 방지).
  //   ★ 발송정지 게이트보다 **앞**에서 계산한다. 라우트가 outbound row 에 기록할 From 을
  //     이 결과에서 가져가야 하는데, 게이트 뒤에 두면 dev(발송정지)에서는 값이 없어
  //     "실발송은 별칭인데 보낸메일함은 계정 주소" 가 된다(같은 종류의 표시≠실발신).
  const ident = await resolveOutgoingIdentity(account, { fromAliasId, replyToAddresses });
  const from = ident.fromName
    ? `"${String(ident.fromName).replace(/"/g, '')}" <${ident.fromEmail}>`
    : ident.fromEmail;

  if (String(process.env.EMAIL_SENDING_ENABLED ?? 'true').toLowerCase() === 'false') {
    const recipients = [].concat(to || []).map((v) => String(v));
    console.warn(`[emailSend] 발송 정지(이 서버는 발송 안 함): to=${recipients.join(', ')}, subject=${subject}`);
    return {
      messageId: `<suppressed-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@planq.local>`,
      accepted: [],
      rejected: [],
      suppressed: true,
      fromEmail: ident.fromEmail,
      fromName: ident.fromName || null,
    };
  }

  const transport = await buildTransport(account);

  // 발신 이름 기준: 계정별 발신 이름 → 워크스페이스 발신 이름 → 브랜드명 → 워크스페이스명.
  //   (개인 계정(owner_user_id)은 본인 이름이 기본이라 계정 값을 그대로 쓴다.)
  //   실제 계산은 위 게이트 앞의 resolveOutgoingIdentity 한 번뿐이다.

  // 서명 — 계정마다 다르다. 발송 직전 한 곳에서 붙인다(답장·전달·새 메일 3경로가 모두 여기를 지난다).
  //   이미 서명이 들어간 본문(사용자가 편집한 초안)에는 다시 붙이지 않는다 — 표식으로 판별.
  //   `signature: false` 는 **이 발송만** 서명을 끈다 (계정 설정 signature_enabled 는 건드리지 않는다).
  const htmlWithSig = signature === false
    ? html
    : appendSignature(html, account, ident.aliasSignatureHtml, ident.workspaceSignature);

  // 표 인라인 — 서명 안의 표까지 덮는다(서명도 같은 에디터로 쓴다). 멱등이라 라우트에서 이미
  //   한 번 처리했어도 안전하다.
  const { inlineMailTableStyles } = require('./emailHtmlInline');
  const htmlInlined = inlineMailTableStyles(htmlWithSig);

  // 인용은 **보내는 편지에만** 붙인다 — 저장본은 라우트가 인용 없이 따로 기록한다.
  //   text 파트를 같이 만들어야 수신측이 본문을 정리할 때 인용 머리말이 줄 맨 앞에 온다.
  const wireHtml = quote ? `${htmlInlined}${quote.html}` : htmlInlined;
  const wireText = quote
    ? `${htmlToTextForWire(htmlInlined)}${quote.text}`
    : (text || undefined);

  // ★ 2026-08-27 — **data:URI 이미지는 받는 쪽에서 안 보인다.** Gmail·Outlook 은
  //   <img src="data:..."> 를 렌더하지 않고 차단한다. 우리 저장본은 수신 시 mailparser 가
  //   인라인 이미지를 data:URI 로 박아 두므로(전달 원문·답장 인용문 모두), 그대로 내보내면
  //   보내는 화면에선 멀쩡한데 **받는 사람에겐 이미지가 전멸**한다.
  //   nodemailer 의 attachDataUrls 가 발송 직전에 그것을 진짜 CID 첨부(multipart/related)로
  //   바꿔 준다 — 이것이 메일 표준의 정공법이다. normalizeDataUris 는 그 변환 정규식이
  //   base64 안 공백에서 끊기는 것을 막는 안전핀(services/emailInlineData.js 주석 참조).
  // ★ 2026-08-27 — **글꼴 통일(고딕).** 여태 Q Mail 발송 HTML 에는 font-family 가 한 줄도 없어서
  //   받는 쪽 메일앱 기본값으로 렌더됐다 — Gmail=Arial, Outlook=Calibri, 네이버=굴림.
  //   즉 "우리 메일" 인데 받는 사람마다 글꼴이 달랐다(Irene: "전달 이메일 글씨체 고딕으로 통일").
  //   플랫폼 메일(emailService.emailWrap)은 이미 이 스택을 쓰므로 **같은 상수를 가져다** 쓴다 —
  //   값을 여기 또 적으면 그 순간 두 벌이 되어 갈라진다.
  //   래퍼일 뿐이라 **원문에 이미 박힌 서식은 그대로 이긴다**(CSS 상속). 전달 시 상대가 보낸
  //   원문 인용문의 글꼴을 우리가 갈아엎지 않는다 — 전달은 원문 보존이 맞다.
  const wireHtmlFont = `<div style="font-family:${MAIL_FONT_STACK};">${wireHtml}</div>`;
  // ★ #378 — 본문에 넣은 **우리 이미지**를 CID 첨부로 바꾼다(services/emailImageEmbed.js).
  //   저장본은 URL 그대로 두고 **나가는 편지에서만** 바꾼다 — 보낸메일 화면은 그 URL 로 그리고,
  //   초안 재발송도 언제나 URL 에서 다시 출발한다(멱등).
  //   남의 원문 이미지(data: · 원격 https: · cid:)는 판정에 안 걸려 손대지 않는다.
  const { embedOwnImages } = require('./emailImageEmbed');
  //   ★ senderUserId 를 반드시 넘긴다 — 안 넘기면 아래 권한 검사가 그냥 통과해
  //     타 멤버의 개인(L1) 파일이 메일로 나간다. 라우트 3곳이 req.user.id 를 준다.
  const embedded = await embedOwnImages(wireHtmlFont, { businessId: account.business_id, userId: senderUserId });
  const wireHtmlOut = normalizeDataUris(embedded.html);
  const allAttachments = [...(attachments || []), ...embedded.attachments];
  const info = await transport.sendMail({
    attachDataUrls: true,
    from,
    to: joinAddrs(to),
    ...(joinAddrs(cc) ? { cc: joinAddrs(cc) } : {}),
    ...(joinAddrs(bcc) ? { bcc: joinAddrs(bcc) } : {}),
    subject: subject || '(제목 없음)',
    html: wireHtmlOut,
    ...(wireText ? { text: wireText } : {}),
    ...(inReplyTo ? { inReplyTo } : {}),
    ...(references && references.length ? { references } : {}),
    ...(allAttachments.length ? { attachments: allAttachments } : {}),
  });

  return {
    messageId: info.messageId,
    accepted: info.accepted || [],
    rejected: info.rejected || [],
    // 라우트가 outbound row 에 **실제 나간 주소**를 기록하도록 돌려준다.
    //   여태 라우트가 account.email 을 하드코딩해, 별칭으로 나간 메일도 보낸메일함엔 계정 주소로 남았다.
    fromEmail: ident.fromEmail,
    fromName: ident.fromName || null,
  };
}

/**
 * SMTP 결과를 실제 상태로 옮긴다.
 *
 * 여태 발송 라우트 3곳이 무조건 delivery_status:'sent' 를 박아 넣었다. 그래서
 *  - dev 에서 게이트가 삼킨 발송도 "보냄" 으로 기록되어 사용자가 보냈다고 믿었고 (2026-07-27 Irene 보고)
 *  - 수신자가 거부된 발송도 성공으로 남았다.
 * 'delivered'(수신자 메일서버 최종 인계)는 DSN 없이는 알 수 없으므로 여기서 절대 만들지 않는다.
 */
function deliveryFromSendResult(sendResult) {
  if (sendResult?.suppressed) {
    return { delivery_status: 'suppressed', delivery_error: 'EMAIL_SENDING_ENABLED=false — 이 서버는 실제 발송하지 않습니다' };
  }
  const accepted = Array.isArray(sendResult?.accepted) ? sendResult.accepted : [];
  const rejected = Array.isArray(sendResult?.rejected) ? sendResult.rejected : [];
  if (rejected.length && !accepted.length) {
    return { delivery_status: 'failed', delivery_error: `전 수신자 거부: ${rejected.join(', ')}`.slice(0, 1000) };
  }
  if (rejected.length) {
    // 일부만 거부 — 나간 건 나갔으므로 sent 이되 거부 목록을 남긴다(조용히 삼키지 않는다).
    return { delivery_status: 'sent', delivery_error: `일부 수신자 거부: ${rejected.join(', ')}`.slice(0, 1000) };
  }
  return { delivery_status: 'sent', delivery_error: null };
}

module.exports = {
  appendSignature,
  resolveSender, resolveOutgoingIdentity, sendMail, buildTransport, deriveSmtpHost, deliveryFromSendResult };
