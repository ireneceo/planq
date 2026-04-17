import { useEffect, useState, useCallback } from 'react';
import { detectBrowserTz } from '../utils/timezones';

// 백엔드 미연결 단계에서 사용할 로컬 저장소 키
// 백엔드 연결 후 이 훅은 API 기반으로 교체됨.
const K_WS_TZ = 'planq:mock:workspace_timezone';
const K_WS_REFS = 'planq:mock:workspace_reference_timezones';
const K_USER_TZ = 'planq:mock:user_timezone';
const K_USER_REFS = 'planq:mock:user_reference_timezones';

function readList(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function readString(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export type TimezonesState = {
  workspaceTz: string;
  workspaceRefs: string[];
  userTz: string;
  userRefs: string[];
};

export function useTimezones() {
  const browserTz = detectBrowserTz();

  const load = useCallback((): TimezonesState => ({
    workspaceTz: readString(K_WS_TZ) || 'Asia/Seoul',
    workspaceRefs: readList(K_WS_REFS),
    userTz: readString(K_USER_TZ) || browserTz,
    userRefs: readList(K_USER_REFS),
  }), [browserTz]);

  const [state, setState] = useState<TimezonesState>(() => load());

  // 같은 탭 내 다른 컴포넌트에서 변경 시 반영을 위한 이벤트
  useEffect(() => {
    const handler = () => setState(load());
    window.addEventListener('planq:timezones-changed', handler);
    window.addEventListener('storage', handler);
    return () => {
      window.removeEventListener('planq:timezones-changed', handler);
      window.removeEventListener('storage', handler);
    };
  }, [load]);

  const update = useCallback((patch: Partial<TimezonesState>) => {
    if (patch.workspaceTz !== undefined) localStorage.setItem(K_WS_TZ, patch.workspaceTz);
    if (patch.workspaceRefs !== undefined) localStorage.setItem(K_WS_REFS, JSON.stringify(patch.workspaceRefs));
    if (patch.userTz !== undefined) localStorage.setItem(K_USER_TZ, patch.userTz);
    if (patch.userRefs !== undefined) localStorage.setItem(K_USER_REFS, JSON.stringify(patch.userRefs));
    window.dispatchEvent(new Event('planq:timezones-changed'));
  }, []);

  return { ...state, update };
}
