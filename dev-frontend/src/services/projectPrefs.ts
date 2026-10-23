// 프로젝트 별·직접 정렬 API (2026-10-23, docs/PROJECT_PREFS_DESIGN.md). 사람 단위 — 서버 user_entity_prefs.
//   대화방 별(qtalk.pinConversation)과 같은 모양 — 성공 여부만 돌려준다(화면이 낙관 반영 후 실패면 되돌린다).
import { apiFetch } from '../contexts/AuthContext';

export async function setProjectPinned(projectId: number, pinned: boolean): Promise<boolean> {
  const r = await apiFetch(`/api/projects/${projectId}/pin`, { method: pinned ? 'POST' : 'DELETE' });
  const j = await r.json().catch(() => null);
  return !!j?.success;
}

export async function saveProjectOrder(businessId: number, ids: number[]): Promise<boolean> {
  const r = await apiFetch('/api/projects/order', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ business_id: businessId, ids }),
  });
  const j = await r.json().catch(() => null);
  return !!j?.success;
}

export async function resetProjectOrder(businessId: number): Promise<boolean> {
  const r = await apiFetch(`/api/projects/order?business_id=${businessId}`, { method: 'DELETE' });
  const j = await r.json().catch(() => null);
  return !!j?.success;
}

/** 서버 신호 이름 — 내 다른 기기·탭에서 별·순서가 바뀌었다(신호만, 받는 화면이 다시 읽는다). */
export const PROJECT_PREF_EVENT = 'project:pref';
