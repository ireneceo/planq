// /projects/p/:id — 프로젝트 허브 (대시보드/업무/문서/고객/프로세스 파트 5탭)
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../contexts/AuthContext';
import PageShell from '../../components/Layout/PageShell';
import AutoSaveField from '../../components/Common/AutoSaveField';
import { useTimeFormat } from '../../hooks/useTimeFormat';
import { useVisibilityRefresh } from '../../hooks/useVisibilityRefresh';
import TasksTab from './TasksTab';
import DocsTab from './DocsTab';
// #96 — 프로젝트 '문서' 탭은 Q docs PostsPage 를 project scope 로 재사용 (문서·표·첨부 전 기능 동일).
import PostsPage from '../../components/Docs/PostsPage';
import TransactionsTab from './TransactionsTab';
import ProjectReportTab from './ProjectReportTab';
import ProjectCanvas from './canvas/ProjectCanvas';
import ProjectKnowledgeTab from './ProjectKnowledgeTab';
import PostEditor from '../../components/Docs/PostEditor';
import { fetchPost, type PostDetail } from '../../services/posts';
import PlanQSelect from '../../components/Common/PlanQSelect';
import CalendarPicker from '../../components/Common/CalendarPicker';
import { PROJECT_COLOR_PALETTE } from '../../utils/projectColors';
import ConfirmDialog from '../../components/Common/ConfirmDialog';

const PROJECT_COLORS = PROJECT_COLOR_PALETTE.map(p => p.value);

// process 탭 폐지 — Q docs 의 표(table) kind 로 흡수. 이전 url ?tab=process 는 docs 로 fallback.
// 'doc-:id' 형태는 사용자가 메뉴에 추가한 특정 문서 탭 (문서 탭 PostsPage 의 📌 메뉴 추가 버튼).
// 사이클 N+14 — 'info' 의미 분리:
//   'details' = 프로젝트 메타데이터 편집 (옛 'info' 폼). 라벨 "상세정보".
//   'info'    = Q info (KbDocument scope='project'). 라벨 "정보". 문서 다음 위치.
type TabKey = 'dashboard' | 'tasks' | 'details' | 'info' | 'clients' | 'files' | 'docs' | 'transactions' | 'report' | `doc-${number}`;

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
  projectMembers?: { user_id: number; role: string; is_pm?: boolean; User?: { id: number; name: string; display_name?: string | null }}[];
  projectClients?: { id: number; client_id?: number | null; contact_name: string; contact_email: string | null; contact_user_id?: number | null; invite_token?: string | null; invited_at?: string | null }[];
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
  project_id?: number | null;
}

