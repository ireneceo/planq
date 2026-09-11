// WorkspaceSyncGuard — 다른 창·기기에서 바꾼 워크스페이스를 **이 창에도** 반영한다
//   docs/WORKSPACE_SCOPE_DESIGN.md C4 (2026-09-11)
//
// Irene: "팝아웃에서 업무리스트가 워크스페이스 바꾸니까 다 없어졌는데 다시 바꿔도 돌아가지 않아.
//         워크스페이스 바뀌는게 팝아웃에도 연결되어서 저장되어야지. 모든 페이지가 하나의 워크스페이스로만 연결되어야지."
//
// 창은 부팅 때 워크스페이스 사본을 들고 있다. 사본이 정본과 달라지는 계기는 셋이고, 셋 다 여기서 받는다:
//   ① 같은 브라우저의 다른 창이 전환 → BroadcastChannel('planq:workspace')
//   ② 다른 기기가 전환              → 소켓 'workspace:switched' (user:N room)
//   ③ 이벤트를 놓쳤다가 사본이 조용히 갱신됨(refresh 응답 · refreshUser · 소켓 재연결 뒤 /me) → user.business_id 변화
// 받으면 **안전할 때 재부팅**, 입력·녹음·핀 중이면 줄만 띄우고 사람이 누른다(utils/reloadSafety — 새 빌드 반영과 같은 술어).
// 멱등 판정(user_id·business_id·switching)은 services/workspaceSync.ts 머리말 참조.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { onSocket, getSocket } from '../../services/socket';
import { isReloadSafe } from '../../utils/reloadSafety';
import { flushPendingSaves } from '../../services/pendingSaves';
import { isPopoutWindow } from '../../utils/popout';
import { clearPageCache } from '../../lib/pageCache';
import {
  WORKSPACE_CHANNEL, isSwitching, canRebootNow, rebootForWorkspace,
  type WorkspaceSwitchMsg,
} from '../../services/workspaceSync';

