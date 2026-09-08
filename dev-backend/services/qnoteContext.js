// services/qnoteContext.js — Cue 가 **내 회의록**을 읽는 단일 통로 (2026-09-08).
//
// Irene: "Q sale 빼고 다 해줘." Cue 는 업무·문서·파일·메일까지 읽으면서
//   **회의에서 정한 것**만 못 읽었다. 정작 "그때 뭐라고 했더라" 가 가장 자주 묻는 것이다.
//
// ★ 이 파일이 지키는 두 가지
//   ① **본인 것만.** `user_id` 를 반드시 넘기고, q-note 쪽 `/internal/search` 가 그 조건으로
//      격리한다. owner·admin·platform_admin 예외 없음 — Q Note 는 사적 공간이다
//      (PERMISSION_MATRIX §5.8 · memory feedback_qnote_personal_tool).
//   ② **답이 묻는 사람에게만 뜨는 경로에서만.** 판정은 부르는 쪽(cue_context)이 하고
//      여기서는 안 한다 — 판정을 두 곳에 두면 갈라진다. 여기는 통로다.
//
// ★ 실패해도 Cue 를 죽이지 않는다. q-note 는 별도 프로세스(FastAPI)라 재기동 창이 있다.
//   회의록 하나 못 읽었다고 업무·청구 답변까지 안 나오면 그게 더 큰 사고다.
//   (같은 계약: services/event_stream.js 의 qnote 블록)

const TIMEOUT_MS = 2500;

/**
 * 질문과 겹치는 **본인** 노트 몇 건.
 * @returns {Promise<Array<{id:number,title:string,created_at:string,snippet:string}>>} 실패 시 []
 */
async function searchMyNotes({ businessId, userId, query, limit = 3, snippetChars = 700 }) {
  const key = process.env.INTERNAL_API_KEY;
  if (!key || !businessId || !userId || !String(query || '').trim()) return [];
  const base = process.env.QNOTE_INTERNAL_URL || 'http://localhost:8000';
  const qs = new URLSearchParams({
    business_id: String(businessId),
    user_id: String(userId),
    q: String(query).slice(0, 300),
    limit: String(Math.max(1, Math.min(10, limit))),
    snippet_chars: String(snippetChars),
  });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(`${base}/api/sessions/internal/search?${qs}`, {
      headers: { 'x-internal-api-key': key }, signal: ctrl.signal,
    });
    if (!r.ok) return [];
    const j = await r.json();
    return Array.isArray(j?.data) ? j.data : [];
  } catch { return []; }
  finally { clearTimeout(timer); }
}

module.exports = { searchMyNotes };
