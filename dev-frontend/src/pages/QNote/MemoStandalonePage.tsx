// MemoStandalonePage — 메모 분리 창 전용 minimal wrapper (사이클 N+17 hotfix)
//
// MemoPopup 의 ⧉ "별도 창 분리" 클릭 시 이 페이지가 열림 (Chrome Document PiP 또는 window.open).
// MainLayout 우회 (사이드바/헤더 없음) + MemoPopup 을 standalone 모드로 마운트해 동일 팝업 UI 재사용.
//
// route: /memo/:id  (App.tsx 의 ProtectedRoute 안, MainLayout 미적용)
import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import MemoPopup from '../../components/QNote/MemoPopup';
import PopoutPinButton from '../../components/Common/PopoutPinButton';
import PinHolderView from '../../components/Common/PinHolderView';
import { usePinHost } from '../../utils/pinHost';
import { getSession } from '../../services/qnote';
import { useAuth } from '../../contexts/AuthContext';
import DetailFallback from '../../components/Common/DetailFallback';
import { isOtherWorkspace } from '../../utils/workspaceMatch';
import { markPopoutWindow } from '../../utils/popout';
import { useAppShellLock } from '../../hooks/useAppShellLock';

const MemoStandalonePage: React.FC = () => {
  useAppShellLock();
  const { t } = useTranslation('qnote');
  const { id: idParam } = useParams<{ id: string }>();
  const sessionId = idParam ? Number(idParam) : null;
  const { user } = useAuth();
  // 열린 메모 창도 다른 팝아웃과 똑같이 핀이 있어야 한다 (Irene 2026-08-20: "왜 메모는 핀 기능이 없는 거야").
  //   고정창은 이 창의 현재 URL(/memo/:id)을 그대로 싣는다 — 보고 있던 그 메모가 고정된다.
  const pin = usePinHost({ tool: 'qnote', title: 'Q note' });

  const [businessId, setBusinessId] = useState<number | null>(user?.business_id ?? null);
  const [loadError, setLoadError] = useState(false);
  // 다른 워크스페이스 메모 — 옛 동작은 **그 메모의 워크스페이스로 조용히 갈아탔다**(창 하나만). 한 창 한 워크스페이스 원칙에
  //   어긋나고 메인 창과 다른 워크스페이스로 저장·검색이 돌았다 → 내용 대신 전환 안내(WORKSPACE_SCOPE_DESIGN Q6).
  const [otherWsBizId, setOtherWsBizId] = useState<number | null>(null);

  // #84 — 다른 팝아웃 페이지(talk/task/note/help)와 동일하게 창 단위 팝아웃 마커를 남긴다.
  //   여태 빠져 있어서, 이 창 안에서 다른 라우트로 이동하면 우하단 FAB·토스터가 되살아났다.
  useEffect(() => {
    document.body.dataset.popout = '1';
    markPopoutWindow();
    return () => { delete document.body.dataset.popout; };
  }, []);

  // 세션 정보로 business_id 확정 (현재 active workspace 와 다를 수 있음)
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    getSession(sessionId)
      .then((s) => {
        if (cancelled) return;
        if (isOtherWorkspace(s.business_id, user?.business_id)) { setOtherWsBizId(Number(s.business_id)); return; }
        setOtherWsBizId(null);
        setBusinessId(s.business_id);
        document.title = (s.title || (t('memoPopup.title') as string));
      })
      .catch(() => { if (!cancelled) setLoadError(true); });
    return () => { cancelled = true; };
  }, [sessionId, t]);

  if (otherWsBizId) return <DetailFallback status="other_workspace" businessId={otherWsBizId} />;
  if (!sessionId || loadError || !businessId) {
    return <CenterMsg>{t('memoPopup.searchEmpty') as string}</CenterMsg>;
  }

  if (pin.mode === 'holder') return <PinHolderView host={pin} label="Q note" />;

  return (
    <MemoPopup
      open={true}
      onClose={() => window.close()}
      businessId={businessId}
      existingSessionId={sessionId}
      standalone
      pinSlot={<PopoutPinButton host={pin} />}
    />
  );
};

export default MemoStandalonePage;

const CenterMsg = styled.div`
  position: fixed; inset: 0;
  display: flex; align-items: center; justify-content: center;
  background: #F8FAFC;
  font-size: 0.8125rem; color: #94A3B8;
`;
