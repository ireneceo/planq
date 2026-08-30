// 설정 > 근태 관리 (#208) — **워크스페이스 관리자 영역**
//
// 왜 근태 페이지에서 떼어냈나: 한 화면에 "내 출퇴근"(개인)과 "남의 근태 승인·통계"(관리)를
//   탭으로 묶어 뒀더니 둘 다 어정쩡해졌다. 보는 사람도 권한도 다르다
//   (운영: "내 기록·휴가는 개인영역이잖아. 팀관리는 설정에서 관리자 영역 아니야?").
//   여기는 멤버·권한·청구와 같은 줄 — 관리자가 관리하러 오는 곳이다.
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import { apiFetch } from '../../contexts/AuthContext';
import { joinRoom, leaveRoom, onSocket } from '../../services/socket';
import { useVisibilityRefresh } from '../../hooks/useVisibilityRefresh';
import { ATTENDANCE_REFRESH_EVENT, type AttendanceDay } from '../../hooks/useAttendance';
import { TeamTab } from '../Attendance/TeamTab';
import { AdminFixDrawer } from '../Attendance/AdminFixDrawer';
import type { LeaveRequestRow, PresenceRow, StatRow } from '../Attendance/shared';

interface Props { businessId: number }

export default function AttendanceAdminSettings({ businessId }: Props) {
  const { t } = useTranslation('attendance');
  const year = new Date().getFullYear();
  const today = new Date().toISOString().slice(0, 10);

  const [presence, setPresence] = useState<PresenceRow[]>([]);
  const [teamDays, setTeamDays] = useState<AttendanceDay[]>([]);
  const [allRequests, setAllRequests] = useState<LeaveRequestRow[]>([]);
  const [stats, setStats] = useState<StatRow[]>([]);
  const [members, setMembers] = useState<{ user_id: number; name: string }[]>([]);
  const [teamDate, setTeamDate] = useState(today);
  const [statMonth, setStatMonth] = useState(() => today.slice(0, 7));
  const [fixTarget, setFixTarget] = useState<AttendanceDay | null>(null);

  const load = useCallback(async () => {
    const get = async (url: string) => {
      const r = await apiFetch(url);
      if (!r.ok) return null;                    // apiFetch 는 throw 하지 않는다
      const j = await r.json().catch(() => null);
      return j?.success ? j.data : null;
    };
    const [pres, all, team, st] = await Promise.all([
      get(`/api/attendance/presence?business_id=${businessId}`),
      get(`/api/leave/requests?business_id=${businessId}&scope=all&limit=200`),
      get(`/api/attendance/team?business_id=${businessId}&date=${teamDate}`),
      get(`/api/attendance/stats?business_id=${businessId}&month=${statMonth}`),
    ]);
    if (pres) setPresence(pres);
    if (all) setAllRequests(all);
    if (team) setTeamDays(team);
    if (st) setStats(st.members || []);
  }, [businessId, teamDate, statMonth]);

  useEffect(() => { void load(); }, [load]);
  useVisibilityRefresh(load);

  // 다른 사람이 출근하거나 휴가를 신청하면 새로고침 없이 반영된다(CLAUDE.md §16).
  useEffect(() => {
    const room = `business:${businessId}`;
    joinRoom(room);
    let timer: number | null = null;
    const debounced = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => { void load(); }, 250);
    };
    const offA = onSocket('attendance:updated', debounced);
    const offL = onSocket('leave:updated', debounced);
    window.addEventListener(ATTENDANCE_REFRESH_EVENT, debounced);
    return () => {
      if (timer) window.clearTimeout(timer);
      offA(); offL(); leaveRoom(room);
      window.removeEventListener(ATTENDANCE_REFRESH_EVENT, debounced);
    };
  }, [businessId, load]);

  useEffect(() => {
    (async () => {
      const r = await apiFetch(`/api/businesses/${businessId}/members`);
      if (!r.ok) return;
      const j = await r.json().catch(() => null);
      if (!j?.success) return;
      const list = (j.data || []) as { user_id: number; name?: string; user?: { name?: string } }[];
      if (!Array.isArray(list)) return;
      setMembers(list.map((m) => ({ user_id: m.user_id, name: m.name || m.user?.name || `#${m.user_id}` })));
    })();
  }, [businessId]);

  const nameOf = useCallback(
    (uid: number) => members.find((m) => m.user_id === uid)?.name || `#${uid}`,
    [members],
  );

  const decide = async (id: number, action: 'approve' | 'reject' | 'cancel') => {
    const r = await apiFetch(`/api/leave/requests/${id}/${action}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
    });
    if (r.ok) await load();
  };

  return (
    <Wrap>
      <Desc>{t('admin.desc') as string}</Desc>
      <TeamTab
        presence={presence} teamDays={teamDays} allRequests={allRequests}
        nameOf={nameOf} members={members} bizId={businessId} year={year}
        teamDate={teamDate} setTeamDate={setTeamDate}
        stats={stats} statMonth={statMonth} setStatMonth={setStatMonth}
        onFix={setFixTarget}
        onDecide={decide} onReload={load}
      />
      <AdminFixDrawer
        day={fixTarget} onClose={() => setFixTarget(null)}
        nameOf={nameOf} onDone={load}
      />
    </Wrap>
  );
}

const Wrap = styled.div` display: flex; flex-direction: column; `;
const Desc = styled.p`
  margin: 0 0 16px; font-size: 0.8125rem; color: #64748B; line-height: 1.5;
`;
