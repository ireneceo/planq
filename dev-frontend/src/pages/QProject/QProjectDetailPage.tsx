// /projects/p/:id — 프로젝트 허브 (대시보드/업무/문서/고객/프로세스 파트 5탭)
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../contexts/AuthContext';
import PageShell from '../../components/Layout/PageShell';
import { useTimeFormat } from '../../hooks/useTimeFormat';
import ProcessPartsTab from './ProcessPartsTab';
import TasksTab from './TasksTab';
import DocsTab from './DocsTab';
import PostsPage from '../../components/Docs/PostsPage';
import PlanQSelect from '../../components/Common/PlanQSelect';
import CalendarPicker from '../../components/Common/CalendarPicker';
import { PROJECT_COLOR_PALETTE } from '../../utils/projectColors';
import { GanttHeader, GanttRowTrack, GanttBar, useGanttScrollSync, type GanttRange } from '../../components/Common/GanttTrack';
import { STATUS_COLOR, displayStatus, type StatusCode } from '../../utils/taskLabel';

const PROJECT_COLORS = PROJECT_COLOR_PALETTE.map(p => p.value);

type TabKey = 'dashboard' | 'tasks' | 'info' | 'process' | 'clients' | 'files' | 'docs';

interface BizMember { id: number; user_id: number; user?: { id: number; name: string; email?: string; is_ai?: boolean } }

interface ProjectDetail {
  id: number;
  business_id: number;
  name: string;
  description: string | null;
  client_company: string | null;
  status: string;
  start_date: string | null;
  end_date: string | null;
  project_type?: 'fixed' | 'ongoing';
  process_tab_label?: string;
  color?: string | null;
  owner_user_id: number;
  Business?: { id: number; name: string; brand_name?: string };
  projectMembers?: { user_id: number; role: string; is_pm?: boolean; User?: { id: number; name: string } }[];
  projectClients?: { id: number; contact_name: string; contact_email: string | null; contact_user_id?: number | null; invite_token?: string | null }[];
}
interface Conv {
  id: number;
  title: string | null;
  channel_type: string;
  unread_count?: number;
  last_message_at?: string | null;
}
interface TaskRow {
  id: number; title: string; status: string; due_date: string | null; start_date: string | null;
  assignee_id: number | null; assignee?: { id: number; name: string } | null; progress_percent?: number;
}

