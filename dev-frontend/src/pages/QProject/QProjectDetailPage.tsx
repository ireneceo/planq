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
import PlanQSelect from '../../components/Common/PlanQSelect';
import CalendarPicker from '../../components/Common/CalendarPicker';
import { PROJECT_COLOR_PALETTE } from '../../utils/projectColors';

const PROJECT_COLORS = PROJECT_COLOR_PALETTE.map(p => p.value);

type TabKey = 'dashboard' | 'tasks' | 'info' | 'process' | 'clients' | 'docs';

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
  projectMembers?: { user_id: number; role: string; User?: { id: number; name: string } }[];
  projectClients?: { id: number; contact_name: string; contact_email: string | null }[];
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

  const validTabs: TabKey[] = ['dashboard', 'tasks', 'info', 'process', 'clients', 'docs'];
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
      if (pr.success) setProject(pr.data);
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

  const sortedTasks = useMemo(() => {
    return [...tasks].sort((a, b) => {
      const as = a.start_date || a.due_date || '9999-12-31';
      const bs = b.start_date || b.due_date || '9999-12-31';
      return as.localeCompare(bs);
    });
  }, [tasks]);

  if (!projectId) return <PageShell title="Error"><Empty>잘못된 주소</Empty></PageShell>;
  if (loading) return <PageShell title={t('loading', '로드 중...')}><Empty>{t('loading', '로드 중...')}</Empty></PageShell>;
  if (!project) return <PageShell title="Not found"><Empty>프로젝트를 찾을 수 없습니다</Empty></PageShell>;

  return (
    <PageShell
      title={project.name}
      actions={
        <BackBtn type="button" onClick={() => navigate('/projects')}>← {t('backToList', '목록')}</BackBtn>
      }
    >
      <TabBar>
        {([['dashboard', '대시보드'], ['tasks', '업무'], ['process', project.process_tab_label || '테이블'], ['clients', '고객'], ['docs', '문서'], ['info', '상세정보']] as [TabKey, string][]).map(([k, lbl]) => {
          if (k === 'process' && editingTabLabel) {
            return (
              <TabLabelInput key={k} autoFocus value={tabLabelDraft}
                onChange={e => setTabLabelDraft(e.target.value)}
                onBlur={async () => {
                  const v = tabLabelDraft.trim() || '테이블';
                  setEditingTabLabel(false);
                  if (v !== (project.process_tab_label || '테이블')) {
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
              onDoubleClick={() => { if (k === 'process') { setTabLabelDraft(project.process_tab_label || '테이블'); setEditingTabLabel(true); } }}
              title={k === 'process' ? t('tab.processEditHint', '더블클릭하여 이름 변경') as string : ''}
            >
              {t(`tab.${k}`, lbl)}
              {k === 'process' && tab === k && (
                <TabEditIcon onClick={e => { e.stopPropagation(); setTabLabelDraft(project.process_tab_label || '테이블'); setEditingTabLabel(true); }} title="이름 변경">✎</TabEditIcon>
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
              <InfoCell><InfoLabel>{t('info.type', '타입')}</InfoLabel><TypeBadge>{project.project_type === 'ongoing' ? '지속 구독' : '일시 프로젝트'}</TypeBadge></InfoCell>
              <InfoCell><InfoLabel>{t('info.client', '고객사')}</InfoLabel><InfoValue>{project.client_company || '—'}</InfoValue></InfoCell>
              <InfoCell><InfoLabel>{t('info.period', '기간')}</InfoLabel><InfoValue>
                {project.start_date ? formatDate(project.start_date) : '—'} {project.project_type === 'fixed' && <>~ {project.end_date ? formatDate(project.end_date) : '—'}</>}
              </InfoValue></InfoCell>
              <InfoCell><InfoLabel>{t('info.members', '멤버')}</InfoLabel><InfoValue>{(project.projectMembers || []).length}명</InfoValue></InfoCell>
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
              <Stat><StatNum>{stats.total}</StatNum><StatLabel>전체</StatLabel></Stat>
              <Stat><StatNum style={{ color: '#14B8A6' }}>{stats.inProgress}</StatNum><StatLabel>진행</StatLabel></Stat>
              <Stat><StatNum style={{ color: '#22C55E' }}>{stats.completed}</StatNum><StatLabel>완료</StatLabel></Stat>
              <Stat><StatNum style={{ color: '#DC2626' }}>{stats.overdue}</StatNum><StatLabel>지연</StatLabel></Stat>
            </StatRow>
          </Card>

          {/* 업무 타임라인 요약 — 최하단 */}
          <Card style={{ gridColumn: '1 / -1', order: 99 }}>
            <CardTitle>{t('section.taskTimeline', '업무 타임라인')} <small>{sortedTasks.length}</small></CardTitle>
            {sortedTasks.filter(t => t.start_date || t.due_date).length === 0 ? (
              <Dim>{t('section.noTasks', '기간이 설정된 업무가 없습니다')}</Dim>
            ) : (
              <MiniTimeline>
                {(() => {
                  const withDates = sortedTasks.filter(t => t.start_date || t.due_date);
                  const dates = withDates.flatMap(t => [t.start_date, t.due_date].filter(Boolean) as string[]).map(d => d.slice(0, 10));
                  const minD = dates.reduce((a, b) => a < b ? a : b);
                  const maxD = dates.reduce((a, b) => a > b ? a : b);
                  const minTime = new Date(minD).getTime();
                  const maxTime = new Date(maxD).getTime();
                  const totalDays = Math.max(1, Math.round((maxTime - minTime) / 86400000) + 1);
                  const TASK_STATUS_COLOR: Record<string, string> = {
                    not_started: '#94A3B8', waiting: '#EAB308', in_progress: '#14B8A6', reviewing: '#3B82F6',
                    revision_requested: '#F59E0B', done_feedback: '#22C55E', completed: '#64748B', canceled: '#94A3B8',
                  };
                  return withDates.slice(0, 10).map(tsk => {
                    const s = tsk.start_date || tsk.due_date!;
                    const e = tsk.due_date || tsk.start_date!;
                    const left = ((new Date(s.slice(0, 10)).getTime() - minTime) / 86400000 / totalDays) * 100;
                    const width = Math.max(3, ((new Date(e.slice(0, 10)).getTime() - new Date(s.slice(0, 10)).getTime()) / 86400000 / totalDays) * 100);
                    return (
                      <MiniRow key={tsk.id} onClick={() => navigate(`/tasks?task=${tsk.id}`)}>
                        <MiniLabel>{tsk.title}</MiniLabel>
                        <MiniTrack>
                          <MiniBar style={{ left: `${left}%`, width: `${width}%`, background: TASK_STATUS_COLOR[tsk.status] || '#14B8A6' }}>
                            {tsk.assignee?.name || ''}
                          </MiniBar>
                        </MiniTrack>
                      </MiniRow>
                    );
                  });
                })()}
                {sortedTasks.filter(t => t.start_date || t.due_date).length > 10 && (
                  <MiniMore onClick={() => setTab('tasks')}>+ 더 보기 ({sortedTasks.filter(t => t.start_date || t.due_date).length - 10})</MiniMore>
                )}
              </MiniTimeline>
            )}
          </Card>

          {/* 주요 이슈 (순서 5) */}
          <Card style={{ order: 5 }}>
            <CardTitle>{t('section.issues', '주요 이슈')} <small>{issues.length}</small></CardTitle>
            {issues.length === 0 ? <Dim>이슈가 없습니다</Dim> : (
              <IssueList>
                {issues.slice(0, 5).map(i => (
                  <IssueRow key={i.id}>
                    <IssueBody>{i.body}</IssueBody>
                    <IssueMeta>{i.author?.name || '—'} · {i.created_at?.slice(5, 10).replace('-', '/')}</IssueMeta>
                  </IssueRow>
                ))}
              </IssueList>
            )}
            <AddIssueRow>
              <IssueInput placeholder="이슈 추가..." value={newIssue} onChange={e => setNewIssue(e.target.value)}
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
            {notes.length === 0 ? <Dim>메모가 없습니다</Dim> : (
              <IssueList>
                {notes.slice(0, 5).map(n => (
                  <IssueRow key={n.id}>
                    <IssueBody>
                      {n.visibility === 'personal' && <VisTag>개인</VisTag>}
                      {n.visibility === 'internal' && <VisTag $internal>내부</VisTag>}
                      {n.body}
                    </IssueBody>
                    <IssueMeta>{n.author?.name || '—'} · {n.created_at?.slice(5, 10).replace('-', '/')}</IssueMeta>
                  </IssueRow>
                ))}
              </IssueList>
            )}
            <AddIssueRow>
              <div style={{ flex: '0 0 90px' }}>
                <PlanQSelect size="sm" isSearchable={false}
                  value={{ value: newNoteVis, label: newNoteVis === 'internal' ? '내부' : '개인' }}
                  onChange={v => setNewNoteVis(((v as { value?: 'personal' | 'internal' } | null)?.value) || 'internal')}
                  options={[{ value: 'internal', label: '내부' }, { value: 'personal', label: '개인' }]} />
              </div>
              <IssueInput placeholder="메모 추가..." value={newNote} onChange={e => setNewNote(e.target.value)}
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
            {(project.projectClients || []).length === 0 ? <Dim>연결된 고객이 없습니다</Dim> : (
              <IssueList>
                {(project.projectClients || []).slice(0, 5).map(c => (
                  <IssueRow key={c.id} onClick={() => setTab('clients')} style={{ cursor: 'pointer' }}>
                    <IssueBody><strong>{c.contact_name}</strong></IssueBody>
                    <IssueMeta>{c.contact_email || '이메일 없음'}</IssueMeta>
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
                    <ConvChannel $type={c.channel_type}>{c.channel_type === 'customer' ? '고객' : c.channel_type === 'internal' ? '내부' : '그룹'}</ConvChannel>
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
            <CardTitle>{t('section.editInfo', '기본 정보 (수정)')}</CardTitle>
            <EditGrid>
              <EditField>
                <EditLabel>프로젝트명</EditLabel>
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
                <EditLabel>고객사</EditLabel>
                <EditInput defaultValue={project.client_company || ''}
                  onBlur={async e => {
                    const v = e.target.value.trim();
                    await apiFetch(`/api/projects/${projectId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_company: v || null }) });
                    setProject(prev => prev ? { ...prev, client_company: v || null } : prev);
                  }} />
              </EditField>
              <EditField>
                <EditLabel>타입</EditLabel>
                <div style={{ display: 'flex', gap: 6 }}>
                  <TypeBtn2 $active={project.project_type === 'fixed'} onClick={async () => {
                    await apiFetch(`/api/projects/${projectId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project_type: 'fixed' }) });
                    setProject(prev => prev ? { ...prev, project_type: 'fixed' } : prev);
                  }}>일시 프로젝트</TypeBtn2>
                  <TypeBtn2 $active={project.project_type === 'ongoing'} onClick={async () => {
                    await apiFetch(`/api/projects/${projectId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project_type: 'ongoing' }) });
                    setProject(prev => prev ? { ...prev, project_type: 'ongoing' } : prev);
                  }}>지속 구독</TypeBtn2>
                </div>
              </EditField>
              <EditField>
                <EditLabel>기간</EditLabel>
                <EditDateRangeTrigger ref={periodAnchorRef} type="button"
                  onClick={() => setPeriodPickerOpen(v => !v)}>
                  {(project.start_date || project.end_date) ?
                    (project.project_type === 'fixed'
                      ? `${project.start_date?.slice(0, 10) || '—'} ~ ${project.end_date?.slice(0, 10) || '—'}`
                      : project.start_date?.slice(0, 10) || '—')
                    : <DatePH>기간 선택</DatePH>}
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
              <EditField>
                <EditLabel>색상</EditLabel>
                <ColorRow>
                  {PROJECT_COLORS.map(c => (
                    <ColorSwatch key={c} type="button" $active={(project.color || '').toLowerCase() === c.toLowerCase()}
                      style={{ background: c }}
                      onClick={async () => {
                        await apiFetch(`/api/projects/${projectId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ color: c }) });
                        setProject(prev => prev ? { ...prev, color: c } : prev);
                      }} />
                  ))}
                </ColorRow>
              </EditField>
              <EditField style={{ gridColumn: '1 / -1' }}>
                <EditLabel>설명</EditLabel>
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
            <CardTitle>{t('section.chats', '연결된 채팅방')} <small>{convs.length}</small></CardTitle>
            {convs.length === 0 ? <Dim>없음</Dim> : (
              <ConvList>
                {convs.map(c => (
                  <ConvRow key={c.id} onClick={() => navigate(`/talk?project=${projectId}&conv=${c.id}`)}>
                    <ConvChannel $type={c.channel_type}>{c.channel_type === 'customer' ? '고객' : c.channel_type === 'internal' ? '내부' : '그룹'}</ConvChannel>
                    <ConvTitle>{c.title || `#${c.id}`}</ConvTitle>
                  </ConvRow>
                ))}
              </ConvList>
            )}
          </Card>

          <Card>
            <CardTitle>{t('section.issues', '주요 이슈')} <small>{issues.length}</small></CardTitle>
            {issues.length === 0 ? <Dim>이슈가 없습니다</Dim> : (
              <IssueList>
                {issues.map(i => (
                  <IssueRow key={i.id}>
                    <IssueBody>{i.body}</IssueBody>
                    <IssueMeta>{i.author?.name || '—'} · {i.created_at?.slice(5, 10).replace('-', '/')}</IssueMeta>
                  </IssueRow>
                ))}
              </IssueList>
            )}
            <AddIssueRow>
              <IssueInput placeholder="이슈 추가..." value={newIssue} onChange={e => setNewIssue(e.target.value)}
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
            {notes.length === 0 ? <Dim>메모가 없습니다</Dim> : (
              <IssueList>
                {notes.map(n => (
                  <IssueRow key={n.id}>
                    <IssueBody>
                      {n.visibility === 'personal' && <VisTag>개인</VisTag>}
                      {n.visibility === 'internal' && <VisTag $internal>내부</VisTag>}
                      {n.body}
                    </IssueBody>
                    <IssueMeta>{n.author?.name || '—'} · {n.created_at?.slice(5, 10).replace('-', '/')}</IssueMeta>
                  </IssueRow>
                ))}
              </IssueList>
            )}
            <AddIssueRow>
              <div style={{ flex: '0 0 90px' }}>
                <PlanQSelect size="sm" isSearchable={false}
                  value={{ value: newNoteVis, label: newNoteVis === 'internal' ? '내부' : '개인' }}
                  onChange={v => setNewNoteVis(((v as { value?: 'personal' | 'internal' } | null)?.value) || 'internal')}
                  options={[{ value: 'internal', label: '내부' }, { value: 'personal', label: '개인' }]} />
              </div>
              <IssueInput placeholder="메모 추가..." value={newNote} onChange={e => setNewNote(e.target.value)}
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
      {tab === 'docs' && <DocsBody><Dim>문서/자료는 추후 연결</Dim></DocsBody>}
      {tab === 'clients' && (
        <ClientsBody>
          <Card>
            <CardTitle>{t('section.projClients', '참여 고객')} <small>{(project.projectClients || []).length}</small></CardTitle>
            {(project.projectClients || []).length === 0 ? <Dim>고객이 없습니다</Dim> : (
              <ClientList>
                {(project.projectClients || []).map(c => (
                  <ClientRow key={c.id}>
                    <strong>{c.contact_name}</strong>
                    <span>{c.contact_email || '—'}</span>
                    <ClientDelBtn type="button" onClick={async () => {
                      const r = await apiFetch(`/api/projects/${projectId}/clients/${c.id}`, { method: 'DELETE' });
                      if ((await r.json()).success) {
                        setProject(prev => prev ? { ...prev, projectClients: (prev.projectClients || []).filter(x => x.id !== c.id) } : prev);
                      }
                    }}>×</ClientDelBtn>
                  </ClientRow>
                ))}
              </ClientList>
            )}
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
              <ClientInput placeholder="고객 이름" value={newClientName} onChange={e => setNewClientName(e.target.value)} />
              <ClientInput placeholder="이메일 (선택)" type="email" value={newClientEmail} onChange={e => setNewClientEmail(e.target.value)} />
              <AddClientBtn type="submit" disabled={!newClientName.trim()}>+ 고객 추가</AddClientBtn>
            </AddClientForm>
          </Card>
        </ClientsBody>
      )}
      {tab === 'process' && <ProcessPartsTab projectId={projectId} />}
    </PageShell>
  );
};

export default QProjectDetailPage;

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
const ColorRow = styled.div`display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:2px 0;`;
const ColorSwatch = styled.button<{$active?:boolean}>`width:28px;height:28px;border-radius:50%;border:2px solid ${p=>p.$active?'#0F172A':'#E2E8F0'};cursor:pointer;padding:0;transition:transform 0.15s;&:hover{transform:scale(1.1);}`;
const DocsBody = styled.div``;
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
const ClientRow = styled.div`display:flex;align-items:center;gap:12px;padding:8px 12px;border:1px solid #E2E8F0;border-radius:6px;strong{flex:1;font-size:13px;color:#0F172A;}span{font-size:12px;color:#64748B;}`;
const ClientDelBtn = styled.button`width:24px;height:24px;border:none;background:transparent;color:#94A3B8;cursor:pointer;border-radius:4px;font-size:14px;&:hover{background:#FEE2E2;color:#DC2626;}`;
const AddClientForm = styled.form`display:flex;gap:6px;align-items:center;padding:10px;background:#F8FAFC;border-radius:8px;border:1px dashed #E2E8F0;`;
const ClientInput = styled.input`flex:1;padding:6px 10px;border:1px solid #E2E8F0;border-radius:6px;font-size:12px;font-family:inherit;&:focus{outline:none;border-color:#14B8A6;}`;
const AddClientBtn = styled.button`padding:6px 12px;background:#14B8A6;color:#FFF;border:none;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;&:hover:not(:disabled){background:#0D9488;}&:disabled{background:#CBD5E1;cursor:not-allowed;}`;

const Dim = styled.div`padding:16px;text-align:center;font-size:12px;color:#94A3B8;`;
const MiniTimeline = styled.div`display:flex;flex-direction:column;gap:4px;`;
const MiniRow = styled.div`display:flex;align-items:center;gap:8px;padding:3px 0;cursor:pointer;&:hover{background:#F8FAFC;}`;
const MiniLabel = styled.span`width:180px;font-size:12px;color:#0F172A;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`;
const MiniTrack = styled.div`flex:1;position:relative;height:18px;background:#F8FAFC;border-radius:3px;`;
const MiniBar = styled.div`position:absolute;top:1px;bottom:1px;border-radius:3px;padding:0 6px;color:#FFF;font-size:10px;font-weight:600;display:flex;align-items:center;white-space:nowrap;overflow:hidden;`;
const MiniMore = styled.div`font-size:11px;color:#0F766E;cursor:pointer;padding:6px;text-align:center;&:hover{text-decoration:underline;}`;
const IssueList = styled.div`display:flex;flex-direction:column;gap:6px;margin-bottom:10px;`;
const IssueRow = styled.div`padding:8px 10px;background:#F8FAFC;border-radius:6px;display:flex;flex-direction:column;gap:2px;`;
const IssueBody = styled.div`font-size:12px;color:#0F172A;line-height:1.5;display:flex;align-items:center;gap:6px;strong{font-size:12px;}`;
const IssueMeta = styled.div`font-size:10px;color:#94A3B8;`;
const AddIssueRow = styled.div`display:flex;gap:6px;align-items:center;`;
const IssueInput = styled.input`flex:1;padding:6px 10px;border:1px solid #E2E8F0;border-radius:6px;font-size:12px;font-family:inherit;&:focus{outline:none;border-color:#14B8A6;}`;
const VisTag = styled.span<{$internal?:boolean}>`padding:1px 6px;border-radius:4px;font-size:10px;font-weight:600;flex-shrink:0;background:${p=>p.$internal?'#F0FDFA':'#F1F5F9'};color:${p=>p.$internal?'#0F766E':'#64748B'};`;
const Empty = styled.div`padding:60px;text-align:center;color:#94A3B8;`;
