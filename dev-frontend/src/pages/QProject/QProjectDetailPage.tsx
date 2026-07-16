// /projects/p/:id — 프로젝트 허브 (대시보드/업무/문서/고객/프로세스 파트 5탭)
import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../contexts/AuthContext';
import { joinRoom, leaveRoom, onSocket } from '../../services/socket';
import PageShell from '../../components/Layout/PageShell';
import AutoSaveField, { type AutoSaveHandle } from '../../components/Common/AutoSaveField';
import { useTimeFormat } from '../../hooks/useTimeFormat';
import { useVisibilityRefresh } from '../../hooks/useVisibilityRefresh';
import ProjectCanvas from './canvas/ProjectCanvas'; // 기본 탭 — 즉시 로드(로딩 플래시 없음)
// 나머지 탭은 지연 로드(lazy) — 프로젝트 열 때 모든 탭 코드(+무거운 에디터 tiptap)를 한꺼번에
// 받던 것을 탭 클릭 시점 로드로 분리. 초기 페이지 로드 대폭 경량화.
const TasksTab = React.lazy(() => import('./TasksTab'));
const DocsTab = React.lazy(() => import('./DocsTab'));
// #96 — 프로젝트 '문서' 탭은 Q docs PostsPage 를 project scope 로 재사용 (문서·표·첨부 전 기능 동일).
const PostsPage = React.lazy(() => import('../../components/Docs/PostsPage'));
const TransactionsTab = React.lazy(() => import('./TransactionsTab'));
const ProjectReportTab = React.lazy(() => import('./ProjectReportTab'));
const ProjectKnowledgeTab = React.lazy(() => import('./ProjectKnowledgeTab'));
const PostEditor = React.lazy(() => import('../../components/Docs/PostEditor'));
const PostTableGrid = React.lazy(() => import('../../components/Docs/PostTableGrid')); // 표 문서 뷰(추가탭에서도 문서탭과 동일 렌더)
import { fetchPost, type PostDetail } from '../../services/posts';
import PlanQSelect from '../../components/Common/PlanQSelect';
import CalendarPicker from '../../components/Common/CalendarPicker';
import { PROJECT_COLOR_PALETTE } from '../../utils/projectColors';
import ConfirmDialog from '../../components/Common/ConfirmDialog';
import {
  PinnedDocCard,
  PinnedDocHeader,
  PinnedDocTitle,
  PinnedDocActions,
  PinnedDocBtn,
  PinnedDocLoading,
  PinnedDocEmpty,
  PinnedDocInfo,
  BackBtn,
  TabBar,
  TabFallback,
  Tab,
  InfoBody,
  ProjectDocsWrap,
  EditGrid,
  EditField,
  EditLabel,
  EditHint,
  EditInput,
  EditTextarea,
  TypeBtn2,
  EditDateRangeTrigger,
  DatePH,
  ColorRow,
  ColorSwatch,
  HexRow,
  HexPreview,
  HexNativePicker,
  HexInput,
  ClientsBody,
  Card,
  CardTitle,
  ProjHistEmpty,
  ProjHistList,
  ProjHistRow,
  ProjHistDot,
  ProjHistBody,
  ProjHistMain,
  ProjHistChip,
  ProjHistArrow,
  ProjHistMeta,
  ConvList,
  ConvRow,
  ConvMoreBtn,
  ConvMenu,
  ConvMenuBtn,
  ConvChannel,
  ConvTitle,
  ClientList,
  ClientRow,
  ClientStatusPill,
  ClientDelBtn,
  InviteSentAt,
  ResendBtn,
  CloseBackdrop,
  CloseDialog,
  CloseHeader,
  CloseBody,
  ClientsChoiceTitle,
  ClientsChoiceHint,
  ClientChoiceList,
  ClientChoiceRow,
  ClientChoiceEmail,
  CloseFooter,
  CFCancelBtn,
  CFConfirmBtn,
  LinkClientBar,
  LinkClientLabel,
  AddClientForm,
  ClientInput,
  AddClientBtn,
  Dim,
  MemberList,
  MemberRow,
  MemberName,
  OwnerTag,
  PmTag,
  MemberRoleInput,
  PmToggle,
  MemberRemoveBtn,
  AddMemberBox,
  MemberCandidateList,
  MemberCandidateItem,
  MemberEmail,
  AddMemberCancelBtn,
  AddMemberLink,
  IssueList,
  IssueRow,
  IssueBody,
  IssueMeta,
  AddIssueRow,
  AddBtn,
  IssueInput,
  VisTag,
  Empty,
  HeaderActions,
  HeaderBtn,
} from './QProjectDetailPage.styles';

