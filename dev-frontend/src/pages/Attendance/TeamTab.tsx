// 근태 — 팀 관리 탭 (#208). AttendancePage 에서 분리(컴포넌트 800줄 가드).
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import ActionButton from '../../components/Common/ActionButton';
import PlanQSelect from '../../components/Common/PlanQSelect';
import { useLeaveTypes, labelOf } from './leaveTypes';
import SingleDateField from '../../components/Common/SingleDateField';
import { apiFetch } from '../../contexts/AuthContext';
import { formatHours, type AttendanceDay } from '../../hooks/useAttendance';
import { useRevealSelectedRow } from '../../hooks/useRevealSelectedRow';
import {
  type LeaveRequestRow, type PresenceRow, type StatRow, hhmm, unitKey, shiftMonth,
  Section, SectionTitle, Empty, TableWrap, Table, Th, Td, Muted, Badge,
  List, HighlightRow, RowMain, RowTitle, RowMeta, Hint, NumInput, TextInput,
} from './shared';

const DecidedNote = styled.div`
  margin-bottom: 10px; padding: 10px 12px; border-radius: 8px;
  background: #F1F5F9; border: 1px solid #E2E8F0;
  font-size: 0.8125rem; color: #475569; line-height: 1.5;
`;

// ─── 팀 관리 탭 ─────────────────────────────────────────────────
export const TeamTab: React.FC<{
  presence: PresenceRow[]; teamDays: AttendanceDay[]; allRequests: LeaveRequestRow[];
  nameOf: (id: number) => string; members: { user_id: number; name: string }[];
  bizId: number; year: number; teamDate: string; setTeamDate: (v: string) => void;
  stats: StatRow[]; statMonth: string; setStatMonth: (v: string) => void;
  onFix: (d: AttendanceDay) => void;
  onDecide: (id: number, a: 'approve' | 'reject' | 'cancel') => void;
  // 알림 링크(`?leave=<id>`)로 들어왔을 때 가리킬 신청. 화면이 URL 을 직접 읽지 않는다 —
  //   부모가 파라미터를 쥐고 내려 준다(같은 파라미터를 두 곳에서 읽으면 갈라진다).
  highlightLeaveId?: number | null;
  onReload: () => Promise<void>;
}> = ({ presence, teamDays, allRequests, nameOf, members, bizId, year, teamDate, setTeamDate,
        stats, statMonth, setStatMonth, onFix, onDecide, onReload, highlightLeaveId }) => {
  const { t } = useTranslation('attendance');
  const pending = allRequests.filter((r) => r.status === 'pending');
  // 알림에서 들어온 신청이 **이미 처리됐으면** 대기 목록에 없다 → 링크가 막다른 길이 된다
  //   (사용자에게는 «알림은 오는데 화면이 안 뜬다» 로 보인다 — 신고 #424 의 절반이 이것이다).
  //   그래서 처리된 건은 결과를 한 줄로 알려 준다.
  const linked = highlightLeaveId ? allRequests.find((r) => r.id === highlightLeaveId) : null;
  const linkedDecided = linked && linked.status !== 'pending' ? linked : null;
  // 목록 안에서 보이게 — 공용 훅(화면마다 스크롤 코드를 쓰지 않는다)
  useRevealSelectedRow(highlightLeaveId ?? null);
  const [grantUser, setGrantUser] = useState<number | null>(null);
  const [grantDays, setGrantDays] = useState('');
  // ★ 휴가 **종류**(2026-10-22 — 회사가 정한 목록, 설정 › 근태 관리 맨 위 «휴가 설정»).
  //   부여는 **유급** 종류에만 한다(무급은 잔여가 없다). 잔여도 종류별로 따로 계산된다(서버 getBalance).
  //   종류를 고르면 일수 칸을 그 종류의 «연간 기본 일수» 로 채운다 — 단 사람이 이미 친 값은 덮지 않는다
  //   (시스템이 채운 값 ≠ 사용자 입력).
  const { types: allTypes } = useLeaveTypes(bizId);
  const paidTypes = allTypes.filter((x) => x.pay === 'paid');
  const [grantTypeId, setGrantTypeId] = useState<number | null>(null);
  const [daysTouched, setDaysTouched] = useState(false);
  const pickGrantType = (id: number | null) => {
    setGrantTypeId(id);
    const d = paidTypes.find((x) => x.id === id)?.default_days;
    if (!daysTouched) setGrantDays(d === null || d === undefined ? '' : String(d));
  };
  React.useEffect(() => {
    if (!paidTypes.length) return;
    if (!grantTypeId || !paidTypes.some((x) => x.id === grantTypeId)) pickGrantType(paidTypes[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allTypes]);
  const [grantNote, setGrantNote] = useState('');
  const [saving, setSaving] = useState(false);

  const submitGrant = async () => {
    if (!grantUser || !grantTypeId || grantDays === '' || saving) return;
    setSaving(true);
    try {
      const r = await apiFetch('/api/leave/grants', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: bizId, user_id: grantUser, year, days: Number(grantDays), leave_type_id: grantTypeId, note: grantNote }),
      });
      if (r.ok) { setGrantNote(''); setDaysTouched(false); await onReload(); }
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
        {linkedDecided && (
          <DecidedNote role="status" data-testid="leave-linked-decided">
            {t(`leave.linkedDecided.${linkedDecided.status}`, {
              name: nameOf(linkedDecided.user_id),
              date: linkedDecided.start_date,
              defaultValue: '{{name}} · {{date}} 신청은 이미 처리됐습니다.',
            })}
          </DecidedNote>
        )}
        {pending.length === 0 ? <Empty>{t('leave.noPending')}</Empty> : (
          <List>
            {pending.map((r) => (
              <HighlightRow key={r.id} data-row-id={r.id} $highlight={r.id === highlightLeaveId}>
                <RowMain>
                  <RowTitle>{nameOf(r.user_id)} · {r.start_date}{r.end_date !== r.start_date ? ` ~ ${r.end_date}` : ''}</RowTitle>
                  <RowMeta>{r.type ? `${labelOf(r.type, t)} · ` : ''}{t(`leave.${r.leave_type}`)} · {t(`leave.${unitKey(r.unit)}`)}{r.reason ? ` · ${r.reason}` : ''}</RowMeta>
                </RowMain>
                <ActionButton tone="primary" size="sm" onClick={() => onDecide(r.id, 'approve')}>{t('leave.approve')}</ActionButton>
                <ActionButton tone="danger" size="sm" onClick={() => onDecide(r.id, 'reject')}>{t('leave.reject')}</ActionButton>
              </HighlightRow>
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
          <PlanQSelect
            size="sm"
            options={paidTypes.map((x) => ({ value: x.id, label: labelOf(x, t) }))}
            value={paidTypes.filter((x) => x.id === grantTypeId).map((x) => ({ value: x.id, label: labelOf(x, t) }))[0] || null}
            onChange={(opt) => pickGrantType(Number((opt as { value: number } | null)?.value) || null)}
            aria-label={t('leave.categoryLabel', { defaultValue: '휴가 종류' }) as string}
          />
          <NumInput type="number" step="0.5" value={grantDays} data-testid="leave-grant-days"
            onChange={(e) => { setGrantDays(e.target.value); setDaysTouched(true); }}
            placeholder={t('leave.grantDays') as string}
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
                    <Td>
                      {d.auto_closed && <Badge $tone="warn">{t('my.autoClosed')}</Badge>}
                      {d.admin_fixed && <Badge $tone="info">{t('my.adminFixed')}</Badge>}
                      <ActionButton tone="secondary" size="sm" onClick={() => onFix(d)} data-testid="attn-fix-open">
                        {t('fix.open')}
                      </ActionButton>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        )}
      </Section>

      <Section>
        <SectionTitle>{t('stats.title')}</SectionTitle>
        <MonthNav>
          <ActionButton tone="secondary" size="sm" onClick={() => setStatMonth(shiftMonth(statMonth, -1))}>‹</ActionButton>
          <MonthLabel>{statMonth}</MonthLabel>
          <ActionButton tone="secondary" size="sm" onClick={() => setStatMonth(shiftMonth(statMonth, 1))}>›</ActionButton>
        </MonthNav>
        <Hint>{t('stats.overtimeHint')}</Hint>
        {stats.length === 0 ? <Empty>{t('stats.empty')}</Empty> : (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>{t('team.member')}</Th><Th>{t('stats.workDays')}</Th><Th>{t('stats.workHours')}</Th>
                  <Th>{t('stats.breakHours')}</Th><Th>{t('stats.overtime')}</Th>
                  <Th>{t('stats.avgIn')}</Th><Th>{t('stats.avgOut')}</Th>
                  <Th>{t('stats.leaveUsed')}</Th><Th>{t('stats.autoClosed')}</Th>
                </tr>
              </thead>
              <tbody>
                {stats.map((r) => (
                  <tr key={r.user_id}>
                    <Td>{nameOf(r.user_id)}</Td>
                    <Td>{r.work_days}</Td>
                    <Td><strong>{r.work_hours}h</strong></Td>
                    <Td>{r.break_hours}h</Td>
                    <Td>{r.overtime_hours ? `+${r.overtime_hours}h` : '–'}</Td>
                    <Td>{r.avg_clock_in || '–'}</Td>
                    <Td>{r.avg_clock_out || '–'}</Td>
                    <Td>{r.leave_used_paid}{r.leave_used_unpaid ? ` (+${r.leave_used_unpaid})` : ''}</Td>
                    <Td>{r.auto_closed_count ? <Badge $tone="warn">{r.auto_closed_count}</Badge> : '–'}</Td>
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

const PresenceWrap = styled.div` display: flex; flex-wrap: wrap; gap: 8px; `;

const PresenceChip = styled.div<{ $state: string | null }>`
  display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px;
  background: #fff; border: 1px solid #E2E8F0; border-radius: 999px;
  font-size: 0.75rem; font-weight: 600; color: #334155;
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

const MonthNav = styled.div` display: flex; align-items: center; gap: 8px; margin-bottom: 8px; `;

const MonthLabel = styled.span` font-size: 0.875rem; font-weight: 700; color: #0F172A; font-variant-numeric: tabular-nums; `;
