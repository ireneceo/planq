// components/QTask/createTaskTag.ts — 업무 태그를 **만드는 한 곳** (2026-09-08).
//
// Irene: *"팝아웃에서 태그선택에서 태그 없으면 추가되게 하면 안돼?"* /
//        *"Q task에서도 전체리스트에 있는 태그선택란에서도 만들게 하면 안돼?"*
//
// 만드는 문이 늘어난다 — 지금은 업무 상세·행 메뉴, 여기에 팝아웃 퀵애드와 목록 필터가 붙는다.
// 호출을 각자 적으면 이름 길이 제한·에러 처리·응답 모양이 곧 갈라진다. 한 함수만 둔다.
// (`TagQuickMenu` 도 이 함수를 쓴다 — 만드는 규칙이 두 벌이 되지 않게.)
import { apiFetch } from '../../contexts/AuthContext';

export interface TaskTagLite { id: number; name: string; color: string | null }

/** 태그를 만든다. 실패하면 null (throw 하지 않는다 — apiFetch 계약과 같다). */
export async function createTaskTag(bizId: number | null, rawName: string): Promise<TaskTagLite | null> {
  const name = String(rawName || '').trim().slice(0, 30);   // 길이 상한은 여기 하나
  if (!name || !bizId) return null;
  try {
    const r = await apiFetch('/api/tasks/tags', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ business_id: bizId, name }),
    });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.success || !j.data) return null;
    return j.data as TaskTagLite;
  } catch { return null; }
}
