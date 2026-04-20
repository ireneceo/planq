import React, { useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import type { CalendarEvent, EventCategory, EventVisibility } from './types';
import { CATEGORY_OPTIONS } from './categoryColors';
import { toDateKey } from './dateUtils';
import PlanQSelect from '../../components/Common/PlanQSelect';
import CalendarPicker from '../../components/Common/CalendarPicker';
import { getVideoStatus } from '../../services/calendar';

type RecurrencePreset = 'none' | 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'yearly';
const PRESET_TO_RRULE: Record<RecurrencePreset, string | null> = {
  none: null,
  daily: 'FREQ=DAILY',
  weekly: 'FREQ=WEEKLY',
  biweekly: 'FREQ=WEEKLY;INTERVAL=2',
  monthly: 'FREQ=MONTHLY',
  yearly: 'FREQ=YEARLY',
};

interface Props {
  initialStart: Date;
  projects: Array<{ id: number; name: string; color?: string | null }>;
  onClose: () => void;
  onCreate: (payload: Partial<CalendarEvent>) => void;
}

// 30분 스텝 시간 옵션 (00:00 ~ 23:30)
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

const NewEventModal: React.FC<Props> = ({ initialStart, projects, onClose, onCreate }) => {
  const { t, i18n } = useTranslation('qcalendar');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');

  const [startDate, setStartDate] = useState<string>(toDateKey(initialStart));
  const [endDate, setEndDate] = useState<string>(toDateKey(initialStart));
  const [startTime, setStartTime] = useState<string>(() => {
    const h = String(initialStart.getHours()).padStart(2, '0');
    const m = initialStart.getMinutes() >= 30 ? '30' : '00';
    return `${h}:${m}`;
  });
  const [endTime, setEndTime] = useState<string>(() => {
    const d = new Date(initialStart); d.setHours(d.getHours() + 1);
    const h = String(d.getHours()).padStart(2, '0');
    const m = d.getMinutes() >= 30 ? '30' : '00';
    return `${h}:${m}`;
  });

  const [allDay, setAllDay] = useState(false);
  const [category, setCategory] = useState<EventCategory>('meeting');
  const [visibility, setVisibility] = useState<EventVisibility>('business');
  const [projectId, setProjectId] = useState<number | ''>('');
  const [meetingUrl, setMeetingUrl] = useState('');
  const [autoCreateMeeting, setAutoCreateMeeting] = useState(false);
  const [dailyConfigured, setDailyConfigured] = useState(false);
  const [recurrence, setRecurrence] = useState<RecurrencePreset>('none');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    getVideoStatus()
      .then((s) => setDailyConfigured(!!s.daily_configured))
      .catch(() => setDailyConfigured(false));
  }, []);

  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const dateTriggerRef = useRef<HTMLButtonElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => { titleRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const dateLabel = useMemo(() => {
    const locale = i18n.language === 'en' ? 'en-US' : 'ko-KR';
    const s = new Date(`${startDate}T00:00:00`);
    const e = new Date(`${endDate}T00:00:00`);
    const fmt = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', weekday: 'short' });
    if (startDate === endDate) return fmt.format(s);
    return `${fmt.format(s)} ~ ${fmt.format(e)}`;
  }, [startDate, endDate, i18n.language]);

  const canSubmit = title.trim().length > 0 && !submitting;

  const handleSubmit = () => {
    if (!canSubmit) return;
    // ISO 변환 — 로컬 타임존 기준
    const mkISO = (dateStr: string, timeStr: string, endOfDay = false): string => {
      const [y, mo, d] = dateStr.split('-').map(Number);
      if (allDay) {
        return new Date(y, mo - 1, d, endOfDay ? 23 : 0, endOfDay ? 59 : 0, 0).toISOString();
      }
      const [hh, mm] = timeStr.split(':').map(Number);
      return new Date(y, mo - 1, d, hh, mm, 0).toISOString();
    };
    const sISO = mkISO(startDate, startTime);
    const eISO = mkISO(endDate, endTime, true);
    if (new Date(eISO) < new Date(sISO)) return;

    setSubmitting(true);
    onCreate({
      title: title.trim(),
      description: description.trim() || null,
      location: location.trim() || null,
      start_at: sISO,
      end_at: eISO,
      all_day: allDay,
      category,
      visibility,
      project_id: projectId === '' ? null : Number(projectId),
      meeting_url: meetingUrl.trim() || null,
      meeting_provider: meetingUrl.trim() ? (meetingUrl.includes('daily.co') ? 'daily' : 'manual') : null,
      auto_create_meeting: autoCreateMeeting && dailyConfigured,
      rrule: PRESET_TO_RRULE[recurrence],
    } as unknown as Partial<CalendarEvent>);
  };

  return (
    <>
      <Backdrop onClick={onClose} />
      <Modal role="dialog" aria-label={t('new')}>
        <Header>
          <HeaderTitle>{t('new')}</HeaderTitle>
          <CloseBtn onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </CloseBtn>
        </Header>
        <Body>
          <Field>
            <TitleInput
              ref={titleRef}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('form.titlePlaceholder')}
              onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') handleSubmit(); }}
            />
          </Field>

          <Field>
            <Label>{t('form.startAt')} – {t('form.endAt')}</Label>
            <DateRow>
              <DateTrigger
                ref={dateTriggerRef}
                type="button"
                onClick={() => setDatePickerOpen((x) => !x)}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="4" width="18" height="18" rx="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
                <span>{dateLabel}</span>
              </DateTrigger>
              {!allDay && (
                <TimePair>
                  <TimeWrap>
                    <PlanQSelect
                      size="sm"
                      density="compact"
                      options={TIME_OPTIONS}
                      value={{ value: startTime, label: startTime }}
                      onChange={(opt) => opt && setStartTime((opt as { value: string }).value)}
                    />
                  </TimeWrap>
                  <Dash>–</Dash>
                  <TimeWrap>
                    <PlanQSelect
                      size="sm"
                      density="compact"
                      options={TIME_OPTIONS}
                      value={{ value: endTime, label: endTime }}
                      onChange={(opt) => opt && setEndTime((opt as { value: string }).value)}
                    />
                  </TimeWrap>
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
                setStartDate(s);
                setEndDate(e || s);
              }}
            />
          </Field>

          <Row>
            <CheckboxLabel>
              <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
              <span>{t('form.allDay')}</span>
            </CheckboxLabel>
          </Row>

          <Field>
            <Label>{t('form.category')}</Label>
            <CategoryRow>
              {CATEGORY_OPTIONS.map((c) => (
                <CategoryBtn key={c} type="button" $active={category === c} onClick={() => setCategory(c)}>
                  {t(`category.${c}`)}
                </CategoryBtn>
              ))}
            </CategoryRow>
          </Field>

          <Field>
            <Label>{t('recurrence.label')}</Label>
            <PlanQSelect
              size="sm"
              options={(['none','daily','weekly','biweekly','monthly','yearly'] as RecurrencePreset[]).map((v) => ({
                value: v, label: t(`recurrence.${v}`),
              }))}
              value={{ value: recurrence, label: t(`recurrence.${recurrence}`) }}
              onChange={(opt) => opt && setRecurrence((opt as { value: string }).value as RecurrencePreset)}
            />
          </Field>

          <Grid2>
            <Field>
              <Label>{t('form.project')}</Label>
              <PlanQSelect
                size="sm"
                isClearable
                placeholder={t('form.projectNone')}
                options={projects.map((p) => ({ value: p.id, label: p.name }))}
                value={projectId === '' ? null : { value: projectId, label: projects.find((p) => p.id === projectId)?.name || '' }}
                onChange={(opt) => setProjectId(opt ? Number((opt as { value: number | string }).value) : '')}
              />
            </Field>
            <Field>
              <Label>{t('form.visibility')}</Label>
              <PlanQSelect
                size="sm"
                options={[
                  { value: 'business', label: t('visibility.business') },
                  { value: 'personal', label: t('visibility.personal') },
                ]}
                value={{ value: visibility, label: t(`visibility.${visibility}`) }}
                onChange={(opt) => opt && setVisibility((opt as { value: string }).value as EventVisibility)}
              />
            </Field>
          </Grid2>

          <Field>
            <Label>{t('form.location')}</Label>
            <Input
              value={location} onChange={(e) => setLocation(e.target.value)}
              placeholder={t('form.locationPlaceholder')}
            />
          </Field>

          <Field>
            <Label>{t('form.meetingUrl')}</Label>
            {dailyConfigured && (
              <AutoMeetingRow>
                <CheckboxLabel>
                  <input
                    type="checkbox"
                    checked={autoCreateMeeting}
                    onChange={(e) => setAutoCreateMeeting(e.target.checked)}
                  />
                  <AutoMeetingText>
                    <strong>{t('form.autoCreateMeeting')}</strong>
                    <small>{t('form.autoCreateMeetingHelp')}</small>
                  </AutoMeetingText>
                </CheckboxLabel>
              </AutoMeetingRow>
            )}
            <Input
              value={meetingUrl} onChange={(e) => setMeetingUrl(e.target.value)}
              placeholder={t('form.meetingUrlPlaceholder')}
              disabled={autoCreateMeeting}
            />
          </Field>

          <Field>
            <Label>{t('form.description')}</Label>
            <Textarea
              rows={3} value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder={t('form.descriptionPlaceholder')}
            />
          </Field>
        </Body>
        <Footer>
          <SecondaryBtn type="button" onClick={onClose}>{t('button.cancel')}</SecondaryBtn>
          <PrimaryBtn type="button" disabled={!canSubmit} onClick={handleSubmit}>
            {t('button.create')}
          </PrimaryBtn>
        </Footer>
      </Modal>
    </>
  );
};