const WorkspaceSyncGuard: React.FC = () => {
  const { t } = useTranslation('common');
  const { user, refreshUser } = useAuth();
  const [pending, setPending] = useState<number | null>(null);

  // 최신 값은 ref 로 읽는다 — 리스너는 한 번만 붙이고, 판정은 늘 지금 값으로 한다.
  const userIdRef = useRef<number | null>(null);
  const bizRef = useRef<number | null>(null);
  const refreshRef = useRef(refreshUser);
  userIdRef.current = user?.id != null ? Number(user.id) : null;
  bizRef.current = user?.business_id != null ? Number(user.business_id) : null;
  refreshRef.current = refreshUser;

  const apply = useCallback((targetBizId: number, byUser = false) => {
    if (!byUser) {
      if (isSwitching()) return;                         // 이 창이 누른 전환 — 스스로 리로드 중
      if (!isReloadSafe() || !canRebootNow(targetBizId)) { setPending(targetBizId); return; }
    }
    // ★ 사용자가 "전환" 을 누른 경우(보류 중이던 창)엔 대기 중인 자동저장이 있을 수 있다 — 버리기 전에 먼저 보낸다.
    //   자동 경로는 위 isReloadSafe 가 대기 중(data-form-dirty)이면 이미 보류시킨다. 상한 3초, 넘기면 진행.
    void flushPendingSaves().finally(() => {
      clearPageCache();
      rebootForWorkspace(isPopoutWindow(), targetBizId);
    });
  }, []);

  // ①② 전파 수신
  useEffect(() => {
    if (!user?.id) return undefined;
    const handle = (m: Partial<WorkspaceSwitchMsg> | null | undefined) => {
      if (!m) return;
      const uid = Number(m.user_id);
      const bid = Number(m.business_id);
      if (!uid || !bid) return;
      if (uid !== userIdRef.current) return;             // 사칭 창·다른 계정 창
      if (bid === bizRef.current) return;                // 이미 이 워크스페이스(자기 수신 포함)
      apply(bid);
    };
    let ch: BroadcastChannel | null = null;
    try {
      ch = new BroadcastChannel(WORKSPACE_CHANNEL);
      ch.onmessage = (ev: MessageEvent) => handle(ev.data as WorkspaceSwitchMsg);
    } catch { /* 미지원 — 소켓 경로만 */ }
    const off = onSocket<WorkspaceSwitchMsg>('workspace:switched', (d) => handle(d));
    return () => {
      try { if (ch) { ch.onmessage = null; ch.close(); } } catch { /* noop */ }
      off();
    };
  }, [user?.id, apply]);

  // ④ 서버가 "이 창은 옛 워크스페이스" 라고 답했다(409 workspace_stale — 전파 이벤트를 놓친 창).
  //   apiFetch/apiUpload 가 응답을 보고 쏜다. 판정은 ①② 와 같은 apply(보류·루프 안전망 포함).
  useEffect(() => {
    if (!user?.id) return undefined;
    const onStale = (ev: Event) => {
      const bid = Number((ev as CustomEvent<{ business_id?: number }>).detail?.business_id);
      if (!bid || bid === bizRef.current) return;
      apply(bid);
    };
    window.addEventListener('planq:workspace-stale', onStale);
    return () => window.removeEventListener('planq:workspace-stale', onStale);
  }, [user?.id, apply]);

  // ③ 사본이 조용히 바뀐 경우 — 첫 값은 기준선으로만 기억한다(부팅), 계정이 바뀌면 기준선을 새로 잡는다
  const seenRef = useRef<{ uid: number | null; biz: number | null }>({ uid: null, biz: null });
  useEffect(() => {
    const uid = user?.id != null ? Number(user.id) : null;
    const biz = user?.business_id != null ? Number(user.business_id) : null;
    const seen = seenRef.current;
    if (uid !== seen.uid) { seenRef.current = { uid, biz }; return; }
    if (biz == null || seen.biz == null) { seenRef.current = { uid, biz }; return; }
    if (biz === seen.biz) return;
    seenRef.current = { uid, biz };
    apply(biz);
  }, [user?.id, user?.business_id, apply]);

  // 소켓이 끊겼다 다시 붙으면 그 사이 전환을 놓쳤을 수 있다 → /me 로 사본을 맞춘다(③ 이 받는다)
  useEffect(() => {
    if (!user?.id) return undefined;
    let connected = !!getSocket()?.connected;
    const off = onSocket('connect', () => {
      if (connected) { void refreshRef.current().catch(() => null); }
      connected = true;
    });
    const offDis = onSocket('disconnect', () => { /* 다음 connect 가 재연결이다 */ connected = true; });
    return () => { off(); offDis(); };
  }, [user?.id]);

  if (!pending) return null;
  return (
    <Bar role="status" aria-live="polite" data-testid="workspace-sync-bar">
      <span>{t('workspaceSync.banner', '다른 창이나 기기에서 워크스페이스가 바뀌었어요') as string}</span>
      <ApplyBtn type="button" data-testid="workspace-sync-apply" onClick={() => apply(pending, true)}>
        {t('workspaceSync.apply', '지금 전환') as string}
      </ApplyBtn>
    </Bar>
  );
};

export default WorkspaceSyncGuard;

// 화면 위쪽 가운데 한 줄 — 하던 일을 가리지 않게 작게. 모달이 아니다(포커스를 뺏지 않는다).
const Bar = styled.div`
  position: fixed; left: 50%; transform: translateX(-50%);
  top: calc(var(--pq-chrome-bottom, 0px) + 8px);
  z-index: 1200;
  display: flex; align-items: center; gap: 10px;
  max-width: calc(100vw - 32px);
  padding: 8px 8px 8px 14px; border-radius: 10px;
  background: #0F172A; color: #F8FAFC;
  font-size: 0.8125rem; font-weight: 500;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.25);
  span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
`;
const ApplyBtn = styled.button`
  flex-shrink: 0; min-height: 36px; padding: 0 12px; border-radius: 8px;
  border: none; background: #14B8A6; color: #FFFFFF;
  font-size: 0.8125rem; font-weight: 700; cursor: pointer;
  &:hover { background: #0D9488; }
  &:focus-visible { outline: 2px solid #99F6E4; outline-offset: 2px; }
`;
