// 문서(포스팅) 공용 페이지 — 워크스페이스·프로젝트 공용
// 레이아웃 패턴: Q Note 와 동일 (Sidebar + Content 2컬럼 + PanelHeader)
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import HelpDot from '../Common/HelpDot';
import SlotFormModal from './SlotFormModal';
import { displayName } from '../../utils/displayName';
import i18n from '../../i18n';
import { useSearchParams } from 'react-router-dom';
import { useTimeFormat } from '../../hooks/useTimeFormat';
import SearchBox from '../Common/SearchBox';
import PanelHeader, { PanelTitle, PanelSubTitle } from '../Layout/PanelHeader';
import InlineAttachPicker from './InlineAttachPicker';
import CategoryCombobox from '../Common/CategoryCombobox';
import EmptyState from '../Common/EmptyState';
import { uploadMyFile, uploadProjectFile, fetchWorkspaceFiles } from '../../services/files';
import ConfirmDialog from '../Common/ConfirmDialog';
import PostEditor from './PostEditor';
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
  createCategory,
  type PostRow, type PostDetail, type PostsMeta,
} from '../../services/posts';
import { listTemplates, type DocTemplate, KIND_LABELS_KO } from '../../services/docs';
import KindIcon from './KindIcon';
import PostShareModal from './PostShareModal';
import PostAiModal from './PostAiModal';
import PostSignatureModal from './PostSignatureModal';
import SignatureProgressSection from './SignatureProgressSection';
import PlanQSelect, { type PlanQSelectOption } from '../Common/PlanQSelect';
import { listProjects, type ApiProject } from '../../services/qtalk';
import { useAuth, apiFetch } from '../../contexts/AuthContext';

// 좌측 필터: 전체(기본) / 프로젝트 그룹 / 카테고리
// '내 문서'·'기본' 섹션은 제거. 상단 통합검색이 프로젝트명·제목·본문·카테고리를 모두 커버.
type FilterSel =
  | { kind: 'all' }
  | { kind: 'project'; projectId: number }
  | { kind: 'category'; name: string };