export default NewEventModal;

// ── styled ──
const Backdrop = styled.div`
  position: fixed; inset: 0; background: rgba(15, 23, 42, 0.08);
  z-index: 60;
`;
const Modal = styled.div`
  position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
  z-index: 70; width: 540px; max-width: calc(100vw - 40px); max-height: calc(100vh - 48px);
  background: #fff; border-radius: 14px; box-shadow: 0 30px 60px -20px rgba(15, 23, 42, 0.25);
  display: flex; flex-direction: column; overflow: hidden;
`;
const Header = styled.div`
  display: flex; align-items: center; padding: 14px 18px;
  border-bottom: 1px solid #EEF2F6;
`;
const HeaderTitle = styled.div`
  flex: 1; font-size: 15px; font-weight: 700; color: #0F172A; letter-spacing: -0.1px;
`;
const CloseBtn = styled.button`
  width: 30px; height: 30px; border: none; background: transparent; color: #64748B;
  border-radius: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center;
  &:hover { background: #F1F5F9; color: #0F172A; }
`;
const Body = styled.div`
  padding: 16px 18px; overflow-y: auto;
  display: flex; flex-direction: column; gap: 14px;
`;
const Field = styled.div` display: flex; flex-direction: column; gap: 6px; position: relative; `;
const Label = styled.label`
  font-size: 11px; font-weight: 600; color: #64748B;
  text-transform: uppercase; letter-spacing: 0.3px;
`;
const TitleInput = styled.input`
  font-size: 20px; font-weight: 700; color: #0F172A; letter-spacing: -0.3px;
  border: none; outline: none; padding: 4px 0; background: transparent;
  border-bottom: 1px solid transparent;
  &:focus { border-bottom-color: #14B8A6; }
  &::placeholder { color: #94A3B8; font-weight: 500; }
`;

