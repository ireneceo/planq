// 캘린더 상단 안내 — Google 캘린더 연동 시 현재 동기화 범위 안내(#126).
//   현재: PlanQ→Google 내보내기 + 연결한 개인 Google 일정 읽기(overlay)는 동작.
//   실시간 양방향(Google 변경의 자동 반영)은 Google OAuth 검수 승인 후 제공([[project_google_oauth_verification_pending]]).
//   고객이 "양방향이 안 된다"고 오해하지 않도록 기대치를 맞춘다. CloudConnectNotice(Drive 단방향)와 같은
//   시각 언어. 일상 사용 화면이라 사용자별 1회 dismiss(localStorage) — 승인되면 이 배너 자체를 제거.
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';

interface Props {
  connected: boolean;   // 워크스페이스 또는 개인 Google 캘린더 연동 여부
}

const DISMISS_KEY = 'qcal_sync_notice_dismissed';

const CalendarSyncNotice: React.FC<Props> = ({ connected }) => {
  const { t } = useTranslation('qcalendar');
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; }
  });
  if (!connected || dismissed) return null;

  const close = () => {
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* noop */ }
    setDismissed(true);
  };

  return (
    <Notice role="note">
      <NoticeIcon aria-hidden>!</NoticeIcon>
      <NoticeText>
        <strong>{t('syncNotice.title', { defaultValue: 'Google 캘린더는 현재 제한적으로 연동됩니다.' })}</strong>{' '}
        {t('syncNotice.body', { defaultValue: 'PlanQ에서 만든 일정은 Google 캘린더에 자동 반영되고, 연결한 개인 Google 일정은 여기서 함께 볼 수 있어요. 실시간 양방향 동기화(Google에서 변경한 내용의 자동 반영)는 Google 검수 승인 후 제공됩니다.' })}
      </NoticeText>
      <CloseBtn type="button" onClick={close} aria-label={t('syncNotice.dismiss', { defaultValue: '안내 닫기' }) as string}>×</CloseBtn>
    </Notice>
  );
};

export default CalendarSyncNotice;

const Notice = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 14px;
  border-radius: 10px;
  margin-bottom: 12px;
  background: #FEF3C7;
  border: 1px solid #FDE68A;
  @media (max-width: 640px) { flex-wrap: wrap; }
`;
const NoticeIcon = styled.span`
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
  background: #F59E0B;
`;
const NoticeText = styled.div`
  flex: 1;
  min-width: 0;
  font-size: 12.5px;
  line-height: 1.55;
  color: #334155;
  strong { color: #0F172A; font-weight: 700; }
`;
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
