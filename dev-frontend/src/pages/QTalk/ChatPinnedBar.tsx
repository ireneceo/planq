// 대화 머리 아래 공지 띠 — 핀한 메시지 목록(Slack 패턴, 사이클 N+16-E). ChatPanel 에서 떼어 냄(2026-11-16 · god-file 래칫).
//   «전체» 방(services/team_channel)이면 핀이 없어도 띠를 보이고 «공지 목록»(지난 공지·읽은 사람) · «공지 올리기»(대표·관리자)를 붙인다.
//   공지 메시지(meta.announcement)는 본문 대신 제목을 보인다.
import React, { useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import type { MockMessage } from './types';
import AnnouncementsDrawer from '../../components/TeamChannel/AnnouncementsDrawer';
import AnnounceModal from '../../components/TeamChannel/AnnounceModal';

interface Props {
  pinnedMessages: MockMessage[];
  canPin: boolean;
  onJump: (msgId: number) => void;
  onUnpin: (m: MockMessage) => void;
  formatTime: (iso: string) => string;
  /** «전체» 방일 때만 */
  team?: { businessId: number; conversationId: number; myUserId: number; canAnnounce: boolean } | null;
}

const ChatPinnedBar: React.FC<Props> = ({ pinnedMessages, canPin, onJump, onUnpin, formatTime, team }) => {
  const { t } = useTranslation('qtalk');
  const [open, setOpen] = useState(true);
  const [listOpen, setListOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  if (!pinnedMessages.length && !team) return null;
  return (
    <>
      <PinnedBar data-testid="chat-pinned-bar">
        <HeadRow>
          <PinnedHeader type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} disabled={!pinnedMessages.length}>
            <PinIcon viewBox="0 0 24 24" fill="currentColor"><path d="M14 4l-1 1 1 1-4 4-4-1-1 1 4 4-5 5 1 1 5-5 4 4 1-1-1-4 4-4 1 1 1-1z"/></PinIcon>
            <PinnedTitle>{pinnedMessages.length
              ? t('chat.pinned.count', { count: pinnedMessages.length, defaultValue: `공지 ${pinnedMessages.length}개` })
              : t('team.bar.none', '게시 중인 공지 없음')}</PinnedTitle>
            {pinnedMessages.length > 0 && (
              <PinChevron $open={open} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9" />
              </PinChevron>
            )}
          </PinnedHeader>
          {team && (
            <TeamActions>
              <TeamBtn type="button" onClick={() => setListOpen(true)} data-testid="team-announcements-open">{t('team.bar.list', '공지 목록')}</TeamBtn>
              {team.canAnnounce && (
                <TeamBtn type="button" $primary onClick={() => setComposeOpen(true)} data-testid="team-announce-open">{t('team.bar.new', '공지 올리기')}</TeamBtn>
              )}
            </TeamActions>
          )}
        </HeadRow>
        {open && pinnedMessages.length > 0 && (
          <PinnedList>
            {pinnedMessages.map((m) => (
              <PinnedItem key={m.id} type="button" onClick={() => onJump(m.id)}>
                <PinnedSender>{m.sender_name}</PinnedSender>
                <PinnedBody>{m.announcement?.title || m.body || (m.attachments?.length ? t('preview.attachments', { defaultValue: '[첨부 {{count}}개]', count: m.attachments.length }) : '')}</PinnedBody>
                <PinnedTime>{formatTime(m.pinned_at || m.created_at)}</PinnedTime>
                {canPin && (
                  <PinnedUnpinBtn
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onUnpin(m); }}
                    title={t('chat.pinned.unpin', '공지 해제') as string}
                    aria-label={t('chat.pinned.unpin', '공지 해제') as string}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
                  </PinnedUnpinBtn>
                )}
              </PinnedItem>
            ))}
          </PinnedList>
        )}
      </PinnedBar>
      {team && (
        <AnnouncementsDrawer open={listOpen} onClose={() => setListOpen(false)}
          businessId={team.businessId} conversationId={team.conversationId} myUserId={team.myUserId} canAnnounce={team.canAnnounce}
          onJump={(id) => { setListOpen(false); onJump(id); }} />
      )}
      {team && composeOpen && (
        <AnnounceModal businessId={team.businessId} onClose={() => setComposeOpen(false)} onDone={() => setComposeOpen(false)} />
      )}
    </>
  );
};
export default ChatPinnedBar;

