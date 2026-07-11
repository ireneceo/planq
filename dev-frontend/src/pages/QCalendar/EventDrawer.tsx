import React, { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import type { CalendarEvent, EventCategory } from './types';
import VisibilityField, { serializeVisibility, parseVisibility, type VisibilityValue } from '../../components/Common/VisibilityField';
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

interface MemberOption { user_id: number; name: string; role?: string }
interface ClientOption { id: number; display_name?: string | null; company_name?: string | null; biz_name?: string | null; }

interface Props {
  event: CalendarEvent | null;
  // N+63 P2a 후속 — 사용자가 클릭한 instance 의 date (YYYY-MM-DD). master 의 경우 modal single 선택 시 정확한 회차 식별.
  // 없으면 master.start_at 의 date (첫 회차 fallback).
  instanceDate?: string | null;
  projects?: ProjectOption[];
  members?: MemberOption[];
  clients?: ClientOption[];
  myUserId?: number | null;
  myBusinessRole?: string | null;
  onClose: () => void;
  // N+63 P2a — options 로 scope/recurrence_id 전달. 정기 master 시 modal 거치고 parent 가 services 호출
  onUpdate: (patch: Partial<CalendarEvent>, options?: { scope?: 'single' | 'future' | 'all'; recurrence_id?: string }) => Promise<void> | void;
  onDelete: (options?: { scope?: 'single' | 'future' | 'all'; recurrence_id?: string }) => void;
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
  event, instanceDate, projects = [], members = [], clients = [], myUserId, myBusinessRole,
  onClose, onUpdate, onDelete, onCreateMeetingRoom, gcalConnected,
}) => {
  const { t, i18n } = useTranslation('qcalendar');
  const { user } = useAuth();
  // 운영 #41 — 워크스페이스 tz 기본 + 개인 tz 보조표시
  const wsTz = user?.workspace_timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const personalTz = user?.timezone || null;
  const showPersonalTz = !!personalTz && personalTz !== wsTz;
  // formatRRuleLabel 은 qtask 네임스페이스의 recur.* 키를 사용
  const { t: tQtask } = useTranslation('qtask');
  const [copied, setCopied] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [creatingRoom, setCreatingRoom] = useState(false);
  const [reissuingMeeting, setReissuingMeeting] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const dateTriggerRef = useRef<HTMLButtonElement>(null);
  // N+63 P2a — 정기 master 시간 변경 modal (single/future/all 분기)
  const [scopeModalOpen, setScopeModalOpen] = useState(false);
  const [pendingPatch, setPendingPatch] = useState<Partial<CalendarEvent> | null>(null);

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

  // #135 — 링크만 복사하면 붙여넣은 쪽에서 무슨 회의인지 알 수 없다. 제목 · 일시 · 링크를 함께 복사.
  const copyMeetingLink = async () => {
    if (!event.meeting_url) return;
    const locale = i18n.language === 'en' ? 'en-US' : 'ko-KR';
    const dayFmt = new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric', weekday: 'short' });
    const timeFmt = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' });
    const when = event.all_day
      ? dayFmt.format(start)
      : `${dayFmt.format(start)} ${timeFmt.format(start)}–${timeFmt.format(end)}`;
    const text = [event.title, when, event.meeting_url].filter(Boolean).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* 클립보드 거부 — 링크는 화면에 그대로 노출돼 있어 수동 복사 가능 */ }
  };

  // #119 — 시작/마감 각 날짜를 단독 포맷 (시간과 같은 줄에 붙여 표시). 연도 생략(컴팩트).
  const fmtDay = (dstr: string) => {
    if (!dstr) return '';
    const locale = i18n.language === 'en' ? 'en-US' : 'ko-KR';
    return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', weekday: 'short' }).format(new Date(`${dstr}T00:00:00`));
  };

  // 시간/날짜 저장 (4 필드 묶음) — debounce 300ms (select)
  // N+63 P2a — master event (rrule != null, recurrence_parent_id null) 의 instance-affecting 필드 변경 시 modal.
  //   instance-affecting (master 면 modal 분기): title/start_at/end_at/all_day/category/location/description/visibility/project_id/color
  //   instance-independent (master 라도 modal X — event 전체 속성): rrule/attendees/reminder_minutes
  const isMaster = !!event?.rrule && !event?.recurrence_parent_id;
  const updateMaybeScoped = (patch: Partial<CalendarEvent>): void | Promise<void> => {
    if (isMaster) {
      setPendingPatch(patch);
      setScopeModalOpen(true);
      return;
    }
    return Promise.resolve(onUpdate(patch));
  };
  const saveSchedule = async (sd: string, ed: string, st: string, et: string, allDay: boolean) => {
    const sISO = mkISO(sd, st, allDay, false);
    const eISO = mkISO(ed, et, allDay, true);
    if (new Date(eISO) < new Date(sISO)) return;
    await updateMaybeScoped({ start_at: sISO, end_at: eISO, all_day: allDay });
  };
  // modal 에서 사용자가 scope 선택 후 적용
  const applyScopeUpdate = async (scope: 'single' | 'future' | 'all') => {
    if (!pendingPatch || !event) return;
    if (scope === 'all') {
      await onUpdate(pendingPatch);
    } else {
      // N+63 P2a 후속 — instance picker 적용. instanceDate prop 우선, fallback master start_at.
      const recurrenceId = instanceDate || toDateKey(new Date(event.start_at));
      await onUpdate(pendingPatch, { scope, recurrence_id: recurrenceId });
    }
    setPendingPatch(null);
    setScopeModalOpen(false);
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
                if (v && v !== event.title) await updateMaybeScoped({ title: v });
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
                {/* #119 — 시작/마감 각각 [날짜 + 시간] 한 줄로 묶어 표시 (시간이 자기 날짜에 붙음). */}
                <DateTimeRow>
                  <RowLabel>{t('drawer.startLabel', '시작')}</RowLabel>
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
                    <span>{fmtDay(startDate)}</span>
                  </DateTrigger>
                  {!event.all_day && (
                    <AutoSaveField type="select" onSave={async () => {
                      await saveSchedule(startDate, endDate, startTime, endTime, false);
                    }}>
                      <TimeWrap>
                        <PlanQSelect
                          size="sm"
                          density="compact"
                          options={TIME_OPTIONS}
                          value={{ value: startTime, label: startTime }}
                          onChange={(opt) => {
                            if (!opt) return;
                            const v = (opt as { value: string }).value;
                            setStartTime(v);
                            // #123 — 종료시간 follow. Fable D-1 — 같은 날짜일 때만(멀티데이는 시각-only dur 왜곡).
                            if (startDate === endDate) {
                              const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
                              const dur = toMin(endTime) - toMin(startTime);
                              const newEnd = Math.min(toMin(v) + (dur > 0 ? dur : 60), 23 * 60 + 30);
                              setEndTime(`${String(Math.floor(newEnd / 60)).padStart(2, '0')}:${String(newEnd % 60).padStart(2, '0')}`);
                            }
                          }}
                        />
                      </TimeWrap>
                    </AutoSaveField>
                  )}
                </DateTimeRow>
                <DateTimeRow>
                  <RowLabel>{t('drawer.endLabel', '마감')}</RowLabel>
                  <DateTrigger
                    type="button"
                    onClick={() => setDatePickerOpen((x) => !x)}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="4" width="18" height="18" rx="2" />
                      <line x1="16" y1="2" x2="16" y2="6" />
                      <line x1="8" y1="2" x2="8" y2="6" />
                      <line x1="3" y1="10" x2="21" y2="10" />
                    </svg>
                    <span>{fmtDay(endDate)}</span>
                  </DateTrigger>
                  {!event.all_day && (
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
                  )}
                </DateTimeRow>
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
                <DateLine>{formatDateTimeInTz(start, i18n.language, wsTz)}</DateLine>
                <DateLine>→ {formatDateTimeInTz(end, i18n.language, wsTz)}</DateLine>
                {/* 운영 #41 — 기준 타임존(워크스페이스) 명시 */}
                <TzNote>{t('tz.workspaceBasis', { tz: tzAbbr(start, wsTz, i18n.language), defaultValue: '{{tz}} · 워크스페이스 기준' }) as string}</TzNote>
                {/* 개인 타임존이 다르면 보조 시간 표시 (같거나 미설정이면 숨김) */}
                {showPersonalTz && personalTz && (
                  <TzNote $alt>
                    {t('tz.yourTime', { defaultValue: '내 시간대' }) as string} ({tzAbbr(start, personalTz, i18n.language)}): {formatDateTimeInTz(start, i18n.language, personalTz)} → {formatDateTimeInTz(end, i18n.language, personalTz)}
                  </TzNote>
                )}
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
                  onClick={() => { if (canEdit && event.category !== cat) updateMaybeScoped({ category: cat }); }}
                >
                  {t(`category.${cat}`)}
                </CategoryBtn>
              ))}
            </CategoryRow>
            {canEdit && (
              <Grid2>
                <Field style={{ gridColumn: '1 / -1' }}>
                  <FieldLabel>{t('form.visibility', { defaultValue: '공개' }) as string}</FieldLabel>
                  {/* N+66 — 통합 VisibilityField (NewEventModal · KnowledgePage 정합). 옛 personal/business 2 select 폐지. */}
                  <VisibilityField
                    value={parseVisibility({
                      vlevel: event.vlevel ?? null,
                      scope: null,
                      read_policy: null,
                      project_id: event.project_id ?? null,
                      client_id: null,
                      client_ids: event.target_client_ids ?? null,
                      target_member_ids: event.target_member_ids ?? null,
                    })}
                    onChange={(v: VisibilityValue) => {
                      const ser = serializeVisibility(v);
                      const patch: Partial<CalendarEvent> = {
                        vlevel: v.vlevel,
                        target_member_ids: ser.target_member_ids,
                        target_client_ids: v.variant === 'L4' ? ser.client_ids : [],
                        // legacy backward-compat (hook 가 자동 동기지만 explicit)
                        visibility: v.vlevel === 'L1' ? 'personal' : 'business',
                      };
                      if (v.variant === 'L2_project') patch.project_id = ser.project_id;
                      updateMaybeScoped(patch);
                    }}
                    projects={(projects || []).map(p => ({ id: p.id, name: p.name }))}
                    clients={(clients || []).map(c => ({ id: c.id, display_name: c.display_name || c.company_name }))}
                    members={(members || []).map(m => ({ user_id: m.user_id, name: m.name, role: m.role || 'member' }))}
                  />
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
                        if (v !== event.project_id) updateMaybeScoped({ project_id: v });
                      }}
                    />
                  </AutoSaveField>
                </Field>
              </Grid2>
            )}
          </SectionBody>
        </Section>

        {/* N+63 — 임박 알림 (reminder_minutes). 5분/10분/15분/30분/1시간/1일 + 없음 */}
        <Section>
          <SectionIcon>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
          </SectionIcon>
          <SectionBody>
            <MutedSmall>{t('drawer.reminder', '임박 알림')}</MutedSmall>
            {canEdit ? (
              <AutoSaveField type="select" onSave={async () => { /* onChange 직접 호출 */ }}>
                <PlanQSelect
                  size="sm"
                  isClearable
                  placeholder={t('drawer.reminderNone', '알림 없음') as string}
                  options={[
                    { value: 5, label: t('drawer.reminderMin', { count: 5, defaultValue: '{{count}}분 전' }) as string },
                    { value: 10, label: t('drawer.reminderMin', { count: 10, defaultValue: '{{count}}분 전' }) as string },
                    { value: 15, label: t('drawer.reminderMin', { count: 15, defaultValue: '{{count}}분 전' }) as string },
                    { value: 30, label: t('drawer.reminderMin', { count: 30, defaultValue: '{{count}}분 전' }) as string },
                    { value: 60, label: t('drawer.reminderHour', { count: 1, defaultValue: '{{count}}시간 전' }) as string },
                    { value: 1440, label: t('drawer.reminderDay', { count: 1, defaultValue: '{{count}}일 전' }) as string },
                  ]}
                  value={(event as CalendarEvent & { reminder_minutes?: number | null }).reminder_minutes
                    ? { value: (event as CalendarEvent & { reminder_minutes?: number | null }).reminder_minutes!, label: '' }
                    : null}
                  onChange={(opt) => {
                    const v = opt ? Number((opt as { value: number }).value) : null;
                    const cur = (event as CalendarEvent & { reminder_minutes?: number | null }).reminder_minutes ?? null;
                    if (v !== cur) onUpdate({ reminder_minutes: v } as unknown as Partial<CalendarEvent>);
                  }}
                />
              </AutoSaveField>
            ) : (
              <Plain>
                {(event as CalendarEvent & { reminder_minutes?: number | null }).reminder_minutes
                  ? t('drawer.reminderMin', { count: (event as CalendarEvent & { reminder_minutes?: number }).reminder_minutes })
                  : t('drawer.reminderNone', '알림 없음')}
              </Plain>
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
                if ((v || null) !== (event.location || null)) await updateMaybeScoped({ location: v || null });
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
                  {/* N+63 사용자 호소 — 재발급 후 변화 확인 위해 URL 자체 노출.
                      location 자동 덮어쓰기는 사용자 입력 침범 → 별도 영역 (Google Calendar / Outlook 표준 패턴). */}
                  <MeetingUrl
                    href={event.meeting_url}
                    target="_blank"
                    rel="noreferrer"
                    title={event.meeting_url}
                  >
                    {event.meeting_url}
                  </MeetingUrl>
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
                if ((v || null) !== (event.description || null)) await updateMaybeScoped({ description: v || null });
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

        {/* 참석자 — 인라인 편집 (멤버 picker + 각 row 제거 버튼) */}
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
                      {canEdit && (
                        <AttendeeRemoveBtn
                          type="button"
                          title={t('drawer.removeAttendee', '제거') as string}
                          aria-label={t('drawer.removeAttendee', '제거') as string}
                          onClick={() => {
                            const next = (event.attendees || [])
                              .filter(x => x.id !== a.id)
                              .map(x => ({
                                user_id: x.user_id ?? undefined,
                                client_id: x.client_id ?? undefined,
                                response: x.response,
                              }));
                            onUpdate({ attendees: next as unknown as CalendarEvent['attendees'] });
                          }}
                        >×</AttendeeRemoveBtn>
                      )}
                    </AttendeeRow>
                  );
                })}
              </AttendeeList>
            )}
            {canEdit && (members.length > 0 || clients.length > 0) && (() => {
              const existingUserIds = new Set((event.attendees || []).map(a => a.user_id).filter(Boolean));
              const existingClientIds = new Set((event.attendees || []).map(a => a.client_id).filter(Boolean));
              const addableMembers = members.filter(m => !existingUserIds.has(m.user_id));
              const addableClients = clients.filter(c => !existingClientIds.has(c.id));
              if (addableMembers.length === 0 && addableClients.length === 0) return null;
              // 통합 picker — 멤버/고객 grouped options. value prefix 로 분기:
              //   'u-{userId}' = 멤버, 'c-{clientId}' = 고객
              const groupedOptions = [
                ...(addableMembers.length > 0 ? [{
                  label: t('drawer.attendeeGroupMember', '멤버') as string,
                  options: addableMembers.map(m => ({ value: `u-${m.user_id}`, label: m.name })),
                }] : []),
                ...(addableClients.length > 0 ? [{
                  label: t('drawer.attendeeGroupClient', '고객') as string,
                  options: addableClients.map(c => ({
                    value: `c-${c.id}`,
                    label: c.display_name || c.company_name || `#${c.id}`,
                  })),
                }] : []),
              ];
              return (
                <AddAttendeeRow>
                  <PlanQSelect
                    size="sm"
                    placeholder={t('drawer.addAttendee', '+ 참석자 추가') as string}
                    options={groupedOptions}
                    value={null}
                    onChange={(opt) => {
                      const v = opt ? String((opt as { value: string }).value) : '';
                      if (!v) return;
                      const [kind, idStr] = v.split('-');
                      const id = Number(idStr);
                      if (!id) return;
                      const newRow = kind === 'c'
                        ? { client_id: id, response: 'pending' as const }
                        : { user_id: id, response: 'pending' as const };
                      const next = [
                        ...(event.attendees || []).map(x => ({
                          user_id: x.user_id ?? undefined,
                          client_id: x.client_id ?? undefined,
                          response: x.response,
                        })),
                        newRow,
                      ];
                      onUpdate({ attendees: next as unknown as CalendarEvent['attendees'] });
                    }}
                  />
                </AddAttendeeRow>
              );
            })()}
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
          // #122 — 정기일정이면 삭제 범위(이 일정만/이후/모두) 선택. 단발이면 단순 확인.
          (isMaster || !!event.recurrence_parent_id) ? (
            <ScopeDeleteGroup>
              <ConfirmText>{t('drawer.deleteScopeTitle', '어느 회차를 삭제할까요?')}</ConfirmText>
              <ScopeDeleteBtn type="button" onClick={() => { onDelete({ scope: 'single', recurrence_id: instanceDate || toDateKey(new Date(event.start_at)) }); setConfirmDelete(false); }}>
                {t('drawer.scopeSingle', '이 일정만')}
              </ScopeDeleteBtn>
              <ScopeDeleteBtn type="button" onClick={() => { onDelete({ scope: 'future', recurrence_id: instanceDate || toDateKey(new Date(event.start_at)) }); setConfirmDelete(false); }}>
                {t('drawer.scopeFuture', '이 일정 이후 모두')}
              </ScopeDeleteBtn>
              <ScopeDeleteBtn type="button" $danger onClick={() => { onDelete({ scope: 'all' }); setConfirmDelete(false); }}>
                {t('drawer.scopeAll', '모든 일정')}
              </ScopeDeleteBtn>
              <SecondaryBtn type="button" onClick={() => setConfirmDelete(false)}>{t('button.cancel')}</SecondaryBtn>
            </ScopeDeleteGroup>
          ) : (
          <ConfirmGroup>
            <ConfirmText>{t('button.deleteConfirm')}</ConfirmText>
            <SecondaryBtn type="button" onClick={() => setConfirmDelete(false)}>{t('button.cancel')}</SecondaryBtn>
            <DangerBtn type="button" onClick={() => { onDelete(); setConfirmDelete(false); }}>
              {t('button.delete')}
            </DangerBtn>
          </ConfirmGroup>
          )
        ) : (
          <FooterRow>
            {/* #104 — 나만보기(L1) 일정은 공개 링크 발급 불가 (개인 자원 누출 차단) */}
            {event.vlevel === 'L1' ? (
              <PrivateShareNote>{t('share.privateBlocked', { defaultValue: '나만보기 일정은 공유할 수 없어요' }) as string}</PrivateShareNote>
            ) : (
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
            )}
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
      {/* N+63 P2a — 정기일정 scope modal. master 시간 변경 시 띄움. zIndex 2100 (drawer 위) */}
      {scopeModalOpen && (
        <>
          <ScopeBackdrop onClick={() => { setScopeModalOpen(false); setPendingPatch(null); }} />
          <ScopeModal role="dialog" aria-modal="true" aria-label={t('drawer.scopeTitle', '변경 범위 선택') as string}>
            <ScopeTitle>{t('drawer.scopeTitle', '변경 범위 선택')}</ScopeTitle>
            <ScopeDesc>{t('drawer.scopeDesc', '이 정기 일정의 어느 회차까지 변경할까요?')}</ScopeDesc>
            <ScopeOption type="button" onClick={() => applyScopeUpdate('single')}>
              <ScopeOptName>{t('drawer.scopeSingle', '이 일정만')}</ScopeOptName>
              <ScopeOptHint>{t('drawer.scopeSingleHint', '선택한 회차만 변경. 다른 회차는 그대로')}</ScopeOptHint>
            </ScopeOption>
            <ScopeOption type="button" onClick={() => applyScopeUpdate('future')}>
              <ScopeOptName>{t('drawer.scopeFuture', '이 일정 이후 모두')}</ScopeOptName>
              <ScopeOptHint>{t('drawer.scopeFutureHint', '이 회차부터 미래 회차까지 변경. 과거 회차는 그대로')}</ScopeOptHint>
            </ScopeOption>
            <ScopeOption type="button" onClick={() => applyScopeUpdate('all')}>
              <ScopeOptName>{t('drawer.scopeAll', '모든 일정')}</ScopeOptName>
              <ScopeOptHint>{t('drawer.scopeAllHint', '과거·미래 모든 회차 변경')}</ScopeOptHint>
            </ScopeOption>
            <ScopeFooter>
              <SecondaryBtn type="button" onClick={() => { setScopeModalOpen(false); setPendingPatch(null); }}>
                {t('button.cancel', '취소')}
              </SecondaryBtn>
            </ScopeFooter>
          </ScopeModal>
        </>
      )}
    </DetailDrawer>
  );
};

