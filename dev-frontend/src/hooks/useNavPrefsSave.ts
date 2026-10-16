// 사이드바 «메뉴 편집» 저장 — 사람 × 지금 워크스페이스(서버 PUT /api/businesses/:id/me/nav-prefs · services/navPrefs).
//   화면을 먼저 바꾸고, 실패하면 되돌린 뒤 던진다 — 던져야 편집 칸이 «저장하지 못했어요» 를 띄운다
//   (apiFetch 는 실패해도 throw 하지 않는다).
import { useCallback } from 'react';
import { apiFetch, useAuth } from '../contexts/AuthContext';
import type { NavPrefs } from '../config/navPrefs';

export function useNavPrefsSave() {
  const { user, updateUser } = useAuth();
  return useCallback(async (next: NavPrefs | null) => {
    const bizId = user?.business_id;
    if (!bizId) throw new Error('no_workspace');
    const prev = user?.nav_prefs ?? null;
    updateUser({ nav_prefs: next });
    const res = await apiFetch(`/api/businesses/${bizId}/me/nav-prefs`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nav_prefs: next }),
    });
    const j = await res.json().catch(() => null);
    if (!res.ok || !j?.success) { updateUser({ nav_prefs: prev }); throw new Error('save_failed'); }
  }, [user, updateUser]);
}
