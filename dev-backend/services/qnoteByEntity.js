// services/qnoteByEntity.js — 프로젝트·고객에 연결된 Q Note 세션을 읽는 **단 하나의 문**.
//
// ★ 2026-09-13 (Irene: *"상단에 문서 다음에 노트 넣어줘. 노트는 Q note가 프로젝트로 연결되면
//   잡히는 거야."* · *"Q note나 문서 등 고객이 연결되면 고객프로필에도 나와야 하는 거야."*)
//
// 여태 이 호출은 `services/event_stream.js` 안에 **인라인**으로 있었다(히스토리 전용).
// 노트 탭·고객 프로필이 같은 것을 읽어야 하므로 꺼냈다 — 베껴 두면 한쪽만 L1 필터가 빠지거나
// 타임아웃이 달라진다(memory `feedback_copied_component_drifts_extract_shell`).
//
// ★ 범위는 q-note 쪽이 정한다: `visibility <> 'L1'` — **개인 노트는 안 준다.**
//   프로젝트에 연결했다는 것과 남이 읽어도 된다는 것은 다르다(PERMISSION_MATRIX §5.8).
//   여기서 그 조건을 우회하지 않는다.

/**
 * @param {{ businessId: number, projectId?: number|null, clientId?: number|null, limit?: number }} opts
 * @returns {Promise<Array<{id:number,title:string|null,user_id:number,created_at:string,status:string,capture_mode:string,project_id:number|null,client_id:number|null}>>}
 */
async function listQnoteByEntity({ businessId, projectId = null, clientId = null, limit = 50 }) {
  const key = process.env.INTERNAL_API_KEY;
  if (!key) return [];                       // 키가 없으면 **조용히 빈 목록** — 화면은 "없음" 으로 그린다
  if (!projectId && !clientId) return [];
  const base = process.env.QNOTE_INTERNAL_URL || 'http://localhost:8000';
  const qs = new URLSearchParams({ business_id: String(businessId), limit: String(Math.min(limit, 100)) });
  if (projectId) qs.set('project_id', String(projectId));
  if (clientId) qs.set('client_id', String(clientId));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2500);
  try {
    const r = await fetch(`${base}/api/sessions/internal/by-entity?${qs}`, {
      headers: { 'x-internal-api-key': key }, signal: ctrl.signal,
    });
    if (!r.ok) return [];
    const j = await r.json();
    return Array.isArray(j?.data) ? j.data : [];
  } catch { return []; }                     // q-note 가 죽어도 프로젝트 화면은 떠야 한다
  finally { clearTimeout(timer); }
}

module.exports = { listQnoteByEntity };
