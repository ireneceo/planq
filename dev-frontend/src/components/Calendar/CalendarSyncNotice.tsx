// 캘린더 상단 안내 — Google 캘린더 연동 시 현재 동기화 범위 안내(#126·#201).
//
// #201 — 옛 문구는 두 연동을 한 문장으로 뭉쳐 "PlanQ에서 만든 일정은 Google 캘린더에 자동 반영"
//   이라고만 했다. 개인 연동만 한 사용자에게 이 문장은 거짓이다. 실제 동작은 연동 종류로 갈린다:
//     - 워크스페이스 연동(BusinessCloudToken, scope calendar.events)
//         → PlanQ → Google 쓰기 O. 단 google_calendar.isPrivateForGcal 이 개인(L1)·팀 비공개(L2)·
//           visibility='personal' 일정을 막으므로 "워크스페이스에 공개된 일정만" 넘어간다.
//     - 개인 연동(external_connections owner_scope='user', scope calendar.readonly)
//         → 읽기 전용 overlay 뿐. 쓰기 경로 자체가 없다(services/personalCalendar.js).
//   그래서 연동 종류별로 문장을 분기한다. 양쪽 다 연결했으면 두 문장 모두 보여준다.
//
//   실시간 양방향(Google 변경의 자동 반영)은 Google OAuth 검수 승인 후 제공
//   ([[project_google_oauth_verification_pending]]) — 워크스페이스 연동에만 해당하는 이야기다.
//   일상 사용 화면이라 사용자별 1회 dismiss(localStorage). 문구가 실질적으로 바뀌었으므로
//   dismiss 키에 v2 를 붙여, 옛 (틀린) 문구를 닫았던 사용자도 정정된 안내를 한 번은 보게 한다.
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';

interface Props {
  workspaceConnected: boolean;  // 워크스페이스 Google 캘린더 (owner 연결, 쓰기 가능)
  personalConnected: boolean;   // 개인 Google 캘린더 연결됨
  personalCanWrite?: boolean;   // 쓰기 스코프(calendar.events)까지 동의했는가 — 문구가 여기서 갈린다
}

const DISMISS_KEY = 'qcal_sync_notice_dismissed_v3';

const CalendarSyncNotice: React.FC<Props> = ({ workspaceConnected, personalConnected, personalCanWrite = false }) => {
  const { t } = useTranslation('qcalendar');
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; }
  });
  if ((!workspaceConnected && !personalConnected) || dismissed) return null;

  const close = () => {
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* noop */ }
    setDismissed(true);
  };

  return (
    <Notice role="note">
      <NoticeIcon aria-hidden>!</NoticeIcon>
      <NoticeText>
        <strong>{t('syncNotice.title', { defaultValue: 'Google 캘린더 연동 범위' })}</strong>
        {workspaceConnected && (
          <NoticeLine>
            <LineLabel>{t('syncNotice.workspaceLabel', { defaultValue: '워크스페이스 연동' }) as string}</LineLabel>
            {t('syncNotice.workspaceBody')}
          </NoticeLine>
        )}
        {personalConnected && (
          <NoticeLine>
            <LineLabel>{t('syncNotice.personalLabel', { defaultValue: '개인 연동' }) as string}</LineLabel>
            {personalCanWrite ? t('syncNotice.personalBodyWrite') : t('syncNotice.personalBodyRead')}
          </NoticeLine>
        )}
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
const NoticeLine = styled.div`
  margin-top: 4px;
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
