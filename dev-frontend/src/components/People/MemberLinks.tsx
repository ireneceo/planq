// 멤버 상세 — «연결 프로젝트 · 업무 · 히스토리» (2026-10-22 Fable 판정 5, docs/PEOPLE_PROFILE_UNIFY_DESIGN.md)
//   Irene: *"멤버도 연결된 프로젝트랑 업무리스트, 히스토리가 보이게 해주고"*
//   서버 GET /api/businesses/:biz/members/:userId/overview 하나가 **보는 사람이 볼 수 있는 것만** 준다 —
//   화면은 거르지 않는다(거르는 판정이 두 벌이 되면 갈라진다). 업무·프로젝트는 하던 일 위에 얹히므로 새 탭으로 연다.
//   owner/admin 에게만 «활동 기록 보기»(설정 › 활동 기록 ?actor=) — 감사 기록은 여기 다시 싣지 않는다.
import { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../contexts/AuthContext';
import { tabStore } from '../../stores/tabStore';
import { getStatusLabel, displayStatus, STATUS_COLOR } from '../../utils/taskLabel';
import { formatDay, formatDayTime } from '../../utils/dateFormat';
import { onSocket } from '../../services/socket';

interface OvProject { id: number; name: string; status: string; color: string | null; role: string | null; is_pm: boolean }
interface OvTask { id: number; title: string; status: string; due_date: string | null; project_id: number | null; project_name: string | null; role: 'assignee' | 'requester' | 'creator'; completed_at: string | null }
interface OvHistory { id: number; task_id: number; task_title: string | null; event_type: string; from_status: string | null; to_status: string | null; at: string }
interface Overview { projects: OvProject[]; tasks: { active: OvTask[]; done: OvTask[]; counts: { active: number; done: number } }; history: OvHistory[] }

const SHOW = 8;

interface Props { businessId: number; userId: number; canSeeActivity?: boolean }

export default function MemberLinks({ businessId, userId, canSeeActivity }: Props) {
  const { t } = useTranslation('settings');
  const { t: tq } = useTranslation('qtask');
  const [data, setData] = useState<Overview | null>(null);
  const [failed, setFailed] = useState(false);
  const [moreActive, setMoreActive] = useState(false);
  const [moreHistory, setMoreHistory] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await apiFetch(`/api/businesses/${businessId}/members/${userId}/overview`);
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.success) { setFailed(true); return; }
      setFailed(false); setData(j.data as Overview);
    } catch { setFailed(true); }
  }, [businessId, userId]);

  useEffect(() => { void load(); }, [load]);
  // 업무가 바뀌면(다른 사람이 상태를 바꿔도) 다시 읽는다 — 신호만 받고 서버에서 새로(CLAUDE.md 16)
  useEffect(() => {
    let timer: number | null = null;
    const again = () => { if (timer) window.clearTimeout(timer); timer = window.setTimeout(() => { void load(); }, 300); };
    const offs = ['task:new', 'task:updated', 'task:deleted', 'project:updated'].map((ev) => onSocket(ev, again));
    return () => { if (timer) window.clearTimeout(timer); offs.forEach((off) => off()); };
  }, [load]);

  const today = new Date().toISOString().slice(0, 10);
  const tl = (k: string, f?: string) => tq(k, f ?? '') as string;
  const statusChip = (task: OvTask) => {
    const code = displayStatus({ status: task.status, due_date: task.due_date }, today);
    const c = STATUS_COLOR[code] || STATUS_COLOR.not_started;
    return <StatusChip $bg={c.bg} $fg={c.fg}>{getStatusLabel({ status: task.status, due_date: task.due_date }, 'observer', today, tl)}</StatusChip>;
  };
  const openTask = (id: number) => tabStore.openInNewTab(`/tasks?task=${id}`);

  if (failed) return <Section><Title>{t('members.links.projects', '연결 프로젝트')}</Title><Dim>{t('members.links.loadFailed', '불러오지 못했습니다.')}</Dim></Section>;
  if (!data) return <Section><Dim>{t('members.links.loading', '불러오는 중…')}</Dim></Section>;

  const active = moreActive ? data.tasks.active : data.tasks.active.slice(0, SHOW);
  const history = moreHistory ? data.history : data.history.slice(0, SHOW);

  return (
    <>
      <Section data-testid="member-links-projects">
        <Title>{t('members.links.projects', '연결 프로젝트')} <Count>{data.projects.length}</Count></Title>
        {data.projects.length === 0 ? <Dim>{t('members.links.noProjects', '참여한 프로젝트가 없습니다.')}</Dim> : (
          <List>
            {data.projects.map((p) => (
              <RowBtn key={p.id} type="button" onClick={() => tabStore.openInNewTab(`/projects/p/${p.id}`)}>
                <Dot style={{ background: p.color || '#94A3B8' }} aria-hidden />
                <RowMain>{p.name}</RowMain>
                {p.is_pm && <Tag>PM</Tag>}
                {p.role && <Meta>{p.role}</Meta>}
                {p.status !== 'active' && <Meta>{t(`members.links.projectStatus.${p.status}`, p.status)}</Meta>}
              </RowBtn>
            ))}
          </List>
        )}
      </Section>

      <Section data-testid="member-links-tasks">
        <Title>
          {t('members.links.tasks', '업무')} <Count>{data.tasks.counts.active}</Count>
          <SubCount>{t('members.links.doneCount', { defaultValue: '완료 {{n}}', n: data.tasks.counts.done })}</SubCount>
        </Title>
        {data.tasks.active.length === 0 ? <Dim>{t('members.links.noTasks', '진행 중인 업무가 없습니다.')}</Dim> : (
          <List>
            {active.map((task) => (
              <RowBtn key={task.id} type="button" onClick={() => openTask(task.id)}>
                <RowMain title={task.title}>{task.title}</RowMain>
                <Meta>{t(`members.links.role.${task.role}`, task.role)}</Meta>
                {task.due_date && <Meta>{formatDay(task.due_date)}</Meta>}
                {statusChip(task)}
              </RowBtn>
            ))}
          </List>
        )}
        {data.tasks.active.length > SHOW && (
          <MoreBtn type="button" onClick={() => setMoreActive((v) => !v)}>
            {moreActive ? t('members.links.less', '접기') : t('members.links.more', { defaultValue: '{{n}}개 더 보기', n: data.tasks.active.length - SHOW })}
          </MoreBtn>
        )}
        {data.tasks.done.length > 0 && (
          <>
            <SubTitle>{t('members.links.recentDone', '최근 완료')}</SubTitle>
            <List>
              {data.tasks.done.slice(0, 5).map((task) => (
                <RowBtn key={task.id} type="button" onClick={() => openTask(task.id)}>
                  <RowMain $done title={task.title}>{task.title}</RowMain>
                  {task.completed_at && <Meta>{formatDay(task.completed_at)}</Meta>}
                </RowBtn>
              ))}
            </List>
          </>
        )}
      </Section>

      <Section data-testid="member-links-history">
        <Title>{t('members.links.history', '히스토리')}</Title>
        {data.history.length === 0 ? <Dim>{t('members.links.noHistory', '최근 기록이 없습니다.')}</Dim> : (
          <List>
            {history.map((h) => (
              <RowBtn key={h.id} type="button" onClick={() => openTask(h.task_id)}>
                <HistWhen>{formatDayTime(h.at)}</HistWhen>
                <RowMain title={h.task_title || ''}>
                  <HistEvent>{t(`members.links.event.${h.event_type}`, h.event_type)}</HistEvent>
                  {h.task_title}
                </RowMain>
              </RowBtn>
            ))}
          </List>
        )}
        {data.history.length > SHOW && (
          <MoreBtn type="button" onClick={() => setMoreHistory((v) => !v)}>
            {moreHistory ? t('members.links.less', '접기') : t('members.links.more', { defaultValue: '{{n}}개 더 보기', n: data.history.length - SHOW })}
          </MoreBtn>
        )}
        {canSeeActivity && (
          <MoreBtn type="button" data-testid="member-links-activity"
            onClick={() => tabStore.openInNewTab(`/business/settings/activity?actor=${userId}`)}>
            {t('members.links.activity', '활동 기록 전체 보기 →')}
          </MoreBtn>
        )}
      </Section>
    </>
  );
}

