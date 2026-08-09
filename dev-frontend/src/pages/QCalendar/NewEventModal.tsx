import React, { useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useAuth, apiFetch } from '../../contexts/AuthContext';
import type { CalendarEvent, EventCategory, EventVisibility } from './types';
import { CATEGORY_OPTIONS } from './categoryColors';
import { toDateKey } from './dateUtils';
import PlanQSelect from '../../components/Common/PlanQSelect';
import CreateDrawer from '../../components/Common/CreateDrawer';
import CalendarPicker from '../../components/Common/CalendarPicker';
import RecurrencePicker from '../../components/Common/RecurrencePicker';
import { getVideoStatus } from '../../services/calendar';
import VisibilityField, { serializeVisibility, type VisibilityValue } from '../../components/Common/VisibilityField';
import { listWorkspaceClients, type WorkspaceClientRow } from '../../services/qtalk';

interface Props {
  initialStart: Date;
  // 음성 캡처('말로 추가') 등 외부에서 넘어온 초기값. 미전달이면 기존 동작 그대로(빈 폼).
  //   모달은 열릴 때 mount 되므로(부모의 `{showNewModal && <NewEventModal .../>}`) useState 초기값으로 1회만 적용된다.
  initialTitle?: string;
  initialDescription?: string;
  initialAllDay?: boolean;
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

const NewEventModal: React.FC<Props> = ({ initialStart, initialTitle, initialDescription, initialAllDay, projects, businessId, onClose, onCreate }) => {
  const { t, i18n } = useTranslation('qcalendar');
  const { user } = useAuth();
  const bizId = user?.business_id || null;
  // 운영 #41 — 입력 시간의 기준 타임존(워크스페이스) 안내
  const wsTz = user?.workspace_timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const wsTzLabel = (() => {
    try {
      const locale = i18n.language === 'en' ? 'en-US' : 'ko-KR';
      const parts = new Intl.DateTimeFormat(locale, { timeZone: wsTz, timeZoneName: 'short' }).formatToParts(new Date());
      return parts.find((p) => p.type === 'timeZoneName')?.value || wsTz.split('/').pop() || wsTz;
    } catch { return wsTz.split('/').pop() || wsTz; }
  })();
  const [title, setTitle] = useState(initialTitle || '');
  const [description, setDescription] = useState(initialDescription || '');
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

  const [allDay, setAllDay] = useState(initialAllDay === true);
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
  // 구글 캘린더에 올릴지 — **팀/개인 각각** (계정이 다르므로 하나로 합치면 안 된다). 기본 둘 다 ON.
  const [gcalSyncWorkspace, setGcalSyncWorkspace] = useState(true);
  const [gcalSyncPersonal, setGcalSyncPersonal] = useState(true);
  // 비공개(L1)·팀비공개(L2)·personal 일정은 팀 캘린더로 나갈 수 없다(#126 유출 차단).
  //   서버가 어차피 막지만, 화면에서 미리 비활성 + 이유를 보여야 사용자가 규칙을 안다.
  const isPrivateVis = vis.vlevel === 'L1' || vis.vlevel === 'L2';
  // 개인 캘린더는 쓰기 동의(calendar.events)까지 된 연결이 있을 때만 의미가 있다.
  const [personalCalWritable, setPersonalCalWritable] = useState(false);
  useEffect(() => {
    if (!bizId) return;
    apiFetch(`/api/me/external-connections?business_id=${bizId}`)
      .then(r => r.json())
      .then(j => {
        if (!j.success) return;
        setPersonalCalWritable((j.data || []).some(
          (c: { provider?: string; is_active?: boolean; can_write_calendar?: boolean | null }) =>
            c.provider === 'google_calendar' && c.is_active && c.can_write_calendar === true
        ));
      })
      .catch(() => {});
  }, [bizId]);
  // 사이클 N+13 — Daily.co 완전 교체, Google Meet 자동 생성으로 변경
  const [gcalConfigured, setGcalConfigured] = useState(false);
  // #242 — 토큰 존재와 쓰기 권한(gcalCanWrite)은 다르다. Meet 은 권한 기준.
  //   합산된 gcal_connected 는 더 쓰지 않는다 — 어느 축이 빠졌는지 구분이 안 돼 배너가
  //   직원에게 오너 전용 경로를 안내하던 원인이었다. 축별로 workspace_*/personal_* 를 쓴다.
  //   ★ gcalCanWrite 는 Meet 축이라 **개인 연동을 포함**한다. 팀 동기화 토글은 워크스페이스
  //     전용이므로 workspaceCanWrite 를 쓴다 — 섞으면 워크스페이스 미연결인데 팀 체크박스가 뜬다.
  const [gcalCanWrite, setGcalCanWrite] = useState(false);
  const [workspaceCanWrite, setWorkspaceCanWrite] = useState(false);
  // 개인 축 — 배너가 어느 연동을 가리킬지 결정한다. 워크스페이스 연동은 **오너 전용**이라
  //   (routes/cloud.js requireOwnerForCloud) 직원에게 그 경로를 안내하면 눌러도 403 이다.
  const [workspaceConnected, setWorkspaceConnected] = useState(false);
  const [personalConnected, setPersonalConnected] = useState(false);
  // 회의가 어느 계정에 개설되는지 — 'personal' 이면 본인 구글 계정이 호스트가 된다.
  const [meetSource, setMeetSource] = useState<'personal' | 'workspace' | null>(null);
  const [rrule, setRrule] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    getVideoStatus(businessId || undefined)
      .then((s) => {
        setGcalConfigured(!!s.gcal_configured);
        setGcalCanWrite(!!s.gcal_can_write);
        setWorkspaceCanWrite(!!s.workspace_can_write);
        setWorkspaceConnected(!!s.workspace_connected);
        setPersonalConnected(!!s.personal_connected);
        setMeetSource(s.meet_source ?? null);
      })
      .catch(() => {
        setGcalConfigured(false); setGcalCanWrite(false);
        setWorkspaceCanWrite(false); setWorkspaceConnected(false);
        setPersonalConnected(false); setMeetSource(null);
      });
  }, [businessId]);

  // 오너 판정은 **이 모달이 다루는 워크스페이스** 기준이어야 한다. user.business_role 은 active
  //   워크스페이스의 역할이라 멀티 워크스페이스에서 businessId 와 어긋날 수 있다.
  const isOwnerHere = useMemo(() => {
    const target = businessId || bizId;
    if (!target) return false;
    const ws = user?.workspaces?.find((w) => w.business_id === target);
    return ws ? ws.role === 'owner' : user?.business_role === 'owner';
  }, [user, businessId, bizId]);

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
    const created = onCreate({
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
      // 비공개 전환은 체크 후에도 일어날 수 있다 — 체크박스를 숨기는 것만으로는 부족하고,
      // 전송 시점에도 걸러야 백엔드 400(일정 생성 전체 실패)을 막는다.
      meeting_provider: autoCreateMeeting && gcalCanWrite && !isPrivateVis
        ? 'google_meet'
        : (meetingUrl.trim() ? 'manual' : null),
      auto_create_meeting: autoCreateMeeting && gcalCanWrite && !isPrivateVis,
      rrule,
      gcal_sync_workspace: gcalSyncWorkspace,
      gcal_sync_personal: gcalSyncPersonal,
      // N+66 — 통합 visibility
      vlevel: vis.vlevel,
      target_member_ids: ser.target_member_ids,
      target_client_ids: vis.variant === 'L4' ? ser.client_ids : [],
    } as unknown as Partial<CalendarEvent>);
    // #242 — 실패 경로에서 submitting 이 영영 안 풀려 버튼이 잠기던 것. 성공 시엔 모달이 사라지므로 무해.
    Promise.resolve(created).finally(() => setSubmitting(false));
  };

  return (
    <CreateDrawer
      open
      onClose={onClose}
      title={t('new')}
      wide
      onSubmit={handleSubmit}
      submitting={submitting}
      submitLabel={t('button.create')}
      submitDisabled={!title.trim()}
    >
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

          {/* 구글 캘린더 연동 — 팀/개인은 **연결된 구글 계정이 다르다**. 각각 켜고 끈다.
              공개 범위 바로 아래에 둔다 — 어디로 나가는지가 공개 범위에 달렸기 때문.
              (화상 미팅 링크 항목 아래에 두면 회의 기능에 종속돼 보인다 — Irene 지적) */}
          {(workspaceCanWrite || personalCalWritable) && (
            <Field>
              <Label>{t('form.gcalSection')}</Label>
              {workspaceCanWrite && (
                <GcalRow $disabled={isPrivateVis}>
                  <input
                    type="checkbox"
                    checked={gcalSyncWorkspace && !isPrivateVis}
                    disabled={isPrivateVis}
                    onChange={(e) => setGcalSyncWorkspace(e.target.checked)}
                  />
                  <span>
                    {t('form.gcalTeam')}
                    <GcalHint>{isPrivateVis ? t('form.gcalTeamBlocked') : t('form.gcalTeamHint')}</GcalHint>
                  </span>
                </GcalRow>
              )}
              {personalCalWritable && (
                <GcalRow>
                  <input
                    type="checkbox"
                    checked={gcalSyncPersonal}
                    onChange={(e) => setGcalSyncPersonal(e.target.checked)}
                  />
                  <span>
                    {t('form.gcalPersonal')}
                    <GcalHint>{t('form.gcalPersonalHint')}</GcalHint>
                  </span>
                </GcalRow>
              )}
            </Field>
          )}

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
            {/* 비공개(L1/L2) 일정에는 Meet 을 걸 수 없다 — 백엔드가 400 으로 **일정 생성 자체를
                거부**하므로(유출 차단), 체크할 수 있게 두면 저장이 통째로 실패한다. */}
            {gcalCanWrite && !isPrivateVis && (
              <AutoMeetingRow>
                <CheckboxLabel>
                  <input
                    type="checkbox"
                    checked={autoCreateMeeting}
                    onChange={(e) => setAutoCreateMeeting(e.target.checked)}
                  />
                  <AutoMeetingText>
                    <strong>{t('form.autoCreateMeeting')}</strong>
                    <small>
                      {meetSource === 'personal'
                        ? t('form.autoCreateMeetingPersonal')
                        : t('form.autoCreateMeetingHelp')}
                    </small>
                  </AutoMeetingText>
                </CheckboxLabel>
              </AutoMeetingRow>
            )}
            {/* Meet 을 못 만드는 상태의 안내 — **그 사용자가 스스로 할 수 있는 행동**만 가리킨다.
                개인 연동(/profile/integrations)은 누구나 할 수 있고, 워크스페이스 연동
                (/business/settings/storage)은 오너 전용이다. 옛 코드는 둘 다 워크스페이스로
                보내서, 직원에게는 눌러도 403 이 나는 죽은 안내였다(#246 과 같은 계열).
                Meet 은 이미 개인 연동 우선으로 동작하므로 개인 경로가 주 CTA 가 맞다. */}
            {gcalConfigured && !gcalCanWrite && (
              <>
                <AutoMeetingRow as="a" href="/profile/integrations" style={{ textDecoration: 'none', cursor: 'pointer' }}>
                  <AutoMeetingText>
                    <strong>
                      {personalConnected
                        ? t('form.gcalPersonalReconnectPrompt')
                        : t('form.gcalPersonalConnectPrompt')}
                    </strong>
                    <small>
                      {personalConnected
                        ? t('form.gcalPersonalReconnectHelp')
                        : t('form.gcalPersonalConnectHelp')}
                    </small>
                  </AutoMeetingText>
                </AutoMeetingRow>
                {/* 오너에게만 — 워크스페이스 연동도 권한이 없으면 그쪽도 고칠 수 있다고 알린다.
                    오너가 아니면 이 줄은 뜨지 않는다(누를 수 없는 경로를 보여주지 않기 위해). */}
                {isOwnerHere && workspaceConnected && !workspaceCanWrite && (
                  <AutoMeetingRow as="a" href="/business/settings/storage" style={{ textDecoration: 'none', cursor: 'pointer' }}>
                    <AutoMeetingText>
                      <strong>{t('form.gcalWorkspaceReconnectPrompt')}</strong>
                      <small>{t('form.gcalWorkspaceReconnectHelp')}</small>
                    </AutoMeetingText>
                  </AutoMeetingRow>
                )}
              </>
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
    </CreateDrawer>
  );
};

export default NewEventModal;

// ── styled ──
const GcalRow = styled.label<{ $disabled?: boolean }>`
  display: flex; align-items: flex-start; gap: 8px;
  padding: 6px 0; font-size: 13px; color: #334155;
  cursor: ${p => (p.$disabled ? 'not-allowed' : 'pointer')};
  opacity: ${p => (p.$disabled ? 0.55 : 1)};
`;
const GcalHint = styled.small`display:block;margin-top:2px;font-size:11.5px;color:#94A3B8;line-height:1.45;`;
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
