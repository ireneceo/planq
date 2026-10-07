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
 * 질문과 겹치는 **읽을 수 있는** 노트 몇 건 — 상태를 같이 준다.
 *   status 'ok' = q-note 가 답했다(0건일 수도 있다) · 'unavailable' = 못 물었다(키 없음·타임아웃·오류).
 *   AI 통합 검색(services/searchScope.searchMeetingNotes)은 이 둘을 **다르게** 말해야 한다 — 실패를 빈 결과로 위장하지 않는다.
 * @returns {Promise<{status:'ok'|'unavailable', items:Array<{id:number,title:string,created_at:string,snippet:string,project_id:?number,client_id:?number,is_mine:boolean}>}>}
 */
async function searchNotes({ businessId, userId, query, limit = 3, snippetChars = 700 }) {
  const key = process.env.INTERNAL_API_KEY;
  if (!String(query || '').trim()) return { status: 'ok', items: [] };
  if (!key || !businessId || !userId) return { status: 'unavailable', items: [] };
  const base = process.env.QNOTE_INTERNAL_URL || 'http://localhost:8000';
  const qs = new URLSearchParams({
    business_id: String(businessId),
    user_id: String(userId),
    q: String(query).slice(0, 300),
    limit: String(Math.max(1, Math.min(10, limit))),
    snippet_chars: String(Math.max(100, snippetChars)),
  });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(`${base}/api/sessions/internal/search?${qs}`, {
      headers: { 'x-internal-api-key': key }, signal: ctrl.signal,
    });
    if (!r.ok) return { status: 'unavailable', items: [] };
    const j = await r.json();
    return { status: 'ok', items: Array.isArray(j?.data) ? j.data : [] };
  } catch { return { status: 'unavailable', items: [] }; }
  finally { clearTimeout(timer); }
}

/**
 * 질문과 겹치는 **본인** 노트 몇 건(Cue 용 — 실패하면 [] 로 조용히).
 * @returns {Promise<Array<{id:number,title:string,created_at:string,snippet:string}>>} 실패 시 []
 */
async function searchMyNotes(args) {
  const r = await searchNotes(args);
  return r.items;
}

/**
 * 노트 한 건 읽기(AI 앱 get_meeting_note, 설계 docs/AI_AGENT_M3_DESIGN.md §1.2) — q-note `internal/read`.
 *   판정은 q-note 의 session_read_allowed(상세 조회와 같은 문). Node 는 판정하지 않는다 — 통로다.
 * @returns {Promise<{status:'ok', note:object}|{status:'not_found'}|{status:'unavailable'}>}
 */
async function readNote({ businessId, userId, sessionId, offset = 0, maxChars = 6000 }) {
  const key = process.env.INTERNAL_API_KEY;
  if (!key || !businessId || !userId || !sessionId) return { status: 'unavailable' };
  const base = process.env.QNOTE_INTERNAL_URL || 'http://localhost:8000';
  const qs = new URLSearchParams({
    session_id: String(sessionId), user_id: String(userId), business_id: String(businessId),
    offset: String(Math.max(0, offset)), max_chars: String(Math.max(100, Math.min(20000, maxChars))),
  });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS * 2);
  try {
    const r = await fetch(`${base}/api/sessions/internal/read?${qs}`, {
      headers: { 'x-internal-api-key': key }, signal: ctrl.signal,
    });
    if (r.status === 404) return { status: 'not_found' };
    if (!r.ok) return { status: 'unavailable' };
    const j = await r.json();
    return j?.data ? { status: 'ok', note: j.data } : { status: 'unavailable' };
  } catch { return { status: 'unavailable' }; }
  finally { clearTimeout(timer); }
}

/**
 * 텍스트 메모 만들기(AI 앱 create_memo, 2026-10-07 Fable B 판정 3) — q-note `internal/create-memo`.
 *   신원은 부르는 쪽이 토큰에서 꺼낸 값만 넘긴다. 공개 범위는 q-note 기본값(L1 — 본인만).
 *   ★ 실패를 성공으로 위장하지 않는다 — 'unavailable' 이면 부르는 쪽이 오류로 알린다(쓰기는 fail-closed).
 * @param {{businessId:number, userId:number, title:string, bodyJson:string, projectId?:number|null, clientId?:number|null}} a
 * @returns {Promise<{status:'ok', memo:object}|{status:'forbidden', reason:string}|{status:'invalid', reason:string}|{status:'unavailable'}>}
 */
async function createMemo({ businessId, userId, title, bodyJson, projectId = null, clientId = null }) {
  const key = process.env.INTERNAL_API_KEY;
  if (!key || !businessId || !userId) return { status: 'unavailable' };
  const base = process.env.QNOTE_INTERNAL_URL || 'http://localhost:8000';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS * 3);
  try {
    const r = await fetch(`${base}/api/sessions/internal/create-memo`, {
      method: 'POST',
      headers: { 'x-internal-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, business_id: businessId, title, body: bodyJson, project_id: projectId, client_id: clientId }),
      signal: ctrl.signal,
    });
    if (r.status === 403) {
      const j = await r.json().catch(() => ({}));
      return { status: 'forbidden', reason: String(j?.detail || 'forbidden') };
    }
    if (r.status === 400 || r.status === 422) return { status: 'invalid', reason: 'invalid_input' };
    if (!r.ok) return { status: 'unavailable' };
    const j = await r.json();
    return j?.data ? { status: 'ok', memo: j.data } : { status: 'unavailable' };
  } catch { return { status: 'unavailable' }; }
  finally { clearTimeout(timer); }
}

module.exports = { searchMyNotes, searchNotes, readNote, createMemo };
