// 회의 설정 창(StartMeetingModal)의 조각 — 녹음 방식 줄 · «더 정확하게» 접는 카드 · 바닥 안내.
//
// Irene 2026-11-08: *"설정 팝업도 … 다 나열된 상태에서 뭘 어떻게 설정하면 어떻게 되는지 모르겠어. 친절하고 인지가 바로 되게 심플한 UI/UX"*
// → 꼭 필요한 것(제목·목적·언어)만 펼치고, 나머지는 «넣으면 무엇이 좋아지나» 한 줄 + 지금 값 요약이 붙은 접힌 카드.
// Fable 설계 판정(2026-11-08 DESIGN-FIX 반영): 카드는 여러 개 동시에 열린다(아코디언 X) · 편집도 접힌 채 시작 ·
// 요약은 실제 값(«김○○ 외 2명» · «파일 2개 · 링크 1개») · 이모지 대신 앱 SVG 아이콘.
// 2170줄 설정 창이 더 커지지 않게 껍데기는 여기에 둔다.
import React from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { MonitorIcon, MicIcon, ChevronDownIcon } from '../../components/Common/Icons';
import type { CaptureMode } from '../../services/audio';

/** 맨 위 녹음 방식 줄 — 메뉴에서 이미 골랐다. 새 노트면 [바꾸기], 편집이면 바꿀 수 없음(저장이 녹음 방식을 보내지 않는다 ·
 *  녹음한 뒤 바꾸면 앞 구간과 뒤 구간의 화자 구분이 섞인다 — Fable 판정 c). */
export function CaptureModeBar({ mode, onChange, locked, onlineAvailable }: {
  mode: CaptureMode;
  onChange: (m: CaptureMode) => void;
  locked: boolean;
  onlineAvailable: boolean;
}) {
  const { t } = useTranslation('qnote');
  const online = mode === 'web_conference';
  const other: CaptureMode = online ? 'microphone' : 'web_conference';
  const switchBlocked = !online && !onlineAvailable;
  return (
    <ModeBar data-testid="qnote-start-mode" data-mode={mode}>
      <ModeIcon $online={online} aria-hidden="true">{online ? <MonitorIcon size={18} /> : <MicIcon size={18} />}</ModeIcon>
      <ModeText>
        <ModeName>{online ? t('startModal.mode.online') : t('startModal.mode.offline')}</ModeName>
        <ModeHint>
          {locked
            ? t('startModal.mode.locked')
            : (online ? t('startModal.mode.onlineHint') : t('startModal.mode.offlineHint'))}
        </ModeHint>
        {!locked && switchBlocked && <ModeHint>{t('startModal.mode.onlineUnavailable')}</ModeHint>}
      </ModeText>
      {!locked && (
        <ModeSwitch type="button" data-testid="qnote-start-mode-change"
          disabled={switchBlocked}
          onClick={() => onChange(other)}
          title={(online ? t('startModal.mode.toOffline') : t('startModal.mode.toOnline')) as string}>
          {t('startModal.mode.change')}
        </ModeSwitch>
      )}
    </ModeBar>
  );
}

/** «더 정확하게» 카드 하나 — 머리줄(아이콘·이름·좋아지는 것·지금 값)을 누르면 그 자리에서 입력칸이 펼쳐진다. */
export function SettingCard({ id, icon, title, benefit, summary, filled, open, onToggle, children }: {
  id: string;
  icon: React.ReactNode;
  title: string;
  benefit: string;
  summary: string;
  filled: boolean;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <Card $open={open} data-testid={`qnote-card-${id}`}>
      <CardHead type="button" aria-expanded={open} aria-controls={`qnote-card-body-${id}`} onClick={onToggle}>
        <CardIcon $filled={filled} aria-hidden="true">{icon}</CardIcon>
        <CardText>
          <CardTitle>{title}</CardTitle>
          <CardBenefit>{benefit}</CardBenefit>
        </CardText>
        <CardSummary $filled={filled} data-testid={`qnote-card-${id}-summary`}>{summary}</CardSummary>
        <CardChevron $open={open} aria-hidden="true"><ChevronDownIcon size={16} /></CardChevron>
      </CardHead>
      {open && <CardBody id={`qnote-card-body-${id}`}>{children}</CardBody>}
    </Card>
  );
}