export type PostsScope =
  | { type: 'workspace'; businessId: number }
  | { type: 'project'; businessId: number; projectId: number };

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
  const [detail, setDetail] = useState<PostDetail | null>(null);
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
  const [pendingExistingMeta, setPendingExistingMeta] = useState<Record<number, { name: string; size: number }>>({});
  const submittingRef = useRef(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
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
  const businessId = scope.type === 'workspace' ? scope.businessId : (user?.business_id ? Number(user.business_id) : null);
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
        setMode('view');
        if (d) {
          setTitleDraft(d.title);
          setContentDraft(d.content_json);
          setCategoryDraft(d.category || '');
        }
      }
    })();
    return () => { cancelled = true; };
  }, [activeId]);

  const startNew = () => {
    setActiveId(null);
    setDetail(null);
    setMode('new');
    setTitleDraft('');
    setContentDraft(null);
    // 현재 필터가 카테고리면 해당 카테고리로 프리필
    setCategoryDraft(filter.kind === 'category' ? filter.name : '');
    // 프로젝트 scope 면 자동 연결, 워크스페이스 scope + 필터=프로젝트면 그 프로젝트로
    setProjectDraft(scope.type === 'project' ? scope.projectId : (filter.kind === 'project' ? filter.projectId : null));
    setPendingUploads([]);
    setPendingExistingIds([]);
    setPendingExistingMeta({});
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

  const startFromAi = ({ title, bodyHtml }: { title: string; bodyHtml: string }) => {
    setActiveId(null);
    setDetail(null);
    setMode('new');
    setTitleDraft(title);
    setContentDraft(bodyHtml as unknown);
    setCategoryDraft(filter.kind === 'category' ? filter.name : '');
    setPendingUploads([]);
    setPendingExistingIds([]);
    setPendingExistingMeta({});
    setError(null);
    setAiOpen(false);
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
    setError(null);
    setSlotTplId(null);
  };

  const startEdit = () => {
    if (!detail) return;
    setMode('edit');
    setTitleDraft(detail.title);
    setContentDraft(detail.content_json);
    setCategoryDraft(detail.category || '');
    setProjectDraft(detail.project_id);
    setError(null);
  };

  // 사이클 O3 — 포스트를 Q knowledge 로 보내기 (인덱싱 후 Cue 답변에 활용)
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
      const msg = e instanceof Error ? e.message : 'error';
      setKnowledgeMsg(t('actions.sendToKnowledgeErr', '추가 실패: {{msg}}', { msg }) as string);
    } finally {
      setKnowledgeBusy(false);
      setTimeout(() => setKnowledgeMsg(null), 4000);
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

  // 로컬 파일 업로드 요청 — 신규면 예약, 편집이면 즉시 upload+attach
  const handlePickFiles = async (files: File[]) => {
    if (mode === 'new') {
      setPendingUploads(prev => [...prev, ...files]);
      return;
    }
    if (!detail) return;
    const fileIds: number[] = [];
    for (const f of files) {
      const result = scope.type === 'project'
        ? await uploadProjectFile(scope.businessId, scope.projectId, f)
        : await uploadMyFile(scope.businessId, f);
      if (result.success && result.file) {
        const fid = Number(result.file.id.replace(/^direct-/, ''));
        if (fid) fileIds.push(fid);
      }
    }
    if (fileIds.length > 0) {
      await attachToPost(detail.id, fileIds);
      const reloaded = await fetchPost(detail.id);
      setDetail(reloaded);
    }
  };

  // 기존 파일 선택 — 신규면 예약, 편집이면 즉시 attach
  const handlePickExisting = async (fileIds: number[]) => {
    if (fileIds.length === 0) return;
    if (mode === 'new') {
      const all = await fetchWorkspaceFiles(scope.businessId);
      const meta = { ...pendingExistingMeta };
      for (const fid of fileIds) {
        const hit = all.find(f => f.id === `direct-${fid}`);
        if (hit) meta[fid] = { name: hit.file_name, size: hit.file_size };
      }
      setPendingExistingMeta(meta);
      setPendingExistingIds(prev => [...prev, ...fileIds.filter(id => !prev.includes(id))]);
      return;
    }
    if (!detail) return;
    await attachToPost(detail.id, fileIds);
    const reloaded = await fetchPost(detail.id);
    setDetail(reloaded);
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
  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed(prev => {
      const next = !prev;
      try { localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0'); } catch { /* noop */ }
      return next;
    });
  }, [COLLAPSE_KEY]);

  return (
    <Layout $collapsed={sidebarCollapsed}>
      {sidebarCollapsed ? (
        <CollapsedStrip>
          <EdgeHandle type="button" onClick={toggleSidebar} aria-label={t('sidebar.expand', '리스트 열기') as string} title={t('sidebar.expand', '리스트 열기') as string}>
            <EdgeChevron><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg></EdgeChevron>
          </EdgeHandle>
        </CollapsedStrip>
      ) : (
      <Sidebar>
        <PanelHeader>
          <PanelTitle>{scope.type === 'workspace' ? t('page.title', 'Q docs') : t('tab.title', '문서')}</PanelTitle>
          <HelpDot askCue={t('help.cuePrefill','Q docs 의 템플릿·AI 작성·서명 요청·분할 청구가 어떻게 작동하는지 알려줘') as string} topic="qdocs">
            {t('help.body','5종 템플릿(견적·청구·NDA·제안·회의록)에서 시작하거나 AI 자동 작성. 작성 후 서명 요청을 보내면 고객이 OTP 인증으로 서명. 견적·계약 post 와 청구서를 연결하면 회차별 분할 청구도 가능.')}
          </HelpDot>
          <HeaderBtnRow>
            <AiBtn type="button" onClick={() => setAiOpen(true)} title={t('ai.openHint', 'AI 가 문서 본문을 자동 작성') as string}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8 5.8 21.3l2.4-7.4L2 9.4h7.6L12 2z"/></svg>
              {t('ai.btn', 'AI')}
            </AiBtn>
            <TemplateBtn type="button" onClick={openTemplateModal} title={t('templates.openHint', '견적·청구·NDA·제안서·회의록 5종 템플릿에서 시작') as string}>
              {t('templates.btn', '템플릿')}
            </TemplateBtn>
            <NewBtn type="button" onClick={startNew} title={t('new', '새 문서') as string} aria-label={t('new', '새 문서') as string}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
            </NewBtn>
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
              onClick={() => setFilter({ kind: 'category', name: c.name })}
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
                  onClick={() => setFilter({ kind: 'project', projectId: p.id })}
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
            <EmptyList>{t('list.empty', '아직 작성된 문서가 없습니다')}</EmptyList>
          ) : (
            filtered.map(r => (
              <RowItem
                key={r.id}
                $active={activeId === r.id}
                onClick={() => setActiveId(activeId === r.id ? null : r.id)}
              >
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
                </RowMeta>
              </RowItem>
            ))
          )}
        </RowList>
        <EdgeHandle type="button" onClick={toggleSidebar} aria-label={t('sidebar.collapse', '리스트 접기') as string} title={t('sidebar.collapse', '리스트 접기') as string}>
          <EdgeChevron><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg></EdgeChevron>
        </EdgeHandle>
      </Sidebar>
      )}

      <Content>
        {isEditing ? (
          <>
            <PanelHeader>
              <TitleInput
                autoFocus={mode === 'new'}
                value={titleDraft}
                onChange={e => setTitleDraft(e.target.value)}
                placeholder={t('titlePlaceholder', '문서 제목') as string}
                maxLength={200}
              />
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
              </MetaRow>
              {error && <ErrorBar>{error}</ErrorBar>}
              <PostEditor value={contentDraft} onChange={setContentDraft} placeholder={t('contentPlaceholder', '본문을 작성하세요…') as string} />

              <AttachSection>
                <AttachTitle>{t('attachments', '첨부 파일')}</AttachTitle>
                {mode === 'edit' && detail && detail.attachments.length > 0 && (
                  <AttachList>
                    {detail.attachments.map(a => (
                      <AttachRow key={a.id}>
                        <AttachName href={a.file?.download_url || '#'} target="_blank" rel="noreferrer">
                          {a.file?.file_name || '—'}
                        </AttachName>
                        <RemoveBtn type="button" onClick={() => detachOne(a.id)} title="제거" aria-label="제거">×</RemoveBtn>
                      </AttachRow>
                    ))}
                  </AttachList>
                )}
                {mode === 'new' && (pendingUploads.length > 0 || pendingExistingIds.length > 0) && (
                  <AttachList>
                    {pendingUploads.map((f, i) => (
                      <AttachRow key={`u-${i}`}>
                        <AttachName as="span">{f.name}</AttachName>
                        <RemoveBtn type="button" onClick={() => setPendingUploads(prev => prev.filter((_, idx) => idx !== i))} title="제거" aria-label="제거">×</RemoveBtn>
                      </AttachRow>
                    ))}
                    {pendingExistingIds.map(fid => (
                      <AttachRow key={`e-${fid}`}>
                        <AttachName as="span">{pendingExistingMeta[fid]?.name || `file #${fid}`}</AttachName>
                        <RemoveBtn type="button" onClick={() => {
                          setPendingExistingIds(prev => prev.filter(x => x !== fid));
                          setPendingExistingMeta(prev => { const c = { ...prev }; delete c[fid]; return c; });
                        }} title="제거" aria-label="제거">×</RemoveBtn>
                      </AttachRow>
                    ))}
                  </AttachList>
                )}
                <InlineAttachPicker
                  businessId={scope.businessId}
                  excludeIds={[
                    ...(detail?.attachments?.map(a => a.file_id).filter((x): x is number => !!x) || []),
                    ...pendingExistingIds,
                  ]}
                  onPickFiles={handlePickFiles}
                  onPickExisting={handlePickExisting}
                />
              </AttachSection>
            </Body>
          </>
        ) : detail ? (
          <>
            <PanelHeader>
              <PanelSubTitle>
                {detail.is_pinned && <PinDot title={t('list.pinned', '고정됨') as string} />}
                {detail.title}
              </PanelSubTitle>
              <EditActions>
                <SignBtn type="button" onClick={() => setSignOpen(true)} title={t('sign.headerHint', '서명자에게 이메일로 서명 요청') as string}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 4 }}><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>
                  {t('sign.button', '서명 받기')}
                </SignBtn>
                <PrimaryBtn type="button" onClick={() => setShareOpen(true)}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 4 }}><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
                  {t('share.button', '공유')}
                </PrimaryBtn>
                <IconBtn type="button" onClick={() => window.print()} title={t('actions.print', 'PDF / 인쇄 (저장하려면 ‘대상: PDF로 저장’ 선택)') as string} aria-label={t('actions.print', 'PDF / 인쇄') as string}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
                </IconBtn>
                <IconBtn type="button" onClick={() => sendToKnowledge(detail)} title={t('actions.sendToKnowledge', 'Q knowledge 로 보내기 — Cue 가 답변 시 참조') as string} aria-label={t('actions.sendToKnowledge', 'Q knowledge 로 보내기') as string} disabled={knowledgeBusy}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 6.253v13"/><path d="M12 6.253C10.832 5.477 9.246 5 7.5 5 5.754 5 4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253"/><path d="M12 6.253C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18s-3.332.477-4.5 1.253"/></svg>
                </IconBtn>
                <IconBtn type="button" onClick={() => { setSaveTplName(detail.title); setSaveTplDesc(''); setSaveTplError(null); setSaveTplOpen(true); }} title={t('actions.saveAsTemplate', '템플릿으로 저장') as string} aria-label={t('actions.saveAsTemplate', '템플릿으로 저장') as string}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
                </IconBtn>
                <SecondaryBtn type="button" onClick={startEdit}>{t('edit', '편집')}</SecondaryBtn>
                <DangerBtn type="button" onClick={() => setDeleteTarget(detail)}>{t('delete', '삭제')}</DangerBtn>
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
                {detail.share_token && (
                  <ShareTag title={t('share.publicHint', '공개 링크가 활성화되어 있습니다') as string}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 2 }}><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.72"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.72-1.72"/></svg>
                    {t('share.publicBadge', '공유 중')}
                  </ShareTag>
                )}
              </ViewMeta>
              <div data-print-area>
                <PrintOnlyTitle>{detail.title}</PrintOnlyTitle>
                <PostEditor value={detail.content_json} onChange={() => {}} editable={false} />
              </div>

              <SignatureProgressSection
                postId={detail.id}
                postTitle={detail.title}
                inferredKind={inferKindFromTitle(detail.title, detail.category)}
                reloadTrigger={signReloadKey}
                onAddMore={() => setSignOpen(true)}
              />

              <AttachSection>
                <AttachTitle>{t('attachments', '첨부 파일')}</AttachTitle>
                {detail.attachments.length > 0 && (
                  <AttachList>
                    {detail.attachments.map(a => (
                      <AttachRow key={a.id}>
                        <AttachName href={a.file?.download_url || '#'} target="_blank" rel="noreferrer">
                          {a.file?.file_name || '—'}
                        </AttachName>
                        <RemoveBtn type="button" onClick={() => detachOne(a.id)} title="제거" aria-label="제거">×</RemoveBtn>
                      </AttachRow>
                    ))}
                  </AttachList>
                )}
                <InlineAttachPicker
                  businessId={scope.businessId}
                  excludeIds={detail.attachments?.map(a => a.file_id).filter((x): x is number => !!x) || []}
                  onPickFiles={handlePickFiles}
                  onPickExisting={handlePickExisting}
                />
              </AttachSection>
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
            ctaLabel={t('new', '새 문서') as string}
            ctaIcon={(
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                <line x1="12" y1="5" x2="12" y2="19"/>
                <line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
            )}
            onCta={startNew}
          />
        )}
      </Content>

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

      {detail && shareOpen && (
        <PostShareModal
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          post={detail}
          onChanged={updated => setDetail(updated)}
        />
      )}

      {aiOpen && (
        <PostAiModal
          open={aiOpen}
          onClose={() => setAiOpen(false)}
          businessId={scope.businessId}
          projectId={scope.type === 'project' ? scope.projectId : null}
          onGenerate={startFromAi}
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
const Layout = styled.div<{ $collapsed?: boolean }>`
  display: grid;
  grid-template-columns: ${p => p.$collapsed ? '0 1fr' : '320px 1fr'};
  height: 100%; min-height: 0;
  background: #F8FAFC;
  overflow: hidden;
  transition: grid-template-columns 0.18s ease;
  @media (max-width: 900px) { grid-template-columns: 1fr; }
`;

// 좌측 사이드바 (리스트)
const Sidebar = styled.aside`
  display: flex; flex-direction: column; position: relative;
  background: #fff; border-right: 1px solid #E2E8F0;
  min-height: 0;
  @media (max-width: 900px) { border-right: none; border-bottom: 1px solid #E2E8F0; }
`;
// 접힘 상태: 0 폭 + EdgeHandle 만 노출 (Q Talk LeftPanel 패턴 통일)
const CollapsedStrip = styled.aside`
  width: 0; flex-shrink: 0; position: relative;
  @media (max-width: 900px) { display: none; }
`;
const EdgeHandle = styled.button`
  position: absolute; top: 50%; right: 0;
  transform: translate(50%, -50%);
  width: 8px; height: 60px;
  padding: 0; border: none; background: #CBD5E1;
  border-radius: 4px; cursor: pointer; z-index: 10;
  box-shadow: 0 1px 3px rgba(15,23,42,0.08);
  transition: width 0.15s ease, background 0.15s ease, height 0.15s ease;
  display: flex; align-items: center; justify-content: center;
  &::before {
    content: ''; position: absolute;
    top: -10px; bottom: -10px; left: -8px; right: -8px;
  }
  &:hover { width: 14px; height: 72px; background: #14B8A6; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 2px; }
`;
const EdgeChevron = styled.span`
  display: flex; align-items: center; justify-content: center;
  color: #64748B;
  svg { width: 10px; height: 10px; }
  ${EdgeHandle}:hover & { color: #FFFFFF; }
`;
// 우측 컨텐츠 — background 를 Content 에 직접 부여
const HeaderBtnRow = styled.div`display:flex;align-items:center;gap:6px;`;
const AiBtn = styled.button`
  height: 32px; padding: 0 12px;
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 12px; font-weight: 700; color: #fff;
  background: linear-gradient(135deg, #F43F5E 0%, #BE185D 100%);
  border: none; border-radius: 8px; cursor: pointer;
  transition: opacity 0.15s, transform 0.15s;
  &:hover { transform: translateY(-1px); }
  &:focus-visible { outline: 2px solid #F43F5E; outline-offset: 2px; }
`;
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
const ModalBackdrop = styled.div`
  position: fixed; inset: 0; background: rgba(15,23,42,0.4);
  display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 20px;
`;
const ModalDialog = styled.div`
  background: #FFF; border-radius: 14px; max-width: 640px; width: 100%; padding: 22px 24px;
  box-shadow: 0 20px 60px rgba(0,0,0,0.2);
  max-height: 80vh; overflow-y: auto;
`;
const ModalHead = styled.div`display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;`;
const ModalTitle = styled.h2`font-size:16px;font-weight:700;color:#0F172A;margin:0;`;
const ModalClose = styled.button`
  width:28px;height:28px;border:none;background:transparent;color:#64748B;cursor:pointer;border-radius:6px;
  display:flex;align-items:center;justify-content:center;
  &:hover{background:#F1F5F9;color:#0F172A;}
`;
const ModalSub = styled.p`font-size:12px;color:#64748B;margin:0 0 14px 0;line-height:1.5;`;
const TplGrid = styled.div`display:grid;grid-template-columns:repeat(2,1fr);gap:8px;@media(max-width:520px){grid-template-columns:1fr;}`;
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
const SaveTplField = styled.div`display:flex;flex-direction:column;gap:6px;margin-bottom:10px;`;
const SaveTplLabel = styled.label`font-size:12px;font-weight:600;color:#0F172A;`;
const SaveTplError = styled.div`font-size:12px;color:#DC2626;background:#FEF2F2;padding:8px 10px;border-radius:6px;margin-bottom:8px;`;
const ModalFooter = styled.div`display:flex;justify-content:flex-end;gap:8px;margin-top:8px;`;
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
const RowItem = styled.button<{ $active: boolean }>`
  all: unset; cursor: pointer;
  padding: 12px 16px;
  border-bottom: 1px solid #F1F5F9;
  background: ${p => p.$active ? '#F0FDFA' : 'transparent'};
  &:hover { background: ${p => p.$active ? '#F0FDFA' : '#F8FAFC'}; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: -2px; }
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
const RowMeta = styled.div`
  margin-top: 6px;
  display: flex; align-items: center; gap: 4px;
  font-size: 11px; color: #94A3B8; flex-wrap: wrap;
`;
const EmptyList = styled.div`padding: 40px 20px; color: #94A3B8; font-size: 12px; text-align: center;`;
const Dim = styled.div`padding: 24px 16px; color: #94A3B8; font-size: 12px; text-align: center;`;

const Content = styled.section`
  display: flex; flex-direction: column;
  min-height: 0; overflow: hidden;
  background: #fff;
`;
const Body = styled.div`
  flex: 1; min-height: 0;
  padding: 24px 28px;
  overflow-y: auto;
  background: #F8FAFC;
  display: flex; flex-direction: column; gap: 16px;
`;
const TitleInput = styled.input`
  flex: 1; height: 32px; padding: 0 10px;
  background: #fff; border: 1px solid #E2E8F0; border-radius: 8px;
  font-size: 15px; font-weight: 700; color: #0F172A;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 2px rgba(20,184,166,0.15); }
`;
const EditActions = styled.div`display: flex; gap: 8px;`;
const ViewMeta = styled.div`
  display: flex; align-items: center; gap: 8px;
  font-size: 12px; color: #94A3B8; flex-wrap: wrap;
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
  border-top: 1px solid #EEF2F6;
  display: flex; flex-direction: column; gap: 12px;
`;
const AttachTitle = styled.div`font-size: 13px; font-weight: 700; color: #334155;`;
const AttachList = styled.div`
  display: flex; flex-direction: column;
  background: #fff; border: 1px solid #EEF2F6; border-radius: 8px; overflow: hidden;
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

// 버튼 — PanelHeader 60px (padding 14*2=28 + 32 content) 와 일치하도록 32px
const PrimaryBtn = styled.button`
  height: 32px; padding: 0 14px; background: #14B8A6; color: #fff; border: none; border-radius: 8px;
  font-size: 13px; font-weight: 600; cursor: pointer;
  display: inline-flex; align-items: center;
  &:hover:not(:disabled) { background: #0D9488; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
const SignBtn = styled.button`
  height: 32px; padding: 0 14px;
  display: inline-flex; align-items: center;
  font-size: 13px; font-weight: 700; color: #0F766E;
  background: #F0FDFA; border: 1px solid #14B8A6; border-radius: 8px; cursor: pointer;
  transition: background 0.15s, color 0.15s, transform 0.15s;
  &:hover:not(:disabled) { background: #14B8A6; color: #fff; transform: translateY(-1px); }
  &:focus-visible { outline: 2px solid #0D9488; outline-offset: 2px; }
`;
const SecondaryBtn = styled.button`
  height: 32px; padding: 0 14px; background: #fff; color: #0F172A;
  border: 1px solid #CBD5E1; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer;
  &:hover:not(:disabled) { background: #F8FAFC; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
const DangerBtn = styled.button`
  height: 32px; padding: 0 14px; background: #fff; color: #DC2626;
  border: 1px solid #FCA5A5; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer;
  &:hover:not(:disabled) { background: #FEF2F2; border-color: #DC2626; }
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
