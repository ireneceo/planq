// 좌측 하단 «시계·근무» 가 접혔을 때의 **요약 한 줄** (2026-09-21).
//   Irene: *"시계/근무라는 제목이 안나오고 화살표 말고 다른 방법으로 열리게 못하나? … 쓸데없는 항목명도."*
//   → 제목·화살표 줄을 없애고, 접힌 상태에서는 «지금 시각 · 근무 상태» 한 줄을 보여 준다.
//     **그 줄을 누르면** 펼쳐진다. 펼친 뒤 접기는 카드 아래 [간단히 보기].
//   근무 상태는 근태 위젯과 **같은 훅**(useAttendance)으로 읽는다 — 따로 세면 둘이 갈라진다.
import React, { useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { useAttendance } from '../../hooks/useAttendance';

const DOT: Record<string, string> = { working: '#5EEAD4', on_break: '#FCD34D', done: '#94A3B8', none: '#CBD5E1' };

function hhmm(tz: string | undefined): string {
  try {
    return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz || undefined }).format(new Date());
  } catch { return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date()); }
}

const SidebarStatusSummary: React.FC<{ workspaceTz?: string; onOpen: () => void }> = ({ workspaceTz, onOpen }) => {
  const { t } = useTranslation('layout');
  const { t: ta } = useTranslation('attendance');
  const { user } = useAuth();
  const isClient = user?.business_role === 'client';
  const bizId = (!isClient && user?.business_id) ? Number(user.business_id) : null;
  const a = useAttendance(bizId);
  const [now, setNow] = useState(() => hhmm(workspaceTz));
  useEffect(() => {
    setNow(hhmm(workspaceTz));
    const id = window.setInterval(() => setNow(hhmm(workspaceTz)), 20000);
    return () => window.clearInterval(id);
  }, [workspaceTz]);
  const key = a.state || 'none';
  return (
    <Row type="button" data-testid="sidebar-status-summary" onClick={onOpen}
      aria-expanded={false} aria-controls="pq-sidebar-status"
      title={t('sidebar.statusExpand', '시계·근무 펼치기') as string}>
      <ClockIcon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15 14" />
      </ClockIcon>
      <Time>{now}</Time>
      {bizId && <>
        <Sep aria-hidden="true">·</Sep>
        <Dot style={{ background: DOT[key] }} aria-hidden="true" />
        <State>{ta(`state.${key}`) as string}</State>
      </>}
    </Row>
  );
};

export default SidebarStatusSummary;

const Row = styled.button`
  display: flex; align-items: center; gap: 6px;
  width: 100%; padding: 6px 8px; margin: 0 0 4px 0; border-radius: 8px;
  background: rgba(255, 255, 255, 0.04); border: 1px solid transparent; cursor: pointer;
  color: rgba(255, 255, 255, 0.78); font-size: 0.75rem; font-weight: 500; text-align: left;
  font-variant-numeric: tabular-nums;
  &:hover { background: rgba(255, 255, 255, 0.08); color: #FFFFFF; }
  &:focus-visible { outline: none; border-color: rgba(255, 255, 255, 0.3); }
`;
const ClockIcon = styled.svg`width: 14px; height: 14px; flex-shrink: 0; opacity: 0.8;`;
const Time = styled.span`font-weight: 600; color: #FFFFFF;`;
const Sep = styled.span`opacity: 0.5;`;
const Dot = styled.span`width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0;`;
const State = styled.span`overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`;
