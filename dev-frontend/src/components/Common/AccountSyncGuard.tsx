// AccountSyncGuard — 한 기기 여러 계정: 이 기기의 지금 계정이 바뀌면 **이 창도** 따라간다.
//   설계 docs/MULTI_ACCOUNT_DESIGN.md 7절 (D1 «전환 = 기기 전체 · 다시 부팅»). App 루트 한 곳(WorkspaceSyncGuard 옆).
//
// 바뀐 것을 아는 길 넷:
//   ① 같은 브라우저의 다른 창이 전환 → BroadcastChannel('planq:account')
//   ② 이 창의 refresh 가 409 account_stale(늦게 깬 창·팝아웃) → 'planq:account-stale'
//   ③ 탭 복귀 때 서버에 지금 계정을 묻는다(30초에 한 번) — 다른 앱 창(PWA·앱 WebView)이 바꾼 경우
//   ④ 알림을 눌러 왔다(주소의 pq_as=<계정>) → 그 계정이 지금과 다르면 전환한 뒤 같은 주소로
// 받으면 **안전할 때** 다시 부팅, 입력·녹음 중이면 줄만 띄우고 사람이 누른다(utils/reloadSafety — 워크스페이스 전환과 같은 술어).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { SyncBar as Bar, SyncApplyBtn as ApplyBtn } from './syncBarShell';
import { useTranslation } from 'react-i18next';
import { useAuth, isImpersonatingNow } from '../../contexts/AuthContext';
import { isReloadSafe } from '../../utils/reloadSafety';
import { flushPendingSaves } from '../../services/pendingSaves';
import { clearPageCache } from '../../lib/pageCache';
import { ACCOUNT_CHANNEL, fetchDeviceAccounts, rebootForAccount, switchAccount } from '../../services/accounts';

const AS_PARAM = 'pq_as';

function stripAsParam(): string {
  const u = new URL(window.location.href);
  u.searchParams.delete(AS_PARAM);
  return u.pathname + (u.searchParams.toString() ? `?${u.searchParams.toString()}` : '') + u.hash;
}

const AccountSyncGuard: React.FC = () => {
  const { t } = useTranslation('common');
  const { user } = useAuth();
  const [pending, setPending] = useState(false);
  const uidRef = useRef<number | null>(null);
  uidRef.current = user?.id != null ? Number(user.id) : null;
  const leavingRef = useRef(false);

  const apply = useCallback((byUser = false) => {
    if (leavingRef.current) return;
    if (!byUser && !isReloadSafe()) { setPending(true); return; }
    leavingRef.current = true;
    void flushPendingSaves().finally(() => { clearPageCache(); rebootForAccount(); });
  }, []);

  // ① ② 다른 창의 전환 · 409
  useEffect(() => {
    if (!user?.id || isImpersonatingNow()) return undefined;
    let ch: BroadcastChannel | null = null;
    try {
      ch = new BroadcastChannel(ACCOUNT_CHANNEL);
      ch.onmessage = (ev: MessageEvent) => {
        const to = Number((ev.data as { user_id?: number } | null)?.user_id);
        if (to && to !== uidRef.current) apply();
      };
    } catch { /* 미지원 — ②③ 이 받는다 */ }
    const onStale = () => apply();
    window.addEventListener('planq:account-stale', onStale);
    return () => {
      try { if (ch) { ch.onmessage = null; ch.close(); } } catch { /* noop */ }
      window.removeEventListener('planq:account-stale', onStale);
    };
  }, [user?.id, apply]);

  // ③ 탭 복귀 — 서버가 본 지금 계정과 이 창이 다르면 따라간다(30초에 한 번만 묻는다)
  useEffect(() => {
    if (!user?.id || isImpersonatingNow()) return undefined;
    let last = 0;
    const check = async () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - last < 30_000) return;
      last = Date.now();
      const d = await fetchDeviceAccounts({ fresh: true });
      if (d && d.active_user_id && uidRef.current && d.active_user_id !== uidRef.current
          && d.accounts.some((a) => a.user_id === d.active_user_id && a.valid)) apply();
    };
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    return () => { document.removeEventListener('visibilitychange', check); window.removeEventListener('focus', check); };
  }, [user?.id, apply]);

  // ④ 알림 클릭 주소의 pq_as — 다른 계정 알림이면 그 계정으로 전환해 같은 주소를 연다
  const deepLinkDoneRef = useRef(false);
  useEffect(() => {
    if (!user?.id || deepLinkDoneRef.current) return;
    let want = 0;
    try { want = Number(new URL(window.location.href).searchParams.get(AS_PARAM) || 0); } catch { want = 0; }
    if (!want) return;
    deepLinkDoneRef.current = true;
    const clean = stripAsParam();
    if (want === Number(user.id) || isImpersonatingNow()) {
      try { window.history.replaceState(window.history.state, '', clean); } catch { /* noop */ }
      return;
    }
    void switchAccount(want, { next: clean }).then((fail) => {
      // 이 기기에 없는 계정·다시 로그인 필요 — 지금 계정 그대로 두고 주소만 정리(엉뚱한 계정으로 열지 않는다)
      if (fail) { try { window.history.replaceState(window.history.state, '', clean); } catch { /* noop */ } }
    });
  }, [user?.id]);

  if (!pending) return null;
  return (
    <Bar role="status" aria-live="polite" data-testid="account-sync-bar">
      <span>{t('accounts.syncBanner', '다른 창에서 계정이 바뀌었어요') as string}</span>
      <ApplyBtn type="button" data-testid="account-sync-apply" onClick={() => apply(true)}>
        {t('accounts.syncApply', '지금 바꾸기') as string}
      </ApplyBtn>
    </Bar>
  );
};

export default AccountSyncGuard;