// ─── read-only 일 때 시간 표시 헬퍼 ───
// 운영 #41 — 특정 타임존(워크스페이스/개인) 기준으로 날짜+시간 포맷.
function formatDateTimeInTz(d: Date, lang: string, tz: string): string {
  const locale = lang === 'en' ? 'en-US' : 'ko-KR';
  try {
    return new Intl.DateTimeFormat(locale, {
      year: 'numeric', month: 'short', day: 'numeric', weekday: 'short',
      hour: '2-digit', minute: '2-digit', timeZone: tz,
    }).format(d);
  } catch {
    // 잘못된 tz fallback — 브라우저 로컬
    const dateFmt = new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric', weekday: 'short' });
    return `${dateFmt.format(d)} ${formatTime(d)}`;
  }
}
// 타임존 짧은 라벨 (예: KST, GMT+9). 실패 시 IANA 이름 끝부분.
function tzAbbr(d: Date, tz: string, lang: string): string {
  const locale = lang === 'en' ? 'en-US' : 'ko-KR';
  try {
    const parts = new Intl.DateTimeFormat(locale, { timeZone: tz, timeZoneName: 'short' }).formatToParts(d);
    return parts.find((p) => p.type === 'timeZoneName')?.value || tz.split('/').pop() || tz;
  } catch {
    return tz.split('/').pop() || tz;
  }
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
  background: #F0FDFA; color: #0F766E;
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
// 운영 #41 — 타임존 안내 (기준 tz / 개인 tz 보조)
const TzNote = styled.div<{ $alt?: boolean }>`
  font-size: 11px; font-weight: 500; margin-top: 2px;
  color: ${p => p.$alt ? '#0F766E' : '#94A3B8'};
`;
const Plain = styled.div` font-size: 13px; color: #334155; `;
const Muted = styled.span` font-size: 12px; color: #94A3B8; font-style: italic; `;
const Description = styled.div`
  font-size: 13px; color: #334155; line-height: 1.55; white-space: pre-wrap;
`;

// 시간 편집
const ScheduleEditor = styled.div` display: flex; flex-direction: column; gap: 8px; position: relative; `;
const DateTimeRow = styled.div` display: flex; align-items: center; gap: 8px; flex-wrap: wrap; `;
const RowLabel = styled.span` font-size: 11px; font-weight: 700; color: #64748B; min-width: 30px; `;
const DateTrigger = styled.button`
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 10px; border: 1px solid #CBD5E1; border-radius: 8px;
  background: #fff; color: #0F172A; font-size: 12.5px; font-weight: 500; cursor: pointer;
  svg { color: #64748B; flex-shrink: 0; }
  &:hover { border-color: #14B8A6; }
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20, 184, 166, 0.12); }
`;
const TimeWrap = styled.div` width: 100px; `;
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
  background: ${({ $active }) => $active ? '#14B8A6' : '#F1F5F9'};
  color: ${({ $active }) => $active ? '#fff' : '#475569'};
  border: none; cursor: pointer;
  &:hover:not(:disabled) { background: ${({ $active }) => $active ? '#0D9488' : '#E2E8F0'}; }
  &:disabled { cursor: default; opacity: 0.6; }
`;

// input/textarea
const Input = styled.input`
  padding: 8px 11px; border: 1px solid #CBD5E1; border-radius: 8px;
  font-size: 13px; color: #0F172A; outline: none; background: #fff;
  &:focus { border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20, 184, 166, 0.12); }
