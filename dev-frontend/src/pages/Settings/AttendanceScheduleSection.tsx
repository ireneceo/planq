// 설정 › 근태 관리 — «근무 일정» (docs/ATTENDANCE_FIXED_SCHEDULE_DESIGN.md §5.1)
//
// 유연 근무(기본 — 지금 그대로) / 고정 근무(정한 시각보다 늦으면 지각). 바꾸면 «적용 시작» 날짜부터(내일 이후만) —
//   지난 날 판정이 바뀌지 않게 서버가 이력으로 둔다(D2). 그래서 자동저장이 아니라 [저장] 버튼이다.
// 요일별 시간 편집기는 예약 받는 시간과 같은 것(components/Common/WeekHoursEditor) — 저장하는 칸은 다르다(D1).
import React, { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../contexts/AuthContext';
import ActionButton from '../../components/Common/ActionButton';
import PlanQSelect from '../../components/Common/PlanQSelect';
import SingleDateField from '../../components/Common/SingleDateField';
import WeekHoursEditor, { DEFAULT_WEEK_HOURS, WEEK_DAYS, readWeekHours, type WeekHours } from '../../components/Common/WeekHoursEditor';
import { onSocket } from '../../services/socket';
import { useVisibilityRefresh } from '../../hooks/useVisibilityRefresh';
import MemberTrackingSwitch from './MemberTrackingSwitch';

interface SchedRow {
  id: number; user_id: number | null; effective_from: string; mode: 'flex' | 'fixed' | 'inherit' | string;
  schedule: WeekHours | null; grace_min: number; half_day_at: number | null;
}
interface SchedData {
  today: string;
  workspace: { current: SchedRow | null; upcoming?: SchedRow | null };
  members?: { user_id: number; current: SchedRow | null; upcoming: SchedRow | null; effective: string; tracked?: boolean }[];
}
interface Props { businessId: number; members: { user_id: number; name: string }[] }

const GRACE = [0, 5, 10, 15, 30];
const HALF_OPTS = Array.from({ length: 33 }, (_, i) => 8 + i / 4).filter((h) => h * 2 === Math.round(h * 2));
const hm = (h: number) => `${String(Math.floor(h)).padStart(2, '0')}:${h % 1 ? '30' : '00'}`;
const addDay = (ymd: string, n: number) => {
  const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
};

/** «월~금 09:00~18:00 · 토 10:00~14:00» — 같은 시간인 이웃 요일을 묶는다. */
function summarize(h: WeekHours | null, dayLabel: (d: string) => string): string {
  if (!h) return '';
  const parts: string[] = [];
  let i = 0;
  while (i < WEEK_DAYS.length) {
    const v = h[WEEK_DAYS[i]];
    if (!v) { i += 1; continue; }
    let j = i;
    while (j + 1 < WEEK_DAYS.length && h[WEEK_DAYS[j + 1]] && h[WEEK_DAYS[j + 1]]![0] === v[0] && h[WEEK_DAYS[j + 1]]![1] === v[1]) j += 1;
    const days = i === j ? dayLabel(WEEK_DAYS[i]) : `${dayLabel(WEEK_DAYS[i])}~${dayLabel(WEEK_DAYS[j])}`;
    parts.push(`${days} ${hm(v[0])}~${hm(v[1])}`);
    i = j + 1;
  }
  return parts.join(' · ');
}

export default function AttendanceScheduleSection({ businessId, members }: Props) {
  const { t } = useTranslation('attendance');
  const { t: ts } = useTranslation('settings');
  const dayLabel = (d: string) => ts(`entry.booking.day.${d}`);
  const [data, setData] = useState<SchedData | null>(null);
  const [mode, setMode] = useState<'flex' | 'fixed'>('flex');
  const [hours, setHours] = useState<WeekHours>(DEFAULT_WEEK_HOURS);
  const [grace, setGrace] = useState(0);
  const [halfAt, setHalfAt] = useState<number | null>(null);
  const [from, setFrom] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [editMember, setEditMember] = useState<number | null>(null);

  const describe = useCallback((r: SchedRow | null | undefined): string => {
    if (!r) return t('schedule.mode.flexShort');
    if (r.mode === 'inherit') return t('schedule.member.inherit');
    if (r.mode === 'flex') return t('schedule.mode.flexShort');
    if (r.mode === 'fixed') {
      const g = r.grace_min ? ` · ${t('schedule.graceShort', { min: r.grace_min })}` : '';
      return `${t('schedule.mode.fixedShort')} ${summarize(r.schedule, dayLabel)}${g}`;
    }
    return r.mode;   // 모르는 값은 그대로(status-values 규약)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);

  const load = useCallback(async () => {
    const r = await apiFetch(`/api/attendance/schedule?business_id=${businessId}`);
    if (!r.ok) return;
    const j = await r.json().catch(() => null);
    if (!j?.success) return;
    const d: SchedData = j.data;
    setData(d);
    // 폼은 «예정 > 지금» 값으로 채운다(예정이 있으면 그걸 고치는 게 자연스럽다)
    const base = d.workspace.upcoming || d.workspace.current;
    setMode(base?.mode === 'fixed' ? 'fixed' : 'flex');
    setHours(base?.schedule ? readWeekHours(base.schedule) : DEFAULT_WEEK_HOURS);
    setGrace(base?.grace_min || 0);
    setHalfAt(base?.half_day_at ?? null);
    setFrom((prev) => prev || d.workspace.upcoming?.effective_from || addDay(d.today, 1));
  }, [businessId]);
  useEffect(() => { void load(); }, [load]);
  useVisibilityRefresh(load);
  useEffect(() => onSocket('attendance:schedule', () => { void load(); }), [load]);

  const copyFromBooking = async () => {
    const r = await apiFetch(`/api/businesses/${businessId}`);
    const j = await r.json().catch(() => null);
    if (j?.success && j.data?.work_hours) setHours(readWeekHours(j.data.work_hours));
  };

  const errText = (code?: string) => t(`schedule.error.${code || 'generic'}`, { defaultValue: t('error.generic') });

  // autosave-exempt: 적용 날짜가 붙는 변경이라 명시 저장(설계 §5.1) — 고를 때마다 저장하면 반쯤 고친 일정이 내일부터 적용된다
  const save = async () => {
    if (saving) return;
    setSaving(true); setMsg(null);
    try {
      const r = await apiFetch('/api/attendance/schedule', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: businessId, mode, schedule: mode === 'fixed' ? hours : null, grace_min: grace, half_day_at: halfAt, effective_from: from }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.success) { setMsg({ tone: 'err', text: errText(j?.message) }); return; }
      setMsg({ tone: 'ok', text: t('schedule.appliesFrom', { date: from }) });
      await load();
    } finally { setSaving(false); }
  };
  const cancelUpcoming = async (id: number) => {
    const r = await apiFetch(`/api/attendance/schedule/${id}?business_id=${businessId}`, { method: 'DELETE' });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.success) { setMsg({ tone: 'err', text: errText(j?.message) }); return; }
    setMsg(null); setFrom(''); await load();
  };

  if (!data) return null;
  const tomorrow = addDay(data.today, 1);
  const nameOf = (uid: number) => members.find((m) => m.user_id === uid)?.name || `#${uid}`;
  const memberRows = (data.members || []).filter((m) => members.some((x) => x.user_id === m.user_id));

  return (
    <Card data-testid="attn-schedule-section">
      <Title>{t('schedule.title')}</Title>
      <Desc>{t('schedule.desc')}</Desc>
      <Radios role="radiogroup" aria-label={t('schedule.title') as string}>
        {(['flex', 'fixed'] as const).map((m) => (
          <Radio key={m} type="button" role="radio" aria-checked={mode === m} $on={mode === m}
            data-testid={`attn-schedule-mode-${m}`} onClick={() => setMode(m)}>
            <Dot $on={mode === m} />
            <span><strong>{t(`schedule.mode.${m}Short`)}</strong> — {t(`schedule.mode.${m}Desc`)}</span>
          </Radio>
        ))}
      </Radios>

      {mode === 'fixed' && (
        <Fixed>
          <Line>
            <Label>{t('schedule.hours')}</Label>
            <ActionButton tone="secondary" size="sm" onClick={copyFromBooking} data-testid="attn-schedule-copy-booking">
              {t('schedule.copyFromBooking')}
            </ActionButton>
          </Line>
          <WeekHoursEditor hours={hours} onChange={(fn) => setHours(fn)} closedLabel={t('schedule.dayOff')} testIdPrefix="attn-schedule-hours" />
          <Grid>
            <Field>
              <Label>{t('schedule.grace')}</Label>
              <PlanQSelect size="sm" options={GRACE.map((g) => ({ value: String(g), label: g ? t('schedule.graceMin', { min: g }) : t('schedule.graceNone') }))}
                value={{ value: String(grace), label: grace ? t('schedule.graceMin', { min: grace }) : t('schedule.graceNone') }}
                onChange={(o) => setGrace(Number((o as { value: string }).value))} />
            </Field>
            <Field>
              <Label>{t('schedule.halfDayAt')}</Label>
              <PlanQSelect size="sm"
                options={[{ value: '', label: t('schedule.halfAuto') }, ...HALF_OPTS.map((h) => ({ value: String(h), label: hm(h) }))]}
                value={halfAt === null ? { value: '', label: t('schedule.halfAuto') } : { value: String(halfAt), label: hm(halfAt) }}
                onChange={(o) => { const v = (o as { value: string }).value; setHalfAt(v === '' ? null : Number(v)); }} />
            </Field>
          </Grid>
          <Hint>{t('schedule.halfHint')}</Hint>
        </Fixed>
      )}

      <Line>
        <Field>
          <Label>{t('schedule.effectiveFrom')}</Label>
          <SingleDateField value={from || tomorrow} minDate={tomorrow} onChange={setFrom} />
        </Field>
        <SaveSlot>
          <ActionButton tone="primary" size="sm" loading={saving} onClick={save} data-testid="attn-schedule-save">{t('schedule.save')}</ActionButton>
        </SaveSlot>
      </Line>
      {msg && <Msg $tone={msg.tone} role={msg.tone === 'err' ? 'alert' : 'status'}>{msg.text}</Msg>}
      <Info data-testid="attn-schedule-current">
        <span>{t('schedule.current')}: <strong>{describe(data.workspace.current)}</strong></span>
        {data.workspace.upcoming && (
          <span>
            {t('schedule.upcoming', { date: data.workspace.upcoming.effective_from })}: <strong>{describe(data.workspace.upcoming)}</strong>
            {' '}<LinkBtn type="button" onClick={() => cancelUpcoming(data.workspace.upcoming!.id)} data-testid="attn-schedule-cancel">{t('schedule.cancelUpcoming')}</LinkBtn>
          </span>
        )}
      </Info>

      {memberRows.length > 0 && (
        <>
          <Sub>{t('schedule.memberTitle')}</Sub>
          <Hint>{t('schedule.memberHint')}</Hint>
          {memberRows.map((m) => (
            <MemberRow key={m.user_id} data-testid={`attn-schedule-member-${m.user_id}`}>
              <MemberHead>
                <MemberName>{nameOf(m.user_id)}</MemberName>
                <MemberDesc data-testid="attn-schedule-member-desc">
                  {m.tracked === false ? t('tracking.offDesc') : <>
                    {m.current ? describe(m.current) : t('schedule.member.inherit')}
                    {m.upcoming && ` → ${t('schedule.upcoming', { date: m.upcoming.effective_from })}: ${describe(m.upcoming)}`}
                  </>}
                </MemberDesc>
                <MemberTrackingSwitch businessId={businessId} userId={m.user_id} name={nameOf(m.user_id)}
                  tracked={m.tracked !== false} onChanged={() => { if (editMember === m.user_id) setEditMember(null); void load(); }} />
                {m.tracked !== false && (
                  <ActionButton tone="secondary" size="sm" onClick={() => setEditMember(editMember === m.user_id ? null : m.user_id)}
                    data-testid="attn-schedule-member-edit">
                    {t('schedule.member.change')}
                  </ActionButton>
                )}
              </MemberHead>
              {editMember === m.user_id && m.tracked !== false && (
                <MemberEditor businessId={businessId} userId={m.user_id} tomorrow={tomorrow}
                  base={m.upcoming || m.current} wsHours={hours}
                  onDone={async () => { setEditMember(null); await load(); }}
                  onCancelUpcoming={m.upcoming ? () => cancelUpcoming(m.upcoming!.id) : undefined} />
              )}
            </MemberRow>
          ))}
        </>
      )}
    </Card>
  );
}

const MemberEditor: React.FC<{
  businessId: number; userId: number; tomorrow: string; base: SchedRow | null; wsHours: WeekHours;
  onDone: () => void; onCancelUpcoming?: () => void;
}> = ({ businessId, userId, tomorrow, base, wsHours, onDone, onCancelUpcoming }) => {
  const { t } = useTranslation('attendance');
  const [mode, setMode] = useState<string>(base?.mode === 'flex' || base?.mode === 'fixed' ? base.mode : 'inherit');
  const [hours, setHours] = useState<WeekHours>(base?.schedule ? readWeekHours(base.schedule) : wsHours);
  const [grace, setGrace] = useState(base?.grace_min || 0);
  const [from, setFrom] = useState(base && base.effective_from >= tomorrow ? base.effective_from : tomorrow);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const opts = ['inherit', 'flex', 'fixed'].map((m) => ({ value: m, label: t(`schedule.member.${m === 'fixed' ? 'custom' : m}`) }));
  // autosave-exempt: 적용 날짜가 붙는 변경이라 명시 저장(설계 §5.1)
  const save = async () => {
    if (saving) return;
    setSaving(true); setErr(null);
    try {
      const r = await apiFetch(`/api/attendance/schedule/members/${userId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: businessId, mode, schedule: mode === 'fixed' ? hours : null, grace_min: grace, effective_from: from }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.success) { setErr(t(`schedule.error.${j?.message || 'generic'}`, { defaultValue: t('error.generic') })); return; }
      onDone();
    } finally { setSaving(false); }
  };
  return (
    <Editor>
      <Grid>
        <Field>
          <Label>{t('schedule.member.mode')}</Label>
          <PlanQSelect size="sm" options={opts} value={opts.find((o) => o.value === mode) || null}
            onChange={(o) => setMode((o as { value: string }).value)} />
        </Field>
        {mode === 'fixed' && (
          <Field>
            <Label>{t('schedule.grace')}</Label>
            <PlanQSelect size="sm" options={GRACE.map((g) => ({ value: String(g), label: g ? t('schedule.graceMin', { min: g }) : t('schedule.graceNone') }))}
              value={{ value: String(grace), label: grace ? t('schedule.graceMin', { min: grace }) : t('schedule.graceNone') }}
              onChange={(o) => setGrace(Number((o as { value: string }).value))} />
          </Field>
        )}
        <Field>
          <Label>{t('schedule.effectiveFrom')}</Label>
          <SingleDateField value={from} minDate={tomorrow} onChange={setFrom} />
        </Field>
      </Grid>
      {mode === 'fixed' && <WeekHoursEditor hours={hours} onChange={(fn) => setHours(fn)} closedLabel={t('schedule.dayOff')} testIdPrefix={`attn-schedule-m${userId}-hours`} />}
      {err && <Msg $tone="err" role="alert">{err}</Msg>}
      <Line>
        {onCancelUpcoming && <LinkBtn type="button" onClick={onCancelUpcoming}>{t('schedule.cancelUpcoming')}</LinkBtn>}
        <SaveSlot>
          <ActionButton tone="primary" size="sm" loading={saving} onClick={save} data-testid="attn-schedule-member-save">{t('schedule.save')}</ActionButton>
        </SaveSlot>
      </Line>
    </Editor>
  );
};

const Card = styled.section`background: #FFF; border: 1px solid #E2E8F0; border-radius: 12px; padding: 16px 20px; margin-bottom: 16px; display: flex; flex-direction: column; gap: 10px;`;
const Title = styled.div`font-size: 0.9375rem; font-weight: 700; color: #0F172A;`;
const Desc = styled.div`font-size: 0.75rem; color: #64748B; line-height: 1.5;`;
const Radios = styled.div`display: flex; flex-direction: column; gap: 6px;`;
const Radio = styled.button<{ $on: boolean }>`
  display: flex; align-items: center; gap: 10px; text-align: left; padding: 10px 12px; min-height: 44px;
  border-radius: 10px; cursor: pointer; font-size: 0.8125rem; color: #334155; background: #fff;
  border: 1px solid ${(p) => (p.$on ? '#14B8A6' : '#E2E8F0')};
  ${(p) => (p.$on ? 'background:#F0FDFA;' : '')}
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 2px; }
`;
const Dot = styled.span<{ $on: boolean }>`
  flex: 0 0 14px; aspect-ratio: 1 / 1; border-radius: 50%; border: 2px solid ${(p) => (p.$on ? '#0F766E' : '#CBD5E1')};
  box-shadow: inset 0 0 0 2px #fff; background: ${(p) => (p.$on ? '#0F766E' : '#fff')};
`;
const Fixed = styled.div`display: flex; flex-direction: column; gap: 10px; padding: 12px; border-radius: 10px; background: #F8FAFC;`;
const Line = styled.div`display: flex; align-items: flex-end; gap: 12px; flex-wrap: wrap;`;
const Grid = styled.div`display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px;`;
const Field = styled.div`display: flex; flex-direction: column; gap: 6px; min-width: 0;`;
const Label = styled.div`font-size: 0.75rem; font-weight: 600; color: #475569;`;
const Hint = styled.div`font-size: 0.6875rem; color: #94A3B8; line-height: 1.5;`;
const SaveSlot = styled.div`margin-left: auto;`;
const Msg = styled.div<{ $tone: 'ok' | 'err' }>`font-size: 0.75rem; color: ${(p) => (p.$tone === 'ok' ? '#0F766E' : '#BE123C')};`;
const Info = styled.div`display: flex; flex-direction: column; gap: 4px; font-size: 0.75rem; color: #475569; padding-top: 6px; border-top: 1px solid #F1F5F9;`;
const LinkBtn = styled.button`
  background: none; border: none; padding: 0; color: #0F766E; font-size: 0.75rem; font-weight: 600; cursor: pointer; text-decoration: underline;
`;
const Sub = styled.div`margin-top: 6px; font-size: 0.8125rem; font-weight: 700; color: #0F172A;`;
const MemberRow = styled.div`border: 1px solid #F1F5F9; border-radius: 10px; padding: 8px 12px;`;
const MemberHead = styled.div`display: flex; align-items: center; gap: 10px; min-height: 36px; flex-wrap: wrap;
  @media (max-width: 640px) { gap: 6px 10px; }`;
const MemberName = styled.div`flex: 0 0 auto; font-size: 0.8125rem; font-weight: 600; color: #0F172A;`;
const MemberDesc = styled.div`flex: 1 1 160px; min-width: 0; font-size: 0.75rem; color: #64748B; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`;
const Editor = styled.div`display: flex; flex-direction: column; gap: 10px; padding: 10px 0 4px;`;
