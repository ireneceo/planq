// /attendance — 근태 (#208 · #285). 설계: docs/ATTENDANCE_LEAVE_DESIGN.md §9.3
//
// 탭 3개. "팀 관리" 는 owner/admin 에게만 보인다 — 남의 근무시간은 관리 목적으로만 열린다(§6).
// 신청·부여는 제출형 폼이라 저장 버튼을 쓴다(자동저장 예외 — 청구서 작성과 같은 분류).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import PageShell from '../../components/Layout/PageShell';
import ErrorBoundary from '../../components/Common/ErrorBoundary';
import ActionButton from '../../components/Common/ActionButton';
import AttendanceWidget from '../../components/Attendance/AttendanceWidget';
import { useAuth, apiFetch } from '../../contexts/AuthContext';
import { ATTENDANCE_REFRESH_EVENT, formatHours, type AttendanceDay } from '../../hooks/useAttendance';
import { LeaveRequestDrawer } from './LeaveRequestDrawer';
import {
  type LeaveRequestRow, type Balance,
  hhmm, unitKey,
  Empty, TableWrap, Table, Th, Td, Muted, Badge,
  List, Row, RowMain, RowTitle, RowMeta, ErrorBar,
} from './shared';
import { joinRoom, leaveRoom, onSocket } from '../../services/socket';
import { useVisibilityRefresh } from '../../hooks/useVisibilityRefresh';

type Tab = 'my' | 'leave';