/** 대화 안 공지 메시지 머리 — «공지» 표 + 제목(본문은 ChatPanel 이 그대로 그린다). */
export const AnnouncementHead: React.FC<{ title: string }> = ({ title }) => {
  const { t } = useTranslation('qtalk');
  return (
    <AnnHead data-testid="chat-announcement-head">
      <AnnTag>{t('team.msg.tag', '공지')}</AnnTag>
      <AnnTitle>{title}</AnnTitle>
    </AnnHead>
  );
};
const AnnHead = styled.div`display: flex; align-items: baseline; gap: 6px; margin-bottom: 4px; min-width: 0;`;
const AnnTag = styled.span`
  flex-shrink: 0; font-size: 0.6875rem; font-weight: 700; padding: 1px 7px; border-radius: 999px;
  background: #FEF3C7; color: #92400E;
`;
const AnnTitle = styled.span`font-size: 0.9375rem; font-weight: 700; color: #0F172A; overflow-wrap: anywhere;`;

const HeadRow = styled.div`display: flex; align-items: center; gap: 6px; padding-right: 10px;`;
const TeamActions = styled.div`display: flex; align-items: center; gap: 6px; flex-shrink: 0;`;
const TeamBtn = styled.button<{ $primary?: boolean }>`
  min-height: 32px; padding: 0 10px; border-radius: 6px; cursor: pointer; font-size: 0.75rem; font-weight: 700; white-space: nowrap;
  border: 1px solid ${(p) => (p.$primary ? '#0F766E' : 'rgba(217, 119, 6, 0.35)')};
  background: ${(p) => (p.$primary ? '#14B8A6' : '#FFFFFF')}; color: ${(p) => (p.$primary ? '#FFFFFF' : '#92400E')};
  &:hover { background: ${(p) => (p.$primary ? '#0D9488' : '#FFFBEB')}; }
`;

// PinnedBar — Slack 패턴 헤더 아래 공지 영역
const PinnedBar = styled.div`
  flex-shrink: 0;
  background: linear-gradient(180deg, #FEF3C7 0%, #FEF9E7 100%);
  border-bottom: 1px solid #FCD34D;
`;
const PinnedHeader = styled.button`
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 16px;
  background: transparent;
  border: none;
  cursor: pointer;
  font-size: 0.75rem;
  color: #92400E;
  transition: background 0.15s;
  &:hover:not(:disabled) { background: rgba(245, 158, 11, 0.08); }
  &:disabled { cursor: default; }
`;
const PinIcon = styled.svg`
  width: 14px;
  height: 14px;
  color: #D97706;
  flex-shrink: 0;
`;
const PinnedTitle = styled.span`
  font-size: 0.75rem;
  font-weight: 700;
  color: #92400E;
`;
const PinChevron = styled.svg<{ $open: boolean }>`
  width: 12px;
  height: 12px;
  color: #92400E;
  margin-left: auto;
  transition: transform 0.15s;
  transform: rotate(${(p) => (p.$open ? '0deg' : '-90deg')});
`;
const PinnedList = styled.div`
  display: flex;
  flex-direction: column;
  padding: 0 8px 8px;
  gap: 4px;
  max-height: 200px;
  /* #245 — 한 축만 auto 로 두면 반대축이 visible→auto 로 강제돼(CSS overflow 상호작용)
     1px 초과에도 가로로 흔들린다. MessageList 와 같은 잠금을 여기에도 건다
     (내부 PinnedItem 에 nowrap 텍스트가 있어 실제로 넘칠 수 있다). */
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior-x: none;
`;
const PinnedItem = styled.button`
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 30px 8px 12px;
  background: #FFFFFF;
  border: 1px solid rgba(217, 119, 6, 0.18);
  border-radius: 8px;
  cursor: pointer;
  text-align: left;
  font-size: 0.75rem;
  transition: background 0.15s, border-color 0.15s;
  &:hover { background: #FFFBEB; border-color: #F59E0B; }
`;
const PinnedSender = styled.span`
  font-weight: 700;
  color: #0F172A;
  flex-shrink: 0;
`;
const PinnedBody = styled.span`
  flex: 1;
  color: #334155;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
`;
const PinnedTime = styled.span`
  font-size: 0.625rem;
  color: #94A3B8;
  flex-shrink: 0;
`;
const PinnedUnpinBtn = styled.button`
  position: absolute;
  right: 4px;
  top: 50%;
  transform: translateY(-50%);
  width: 22px;
  height: 22px;
  border: none;
  background: transparent;
  color: #94A3B8;
  border-radius: 4px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  &:hover { background: #FEF3C7; color: #92400E; }
`;
