import React, { useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import type { CalendarEvent, EventCategory } from './types';
import { CATEGORY_OPTIONS, getEventColors } from './categoryColors';
import { formatTime, isoToLocalInput } from './dateUtils';
import DetailDrawer from '../../components/Common/DetailDrawer';

// RRULE 문자열을 i18n 라벨로 변환 (Phase C 프리셋 기준)
const recurrenceLabel = (rrule: string, t: (k: string) => string): string => {
  const r = rrule.replace('RRULE:', '');
  if (r === 'FREQ=DAILY') return t('recurrence.daily');
  if (r === 'FREQ=WEEKLY') return t('recurrence.weekly');
  if (r === 'FREQ=WEEKLY;INTERVAL=2') return t('recurrence.biweekly');
  if (r === 'FREQ=MONTHLY') return t('recurrence.monthly');
  if (r === 'FREQ=YEARLY') return t('recurrence.yearly');
  return t('recurrence.label');
};

interface Props {
  event: CalendarEvent | null;
  onClose: () => void;
  onUpdate: (patch: Partial<CalendarEvent>) => void;
  onDelete: () => void;
  onCreateMeetingRoom?: () => Promise<void>;
  dailyConfigured?: boolean;
}

const EventDrawer: React.FC<Props> = ({ event, onClose, onUpdate, onDelete, onCreateMeetingRoom, dailyConfigured }) => {
  const { t } = useTranslation('qcalendar');
  const [copied, setCopied] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [embedOpen, setEmbedOpen] = useState(false);
  const [creatingRoom, setCreatingRoom] = useState(false);

  const handleCreateRoom = async () => {
    if (!onCreateMeetingRoom) return;
    setCreatingRoom(true);
    try { await onCreateMeetingRoom(); } finally { setCreatingRoom(false); }
  };

  if (!event) return null;
  const c = getEventColors(event);
  const start = new Date(event.start_at);
  const end = new Date(event.end_at);

  const copyMeetingLink = async () => {
    if (!event.meeting_url) return;
    try { await navigator.clipboard.writeText(event.meeting_url); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {}
  };

  const formatDateTime = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}. ${m}. ${day} ${formatTime(d)}`;
  };

  return (
    <DetailDrawer open={!!event} onClose={onClose} width={440} ariaLabel={event.title}>
      <DetailDrawer.Header onClose={onClose}>
        <HeaderInner>
          <ColorBar $color={c.fg} />
          <HeaderTexts>
            <TitleInput
              defaultValue={event.title}
              onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== event.title) onUpdate({ title: v }); }}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            />
            <MetaRow>
              <CategoryPill $bg={c.bg} $fg={c.fg}>
                {t(`category.${event.category}`)}
              </CategoryPill>
              {event.Project && (
                <ProjectChip>
                  <ProjectDot $color={event.Project.color || '#94A3B8'} />
                  {event.Project.name}
                </ProjectChip>
              )}
              <VisibilityTag>{t(`visibility.${event.visibility}`)}</VisibilityTag>
              {event.rrule && (
                <RecurrenceBadge>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="23 4 23 10 17 10" />
                    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                  </svg>
                  {recurrenceLabel(event.rrule, t)}
                </RecurrenceBadge>
              )}
            </MetaRow>
          </HeaderTexts>
        </HeaderInner>
      </DetailDrawer.Header>

      <DetailDrawer.Body>
          <Section>
            <SectionIcon>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
              </svg>
            </SectionIcon>
            <SectionBody>
              <DateLine>{formatDateTime(start)}</DateLine>
              <DateLine>→ {formatDateTime(end)}</DateLine>
              {event.all_day && <MutedSmall>{t('allDay')}</MutedSmall>}
            </SectionBody>
          </Section>

          {event.location && (
            <Section>
              <SectionIcon>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" />
                </svg>
              </SectionIcon>
              <SectionBody><Plain>{event.location}</Plain></SectionBody>
            </Section>
          )}

          {event.meeting_url ? (
            <Section>
              <SectionIcon>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" />
                </svg>
              </SectionIcon>
              <SectionBody>
                <MutedSmall>{t('drawer.meeting')}</MutedSmall>
                <MeetingActions>
                  {event.meeting_provider === 'daily' && (
                    <JoinBtn as="button" type="button" onClick={() => setEmbedOpen((x) => !x)}>
                      {embedOpen ? t('drawer.closeEmbed') : t('drawer.openInEmbed')}
                    </JoinBtn>
                  )}
                  <CopyBtn as="a" href={event.meeting_url} target="_blank" rel="noreferrer">
                    {t('drawer.joinMeeting')} ↗
                  </CopyBtn>
                  <CopyBtn onClick={copyMeetingLink}>
                    {copied ? t('drawer.linkCopied') : t('drawer.copyLink')}
                  </CopyBtn>
                </MeetingActions>
                {embedOpen && event.meeting_provider === 'daily' && (
                  <MeetingEmbed>
                    <iframe
                      src={event.meeting_url}
                      title={t('drawer.meeting')}
                      allow="camera; microphone; fullscreen; speaker; display-capture; autoplay"
                      allowFullScreen
                    />
                  </MeetingEmbed>
                )}
              </SectionBody>
            </Section>
          ) : (
            dailyConfigured && onCreateMeetingRoom && (
              <Section>
                <SectionIcon>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" />
                  </svg>
                </SectionIcon>
                <SectionBody>
                  <MutedSmall>{t('drawer.meeting')}</MutedSmall>
                  <CreateRoomBtn onClick={handleCreateRoom} disabled={creatingRoom}>
                    {creatingRoom ? t('drawer.creating') : t('drawer.createRoom')}
                  </CreateRoomBtn>
                </SectionBody>
              </Section>
            )
          )}

          {event.description && (
            <Section>
              <SectionIcon>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="21" y1="6" x2="3" y2="6" /><line x1="21" y1="12" x2="3" y2="12" /><line x1="21" y1="18" x2="3" y2="18" />
                </svg>
              </SectionIcon>
              <SectionBody>
                <Description>{event.description}</Description>
              </SectionBody>
            </Section>
          )}

          <Section>
            <SectionIcon>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </SectionIcon>
            <SectionBody>
              <MutedSmall>{t('drawer.attendees')}</MutedSmall>
              {(event.attendees || []).length === 0 ? (
                <Plain style={{ color: '#94A3B8' }}>{t('drawer.noAttendees')}</Plain>
              ) : (
                <AttendeeList>
                  {(event.attendees || []).map((a) => {
                    const name = a.user?.name || a.client?.display_name || '—';
                    return (
                      <AttendeeRow key={a.id}>
                        <Avatar>{name[0]}</Avatar>
                        <AttendeeName>{name}</AttendeeName>
                        <ResponsePill $response={a.response}>{t(`response.${a.response}`)}</ResponsePill>
                      </AttendeeRow>
                    );
                  })}
                </AttendeeList>
              )}
            </SectionBody>
          </Section>

          <Section>
            <SectionIcon>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
              </svg>
            </SectionIcon>
            <SectionBody>
              <MutedSmall>{t('drawer.createdBy')}</MutedSmall>
              <Plain>{event.creator?.name || '—'}</Plain>
            </SectionBody>
          </Section>

          <Section>
            <SectionIcon>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
              </svg>
            </SectionIcon>
            <SectionBody>
              <MutedSmall>{t('form.category')}</MutedSmall>
              <CategoryRow>
                {CATEGORY_OPTIONS.map((cat: EventCategory) => (
                  <CategoryBtn
                    key={cat}
                    $active={event.category === cat}
                    onClick={() => { if (event.category !== cat) onUpdate({ category: cat }); }}
                  >
                    {t(`category.${cat}`)}
                  </CategoryBtn>
                ))}
              </CategoryRow>
            </SectionBody>
          </Section>
      </DetailDrawer.Body>

      <DetailDrawer.Footer>
        {confirmDelete ? (
          <ConfirmGroup>
            <ConfirmText>{t('button.deleteConfirm')}</ConfirmText>
            <SecondaryBtn onClick={() => setConfirmDelete(false)}>{t('button.cancel')}</SecondaryBtn>
            <DangerBtn onClick={() => { onDelete(); setConfirmDelete(false); }}>
              {t('button.delete')}
            </DangerBtn>
          </ConfirmGroup>
        ) : (
          <DangerBtn onClick={() => setConfirmDelete(true)}>
            {t('button.delete')}
          </DangerBtn>
        )}
      </DetailDrawer.Footer>
    </DetailDrawer>
  );
};

export default EventDrawer;

// ── styled ──
const HeaderInner = styled.div`
  display: flex; align-items: flex-start; gap: 10px; flex: 1; min-width: 0;
`;
const ColorBar = styled.div<{ $color: string }>`
  width: 4px; align-self: stretch; border-radius: 2px; min-height: 44px;
  background: ${({ $color }) => $color}; flex-shrink: 0;
`;
const HeaderTexts = styled.div` flex: 1; min-width: 0; `;
const TitleInput = styled.input`
  width: 100%; border: none; outline: none; background: transparent;
  font-size: 18px; font-weight: 700; color: #0F172A; letter-spacing: -0.2px;
  padding: 0 0 6px; line-height: 1.25;
`;
const MetaRow = styled.div`
  display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px;
`;
const CategoryPill = styled.span<{ $bg: string; $fg: string }>`
  display: inline-flex; align-items: center; padding: 3px 8px; border-radius: 999px;
  font-size: 11px; font-weight: 600;
  background: ${({ $bg }) => $bg}; color: ${({ $fg }) => $fg};
`;
const ProjectChip = styled.span`
  display: inline-flex; align-items: center; gap: 5px; padding: 3px 8px; border-radius: 999px;
  font-size: 11px; font-weight: 500; background: #F1F5F9; color: #334155;
`;
const ProjectDot = styled.span<{ $color: string }>`
  width: 7px; height: 7px; border-radius: 50%; background: ${({ $color }) => $color};
`;
const VisibilityTag = styled.span`
  font-size: 11px; color: #94A3B8; padding: 3px 0;
`;
const RecurrenceBadge = styled.span`
  display: inline-flex; align-items: center; gap: 4px;
  padding: 3px 8px; border-radius: 999px;
  font-size: 11px; font-weight: 600;
  background: #F5F3FF; color: #6D28D9;
`;
const Section = styled.div` display: flex; gap: 12px; `;
const SectionIcon = styled.div`
  width: 20px; color: #94A3B8; flex-shrink: 0; padding-top: 2px;
`;
const SectionBody = styled.div` flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; `;
const DateLine = styled.div`
  font-size: 13px; font-weight: 500; color: #0F172A; font-variant-numeric: tabular-nums;
`;
const MutedSmall = styled.div`
  font-size: 11px; font-weight: 500; color: #94A3B8; text-transform: uppercase; letter-spacing: 0.4px;
`;
const Plain = styled.div` font-size: 13px; color: #334155; `;
const Description = styled.div`
  font-size: 13px; color: #334155; line-height: 1.55; white-space: pre-wrap;
`;
const MeetingActions = styled.div` display: flex; gap: 6px; margin-top: 4px; flex-wrap: wrap; `;
const MeetingEmbed = styled.div`
  margin-top: 10px;
  width: 100%; aspect-ratio: 16/10; border-radius: 10px; overflow: hidden;
  background: #0F172A; border: 1px solid #E2E8F0;
  iframe { width: 100%; height: 100%; border: 0; }
`;
const CreateRoomBtn = styled.button`
  margin-top: 4px;
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 14px; border-radius: 7px; font-size: 12.5px; font-weight: 600;
  background: #14B8A6; color: #fff; border: none; cursor: pointer;
  &:hover:not(:disabled) { background: #0F766E; }
  &:disabled { background: #CBD5E1; cursor: not-allowed; }
`;
const JoinBtn = styled.a`
  display: inline-flex; align-items: center; padding: 7px 12px; border-radius: 6px;
  background: #14B8A6; color: #fff; font-size: 12px; font-weight: 600;
  text-decoration: none;
  &:hover { background: #0F766E; }
`;
const CopyBtn = styled.button`
  display: inline-flex; align-items: center; padding: 7px 12px; border-radius: 6px;
  background: transparent; color: #475569; font-size: 12px; font-weight: 500;
  border: 1px solid #CBD5E1; cursor: pointer;
  &:hover { background: #F8FAFC; color: #0F172A; }
`;
const AttendeeList = styled.div` display: flex; flex-direction: column; gap: 6px; margin-top: 2px; `;
const AttendeeRow = styled.div` display: flex; align-items: center; gap: 8px; `;
const Avatar = styled.div`
  width: 24px; height: 24px; border-radius: 50%; background: #E2E8F0;
  color: #475569; font-size: 11px; font-weight: 600;
  display: flex; align-items: center; justify-content: center;
`;
const AttendeeName = styled.div` font-size: 13px; color: #0F172A; flex: 1; `;
const ResponsePill = styled.span<{ $response: string }>`
  font-size: 10.5px; font-weight: 600; padding: 2px 7px; border-radius: 999px;
  background: ${({ $response }) => ({
    accepted: '#DCFCE7', declined: '#FEE2E2', tentative: '#FEF3C7', pending: '#F1F5F9',
  }[$response] || '#F1F5F9')};
  color: ${({ $response }) => ({
    accepted: '#15803D', declined: '#B91C1C', tentative: '#A16207', pending: '#64748B',
  }[$response] || '#64748B')};
`;
const CategoryRow = styled.div` display: flex; flex-wrap: wrap; gap: 5px; margin-top: 4px; `;
const CategoryBtn = styled.button<{ $active: boolean }>`
  padding: 5px 10px; border-radius: 999px; font-size: 11.5px; font-weight: 500;
  background: ${({ $active }) => $active ? '#0F172A' : '#F1F5F9'};
  color: ${({ $active }) => $active ? '#fff' : '#475569'};
  border: none; cursor: pointer;
  &:hover { background: ${({ $active }) => $active ? '#0F172A' : '#E2E8F0'}; }
`;
const DangerBtn = styled.button`
  padding: 7px 14px; border-radius: 6px; font-size: 12px; font-weight: 500;
  background: transparent; color: #B91C1C; border: 1px solid #FECACA; cursor: pointer;
  &:hover { background: #FEF2F2; }
`;
const SecondaryBtn = styled.button`
  padding: 7px 14px; border-radius: 6px; font-size: 12px; font-weight: 500;
  background: transparent; color: #475569; border: 1px solid #CBD5E1; cursor: pointer;
  &:hover { background: #F8FAFC; color: #0F172A; }
`;
const ConfirmGroup = styled.div` display: flex; align-items: center; gap: 8px; `;
const ConfirmText = styled.div`
  font-size: 12px; color: #64748B; margin-right: 4px;
`;

// NOTE: isoToLocalInput is exported from dateUtils — currently unused in this view
export { isoToLocalInput };
