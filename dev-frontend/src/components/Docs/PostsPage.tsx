// 문서(포스팅) 공용 페이지 — 워크스페이스·프로젝트 공용
// 레이아웃 패턴: Q Note 와 동일 (Sidebar + Content 2컬럼 + PanelHeader)
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVisibilityRefresh } from '../../hooks/useVisibilityRefresh';
import { joinRoom, leaveRoom, onSocket } from '../../services/socket';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import HelpDot from '../Common/HelpDot';
import AiActionButton from '../Common/AiActionButton';
import SlotFormModal from './SlotFormModal';
import { displayName } from '../../utils/displayName';
import i18n from '../../i18n';
import { useSearchParams } from 'react-router-dom';
import { useTabTitle } from '../../hooks/useTabTitle';
import { useTimeFormat } from '../../hooks/useTimeFormat';
import SearchBox from '../Common/SearchBox';
import PanelHeader, { PanelTitle, PanelSubTitle } from '../Layout/PanelHeader';
import AttachmentField from '../Common/AttachmentField';
import CategoryCombobox from '../Common/CategoryCombobox';
import EmptyState from '../Common/EmptyState';
import { uploadMyFile, uploadProjectFile } from '../../services/files';
import ConfirmDialog from '../Common/ConfirmDialog';
import PostEditor from './PostEditor';
import DocToc from './DocToc';
import PostTableGrid from './PostTableGrid';
import { mapApiError } from '../../utils/apiError';
import { generateHTML } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import {
  fetchPosts, fetchPost, createPost, updatePost, deletePost, StaleEditError,
  attachToPost, detachFromPost, fetchPostsMeta,
  createCategory, updatePostVisibility, updatePostSecurityLevel, downloadPostPdf,
  downloadPostDocx,
  type PostRow, type PostDetail, type PostsMeta,
} from '../../services/posts';
import VisibilityChangeModal from '../Common/VisibilityChangeModal';
import { listProjects, listWorkspaceClients, type ApiProject, type WorkspaceClientRow } from '../../services/qtalk';
import { listTemplates, aiGenerateDoc, type DocTemplate, type DocKind, KIND_LABELS_KO } from '../../services/docs';
import AiRegenerateBar from '../Common/AiRegenerateBar';
import KindIcon from './KindIcon';
import PostShareModal from './PostShareModal';
import PostAiModal from './PostAiModal';
// 프로젝트 문서 탭 — 파일 탭과 동일한 공용 레이아웃 (단일 원천). 파일탭·문서탭 디자인 통일.
import { Split as AtSplit, FolderTreePanel as AtPanel, FilesArea as AtArea, TreeRoot as AtTree, FolderRow as AtRow, FolderName as AtName, FolderCount as AtCount, Grid as AtGrid, Card as AtCard, CardName as AtCardName, CardMeta as AtCardMeta, Toolbar as AtToolbar, SortWrap as AtSortWrap } from './assetTabLayout';
import PostSignatureModal from './PostSignatureModal';
import SignatureProgressSection from './SignatureProgressSection';
import PlanQSelect, { type PlanQSelectOption } from '../Common/PlanQSelect';
import SecurityLevelBadge, { useSecurityLevelLabel } from '../Common/SecurityLevelBadge';
import { useAuth, apiFetch } from '../../contexts/AuthContext';
import FloatingPanelToggle from '../Common/FloatingPanelToggle';
import PanelResizeHandle, { usePanelWidth } from '../Layout/PanelResizeHandle';
import { usePostPresence } from '../../hooks/usePostPresence';
import PostHistoryPanel from './PostHistoryPanel';

// 좌측 필터: 전체(기본) / 프로젝트 그룹 / 카테고리
// '내 문서'·'기본' 섹션은 제거. 상단 통합검색이 프로젝트명·제목·본문·카테고리를 모두 커버.
type FilterSel =
  | { kind: 'all' }
  | { kind: 'project'; projectId: number }
  | { kind: 'category'; name: string };

export type PostsScope =
  | { type: 'workspace'; businessId: number }
  | { type: 'project'; businessId: number; projectId: number }
  | { type: 'personal'; businessId: number };  // N+30 — 개인 보관함 (본인 + vlevel=L1 + project_id=null)

interface Props {
  scope: PostsScope;
}

// 제목·카테고리에서 종류 추정 — 후속 액션 결정용
function inferKindFromTitle(title: string, category: string | null): 'contract' | 'nda' | 'sow' | 'proposal' | 'quote' | 'other' {
  const t = ((title || '') + ' ' + (category || '')).toLowerCase();
  if (/계약|contract/.test(t)) return 'contract';
  if (/nda|기밀|비밀유지/.test(t)) return 'nda';
  if (/sow|작업|명세/.test(t)) return 'sow';
  if (/제안|proposal/.test(t)) return 'proposal';
  if (/견적|quote|quotation/.test(t)) return 'quote';
  return 'other';
}

