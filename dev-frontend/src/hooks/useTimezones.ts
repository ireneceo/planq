import { useCallback } from 'react';
import { detectBrowserTz } from '../utils/timezones';
import { useAuth, apiFetch } from '../contexts/AuthContext';

// 타임존 상태와 갱신 훅.
// - 워크스페이스 타임존 / 참조 타임존은 active workspace(business) 기준 — owner 만 수정 가능.
// - 개인 타임존 / 참조 타임존은 본인 계정 기준.
// - 소스: /api/auth/me (AuthContext.user) 에서 읽고, 수정은 PUT /api/businesses/:id/settings,
//   PUT /api/users/:id 로 영속화 후 user 상태를 갱신한다.

export type TimezonesState = {
  workspaceTz: string;
  workspaceRefs: string[];
  userTz: string;
  userRefs: string[];
};

export function useTimezones() {
  const { user, updateUser } = useAuth();
  const browserTz = detectBrowserTz();

  const workspaceTz = user?.workspace_timezone || 'Asia/Seoul';
  const workspaceRefs = Array.isArray(user?.workspace_reference_timezones)
    ? (user!.workspace_reference_timezones as string[])
    : [];
  const userTz = user?.timezone || browserTz;
  const userRefs = Array.isArray(user?.reference_timezones)
    ? (user!.reference_timezones as string[])
    : [];

  const update = useCallback(async (patch: Partial<TimezonesState>) => {
    if (!user) return;

    // 워크스페이스 타임존 변경 — PUT /api/businesses/:id/settings
    if (patch.workspaceTz !== undefined || patch.workspaceRefs !== undefined) {
      const businessId = user.business_id;
      if (businessId) {
        const body: Record<string, unknown> = {};
        if (patch.workspaceTz !== undefined) body.timezone = patch.workspaceTz;
        if (patch.workspaceRefs !== undefined) body.reference_timezones = patch.workspaceRefs;
        const res = await apiFetch(`/api/businesses/${businessId}/settings`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (res.ok) {
          updateUser({
            workspace_timezone: patch.workspaceTz ?? workspaceTz,
            workspace_reference_timezones: patch.workspaceRefs ?? workspaceRefs,
          });
        } else {
          throw new Error('workspace_timezone_update_failed');
        }
      }
    }

    // 개인 타임존 변경 — PUT /api/users/:id
    if (patch.userTz !== undefined || patch.userRefs !== undefined) {
      const body: Record<string, unknown> = {};
      if (patch.userTz !== undefined) body.timezone = patch.userTz;
      if (patch.userRefs !== undefined) body.reference_timezones = patch.userRefs;
      const res = await apiFetch(`/api/users/${user.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        updateUser({
          timezone: patch.userTz ?? userTz,
          reference_timezones: patch.userRefs ?? userRefs,
        });
      } else {
        throw new Error('user_timezone_update_failed');
      }
    }
  }, [user, updateUser, workspaceTz, workspaceRefs, userTz, userRefs]);

  return { workspaceTz, workspaceRefs, userTz, userRefs, update };
}
