import React, { useCallback, useEffect, useMemo, useState } from 'react';
import styled from 'styled-components';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { displayName } from '../../utils/displayName';
import { apiFetch, useAuth } from '../../contexts/AuthContext';
import PageShell from '../../components/Layout/PageShell';
import { useTimeFormat } from '../../hooks/useTimeFormat';
import { todayInTz, addDaysStr, detectBrowserTz } from '../../utils/timezones';
import { colorForProject, lightenColor } from '../../utils/projectColors';
import NewProjectModal, { type ProjectFormData } from '../QTalk/NewProjectModal';
import SearchBox from '../../components/Common/SearchBox';

// ─── Types ───
type ViewMode = 'list' | 'timeline' | 'calendar';
type StatusFilter = 'all' | 'active' | 'paused' | 'closed';

interface ProjectMemberRow {
  user_id: number;
  role?: string | null;
  is_pm?: boolean;
  User?: {
    id: number; name: string; email?: string | null;
    name_localized?: Record<string, string> | null;
    // 워크스페이스 표시명 (BusinessMember.name) — 사이드바·리스트 우선 노출
    display_name?: string | null;
    display_name_localized?: Record<string, string> | null;
    workspace_role?: string | null;
  } | null;
}
interface ProjectClientRow {
  id?: number;
  contact_name?: string | null;
  contact_email?: string | null;
  contact_user_id?: number | null;
}
interface ProjectRow {
  id: number;
  name: string;
  description: string | null;
  client_company: string | null;
  status: 'active' | 'paused' | 'closed';
  kind?: 'client' | 'internal';
  start_date: string | null;
  end_date: string | null;
  color?: string | null;
  default_assignee_user_id?: number | null;
  owner_user_id?: number | null;
  updatedAt?: string | null;
  createdAt?: string | null;
  projectMembers?: ProjectMemberRow[];
  projectClients?: ProjectClientRow[];
}

interface TaskRow {
  id: number;
  project_id: number;
  title: string;
  status: string;
  due_date: string | null;
  start_date: string | null;
  progress_percent: number;
  assignee_id: number | null;
  assignee?: { id: number; name: string } | null;
}

interface ProjectWithStats extends ProjectRow {
  totalTasks: number;
  completedTasks: number;
  overdueTasks: number;
  progressPercent: number;
  tasks: TaskRow[];
}

const STATUS_COLOR: Record<string, { bg: string; fg: string }> = {
  active: { bg: '#CCFBF1', fg: '#0F766E' },
  paused: { bg: '#FEF3C7', fg: '#92400E' },
  closed: { bg: '#F1F5F9', fg: '#64748B' },
};

