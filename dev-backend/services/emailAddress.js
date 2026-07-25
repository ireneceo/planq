// 메일 주소 표현 단일 원천 (#200 b')
//
// 저장된 주소 목록의 shape 이 세 가지로 혼재한다:
//   { email, name }   — IMAP 수신 경로가 저장하는 형태 (emailImapCron.js, 운영 977/985)
//   'a@b.c'           — 발송 경로가 저장하는 형태 (email_threads.js toList, 운영 5건)
//   { address, name } — mailparser 원형 (headers 파싱 직후)
//
// 파싱을 호출부마다 흩어 놓았더니 email_threads.js 의 답장 라우트가 `x?.address` 로 읽어
//   `{email,name}` 저장분을 통째로 흘렸다 — 별칭 자동 선택(emailSend.resolveSender ②)이
//   빈 배열만 받아 죽어 있었다. 포맷 흡수는 이 파일 한 곳에서만 한다.

// 주소 하나에서 이메일 문자열 추출 (문자열 / {email} / {address} 전부)
function pickEmail(x) {
  if (!x) return '';
  if (typeof x === 'string') return x.trim();
  if (typeof x === 'object') {
    if (x.email) return String(x.email).trim();
    if (x.address) return String(x.address).trim();
  }
  return '';
}

function pickName(x) {
  if (!x || typeof x !== 'object') return '';
  return String(x.name || '').trim();
}

// 주소 목록 정규화 → [{ email(소문자), name }]. 빈 주소·중복 제거.
function normalizeAddrList(v) {
  const arr = Array.isArray(v) ? v : (v ? [v] : []);
  const out = [];
  const seen = new Set();
  for (const x of arr) {
    const email = pickEmail(x).toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    out.push({ email, name: pickName(x) });
  }
  return out;
}

// 이메일 문자열 배열만 (소문자)
function emailsOf(v) {
  return normalizeAddrList(v).map((a) => a.email);
}

// 스레드 참여자 병합 — 멱등.
//   excludeEmails 는 prev 를 포함한 **최종 결과 전체**에 적용한다 (옛 데이터에 자기 주소가
//   섞여 있어도 같은 술어로 정리되게. 안 그러면 백필 결과와 라이브 결과가 갈린다).
//   항목 shape 은 라이브와 동일한 { email, name, is_internal } 3키만 유지한다.
function mergeParticipants(prev, incoming, { excludeEmails = [] } = {}) {
  const excl = new Set(
    (Array.isArray(excludeEmails) ? excludeEmails : [excludeEmails])
      .map((e) => String(e || '').trim().toLowerCase())
      .filter(Boolean),
  );
  const out = [];
  const idx = new Map();
  const push = (x) => {
    const email = pickEmail(x).toLowerCase();
    if (!email || excl.has(email)) return;
    const name = pickName(x);
    const internal = !!(x && typeof x === 'object' && x.is_internal === true);
    const hit = idx.get(email);
    if (hit) {
      // 이름은 먼저 들어온 쪽을 지킨다 — 옛 데이터가 가진 표시명을 백필이 덮지 않게.
      if (!hit.name && name) hit.name = name;
      if (internal) hit.is_internal = true;
      return;
    }
    const entry = { email, name: name || '', is_internal: internal };
    idx.set(email, entry);
    out.push(entry);
  };
  for (const x of (Array.isArray(prev) ? prev : [])) push(x);
  for (const x of (Array.isArray(incoming) ? incoming : [])) push(x);
  return out;
}

// 변경 여부 판정 (백필 UPDATE 스킵용) — 키 순서까지 같은 형태로만 만들어지므로 문자열 비교로 충분
function participantsEqual(a, b) {
  const norm = (v) => JSON.stringify(Array.isArray(v) ? v : []);
  return norm(a) === norm(b);
}

// 이 계정이 "나" 인 주소들 — 계정 주소 + 별칭. 참여자 제외 집합.
//   비즈니스 단위가 아니라 **계정 단위**다. 같은 워크스페이스의 다른 계정(help@ ↔ irene@)끼리
//   주고받은 메일에서 상대는 정당한 참여자다.
async function selfEmailsForAccount(account) {
  const { EmailAccount, EmailAccountAlias } = require('../models');
  let acc = account;
  if (!acc || typeof acc !== 'object') {
    acc = await EmailAccount.findByPk(Number(account));
  }
  if (!acc) return [];
  const out = [];
  const own = String(acc.email || '').trim().toLowerCase();
  if (own) out.push(own);
  try {
    const aliases = await EmailAccountAlias.findAll({ where: { account_id: acc.id }, attributes: ['email'] });
    for (const a of aliases) {
      const e = String(a.email || '').trim().toLowerCase();
      if (e) out.push(e);
    }
  } catch (e) {
    // 별칭 조회 실패가 메일 저장·발송을 막으면 안 된다 (부가 정보)
    console.warn('[emailAddress] aliases', e.message);
  }
  return [...new Set(out)];
}

module.exports = {
  normalizeAddrList,
  emailsOf,
  mergeParticipants,
  participantsEqual,
  selfEmailsForAccount,
};