export function MoreSectionTitle() {
  const { t } = useTranslation('qnote');
  return (
    <MoreHead>
      <MoreTitle>{t('startModal.more.title')}</MoreTitle>
      <MoreHint>{t('startModal.more.hint')}</MoreHint>
    </MoreHead>
  );
}

export const FooterNote = styled.span`
  margin-right: auto;
  font-size: 0.75rem;
  color: #64748B;
  align-self: center;
  @media (max-width: 640px) { display: none; }
`;

// ── styled ──
const ModeBar = styled.div`
  display: flex; align-items: center; gap: 12px;
  padding: 12px 14px;
  border: 1px solid #CCFBF1; background: #F0FDFA;
  border-radius: 10px;
  margin-bottom: 16px;
`;
const ModeIcon = styled.span<{ $online: boolean }>`
  flex-shrink: 0; width: 36px; height: 36px; border-radius: 10px;
  display: inline-flex; align-items: center; justify-content: center;
  background: ${p => (p.$online ? '#EFF6FF' : '#F5F3FF')};
  color: ${p => (p.$online ? '#1D4ED8' : '#6D28D9')};
`;
const ModeText = styled.div`flex: 1; min-width: 0;`;
const ModeName = styled.div`font-size: 0.875rem; font-weight: 700; color: #0F172A;`;
const ModeHint = styled.div`font-size: 0.75rem; color: #475569; margin-top: 2px; line-height: 1.45;`;
const ModeSwitch = styled.button`
  flex-shrink: 0; height: 32px; padding: 0 12px;
  border: 1px solid #CBD5E1; background: #FFFFFF; color: #0F172A;
  border-radius: 8px; font-size: 0.8125rem; font-weight: 600; cursor: pointer;
  &:hover:not(:disabled) { border-color: #14B8A6; color: #0F766E; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;

const MoreHead = styled.div`margin: 8px 0 8px;`;
const MoreTitle = styled.div`font-size: 0.8125rem; font-weight: 700; color: #0F172A;`;
const MoreHint = styled.div`font-size: 0.75rem; color: #64748B; margin-top: 2px;`;

const Card = styled.div<{ $open: boolean }>`
  border: 1px solid ${p => (p.$open ? '#99F6E4' : '#E2E8F0')};
  border-radius: 10px;
  background: #FFFFFF;
  & + & { margin-top: 8px; }
`;
const CardHead = styled.button`
  display: flex; align-items: center; gap: 10px; width: 100%;
  padding: 10px 12px; min-height: 52px;
  background: transparent; border: none; text-align: left; cursor: pointer;
  border-radius: 10px;
  &:hover { background: #F8FAFC; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: -2px; }
`;
const CardIcon = styled.span<{ $filled: boolean }>`
  flex-shrink: 0; width: 32px; height: 32px; border-radius: 8px;
  display: inline-flex; align-items: center; justify-content: center;
  background: ${p => (p.$filled ? '#CCFBF1' : '#F1F5F9')};
  color: ${p => (p.$filled ? '#0F766E' : '#64748B')};
`;
const CardText = styled.span`display: block; flex: 1; min-width: 0;`;
const CardTitle = styled.span`display: block; font-size: 0.875rem; font-weight: 600; color: #0F172A;`;
const CardBenefit = styled.span`display: block; font-size: 0.75rem; color: #64748B; margin-top: 1px; line-height: 1.4;`;
const CardSummary = styled.span<{ $filled: boolean }>`
  flex-shrink: 1; min-width: 0; max-width: 40%;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 0.75rem; font-weight: ${p => (p.$filled ? 600 : 400)};
  color: ${p => (p.$filled ? '#0F766E' : '#94A3B8')};
`;
const CardChevron = styled.span<{ $open: boolean }>`
  flex-shrink: 0; color: #94A3B8; display: inline-flex;
  transform: rotate(${p => (p.$open ? '180deg' : '0deg')});
  transition: transform 0.15s;
`;
const CardBody = styled.div`
  padding: 4px 14px 14px;
  border-top: 1px solid #F1F5F9;
  & > *:first-child { margin-top: 10px; }
`;