const DateRow = styled.div`
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
`;
const DateTrigger = styled.button`
  display: inline-flex; align-items: center; gap: 8px;
  padding: 9px 12px; border: 1px solid #CBD5E1; border-radius: 7px;
  background: #fff; color: #0F172A; font-size: 13px; font-weight: 500; cursor: pointer;
  svg { color: #64748B; flex-shrink: 0; }
  &:hover { border-color: #14B8A6; }
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20, 184, 166, 0.12); }
`;
const TimePair = styled.div`
  display: inline-flex; align-items: center; gap: 6px;
`;
const TimeWrap = styled.div` width: 112px; `;
const Dash = styled.span` color: #94A3B8; font-size: 13px; `;

const Grid2 = styled.div` display: grid; grid-template-columns: 1fr 1fr; gap: 12px; `;
const Row = styled.div` display: flex; gap: 16px; `;
const CheckboxLabel = styled.label`
  display: inline-flex; align-items: center; gap: 6px; cursor: pointer;
  font-size: 13px; color: #334155;
  input { accent-color: #14B8A6; cursor: pointer; }
`;
const CategoryRow = styled.div` display: flex; flex-wrap: wrap; gap: 6px; `;
const CategoryBtn = styled.button<{ $active: boolean }>`
  padding: 6px 12px; border-radius: 999px;
  font-size: 12px; font-weight: 500;
  background: ${({ $active }) => $active ? '#0F172A' : '#F1F5F9'};
  color: ${({ $active }) => $active ? '#fff' : '#475569'};
  border: none; cursor: pointer;
  &:hover { background: ${({ $active }) => $active ? '#0F172A' : '#E2E8F0'}; }
`;
const Input = styled.input`
  padding: 9px 11px; border: 1px solid #CBD5E1; border-radius: 7px;
  font-size: 13px; color: #0F172A; outline: none; background: #fff;
  &:focus { border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20, 184, 166, 0.12); }
  &:disabled { background: #F8FAFC; color: #94A3B8; cursor: not-allowed; }
`;
const AutoMeetingRow = styled.div`
  background: #F0FDFA; border: 1px solid #99F6E4; border-radius: 8px;
  padding: 10px 12px; margin-bottom: 2px;
`;
const AutoMeetingText = styled.div`
  display: flex; flex-direction: column; gap: 2px;
  strong { font-size: 13px; color: #0F172A; font-weight: 600; }
  small { font-size: 11.5px; color: #64748B; }
`;
const Textarea = styled.textarea`
  padding: 9px 11px; border: 1px solid #CBD5E1; border-radius: 7px;
  font-size: 13px; color: #0F172A; outline: none; resize: vertical;
  font-family: inherit;
  &:focus { border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20, 184, 166, 0.12); }
`;
const Footer = styled.div`
  padding: 12px 18px; border-top: 1px solid #EEF2F6;
  display: flex; justify-content: flex-end; gap: 8px;
`;
const SecondaryBtn = styled.button`
  padding: 8px 14px; border-radius: 7px; font-size: 13px; font-weight: 500;
  background: transparent; color: #475569; border: 1px solid #CBD5E1; cursor: pointer;
  &:hover { background: #F8FAFC; color: #0F172A; }
`;
const PrimaryBtn = styled.button`
  padding: 8px 16px; border-radius: 7px; font-size: 13px; font-weight: 600;
  background: #14B8A6; color: #fff; border: none; cursor: pointer;
  transition: background 0.15s ease;
  &:hover:not(:disabled) { background: #0F766E; }
  &:disabled { background: #CBD5E1; cursor: not-allowed; }
`;