const QProjectDetailPage: React.FC = () => {
  const { t } = useTranslation('qproject');
  const { formatDateTime } = useTimeFormat();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const projectId = id ? Number(id) : 0;
  const [searchParams, setSearchParams] = useSearchParams();

  const validTabs: TabKey[] = ['dashboard', 'tasks', 'info', 'clients', 'files', 'docs', 'transactions', 'report'];
  const rawTab = searchParams.get('tab');
  // 이전 ?tab=process 진입 호환 — docs 로 fallback
  // doc-:id 도 허용 (사용자가 메뉴에 추가한 특정 문서)
  const isDocTabKey = (s: string): s is `doc-${number}` => /^doc-\d+$/.test(s);
  const initialTab: TabKey = (rawTab === 'process'
    ? 'docs'
    : (rawTab && (validTabs.includes(rawTab as TabKey) || isDocTabKey(rawTab))) ? (rawTab as TabKey)
    : 'dashboard');
  const [tab, setTabState] = useState<TabKey>(initialTab);

  // 메뉴에 추가한 문서 (문서 탭 PostsPage 의 📌 토글) — TabBar 에 추가 탭으로 등장
  const PIN_KEY = `qproject_pinned_docs_${projectId}`;
  const readPinnedIds = (): number[] => {
    try { const raw = localStorage.getItem(PIN_KEY); if (raw) return JSON.parse(raw); } catch { /* ignore */ }
    return [];
  };
  const [pinnedDocIds, setPinnedDocIds] = useState<number[]>(readPinnedIds);
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ projectId?: number }>;
      if (!ce.detail || ce.detail.projectId === projectId) setPinnedDocIds(readPinnedIds());
    };
    window.addEventListener('qproject-pinned-changed', handler);
    return () => window.removeEventListener('qproject-pinned-changed', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // 메뉴 탭 라벨 캐시 — pinned id → post title
  const [pinnedDocLabels, setPinnedDocLabels] = useState<Record<number, string>>({});
  useEffect(() => {
    const missing = pinnedDocIds.filter(id => !pinnedDocLabels[id]);
    if (missing.length === 0) return;
    Promise.all(missing.map(id => apiFetch(`/api/posts/${id}`).then(r => r.json()).then(j => [id, j?.data?.title || `#${id}`] as [number, string]).catch(() => [id, `#${id}`] as [number, string])))
      .then(rows => setPinnedDocLabels(prev => ({ ...prev, ...Object.fromEntries(rows) })));
  }, [pinnedDocIds, pinnedDocLabels]);
  const setTab = (k: TabKey) => {
    setTabState(k);
    const sp = new URLSearchParams(searchParams);
    if (k === 'dashboard') sp.delete('tab'); else sp.set('tab', k);
    setSearchParams(sp, { replace: true });
  };
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
  const [statusHistory, setStatusHistory] = useState<{ id: number; from_status: string | null; to_status: string; note: string | null; created_at: string; changed_by_name: string | null }[]>([]);
  const [convs, setConvs] = useState<Conv[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [bizMembers, setBizMembers] = useState<BizMember[]>([]);
  const [bizClients, setBizClients] = useState<{ id: number; display_name: string | null; company_name: string | null; invite_email?: string | null; user?: { id: number; name: string; email: string } }[]>([]);
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [closeModalOpen, setCloseModalOpen] = useState(false);
  const [clientsToRemove, setClientsToRemove] = useState<Set<number>>(new Set());

  // 상태 변경 이력 (기본 히스토리) — details 탭 진입 시 + 상태 변경 후 자동 로드
  const projStatusLabel = (s: string) =>
    s === 'active' ? t('edit.statusActive', '진행 중')
      : s === 'paused' ? t('edit.statusPaused', '일시 중지')
        : s === 'closed' ? t('edit.statusClosed', '완료') : s;
  const loadStatusHistory = useCallback(async () => {
    if (!projectId) return;
    try {
      const r = await apiFetch(`/api/projects/${projectId}/status-history`);
      const j = await r.json();
      if (j?.success) setStatusHistory(Array.isArray(j.data) ? j.data : []);
    } catch { /* best-effort */ }
  }, [projectId]);
  useEffect(() => {
    if (tab === 'details') loadStatusHistory();
  }, [tab, project?.status, loadStatusHistory]);
  const [resendingIds, setResendingIds] = useState<Set<number>>(new Set());
  const [resentIds, setResentIds] = useState<Set<number>>(new Set());

  // 프로젝트 고객 초대 재발송 (대기 중인 고객만)
  const resendProjectInvite = async (clientId: number) => {
    if (resendingIds.has(clientId)) return;
    setResendingIds(prev => new Set(prev).add(clientId));
    try {
      const r = await apiFetch(`/api/projects/${projectId}/clients/${clientId}/resend-invite`, { method: 'POST' });
      const j = await r.json();
      if (j.success) {
        setProject(prev => prev ? { ...prev, projectClients: (prev.projectClients || []).map(x => x.id === clientId ? { ...x, invited_at: j.data.invited_at } : x) } : prev);
        setResentIds(prev => new Set(prev).add(clientId));
        setTimeout(() => setResentIds(prev => { const n = new Set(prev); n.delete(clientId); return n; }), 3000);
      }
    } finally {
      setResendingIds(prev => { const n = new Set(prev); n.delete(clientId); return n; });
    }
  };
  const [closing, setClosing] = useState(false);
  const [loading, setLoading] = useState(true);
  // 채팅방 ⋮ 메뉴 — 연결 끊기 / 삭제 (둘 다 ConfirmDialog 후 실행)
  const [convMenuFor, setConvMenuFor] = useState<number | null>(null);
  const [unlinkConv, setUnlinkConv] = useState<Conv | null>(null);
  const [archiveConv, setArchiveConv] = useState<Conv | null>(null);
  const [busyConvAction, setBusyConvAction] = useState(false);

  const handleUnlinkConv = useCallback(async () => {
    if (!unlinkConv || busyConvAction) return;
    setBusyConvAction(true);
    try {
      const r = await apiFetch(`/api/projects/conversations/${unlinkConv.id}/unlink`, { method: 'POST' });
      if (r.ok) {
        setConvs(prev => prev.filter(c => c.id !== unlinkConv.id));
        setUnlinkConv(null);
      }
    } finally { setBusyConvAction(false); }
  }, [unlinkConv, busyConvAction]);

  const handleArchiveConv = useCallback(async () => {
    if (!archiveConv || busyConvAction || !project) return;
    setBusyConvAction(true);
    try {
      const r = await apiFetch(`/api/conversations/${project.business_id}/${archiveConv.id}/archive`, { method: 'POST' });
      if (r.ok) {
        setConvs(prev => prev.filter(c => c.id !== archiveConv.id));
        setArchiveConv(null);
      }
    } finally { setBusyConvAction(false); }
  }, [archiveConv, busyConvAction, project]);

  // 외부 클릭 시 ⋮ 메뉴 닫기
  useEffect(() => {
    if (convMenuFor === null) return;
    const onClick = () => setConvMenuFor(null);
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [convMenuFor]);

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
          // 사이클 P8 — Cue (is_ai=true) 도 팀원으로 노출. 업무 자동 실행 가능.
          if (mr?.success) setBizMembers(mr.data || []);
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

  // N+39-2 — 실시간 동기화 (CLAUDE.md 16번) + PWA visibility 안전망
  const projectBizId = project?.business_id;
  useVisibilityRefresh(useCallback(() => { void load(); }, [load]));
  useEffect(() => {
    if (!projectBizId || !projectId) return;
    let pending: number | null = null;
    const debouncedReload = () => {
      if (pending) return;
      pending = window.setTimeout(() => { pending = null; void load(); }, 250);
    };
    let socket: { disconnect: () => void } | null = null;
    import('socket.io-client').then(({ io }) => {
      import('../../contexts/AuthContext').then(({ getAccessToken }) => {
        if (!getAccessToken()) return;
        const s = io({
          auth: (cb) => cb({ token: getAccessToken() }),
          transports: ['websocket', 'polling'],
          reconnection: true,
        });
        socket = s;
        s.on('connect', () => { s.emit('join:business', Number(projectBizId)); s.emit('join:project', Number(projectId)); });
        // 운영 #48 — task 변경은 전체 reload(=리프레시·위치 점프) 대신 in-place merge (§16(c) 작은 list).
        //   project_id 가 이 프로젝트면 upsert, 다른 프로젝트로 이관됐으면 이 리스트에서 제거(#42 실시간 반영).
        const upsertTask = (task: TaskRow) => {
          if (!task || task.id == null) return;
          if (task.project_id != null && Number(task.project_id) !== Number(projectId)) {
            setTasks((prev) => prev.filter((t) => t.id !== task.id));
            return;
          }
          setTasks((prev) => (prev.some((t) => t.id === task.id)
            ? prev.map((t) => (t.id === task.id ? { ...t, ...task } : t))
            : [task, ...prev]));
        };
        s.on('task:new', upsertTask);
        s.on('task:updated', upsertTask);
        s.on('task:deleted', (meta: { id: number }) => setTasks((prev) => prev.filter((t) => t.id !== meta?.id)));
        s.on('note:new', debouncedReload); s.on('issue:new', debouncedReload);
        s.on('post:new', debouncedReload); s.on('post:updated', debouncedReload); s.on('post:deleted', debouncedReload);
        // 고객 초대 수락/변경 실시간 반영 (참여 고객 리스트 즉시 갱신)
        s.on('client:updated', debouncedReload); s.on('project_client:updated', debouncedReload);
      });
    });
    return () => { if (pending) window.clearTimeout(pending); if (socket) socket.disconnect(); };
  }, [projectBizId, projectId, load]);


  // ── 멤버 관리 (bulk PUT) ──
  const saveMembers = async (next: { user_id: number; role: string; is_pm?: boolean; User?: { id: number; name: string; display_name?: string | null }}[]) => {
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
        {/* 탭 순서 (사이클 N+14): 문서 다음에 정보(Q info), 상세정보(메타)는 마지막 */}
        {([['dashboard', '캔버스'], ['tasks', '업무'], ['clients', '고객'], ['files', '파일'], ['docs', '문서'], ['info', '정보'], ['transactions', '거래'], ['report', '보고서'], ['details', '상세정보']] as [TabKey, string][]).map(([k, lbl]) => (
          <Tab key={k} $active={tab === k} onClick={() => setTab(k)}>
            {t(`tab.${k}`, lbl)}
          </Tab>
        ))}
        {pinnedDocIds.map(id => {
          const tabKey = `doc-${id}` as TabKey;
          const label = pinnedDocLabels[id] || `#${id}`;
          return (
            <Tab key={tabKey} $active={tab === tabKey} onClick={() => setTab(tabKey)} title={label}>
              📄 {label.length > 14 ? label.slice(0, 14) + '…' : label}
            </Tab>
          );
        })}
      </TabBar>

      {tab === 'dashboard' && (
        <ProjectCanvas projectId={projectId} businessId={project.business_id} />
      )}

      {tab === 'tasks' && (
        <TasksTab
          projectId={projectId}
          businessId={project.business_id}
          projectName={project.name}
          tasks={sortedTasks as unknown as import('./TasksTab').TaskRow[]}
          onRefresh={load}
        />
      )}

      {tab === 'info' && (
        <ProjectKnowledgeTab businessId={project.business_id} projectId={projectId} />
      )}

      {tab === 'details' && (
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
                <ProjectDescriptionEditor
                  projectId={projectId}
                  initial={project.description || ''}
                  onSave={async (v) => {
                    await apiFetch(`/api/projects/${projectId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ description: v || null }) });
                    setProject(prev => prev ? { ...prev, description: v || null } : prev);
                  }}
                />
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
                        {m.User?.display_name || m.User?.name || `user ${m.user_id}`}
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
                    <ConvMoreBtn type="button"
                      title={t('convs.moreHint', { defaultValue: '연결 끊기 / 삭제' }) as string}
                      aria-label={t('convs.moreHint', { defaultValue: '연결 끊기 / 삭제' }) as string}
                      onClick={(e) => { e.stopPropagation(); setConvMenuFor(convMenuFor === c.id ? null : c.id); }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><circle cx="12" cy="6" r="0.5"/><circle cx="12" cy="12" r="0.5"/><circle cx="12" cy="18" r="0.5"/></svg>
                    </ConvMoreBtn>
                    {convMenuFor === c.id && (
                      <ConvMenu onClick={(e) => e.stopPropagation()}>
                        <ConvMenuBtn type="button" onClick={() => { setUnlinkConv(c); setConvMenuFor(null); }}>
                          {t('convs.unlink', { defaultValue: '프로젝트 연결 끊기' }) as string}
                        </ConvMenuBtn>
                        <ConvMenuBtn type="button" $danger onClick={() => { setArchiveConv(c); setConvMenuFor(null); }}>
                          {t('convs.archive', { defaultValue: '채팅방 삭제' }) as string}
                        </ConvMenuBtn>
                      </ConvMenu>
                    )}
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

          {/* 상태 변경 이력 (기본 히스토리) */}
          <Card>
            <CardTitle>{t('section.statusHistory', '상태 이력')}</CardTitle>
            {statusHistory.length === 0 ? (
              <ProjHistEmpty>{t('section.statusHistoryEmpty', '상태 변경 이력이 없습니다')}</ProjHistEmpty>
            ) : (
              <ProjHistList>
                {statusHistory.map(ev => (
                  <ProjHistRow key={ev.id}>
                    <ProjHistDot />
                    <ProjHistBody>
                      <ProjHistMain>
                        {ev.from_status && (
                          <>
                            <ProjHistChip>{projStatusLabel(ev.from_status)}</ProjHistChip>
                            <ProjHistArrow>→</ProjHistArrow>
                          </>
                        )}
                        <ProjHistChip $to>{projStatusLabel(ev.to_status)}</ProjHistChip>
                      </ProjHistMain>
                      <ProjHistMeta>
                        {formatDateTime(ev.created_at)}
                        {ev.changed_by_name && ` · ${ev.changed_by_name}`}
                        {ev.note && ` · ${ev.note}`}
                      </ProjHistMeta>
                    </ProjHistBody>
                  </ProjHistRow>
                ))}
              </ProjHistList>
            )}
          </Card>
        </InfoBody>
      )}
      {tab === 'files' && <DocsTab projectId={projectId} businessId={project.business_id} />}
      {tab === 'docs' && (
        <ProjectDocsWrap>
          <PostsPage scope={{ type: 'project', businessId: project.business_id, projectId }} />
        </ProjectDocsWrap>
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
                      {!joined && c.invited_at && (
                        <InviteSentAt title={t('clients.invitedAtTitle', '초대 발송 시각') as string}>
                          {t('clients.invitedAt', { defaultValue: '{{date}} 발송', date: formatDateTime(c.invited_at) })}
                        </InviteSentAt>
                      )}
                      <ClientStatusPill $joined={joined} title={joined ? t('clients.joinedTitle', '워크스페이스 사용자로 참여 중') as string : t('clients.pendingTitle', '초대 발송 — 수락 대기 중') as string}>
                        {joined ? t('clients.joined', '참여 중') : t('clients.pending', '초대 대기')}
                      </ClientStatusPill>
                      {!joined && c.contact_email && (
                        <ResendBtn type="button" disabled={resendingIds.has(c.id)}
                          onClick={() => resendProjectInvite(c.id)}>
                          {resentIds.has(c.id)
                            ? t('clients.resent', '발송됨')
                            : resendingIds.has(c.id)
                              ? t('clients.resending', '발송 중…')
                              : t('clients.resend', '재발송')}
                        </ResendBtn>
                      )}
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
              // 이미 이 프로젝트에 참여 중인 고객은 제외 — client_id 우선(견고), 이메일 보조.
              //  (옛 버그: contact_email vs display_name 키 불일치로 미가입 초대고객이 또 노출)
              const joinedClientIds = new Set((project.projectClients || []).map((c) => c.client_id).filter(Boolean));
              const joinedEmails = new Set((project.projectClients || []).map((c) => c.contact_email).filter(Boolean));
              const candidates = bizClients.filter((b) => {
                if (joinedClientIds.has(b.id)) return false;
                const email = b.user?.email || b.invite_email;
                if (email && joinedEmails.has(email)) return false;
                return true;
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
      {tab === 'transactions' && <TransactionsTab projectId={projectId} />}
      {tab === 'report' && <ProjectReportTab businessId={project.business_id} projectId={projectId} />}

      {/* 메뉴에 추가된 문서 탭 (doc-:id) — PostEditor read-only + 편집 진입 */}
      {isDocTabKey(tab) && (
        <PinnedDocBody
          postId={Number(tab.replace('doc-', ''))}
          onEdit={(pid) => {
            // #96 — 문서 탭(PostsPage)으로 이동 + ?post=N 쿼리 → 해당 문서 열림
            const sp = new URLSearchParams(searchParams);
            sp.set('tab', 'docs');
            sp.set('post', String(pid));
            setTabState('docs');
            setSearchParams(sp, { replace: true });
          }}
        />
      )}

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

      {/* 채팅방 ⋮ 메뉴 — 연결 끊기 / 삭제 confirm */}
      <ConfirmDialog
        isOpen={!!unlinkConv}
        onClose={() => setUnlinkConv(null)}
        onConfirm={handleUnlinkConv}
        title={t('convs.unlinkTitle', { defaultValue: '프로젝트 연결 끊기' }) as string}
        message={t('convs.unlinkMessage', { defaultValue: '"{{name}}" 채팅방을 이 프로젝트에서 분리합니다. 채팅방과 메시지는 보존되며 워크스페이스의 일반 채팅으로 전환됩니다.', name: unlinkConv?.title || `#${unlinkConv?.id || ''}` }) as string}
        confirmText={t('convs.unlinkConfirm', { defaultValue: '연결 끊기' }) as string}
        cancelText={t('common.cancel', '취소') as string}
        variant="info"
      />
      <ConfirmDialog
        isOpen={!!archiveConv}
        onClose={() => setArchiveConv(null)}
        onConfirm={handleArchiveConv}
        title={t('convs.archiveTitle', { defaultValue: '채팅방 삭제' }) as string}
        message={t('convs.archiveMessage', { defaultValue: '"{{name}}" 채팅방을 삭제합니다. 모든 멤버에게 더 이상 보이지 않으며 메시지·참가자 데이터는 감사 목적으로 30일 보존됩니다.', name: archiveConv?.title || `#${archiveConv?.id || ''}` }) as string}
        confirmText={t('convs.archiveConfirm', { defaultValue: '삭제' }) as string}
        cancelText={t('common.cancel', '취소') as string}
        variant="danger"
      />
    </PageShell>
  );
};

export default QProjectDetailPage;

// ───────── 메뉴에 추가된 문서 탭 본문 (PostEditor read-only + 편집 액션) ─────────
const PinnedDocBody: React.FC<{ postId: number; onEdit: (id: number) => void }> = ({ postId, onEdit }) => {
  const { t } = useTranslation('qproject');
  const [detail, setDetail] = useState<PostDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchPost(postId)
      .then(d => { if (!cancelled) { if (d) setDetail(d); else setError('not_found'); } })
      .catch(() => { if (!cancelled) setError('error'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [postId]);

  if (loading) return <PinnedDocLoading>{t('pinnedDoc.loading', '불러오는 중...')}</PinnedDocLoading>;
  if (error || !detail) return <PinnedDocEmpty>{t('pinnedDoc.notFound', '문서를 찾을 수 없습니다. 메뉴에서 제거하세요.')}</PinnedDocEmpty>;

  return (
    <PinnedDocCard>
      <PinnedDocHeader>
        <PinnedDocTitle>{detail.title}</PinnedDocTitle>
        <PinnedDocActions>
          <PinnedDocBtn type="button" onClick={() => onEdit(postId)} title={t('pinnedDoc.editHint', '문서 탭에서 이 문서 편집') as string}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
            {t('pinnedDoc.edit', '편집')}
          </PinnedDocBtn>
        </PinnedDocActions>
      </PinnedDocHeader>
      <PostEditor value={detail.content_json} onChange={() => {}} editable={false} />
    </PinnedDocCard>
  );
};

const PinnedDocCard = styled.div`
  background: #FFFFFF;
  border: 1px solid #E2E8F0;
  border-radius: 12px;
  padding: 24px 28px;
`;
const PinnedDocHeader = styled.div`
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px; margin-bottom: 16px;
  padding-bottom: 12px; border-bottom: 1px solid #E2E8F0;
`;
const PinnedDocTitle = styled.h2`
  margin: 0; font-size: 18px; font-weight: 700; color: #0F172A;
  flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
`;
const PinnedDocActions = styled.div`
  display: inline-flex; gap: 6px; flex-shrink: 0;
`;
const PinnedDocBtn = styled.button`
  display: inline-flex; align-items: center; gap: 5px;
  height: 32px; padding: 0 12px;
  background: #14B8A6; color: #fff;
  border: none; border-radius: 8px;
  font-size: 12px; font-weight: 600; cursor: pointer;
  transition: background 0.15s;
  &:hover { background: #0D9488; }
`;
const PinnedDocLoading = styled.div`
  text-align: center; padding: 40px; color: #94A3B8; font-size: 13px;
`;
const PinnedDocEmpty = styled.div`
  text-align: center; padding: 40px; color: #DC2626; font-size: 13px;
  background: #FEF2F2; border: 1px solid #FECACA; border-radius: 12px;
`;

// ───────── Dashboard Timeline (공용 GanttTrack) ─────────
// ───────── styled ─────────
const BackBtn = styled.button`padding:6px 12px;background:#FFF;color:#334155;border:1px solid #CBD5E1;border-radius:8px;font-size:12px;cursor:pointer;&:hover{background:#F8FAFC;border-color:#94A3B8;}`;
const TabBar = styled.div`display:flex;gap:4px;border-bottom:1px solid #E2E8F0;background:#FFF;padding:0 20px;margin:-20px -20px 20px;`;
const Tab = styled.button<{$active:boolean}>`
  padding:12px 14px;background:transparent;border:none;color:${p=>p.$active?'#0F766E':'#64748B'};
  font-size:13px;font-weight:600;cursor:pointer;border-bottom:2px solid ${p=>p.$active?'#14B8A6':'transparent'};
  display:inline-flex;align-items:center;gap:6px;
  &:hover{color:#0F766E;}
`;
const InfoBody = styled.div`display:grid;grid-template-columns:repeat(2, minmax(0, 1fr));gap:16px;@media (max-width:900px){grid-template-columns:1fr;}`;
// #96 — PostsPage(Layout height:100%) 를 프로젝트 탭에 임베드. 경계 높이 부여 → 내부 사이드바·그리드 자체 스크롤.
//   상단 네비(64)+PageShell 헤더(60)+Body padding+TabBar 보정. Body padding(20) 상쇄 위해 음수 마진.
const ProjectDocsWrap = styled.div`
  height: calc(100vh - 210px);
  min-height: 460px;
  margin: -20px;
  @media (max-width: 768px) { height: calc(100vh - 180px); margin: -16px; }
`;
const EditGrid = styled.div`display:grid;grid-template-columns:1fr 1fr;gap:12px;`;
const EditField = styled.div`display:flex;flex-direction:column;gap:4px;`;
const EditLabel = styled.span`font-size:11px;color:#64748B;font-weight:700;`;
const EditInput = styled.input`height:34px;padding:0 10px;border:1px solid #E2E8F0;border-radius:6px;font-size:13px;font-family:inherit;&:focus{outline:none;border-color:#14B8A6;}`;
const EditTextarea = styled.textarea`padding:8px 10px;border:1px solid #E2E8F0;border-radius:6px;font-size:13px;font-family:inherit;resize:vertical;&:focus{outline:none;border-color:#14B8A6;}`;
const TypeBtn2 = styled.button<{$active?:boolean}>`flex:1;padding:8px 12px;border:1px solid ${p=>p.$active?'#14B8A6':'#E2E8F0'};background:${p=>p.$active?'#F0FDFA':'#FFF'};color:${p=>p.$active?'#0F766E':'#334155'};border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;&:hover{border-color:#14B8A6;}`;
const EditDateRangeTrigger = styled.button`width:100%;height:34px;padding:0 10px;border:1px solid #E2E8F0;border-radius:6px;font-size:13px;color:#0F172A;background:#FFF;font-family:inherit;text-align:left;cursor:pointer;&:hover{border-color:#14B8A6;}`;
const DatePH = styled.span`color:#94A3B8;`;
const ColorRow = styled.div`display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:flex-start;padding:2px 0;width:100%;`;
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

// 상태 변경 이력 타임라인 (기본 히스토리)
const ProjHistEmpty = styled.div`font-size:12px;color:#94A3B8;`;
const ProjHistList = styled.div`display:flex;flex-direction:column;gap:12px;`;
const ProjHistRow = styled.div`display:flex;gap:10px;align-items:flex-start;`;
const ProjHistDot = styled.div`width:8px;height:8px;border-radius:999px;background:#14B8A6;margin-top:5px;flex-shrink:0;`;
const ProjHistBody = styled.div`display:flex;flex-direction:column;gap:2px;min-width:0;`;
const ProjHistMain = styled.div`display:flex;align-items:center;gap:6px;flex-wrap:wrap;`;
const ProjHistChip = styled.span<{ $to?: boolean }>`font-size:12px;font-weight:600;padding:2px 8px;border-radius:999px;background:${p => (p.$to ? '#F0FDFA' : '#F1F5F9')};color:${p => (p.$to ? '#0F766E' : '#64748B')};`;
const ProjHistArrow = styled.span`font-size:12px;color:#94A3B8;`;
const ProjHistMeta = styled.div`font-size:11px;color:#94A3B8;`;


const ConvList = styled.div`display:flex;flex-direction:column;gap:6px;`;
const ConvRow = styled.div`
  position:relative;display:flex;align-items:center;gap:10px;padding:8px 10px;
  border:1px solid #E2E8F0;border-radius:6px;cursor:pointer;
  &:hover{border-color:#14B8A6;background:#F0FDFA;}
  &:hover .conv-more-btn{opacity:1;}
`;
const ConvMoreBtn = styled.button.attrs({ className: 'conv-more-btn' })`
  width:24px;height:24px;background:transparent;border:none;border-radius:4px;
  display:inline-flex;align-items:center;justify-content:center;color:#64748B;cursor:pointer;
  opacity:0;transition:opacity 0.15s,background 0.15s;
  &:hover{background:#FFFFFF;color:#0F172A;}
  &:focus-visible{opacity:1;outline:1px solid #14B8A6;}
`;
const ConvMenu = styled.div`
  position:absolute;right:6px;top:calc(100% - 4px);z-index:20;
  min-width:160px;padding:4px;background:#FFFFFF;
  border:1px solid #E2E8F0;border-radius:8px;
  box-shadow:0 4px 12px rgba(0,0,0,0.06);
`;
const ConvMenuBtn = styled.button<{$danger?:boolean}>`
  width:100%;padding:8px 10px;text-align:left;font-size:12px;font-weight:500;
  color:${p=>p.$danger?'#DC2626':'#334155'};
  background:transparent;border:none;border-radius:6px;cursor:pointer;
  transition:background 0.15s;
  &:hover{background:${p=>p.$danger?'#FEF2F2':'#F8FAFC'};}
`;
const ConvChannel = styled.span<{$type:string}>`
  padding:2px 6px;border-radius:4px;font-size:10px;font-weight:700;flex-shrink:0;
  background:${p=>p.$type==='customer'?'#FFF1F2':p.$type==='internal'?'#F0FDFA':'#F1F5F9'};
  color:${p=>p.$type==='customer'?'#9F1239':p.$type==='internal'?'#0F766E':'#475569'};
`;
const ConvTitle = styled.span`flex:1;font-size:13px;color:#0F172A;`;


const ClientList = styled.div`display:flex;flex-direction:column;gap:6px;margin-bottom:12px;`;
const ClientRow = styled.div`display:flex;align-items:center;gap:10px;padding:8px 12px;border:1px solid #E2E8F0;border-radius:6px;strong{flex:1;font-size:13px;color:#0F172A;}span{font-size:12px;color:#64748B;}`;
const ClientStatusPill = styled.span<{ $joined: boolean }>`
  flex-shrink:0;padding:2px 8px;border-radius:8px;font-size:10px;font-weight:600;white-space:nowrap;
  ${p=>p.$joined?'background:#CCFBF1;color:#0F766E;':'background:#FEF3C7;color:#92400E;'}
`;
const ClientDelBtn = styled.button`width:24px;height:24px;border:none;background:transparent;color:#94A3B8;cursor:pointer;border-radius:4px;font-size:14px;&:hover{background:#FEE2E2;color:#DC2626;}`;
const InviteSentAt = styled.span`font-size:11px!important;color:#94A3B8!important;white-space:nowrap;`;
const ResendBtn = styled.button`
  height:26px;padding:0 10px;border:1px solid #CBD5E1;background:#fff;color:#0F766E;
  border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;
  &:hover:not(:disabled){background:#F0FDFA;border-color:#14B8A6;}
  &:disabled{opacity:0.5;cursor:not-allowed;}
`;
// ── Close Project modal ──
const CloseBackdrop = styled.div`position:fixed;inset:0;background:rgba(15,23,42,0.40);z-index: 1000;display:flex;align-items:center;justify-content:center;padding:20px;animation:cpfade 0.15s ease-out;@keyframes cpfade{from{opacity:0;}to{opacity:1;}}`;
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
const IssueList = styled.div`display:flex;flex-direction:column;gap:6px;margin-bottom:10px;`;
const IssueRow = styled.div`padding:8px 10px;background:#F8FAFC;border-radius:6px;display:flex;flex-direction:column;gap:2px;`;
const IssueBody = styled.div`font-size:12px;color:#0F172A;line-height:1.5;display:flex;align-items:center;gap:6px;strong{font-size:12px;}`;
const IssueMeta = styled.div`font-size:10px;color:#94A3B8;`;
const AddIssueRow = styled.div`display:flex;gap:6px;align-items:center;`;
const IssueInput = styled.input`flex:1;padding:6px 10px;border:1px solid #E2E8F0;border-radius:6px;font-size:12px;font-family:inherit;&:focus{outline:none;border-color:#14B8A6;}`;
const VisTag = styled.span<{$internal?:boolean}>`padding:1px 6px;border-radius:4px;font-size:10px;font-weight:600;flex-shrink:0;background:${p=>p.$internal?'#F0FDFA':'#F1F5F9'};color:${p=>p.$internal?'#0F766E':'#64748B'};`;
const Empty = styled.div`padding:60px;text-align:center;color:#94A3B8;`;

// 프로젝트 설명 — AutoSaveField + draft state (controlled)
const ProjectDescriptionEditor = ({ projectId, initial, onSave }: {
  projectId: number;
  initial: string;
  onSave: (v: string) => Promise<void>;
}) => {
  const [draft, setDraft] = useState(initial);
  useEffect(() => { setDraft(initial); }, [projectId, initial]);
  return (
    <AutoSaveField onSave={async () => { await onSave(draft.trim()); }}>
      <EditTextarea rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} />
    </AutoSaveField>
  );
};