const Section = styled.section`display:flex;flex-direction:column;gap:8px;padding:18px 0;border-bottom:1px solid #F1F5F9;`;
const Title = styled.h3`display:flex;align-items:center;gap:6px;margin:0;font-size:0.8125rem;font-weight:700;color:#0F172A;`;
const SubTitle = styled.h4`margin:6px 0 0;font-size:0.75rem;font-weight:600;color:#64748B;`;
const Count = styled.span`font-size:0.75rem;font-weight:600;color:#64748B;`;
const SubCount = styled.span`margin-left:auto;font-size:0.6875rem;font-weight:500;color:#94A3B8;`;
const Dim = styled.div`padding:10px 12px;font-size:0.75rem;color:#94A3B8;background:#F8FAFC;border-radius:8px;`;
const List = styled.div`display:flex;flex-direction:column;gap:2px;`;
const RowBtn = styled.button`
  display:flex;align-items:center;gap:8px;min-height:36px;padding:6px 8px;border:none;border-radius:8px;
  background:transparent;cursor:pointer;text-align:left;font-family:inherit;min-width:0;
  &:hover{background:#F8FAFC;}
  &:focus-visible{outline:2px solid #14B8A6;outline-offset:1px;}
  @media (max-width:640px){min-height:44px;}
`;
const RowMain = styled.span<{ $done?: boolean }>`flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:0.8125rem;color:${(p) => (p.$done ? '#94A3B8' : '#0F172A')};`;
const Meta = styled.span`flex-shrink:0;font-size:0.6875rem;color:#94A3B8;`;
const Tag = styled.span`flex-shrink:0;padding:1px 6px;border-radius:6px;background:#F0FDFA;color:#0F766E;font-size:0.625rem;font-weight:700;`;
const Dot = styled.span`flex-shrink:0;width:8px;height:8px;border-radius:3px;`;
const StatusChip = styled.span<{ $bg: string; $fg: string }>`flex-shrink:0;padding:2px 8px;border-radius:8px;font-size:0.625rem;font-weight:600;white-space:nowrap;background:${(p) => p.$bg};color:${(p) => p.$fg};`;
const HistWhen = styled.span`flex-shrink:0;width:92px;font-size:0.6875rem;color:#94A3B8;font-variant-numeric:tabular-nums;`;
const HistEvent = styled.span`margin-right:6px;font-weight:600;color:#475569;`;
const MoreBtn = styled.button`align-self:flex-start;padding:4px 0;border:none;background:none;color:#0F766E;font-size:0.75rem;font-weight:600;cursor:pointer;font-family:inherit;&:hover{text-decoration:underline;}`;
