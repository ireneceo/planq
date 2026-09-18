// services/qnoteOwnership.js — "이 노트가 정말 그 사람 것인가" 를 묻는 **단 하나의 문**.
//
// Q Note 는 별도 서비스(SQLite)라 Node 가 직접 못 읽는다. 그래서 `qnote_session_id` 를 원장에
// 적는 곳(Q sale 상담 저장)은 여기로 묻는다. 화면이 보낸 번호를 그대로 적으면 남의 세션 번호가
// 박힌 기록이 생긴다 — 열면 403 이라 내용이 새지는 않지만 **원장에 거짓이 남는다.**
//
// ★ `qnoteByEntity` 로 대신 묻지 않는다 — 그 문은 `visibility <> 'L1'` 이라 개인 노트를 안 준다.
//   막 끝낸 내 회의는 대개 L1 이므로 그 문으로 물으면 **내 것도 "아니다"** 가 된다.
// ★ 실패를 조용히 통과시키지 않는다(fail-closed). q-note 가 죽었으면 저장을 막는다 —
//   목록 화면은 비어도 되지만 원장은 확인 못 한 값을 받으면 안 된다.

/**
 * @returns {Promise<{ ok: true, session: object } | { ok: false, reason: string }>}
 */
async function verifyQnoteSession({ sessionId, userId, businessId }) {
  const sid = Number(sessionId);
  if (!Number.isInteger(sid) || sid <= 0) return { ok: false, reason: 'invalid_qnote_session' };
  const key = process.env.INTERNAL_API_KEY;
  if (!key) return { ok: false, reason: 'qnote_unavailable' };
  const base = process.env.QNOTE_INTERNAL_URL || 'http://localhost:8000';
  const qs = new URLSearchParams({
    session_id: String(sid), user_id: String(userId), business_id: String(businessId),
  });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2500);
  try {
    const r = await fetch(`${base}/api/sessions/internal/owns?${qs}`, {
      headers: { 'x-internal-api-key': key }, signal: ctrl.signal,
    });
    if (r.status === 404) return { ok: false, reason: 'qnote_session_not_found' };
    if (!r.ok) return { ok: false, reason: 'qnote_unavailable' };
    const j = await r.json();
    const data = j && j.data;
    if (!data || Number(data.id) !== sid) return { ok: false, reason: 'qnote_session_not_found' };
    return { ok: true, session: data };
  } catch { return { ok: false, reason: 'qnote_unavailable' }; }
  finally { clearTimeout(timer); }
}

module.exports = { verifyQnoteSession };
