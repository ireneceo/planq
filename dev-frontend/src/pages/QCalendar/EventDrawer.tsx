import React, { useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import type { CalendarEvent, EventCategory, EventVisibility } from './types';
import { CATEGORY_OPTIONS, getEventColors } from './categoryColors';
import { toDateKey, formatTime } from './dateUtils';
import DetailDrawer from '../../components/Common/DetailDrawer';
import ShareModal from '../../components/Common/ShareModal';
import AutoSaveField from '../../components/Common/AutoSaveField';
import PlanQSelect from '../../components/Common/PlanQSelect';
import CalendarPicker from '../../components/Common/CalendarPicker';
import RecurrencePicker from '../../components/Common/RecurrencePicker';
import { formatRRuleLabel } from '../../utils/recurrence';

// 30분 스텝 시간 옵션 — NewEventModal 과 동일 패턴
const TIME_OPTIONS = (() => {
  const arr: Array<{ value: string; label: string }> = [];
  for (let h = 0; h < 24; h += 1) {
    for (const m of [0, 30]) {
      const hh = String(h).padStart(2, '0');
      const mm = String(m).padStart(2, '0');
      arr.push({ value: `${hh}:${mm}`, label: `${hh}:${mm}` });
    }
  }
  return arr;
})();

interface ProjectOption {
  id: number;
  name: string;
  color?: string | null;
}

interface Props {
  event: CalendarEvent | null;
  projects?: ProjectOption[];
  myUserId?: number | null;
  myBusinessRole?: string | null;
  onClose: () => void;
  onUpdate: (patch: Partial<CalendarEvent>) => Promise<void> | void;
  onDelete: () => void;
  onCreateMeetingRoom?: () => Promise<void>;
  // 사이클 N+13: Daily.co → Google Meet 교체. 워크스페이스의 Google Calendar 연동 여부
  gcalConnected?: boolean;
}

// 시간 + 날짜 → ISO 변환 (로컬 타임존 기준, NewEventModal 의 mkISO 동일 패턴)
const mkISO = (dateStr: string, timeStr: string, allDay: boolean, isEnd: boolean): string => {
  const [y, mo, d] = dateStr.split('-').map(Number);
  if (allDay) {
    return new Date(y, mo - 1, d, isEnd ? 23 : 0, isEnd ? 59 : 0, 0).toISOString();
  }
  const [hh, mm] = timeStr.split(':').map(Number);
  return new Date(y, mo - 1, d, hh, mm, 0).toISOString();
};

const EventDrawer: React.FC<Props> = ({
  event, projects = [], myUserId, myBusinessRole,
  onClose, onUpdate, onDelete, onCreateMeetingRoom, gcalConnected,
}) => {
  const { t, i18n } = useTranslation('qcalendar');
  // formatRRuleLabel 은 qtask 네임스페이스의 recur.* 키를 사용
  const { t: tQtask } = useTranslation('qtask');
  const [copied, setCopied] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [creatingRoom, setCreatingRoom] = useState(false);
  const [reissuingMeeting, setReissuingMeeting] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const dateTriggerRef = useRef<HTMLButtonElement>(null);

  // 편집 권한: 작성자 또는 owner (백엔드 PUT 라우트와 일치)
  const canEdit = !!event && (event.created_by === myUserId || myBusinessRole === 'owner');

  // local controlled state — props 변경 시 sync. 자동저장 도중 server 응답 덮어쓰기로 인한
  // 입력 깜빡임 방지를 위해 event.id 가 바뀔 때 + 핵심 필드 명시적 변경 시에만 reset.
  const [title, setTitle] = useState(event?.title || '');
  const [description, setDescription] = useState(event?.description || '');
  const [location, setLocation] = useState(event?.location || '');
  const [startDate, setStartDate] = useState<string>(() => event ? toDateKey(new Date(event.start_at)) : '');
  const [endDate, setEndDate] = useState<string>(() => event ? toDateKey(new Date(event.end_at)) : '');
  const [startTime, setStartTime] = useState<string>(() => event ? formatTime(new Date(event.start_at)) : '00:00');
  const [endTime, setEndTime] = useState<string>(() => event ? formatTime(new Date(event.end_at)) : '23:30');

  useEffect(() => {
    if (!event) return;
    setTitle(event.title);
    setDescription(event.description || '');
    setLocation(event.location || '');
    setStartDate(toDateKey(new Date(event.start_at)));
    setEndDate(toDateKey(new Date(event.end_at)));
    setStartTime(formatTime(new Date(event.start_at)));
    setEndTime(formatTime(new Date(event.end_at)));
  }, [event?.id, event?.start_at, event?.end_at, event?.title, event?.description, event?.location]);

  const handleCreateRoom = async () => {
    if (!onCreateMeetingRoom) return;
    setCreatingRoom(true);
    try { await onCreateMeetingRoom(); } finally { setCreatingRoom(false); }
  };

  // P1 — Meet 링크 재발급. POST /:id/meeting 다시 호출 (rrule 정합은 백엔드 fix 가 처리).
  // 옛 링크 만료 / 정기 회의 다음 회차 "회의 없음" 회귀 사용자 self-fix 경로.
  const handleReissueMeeting = async () => {
    if (!onCreateMeetingRoom) return;
    setReissuingMeeting(true);
    try { await onCreateMeetingRoom(); } finally { setReissuingMeeting(false); }
  };

  if (!event) return null;
  const c = getEventColors(event);
  const start = new Date(event.start_at);
  const end = new Date(event.end_at);

  const copyMeetingLink = async () => {
    if (!event.meeting_url) return;
    try { await navigator.clipboard.writeText(event.meeting_url); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {}
  };

  const dateLabel = useMemo(() => {
    const locale = i18n.language === 'en' ? 'en-US' : 'ko-KR';
    const s = new Date(`${startDate}T00:00:00`);
    const e = new Date(`${endDate}T00:00:00`);
    const fmt = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', weekday: 'short', year: 'numeric' });
    if (startDate === endDate) return fmt.format(s);
    return `${fmt.format(s)} ~ ${fmt.format(e)}`;
  }, [startDate, endDate, i18n.language]);

  // 시간/날짜 저장 (4 필드 묶음) — debounce 300ms (select)
  const saveSchedule = async (sd: string, ed: string, st: string, et: string, allDay: boolean) => {
    const sISO = mkISO(sd, st, allDay, false);
    const eISO = mkISO(ed, et, allDay, true);
    if (new Date(eISO) < new Date(sISO)) return;
    await onUpdate({ start_at: sISO, end_at: eISO, all_day: allDay });
  };

  return (
    <DetailDrawer open={!!event} onClose={onClose} width={480} ariaLabel={event.title}>
      <DetailDrawer.Header onClose={onClose}>
        <HeaderInner>
          <ColorBar $color={c.fg} />
          <HeaderTexts>
            {canEdit ? (
              <AutoSaveField type="input" onSave={async () => {
                const v = title.trim();
                if (v && v !== event.title) await onUpdate({ title: v });
              }}>
                <TitleInput
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                />
              </AutoSaveField>
            ) : (
              <TitleReadOnly>{event.title}</TitleReadOnly>
            )}
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
                  {formatRRuleLabel(event.rrule, event.start_at?.slice(0, 10), tQtask as unknown as Parameters<typeof formatRRuleLabel>[2], { short: true })}
                </RecurrenceBadge>
              )}
              {!canEdit && (
                <ReadOnlyHint title={t('drawer.readOnlyHint', '편집은 작성자 또는 관리자만 가능합니다') as string}>
                  {t('drawer.readOnly', '읽기 전용')}
                </ReadOnlyHint>
              )}
            </MetaRow>
          </HeaderTexts>
        </HeaderInner>
      </DetailDrawer.Header>

      <DetailDrawer.Body>
        {/* 시간 — 인라인 편집 */}
        <Section>
          <SectionIcon>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
            </svg>
          </SectionIcon>
          <SectionBody>
            <MutedSmall>{t('drawer.schedule', '일정')}</MutedSmall>
            {canEdit ? (
              <ScheduleEditor>
                <DateRow>
                  <DateTrigger
                    ref={dateTriggerRef}
                    type="button"
                    onClick={() => setDatePickerOpen((x) => !x)}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="4" width="18" height="18" rx="2" />
                      <line x1="16" y1="2" x2="16" y2="6" />
                      <line x1="8" y1="2" x2="8" y2="6" />
                      <line x1="3" y1="10" x2="21" y2="10" />
                    </svg>
                    <span>{dateLabel}</span>
                  </DateTrigger>
                  {!event.all_day && (
                    <TimePair>
                      <AutoSaveField type="select" onSave={async () => {
                        await saveSchedule(startDate, endDate, startTime, endTime, false);
                      }}>
                        <TimeWrap>
                          <PlanQSelect
                            size="sm"
                            density="compact"
                            options={TIME_OPTIONS}
                            value={{ value: startTime, label: startTime }}
                            onChange={(opt) => opt && setStartTime((opt as { value: string }).value)}
                          />
                        </TimeWrap>
                      </AutoSaveField>
                      <Dash>–</Dash>
                      <AutoSaveField type="select" onSave={async () => {
                        await saveSchedule(startDate, endDate, startTime, endTime, false);
                      }}>
                        <TimeWrap>
                          <PlanQSelect
                            size="sm"
                            density="compact"
                            options={TIME_OPTIONS}
                            value={{ value: endTime, label: endTime }}
                            onChange={(opt) => opt && setEndTime((opt as { value: string }).value)}
                          />
                        </TimeWrap>
                      </AutoSaveField>
                    </TimePair>
                  )}
                </DateRow>
                <CalendarPicker
                  isOpen={datePickerOpen}
                  startDate={startDate}
                  endDate={endDate}
                  anchorRef={dateTriggerRef}
                  onClose={() => setDatePickerOpen(false)}
                  onRangeSelect={(s, e) => {
                    const sd = s;
                    const ed = e || s;
                    setStartDate(sd);
                    setEndDate(ed);
                    // 날짜는 select 패턴 — 즉시 저장
                    saveSchedule(sd, ed, startTime, endTime, event.all_day);
                  }}
                />
                <AllDayRow>
                  <AutoSaveField type="toggle" onSave={async () => {
                    await saveSchedule(startDate, endDate, startTime, endTime, !event.all_day);
                  }}>
                    <CheckboxLabel>
                      <input
                        type="checkbox"
                        checked={event.all_day}
                        onChange={() => { /* AutoSaveField 가 onSave 호출 — saveSchedule 안에서 ENV 토글 */ }}
                      />
                      <span>{t('form.allDay', '종일')}</span>
                    </CheckboxLabel>
                  </AutoSaveField>
                </AllDayRow>
              </ScheduleEditor>
            ) : (
              <>
                <DateLine>{formatDateTimeReadOnly(start, i18n.language)}</DateLine>
                <DateLine>→ {formatDateTimeReadOnly(end, i18n.language)}</DateLine>
                {event.all_day && <MutedSmall>{t('allDay', '종일')}</MutedSmall>}
              </>
            )}
          </SectionBody>
        </Section>

        {/* 카테고리 / visibility / project — 인라인 select */}
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
                  type="button"
                  $active={event.category === cat}
                  disabled={!canEdit}
                  onClick={() => { if (canEdit && event.category !== cat) onUpdate({ category: cat }); }}
                >
                  {t(`category.${cat}`)}
                </CategoryBtn>
              ))}
            </CategoryRow>
            {canEdit && (
              <Grid2>
                <Field>
                  <FieldLabel>{t('form.visibility', '공개 범위')}</FieldLabel>
                  <AutoSaveField type="select" onSave={async () => { /* PlanQSelect onChange 가 직접 호출 — 아래 */ }}>
                    <PlanQSelect
                      size="sm"
                      options={[
                        { value: 'business', label: t('visibility.business') },
                        { value: 'personal', label: t('visibility.personal') },
                      ]}
                      value={{ value: event.visibility, label: t(`visibility.${event.visibility}`) }}
                      onChange={(opt) => {
                        const v = (opt as { value?: EventVisibility } | null)?.value;
                        if (v && v !== event.visibility) onUpdate({ visibility: v });
                      }}
                    />
                  </AutoSaveField>
                </Field>
                <Field>
                  <FieldLabel>{t('form.project')}</FieldLabel>
                  <AutoSaveField type="select" onSave={async () => { /* onChange 직접 호출 */ }}>
                    <PlanQSelect
                      size="sm"
                      isClearable
                      placeholder={t('form.projectNone', '연결 없음') as string}
                      options={projects.map((p) => ({ value: p.id, label: p.name }))}
                      value={event.project_id == null
                        ? null
                        : { value: event.project_id, label: projects.find((p) => p.id === event.project_id)?.name || `#${event.project_id}` }
                      }
                      onChange={(opt) => {
                        const v = opt ? Number((opt as { value: number }).value) : null;
                        if (v !== event.project_id) onUpdate({ project_id: v });
                      }}
                    />
                  </AutoSaveField>
                </Field>
              </Grid2>
            )}
          </SectionBody>
        </Section>

        {/* 정기 일정 — RecurrencePicker */}
        <Section>
          <SectionIcon>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
          </SectionIcon>
          <SectionBody>
            <MutedSmall>{t('recurrence.label', '정기 일정')}</MutedSmall>
            {canEdit ? (
              <RecurrencePicker
                value={event.rrule}
                onChange={(rrule) => {
                  if (rrule !== event.rrule) onUpdate({ rrule });
                }}
                anchorDate={startDate}
              />
            ) : (
              <Plain>
                {event.rrule
                  ? formatRRuleLabel(event.rrule, event.start_at?.slice(0, 10), tQtask as unknown as Parameters<typeof formatRRuleLabel>[2])
                  : t('recurrence.none', '반복 없음')}
              </Plain>
            )}
          </SectionBody>
        </Section>

        {/* 위치 */}
        <Section>
          <SectionIcon>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" />
            </svg>
          </SectionIcon>
          <SectionBody>
            <MutedSmall>{t('form.location', '위치')}</MutedSmall>
            {canEdit ? (
              <AutoSaveField type="input" onSave={async () => {
                const v = location.trim();
                if ((v || null) !== (event.location || null)) await onUpdate({ location: v || null });
              }}>
                <Input
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder={t('form.locationPlaceholder', '회의실, 주소 등') as string}
                />
              </AutoSaveField>
            ) : (
              <Plain>{event.location || <Muted>{t('drawer.noLocation', '위치 없음')}</Muted>}</Plain>
            )}
          </SectionBody>
        </Section>

        {/* 회의 — 재발급 버튼 포함 (P1) */}
        {(event.meeting_url || (gcalConnected && onCreateMeetingRoom)) && (
          <Section>
            <SectionIcon>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" />
              </svg>
            </SectionIcon>
            <SectionBody>
              <MutedSmall>{t('drawer.meeting')}</MutedSmall>
              {event.meeting_url ? (
                <>
                  <MeetingActions>
                    {/* Google Meet 는 X-Frame-Options 로 iframe embed 불가 — 외부 링크만 */}
                    <CopyBtn as="a" href={event.meeting_url} target="_blank" rel="noreferrer">
                      {t('drawer.joinMeeting')} ↗
                    </CopyBtn>
                    <CopyBtn type="button" onClick={copyMeetingLink}>
                      {copied ? t('drawer.linkCopied') : t('drawer.copyLink')}
                    </CopyBtn>
                    {/* P1 — 재발급 (만료된 옛 링크 / 정기 회의 다음 회차 회복) */}
                    {canEdit && gcalConnected && (
                      <ReissueBtn type="button" onClick={handleReissueMeeting} disabled={reissuingMeeting}>
                        {reissuingMeeting ? t('drawer.reissuing', '재발급 중...') : t('drawer.reissueMeeting', '링크 재발급')}
                      </ReissueBtn>
                    )}
                  </MeetingActions>
                  {canEdit && (
                    <MeetingHint>{t('drawer.reissueHint', '만료된 링크는 재발급으로 복구하세요. 정기 회의는 모든 회차에 동일 링크가 유효해야 합니다.')}</MeetingHint>
                  )}
                </>
              ) : (
                canEdit && gcalConnected && onCreateMeetingRoom && (
                  <CreateRoomBtn onClick={handleCreateRoom} disabled={creatingRoom}>
                    {creatingRoom ? t('drawer.creating') : t('drawer.createRoom')}
                  </CreateRoomBtn>
                )
              )}
            </SectionBody>
          </Section>
        )}

        {/* 설명 */}
        <Section>
          <SectionIcon>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="21" y1="6" x2="3" y2="6" /><line x1="21" y1="12" x2="3" y2="12" /><line x1="21" y1="18" x2="3" y2="18" />
            </svg>
          </SectionIcon>
          <SectionBody>
            <MutedSmall>{t('form.description', '설명')}</MutedSmall>
            {canEdit ? (
              <AutoSaveField type="input" onSave={async () => {
                const v = description.trim();
                if ((v || null) !== (event.description || null)) await onUpdate({ description: v || null });
              }}>
                <Textarea
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t('form.descriptionPlaceholder', '회의 내용, 안건, 참고 사항...') as string}
                />
              </AutoSaveField>
            ) : (
              <Description>{event.description || <Muted>{t('drawer.noDescription', '설명 없음')}</Muted>}</Description>
            )}
          </SectionBody>
        </Section>

        {/* 참석자 — read-only (다음 청크에서 인라인 편집) */}
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
              <Muted>{t('drawer.noAttendees')}</Muted>
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

        {/* 작성자 — read-only */}
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
      </DetailDrawer.Body>

      <DetailDrawer.Footer>
        {confirmDelete ? (
          <ConfirmGroup>
            <ConfirmText>{t('button.deleteConfirm')}</ConfirmText>
            <SecondaryBtn type="button" onClick={() => setConfirmDelete(false)}>{t('button.cancel')}</SecondaryBtn>
            <DangerBtn type="button" onClick={() => { onDelete(); setConfirmDelete(false); }}>
              {t('button.delete')}
            </DangerBtn>
          </ConfirmGroup>
        ) : (
          <FooterRow>
            <ShareBtn type="button" onClick={() => setShareOpen(true)} title={t('button.share', { defaultValue: '공유' }) as string}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="18" cy="5" r="3" />
                <circle cx="6" cy="12" r="3" />
                <circle cx="18" cy="19" r="3" />
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
              </svg>
              {t('button.share', { defaultValue: '공유' }) as string}
            </ShareBtn>
            {canEdit && (
              <DangerBtn type="button" onClick={() => setConfirmDelete(true)}>
                {t('button.delete')}
              </DangerBtn>
            )}
          </FooterRow>
        )}
      </DetailDrawer.Footer>
      {shareOpen && (
        <ShareModal
          open={shareOpen}
          entityType="calendar_event"
          entityId={Number(event.id)}
          entityTitle={event.title}
          onClose={() => setShareOpen(false)}
        />
      )}
    </DetailDrawer>
  );
};

