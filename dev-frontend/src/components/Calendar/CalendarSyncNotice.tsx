// 캘린더 상단 동기화 배너 — **상태를 말하고, 그 자리에서 고친다** (#126·#201·#242).
//
// 왜 개편했나 (2026-08-14, 운영 #242 재신고)
//   역방향 동기화는 실제로 작동하는데도 "아직 해결 안 됐다" 는 신고가 몇 주째 반복됐다.
//   운영 실측으로 드러난 실체는 코드 결함이 아니라 **사용자가 그 사실에 도달하지 못하는 것**이었다:
//     ① 반영에 최대 몇 분이 걸리는데 화면 어디에도 그 말이 없다 → 3분 만에 확인하고 고장으로 판단
//     ② 팀 토큰의 캘린더 권한이 끊긴 것을 **캘린더 화면에서 고칠 수 없다**(설정 깊은 곳에만 있었다)
//     ③ 구글에 남은 옛 사본은 "직접 지우세요" 라고 안내했다 — 우리 일을 사용자에게 떠넘긴 것
//   그래서 이 배너는 안내문이 아니라 **조치 지점**이다.
//
// 문구 규칙
//   - 옛 문구의 "실시간 양방향은 Google 검수 승인 후 제공" 은 **삭제**했다. 이미 배포된 기능이라 거짓말이었다.
//   - 정상일 때는 "최대 N분 내 자동 반영 · 마지막 확인 n분 전". **확인**과 **반영**을 구분한다 —
//     건강한 워크스페이스는 며칠간 반영 0 이 정상인데 "마지막 반영 5일 전" 은 고장으로 읽힌다.
//   - 재연결 안내에는 ①"확인되지 않은 앱" 경고에서 계속 진행 ②동의 화면 "캘린더" 항목 체크,
//     두 함정을 모두 적는다. 운영 로그상 재연결이 **콜백까지 도달한 적이 없다** — 그 앞에서 이탈했다.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import ActionButton from '../Common/ActionButton';
import { apiFetch } from '../../contexts/AuthContext';
import { startAuthPopup } from '../../services/oauth';
import { isNativeApp } from '../../services/native';
import {
  syncCalendarNow, listGcalOrphans, cleanupGcalOrphans, type GcalOrphan,
} from '../../services/calendar';
import { onSocket } from '../../services/socket';

export interface CalendarSyncStatus {
  workspace_connected: boolean;
  workspace_can_write: boolean;
  workspace_needs_reconnect: boolean;
  workspace_account_email: string | null;
  personal_connected: boolean;
  personal_can_write: boolean;
  can_reconnect_workspace: boolean;
  poll_interval_seconds: number;
  last_checked_at: string | null;
}

interface Props {
  businessId: number | null;
  status: CalendarSyncStatus | null;
  /** 동기화·백필로 데이터가 바뀌면 캘린더를 다시 그린다. */
  onChanged?: () => void;
  /** 연동 상태 자체를 다시 읽는다(재연결 성공 후). */
  onStatusReload?: () => void;
}

const DISMISS_KEY = 'qcal_sync_notice_dismissed_v4';   // 문구가 실질 변경 — 옛 dismiss 를 무효화

