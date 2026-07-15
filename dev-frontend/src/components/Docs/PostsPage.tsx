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
import { useTimeFormat } from '../../hooks/useTimeFormat';
import SearchBox from '../Common/SearchBox';
import PanelHeader, { PanelTitle, PanelSubTitle } from '../Layout/PanelHeader';
import AttachmentField from '../Common/AttachmentField';
import CategoryCombobox from '../Common/CategoryCombobox';
import EmptyState from '../Common/EmptyState';
import { uploadMyFile, uploadProjectFile } from '../../services/files';
import ConfirmDialog from '../Common/ConfirmDialog';
import PostEditor from './PostEditor';
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
  fetchPosts, fetchPost, createPost, updatePost, deletePost,
  attachToPost, detachFromPost, fetchPostsMeta,
  createCategory, updatePostVisibility, updatePostSecurityLevel,
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
  const [shareOpen, setShareOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  // 운영 — Q docs AI 재생성: 생성 컨텍스트 보관 + 재생성 busy
  const [aiCtx, setAiCtx] = useState<{ kind: string; userInput: string; clientId?: number | null; projectId?: number | null } | null>(null);
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
  const [projects, setProjects] = useState<ApiProject[]>([]);
  // 템플릿 모달 — 새 글 작성 시 시드 5종 중 선택해서 본문 prefill
  const [tplModalOpen, setTplModalOpen] = useState(false);
  const [templates, setTemplates] = useState<DocTemplate[]>([]);
  // 사이클 I2 — Phase F 슬롯 폼
  const [slotTplId, setSlotTplId] = useState<number | null>(null);
  const [tplSearch, setTplSearch] = useState('');
  const { user } = useAuth();
  // N+30 — personal 도 scope.businessId 우선 사용 (multi-workspace 사용자 시 user.business_id fallback 잘못된 bizId 회귀 차단)
  const businessId = (scope.type === 'workspace' || scope.type === 'personal') ? scope.businessId : (user?.business_id ? Number(user.business_id) : null);
  // 템플릿 저장 모달 상태
  const [saveTplOpen, setSaveTplOpen] = useState(false);
  const [saveTplName, setSaveTplName] = useState('');
  const [saveTplDesc, setSaveTplDesc] = useState('');
  const [saveTplBusy, setSaveTplBusy] = useState(false);
  const [saveTplError, setSaveTplError] = useState<string | null>(null);

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
        if (activeId === postId) {
          const d = await fetchPost(postId);
          setDetail(d);
        }
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
        const isNewTable = searchParams.get('new_table') === '1' && d?.kind === 'table';
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

  const startNew = () => {
    setActiveId(null);
    setDetail(null);
    setMode('new');
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

  const startFromAi = ({ title, bodyHtml, aiContext }: { title: string; bodyHtml: string; aiContext?: { kind: string; userInput: string; clientId?: number | null; projectId?: number | null } }) => {
    setActiveId(null);
    setDetail(null);
    setMode('new');
    setTitleDraft(title);
    setContentDraft(bodyHtml as unknown);
    setCategoryDraft(filter.kind === 'category' ? filter.name : '');
    setPendingUploads([]);
    setPendingExistingIds([]);
    setPendingExistingMeta({});
    setPendingPostIds([]);
    setAiCtx(aiContext || null);  // 운영 — 재생성용 컨텍스트
    setError(null);
    setAiOpen(false);
  };

  // 운영 — Q docs AI 재생성: 보관한 컨텍스트 + 지시로 본문 재생성 (제목 유지, 본문 교체)
  const regenerateDoc = async (instruction: string) => {
    if (!aiCtx || regenBusy) return;
    setRegenBusy(true); setError(null);
    try {
      const r = await aiGenerateDoc({
        business_id: scope.businessId, kind: aiCtx.kind as DocKind, title: titleDraft.trim() || (t('ai.untitledDoc', { defaultValue: '문서' }) as string),
        user_input: aiCtx.userInput, client_id: aiCtx.clientId, project_id: aiCtx.projectId,
        instruction: instruction || undefined,
      });
      setContentDraft(r.body_html as unknown);
    } catch (e) {
      setError((e as Error).message || (t('ai.regenFailed', '재생성 실패. 잠시 후 다시 시도해 주세요.') as string));
    } finally { setRegenBusy(false); }
  };

  const startFromTemplate = (tpl: DocTemplate) => {
    // 사이클 I2 — schema_json 슬롯이 있으면 SlotFormModal 먼저, 없으면 기존 흐름
    const sj = (tpl as unknown as { schema_json?: unknown }).schema_json;
    const hasSlots = Array.isArray(sj) && sj.length > 0;
    if (hasSlots && tpl.id) {
      setTplModalOpen(false);
      setSlotTplId(tpl.id);
      return;
    }
    setActiveId(null);
    setDetail(null);
    setMode('new');
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
  const handleSlotConfirm = (rendered: { html: string; title: string }) => {
    setActiveId(null);
    setDetail(null);
    setMode('new');
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
    setMode('edit');
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

  const cancelEdit = () => {
    if (mode === 'new') {
      setMode('view');
      setTitleDraft('');
      setContentDraft(null);
      setCategoryDraft('');
      setProjectDraft(null);
      setPendingUploads([]);
      setPendingExistingIds([]);
      setPendingExistingMeta({});
    } else if (detail) {
      setMode('view');
      setTitleDraft(detail.title);
      setContentDraft(detail.content_json);
      setCategoryDraft(detail.category || '');
      setProjectDraft(detail.project_id);
    }
    setError(null);
  };

  const submit = async () => {
    if (submittingRef.current) return;
    if (!titleDraft.trim()) { setError(t('validation.titleRequired', '제목을 입력하세요') as string); return; }
    submittingRef.current = true;
    setSaving(true); setError(null);
    try {
      const categoryVal = categoryDraft.trim() || null;
      if (mode === 'new') {
        // 프로젝트 scope 는 자동 강제, 워크스페이스 scope 면 사용자 선택값
        const projectId = scope.type === 'project' ? scope.projectId : projectDraft;
        const created = await createPost({
          business_id: scope.businessId,
          project_id: projectId,
          title: titleDraft.trim(),
          content_json: contentDraft as any,
          category: categoryVal,
        });
        // 신규 작성 시 예약된 첨부를 한 번에 처리
        const fileIdsToAttach: number[] = [...pendingExistingIds];
        if (pendingUploads.length > 0) {
          for (const f of pendingUploads) {
            const result = scope.type === 'project'
              ? await uploadProjectFile(scope.businessId, scope.projectId, f)
              : await uploadMyFile(scope.businessId, f);
            if (result.success && result.file) {
              const fid = Number(result.file.id.replace(/^direct-/, ''));
              if (fid) fileIdsToAttach.push(fid);
            }
          }
        }
        let final = created;
        if (fileIdsToAttach.length > 0) {
          await attachToPost(created.id, fileIdsToAttach);
          final = (await fetchPost(created.id)) || created;
        }
        setDetail(final);
        setActiveId(final.id);
        setMode('view');
        setPendingUploads([]);
        setPendingExistingIds([]);
        setPendingExistingMeta({});
        await load(); await loadMeta();
      } else if (mode === 'edit' && detail) {
        const patched = await updatePost(detail.id, {
          title: titleDraft.trim(),
          content_json: contentDraft as any,
          category: categoryVal,
          linked_post_ids: pendingPostIds,
          // 프로젝트 scope 페이지에선 project_id 변경 막기 (강제 유지)
          ...(scope.type === 'workspace' ? { project_id: projectDraft } : {}),
        });
        setDetail(patched);
        setMode('view');
        await load(); await loadMeta();
      }
    } catch (e) { setError((e as Error).message); }
    finally { submittingRef.current = false; setSaving(false); }
  };

  const onDelete = async () => {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    setDeleteTarget(null);
    await deletePost(id);
    setActiveId(null);
    setDetail(null);
    await load(); await loadMeta();
  };

  const detachOne = async (attId: number) => {
    if (!detail) return;
    await detachFromPost(detail.id, attId);
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
                    <AtCard key={r.id} $selected={activeId === r.id} onClick={() => setActiveId(r.id)}>
                      <RowPinBtn type="button" $on={pinnedIds.includes(r.id)} onClick={(e) => { e.stopPropagation(); togglePin(r.id); }}
                        aria-label={(pinnedIds.includes(r.id) ? t('project.docs.removeFromMenu', '상단 메뉴에서 제거') : t('project.docs.addToMenu', '상단 메뉴에 추가')) as string}
                        title={(pinnedIds.includes(r.id) ? t('project.docs.removeFromMenu', '상단 메뉴에서 제거') : t('project.docs.addToMenu', '상단 메뉴에 추가')) as string}>📌</RowPinBtn>
                      <AtCardName>{r.title}</AtCardName>
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
                $active={activeId === r.id}
                $project={isProject}
                onClick={() => setActiveId(activeId === r.id ? null : r.id)}
              >
                {isProject && (
                  <RowPinBtn
                    type="button"
                    $on={pinnedIds.includes(r.id)}
                    onClick={(e) => { e.stopPropagation(); togglePin(r.id); }}
                    aria-label={(pinnedIds.includes(r.id) ? t('project.docs.removeFromMenu', '상단 메뉴에서 제거') : t('project.docs.addToMenu', '상단 메뉴에 추가')) as string}
                    title={(pinnedIds.includes(r.id) ? t('project.docs.removeFromMenu', '상단 메뉴에서 제거') : t('project.docs.addToMenu', '상단 메뉴에 추가')) as string}
                  >📌</RowPinBtn>
                )}
                <RowTitle>
                  {r.is_pinned && <PinTag>📌</PinTag>}
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
                <SecondaryBtn type="button" disabled={saving} onClick={cancelEdit}>{t('cancel', '취소')}</SecondaryBtn>
                <PrimaryBtn type="button" disabled={saving || !titleDraft.trim()} onClick={submit}>
                  {saving ? t('saving', '저장 중…') : t('save', '저장')}
                </PrimaryBtn>
              </EditActions>
            </PanelHeader>
            <Body>
              <MetaRow>
                <CategoryCombobox
                  value={categoryDraft}
                  onChange={setCategoryDraft}
                  options={meta.categories.map(c => c.name)}
                  placeholder={t('categoryPlaceholder', '카테고리 (예: 매뉴얼, 가이드, 회의록)') as string}
                />
                {scope.type === 'workspace' && (
                  <PlanQSelect
                    size="sm"
                    options={projectOptions}
                    value={projectOptions.find(o => o.value === projectDraft) || null}
                    onChange={(opt) => setProjectDraft(opt ? Number((opt as PlanQSelectOption).value) : null)}
                    placeholder={t('share.linkage.noneProject', '프로젝트 연결 안 함') as string}
                    isClearable
                    isSearchable
                  />
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
              </MetaRow>
              {error && <ErrorBar>{error}</ErrorBar>}
              {detail?.kind === 'table' && detail.q_record_id ? (
                <>
                  {tableDescOpen ? (
                    <DescBox>
                      <DescBoxHeader>
                        <DescBoxLabel>{t('tableDescTitle', { defaultValue: '표 설명 에디터' }) as string}</DescBoxLabel>
                        <DescCloseBtn type="button" onClick={() => setTableDescOpen(false)}
                          title={t('tableDescClose', { defaultValue: '에디터 닫기' }) as string}
                          aria-label={t('tableDescClose', { defaultValue: '에디터 닫기' }) as string}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
                          <span>{t('tableDescCloseShort', { defaultValue: '닫기' }) as string}</span>
                        </DescCloseBtn>
                      </DescBoxHeader>
                      <PostEditor
                        value={contentDraft}
                        onChange={setContentDraft}
                        businessId={scope.businessId}
                        placeholder={t('tableDescPlaceholder', '표에 대한 설명을 입력하세요 (선택)') as string}
                        borderless
                      />
                    </DescBox>
                  ) : (
                    <DescToggleBtn type="button" onClick={() => setTableDescOpen(true)}>
                      + {t('tableDescOpen', { defaultValue: '표 설명 에디터 열기' }) as string}
                    </DescToggleBtn>
                  )}
                  {/* N+72-7 — 본문↔표 간격 (편집 모드) */}
                  <SectionGap />
                  <PostTableGrid recordId={detail.q_record_id} businessId={scope.businessId} />
                </>
              ) : (
                <>
                  {/* 운영 — AI 생성물 재생성 (지시 기반). AI 로 만든 새 문서일 때만 노출 */}
                  {mode === 'new' && aiCtx && (
                    <AiRegenRow>
                      <AiRegenerateBar busy={regenBusy} onRegenerate={regenerateDoc} />
                    </AiRegenRow>
                  )}
                  <PostEditor value={contentDraft} onChange={setContentDraft} businessId={scope.businessId} placeholder={t('contentPlaceholder', '본문을 작성하세요…') as string} />
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
                {/* N+72-7 — 30년차 UX 재구성. 공개=visibility (chip), 공유=share (외부). 자주 안 쓰는 액션은 IconBtn + 툴팁. */}
                {/* 1) 공개 범위 chip — 상태 표시 + 클릭 시 변경 모달 */}
                <VisChip type="button" onClick={() => setVisModalOpen(true)} title={t('visibility.changeHint', '공개 범위 변경') as string} $level={detail.vlevel || 'L3'}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/></svg>
                  {t('visibility.openLabel', '공개') as string}: {visLabel(detail.vlevel)}
                </VisChip>
                {/* 2) Primary 액션 — 자주 쓰는 것 */}
                <PrimaryBtn type="button" onClick={() => setShareOpen(true)} title={t('share.headerHint', '외부 사람과 공유 — 링크 / 이메일 / 만료') as string}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 4 }}><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
                  {t('share.button', '공유')}
                </PrimaryBtn>
                <SignBtn type="button" onClick={() => setSignOpen(true)} title={t('sign.headerHint', '서명자에게 이메일로 서명 요청') as string}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 4 }}><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>
                  {t('sign.button', '서명 받기')}
                </SignBtn>
                {/* 3) IconBtn + 툴팁 — 가끔 쓰는 것 */}
                <IconBtn type="button" onClick={startEdit} title={t('edit', '편집') as string} aria-label={t('edit', '편집') as string}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                </IconBtn>
                <IconBtn type="button" onClick={() => sendToKnowledge(detail)} title={t('actions.sendToKnowledge', 'Q knowledge 로 보내기 — Cue 가 답변 시 참조') as string} aria-label={t('actions.sendToKnowledge', 'Q knowledge 로 보내기') as string} disabled={knowledgeBusy}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 6.253v13"/><path d="M12 6.253C10.832 5.477 9.246 5 7.5 5 5.754 5 4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253"/><path d="M12 6.253C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18s-3.332.477-4.5 1.253"/></svg>
                </IconBtn>
                <IconBtn type="button" onClick={() => { setSaveTplName(detail.title); setSaveTplDesc(''); setSaveTplError(null); setSaveTplOpen(true); }} title={t('actions.saveAsTemplate', '템플릿으로 저장 — 다음 새 글 작성 시 검색해서 사용') as string} aria-label={t('actions.saveAsTemplate', '템플릿으로 저장') as string}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
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
              </ViewMeta>
              {/* D4 #62 — 보안등급 선택 (visibility 와 별개 축. 내부·기밀은 외부 공유 차단) */}
              <SecurityRow>
                <SecurityRowLabel>{t('securityLevel.label', { defaultValue: '보안등급' }) as string}</SecurityRowLabel>
                <div style={{ minWidth: 160 }}>
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
                </div>
                <SecHint>{t(`securityLevel.${detail.security_level || 'general'}Hint`, { defaultValue: '' }) as string}</SecHint>
              </SecurityRow>
              <div data-print-area>
                <PrintOnlyTitle>{detail.title}</PrintOnlyTitle>
                {detail.kind === 'table' && detail.q_record_id ? (
                  // 표 kind — 본문 설명(있으면) + Q record 그리드 (보기 모드: read-only)
                  <>
                    {detail.content_json && (
                      <PostEditor value={detail.content_json} onChange={() => {}} editable={false} />
                    )}
                    {/* N+72-7 — 본문↔표 사이 간격 (사용자 호소 "들러붙어 보기 안좋아") */}
                    {detail.content_json && <SectionGap />}
                    <PostTableGrid recordId={detail.q_record_id} businessId={scope.businessId} readOnly />
                  </>
                ) : (
                  <PostEditor value={detail.content_json} onChange={() => {}} editable={false} />
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
          onTableCreated={(id) => {
            // #96 — 표 생성 후 in-place 진입 (프로젝트 scope 에서도 페이지 이탈 없이). new_table=1 로 edit 모드.
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
const RowItem = styled.button<{ $active: boolean; $project?: boolean }>`
  all: unset; cursor: pointer; position: relative; display: block; width: 100%; box-sizing: border-box;
  padding: 12px 16px;
  padding-right: ${p => p.$project ? '44px' : '16px'};
  border-bottom: 1px solid #F1F5F9;
  background: ${p => p.$active ? '#F0FDFA' : 'transparent'};
  &:hover { background: ${p => p.$active ? '#F0FDFA' : '#F8FAFC'}; }
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
const RowTitle = styled.div`
  font-size: 13px; font-weight: 700; color: #0F172A;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  display: flex; align-items: center; gap: 4px;
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
const VisChip = styled.button<{ $level: string }>`
  display: inline-flex; align-items: center; gap: 5px;
  height: 28px; padding: 0 10px;
  background: ${p => p.$level === 'L1' ? '#F1F5F9' : p.$level === 'L2' ? '#FEF3C7' : p.$level === 'L4' ? '#FCE7F3' : '#CCFBF1'};
  color: ${p => p.$level === 'L1' ? '#475569' : p.$level === 'L2' ? '#92400E' : p.$level === 'L4' ? '#9F1239' : '#0F766E'};
  border: 1px solid ${p => p.$level === 'L1' ? '#CBD5E1' : p.$level === 'L2' ? '#FDE68A' : p.$level === 'L4' ? '#FBCFE8' : '#5EEAD4'};
  border-radius: 999px;
  font-size: 12px; font-weight: 600;
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s;
  &:hover { filter: brightness(0.97); }
`;
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
  padding: 24px 28px;
  overflow-y: auto;
  background: #F8FAFC;
  display: flex; flex-direction: column; gap: 16px;
  @media (max-width: 900px) {
    /* 모바일: Content가 스크롤하므로 Body는 스크롤 안 함 */
    overflow-y: visible;
    padding: 16px;
  }
`;
const TitleInput = styled.input`
  flex: 1; height: 32px; padding: 0 10px;
  background: #fff; border: 1px solid #E2E8F0; border-radius: 8px;
  font-size: 15px; font-weight: 700; color: #0F172A;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 2px rgba(20,184,166,0.15); }
`;
const EditActions = styled.div`
  display: flex; gap: 8px; flex-wrap: wrap;
  @media (max-width: 640px) { gap: 6px; }
`;
const ViewMeta = styled.div`
  display: flex; align-items: center; gap: 8px;
  font-size: 12px; color: #94A3B8; flex-wrap: wrap;
`;
// D4 #62 — 보안등급 선택 행 (DocsTab files 패턴 정합)
const SecurityRow = styled.div`
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  margin: 12px 0 4px;
`;
const SecurityRowLabel = styled.span`
  font-size: 12px; font-weight: 600; color: #475569;
`;
const SecHint = styled.span`
  font-size: 11px; color: #94A3B8; flex: 1; min-width: 0;
`;

// 태그
const PinTag = styled.span`font-size: 12px;`;
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
const MetaRow = styled.div`
  display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px;
  @media (max-width: 640px) { grid-template-columns: 1fr; }
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
const DescToggleBtn = styled.button`
  align-self: flex-start;
  padding: 6px 12px; font-size: 12px; font-weight: 500; color: #64748B;
  background: transparent; border: 1px dashed #CBD5E1; border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s;
  &:hover { color: #0F766E; border-color: #14B8A6; background: #F0FDFA; }
`;
const DescBox = styled.div`
  display: flex; flex-direction: column;
  border: 1px solid #E2E8F0; border-radius: 10px;
  background: #fff;
`;
const DescBoxHeader = styled.div`
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid #F1F5F9;
  background: #F8FAFC;
  border-radius: 10px 10px 0 0;
`;
const DescBoxLabel = styled.span`
  font-size: 11px; font-weight: 700; color: #64748B;
  text-transform: uppercase; letter-spacing: 0.05em;
`;
const DescCloseBtn = styled.button`
  display: inline-flex; align-items: center; gap: 4px;
  padding: 4px 8px; font-size: 11px; font-weight: 500; color: #64748B;
  background: transparent; border: 1px solid transparent; border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s;
  &:hover { color: #DC2626; border-color: #FECACA; background: #FEF2F2; }
`;

// 버튼 — PanelHeader 60px (padding 14*2=28 + 32 content) 와 일치하도록 32px
const PrimaryBtn = styled.button`
  height: 32px; padding: 0 14px; background: #14B8A6; color: #fff; border: none; border-radius: 8px;
  font-size: 13px; font-weight: 600; cursor: pointer; white-space: nowrap;
  display: inline-flex; align-items: center;
  &:hover:not(:disabled) { background: #0D9488; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
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