// ─── read-only 일 때 시간 표시 헬퍼 ───
function formatDateTimeReadOnly(d: Date, lang: string): string {
  const locale = lang === 'en' ? 'en-US' : 'ko-KR';
  const dateFmt = new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric', weekday: 'short' });
  return `${dateFmt.format(d)} ${formatTime(d)}`;
}

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
  border-bottom: 1px solid transparent;
  &:focus { border-bottom-color: #14B8A6; }
`;
const TitleReadOnly = styled.div`
  font-size: 18px; font-weight: 700; color: #0F172A; letter-spacing: -0.2px;
  padding: 0 0 6px; line-height: 1.25;
`;
const MetaRow = styled.div`
  display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; align-items: center;
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
const ReadOnlyHint = styled.span`
  font-size: 11px; font-weight: 500;
  color: #94A3B8; background: #F1F5F9;
  border-radius: 10px; padding: 2px 8px;
`;

const Section = styled.div` display: flex; gap: 12px; `;
const SectionIcon = styled.div`
  width: 20px; color: #94A3B8; flex-shrink: 0; padding-top: 2px;
`;
const SectionBody = styled.div` flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; `;
const DateLine = styled.div`
  font-size: 13px; font-weight: 500; color: #0F172A; font-variant-numeric: tabular-nums;
`;
const MutedSmall = styled.div`
  font-size: 11px; font-weight: 500; color: #94A3B8; text-transform: uppercase; letter-spacing: 0.4px;
`;
const Plain = styled.div` font-size: 13px; color: #334155; `;
const Muted = styled.span` font-size: 12px; color: #94A3B8; font-style: italic; `;
const Description = styled.div`
  font-size: 13px; color: #334155; line-height: 1.55; white-space: pre-wrap;
`;

// 시간 편집
const ScheduleEditor = styled.div` display: flex; flex-direction: column; gap: 8px; position: relative; `;
const DateRow = styled.div` display: flex; align-items: center; gap: 8px; flex-wrap: wrap; `;
const DateTrigger = styled.button`
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 10px; border: 1px solid #CBD5E1; border-radius: 7px;
  background: #fff; color: #0F172A; font-size: 12.5px; font-weight: 500; cursor: pointer;
  svg { color: #64748B; flex-shrink: 0; }
  &:hover { border-color: #14B8A6; }
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20, 184, 166, 0.12); }
`;
const TimePair = styled.div` display: inline-flex; align-items: center; gap: 6px; `;
const TimeWrap = styled.div` width: 100px; `;
const Dash = styled.span` color: #94A3B8; font-size: 12px; `;
const AllDayRow = styled.div` display: flex; `;
const CheckboxLabel = styled.label`
  display: inline-flex; align-items: center; gap: 6px; cursor: pointer;
  font-size: 12.5px; color: #475569;
  input { accent-color: #14B8A6; cursor: pointer; width: 14px; height: 14px; }
`;

// 카테고리 / project / visibility
const Grid2 = styled.div` display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 4px; `;
const Field = styled.div` display: flex; flex-direction: column; gap: 4px; min-width: 0; `;
const FieldLabel = styled.label`
  font-size: 10.5px; font-weight: 500; color: #94A3B8;
  text-transform: uppercase; letter-spacing: 0.3px;
`;
const CategoryRow = styled.div` display: flex; flex-wrap: wrap; gap: 5px; `;
const CategoryBtn = styled.button<{ $active: boolean }>`
  padding: 5px 10px; border-radius: 999px; font-size: 11.5px; font-weight: 500;
  background: ${({ $active }) => $active ? '#0F172A' : '#F1F5F9'};
  color: ${({ $active }) => $active ? '#fff' : '#475569'};
  border: none; cursor: pointer;
  &:hover:not(:disabled) { background: ${({ $active }) => $active ? '#0F172A' : '#E2E8F0'}; }
  &:disabled { cursor: default; opacity: 0.6; }
`;

// input/textarea
const Input = styled.input`
  padding: 8px 11px; border: 1px solid #CBD5E1; border-radius: 7px;
  font-size: 13px; color: #0F172A; outline: none; background: #fff;
  &:focus { border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20, 184, 166, 0.12); }
`;
const Textarea = styled.textarea`
  padding: 8px 11px; border: 1px solid #CBD5E1; border-radius: 7px;
  font-size: 13px; color: #0F172A; outline: none; resize: vertical;
  font-family: inherit; line-height: 1.5;
  &:focus { border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20, 184, 166, 0.12); }
`;

// meeting
const MeetingActions = styled.div` display: flex; gap: 6px; flex-wrap: wrap; `;
const MeetingHint = styled.div`
  font-size: 11px; color: #94A3B8; line-height: 1.45; margin-top: 4px;
`;
const CreateRoomBtn = styled.button`
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 14px; border-radius: 7px; font-size: 12.5px; font-weight: 600;
  background: #14B8A6; color: #fff; border: none; cursor: pointer;
  &:hover:not(:disabled) { background: #0F766E; }
  &:disabled { background: #CBD5E1; cursor: not-allowed; }
`;
const ReissueBtn = styled.button`
  display: inline-flex; align-items: center;
  padding: 7px 12px; border-radius: 6px; font-size: 12px; font-weight: 500;
  background: #FFFBEB; color: #92400E; border: 1px solid #FDE68A; cursor: pointer;
  &:hover:not(:disabled) { background: #FEF3C7; }
  &:disabled { opacity: 0.6; cursor: not-allowed; }
`;
const CopyBtn = styled.button`
  display: inline-flex; align-items: center; padding: 7px 12px; border-radius: 6px;
  background: transparent; color: #475569; font-size: 12px; font-weight: 500;
  border: 1px solid #CBD5E1; cursor: pointer; text-decoration: none;
  &:hover { background: #F8FAFC; color: #0F172A; }
`;

// attendees (read-only)
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

// footer
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
const ConfirmText = styled.div` font-size: 12px; color: #64748B; margin-right: 4px; `;
const FooterRow = styled.div`
  display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%;
`;
const ShareBtn = styled.button`
  padding: 7px 12px; border-radius: 6px; font-size: 12px; font-weight: 500;
  background: transparent; color: #475569; border: 1px solid #CBD5E1; cursor: pointer;
  display: inline-flex; align-items: center; gap: 6px;
  &:hover { background: #F0FDFA; color: #0F766E; border-color: #99F6E4; }
`;
