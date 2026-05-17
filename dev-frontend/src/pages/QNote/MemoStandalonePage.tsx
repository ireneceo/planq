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
import { getSession } from '../../services/qnote';
import { useAuth } from '../../contexts/AuthContext';

const MemoStandalonePage: React.FC = () => {
  const { t } = useTranslation('qnote');
  const { id: idParam } = useParams<{ id: string }>();
  const sessionId = idParam ? Number(idParam) : null;
  const { user } = useAuth();

  const [businessId, setBusinessId] = useState<number | null>(user?.business_id ?? null);
  const [loadError, setLoadError] = useState(false);

  // 세션 정보로 business_id 확정 (현재 active workspace 와 다를 수 있음)
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    getSession(sessionId)
      .then((s) => {
        if (cancelled) return;
        setBusinessId(s.business_id);
        document.title = (s.title || (t('memoPopup.title') as string));
      })
      .catch(() => { if (!cancelled) setLoadError(true); });
    return () => { cancelled = true; };
  }, [sessionId, t]);

  if (!sessionId || loadError || !businessId) {
    return <CenterMsg>{t('memoPopup.searchEmpty') as string}</CenterMsg>;
  }

  return (
    <MemoPopup
      open={true}
      onClose={() => window.close()}
      businessId={businessId}
      existingSessionId={sessionId}
      standalone
    />
  );
};

export default MemoStandalonePage;

const CenterMsg = styled.div`
  position: fixed; inset: 0;
  display: flex; align-items: center; justify-content: center;
  background: #F8FAFC;
  font-size: 13px; color: #94A3B8;
`;