const QProjectPage: React.FC = () => {
  const { t } = useTranslation('qproject');
  const { user } = useAuth();
  const { formatDate } = useTimeFormat();
  const navigate = useNavigate();
  const { view: viewParam } = useParams<{ view?: string }>();
  const view: ViewMode = viewParam === 'timeline' || viewParam === 'calendar' ? viewParam : 'list';

  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [tasksByProject, setTasksByProject] = useState<Record<number, TaskRow[]>>({});
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  // 검색 + 상태 필터 (사이클 N+17). 기본은 'active' — 진행 중만 노출. 종료/대기는 명시 선택 시 표시.
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');
  // #99 — 구분(고객/내부) 필터 + 정렬
  const [kindFilter, setKindFilter] = useState<'all' | 'client' | 'internal'>('all');
  const [sortBy, setSortBy] = useState<'recent' | 'name' | 'progress' | 'deadline'>('recent');
  const [groupBy, setGroupBy] = useState<'none' | 'kind' | 'status' | 'client'>('none');
  const handleCreateProject = useCallback(async (data: ProjectFormData & { project_type?: 'fixed' | 'ongoing' }) => {
    if (!user?.business_id) return;
    const res = await apiFetch('/api/projects', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        business_id: user.business_id,
        name: data.name,
        description: data.description || undefined,
        client_company: data.client_company || undefined,
        start_date: data.start_date || undefined,
        end_date: data.end_date || undefined,
        color: data.color || undefined,
        project_type: data.project_type || 'fixed',
        members: data.members.map(m => ({ user_id: m.user_id, role: m.role, is_default: m.is_default })),
        clients: data.clients.map(c => ({ name: c.name, email: c.email })),
        channels: data.channels,
      })
    });
    const j = await res.json();
    if (j.success && j.data?.id) {
      setNewProjectOpen(false);
      navigate(`/projects/p/${j.data.id}`);
    }
  }, [user?.business_id, navigate]);
  const [loading, setLoading] = useState(true);

  const bizId = user?.business_id || null;
  const wsTz = user?.workspace_timezone || detectBrowserTz();
  const todayStr = todayInTz(wsTz);

  const load = useCallback(async () => {
    if (!bizId) return;
    setLoading(true);
    try {
      const pr = await (await apiFetch(`/api/projects?business_id=${bizId}`)).json();
      const list: ProjectRow[] = pr.success ? pr.data : [];
      setProjects(list);
      // 각 프로젝트의 tasks 병렬 fetch
      const results = await Promise.all(
        list.map((p) => apiFetch(`/api/projects/${p.id}/tasks`).then((r) => r.json()).catch(() => ({ success: false })))
      );
      const map: Record<number, TaskRow[]> = {};
      list.forEach((p, i) => {
        const r = results[i];
        map[p.id] = r.success ? r.data : [];
      });
      setTasksByProject(map);
    } finally {
      setLoading(false);
    }
  }, [bizId]);

  useEffect(() => { load(); }, [load]);

  const enriched: ProjectWithStats[] = useMemo(() => {
    return projects.map((p) => {
      const tasks = tasksByProject[p.id] || [];
      // 집계 대상: 취소 제외
      const active = tasks.filter((t) => t.status !== 'canceled');
      const totalTasks = active.length;
      const completedTasks = active.filter((t) => t.status === 'completed').length;
      const overdueTasks = active.filter(
        (t) => t.due_date && t.due_date.slice(0, 10) < todayStr && t.status !== 'completed'
      ).length;
      // 진행률 = task 별 progress_percent 평균 (완료는 100 으로 간주)
      const progressPercent = totalTasks === 0
        ? 0
        : Math.round(
            active.reduce((s, t) => s + (t.status === 'completed' ? 100 : (t.progress_percent || 0)), 0) / totalTasks
          );
      return { ...p, totalTasks, completedTasks, overdueTasks, progressPercent, tasks };
    });
  }, [projects, tasksByProject, todayStr]);

  // 상태 + 검색 필터링 (이름·설명·고객사·멤버명 across-field 검색)
  const visibleProjects = useMemo(() => {
    const q = query.trim().toLowerCase();
    return enriched.filter((p) => {
      if (statusFilter !== 'all' && p.status !== statusFilter) return false;
      if (kindFilter !== 'all' && (p.kind || 'client') !== kindFilter) return false;
      if (!q) return true;
      if (p.name?.toLowerCase().includes(q)) return true;
      if (p.description?.toLowerCase().includes(q)) return true;
      if (p.client_company?.toLowerCase().includes(q)) return true;
      // 멤버 이름 (workspace 표시명 + display_name + base name) 매칭
      if (p.projectMembers?.some((m) => {
        const u = m.User;
        if (!u) return false;
        const names = [u.display_name, u.name];
        const locA = u.display_name_localized ? Object.values(u.display_name_localized) : [];
        const locB = u.name_localized ? Object.values(u.name_localized) : [];
        return [...names, ...locA, ...locB].some((n) => n?.toLowerCase().includes(q));
      })) return true;
      // 고객 contact_name 매칭
      if (p.projectClients?.some((c) => c.contact_name?.toLowerCase().includes(q))) return true;
      return false;
    });
  }, [enriched, statusFilter, kindFilter, query]);

  // #99 — 정렬 (최근/이름/진행률/마감임박). 모든 뷰에 적용.
  const sortedProjects = useMemo(() => {
    const arr = [...visibleProjects];
    arr.sort((a, b) => {
      switch (sortBy) {
        case 'name': return (a.name || '').localeCompare(b.name || '');
        case 'progress': return (b.progressPercent || 0) - (a.progressPercent || 0);
        case 'deadline': {
          // 마감(end_date) 임박 오름차순, 없는 것은 맨 뒤
          const ad = a.end_date || '9999-12-31'; const bd = b.end_date || '9999-12-31';
          return ad.localeCompare(bd);
        }
        default: { // recent — 최근 수정(없으면 생성) 내림차순
          const at = a.updatedAt || a.createdAt || ''; const bt = b.updatedAt || b.createdAt || '';
          return bt.localeCompare(at);
        }
      }
    });
    return arr;
  }, [visibleProjects, sortBy]);

  const filterActive = query.trim().length > 0 || statusFilter !== 'active' || kindFilter !== 'all';
  const clearFilters = () => { setQuery(''); setStatusFilter('active'); setKindFilter('all'); };

  const changeProjectStatus = useCallback(async (projectId: number, next: 'active' | 'paused' | 'closed') => {
    const r = await apiFetch(`/api/projects/${projectId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: next }),
    });
    const j = await r.json();
    if (j.success) {
      setProjects((prev) => prev.map((p) => p.id === projectId ? { ...p, status: next } : p));
    }
  }, []);

  const setView = (v: ViewMode) => {
    navigate(v === 'list' ? '/projects' : `/projects/${v}`);
  };

  return (
    <PageShell
      title={t('page.title')}
      count={projects.length}
      actions={
        <>
          <ViewTabs>
            <ViewTab $active={view === 'list'} onClick={() => setView('list')} type="button">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg>
              <span>{t('view.list')}</span>
            </ViewTab>
            <ViewTab $active={view === 'timeline'} onClick={() => setView('timeline')} type="button">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="15" y2="12"/><line x1="3" y1="18" x2="18" y2="18"/></svg>
              <span>{t('view.timeline')}</span>
            </ViewTab>
            <ViewTab $active={view === 'calendar'} onClick={() => setView('calendar')} type="button">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              <span>{t('view.calendar')}</span>
            </ViewTab>
          </ViewTabs>
          <SearchBox
            value={query}
            onChange={setQuery}
            placeholder={t('filter.searchPlaceholder') as string}
            width={240}
          />
          <FilterSeg role="tablist" aria-label={t('filter.searchPlaceholder') as string}>
            {(['active', 'paused', 'closed', 'all'] as StatusFilter[]).map((s) => (
              <FilterSegBtn key={s} type="button" $active={statusFilter === s}
                role="tab" aria-selected={statusFilter === s}
                onClick={() => setStatusFilter(s)}>
                {t(`filter.${s}`)}
              </FilterSegBtn>
            ))}
          </FilterSeg>
          {/* #99 — 고객/내부 구분 필터 */}
          <FilterSeg role="tablist" aria-label={t('filter.kindLabel', '구분') as string}>
            {(['all', 'client', 'internal'] as const).map((k) => (
              <FilterSegBtn key={k} type="button" $active={kindFilter === k}
                role="tab" aria-selected={kindFilter === k}
                onClick={() => setKindFilter(k)}>
                {t(`filter.kind.${k}`, k === 'all' ? '전체' : k === 'client' ? '고객' : '내부')}
              </FilterSegBtn>
            ))}
          </FilterSeg>
          {/* #99 — 정렬 */}
          <SortSelect value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            aria-label={t('filter.sortLabel', '정렬') as string}>
            <option value="recent">{t('filter.sort.recent', '최근순')}</option>
            <option value="name">{t('filter.sort.name', '이름순')}</option>
            <option value="progress">{t('filter.sort.progress', '진행률순')}</option>
            <option value="deadline">{t('filter.sort.deadline', '마감임박순')}</option>
          </SortSelect>
          {/* #99 — 그룹 (list 뷰) */}
          {view === 'list' && (
            <SortSelect value={groupBy} onChange={(e) => setGroupBy(e.target.value as typeof groupBy)}
              aria-label={t('filter.groupLabel', '그룹') as string}>
              <option value="none">{t('filter.group.none', '그룹 없음')}</option>
              <option value="kind">{t('filter.group.kind', '고객/내부')}</option>
              <option value="status">{t('filter.group.status', '상태별')}</option>
              <option value="client">{t('filter.group.client', '고객사별')}</option>
            </SortSelect>
          )}
          <NewProjectCta type="button" onClick={() => setNewProjectOpen(true)}>+ <span>{t('newProject', '새 프로젝트')}</span></NewProjectCta>
        </>
      }
    >
      <NewProjectModal
        businessId={user?.business_id || 0}
        open={newProjectOpen}
        onClose={() => setNewProjectOpen(false)}
        onCreate={handleCreateProject}
      />
      {loading ? (
        <EmptyState>{t('loading')}</EmptyState>
      ) : enriched.length === 0 ? (
        <EmptyState>
          <EmptyIcon aria-hidden>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/>
              <rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>
            </svg>
          </EmptyIcon>
          <EmptyTitle>{t('empty.title')}</EmptyTitle>
          <EmptyDesc>{t('empty.desc')}</EmptyDesc>
          <EmptyCta type="button" onClick={() => navigate('/talk')}>{t('empty.cta')}</EmptyCta>
        </EmptyState>
      ) : visibleProjects.length === 0 ? (
        <EmptyState>
          <EmptyIcon aria-hidden>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
          </EmptyIcon>
          <EmptyTitle>{t('filter.noResults')}</EmptyTitle>
          {filterActive && (
            <EmptyCta type="button" onClick={clearFilters}>{t('filter.clearFilters')}</EmptyCta>
          )}
        </EmptyState>
      ) : view === 'list' ? (
        <ListView projects={sortedProjects} groupBy={groupBy} formatDate={formatDate} t={t} onOpen={(id) => navigate(`/projects/p/${id}`)} onStatusChange={changeProjectStatus} />
      ) : view === 'timeline' ? (
        <TimelineView projects={sortedProjects} todayStr={todayStr} t={t} onOpen={(id) => navigate(`/projects/p/${id}`)} />
      ) : (
        <CalendarView projects={sortedProjects} todayStr={todayStr} t={t} />
      )}
    </PageShell>
  );
};

export default QProjectPage;

// ─── 상대 시간 포맷 (n분 전 / n시간 전 / n일 전) ───
function formatRelativeTime(iso: string | Date, t: (k: string, o?: Record<string, unknown>) => string): string {
  try {
    const d = typeof iso === 'string' ? new Date(iso) : iso;
    const diff = Date.now() - d.getTime();
    if (isNaN(diff)) return '';
    if (diff < 60_000) return t('relTime.justNow', { defaultValue: '방금' });
    if (diff < 3600_000) return t('relTime.minutesAgo', { count: Math.floor(diff / 60_000), defaultValue: '{{count}}분 전' });
    if (diff < 86_400_000) return t('relTime.hoursAgo', { count: Math.floor(diff / 3_600_000), defaultValue: '{{count}}시간 전' });
    if (diff < 7 * 86_400_000) return t('relTime.daysAgo', { count: Math.floor(diff / 86_400_000), defaultValue: '{{count}}일 전' });
    return d.toLocaleDateString();
  } catch { return ''; }
}

// ─── List View ───
const ListView: React.FC<{
  projects: ProjectWithStats[];
  groupBy?: 'none' | 'kind' | 'status' | 'client';
  formatDate: (iso: string | Date) => string;
  t: (k: string, o?: Record<string, unknown>) => string;
  onOpen: (projectId: number) => void;
  onStatusChange: (id: number, next: 'active' | 'paused' | 'closed') => Promise<void>;
}> = ({ projects, groupBy = 'none', formatDate, t, onOpen, onStatusChange }) => {
  const { t: tl, i18n } = useTranslation('qproject');
  const lang = i18n.language;
  const [menuOpen, setMenuOpen] = useState<number | null>(null);
  const [confirmCloseId, setConfirmCloseId] = useState<number | null>(null);

  useEffect(() => {
    if (menuOpen == null) return;
    const close = (e: MouseEvent) => {
      const tgt = e.target as HTMLElement | null;
      if (tgt && tgt.closest('[data-project-menu]')) return;
      setMenuOpen(null);
    };
    const id = window.setTimeout(() => window.addEventListener('click', close), 0);
    return () => { window.clearTimeout(id); window.removeEventListener('click', close); };
  }, [menuOpen]);

  // #99 — 그룹핑 (구분/상태/고객사). 팀/부서는 프로젝트에 필드 부재로 제외.
  const groups = ((): Array<{ key: string; label: string; items: ProjectWithStats[] }> => {
    if (groupBy === 'none') return [{ key: '_all', label: '', items: projects }];
    const map = new Map<string, { key: string; label: string; items: ProjectWithStats[] }>();
    for (const p of projects) {
      let key: string; let label: string;
      if (groupBy === 'kind') { key = p.kind || 'client'; label = key === 'internal' ? tl('filter.kind.internal', '내부') : tl('filter.kind.client', '고객'); }
      else if (groupBy === 'status') { key = p.status; label = t(`status.${p.status}`); }
      else { key = p.client_company || '_none'; label = p.client_company || tl('card.noClient', '고객사 미지정'); }
      if (!map.has(key)) map.set(key, { key, label, items: [] });
      map.get(key)!.items.push(p);
    }
    return [...map.values()];
  })();

  const renderCard = (p: ProjectWithStats) => (
      <ProjectCard key={p.id} onClick={() => onOpen(p.id)} role="button" tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter') onOpen(p.id); }}
        style={{ borderLeft: `4px solid ${colorForProject(p)}` }}>
        <CardHead>
          <CardTitle>{p.name}</CardTitle>
          <CardHeadRight>
            <StatusBadge $bg={STATUS_COLOR[p.status]?.bg} $fg={STATUS_COLOR[p.status]?.fg}>
              {t(`status.${p.status}`)}
            </StatusBadge>
            <MenuWrap data-project-menu>
              <MenuBtn type="button" aria-label={tl('card.menu', '프로젝트 메뉴') as string}
                onClick={(e) => { e.stopPropagation(); setMenuOpen((cur) => cur === p.id ? null : p.id); }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
              </MenuBtn>
              {menuOpen === p.id && (
                <MenuDropdown onClick={(e) => e.stopPropagation()}>
                  {p.status !== 'active' && (
                    <MenuItem type="button" onClick={async () => { setMenuOpen(null); await onStatusChange(p.id, 'active'); }}>
                      {tl('card.resume', '진행 중으로 전환')}
                    </MenuItem>
                  )}
                  {p.status !== 'paused' && p.status !== 'closed' && (
                    <MenuItem type="button" onClick={async () => { setMenuOpen(null); await onStatusChange(p.id, 'paused'); }}>
                      {tl('card.pause', '일시 중지')}
                    </MenuItem>
                  )}
                  {p.status !== 'closed' && (
                    <MenuItem type="button" $danger onClick={() => { setMenuOpen(null); setConfirmCloseId(p.id); }}>
                      {tl('card.close', '프로젝트 종료')}
                    </MenuItem>
                  )}
                </MenuDropdown>
              )}
            </MenuWrap>
          </CardHeadRight>
        </CardHead>
        {p.client_company && <ClientLine>🏢 {p.client_company}</ClientLine>}
        {p.description && <Description>{p.description}</Description>}

        <BottomStack>
        {/* 진행률 — 시각 우위 */}
        <ProgressBlock>
          <ProgressBar>
            <ProgressFill $pct={p.progressPercent} />
          </ProgressBar>
          <ProgressMeta>
            <ProgressPct>{p.progressPercent}%</ProgressPct>
            <ProgressTaskCount>{p.completedTasks} / {p.totalTasks}{t('card.tasksUnit')}</ProgressTaskCount>
            {p.overdueTasks > 0 && (
              <OverdueChip title={t('stats.overdue') as string}>
                ⚠ {p.overdueTasks}
              </OverdueChip>
            )}
          </ProgressMeta>
        </ProgressBlock>

        {/* 기간 + 활동 시간 */}
        {(p.start_date || p.end_date || p.updatedAt) && (
          <MetaLine>
            {(p.start_date || p.end_date) && (
              <MetaItem title={t('stats.period') as string}>
                <MetaIcon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                </MetaIcon>
                <span>{p.start_date ? formatDate(p.start_date) : '—'} → {p.end_date ? formatDate(p.end_date) : '—'}</span>
                {p.end_date && p.status === 'active' && (() => {
                  const diff = Math.ceil((new Date(p.end_date).getTime() - new Date().getTime()) / 86400000);
                  if (diff < 0) return <DDay $danger>D+{Math.abs(diff)}</DDay>;
                  if (diff <= 7) return <DDay $warning>D-{diff}</DDay>;
                  return <DDay>D-{diff}</DDay>;
                })()}
              </MetaItem>
            )}
            {p.updatedAt && (
              <MetaItem title={t('card.lastActivity') as string}>
                <MetaIcon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                </MetaIcon>
                <span>{formatRelativeTime(p.updatedAt, t)}</span>
              </MetaItem>
            )}
          </MetaLine>
        )}

        {/* 멤버 (PM 강조) + 고객 컨택 */}
        {((p.projectMembers && p.projectMembers.length > 0) || (p.projectClients && p.projectClients.length > 0)) && (
          <PeopleRow>
            {p.projectMembers && p.projectMembers.length > 0 && (() => {
              const pm = p.projectMembers.find(m => m.user_id === p.default_assignee_user_id) || p.projectMembers.find(m => m.is_pm);
              const others = p.projectMembers.filter(m => m !== pm);
              return (
                <PeopleGroup>
                  {pm && (
                    <PMBlock title={t('card.pmLabel') as string}>
                      <PMStar>★</PMStar>
                      {/* 워크스페이스 표시명 우선 — display_name (BusinessMember.name) → name fallback */}
                      <PMName>{displayName(pm.User, lang) || `#${pm.user_id}`}</PMName>
                    </PMBlock>
                  )}
                  {others.length > 0 && (
                    <AvatarStack>
                      {others.slice(0, 4).map(m => {
                        const dn = displayName(m.User, lang);
                        return (
                          <Avatar key={m.user_id} title={dn || `#${m.user_id}`}>
                            {(dn || '?').charAt(0).toUpperCase()}
                          </Avatar>
                        );
                      })}
                      {others.length > 4 && <AvatarMore>+{others.length - 4}</AvatarMore>}
                    </AvatarStack>
                  )}
                </PeopleGroup>
              );
            })()}
            {p.projectClients && p.projectClients.length > 0 && (
              <ClientChip>
                <MetaIcon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
                </MetaIcon>
                <span>{p.projectClients.length}{t('card.clientsCount')}</span>
              </ClientChip>
            )}
          </PeopleRow>
        )}
        </BottomStack>
      </ProjectCard>
  );

  return (<>
  {groupBy === 'none'
    ? <CardGrid>{projects.map(renderCard)}</CardGrid>
    : groups.map((g) => (
        <GroupSection key={g.key}>
          <GroupHeader><GroupLabel>{g.label}</GroupLabel><GroupCount>{g.items.length}</GroupCount></GroupHeader>
          <CardGrid>{g.items.map(renderCard)}</CardGrid>
        </GroupSection>
      ))}
  {confirmCloseId != null && (() => {
    const target = projects.find((p) => p.id === confirmCloseId);
    if (!target) return null;
    return (
      <ConfirmBackdrop onClick={() => setConfirmCloseId(null)}>
        <ConfirmModal onClick={(e) => e.stopPropagation()}>
          <ConfirmTitle>{tl('card.closeConfirmTitle', '프로젝트를 종료할까요?')}</ConfirmTitle>
          <ConfirmBody>{tl('card.closeConfirmBody', { defaultValue: '"{{name}}" 프로젝트를 종료합니다. 데이터는 보존되며 필터로 다시 볼 수 있습니다.', name: target.name })}</ConfirmBody>
          <ConfirmRow>
            <ConfirmCancel type="button" onClick={() => setConfirmCloseId(null)}>{tl('common.cancel', '취소')}</ConfirmCancel>
            <ConfirmDanger type="button" onClick={async () => {
              const id = confirmCloseId;
              setConfirmCloseId(null);
              if (id != null) await onStatusChange(id, 'closed');
            }}>{tl('card.closeAction', '종료')}</ConfirmDanger>
          </ConfirmRow>
        </ConfirmModal>
      </ConfirmBackdrop>
    );
  })()}
  </>);
};

