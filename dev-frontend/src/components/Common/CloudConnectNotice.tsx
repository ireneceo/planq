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
    /** PlanQ 폴더가 어디 있는가 — 서버가 Drive 에 실제로 물어본 값. */
    folder?: {
      name?: string;
      web_view_link?: string | null;
      /** true = 공유(팀) 드라이브 안. false = 연결한 사람의 내 드라이브. */
      in_shared_drive?: boolean;
      reachable?: boolean;
    } | null;
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
  const folder = gdrive?.folder || null;
  const driveLink = folder?.web_view_link
    || (gdrive?.root_folder_id ? `https://drive.google.com/drive/folders/${gdrive.root_folder_id}` : null);
  // 팀 드라이브를 쓰고 싶은데 폴더가 내 드라이브에 있으면 그 사실과 옮기는 법을 말해 준다.
  //   ★ drive.file 권한은 **앱이 만든 파일을 계속 따라간다** — 폴더를 공유 드라이브로 끌어다 놓아도
  //     PlanQ 접근권은 유지된다. 그래서 "옮기세요" 가 성립하고, 재연동도 필요 없다.
  const inMyDrive = !!folder && folder.reachable !== false && folder.in_shared_drive === false;

  if (connected) {
    return (
      <ConnectedNotice data-testid="cloud-connect-notice">
        <NoticeIcon $tone="amber" aria-hidden>!</NoticeIcon>
        <NoticeText>
          <strong>{t('docs.cloud.connectedTitle', { defaultValue: '공용 파일은 Google Drive 에 저장됩니다.' })}</strong>{' '}
          {t('docs.cloud.connectedBody', { defaultValue: 'Drive 에서 직접 만들거나 지운 파일은 PlanQ 에 반영되지 않습니다.' })}
        </NoticeText>
        {driveLink && (
          <NoticeAction as="a" href={driveLink} target="_blank" rel="noreferrer">
            {t('docs.cloud.openDrive', { defaultValue: 'Drive 폴더 열기' })} ↗
          </NoticeAction>
        )}
        {folder?.reachable === false && (
          <NoticeSub data-testid="cloud-folder-unreachable">
            {t('docs.cloud.folderUnreachable')}
          </NoticeSub>
        )}
        {folder?.in_shared_drive && (
          <NoticeSub data-testid="cloud-folder-shared">
            {t('docs.cloud.inSharedDrive', { name: folder.name || '' })}
          </NoticeSub>
        )}
        {inMyDrive && (
          <NoticeSub data-testid="cloud-folder-mydrive">
            {t('docs.cloud.inMyDrive', { name: folder?.name || '' })}
          </NoticeSub>
        )}
      </ConnectedNotice>
    );
  }

  return (
    <RecommendNotice data-testid="cloud-connect-notice">
      <NoticeIcon $tone="teal" aria-hidden>+</NoticeIcon>
      <NoticeText>
        <strong>{t('docs.cloud.recommendTitle', { defaultValue: 'Google Drive 연결' })}</strong>{' '}
        {t('docs.cloud.recommendDesc', { defaultValue: '공용 파일을 Drive 에 보관해 저장 용량을 아낄 수 있어요.' })}
      </NoticeText>
      <NoticeAction as={Link} to="/business/settings/storage">
        {t('docs.cloud.connectCta', { defaultValue: '연결 설정' })} →
      </NoticeAction>
    </RecommendNotice>
  );
};

const NoticeSub = styled.p`
  /* 안내 본문 아래 한 줄 — **자기 줄을 차지한다**(부모가 wrap 이라 성립).
     min-width:0 이 없으면 긴 문장이 flex 기본 규칙에 눌려 옆 칸을 밀어낸다. */
  flex-basis: 100%;
  min-width: 0;
  margin: 6px 0 0;
  font-size: 0.75rem;
  line-height: 1.55;
  color: #475569;
`;

export default CloudConnectNotice;

const baseNotice = `
  display: flex;
  align-items: flex-start;
  /* ★ 모든 폭에서 감긴다. 데스크탑에서만 wrap 이 없었던 탓에, 아래 줄(NoticeSub)이
     같은 행에 끼어 **첫 칸이 길게 늘어지고 전체가 한 줄로 뭉갰다**
     (Irene 2026-09-07: "첫 열이 길게 늘어져서 엉망이야"). */
  flex-wrap: wrap;
  gap: 10px;
  padding: 10px 14px;
  border-radius: 10px;
  margin-bottom: 12px;
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
  font-size: 0.75rem;
  font-weight: 700;
  line-height: 1;
  color: #fff;
  background: ${p => p.$tone === 'amber' ? '#F59E0B' : '#14B8A6'};
`;
const NoticeText = styled.div`
  flex: 1;
  /* 좁은 화면에서는 글이 한 줄을 다 쓰고 버튼은 다음 줄로 내려간다.
     버튼이 옆에 끼면 안내문이 2~3자씩 끊겨 읽을 수 없다(모바일 실측 2026-08-25). */
  @media (max-width: 640px) { flex: 1 1 100%; }
  font-size: 0.78125rem;
  line-height: 1.55;
  color: #334155;
  strong { color: #0F172A; font-weight: 700; }
`;
const NoticeAction = styled.button`
  flex-shrink: 0;
  /* 아이콘(20px) + gap(10px) 만큼 들여써 본문 왼쪽선에 맞춘다. */
  @media (max-width: 640px) { margin-left: 30px; margin-top: 2px; }
  padding: 4px 10px;
  font-size: 0.75rem;
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