const AttendancePage: React.FC = () => {
  const { t } = useTranslation('attendance');
  const { user } = useAuth();
  const bizId = user?.business_id ? Number(user.business_id) : null;
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'my';

  // 관리자 여부 — /team 을 실제로 호출해서 판정하지 않고, 서버가 준 역할로 본다.

  const [days, setDays] = useState<AttendanceDay[]>([]);
  const [requests, setRequests] = useState<LeaveRequestRow[]>([]);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // #208 — 근태 설정의 집은 근태 화면이다. 처음엔 '업무 흐름' 카드 안에 뒀는데,
  //   그 카드는 focus_enabled 가 꺼져 있으면 통째로 안 보여서 설정이 영영 닿지 않았다.
  const [autoClockIn, setAutoClockIn] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const year = new Date().getFullYear();

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
  }, [bizId, year]);

  useEffect(() => { void silentLoad(); }, [silentLoad]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await apiFetch('/api/attendance/settings');
      if (!r.ok || cancelled) return;
      const j = await r.json().catch(() => null);
      if (j?.success) setAutoClockIn(!!j.data.auto_clock_in_on_focus);
    })();
    return () => { cancelled = true; };
  }, []);

  const saveAutoClockIn = async (next: boolean) => {
    setAutoClockIn(next);                       // 즉시 반영 — 토글은 기다림이 없어야 한다
    const r = await apiFetch('/api/attendance/settings', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ auto_clock_in_on_focus: next }),
    });
    if (!r.ok) setAutoClockIn(!next);           // 실패하면 되돌린다(거짓 성공 금지)
  };
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

  // ★ **아무것도 안 그리는 분기를 두지 않는다.** 워크스페이스가 아직 안 잡혔을 때 null 을 돌려주면
  //   사용자에게는 메뉴를 눌렀는데 빈 화면이 뜬 것으로 보인다(운영: "근태 메뉴 누르면 아무것도 없는데").
  //   무슨 상황인지 말해주는 화면을 대신 그린다.
  if (!bizId) {
    return (
      <PageShell title={t('page.title')}>
        <Empty>{t('noWorkspace', { defaultValue: '워크스페이스를 먼저 선택해 주세요.' }) as string}</Empty>
      </PageShell>
    );
  }

  return (
    <PageShell title={t('page.title')}>
      <Tabs role="tablist">
        <TabBtn role="tab" $on={tab === 'my'} onClick={() => setTab('my')}>{t('tabs.my')}</TabBtn>
        <TabBtn role="tab" $on={tab === 'leave'} onClick={() => setTab('leave')}>{t('tabs.leave')}</TabBtn>

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
          {autoClockIn !== null && (
            <SettingRow>
              <SettingCheck
                type="checkbox" id="attn-auto-clockin"
                checked={autoClockIn}
                onChange={(e) => saveAutoClockIn(e.target.checked)}
              />
              <SettingText htmlFor="attn-auto-clockin">
                <b>{t('settings.autoClockIn')}</b>
                <span>{t('settings.autoClockInHint')}</span>
              </SettingText>
            </SettingRow>
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

      <LeaveRequestDrawer
        open={drawerOpen} onClose={() => setDrawerOpen(false)}
        bizId={bizId} onDone={silentLoad}
      />
    </PageShell>
  );
};

// ★ 렌더 중 오류가 나면 **흰 화면**이 남는다 — 사용자에게는 "메뉴를 눌렀는데 아무것도 없다" 이고,
//   무엇이 잘못됐는지 단서가 하나도 없다(운영 2026-08-22, 원인 추적에 반나절이 갔다).
//   경계로 감싸 오류 내용을 화면에 남긴다. 고치는 것보다 **보이게 하는 것이 먼저**다.
export default function AttendancePageBoundary() {
  // ★ 렌더 중 오류가 나면 흰 화면이 남는다 — 사용자에게는 "메뉴를 눌렀는데 아무것도 없다" 이고
  //   무엇이 잘못됐는지 단서가 하나도 없다(운영 2026-08-22, 원인 추적에 반나절이 갔다).
  //   ErrorBoundary 의 기본 화면이 오류 메시지까지 보여주므로 따로 만들지 않는다 —
  //   같은 것을 두 벌 만들면 한쪽만 고쳐지는 날이 온다.
  return (
    <ErrorBoundary>
      <AttendancePage />
    </ErrorBoundary>
  );
}

// ─── styled ─────────────────────────────────────────────────────
const Tabs = styled.div` display: flex; gap: 4px; margin-bottom: 16px; border-bottom: 1px solid #E2E8F0; `;
const TabBtn = styled.button<{ $on: boolean }>`
  padding: 8px 14px; background: transparent; border: none; cursor: pointer;
  font-size: 0.8125rem; font-weight: ${p => (p.$on ? 700 : 500)};
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
  font-size: 0.8125rem; font-weight: 600; color: #334155;
`;
const BalanceCard = styled.div`
  display: flex; flex-direction: column; gap: 12px; padding: 16px;
  background: #fff; border: 1px solid #E2E8F0; border-radius: 12px; margin-bottom: 16px;
`;
const BalanceTitle = styled.div` font-size: 0.8125rem; font-weight: 700; color: #0F172A; `;
const BalanceRow = styled.div` display: flex; gap: 20px; flex-wrap: wrap; `;
const BalanceItem = styled.div<{ $accent?: boolean }>`
  display: flex; flex-direction: column; gap: 2px;
  span { font-size: 0.6875rem; color: #64748B; }
  b { font-size: 1.25rem; font-weight: 700; color: ${p => (p.$accent ? '#F43F5E' : '#0F172A')}; }
`;
const StatusBadge = styled.span<{ $s: string }>`
  padding: 3px 9px; border-radius: 999px; font-size: 0.6875rem; font-weight: 700; white-space: nowrap;
  background: ${p => ({ pending: '#FEF3C7', approved: '#DCFCE7', rejected: '#FEE2E2', canceled: '#F1F5F9' }[p.$s] || '#F1F5F9')};
  color: ${p => ({ pending: '#92400E', approved: '#166534', rejected: '#991B1B', canceled: '#64748B' }[p.$s] || '#64748B')};
`;


// #208 — 근태 설정. 페이지 안에 두어 "설정이 어디 있지" 가 없게 한다.
const SettingRow = styled.div`
  display: flex; align-items: flex-start; gap: 8px;
  margin-top: 16px; padding: 12px 14px;
  background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 10px;
`;
const SettingCheck = styled.input`
  width: 16px; height: 16px; margin-top: 2px; accent-color: #F43F5E; cursor: pointer; flex-shrink: 0;
`;
const SettingText = styled.label`
  display: flex; flex-direction: column; gap: 2px; cursor: pointer;
  b { font-size: 0.8125rem; font-weight: 600; color: #0F172A; }
  span { font-size: 0.6875rem; color: #64748B; line-height: 1.45; }
`;