const PostsPage: React.FC<Props> = ({ scope }) => {
  const { t } = useTranslation('qdocs');
  const { t: tErr } = useTranslation('errors');
  const { formatDate } = useTimeFormat();

  const [rows, setRows] = useState<PostRow[]>([]);
  const [meta, setMeta] = useState<PostsMeta>({ total: 0, myCount: 0, categories: [], projects: [] });
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();
  const [filter, setFilter] = useState<FilterSel>(() => {
    // 워크스페이스 scope 진입 시 ?project=:id 쿼리 → 그 프로젝트 필터 자동 선택
    if (scope.type === 'workspace') {
      const pid = Number(searchParams.get('project'));
      if (Number.isFinite(pid) && pid > 0) return { kind: 'project', projectId: pid };
    }
    return { kind: 'all' };
  });
  const [activeId, setActiveId] = useState<number | null>(() => {
    const v = Number(searchParams.get('post'));
    return Number.isFinite(v) && v > 0 ? v : null;
  });

  // N+42 — Q Note 정리하기 → 정식 문서 승격 (?prefill_brief=text 으로 진입). 마운트 시 한 번만.
  useEffect(() => {
    if (briefPrefillAppliedRef.current) return;
    const text = searchParams.get('prefill_brief');
    const title = searchParams.get('prefill_brief_title');
    if (!text && !title) return;
    setAiInitialBriefText(text || '');
    setAiInitialBriefTitle((title || '').slice(0, 200));
    setAiDefaultMode('brief');
    setAiIntent('ai');
    setAiOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete('prefill_brief');
    next.delete('prefill_brief_title');
    setSearchParams(next, { replace: true });
    briefPrefillAppliedRef.current = true;
  }, [searchParams, setSearchParams]);
  // URL 싱크는 별도 effect 로 분리 — setActiveId 호출 흐름에 부수효과 안 만들도록.
  useEffect(() => {
    setSearchParams(prev => {
      const sp = new URLSearchParams(prev);
      const cur = sp.get('post');
      const next = activeId ? String(activeId) : null;
      if (cur === next) return prev; // 변화 없으면 스킵 (re-render 방지)
      if (next) sp.set('post', next); else sp.delete('post');
      return sp;
    }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);
  // URL(?post) → activeId 역방향 동기화. 탭 전환 등으로 외부에서 ?post 가 제거/변경되면 활성 문서도 따라감.
  //   (옛: 최초 1회만 읽어서, 문서 탭 클릭으로 ?post 지워도 상세에 남던 버그)
  useEffect(() => {
    const v = Number(searchParams.get('post'));
    const urlId = Number.isFinite(v) && v > 0 ? v : null;
    setActiveId(prev => (prev === urlId ? prev : urlId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);
  const [detail, setDetail] = useState<PostDetail | null>(null);
  // 탭 이름 = 열려 있는 문서 이름 (목록만 보는 중이면 null → 'Q docs' 로 복귀).
  //   ★ 워크스페이스 scope 일 때만 — 이 컴포넌트는 프로젝트 상세(DocsTab)·개인 보관함 안에도
  //     임베드된다. 거기서도 제목을 쓰면 그 화면의 주인(프로젝트명)을 덮어써 지운다.
  useTabTitle(detail?.title, scope.type === 'workspace');
  // N+67 — visibility 변경 모달 + fetch context
  const [visModalOpen, setVisModalOpen] = useState(false);
  const [visProjects, setVisProjects] = useState<ApiProject[]>([]);
  const [visClients, setVisClients] = useState<WorkspaceClientRow[]>([]);
  const [visMembers, setVisMembers] = useState<Array<{ user_id: number; name: string; role: string }>>([]);
  // N+72 fix — 페이지 mount 시 즉시 fetch (detail null 이어도 OK).
  // 옛: deps=[detail?.business_id] 였는데 modal 열 시점에 visMembers=[] 회귀 (사용자 호소 "멤버 리스트에 안뜨던데").
  const visBizId = scope.type === 'project' ? scope.businessId : (scope.type === 'workspace' || scope.type === 'personal' ? scope.businessId : null);
  useEffect(() => {
    if (!visBizId) return;
    listProjects(visBizId).then(setVisProjects).catch(() => {});
    listWorkspaceClients(visBizId).then(c => setVisClients(c.filter(x => x.status !== 'archived'))).catch(() => {});
    apiFetch(`/api/businesses/${visBizId}/members`).then(r => r.json()).then(j => {
      if (j?.success && Array.isArray(j.data)) {
        setVisMembers(j.data
          .filter((m: { user?: { is_ai?: boolean }; role?: string }) => !m.user?.is_ai && m.role !== 'ai')
          .map((m: { user_id?: number; id?: number; user?: { id?: number; name?: string; display_name?: string | null }; name?: string; role?: string }) => ({
            user_id: m.user_id || m.id || m.user?.id || 0,
            // 워크스페이스 표시명(user.display_name) 우선 — 계정명 노출 방지 [[feedback_member_display_name_on_lists]]
            name: m.user?.display_name || m.name || m.user?.name || '—',
            role: m.role || 'member',
          })).filter((m: { user_id: number }) => m.user_id > 0));
      }
    }).catch(() => {});
  }, [visBizId]);
  const visLabel = (vl: string | null | undefined) => {
    if (vl === 'L1') return t('vis.L1', '나만') as string;
    if (vl === 'L2') return t('vis.L2', '팀') as string;
    if (vl === 'L4') return t('vis.L4', '외부') as string;
    return t('vis.L3', '워크스페이스') as string;
  };
  const secLabel = useSecurityLevelLabel();  // D4 #62 보안등급 라벨
  const [mode, setMode] = useState<'view' | 'edit' | 'new'>('view');
  const [titleDraft, setTitleDraft] = useState('');
  const [contentDraft, setContentDraft] = useState<unknown>(null);
  const [categoryDraft, setCategoryDraft] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PostDetail | null>(null);
  const [newCatOpen, setNewCatOpen] = useState(false);
  const [newCatDraft, setNewCatDraft] = useState('');
  // 신규 모드(Post.id 미존재) 에서 첨부 예약용 — 저장 직후 attach 일괄 처리
  const [pendingUploads, setPendingUploads] = useState<File[]>([]);
  const [pendingExistingIds, setPendingExistingIds] = useState<number[]>([]);
  const [, setPendingExistingMeta] = useState<Record<number, { name: string; size: number }>>({});
  // 본문 하단 "관련 문서" 연결 — 다른 post(문서/표) 참조. 단방향 (저장 시 PUT linked_post_ids).
  const [pendingPostIds, setPendingPostIds] = useState<number[]>([]);
  // 표(table) 편집 모드의 본문 설명 에디터 collapsible — 빈 상태 신규일 때 닫혀 시작, 내용 있으면 열린 상태.
  const [tableDescOpen, setTableDescOpen] = useState<boolean>(false);
  const submittingRef = useRef(false);
  /** 명시 저장 재시도 1회 가드 (내가 낸 충돌만) */
  const saveRetriedRef = useRef(false);
  // ── #252 자동저장 ("문서에 글 쓸 때도 메모처럼 임시저장되면 안되나? 날라갈까봐 불안한데") ──
  //   메모(MemoView)와 같은 모델: 입력 → debounce → PUT. 성공은 ✓ 뱃지만(토스트 금지, CLAUDE.md).
  //   신규 글은 첫 입력에 draft 로 POST 해 id 를 확보한 뒤 PUT 으로 이어간다 —
  //   서버가 draft 를 L1 로 강제하고 broadcast·감사·stage 를 막으므로 남에게 새지 않는다.
  const [autoState, setAutoState] = useState<'idle' | 'saving' | 'saved' | 'error' | 'stale'>('idle');
  const [autoErr, setAutoErr] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  // leaveEditSession 이 최신 값을 보게 하는 ref (useCallback 클로저에 갇히지 않게).
  const detailRef = useRef<PostDetail | null>(null);
  const persistAttachmentsRef = useRef<((id: number) => Promise<{ changed: boolean; hasFailure: boolean }>) | null>(null);
  // ★ 2026-08-24 — 자동저장이 실패/충돌이면 leaveEditSession() 이 false 를 돌려 **이동을 막는다**.
  //   그 자체는 옳다(저장 안 된 글을 잃지 않는다). 문제는 **아무 말도 안 한다**는 것이었다 —
  //   문서를 클릭해도, 새 문서를 눌러도 반응이 없어 화면이 먹통으로 보인다(작은 배지에만 사유가 있다).
  //   막힌 순간을 명시적으로 알린다.
  const [leaveBlocked, setLeaveBlocked] = useState(false);
  const autoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoDirtyRef = useRef(false);
  const autoBusyRef = useRef(false);
  // 편집 시작 시점의 updated_at — 낙관적 잠금 기준. 저장 성공마다 갱신한다.
  const baseUpdatedAtRef = useRef<string | null>(null);
  /** 자동저장 재시도 1회 가드 — 내가 낸 충돌만, 무한 재시도 금지 */
  const autoRetriedRef = useRef(false);
  // 자동저장이 만든 draft 의 id (신규 모드). 명시 저장·취소가 이걸 보고 승격/삭제한다.
  const autoDraftIdRef = useRef<number | null>(null);
  // 편집 진입 시점 스냅샷 — "취소" 가 자동저장된 내용을 되돌리는 근거.
  const editSnapshotRef = useRef<{ title: string; content: unknown; category: string } | null>(null);
  // ★ 자동저장 발화 기준은 "마지막으로 서버에 쓴 값" 이어야 한다 (편집 진입 스냅샷이 아니라).
  //   진입 스냅샷만 보면, 한 글자만 고쳐도 그 뒤로 **영원히 changed=true** 라
  //   저장이 끝나 autoState 가 바뀔 때마다 effect 가 다시 2초 타이머를 걸어 **자동저장이 자기를 재예약**한다.
  //   → 타이핑을 멈춰도 2초마다 PUT 이 계속 나간다(운영 신고: "갑자기 갑자기 저장이 돼").
  //   진입 스냅샷은 '취소' 되돌림 기준이라 건드리면 안 되므로 **기준을 둘로 분리**한다.
  const lastSavedRef = useRef<{ title: string; content: unknown; category: string } | null>(null);
  // ★ 편집 세션 카운터. 스냅샷 effect 를 `detail?.id` 에 걸면, 첫 자동저장의 setDetail(created) 가
  //   그 effect 를 재발화시켜 autoDraftIdRef·autoState 를 리셋한다 — 그러면 명시 저장이 승격 대신
  //   글을 하나 더 만들고, 취소는 draft 를 못 지운다(Fable 실측 BLOCKER). 진입 지점만 이 값을 올린다.
  const [editEpoch, setEditEpoch] = useState(0);
  const beginEditSession = useCallback(() => setEditEpoch((n) => n + 1), []);
  useEffect(() => { detailRef.current = detail; }, [detail]);
  const [shareOpen, setShareOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  // 운영 — Q docs AI 재생성: 생성 컨텍스트 보관 + 재생성 busy
  // 운영 #312 — instructions: "다시 만들기" 로 준 지시를 **누적** 보관한다. 매번 마지막 한 줄만
  //   보내면 앞서 시킨 것이 전부 풀려 결과가 처음으로 되돌아간다("히스토리 날리고").
  const [aiCtx, setAiCtx] = useState<{ kind: string; userInput: string; clientId?: number | null; projectId?: number | null; instructions?: string[] } | null>(null);
  const [regenBusy, setRegenBusy] = useState(false);
  const [aiIntent, setAiIntent] = useState<'manual' | 'ai'>('manual');
  // 사이클 N+22 — + 버튼 드롭다운 (빈 문서 즉시 / 표는 모달 default table) + 모달 default tab
  const [newDropdownOpen, setNewDropdownOpen] = useState(false);
  const [aiDefaultMode, setAiDefaultMode] = useState<'blank' | 'new' | 'brief' | 'table' | undefined>(undefined);
  // N+42 — Q Note 정리하기 → 정식 문서 승격 진입 prefill
  const [aiInitialBriefTitle, setAiInitialBriefTitle] = useState<string | undefined>(undefined);
  const [aiInitialBriefText, setAiInitialBriefText] = useState<string | undefined>(undefined);
  const briefPrefillAppliedRef = useRef(false);
  const [signOpen, setSignOpen] = useState(false);
  // 사이클 O3 — Q knowledge 로 보내기 (post → KbDocument import)
  const [knowledgeBusy, setKnowledgeBusy] = useState(false);
  const [knowledgeMsg, setKnowledgeMsg] = useState<string | null>(null);
  const [signReloadKey, setSignReloadKey] = useState(0);
  const [projectDraft, setProjectDraft] = useState<number | null>(null);
  // #336 — 방금 만든 표는 바로 편집 화면으로 열려야 한다.
  //   여태 URL 의 ?new_table=1 만 보고 판정했는데, setActiveId 와 setSearchParams 가
  //   **다른 커밋에 떨어지면** activeId effect 가 옛 searchParams 를 읽어 보기 모드로 연다.
  //   타이밍에 따라 되기도 하고 안 되기도 해서 "이상하다" 로 보였다. ref 로 확정 신호를 남긴다.
  const pendingNewTableRef = useRef<number | null>(null);
  const [projects, setProjects] = useState<ApiProject[]>([]);
  // 템플릿 모달 — 새 글 작성 시 시드 5종 중 선택해서 본문 prefill
  const [tplModalOpen, setTplModalOpen] = useState(false);
  const [templates, setTemplates] = useState<DocTemplate[]>([]);
  // 사이클 I2 — Phase F 슬롯 폼
  const [slotTplId, setSlotTplId] = useState<number | null>(null);
  const [tplSearch, setTplSearch] = useState('');
  const { user } = useAuth();
  // 지금 이 문서를 함께 편집 중인 사람들 (본인 제외하고 표시).
  const presenceUsers = usePostPresence(
    detail?.id ?? null,
    scope.businessId ?? null,
    user?.name || user?.username || '',
    mode === 'edit',
  );

  // N+30 — personal 도 scope.businessId 우선 사용 (multi-workspace 사용자 시 user.business_id fallback 잘못된 bizId 회귀 차단)
  const businessId = (scope.type === 'workspace' || scope.type === 'personal') ? scope.businessId : (user?.business_id ? Number(user.business_id) : null);
  // 템플릿 저장 모달 상태
  const [saveTplOpen, setSaveTplOpen] = useState(false);
  const [saveTplName, setSaveTplName] = useState('');
  const [saveTplDesc, setSaveTplDesc] = useState('');
  const [saveTplBusy, setSaveTplBusy] = useState(false);
  const [saveTplError, setSaveTplError] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [docxBusy, setDocxBusy] = useState(false);   // #225 — 워드 생성 중 중복 클릭 차단
  // 운영 #338 — 목차가 이동할 대상(렌더된 본문 컨테이너). 목차는 여기서 h1~h3 을 찾는다.
  const docBodyRef = useRef<HTMLDivElement>(null);

  // content_json → HTML 변환 (TipTap headless)
  const renderContentToHtml = useCallback((contentJson: unknown): string => {
    if (!contentJson) return '';
    try {
      return generateHTML(contentJson as Record<string, unknown>, [
        StarterKit, Link, Image, Table, TableRow, TableHeader, TableCell,
      ]);
    } catch { return ''; }
  }, []);

  const filteredTemplates = useMemo(() => {
    const q = tplSearch.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter(t =>
      (t.name || '').toLowerCase().includes(q) ||
      (t.description || '').toLowerCase().includes(q) ||
      (KIND_LABELS_KO[t.kind] || '').toLowerCase().includes(q)
    );
  }, [templates, tplSearch]);

  // 워크스페이스 모드: project_id 필터 없음(모든 문서), 프로젝트 모드: project_id=scope.projectId
  const scopeProjectId = scope.type === 'project' ? scope.projectId : undefined;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // N+30 — 개인 보관함 모드: 자체 fetch 함수 (본인 + L1 + project_id=null 자동)
      if (scope.type === 'personal') {
        const { fetchPersonalPosts } = await import('../../services/posts');
        const list = await fetchPersonalPosts(scope.businessId);
        // 클라이언트 측 query 필터 (backend 가 q 파라미터 안 받음)
        const filtered = query
          ? list.filter(p => (p.title || '').toLowerCase().includes(query.toLowerCase()))
          : list;
        setRows(filtered);
        return;
      }
      // 필터를 API 파라미터로 변환
      const apiFilter: { projectId?: number | null; query?: string; category?: string; mine?: boolean } = {
        query: query || undefined,
      };
      if (scope.type === 'project') apiFilter.projectId = scope.projectId;
      if (filter.kind === 'project') apiFilter.projectId = filter.projectId;
      else if (filter.kind === 'category') apiFilter.category = filter.name;

      const list = await fetchPosts(scope.businessId, apiFilter);
      setRows(list);
    } finally { setLoading(false); }
  }, [scope, query, filter]);

  const loadMeta = useCallback(async () => {
    const m = await fetchPostsMeta(scope.businessId, scopeProjectId);
    setMeta(m);
  }, [scope.businessId, scopeProjectId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadMeta(); }, [loadMeta]);

  // N+39 — PWA background → foreground 복귀 시 missed events 회복 (CLAUDE.md 운영 안정성 16번 (d))
  useVisibilityRefresh(useCallback(() => { void load(); void loadMeta(); }, [load, loadMeta]));

  // N+38 — 실시간 동기화 (CLAUDE.md 운영 안정성 16번 박제).
  // 다른 사용자가 문서 추가/수정/삭제 시 본인이 페이지 열고 있으면 즉시 보임.
  // backend posts.js 가 'business:${bizId}' room 으로 broadcast — 공유 소켓(services/socket)
  // 에 joinRoom + listener 만 추가.
  useEffect(() => {
    if (!scope.businessId) return;
    let pending: number | null = null;
    const debouncedReload = () => {
      if (pending) return;
      pending = window.setTimeout(() => { pending = null; void load(); void loadMeta(); }, 250);
    };
    // N+72 fix — 열린 detail 도 갱신 (저장 직후 실시간 반영 안 됨 호소)
    const refetchOpenDetail = async (postId: number) => {
      try {
        if (activeId !== postId) return;
        // #252 MAJOR-1 — 편집 중이면 남의 저장으로 내 에디터를 갈아끼우지 않는다.
        //   setDetail 은 스냅샷·base_updated_at 기준까지 흔들어 타이핑 중 글을 날린다.
        //   충돌은 낙관적 잠금이 409(stale 배지)로 알려준다 — 조용히 덮는 대신 사용자가 판단한다.
        if (modeRef.current === 'edit' || modeRef.current === 'new') return;
        const d = await fetchPost(postId);
        setDetail(d);
      } catch (_) { /* skip */ }
    };
    // 페이지 mount 시 공유 소켓 (services/socket) business room join + listener 3종.
    //   §10-D: 옛 window.__planq_postsSocket 전역 싱글턴 제거 (멀티탭에서 두 인스턴스가 서로
    //   소켓 참조를 덮어써 끊던 코드). 공유 소켓 + refCount 로 근본 해결.
    joinRoom(`business:${scope.businessId}`);
    const offNew = onSocket('post:new', debouncedReload);
    const offUpd = onSocket('post:updated', (payload: { id: number } | number) => {
      debouncedReload();
      const id = typeof payload === 'number' ? payload : payload?.id;
      if (id) void refetchOpenDetail(id);
    });
    const offDel = onSocket('post:deleted', debouncedReload);
    return () => {
      if (pending) window.clearTimeout(pending);
      leaveRoom(`business:${scope.businessId}`);
      offNew(); offUpd(); offDel();
    };
  }, [scope.businessId, load, loadMeta, activeId]);

  useEffect(() => {
    if (!activeId) {
      setDetail(null);
      // mode 는 강제 변경 안 함 — startNew()/cancelEdit() 가 명시적으로 책임짐.
      // 강제 변경하면 startNew → mode='new' 직후 이 effect 가 'view' 로 덮어써 에디터가 사라짐.
      return;
    }
    let cancelled = false;
    (async () => {
      const d = await fetchPost(activeId);
      if (!cancelled) {
        setDetail(d);
        // #96 — 방금 만든 표(?new_table=1)는 바로 편집 화면으로. 그 외는 view.
        const flaggedNewTable = pendingNewTableRef.current === activeId;
        const isNewTable = (flaggedNewTable || searchParams.get('new_table') === '1') && d?.kind === 'table';
        if (flaggedNewTable) pendingNewTableRef.current = null;   // 1회성 신호
        // #252 — 이것도 편집 진입이다. beginEditSession() 이 없으면 직전 편집의 스냅샷·
        //   draft ref 가 그대로 남아(mode 가 이미 'edit' 이면 effect 자체가 재발화하지 않는다)
        //   취소가 엉뚱한 글을 되돌리고 저장이 엉뚱한 draft 를 승격시킨다.
        if (isNewTable) beginEditSession();
        setMode(isNewTable ? 'edit' : 'view');
        if (isNewTable) {
          const np = new URLSearchParams(searchParams);
          np.delete('new_table');
          setSearchParams(np, { replace: true });
        }
        if (d) {
          setTitleDraft(d.title);
          setContentDraft(d.content_json);
          setCategoryDraft(d.category || '');
        }
      }
    })();
    return () => { cancelled = true; };
  }, [activeId]); // eslint-disable-line react-hooks/exhaustive-deps

  const startNew = async () => {
    // #252 — 이미 편집 중이었다면 그 세션부터 마무리(마지막 타이핑 flush + 고아 draft 차단)
    if (!(await leaveEditSession())) return;
    setActiveId(null);
    setDetail(null);
    setMode('new'); beginEditSession();
    setAiCtx(null);  // 운영 — 빈 새 문서는 AI 재생성 바 숨김
    setTitleDraft('');
    setContentDraft(null);
    // 현재 필터가 카테고리면 해당 카테고리로 프리필
    setCategoryDraft(filter.kind === 'category' ? filter.name : '');
    // 프로젝트 scope 면 자동 연결, 워크스페이스 scope + 필터=프로젝트면 그 프로젝트로
    setProjectDraft(scope.type === 'project' ? scope.projectId : (filter.kind === 'project' ? filter.projectId : null));
    setPendingUploads([]);
    setPendingExistingIds([]);
    setPendingExistingMeta({});
    setPendingPostIds([]);
    setError(null);
  };

  // 편집 폼 옵션용: 워크스페이스 프로젝트 목록 (편집/신규 진입 시점에만 fetch)
  useEffect(() => {
    const isEditing = mode === 'edit' || mode === 'new';
    if (!isEditing) return;
    let cancelled = false;
    listProjects(scope.businessId, 'active').then(list => { if (!cancelled) setProjects(list); }).catch(() => {});
    return () => { cancelled = true; };
  }, [mode, scope.businessId]);

  const projectOptions: PlanQSelectOption[] = useMemo(
    () => projects.map(p => ({ value: p.id, label: p.name })),
    [projects]
  );

  // 템플릿 모달 오픈 — 시스템 5종 + 사용자 본인 템플릿 모두 fetch
  const openTemplateModal = async () => {
    if (!businessId) return;
    setTplModalOpen(true);
    setTplSearch('');
    try {
      const list = await listTemplates(businessId);
      setTemplates(list);
    } catch { /* ignore */ }
  };

  // 클라이언트 사이드 mustache — business/today 만 치환 (Post 단계라 client/project 없음)
  const renderTemplateClient = (html: string): string => {
    const today = new Date().toISOString().slice(0, 10);
    const todayPlus30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const ctx: Record<string, string> = {
      'business.name': user?.business_name || '',
      'business.brand_name': user?.business_name || '',
      'party_a.name': user?.business_name || '',
      'issued_at': today,
      'effective_date': today,
      'valid_until': todayPlus30,
      'duration_months': '24',
      'title': '',
      'session.title': '',
      'session.created_at': today,
      'session.participants': '',
      'session.location': '',
      'session.brief': '',
    };
    return html.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, p) => ctx[p] ?? '');
  };

  const startFromAi = async ({ title, bodyHtml, aiContext }: { title: string; bodyHtml: string; aiContext?: { kind: string; userInput: string; clientId?: number | null; projectId?: number | null } }) => {
    if (!(await leaveEditSession())) return;
    setActiveId(null);
    setDetail(null);
    setMode('new'); beginEditSession();
    setTitleDraft(title);
    setContentDraft(bodyHtml as unknown);
    setCategoryDraft(filter.kind === 'category' ? filter.name : '');
    setPendingUploads([]);
    setPendingExistingIds([]);
    setPendingExistingMeta({});
    setPendingPostIds([]);
    // #310 — AI 모달에서 고른 프로젝트를 새 문서에 그대로 잇는다.
    //   여태 aiContext 에 projectId 가 담겨 오는데도 초안에 반영하지 않아,
    //   "AI 로 문서 만들 때 프로젝트 연결했는데 새 문서에 동기화가 안 된다" 는 신고가 났다.
    //   페이지가 프로젝트 스코프면 그 프로젝트가 우선(그 화면에서는 소속이 고정이다).
    setProjectDraft(scope.type === 'project' ? scope.projectId : (aiContext?.projectId ?? null));
    setAiCtx(aiContext || null);  // 운영 — 재생성용 컨텍스트
    setError(null);
    setAiOpen(false);
  };

  // 운영 — Q docs AI 재생성: 보관한 컨텍스트 + 지시로 본문 재생성 (제목 유지, 본문 교체)
  const regenerateDoc = async (instruction: string) => {
    if (!aiCtx || regenBusy) return;
    setRegenBusy(true); setError(null);
    // 운영 #312 — 재생성은 "다시 쓰기" 가 아니라 "고쳐 쓰기" 다.
    //   ① 지금 화면의 본문(사용자가 손으로 고친 것 포함)을 원본으로 넘기고
    //   ② 지금까지 준 지시를 전부 누적해 넘긴다.
    //   ★ 지시 누적은 **성공했을 때만** 확정한다 — 실패한 요청까지 쌓이면 다음 재생성이
    //     한 번도 반영된 적 없는 지시를 들고 간다.
    const nextInstructions = [...(aiCtx.instructions || []), ...(instruction ? [instruction] : [])];
    // contentDraft 는 사용자가 편집하는 순간 TipTap JSON 이 된다(AI 직후엔 HTML 문자열).
    //   둘 다 HTML 로 맞춰 보낸다 — 모델에게는 HTML 이 원본이다.
    const baseHtml = typeof contentDraft === 'string' ? contentDraft : renderContentToHtml(contentDraft);
    try {
      const r = await aiGenerateDoc({
        business_id: scope.businessId, kind: aiCtx.kind as DocKind, title: titleDraft.trim() || (t('ai.untitledDoc', { defaultValue: '문서' }) as string),
        user_input: aiCtx.userInput, client_id: aiCtx.clientId, project_id: aiCtx.projectId,
        base_html: baseHtml || undefined,
        instructions: nextInstructions.length ? nextInstructions : undefined,
      });
      setContentDraft(r.body_html as unknown);
      setAiCtx((prev) => (prev ? { ...prev, instructions: nextInstructions } : prev));
    } catch (e) {
      setError((e as Error).message || (t('ai.regenFailed', '재생성 실패. 잠시 후 다시 시도해 주세요.') as string));
    } finally { setRegenBusy(false); }
  };

  const startFromTemplate = async (tpl: DocTemplate) => {
    // 사이클 I2 — schema_json 슬롯이 있으면 SlotFormModal 먼저, 없으면 기존 흐름
    const sj = (tpl as unknown as { schema_json?: unknown }).schema_json;
    const hasSlots = Array.isArray(sj) && sj.length > 0;
    if (hasSlots && tpl.id) {
      setTplModalOpen(false);
      setSlotTplId(tpl.id);
      return;
    }
    if (!(await leaveEditSession())) return;
    setActiveId(null);
    setDetail(null);
    setMode('new'); beginEditSession();
    setTitleDraft(tpl.name);
    const html = tpl.body_template ? renderTemplateClient(tpl.body_template) : '';
    setContentDraft(html as unknown);
    setCategoryDraft(filter.kind === 'category' ? filter.name : KIND_LABELS_KO[tpl.kind] || '');
    setPendingUploads([]);
    setPendingExistingIds([]);
    setPendingExistingMeta({});
    setPendingPostIds([]);
    setError(null);
    setTplModalOpen(false);
  };

  // 슬롯 폼 완료 시 — 채워진 HTML 로 PostEditor 진입
  const handleSlotConfirm = async (rendered: { html: string; title: string }) => {
    if (!(await leaveEditSession())) return;
    setActiveId(null);
    setDetail(null);
    setMode('new'); beginEditSession();
    setTitleDraft(rendered.title);
    setContentDraft(rendered.html as unknown);
    setCategoryDraft(filter.kind === 'category' ? filter.name : '');
    setPendingUploads([]);
    setPendingExistingIds([]);
    setPendingExistingMeta({});
    setPendingPostIds([]);
    setError(null);
    setSlotTplId(null);
  };

  const startEdit = () => {
    if (!detail) return;
    setMode('edit'); beginEditSession();
    setAiCtx(null);  // 운영 — 기존 문서 편집은 AI 재생성 바 숨김
    setTitleDraft(detail.title);
    setContentDraft(detail.content_json);
    setCategoryDraft(detail.category || '');
    setProjectDraft(detail.project_id);
    setPendingPostIds(Array.isArray(detail.linked_post_ids) ? detail.linked_post_ids : []);
    // 표 본문 설명 — 기존 내용이 있으면 자동 펼침, 없으면 접어두기
    const hasContent = !!(detail.content_json && JSON.stringify(detail.content_json).length > 30);
    setTableDescOpen(hasContent);
    setError(null);
  };

  // 사이클 O3 — 포스트를 Q knowledge 로 보내기 (인덱싱 후 Cue 답변에 활용)
  // N+72-7 — 문서 ↔ 표 타입 변경 (편집 모드).
  //   표→문서: 빈 표면 자유, 컬럼/행 있으면 ConfirmDialog (force_kind_change=true)
  //   문서→표: 자유 (빈 q_record 자동 생성)
  const [pendingKindChange, setPendingKindChange] = useState<'doc' | 'table' | null>(null);

  const doKindChange = async (newKind: 'doc' | 'table', force = false) => {
    if (!detail || !businessId) return;
    try {
      const r = await apiFetch(`/api/posts/${detail.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: newKind, force_kind_change: force }),
      });
      const j = await r.json();
      if (j.success && j.data) {
        setDetail(j.data);
        setKnowledgeMsg(t('kind.changed', '{{kind}} 으로 변경됐습니다', { kind: newKind === 'table' ? '표' : '문서' }) as string);
        setTimeout(() => setKnowledgeMsg(null), 3000);
      } else {
        setKnowledgeMsg(t('kind.changeErr', '변경 실패: {{msg}}', { msg: j.message || 'error' }) as string);
        setTimeout(() => setKnowledgeMsg(null), 8000);
      }
    } catch (e) {
      setKnowledgeMsg(t('kind.changeErr', '변경 실패: {{msg}}', { msg: mapApiError(e, tErr) }) as string);
      setTimeout(() => setKnowledgeMsg(null), 8000);
    }
  };

  const changeKind = async (newKind: 'doc' | 'table') => {
    if (!detail || detail.kind === newKind) return;
    // 표→문서: q_record 가 비어있어도 backend 409 안 나옴 → 일단 force=false 로 시도, 409 면 confirm
    if (newKind === 'doc' && detail.kind === 'table' && detail.q_record_id) {
      // 우선 force=false 로 호출, 409 (table_has_data) 일 때만 confirm
      const r = await apiFetch(`/api/posts/${detail.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'doc', force_kind_change: false }),
      });
      if (r.status === 409) {
        setPendingKindChange('doc');  // ConfirmDialog 띄움
        return;
      }
      const j = await r.json();
      if (j.success && j.data) {
        setDetail(j.data);
        setKnowledgeMsg(t('kind.changed', '문서로 변경됐습니다') as string);
        setTimeout(() => setKnowledgeMsg(null), 3000);
      }
      return;
    }
    await doKindChange(newKind, false);
  };

  const sendToKnowledge = async (post: PostDetail) => {
    if (!businessId || knowledgeBusy) return;
    setKnowledgeBusy(true);
    setKnowledgeMsg(null);
    try {
      // 프로젝트 연결된 포스트면 project scope, 아니면 workspace
      const scope = post.project_id ? 'project' : 'workspace';
      const r = await apiFetch(`/api/businesses/${businessId}/kb/documents/import-from-post`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          post_id: post.id,
          category: 'manual',
          scope,
          project_id: post.project_id || undefined,
        }),
      });
      const j = await r.json();
      if (j.success) {
        setKnowledgeMsg(t('actions.sendToKnowledgeOk', 'Q knowledge 에 추가됐습니다 — 인덱싱 후 Cue 답변에 활용됩니다') as string);
      } else {
        setKnowledgeMsg(t('actions.sendToKnowledgeErr', '추가 실패: {{msg}}', { msg: j.message || 'error' }) as string);
      }
    } catch (e) {
      setKnowledgeMsg(t('actions.sendToKnowledgeErr', '추가 실패: {{msg}}', { msg: mapApiError(e, tErr) }) as string);
    } finally {
      setKnowledgeBusy(false);
      // 에러는 더 길게 (8초), 성공은 4초
      const isErr = (s: string | null) => s && (s.includes('실패') || s.includes('Failed') || s.includes('에러'));
      setTimeout(() => setKnowledgeMsg(null), isErr(knowledgeMsg) ? 8000 : 4000);
    }
  };

  // ── #252 편집 진입 스냅샷 ──────────────────────────────────────────
  // 편집/신규 진입 지점이 5곳(빈 문서·AI·템플릿·슬롯·기존 편집)이라 각각에 손대는 대신
  //   mode 전환 한 곳에서 잡는다. 스냅샷은 두 가지 역할을 한다:
  //     ① 자동저장 발화 기준 — 진입 시 세팅된 초안(템플릿·AI 시드)은 "변경" 이 아니다.
  //        이게 없으면 템플릿만 열고 닫아도 빈 draft 가 쌓인다.
  //     ② "취소" 의 되돌림 기준 — 자동저장이 이미 서버에 썼으므로, 취소는 이 값으로
  //        되돌리는 명시 PUT 이어야 한다(안 그러면 취소해도 남는다).
  useEffect(() => {
    if (mode === 'edit' || mode === 'new') {
      editSnapshotRef.current = { title: titleDraft, content: contentDraft, category: categoryDraft };
      lastSavedRef.current = null;
      baseUpdatedAtRef.current = detail?.updated_at ?? null;
      autoDraftIdRef.current = mode === 'new' ? null : (detail?.id ?? null);
      autoDirtyRef.current = false;
      setAutoState('idle');
      setAutoErr(null);
    } else {
      editSnapshotRef.current = null;
      lastSavedRef.current = null;
      autoDirtyRef.current = false;
    }
    // ★ deps 에 detail?.id 를 넣지 않는다 — 자동저장이 detail 을 갱신하면 세션이 리셋된다.
    //   진입 지점이 beginEditSession() 으로 editEpoch 를 올릴 때만 재초기화한다.
  }, [mode, editEpoch]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 충돌(stale) 빠져나오기 ────────────────────────────────────────
  //   "저장은 누가 해?"(Irene) — 둘이 같이 고치면 **나중에 저장한 사람 내용이 남는다**.
  //   문제는 여태 뒤늦은 사람이 뱃지 하나만 보고 저장도 이동도 못 하는 막다른 길에 갇혔다는 것.
  //   두 갈래를 명시적으로 준다: 남의 최신본으로 갈아타거나, 내 내용으로 덮어쓰거나.
  const resolveStaleReload = useCallback(async () => {
    if (!detail?.id) return;
    const latest = await fetchPost(detail.id);
    if (!latest) return;
    setDetail(latest);
    setTitleDraft(latest.title);
    setContentDraft(latest.content_json);
    setCategoryDraft(latest.category || '');
    baseUpdatedAtRef.current = latest.updated_at ?? null;
    lastSavedRef.current = { title: latest.title, content: latest.content_json, category: latest.category || '' };
    autoDirtyRef.current = false;
    setAutoErr(null);
    setAutoState('idle');
    setLeaveBlocked(false);
  }, [detail?.id]);

  const resolveStaleOverwrite = useCallback(async () => {
    if (!detail?.id) return;
    const latest = await fetchPost(detail.id);
    // 최신 기준점을 잡고 내 내용을 그 위에 쓴다 — 명시적인 last-writer-wins.
    baseUpdatedAtRef.current = latest?.updated_at ?? baseUpdatedAtRef.current;
    setAutoState('idle');
    setAutoErr(null);
    setLeaveBlocked(false);
    autoDirtyRef.current = true;
    await runAutosaveRef.current?.();
  }, [detail?.id]);

  // ── #252 자동저장 엔진 ────────────────────────────────────────────
  // debounce 2초 (AutoSaveField 표준. 메모는 1초지만 문서는 본문이 길어 PUT 이 무겁다).
  const AUTOSAVE_DEBOUNCE_MS = 2000;

  // 반환값은 "이탈 flush"(leaveEditSession) 가 성공/실패를 판정하는 근거다 —
  //   실패했는데 화면을 넘겨버리면 사용자는 저장된 줄 알고 글을 잃는다.
  const runAutosave = useCallback(async (): Promise<'ok' | 'skip' | 'error' | 'stale'> => {
    if (autoBusyRef.current) return 'skip';
    // 제목이 비면 서버가 400 을 준다 — 아직 저장할 단계가 아니다(조용히 대기).
    if (!titleDraft.trim()) return 'skip';
    autoBusyRef.current = true;
    setAutoState('saving');
    // 이 저장이 실제로 보낸 값 — 성공 후 자동저장 발화 기준(lastSavedRef)이 된다.
    //   await 도중 사용자가 더 타이핑하면 draft 가 바뀌므로 **호출 시점 값**으로 고정해야 한다
    //   (안 그러면 방금 친 글자가 "이미 저장됨" 으로 처리돼 마지막 타이핑이 유실된다).
    const sentSnapshot = { title: titleDraft, content: contentDraft, category: categoryDraft };
    try {
      const categoryVal = categoryDraft.trim() || null;
      const targetId = detail?.id ?? autoDraftIdRef.current;
      if (!targetId) {
        // 신규 — 임시저장으로 만들고 id 를 붙든다. 이후 입력은 전부 PUT.
        const created = await createPost({
          business_id: scope.businessId,
          project_id: scope.type === 'project' ? scope.projectId : projectDraft,
          title: titleDraft.trim(),
          content_json: contentDraft as never,
          category: categoryVal,
          status: 'draft',
        });
        autoDraftIdRef.current = created.id;
        baseUpdatedAtRef.current = created.updated_at ?? null;
        setDetail(created);
      } else {
        const patched = await updatePost(targetId, {
          title: titleDraft.trim(),
          content_json: contentDraft as never,
          category: categoryVal,
          base_updated_at: baseUpdatedAtRef.current,
          autosave: true,
        });
        baseUpdatedAtRef.current = patched.updated_at ?? null;
        // detail 전체를 갈아끼우면 편집 중인 draft 가 서버 값으로 튕긴다 — 메타만 반영.
        setDetail((prev) => (prev ? { ...prev, updated_at: patched.updated_at } : patched));
      }
      autoDirtyRef.current = false;
      lastSavedRef.current = sentSnapshot;   // ★ 이게 없으면 자동저장이 2초마다 자기를 재예약한다
      setAutoState('saved');
      setAutoErr(null);
      return 'ok';
    } catch (e) {
      if (e instanceof StaleEditError) {
        // ★ **내 저장으로 서버가 앞서 나간 것이면 충돌이 아니다** — 기준만 갱신하고 한 번 재시도한다.
        //   혼자 쓰는데도 "다른 사람이 수정했습니다" 가 뜨던 것의 정체가 이것이다(운영 신고 2026-08-20).
        //   재시도는 1회만 — 진짜 충돌이면 두 번째에 다시 409 가 나고 그때는 배너로 알린다.
        if (e.byMe && e.currentUpdatedAt && !autoRetriedRef.current) {
          autoRetriedRef.current = true;
          baseUpdatedAtRef.current = e.currentUpdatedAt;
          const again = (await runAutosaveRef.current?.()) ?? 'stale';
          autoRetriedRef.current = false;
          return again;
        }
        // 남의 저장을 덮지 않는다 — 자동저장을 멈추고 사용자에게 알린다.
        setAutoState('stale');
        setAutoErr(e.message || (t('autosave.staleHelp', '다른 사람이 이 문서를 수정했습니다. 새로고침 후 이어서 작성해 주세요.') as string));
        return 'stale';
      }
      // 서명 잠금 — 재시도해도 영영 안 된다. 자동저장을 멈추고 사실과 다음 행동을 알린다.
      if ((e as { code?: string })?.code === 'post_locked_by_signature') {
        setAutoState('stale');   // 자동저장 정지 상태(재시도 안 함)
        setAutoErr((e as Error).message || (t('autosave.signatureLocked', '서명 요청이 진행 중이거나 완료된 문서라 수정할 수 없습니다. 서명 요청을 취소하거나 새 버전 문서로 작성해 주세요.') as string));
        return 'stale';
      }
      setAutoState('error');
      setAutoErr((e as Error).message || (t('autosave.failed', '임시저장 실패') as string));
      return 'error';
    } finally {
      autoBusyRef.current = false;
    }
  }, [titleDraft, contentDraft, categoryDraft, detail?.id, projectDraft, scope, t]);

  // ── #252 BLOCKER-3c — "저장도 취소도 아닌 이탈" 마무리 ─────────────
  // 편집 중 다른 문서를 클릭하거나 새 문서를 시작하면 지금까지 쓴 글이 갈 곳을 잃는다.
  //   ① 대기 중인 debounce 를 즉시 flush 한다 — 마지막 2초 타이핑을 버리지 않는다.
  //   ② flush 가 실패(에러·충돌)하면 false 를 반환해 **이탈 자체를 막는다**.
  //      실패를 감춘 채 화면을 넘기면 사용자는 저장된 줄 알고 글을 잃는다(조용한 실패 금지).
  //   ③ 성공하면 세션 ref 를 끊는다. 남은 draft 는 삭제하지 않는다 — 사용자가 쓴 글이고,
  //      목록에 "임시저장" 뱃지로 보여 다시 열어 이어쓸 수 있다(3a·3b).
  // 렌더 중 대입은 concurrent 렌더에서 안전하지 않다 — commit 후 effect 로 동기화한다.
  //   (읽는 쪽이 전부 이벤트 핸들러라 effect 시점이면 충분하다)
  const runAutosaveRef = useRef(runAutosave);
  const modeRef = useRef(mode);
  const autoStateRef = useRef(autoState);
  useEffect(() => {
    runAutosaveRef.current = runAutosave;
    modeRef.current = mode;
    autoStateRef.current = autoState;
  });

  const leaveEditSession = useCallback(async (): Promise<boolean> => {
    if (modeRef.current !== 'edit' && modeRef.current !== 'new') return true;
    if (autoTimerRef.current) { clearTimeout(autoTimerRef.current); autoTimerRef.current = null; }
    if (autoDirtyRef.current && autoStateRef.current !== 'stale') {
      const r = await runAutosaveRef.current();
      if (r === 'error' || r === 'stale') { setLeaveBlocked(true); return false; }   // 편집 화면 유지 + 사유 노출
    }
    // ★ 저장 버튼 없이 쓰려면(CLAUDE.md 자동저장 원칙) "나가는 순간" 이 곧 저장이어야 한다.
    //   자동저장은 본문·제목만 쓴다 — **첨부는 명시 저장에서만 반영**되므로 여기서 같이 마무리한다.
    //   안 하면 버튼을 없앤 순간 첨부가 조용히 사라진다(Irene: "저장버튼 없이 자동저장", 2026-08-25).
    if (modeRef.current === 'edit' && detailRef.current?.id) {
      try {
        const res = await persistAttachmentsRef.current?.(detailRef.current.id);
        if (res?.changed) {
          const fresh = await fetchPost(detailRef.current.id);
          if (fresh) setDetail(fresh);
        }
      } catch { /* 첨부 반영 실패는 편집 이탈을 막지 않는다 — 본문은 이미 저장됐다 */ }
    }
    autoDirtyRef.current = false;
    autoDraftIdRef.current = null;
    editSnapshotRef.current = null;
    setLeaveBlocked(false);
    setAutoState('idle');
    setAutoErr(null);
    // 편집 모드를 명시적으로 닫는다 — 같은 행 재클릭(activeId=null) 처럼 activeId effect 가
    //   mode 를 건드리지 않는 경로에서도 세션이 남지 않게.
    setMode('view');
    await load();   // 이탈 직후 목록에 임시저장 행이 바로 보이게
    return true;
  }, [load]);

  // 목록/카드 클릭 진입점 — 편집 중이면 먼저 세션을 마무리한다(고아 draft·타이핑 유실 차단).
  //   재클릭 토글(CLAUDE.md UI 규칙)은 호출부에서 id === activeId ? null : id 로 넘긴다.
  const selectPost = useCallback(async (id: number | null) => {
    if (!(await leaveEditSession())) return;   // flush 실패 — 편집 화면 유지
    setActiveId(id);
  }, [leaveEditSession]);

  // 입력 변화 → debounce 예약. stale(충돌) 상태면 더 이상 쏘지 않는다.
  useEffect(() => {
    if (!(mode === 'edit' || mode === 'new')) return;
    if (autoState === 'stale') return;
    // 저장이 날아가는 중이면 예약하지 않는다 — 끝나면 기준(lastSavedRef)이 갱신되고,
    // 그 사이 사용자가 더 쳤으면 'saved' 로 바뀌는 순간 이 effect 가 다시 돌아 예약한다(유실 없음).
    if (autoState === 'saving') return;
    if (!editSnapshotRef.current) return;   // 편집 진입 스냅샷 전에는 발화 금지(초기 세팅이 dirty 로 잡히지 않게)
    // 마지막 저장분이 있으면 그것과 비교한다 — 없으면(아직 한 번도 저장 안 함) 진입 스냅샷과 비교.
    const snap = lastSavedRef.current || editSnapshotRef.current;
    const changed = titleDraft !== snap.title
      || JSON.stringify(contentDraft ?? null) !== JSON.stringify(snap.content ?? null)
      || categoryDraft !== snap.category;
    if (!changed && !autoDirtyRef.current) return;
    autoDirtyRef.current = true;
    if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
    autoTimerRef.current = setTimeout(() => { runAutosave(); }, AUTOSAVE_DEBOUNCE_MS);
    return () => { if (autoTimerRef.current) clearTimeout(autoTimerRef.current); };
  }, [titleDraft, contentDraft, categoryDraft, mode, autoState, runAutosave]);

  // 저장 대기 중 이탈 경고 + PWA 자동 reload 차단 (운영 안정성 2번 — body[data-form-dirty]).
  useEffect(() => {
    const editing = mode === 'edit' || mode === 'new';
    const dirty = editing && (autoDirtyRef.current || autoState === 'saving');
    if (dirty) document.body.dataset.formDirty = '1';
    else delete document.body.dataset.formDirty;
    // ★ 편집 화면이 열려 있는 동안은 저장이 끝났어도 자동 reload 를 막는다.
    //   formDirty 만으로는 **자동저장이 끝나는 순간** 플래그가 꺼져, 그 틈에 새 빌드가 감지되면
    //   글을 쓰는 중에 페이지가 새로고침돼 편집이 닫혔다(운영 신고 2026-08-21).
    if (editing) document.body.dataset.editingActive = '1';
    else delete document.body.dataset.editingActive;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!autoDirtyRef.current && autoState !== 'saving') return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      delete document.body.dataset.formDirty;
      delete document.body.dataset.editingActive;
    };
  }, [mode, autoState, titleDraft, contentDraft, categoryDraft]);

  // 취소 — ★ 자동저장이 이미 서버에 썼으므로 state 만 되돌리면 "취소했는데 남아있다" 가 된다.
  //   신규(자동 draft) 는 삭제하고, 기존 문서는 진입 스냅샷으로 되돌리는 명시 PUT 을 쏜다.
  const cancelEdit = async () => {
    if (autoTimerRef.current) clearTimeout(autoTimerRef.current);   // 대기 중인 자동저장 취소
    const snap = editSnapshotRef.current;
    if (mode === 'new') {
      const draftId = autoDraftIdRef.current;
      if (draftId) await deletePost(draftId);   // boolean 반환(throw 안 함) — 실패해도 화면은 닫는다
      autoDraftIdRef.current = null;
      setActiveId(null);
      setDetail(null);
      setMode('view');
      setTitleDraft('');
      setContentDraft(null);
      setCategoryDraft('');
      setProjectDraft(null);
      setPendingUploads([]);
      setPendingExistingIds([]);
      setPendingExistingMeta({});
      await load(); await loadMeta();
    } else if (detail) {
      // 자동저장이 한 번이라도 나갔으면 서버 값이 스냅샷과 다르다 → 되돌리기 PUT.
      if (autoState !== 'idle' && autoState !== 'stale' && snap) {
        try {
          const reverted = await updatePost(detail.id, {
            title: snap.title,
            content_json: snap.content as never,
            category: snap.category.trim() || null,
            base_updated_at: baseUpdatedAtRef.current,
          });
          baseUpdatedAtRef.current = reverted.updated_at ?? null;
          setDetail(reverted);
        } catch { /* 되돌리기 실패 — 아래에서 서버 최신본으로 재조회 */
          const fresh = await fetchPost(detail.id);
          if (fresh) { baseUpdatedAtRef.current = fresh.updated_at ?? null; setDetail(fresh); }
        }
        await load();
      }
      setMode('view');
      setTitleDraft(snap?.title ?? detail.title);
      setContentDraft(snap?.content ?? detail.content_json);
      setCategoryDraft(snap?.category ?? (detail.category || ''));
      setProjectDraft(detail.project_id);
    }
    setAutoState('idle');
    setAutoErr(null);
    autoDirtyRef.current = false;
    setError(null);
  };

  // 예약된 첨부(신규 업로드 + 기존 파일 선택)를 post 에 반영한다.
  //   신규 작성·편집 **양쪽이 같은 경로**를 쓴다 — 한쪽에만 있어서 편집 모드 첨부가 통째로 유실됐다(#365).
  //   업로드가 실패해도 **본문 저장은 되돌리지 않는다**. 파일 하나 때문에 쓴 글을 잃게 하지 않는다.
  const persistAttachments = async (postId: number): Promise<{ changed: boolean; hasFailure: boolean }> => {
    const fileIds: number[] = [...pendingExistingIds];
    const failedFiles: File[] = [];
    const failedLabels: string[] = [];
    for (const f of pendingUploads) {
      const result = scope.type === 'project'
        ? await uploadProjectFile(scope.businessId, scope.projectId, f)
        : await uploadMyFile(scope.businessId, f);
      if (result.success && result.file) {
        const fid = Number(result.file.id.replace(/^direct-/, ''));
        if (fid) fileIds.push(fid);
      } else {
        const reason = result.message === 'file_size_exceeded'
          ? t('attach.tooLarge', '용량 한도 초과')
          : t('attach.uploadFailed', '업로드 실패');
        failedFiles.push(f);
        failedLabels.push(`${f.name} (${reason})`);
      }
    }
    if (fileIds.length > 0) await attachToPost(postId, fileIds);
    // 성공분만 비우고 **실패분은 남긴다** — 사용자가 무엇이 안 올라갔는지 보고 다시 시도할 수 있게.
    setPendingUploads(failedFiles);
    setPendingExistingIds([]);
    setPendingExistingMeta({});
    if (failedLabels.length > 0) {
      setError(t('attach.someFailed', '문서는 저장했습니다. 다음 파일은 올리지 못했습니다: {{files}}', { files: failedLabels.join(', ') }) as string);
    }
    return { changed: fileIds.length > 0, hasFailure: failedLabels.length > 0 };
  };

  const submit = async () => {
    if (submittingRef.current) return;
    if (!titleDraft.trim()) { setError(t('validation.titleRequired', '제목을 입력하세요') as string); return; }
    submittingRef.current = true;
    if (autoTimerRef.current) clearTimeout(autoTimerRef.current);   // 대기 중 자동저장과 겹치지 않게
    setSaving(true); setError(null);
    // ★ #341 — 이미 **날아가고 있는** 자동저장이 있으면 끝날 때까지 기다린다.
    //   타이머만 끄면 in-flight 요청은 그대로 간다. 그 사이 저장을 누르면
    //   autoDraftIdRef 가 아직 null 이라 아래 분기가 createPost 로 빠져
    //   **임시저장본(자동) + 저장본(수동) 두 개**가 만들어진다.
    //   운영 신고: "임시저장 남고 저장이 따로 되는 경우가 자꾸 생긴다".
    //   무한 대기 방지로 상한을 둔다 — 넘어가면 아래 분기가 알아서 처리한다(멱등은 아니지만 멈추진 않는다).
    for (let waited = 0; autoBusyRef.current && waited < 8000; waited += 50) {
      await new Promise((r) => setTimeout(r, 50));
    }
    try {
      const categoryVal = categoryDraft.trim() || null;
      if (mode === 'new') {
        // 프로젝트 scope 는 자동 강제, 워크스페이스 scope 면 사용자 선택값
        const projectId = scope.type === 'project' ? scope.projectId : projectDraft;
        // 자동저장이 이미 draft 를 만들어 뒀으면 **새로 만들지 않고 승격**한다.
        //   여기서 또 createPost 하면 같은 글이 두 개 생긴다(draft 1 + 정식 1).
        //   status='published' 로 올라가는 이 PUT 에서 broadcast·감사·stage 가 비로소 발화한다.
        const created = autoDraftIdRef.current
          ? await updatePost(autoDraftIdRef.current, {
            title: titleDraft.trim(),
            content_json: contentDraft as any,
            category: categoryVal,
            status: 'published',
            // draft 는 L1 로 강제돼 있었다 — 정식 등록 시 기본 공개 범위로 승격.
            vlevel: projectId ? 'L2' : 'L3',
            base_updated_at: baseUpdatedAtRef.current,
          })
          : await createPost({
            business_id: scope.businessId,
            project_id: projectId,
            title: titleDraft.trim(),
            content_json: contentDraft as any,
            category: categoryVal,
          });
        // 예약된 첨부 처리 — 편집 모드와 **같은 경로**를 쓴다 (#365)
        const attachRes = await persistAttachments(created.id);
        const final = attachRes.changed ? ((await fetchPost(created.id)) || created) : created;
        setDetail(final);
        setActiveId(final.id);
        // 업로드 실패가 있으면 편집 화면에 머문다 — 보기 모드로 넘어가면 안내가 사라진다.
        setMode(attachRes.hasFailure ? 'edit' : 'view');
        await load(); await loadMeta();
      } else if (mode === 'edit' && detail) {
        // #252 BLOCKER-3b — 임시저장(draft) 을 다시 열어 편집한 뒤 저장하면 **정식 등록**이다.
        //   status 를 안 보내면 저장은 성공하는데 문서는 draft(L1) 로 남아 남에게 영영 안 보인다.
        //   사용자는 저장했다고 믿는다 — 신규 승격(위 분기)과 같은 규칙을 적용한다.
        const targetProjectId = scope.type === 'workspace' ? projectDraft : detail.project_id;
        const promote = detail.status === 'draft';
        const patched = await updatePost(detail.id, {
          title: titleDraft.trim(),
          content_json: contentDraft as any,
          category: categoryVal,
          linked_post_ids: pendingPostIds,
          base_updated_at: baseUpdatedAtRef.current,
          // 프로젝트 scope 페이지에선 project_id 변경 막기 (강제 유지)
          ...(scope.type === 'workspace' ? { project_id: projectDraft } : {}),
          ...(promote ? { status: 'published' as const, vlevel: (targetProjectId ? 'L2' : 'L3') as 'L2' | 'L3' } : {}),
        });
        // ★ 기준 시각 갱신 — 이게 없어서 저장 버튼을 누른 뒤 이어서 쓰면 **다음 자동저장이 반드시
        //   409** 였다(혼자 쓰는데도 "다른 사람이 수정했습니다"). 자동저장 경로에만 있던 갱신을 여기에도.
        baseUpdatedAtRef.current = patched.updated_at ?? null;
        // ★ #365 — 편집 모드에서는 첨부가 **한 번도 저장되지 않았다**.
        //   attachToPost 호출이 신규 작성 분기에만 있어서, 이미 저장된 문서에 파일을 올려도
        //   조용히 사라졌다("첨부한 영상이 보이지 않아요"). 영상 한정이 아니라 전 파일 공통이었다.
        const attachResEdit = await persistAttachments(patched.id);
        const finalEdit = attachResEdit.changed ? ((await fetchPost(patched.id)) || patched) : patched;
        setDetail(finalEdit);
        setMode(attachResEdit.hasFailure ? 'edit' : 'view');
        await load(); await loadMeta();
      }
      // 명시 저장이 끝났으면 자동저장 상태·draft 참조를 비운다.
      autoDraftIdRef.current = null;
      autoDirtyRef.current = false;
      setAutoState('idle');
      setAutoErr(null);
    } catch (e) {
      if (e instanceof StaleEditError) {
        // ★ 내 저장으로 서버가 앞서 나간 것이면 충돌이 아니다 — 기준만 갱신하고 한 번 더 저장한다.
        //   (자동저장과 같은 규칙. 여기서 막히면 사용자는 쓴 글을 저장할 방법이 없다.)
        if (e.byMe && e.currentUpdatedAt && !saveRetriedRef.current) {
          saveRetriedRef.current = true;
          baseUpdatedAtRef.current = e.currentUpdatedAt;
          submittingRef.current = false;
          try { await submit(); } finally { saveRetriedRef.current = false; }
          return;
        }
        // 충돌은 "저장 실패" 가 아니라 별도 안내 — 사용자가 새로고침해야 하는 상황이다.
        setAutoState('stale');
        setAutoErr(e.message || (t('autosave.staleHelp', '다른 사람이 이 문서를 수정했습니다. 새로고침 후 이어서 작성해 주세요.') as string));
      }
      setError((e as Error).message);
    }
    finally { submittingRef.current = false; setSaving(false); }
  };

  const onDelete = async () => {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    const ok = await deletePost(id);  // boolean 반환(throw 안 함) — false(403 등)면 삭제 반영 금지
    if (!ok) return;  // 실패 시 확인 모달 유지(거짓 삭제 방지)
    setDeleteTarget(null);
    setActiveId(null);
    setDetail(null);
    await load(); await loadMeta();
  };

  const detachOne = async (attId: number) => {
    if (!detail) return;
    const ok = await detachFromPost(detail.id, attId);  // boolean(throw 안 함)
    if (!ok) return;  // 실패 시 반영 금지(거짓 분리 방지)
    const reloaded = await fetchPost(detail.id);
    setDetail(reloaded);
  };

  const filtered = useMemo(() => rows, [rows]);

  const isEditing = mode === 'new' || (mode === 'edit' && !!detail);

  const COLLAPSE_KEY = `qdocs-sidebar-collapsed-${scope.businessId}`;
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; }
  });
  // 좌측 리스트 폭 — 드래그로 조절 (다른 화면과 같은 방식)
  const { width: listWidth, startResize: startListResize } = usePanelWidth('qdocs_list_width', 300, 'left');

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed(prev => {
      const next = !prev;
      try { localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0'); } catch { /* noop */ }
      return next;
    });
  }, [COLLAPSE_KEY]);

  // ── 프로젝트 스코프 풀레이아웃 + 상단 메뉴 고정(pin) ──
  //   프로젝트 탭은 다른 탭처럼 단일 풀폭 레이아웃. 문서를 "상단 메뉴에 추가"하면 프로젝트 탭바에
  //   doc-탭으로 등장(QProjectDetailPage 가 localStorage 를 읽어 렌더). 옛 ProjectPostsTab 기능 복원.
  const isProject = scope.type === 'project';
  const projId = scope.type === 'project' ? scope.projectId : null;
  const [projSort, setProjSort] = useState<'recent' | 'name'>('recent');
  const PIN_KEY = projId ? `qproject_pinned_docs_${projId}` : null;
  const [pinnedIds, setPinnedIds] = useState<number[]>(() => {
    if (!PIN_KEY) return [];
    try { const r = JSON.parse(localStorage.getItem(PIN_KEY) || '[]'); return Array.isArray(r) ? r.filter((x) => typeof x === 'number') : []; } catch { return []; }
  });
  const togglePin = useCallback((id: number) => {
    if (!PIN_KEY) return;
    setPinnedIds(prev => {
      const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
      try {
        localStorage.setItem(PIN_KEY, JSON.stringify(next));
        window.dispatchEvent(new CustomEvent('qproject-pinned-changed', { detail: { projectId: projId } }));
      } catch { /* ignore */ }
      return next;
    });
  }, [PIN_KEY, projId]);

  return (
    <Layout $collapsed={sidebarCollapsed} $projectFull={isProject} $hasDetail={!!detail || isEditing} $listW={listWidth}>
      {isProject && !detail && !isEditing && (
        <ProjBrowse>
          <AtToolbar>
            <SearchBox width={260} value={query} onChange={setQuery} placeholder={t('search.placeholder', '문서 검색') as string} />
            <AtSortWrap>
              <PlanQSelect
                size="sm"
                value={{ value: projSort, label: (projSort === 'name' ? t('sort.name', '이름 순') : t('sort.recent', '최근 순')) as string }}
                onChange={(v) => { const nv = (v as { value?: string } | null)?.value; if (nv === 'name' || nv === 'recent') setProjSort(nv); }}
                options={[{ value: 'recent', label: t('sort.recent', '최근 순') as string }, { value: 'name', label: t('sort.name', '이름 순') as string }]}
              />
            </AtSortWrap>
            <AiActionButton onClick={() => { setAiIntent('ai'); setAiOpen(true); }} label={t('ai.btn', 'AI')} title={t('ai.openHint', 'AI 가 문서 본문을 자동 작성') as string} />
            <TemplateBtn type="button" onClick={openTemplateModal} title={t('templates.openHint', '템플릿에서 시작') as string}>{t('templates.btn', '템플릿')}</TemplateBtn>
            <NewBtnWrap>
              <NewBtn type="button" onClick={() => setNewDropdownOpen(v => !v)} title={t('btn.new') as string} aria-label={t('btn.new') as string} aria-expanded={newDropdownOpen}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              </NewBtn>
              {newDropdownOpen && (
                <NewDropdown onMouseLeave={() => setNewDropdownOpen(false)}>
                  <NewItem type="button" onClick={() => { setNewDropdownOpen(false); startNew(); }}>
                    <NewItemTitle>{t('newDropdown.blankLabel', { defaultValue: '빈 문서' }) as string}</NewItemTitle>
                    <NewItemDesc>{t('newDropdown.blankDesc', { defaultValue: '빈 본문으로 즉시 시작' }) as string}</NewItemDesc>
                  </NewItem>
                  <NewItem type="button" onClick={() => { setNewDropdownOpen(false); setAiIntent('manual'); setAiDefaultMode('table'); setAiOpen(true); }}>
                    <NewItemTitle>{t('newDropdown.tableLabel', { defaultValue: '표' }) as string}</NewItemTitle>
                    <NewItemDesc>{t('newDropdown.tableDesc', { defaultValue: '계정·자산 등 행/열 데이터' }) as string}</NewItemDesc>
                  </NewItem>
                </NewDropdown>
              )}
            </NewBtnWrap>
          </AtToolbar>
          <AtSplit>
            <AtPanel>
              <AtTree>
                <AtRow $selected={filter.kind === 'all'} onClick={() => setFilter({ kind: 'all' })}>
                  <span />
                  <AtName>{t('filter.all', '전체') as string}</AtName>
                  <AtCount>{meta.total}</AtCount>
                  <span />
                </AtRow>
                {meta.categories.map(c => (
                  <AtRow key={c.name} $selected={filter.kind === 'category' && filter.name === c.name}
                    onClick={() => { if (filter.kind === 'category' && filter.name === c.name) setFilter({ kind: 'all' }); else setFilter({ kind: 'category', name: c.name }); }}>
                    <span />
                    <AtName>#{c.name}</AtName>
                    <AtCount>{c.count}</AtCount>
                    <span />
                  </AtRow>
                ))}
                {newCatOpen ? (
                  <NewCatInput autoFocus value={newCatDraft} onChange={e => setNewCatDraft(e.target.value)}
                    onBlur={async () => { const v = newCatDraft.trim(); setNewCatOpen(false); setNewCatDraft(''); if (!v) return; try { await createCategory(scope.businessId, v, scopeProjectId ?? null); await loadMeta(); setFilter({ kind: 'category', name: v }); } catch { /* silent */ } }}
                    onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setNewCatOpen(false); setNewCatDraft(''); } }}
                    placeholder={t('filter.newCategoryPlaceholder', '카테고리 이름 (Enter)') as string} maxLength={40} />
                ) : (
                  <AddCatBtn type="button" onClick={() => setNewCatOpen(true)} title={t('filter.addCategory', '카테고리 추가') as string}>
                    + {t('filter.addCategory', '카테고리 추가')}
                  </AddCatBtn>
                )}
              </AtTree>
            </AtPanel>
            <AtArea>
              {loading ? (
                <Dim>{t('loading', '로딩 중…') as string}</Dim>
              ) : filtered.length === 0 ? (
                <EmptyState
                  icon={(
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                      <polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
                    </svg>
                  )}
                  title={t('empty.title', '문서를 시작하세요') as string}
                  description={t('empty.line1', '매뉴얼 · 가이드 · 공지 · 회의록 — 팀이 함께 읽는 문서를 만들어 보세요.') as string}
                  ctaLabel={t('newDropdown.blankLabel', { defaultValue: '빈 문서' }) as string}
                  onCta={startNew}
                  secondaryCtaLabel={t('newDropdown.tableLabel', { defaultValue: '표' }) as string}
                  onSecondaryCta={() => { setAiIntent('manual'); setAiDefaultMode('table'); setAiOpen(true); }}
                />
              ) : (
                <AtGrid>
                  {[...filtered].sort((a, b) => projSort === 'name' ? a.title.localeCompare(b.title) : 0).map(r => (
                    <AtCard key={r.id} data-testid="docs-card" $selected={activeId === r.id} onClick={() => { void selectPost(r.id); }}>
                      <RowPinBtn type="button" $on={pinnedIds.includes(r.id)} onClick={(e) => { e.stopPropagation(); togglePin(r.id); }}
                        aria-label={(pinnedIds.includes(r.id) ? t('project.docs.removeFromMenu', '상단 메뉴에서 제거') : t('project.docs.addToMenu', '상단 메뉴에 추가')) as string}
                        title={(pinnedIds.includes(r.id) ? t('project.docs.removeFromMenu', '상단 메뉴에서 제거') : t('project.docs.addToMenu', '상단 메뉴에 추가')) as string}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14l-1.7-2.6a2 2 0 0 1-.3-1.1V7a2 2 0 0 1 2-2H5a2 2 0 0 1 2 2v6.3a2 2 0 0 1-.3 1.1L5 17z"/></svg></RowPinBtn>
                      <AtCardName>
                        {r.status === 'draft' && (
                          <DraftTag title={t('autosave.draftBadgeHint', '아직 나만 보이는 임시저장 문서입니다. 열어서 저장하면 정식 등록됩니다.') as string}>
                            {t('autosave.draftBadge', '임시저장')}
                          </DraftTag>
                        )}
                        {r.title}
                      </AtCardName>
                      <AtCardMeta>
                        <span>{formatDate(r.updated_at)}</span>
                        {r.category && <CategoryMini>#{r.category}</CategoryMini>}
                        <RowVisChip $level={(r.vlevel as string) || 'L3'}>{visLabel(r.vlevel)}</RowVisChip>
                      </AtCardMeta>
                    </AtCard>
                  ))}
                </AtGrid>
              )}
            </AtArea>
          </AtSplit>
        </ProjBrowse>
      )}
      {/* 리스트 접기/펼치기 — 공통 FloatingPanelToggle(뷰포트 왼쪽 변 플로팅).
          ≤900px 은 리스트↔상세 풀스크린 전환이라 핸들 숨김(hideBelow). */}
      {!isProject && (
        <FloatingPanelToggle
          side="left"
          hideBelow={900}
          open={!sidebarCollapsed}
          onToggle={toggleSidebar}
          offsetOpen={`${listWidth}px`}
          ariaLabel={(sidebarCollapsed ? t('sidebar.expand', '리스트 열기') : t('sidebar.collapse', '리스트 접기')) as string}
        />
      )}
      {!isProject && !sidebarCollapsed && (
      <Sidebar $hasDetail={!!detail || isEditing} $projectFull={false} style={{ position: 'relative' }}>
        <PanelResizeHandle onMouseDown={startListResize} />
        <>
        <PanelHeader>
          <TitleGroup>
            <PanelTitle>{scope.type === 'workspace' ? t('page.title', 'Q docs') : t('tab.title', '문서')}</PanelTitle>
            <HelpDot askCue={t('help.cuePrefill','Q docs 의 템플릿·AI 작성·서명 요청·분할 청구가 어떻게 작동하는지 알려줘') as string} topic="qdocs">
              {t('help.body','5종 템플릿(견적·청구·NDA·제안·회의록)에서 시작하거나 AI 자동 작성. 작성 후 서명 요청을 보내면 고객이 OTP 인증으로 서명. 견적·계약 post 와 청구서를 연결하면 회차별 분할 청구도 가능.')}
            </HelpDot>
          </TitleGroup>
          <HeaderBtnRow>
            <AiActionButton
              onClick={() => { setAiIntent('ai'); setAiOpen(true); }}
              label={t('ai.btn', 'AI')}
              title={t('ai.openHint', 'AI 가 문서 본문을 자동 작성') as string}
            />
            <TemplateBtn type="button" onClick={openTemplateModal} title={t('templates.openHint', '견적·청구·NDA·제안서·회의록 5종 템플릿에서 시작') as string}>
              {t('templates.btn', '템플릿')}
            </TemplateBtn>
            <NewBtnWrap>
              <NewBtn type="button" onClick={() => setNewDropdownOpen(v => !v)} title={t('btn.new') as string} aria-label={t('btn.new') as string} aria-expanded={newDropdownOpen}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
              </NewBtn>
              {newDropdownOpen && (
                <NewDropdown onMouseLeave={() => setNewDropdownOpen(false)}>
                  <NewItem type="button" onClick={() => { setNewDropdownOpen(false); startNew(); }}>
                    <NewItemTitle>{t('newDropdown.blankLabel', { defaultValue: '빈 문서' }) as string}</NewItemTitle>
                    <NewItemDesc>{t('newDropdown.blankDesc', { defaultValue: '빈 본문으로 즉시 시작' }) as string}</NewItemDesc>
                  </NewItem>
                  <NewItem type="button" onClick={() => { setNewDropdownOpen(false); setAiIntent('manual'); setAiDefaultMode('table'); setAiOpen(true); }}>
                    <NewItemTitle>{t('newDropdown.tableLabel', { defaultValue: '표' }) as string}</NewItemTitle>
                    <NewItemDesc>{t('newDropdown.tableDesc', { defaultValue: '계정·자산 등 행/열 데이터' }) as string}</NewItemDesc>
                  </NewItem>
                </NewDropdown>
              )}
            </NewBtnWrap>
          </HeaderBtnRow>
        </PanelHeader>

        <SearchWrap>
          <SearchBox width="100%" value={query} onChange={setQuery} placeholder={t('search.placeholder', '제목·내용·프로젝트 검색') as string} />
        </SearchWrap>

        <FilterSection>
          {/* 카테고리 — 전체 포함 */}
          <FilterGroupLabel>{t('filter.byCategory', '카테고리') as string}</FilterGroupLabel>
          <Chip type="button" $active={filter.kind === 'all'} onClick={() => setFilter({ kind: 'all' })}>
            {t('filter.all', '전체') as string}
            <Count>{meta.total}</Count>
          </Chip>
          {meta.categories.map(c => (
            <Chip
              key={c.name}
              type="button"
              $active={filter.kind === 'category' && filter.name === c.name}
              onClick={() => {
                // 재클릭 시 토글 해제 (PlanQ UI 표준 — 리스트 재클릭 토글)
                if (filter.kind === 'category' && filter.name === c.name) setFilter({ kind: 'all' });
                else setFilter({ kind: 'category', name: c.name });
              }}
            >
              #{c.name}
              <Count>{c.count}</Count>
            </Chip>
          ))}
          {newCatOpen ? (
            <NewCatInput
              autoFocus
              value={newCatDraft}
              onChange={e => setNewCatDraft(e.target.value)}
              onBlur={async () => {
                const v = newCatDraft.trim();
                setNewCatOpen(false);
                setNewCatDraft('');
                if (!v) return;
                try {
                  await createCategory(scope.businessId, v, scopeProjectId ?? null);
                  await loadMeta();
                  setFilter({ kind: 'category', name: v });
                } catch { /* silent */ }
              }}
              onKeyDown={e => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') { setNewCatOpen(false); setNewCatDraft(''); }
              }}
              placeholder={t('filter.newCategoryPlaceholder', '카테고리 이름 (Enter)') as string}
              maxLength={40}
            />
          ) : (
            <AddCatBtn type="button" onClick={() => setNewCatOpen(true)} title={t('filter.addCategory', '카테고리 추가') as string}>
              + {t('filter.addCategory', '카테고리 추가')}
            </AddCatBtn>
          )}

          {/* 프로젝트 — 워크스페이스 모드에서만 */}
          {scope.type === 'workspace' && meta.projects.length > 0 && (
            <>
              <FilterGroupLabel>{t('filter.byProject', '프로젝트') as string}</FilterGroupLabel>
              {meta.projects.map(p => (
                <Chip
                  key={p.id}
                  type="button"
                  $active={filter.kind === 'project' && filter.projectId === p.id}
                  onClick={() => {
                    // 재클릭 시 토글 해제
                    if (filter.kind === 'project' && filter.projectId === p.id) setFilter({ kind: 'all' });
                    else setFilter({ kind: 'project', projectId: p.id });
                  }}
                >
                  <ColorDot $color={p.color || '#14B8A6'} />
                  {p.name}
                  <Count>{p.count}</Count>
                </Chip>
              ))}
            </>
          )}
        </FilterSection>

        <RowList>
          {loading ? (
            <Dim>{t('loading', '로딩 중…')}</Dim>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={(
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                  <line x1="16" y1="13" x2="8" y2="13"/>
                  <line x1="16" y1="17" x2="8" y2="17"/>
                </svg>
              )}
              title={t('empty.title') as string}
              description={t('empty.line1') as string}
              ctaLabel={t('newDropdown.blankLabel', { defaultValue: '빈 문서' }) as string}
              ctaIcon={(
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                  <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
              )}
              onCta={startNew}
              secondaryCtaLabel={t('newDropdown.tableLabel', { defaultValue: '표' }) as string}
              onSecondaryCta={() => { setAiIntent('manual'); setAiDefaultMode('table'); setAiOpen(true); }}
            />
          ) : (
            filtered.map(r => (
              <RowItem
                key={r.id}
                data-testid="docs-row"
                $active={activeId === r.id}
                $project={isProject}
                onClick={() => { void selectPost(activeId === r.id ? null : r.id); }}
              >
                {isProject && (
                  <RowPinBtn
                    type="button"
                    $on={pinnedIds.includes(r.id)}
                    onClick={(e) => { e.stopPropagation(); togglePin(r.id); }}
                    aria-label={(pinnedIds.includes(r.id) ? t('project.docs.removeFromMenu', '상단 메뉴에서 제거') : t('project.docs.addToMenu', '상단 메뉴에 추가')) as string}
                    title={(pinnedIds.includes(r.id) ? t('project.docs.removeFromMenu', '상단 메뉴에서 제거') : t('project.docs.addToMenu', '상단 메뉴에 추가')) as string}
                  ><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14l-1.7-2.6a2 2 0 0 1-.3-1.1V7a2 2 0 0 1 2-2H5a2 2 0 0 1 2 2v6.3a2 2 0 0 1-.3 1.1L5 17z"/></svg></RowPinBtn>
                )}
                <RowTitle>
                  {r.is_pinned && <PinTag aria-hidden="true"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14l-1.7-2.6a2 2 0 0 1-.3-1.1V7a2 2 0 0 1 2-2H5a2 2 0 0 1 2 2v6.3a2 2 0 0 1-.3 1.1L5 17z"/></svg></PinTag>}
                  {/* #252 — 임시저장 행은 나만 보인다. 표시가 없으면 "저장했는데 팀이 못 본다" 가 된다. */}
                  {r.status === 'draft' && (
                    <DraftTag title={t('autosave.draftBadgeHint', '아직 나만 보이는 임시저장 문서입니다. 열어서 저장하면 정식 등록됩니다.') as string}>
                      {t('autosave.draftBadge', '임시저장')}
                    </DraftTag>
                  )}
                  {r.title}
                </RowTitle>
                {r.content_preview && <RowPreview>{r.content_preview}</RowPreview>}
                <RowMeta>
                  <span>{displayName(r.author, i18n.language) || '—'}</span>
                  <span>·</span>
                  <span>{formatDate(r.updated_at)}</span>
                  {r.category && <CategoryMini>#{r.category}</CategoryMini>}
                  {r.project && (
                    <ProjectTag $color={r.project.color || '#14B8A6'}>{r.project.name}</ProjectTag>
                  )}
                  {/* N+72 — 리스트 행 공유 범위 표시 (사용자 호소) */}
                  <RowVisChip $level={(r.vlevel as string) || 'L3'}>
                    {visLabel(r.vlevel)}
                  </RowVisChip>
                  {r.share_token && <ShareMini title={t('share.publicHint', '공개 링크가 활성화됨') as string}>🔗</ShareMini>}
                  {/* D4 #62 — 보안등급 배지 (일반은 자동 숨김) */}
                  <SecurityLevelBadge level={r.security_level} />
                </RowMeta>
              </RowItem>
            ))
          )}
        </RowList>
        </>
      </Sidebar>
      )}

      {(!isProject || detail || isEditing) && (
      <Content $hasDetail={!!detail || isEditing} $projectFull={isProject}>
        {isEditing ? (
          <>
            <PanelHeader>
              <TitleRow>
                <MobileBackBtn $always={isProject} type="button" onClick={cancelEdit} aria-label={t('back', '뒤로') as string}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
                </MobileBackBtn>
                <TitleInput
                  autoFocus={mode === 'new'}
                  value={titleDraft}
                  onChange={e => setTitleDraft(e.target.value)}
                  placeholder={t('titlePlaceholder', '문서 제목') as string}
                  maxLength={200}
                />
              </TitleRow>
              <EditActions>
                {/* #252 임시저장 상태 — 성공은 뱃지만(토스트 금지, CLAUDE.md 자동저장 규칙).
                    실패·충돌은 반드시 눈에 보여야 한다 — 조용히 죽으면 저장된 줄 알고 창을 닫는다. */}
                <AutoSaveMark
                  $tone={autoState === 'error' || autoState === 'stale' ? 'err' : 'ok'}
                  title={autoErr || undefined}
                  aria-live="polite"
                >
                  {autoState === 'saving' && t('autosave.saving', '임시저장 중…')}
                  {autoState === 'saved' && `✓ ${t('autosave.saved', '임시저장됨')}`}
                  {/* 동시 편집 표시 — 나 말고 이 문서를 지금 편집 중인 사람 (구글 문서식) */}
                  {presenceUsers.filter((p) => p.userId !== Number(user?.id)).map((p) => (
                    <PresenceChip key={p.userId} title={t('presence.editing', { name: p.name, defaultValue: '{{name}} 님이 편집 중' }) as string}>
                      <PresenceDot />{p.name || t('presence.someone', '누군가')}
                    </PresenceChip>
                  ))}
                  {autoState === 'error' && `! ${t('autosave.failed', '임시저장 실패')}`}
                  {autoState === 'stale' && `! ${t('autosave.stale', '다른 사람이 수정함')}`}
                </AutoSaveMark>
                {autoState === 'stale' && (
                  <StaleBar role="alert">
                    <span>{t('autosave.staleBar', '다른 사람이 이 문서를 저장했습니다. 어떻게 할까요?')}</span>
                    <StaleBtn type="button" onClick={() => { void resolveStaleReload(); }}>
                      {t('autosave.staleReload', '최신 내용 가져오기')}
                    </StaleBtn>
                    <StaleBtn type="button" $danger onClick={() => { void resolveStaleOverwrite(); }}>
                      {t('autosave.staleOverwrite', '내 수정으로 덮어쓰기')}
                    </StaleBtn>
                  </StaleBar>
                )}
                {leaveBlocked && (
                  <LeaveBlockedNote role="alert">
                    {t('autosave.leaveBlocked', '저장하지 못한 변경이 있어 이동하지 못했습니다. 저장하거나 취소해 주세요.')}
                  </LeaveBlockedNote>
                )}
                {/* ★ 저장 버튼은 **새 문서에만** 둔다 (2026-08-25, Notion 방식으로 정렬).
                    기존 문서 편집은 치는 대로 저장되고, 나가는 순간 첨부까지 마무리된다
                    (leaveEditSession). 저장 버튼을 남겨두면 "임시저장인데 왜 저장돼?" 라는
                    이중 상태 혼란이 그대로 남는다. 되돌리기는 변경 기록이 담당한다.
                    새 문서는 처음 공개되는 순간이 의도적이어야 하므로 버튼을 유지한다. */}
                <SecondaryBtn type="button" disabled={saving} onClick={cancelEdit}>
                  {mode === 'new' ? t('cancel', '취소') : t('revertEdit', '이번 편집 되돌리기')}
                </SecondaryBtn>
                {mode === 'new' ? (
                  <PrimaryBtn type="button" disabled={saving || !titleDraft.trim()} onClick={submit}>
                    {saving ? t('saving', '저장 중…') : t('save', '저장')}
                  </PrimaryBtn>
                ) : (
                  <PrimaryBtn type="button" disabled={saving} onClick={() => { void leaveEditSession(); }}>
                    {t('doneEditing', '편집 완료')}
                  </PrimaryBtn>
                )}
              </EditActions>
            </PanelHeader>
            <Body>
              <MetaRow>
                {/* ★ 카테고리 입력은 width:100% 라 행을 통째로 먹었고, 그래서 혼자 한 줄을 차지했다
                    (Irene: "카테고리 창이 너무 심하게 길어. 혼자 있을 이유가 없는데").
                    폭을 묶어 프로젝트·형태·공개·보안과 **한 줄**에 서게 한다. 좁아지면 자연히 접힌다. */}
                <MetaField $basis={240}>
                  <CategoryCombobox
                    value={categoryDraft}
                    onChange={setCategoryDraft}
                    options={meta.categories.map(c => c.name)}
                    placeholder={t('categoryPlaceholder', '카테고리 (예: 매뉴얼, 가이드)') as string}
                  />
                </MetaField>
                {scope.type === 'workspace' && (
                  <MetaField $basis={200}>
                  <PlanQSelect
                    size="sm"
                    options={projectOptions}
                    value={projectOptions.find(o => o.value === projectDraft) || null}
                    onChange={(opt) => setProjectDraft(opt ? Number((opt as PlanQSelectOption).value) : null)}
                    placeholder={t('share.linkage.noneProject', '프로젝트 연결 안 함') as string}
                    isClearable
                    isSearchable
                  />
                  </MetaField>
                )}
                {/* N+72-7 — 문서 ↔ 표 타입 toggle (편집 모드에서 변경 가능). 표→문서: 데이터 있으면 confirm 모달 */}
                {mode === 'edit' && detail && (
                  <KindToggle role="tablist" aria-label={t('kind.label', '문서 형태') as string}>
                    <KindBtn type="button" role="tab" aria-selected={detail.kind !== 'table'} $active={detail.kind !== 'table'} onClick={() => changeKind('doc')}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                      {t('kind.doc', '문서') as string}
                    </KindBtn>
                    <KindBtn type="button" role="tab" aria-selected={detail.kind === 'table'} $active={detail.kind === 'table'} onClick={() => changeKind('table')}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>
                      {t('kind.table', '표') as string}
                    </KindBtn>
                  </KindToggle>
                )}
                {/* 편집 메타 패리티 — 상세에서 바꾸던 공개·보안을 편집 모드에서도 같은 줄에서 수정(Irene) */}
                {mode === 'edit' && detail && (
                  <>
                    <VisibilityChip type="button" onClick={() => setVisModalOpen(true)} title={t('visibility.change', { defaultValue: '공개 범위 변경' }) as string}>
                      {t('visibility.label', { defaultValue: '공개' }) as string}: {visLabel(detail.vlevel)}
                    </VisibilityChip>
                    <MetaField $basis={160}>
                      <PlanQSelect
                        size="sm" isClearable={false} isSearchable={false}
                        value={{ value: detail.security_level || 'general', label: secLabel(detail.security_level || 'general') }}
                        options={(['general', 'internal', 'confidential'] as const).map((lv) => ({ value: lv, label: secLabel(lv) }))}
                        onChange={async (o) => {
                          const lv = (((o as { value?: string })?.value) || 'general') as 'general' | 'internal' | 'confidential';
                          try {
                            const r = await updatePostSecurityLevel(detail.id, lv);
                            setDetail(prev => prev ? { ...prev, security_level: lv, ...(r.revoked_share ? { share_token: null, vlevel: prev.vlevel === 'L4' ? 'L3' : prev.vlevel } : {}) } : prev);
                          } catch { /* keep current on error */ }
                        }}
                      />
                    </MetaField>
                  </>
                )}
              </MetaRow>
              {error && <ErrorBar>{error}</ErrorBar>}
              {detail?.kind === 'table' && detail.q_record_id ? (
                <>
                  {/* 표 설명 — 열기/닫기 하나의 full-width 헤더 바로 통일(닫힘=헤더만, 열림=헤더+에디터). (Irene) */}
                  <div className="pq-fullbleed" style={{ marginTop: -16 }}>
                    <DescToggleHeader type="button" onClick={() => setTableDescOpen(v => !v)} aria-expanded={tableDescOpen}>
                      <DescBoxLabel>{t('tableDescTitle', { defaultValue: '표 설명' }) as string}</DescBoxLabel>
                      <DescChevron $open={tableDescOpen}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                        {tableDescOpen ? (t('tableDescCloseShort', { defaultValue: '닫기' }) as string) : (t('tableDescOpenShort', { defaultValue: '열기' }) as string)}
                      </DescChevron>
                    </DescToggleHeader>
                    {tableDescOpen && (
                      <PostEditor
                        value={contentDraft}
                        onChange={setContentDraft}
                        businessId={scope.businessId}
                        projectId={scopeProjectId}
                        placeholder={t('tableDescPlaceholder', '표에 대한 설명을 입력하세요 (선택)') as string}
                        borderless
                      />
                    )}
                  </div>
                  {/* N+72-7 — 본문↔표 간격 (편집 모드) */}
                  <SectionGap />
                  <div className="pq-fullbleed"><PostTableGrid recordId={detail.q_record_id} businessId={scope.businessId} /></div>
                </>
              ) : (
                <>
                  {/* 운영 — AI 생성물 재생성 (지시 기반). AI 로 만든 새 문서일 때만 노출 */}
                  {mode === 'new' && aiCtx && (
                    <AiRegenRow>
                      <AiRegenerateBar busy={regenBusy} onRegenerate={regenerateDoc} />
                    </AiRegenRow>
                  )}
                  {/* 툴바를 위 MetaRow 회색 구분선에 바로 붙인다(Body gap 16 상쇄) — 편집 상단 여백 제거(Irene) */}
                  <div className="pq-fullbleed" style={{ marginTop: -16 }}>
                    <PostEditor value={contentDraft} onChange={setContentDraft} businessId={scope.businessId} projectId={scopeProjectId} placeholder={t('contentPlaceholder', '본문을 작성하세요…') as string} borderless />
                  </div>
                </>
              )}

              <AttachSection>
                <AttachTitle>{t('attachments', '첨부 파일·문서')}</AttachTitle>
                {mode === 'edit' && detail && detail.attachments.length > 0 && (
                  <AttachList>
                    {detail.attachments.map(a => (
                      <AttachRow key={a.id}>
                        <AttachName href={a.file?.download_url || '#'} target="_blank" rel="noreferrer">
                          {a.file?.file_name || '—'}
                        </AttachName>
                        <RemoveBtn type="button" onClick={() => detachOne(a.id)} title={t('actions.remove', '제거') as string} aria-label={t('actions.remove', '제거') as string}>×</RemoveBtn>
                      </AttachRow>
                    ))}
                  </AttachList>
                )}
                <AttachmentField
                  businessId={scope.businessId}
                  uploads={pendingUploads}
                  onUploadsChange={setPendingUploads}
                  existingFileIds={pendingExistingIds}
                  onExistingFileIdsChange={setPendingExistingIds}
                  includePosts
                  existingPostIds={pendingPostIds}
                  onExistingPostIdsChange={setPendingPostIds}
                />
              </AttachSection>
            </Body>
          </>
        ) : detail ? (
          <>
            <PanelHeader>
              <TitleRow>
                <MobileBackBtn $always={isProject} type="button" onClick={() => setDetail(null)} aria-label={t('back', '뒤로') as string}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
                </MobileBackBtn>
                <PanelSubTitle>
                  {detail.is_pinned && <PinDot title={t('list.pinned', '고정됨') as string} />}
                  {detail.title}
                {/* 양방향 링크: 자료정리에서 파생된 후속 문서면 parent 로 가는 링크 */}
                {detail.parent_post_id && (
                  <ParentLink href={`/docs/brief/${detail.parent_post_id}`}
                    title={t('parentLink.title', '원본 자료정리로 이동') as string}>
                    ← {t('parentLink.label', '자료정리에서 파생')}
                  </ParentLink>
                )}
              </PanelSubTitle>
              </TitleRow>
              <EditActions>
                {/* N+72-7 — 30년차 UX 재구성. 공개=visibility, 공유=share (외부). 자주 안 쓰는 액션은 IconBtn + 툴팁. */}
                {/* 공개 chip 은 헤더에서 제거 — 아래 MetaBar 로 단일화(중복 제거, Irene). 헤더는 제목+액션 전용. */}
                {/* ★ 2026-08-24 (Irene: "편집을 할 수 없다") — 편집은 여기서 **가장 자주 쓰는 액션**인데
                    아이콘만이라 눈에 띄지 않았다. 공유·서명 받기는 글자 버튼인데 편집만 아이콘이었다.
                    글자 버튼으로 올리고 맨 앞에 둔다. */}
                {/* 변경 기록 — "저장 버튼 없이 항상 저장" 의 안전망(되돌리기). 편집 권한자에게만 의미가 있다. */}
                <IconBtn type="button" data-testid="post-history" onClick={() => setHistoryOpen(true)}
                  title={t('history.title', '변경 기록') as string} aria-label={t('history.title', '변경 기록') as string}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 3v5h5" /><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" /><path d="M12 7v5l4 2" />
                  </svg>
                </IconBtn>
                <EditBtn type="button" data-testid="post-edit" onClick={startEdit}
                  title={t('edit', '편집') as string} aria-label={t('edit', '편집') as string}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 4 }}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  {t('edit', '편집')}
                </EditBtn>
                {/* Primary 액션 — 자주 쓰는 것 */}
                <PrimaryBtn type="button" onClick={() => setShareOpen(true)} title={t('share.headerHint', '외부 사람과 공유 — 링크 / 이메일 / 만료') as string}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 4 }}><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
                  {t('share.button', '공유')}
                </PrimaryBtn>
                <SignBtn type="button" onClick={() => setSignOpen(true)} title={t('sign.headerHint', '서명자에게 이메일로 서명 요청') as string}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 4 }}><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>
                  {t('sign.button', '서명 받기')}
                </SignBtn>
                {/* 3) IconBtn + 툴팁 — 가끔 쓰는 것 */}
                <IconBtn type="button" onClick={() => sendToKnowledge(detail)} title={t('actions.sendToKnowledge', 'Q knowledge 로 보내기 — Cue 가 답변 시 참조') as string} aria-label={t('actions.sendToKnowledge', 'Q knowledge 로 보내기') as string} disabled={knowledgeBusy}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 6.253v13"/><path d="M12 6.253C10.832 5.477 9.246 5 7.5 5 5.754 5 4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253"/><path d="M12 6.253C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18s-3.332.477-4.5 1.253"/></svg>
                </IconBtn>
                <IconBtn type="button" onClick={() => { setSaveTplName(detail.title); setSaveTplDesc(''); setSaveTplError(null); setSaveTplOpen(true); }} title={t('actions.saveAsTemplate', '템플릿으로 저장 — 다음 새 글 작성 시 검색해서 사용') as string} aria-label={t('actions.saveAsTemplate', '템플릿으로 저장') as string}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
                </IconBtn>
                {/* 운영 #225 — 서버 PDF 생성(GET /api/posts/:id/pdf)과 프론트 헬퍼(downloadPostPdf)가 이미 있는데
                    **호출부가 한 곳도 없어** 화면에는 window.print() 만 있었다. 완성된 기능이 도달하지 못한 경우. */}
                <IconBtn type="button" disabled={pdfBusy}
                  onClick={async () => {
                    if (pdfBusy) return;            // 중복 제출 가드 (UI_DESIGN_GUIDE §1.8)
                    setPdfBusy(true); setError(null);
                    try { await downloadPostPdf(detail.id, detail.title); }
                    catch (e) {
                      // 서버가 보낸 사유가 있으면 그대로, 없으면 이 동작의 문구로. (apiFetch 는 throw 하지 않으므로
                      //  downloadPostPdf 안에서 res.ok 를 보고 던진 Error 가 여기로 온다.)
                      const msg = (e as Error)?.message;
                      setError(msg && !/^HTTP \d+$/.test(msg) ? msg : (t('actions.pdfError', 'PDF 생성 실패') as string));
                    }
                    finally { setPdfBusy(false); }
                  }}
                  title={t('actions.downloadPdf', 'PDF 로 내려받기') as string} aria-label={t('actions.downloadPdf', 'PDF 로 내려받기') as string}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                </IconBtn>
                {/* #225 — 워드. "워드, pdf, 엑셀 … 기본적으로 다운로드" 중 없던 것이 워드였다.
                    같은 본문을 같은 권한으로 형식만 바꿔 준다. */}
                <IconBtn type="button" disabled={docxBusy}
                  onClick={async () => {
                    if (docxBusy) return;
                    setDocxBusy(true); setError(null);
                    try { await downloadPostDocx(detail.id, detail.title); }
                    catch (e) {
                      const msg = (e as Error)?.message;
                      setError(msg && !/^HTTP \d+$/.test(msg) ? msg : (t('actions.docxError', '워드 파일 생성 실패') as string));
                    }
                    finally { setDocxBusy(false); }
                  }}
                  title={t('actions.downloadDocx', '워드(.docx) 로 내려받기') as string} aria-label={t('actions.downloadDocx', '워드로 내려받기') as string}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M8 13l1.5 5L12 14l2.5 4L16 13"/></svg>
                </IconBtn>
                <IconBtn type="button" onClick={() => window.print()} title={t('actions.print', 'PDF / 인쇄 (저장하려면 ‘대상: PDF로 저장’ 선택)') as string} aria-label={t('actions.print', 'PDF / 인쇄') as string}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
                </IconBtn>
                <IconBtn type="button" onClick={() => setDeleteTarget(detail)} title={t('delete', '삭제') as string} aria-label={t('delete', '삭제') as string} style={{ color: '#DC2626' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </IconBtn>
              </EditActions>
            </PanelHeader>
            <Body>
              <ViewMeta>
                <MetaLeft>
                <span>{displayName(detail.author, i18n.language) || '—'}</span>
                <span>·</span>
                <span>{formatDate(detail.created_at)}</span>
                {detail.editor && detail.editor.id !== detail.author?.id && (
                  <><span>·</span><span>{t('editedBy', '수정: {{name}}', { name: detail.editor.name })}</span></>
                )}
                {detail.category && (
                  <CategoryTag
                    type="button"
                    onClick={() => setFilter({ kind: 'category', name: detail.category! })}
                    title={t('filter.filterBy', '이 카테고리로 필터') as string}
                  >
                    #{detail.category}
                  </CategoryTag>
                )}
                {detail.project && (
                  <ProjectTag $color={detail.project.color || '#14B8A6'}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 2 }}><path d="M3 7a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>
                    {detail.project.name}
                  </ProjectTag>
                )}
                </MetaLeft>
                <MetaRight>
                {/* N+67 — visibility chip + 변경 modal */}
                <VisibilityChip
                  type="button"
                  onClick={() => setVisModalOpen(true)}
                  title={t('visibility.change', { defaultValue: '공개 범위 변경' }) as string}
                >
                  {t('visibility.label', { defaultValue: '공개' }) as string}: {visLabel(detail.vlevel)}
                </VisibilityChip>
                {detail.share_token && (
                  <ShareTag title={t('share.publicHint', '공개 링크가 활성화되어 있습니다') as string}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 2 }}><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.72"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.72-1.72"/></svg>
                    {t('share.publicBadge', '공유 중')}
                  </ShareTag>
                )}
                {/* D4 #62 — 보안등급 배지 (일반은 노이즈 0, 자동 숨김) */}
                <SecurityLevelBadge level={detail.security_level} />
                </MetaRight>
              </ViewMeta>
              {/* 보안등급 상시노출 SecurityRow 제거 — 뷰는 MetaBar chip(일반 자동숨김), 변경은 편집 모드 메타에서(Irene) */}
              {/* 운영 #338 — 긴 문서의 목차. 본문에서 파생하므로 옛 문서에서도 바로 뜬다.
                  제목이 2개 미만이면 스스로 아무것도 그리지 않는다. 인쇄에는 넣지 않는다
                  (data-print-area 밖 — 종이에서는 클릭 이동이 의미가 없다). */}
              <DocToc content={detail.content_json} containerRef={docBodyRef} />
              <div data-print-area className="pq-fullbleed" style={{ marginTop: -16 }} ref={docBodyRef}>
                <PrintOnlyTitle>{detail.title}</PrintOnlyTitle>
                {detail.kind === 'table' && detail.q_record_id ? (
                  // 표 kind — 본문 설명(있으면) + Q record 그리드 (보기 모드: read-only)
                  <>
                    {detail.content_json && (
                      <PostEditor value={detail.content_json} onChange={() => {}} editable={false} borderless />
                    )}
                    {/* N+72-7 — 본문↔표 사이 간격 (사용자 호소 "들러붙어 보기 안좋아") */}
                    {detail.content_json && <SectionGap />}
                    <PostTableGrid recordId={detail.q_record_id} businessId={scope.businessId} readOnly />
                  </>
                ) : (
                  <PostEditor value={detail.content_json} onChange={() => {}} editable={false} borderless />
                )}
              </div>

              <SignatureProgressSection
                postId={detail.id}
                inferredKind={inferKindFromTitle(detail.title, detail.category)}
                reloadTrigger={signReloadKey}
                onAddMore={() => setSignOpen(true)}
              />

              {/* 보기 모드 — 첨부도 연결도 없으면 섹션 자체 숨김 */}
              {(detail.attachments.length > 0 || (detail.linked_posts && detail.linked_posts.length > 0)) && (
                <AttachSection>
                  <AttachTitle>{t('attachments', '첨부 파일·문서')}</AttachTitle>
                  {detail.attachments.length > 0 && (
                    <AttachList>
                      {detail.attachments.map(a => (
                        <AttachRow key={a.id}>
                          <AttachName href={a.file?.download_url || '#'} target="_blank" rel="noreferrer">
                            {a.file?.file_name || '—'}
                          </AttachName>
                          <RemoveBtn type="button" onClick={() => detachOne(a.id)} title={t('actions.remove', '제거') as string} aria-label={t('actions.remove', '제거') as string}>×</RemoveBtn>
                        </AttachRow>
                      ))}
                    </AttachList>
                  )}
                  {detail.linked_posts && detail.linked_posts.length > 0 && (
                    <AttachList>
                      {detail.linked_posts.map(lp => (
                        <AttachRow key={`lp-${lp.id}`}>
                          <AttachName as="a" href={`/docs?post=${lp.id}`}>
                            {lp.kind === 'table' ? '📊 ' : '📄 '}{lp.title}
                          </AttachName>
                        </AttachRow>
                      ))}
                    </AttachList>
                  )}
                </AttachSection>
              )}
            </Body>
          </>
        ) : (
          <EmptyState
            icon={(
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
                <polyline points="10 9 9 9 8 9"/>
              </svg>
            )}
            title={t('empty.title', '문서를 시작하세요') as string}
            description={(
              <>
                {t('empty.line1', '매뉴얼 · 가이드 · 공지 · 회의록 — 팀이 함께 읽는 문서를 만들어 보세요.')}
                <br />
                {t('empty.line2', '왼쪽 목록에서 기존 문서를 선택하거나, 새로 작성할 수 있습니다.')}
              </>
            )}
            ctaLabel={t('newDropdown.blankLabel', { defaultValue: '빈 문서' }) as string}
            ctaIcon={(
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                <line x1="12" y1="5" x2="12" y2="19"/>
                <line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
            )}
            onCta={startNew}
            secondaryCtaLabel={t('newDropdown.tableLabel', { defaultValue: '표' }) as string}
            onSecondaryCta={() => { setAiIntent('manual'); setAiDefaultMode('table'); setAiOpen(true); }}
          />
        )}
      </Content>
      )}

      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={onDelete}
        title={t('deleteTitle', '문서 삭제') as string}
        message={t('deleteMessage', '"{{title}}" 문서를 삭제할까요? 이 작업은 되돌릴 수 없습니다.', { title: deleteTarget?.title || '' }) as string}
        confirmText={t('delete', '삭제') as string}
        cancelText={t('cancel', '취소') as string}
        variant="danger"
      />

      {/* N+72-7 — 표→문서 변경 시 표 데이터 사라짐 확인 (force_kind_change=true) */}
      <ConfirmDialog
        isOpen={pendingKindChange === 'doc'}
        onClose={() => setPendingKindChange(null)}
        onConfirm={() => { doKindChange('doc', true); setPendingKindChange(null); }}
        title={t('kind.changeToDocTitle', '문서로 변경') as string}
        message={t('kind.changeToDocMsg', '표의 컬럼·데이터가 모두 사라집니다. 계속하시겠습니까?') as string}
        confirmText={t('kind.changeToDocConfirmBtn', '문서로 변경') as string}
        cancelText={t('cancel', '취소') as string}
        variant="danger"
      />

      {detail && shareOpen && (
        <PostShareModal
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          post={detail}
          onChanged={updated => setDetail(updated)}
        />
      )}

      {/* N+67 — visibility 변경 모달 (VisibilityField wrapper) */}
      {detail && (
        <VisibilityChangeModal
          open={visModalOpen}
          current={(detail.vlevel as 'L1'|'L2'|'L3'|'L4') || 'L3'}
          canChooseL2
          projects={visProjects.map(p => ({ id: p.id, name: p.name }))}
          members={visMembers}
          clients={visClients.map(c => ({ id: c.id, display_name: c.display_name, biz_name: c.biz_name, company_name: c.company_name }))}
          onConfirm={async ({ level, projectId }) => {
            try {
              const r = await updatePostVisibility(detail.id, {
                level,
                ...(projectId ? { project_id: projectId } : {}),
              });
              setDetail(prev => prev ? { ...prev, vlevel: r.vlevel as 'L1'|'L2'|'L3'|'L4', project_id: r.project_id, share_token: r.share_token ?? prev.share_token } : prev);
            } catch (e) { /* keep modal open on error */ throw e; }
          }}
          onClose={() => setVisModalOpen(false)}
        />
      )}

      {aiOpen && (
        <PostAiModal
          open={aiOpen}
          onClose={() => { setAiOpen(false); setAiDefaultMode(undefined); setAiInitialBriefText(undefined); setAiInitialBriefTitle(undefined); }}
          businessId={scope.businessId}
          projectId={scope.type === 'project' ? scope.projectId : null}
          onGenerate={startFromAi}
          onBlank={startNew}
          intent={aiIntent}
          defaultMode={aiDefaultMode}
          initialBriefText={aiInitialBriefText}
          initialBriefTitle={aiInitialBriefTitle}
          onTableCreated={async (id) => {
            // #96 — 표 생성 후 in-place 진입 (프로젝트 scope 에서도 페이지 이탈 없이). new_table=1 로 edit 모드.
            if (!(await leaveEditSession())) return;   // #252 — 편집 중이었으면 먼저 마무리
            pendingNewTableRef.current = id;           // #336 — URL 반영 타이밍과 무관하게 편집 모드로
            setActiveId(id);
            setSearchParams(prev => {
              const sp = new URLSearchParams(prev);
              sp.set('post', String(id));
              sp.set('new_table', '1');
              return sp;
            }, { replace: true });
            load();
          }}
        />
      )}


      {detail && signOpen && (
        <PostSignatureModal
          open={signOpen}
          onClose={() => setSignOpen(false)}
          post={detail}
          onSent={() => setSignReloadKey(k => k + 1)}
        />
      )}

      {detail && (
        <PostHistoryPanel
          postId={detail.id}
          open={historyOpen}
          onClose={() => setHistoryOpen(false)}
          onRestored={() => { void (async () => { const fresh = await fetchPost(detail.id); if (fresh) setDetail(fresh); await load(); })(); }}
        />
      )}
      {saveTplOpen && (
        <ModalBackdrop onClick={() => !saveTplBusy && setSaveTplOpen(false)}>
          <ModalDialog onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={t('saveTpl.title', '템플릿으로 저장') as string}>
            <ModalHead>
              <ModalTitle>{t('saveTpl.title', '템플릿으로 저장')}</ModalTitle>
              <ModalClose type="button" onClick={() => !saveTplBusy && setSaveTplOpen(false)} aria-label="Close">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </ModalClose>
            </ModalHead>
            <ModalBody>
              <ModalSub>{t('saveTpl.sub', '현재 본문을 워크스페이스 템플릿으로 저장합니다. 다음 새 글 작성 시 검색해서 사용할 수 있습니다.')}</ModalSub>
              <SaveTplField>
                <SaveTplLabel>{t('saveTpl.name', '템플릿 이름')} *</SaveTplLabel>
                <TplSearchInput type="text" value={saveTplName} onChange={e => setSaveTplName(e.target.value)} placeholder={t('saveTpl.namePh', '예: 우리 회사 표준 NDA') as string} />
              </SaveTplField>
              <SaveTplField>
                <SaveTplLabel>{t('saveTpl.desc', '설명 (선택)')}</SaveTplLabel>
                <TplSearchInput type="text" value={saveTplDesc} onChange={e => setSaveTplDesc(e.target.value)} placeholder={t('saveTpl.descPh', '한 줄 요약') as string} />
              </SaveTplField>
              {saveTplError && <SaveTplError>{saveTplError}</SaveTplError>}
            </ModalBody>
            <ModalFooter>
              <SecondaryBtn type="button" onClick={() => !saveTplBusy && setSaveTplOpen(false)}>{t('cancel', '취소')}</SecondaryBtn>
              <PrimaryBtn type="button" disabled={saveTplBusy || !saveTplName.trim() || !detail} onClick={async () => {
                if (!businessId || !detail) return;
                setSaveTplBusy(true); setSaveTplError(null);
                try {
                  const html = renderContentToHtml(detail.content_json);
                  const r = await (await fetch('/api/docs/templates', {
                    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('accessToken') || ''}` },
                    body: JSON.stringify({
                      business_id: businessId, name: saveTplName.trim(), description: saveTplDesc.trim() || null,
                      kind: 'custom', mode: 'editor', body_template: html, locale: 'ko', visibility: 'workspace_only',
                    }),
                  })).json();
                  if (!r.success) throw new Error(r.message || 'save_failed');
                  setSaveTplOpen(false);
                  setTemplates([]); // 다음 모달 오픈 시 다시 fetch
                } catch (err) {
                  setSaveTplError(t('saveTpl.error', '저장 실패. 다시 시도해주세요.') as string);
                } finally { setSaveTplBusy(false); }
              }}>{saveTplBusy ? t('saving', '저장 중…') : t('save', '저장')}</PrimaryBtn>
            </ModalFooter>
          </ModalDialog>
        </ModalBackdrop>
      )}

      {tplModalOpen && (
        <ModalBackdrop onClick={() => setTplModalOpen(false)}>
          <ModalDialog onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={t('templates.modalTitle', '템플릿 선택') as string}>
            <ModalHead>
              <ModalTitle>{t('templates.modalTitle', '템플릿에서 시작')}</ModalTitle>
              <ModalClose type="button" onClick={() => setTplModalOpen(false)} aria-label="Close">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </ModalClose>
            </ModalHead>
            <ModalBody>
              <ModalSub>{t('templates.modalSub', '본문이 자동으로 채워집니다. 자유롭게 편집한 후 저장하세요.')}</ModalSub>
              <TplSearchInput
                autoFocus
                type="text"
                value={tplSearch}
                onChange={e => setTplSearch(e.target.value)}
                placeholder={t('templates.searchPh', '템플릿 검색 (이름·설명·종류)') as string}
              />
              <TplGrid>
                {templates.length === 0 ? (
                  <Empty>{t('templates.loading', '로드 중...')}</Empty>
                ) : filteredTemplates.length === 0 ? (
                  <Empty>{t('templates.noResult', '검색 결과 없음')}</Empty>
                ) : (
                  filteredTemplates.map(tpl => (
                    <TplCard key={tpl.id} type="button" onClick={() => startFromTemplate(tpl)}>
                      <TplCardIcon><KindIcon kind={tpl.kind} size={20} /></TplCardIcon>
                      <TplCardBody>
                        <TplCardName>{tpl.name}</TplCardName>
                        <TplCardDesc>{tpl.description}</TplCardDesc>
                      </TplCardBody>
                      {tpl.is_system && <TplBadgeSys>{t('templates.system', '기본')}</TplBadgeSys>}
                    </TplCard>
                  ))
                )}
              </TplGrid>
            </ModalBody>
          </ModalDialog>
        </ModalBackdrop>
      )}
      {slotTplId !== null && businessId && (
        <SlotFormModal
          templateId={slotTplId}
          businessId={businessId}
          projectId={scope.type === 'project' ? scope.projectId : null}
          clientId={null}
          open={true}
          onClose={() => setSlotTplId(null)}
          onConfirm={handleSlotConfirm}
        />
      )}
      {knowledgeMsg && <KnowledgeToast>{knowledgeMsg}</KnowledgeToast>}
    </Layout>
  );
};

export default PostsPage;

// ─── styled ─── (Q Note 패턴 — Sidebar + Content 2컬럼 + PanelHeader)
const PrintOnlyTitle = styled.h1`
  display: none;
  @media print {
    display: block;
    font-size: 24px; font-weight: 700; color: #0F172A; margin: 0 0 16px 0;
  }
`;
const Layout = styled.div<{ $collapsed?: boolean; $projectFull?: boolean; $hasDetail?: boolean; $listW?: number }>`
  display: grid;
  /* 좌측 리스트 폭 — Q note 와 동일 (300px). 좌측 리스트 패턴 통일 */
  /* 프로젝트 스코프: 단일 컬럼. browse 시 ProjBrowse(파일 탭과 동일한 Toolbar+Split) 가 셀을 채우고,
     문서를 열면(상세/편집) 같은 셀에 상세를 풀폭으로 렌더. */
  grid-template-columns: ${p => p.$projectFull ? '1fr' : (p.$collapsed ? '0 1fr' : `${p.$listW || 300}px 1fr`)};
  height: 100%; min-height: 0;
  /* 경계선 핸들(PanelEdgeHandle)이 이 컨테이너 기준으로 absolute 배치된다 */
  position: relative;
  background: #F8FAFC;
  overflow: hidden;
  transition: grid-template-columns 0.18s ease;
  @media (max-width: 900px) { grid-template-columns: 1fr; }
`;

// 좌측 사이드바 (리스트)
const Sidebar = styled.aside<{ $hasDetail?: boolean; $projectFull?: boolean }>`
  display: flex; flex-direction: column; position: relative;
  background: #fff; border-right: 1px solid #E2E8F0;
  min-height: 0;
  /* 프로젝트: 카테고리 패널(좌). 단 문서를 열면(상세/편집) 숨겨 상세를 풀폭으로. */
  ${p => (p.$projectFull && p.$hasDetail) ? 'display: none;' : ''}
  @media (max-width: 900px) {
    border-right: none; border-bottom: 1px solid #E2E8F0;
    /* 모바일에서 문서 선택 시 리스트 숨기고 상세만 표시 */
    display: ${p => p.$hasDetail ? 'none' : 'flex'};
  }
`;
// 우측 컨텐츠 — background 를 Content 에 직접 부여
// 제목 + 헬프 아이콘 묶음 — Q note 와 동일 (제목 끝나면 바로 helpDot 붙임)
const TitleGroup = styled.div`
  display: inline-flex; align-items: center; gap: 4px; min-width: 0;
`;
const HeaderBtnRow = styled.div`display:flex;align-items:center;gap:6px;`;
const TemplateBtn = styled.button`
  height: 32px; padding: 0 12px;
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 12px; font-weight: 600; color: #0F766E;
  background: #F0FDFA; border: 1px solid #14B8A6; border-radius: 8px; cursor: pointer;
  transition: background 0.15s, color 0.15s;
  &:hover { background: #14B8A6; color: #FFF; }
  &:focus-visible { outline: 2px solid #0D9488; outline-offset: 2px; }
`;
const NewBtn = styled.button`
  width: 32px; height: 32px;
  display: inline-flex; align-items: center; justify-content: center;
  background: #14B8A6; color: #fff; border: none; border-radius: 8px; cursor: pointer;
  transition: background 0.15s;
  &:hover { background: #0D9488; }
  &:focus-visible { outline: 2px solid #0D9488; outline-offset: 2px; }
`;
// 사이클 N+22 — + 드롭다운 (빈 문서 / 표)
const NewBtnWrap = styled.div`position: relative;`;
const NewDropdown = styled.div`
  position: absolute; top: calc(100% + 6px); right: 0;
  min-width: 220px;
  background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 10px;
  box-shadow: 0 8px 24px -6px rgba(15,23,42,0.18);
  z-index: 100; overflow: hidden;
  animation: pqDocsNewDdFade 0.12s ease-out;
  @keyframes pqDocsNewDdFade { from { opacity: 0; } to { opacity: 1; } }
  /* 모바일 — 헤더 아래 우측 정렬 */
  @media (max-width: 640px) {
    position: fixed;
    top: 68px;
    right: 16px;
    left: auto;
    min-width: auto;
    width: 200px;
  }
`;
const NewItem = styled.button`
  display: block; width: 100%; text-align: left;
  padding: 10px 14px;
  background: transparent; border: none; cursor: pointer;
  &:hover { background: #F8FAFC; }
  &:focus-visible { background: #F0FDFA; outline: none; }
  & + & { border-top: 1px solid #F1F5F9; }
`;
const NewItemTitle = styled.div`font-size: 13px; font-weight: 600; color: #0F172A;`;
const NewItemDesc = styled.div`font-size: 11px; color: #94A3B8; margin-top: 2px;`;
const ModalBackdrop = styled.div`
  position: fixed; inset: 0; background: rgba(15,23,42,0.08);
  z-index: 60;
`;
const ModalDialog = styled.div`
  position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
  z-index: 70; width: 540px; max-width: calc(100vw - 40px); max-height: calc(100vh - 48px);
  background: #FFF; border-radius: 14px;
  box-shadow: 0 30px 60px -20px rgba(15,23,42,0.25);
  display: flex; flex-direction: column; overflow: hidden;
  /* 모바일 — Q Calendar 패턴: 헤더(70px) 아래로 배치 */
  @media (max-width: 640px) {
    top: 70px; bottom: 20px; left: 16px; right: 16px;
    transform: none; width: auto; max-width: none; max-height: none;
  }
`;
const ModalHead = styled.div`
  display:flex;justify-content:space-between;align-items:center;
  padding: 14px 18px; border-bottom: 1px solid #E2E8F0; flex-shrink: 0;
`;
const ModalTitle = styled.h2`font-size:15px;font-weight:700;color:#0F172A;margin:0;letter-spacing:-0.1px;`;
const ModalClose = styled.button`
  width:30px;height:30px;border:none;background:transparent;color:#64748B;cursor:pointer;border-radius:6px;
  display:flex;align-items:center;justify-content:center;
  &:hover{background:#F1F5F9;color:#0F172A;}
`;
const ModalBody = styled.div`
  padding: 16px 18px; overflow-y: auto; flex: 1; min-height: 0;
  display: flex; flex-direction: column; gap: 14px;
`;
const ModalSub = styled.p`font-size:12px;color:#64748B;margin:0;line-height:1.5;`;
const TplGrid = styled.div`display:grid;grid-template-columns:repeat(2,1fr);gap:8px;flex:1;overflow-y:auto;@media(max-width:520px){grid-template-columns:1fr;}`;
const TplCard = styled.button`
  display:flex;gap:10px;padding:12px;font-family:inherit;text-align:left;
  background:#FFF;border:1px solid #E2E8F0;border-radius:10px;cursor:pointer;
  transition:border-color 0.15s,background 0.15s;
  &:hover{border-color:#14B8A6;background:#F0FDFA;}
`;
const TplCardIcon = styled.div`flex:0 0 auto;color:#0F766E;display:inline-flex;align-items:flex-start;`;
const TplBadgeSys = styled.span`flex:0 0 auto;font-size:10px;font-weight:700;color:#0F766E;background:#F0FDFA;border:1px solid #14B8A6;border-radius:999px;padding:1px 8px;align-self:flex-start;`;
const TplSearchInput = styled.input`
  width:100%;padding:8px 12px;font-size:13px;color:#0F172A;
  border:1px solid #E2E8F0;border-radius:8px;background:#FFF;margin-bottom:12px;
  &:focus{outline:none;border-color:#14B8A6;}
  &::placeholder{color:#94A3B8;}
`;
const IconBtn = styled.button`
  width:32px;height:32px;display:inline-flex;align-items:center;justify-content:center;
  background:#FFF;border:1px solid #E2E8F0;border-radius:8px;color:#475569;cursor:pointer;transition:border-color 0.15s,color 0.15s;
  &:hover{border-color:#14B8A6;color:#0F766E;}
  &:focus-visible{outline:2px solid #14B8A6;outline-offset:2px;}
`;
const PinDot = styled.span`
  display:inline-block;width:6px;height:6px;border-radius:50%;background:#F43F5E;margin-right:6px;flex:0 0 auto;
`;
const ParentLink = styled.a`
  display: inline-flex; align-items: center;
  margin-left: 12px;
  padding: 2px 10px;
  font-size: 11px; font-weight: 600;
  color: #0F766E;
  background: #F0FDFA;
  border: 1px solid #CCFBF1;
  border-radius: 999px;
  text-decoration: none;
  transition: background 0.15s;
  &:hover { background: #CCFBF1; }
`;
const SaveTplField = styled.div`display:flex;flex-direction:column;gap:6px;margin-bottom:10px;`;
const SaveTplLabel = styled.label`font-size:12px;font-weight:600;color:#0F172A;`;
const SaveTplError = styled.div`font-size:12px;color:#DC2626;background:#FEF2F2;padding:8px 10px;border-radius:6px;margin-bottom:8px;`;
const ModalFooter = styled.div`
  padding: 12px 18px; border-top: 1px solid #E2E8F0;
  display: flex; justify-content: flex-end; gap: 8px; flex-shrink: 0;
`;
const TplCardBody = styled.div`flex:1;min-width:0;`;
const TplCardName = styled.div`font-size:13px;font-weight:600;color:#0F172A;margin-bottom:2px;`;
const TplCardDesc = styled.div`font-size:11px;color:#64748B;line-height:1.4;`;
const Empty = styled.div`grid-column:1/-1;padding:32px;text-align:center;color:#94A3B8;font-size:13px;`;
const SearchWrap = styled.div`
  padding: 12px 16px 8px; border-bottom: 1px solid #F1F5F9;
`;
const FilterSection = styled.div`
  padding: 10px 16px; border-bottom: 1px solid #F1F5F9;
  display: flex; flex-wrap: wrap; gap: 6px; align-items: center;
  max-height: 160px; overflow-y: auto;
`;
const FilterGroupLabel = styled.div`
  width: 100%; font-size: 10px; font-weight: 700; color: #94A3B8;
  text-transform: uppercase; letter-spacing: 0.3px;
  margin-top: 4px;
  &:first-child { margin-top: 0; }
`;
const Chip = styled.button<{ $active: boolean }>`
  all: unset; cursor: pointer;
  display: inline-flex; align-items: center; gap: 4px;
  padding: 4px 10px; border-radius: 999px;
  background: ${p => p.$active ? '#14B8A6' : '#F1F5F9'};
  color: ${p => p.$active ? '#fff' : '#475569'};
  border: 1px solid ${p => p.$active ? '#14B8A6' : 'transparent'};
  font-size: 11px; font-weight: 600;
  transition: all 0.15s;
  &:hover { background: ${p => p.$active ? '#0D9488' : '#E2E8F0'}; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 2px; }
`;
const Count = styled.span`
  background: rgba(15, 23, 42, 0.08); color: #64748B;
  padding: 0 6px; border-radius: 999px; font-size: 10px; font-weight: 700;
  ${Chip}[data-active="true"] & { background: rgba(255, 255, 255, 0.25); color: #fff; }
`;
const ColorDot = styled.span<{ $color: string }>`
  width: 6px; height: 6px; border-radius: 50%; background: ${p => p.$color};
`;
const AddCatBtn = styled.button`
  all: unset; cursor: pointer;
  display: inline-flex; align-items: center;
  padding: 4px 10px; border-radius: 999px;
  background: transparent; color: #0F766E;
  border: 1px dashed #99F6E4;
  font-size: 11px; font-weight: 600;
  transition: all 0.15s;
  &:hover { background: #F0FDFA; border-color: #14B8A6; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 2px; }
`;
const NewCatInput = styled.input`
  height: 24px; padding: 0 10px; border: 1px solid #14B8A6; border-radius: 999px;
  background: #fff; font-size: 11px; color: #0F172A; min-width: 140px;
  &:focus { outline: none; box-shadow: 0 0 0 2px rgba(20,184,166,0.2); }
`;

// 리스트 (세로 무제한 스크롤)
const RowList = styled.div`
  flex: 1; min-height: 0;
  display: flex; flex-direction: column;
  overflow-y: auto;
  /* Q Talk/Mail/Note 리스트와 통일 — 둥근 행이 측면 여백 갖도록 (Irene: Q docs만 선 스타일이라 달랐음) */
  padding: 6px 6px 12px;
`;
// 프로젝트 문서 탭 browse 컨테이너 — 파일 탭(DocsTab) Body 흐름과 동일: 배경 #F8FAFC + padding 20 +
//   세로 flex(gap 12: Toolbar + Split). 내부는 공용 assetTabLayout(AtToolbar/AtSplit/AtPanel/AtArea/AtGrid/AtCard)
//   을 그대로 써서 파일 탭과 좌측 패널·카드·간격·툴바가 픽셀 동일. Layout 이 고정 높이라 자체 스크롤.
const ProjBrowse = styled.div`
  min-height: 0; height: 100%; overflow-y: auto;
  background: #F8FAFC; padding: 20px;
  display: flex; flex-direction: column; gap: 12px;
  @media (max-width: 900px) { padding: 16px; }
`;
// Q Talk ChatRow / Mail ThreadItem 정확값 — 둥근 행, active=#F0FDFA + inset 3px 0 0 #0D9488, hover #F8FAFC.
// 가로 구분선 제거(Q docs만 선 스타일이라 달랐다 — Irene 통일 지시).
const RowItem = styled.button<{ $active: boolean; $project?: boolean }>`
  all: unset; cursor: pointer; position: relative; display: block; width: 100%; box-sizing: border-box;
  padding: 10px 12px;
  padding-right: ${p => p.$project ? '40px' : '12px'};
  margin: 2px 0;
  border-radius: 10px;
  background: ${p => p.$active ? '#F0FDFA' : 'transparent'};
  ${p => p.$active && 'box-shadow: inset 3px 0 0 #0D9488;'}
  transition: background 0.1s;
  &:hover { ${p => !p.$active && 'background: #F8FAFC;'} }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: -2px; }
`;
// 행에서 '상단 메뉴에 추가(고정)' 토글 — 우측 상단 코너. 켜짐=teal, 꺼짐=흐린 회색(hover 시 진해짐).
const RowPinBtn = styled.button<{ $on: boolean }>`
  position: absolute; top: 8px; right: 8px;
  width: 28px; height: 28px; padding: 0; border: none; border-radius: 6px;
  display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer; font-size: 13px; line-height: 1;
  background: ${p => p.$on ? '#F0FDFA' : 'transparent'};
  filter: ${p => p.$on ? 'none' : 'grayscale(1) opacity(0.4)'};
  transition: filter 0.15s ease, background 0.15s ease;
  &:hover { background: #F0FDFA; filter: none; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 2px; }
`;
// 운영 #257 — 제목이 길어도 1줄로 잘려 읽기 어려웠다(특히 프로젝트 > 문서).
//   2줄까지 보여주고 그 다음부터 말줄임. 뱃지(고정·임시저장)는 제목과 같은 흐름에 놓아
//   짧은 제목일 때 빈 줄이 생기지 않게 한다(높이는 내용만큼만).
//   ★ 이 컴포넌트는 Q docs 와 프로젝트 > 문서 탭이 함께 쓴다 — 한 번 고치면 두 화면에 같이 적용된다.
const RowTitle = styled.div`
  font-size: 13px; font-weight: 700; color: #0F172A;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  overflow: hidden; overflow-wrap: anywhere; line-height: 1.45;
  > * { vertical-align: middle; margin-right: 4px; }
`;
const RowPreview = styled.div`
  margin-top: 4px; font-size: 12px; color: #64748B; line-height: 1.5;
  overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
`;
// N+72 — 리스트 row vlevel chip + share mini
const RowVisChip = styled.span<{ $level: string }>`
  display: inline-flex; align-items: center;
  padding: 1px 7px; border-radius: 8px;
  font-size: 10px; font-weight: 600;
  background: ${p => p.$level === 'L1' ? '#F1F5F9' : p.$level === 'L2' ? '#FEF3C7' : p.$level === 'L4' ? '#FCE7F3' : '#CCFBF1'};
  color: ${p => p.$level === 'L1' ? '#475569' : p.$level === 'L2' ? '#92400E' : p.$level === 'L4' ? '#9F1239' : '#0F766E'};
`;
// N+72-7 — 본문↔표 사이 시각 간격 (사용자 호소 "들러붙어 보기 안좋아")
const SectionGap = styled.div`
  height: 24px;
`;
// 운영 — AI 재생성 바 행 (에디터 상단)
const AiRegenRow = styled.div`
  display: flex; margin-bottom: 10px;
`;
// N+72-7 — 문서/표 kind toggle (편집 모드 MetaRow)
const KindToggle = styled.div`
  display: inline-flex;
  border: 1px solid #E2E8F0;
  border-radius: 8px;
  overflow: hidden;
  background: #F8FAFC;
`;
const KindBtn = styled.button<{ $active: boolean }>`
  display: inline-flex; align-items: center; gap: 5px;
  height: 32px; padding: 0 12px;
  background: ${p => p.$active ? '#FFFFFF' : 'transparent'};
  color: ${p => p.$active ? '#0F766E' : '#64748B'};
  border: none;
  font-size: 12px; font-weight: 600;
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
  box-shadow: ${p => p.$active ? '0 1px 2px rgba(0,0,0,0.06)' : 'none'};
  &:hover { color: ${p => p.$active ? '#0F766E' : '#334155'}; }
  & + & { border-left: 1px solid #E2E8F0; }
`;
// N+72-7 — 헤더 공개범위 chip (RowVisChip 보다 크고 button 형태, 클릭=변경)
const ShareMini = styled.span`font-size: 11px; cursor: help;`;
const RowMeta = styled.div`
  margin-top: 6px;
  display: flex; align-items: center; gap: 4px;
  font-size: 11px; color: #94A3B8; flex-wrap: wrap;
`;
const Dim = styled.div`padding: 24px 16px; color: #94A3B8; font-size: 12px; text-align: center;`;

const Content = styled.section<{ $hasDetail?: boolean; $projectFull?: boolean }>`
  display: flex; flex-direction: column;
  min-height: 0; overflow: hidden;
  background: #fff;
  /* 프로젝트: 우측 영역 — 문서 미선택 시 카드 그리드(browse), 선택 시 상세/편집 */
  /* 모바일에서 문서 미선택 시 Content 숨기고 리스트만 표시 */
  @media (max-width: 900px) {
    display: ${p => p.$hasDetail ? 'flex' : 'none'};
    /* 모바일: 헤더+본문 함께 스크롤 */
    overflow-y: auto;
  }
`;
const Body = styled.div`
  flex: 1; min-height: 0;
  /* 좌우 0 — 에디터 툴바·구분선이 좌우 끝까지 풀폭. 글자 안쪽 여백은 아래 규칙으로 통일(Irene).
     에디터(.pq-fullbleed)만 풀폭 유지(자체 본문 여백), 그 외 모든 섹션은 좌우 24px. */
  /* 위 여백과 sticky 기준을 **한 변수에서** 파생시킨다 — 따로 적으면 언젠가 갈라져 툴바가 다시 뜬다 */
  --pq-body-pad-top: 20px;
  --pq-sticky-top: calc(var(--pq-body-pad-top) * -1);
  padding: var(--pq-body-pad-top) 0 20px;
  overflow-y: auto;
  background: #fff;
  display: flex; flex-direction: column; gap: 16px;
  & > *:not(.pq-fullbleed) { padding-left: 24px; padding-right: 24px; }
  @media (max-width: 900px) {
    /* 모바일: Content가 스크롤하므로 Body는 스크롤 안 함 */
    overflow-y: visible;
    padding: 16px 0;
  }
`;
const TitleInput = styled.input`
  flex: 1; height: 32px; padding: 0 10px;
  background: #fff; border: 1px solid #E2E8F0; border-radius: 8px;
  font-size: 15px; font-weight: 700; color: #0F172A;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 2px rgba(20,184,166,0.15); }
`;
const EditActions = styled.div`
  display: flex; gap: 8px; flex-wrap: wrap; align-items: center;
  @media (max-width: 640px) { gap: 6px; }
`;
// #252 임시저장 상태 표시 — AutoSaveField 의 뱃지 톤과 동일 (성공 회색 ✓ / 실패 붉은 !).
const AutoSaveMark = styled.span<{ $tone: 'ok' | 'err' }>`
  font-size: 12px; white-space: nowrap;
  color: ${p => (p.$tone === 'err' ? '#DC2626' : '#94A3B8')};
  /* ★ 모바일에서 숨기지 않는다 — 실패·충돌이 안 보이면 저장된 줄 알고 창을 닫는다(조용한 실패 금지).
     좁은 화면에서는 글자만 줄인다. */
  @media (max-width: 640px) { font-size: 11px; }
`;
// #252 — 목록의 임시저장(draft) 행 표시. 이 행은 작성자에게만 보인다(백엔드 필터).
const DraftTag = styled.span`
  display: inline-flex; align-items: center; flex-shrink: 0;
  margin-right: 6px; padding: 1px 6px;
  background: #FFF7ED; color: #C2410C; border: 1px solid #FED7AA;
  border-radius: 999px; font-size: 10px; font-weight: 700; line-height: 16px;
`;
// 상세 메타 — 헤더 아래 한 줄 MetaBar. 좌(작성자·날짜·분류·프로젝트) ↔ 우(공개·공유·보안). (Irene)
// 구분선은 좌우 끝까지(풀폭), 글자만 좌우 24px 안쪽.
const ViewMeta = styled.div`
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  font-size: 12px; color: #94A3B8;
  padding-bottom: 12px; border-bottom: 1px solid #F1F5F9;
  /* ★ 2026-08-25 (Irene: "Q 문서 상세도 가면 서브헤더 엉망이야. 완전 심해")
     좌(작성자·날짜·분류·프로젝트) ↔ 우(공개·공유·보안) 를 space-between 으로 밀어 두고
     양쪽 다 wrap 을 허용하면, 폰 폭에서는 두 덩어리가 서로 밀며 줄이 엉킨다.
     폰에서는 **두 줄로 분리**한다 — 1행 정보, 2행 액션. 서로 폭을 다투지 않게. */
  @media (max-width: 640px) {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
    > * { width: 100%; }
  }
`;
const MetaLeft = styled.div`display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0;`;
const MetaRight = styled.div`display: flex; align-items: center; gap: 8px; flex-wrap: wrap; flex-shrink: 0;`;
// D4 #62 — 보안등급 선택 행 (DocsTab files 패턴 정합)
// 태그
// 이모지 금지(UI_DESIGN_GUIDE §1.5) — feather 계열 stroke 아이콘으로 교체.
const PinTag = styled.span`display: inline-flex; align-items: center; color: #0D9488;`;
const ProjectTag = styled.span<{ $color: string }>`
  display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px;
  background: #F1F5F9; color: #475569; border-radius: 999px; font-size: 10px; font-weight: 600;
  &::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: ${p => p.$color}; }
`;
const CategoryTag = styled.button`
  all: unset; cursor: pointer;
  display: inline-flex; align-items: center; padding: 2px 8px;
  background: #F0FDFA; color: #0F766E;
  border-radius: 999px; font-size: 11px; font-weight: 600;
  &:hover { background: #CCFBF1; }
`;
// 편집 메타 — 한 줄(카테고리·프로젝트·형태·공개·보안). 좁으면 wrap. (Irene: 한 줄로)
// 한 줄에 서는 입력/셀렉트 칸 — 폭을 묶어 카테고리가 행을 독점하지 않게. 좁아지면 함께 줄고 접힌다.
//   ★ MetaRow 보다 **먼저** 선언해야 한다 — 아래에서 컴포넌트 선택자(`${MetaField}`)로 참조한다.
const MetaField = styled.div<{ $basis: number }>`
  flex: 1 1 ${(p) => p.$basis}px;
  min-width: 150px;
  max-width: ${(p) => p.$basis + 80}px;
  @media (max-width: 640px) { flex-basis: 100%; max-width: none; }
`;
// 구분선 풀폭, 글자만 좌우 24px 안쪽.
const MetaRow = styled.div`
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 0;
  padding-bottom: 12px; border-bottom: 1px solid #F1F5F9;
  /* ★ 칩·토글은 줄어들면 글자가 잘리므로 고정. 입력·셀렉트는 MetaField 가 스스로 줄어든다. */
  & > *:not(${MetaField}) { flex-shrink: 0; }
`;
// N+67 — visibility chip (PostsPage detail meta row)
const VisibilityChip = styled.button`
  display: inline-flex; align-items: center; gap: 4px;
  background: #F1F5F9; color: #475569;
  border: 1px solid #CBD5E1;
  border-radius: 12px;
  padding: 2px 10px;
  font-size: 11px; font-weight: 600;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
  &:hover { background: #E2E8F0; border-color: #94A3B8; }
  &:focus-visible { outline: 2px solid #5EEAD4; outline-offset: 2px; }
`;
const ShareTag = styled.span`
  display: inline-flex; align-items: center; padding: 2px 8px;
  background: #FFF7ED; color: #C2410C; border-radius: 999px; font-size: 10px; font-weight: 700;
  border: 1px solid #FED7AA;
`;
const CategoryMini = styled.span`
  display: inline-flex; padding: 1px 6px; background: #F0FDFA; color: #0F766E;
  border-radius: 999px; font-size: 10px; font-weight: 600;
`;

// 첨부 섹션 — 외곽 박스 없음, 상단 구분선으로 영역만 분리
const AttachSection = styled.section`
  margin-top: 12px;
  padding-top: 16px;
  border-top: 1px solid #E2E8F0;
  display: flex; flex-direction: column; gap: 12px;
`;
const AttachTitle = styled.div`font-size: 13px; font-weight: 700; color: #334155;`;
const AttachList = styled.div`
  display: flex; flex-direction: column;
  background: #fff; border: 1px solid #E2E8F0; border-radius: 8px; overflow: hidden;
`;
const AttachRow = styled.div`
  display: flex; align-items: center; gap: 10px; padding: 10px 12px;
  border-bottom: 1px solid #F1F5F9;
  &:last-child { border-bottom: none; }
  &:hover { background: #F8FAFC; }
`;
const AttachName = styled.a`
  flex: 1; min-width: 0; font-size: 13px; color: #0F172A; text-decoration: none;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left;
  &:hover { color: #0F766E; text-decoration: underline; }
`;
const RemoveBtn = styled.button`
  all: unset; cursor: pointer; width: 22px; height: 22px;
  display: flex; align-items: center; justify-content: center;
  color: #94A3B8; border-radius: 4px; font-size: 16px;
  &:hover { background: #FEE2E2; color: #DC2626; }
`;

const ErrorBar = styled.div`font-size: 12px; color: #DC2626; background: #FEF2F2; padding: 8px 12px; border-radius: 6px;`;
// 표 설명 — 열기/닫기 통합 full-width 헤더 바(라운드·이질감 제거, flat 통일). (Irene)
const DescToggleHeader = styled.button`
  display: flex; align-items: center; justify-content: space-between; width: 100%;
  padding: 10px 24px; text-align: left;
  background: #F8FAFC; border: none;
  border-bottom: 1px solid #F1F5F9;
  cursor: pointer; transition: background 0.15s;
  &:hover { background: #F1F5F9; }
`;
const DescBoxLabel = styled.span`
  font-size: 11px; font-weight: 700; color: #64748B;
  text-transform: uppercase; letter-spacing: 0.05em;
`;
const DescChevron = styled.span<{ $open?: boolean }>`
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 11px; font-weight: 600; color: #64748B;
  svg { transition: transform 0.18s ease; transform: rotate(${p => p.$open ? '180deg' : '0deg'}); }
`;

// 버튼 — PanelHeader 60px (padding 14*2=28 + 32 content) 와 일치하도록 32px
const PrimaryBtn = styled.button`
  height: 32px; padding: 0 14px; background: #14B8A6; color: #fff; border: none; border-radius: 8px;
  font-size: 13px; font-weight: 600; cursor: pointer; white-space: nowrap;
  display: inline-flex; align-items: center;
  &:hover:not(:disabled) { background: #0D9488; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
// 편집 — 문서 화면에서 가장 자주 쓰는 액션이라 글자 버튼(중립 톤). 공유(Primary teal)와 색으로 구분한다.
const EditBtn = styled.button`
  height: 32px; padding: 0 14px;
  display: inline-flex; align-items: center; white-space: nowrap;
  font-size: 13px; font-weight: 600; color: #334155;
  background: #FFFFFF; border: 1px solid #CBD5E1; border-radius: 8px; cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
  &:hover:not(:disabled) { background: #F8FAFC; border-color: #94A3B8; color: #0F172A; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 2px; }
`;
const SignBtn = styled.button`
  height: 32px; padding: 0 14px;
  display: inline-flex; align-items: center; white-space: nowrap;
  font-size: 13px; font-weight: 700; color: #0F766E;
  background: #F0FDFA; border: 1px solid #14B8A6; border-radius: 8px; cursor: pointer;
  transition: background 0.15s, color 0.15s, transform 0.15s;
  &:hover:not(:disabled) { background: #14B8A6; color: #fff; transform: translateY(-1px); }
  &:focus-visible { outline: 2px solid #0D9488; outline-offset: 2px; }
`;
const LeaveBlockedNote = styled.span`
  display:inline-flex; align-items:center; max-width:340px;
  padding:4px 10px; border-radius:8px;
  font-size:12px; font-weight:600; line-height:1.4;
  color:#B91C1C; background:#FEE2E2; border:1px solid #FCA5A5;
`;
const SecondaryBtn = styled.button`
  height: 32px; padding: 0 14px; background: #fff; color: #0F172A; white-space: nowrap;
  border: 1px solid #CBD5E1; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer;
  &:hover:not(:disabled) { background: #F8FAFC; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
// 모바일 제목 행 — 뒤로가기 + 제목을 한 줄에
const TitleRow = styled.div`
  display: flex;
  align-items: center;
  min-width: 0;
  flex: 1;
`;
// 모바일 뒤로가기 버튼 — 데스크톱에서는 숨김, 제목과 인라인
const MobileBackBtn = styled.button<{ $always?: boolean }>`
  display: ${p => p.$always ? 'flex' : 'none'};
  align-items: center; justify-content: center;
  width: 28px; height: 28px; flex-shrink: 0; margin-right: 4px;
  background: transparent; border: none; color: #64748B; cursor: pointer;
  border-radius: 6px;
  &:hover { background: #F1F5F9; color: #0F172A; }
  @media (max-width: 900px) {
    display: flex;
  }
`;
const KnowledgeToast = styled.div`
  position: fixed; bottom: 24px; right: 24px;
  padding: 10px 16px;
  background: #0F172A; color: #FFFFFF;
  border-radius: 8px; font-size: 13px; font-weight: 500;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  z-index: 60;
  animation: fadeInUp 0.2s ease-out;
  @keyframes fadeInUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
`;

// 동시 편집 표시 칩 — 편집 헤더에 인라인. 초록 점 = 지금 접속해 편집 중.
const PresenceChip = styled.span`
  display: inline-flex; align-items: center; gap: 5px;
  padding: 3px 9px; margin-left: 6px;
  font-size: 11.5px; font-weight: 600; color: #0F766E;
  background: #F0FDFA; border: 1px solid #99F6E4; border-radius: 999px;
  white-space: nowrap;
`;
const PresenceDot = styled.span`
  width: 6px; height: 6px; border-radius: 50%; background: #14B8A6; flex-shrink: 0;
`;

// 충돌 해결 바 — 뱃지만 띄우면 사용자는 막다른 길에 갇힌다(저장도 이동도 불가).
const StaleBar = styled.div`
  display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 6px 10px; margin-left: 8px;
  background: #FEF2F2; border: 1px solid #FECACA; border-radius: 8px;
  font-size: 12px; color: #991B1B;
`;
const StaleBtn = styled.button<{ $danger?: boolean }>`
  height: 28px; padding: 0 10px; border-radius: 6px; cursor: pointer;
  font-size: 12px; font-weight: 700; white-space: nowrap;
  color: ${(p) => (p.$danger ? '#B91C1C' : '#0F766E')};
  background: #fff;
  border: 1px solid ${(p) => (p.$danger ? '#FECACA' : '#99F6E4')};
  &:hover { background: ${(p) => (p.$danger ? '#FEF2F2' : '#F0FDFA')}; }
`;
