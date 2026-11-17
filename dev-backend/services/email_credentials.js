// 메일 계정 IMAP 자격 검증 — 라우트에서 분리 (routes/email_accounts.js god-file 해소)
//
// 두 가지 책임만 담는다:
//   1) normalizeImapPassword — provider 별 비밀번호 정규화 (앱비밀번호 공백 문제, #198)
//   2) verifyImapCredentials — 등록/수정 전 실제 IMAP 접속 검증 + 원인별 안내 코드 분류

// IMAP 자격 실검증 — 등록/수정 전 강제. 실패 원인을 provider 별 안내 코드로 분류.
// 앱 비밀번호를 쓰는 provider — Google/Naver/Apple/MS 는 화면에 4자 4묶음(예: 'abcd efgh ijkl mnop')으로
// 보여줘서 사용자가 공백째 붙여넣는다. 그대로 IMAP AUTH 하면 실패 → "일반 비밀번호를 넣었다" 로 오진된다.
const APP_PASSWORD_HOSTS = ['gmail', 'googlemail', 'naver', 'icloud', 'me.com', 'office365', 'outlook', 'hotmail'];
function normalizeImapPassword(host, password) {
  if (password === undefined || password === null) return password;
  const raw = String(password);
  const h = String(host || '').toLowerCase();
  // 앱비밀번호 provider: 모든 공백류(일반/NBSP) 제거. 그 외: 앞뒤 공백만 (중간 공백이 유효한 비밀번호일 수 있음)
  return APP_PASSWORD_HOSTS.some((x) => h.includes(x))
    ? raw.replace(/[\s\u00A0]/g, '')
    : raw.trim();
}

// 응답 없음 판정·길 고르기는 services/mailRoute 한 곳(2026-11-17 한국 중계 — docs/MAIL_KR_RELAY_DESIGN.md).
const mailRoute = require('./mailRoute');
const { isUnreachable } = mailRoute;

// 중계를 탈 수도 있을 때만 검사한 주소를 구한다(중계는 그 IP 로만 CONNECT).
async function relayAddresses(host, port, tls, authType) {
  if (!mailRoute.relayAllowed({ port, tls, authType })) return null;
  const { assertOutboundHostAllowed } = require('../utils/netGuard');
  const g = await assertOutboundHostAllowed(host, port);
  return g.ok ? g.addresses : null;
}

// 결과의 `route`(direct|relay)는 등록·수정이 계정에 저장한다. `account` 를 주면 mailRoute 가 직접 기억한다.
async function verifyImapCredentials({ host, port, tls, username, password, folder, account = null, authType = 'password' }) {
  let addresses = null;
  try {
    addresses = await relayAddresses(host, port, tls, authType);
    const imapConfig = { user: username, password, host, port, tls, authTimeout: 10000, tlsOptions: { rejectUnauthorized: false } };
    const run = addresses
      ? mailRoute.connectImap(account, imapConfig, { addresses, authType })
      : require('imap-simple').connect({ imap: imapConfig }).then((conn) => ({ conn, route: 'direct' }));
    const { conn, route } = await run;
    await conn.openBox(folder || 'INBOX');
    await conn.end();
    return { ok: true, route };
  } catch (e) {
    if (e && e.pqCode === 'relay_unavailable') return { ok: false, code: 'relay_unavailable', detail: e.message };
    if (e && e.pqCode === 'cert') return { ok: false, code: 'imap_cert_invalid', detail: e.message };
    const msg = String((e && e.message) || e);
    const h = String(host || '').toLowerCase();
    if (/invalid credentials|authenticat|login fail|auth|application-specific password/i.test(msg)) {
      // 구글은 두 갈래로 거절한다 — 화면 안내가 달라야 한다(2단계 인증 꺼진 사람이 «앱 비밀번호 만들기» 로 가면 막힌다).
      //   ① 2단계 인증 켜짐 + 계정 비밀번호 → «Application-specific password required» → 앱 비밀번호를 만들면 된다
      //   ② 그 밖(2단계 인증 꺼짐 + 계정 비밀번호 · 앱 비밀번호 오타) → «Invalid credentials» → 2단계 인증부터 / 다시 붙여넣기
      if (h.includes('gmail') || h.includes('googlemail')) {
        if (/application-specific password required/i.test(msg)) return { ok: false, code: 'gmail_app_password_required', detail: msg };
        return { ok: false, code: 'gmail_auth_invalid', detail: msg };
      }
      if (h.includes('naver')) return { ok: false, code: 'naver_app_password_required', detail: msg };
      if (h.includes('office365') || h.includes('outlook')) return { ok: false, code: 'ms_app_password_required', detail: msg };
      return { ok: false, code: 'imap_auth_failed', detail: msg };
    }
    if (/enotfound|getaddrinfo/i.test(msg)) return { ok: false, code: 'imap_host_not_found', detail: msg };
    // 응답 없음(타임아웃) ≠ 주소·포트 틀림 — 2026-11-16 gmate.co.kr 실측: 한국 회사 메일 서버가 해외(우리 서버 DE)
    //   접속을 말없이 버려 «주소·포트 확인» 안내가 거짓이었다(같은 값으로 맥 메일은 연결됨).
    // 한국 중계까지 거쳤는데도 응답 없음 — «해외 차단» 이 아니라 주소·포트·서버 쪽 문제다(안내가 다르다)
    if (isUnreachable(e, msg)) return { ok: false, code: addresses ? 'imap_unreachable_relay' : 'imap_unreachable', detail: msg };
    return { ok: false, code: 'imap_connect_failed', detail: msg };
  }
}

