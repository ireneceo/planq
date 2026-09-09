// /attendance — 근태 (#208 · #285). 설계: docs/ATTENDANCE_LEAVE_DESIGN.md §9.3
//
// 탭 3개. "팀 관리" 는 owner/admin 에게만 보인다 — 남의 근무시간은 관리 목적으로만 열린다(§6).
// 신청·부여는 제출형 폼이라 저장 버튼을 쓴다(자동저장 예외 — 청구서 작성과 같은 분류).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import PageShell from '../../components/Layout/PageShell';
import ErrorBoundary from '../../components/Common/ErrorBoundary';
import ActionButton from '../../components/Common/ActionButton';
import AutoSaveField from '../../components/Common/AutoSaveField';
import AttendanceWidget from '../../components/Attendance/AttendanceWidget';
import { useAuth, apiFetch } from '../../contexts/AuthContext';
import { ATTENDANCE_REFRESH_EVENT, formatHours, type AttendanceDay } from '../../hooks/useAttendance';
import { LeaveRequestDrawer } from './LeaveRequestDrawer';
import CorrectDayModal from './CorrectDayModal';
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
  // 운영 #392 — 본인 정정. 서버와 같은 창(14일)을 화면도 알아야 "왜 버튼이 없지" 가 안 생긴다.
  const [correcting, setCorrecting] = useState<AttendanceDay | null>(null);
  const SELF_FIX_WINDOW_DAYS = 14;
  const canCorrect = (d: AttendanceDay) => {
    const age = Math.floor((Date.now() - new Date(`${d.work_date}T00:00:00`).getTime()) / 86400000);
    return age <= SELF_FIX_WINDOW_DAYS;
  };
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

  // ★ 2026-09-09 — 자동저장 ✓ 를 붙인다. 래퍼가 onSave 를 부르므로 여기서 저장까지 하면
  //   **두 번 나간다** → flip(화면만) / persistAutoClockIn(저장) 으로 가른다.
  //   최신값은 클로저가 아니라 ref 로 읽는다(클릭으로 이미 뒤집힌 값을 저장해야 한다).
  const autoClockInRef = useRef<boolean | null>(null);
  autoClockInRef.current = autoClockIn;
  const flipAutoClockIn = () => setAutoClockIn((v) => !v);
  const persistAutoClockIn = async () => {
    const next = autoClockInRef.current;
    if (next === null) return;
    const r = await apiFetch('/api/attendance/settings', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ auto_clock_in_on_focus: next }),
    });
    if (!r.ok) {
      setAutoClockIn(!next);                    // 실패하면 되돌린다(거짓 성공 금지)
      throw new Error('save_failed');           // 던져야 래퍼가 ! 를 띄운다
    }
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
        {/* 표식은 하니스가 탭을 기계적으로 여는 근거 (CLAUDE.md 운영 안정성 17).
            없으면 검사기가 글자로 찾다가 못 찾아 **거짓 FAIL** 을 낸다 — 실제로 한 번 났다. */}
        <TabBtn role="tab" data-testid="attendance-tab-my" $on={tab === 'my'} onClick={() => setTab('my')}>{t('tabs.my')}</TabBtn>
        <TabBtn role="tab" data-testid="attendance-tab-leave" $on={tab === 'leave'} onClick={() => setTab('leave')}>{t('tabs.leave')}</TabBtn>

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
                    <Th />
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
                      <Td>
                        {/* 운영 #392 — 자동 기록이 안 맞을 때 본인이 고칠 자리. 여태 없었다. */}
                        {canCorrect(d) && (
                          <ActionButton tone="secondary" size="sm"
                            data-testid="attendance-correct-open"
                            onClick={() => setCorrecting(d)}>
                            {t('correct.open', { defaultValue: '정정' })}
                          </ActionButton>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          )}
          {autoClockIn !== null && (
            <SettingRow>
              {/* ★ 네이티브 체크박스(16px)였다 — ✓ 뱃지(22px)가 컨트롤을 통째로 덮어
                  "저장됨" 을 보여주려다 무엇을 켰는지 안 보이는 상태가 된다.
                  워크스페이스 설정과 **같은 표준 스위치**로 바꾸고 그 옆에 뱃지를 둔다
                  (Irene 확인: 모양이 바뀌는 것을 알고 승인). */}
              <AutoSaveField type="toggle" onSave={persistAutoClockIn}>
                <SettingSwitch
                  type="button" role="switch" id="attn-auto-clockin"
                  aria-checked={!!autoClockIn}
                  aria-labelledby="attn-auto-clockin-label"
                  $on={!!autoClockIn}
                  onClick={flipAutoClockIn}
                >
                  <SettingTrack $on={!!autoClockIn}>
                    <SettingKnob $on={!!autoClockIn} />
                  </SettingTrack>
                </SettingSwitch>
              </AutoSaveField>
              <SettingText id="attn-auto-clockin-label" onClick={flipAutoClockIn}>
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

      {correcting && (

        <CorrectDayModal

          day={correcting}

          onClose={() => setCorrecting(null)}

          onSaved={() => { void silentLoad(); }}

        />

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
// 표준 스위치 — 보이는 트랙은 다른 설정 화면과 같은 36×20 이지만,
//   **누르는 상자는 36×36** 이다(CLAUDE.md 반응형 원칙 2 + UISPEC 토큰 36/40/44).
//   ★ 처음엔 버튼 자체를 20px 로 썼다가 UISPEC 래칫이 702→703 으로 잡았다.
//     베이스라인을 올리지 않고 규격에 맞췄다 — 터치 타깃도 같이 커진다.
//   네이티브 체크박스(16px)를 대체한다: 뱃지(22px)가 컨트롤을 통째로 덮던 문제.
const SettingSwitch = styled.button<{ $on: boolean }>`
  width: 36px; height: 36px; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  border: none; background: transparent; cursor: pointer; padding: 0;
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 2px; border-radius: 8px; }
`;
const SettingTrack = styled.span<{ $on: boolean }>`
  display: block; width: 36px; height: 20px; border-radius: 999px;
  background: ${(p) => (p.$on ? '#14B8A6' : '#CBD5E1')};
  transition: background 0.15s;
`;
const SettingKnob = styled.span<{ $on: boolean }>`
  display: block; width: 16px; height: 16px; border-radius: 50%; margin-top: 2px;
  background: #FFFFFF; box-shadow: 0 1px 2px rgba(15,23,42,.2);
  transform: translateX(${(p) => (p.$on ? '18px' : '2px')});
  transition: transform 0.15s;
`;
const SettingText = styled.div`
  display: flex; flex-direction: column; gap: 2px; cursor: pointer;
  b { font-size: 0.8125rem; font-weight: 600; color: #0F172A; }
  span { font-size: 0.6875rem; color: #64748B; line-height: 1.45; }
`;
