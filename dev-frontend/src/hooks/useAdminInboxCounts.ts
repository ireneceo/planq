// N+63 — platform_admin 좌측 메뉴 inbox badge 용.
//   미처리 feedback (pending+reviewing) + 미답 inquiry (new+in_progress) 카운트.
//   30초 polling + socket 'feedback:new'/'inquiry:new' listener (있으면 즉시 갱신, 없으면 polling fallback).
//
// 반환:
//   { feedbackPending, inquiriesPending, totalPending }
//
// platform_admin 아닌 사용자는 fetch 안 함 (zero overhead).

import { useEffect, useState } from 'react';
import { apiFetch, useAuth } from '../contexts/AuthContext';

export interface AdminInboxCounts {
  feedbackPending: number;
  inquiriesPending: number;
  totalPending: number;
}

const DEFAULT: AdminInboxCounts = { feedbackPending: 0, inquiriesPending: 0, totalPending: 0 };

export function useAdminInboxCounts(): AdminInboxCounts {
  const { user } = useAuth();
  const [counts, setCounts] = useState<AdminInboxCounts>(DEFAULT);
  const isAdmin = user?.platform_role === 'platform_admin';

  useEffect(() => {
    if (!isAdmin) { setCounts(DEFAULT); return; }
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const refresh = async () => {
      try {
        const [fbRes, inqRes] = await Promise.all([
          apiFetch('/api/feedback/admin/counts').then(r => r.json()).catch(() => null),
          apiFetch('/api/inquiries/admin/counts').then(r => r.json()).catch(() => null),
        ]);
        if (cancelled) return;
        const fbCount = fbRes?.success
          ? (fbRes.data?.counts?.pending || 0) + (fbRes.data?.counts?.reviewing || 0)
          : 0;
        const inqCount = inqRes?.success ? (inqRes.data?.pending || 0) : 0;
        setCounts({
          feedbackPending: fbCount,
          inquiriesPending: inqCount,
          totalPending: fbCount + inqCount,
        });
      } catch { /* silent */ }
    };

    refresh();
    // 30초 polling (admin 대시보드는 frequent change 적음 — 30s 충분)
    timer = setInterval(refresh, 30_000);
    // foreground 복귀 시 즉시 refresh (PWA 안전망)
    const onVisibility = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', refresh);

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', refresh);
    };
  }, [isAdmin, user?.id]);

  return counts;
}
