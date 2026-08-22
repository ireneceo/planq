// /attendance — 근태 (#208 · #285). 설계: docs/ATTENDANCE_LEAVE_DESIGN.md §9.3
//
// 탭 3개. "팀 관리" 는 owner/admin 에게만 보인다 — 남의 근무시간은 관리 목적으로만 열린다(§6).
// 신청·부여는 제출형 폼이라 저장 버튼을 쓴다(자동저장 예외 — 청구서 작성과 같은 분류).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import PageShell from '../../components/Layout/PageShell';
import ActionButton from '../../components/Common/ActionButton';
import PlanQSelect from '../../components/Common/PlanQSelect';
import SingleDateField from '../../components/Common/SingleDateField';
import DetailDrawer from '../../components/Common/DetailDrawer';
import AttendanceWidget from '../../components/Attendance/AttendanceWidget';
import { useAuth, apiFetch } from '../../contexts/AuthContext';
import { ATTENDANCE_REFRESH_EVENT, formatHours, type AttendanceDay } from '../../hooks/useAttendance';
import { joinRoom, leaveRoom, onSocket } from '../../services/socket';
import { useVisibilityRefresh } from '../../hooks/useVisibilityRefresh';

type Tab = 'my' | 'leave' | 'team';

interface LeaveRequestRow {
  id: number; user_id: number; leave_type: 'paid' | 'unpaid';
  unit: 'full_day' | 'half_day' | 'hours';
  start_date: string; end_date: string; half_kind: 'am' | 'pm' | null; hours: number | null;
  days_charged: number; reason: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'canceled';
  decide_note: string | null;
}
interface Balance { year: number; granted: number; used: number; pending: number; remaining: number }
interface PresenceRow { user_id: number; state: string | null; on_leave_today: boolean }