// SMTP(보내기) 자격 실검증 — 로그인만 하고 메일은 보내지 않는다(nodemailer verify = EHLO + AUTH).
//
// ★ 2026-09-21 — 여태 연결·수정은 **IMAP(받기)만** 검사했다. 운영의 네이버 계정이 받기는 되는데
//   보내기는 535 로 거절되고 있었다 — 추가 화면이 이메일 칸 **첫 글자**를 보내기 아이디로 복사해
//   `smtp_username` 이 한 글자로 저장됐다. 받기는 멀쩡해서 아무도 몰랐고, 보내는 순간에야 실패한다.
//   발송 코드(emailSend.buildTransport)와 **같은 규칙**으로 호스트·포트·아이디를 정한다 — 검사와 실제가
//   다르면 검사가 초록이어도 발송은 실패한다.
//   `preferRoute` = 받기가 성공한 길 — 그 길부터 시도한다(등록 대기 최악 시간을 줄인다, Fable).
async function verifySmtpCredentials({ host, port, username, password, tls, preferRoute = null, authType = 'password' }) {
  const p = Number(port) || 587;
  const addresses = await relayAddresses(host, p, tls, authType);
  let order = ['direct'];
  if (addresses) order = mailRoute.forceRelay() ? ['relay'] : (preferRoute === 'relay' ? ['relay'] : ['direct', 'relay']);
  let res;
  for (let i = 0; i < order.length; i += 1) {
    res = await verifySmtpOnce({ host, port: p, username, password, tls, route: order[i], addresses, fallback: i < order.length - 1 });
    if (res.ok || res.code !== 'smtp_unreachable' || order[i] !== 'direct') break;
  }
  if (!res.ok && res.code === 'smtp_unreachable' && order.includes('relay')) return { ...res, code: 'smtp_unreachable_relay' };
  return res;
}

async function verifySmtpOnce({ host, port: p, username, password, tls, route, addresses, fallback }) {
  const nodemailer = require('nodemailer');
  const tr = nodemailer.createTransport({
    host, port: p, secure: p === 465,
    auth: { user: username, pass: password },
    requireTLS: tls !== false && p !== 465,
    connectionTimeout: fallback ? mailRoute.DIRECT_TIMEOUT_WITH_FALLBACK_MS : 10000, greetingTimeout: 10000, socketTimeout: 15000,
    ...(route === 'relay' ? mailRoute.smtpRelayOptions(host, addresses) : {}),
  });
  try {
    await tr.verify();
    return { ok: true, route };
  } catch (e) {
    if (e && e.pqCode === 'relay_unavailable') return { ok: false, code: 'relay_unavailable', detail: e.message };
    if (route === 'relay' && mailRoute.isCertError(e)) return { ok: false, code: 'smtp_cert_invalid', detail: String(e.message) };
    const msg = String((e && e.message) || e);
    const h = String(host || '').toLowerCase();
    if (e && (e.code === 'EAUTH' || /535|534|auth/i.test(msg))) {
      if (h.includes('gmail') || h.includes('googlemail')) return { ok: false, code: 'gmail_smtp_auth_failed', detail: msg };
      if (h.includes('naver')) return { ok: false, code: 'naver_smtp_auth_failed', detail: msg };
      if (h.includes('office365') || h.includes('outlook')) return { ok: false, code: 'ms_smtp_auth_failed', detail: msg };
      return { ok: false, code: 'smtp_auth_failed', detail: msg };
    }
    if (/enotfound|getaddrinfo/i.test(msg)) return { ok: false, code: 'smtp_host_not_found', detail: msg };
    if (isUnreachable(e, msg)) return { ok: false, code: 'smtp_unreachable', detail: msg };
    return { ok: false, code: 'smtp_connect_failed', detail: msg };
  } finally {
    try { tr.close(); } catch { /* noop */ }
  }
}

module.exports = {
  APP_PASSWORD_HOSTS,
  normalizeImapPassword,
  verifyImapCredentials,
  verifySmtpCredentials,
};