// ─── Timeline View (Gantt-like) ───
const TimelineView: React.FC<{
  projects: ProjectWithStats[];
  todayStr: string;
  t: (k: string, o?: Record<string, unknown>) => string;
  onOpen: (projectId: number) => void;
}> = ({ projects, todayStr, t, onOpen }) => {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const toggleExpand = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  // 전체 구간 계산: 프로젝트 + task 까지 포함
  const range = useMemo(() => {
    const dates: string[] = [];
    for (const p of projects) {
      if (p.start_date) dates.push(p.start_date.slice(0, 10));
      if (p.end_date) dates.push(p.end_date.slice(0, 10));
      for (const tk of p.tasks) {
        if (tk.start_date) dates.push(tk.start_date.slice(0, 10));
        if (tk.due_date) dates.push(tk.due_date.slice(0, 10));
      }
    }
    if (dates.length === 0) {
      return { from: addDaysStr(todayStr, -30), to: addDaysStr(todayStr, 60) };
    }
    return { from: dates.sort()[0], to: dates.sort()[dates.length - 1] };
  }, [projects, todayStr]);

  const totalDays = useMemo(() => {
    const a = new Date(range.from + 'T00:00:00Z').getTime();
    const b = new Date(range.to + 'T00:00:00Z').getTime();
    return Math.max(1, Math.round((b - a) / 86400000) + 1);
  }, [range]);

  const dayPct = (dateStr: string) => {
    const a = new Date(range.from + 'T00:00:00Z').getTime();
    const d = new Date(dateStr + 'T00:00:00Z').getTime();
    return ((d - a) / 86400000 / totalDays) * 100;
  };

  // 월 단위 눈금 라벨 계산
  const monthTicks = useMemo(() => {
    const ticks: { date: string; label: string; leftPct: number }[] = [];
    const [fy, fm] = range.from.split('-').map(Number);
    // 첫 달 1일부터 마지막 날 포함까지 매월 1일 지점
    let cy = fy, cm = fm - 1; // 0-indexed
    for (let i = 0; i < 24; i++) {
      const d = new Date(Date.UTC(cy, cm, 1));
      const iso = d.toISOString().slice(0, 10);
      if (iso > range.to) break;
      if (iso >= range.from) {
        ticks.push({ date: iso, label: `${d.getUTCFullYear()}.${String(d.getUTCMonth() + 1).padStart(2, '0')}`, leftPct: dayPct(iso) });
      }
      cm += 1; if (cm > 11) { cm = 0; cy += 1; }
    }
    return ticks;
  }, [range]);

  const todayLeft = Math.min(100, Math.max(0, dayPct(todayStr)));

  return (
    <TimelineWrap>
      <TimelineHeader>
        <TimelineHeadLabel>{t('timeline.project')}</TimelineHeadLabel>
        <TimelineScale>
          {monthTicks.map((mt) => (
            <ScaleTick key={mt.date} style={{ left: `${mt.leftPct}%` }}>
              <ScaleTickBar />
              <ScaleTickLabel>{mt.label}</ScaleTickLabel>
            </ScaleTick>
          ))}
        </TimelineScale>
      </TimelineHeader>
      {projects.map((p) => {
        const start = p.start_date ? p.start_date.slice(0, 10) : range.from;
        const end = p.end_date ? p.end_date.slice(0, 10) : range.to;
        const left = Math.max(0, dayPct(start));
        const right = Math.min(100, dayPct(end));
        const width = Math.max(2, right - left);
        const color = colorForProject(p);
        const isExpanded = expanded.has(p.id);
        const hasTasksWithDates = p.tasks.some((tk) => tk.start_date || tk.due_date);
        return (
          <React.Fragment key={p.id}>
            <TimelineRow>
              <TimelineRowLabel>
                {hasTasksWithDates ? (
                  <ExpandBtn type="button" onClick={() => toggleExpand(p.id)}
                    aria-expanded={isExpanded} aria-label={isExpanded ? t('timeline.collapse') : t('timeline.expand')}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                      style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}>
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </ExpandBtn>
                ) : (<ExpandSpacer />)}
                <ProjectNameBtn type="button" onClick={() => onOpen(p.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter') onOpen(p.id); }}
                  style={{ borderLeft: `3px solid ${color}` }}>
                  <strong>{p.name}</strong>
                  <small>{p.progressPercent}%</small>
                </ProjectNameBtn>
              </TimelineRowLabel>
              <TimelineTrack>
                {monthTicks.map((mt) => (
                  <ScaleGridLine key={mt.date} style={{ left: `${mt.leftPct}%` }} />
                ))}
                <TodayMarker style={{ left: `${todayLeft}%` }} title={`${t('cal.today')} · ${todayStr}`} />
                <TimelineBar style={{ left: `${left}%`, width: `${width}%`, background: color }}
                  title={`${start} ~ ${end}`}>
                  <BarFill style={{ width: `${p.progressPercent}%` }} />
                </TimelineBar>
              </TimelineTrack>
            </TimelineRow>
            {/* Task 세부 행 — 프로젝트 펼쳐졌을 때만 */}
            {isExpanded && p.tasks.filter((tk) => tk.start_date || tk.due_date).map((tk) => {
              const ts = (tk.start_date || tk.due_date || '').slice(0, 10);
              const te = (tk.due_date || tk.start_date || '').slice(0, 10);
              const tl = Math.max(0, dayPct(ts));
              const tr2 = Math.min(100, dayPct(te));
              const tw = Math.max(1.5, tr2 - tl);
              return (
                <TimelineRow key={`t-${tk.id}`} $task>
                  <TimelineRowLabel>
                    <ExpandSpacer />
                    <TaskNameLabel style={{ borderLeft: `3px solid ${color}` }}>
                      <span>{tk.title}</span>
                      <small>{tk.progress_percent || 0}%</small>
                    </TaskNameLabel>
                  </TimelineRowLabel>
                  <TimelineTrack>
                    {monthTicks.map((mt) => (
                      <ScaleGridLine key={mt.date} style={{ left: `${mt.leftPct}%` }} />
                    ))}
                    <TodayMarker style={{ left: `${todayLeft}%` }} />
                    <TimelineTaskBar style={{
                      left: `${tl}%`, width: `${tw}%`,
                      background: lightenColor(color, 0.35),
                      border: `1px solid ${color}`,
                    }} title={`${tk.title} · ${ts} ~ ${te}`}>
                      <BarFill style={{ width: `${tk.progress_percent || 0}%`, background: color, opacity: 0.7 }} />
                    </TimelineTaskBar>
                  </TimelineTrack>
                </TimelineRow>
              );
            })}
          </React.Fragment>
        );
      })}
    </TimelineWrap>
  );
};

// ─── Calendar View (월별 마감일) ───
const CalendarView: React.FC<{
  projects: ProjectWithStats[];
  todayStr: string;
  t: (k: string, o?: Record<string, unknown>) => string;
}> = ({ projects, todayStr, t }) => {
  const [monthOffset, setMonthOffset] = useState(0);
  const [y, m] = todayStr.split('-').map(Number);
  const baseDate = new Date(Date.UTC(y, m - 1 + monthOffset, 1));
  const year = baseDate.getUTCFullYear();
  const month = baseDate.getUTCMonth();

  const firstDay = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;

  // 날짜별 이벤트 수집 (프로젝트 start/end + task due/start) — 모두 프로젝트 색상으로
  type Ev = { type: 'projectStart' | 'projectEnd' | 'taskDue' | 'taskStart'; name: string; projectName: string; color: string };
  const eventsByDay: Record<string, Ev[]> = {};
  const add = (dateStr: string, ev: Ev) => {
    if (!dateStr || !dateStr.startsWith(monthStr)) return;
    const key = dateStr.slice(0, 10);
    if (!eventsByDay[key]) eventsByDay[key] = [];
    eventsByDay[key].push(ev);
  };
  for (const p of projects) {
    const pColor = colorForProject(p);
    if (p.start_date) add(p.start_date, { type: 'projectStart', name: `${p.name} · ${t('cal.start')}`, projectName: p.name, color: pColor });
    if (p.end_date) add(p.end_date, { type: 'projectEnd', name: `${p.name} · ${t('cal.end')}`, projectName: p.name, color: pColor });
    for (const tk of p.tasks) {
      if (tk.status === 'canceled') continue;
      if (tk.start_date) add(tk.start_date, { type: 'taskStart', name: tk.title, projectName: p.name, color: pColor });
      if (tk.due_date) add(tk.due_date, { type: 'taskDue', name: tk.title, projectName: p.name, color: pColor });
    }
  }

  const weekDays = [
    t('cal.sun'), t('cal.mon'), t('cal.tue'), t('cal.wed'), t('cal.thu'), t('cal.fri'), t('cal.sat'),
  ];
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <CalendarWrap>
      <CalendarHeader>
        <MonthNavBtn onClick={() => setMonthOffset((o) => o - 1)} type="button">‹</MonthNavBtn>
        <MonthLabel>{year}.{String(month + 1).padStart(2, '0')}</MonthLabel>
        <MonthNavBtn onClick={() => setMonthOffset((o) => o + 1)} type="button">›</MonthNavBtn>
        <MonthNavBtn onClick={() => setMonthOffset(0)} type="button" style={{ marginLeft: 'auto', fontSize: 12 }}>
          {t('cal.today')}
        </MonthNavBtn>
      </CalendarHeader>
      <CalendarGrid>
        {weekDays.map((w) => <CalWeekday key={w}>{w}</CalWeekday>)}
        {cells.map((d, i) => {
          if (d === null) return <CalCell key={`e${i}`} $empty />;
          const dayStr = `${monthStr}-${String(d).padStart(2, '0')}`;
          const isToday = dayStr === todayStr;
          const events = eventsByDay[dayStr] || [];
          return (
            <CalCell key={dayStr} $today={isToday}>
              <CalDayNum $today={isToday}>{d}</CalDayNum>
              {events.slice(0, 3).map((e, idx) => (
                <CalEvent key={idx}
                  $bg={lightenColor(e.color, 0.15)}
                  $fg={e.color}
                  title={`${e.projectName}: ${e.name}`}>
                  <CalDot $color={e.color} />
                  <CalEventText>{e.name}</CalEventText>
                </CalEvent>
              ))}
              {events.length > 3 && <CalMore>+{events.length - 3}</CalMore>}
            </CalCell>
          );
        })}
      </CalendarGrid>
    </CalendarWrap>
  );
};