const CalendarSyncNotice: React.FC<Props> = ({ businessId, status, onChanged, onStatusReload }) => {
  const { t } = useTranslation('qcalendar');
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; }
  });
  const [busy, setBusy] = useState<null | 'sync' | 'reconnect' | 'clean'>(null);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [orphans, setOrphans] = useState<GcalOrphan[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const workspaceConnected = !!status?.workspace_connected;
  const personalConnected = !!status?.personal_connected;
  // 조치가 필요한 오류 — dismiss 되어도 계속 보여준다(사용자가 고쳐야 기능이 돌아온다).
  const broken = workspaceConnected && !!status?.workspace_needs_reconnect;
  const pollMinutes = Math.max(1, Math.round((status?.poll_interval_seconds || 60) / 60));

  const lastCheckedText = useMemo(() => {
    if (!status?.last_checked_at) return null;
    const diffMin = Math.max(0, Math.round((Date.now() - new Date(status.last_checked_at).getTime()) / 60000));
    return diffMin < 1
      ? t('syncNotice.checkedJustNow', { defaultValue: '방금 확인함' }) as string
      : t('syncNotice.checkedAgo', { count: diffMin, defaultValue: '{{count}}분 전 확인' }) as string;
  }, [status?.last_checked_at, t]);

  const scanOrphans = useCallback(async () => {
    if (!businessId || !status?.can_reconnect_workspace) return;
    try {
      const r = await listGcalOrphans(businessId);
      setOrphans(r.supported ? r.orphans : []);
      setPicked(new Set());
    } catch { /* 보조 기능 — 실패해도 배너 본문은 유지 */ }
  }, [businessId, status?.can_reconnect_workspace]);

  // 재연결 성공 신호 — COOP 로 opener 가 끊기는 환경이 있어 BroadcastChannel 도 같이 듣는다.
  //   성공하면 ①연동 상태 재조회 ②고아 사본 스캔을 잇는다.
  //   밀린 일정 백필은 **서버 콜백**이 담당한다(아래 socket 수신으로 결과만 받는다) —
  //   재연결 경로가 캘린더 배너 하나가 아니라서(설정 화면도 있다) 서버에 두는 것이 유일한 정합점이다.
  useEffect(() => {
    if (!businessId) return undefined;
    const isDone = (d: unknown) => {
      const x = d as { type?: string; ok?: boolean } | null;
      return !!x && x.type === 'gcal:connected' && !!x.ok;
    };
    // ★ 백필을 여기서 부르지 않는다 — **서버 콜백이 모든 재연결 경로에서 이미 돌린다**
    //   (캘린더 배너로 하든 설정 화면으로 하든). 여기서도 부르면 같은 워크스페이스를 두 실행이
    //   동시에 집어 구글에 사본이 두 벌 생길 수 있다. 결과는 socket `calendar:sync-changed` 로 온다.
    const finish = async () => {
      setBusy(null);
      onStatusReload?.();
      void scanOrphans();
    };
    const onMsg = (e: MessageEvent) => { if (isDone(e.data)) void finish(); };
    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel('planq:oauth');
      bc.onmessage = (e) => { if (isDone(e.data)) void finish(); };
    } catch { bc = null; }
    const onNativeDone = () => { void finish(); };
    window.addEventListener('message', onMsg);
    window.addEventListener('planq:oauth-connected', onNativeDone);
    // 서버가 재연결 직후 백필을 끝내면 알려온다 — 오너 본인 화면뿐 아니라
    //   그 워크스페이스의 **모든 열린 화면**이 이 신호로 배너를 최신화한다.
    const offSock = onSocket<{ backfilled?: number }>('calendar:sync-changed', (d) => {
      onStatusReload?.();
      if (d && typeof d.backfilled === 'number' && d.backfilled > 0) {
        setSyncMsg(t('syncNotice.backfilled', { count: d.backfilled, defaultValue: '밀려 있던 일정 {{count}}건을 팀 캘린더로 올렸습니다.' }) as string);
        onChanged?.();
      }
    });
    return () => {
      window.removeEventListener('message', onMsg);
      window.removeEventListener('planq:oauth-connected', onNativeDone);
      offSock();
      try { bc?.close(); } catch { /* 이미 닫힘 */ }
    };
  }, [businessId, onChanged, onStatusReload, scanOrphans, t]);

  const handleReconnect = async () => {
    if (!businessId) return;
    setBusy('reconnect');
    try {
      const r = await apiFetch(`/api/cloud/connect/gcal/${businessId}`, { method: 'POST' });
      const j = await r.json();
      if (!j.success || !j.data?.auth_url) { setBusy(null); return; }
      const w = 540; const h = 640;
      const left = (window.screen.width - w) / 2;
      const top = (window.screen.height - h) / 2;
      const popup = await startAuthPopup(j.data.auth_url, 'planq-oauth-gcal', `width=${w},height=${h},left=${left},top=${top}`);
      if (isNativeApp()) return;   // 네이티브는 앱 복귀 이벤트가 마무리
      if (!popup) setBusy(null);
    } catch { setBusy(null); }
  };

  const handleSyncNow = async () => {
    if (!businessId) return;
    setBusy('sync'); setSyncMsg(null);
    try {
      const r = await syncCalendarNow(businessId);
      onChanged?.();
      setSyncMsg(r.applied > 0
        ? t('syncNotice.syncApplied', { count: r.applied, defaultValue: '구글 변경 {{count}}건을 반영했습니다.' }) as string
        : t('syncNotice.syncNoChange', { defaultValue: '구글에 새로 바뀐 내용이 없습니다.' }) as string);
    } catch {
      setSyncMsg(t('syncNotice.syncFailed', { defaultValue: '지금 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.' }) as string);
    } finally { setBusy(null); }
  };

  const handleCleanup = async () => {
    if (!businessId || picked.size === 0) return;
    setBusy('clean');
    try {
      const r = await cleanupGcalOrphans(businessId, Array.from(picked));
      setSyncMsg(t('syncNotice.cleaned', { count: r.deleted, defaultValue: '구글에서 옛 사본 {{count}}건을 지웠습니다.' }) as string);
      await scanOrphans();
    } catch {
      setSyncMsg(t('syncNotice.cleanFailed', { defaultValue: '정리하지 못했습니다. 잠시 후 다시 시도해 주세요.' }) as string);
    } finally { setBusy(null); }
  };

  if (!workspaceConnected && !personalConnected) return null;
  if (dismissed && !broken) return null;

  const close = () => {
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* noop */ }
    setDismissed(true);
  };

  const togglePick = (id: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <Notice role="note" $tone={broken ? 'error' : 'info'}>
      <NoticeIcon aria-hidden $tone={broken ? 'error' : 'info'}>!</NoticeIcon>
      <NoticeText>
        <strong>
          {broken
            ? t('syncNotice.brokenTitle', { defaultValue: '팀 Google 캘린더 연결이 끊겼습니다' }) as string
            : t('syncNotice.title', { defaultValue: 'Google 캘린더 연동 범위' }) as string}
        </strong>

        {broken ? (
          <>
            <NoticeLine>
              {status?.can_reconnect_workspace
                ? t('syncNotice.brokenOwner', { defaultValue: '팀 캘린더로 일정이 나가지 않고, Google에서 고친 내용도 돌아오지 않습니다. 아래 버튼으로 다시 연결해 주세요.' }) as string
                : t('syncNotice.brokenMember', { defaultValue: '팀 캘린더로 일정이 나가지 않고, Google에서 고친 내용도 돌아오지 않습니다. 워크스페이스 오너가 다시 연결해야 합니다.' }) as string}
            </NoticeLine>
            <NoticeHint>
              {t('syncNotice.brokenHowTo', { defaultValue: '연결할 때 ① "확인되지 않은 앱" 경고가 나오면 [고급] → [계속]으로 진행하고, ② 동의 화면에서 "캘린더" 항목을 반드시 체크해 주세요. 체크하지 않아도 연결은 성공한 것처럼 보입니다.' }) as string}
            </NoticeHint>
            {status?.workspace_account_email && (
              <NoticeHint>
                {t('syncNotice.connectedAccount', { email: status.workspace_account_email, defaultValue: '현재 연결 계정: {{email}}' }) as string}
              </NoticeHint>
            )}
          </>
        ) : (
          <>
            {workspaceConnected && (
              <NoticeLine>
                <LineLabel>{t('syncNotice.workspaceLabel', { defaultValue: '워크스페이스 연동' }) as string}</LineLabel>
                {t('syncNotice.workspaceBody')}
              </NoticeLine>
            )}
            {personalConnected && (
              <NoticeLine>
                <LineLabel>{t('syncNotice.personalLabel', { defaultValue: '개인 연동' }) as string}</LineLabel>
                {status?.personal_can_write ? t('syncNotice.personalBodyWrite') : t('syncNotice.personalBodyRead')}
              </NoticeLine>
            )}
            <NoticeHint>
              {t('syncNotice.delayHint', { minutes: pollMinutes, defaultValue: 'Google에서 고친 내용은 최대 {{minutes}}분 안에 자동으로 반영됩니다. 바로 확인하려면 "지금 가져오기"를 누르세요.' }) as string}
              {lastCheckedText ? ` · ${lastCheckedText}` : ''}
            </NoticeHint>
          </>
        )}

        {syncMsg && <SyncMsg>{syncMsg}</SyncMsg>}

        {orphans && orphans.length > 0 && (
          <OrphanBox>
            <OrphanTitle>
              {t('syncNotice.orphanTitle', { count: orphans.length, defaultValue: 'Google에 남은 옛 PlanQ 사본 {{count}}건' }) as string}
            </OrphanTitle>
            <OrphanHint>{t('syncNotice.orphanHint', { defaultValue: 'PlanQ가 더 이상 관리하지 못하는 사본입니다. 지울 항목을 선택하세요.' }) as string}</OrphanHint>
            <OrphanList>
              {orphans.slice(0, 20).map((o) => (
                <OrphanItem key={o.gcal_event_id}>
                  <input
                    type="checkbox"
                    checked={picked.has(o.gcal_event_id)}
                    onChange={() => togglePick(o.gcal_event_id)}
                    aria-label={o.title}
                  />
                  <OrphanName>{o.title}</OrphanName>
                  {o.start && <OrphanDate>{new Date(o.start).toLocaleDateString()}</OrphanDate>}
                </OrphanItem>
              ))}
            </OrphanList>
            <ActionButton tone="danger" size="sm" loading={busy === 'clean'} disabled={picked.size === 0} onClick={handleCleanup}>
              {t('syncNotice.cleanSelected', { count: picked.size, defaultValue: '선택한 {{count}}건 지우기' }) as string}
            </ActionButton>
          </OrphanBox>
        )}
      </NoticeText>

      <Actions>
        {broken && status?.can_reconnect_workspace && (
          <ActionButton tone="primary" size="sm" loading={busy === 'reconnect'} onClick={handleReconnect}>
            {t('syncNotice.reconnect', { defaultValue: '다시 연결' }) as string}
          </ActionButton>
        )}
        {!broken && (
          <ActionButton tone="secondary" size="sm" loading={busy === 'sync'} onClick={handleSyncNow}>
            {t('syncNotice.syncNow', { defaultValue: '지금 가져오기' }) as string}
          </ActionButton>
        )}
        {!broken && status?.can_reconnect_workspace && workspaceConnected && orphans === null && (
          <ActionButton tone="secondary" size="sm" onClick={scanOrphans}>
            {t('syncNotice.checkOrphans', { defaultValue: '남은 사본 확인' }) as string}
          </ActionButton>
        )}
      </Actions>

      {!broken && (
        <CloseBtn type="button" onClick={close} aria-label={t('syncNotice.dismiss', { defaultValue: '안내 닫기' }) as string}>×</CloseBtn>
      )}
    </Notice>
  );
};

