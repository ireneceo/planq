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
  // 닫음은 **이 브라우저의 편의**다 — 워크스페이스별로 기억하되 서버에 저장하지 않는다.
  //   localStorage 는 사생활 보호 창에서 던질 수 있으므로 읽기·쓰기 둘 다 감싼다.
  const dismissKey = `planq:cloud-notice-dismissed:${businessId}`;
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try { return localStorage.getItem(`planq:cloud-notice-dismissed:${businessId}`) === '1'; } catch { return false; }
  });

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
  if (dismissed) return null;

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
    // ★ 2026-09-20 (Irene: *"이 배너는 고장이야? 내용이 다 아래로 내려가잖아"*) —
    //   고장이 아니라 **항상 자리를 먹고 있었다.** 제목·본문·링크·저장위치까지 3~4줄이라
    //   파일 목록이 그만큼 아래로 밀렸다. 배너는 «지금 상태» 를 알리는 것이지 화면을 차지하는
    //   설명서가 아니다. 한 줄로 줄이고 **닫을 수 있게** 했다.
    //   ★ 본문 설명은 뺐다 — `title` 속성으로 옮기면 터치 기기에서 안 뜬다. 설명이 필요한 사람은
    //     [저장 위치 바꾸기] 로 설정에 간다.
    //   ★ **문제 상태일 때는 닫히지 않는다**(폴더를 못 찾음). 그건 알아야 하는 정보다.
    const hasProblem = folder?.reachable === false;
    return (
      <ConnectedNotice data-testid="cloud-connect-notice" $problem={hasProblem}>
        <NoticeIcon $tone="amber" aria-hidden>!</NoticeIcon>
        <NoticeText>
          {hasProblem
            ? t('docs.cloud.folderUnreachable')
            : t('docs.cloud.connectedOneLine', {
              defaultValue: '공용 파일은 Google Drive 에 저장됩니다',
            })}
        </NoticeText>
        {driveLink && (
          <NoticeAction as="a" href={driveLink} target="_blank" rel="noreferrer">
            {t('docs.cloud.openDrive', { defaultValue: 'Drive 폴더 열기' })} ↗
          </NoticeAction>
        )}
        {(inMyDrive || folder?.in_shared_drive) && (
          <SubLink to="/business/settings/storage">{t('docs.cloud.changeLocation')}</SubLink>
        )}
        {!hasProblem && (
          <DismissBtn type="button" data-testid="cloud-notice-dismiss"
            onClick={() => {
              setDismissed(true);
              try { localStorage.setItem(dismissKey, '1'); } catch { /* 사생활 보호 창 등 — 화면은 그대로 동작한다 */ }
            }}
            aria-label={t('docs.cloud.dismiss', { defaultValue: '이 안내 닫기' }) as string}
            title={t('docs.cloud.dismiss', { defaultValue: '이 안내 닫기' }) as string}>
            ✕
          </DismissBtn>
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

const SubLink = styled(Link)`
  color:#0F766E;font-weight:700;text-decoration:none;
  &:hover{text-decoration:underline;}
`;
export default CloudConnectNotice;

const baseNotice = `
  display: flex;
  align-items: flex-start;
  /* 좁은 폭에서만 감긴다. 2026-09-20 부터 배너는 **한 줄**이라 아래 줄이 없다
     (옛 NoticeSub 은 읽는 곳이 없어져 지웠다 — 남기면 다음 사람이 적용 중이라고 믿는다). */
  flex-wrap: wrap;
  gap: 10px;
  padding: 10px 14px;
  border-radius: 10px;
  margin-bottom: 12px;
`;
const ConnectedNotice = styled.div<{ $problem?: boolean }>`
  ${baseNotice}
  /* ★ 한 줄로 끝낸다 — 목록이 밀리지 않게. 좁으면 감기되 세로로 쌓이지는 않는다. */
  align-items: center;
  padding: 6px 12px;
  margin-bottom: 8px;
  background: ${p => (p.$problem ? '#FEE2E2' : '#FEF3C7')};
  border: 1px solid ${p => (p.$problem ? '#FECACA' : '#FDE68A')};
`;
const DismissBtn = styled.button`
  flex-shrink: 0; margin-left: auto;
  /* ★ 컨트롤 높이는 토큰(32/36/40/44)만 쓴다 — 24px 로 썼다가 가드(uispec)가 잡았다.
     한 줄 배너 안이라 가장 작은 32 를 쓰고, 폰에서는 손가락이 닿게 40 으로 키운다. */
  width: 32px; height: 32px; display: inline-flex; align-items: center; justify-content: center;
  @media (max-width: 640px) { width: 40px; height: 40px; }
  background: transparent; border: 0; border-radius: 6px;
  color: #92400E; font-size: 0.8125rem; line-height: 1; cursor: pointer;
  &:hover { background: rgba(146,64,14,0.12); }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 1px; }
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
