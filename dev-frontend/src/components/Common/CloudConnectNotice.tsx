// 파일 페이지 상단 안내 — Google Drive 연결 상태에 따라 두 가지 모드.
// - 연결됨: "PlanQ → Drive 단방향" 호박색 안내 + Drive 폴더 열기
// - 미연결: "Google Drive 연결 추천" 청록색 권장 + 연결 설정으로 이동
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import { apiFetch, useAuth } from '../../contexts/AuthContext';

interface Props {
  businessId: number;
}

interface CloudStatus {
  gdrive?: {
    connected: boolean;
    account_email?: string;
    root_folder_id?: string;
  };
}

const CloudConnectNotice: React.FC<Props> = ({ businessId }) => {
  const { t } = useTranslation('qproject');
  const { user } = useAuth();
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<CloudStatus | null>(null);

  // 고객(client)에게는 Drive 연결·관리 권한이 없으므로 안내 자체를 숨김
  const isClient = user?.business_role === 'client';

  useEffect(() => {
    if (!businessId || isClient) return;
    let cancelled = false;
    apiFetch(`/api/cloud/status/${businessId}`)
      .then(r => r.json())
      .then(j => { if (!cancelled) { setStatus(j?.data || {}); setLoaded(true); } })
      .catch(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, [businessId, isClient]);

  if (isClient) return null;
  if (!loaded) return null;

  const gdrive = status?.gdrive;
  const connected = !!gdrive?.connected;
  const driveLink = gdrive?.root_folder_id
    ? `https://drive.google.com/drive/folders/${gdrive.root_folder_id}`
    : null;

  if (connected) {
    return (
      <ConnectedNotice data-testid="cloud-connect-notice">
        <NoticeIcon $tone="amber" aria-hidden>!</NoticeIcon>
        <NoticeText>
          <strong>{t('docs.cloud.connectedTitle', { defaultValue: '워크스페이스 공용 파일을 Google Drive 에 보관 중입니다.' })}</strong>{' '}
          {t('docs.cloud.connectedBody', { defaultValue: '프로젝트·업무·채팅 첨부 파일이 자동으로 Drive 의 PlanQ 폴더에 저장됩니다. "내 파일" 등 개인 파일은 PlanQ 자체 스토리지에 보관됩니다. Drive 에서 직접 만들거나 삭제한 파일은 PlanQ 와 동기화되지 않으니 PlanQ 안에서만 관리해 주세요.' })}
        </NoticeText>
        {driveLink && (
          <NoticeAction as="a" href={driveLink} target="_blank" rel="noreferrer">
            {t('docs.cloud.openDrive', { defaultValue: 'Drive 폴더 열기' })} ↗
          </NoticeAction>
        )}
      </ConnectedNotice>
    );
  }

  return (
    <RecommendNotice data-testid="cloud-connect-notice">
      <NoticeIcon $tone="teal" aria-hidden>+</NoticeIcon>
      <NoticeText>
        <strong>{t('docs.cloud.recommendTitle', { defaultValue: 'Google Drive 연결을 권장합니다.' })}</strong>{' '}
        {t('docs.cloud.recommendDesc', { defaultValue: 'PlanQ 에서 업로드한 파일이 자동으로 Drive 의 PlanQ 폴더에 보관됩니다. 자체 스토리지 용량을 절약할 수 있어요.' })}
      </NoticeText>
      <NoticeAction as={Link} to="/business/settings/storage">
        {t('docs.cloud.connectCta', { defaultValue: '연결 설정' })} →
      </NoticeAction>
    </RecommendNotice>
  );
};

export default CloudConnectNotice;

const baseNotice = `
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 14px;
  border-radius: 10px;
  margin-bottom: 12px;
  @media (max-width: 640px) { flex-wrap: wrap; }
`;
const ConnectedNotice = styled.div`
  ${baseNotice}
  background: #FEF3C7;
  border: 1px solid #FDE68A;
`;
const RecommendNotice = styled.div`
  ${baseNotice}
  background: #F0FDFA;
  border: 1px solid #99F6E4;
`;
const NoticeIcon = styled.span<{ $tone: 'amber' | 'teal' }>`
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
  background: ${p => p.$tone === 'amber' ? '#F59E0B' : '#14B8A6'};
`;
const NoticeText = styled.div`
  flex: 1;
  font-size: 12.5px;
  line-height: 1.55;
  color: #334155;
  strong { color: #0F172A; font-weight: 700; }
`;
const NoticeAction = styled.button`
  flex-shrink: 0;
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 600;
  color: #0F766E;
  background: #fff;
  border: 1px solid #99F6E4;
  border-radius: 999px;
  text-decoration: none;
  cursor: pointer;
  white-space: nowrap;
  &:hover { background: #F0FDFA; border-color: #14B8A6; }
`;