const PROJECT_COLORS = PROJECT_COLOR_PALETTE.map(p => p.value);

// process 탭 폐지 — Q docs 의 표(table) kind 로 흡수. 이전 url ?tab=process 는 docs 로 fallback.
// 'doc-:id' 형태는 사용자가 메뉴에 추가한 특정 문서 탭 (문서 탭 PostsPage 의 📌 메뉴 추가 버튼).
// 사이클 N+14 — 'info' 의미 분리:
//   'details' = 프로젝트 메타데이터 편집 (옛 'info' 폼). 라벨 "상세정보".
//   'info'    = Q info (KbDocument scope='project'). 라벨 "정보". 문서 다음 위치.
type TabKey = 'dashboard' | 'tasks' | 'details' | 'settings' | 'info' | 'clients' | 'files' | 'docs' | 'transactions' | 'report' | `doc-${number}`;
// 고객(client)에게 숨기는 탭 — 내부 캔버스(전략·403)·고객목록·거래(청구)·보고서·상세메타. 고객은 협업 탭(업무·파일·문서·정보)만.
const CLIENT_HIDDEN_TABS: TabKey[] = ['dashboard', 'clients', 'transactions', 'report', 'details', 'settings'];

interface BizMember { id: number; user_id: number; user?: { id: number; name: string; email?: string; is_ai?: boolean; display_name?: string | null } }

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
  kind?: 'client' | 'internal';
  process_tab_label?: string;
  color?: string | null;
  owner_user_id: number;
  my_role_in_project?: 'owner' | 'admin' | 'member' | 'client' | string;
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

/**
 * 저장 피드백을 onChange 없는 컨트롤까지 넓힌다 (#147).
 *
 * AutoSaveField 는 자식의 onChange 를 가로채 debounce 후 저장한다. 그런데 프로젝트 설정의
 * 절반(타입·구분·상태 버튼, 색상 스와치, 기간 달력, 역할 입력)은 onClick/onBlur 로 저장해서
 * **뱃지가 붙을 자리가 없었다** — 저장은 되는데 사용자는 됐는지 알 수 없었다.
 * AutoSaveField 가 이미 노출하던 triggerSave() 핸들로 그 컨트롤들도 같은 문을 지나게 한다.
 */