const AttendancePage: React.FC = () => {
  const { t } = useTranslation('attendance');
  const { user } = useAuth();
  const bizId = user?.business_id ? Number(user.business_id) : null;
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'my';

  // 관리자 여부 — /team 을 실제로 호출해서 판정하지 않고, 서버가 준 역할로 본다.
  const isManager = user?.business_role === 'owner' || user?.business_role === 'admin' || user?.platform_role === 'platform_admin';

  const [days, setDays] = useState<AttendanceDay[]>([]);
  const [requests, setRequests] = useState<LeaveRequestRow[]>([]);
  const [allRequests, setAllRequests] = useState<LeaveRequestRow[]>([]);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [presence, setPresence] = useState<PresenceRow[]>([]);
  const [teamDays, setTeamDays] = useState<AttendanceDay[]>([]);
  const [members, setMembers] = useState<{ user_id: number; name: string }[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const year = new Date().getFullYear();
  const todayStr = new Date().toISOString().slice(0, 10);
  const [teamDate, setTeamDate] = useState(todayStr);

  const setTab = (next: Tab) => {
    const p = new URLSearchParams(params);
    p.set('tab', next);
    setParams(p, { replace: true });
  };

  const silentLoad = useCallback(async () => {
    if (!bizId) return;
    const get = async (url: string) => {
      const r = await apiFetch(url);
      if (!r.ok) return null;                       // apiFetch 는 throw 하지 않는다
      const j = await r.json().catch(() => null);
      return j?.success ? j.data : null;
    };
    const [d, req, bal] = await Promise.all([
      get(`/api/attendance/my?business_id=${bizId}&limit=60`),
      get(`/api/leave/requests?business_id=${bizId}&limit=100`),
      get(`/api/leave/balance?business_id=${bizId}&year=${year}`),
    ]);
    if (d) setDays(d);
    if (req) setRequests(req);
    if (bal) setBalance(bal);
    if (isManager) {
      const [pres, all, team] = await Promise.all([
        get(`/api/attendance/presence?business_id=${bizId}`),
        get(`/api/leave/requests?business_id=${bizId}&scope=all&limit=200`),
        get(`/api/attendance/team?business_id=${bizId}&date=${teamDate}`),
      ]);
      if (pres) setPresence(pres);
      if (all) setAllRequests(all);
      if (team) setTeamDays(team);
    }
  }, [bizId, year, isManager, teamDate]);

  useEffect(() => { void silentLoad(); }, [silentLoad]);
  useVisibilityRefresh(silentLoad);

  // 다른 사람이 출근하거나 휴가를 신청하면 새로고침 없이 반영된다(CLAUDE.md §16).
  useEffect(() => {
    if (!bizId) return;
    const room = `business:${bizId}`;
    joinRoom(room);
    let timer: number | null = null;
    const debounced = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => { void silentLoad(); }, 250);
    };
    const offA = onSocket('attendance:updated', debounced);
    const offL = onSocket('leave:updated', debounced);
    window.addEventListener(ATTENDANCE_REFRESH_EVENT, debounced);
    return () => {
      if (timer) window.clearTimeout(timer);
      offA(); offL(); leaveRoom(room);
      window.removeEventListener(ATTENDANCE_REFRESH_EVENT, debounced);
    };
  }, [bizId, silentLoad]);

  // 멤버 이름 — 팀 화면에서 user_id 만 보여줄 수는 없다.
  useEffect(() => {
    if (!bizId || !isManager) return;
    (async () => {
      const r = await apiFetch(`/api/businesses/${bizId}/members`);
      if (!r.ok) return;
      const j = await r.json().catch(() => null);
      if (!j?.success) return;
      const list = (j.data || []) as { user_id: number; name?: string; user?: { name?: string } }[];
      setMembers(list.map((m) => ({ user_id: m.user_id, name: m.name || m.user?.name || `#${m.user_id}` })));
    })();
  }, [bizId, isManager]);

  const nameOf = useCallback((uid: number) => members.find((m) => m.user_id === uid)?.name || `#${uid}`, [members]);

  const weekSummary = useMemo(() => {
    const monday = (() => {
      const d = new Date();
      const w = (d.getDay() + 6) % 7;
      d.setDate(d.getDate() - w);
      return d.toISOString().slice(0, 10);
    })();
    const inWeek = days.filter((d) => d.work_date >= monday);
    const work = inWeek.reduce((s, d) => s + d.work_sec, 0);
    const brk = inWeek.reduce((s, d) => s + d.break_sec, 0);
    const leave = requests
      .filter((r) => r.status === 'approved' && r.end_date >= monday)
      .reduce((s, r) => s + Number(r.days_charged || 0), 0);
    return { work, brk, leave };
  }, [days, requests]);

  const decide = async (id: number, action: 'approve' | 'reject' | 'cancel') => {
    setError(null);
    const r = await apiFetch(`/api/leave/requests/${id}/${action}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
    });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.success) { setError(j?.message || 'generic'); return; }
    await silentLoad();
  };

  if (!bizId) return null;

  return (
    <PageShell title={t('page.title')}>
      <Tabs role="tablist">
        <TabBtn role="tab" $on={tab === 'my'} onClick={() => setTab('my')}>{t('tabs.my')}</TabBtn>
        <TabBtn role="tab" $on={tab === 'leave'} onClick={() => setTab('leave')}>{t('tabs.leave')}</TabBtn>
        {isManager && <TabBtn role="tab" $on={tab === 'team'} onClick={() => setTab('team')}>{t('tabs.team')}</TabBtn>}
      </Tabs>

      {error && <ErrorBar role="alert">{t(`error.${error}`, { defaultValue: t('error.generic') as string }) as string}</ErrorBar>}

      {tab === 'my' && (
        <>
          <TopRow>
            <WidgetSlot><AttendanceWidget variant="card" /></WidgetSlot>
            <SummaryChip>
              {t('my.weekSummary', {
                work: formatHours(weekSummary.work),
                brk: formatHours(weekSummary.brk),
                leave: weekSummary.leave,
              })}
            </SummaryChip>
          </TopRow>
          {days.length === 0 ? (
            <Empty>{t('my.empty')}</Empty>
          ) : (
            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <Th>{t('my.date')}</Th><Th>{t('my.in')}</Th><Th>{t('my.out')}</Th>
                    <Th>{t('my.break')}</Th><Th>{t('my.work')}</Th><Th>{t('my.status')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {days.map((d) => (
                    <tr key={d.id}>
                      <Td>{d.work_date}</Td>
                      <Td>{hhmm(d.clock_in_at)}</Td>
                      <Td>{d.clock_out_at ? hhmm(d.clock_out_at) : <Muted>{t('my.inProgress')}</Muted>}</Td>
                      <Td>{formatHours(d.break_sec)}</Td>
                      <Td><strong>{formatHours(d.work_sec)}</strong></Td>
                      <Td>
                        {d.auto_closed && <Badge $tone="warn" title={t('my.autoClosedHint') as string}>{t('my.autoClosed')}</Badge>}
                        {d.admin_fixed && <Badge $tone="info">{t('my.adminFixed')}</Badge>}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          )}
        </>
      )}

      {tab === 'leave' && (
        <>
          <BalanceCard>
            <BalanceTitle>{t('leave.balanceTitle', { year })}</BalanceTitle>
            <BalanceRow>
              <BalanceItem><span>{t('leave.granted')}</span><b>{balance?.granted ?? 0}</b></BalanceItem>
              <BalanceItem><span>{t('leave.used')}</span><b>{balance?.used ?? 0}</b></BalanceItem>
              <BalanceItem><span>{t('leave.pending')}</span><b>{balance?.pending ?? 0}</b></BalanceItem>
              <BalanceItem $accent><span>{t('leave.remaining')}</span><b>{balance?.remaining ?? 0}</b></BalanceItem>
            </BalanceRow>
            <ActionButton tone="primary" size="md" data-testid="leave-new" onClick={() => setDrawerOpen(true)}>
              + {t('leave.new')}
            </ActionButton>
          </BalanceCard>
          {requests.length === 0 ? (
            <Empty>{t('leave.empty')}</Empty>
          ) : (
            <List>
              {requests.map((r) => (
                <Row key={r.id}>
                  <RowMain>
                    <RowTitle>{r.start_date}{r.end_date !== r.start_date ? ` ~ ${r.end_date}` : ''}</RowTitle>
                    <RowMeta>
                      {t(`leave.${r.leave_type}`)} · {t(`leave.${unitKey(r.unit)}`)}
                      {r.status === 'approved' && ` · ${t('leave.chargedDays', { days: r.days_charged })}`}
                      {r.reason ? ` · ${r.reason}` : ''}
                    </RowMeta>
                  </RowMain>
                  <StatusBadge $s={r.status}>{t(`leave.status.${r.status}`)}</StatusBadge>
                  {(r.status === 'pending' || r.status === 'approved') && (
                    <ActionButton tone="secondary" size="sm" onClick={() => decide(r.id, 'cancel')}>
                      {t('leave.cancel')}
                    </ActionButton>
                  )}
                </Row>
              ))}
            </List>
          )}
        </>
      )}

      {tab === 'team' && isManager && (
        <TeamTab
          presence={presence} teamDays={teamDays} allRequests={allRequests}
          nameOf={nameOf} members={members} bizId={bizId} year={year}
          teamDate={teamDate} setTeamDate={setTeamDate}
          onDecide={decide} onReload={silentLoad}
        />
      )}

      <LeaveRequestDrawer
        open={drawerOpen} onClose={() => setDrawerOpen(false)}
        bizId={bizId} onDone={silentLoad}
      />
    </PageShell>
  );
};

export default AttendancePage;

// ─── 팀 관리 탭 ─────────────────────────────────────────────────
const TeamTab: React.FC<{
  presence: PresenceRow[]; teamDays: AttendanceDay[]; allRequests: LeaveRequestRow[];
  nameOf: (id: number) => string; members: { user_id: number; name: string }[];
  bizId: number; year: number; teamDate: string; setTeamDate: (v: string) => void;
  onDecide: (id: number, a: 'approve' | 'reject' | 'cancel') => void;
  onReload: () => Promise<void>;
}> = ({ presence, teamDays, allRequests, nameOf, members, bizId, year, teamDate, setTeamDate, onDecide, onReload }) => {
  const { t } = useTranslation('attendance');
  const pending = allRequests.filter((r) => r.status === 'pending');
  const [grantUser, setGrantUser] = useState<number | null>(null);
  const [grantDays, setGrantDays] = useState('15');
  const [grantNote, setGrantNote] = useState('');
  const [saving, setSaving] = useState(false);

  const submitGrant = async () => {
    if (!grantUser || saving) return;
    setSaving(true);
    try {
      const r = await apiFetch('/api/leave/grants', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: bizId, user_id: grantUser, year, days: Number(grantDays), note: grantNote }),
      });
      if (r.ok) { setGrantNote(''); await onReload(); }
    } finally { setSaving(false); }
  };

  return (
    <>
      <Section>
        <SectionTitle>{t('team.presence')}</SectionTitle>
        <PresenceWrap>
          {presence.map((p) => (
            <PresenceChip key={p.user_id} $state={p.on_leave_today ? 'leave' : p.state}>
              <Dot $state={p.on_leave_today ? 'leave' : p.state} />
              {nameOf(p.user_id)}
              <PresenceState>
                {p.on_leave_today ? t('widget.onLeaveToday') : t(`state.${p.state || 'none'}`)}
              </PresenceState>
            </PresenceChip>
          ))}
        </PresenceWrap>
      </Section>

      <Section>
        <SectionTitle>{t('leave.new')} — {t('leave.status.pending')}</SectionTitle>
        {pending.length === 0 ? <Empty>{t('leave.noPending')}</Empty> : (
          <List>
            {pending.map((r) => (
              <Row key={r.id}>
                <RowMain>
                  <RowTitle>{nameOf(r.user_id)} · {r.start_date}{r.end_date !== r.start_date ? ` ~ ${r.end_date}` : ''}</RowTitle>
                  <RowMeta>{t(`leave.${r.leave_type}`)} · {t(`leave.${unitKey(r.unit)}`)}{r.reason ? ` · ${r.reason}` : ''}</RowMeta>
                </RowMain>
                <ActionButton tone="primary" size="sm" onClick={() => onDecide(r.id, 'approve')}>{t('leave.approve')}</ActionButton>
                <ActionButton tone="danger" size="sm" onClick={() => onDecide(r.id, 'reject')}>{t('leave.reject')}</ActionButton>
              </Row>
            ))}
          </List>
        )}
      </Section>

      <Section>
        <SectionTitle>{t('leave.grantTitle')}</SectionTitle>
        <GrantForm>
          <PlanQSelect
            size="sm"
            options={members.map((m) => ({ value: m.user_id, label: m.name }))}
            value={grantUser ? { value: grantUser, label: nameOf(grantUser) } : null}
            onChange={(opt) => setGrantUser(opt ? Number((opt as { value: number }).value) : null)}
            placeholder={t('team.member') as string}
          />
          <NumInput type="number" step="0.5" value={grantDays} onChange={(e) => setGrantDays(e.target.value)}
            aria-label={t('leave.grantDays') as string} />
          <TextInput value={grantNote} onChange={(e) => setGrantNote(e.target.value)}
            placeholder={t('leave.grantNote') as string} />
          <ActionButton tone="primary" size="sm" loading={saving} onClick={submitGrant}>{t('leave.grantSubmit')}</ActionButton>
        </GrantForm>
        <Hint>{t('leave.grantHint')}</Hint>
      </Section>

      <Section>
        <SectionTitle>{t('team.records')}</SectionTitle>
        <SingleDateField value={teamDate} onChange={setTeamDate} />
        {teamDays.length === 0 ? <Empty>{t('team.noRecords')}</Empty> : (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>{t('team.member')}</Th><Th>{t('my.in')}</Th><Th>{t('my.out')}</Th>
                  <Th>{t('my.break')}</Th><Th>{t('my.work')}</Th><Th>{t('my.status')}</Th>
                </tr>
              </thead>
              <tbody>
                {teamDays.map((d) => (
                  <tr key={d.id}>
                    <Td>{nameOf(d.user_id)}</Td>
                    <Td>{hhmm(d.clock_in_at)}</Td>
                    <Td>{d.clock_out_at ? hhmm(d.clock_out_at) : <Muted>{t('my.inProgress')}</Muted>}</Td>
                    <Td>{formatHours(d.break_sec)}</Td>
                    <Td><strong>{formatHours(d.work_sec)}</strong></Td>
                    <Td>{d.auto_closed && <Badge $tone="warn">{t('my.autoClosed')}</Badge>}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        )}
      </Section>
    </>
  );
};

// ─── 신청 드로어 ────────────────────────────────────────────────
const LeaveRequestDrawer: React.FC<{ open: boolean; onClose: () => void; bizId: number; onDone: () => Promise<void> }> =
({ open, onClose, bizId, onDone }) => {
  const { t } = useTranslation('attendance');
  const today = new Date().toISOString().slice(0, 10);
  const [leaveType, setLeaveType] = useState<'paid' | 'unpaid'>('paid');
  const [unit, setUnit] = useState<'full_day' | 'half_day' | 'hours'>('full_day');
  const [halfKind, setHalfKind] = useState<'am' | 'pm'>('am');
  const [hours, setHours] = useState('2');
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (saving) return;
    setSaving(true); setErr(null);
    try {
      const r = await apiFetch('/api/leave/requests', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: bizId, leave_type: leaveType, unit,
          start_date: start, end_date: unit === 'full_day' ? end : start,
          half_kind: unit === 'half_day' ? halfKind : undefined,
          hours: unit === 'hours' ? Number(hours) : undefined,
          reason,
        }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.success) { setErr(j?.message || 'generic'); return; }
      await onDone();
      setReason('');
      onClose();
    } finally { setSaving(false); }
  };

  const typeOpts = [
    { value: 'paid', label: t('leave.paid') as string },
    { value: 'unpaid', label: t('leave.unpaid') as string },
  ];
  const unitOpts = [
    { value: 'full_day', label: t('leave.fullDay') as string },
    { value: 'half_day', label: t('leave.halfDay') as string },
    { value: 'hours', label: t('leave.hours') as string },
  ];
  const halfOpts = [
    { value: 'am', label: t('leave.am') as string },
    { value: 'pm', label: t('leave.pm') as string },
  ];

  return (
    <DetailDrawer open={open} onClose={onClose} width={440} ariaLabel={t('leave.new') as string}>
      <DetailDrawer.Header onClose={onClose}>{t('leave.new')}</DetailDrawer.Header>
      <DetailDrawer.Body>
        <Field>
          <FieldLabel>{t('leave.type')}</FieldLabel>
          <PlanQSelect size="md" options={typeOpts}
            value={typeOpts.find((o) => o.value === leaveType) || null}
            onChange={(o) => setLeaveType(((o as { value: string })?.value as 'paid' | 'unpaid') || 'paid')} />
        </Field>
        <Field>
          <FieldLabel>{t('leave.unit')}</FieldLabel>
          <PlanQSelect size="md" options={unitOpts}
            value={unitOpts.find((o) => o.value === unit) || null}
            onChange={(o) => setUnit(((o as { value: string })?.value as typeof unit) || 'full_day')} />
        </Field>
        <Field>
          <FieldLabel>{t('leave.startDate')}</FieldLabel>
          <SingleDateField value={start} onChange={(v) => { setStart(v); if (v > end) setEnd(v); }} size="md" />
        </Field>
        {unit === 'full_day' && (
          <Field>
            <FieldLabel>{t('leave.endDate')}</FieldLabel>
            <SingleDateField value={end} onChange={setEnd} minDate={start} size="md" />
          </Field>
        )}
        {unit === 'half_day' && (
          <Field>
            <FieldLabel>{t('leave.halfDay')}</FieldLabel>
            <PlanQSelect size="md" options={halfOpts}
              value={halfOpts.find((o) => o.value === halfKind) || null}
              onChange={(o) => setHalfKind(((o as { value: string })?.value as 'am' | 'pm') || 'am')} />
          </Field>
        )}
        {unit === 'hours' && (
          <Field>
            <FieldLabel>{t('leave.hoursCount')}</FieldLabel>
            <NumInput type="number" step="0.5" min="0.5" value={hours} onChange={(e) => setHours(e.target.value)} />
          </Field>
        )}
        <Field>
          <FieldLabel>{t('leave.reason')}</FieldLabel>
          <TextArea value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder={t('leave.reasonPlaceholder') as string} rows={3} />
        </Field>
        {err && <ErrorBar role="alert">{t(`error.${err}`, { defaultValue: t('error.generic') as string }) as string}</ErrorBar>}
      </DetailDrawer.Body>
      <DetailDrawer.Footer>
        <ActionButton tone="secondary" size="md" onClick={onClose}>{t('leave.cancel')}</ActionButton>
        <ActionButton tone="primary" size="md" loading={saving} onClick={submit} data-testid="leave-submit">
          {t('leave.submit')}
        </ActionButton>
      </DetailDrawer.Footer>
    </DetailDrawer>
  );
};

// ─── utils ──────────────────────────────────────────────────────
function hhmm(iso: string | null): string {
  if (!iso) return '–';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function unitKey(u: 'full_day' | 'half_day' | 'hours'): string {
  return u === 'full_day' ? 'fullDay' : u === 'half_day' ? 'halfDay' : 'hours';
}

// ─── styled ─────────────────────────────────────────────────────
const Tabs = styled.div` display: flex; gap: 4px; margin-bottom: 16px; border-bottom: 1px solid #E2E8F0; `;
const TabBtn = styled.button<{ $on: boolean }>`
  padding: 8px 14px; background: transparent; border: none; cursor: pointer;
  font-size: 13px; font-weight: ${p => (p.$on ? 700 : 500)};
  color: ${p => (p.$on ? '#0F172A' : '#64748B')};
  border-bottom: 2px solid ${p => (p.$on ? '#F43F5E' : 'transparent')};
  margin-bottom: -1px;
  &:hover { color: #0F172A; }
`;
const TopRow = styled.div`
  display: flex; gap: 12px; align-items: stretch; margin-bottom: 16px; flex-wrap: wrap;
`;
const WidgetSlot = styled.div` flex: 1 1 280px; min-width: 0; `;
const SummaryChip = styled.div`
  display: flex; align-items: center; padding: 14px 16px;
  background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 12px;
  font-size: 13px; font-weight: 600; color: #334155;
`;
const Section = styled.section` margin-bottom: 24px; `;
const SectionTitle = styled.h3` margin: 0 0 10px; font-size: 14px; font-weight: 700; color: #0F172A; `;
const Empty = styled.div` padding: 28px; text-align: center; color: #94A3B8; font-size: 13px; `;
const TableWrap = styled.div` overflow-x: auto; border: 1px solid #E2E8F0; border-radius: 10px; background: #fff; `;
const Table = styled.table` width: 100%; border-collapse: collapse; font-size: 13px; `;
const Th = styled.th`
  text-align: left; padding: 10px 12px; background: #F8FAFC;
  font-size: 11px; font-weight: 700; color: #64748B; white-space: nowrap;
  border-bottom: 1px solid #E2E8F0;
`;
const Td = styled.td` padding: 10px 12px; border-bottom: 1px solid #F1F5F9; color: #334155; white-space: nowrap; `;
const Muted = styled.span` color: #94A3B8; `;
const Badge = styled.span<{ $tone: 'warn' | 'info' }>`
  display: inline-block; padding: 2px 7px; border-radius: 999px; margin-right: 4px;
  font-size: 11px; font-weight: 600;
  background: ${p => (p.$tone === 'warn' ? '#FEF3C7' : '#E0F2FE')};
  color: ${p => (p.$tone === 'warn' ? '#92400E' : '#075985')};
`;
const BalanceCard = styled.div`
  display: flex; flex-direction: column; gap: 12px; padding: 16px;
  background: #fff; border: 1px solid #E2E8F0; border-radius: 12px; margin-bottom: 16px;
`;
const BalanceTitle = styled.div` font-size: 13px; font-weight: 700; color: #0F172A; `;
const BalanceRow = styled.div` display: flex; gap: 20px; flex-wrap: wrap; `;
const BalanceItem = styled.div<{ $accent?: boolean }>`
  display: flex; flex-direction: column; gap: 2px;
  span { font-size: 11px; color: #64748B; }
  b { font-size: 20px; font-weight: 700; color: ${p => (p.$accent ? '#F43F5E' : '#0F172A')}; }
`;
const List = styled.div` display: flex; flex-direction: column; gap: 8px; `;
const Row = styled.div`
  display: flex; align-items: center; gap: 10px; padding: 12px 14px;
  background: #fff; border: 1px solid #E2E8F0; border-radius: 10px;
`;
const RowMain = styled.div` flex: 1; min-width: 0; `;
const RowTitle = styled.div` font-size: 13px; font-weight: 600; color: #0F172A; `;
const RowMeta = styled.div` font-size: 12px; color: #64748B; margin-top: 2px; `;
const StatusBadge = styled.span<{ $s: string }>`
  padding: 3px 9px; border-radius: 999px; font-size: 11px; font-weight: 700; white-space: nowrap;
  background: ${p => ({ pending: '#FEF3C7', approved: '#DCFCE7', rejected: '#FEE2E2', canceled: '#F1F5F9' }[p.$s] || '#F1F5F9')};
  color: ${p => ({ pending: '#92400E', approved: '#166534', rejected: '#991B1B', canceled: '#64748B' }[p.$s] || '#64748B')};
`;
const PresenceWrap = styled.div` display: flex; flex-wrap: wrap; gap: 8px; `;
const PresenceChip = styled.div<{ $state: string | null }>`
  display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px;
  background: #fff; border: 1px solid #E2E8F0; border-radius: 999px;
  font-size: 12px; font-weight: 600; color: #334155;
`;
const PresenceState = styled.span` font-weight: 500; color: #94A3B8; `;
const Dot = styled.span<{ $state: string | null }>`
  width: 7px; height: 7px; border-radius: 50%;
  background: ${p => ({ working: '#10B981', on_break: '#F59E0B', done: '#94A3B8', leave: '#6366F1' }[p.$state || ''] || '#CBD5E1')};
`;
const GrantForm = styled.div`
  display: grid; grid-template-columns: minmax(140px, 1fr) 90px minmax(140px, 1.4fr) auto;
  gap: 8px; align-items: center;
  @media (max-width: 640px) { grid-template-columns: 1fr; }
`;
const Hint = styled.div` margin-top: 6px; font-size: 11px; color: #94A3B8; `;
const Field = styled.div` margin-bottom: 14px; `;
const FieldLabel = styled.label` display: block; margin-bottom: 6px; font-size: 12px; font-weight: 600; color: #475569; `;
const inputCss = `
  width: 100%; padding: 10px 12px; border: 1px solid #CBD5E1; border-radius: 8px;
  font-size: 14px; color: #0F172A; background: #fff;
  &:focus { outline: none; border-color: #F43F5E; box-shadow: 0 0 0 3px rgba(244,63,94,0.12); }
`;
const NumInput = styled.input`${inputCss}`;
const TextInput = styled.input`${inputCss}`;
const TextArea = styled.textarea`${inputCss} resize: vertical;`;
const ErrorBar = styled.div`
  padding: 10px 12px; margin-bottom: 12px;
  background: #FEE2E2; border: 1px solid #FECACA; border-radius: 8px;
  font-size: 12px; color: #991B1B;
`;
