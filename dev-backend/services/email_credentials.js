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

async function verifyImapCredentials({ host, port, tls, username, password, folder }) {
  try {
    const imaps = require('imap-simple');
    const conn = await imaps.connect({
      imap: { user: username, password, host, port, tls, authTimeout: 10000, tlsOptions: { rejectUnauthorized: false } },
    });
    await conn.openBox(folder || 'INBOX');
    await conn.end();
    return { ok: true };
  } catch (e) {
    const msg = String((e && e.message) || e);
    const h = String(host || '').toLowerCase();
    if (/invalid credentials|authenticat|login fail|auth/i.test(msg)) {
      if (h.includes('gmail') || h.includes('googlemail')) return { ok: false, code: 'gmail_app_password_required', detail: msg };
      if (h.includes('naver')) return { ok: false, code: 'naver_app_password_required', detail: msg };
      if (h.includes('office365') || h.includes('outlook')) return { ok: false, code: 'ms_app_password_required', detail: msg };
      return { ok: false, code: 'imap_auth_failed', detail: msg };
    }
    if (/enotfound|getaddrinfo/i.test(msg)) return { ok: false, code: 'imap_host_not_found', detail: msg };
    return { ok: false, code: 'imap_connect_failed', detail: msg };
  }
}

module.exports = {
  APP_PASSWORD_HOSTS,
  normalizeImapPassword,
  verifyImapCredentials,
};