`;
const Textarea = styled.textarea`
  padding: 8px 11px; border: 1px solid #CBD5E1; border-radius: 8px;
  font-size: 13px; color: #0F172A; outline: none; resize: vertical;
  font-family: inherit; line-height: 1.5;
  &:focus { border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20, 184, 166, 0.12); }
`;

// meeting
// N+63 — URL 자체 표시. 재발급 후 즉시 변화 확인 가능. 텍스트 select·복사 OK, 클릭 시 새 탭 진입.
const MeetingUrl = styled.a`
  display: inline-block;
  padding: 6px 10px;
  background: #F0FDFA;
  border: 1px solid #99F6E4;
  border-radius: 6px;
  font-family: 'SF Mono', 'Monaco', 'Menlo', 'Roboto Mono', monospace;
  font-size: 12px;
  color: #0F766E;
  text-decoration: none;
  word-break: break-all;
  line-height: 1.45;
  user-select: text;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
  &:hover { background: #CCFBF1; border-color: #5EEAD4; text-decoration: underline; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 1px; }
`;
const MeetingActions = styled.div` display: flex; gap: 6px; flex-wrap: wrap; `;
const MeetingHint = styled.div`
  font-size: 11px; color: #94A3B8; line-height: 1.45; margin-top: 4px;
`;
const CreateRoomBtn = styled.button`
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 14px; border-radius: 8px; font-size: 12.5px; font-weight: 600;
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
const AttendeeRemoveBtn = styled.button`
  width: 22px; height: 22px; border-radius: 50%;
  background: transparent; border: 1px solid transparent;
  color: #94A3B8; font-size: 16px; line-height: 1; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  margin-left: 4px; flex-shrink: 0; padding: 0;
  &:hover { background: #FEF2F2; color: #B91C1C; border-color: #FECACA; }
`;
const AddAttendeeRow = styled.div`
  margin-top: 8px;
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
// #122 — 정기일정 삭제 범위 선택 (footer 안, 세로 배치)
const ScopeDeleteGroup = styled.div`
  display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
`;
const ScopeDeleteBtn = styled.button<{ $danger?: boolean }>`
  padding: 7px 12px; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer;
  background: transparent;
  color: ${p => p.$danger ? '#B91C1C' : '#334155'};
  border: 1px solid ${p => p.$danger ? '#FECACA' : '#CBD5E1'};
  &:hover { background: ${p => p.$danger ? '#FEF2F2' : '#F8FAFC'}; }
`;
const FooterRow = styled.div`
  display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%;
`;
const PrivateShareNote = styled.span`font-size: 11px; color: #94A3B8;`;
const ShareBtn = styled.button`
  padding: 7px 12px; border-radius: 6px; font-size: 12px; font-weight: 500;
  background: transparent; color: #475569; border: 1px solid #CBD5E1; cursor: pointer;
  display: inline-flex; align-items: center; gap: 6px;
  &:hover { background: #F0FDFA; color: #0F766E; border-color: #99F6E4; }
`;

// N+63 P2a — RecurrenceScopeModal styled
const ScopeBackdrop = styled.div`
  position: fixed; inset: 0; background: rgba(15, 23, 42, 0.4);
  z-index: 2099;
`;
const ScopeModal = styled.div`
  position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
  z-index: 2100;
  width: 420px; max-width: calc(100vw - 32px);
  background: #FFFFFF; border-radius: 12px;
  box-shadow: 0 24px 48px rgba(15, 23, 42, 0.2);
  padding: 20px;
  display: flex; flex-direction: column; gap: 10px;
`;
const ScopeTitle = styled.h3`
  margin: 0; font-size: 16px; font-weight: 700; color: #0F172A;
`;
const ScopeDesc = styled.p`
  margin: 0 0 8px; font-size: 13px; color: #64748B; line-height: 1.5;
`;
const ScopeOption = styled.button`
  display: flex; flex-direction: column; gap: 3px;
  padding: 12px 14px; border-radius: 8px;
  background: #F8FAFC; border: 1px solid #E2E8F0;
  text-align: left; cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
  &:hover { background: #F0FDFA; border-color: #5EEAD4; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 2px; }
`;
const ScopeOptName = styled.span`
  font-size: 14px; font-weight: 600; color: #0F172A;
`;
const ScopeOptHint = styled.span`
  font-size: 12px; color: #64748B; line-height: 1.45;
`;
const ScopeFooter = styled.div`
  display: flex; justify-content: flex-end; margin-top: 4px;
`;
