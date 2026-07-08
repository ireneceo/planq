import React, { useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import type { CalendarEvent, EventCategory, EventVisibility } from './types';
import { CATEGORY_OPTIONS } from './categoryColors';
import { toDateKey } from './dateUtils';
import PlanQSelect from '../../components/Common/PlanQSelect';
import CalendarPicker from '../../components/Common/CalendarPicker';
import RecurrencePicker from '../../components/Common/RecurrencePicker';
import { getVideoStatus } from '../../services/calendar';
import VisibilityField, { serializeVisibility, type VisibilityValue } from '../../components/Common/VisibilityField';
import { listWorkspaceClients, type WorkspaceClientRow } from '../../services/qtalk';
import { apiFetch } from '../../contexts/AuthContext';

interface Props {
  initialStart: Date;
  projects: Array<{ id: number; name: string; color?: string | null }>;
  businessId?: number | null;
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

const NewEventModal: React.FC<Props> = ({ initialStart, projects, businessId, onClose, onCreate }) => {
  const { t, i18n } = useTranslation('qcalendar');
  const { user } = useAuth();
  // 운영 #41 — 입력 시간의 기준 타임존(워크스페이스) 안내
  const wsTz = user?.workspace_timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const wsTzLabel = (() => {
    try {
      const locale = i18n.language === 'en' ? 'en-US' : 'ko-KR';
      const parts = new Intl.DateTimeFormat(locale, { timeZone: wsTz, timeZoneName: 'short' }).formatToParts(new Date());
      return parts.find((p) => p.type === 'timeZoneName')?.value || wsTz.split('/').pop() || wsTz;
    } catch { return wsTz.split('/').pop() || wsTz; }
  })();
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
  // N+66 — 통합 visibility 5단계
  const [vis, setVis] = useState<VisibilityValue>({
    vlevel: 'L3', variant: 'L3', project_id: null, client_ids: [], target_member_ids: [],
  });
  const [clientsList, setClientsList] = useState<WorkspaceClientRow[]>([]);
  const [members, setMembers] = useState<Array<{ user_id: number; name: string; role: string }>>([]);
  useEffect(() => {
    if (!businessId) return;
    listWorkspaceClients(businessId).then(c => setClientsList(c.filter(x => x.status !== 'archived'))).catch(() => {});
    apiFetch(`/api/businesses/${businessId}/members`).then(r => r.json()).then(j => {
      if (j?.success && Array.isArray(j.data)) {
        setMembers(j.data
          .filter((m: { user?: { is_ai?: boolean }; role?: string }) => !m.user?.is_ai && m.role !== 'ai')
          .map((m: { user_id?: number; id?: number; user?: { id?: number; name?: string; display_name?: string | null }; name?: string; role?: string }) => ({
            user_id: m.user_id || m.id || m.user?.id || 0,
            // 워크스페이스 표시명 우선 — 계정명 노출 방지
            name: m.user?.display_name || m.name || m.user?.name || '—',
            role: m.role || 'member',
          })).filter((m: { user_id: number }) => m.user_id > 0));
      }
    }).catch(() => {});
  }, [businessId]);
  const [projectId, setProjectId] = useState<number | ''>('');
  const [meetingUrl, setMeetingUrl] = useState('');
  const [autoCreateMeeting, setAutoCreateMeeting] = useState(false);
  // 사이클 N+13 — Daily.co 완전 교체, Google Meet 자동 생성으로 변경
  const [gcalConfigured, setGcalConfigured] = useState(false);
  const [gcalConnected, setGcalConnected] = useState(false);
  const [rrule, setRrule] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    getVideoStatus(businessId || undefined)
      .then((s) => {
        setGcalConfigured(!!s.gcal_configured);
        setGcalConnected(!!s.gcal_connected);
      })
      .catch(() => { setGcalConfigured(false); setGcalConnected(false); });
  }, [businessId]);

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
    // N+66 — vlevel 우선. hook 가 visibility 자동 동기.
    const ser = serializeVisibility(vis);
    // L2-project 가 선택되면 project_id 도 sync (정합)
    const finalProjectId = vis.variant === 'L2_project'
      ? ser.project_id
      : (projectId === '' ? null : Number(projectId));
    onCreate({
      title: title.trim(),
      description: description.trim() || null,
      location: location.trim() || null,
      start_at: sISO,
      end_at: eISO,
      all_day: allDay,
      category,
      visibility,  // backend hook 가 vlevel 우선 처리하므로 backward-compat
      project_id: finalProjectId,
      meeting_url: meetingUrl.trim() || null,
      meeting_provider: autoCreateMeeting && gcalConnected
        ? 'google_meet'
        : (meetingUrl.trim() ? 'manual' : null),
      auto_create_meeting: autoCreateMeeting && gcalConnected,
      rrule,
      // N+66 — 통합 visibility
      vlevel: vis.vlevel,
      target_member_ids: ser.target_member_ids,
      target_client_ids: vis.variant === 'L4' ? ser.client_ids : [],
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
                      onChange={(opt) => {
                        if (!opt) return;
                        const v = (opt as { value: string }).value;
                        setStartTime(v);
                        // #123 — 시작시간 변경 시 종료시간이 기존 기간 유지하며 follow (구글 방식).
                        //   Fable D-1 — 같은 날짜일 때만. 멀티데이(startDate≠endDate)는 시각만으로 dur 계산 시 왜곡되므로 종료 시각 건드리지 않음.
                        if (startDate === endDate) {
                          const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
                          const dur = toMin(endTime) - toMin(startTime);
                          const newEnd = Math.min(toMin(v) + (dur > 0 ? dur : 60), 23 * 60 + 30);
                          setEndTime(`${String(Math.floor(newEnd / 60)).padStart(2, '0')}:${String(newEnd % 60).padStart(2, '0')}`);
                        }
                      }}
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
            {!allDay && <TzHint>{t('tz.inputBasis', { tz: wsTzLabel, defaultValue: '{{tz}} (워크스페이스 시간대) 기준' }) as string}</TzHint>}
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
            <RecurrencePicker
              value={rrule}
              onChange={setRrule}
              anchorDate={startDate}
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
          </Grid2>
          {/* N+66 — 공유 범위 통합 (KnowledgePage 와 동일 VisibilityField). 옛 personal/business 2 select 폐지. */}
          <Field>
            <Label>{t('form.visibility')}</Label>
            <VisibilityField
              value={vis}
              onChange={(v) => {
                setVis(v);
                // legacy visibility state 도 동기 (backward compat)
                setVisibility(v.vlevel === 'L1' ? 'personal' : 'business');
                // L2-project 선택 시 projectId 도 sync
                if (v.variant === 'L2_project' && v.project_id) setProjectId(v.project_id);
              }}
              projects={projects.map(p => ({ id: p.id, name: p.name }))}
              clients={clientsList.map(c => ({ id: c.id, display_name: c.display_name, biz_name: c.biz_name, company_name: c.company_name }))}
              members={members}
            />
          </Field>

          <Field>
            <Label>{t('form.location')}</Label>
            <Input
              value={location} onChange={(e) => setLocation(e.target.value)}
              placeholder={t('form.locationPlaceholder')}
            />
          </Field>

          <Field>
            <Label>{t('form.meetingUrl')}</Label>
            {/* Google Meet 자동 생성 — 워크스페이스가 Google Calendar 연결되어 있을 때만 노출.
                연결 안 됨 + 서버 OAuth 설정은 정상 → "Google 계정 연결하기" CTA 안내. */}
            {gcalConnected && (
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
            {!gcalConnected && gcalConfigured && (
              <AutoMeetingRow as="a" href="/business/settings/storage" style={{ textDecoration: 'none', cursor: 'pointer' }}>
                <AutoMeetingText>
                  <strong>{t('form.gcalConnectPrompt')}</strong>
                  <small>{t('form.gcalConnectHelp')}</small>
                </AutoMeetingText>
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
  z-index: 1000;
`;
const Modal = styled.div`
  position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
  z-index: 1000; width: 540px; max-width: calc(100vw - 40px); max-height: calc(var(--vvh, 100vh) - 48px);
  background: #fff; border-radius: 14px; box-shadow: 0 30px 60px -20px rgba(15, 23, 42, 0.25);
  display: flex; flex-direction: column; overflow: hidden;

  /* mobile: top/bottom 고정으로 GNB 피하고 화면 안에 확실히 배치 */
  @media (max-width: 640px) {
    top: 70px;
    bottom: auto;
    left: 16px;
    right: 16px;
    transform: none;
    width: auto;
    max-width: none;
    max-height: calc(var(--vvh, 100vh) - 90px);
  }
`;
const Header = styled.div`
  display: flex; align-items: center; padding: 14px 18px;
  border-bottom: 1px solid #E2E8F0;
  flex-shrink: 0;
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
  flex: 1; min-height: 0;
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
const TzHint = styled.div`
  font-size: 11px; font-weight: 500; color: #94A3B8; margin-top: 4px;
`;
const DateTrigger = styled.button`
  display: inline-flex; align-items: center; gap: 8px;
  padding: 9px 12px; border: 1px solid #CBD5E1; border-radius: 8px;
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
  background: ${({ $active }) => $active ? '#14B8A6' : '#F1F5F9'};
  color: ${({ $active }) => $active ? '#fff' : '#475569'};
  border: none; cursor: pointer;
  &:hover { background: ${({ $active }) => $active ? '#0D9488' : '#E2E8F0'}; }
`;
const Input = styled.input`
  padding: 9px 11px; border: 1px solid #CBD5E1; border-radius: 8px;
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
  padding: 9px 11px; border: 1px solid #CBD5E1; border-radius: 8px;
  font-size: 13px; color: #0F172A; outline: none; resize: vertical;
  font-family: inherit;
  &:focus { border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20, 184, 166, 0.12); }
`;
const Footer = styled.div`
  padding: 12px 18px; border-top: 1px solid #E2E8F0;
  display: flex; justify-content: flex-end; gap: 8px;
  flex-shrink: 0;
`;
const SecondaryBtn = styled.button`
  padding: 8px 14px; border-radius: 8px; font-size: 13px; font-weight: 500;
  background: transparent; color: #475569; border: 1px solid #CBD5E1; cursor: pointer;
  &:hover { background: #F8FAFC; color: #0F172A; }
`;
const PrimaryBtn = styled.button`
  padding: 8px 16px; border-radius: 8px; font-size: 13px; font-weight: 600;
  background: #14B8A6; color: #fff; border: none; cursor: pointer;
  transition: background 0.15s ease;
  &:hover:not(:disabled) { background: #0F766E; }
  &:disabled { background: #CBD5E1; cursor: not-allowed; }
`;