// ─── Styled ───
const NewProjectCta = styled.button`
  display:inline-flex;align-items:center;justify-content:center;gap:6px;
  padding:0 12px;height:32px;background:#14B8A6;color:#FFF;border:none;border-radius:8px;
  font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;
  &:hover{background:#0D9488;}
  @media(max-width:640px){width:32px;padding:0;span{display:none;}}
`;
const ViewTabs = styled.div`
  display: inline-flex;
  gap: 4px;
  padding: 3px;
  background: #F1F5F9;
  border-radius: 8px;
  @media (max-width: 640px) {
    gap: 2px;
    padding: 2px;
  }
`;
const ViewTab = styled.button<{ $active: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: none;
  background: ${p => p.$active ? '#FFFFFF' : 'transparent'};
  color: ${p => p.$active ? '#0F766E' : '#64748B'};
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: ${p => p.$active ? '0 1px 2px rgba(0,0,0,0.06)' : 'none'};
  transition: background 0.15s;
  &:hover { background: ${p => p.$active ? '#FFFFFF' : '#E2E8F0'}; }
  @media (max-width: 640px) {
    padding: 6px 8px;
    span { display: none; }
  }
`;

const EmptyState = styled.div`
  flex: 1;
  min-height: 60vh;
  padding: 40px 20px;
  text-align: center;
  color: #94A3B8;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
`;
const EmptyIcon = styled.div`color: #CBD5E1; margin-bottom: 4px;`;
const EmptyTitle = styled.div`font-size: 15px; font-weight: 600; color: #334155;`;
const EmptyDesc = styled.div`font-size: 13px; color: #64748B;`;
const EmptyCta = styled.button`
  margin-top: 12px;
  padding: 8px 16px;
  background: #14B8A6;
  color: #FFFFFF;
  border: none;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s;
  &:hover { background: #0D9488; }
  &:focus-visible { box-shadow: 0 0 0 3px rgba(20, 184, 166, 0.3); outline: none; }
`;

// List view
const CardGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
  @media (max-width: 768px) { grid-template-columns: 1fr; gap: 12px; }
`;
// #99 — 그룹 섹션
const GroupSection = styled.section` margin-bottom: 22px; `;
const GroupHeader = styled.div` display: flex; align-items: center; gap: 8px; margin: 0 0 10px; `;
const GroupLabel = styled.h3` margin: 0; font-size: 13px; font-weight: 700; color: #0F172A; letter-spacing: -0.2px; `;
const GroupCount = styled.span` display: inline-flex; align-items: center; justify-content: center; min-width: 20px; height: 18px; padding: 0 6px; background: #E2E8F0; color: #475569; border-radius: 999px; font-size: 10px; font-weight: 700; `;
const ProjectCard = styled.div`
  background: #FFFFFF;
  border: 1px solid #E2E8F0;
  border-radius: 12px;
  padding: 16px 18px;
  cursor: pointer;
  transition: box-shadow 0.15s, border-color 0.15s, transform 0.15s;
  /* 카드 내부 flex column — 하단 블록 (진행률·기간·사람) 을 카드 바닥에 정렬.
     사이클 N+22 — min-height 강제 제거 (Irene): 내용 적은 카드는 짧게,
     같은 row 의 옆 카드와는 grid stretch (default) 로 상하단 자동 정렬됨. */
  display: flex;
  flex-direction: column;
  &:hover {
    box-shadow: 0 4px 12px rgba(15, 23, 42, 0.08);
    border-color: #CBD5E1;
    transform: translateY(-1px);
  }
  &:focus-visible {
    outline: none;
    box-shadow: 0 0 0 3px rgba(20, 184, 166, 0.3);
    border-color: #14B8A6;
  }
`;
// 하단 고정 블록 — 진행률 + 기간 + 사람 정보를 카드 바닥에 정렬
const BottomStack = styled.div`
  margin-top: auto;
  padding-top: 14px;
  border-top: 1px solid #F1F5F9;
  display: flex; flex-direction: column;
  gap: 10px;
`;
const CardHead = styled.div`display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; margin-bottom: 8px;`;
const CardTitle = styled.div`font-size: 15px; font-weight: 700; color: #0F172A; line-height: 1.4;`;
const StatusBadge = styled.span<{ $bg?: string; $fg?: string }>`
  flex-shrink: 0;
  padding: 2px 10px;
  background: ${p => p.$bg || '#F1F5F9'};
  color: ${p => p.$fg || '#64748B'};
  border-radius: 16px;
  font-size: 11px;
  font-weight: 600;
`;
const ClientLine = styled.div`font-size: 12px; color: #64748B; margin-bottom: 8px; display: inline-flex; align-items: center; gap: 4px;`;
const Description = styled.div`font-size: 13px; color: #475569; line-height: 1.5; margin-bottom: 12px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;`;

// ─── Progress block ───
const ProgressBlock = styled.div`display: flex; flex-direction: column; gap: 6px;`;
const ProgressMeta = styled.div`
  display: flex; align-items: center; gap: 10px;
  font-size: 12px;
`;
const ProgressPct = styled.span`font-weight: 700; color: #0F766E;`;
const ProgressTaskCount = styled.span`color: #64748B;`;
const OverdueChip = styled.span`
  display: inline-flex; align-items: center; gap: 2px;
  padding: 2px 8px; border-radius: 999px;
  background: #FEE2E2; color: #B91C1C;
  font-size: 11px; font-weight: 700;
  margin-left: auto;
`;

// ─── Meta line (기간 + 활동) ───
const MetaLine = styled.div`
  display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
  font-size: 12px; color: #64748B;
`;
const MetaItem = styled.div`
  display: inline-flex; align-items: center; gap: 6px;
  span { white-space: nowrap; }
`;
const MetaIcon = styled.svg`width: 13px; height: 13px; flex-shrink: 0; color: #94A3B8;`;
const DDay = styled.span<{ $danger?: boolean; $warning?: boolean }>`
  display: inline-flex; align-items: center;
  padding: 1px 6px; border-radius: 4px;
  font-size: 10px; font-weight: 700;
  ${p => p.$danger ? 'background: #FEE2E2; color: #B91C1C;' :
        p.$warning ? 'background: #FEF3C7; color: #92400E;' :
        'background: #F0FDFA; color: #0F766E;'}
`;

// ─── People (PM 강조 + 멤버 + 고객) ───
const PeopleRow = styled.div`
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
`;
const PeopleGroup = styled.div`
  display: flex; align-items: center; gap: 8px;
  flex: 1; min-width: 0;
`;
const PMBlock = styled.div`
  display: inline-flex; align-items: center; gap: 4px;
  padding: 3px 8px 3px 6px;
  background: #FFF7ED; border: 1px solid #FDE68A; border-radius: 999px;
`;
const PMStar = styled.span`color: #F59E0B; font-size: 11px;`;
const PMName = styled.span`font-size: 11px; font-weight: 700; color: #92400E;`;
const AvatarStack = styled.div`
  display: inline-flex; align-items: center;
  & > * { margin-left: -6px; &:first-child { margin-left: 0; } }
`;
const Avatar = styled.span`
  display: inline-flex; align-items: center; justify-content: center;
  width: 24px; height: 24px; border-radius: 50%;
  background: #0F766E; color: #FFFFFF;
  font-size: 11px; font-weight: 700;
  border: 2px solid #FFFFFF;
  flex-shrink: 0;
`;
const AvatarMore = styled.span`
  display: inline-flex; align-items: center; justify-content: center;
  width: 24px; height: 24px; border-radius: 50%;
  background: #F1F5F9; color: #475569;
  font-size: 10px; font-weight: 700;
  border: 2px solid #FFFFFF;
  flex-shrink: 0;
`;
const ClientChip = styled.span`
  display: inline-flex; align-items: center; gap: 4px;
  padding: 3px 10px; border-radius: 999px;
  background: #F1F5F9; color: #475569;
  font-size: 11px; font-weight: 600;
  flex-shrink: 0;
`;
const ProgressBar = styled.div`height: 6px; background: #F1F5F9; border-radius: 999px; overflow: hidden; margin-top: 12px;`;
const ProgressFill = styled.div<{ $pct: number }>`height: 100%; width: ${p => p.$pct}%; background: linear-gradient(90deg, #14B8A6, #0D9488); border-radius: 999px; transition: width 0.3s;`;

// ─── Card 액션 메뉴 ───
const CardHeadRight = styled.div`display:flex; align-items:center; gap:6px; flex-shrink:0;`;
const MenuWrap = styled.div`position:relative;`;
const MenuBtn = styled.button`
  width:24px; height:24px; display:flex; align-items:center; justify-content:center;
  background:transparent; border:none; border-radius:6px; color:#94A3B8; cursor:pointer;
  &:hover{ background:#F1F5F9; color:#0F172A; }
  &:focus-visible{ outline:2px solid #14B8A6; outline-offset:-2px; }
`;
const MenuDropdown = styled.div`
  position:absolute; top:calc(100% + 4px); right:0; z-index:20;
  min-width:160px; background:#FFFFFF; border:1px solid #E2E8F0; border-radius:8px;
  padding:4px; box-shadow:0 4px 12px rgba(0,0,0,0.08); display:flex; flex-direction:column;
`;
const MenuItem = styled.button<{ $danger?: boolean }>`
  padding:8px 10px; text-align:left; background:transparent; border:none; border-radius:6px;
  font-size:13px; font-weight:500; color:${p => p.$danger ? '#DC2626' : '#0F172A'}; cursor:pointer;
  &:hover{ background:${p => p.$danger ? '#FEF2F2' : '#F8FAFC'}; }
`;

// 종료 확인 모달
const ConfirmBackdrop = styled.div`
  position:fixed; inset:0; background:rgba(15,23,42,0.4); z-index:200;
  display:flex; align-items:center; justify-content:center; padding:24px;
  @media (max-width: 640px) { padding:16px; }
`;
const ConfirmModal = styled.div`
  background:#FFFFFF; border-radius:12px; padding:24px; max-width:400px; width:100%;
  box-shadow:0 10px 40px rgba(0,0,0,0.15);
  @media (max-width: 640px) { margin-top:60px; max-height:calc(100vh - 100px); overflow-y:auto; }
`;
const ConfirmTitle = styled.h3`margin:0 0 8px; font-size:16px; font-weight:700; color:#0F172A;`;
const ConfirmBody = styled.p`margin:0 0 20px; font-size:13px; color:#475569; line-height:1.5;`;
const ConfirmRow = styled.div`display:flex; gap:8px; justify-content:flex-end;`;
const ConfirmCancel = styled.button`
  padding:8px 14px; background:#FFFFFF; color:#334155; border:1px solid #CBD5E1; border-radius:8px;
  font-size:13px; font-weight:600; cursor:pointer;
  &:hover{ background:#F8FAFC; border-color:#94A3B8; }
`;
const ConfirmDanger = styled.button`
  padding:8px 14px; background:#DC2626; color:#FFFFFF; border:none; border-radius:8px;
  font-size:13px; font-weight:700; cursor:pointer;
  &:hover{ background:#B91C1C; }
`;

// #99 — 정렬 셀렉트
const SortSelect = styled.select`
  height: 34px; padding: 0 28px 0 10px; border: 1px solid #E2E8F0; border-radius: 8px;
  background: #FFFFFF; font-size: 12px; font-weight: 600; color: #334155; cursor: pointer;
  font-family: inherit; appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2364748B' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
  background-repeat: no-repeat; background-position: right 8px center;
  &:hover { border-color: #CBD5E1; }
  &:focus { outline: none; border-color: #14B8A6; }
`;

// 상태 필터 세그먼트 (ClientsPage 와 동일 디자인 패턴 — UI 일관성)
const FilterSeg = styled.div`
  display: inline-flex; background: #F1F5F9; padding: 3px; border-radius: 8px; gap: 2px;
  @media (max-width: 640px) { padding: 2px; }
`;
const FilterSegBtn = styled.button<{ $active: boolean }>`
  padding: 6px 12px; border: none;
  background: ${p => p.$active ? '#FFFFFF' : 'transparent'};
  color: ${p => p.$active ? '#0F766E' : '#64748B'};
  border-radius: 6px;
  font-size: 12px; font-weight: 600; cursor: pointer;
  box-shadow: ${p => p.$active ? '0 1px 2px rgba(0,0,0,0.06)' : 'none'};
  transition: color 0.15s, background 0.15s;
  &:hover { color: #0F766E; }
  &:focus-visible { outline: 2px solid rgba(15,118,110,0.5); outline-offset: 2px; }
  @media (max-width: 640px) { padding: 6px 10px; font-size: 11px; }
`;

// Timeline
const TimelineWrap = styled.div`background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 12px; padding: 20px;`;
const TimelineHeader = styled.div`
  display: grid; grid-template-columns: 200px 1fr; gap: 12px; margin-bottom: 12px; padding-bottom: 12px; border-bottom: 1px solid #E2E8F0;
  @media (max-width: 768px) { grid-template-columns: 120px 1fr; gap: 8px; }
`;
const TimelineHeadLabel = styled.div`font-size: 12px; color: #64748B; font-weight: 600;`;
const TimelineScale = styled.div`position: relative; height: 20px;`;
const ScaleTick = styled.div`position: absolute; top: 0; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; gap: 2px;`;
const ScaleTickBar = styled.div`width: 1px; height: 6px; background: #CBD5E1;`;
const ScaleTickLabel = styled.div`font-size: 11px; color: #64748B; white-space: nowrap;`;
const ScaleGridLine = styled.div`position: absolute; top: 0; bottom: 0; width: 1px; background: #F1F5F9; z-index: 0;`;
const TimelineRow = styled.div<{ $task?: boolean }>`
  display: grid;
  grid-template-columns: 200px 1fr;
  gap: 12px;
  padding: ${(p) => p.$task ? '6px 0' : '10px 0'};
  align-items: center;
  ${(p) => p.$task && 'background: #FBFCFD;'}
  @media (max-width: 768px) { grid-template-columns: 120px 1fr; gap: 8px; }
`;
const TimelineRowLabel = styled.div`display: flex; align-items: center; gap: 4px; font-size: 13px; color: #0F172A;`;
const ExpandBtn = styled.button`
  flex: 0 0 auto;
  width: 20px; height: 20px;
  display: inline-flex; align-items: center; justify-content: center;
  border: none; background: transparent; color: #64748B; border-radius: 4px; cursor: pointer;
  &:hover { background: #F1F5F9; color: #0F172A; }
  &:focus-visible { outline: none; box-shadow: 0 0 0 2px rgba(20, 184, 166, 0.3); }
`;
const ExpandSpacer = styled.span`flex: 0 0 auto; width: 20px; height: 20px; display: inline-block;`;
const ProjectNameBtn = styled.button`
  flex: 1 1 auto;
  display: flex; justify-content: space-between; align-items: center; gap: 8px;
  padding: 4px 8px;
  background: transparent;
  border: none;
  border-left: 3px solid transparent;
  font: inherit;
  color: #0F172A;
  text-align: left;
  cursor: pointer;
  border-radius: 0 4px 4px 0;
  transition: background 0.15s;
  strong { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  small { color: #64748B; font-size: 11px; flex-shrink: 0; }
  &:hover { background: #F8FAFC; }
  &:focus-visible { outline: none; background: #F0FDFA; box-shadow: 0 0 0 2px rgba(20, 184, 166, 0.25); }
`;
const TaskNameLabel = styled.div`
  flex: 1 1 auto;
  display: flex; justify-content: space-between; align-items: center; gap: 8px;
  padding: 2px 8px;
  border-left: 3px solid transparent;
  color: #475569;
  font-size: 12px;
  span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  small { color: #94A3B8; font-size: 10px; flex-shrink: 0; }
`;
const TimelineTrack = styled.div`position: relative; height: 24px; background: #F8FAFC; border-radius: 4px; overflow: hidden;`;
const TodayMarker = styled.div`position: absolute; top: 0; bottom: 0; width: 2px; background: #F43F5E; z-index: 2; cursor: help;`;
const TimelineBar = styled.div`position: absolute; top: 4px; bottom: 4px; border-radius: 4px; overflow: hidden; opacity: 0.92; z-index: 1;`;
const TimelineTaskBar = styled.div`position: absolute; top: 6px; bottom: 6px; border-radius: 3px; overflow: hidden; z-index: 1;`;
const BarFill = styled.div`height: 100%; background: rgba(255,255,255,0.45);`;

// Calendar
const CalendarWrap = styled.div`background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 12px; padding: 16px;`;
const CalendarHeader = styled.div`display: flex; align-items: center; gap: 12px; margin-bottom: 12px;`;
const MonthNavBtn = styled.button`padding: 6px 12px; border: 1px solid #E2E8F0; border-radius: 6px; background: #FFFFFF; color: #0F172A; cursor: pointer; font-size: 14px; &:hover { background: #F8FAFC; }`;
const MonthLabel = styled.div`font-size: 16px; font-weight: 700; color: #0F172A;`;
const CalendarGrid = styled.div`display: grid; grid-template-columns: repeat(7, 1fr); gap: 1px; background: #E2E8F0; border: 1px solid #E2E8F0; border-radius: 8px; overflow: hidden;`;
const CalWeekday = styled.div`padding: 8px; background: #F8FAFC; text-align: center; font-size: 12px; font-weight: 600; color: #64748B;`;
const CalCell = styled.div<{ $empty?: boolean; $today?: boolean }>`
  min-height: 96px;
  padding: 6px;
  background: ${p => p.$empty ? '#F8FAFC' : p.$today ? '#F0FDFA' : '#FFFFFF'};
  ${p => p.$today && 'box-shadow: inset 0 0 0 2px #14B8A6;'}
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow: hidden;
  @media (max-width: 768px) {
    min-height: 64px;
    padding: 4px;
  }
`;
const CalDayNum = styled.div<{ $today?: boolean }>`font-size: 12px; font-weight: ${p => p.$today ? 700 : 500}; color: ${p => p.$today ? '#0F766E' : '#334155'}; margin-bottom: 2px;`;
const CalEvent = styled.div<{ $bg?: string; $fg?: string }>`
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 4px;
  background: ${p => p.$bg || '#F1F5F9'};
  color: ${p => p.$fg || '#475569'};
`;
const CalDot = styled.span<{ $color?: string }>`
  display: inline-block;
  flex: 0 0 auto;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: ${p => p.$color || '#94A3B8'};
`;
const CalEventText = styled.span`
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;
const CalMore = styled.div`font-size: 10px; color: #94A3B8; padding: 2px 6px;`;
