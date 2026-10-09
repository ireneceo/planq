// 플랫폼 관리자 사이드바 배지 + «확인 필요» 숫자.
//
// ★ 원천은 `GET /api/admin/todo` 하나다 (services/adminTodo.js). 화면이 따로 세지 않는다 —
//   2026-10-08 전까지 피드백·문의 counts 라우트를 각자 불렀고, 피드백 쪽은 응답 모양(`data.pending`)을
//   `data.counts.pending` 으로 잘못 읽어 **배지가 늘 0** 이었다. 입금 통보는 아예 세지 않았다.
//
// 배지 계약 (워크스페이스 확인필요와 같다): 한 건 = 한 버킷, 메뉴 배지 합 = total.
//   subscriptions = 플랜 입금 통보 · payments = 애드온 입금 통보 + 세금계산서 + 환불 요청 · inquiries · feedback
//
// 갱신: 30초 polling + 탭 복귀 + 관리자 알림 도착(socket notification:new, business_id null)
//       + 같은 탭 안 처리(window 'admin-todo:refresh').
// platform_admin 아닌 사용자는 fetch 안 함.

import { useEffect, useState } from 'react';
import { apiFetch, useAuth } from '../contexts/AuthContext';
import { onSocket } from '../services/socket';

export interface AdminTodoCounts {
  deposit_plan: number;
  deposit_addon: number;
  tax_invoice: number;
  refund_request?: number;
  inquiry: number;
  feedback: number;
}

export interface AdminInboxCounts {
  total: number;
  subscriptions: number;
  payments: number;
  inquiriesPending: number;
  feedbackPending: number;
  loaded: boolean;
}

const DEFAULT: AdminInboxCounts = { total: 0, subscriptions: 0, payments: 0, inquiriesPending: 0, feedbackPending: 0, loaded: false };

/** 처리 화면(입금 확인·발행·답변)이 부른다 — 사이드바 숫자를 즉시 다시 센다. */
export function refreshAdminTodo() {
  try { window.dispatchEvent(new CustomEvent('admin-todo:refresh')); } catch { /* noop */ }
}

const ADMIN_EVENT_KINDS = new Set(['payment', 'subscription', 'inquiry', 'feedback']);

export function useAdminInboxCounts(): AdminInboxCounts {
  const { user } = useAuth();
  const [counts, setCounts] = useState<AdminInboxCounts>(DEFAULT);
  const isAdmin = user?.platform_role === 'platform_admin';

  useEffect(() => {
    if (!isAdmin) { setCounts(DEFAULT); return; }
    let cancelled = false;
    let debounce: ReturnType<typeof setTimeout> | null = null;

    const refresh = async () => {
      try {
        const r = await apiFetch('/api/admin/todo');
        const j = await r.json();
        if (cancelled || !j?.success) return;
        const c: AdminTodoCounts = j.data.counts;
        setCounts({
          total: j.data.total || 0,
          subscriptions: c.deposit_plan || 0,
          payments: (c.deposit_addon || 0) + (c.tax_invoice || 0) + (c.refund_request || 0),
          inquiriesPending: c.inquiry || 0,
          feedbackPending: c.feedback || 0,
          loaded: true,
        });
      } catch { /* silent — 다음 polling 에서 회복 */ }
    };
    const soon = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(refresh, 250);
    };

    refresh();
    const timer = setInterval(refresh, 30_000);
    const onVisibility = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', refresh);
    window.addEventListener('admin-todo:refresh', soon);
    const offNew = onSocket<{ business_id?: number | null; event_kind?: string }>('notification:new', (p) => {
      if (p?.business_id == null && (!p?.event_kind || ADMIN_EVENT_KINDS.has(p.event_kind))) soon();
    });

    return () => {
      cancelled = true;
      clearInterval(timer);
      if (debounce) clearTimeout(debounce);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('admin-todo:refresh', soon);
      offNew();
    };
  }, [isAdmin, user?.id]);

  return counts;
}