const QProjectDetailPage: React.FC = () => {
  const { t } = useTranslation('qproject');
  const { formatDate } = useTimeFormat();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const projectId = id ? Number(id) : 0;
  const [searchParams, setSearchParams] = useSearchParams();

  const validTabs: TabKey[] = ['dashboard', 'tasks', 'info', 'process', 'clients', 'files', 'docs'];
  const initialTab = (searchParams.get('tab') as TabKey) || 'dashboard';
  const [tab, setTabState] = useState<TabKey>(validTabs.includes(initialTab) ? initialTab : 'dashboard');
  const setTab = (k: TabKey) => {
    setTabState(k);
    const sp = new URLSearchParams(searchParams);
    if (k === 'dashboard') sp.delete('tab'); else sp.set('tab', k);
    setSearchParams(sp, { replace: true });
  };
  const [editingTabLabel, setEditingTabLabel] = useState(false);
  const [tabLabelDraft, setTabLabelDraft] = useState('');
  const [newClientName, setNewClientName] = useState('');
  const [newClientEmail, setNewClientEmail] = useState('');
  const [issues, setIssues] = useState<{ id: number; body: string; author?: { name: string }; created_at: string }[]>([]);
  const [notes, setNotes] = useState<{ id: number; body: string; visibility: string; author?: { name: string }; created_at: string }[]>([]);
  const [newIssue, setNewIssue] = useState('');
  const [newNote, setNewNote] = useState('');
  const [newNoteVis, setNewNoteVis] = useState<'personal' | 'internal'>('internal');
  const submittingRef = useRef(false);
  const periodAnchorRef = useRef<HTMLButtonElement>(null);
  const [periodPickerOpen, setPeriodPickerOpen] = useState(false);
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [convs, setConvs] = useState<Conv[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [bizMembers, setBizMembers] = useState<BizMember[]>([]);
  const [bizClients, setBizClients] = useState<{ id: number; display_name: string | null; company_name: string | null; user?: { id: number; name: string; email: string } }[]>([]);
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [closeModalOpen, setCloseModalOpen] = useState(false);
  const [clientsToRemove, setClientsToRemove] = useState<Set<number>>(new Set());
  const [closing, setClosing] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const [pr, cr, tr, ir, nr] = await Promise.all([
        apiFetch(`/api/projects/${projectId}`).then(r => r.json()),
        apiFetch(`/api/projects/${projectId}/conversations`).then(r => r.json()),
        apiFetch(`/api/projects/${projectId}/tasks`).then(r => r.json()).catch(() => ({ data: [] })),
        apiFetch(`/api/projects/${projectId}/issues`).then(r => r.json()).catch(() => ({ data: [] })),
        apiFetch(`/api/projects/${projectId}/notes`).then(r => r.json()).catch(() => ({ data: [] })),
      ]);
      if (pr.success) {
        setProject(pr.data);
        // 비즈니스 멤버 후보 로드 (멤버 추가 드롭다운용)
        if (pr.data.business_id) {
          const [mr, cr] = await Promise.all([
            apiFetch(`/api/businesses/${pr.data.business_id}/members`).then(r => r.json()).catch(() => null),
            apiFetch(`/api/clients/${pr.data.business_id}`).then(r => r.json()).catch(() => null),
          ]);
          if (mr?.success) setBizMembers((mr.data || []).filter((m: BizMember) => !m.user?.is_ai));
          if (cr?.success) setBizClients(cr.data || []);
        }
      }
      if (cr.success) setConvs(cr.data || []);
      if (tr.success) setTasks(tr.data || []);
      if (ir.success) setIssues(ir.data || []);
      if (nr.success) setNotes(nr.data || []);
    } finally { setLoading(false); }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const stats = useMemo(() => {
    const total = tasks.length;
    const completed = tasks.filter(t => t.status === 'completed').length;
    const today = new Date().toISOString().slice(0, 10);
    const overdue = tasks.filter(t => t.due_date && t.due_date.slice(0, 10) < today && t.status !== 'completed' && t.status !== 'canceled').length;
    const progress = total === 0 ? 0 : Math.round(tasks.reduce((s, t) => s + (t.status === 'completed' ? 100 : (t.progress_percent || 0)), 0) / total);
    return { total, completed, overdue, progress, inProgress: total - completed };
  }, [tasks]);

  // ── 멤버 관리 (bulk PUT) ──
  const saveMembers = async (next: { user_id: number; role: string; is_pm?: boolean; User?: { id: number; name: string } }[]) => {
    if (!project) return;
    setProject(prev => prev ? { ...prev, projectMembers: next } : prev);
    try {
      const r = await apiFetch(`/api/projects/${projectId}/members`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ members: next.map(m => ({ user_id: m.user_id, role: m.role || '기타', is_pm: !!m.is_pm })) }),
      });
      const j = await r.json();
      if (j.success) setProject(j.data);
    } catch { /* optimistic — 실패 시 다음 조작에 서버 값으로 덮어짐 */ }
  };
  const addMember = (userId: number) => {
    const existing = project?.projectMembers || [];
    if (existing.some(m => m.user_id === userId)) return;
    const bm = bizMembers.find(b => b.user_id === userId);
    if (!bm?.user) return;
    saveMembers([...existing, { user_id: userId, role: '팀원', is_pm: false, User: { id: bm.user.id, name: bm.user.name } }]);
    setAddMemberOpen(false);
  };
  const removeMember = (userId: number) => {
    const existing = project?.projectMembers || [];
    saveMembers(existing.filter(m => m.user_id !== userId));
  };
  const updateMemberRole = (userId: number, role: string) => {
    const existing = project?.projectMembers || [];
    saveMembers(existing.map(m => m.user_id === userId ? { ...m, role } : m));
  };
  const togglePm = (userId: number) => {
    if (!project) return;
    // 프로젝트 생성자는 항상 PM — 해제 불가 (서버에서도 강제)
    if (userId === project.owner_user_id) return;
    const existing = project.projectMembers || [];
    saveMembers(existing.map(m => m.user_id === userId ? { ...m, is_pm: !m.is_pm } : m));
  };

  const todayStr = new Date().toISOString().slice(0, 10);

  const performCloseProject = async () => {
    if (!project) return;
    setClosing(true);
    try {
      // 1) 체크된 고객은 각자 DELETE /api/projects/:id/clients/:clientId (프로젝트에서만 제거)
      for (const pcId of clientsToRemove) {
        await apiFetch(`/api/projects/${projectId}/clients/${pcId}`, { method: 'DELETE' });
      }
      // 2) 프로젝트 status=closed → 대화도 자동 archived (백엔드 cascade)
      await apiFetch(`/api/projects/${projectId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'closed' }),
      });
      setProject((prev) => prev ? {
        ...prev, status: 'closed',
        projectClients: (prev.projectClients || []).filter((c) => !clientsToRemove.has(c.id)),
      } : prev);
      setClientsToRemove(new Set());
      setCloseModalOpen(false);
    } finally { setClosing(false); }
  };

  const sortedTasks = useMemo(() => {
    return [...tasks].sort((a, b) => {
      const as = a.start_date || a.due_date || '9999-12-31';
      const bs = b.start_date || b.due_date || '9999-12-31';
      return as.localeCompare(bs);
    });
  }, [tasks]);

  if (!projectId) return <PageShell title="Error"><Empty>{t('error.invalidUrl', '잘못된 주소')}</Empty></PageShell>;
  if (loading) return <PageShell title={t('loading', '로드 중...')}><Empty>{t('loading', '로드 중...')}</Empty></PageShell>;
  if (!project) return <PageShell title="Not found"><Empty>{t('error.notFound', '프로젝트를 찾을 수 없습니다')}</Empty></PageShell>;

  return (
    <PageShell
      title={project.name}
      actions={
        <BackBtn type="button" onClick={() => navigate('/projects')}>← {t('backToList', '목록')}</BackBtn>
      }
    >
      <TabBar>
        {([['dashboard', '대시보드'], ['tasks', '업무'], ['process', project.process_tab_label || t('tab.defaultProcess', '테이블')], ['clients', '고객'], ['files', '파일'], ['docs', '문서'], ['info', '상세정보']] as [TabKey, string][]).map(([k, lbl]) => {
          const defaultProcess = t('tab.defaultProcess', '테이블');
          if (k === 'process' && editingTabLabel) {
            return (
              <TabLabelInput key={k} autoFocus value={tabLabelDraft}
                onChange={e => setTabLabelDraft(e.target.value)}
                onBlur={async () => {
                  const v = tabLabelDraft.trim() || defaultProcess;
                  setEditingTabLabel(false);
                  if (v !== (project.process_tab_label || defaultProcess)) {
                    await apiFetch(`/api/projects/${projectId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ process_tab_label: v }) });
                    setProject(prev => prev ? { ...prev, process_tab_label: v } : prev);
                  }
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  if (e.key === 'Escape') { setTabLabelDraft(''); setEditingTabLabel(false); }
                }} />
            );
          }
          return (
            <Tab key={k} $active={tab === k}
              onClick={() => setTab(k)}
              onDoubleClick={() => { if (k === 'process') { setTabLabelDraft(project.process_tab_label || defaultProcess); setEditingTabLabel(true); } }}
              title={k === 'process' ? t('tab.processEditHint', '더블클릭하여 이름 변경') as string : ''}
            >
              {t(`tab.${k}`, lbl)}
              {k === 'process' && tab === k && (
                <TabEditIcon onClick={e => { e.stopPropagation(); setTabLabelDraft(project.process_tab_label || defaultProcess); setEditingTabLabel(true); }} title={t('tab.renameHint', '이름 변경') as string}>✎</TabEditIcon>
              )}
            </Tab>
          );
        })}
      </TabBar>

      {tab === 'dashboard' && (
        <DashboardBody>
          {/* 기본 정보 카드 (순서 1) */}
          <Card style={{ order: 1 }}>
            <CardTitle>{t('section.info', '기본 정보')}</CardTitle>
            <InfoGrid>
              <InfoCell><InfoLabel>{t('info.type', '타입')}</InfoLabel><TypeBadge>{project.project_type === 'ongoing' ? t('info.typeOngoing', '지속 구독') : t('info.typeFixed', '일시 프로젝트')}</TypeBadge></InfoCell>
              <InfoCell><InfoLabel>{t('info.client', '고객사')}</InfoLabel><InfoValue>{project.client_company || t('info.noValue', '—')}</InfoValue></InfoCell>
              <InfoCell><InfoLabel>{t('info.period', '기간')}</InfoLabel><InfoValue>
                {project.start_date ? formatDate(project.start_date) : t('info.noValue', '—')} {project.project_type === 'fixed' && <>~ {project.end_date ? formatDate(project.end_date) : t('info.noValue', '—')}</>}
              </InfoValue></InfoCell>
              <InfoCell><InfoLabel>{t('info.members', '멤버')}</InfoLabel><InfoValue>{t('info.memberCount', '{{n}}명', { n: (project.projectMembers || []).length })}</InfoValue></InfoCell>
            </InfoGrid>
            {project.description && <Description>{project.description}</Description>}
          </Card>

          {/* 진척 (순서 4) */}
          <Card style={{ order: 4 }}>
            <CardTitle>{t('section.progress', '진척')} <small>{stats.completed}/{stats.total}</small></CardTitle>
            <ProgressRow>
              <ProgressTrack><ProgressFill $w={stats.progress} /></ProgressTrack>
              <ProgressPct>{stats.progress}%</ProgressPct>
            </ProgressRow>
            <StatRow>
              <Stat><StatNum>{stats.total}</StatNum><StatLabel>{t('stats.total', '전체')}</StatLabel></Stat>
              <Stat><StatNum style={{ color: '#14B8A6' }}>{stats.inProgress}</StatNum><StatLabel>{t('stats.inProgress', '진행')}</StatLabel></Stat>
              <Stat><StatNum style={{ color: '#22C55E' }}>{stats.completed}</StatNum><StatLabel>{t('stats.completed', '완료')}</StatLabel></Stat>
              <Stat><StatNum style={{ color: '#DC2626' }}>{stats.overdue}</StatNum><StatLabel>{t('stats.overdue', '지연')}</StatLabel></Stat>
            </StatRow>
          </Card>

          {/* 업무 타임라인 요약 — 최하단 (공용 GanttTrack 사용, 스크롤·스타일 통일) */}
          <Card style={{ gridColumn: '1 / -1', order: 99 }}>
            <CardTitle>{t('section.taskTimeline', '업무 타임라인')} <small>{sortedTasks.length}</small></CardTitle>
            <DashTimeline
              tasks={sortedTasks}
              todayStr={todayStr}
              onOpen={(taskId) => {
                const sp = new URLSearchParams(searchParams);
                sp.set('tab', 'tasks');
                sp.set('task', String(taskId));
                setSearchParams(sp, { replace: true });
                setTabState('tasks');
              }}
              onMore={() => setTab('tasks')}
            />
          </Card>

          {/* 주요 이슈 (순서 5) */}
          <Card style={{ order: 5 }}>
            <CardTitle>{t('section.issues', '주요 이슈')} <small>{issues.length}</small></CardTitle>
            {issues.length === 0 ? <Dim>{t('issues.empty', '이슈가 없습니다')}</Dim> : (
              <IssueList>
                {issues.slice(0, 5).map(i => (
                  <IssueRow key={i.id}>
                    <IssueBody>{i.body}</IssueBody>
                    <IssueMeta>{i.author?.name || t('info.noValue', '—')} · {i.created_at?.slice(5, 10).replace('-', '/')}</IssueMeta>
                  </IssueRow>
                ))}
              </IssueList>
            )}
            <AddIssueRow>
              <IssueInput placeholder={t('issues.addPlaceholder', '이슈 추가...') as string} value={newIssue} onChange={e => setNewIssue(e.target.value)}
                onKeyDown={async e => {
                  if (e.key !== 'Enter' || (e.nativeEvent as unknown as { isComposing?: boolean }).isComposing || !newIssue.trim()) return;
                  if (submittingRef.current) return;
                  e.preventDefault();
                  submittingRef.current = true;
                  try {
                    const r = await apiFetch(`/api/projects/${projectId}/issues`, {
                      method: 'POST', headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ body: newIssue.trim() })
                    });
                    const j = await r.json();
                    if (j.success) { setIssues(prev => [j.data, ...prev]); setNewIssue(''); }
                  } finally { submittingRef.current = false; }
                }} />
            </AddIssueRow>
          </Card>

          {/* 프로젝트 메모 (순서 6) */}
          <Card style={{ order: 6 }}>
            <CardTitle>{t('section.notes', '프로젝트 메모')} <small>{notes.length}</small></CardTitle>
            {notes.length === 0 ? <Dim>{t('notes.empty', '메모가 없습니다')}</Dim> : (
              <IssueList>
                {notes.slice(0, 5).map(n => (
                  <IssueRow key={n.id}>
                    <IssueBody>
                      {n.visibility === 'personal' && <VisTag>{t('notes.visPersonal', '개인')}</VisTag>}
                      {n.visibility === 'internal' && <VisTag $internal>{t('notes.visInternal', '내부')}</VisTag>}
                      {n.body}
                    </IssueBody>
                    <IssueMeta>{n.author?.name || t('info.noValue', '—')} · {n.created_at?.slice(5, 10).replace('-', '/')}</IssueMeta>
                  </IssueRow>
                ))}
              </IssueList>
            )}
            <AddIssueRow>
              <div style={{ flex: '0 0 90px' }}>
                <PlanQSelect size="sm" isSearchable={false}
                  value={{ value: newNoteVis, label: newNoteVis === 'internal' ? t('notes.visInternal', '내부') : t('notes.visPersonal', '개인') }}
                  onChange={v => setNewNoteVis(((v as { value?: 'personal' | 'internal' } | null)?.value) || 'internal')}
                  options={[{ value: 'internal', label: t('notes.visInternal', '내부') }, { value: 'personal', label: t('notes.visPersonal', '개인') }]} />
              </div>
              <IssueInput placeholder={t('notes.addPlaceholder', '메모 추가...') as string} value={newNote} onChange={e => setNewNote(e.target.value)}
                onKeyDown={async e => {
                  if (e.key !== 'Enter' || (e.nativeEvent as unknown as { isComposing?: boolean }).isComposing || !newNote.trim()) return;
                  if (submittingRef.current) return;
                  e.preventDefault();
                  submittingRef.current = true;
                  try {
                    const r = await apiFetch(`/api/projects/${projectId}/notes`, {
                      method: 'POST', headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ body: newNote.trim(), visibility: newNoteVis })
                    });
                    const j = await r.json();
                    if (j.success) { setNotes(prev => [j.data, ...prev]); setNewNote(''); }
                  } finally { submittingRef.current = false; }
                }} />
            </AddIssueRow>
          </Card>

          {/* 고객 정보 요약 (순서 2) */}
          <Card style={{ order: 2 }}>
            <CardTitle>{t('section.clients', '고객 정보')} <small>{(project.projectClients || []).length}</small></CardTitle>
            {(project.projectClients || []).length === 0 ? <Dim>{t('clients.emptySummary', '연결된 고객이 없습니다')}</Dim> : (
              <IssueList>
                {(project.projectClients || []).slice(0, 5).map(c => (
                  <IssueRow key={c.id} onClick={() => setTab('clients')} style={{ cursor: 'pointer' }}>
                    <IssueBody><strong>{c.contact_name}</strong></IssueBody>
                    <IssueMeta>{c.contact_email || t('clients.noEmail', '이메일 없음')}</IssueMeta>
                  </IssueRow>
                ))}
              </IssueList>
            )}
          </Card>

          {/* 연결된 채팅방 (순서 3) */}
          <Card style={{ order: 3 }}>
            <CardTitle>{t('section.chats', '연결된 채팅방')} <small>{convs.length}</small></CardTitle>
            {convs.length === 0 ? (
              <Dim>{t('section.noChats', '채팅방이 없습니다')}</Dim>
            ) : (
              <ConvList>
                {convs.map(c => (
                  <ConvRow key={c.id} onClick={() => navigate(`/talk?project=${projectId}&conv=${c.id}`)}>
                    <ConvChannel $type={c.channel_type}>{c.channel_type === 'customer' ? t('convs.channelCustomer', '고객') : c.channel_type === 'internal' ? t('convs.channelInternal', '내부') : t('convs.channelGroup', '그룹')}</ConvChannel>
                    <ConvTitle>{c.title || `#${c.id}`}</ConvTitle>
                    {(c.unread_count || 0) > 0 && <UnreadBadge>{c.unread_count}</UnreadBadge>}
                  </ConvRow>
                ))}
              </ConvList>
            )}
          </Card>
        </DashboardBody>
      )}

      {tab === 'tasks' && (
        <TasksTab
          projectId={projectId}
          businessId={project.business_id}
          tasks={sortedTasks as unknown as import('./TasksTab').TaskRow[]}
          onRefresh={load}
        />
      )}

      {tab === 'info' && (
        <InfoBody>
          <Card>
            <CardTitle>{t('section.editInfo', '기본 정보')}</CardTitle>
            <EditGrid>
              <EditField>
                <EditLabel>{t('edit.projectName', '프로젝트명')}</EditLabel>
                <EditInput defaultValue={project.name}
                  onBlur={async e => {
                    const v = e.target.value.trim();
                    if (v && v !== project.name) {
                      await apiFetch(`/api/projects/${projectId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: v }) });
                      setProject(prev => prev ? { ...prev, name: v } : prev);
                    }
                  }} />
              </EditField>
              <EditField>
                <EditLabel>{t('edit.client', '고객사')}</EditLabel>
                <EditInput defaultValue={project.client_company || ''}
                  onBlur={async e => {
                    const v = e.target.value.trim();
                    await apiFetch(`/api/projects/${projectId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_company: v || null }) });
                    setProject(prev => prev ? { ...prev, client_company: v || null } : prev);
                  }} />
              </EditField>
              <EditField>
                <EditLabel>{t('edit.type', '타입')}</EditLabel>
                <div style={{ display: 'flex', gap: 6 }}>
                  <TypeBtn2 $active={project.project_type === 'fixed'} onClick={async () => {
                    await apiFetch(`/api/projects/${projectId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project_type: 'fixed' }) });
                    setProject(prev => prev ? { ...prev, project_type: 'fixed' } : prev);
                  }}>{t('edit.typeFixed', '일시 프로젝트')}</TypeBtn2>
                  <TypeBtn2 $active={project.project_type === 'ongoing'} onClick={async () => {
                    await apiFetch(`/api/projects/${projectId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project_type: 'ongoing' }) });
                    setProject(prev => prev ? { ...prev, project_type: 'ongoing' } : prev);
                  }}>{t('edit.typeOngoing', '지속 구독')}</TypeBtn2>
                </div>
              </EditField>
              <EditField>
                <EditLabel>{t('edit.status', '상태')}</EditLabel>
                <div style={{ display: 'flex', gap: 6 }}>
                  <TypeBtn2 $active={project.status === 'active'} onClick={async () => {
                    if (project.status === 'active') return;
                    await apiFetch(`/api/projects/${projectId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'active' }) });
                    setProject(prev => prev ? { ...prev, status: 'active' } : prev);
                  }}>{t('edit.statusActive', '진행 중')}</TypeBtn2>
                  <TypeBtn2 $active={project.status === 'paused'} onClick={async () => {
                    if (project.status === 'paused') return;
                    await apiFetch(`/api/projects/${projectId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'paused' }) });
                    setProject(prev => prev ? { ...prev, status: 'paused' } : prev);
                  }}>{t('edit.statusPaused', '일시 중지')}</TypeBtn2>
                  <TypeBtn2 $active={project.status === 'closed'} onClick={() => {
                    if (project.status !== 'closed') setCloseModalOpen(true);
                  }}>{t('edit.statusClosed', '완료')}</TypeBtn2>
                </div>
              </EditField>
              <EditField>
                <EditLabel>{t('edit.period', '기간')}</EditLabel>
                <EditDateRangeTrigger ref={periodAnchorRef} type="button"
                  onClick={() => setPeriodPickerOpen(v => !v)}>
                  {(project.start_date || project.end_date) ?
                    (project.project_type === 'fixed'
                      ? `${project.start_date?.slice(0, 10) || t('info.noValue', '—')} ~ ${project.end_date?.slice(0, 10) || t('info.noValue', '—')}`
                      : project.start_date?.slice(0, 10) || t('info.noValue', '—'))
                    : <DatePH>{t('edit.periodPlaceholder', '기간 선택')}</DatePH>}
                </EditDateRangeTrigger>
                {periodPickerOpen && (
                  <CalendarPicker
                    isOpen anchorRef={periodAnchorRef}
                    startDate={project.start_date?.slice(0, 10) || ''}
                    endDate={project.end_date?.slice(0, 10) || project.start_date?.slice(0, 10) || ''}
                    singleMode={project.project_type === 'ongoing'}
                    onRangeSelect={async (s, e) => {
                      const patch: Record<string, string | null> = { start_date: s || null };
                      if (project.project_type === 'fixed') patch.end_date = e || null;
                      await apiFetch(`/api/projects/${projectId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
                      setProject(prev => prev ? { ...prev, start_date: s || null, end_date: project.project_type === 'fixed' ? (e || null) : prev.end_date } : prev);
                    }}
                    onClose={() => setPeriodPickerOpen(false)}
                  />
                )}
              </EditField>
              <EditField style={{ gridColumn: '1 / -1' }}>
                <EditLabel>{t('edit.color', '색상')}</EditLabel>
                <ColorRow>
                  {PROJECT_COLORS.map(c => (
                    <ColorSwatch key={c} type="button" $active={(project.color || '').toLowerCase() === c.toLowerCase()}
                      style={{ background: c }}
                      title={c}
                      onClick={async () => {
                        await apiFetch(`/api/projects/${projectId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ color: c }) });
                        setProject(prev => prev ? { ...prev, color: c } : prev);
                      }} />
                  ))}
                </ColorRow>
                <HexRow>
                  <HexPreview style={{ background: project.color || '#E2E8F0' }} />
                  <HexNativePicker
                    type="color"
                    value={/^#[0-9a-fA-F]{6}$/.test(project.color || '') ? (project.color as string) : '#14B8A6'}
                    onChange={async e => {
                      const v = e.target.value;
                      setProject(prev => prev ? { ...prev, color: v } : prev);
                      await apiFetch(`/api/projects/${projectId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ color: v }) });
                    }}
                    title={t('edit.colorPicker', '색상 선택기') as string}
                    aria-label={t('edit.colorPicker', '색상 선택기') as string}
                  />
                  <HexInput
                    type="text"
                    maxLength={7}
                    placeholder="#RRGGBB"
                    defaultValue={project.color || ''}
                    onBlur={async e => {
                      let v = e.target.value.trim();
                      if (v && !v.startsWith('#')) v = '#' + v;
                      if (v && !/^#[0-9a-fA-F]{6}$/.test(v)) {
                        e.target.value = project.color || '';
                        return;
                      }
                      const next = v || null;
                      await apiFetch(`/api/projects/${projectId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ color: next }) });
                      setProject(prev => prev ? { ...prev, color: next } : prev);
                    }}
                  />
                </HexRow>
              </EditField>
              <EditField style={{ gridColumn: '1 / -1' }}>
                <EditLabel>{t('edit.description', '설명')}</EditLabel>
                <EditTextarea defaultValue={project.description || ''} rows={3}
                  onBlur={async e => {
                    const v = e.target.value.trim();
                    await apiFetch(`/api/projects/${projectId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ description: v || null }) });
                    setProject(prev => prev ? { ...prev, description: v || null } : prev);
                  }} />
              </EditField>
            </EditGrid>
          </Card>

          <Card>
            <CardTitle>{t('section.members', '프로젝트 멤버')} <small>{(project.projectMembers || []).length}</small></CardTitle>
            {(project.projectMembers || []).length === 0 ? <Dim>{t('members.empty', '멤버가 없습니다')}</Dim> : (
              <MemberList>
                {(project.projectMembers || []).map(m => {
                  const isOwner = m.user_id === project.owner_user_id;
                  const isPm = isOwner || !!m.is_pm;
                  return (
                    <MemberRow key={m.user_id}>
                      <MemberName>
                        {m.User?.name || `user ${m.user_id}`}
                        {isOwner && <OwnerTag>{t('members.owner', '오너')}</OwnerTag>}
                        {isPm && !isOwner && <PmTag>PM</PmTag>}
                      </MemberName>
                      <MemberRoleInput defaultValue={m.role || t('edit.roleDefault', '팀원')} placeholder={t('edit.rolePlaceholder', '역할') as string}
                        disabled={isOwner}
                        onBlur={e => { const v = e.target.value.trim(); if (v && v !== m.role) updateMemberRole(m.user_id, v); }}
                        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
                      {/* PM 체크박스 — 오너는 강제 체크 + disabled */}
                      <PmToggle
                        type="button"
                        $active={isPm}
                        disabled={isOwner}
                        onClick={() => togglePm(m.user_id)}
                        title={isOwner
                          ? (t('members.pmOwner', '프로젝트 생성자는 자동 PM') as string)
                          : (isPm
                              ? (t('members.pmOn', 'PM 해제') as string)
                              : (t('members.pmOff', 'PM 지정') as string))}
                        aria-pressed={isPm}
                      >
                        PM
                      </PmToggle>
                      {!isOwner && (
                        <MemberRemoveBtn type="button" onClick={() => removeMember(m.user_id)} title={t('members.remove', '제거') as string}>×</MemberRemoveBtn>
                      )}
                    </MemberRow>
                  );
                })}
              </MemberList>
            )}
            {(() => {
              const joined = new Set((project.projectMembers || []).map(m => m.user_id));
              const candidates = bizMembers.filter(b => !joined.has(b.user_id));
              if (candidates.length === 0) return <Dim style={{ marginTop: 6 }}>{t('members.noCandidates', '추가 가능한 워크스페이스 멤버가 없습니다')}</Dim>;
              return addMemberOpen ? (
                <AddMemberBox>
                  <MemberCandidateList>
                    {candidates.map(b => (
                      <MemberCandidateItem key={b.user_id} type="button" onClick={() => addMember(b.user_id)}>
                        {b.user?.name || `user ${b.user_id}`}
                        {b.user?.email && <MemberEmail>{b.user.email}</MemberEmail>}
                      </MemberCandidateItem>
                    ))}
                  </MemberCandidateList>
                  <AddMemberCancelBtn type="button" onClick={() => setAddMemberOpen(false)}>{t('members.cancel', '취소')}</AddMemberCancelBtn>
                </AddMemberBox>
              ) : (
                <AddMemberLink type="button" onClick={() => setAddMemberOpen(true)}>+ {t('members.add', '멤버 추가')}</AddMemberLink>
              );
            })()}
          </Card>

          <Card>
            <CardTitle>{t('section.chats', '연결된 채팅방')} <small>{convs.length}</small></CardTitle>
            {convs.length === 0 ? <Dim>{t('convs.empty', '없음')}</Dim> : (
              <ConvList>
                {convs.map(c => (
                  <ConvRow key={c.id} onClick={() => navigate(`/talk?project=${projectId}&conv=${c.id}`)}>
                    <ConvChannel $type={c.channel_type}>{c.channel_type === 'customer' ? t('convs.channelCustomer', '고객') : c.channel_type === 'internal' ? t('convs.channelInternal', '내부') : t('convs.channelGroup', '그룹')}</ConvChannel>
                    <ConvTitle>{c.title || `#${c.id}`}</ConvTitle>
                  </ConvRow>
                ))}
              </ConvList>
            )}
          </Card>

          <Card>
            <CardTitle>{t('section.issues', '주요 이슈')} <small>{issues.length}</small></CardTitle>
            {issues.length === 0 ? <Dim>{t('issues.empty', '이슈가 없습니다')}</Dim> : (
              <IssueList>
                {issues.map(i => (
                  <IssueRow key={i.id}>
                    <IssueBody>{i.body}</IssueBody>
                    <IssueMeta>{i.author?.name || t('info.noValue', '—')} · {i.created_at?.slice(5, 10).replace('-', '/')}</IssueMeta>
                  </IssueRow>
                ))}
              </IssueList>
            )}
            <AddIssueRow>
              <IssueInput placeholder={t('issues.addPlaceholder', '이슈 추가...') as string} value={newIssue} onChange={e => setNewIssue(e.target.value)}
                onKeyDown={async e => {
                  if (e.key !== 'Enter' || (e.nativeEvent as unknown as { isComposing?: boolean }).isComposing || !newIssue.trim()) return;
                  if (submittingRef.current) return;
                  e.preventDefault(); submittingRef.current = true;
                  try {
                    const r = await apiFetch(`/api/projects/${projectId}/issues`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: newIssue.trim() }) });
                    const j = await r.json();
                    if (j.success) { setIssues(prev => [j.data, ...prev]); setNewIssue(''); }
                  } finally { submittingRef.current = false; }
                }} />
            </AddIssueRow>
          </Card>

          <Card>
            <CardTitle>{t('section.notes', '프로젝트 메모')} <small>{notes.length}</small></CardTitle>
            {notes.length === 0 ? <Dim>{t('notes.empty', '메모가 없습니다')}</Dim> : (
              <IssueList>
                {notes.map(n => (
                  <IssueRow key={n.id}>
                    <IssueBody>
                      {n.visibility === 'personal' && <VisTag>{t('notes.visPersonal', '개인')}</VisTag>}
                      {n.visibility === 'internal' && <VisTag $internal>{t('notes.visInternal', '내부')}</VisTag>}
                      {n.body}
                    </IssueBody>
                    <IssueMeta>{n.author?.name || t('info.noValue', '—')} · {n.created_at?.slice(5, 10).replace('-', '/')}</IssueMeta>
                  </IssueRow>
                ))}
              </IssueList>
            )}
            <AddIssueRow>
              <div style={{ flex: '0 0 90px' }}>
                <PlanQSelect size="sm" isSearchable={false}
                  value={{ value: newNoteVis, label: newNoteVis === 'internal' ? t('notes.visInternal', '내부') : t('notes.visPersonal', '개인') }}
                  onChange={v => setNewNoteVis(((v as { value?: 'personal' | 'internal' } | null)?.value) || 'internal')}
                  options={[{ value: 'internal', label: t('notes.visInternal', '내부') }, { value: 'personal', label: t('notes.visPersonal', '개인') }]} />
              </div>
              <IssueInput placeholder={t('notes.addPlaceholder', '메모 추가...') as string} value={newNote} onChange={e => setNewNote(e.target.value)}
                onKeyDown={async e => {
                  if (e.key !== 'Enter' || (e.nativeEvent as unknown as { isComposing?: boolean }).isComposing || !newNote.trim()) return;
                  if (submittingRef.current) return;
                  e.preventDefault(); submittingRef.current = true;
                  try {
                    const r = await apiFetch(`/api/projects/${projectId}/notes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: newNote.trim(), visibility: newNoteVis }) });
                    const j = await r.json();
                    if (j.success) { setNotes(prev => [j.data, ...prev]); setNewNote(''); }
                  } finally { submittingRef.current = false; }
                }} />
            </AddIssueRow>
          </Card>
        </InfoBody>
      )}
      {tab === 'files' && <DocsTab projectId={projectId} businessId={project.business_id} />}
      {tab === 'docs' && (
        <div style={{ height: 'calc(100vh - 240px)', minHeight: '500px' }}>
          <PostsPage scope={{ type: 'project', businessId: project.business_id, projectId }} />
        </div>
      )}
      {tab === 'clients' && (
        <ClientsBody>
          <Card>
            <CardTitle>{t('section.projClients', '참여 고객')} <small>{(project.projectClients || []).length}</small></CardTitle>
            {(project.projectClients || []).length === 0 ? <Dim>{t('clients.empty', '고객이 없습니다')}</Dim> : (
              <ClientList>
                {(project.projectClients || []).map(c => {
                  const joined = !!c.contact_user_id;
                  return (
                    <ClientRow key={c.id}>
                      <strong>{c.contact_name}</strong>
                      <span>{c.contact_email || t('info.noValue', '—')}</span>
                      <ClientStatusPill $joined={joined} title={joined ? t('clients.joinedTitle', '워크스페이스 사용자로 참여 중') as string : t('clients.pendingTitle', '초대 발송 — 수락 대기 중') as string}>
                        {joined ? t('clients.joined', '참여 중') : t('clients.pending', '초대 대기')}
                      </ClientStatusPill>
                      <ClientDelBtn type="button" onClick={async () => {
                        const r = await apiFetch(`/api/projects/${projectId}/clients/${c.id}`, { method: 'DELETE' });
                        if ((await r.json()).success) {
                          setProject(prev => prev ? { ...prev, projectClients: (prev.projectClients || []).filter(x => x.id !== c.id) } : prev);
                        }
                      }}>×</ClientDelBtn>
                    </ClientRow>
                  );
                })}
              </ClientList>
            )}
            {/* 기존 워크스페이스 고객 연결 */}
            {(() => {
              const joined = new Set((project.projectClients || []).map((c) => (c.contact_email || c.contact_name)));
              const candidates = bizClients.filter((b) => {
                const key = b.user?.email || b.display_name || b.user?.name;
                return key && !joined.has(key);
              });
              if (candidates.length === 0) return null;
              return (
                <LinkClientBar>
                  <LinkClientLabel>{t('clients.linkExisting', '기존 고객 연결')}</LinkClientLabel>
                  <div style={{ flex: 1, minWidth: 0 }}>
                  <PlanQSelect
                    size="sm" isClearable
                    placeholder={t('clients.selectPlaceholder', '워크스페이스 고객 선택') as string}
                    value={null}
                    onChange={async (opt) => {
                      const v = (opt as { value?: string } | null)?.value;
                      if (!v) return;
                      const c = bizClients.find((x) => String(x.id) === v);
                      if (!c) return;
                      const name = c.display_name || c.user?.name || '';
                      const email = c.user?.email || null;
                      const r = await apiFetch(`/api/projects/${projectId}/clients`, {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name, email }),
                      });
                      const j = await r.json();
                      if (j.success) {
                        setProject((prev) => prev ? { ...prev, projectClients: [...(prev.projectClients || []), j.data] } : prev);
                      }
                    }}
                    options={candidates.map((c) => ({
                      value: String(c.id),
                      label: `${c.display_name || c.user?.name}${c.company_name ? ' · ' + c.company_name : ''}${c.user?.email ? ' (' + c.user.email + ')' : ''}`,
                    }))}
                  />
                  </div>
                </LinkClientBar>
              );
            })()}

            {/* 새 고객 초대 — 이메일로 초대 토큰 발급, 워크스페이스 고객은 나중에 수락 시 생성 */}
            <AddClientForm onSubmit={async (e) => {
              e.preventDefault();
              const name = newClientName.trim();
              if (!name) return;
              const r = await apiFetch(`/api/projects/${projectId}/clients`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, email: newClientEmail.trim() || null }),
              });
              const j = await r.json();
              if (j.success) {
                setProject(prev => prev ? { ...prev, projectClients: [...(prev.projectClients || []), j.data] } : prev);
                setNewClientName(''); setNewClientEmail('');
              }
            }}>
              <ClientInput placeholder={t('clients.newNamePlaceholder', '새 고객 이름') as string} value={newClientName} onChange={e => setNewClientName(e.target.value)} />
              <ClientInput placeholder={t('clients.newEmailPlaceholder', '이메일 (선택, 초대 발송)') as string} type="email" value={newClientEmail} onChange={e => setNewClientEmail(e.target.value)} />
              <AddClientBtn type="submit" disabled={!newClientName.trim()}>{t('clients.newInviteBtn', '+ 새로 초대')}</AddClientBtn>
            </AddClientForm>
          </Card>
        </ClientsBody>
      )}
      {tab === 'process' && <ProcessPartsTab projectId={projectId} />}

      {closeModalOpen && (
        <CloseBackdrop onMouseDown={(e) => { if (e.target === e.currentTarget) setCloseModalOpen(false); }}>
          <CloseDialog>
            <CloseHeader>{t('close.title', '프로젝트 완료 처리')}</CloseHeader>
            <CloseBody>
              <p>{t('close.intro1', '이 프로젝트를 완료 상태로 전환합니다.')}</p>
              <ul>
                <li>{t('close.intro2', '연결된 대화는 자동으로 보관됩니다 (내용은 유지).')}</li>
                <li>{t('close.intro3', '업무·메모·이슈 데이터는 모두 보존됩니다.')}</li>
              </ul>
              {(project.projectClients || []).length > 0 && (
                <>
                  <ClientsChoiceTitle>{t('close.exportTitle', '고객 내보내기 (선택)')}</ClientsChoiceTitle>
                  <ClientsChoiceHint>{t('close.exportHint', '체크된 고객은 이 프로젝트에서 제외됩니다. 다른 프로젝트에 없으면 워크스페이스에서도 사라집니다. 고객 아이디 자체 삭제는 고객 관리 페이지에서 할 수 있습니다.')}</ClientsChoiceHint>
                  <ClientChoiceList>
                    {(project.projectClients || []).map((c) => (
                      <ClientChoiceRow key={c.id}>
                        <input type="checkbox"
                          checked={clientsToRemove.has(c.id)}
                          onChange={(e) => {
                            const next = new Set(clientsToRemove);
                            if (e.target.checked) next.add(c.id); else next.delete(c.id);
                            setClientsToRemove(next);
                          }} />
                        <strong>{c.contact_name}</strong>
                        <ClientChoiceEmail>{c.contact_email || t('info.noValue', '—')}</ClientChoiceEmail>
                      </ClientChoiceRow>
                    ))}
                  </ClientChoiceList>
                </>
              )}
            </CloseBody>
            <CloseFooter>
              <CFCancelBtn type="button" onClick={() => setCloseModalOpen(false)} disabled={closing}>{t('close.cancel', '취소')}</CFCancelBtn>
              <CFConfirmBtn type="button" onClick={performCloseProject} disabled={closing}>
                {closing ? t('close.processing', '처리 중…') : t('close.confirm', '완료로 전환')}
              </CFConfirmBtn>
            </CloseFooter>
          </CloseDialog>
        </CloseBackdrop>
      )}
    </PageShell>
  );
};

export default QProjectDetailPage;

// ───────── Dashboard Timeline (공용 GanttTrack) ─────────
const DashTimeline: React.FC<{
  tasks: TaskRow[];
  todayStr: string;
  onOpen: (id: number) => void;
  onMore: () => void;
}> = ({ tasks, todayStr, onOpen, onMore }) => {
  const { t } = useTranslation('qproject');
  const gantt = useGanttScrollSync();
  const withDates = tasks.filter(task => task.start_date || task.due_date);
  if (withDates.length === 0) return <Dim>{t('timeline.empty', '기간이 설정된 업무가 없습니다')}</Dim>;
  const dates = withDates.flatMap(task => [task.start_date, task.due_date].filter(Boolean) as string[]).map(d => d.slice(0, 10));
  const from = dates.reduce((a, b) => (a < b ? a : b));
  const to = dates.reduce((a, b) => (a > b ? a : b));
  const range: GanttRange = { from, to };
  const visible = withDates.slice(0, 10);
  const rest = withDates.length - visible.length;
  return (
    <DashTLWrap>
      <DashTLHead>
        <DashTLLabelCol />
        <GanttHeader registry={gantt} range={range} tickMode="auto" />
      </DashTLHead>
      {visible.map(task => {
        const dStatus = displayStatus(task as unknown as { status: string; due_date?: string | null; request_ack_at?: string | null; source?: string }, todayStr);
        const sc = STATUS_COLOR[dStatus as StatusCode] || STATUS_COLOR.not_started;
        return (
          <DashTLRow key={task.id}>
            <DashTLLabelCol onClick={() => onOpen(task.id)}>{task.title}</DashTLLabelCol>
            <GanttRowTrack registry={gantt} range={range} todayStr={todayStr} showGrid height={22}>
              <GanttBar range={range} start={task.start_date} end={task.due_date}
                bg={sc.bg} fg={sc.fg} label={task.assignee?.name || ''}
                onClick={(e) => { e.stopPropagation(); onOpen(task.id); }}
                title={`${task.start_date?.slice(0, 10) || ''} ~ ${task.due_date?.slice(0, 10) || ''}`} />
            </GanttRowTrack>
          </DashTLRow>
        );
      })}
      {rest > 0 && <DashTLMore onClick={onMore}>{t('timeline.more', '+ 더 보기 ({{n}})', { n: rest })}</DashTLMore>}
    </DashTLWrap>
  );
};

// ───────── styled ─────────
const BackBtn = styled.button`padding:6px 12px;background:#FFF;color:#334155;border:1px solid #CBD5E1;border-radius:8px;font-size:12px;cursor:pointer;&:hover{background:#F8FAFC;border-color:#94A3B8;}`;
const TabBar = styled.div`display:flex;gap:4px;border-bottom:1px solid #E2E8F0;background:#FFF;padding:0 20px;margin:-20px -20px 20px;`;
const Tab = styled.button<{$active:boolean}>`
  padding:12px 14px;background:transparent;border:none;color:${p=>p.$active?'#0F766E':'#64748B'};
  font-size:13px;font-weight:600;cursor:pointer;border-bottom:2px solid ${p=>p.$active?'#14B8A6':'transparent'};
  display:inline-flex;align-items:center;gap:6px;
  &:hover{color:#0F766E;}
`;
const TabEditIcon = styled.span`font-size:11px;opacity:0.6;cursor:pointer;&:hover{opacity:1;color:#14B8A6;}`;
const TabLabelInput = styled.input`padding:10px 14px;font-size:13px;font-weight:600;color:#0F766E;background:#F0FDFA;border:1px solid #14B8A6;border-bottom:2px solid #14B8A6;border-radius:6px;font-family:inherit;min-width:100px;&:focus{outline:none;}`;
const DashboardBody = styled.div`display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px;`;
const InfoBody = styled.div`display:grid;grid-template-columns:repeat(2, minmax(0, 1fr));gap:16px;@media (max-width:900px){grid-template-columns:1fr;}`;
const EditGrid = styled.div`display:grid;grid-template-columns:1fr 1fr;gap:12px;`;
const EditField = styled.div`display:flex;flex-direction:column;gap:4px;`;
const EditLabel = styled.span`font-size:11px;color:#64748B;font-weight:700;`;
const EditInput = styled.input`height:34px;padding:0 10px;border:1px solid #E2E8F0;border-radius:6px;font-size:13px;font-family:inherit;&:focus{outline:none;border-color:#14B8A6;}`;
const EditTextarea = styled.textarea`padding:8px 10px;border:1px solid #E2E8F0;border-radius:6px;font-size:13px;font-family:inherit;resize:vertical;&:focus{outline:none;border-color:#14B8A6;}`;
const TypeBtn2 = styled.button<{$active?:boolean}>`flex:1;padding:8px 12px;border:1px solid ${p=>p.$active?'#14B8A6':'#E2E8F0'};background:${p=>p.$active?'#F0FDFA':'#FFF'};color:${p=>p.$active?'#0F766E':'#334155'};border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;&:hover{border-color:#14B8A6;}`;
const EditDateRangeTrigger = styled.button`width:100%;height:34px;padding:0 10px;border:1px solid #E2E8F0;border-radius:6px;font-size:13px;color:#0F172A;background:#FFF;font-family:inherit;text-align:left;cursor:pointer;&:hover{border-color:#14B8A6;}`;
const DatePH = styled.span`color:#94A3B8;`;
const ColorRow = styled.div`display:flex;flex-wrap:nowrap;gap:8px;align-items:center;justify-content:space-between;padding:2px 0;width:100%;`;
const ColorSwatch = styled.button<{$active?:boolean}>`width:28px;height:28px;border-radius:50%;border:2px solid ${p=>p.$active?'#0F172A':'#E2E8F0'};cursor:pointer;padding:0;transition:transform 0.15s;&:hover{transform:scale(1.1);}`;
const HexRow = styled.div`display:flex;align-items:center;gap:8px;margin-top:8px;`;
const HexPreview = styled.div`width:28px;height:28px;border-radius:8px;border:1px solid #E2E8F0;flex-shrink:0;`;
const HexNativePicker = styled.input`
  width:36px;height:28px;padding:0;border:1px solid #CBD5E1;border-radius:6px;background:transparent;cursor:pointer;
  &::-webkit-color-swatch-wrapper{padding:2px;}
  &::-webkit-color-swatch{border:none;border-radius:4px;}
`;
const HexInput = styled.input`
  width:110px;height:28px;padding:0 10px;border:1px solid #CBD5E1;border-radius:6px;
  font-size:12px;font-family:'SFMono-Regular',Menlo,Consolas,monospace;color:#0F172A;letter-spacing:0.5px;
  &:focus{outline:none;border-color:#14B8A6;box-shadow:0 0 0 2px rgba(20,184,166,0.15);}
`;
const ClientsBody = styled.div``;
const Card = styled.div`background:#FFF;border:1px solid #E2E8F0;border-radius:10px;padding:16px;`;
const CardTitle = styled.h3`margin:0 0 12px;font-size:14px;font-weight:700;color:#0F172A;display:flex;align-items:center;gap:8px;small{font-size:11px;font-weight:600;color:#64748B;}`;
const InfoGrid = styled.div`display:grid;grid-template-columns:repeat(2,1fr);gap:10px;`;
const InfoCell = styled.div`display:flex;flex-direction:column;gap:4px;`;
const InfoLabel = styled.span`font-size:10px;font-weight:700;color:#94A3B8;text-transform:uppercase;letter-spacing:0.3px;`;
const InfoValue = styled.span`font-size:13px;color:#0F172A;`;
const TypeBadge = styled.span`display:inline-flex;align-items:center;padding:2px 8px;background:#F0FDFA;color:#0F766E;border-radius:999px;font-size:11px;font-weight:600;width:fit-content;`;
const Description = styled.p`margin:10px 0 0;font-size:12px;color:#475569;line-height:1.5;`;

const ProgressRow = styled.div`display:flex;align-items:center;gap:10px;margin-bottom:14px;`;
const ProgressTrack = styled.div`flex:1;height:8px;background:#F1F5F9;border-radius:4px;overflow:hidden;`;
const ProgressFill = styled.div<{$w:number}>`width:${p=>p.$w}%;height:100%;background:#14B8A6;transition:width 0.3s;`;
const ProgressPct = styled.span`font-size:12px;font-weight:700;color:#475569;min-width:38px;text-align:right;`;
const StatRow = styled.div`display:flex;gap:8px;`;
const Stat = styled.div`flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;padding:8px;background:#F8FAFC;border-radius:6px;`;
const StatNum = styled.div`font-size:18px;font-weight:700;color:#0F172A;`;
const StatLabel = styled.div`font-size:10px;color:#64748B;`;

const ConvList = styled.div`display:flex;flex-direction:column;gap:6px;`;
const ConvRow = styled.div`display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid #E2E8F0;border-radius:6px;cursor:pointer;&:hover{border-color:#14B8A6;background:#F0FDFA;}`;
const ConvChannel = styled.span<{$type:string}>`
  padding:2px 6px;border-radius:4px;font-size:10px;font-weight:700;flex-shrink:0;
  background:${p=>p.$type==='customer'?'#FFF1F2':p.$type==='internal'?'#F0FDFA':'#F1F5F9'};
  color:${p=>p.$type==='customer'?'#9F1239':p.$type==='internal'?'#0F766E':'#475569'};
`;
const ConvTitle = styled.span`flex:1;font-size:13px;color:#0F172A;`;
const UnreadBadge = styled.span`padding:1px 6px;border-radius:999px;background:#F43F5E;color:#FFF;font-size:10px;font-weight:700;`;


const ClientList = styled.div`display:flex;flex-direction:column;gap:6px;margin-bottom:12px;`;
const ClientRow = styled.div`display:flex;align-items:center;gap:10px;padding:8px 12px;border:1px solid #E2E8F0;border-radius:6px;strong{flex:1;font-size:13px;color:#0F172A;}span{font-size:12px;color:#64748B;}`;
const ClientStatusPill = styled.span<{ $joined: boolean }>`
  flex-shrink:0;padding:2px 8px;border-radius:8px;font-size:10px;font-weight:600;white-space:nowrap;
  ${p=>p.$joined?'background:#CCFBF1;color:#0F766E;':'background:#FEF3C7;color:#92400E;'}
`;
const ClientDelBtn = styled.button`width:24px;height:24px;border:none;background:transparent;color:#94A3B8;cursor:pointer;border-radius:4px;font-size:14px;&:hover{background:#FEE2E2;color:#DC2626;}`;
// ── Close Project modal ──
const CloseBackdrop = styled.div`position:fixed;inset:0;background:rgba(15,23,42,0.40);z-index:60;display:flex;align-items:center;justify-content:center;padding:20px;animation:cpfade 0.15s ease-out;@keyframes cpfade{from{opacity:0;}to{opacity:1;}}`;
const CloseDialog = styled.div`width:100%;max-width:520px;background:#FFF;border-radius:14px;box-shadow:0 24px 48px rgba(15,23,42,0.20);display:flex;flex-direction:column;max-height:88vh;overflow:hidden;`;
const CloseHeader = styled.h2`font-size:16px;font-weight:700;color:#0F172A;margin:0;padding:18px 22px;border-bottom:1px solid #E2E8F0;`;
const CloseBody = styled.div`padding:18px 22px;font-size:13px;color:#334155;line-height:1.6;overflow-y:auto;& p{margin:0 0 8px;}& ul{margin:0 0 12px 18px;padding:0;}& li{margin-bottom:2px;}`;
const ClientsChoiceTitle = styled.div`font-size:13px;font-weight:700;color:#0F172A;margin:14px 0 4px;`;
const ClientsChoiceHint = styled.div`font-size:11px;color:#94A3B8;line-height:1.5;margin-bottom:8px;`;
const ClientChoiceList = styled.div`display:flex;flex-direction:column;gap:6px;padding:10px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;max-height:200px;overflow-y:auto;`;
const ClientChoiceRow = styled.label`display:flex;align-items:center;gap:8px;font-size:12px;color:#0F172A;cursor:pointer;& input{accent-color:#14B8A6;}& strong{font-weight:600;}`;
const ClientChoiceEmail = styled.span`color:#64748B;font-size:11px;margin-left:auto;`;
const CloseFooter = styled.div`padding:14px 22px;border-top:1px solid #E2E8F0;display:flex;justify-content:flex-end;gap:8px;background:#FAFBFC;flex-shrink:0;`;
const CFCancelBtn = styled.button`height:40px;padding:0 16px;background:#FFF;color:#475569;border:1px solid #E2E8F0;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;&:hover:not(:disabled){background:#F8FAFC;}&:disabled{opacity:0.5;cursor:not-allowed;}`;
const CFConfirmBtn = styled.button`height:40px;padding:0 20px;background:#14B8A6;color:#FFF;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;&:hover:not(:disabled){background:#0D9488;}&:disabled{background:#CBD5E1;cursor:not-allowed;}`;

const LinkClientBar = styled.div`display:flex;gap:10px;align-items:center;padding:10px 12px;background:#F0FDFA;border:1px solid #CCFBF1;border-radius:8px;margin-bottom:8px;`;
const LinkClientLabel = styled.span`font-size:12px;font-weight:600;color:#0F766E;flex-shrink:0;`;
const AddClientForm = styled.form`display:flex;gap:6px;align-items:center;padding:10px;background:#F8FAFC;border-radius:8px;border:1px dashed #E2E8F0;margin-top:4px;`;
const ClientInput = styled.input`flex:1;padding:6px 10px;border:1px solid #E2E8F0;border-radius:6px;font-size:12px;font-family:inherit;&:focus{outline:none;border-color:#14B8A6;}`;
const AddClientBtn = styled.button`padding:6px 12px;background:#14B8A6;color:#FFF;border:none;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;&:hover:not(:disabled){background:#0D9488;}&:disabled{background:#CBD5E1;cursor:not-allowed;}`;

const Dim = styled.div`padding:16px;text-align:center;font-size:12px;color:#94A3B8;`;

// 프로젝트 멤버 카드
const MemberList = styled.div`display:flex;flex-direction:column;gap:6px;margin-bottom:8px;`;
const MemberRow = styled.div`display:flex;align-items:center;gap:8px;padding:6px 8px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;`;
const MemberName = styled.div`flex:1;min-width:0;font-size:13px;font-weight:600;color:#0F172A;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center;gap:6px;`;
const OwnerTag = styled.span`padding:1px 6px;font-size:10px;font-weight:600;background:#F0FDFA;color:#0F766E;border-radius:6px;`;
const PmTag = styled.span`padding:1px 6px;font-size:10px;font-weight:700;background:#EEF2FF;color:#4338CA;border-radius:6px;letter-spacing:0.2px;`;
const MemberRoleInput = styled.input`flex:0 0 120px;min-width:80px;height:28px;padding:0 8px;font-size:12px;color:#0F172A;border:1px solid transparent;background:transparent;border-radius:6px;font-family:inherit;&:hover:not(:disabled){background:#FFF;border-color:#E2E8F0;}&:focus{outline:none;background:#FFF;border-color:#14B8A6;}&:disabled{color:#94A3B8;cursor:not-allowed;}`;
const PmToggle = styled.button<{ $active: boolean }>`
  flex-shrink:0;width:36px;height:24px;padding:0;font-size:10px;font-weight:700;letter-spacing:0.3px;
  border-radius:6px;cursor:pointer;transition:background 0.12s, color 0.12s, border-color 0.12s;
  ${p => p.$active
    ? 'background:#4338CA;color:#fff;border:1px solid #4338CA;'
    : 'background:#fff;color:#94A3B8;border:1px solid #CBD5E1;'}
  &:hover:not(:disabled){ ${p => p.$active ? 'background:#3730A3;' : 'background:#F8FAFC;color:#4338CA;border-color:#4338CA;'} }
  &:disabled{ background:#EEF2FF;color:#4338CA;border:1px solid #C7D2FE;cursor:not-allowed;opacity:0.85; }
`;
const MemberRemoveBtn = styled.button`width:24px;height:24px;display:flex;align-items:center;justify-content:center;background:transparent;border:none;color:#94A3B8;border-radius:4px;cursor:pointer;font-size:16px;line-height:1;&:hover{background:#FEE2E2;color:#DC2626;}`;
const AddMemberBox = styled.div`display:flex;flex-direction:column;gap:6px;padding:8px;background:#FFF;border:1px solid #E2E8F0;border-radius:8px;margin-top:6px;`;
const MemberCandidateList = styled.div`display:flex;flex-direction:column;gap:2px;max-height:200px;overflow-y:auto;`;
const MemberCandidateItem = styled.button`display:flex;flex-direction:column;gap:2px;padding:6px 10px;text-align:left;background:transparent;border:none;border-radius:4px;font-size:12px;color:#0F172A;cursor:pointer;&:hover{background:#F0FDFA;color:#0F766E;}`;
const MemberEmail = styled.span`font-size:10px;color:#94A3B8;`;
const AddMemberCancelBtn = styled.button`align-self:flex-start;padding:5px 10px;background:transparent;border:1px solid #E2E8F0;border-radius:6px;font-size:12px;color:#64748B;cursor:pointer;&:hover{background:#F8FAFC;color:#0F172A;}`;
const AddMemberLink = styled.button`margin-top:8px;padding:6px 0;background:transparent;border:none;color:#94A3B8;font-size:12px;font-weight:500;cursor:pointer;text-align:left;font-family:inherit;&:hover{color:#0F766E;}`;
const DashTLWrap = styled.div`display:flex;flex-direction:column;gap:4px;`;
const DashTLHead = styled.div`display:flex;align-items:center;gap:8px;border-bottom:1px solid #E2E8F0;padding-bottom:6px;margin-bottom:4px;`;
const DashTLLabelCol = styled.div`width:180px;flex-shrink:0;font-size:12px;font-weight:500;color:#0F172A;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;&:hover{color:#0F766E;}`;
const DashTLRow = styled.div`display:flex;align-items:center;gap:8px;padding:3px 0;`;
const DashTLMore = styled.div`font-size:11px;color:#0F766E;cursor:pointer;padding:6px;text-align:center;&:hover{text-decoration:underline;}`;
const IssueList = styled.div`display:flex;flex-direction:column;gap:6px;margin-bottom:10px;`;
const IssueRow = styled.div`padding:8px 10px;background:#F8FAFC;border-radius:6px;display:flex;flex-direction:column;gap:2px;`;
const IssueBody = styled.div`font-size:12px;color:#0F172A;line-height:1.5;display:flex;align-items:center;gap:6px;strong{font-size:12px;}`;
const IssueMeta = styled.div`font-size:10px;color:#94A3B8;`;
const AddIssueRow = styled.div`display:flex;gap:6px;align-items:center;`;
const IssueInput = styled.input`flex:1;padding:6px 10px;border:1px solid #E2E8F0;border-radius:6px;font-size:12px;font-family:inherit;&:focus{outline:none;border-color:#14B8A6;}`;
const VisTag = styled.span<{$internal?:boolean}>`padding:1px 6px;border-radius:4px;font-size:10px;font-weight:600;flex-shrink:0;background:${p=>p.$internal?'#F0FDFA':'#F1F5F9'};color:${p=>p.$internal?'#0F766E':'#64748B'};`;
const Empty = styled.div`padding:60px;text-align:center;color:#94A3B8;`;