const ActionAutoSave: React.FC<{
  type?: 'input' | 'select' | 'toggle' | 'list';
  save: (patch: Record<string, unknown>) => Promise<void>;
  style?: React.CSSProperties;
  children: (fire: (patch: Record<string, unknown>) => void) => React.ReactNode;
}> = ({ type = 'toggle', save, style, children }) => {
  const handle = useRef<AutoSaveHandle>(null);
  const pending = useRef<Record<string, unknown>>({});
  const fire = useCallback((patch: Record<string, unknown>) => {
    pending.current = patch;
    handle.current?.triggerSave();
  }, []);
  return (
    <AutoSaveField ref={handle} type={type} style={style} onSave={async () => { await save(pending.current); }}>
      {children(fire)}
    </AutoSaveField>
  );
};

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
    // 탭 전환 시 문서 상세(?post) 초기화 — stale ?post 로 문서 탭이 목록 대신 상세로 바로 열리던 문제 방지
    sp.delete('post');
    setSearchParams(sp, { replace: true });
  };
  const [newClientName, setNewClientName] = useState('');
  const [newClientEmail, setNewClientEmail] = useState('');
  const [issues, setIssues] = useState<{ id: number; body: string; author?: { name: string }; created_at: string }[]>([]);
  const [notes, setNotes] = useState<{ id: number; body: string; visibility: string; author?: { name: string }; created_at: string }[]>([]);
  const [newIssue, setNewIssue] = useState('');
  const [newNote, setNewNote] = useState('');
  const [newNoteVis, setNewNoteVis] = useState<'personal' | 'internal'>('internal');
  const [submitting, setSubmitting] = useState(false);   // 버튼 비활성화용 (중복 제출 가드)
  const submittingRef = useRef(false);
  const periodAnchorRef = useRef<HTMLButtonElement>(null);
  const [periodPickerOpen, setPeriodPickerOpen] = useState(false);
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const isClient = project?.my_role_in_project === 'client';
  // 고객이 숨겨진 탭(캔버스 등)으로 진입하면 허용 탭(문서)으로 이동 — 빈/에러 화면 방지.
  useEffect(() => {
    if (isClient && CLIENT_HIDDEN_TABS.includes(tab)) setTab('docs');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isClient, tab]);
  const [statusHistory, setStatusHistory] = useState<{ id: number; from_status: string | null; to_status: string; note: string | null; created_at: string; changed_by_name: string | null }[]>([]);
  const [convs, setConvs] = useState<Conv[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [bizMembers, setBizMembers] = useState<BizMember[]>([]);
  const [bizClients, setBizClients] = useState<{ id: number; display_name: string | null; company_name: string | null; invite_email?: string | null; user?: { id: number; name: string; email: string } }[]>([]);
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [closeModalOpen, setCloseModalOpen] = useState(false);
  const [clientsToRemove, setClientsToRemove] = useState<Set<number>>(new Set());

  // 설정 탭 — 저장 단일 착지점 (#147).
  // apiFetch 는 Response 를 그대로 돌려준다 → 여기서 res.ok 를 보지 않으면 저장이 실패해도
  // 화면은 성공한 척한다(옛 코드가 그랬다). 실패는 throw 해서 AutoSaveField 가 ! 뱃지를 띄운다.
  const saveProject = useCallback(async (patch: Record<string, unknown>) => {
    const res = await apiFetch(`/api/projects/${projectId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error(`save failed: ${res.status}`);
    setProject(prev => (prev ? { ...prev, ...patch } as ProjectDetail : prev));
  }, [projectId]);

  // 텍스트 입력은 controlled — AutoSaveField 표준 패턴(onChange 가로채기)에 태우기 위함
  const [nameDraft, setNameDraft] = useState('');
  const [clientCompanyDraft, setClientCompanyDraft] = useState('');
  const [hexDraft, setHexDraft] = useState('');
  useEffect(() => {
    if (!project) return;
    setNameDraft(project.name || '');
    setClientCompanyDraft(project.client_company || '');
    setHexDraft(project.color || '');
  }, [project?.id, project?.name, project?.client_company, project?.color]); // eslint-disable-line react-hooks/exhaustive-deps

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
    joinRoom(`business:${Number(projectBizId)}`);
    joinRoom(`project:${Number(projectId)}`);
    const offTaskNew = onSocket('task:new', upsertTask);
    const offTaskUpd = onSocket('task:updated', upsertTask);
    const offTaskDel = onSocket('task:deleted', (meta: { id: number }) => setTasks((prev) => prev.filter((t) => t.id !== meta?.id)));
    const offNoteNew = onSocket('note:new', debouncedReload);
    const offIssueNew = onSocket('issue:new', debouncedReload);
    const offPostNew = onSocket('post:new', debouncedReload);
    const offPostUpd = onSocket('post:updated', debouncedReload);
    const offPostDel = onSocket('post:deleted', debouncedReload);
    // 고객 초대 수락/변경 실시간 반영 (참여 고객 리스트 즉시 갱신)
    const offClientUpd = onSocket('client:updated', debouncedReload);
    const offProjClientUpd = onSocket('project_client:updated', debouncedReload);
    return () => {
      if (pending) window.clearTimeout(pending);
      leaveRoom(`business:${Number(projectBizId)}`);
      leaveRoom(`project:${Number(projectId)}`);
      offTaskNew(); offTaskUpd(); offTaskDel();
      offNoteNew(); offIssueNew();
      offPostNew(); offPostUpd(); offPostDel();
      offClientUpd(); offProjClientUpd();
    };
  }, [projectBizId, projectId, load]);


  // ── 멤버 관리 (bulk PUT) ──
  const saveMembers = async (next: { user_id: number; role: string; is_pm?: boolean; User?: { id: number; name: string; display_name?: string | null }}[]) => {
    if (!project) return;
    setProject(prev => prev ? { ...prev, projectMembers: next } : prev);
    // 실패를 삼키지 않는다 (#147) — 옛 코드는 catch {} 로 조용히 넘겨서, 저장이 안 돼도
    // 화면은 낙관적 갱신 그대로였다. 이제 throw 해서 호출부(자동저장 뱃지)가 ! 를 띄운다.
    const r = await apiFetch(`/api/projects/${projectId}/members`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ members: next.map(m => ({ user_id: m.user_id, role: m.role || '기타', is_pm: !!m.is_pm })) }),
    });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.success) throw new Error(j?.message || `members save failed: ${r.status}`);
    setProject(j.data);
  };
  // 뱃지가 없는 호출부(추가·삭제·PM 토글)는 옛 낙관적 동작 유지 — 실패는 다음 조작의 서버 값으로 덮인다
  const saveMembersOptimistic = (next: Parameters<typeof saveMembers>[0]) => { void saveMembers(next).catch(() => {}); };

  // 이슈·메모 등록 (#148) — 옛 코드는 저장 경로가 onKeyDown 안에만 있어서 **Enter 없이는 저장이 불가능**했다
  // (버튼이 없으니 태블릿/모바일에선 등록 자체가 막힘). 버튼과 Enter 가 같은 함수를 지나게 한다.
  const submitIssue = useCallback(async () => {
    const body = newIssue.trim();
    if (!body || submittingRef.current) return;
    submittingRef.current = true; setSubmitting(true);
    try {
      const r = await apiFetch(`/api/projects/${projectId}/issues`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body }),
      });
      const j = await r.json();
      if (j.success) { setIssues(prev => [j.data, ...prev]); setNewIssue(''); }
    } finally { submittingRef.current = false; setSubmitting(false); }
  }, [newIssue, projectId]);

  const submitNote = useCallback(async () => {
    const body = newNote.trim();
    if (!body || submittingRef.current) return;
    submittingRef.current = true; setSubmitting(true);
    try {
      const r = await apiFetch(`/api/projects/${projectId}/notes`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body, visibility: newNoteVis }),
      });
      const j = await r.json();
      if (j.success) { setNotes(prev => [j.data, ...prev]); setNewNote(''); }
    } finally { submittingRef.current = false; setSubmitting(false); }
  }, [newNote, newNoteVis, projectId]);

  // Enter 는 편의 경로일 뿐 — 한글 조합 중(isComposing)엔 발동하지 않는다
  const onEnterSubmit = (fn: () => void) => (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || (e.nativeEvent as unknown as { isComposing?: boolean }).isComposing) return;
    e.preventDefault();
    fn();
  };

  // #167 — 상세정보 탭이 편집 캔버스(ProjectCanvas)를 직접 렌더하므로 옛 읽기전용 전략요약(#148)은 제거.
  const addMember = (userId: number) => {
    const existing = project?.projectMembers || [];
    if (existing.some(m => m.user_id === userId)) return;
    const bm = bizMembers.find(b => b.user_id === userId);
    if (!bm?.user) return;
    saveMembersOptimistic([...existing, { user_id: userId, role: '팀원', is_pm: false, User: { id: bm.user.id, name: bm.user.name, display_name: bm.user.display_name ?? null } }]);
    setAddMemberOpen(false);
  };
  const removeMember = (userId: number) => {
    const existing = project?.projectMembers || [];
    saveMembersOptimistic(existing.filter(m => m.user_id !== userId));
  };
  // 역할 입력만 자동저장 뱃지를 받는다 → 실패를 그대로 올린다 (await + throw)
  const updateMemberRole = (userId: number, role: string) => {
    const existing = project?.projectMembers || [];
    return saveMembers(existing.map(m => m.user_id === userId ? { ...m, role } : m));
  };
  const togglePm = (userId: number) => {
    if (!project) return;
    // 프로젝트 생성자는 항상 PM — 해제 불가 (서버에서도 강제)
    if (userId === project.owner_user_id) return;
    const existing = project.projectMembers || [];
    saveMembersOptimistic(existing.map(m => m.user_id === userId ? { ...m, is_pm: !m.is_pm } : m));
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
      const sr = await apiFetch(`/api/projects/${projectId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'closed' }),
      });
      if (!sr.ok) return;  // owner-only(403) 등 거절 시 closed 표시 금지 + 모달 유지(거짓 종료 방지)
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
        <HeaderActions>
          {/* 소통 창구로 바로 — 채팅과 메일이 PlanQ 의 두 창구다. 프로젝트에서 한 번에 건너간다. */}
          <HeaderBtn type="button" onClick={() => navigate(`/talk?project=${projectId}`)}>
            {t('header.openChat', '프로젝트 채팅')}
          </HeaderBtn>
          <HeaderBtn type="button" onClick={() => navigate(`/mail?folder=all&project=${projectId}`)}>
            {t('header.openMail', '프로젝트 메일')}
          </HeaderBtn>
          <BackBtn type="button" onClick={() => navigate('/projects')}>← {t('backToList', '목록')}</BackBtn>
        </HeaderActions>
      }
    >
      <TabBar>
        {/* 탭 순서 (사이클 N+14): 문서 다음에 정보(Q info), 상세정보(메타)는 마지막 */}
        {/* 고객(client)은 협업 탭만 — 캔버스(내부 전략·403)·고객목록·거래·보고서·상세는 숨김 (권한 매트릭스 detail-only) */}
        {(['dashboard', 'tasks', 'clients', 'files', 'docs', 'info', 'transactions', 'report', 'details', 'settings'] as TabKey[])
          .filter((k) => !(isClient && CLIENT_HIDDEN_TABS.includes(k)))
          .map((k) => (
          <Tab key={k} $active={tab === k} onClick={() => setTab(k)}>
            {t(`tab.${k}`)}
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

      <Suspense fallback={<TabFallback>{t('common.loading', '불러오는 중…')}</TabFallback>}>
      {/* #167 — 개요 탭은 보기 전용. 편집(전략·지표·추진과제·프로젝트 연결)은 상세정보 탭 한 곳. */}
      {tab === 'dashboard' && !isClient && (
        <ProjectCanvas projectId={projectId} businessId={project.business_id} readOnly />
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

      {tab === 'settings' && (
        <InfoBody>
          <Card>
            <CardTitle>{t('section.editInfo', '기본 정보')}</CardTitle>
            <EditGrid>
              <EditField>
                <EditLabel>{t('edit.projectName', '프로젝트명')}</EditLabel>
                <AutoSaveField
                  type="input"
                  onSave={async () => {
                    const v = nameDraft.trim();
                    if (!v || v === project.name) return;   // 빈 이름 저장 금지 (옛 onBlur 규칙 보존)
                    await saveProject({ name: v });
                  }}
                >
                  <EditInput value={nameDraft} onChange={e => setNameDraft(e.target.value)} />
                </AutoSaveField>
              </EditField>
              <EditField>
                <EditLabel>{t('edit.client', '고객사')}</EditLabel>
                <AutoSaveField
                  type="input"
                  onSave={async () => {
                    const v = clientCompanyDraft.trim();
                    if ((project.client_company || '') === v) return;
                    await saveProject({ client_company: v || null });
                  }}
                >
                  <EditInput value={clientCompanyDraft} onChange={e => setClientCompanyDraft(e.target.value)} />
                </AutoSaveField>
              </EditField>
              <EditField>
                <EditLabel>{t('edit.type', '타입')}</EditLabel>
                <ActionAutoSave type="select" save={saveProject}>
                  {fire => (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <TypeBtn2 $active={project.project_type === 'fixed'} onClick={() => {
                        if (project.project_type === 'fixed') return;
                        fire({ project_type: 'fixed' });
                      }}>{t('edit.typeFixed', '일시 프로젝트')}</TypeBtn2>
                      <TypeBtn2 $active={project.project_type === 'ongoing'} onClick={() => {
                        if (project.project_type === 'ongoing') return;
                        fire({ project_type: 'ongoing' });
                      }}>{t('edit.typeOngoing', '지속 구독')}</TypeBtn2>
                    </div>
                  )}
                </ActionAutoSave>
              </EditField>
              <EditField>
                <EditLabel>{t('edit.kind', '구분')}</EditLabel>
                <ActionAutoSave type="select" save={saveProject}>
                  {fire => (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <TypeBtn2 $active={(project.kind ?? 'client') === 'client'} onClick={() => {
                        if ((project.kind ?? 'client') === 'client') return;
                        fire({ kind: 'client' });
                      }}>{t('edit.kindClient', '고객 프로젝트')}</TypeBtn2>
                      <TypeBtn2 $active={project.kind === 'internal'} onClick={() => {
                        if (project.kind === 'internal') return;
                        fire({ kind: 'internal' });
                      }}>{t('edit.kindInternal', '내부 프로젝트')}</TypeBtn2>
                    </div>
                  )}
                </ActionAutoSave>
                <EditHint>{t('edit.kindHint', '내부 = 자체 투자(비청구). 수익성 통계에서 제외되고 "내부 투자"로 별도 집계됩니다.')}</EditHint>
              </EditField>
              <EditField>
                <EditLabel>{t('edit.status', '상태')}</EditLabel>
                <ActionAutoSave type="select" save={saveProject}>
                  {fire => (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <TypeBtn2 $active={project.status === 'active'} onClick={() => {
                        if (project.status === 'active') return;
                        fire({ status: 'active' });
                      }}>{t('edit.statusActive', '진행 중')}</TypeBtn2>
                      <TypeBtn2 $active={project.status === 'paused'} onClick={() => {
                        if (project.status === 'paused') return;
                        fire({ status: 'paused' });
                      }}>{t('edit.statusPaused', '일시 중지')}</TypeBtn2>
                      {/* 완료는 되돌리기 어려운 전이 — 확인 모달을 거친다 (자동저장 대상 아님) */}
                      <TypeBtn2 $active={project.status === 'closed'} onClick={() => {
                        if (project.status !== 'closed') setCloseModalOpen(true);
                      }}>{t('edit.statusClosed', '완료')}</TypeBtn2>
                    </div>
                  )}
                </ActionAutoSave>
              </EditField>
              <EditField>
                <EditLabel>{t('edit.period', '기간')}</EditLabel>
                <ActionAutoSave type="select" save={saveProject}>
                  {fire => (
                    <>
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
                          onRangeSelect={(s, e) => {
                            const patch: Record<string, string | null> = { start_date: s || null };
                            if (project.project_type === 'fixed') patch.end_date = e || null;
                            fire(patch);
                          }}
                          onClose={() => setPeriodPickerOpen(false)}
                        />
                      )}
                    </>
                  )}
                </ActionAutoSave>
              </EditField>
              <EditField style={{ gridColumn: '1 / -1' }}>
                <EditLabel>{t('edit.color', '색상')}</EditLabel>
                <ActionAutoSave type="list" save={saveProject}>
                  {fire => (
                    <ColorRow>
                      {PROJECT_COLORS.map(c => (
                        <ColorSwatch key={c} type="button" $active={(project.color || '').toLowerCase() === c.toLowerCase()}
                          style={{ background: c }}
                          title={c}
                          onClick={() => fire({ color: c })} />
                      ))}
                    </ColorRow>
                  )}
                </ActionAutoSave>
                <HexRow>
                  <HexPreview style={{ background: project.color || '#E2E8F0' }} />
                  <ActionAutoSave type="select" save={saveProject}>
                    {fire => (
                      <HexNativePicker
                        type="color"
                        value={/^#[0-9a-fA-F]{6}$/.test(project.color || '') ? (project.color as string) : '#14B8A6'}
                        onChange={e => fire({ color: e.target.value })}
                        title={t('edit.colorPicker', '색상 선택기') as string}
                        aria-label={t('edit.colorPicker', '색상 선택기') as string}
                      />
                    )}
                  </ActionAutoSave>
                  <AutoSaveField
                    type="input"
                    onSave={async () => {
                      let v = hexDraft.trim();
                      if (v && !v.startsWith('#')) v = '#' + v;
                      // 형식이 틀리면 저장하지 않고 원래 값으로 되돌린다 (옛 onBlur 규칙 보존)
                      if (v && !/^#[0-9a-fA-F]{6}$/.test(v)) { setHexDraft(project.color || ''); return; }
                      const next = v || null;
                      if ((project.color || null) === next) return;
                      await saveProject({ color: next });
                    }}
                  >
                    <HexInput
                      type="text"
                      maxLength={7}
                      placeholder="#RRGGBB"
                      value={hexDraft}
                      onChange={e => setHexDraft(e.target.value)}
                    />
                  </AutoSaveField>
                </HexRow>
              </EditField>
              <EditField style={{ gridColumn: '1 / -1' }}>
                <EditLabel>{t('edit.description', '설명')}</EditLabel>
                <ProjectDescriptionEditor
                  projectId={projectId}
                  initial={project.description || ''}
                  onSave={async (v) => {
                    const r = await apiFetch(`/api/projects/${projectId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ description: v || null }) });
                    if (!r.ok) throw new Error(`save failed: ${r.status}`);  // 실패 시 저장됨 표시 금지(saveProject 패턴)
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
                      <ActionAutoSave
                        type="input"
                        style={{ flex: '0 0 120px' }}   /* MemberRow 는 flex — 래퍼가 폭을 먹지 않게 입력칸 폭을 그대로 물려준다 */
                        save={async patch => { await updateMemberRole(m.user_id, String(patch.role)); }}
                      >
                        {fire => (
                          <MemberRoleInput defaultValue={m.role || t('edit.roleDefault', '팀원')} placeholder={t('edit.rolePlaceholder', '역할') as string}
                            disabled={isOwner}
                            onBlur={e => { const v = e.target.value.trim(); if (v && v !== m.role) fire({ role: v }); }}
                            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
                        )}
                      </ActionAutoSave>
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
                        {b.user?.display_name || b.user?.name || `user ${b.user_id}`}
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
        </InfoBody>
      )}

      {/* #136 — 정보성(이슈·메모·이력·참여고객)과 설정성(기본정보 편집·멤버·채팅 연결)을 탭으로 분리.
          한 화면에 섞여 있어 정보를 보러 왔는데 편집폼이 먼저 나오는 혼란이 있었다. */}
      {tab === 'details' && (
        <InfoBody>

          {/* #167 — 편집은 상세정보 탭 한 곳(단일 원천). 개요와 같은 캔버스를 여기서 편집(개요는 읽기전용). */}
          <div style={{ gridColumn: '1 / -1' }}>
            <ProjectCanvas projectId={projectId} businessId={project.business_id} />
          </div>

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
                onKeyDown={onEnterSubmit(submitIssue)} />
              <AddBtn type="button" onClick={submitIssue} disabled={!newIssue.trim() || submitting}>
                {t('common.add', '추가')}
              </AddBtn>
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
                onKeyDown={onEnterSubmit(submitNote)} />
              <AddBtn type="button" onClick={submitNote} disabled={!newNote.trim() || submitting}>
                {t('common.add', '추가')}
              </AddBtn>
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
          businessId={project.business_id}
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
      </Suspense>

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
const PinnedDocBody: React.FC<{ postId: number; businessId: number; onEdit: (id: number) => void }> = ({ postId, businessId, onEdit }) => {
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
      {detail.kind === 'table' ? (
        detail.q_record_id ? (
          <PostTableGrid recordId={detail.q_record_id} businessId={businessId} readOnly />
        ) : (
          <PinnedDocInfo>
            <div>{t('pinnedDoc.tableHint', '표 문서는 여기서 미리보기를 지원하지 않아요.')}</div>
            <PinnedDocBtn type="button" onClick={() => onEdit(postId)}>
              {t('pinnedDoc.openInDocs', '문서 탭에서 열기')}
            </PinnedDocBtn>
          </PinnedDocInfo>
        )
      ) : (
        <PostEditor value={detail.content_json} onChange={() => {}} editable={false} />
      )}
    </PinnedDocCard>
  );
};