export default CalendarSyncNotice;

const Notice = styled.div<{ $tone: 'info' | 'error' }>`
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 14px;
  border-radius: 10px;
  margin-bottom: 12px;
  background: ${(p) => (p.$tone === 'error' ? '#FEF2F2' : '#FEF3C7')};
  border: 1px solid ${(p) => (p.$tone === 'error' ? '#FECACA' : '#FDE68A')};
  @media (max-width: 640px) { flex-wrap: wrap; }
`;
const NoticeIcon = styled.span<{ $tone: 'info' | 'error' }>`
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
  color: #fff;
  background: ${(p) => (p.$tone === 'error' ? '#EF4444' : '#F59E0B')};
`;
const NoticeText = styled.div`
  flex: 1;
  min-width: 0;
  font-size: 12.5px;
  line-height: 1.55;
  color: #334155;
  strong { color: #0F172A; font-weight: 700; }
`;
const NoticeLine = styled.div`
  margin-top: 4px;
`;
const NoticeHint = styled.div`
  margin-top: 4px;
  font-size: 11.5px;
  color: #64748B;
`;
const SyncMsg = styled.div`
  margin-top: 6px;
  font-size: 11.5px;
  font-weight: 600;
  color: #0F766E;
`;
const LineLabel = styled.span`
  display: inline-block;
  margin-right: 6px;
  padding: 1px 6px;
  border-radius: 5px;
  font-size: 11px;
  font-weight: 700;
  color: #92400E;
  background: #FDE68A;
`;
const Actions = styled.div`
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  @media (max-width: 640px) { width: 100%; margin-top: 8px; }
`;
const OrphanBox = styled.div`
  margin-top: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  background: #FFFFFF;
  border: 1px solid #E2E8F0;
`;
const OrphanTitle = styled.div`font-size: 12px; font-weight: 700; color: #0F172A;`;
const OrphanHint = styled.div`font-size: 11px; color: #64748B; margin-bottom: 6px;`;
const OrphanList = styled.div`display: flex; flex-direction: column; gap: 3px; margin-bottom: 8px; max-height: 180px; overflow-y: auto;`;
const OrphanItem = styled.label`
  display: flex; align-items: center; gap: 6px;
  font-size: 11.5px; color: #334155; cursor: pointer;
`;
const OrphanName = styled.span`flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`;
const OrphanDate = styled.span`flex-shrink: 0; color: #94A3B8; font-size: 11px;`;
const CloseBtn = styled.button`
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  line-height: 1;
  color: #92400E;
  background: transparent;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  &:hover { background: #FDE68A; }
`;
