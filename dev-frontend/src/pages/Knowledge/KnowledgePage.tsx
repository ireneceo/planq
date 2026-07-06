// Q knowledge — 워크스페이스 지식 베이스. Cue / aiGenerate / Q note 가 참조하는 RAG 소스.
//
// 30년차 UX 원칙 (사이클 P1 재구성):
//   - 헤더: "+ 새 지식 등록" 버튼 1개만
//   - 필터 영역: 검색 + scope/project/client 필터 + CSV 다운로드
//   - 등록 모달: 탭 4개 (직접 입력 / 파일 업로드 / 기존 파일 / 기존 문서)
//   - 진짜 1줄 리스트 + 우측 DetailDrawer
//   - 카운트 0 카테고리 자동 숨김
import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { downloadBlob } from '../../utils/download';
import { useSearchParams } from 'react-router-dom';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { useVisibilityRefresh } from '../../hooks/useVisibilityRefresh';
import { joinRoom, leaveRoom, onSocket } from '../../services/socket';
import PageShell from '../../components/Layout/PageShell';
import HelpDot from '../../components/Common/HelpDot';
import EmptyState from '../../components/Common/EmptyState';
import PlanQSelect, { type PlanQSelectOption } from '../../components/Common/PlanQSelect';
import SecurityLevelBadge, { useSecurityLevelLabel } from '../../components/Common/SecurityLevelBadge';
import SearchBox from '../../components/Common/SearchBox';
import DetailDrawer from '../../components/Common/DetailDrawer';
import ShareModal from '../../components/Common/ShareModal';
import AttachmentField from '../../components/Common/AttachmentField';
import RichEditor from '../../components/Common/RichEditor';
import { useImageLightbox } from '../../components/Common/ImageLightbox';
// 가로 Tabs 폐지 — 좌측 카테고리 트리로 변경 (Q file/Q record 패턴 통일)
import ConfirmDialog from '../../components/Common/ConfirmDialog';
import KbAiIngestModal from './KbAiIngestModal';
import KbCsvIngestModal from './KbCsvIngestModal';
import { SparkleIcon } from '../../components/Common/Icons';
import {
  listKnowledge, fetchPersonalKb, createKnowledge, deleteKnowledge, updateKnowledge,
  uploadKnowledgeFile, updateKbSecurityLevel,
  listKbCategories, createKbCategory, createKbShareBundle,
  LEGACY_KB_CATEGORIES,
  type KbDocumentRow, type KbCategory, type KbScope, type KbVlevel, type KbCategoryRow,
} from '../../services/knowledge';
import { mapApiError } from '../../utils/apiError';
import { apiFetch } from '../../contexts/AuthContext';
import { listProjects, listWorkspaceClients, type ApiProject, type WorkspaceClientRow } from '../../services/qtalk';
import { fetchWorkspaceFiles, uploadMyFile, formatBytes, type ProjectFile } from '../../services/files';
import { fetchPosts, type PostRow } from '../../services/posts';
import VisibilityField, { serializeVisibility, parseVisibility, type VisibilityValue } from '../../components/Common/VisibilityField';

// N+64 — 옛 ENUM 6 (i18n cat.{key} 라벨 보유, fallback 표시용). 자유 카테고리는 string 그대로.
const CATEGORIES: KbCategory[] = [...LEGACY_KB_CATEGORIES];
const SCOPES: KbScope[] = ['workspace', 'project', 'client'];
// 사용자 정의 항목 타입
const COL_TYPE_DEFAULT_LABEL: Record<string, string> = {
  text: '텍스트', longtext: '긴 텍스트', number: '숫자', date: '날짜',
  url: 'URL', email: '이메일', phone: '전화', select: '단일 선택',
  checkbox: '체크', secret: '시크릿',
};

interface KbDetail extends KbDocumentRow {
  body?: string | null;  // N+65 — KbDocumentRow.body 와 type 정합 (null 허용)
  file_name?: string | null;
  file_size?: number | null;
  uploaded_by?: number;
  chunks?: { id: number; chunk_index: number; section_title: string | null; token_count: number }[];
  attached_files?: { id: number; file_name: string; file_size: number; mime_type: string | null; storage_provider: string; external_url: string | null }[];
  attached_posts?: { id: number; title: string; project_id: number | null; category: string | null }[];
}

const formatDateSafe = (input: string | number | Date | null | undefined, kind: 'date' | 'datetime' = 'datetime'): string => {
  if (!input) return '—';
  const d = new Date(input);
  if (isNaN(d.getTime())) return '—';
  return kind === 'date' ? d.toLocaleDateString() : d.toLocaleString();
};

// N+30 — 개인 보관함 통합용 props. mode='personal' 시 fetchPersonalKb (본인 + scope='private') 호출
// + PageShell wrapping 차단 (embedded). 옛 호출처 (Q info 메뉴) 는 props 안 전달 → workspace 모드 그대로.
interface KnowledgePageProps {
  embedded?: boolean;
  mode?: 'workspace' | 'personal';
}

const KnowledgePage: React.FC<KnowledgePageProps> = ({ embedded = false, mode = 'workspace' }) => {
  const { t } = useTranslation('knowledge');
  const { t: tErr } = useTranslation('errors');
  const secLabel = useSecurityLevelLabel();  // D4 #62 보안등급 라벨
  const { user } = useAuth();
  const businessId = user?.business_id ? Number(user.business_id) : null;

  // ─── 리스트 + 필터 상태 ───
  const [docs, setDocs] = useState<KbDocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCat, setActiveCat] = useState<KbCategory | 'all'>('all');
  const [activeScope, setActiveScope] = useState<KbScope | 'all'>('all');
  const [activePolicy, setActivePolicy] = useState<'all' | 'all_members' | 'owner_only'>('all');
  const [sortKey, setSortKey] = useState<'recent' | 'title' | 'oldest'>('recent');
  // 선택 모드 — 대량 삭제 (Q file 패턴 통일)
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [activeProject, setActiveProject] = useState<number | null>(null);
  const [activeClient, setActiveClient] = useState<number | null>(null);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  // ─── DetailDrawer ───
  const [detailId, setDetailId] = useState<number | null>(null);
  const [detail, setDetail] = useState<KbDetail | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  // N+93 — 다건/카테고리 공유 번들 (#6)
  const [bundleSharing, setBundleSharing] = useState(false);
  const [bundleShare, setBundleShare] = useState<{ url: string; count: number | null; label: string } | null>(null);
  const [bundleCopied, setBundleCopied] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [catError, setCatError] = useState<string | null>(null);  // 상세 패널 카테고리 저장 에러 노출 (silent catch 제거)
  // 삭제·공유 등 액션 실패를 사용자에게 노출 (옛 silent catch 제거 — "안 됨" 무피드백 회귀 차단)
  const [actionError, setActionError] = useState<string | null>(null);
  useEffect(() => {
    if (!actionError) return;
    const timer = setTimeout(() => setActionError(null), 5000);
    return () => clearTimeout(timer);
  }, [actionError]);

  // ─── 새 지식 등록 모달 (사이클 P3 — 단일 폼) ───
  const [modalOpen, setModalOpen] = useState(false);
  // N+42 — Q Note 정리하기 → 지식 등록 prefill (?prefill=encodedText 으로 진입)
  const [searchParams, setSearchParams] = useSearchParams();
  const prefillAppliedRef = useRef(false);
  // ─── KB-Ingest 사이클 (2026-05-05) — AI 자동 추가 + CSV 일괄 업로드 ───
  const [aiIngestOpen, setAiIngestOpen] = useState(false);
  const [csvIngestOpen, setCsvIngestOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [resultMsg, setResultMsg] = useState<string | null>(null);
  const [draft, setDraft] = useState({
    title: '', body: '',
    category: 'manual' as KbCategory, categories: ['manual'] as KbCategory[], scope: 'workspace' as KbScope,
    project_id: null as number | null, client_id: null as number | null,
    // Q info — 사용자 정의 항목
    custom_columns: [] as Array<{ id: string; name: string; type: string; show_in_list: boolean }>,
    custom_values: {} as Record<string, string>,
    // 권한 (legacy)
    read_policy: 'all' as 'all' | 'owner',
    client_ids: [] as number[],
    // N+64 — 통합 visibility (L3 default = 워크스페이스 전체)
    vlevel: 'L3' as KbVlevel,
    target_member_ids: [] as number[],
  });
  // N+64 — 카테고리 마스터 (자유 추가/편집)
  const [catMaster, setCatMaster] = useState<KbCategoryRow[]>([]);
  const [catOrphan, setCatOrphan] = useState<string[]>([]);
  const [newCatInput, setNewCatInput] = useState('');
  const [catAdding, setCatAdding] = useState(false);
  // 워크스페이스 멤버 (L2-members picker 용)
  const [members, setMembers] = useState<Array<{ user_id: number; name: string; role: string }>>([]);
  // 카테고리 master + orphan fetch 헬퍼
  const reloadCategories = useCallback(async () => {
    if (!businessId) return;
    try {
      const j = await listKbCategories(businessId);
      setCatMaster(j.master);
      setCatOrphan(j.orphan);
    } catch (_) { /* ignore */ }
  }, [businessId]);
  // 첨부 — 새 업로드 + 기존 파일 + 기존 문서 (모두 다중)
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [wsFiles, setWsFiles] = useState<ProjectFile[]>([]);
  const [wsFilesLoaded, setWsFilesLoaded] = useState(false);
  const [pickedFileIds, setPickedFileIds] = useState<Set<number>>(new Set());
  const [wsPosts, setWsPosts] = useState<PostRow[]>([]);
  const [wsPostsLoaded, setWsPostsLoaded] = useState(false);
  const [pickedPostIds, setPickedPostIds] = useState<Set<number>>(new Set());

  // 프로젝트 / 고객 선택지
  const [projects, setProjects] = useState<ApiProject[]>([]);
  const [clients, setClients] = useState<WorkspaceClientRow[]>([]);

  useEffect(() => {
    if (!businessId) return;
    Promise.all([
      listProjects(businessId).catch(() => [] as ApiProject[]),
      listWorkspaceClients(businessId).catch(() => [] as WorkspaceClientRow[]),
    ]).then(([p, c]) => {
      setProjects(p);
      setClients(c.filter(x => x.status !== 'archived'));
    });
    // N+64 — 카테고리 마스터 + 워크스페이스 멤버 fetch
    reloadCategories();
    apiFetch(`/api/businesses/${businessId}/members`).then(r => r.json()).then(j => {
      if (j?.success && Array.isArray(j.data)) {
        setMembers(j.data
          .filter((m: { user?: { is_ai?: boolean }; role?: string }) => !m.user?.is_ai && m.role !== 'ai')
          .map((m: { user_id?: number; id?: number; user?: { id?: number; name?: string }; name?: string; role?: string }) => ({
            user_id: m.user_id || m.id || m.user?.id || 0,
            name: m.user?.name || m.name || '—',
            role: m.role || 'member',
          })).filter((m: { user_id: number }) => m.user_id > 0));
      }
    }).catch(() => {});
  }, [businessId]);

  // N+42: Q Note 정리하기 → 지식 등록 prefill. 마운트 시 한 번만 적용 + URL 정리.
  useEffect(() => {
    if (prefillAppliedRef.current) return;
    const prefill = searchParams.get('prefill');
    const prefillTitle = searchParams.get('prefill_title');
    if (!prefill && !prefillTitle) return;
    setDraft(prev => ({
      ...prev,
      title: (prefillTitle || '').slice(0, 200),
      body: (prefill || '').slice(0, 8000),
    }));
    setModalOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete('prefill');
    next.delete('prefill_title');
    setSearchParams(next, { replace: true });
    prefillAppliedRef.current = true;
  }, [searchParams, setSearchParams]);

  // 공유 페이지 "PlanQ 에서 보기" → /info?doc=:id 딥링크. 마운트 시 해당 문서 상세 열기.
  const docParamAppliedRef = useRef(false);
  useEffect(() => {
    if (docParamAppliedRef.current) return;
    const docParam = searchParams.get('doc');
    if (!docParam) return;
    const id = Number(docParam);
    if (!id) return;
    setDetailId(id);
    docParamAppliedRef.current = true;
  }, [searchParams]);

  // ─── 검색 디바운스 ───
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debouncedSearch = useRef(search);
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => { debouncedSearch.current = search; void load(); }, 300);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      // N+30 — 개인 보관함 모드: fetchPersonalKb (본인 + scope='private') 자체 호출. 필터 UI 무시.
      if (mode === 'personal') {
        const list = await fetchPersonalKb(businessId);
        // client-side query 필터 (backend 가 personal-vault 라우트에서 q 미지원)
        const q = debouncedSearch.current.trim().toLowerCase();
        setDocs(q ? list.filter(d => (d.title || '').toLowerCase().includes(q)) : list);
        return;
      }
      const filter: Parameters<typeof listKnowledge>[1] = {};
      if (activeScope !== 'all') filter.scope = activeScope;
      if (activeProject) filter.project_id = activeProject;
      if (activeClient) filter.client_id = activeClient;
      if (activeTag) filter.tag = activeTag;
      if (debouncedSearch.current.trim()) filter.q = debouncedSearch.current.trim();
      const list = await listKnowledge(businessId, filter);
      setDocs(list);
    } finally { setLoading(false); }
  }, [businessId, mode, activeScope, activeProject, activeClient, activeTag]);

  useEffect(() => { void load(); }, [load]);

  // N+39 — PWA visibility 안전망
  useVisibilityRefresh(useCallback(() => { void load(); }, [load]));

  // N+38 — 실시간 동기화 (CLAUDE.md 운영 안정성 16번 박제).
  // 다른 사용자가 자료 추가/수정/삭제 시 본인이 페이지 열고 있으면 즉시 보임.
  useEffect(() => {
    if (!businessId) return;
    let pending: number | null = null;
    const debouncedReload = () => {
      if (pending) return;
      pending = window.setTimeout(() => { pending = null; void load(); }, 250);
    };
    // N+65 — KbCategory CRUD 다른 탭/디바이스 즉시 반영
    const debouncedReloadCats = () => {
      if (pending) return;
      pending = window.setTimeout(() => { pending = null; void reloadCategories(); }, 250);
    };
    joinRoom(`business:${businessId}`);
    const offs = [
      onSocket('kb:new', debouncedReload),
      onSocket('kb:updated', debouncedReload),
      onSocket('kb:deleted', debouncedReload),
      onSocket('kb:cat:new', debouncedReloadCats),
      onSocket('kb:cat:updated', debouncedReloadCats),
      onSocket('kb:cat:deleted', debouncedReloadCats),
    ];
    return () => {
      if (pending) window.clearTimeout(pending);
      leaveRoom(`business:${businessId}`);
      offs.forEach((off) => off());
    };
  }, [businessId, load, reloadCategories]);

  // ─── DetailDrawer fetch ───
  useEffect(() => {
    if (!detailId || !businessId) { setDetail(null); return; }
    setDetailLoading(true);
    apiFetch(`/api/businesses/${businessId}/kb/documents/${detailId}`)
      .then(r => r.json())
      .then(j => { if (j.success) setDetail(j.data); })
      .finally(() => setDetailLoading(false));
  }, [detailId, businessId]);

  // 멀티 카테고리 헬퍼 — categories 우선, 없으면 [category] fallback
  const docCats = (d: KbDocumentRow): KbCategory[] =>
    (Array.isArray(d.categories) && d.categories.length > 0) ? d.categories : [d.category];

  // ─── 카테고리 탭 (0 카운트 숨김) — 한 자료가 여러 카테고리에 속하면 모두 카운트 ───
  const categoryCounts = useMemo(() => {
    const c: Record<string, number> = { all: docs.length };
    for (const cat of CATEGORIES) c[cat] = docs.filter(d => docCats(d).includes(cat)).length;
    return c;
  }, [docs]);
  const visibleCategories = useMemo(() => CATEGORIES.filter(cat => categoryCounts[cat] > 0), [categoryCounts]);

  const filtered = useMemo(() => {
    let arr = activeCat === 'all' ? docs : docs.filter(d => docCats(d).includes(activeCat));
    if (activePolicy === 'all_members') arr = arr.filter(d => d.read_policy !== 'owner');
    else if (activePolicy === 'owner_only') arr = arr.filter(d => d.read_policy === 'owner');
    arr = [...arr];
    if (sortKey === 'title') arr.sort((a, b) => a.title.localeCompare(b.title));
    else if (sortKey === 'oldest') arr.sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at));
    else arr.sort((a, b) => +new Date(b.updated_at) - +new Date(a.updated_at));
    return arr;
  }, [docs, activeCat, activePolicy, sortKey]);

  // ─── 모달 진입 시 기존 파일/문서 자동 로드 (PlanQSelect 옵션 채움) ───
  useEffect(() => {
    if (!modalOpen || !businessId) return;
    if (!wsFilesLoaded) {
      fetchWorkspaceFiles(businessId)
        .then(files => setWsFiles(files.filter(f => f.source === 'direct')))
        .catch(() => setWsFiles([]))
        .finally(() => setWsFilesLoaded(true));
    }
    if (!wsPostsLoaded) {
      fetchPosts(businessId)
        .then(posts => setWsPosts(posts))
        .catch(() => setWsPosts([]))
        .finally(() => setWsPostsLoaded(true));
    }
  }, [modalOpen, businessId, wsFilesLoaded, wsPostsLoaded]);

  const resetModal = () => {
    setDraft({ title: '', body: '', category: 'manual', categories: ['manual'], scope: 'workspace', project_id: null, client_id: null, custom_columns: [], custom_values: {}, read_policy: 'all', client_ids: [], vlevel: 'L3', target_member_ids: [] });
    setUploadFiles([]);
    setPickedFileIds(new Set());
    setPickedPostIds(new Set());
    setNewCatInput('');
    setSubmitError(null);
    setResultMsg(null);
  };
  const closeModal = () => { setModalOpen(false); resetModal(); };

  // ─── 사이클 P3 — 단일 폼 통합 등록 ───
  // 1 entry = 본문 + 업로드 파일들 + 기존 파일들 + 기존 문서들
  // 카테고리/범위는 한 번만. 백엔드가 첨부 텍스트 합쳐서 인덱싱.
  const submit = async () => {
    if (!businessId) return;
    if (!draft.title.trim()) {
      setSubmitError(t('modal.errTitleRequired', '제목은 필수입니다') as string); return;
    }
    const hasContent = draft.body.trim() || uploadFiles.length > 0 || pickedFileIds.size > 0 || pickedPostIds.size > 0;
    if (!hasContent) {
      setSubmitError(t('modal.errContentRequired', '본문 또는 첨부 (파일/문서) 중 하나는 필요합니다') as string); return;
    }
    // N+64 — vlevel 검증
    if (draft.vlevel === 'L2' && draft.scope === 'project' && !draft.project_id) {
      setSubmitError(t('modal.errProjectRequired', '프로젝트를 선택하세요') as string); return;
    }
    if (draft.vlevel === 'L4' && !draft.client_id && draft.client_ids.length === 0) {
      setSubmitError(t('modal.errClientRequired', '고객을 선택하세요') as string); return;
    }
    if (draft.vlevel === 'L2' && draft.scope === 'workspace' && draft.target_member_ids.length === 0) {
      setSubmitError(t('modal.errMembersRequired', '멤버를 한 명 이상 선택하세요') as string); return;
    }
    setSubmitting(true); setSubmitError(null); setResultMsg(null);
    try {
      const meta = {
        category: draft.categories[0] || draft.category,
        categories: draft.categories.length > 0 ? draft.categories : [draft.category],
        scope: draft.scope,
        project_id: draft.scope === 'project' ? draft.project_id : null,
        client_id: draft.scope === 'client' ? draft.client_id : null,
        // Q info — 사용자 정의 항목 + 권한
        custom_columns: draft.custom_columns.length > 0 ? draft.custom_columns : undefined,
        custom_values: Object.keys(draft.custom_values).length > 0 ? draft.custom_values : undefined,
        read_policy: draft.read_policy,
        client_ids: draft.scope === 'client' && draft.client_ids.length > 0 ? draft.client_ids : undefined,
        // N+64 — 통합 visibility (서버가 vlevel 우선 처리)
        vlevel: draft.vlevel,
        target_member_ids: draft.target_member_ids.length > 0 ? draft.target_member_ids : undefined,
      };

      // 1) 새로 업로드된 파일을 워크스페이스 파일로 변환 (workspace 첨부) — workspaceFile 변환 후 file_id 모음
      // 단순화: 새 업로드는 KbDocument.body 에 텍스트로 합치는 대신 KbDocument.upload endpoint 1번만 사용
      // 본문 + 기존 파일/문서 + 새 업로드 모두 합치는 진짜 통합 등록 — 새 업로드는 일단 1개씩 별도 처리
      // (다중 새 업로드는 추후 확장 — 가장 흔한 경우는 본문 + 기존 첨부)

      const allFileIds = Array.from(pickedFileIds);
      const allPostIds = Array.from(pickedPostIds);

      // 새 업로드 파일이 있다면: 1개씩 별도 KbDocument 로 등록 (다중 가능)
      let uploadedCount = 0;
      for (const file of uploadFiles) {
        try {
          await uploadKnowledgeFile(businessId, {
            file,
            title: `${draft.title.trim()} — ${file.name}`,
            ...meta,
          });
          uploadedCount++;
        } catch (e) { console.error('upload failed', e); }
      }

      // 본문 또는 첨부 (기존 파일/문서) 가 있으면 1 entry 등록
      if (draft.body.trim() || allFileIds.length > 0 || allPostIds.length > 0) {
        await createKnowledge(businessId, {
          title: draft.title.trim(),
          body: draft.body.trim() || undefined,
          attached_file_ids: allFileIds.length > 0 ? allFileIds : undefined,
          attached_post_ids: allPostIds.length > 0 ? allPostIds : undefined,
          ...meta,
        });
        const totalAdded = 1 + uploadedCount;
        setResultMsg(t('modal.savedAll', '{{n}}건 등록 완료', { n: totalAdded }) as string);
      } else if (uploadedCount > 0) {
        setResultMsg(t('modal.savedAll', '{{n}}건 등록 완료', { n: uploadedCount }) as string);
      }

      await load();
      setTimeout(() => closeModal(), 800);
    } catch (e) {
      setSubmitError(t('modal.errSave', { msg: mapApiError(e, tErr) }) as string);
    } finally { setSubmitting(false); }
  };

  const performDelete = async (id: number) => {
    if (!businessId) return;
    try {
      await deleteKnowledge(businessId, id);
      if (detailId === id) setDetailId(null);
      await load();
    } catch (e) {
      setActionError(e instanceof Error && /forbidden/i.test(e.message)
        ? (t('errors.deleteForbidden', '작성자 또는 관리자만 삭제할 수 있습니다.') as string)
        : (t('errors.deleteFailed', '삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.') as string));
    }
    finally { setConfirmDelete(null); }
  };

  // N+93 — 다건 공유 (선택된 인포 묶음)
  const shareSelected = async () => {
    if (!businessId || selectedIds.size === 0) return;
    setBundleSharing(true);
    try {
      const r = await createKbShareBundle(businessId, { kind: 'selection', doc_ids: [...selectedIds] });
      setBundleShare({ url: r.share_url, count: r.count, label: t('select.bundleSelectionLabel', { n: selectedIds.size, defaultValue: `${selectedIds.size}개 선택` }) as string });
      setBundleCopied(false);
    } catch (e) {
      setBundleShare(null);
      // D4 #62 — 내부·기밀 자료 포함 시 구체 안내
      const blocked = e instanceof Error && e.message === 'security_level_blocks_share';
      setActionError(blocked
        ? t('securityLevel.blockedShare', { defaultValue: '보안등급(내부·기밀) 자료는 외부 공유할 수 없어요. 등급을 일반으로 낮추면 공유할 수 있어요.', ns: 'common' }) as string
        : t('errors.shareFailed', '공유 링크를 만들지 못했습니다. 다시 시도해 주세요.') as string);
    }
    finally { setBundleSharing(false); }
  };
  // 카테고리 통째 공유
  const shareCategory = async (category: string) => {
    if (!businessId) return;
    setBundleSharing(true);
    try {
      const r = await createKbShareBundle(businessId, { kind: 'category', category });
      setBundleShare({ url: r.share_url, count: r.count, label: category });
      setBundleCopied(false);
    } catch { setBundleShare(null); setActionError(t('errors.shareFailed', '공유 링크를 만들지 못했습니다. 다시 시도해 주세요.') as string); }
    finally { setBundleSharing(false); }
  };

  // ─── CSV export (현재 필터 결과) ───
  const handleExportCsv = () => {
    if (!filtered.length) return;
    const header = ['id', 'title', 'category', 'scope', 'project_id', 'client_id', 'status', 'chunk_count', 'updated_at'];
    const rows = filtered.map(d => [
      d.id, JSON.stringify(d.title), d.category, d.scope, d.project_id ?? '', d.client_id ?? '',
      d.status, d.chunk_count, d.updated_at,
    ]);
    const csv = [header.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    void downloadBlob(blob, `knowledge-${new Date().toISOString().slice(0,10)}.csv`);
  };

  if (!businessId) return null;

  const renderRowMeta = (d: KbDocumentRow) => {
    // 카테고리는 별도 chip 으로 표시 — meta 텍스트에는 빼고 스코프·소속만
    const parts: string[] = [];
    if (d.scope !== 'workspace') {
      parts.push(t(`scope.${d.scope}`) as string);
    }
    if (d.scope === 'project' && d.project_id) {
      const p = projects.find(x => x.id === d.project_id);
      if (p) parts.push(p.name);
    }
    if (d.scope === 'client' && d.client_id) {
      const c = clients.find(x => x.id === d.client_id);
      if (c) parts.push(c.display_name || c.biz_name || c.company_name || `#${d.client_id}`);
    }
    // 첨부 카운트 — 파일·문서 합계
    const fileCount = Array.isArray(d.attached_file_ids) ? d.attached_file_ids.length : 0;
    const postCount = Array.isArray(d.attached_post_ids) ? d.attached_post_ids.length : 0;
    if (fileCount > 0 || postCount > 0) {
      parts.push(t('row.attached', '첨부 {{n}}', { n: fileCount + postCount }) as string);
    }
    parts.push(formatDateSafe(d.updated_at ?? (d as { updatedAt?: string }).updatedAt, 'date'));
    return parts.join(' · ');
  };

  return (
    <PageShell
      embedded={embedded}
      title={t('page.title') as string}
      count={docs.length}
      helpDot={
        <HelpDot askCue={t('help.cuePrefill') as string} topic="qknowledge">
          {t('help.body')}
        </HelpDot>
      }
      actions={
        <>
          <CsvUploadBtn type="button" onClick={() => setCsvIngestOpen(true)} title={t('page.csvUpload') as string}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/>
              <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            {t('page.csvUpload')}
          </CsvUploadBtn>
          <CsvBtn type="button" onClick={handleExportCsv} disabled={!filtered.length} title={t('page.exportCsv') as string}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            {t('page.exportCsv')}
          </CsvBtn>
          <AiBtn type="button" onClick={() => setAiIngestOpen(true)} title={t('page.aiIngest') as string}>
            <SparkleIcon size={14} />
            {t('page.aiIngest')}
          </AiBtn>
          <NewBtn type="button" onClick={() => setModalOpen(true)}>{t('page.new')}</NewBtn>
        </>
      }
    >

      {actionError && (
        <ActionErrorBanner role="alert" onClick={() => setActionError(null)}>
          {actionError}
        </ActionErrorBanner>
      )}

      {/* ─── Toolbar — 검색 + 필터 통일 (Q file 패턴) ─── */}
      <Toolbar>
        <SearchBox
          value={search}
          onChange={setSearch}
          placeholder={t('page.searchPh') as string}
          width={240}
        />
        <ToolbarFilter>
          <PlanQSelect
            size="sm" isSearchable={false}
            value={{ value: activeScope, label: activeScope === 'all' ? (t('page.allScopes') as string) : (t(`scope.${activeScope}`) as string) }}
            onChange={(opt) => {
              const v = (opt as PlanQSelectOption | null)?.value as KbScope | 'all' | undefined;
              setActiveScope(v || 'all');
              if (v !== 'project') setActiveProject(null);
              if (v !== 'client') setActiveClient(null);
            }}
            options={[
              { value: 'all', label: t('page.allScopes') as string },
              ...SCOPES.map(s => ({ value: s, label: t(`scope.${s}`) as string })),
            ]}
          />
        </ToolbarFilter>
        {activeScope === 'project' && (
          <ToolbarFilter>
            <PlanQSelect
              size="sm" isSearchable
              placeholder={t('page.allProjects') as string}
              value={activeProject ? { value: String(activeProject), label: projects.find(p => p.id === activeProject)?.name || `#${activeProject}` } : null}
              onChange={(opt) => setActiveProject((opt as PlanQSelectOption | null)?.value ? Number((opt as PlanQSelectOption).value) : null)}
              options={[{ value: '', label: t('page.allProjects') as string }, ...projects.map(p => ({ value: String(p.id), label: p.name }))]}
            />
          </ToolbarFilter>
        )}
        {activeScope === 'client' && (
          <ToolbarFilter>
            <PlanQSelect
              size="sm" isSearchable
              placeholder={t('page.allClients') as string}
              value={activeClient ? { value: String(activeClient), label: (() => { const c = clients.find(x => x.id === activeClient); return c?.display_name || c?.biz_name || c?.company_name || `#${activeClient}`; })() } : null}
              onChange={(opt) => setActiveClient((opt as PlanQSelectOption | null)?.value ? Number((opt as PlanQSelectOption).value) : null)}
              options={[{ value: '', label: t('page.allClients') as string }, ...clients.map(c => ({ value: String(c.id), label: c.display_name || c.biz_name || c.company_name || `#${c.id}` }))]}
            />
          </ToolbarFilter>
        )}
        <ToolbarFilter>
          <PlanQSelect
            size="sm" isSearchable={false}
            value={{
              value: activePolicy,
              label: activePolicy === 'all_members' ? (t('policy.allMembers', '멤버 전체') as string)
                : activePolicy === 'owner_only' ? (t('policy.ownerOnly', '운영진만') as string)
                : (t('policy.all', '권한 전체') as string),
            }}
            onChange={(opt) => setActivePolicy(((opt as PlanQSelectOption | null)?.value as 'all' | 'all_members' | 'owner_only') || 'all')}
            options={[
              { value: 'all', label: t('policy.all', '권한 전체') as string },
              { value: 'all_members', label: t('policy.allMembers', '멤버 전체') as string },
              { value: 'owner_only', label: t('policy.ownerOnly', '운영진만') as string },
            ]}
          />
        </ToolbarFilter>
        <ToolbarSort>
          <PlanQSelect
            size="sm" isSearchable={false}
            value={{
              value: sortKey,
              label: sortKey === 'recent' ? (t('sort.recent', '최근 순') as string)
                : sortKey === 'title' ? (t('sort.title', '이름 순') as string)
                : (t('sort.oldest', '오래된 순') as string),
            }}
            onChange={(opt) => setSortKey(((opt as PlanQSelectOption | null)?.value as 'recent' | 'title' | 'oldest') || 'recent')}
            options={[
              { value: 'recent', label: t('sort.recent', '최근 순') as string },
              { value: 'title', label: t('sort.title', '이름 순') as string },
              { value: 'oldest', label: t('sort.oldest', '오래된 순') as string },
            ]}
          />
        </ToolbarSort>
        {/* 선택 모드 토글 (Q file 패턴 통일) */}
        <SelectToggle
          type="button"
          $on={selectMode}
          onClick={() => {
            if (selectMode) { setSelectMode(false); setSelectedIds(new Set()); }
            else setSelectMode(true);
          }}
        >
          {selectMode
            ? `${t('select.cancel', '선택 해제')}${selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}`
            : t('select.toggle', '선택')}
        </SelectToggle>
        {selectMode && selectedIds.size > 0 && (
          <>
            <BulkShareBtn type="button" onClick={shareSelected} disabled={bundleSharing}>
              {bundleSharing ? t('select.sharing', '공유 링크 생성 중...') : `${t('select.share', '선택 공유')} (${selectedIds.size})`}
            </BulkShareBtn>
            <BulkDeleteBtn type="button" onClick={() => setBulkDeleteOpen(true)}>
              {t('select.delete', '선택 삭제')} ({selectedIds.size})
            </BulkDeleteBtn>
          </>
        )}
        {/* N+93 — 카테고리 통째 공유 (#6). 특정 카테고리 선택 시 노출. */}
        {!selectMode && activeCat !== 'all' && (
          <BulkShareBtn type="button" onClick={() => shareCategory(activeCat as string)} disabled={bundleSharing}>
            {bundleSharing ? t('select.sharing', '공유 링크 생성 중...') : t('select.shareCategory', '이 카테고리 공유')}
          </BulkShareBtn>
        )}
      </Toolbar>

      {/* ─── 좌측 카테고리 트리 + 메인 영역 (Q file/Q record 패턴 통일) ─── */}
      <Split>
        <TreePanel>
          <TreeRoot>
            <TreeRow $selected={activeCat === 'all'} onClick={() => setActiveCat('all')}>
              <TreeName>{t('cat.all')}</TreeName>
              <TreeCount>{categoryCounts.all || 0}</TreeCount>
            </TreeRow>
            {visibleCategories.length > 0 && <TreeDivider />}
            {visibleCategories.map(cat => (
              <TreeRow key={cat} $selected={activeCat === cat} onClick={() => setActiveCat(cat)}>
                <TreeName>{t(`cat.${cat}`)}</TreeName>
                <TreeCount>{categoryCounts[cat] || 0}</TreeCount>
              </TreeRow>
            ))}
          </TreeRoot>
        </TreePanel>

        <MainArea>
          {activeTag && (
            <ActiveTagBar>
              <ActiveTagLabel>{t('page.tagFilter', '태그')}:</ActiveTagLabel>
              <ActiveTagChip onClick={() => setActiveTag(null)} title={t('page.clearTag', '태그 필터 해제') as string}>
                #{activeTag}
                <ActiveTagX>×</ActiveTagX>
              </ActiveTagChip>
            </ActiveTagBar>
          )}

          {loading ? <Loading>{t('page.loading')}</Loading> :
           filtered.length === 0 ? (
             <EmptyState
               icon={<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 6.253v13"/><path d="M12 6.253C10.832 5.477 9.246 5 7.5 5 5.754 5 4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253"/><path d="M12 6.253C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18s-3.332.477-4.5 1.253"/></svg>}
               title={t('empty.title') as string}
               description={t('empty.desc') as string}
               ctaLabel={t('empty.cta') as string}
               onCta={() => setModalOpen(true)}
             />
           ) : (
             <List>
               {filtered.map(d => {
                 const isSelected = selectedIds.has(d.id);
                 return (
                 <Row
                   key={d.id}
                   $active={selectMode ? isSelected : detailId === d.id}
                   $selectMode={selectMode}
                   onClick={() => {
                     if (selectMode) {
                       setSelectedIds(prev => {
                         const n = new Set(prev);
                         if (n.has(d.id)) n.delete(d.id); else n.add(d.id);
                         return n;
                       });
                     } else {
                       setDetailId(prev => prev === d.id ? null : d.id);
                     }
                   }}
                 >
                   {/* 체크박스 — 선택 모드일 때만 첫 컬럼 */}
                   {selectMode && (
                     <RowChk onClick={(e) => e.stopPropagation()}>
                       <RowCheckbox
                         type="checkbox"
                         checked={isSelected}
                         readOnly
                         onClick={(e) => e.stopPropagation()}
                       />
                     </RowChk>
                   )}
                   {/* 제목 — 인라인 편집 (Q task 패턴) */}
                   <ColTitleArea>
                     <RowTitleEdit
                       docId={d.id}
                       businessId={businessId}
                       initialValue={d.title}
                       onSaved={(newTitle) => {
                         setDocs(prev => prev.map(x => x.id === d.id ? { ...x, title: newTitle } : x));
                         if (detailId === d.id) setDetail(prev => prev ? { ...prev, title: newTitle } : prev);
                       }}
                     />
                   </ColTitleArea>

                   {/* 가운데: 커스텀 항목 — 인라인 편집 */}
                   <ColCustomArea onClick={(e) => e.stopPropagation()}>
                     {Array.isArray(d.custom_columns) && d.custom_columns.filter(c => c.show_in_list).map(col => (
                       <CustomItem key={col.id}>
                         <CustomLabel>{col.name}</CustomLabel>
                         <InlineCellEdit
                           docId={d.id}
                           colId={col.id}
                           colType={col.type}
                           initialValue={(d.custom_values || {})[col.id] as string | undefined}
                           businessId={businessId}
                           onSaved={(newVal) => {
                             setDocs(prev => prev.map(x => x.id === d.id
                               ? { ...x, custom_values: { ...(x.custom_values || {}), [col.id]: newVal } }
                               : x));
                             if (detailId === d.id) {
                               setDetail(prev => prev ? { ...prev, custom_values: { ...(prev.custom_values || {}), [col.id]: newVal } } : prev);
                             }
                           }}
                         />
                       </CustomItem>
                     ))}
                   </ColCustomArea>

                   {/* 카테고리 chip + 메타 */}
                   <ColMeta>
                     {docCats(d).map(c => <CategoryChip key={c}>{t(`cat.${c}`)}</CategoryChip>)}
                     <MetaText>{renderRowMeta(d)}</MetaText>
                   </ColMeta>

                   {/* 권한·상태 chip */}
                   <ColRight>
                     {/* D4 #62 — 보안등급 배지 (일반은 자동 숨김) */}
                     <SecurityLevelBadge level={d.security_level} />
                     {d.read_policy === 'owner' && (
                       <PolicyChip $kind="owner" title={t('policy.ownerOnly', '운영진만') as string}>
                         {t('policy.ownerShort', '운영진') as string}
                       </PolicyChip>
                     )}
                     {d.status === 'indexing' && (
                       <StatusChip $s="indexing" title={t('status.indexing', '인덱싱 중') as string}>
                         {t('status.indexingShort', '처리중') as string}
                       </StatusChip>
                     )}
                     {d.status === 'failed' && (
                       <StatusChip $s="failed" title={t('status.failed', '실패') as string}>
                         {t('status.failedShort', '실패') as string}
                       </StatusChip>
                     )}
                   </ColRight>

                   {/* 우측 끝: 휴지통 — 선택 모드 아닐 때만 */}
                   <RowAct>
                     {!selectMode && (
                       <IconBtn type="button" title={t('drawer.delete') as string}
                         aria-label={t('drawer.delete') as string}
                         onClick={(e) => { e.stopPropagation(); setConfirmDelete(d.id); }}>
                         <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                           <polyline points="3 6 5 6 21 6" />
                           <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                           <path d="M10 11v6M14 11v6" />
                         </svg>
                       </IconBtn>
                     )}
                   </RowAct>
                 </Row>
                 );
               })}
             </List>
           )}
        </MainArea>
      </Split>

      {/* ─── 우측 DetailDrawer ─── */}
      <DetailDrawer
        open={!!detailId}
        onClose={() => setDetailId(null)}
        width={520}
        ariaLabel={t('drawer.title') as string}
      >
        <DetailDrawer.Header onClose={() => setDetailId(null)}>
          {detail ? (
            <DrawerTitleEdit
              docId={detail.id}
              businessId={businessId}
              initialValue={detail.title}
              onSaved={(newTitle) => {
                setDocs(prev => prev.map(x => x.id === detail.id ? { ...x, title: newTitle } : x));
                setDetail(prev => prev ? { ...prev, title: newTitle } : prev);
              }}
            />
          ) : (
            <DrawerTitle>{t('drawer.title')}</DrawerTitle>
          )}
        </DetailDrawer.Header>
        <DetailDrawer.Body>
          {detailLoading || !detail ? (
            <Loading>{t('page.loading')}</Loading>
          ) : (
            <DrawerSections>
              <DrawerSection>
                <SectionLabel>{t('drawer.metadata')}</SectionLabel>
                <MetaGrid>
                  <MetaLabel>{t('drawer.category')}</MetaLabel>
                  <MetaEditWrap>
                    <PlanQSelect size="sm" isMulti isSearchable
                      value={docCats(detail).map(c => ({
                        value: c,
                        label: LEGACY_KB_CATEGORIES.includes(c as typeof LEGACY_KB_CATEGORIES[number]) ? (t(`cat.${c}`) as string) : c,
                      }))}
                      onChange={async (opts) => {
                        const arr = Array.isArray(opts) ? opts : [];
                        const next = arr.map(o => String((o as PlanQSelectOption).value));
                        const cur = docCats(detail);
                        if (next.length === cur.length && next.every((v, i) => v === cur[i])) return;
                        if (next.length === 0) return;  // 최소 1개 강제
                        try {
                          await updateKnowledge(businessId, detail.id, { categories: next });
                          setDocs(prev => prev.map(x => x.id === detail.id ? { ...x, categories: next, category: next[0] } : x));
                          setDetail(prev => prev ? { ...prev, categories: next, category: next[0] } : prev);
                          setCatError(null);
                        } catch (e) { setCatError(t('drawer.catSaveErr') as string); }
                      }}
                      options={(() => {
                        // 모달(1166-1182)과 동일 union — LEGACY 6 + 마스터 + orphan + 현재 문서 카테고리.
                        const seen = new Set<string>();
                        const opts: { value: string; label: string }[] = [];
                        for (const c of LEGACY_KB_CATEGORIES) { seen.add(c); opts.push({ value: c, label: t(`cat.${c}`) as string }); }
                        for (const m of catMaster) if (!seen.has(m.name)) { seen.add(m.name); opts.push({ value: m.name, label: m.name }); }
                        for (const o of catOrphan) if (!seen.has(o)) { seen.add(o); opts.push({ value: o, label: o }); }
                        for (const c of docCats(detail)) if (!seen.has(c)) { seen.add(c); opts.push({ value: c, label: c }); }
                        return opts;
                      })()} />
                    {catError && <span style={{ fontSize: 11, color: '#B91C1C' }}>{catError}</span>}
                  </MetaEditWrap>
                  {/* N+65 — 상세 패널 visibility 통합 (등록 모달과 동일 VisibilityField). 옛 scope/project/client/read_policy 4 row 폐지. */}
                  <MetaLabel>{t('drawer.visibility', { defaultValue: '공개' }) as string}</MetaLabel>
                  <MetaEditWrap style={{ gridColumn: '1 / -1' }}>
                    <VisibilityField
                      value={parseVisibility({
                        vlevel: detail.vlevel ?? null,
                        scope: detail.scope ?? null,
                        read_policy: detail.read_policy ?? null,
                        project_id: detail.project_id ?? null,
                        client_id: detail.client_id ?? null,
                        client_ids: detail.client_ids ?? null,
                        target_member_ids: detail.target_member_ids ?? null,
                      })}
                      onChange={async (v: VisibilityValue) => {
                        const payload = serializeVisibility(v);
                        try {
                          const updated = await updateKnowledge(businessId, detail.id, payload);
                          setDocs(prev => prev.map(x => x.id === detail.id ? { ...x, ...updated } : x));
                          setDetail(prev => prev ? { ...prev, ...updated } : prev);
                        } catch { /* skip */ }
                      }}
                      projects={projects.map(p => ({ id: p.id, name: p.name }))}
                      clients={clients.map(c => ({ id: c.id, display_name: c.display_name, biz_name: c.biz_name, company_name: c.company_name }))}
                      members={members}
                    />
                  </MetaEditWrap>
                  {/* D4 #62 — 보안등급 (visibility 와 별개 축. 내부·기밀은 외부 공유·번들 차단) */}
                  <MetaLabel>
                    {t('securityLevel.label', { defaultValue: '보안등급', ns: 'common' }) as string}
                    {detail.security_level && detail.security_level !== 'general' && (
                      <span style={{ marginLeft: 6 }}><SecurityLevelBadge level={detail.security_level} /></span>
                    )}
                  </MetaLabel>
                  <MetaEditWrap style={{ gridColumn: '1 / -1' }}>
                    <PlanQSelect
                      size="sm" isClearable={false} isSearchable={false}
                      value={{ value: detail.security_level || 'general', label: secLabel(detail.security_level || 'general') }}
                      options={(['general', 'internal', 'confidential'] as const).map((lv) => ({ value: lv, label: secLabel(lv) }))}
                      onChange={async (o) => {
                        const lv = (((o as { value?: string })?.value) || 'general') as 'general' | 'internal' | 'confidential';
                        try {
                          const r = await updateKbSecurityLevel(detail.id, lv);
                          setDocs(prev => prev.map(x => x.id === detail.id ? { ...x, security_level: lv } : x));
                          setDetail(prev => prev ? { ...prev, security_level: lv, ...(r.revoked_share ? { share_token: null } : {}) } : prev);
                        } catch { /* keep current on error */ }
                      }}
                    />
                    <SecLevelHint>{t(`securityLevel.${detail.security_level || 'general'}Hint`, { defaultValue: '', ns: 'common' }) as string}</SecLevelHint>
                  </MetaEditWrap>
                  <MetaLabel>{t('drawer.tags', '태그')}</MetaLabel>
                  <MetaEditWrap>
                    <TagsEdit
                      docId={detail.id}
                      businessId={businessId}
                      initialValue={Array.isArray(detail.tags) ? detail.tags : []}
                      onSaved={(tags) => {
                        setDocs(prev => prev.map(x => x.id === detail.id ? { ...x, tags } : x));
                        setDetail(prev => prev ? { ...prev, tags } : prev);
                      }}
                      onError={() => setActionError(t('errors.saveFailed', '저장에 실패했습니다. 권한을 확인하거나 다시 시도해 주세요.') as string)}
                    />
                  </MetaEditWrap>
                  {/* N+65 — read_policy 옛 2 select 제거. visibility 에 통합됨. */}
                  <MetaLabel>{t('drawer.status')}</MetaLabel>
                  <MetaValue>{t(`status.${detail.status}`)}</MetaValue>
                  <MetaLabel>{t('drawer.createdAt')}</MetaLabel>
                  <MetaValue>{formatDateSafe(detail.created_at ?? (detail as { createdAt?: string }).createdAt)}</MetaValue>
                  <MetaLabel>{t('drawer.updatedAt')}</MetaLabel>
                  <MetaValue>{formatDateSafe(detail.updated_at ?? (detail as { updatedAt?: string }).updatedAt)}</MetaValue>
                </MetaGrid>
              </DrawerSection>
              <DrawerSection>
                <SectionLabel>{t('drawer.body')}</SectionLabel>
                <DrawerBodyEdit
                  docId={detail.id}
                  businessId={businessId}
                  initialValue={detail.body || ''}
                  onSaved={(v) => {
                    setDetail(prev => prev ? { ...prev, body: v } : prev);
                    setDocs(prev => prev.map(x => x.id === detail.id ? { ...x, body: v } : x));
                  }}
                  onError={() => setActionError(t('errors.saveFailed', '저장에 실패했습니다. 권한을 확인하거나 다시 시도해 주세요.') as string)}
                />
              </DrawerSection>

              {/* 사용자 정의 항목 — 인라인 편집 */}
              {Array.isArray(detail.custom_columns) && detail.custom_columns.length > 0 && (
                <DrawerSection>
                  <SectionLabel>{t('drawer.customColumns', '항목')}</SectionLabel>
                  <DrawerCustomList>
                    {detail.custom_columns.map(col => (
                      <DrawerCustomRow key={col.id}>
                        <DrawerCustomLabel>{col.name}</DrawerCustomLabel>
                        <InlineCellEdit
                          docId={detail.id}
                          colId={col.id}
                          colType={col.type}
                          initialValue={(detail.custom_values || {})[col.id] as string | undefined}
                          businessId={businessId}
                          onSaved={(newVal) => {
                            setDocs(prev => prev.map(x => x.id === detail.id
                              ? { ...x, custom_values: { ...(x.custom_values || {}), [col.id]: newVal } }
                              : x));
                            setDetail(prev => prev ? { ...prev, custom_values: { ...(prev.custom_values || {}), [col.id]: newVal } } : prev);
                          }}
                        />
                      </DrawerCustomRow>
                    ))}
                  </DrawerCustomList>
                </DrawerSection>
              )}
              {/* 첨부 파일·문서 — AttachmentField 통합 컴포넌트로 통일 (사이클 P5 후속, 2026-05-14).
                  새 정보 등록 모달과 같은 UI/UX. 새 업로드는 표준 File 테이블 등록 후 즉시
                  attached_file_ids 에 link. 기존 파일/문서 선택도 즉시 PATCH updateKnowledge. */}
              <DrawerSection>
                <SectionLabel>
                  {t('drawer.attached', '첨부 파일·문서')}
                  {(((detail.attached_files?.length) || 0) + ((detail.attached_posts?.length) || 0)) > 0 && (
                    <small> ({((detail.attached_files?.length) || 0) + ((detail.attached_posts?.length) || 0)})</small>
                  )}
                </SectionLabel>

                {/* 현재 첨부된 파일 목록 — read-only 표시 + remove */}
                {(detail.attached_files?.length || 0) > 0 && (
                  <AttachList>
                    {(detail.attached_files || []).map(f => (
                      <AttachRow key={`f-${f.id}`}>
                        <AttachIcon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                          <polyline points="14 2 14 8 20 8"/>
                        </AttachIcon>
                        <AttachName>{f.file_name}</AttachName>
                        <AttachMeta>{formatBytes(f.file_size)}</AttachMeta>
                        <AttachAction
                          href={f.storage_provider === 'gdrive' && f.external_url ? f.external_url : `/api/files/${businessId}/${f.id}/download`}
                          target={f.storage_provider === 'gdrive' ? '_blank' : undefined}
                          rel="noopener noreferrer"
                          download={f.storage_provider !== 'gdrive' ? f.file_name : undefined}
                          title={t('drawer.download', '다운로드') as string}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                            <polyline points="7 10 12 15 17 10"/>
                            <line x1="12" y1="15" x2="12" y2="3"/>
                          </svg>
                        </AttachAction>
                        <AttachRemoveBtn type="button" title={t('drawer.removeAttach', '제거') as string}
                          onClick={async () => {
                            const cur = Array.isArray(detail.attached_file_ids) ? detail.attached_file_ids : [];
                            const next = cur.filter(id => id !== f.id);
                            try {
                              await updateKnowledge(businessId, detail.id, { attached_file_ids: next });
                              setDetail(prev => prev ? { ...prev, attached_file_ids: next, attached_files: (prev.attached_files || []).filter(x => x.id !== f.id) } : prev);
                              setDocs(prev => prev.map(x => x.id === detail.id ? { ...x, attached_file_ids: next } : x));
                            } catch { /* skip */ }
                          }}>×</AttachRemoveBtn>
                      </AttachRow>
                    ))}
                  </AttachList>
                )}

                {/* 현재 첨부된 문서 목록 — read-only 표시 + remove */}
                {(detail.attached_posts?.length || 0) > 0 && (
                  <AttachList>
                    {(detail.attached_posts || []).map(p => (
                      <AttachRow key={`p-${p.id}`}>
                        <AttachIcon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                          <polyline points="14 2 14 8 20 8"/>
                          <line x1="16" y1="13" x2="8" y2="13"/>
                          <line x1="16" y1="17" x2="8" y2="17"/>
                        </AttachIcon>
                        <AttachName>{p.title}</AttachName>
                        {p.category && <AttachMeta>{p.category}</AttachMeta>}
                        <AttachAction
                          href={`/docs?post=${p.id}`}
                          title={t('drawer.openPost', '문서 열기') as string}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                            <polyline points="15 3 21 3 21 9"/>
                            <line x1="10" y1="14" x2="21" y2="3"/>
                          </svg>
                        </AttachAction>
                        <AttachRemoveBtn type="button" title={t('drawer.removeAttach', '제거') as string}
                          onClick={async () => {
                            const cur = Array.isArray(detail.attached_post_ids) ? detail.attached_post_ids : [];
                            const next = cur.filter(id => id !== p.id);
                            try {
                              await updateKnowledge(businessId, detail.id, { attached_post_ids: next });
                              setDetail(prev => prev ? { ...prev, attached_post_ids: next, attached_posts: (prev.attached_posts || []).filter(x => x.id !== p.id) } : prev);
                              setDocs(prev => prev.map(x => x.id === detail.id ? { ...x, attached_post_ids: next } : x));
                            } catch { /* skip */ }
                          }}>×</AttachRemoveBtn>
                      </AttachRow>
                    ))}
                  </AttachList>
                )}

                {/* 추가 영역 — AttachmentField (등록 모달과 동일 컴포넌트) */}
                <AttachmentField
                  businessId={businessId}
                  uploads={[]}
                  onUploadsChange={async (files) => {
                    if (files.length === 0) return;
                    // 새 업로드 → 표준 File 등록 → file_id + 메타 받음 → attached_file_ids 에 추가
                    const newAttached: KbDetail['attached_files'] = [];
                    const newFileIds: number[] = [];
                    for (const file of files) {
                      try {
                        const r = await uploadMyFile(businessId, file);
                        if (r.success && r.file) {
                          const fid = Number(String(r.file.id).replace(/^direct-/, ''));
                          if (Number.isFinite(fid)) {
                            newFileIds.push(fid);
                            newAttached!.push({
                              id: fid,
                              file_name: r.file.file_name,
                              file_size: r.file.file_size,
                              mime_type: r.file.mime_type || null,
                              storage_provider: r.file.storage_provider || 'planq',
                              external_url: null,
                            });
                          }
                        }
                      } catch { /* 한 건 실패해도 다른 파일은 계속 */ }
                    }
                    if (newFileIds.length === 0) return;
                    const current = Array.isArray(detail.attached_file_ids) ? detail.attached_file_ids : [];
                    const next = Array.from(new Set([...current, ...newFileIds]));
                    try {
                      await updateKnowledge(businessId, detail.id, { attached_file_ids: next });
                      setDetail(prev => prev ? {
                        ...prev,
                        attached_file_ids: next,
                        attached_files: [...(prev.attached_files || []), ...(newAttached || [])],
                      } : prev);
                      setDocs(prev => prev.map(x => x.id === detail.id ? { ...x, attached_file_ids: next } : x));
                    } catch { /* skip */ }
                  }}
                  existingFileIds={detail.attached_file_ids || []}
                  onExistingFileIdsChange={async (ids) => {
                    // 추가된 ID 만 빠르게 PATCH (제거는 위 AttachRemoveBtn 에서 처리)
                    const current = Array.isArray(detail.attached_file_ids) ? detail.attached_file_ids : [];
                    const added = ids.filter(id => !current.includes(id));
                    if (added.length === 0) return;
                    const next = Array.from(new Set([...current, ...added]));
                    try {
                      await updateKnowledge(businessId, detail.id, { attached_file_ids: next });
                      // 새로 추가된 파일들의 메타 합치기 — 이미 fetch 된 wsFiles 에서 lookup
                      const addedMeta = added
                        .map(id => (wsFiles || []).find(f => Number(String(f.id).replace(/^direct-/, '')) === id))
                        .filter((f): f is ProjectFile => !!f && typeof f.id !== 'undefined')
                        .map(f => ({
                          id: Number(String(f.id).replace(/^direct-/, '')),
                          file_name: f.file_name, file_size: f.file_size,
                          mime_type: f.mime_type || null,
                          storage_provider: f.storage_provider || 'planq',
                          external_url: f.external_url || null,
                        }));
                      setDetail(prev => prev ? {
                        ...prev,
                        attached_file_ids: next,
                        attached_files: [...(prev.attached_files || []), ...addedMeta],
                      } : prev);
                      setDocs(prev => prev.map(x => x.id === detail.id ? { ...x, attached_file_ids: next } : x));
                    } catch { /* skip */ }
                  }}
                  includePosts
                  existingPostIds={detail.attached_post_ids || []}
                  onExistingPostIdsChange={async (ids) => {
                    const current = Array.isArray(detail.attached_post_ids) ? detail.attached_post_ids : [];
                    const added = ids.filter(id => !current.includes(id));
                    if (added.length === 0) return;
                    const next = Array.from(new Set([...current, ...added]));
                    try {
                      await updateKnowledge(businessId, detail.id, { attached_post_ids: next });
                      const addedMeta = added
                        .map(id => (wsPosts || []).find(p => p.id === id))
                        .filter((p): p is PostRow => !!p)
                        .map(p => ({ id: p.id, title: p.title, project_id: p.project_id ?? null, category: p.category ?? null }));
                      setDetail(prev => prev ? {
                        ...prev,
                        attached_post_ids: next,
                        attached_posts: [...(prev.attached_posts || []), ...addedMeta],
                      } : prev);
                      setDocs(prev => prev.map(x => x.id === detail.id ? { ...x, attached_post_ids: next } : x));
                    } catch { /* skip */ }
                  }}
                  workspaceFiles={wsFiles}
                />
              </DrawerSection>
            </DrawerSections>
          )}
        </DetailDrawer.Body>
        <DetailDrawer.Footer>
          <ShareFooterBtn type="button" onClick={() => setShareOpen(true)} title={t('drawer.share', { defaultValue: '공유' }) as string}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
              <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
            </svg>
            {t('drawer.share', { defaultValue: '공유' }) as string}
          </ShareFooterBtn>
          <Spacer />
          <DangerBtn type="button" onClick={() => detailId && setConfirmDelete(detailId)}>{t('drawer.delete')}</DangerBtn>
        </DetailDrawer.Footer>
      </DetailDrawer>

      {/* 공유 모달 (단건) */}
      {shareOpen && detail && (
        <ShareModal
          open={shareOpen}
          entityType="kb_document"
          entityId={detail.id}
          entityTitle={detail.title}
          onClose={() => setShareOpen(false)}
        />
      )}

      {/* N+93 — 번들(다건/카테고리) 공유 결과 링크 모달 (#6) */}
      {bundleShare && (
        <BundleBackdrop onClick={() => setBundleShare(null)}>
          <BundleCard onClick={(e) => e.stopPropagation()}>
            <BundleHead>
              <BundleTitle>{t('select.bundleShareTitle', '공유 링크가 생성됐어요') as string}</BundleTitle>
              <BundleClose type="button" onClick={() => setBundleShare(null)} aria-label={t('modal.close', { defaultValue: '닫기' }) as string}>×</BundleClose>
            </BundleHead>
            <BundleDesc>{t('select.bundleShareDesc', { label: bundleShare.label, defaultValue: `${bundleShare.label} · 받는 사람은 문서처럼 미리볼 수 있어요.` }) as string}</BundleDesc>
            <BundleLinkRow>
              <BundleLinkInput readOnly value={bundleShare.url} onFocus={(e) => e.currentTarget.select()} />
              <BundleCopyBtn type="button" onClick={async () => {
                try { await navigator.clipboard.writeText(bundleShare.url); setBundleCopied(true); setTimeout(() => setBundleCopied(false), 2000); } catch { /* ignore */ }
              }}>{bundleCopied ? t('select.copied', '복사됨 ✓') : t('select.copy', '복사')}</BundleCopyBtn>
            </BundleLinkRow>
            <BundleOpen href={bundleShare.url} target="_blank" rel="noreferrer">{t('select.bundleOpen', '미리보기 열기 →') as string}</BundleOpen>
          </BundleCard>
        </BundleBackdrop>
      )}

      {/* ─── 삭제 확인 ─── */}
      <ConfirmDialog
        isOpen={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete !== null && performDelete(confirmDelete)}
        title={t('drawer.delete') as string}
        message={t('drawer.deleteConfirm') as string}
        confirmText={t('drawer.delete') as string}
        cancelText={t('modal.cancel') as string}
        variant="danger"
      />

      {/* ─── 일괄 삭제 확인 ─── */}
      <ConfirmDialog
        isOpen={bulkDeleteOpen}
        onClose={() => setBulkDeleteOpen(false)}
        onConfirm={async () => {
          const ids = Array.from(selectedIds);
          for (const id of ids) {
            try { await deleteKnowledge(businessId, id); } catch { /* skip */ }
          }
          setBulkDeleteOpen(false);
          setSelectedIds(new Set());
          setSelectMode(false);
          await load();
        }}
        title={t('select.deleteTitle', '선택 항목 삭제') as string}
        message={t('select.deleteConfirm', '{{n}}건을 삭제합니다. 되돌릴 수 없습니다.', { n: selectedIds.size }) as string}
        confirmText={t('select.delete', '선택 삭제') as string}
        cancelText={t('modal.cancel') as string}
        variant="danger"
      />

      {/* ─── 사이클 P3 — 통합 단일 폼 등록 모달 ─── */}
      {modalOpen && (
        <>
          <Backdrop onClick={() => !submitting && closeModal()} />
          <Modal onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
            <ModalHeader>
              <ModalTitle>{t('modal.title')}</ModalTitle>
              <ModalCloseBtn type="button" onClick={() => !submitting && closeModal()} aria-label="Close">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="6" y1="6" x2="18" y2="18"/><line x1="6" y1="18" x2="18" y2="6"/></svg>
              </ModalCloseBtn>
            </ModalHeader>
            <ModalBody>
              {/* 1) 제목 (필수) */}
              <Field>
                <Label>{t('modal.titleLabel')} <RequiredMark>*</RequiredMark></Label>
                <TextInput value={draft.title} onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
                  placeholder={t('modal.titlePh') as string} maxLength={300} />
              </Field>

              {/* 2) 카테고리 — N+64 자유 추가/편집 (LEGACY 6 + master + orphan union, 자유 추가 input) */}
              <Field>
                <Label>{t('modal.category')}</Label>
                <PlanQSelect size="sm" isMulti isSearchable
                  value={(draft.categories.length > 0 ? draft.categories : [draft.category]).map(c => ({
                    value: c, label: LEGACY_KB_CATEGORIES.includes(c as typeof LEGACY_KB_CATEGORIES[number]) ? (t(`cat.${c}`) as string) : c,
                  }))}
                  onChange={(opts) => {
                    const arr = Array.isArray(opts) ? opts : [];
                    const next = arr.map(o => String((o as PlanQSelectOption).value));
                    setDraft(d => ({ ...d, categories: next.length > 0 ? next : ['manual'], category: next[0] || 'manual' }));
                  }}
                  options={(() => {
                    const seen = new Set<string>();
                    const opts: { value: string; label: string }[] = [];
                    for (const c of LEGACY_KB_CATEGORIES) { seen.add(c); opts.push({ value: c, label: t(`cat.${c}`) as string }); }
                    for (const m of catMaster) if (!seen.has(m.name)) { seen.add(m.name); opts.push({ value: m.name, label: m.name }); }
                    for (const o of catOrphan) if (!seen.has(o)) { seen.add(o); opts.push({ value: o, label: o }); }
                    return opts;
                  })()} />
                {/* 자유 추가 input */}
                <NewCatRow>
                  <TextInput
                    value={newCatInput}
                    onChange={e => setNewCatInput(e.target.value)}
                    placeholder={t('modal.newCatPh', '새 카테고리 이름') as string}
                    maxLength={40}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); (document.getElementById('kb-add-cat-btn') as HTMLButtonElement)?.click(); }
                    }}
                  />
                  <SecondaryBtn
                    id="kb-add-cat-btn" type="button" disabled={!newCatInput.trim() || catAdding}
                    onClick={async () => {
                      const name = newCatInput.trim();
                      if (!name || !businessId) return;
                      // 중복 검사 — 이미 선택 또는 master 에 있으면 안내 + 선택만
                      const dup = draft.categories.includes(name);
                      if (dup) { setNewCatInput(''); return; }
                      setCatAdding(true);
                      try {
                        await createKbCategory(businessId, name);
                        await reloadCategories();
                        setDraft(d => ({ ...d, categories: [...d.categories, name] }));
                        setNewCatInput('');
                      } catch (_) { /* ignore */ } finally { setCatAdding(false); }
                    }}>
                    + {t('modal.addCat', '추가')}
                  </SecondaryBtn>
                </NewCatRow>
                {newCatInput.trim() && (() => {
                  const name = newCatInput.trim();
                  const exists = [...LEGACY_KB_CATEGORIES, ...catMaster.map(m => m.name), ...catOrphan].includes(name);
                  if (exists) return <DupHint>{t('modal.catDup', '이미 같은 이름이 있어요 — 추가하면 자동 선택됩니다') as string}</DupHint>;
                  return null;
                })()}
              </Field>

              {/* 3) 사용자 정의 항목 추가 */}
              <Field>
                <Label>{t('modal.customColumns', '항목 추가')} <OptionalMark>{t('modal.optional', '(선택)')}</OptionalMark></Label>
                <CustomColList>
                  {draft.custom_columns.map((col, idx) => (
                    <CustomColRow key={col.id}>
                      <CustomColInput
                        type="text" placeholder={t('modal.colNamePh', '항목명') as string}
                        value={col.name}
                        onChange={e => {
                          const cols = [...draft.custom_columns];
                          cols[idx] = { ...col, name: e.target.value };
                          setDraft(d => ({ ...d, custom_columns: cols }));
                        }}
                      />
                      <CustomColTypeSel>
                        <PlanQSelect size="sm" isSearchable={false}
                          value={{ value: col.type, label: COL_TYPE_DEFAULT_LABEL[col.type] ? t(`colType.${col.type}`, { defaultValue: COL_TYPE_DEFAULT_LABEL[col.type] }) : col.type }}
                          onChange={(opt) => {
                            const cols = [...draft.custom_columns];
                            cols[idx] = { ...col, type: (opt as PlanQSelectOption | null)?.value as string || 'text' };
                            setDraft(d => ({ ...d, custom_columns: cols }));
                          }}
                          options={Object.entries(COL_TYPE_DEFAULT_LABEL).map(([v, l]) => ({ value: v, label: t(`colType.${v}`, { defaultValue: l }) }))} />
                      </CustomColTypeSel>
                      <CustomColInput
                        type={col.type === 'date' ? 'date' : col.type === 'number' ? 'number' : 'text'}
                        placeholder={t('modal.colValuePh', '값') as string}
                        value={String(draft.custom_values[col.id] || '')}
                        onChange={e => setDraft(d => ({ ...d, custom_values: { ...d.custom_values, [col.id]: e.target.value } }))}
                      />
                      <ShowInListToggle
                        type="button"
                        $on={col.show_in_list}
                        onClick={() => {
                          const cols = [...draft.custom_columns];
                          cols[idx] = { ...col, show_in_list: !col.show_in_list };
                          setDraft(d => ({ ...d, custom_columns: cols }));
                        }}
                        title={t('modal.showInListHint', '리스트에 항상 표시') as string}
                      >
                        {col.show_in_list ? '◉' : '○'}
                      </ShowInListToggle>
                      <RemoveColBtn type="button" onClick={() => {
                        const cols = draft.custom_columns.filter((_, i) => i !== idx);
                        const vals = { ...draft.custom_values };
                        delete vals[col.id];
                        setDraft(d => ({ ...d, custom_columns: cols, custom_values: vals }));
                      }}>×</RemoveColBtn>
                    </CustomColRow>
                  ))}
                  <AddColBtn type="button" onClick={() => {
                    const id = `c${Math.random().toString(36).slice(2, 10)}`;
                    setDraft(d => ({ ...d, custom_columns: [...d.custom_columns, { id, name: '', type: 'text', show_in_list: true }] }));
                  }}>+ {t('modal.addColumn', '항목 추가')}</AddColBtn>
                </CustomColList>
              </Field>

              {/* 4) 내용 — N+72-5: TextArea → RichEditor (Tiptap, HTML 출력). Q docs 와 동일 에디터 */}
              <Field>
                <Label>{t('modal.body')} <OptionalMark>{t('modal.optional', '(선택)')}</OptionalMark></Label>
                <RichEditor
                  value={draft.body}
                  onChange={(html) => setDraft(d => ({ ...d, body: html }))}
                  placeholder={t('modal.bodyPh') as string}
                  minHeight={200}
                  uploadUrl={businessId ? `/api/files/${businessId}/upload-inline-image` : undefined}
                />
              </Field>

              {/* 5) 공개 범위 — N+65 VisibilityField 공통 컴포넌트 (등록·상세 동일 UI) */}
              <Field>
                <Label>{t('modal.readPolicy', { defaultValue: '공개' }) as string}</Label>
                <VisibilityField
                  value={{
                    vlevel: draft.vlevel,
                    variant: draft.vlevel === 'L2'
                      ? (draft.scope === 'project' ? 'L2_project' : 'L2_members')
                      : draft.vlevel,
                    project_id: draft.project_id,
                    client_ids: draft.client_ids,
                    target_member_ids: draft.target_member_ids,
                  }}
                  onChange={(v) => {
                    const ser = serializeVisibility(v);
                    setDraft(d => ({
                      ...d,
                      vlevel: v.vlevel,
                      scope: v.variant === 'L1' ? 'private'
                        : v.variant === 'L2_project' ? 'project'
                        : v.variant === 'L4' ? 'client'
                        : 'workspace',
                      read_policy: v.variant === 'L2_members' ? 'owner' : 'all',
                      project_id: ser.project_id,
                      client_id: ser.client_id,
                      client_ids: ser.client_ids,
                      target_member_ids: ser.target_member_ids,
                    }));
                  }}
                  projects={projects.map(p => ({ id: p.id, name: p.name }))}
                  clients={clients.map(c => ({ id: c.id, display_name: c.display_name, biz_name: c.biz_name, company_name: c.company_name }))}
                  members={members}
                />
              </Field>

              {/* 6) 자료 첨부 — 새 업로드 + 기존 파일/문서 연결 (AttachmentField 통합 컴포넌트)
                  사이클 P5 후속 (2026-05-14) — 상세 우측 패널과 동일 UI/UX 통일. */}
              <Field>
                <Label>{t('modal.attach', '자료 첨부')} <OptionalMark>{t('modal.optional')}</OptionalMark></Label>
                <AttachmentField
                  businessId={businessId}
                  uploads={uploadFiles}
                  onUploadsChange={setUploadFiles}
                  existingFileIds={Array.from(pickedFileIds)}
                  onExistingFileIdsChange={(ids) => setPickedFileIds(new Set(ids))}
                  includePosts
                  existingPostIds={Array.from(pickedPostIds)}
                  onExistingPostIdsChange={(ids) => setPickedPostIds(new Set(ids))}
                  workspaceFiles={wsFiles}
                  accept=".txt,.md,.markdown,.html,.htm,.json,.csv,.log,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip"
                />
              </Field>

              {submitError && <ErrorBox>{submitError}</ErrorBox>}
              {resultMsg && <SuccessBox>{resultMsg}</SuccessBox>}
            </ModalBody>
            <ModalFooter>
              <SecondaryBtn type="button" onClick={closeModal} disabled={submitting}>
                {t('modal.cancel')}
              </SecondaryBtn>
              <PrimaryBtn type="button" onClick={submit} disabled={submitting}>
                {submitting ? t('modal.saving') : t('modal.save')}
              </PrimaryBtn>
            </ModalFooter>
          </Modal>
        </>
      )}

      {aiIngestOpen && businessId && (
        <KbAiIngestModal businessId={businessId} onClose={() => setAiIngestOpen(false)} onSaved={() => { setAiIngestOpen(false); load(); }} />
      )}
      {csvIngestOpen && businessId && (
        <KbCsvIngestModal businessId={businessId} onClose={() => setCsvIngestOpen(false)} onSaved={() => { setCsvIngestOpen(false); load(); }} />
      )}
    </PageShell>
  );
};

export default KnowledgePage;

// ─── DetailDrawer 제목 편집 (헤더 인라인) ───
const DrawerTitleEdit: React.FC<{
  docId: number;
  businessId: number;
  initialValue: string;
  onSaved: (v: string) => void;
}> = ({ docId, businessId, initialValue, onSaved }) => {
  const { t } = useTranslation('knowledge');
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(initialValue);
  React.useEffect(() => { if (!editing) setDraft(initialValue); }, [initialValue, editing]);
  const commit = async () => {
    setEditing(false);
    if (draft.trim() === initialValue) return;
    try { await updateKnowledge(businessId, docId, { title: draft.trim() }); onSaved(draft.trim()); } catch { /* skip */ }
  };
  if (!editing) {
    return <DrawerTitle onClick={() => setEditing(true)} title={t('inline.editHint', '클릭해서 편집') as string}>{initialValue}</DrawerTitle>;
  }
  return (
    <DrawerTitleInput
      autoFocus
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') { setDraft(initialValue); setEditing(false); }
      }}
    />
  );
};
// 행 제목 인라인 편집 — Q task 패턴 (클릭 → input 변환 → blur 저장)
const RowTitleEdit: React.FC<{
  docId: number;
  businessId: number;
  initialValue: string;
  onSaved: (v: string) => void;
}> = ({ docId, businessId, initialValue, onSaved }) => {
  const { t } = useTranslation('knowledge');
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(initialValue);
  React.useEffect(() => { if (!editing) setDraft(initialValue); }, [initialValue, editing]);
  const commit = async () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (!trimmed || trimmed === initialValue) return;
    try { await updateKnowledge(businessId, docId, { title: trimmed }); onSaved(trimmed); } catch { /* skip */ }
  };
  if (!editing) {
    return (
      <RowTitle
        onClick={(e) => { e.stopPropagation(); setEditing(true); }}
        title={t('inline.editHint', '클릭해서 편집') as string}
      >
        {initialValue}
      </RowTitle>
    );
  }
  return (
    <RowTitleInput
      autoFocus
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') { setDraft(initialValue); setEditing(false); }
      }}
    />
  );
};

const DrawerTitleInput = styled.input`
  font-size: 16px; font-weight: 700; color: #0F172A;
  padding: 4px 8px;
  border: 1px solid #14B8A6; border-radius: 6px;
  background: #FFFFFF; width: 100%;
  &:focus { outline: none; box-shadow: 0 0 0 2px rgba(20,184,166,0.2); }
`;

// ─── DetailDrawer 본문 편집 (textarea 인라인) ───
const DrawerBodyEdit: React.FC<{
  docId: number;
  businessId: number;
  initialValue: string;
  onSaved: (newVal: string) => void;
  onError?: () => void;
}> = ({ docId, businessId, initialValue, onSaved, onError }) => {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(initialValue || '');
  const { open: openLightbox, lightbox } = useImageLightbox();
  React.useEffect(() => { if (!editing) setDraft(initialValue || ''); }, [initialValue, editing]);
  // #121 — 읽기뷰 본문 이미지 클릭 시 확대(라이트박스). img 아니면 편집 진입.
  const onBodyClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const tgt = e.target as HTMLElement;
    if (tgt.tagName === 'IMG') {
      e.stopPropagation();
      const imgs = Array.from(e.currentTarget.querySelectorAll('img')).map((im) => ({ src: (im as HTMLImageElement).src, alt: (im as HTMLImageElement).alt }));
      const idx = imgs.findIndex((x) => x.src === (tgt as HTMLImageElement).src);
      openLightbox(imgs, Math.max(0, idx));
      return;
    }
    setEditing(true);
  };
  const commit = async () => {
    if (draft === (initialValue || '')) { setEditing(false); return; }
    // 옛 회귀: 실패를 silently 삼키고 editing 닫아 "수정 안 됨"으로 보였음. 실패 시 editing 유지 + 부모 배너 노출.
    try {
      await updateKnowledge(businessId, docId, { body: draft });
      onSaved(draft);
      setEditing(false);
    } catch {
      onError?.();
    }
  };
  // N+72-5 — RichEditor (HTML) — 화면 표시도 dangerouslySetInnerHTML 으로 HTML 렌더
  if (!editing) {
    const v = initialValue || '';
    if (!v) return <BodyClickable onClick={() => setEditing(true)}>—</BodyClickable>;
    // 옛 plain text 안 깨지게 — HTML 형태 아니면 <p> wrap
    const isHtml = /<[a-z][\s\S]*>/i.test(v);
    const html = isHtml ? v : `<p>${v.replace(/\n/g, '<br/>')}</p>`;
    return <><BodyClickable onClick={onBodyClick} dangerouslySetInnerHTML={{ __html: html }} />{lightbox}</>;
  }
  return (
    <BodyEditWrap>
      <RichEditor
        value={draft}
        onChange={setDraft}
        onBlur={() => commit()}
        minHeight={180}
        uploadUrl={businessId ? `/api/files/${businessId}/upload-inline-image` : undefined}
      />
    </BodyEditWrap>
  );
};

const BodyClickable = styled.div`
  font-size: 13px; color: #334155; line-height: 1.6;
  word-break: break-word; overflow-wrap: anywhere;
  padding: 10px 12px; background: #F8FAFC; border-radius: 6px;
  cursor: text;
  &:hover { background: #F0FDFA; }
  & p { margin: 0 0 8px; }
  & img { cursor: zoom-in; max-width: 100%; height: auto; border-radius: 6px; }
  & p:last-child { margin-bottom: 0; }
  & ul, & ol { padding-left: 20px; margin: 6px 0; }
  & img { max-width: 100%; height: auto; }
  & a { overflow-wrap: anywhere; }
`;
const BodyEditWrap = styled.div`
  border: 1px solid #14B8A6; border-radius: 8px;
  padding: 6px;
  & .ProseMirror { min-height: 180px; }
`;

// 태그 인라인 편집 — 쉼표 구분 input. blur 시 저장.
const TagsEdit: React.FC<{
  docId: number;
  businessId: number;
  initialValue: string[];
  onSaved: (tags: string[]) => void;
  onError?: () => void;
}> = ({ docId, businessId, initialValue, onSaved, onError }) => {
  const { t } = useTranslation('knowledge');
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState((initialValue || []).join(', '));
  React.useEffect(() => { if (!editing) setDraft((initialValue || []).join(', ')); }, [initialValue, editing]);
  const commit = async () => {
    const next = draft.split(',').map(s => s.trim()).filter(Boolean).slice(0, 12);
    const cur = initialValue || [];
    if (next.length === cur.length && next.every((v, i) => v === cur[i])) { setEditing(false); return; }
    try {
      await updateKnowledge(businessId, docId, { tags: next });
      onSaved(next);
      setEditing(false);
    } catch {
      onError?.();
    }
  };
  if (!editing) {
    if (!initialValue || initialValue.length === 0) {
      return <TagsClickable onClick={() => setEditing(true)}>—</TagsClickable>;
    }
    return (
      <TagsClickable onClick={() => setEditing(true)}>
        {initialValue.map((tag, i) => <TagChip key={i}>{tag}</TagChip>)}
      </TagsClickable>
    );
  }
  return (
    <TagsInput
      autoFocus
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Escape') { setDraft((initialValue || []).join(', ')); setEditing(false); }
        if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); }
      }}
      placeholder={t('tags.placeholder', { defaultValue: '태그1, 태그2, 태그3' })}
    />
  );
};
const TagsClickable = styled.div`
  display: flex; flex-wrap: wrap; gap: 4px; min-height: 24px;
  padding: 4px 6px; cursor: text;
  border-radius: 6px;
  &:hover { background: #F0FDFA; }
`;
const TagChip = styled.span`
  display: inline-flex; align-items: center;
  padding: 2px 8px; font-size: 11px; font-weight: 600; color: #0F766E;
  background: #F0FDFA; border: 1px solid #99F6E4; border-radius: 999px;
`;
const TagsInput = styled.input`
  width: 100%; padding: 6px 10px;
  border: 1px solid #14B8A6; border-radius: 6px;
  font-size: 12px; color: #0F172A; font-family: inherit;
  &:focus { outline: none; box-shadow: 0 0 0 2px rgba(20,184,166,0.2); }
`;
// N+72-5 — BodyTextarea 폐기 (RichEditor 통합)
const DrawerCustomList = styled.div`
  display: flex; flex-direction: column; gap: 8px;
`;
const DrawerCustomRow = styled.div`
  display: grid; grid-template-columns: 100px 1fr;
  gap: 12px; align-items: center;
  padding: 6px 0; border-bottom: 1px solid #F1F5F9;
  &:last-child { border-bottom: none; }
`;
const DrawerCustomLabel = styled.span`
  font-size: 12px; font-weight: 600; color: #64748B;
`;

// ─── 인라인 셀 편집 — 리스트 행의 커스텀 항목 클릭 시 그 자리에서 수정 ───
const InlineCellEdit: React.FC<{
  docId: number;
  colId: string;
  colType: string;
  initialValue: string | undefined;
  businessId: number;
  onSaved: (newVal: string) => void;
}> = ({ docId, colId, colType, initialValue, businessId, onSaved }) => {
  const { t } = useTranslation('knowledge');
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(initialValue == null ? '' : String(initialValue));
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => { if (!editing) setDraft(initialValue == null ? '' : String(initialValue)); }, [initialValue, editing]);

  const commit = async () => {
    setEditing(false);
    if (saving) return;
    if (draft === (initialValue == null ? '' : String(initialValue))) return;
    setSaving(true);
    try {
      // 기존 custom_values 에 이 col 만 update — 백엔드가 partial values 를 받아서 merge 안 하므로 전체 보내야.
      // 안전: 현재 행의 custom_values 전체를 가져와서 부분 갱신 후 PUT.
      // 단, 우리는 초기값만 알고 있어서 전체 values 모름. → onSaved 콜백이 부모 state 갱신하므로 부모가 갖고 있는 d.custom_values 만 전달받아 합쳐서 PUT 하는 게 정확.
      // 단순화: 이 콜만 PUT — 백엔드는 patch 의 custom_values 가 전체로 받음. 부모 상태에서 머지 후 PUT.
      // 여기선 onSaved 만 호출하고 부모가 PUT 처리.
      await updateKnowledge(businessId, docId, {
        // partial — 다음 줄에서 부모가 합쳐서 다시 PUT 하지 않게, 여기서는 단일 column 이라
        // 가장 깨끗한 건 부모가 머지해서 PUT 하는 것이지만, 간단히 단일 column 만 보내고 백엔드는 merge.
        custom_values: { [colId]: draft },
      });
      onSaved(draft);
    } catch { /* skip — 다음 사이클에 에러 처리 */ }
    finally { setSaving(false); }
  };

  if (colType === 'secret') {
    return <CustomValue>{initialValue ? '••••••' : ''}</CustomValue>;
  }
  if (!editing) {
    const v = initialValue == null || initialValue === '' ? '—' : String(initialValue);
    return (
      <InlineValue onClick={(e) => { e.stopPropagation(); setEditing(true); }} title={t('inline.editHint', '클릭해서 편집') as string}>
        {v}
      </InlineValue>
    );
  }
  return (
    <InlineInput
      autoFocus
      type={colType === 'date' ? 'date' : colType === 'number' ? 'number' : colType === 'url' ? 'url' : colType === 'email' ? 'email' : 'text'}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') { setDraft(initialValue == null ? '' : String(initialValue)); setEditing(false); }
      }}
      onClick={(e) => e.stopPropagation()}
    />
  );
};

const InlineValue = styled.span`
  display: inline-block;
  color: #334155; font-weight: 500;
  max-width: 200px; overflow: hidden; text-overflow: ellipsis;
  cursor: text;
  padding: 2px 8px; min-height: 22px;
  border: 1px dashed transparent; border-radius: 4px;
  transition: all 0.12s;
  &:hover { background: #F0FDFA; color: #0F766E; border-color: #CCFBF1; }
`;
const InlineInput = styled.input`
  height: 22px; padding: 0 6px;
  border: 1px solid #14B8A6; border-radius: 4px;
  font-size: 12px; color: #0F172A; background: #fff;
  max-width: 200px;
  &:focus { outline: none; box-shadow: 0 0 0 2px rgba(20,184,166,0.2); }
`;

// ─── styled ───
const NewBtn = styled.button`
  height: 32px; padding: 0 14px;
  background: #14B8A6; color: #FFFFFF;
  border: none; border-radius: 6px;
  font-size: 13px; font-weight: 600; cursor: pointer;
  white-space: nowrap;
  &:hover { background: #0D9488; }
  @media (max-width: 640px) { height: 36px; font-size: 12px; padding: 0 12px; }
`;
const CsvBtn = styled.button`
  display: inline-flex; align-items: center; gap: 6px;
  height: 32px; padding: 0 12px;
  background: #FFFFFF; color: #475569;
  border: 1px solid #CBD5E1; border-radius: 6px;
  font-size: 13px; font-weight: 600; cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s;
  &:hover:not(:disabled) { background: #F1F5F9; border-color: #94A3B8; color: #0F172A; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
  @media (max-width: 640px) { height: 36px; font-size: 12px; padding: 0 10px; gap: 4px; }
`;
// AI 자동 추가 버튼 — 별 아이콘 + teal accent. Q docs NewDocumentModal "AI 로 시작" 패턴 카피.
const AiBtn = styled.button`
  display: inline-flex; align-items: center; gap: 6px;
  height: 32px; padding: 0 12px;
  background: #F0FDFA; color: #0F766E;
  border: 1px solid #99F6E4; border-radius: 6px;
  font-size: 13px; font-weight: 600; cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s;
  svg { color: #14B8A6; }
  &:hover { background: #CCFBF1; border-color: #14B8A6; }
  @media (max-width: 640px) { height: 36px; font-size: 12px; padding: 0 10px; gap: 4px; }
`;
const CsvUploadBtn = styled.button`
  display: inline-flex; align-items: center; gap: 6px;
  height: 32px; padding: 0 12px;
  background: #FFFFFF; color: #475569;
  border: 1px solid #CBD5E1; border-radius: 6px;
  font-size: 13px; font-weight: 600; cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s;
  &:hover { background: #F1F5F9; border-color: #94A3B8; color: #0F172A; }
  @media (max-width: 640px) { height: 36px; font-size: 12px; padding: 0 10px; gap: 4px; }
`;

const Loading = styled.div`padding: 40px; text-align: center; color: #94A3B8;`;
// N+64 — 자유 카테고리 추가 input row
const NewCatRow = styled.div`
  display: flex; gap: 8px; margin-top: 6px;
  & > input { flex: 1; }
`;
const DupHint = styled.div`
  margin-top: 4px;
  padding: 6px 10px;
  background: #FEF3C7; border: 1px solid #FCD34D;
  border-radius: 6px; font-size: 12px; color: #92400E;
`;
// N+65 — 옛 PolicyRadio* / ScopeSubField / SubLabel styled 제거 (VisibilityField 로 통합)

// 사용자 정의 항목 추가 (이름·타입·값·표시여부)
const CustomColList = styled.div`display: flex; flex-direction: column; gap: 6px;`;
const CustomColRow = styled.div`
  display: grid; grid-template-columns: 1fr 130px 1fr 28px 24px;
  gap: 6px; align-items: center;
  @media (max-width: 640px) { grid-template-columns: 1fr 1fr; }
`;
const CustomColInput = styled.input`
  height: 32px; padding: 0 10px;
  border: 1px solid #E2E8F0; border-radius: 6px;
  font-size: 12px; color: #0F172A;
  &:focus { outline: none; border-color: #14B8A6; }
`;
const CustomColTypeSel = styled.div``;
const ShowInListToggle = styled.button<{ $on: boolean }>`
  width: 28px; height: 28px;
  display: inline-flex; align-items: center; justify-content: center;
  background: ${p => p.$on ? '#F0FDFA' : '#F1F5F9'};
  color: ${p => p.$on ? '#0F766E' : '#94A3B8'};
  border: 1px solid ${p => p.$on ? '#CCFBF1' : '#E2E8F0'};
  border-radius: 6px; cursor: pointer; font-size: 11px;
  &:hover { background: ${p => p.$on ? '#CCFBF1' : '#E2E8F0'}; }
`;
const RemoveColBtn = styled.button`
  width: 24px; height: 24px;
  display: inline-flex; align-items: center; justify-content: center;
  background: transparent; border: none; border-radius: 4px;
  color: #94A3B8; cursor: pointer; font-size: 14px;
  &:hover { background: #FEE2E2; color: #DC2626; }
`;
const AddColBtn = styled.button`
  height: 32px; padding: 0 12px;
  background: #F0FDFA; color: #0F766E;
  border: 1px solid #CCFBF1; border-radius: 6px;
  font-size: 12px; font-weight: 600; cursor: pointer;
  align-self: flex-start;
  &:hover { background: #14B8A6; color: #fff; }
`;

// Toolbar — 박스 없이 (페이지 배경 위 inline 배치). 좌측 정렬, 검색·필터·정렬.
const ActionErrorBanner = styled.div`
  display: flex; align-items: center; gap: 8px;
  margin-bottom: 12px; padding: 10px 14px;
  background: #FEF2F2; border: 1px solid #FECACA; border-radius: 8px;
  color: #B91C1C; font-size: 13px; font-weight: 500; cursor: pointer;
`;
const Toolbar = styled.div`
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 0;
  margin-bottom: 12px;
`;
const ToolbarFilter = styled.div`min-width: 140px;`;
const ToolbarSort = styled.div`width: 130px;`;
// 선택 모드 토글 — Toolbar 표준 (36px, Q task 동일)
const SelectToggle = styled.button<{ $on: boolean }>`
  height: 36px; padding: 0 14px;
  background: ${p => p.$on ? '#14B8A6' : '#fff'};
  color: ${p => p.$on ? '#fff' : '#0F172A'};
  border: 1px solid ${p => p.$on ? '#14B8A6' : '#CBD5E1'};
  border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer;
  &:hover { border-color: ${p => p.$on ? '#1E293B' : '#94A3B8'}; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 2px; }
`;
const BulkDeleteBtn = styled.button`
  height: 36px; padding: 0 14px;
  background: #FFFFFF; color: #B91C1C;
  border: 1px solid #FECACA; border-radius: 8px;
  font-size: 12px; font-weight: 600; cursor: pointer;
  &:hover { background: #FEF2F2; border-color: #DC2626; }
`;
// N+93 — 번들 공유 (#6)
const BulkShareBtn = styled.button`
  height: 36px; padding: 0 14px;
  background: #F0FDFA; color: #0F766E;
  border: 1px solid #14B8A6; border-radius: 8px;
  font-size: 12px; font-weight: 600; cursor: pointer;
  transition: background 0.15s;
  &:hover:not(:disabled) { background: #CCFBF1; }
  &:disabled { opacity: 0.6; cursor: default; }
`;
const BundleBackdrop = styled.div`
  position: fixed; inset: 0; z-index: 2200;
  background: rgba(15,23,42,0.45);
  display: flex; align-items: center; justify-content: center; padding: 20px;
`;
const BundleCard = styled.div`
  width: 100%; max-width: 460px;
  background: #FFFFFF; border-radius: 14px; padding: 24px;
  box-shadow: 0 12px 32px rgba(15,23,42,0.18);
`;
const BundleHead = styled.div`display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;`;
const BundleTitle = styled.h3`margin: 0; font-size: 16px; font-weight: 700; color: #0F172A;`;
const BundleClose = styled.button`border: none; background: transparent; font-size: 22px; line-height: 1; color: #94A3B8; cursor: pointer; &:hover { color: #0F172A; }`;
const BundleDesc = styled.div`font-size: 13px; color: #64748B; line-height: 1.6; margin-bottom: 16px;`;
const BundleLinkRow = styled.div`display: flex; gap: 8px; margin-bottom: 12px;`;
const BundleLinkInput = styled.input`
  flex: 1; min-width: 0; height: 40px; padding: 0 12px;
  border: 1px solid #E2E8F0; border-radius: 8px; font-size: 13px; color: #334155; background: #F8FAFC;
  &:focus { outline: none; border-color: #14B8A6; }
`;
const BundleCopyBtn = styled.button`
  height: 40px; padding: 0 16px; white-space: nowrap;
  background: #14B8A6; color: #FFFFFF; border: none; border-radius: 8px;
  font-size: 13px; font-weight: 600; cursor: pointer;
  &:hover { background: #0D9488; }
`;
const BundleOpen = styled.a`
  display: inline-block; font-size: 13px; font-weight: 600; color: #0D9488; text-decoration: none;
  &:hover { text-decoration: underline; }
`;
const RowCheckbox = styled.input`
  width: 16px; height: 16px;
  accent-color: #14B8A6; cursor: pointer;
  vertical-align: middle;
`;

// Q info — 좌측 트리 + 메인 영역 (Q file/Q record 패턴 동일)
const Split = styled.div`
  display: grid; grid-template-columns: 220px 1fr; gap: 12px; align-items: start;
  @media (max-width: 900px) { grid-template-columns: 1fr; }
`;
const TreePanel = styled.div`
  background: #fff; border: 1px solid #E2E8F0; border-radius: 10px; padding: 6px;
  /* N+72-5 fix — Body overflow-y:auto 안에서 sticky top:0. 옛 top:8px 는 padding 과 중복돼 안 보이는 회귀.
     사용자 호소 "문서 길면 메뉴 따라가야 하는데 안 됨" */
  position: sticky; top: 0;
  max-height: calc(100vh - 100px); overflow-y: auto;
  @media (max-width: 900px) { position: static; max-height: none; }
`;
const TreeRoot = styled.div`display: flex; flex-direction: column; gap: 1px;`;
const TreeDivider = styled.div`height: 1px; background: #F1F5F9; margin: 6px 0;`;
const TreeRow = styled.button<{ $selected?: boolean }>`
  display: grid; grid-template-columns: minmax(0, 1fr) auto;
  align-items: center; gap: 8px; padding: 6px 8px;
  background: ${p => p.$selected ? '#F0FDFA' : 'transparent'};
  color: ${p => p.$selected ? '#0F766E' : '#0F172A'};
  border: none; border-radius: 6px; cursor: pointer;
  min-height: 30px; text-align: left; width: 100%;
  &:hover { background: ${p => p.$selected ? '#F0FDFA' : '#F8FAFC'}; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: -2px; }
`;
const TreeName = styled.div`
  min-width: 0; font-size: 12px; font-weight: 500;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
`;
const TreeCount = styled.span`
  font-size: 10px; color: #94A3B8; font-weight: 600;
  min-width: 22px; padding: 1px 6px;
  background: #F1F5F9; border-radius: 999px;
  text-align: center; justify-self: end;
`;
const MainArea = styled.div`display: flex; flex-direction: column; gap: 10px; min-width: 0;`;

// 커스텀 항목 — Row 의 ColCustomArea 안에서 자동 배치
const CustomItem = styled.span`
  display: inline-flex; align-items: center; gap: 4px;
  white-space: nowrap; font-size: 12px;
`;
const CustomLabel = styled.span`color: #94A3B8; font-weight: 500;`;
const CustomValue = styled.span`color: #334155; font-weight: 500;
  max-width: 180px; overflow: hidden; text-overflow: ellipsis;
`;

// Q file (DocsTab) 패턴 통일 — border 1px + radius 10 + overflow hidden
const List = styled.div`
  background: #fff;
  border: 1px solid #E2E8F0;
  border-radius: 10px;
  overflow: hidden;
`;
// 행 컬럼 — Q file 동일 토큰 구조: title 가변 / custom 가변 / category 100px / status 70px / action 36px
// 커스텀 항목이 많은 문서(url 여러 개)도 안 구겨지게 — 커스텀 영역에 충분한 폭 배분.
const KB_LIST_COLS = 'minmax(160px, 1.6fr) minmax(220px, 2.6fr) auto minmax(90px, auto) 36px';
const RowChk = styled.div`display:flex; align-items:center; justify-content:center;`;
const RowAct = styled.div`display:flex; justify-content:flex-end;`;
const RowTitleInput = styled.input`
  width: 100%; height: 26px; padding: 0 8px;
  font-size: 14px; font-weight: 600; color: #0F172A;
  border: 1px solid #14B8A6; border-radius: 4px; background: #fff;
  &:focus { outline: none; box-shadow: 0 0 0 2px rgba(20,184,166,0.2); }
`;
const IconBtn = styled.button`
  width: 28px; height: 28px;
  display: flex; align-items: center; justify-content: center;
  background: transparent; border: none; color: #94A3B8;
  border-radius: 6px; cursor: pointer;
  &:hover { background: #FEE2E2; color: #DC2626; }
`;
// 행 그리드: [제목 240px] [커스텀 1fr (자동 채움)] [메타 auto] [상태 우측]
// 모든 행에서 같은 컬럼 정렬 — 30년차 디자이너 관점의 일관성
// Q file ListRow 패턴 — 36px(체크) + 5컬럼
const Row = styled.div<{ $active: boolean; $selectMode?: boolean }>`
  cursor: pointer;
  display: grid;
  grid-template-columns: ${p => p.$selectMode ? `36px ${KB_LIST_COLS}` : KB_LIST_COLS};
  gap: 8px; align-items: start;
  padding: 10px 14px;
  background: ${p => p.$active ? '#F0FDFA' : 'transparent'};
  border-bottom: 1px solid #F1F5F9;
  transition: background 0.12s;
  &:last-child { border-bottom: none; }
  &:hover { background: ${p => p.$active ? '#F0FDFA' : '#F8FAFC'}; }
  @media (max-width: 900px) {
    grid-template-columns: 1fr auto;
    grid-auto-rows: auto;
  }
`;
// 좌측: 제목
const ColTitleArea = styled.div`min-width: 0;`;
// 가운데: 커스텀 항목 (자동 배치)
const ColCustomArea = styled.div`
  display: flex; flex-wrap: wrap; gap: 12px 16px;
  align-items: center;
  min-width: 0;
  @media (max-width: 900px) { grid-column: 1 / -1; }
`;
// 우측: 카테고리 chip(여러개 가능) + 메타 (스코프·날짜)
const ColMeta = styled.div`
  display: flex; align-items: center; gap: 6px;
  flex-wrap: wrap; justify-content: flex-end;
  font-size: 11px; color: #94A3B8;
  @media (max-width: 900px) { display: none; }
`;
const CategoryChip = styled.span`
  display: inline-flex; align-items: center;
  padding: 2px 8px;
  background: #F0FDFA; color: #0F766E;
  border-radius: 999px;
  font-size: 11px; font-weight: 600;
`;
const MetaText = styled.span`
  font-size: 11px; color: #94A3B8;
`;
// 우측 끝: 권한·상태 chip
const ColRight = styled.div`
  display: flex; align-items: center; gap: 6px;
  flex-shrink: 0;
`;
const PolicyChip = styled.span<{ $kind: 'owner' }>`
  padding: 2px 8px; border-radius: 999px;
  font-size: 10px; font-weight: 600;
  background: #FEF3C7; color: #92400E;
`;
const StatusChip = styled.span<{ $s: string }>`
  flex-shrink: 0;
  padding: 2px 8px; border-radius: 999px; font-size: 10px; font-weight: 600;
  ${p => p.$s === 'ready' ? 'background:#DCFCE7;color:#166534;' :
        p.$s === 'indexing' ? 'background:#FEF3C7;color:#92400E;' :
        p.$s === 'failed' ? 'background:#FEE2E2;color:#B91C1C;' :
        'background:#F1F5F9;color:#64748B;'}
`;
const ActiveTagBar = styled.div`
  display: flex; align-items: center; gap: 8px;
  margin-bottom: 12px;
`;
const ActiveTagLabel = styled.span`font-size: 12px; color: #64748B;`;
const ActiveTagChip = styled.button`
  all: unset; cursor: pointer;
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 10px; border-radius: 999px;
  background: #14B8A6; color: #FFFFFF;
  font-size: 12px; font-weight: 600;
  &:hover { background: #0D9488; }
`;
const ActiveTagX = styled.span`font-size: 14px; line-height: 1;`;
const RowTitle = styled.div`
  font-size: 14px; font-weight: 600; color: #0F172A;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  cursor: text; padding: 2px 8px;
  border: 1px dashed transparent; border-radius: 4px;
  transition: all 0.12s;
  &:hover { background: #F0FDFA; border-color: #CCFBF1; }
`;
// ─── DetailDrawer 내부 ───
const DrawerTitle = styled.div`
  font-size: 16px; font-weight: 700; color: #0F172A;
  cursor: text; padding: 4px 8px; border-radius: 6px;
  &:hover { background: #F0FDFA; }
`;
const DrawerSections = styled.div`display: flex; flex-direction: column; gap: 20px; padding: 20px;`;
const DrawerSection = styled.div`display: flex; flex-direction: column; gap: 8px;`;
const SectionLabel = styled.div`
  font-size: 11px; font-weight: 700; color: #64748B;
  text-transform: uppercase; letter-spacing: 0.5px;
  small { font-weight: 500; text-transform: none; letter-spacing: 0; color: #94A3B8; margin-left: 4px; }
`;
const MetaGrid = styled.div`
  display: grid; grid-template-columns: max-content 1fr;
  gap: 8px 16px; font-size: 13px;
`;
const MetaLabel = styled.div`color: #64748B; font-weight: 500;`;
const MetaValue = styled.div`color: #0F172A; font-weight: 500;`;
const MetaEditWrap = styled.div`min-width: 0;`;
// D4 #62 — 보안등급 힌트
const SecLevelHint = styled.div`margin-top: 6px; font-size: 11px; color: #94A3B8; line-height: 1.45;`;
const AttachList = styled.div`display: flex; flex-direction: column; gap: 6px;`;
const AttachRow = styled.div`
  display: grid; grid-template-columns: auto 1fr auto auto auto; gap: 10px;
  align-items: center;
  padding: 10px 12px;
  background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px;
  font-size: 13px;
`;
const AttachIcon = styled.svg`width: 16px; height: 16px; color: #64748B; flex-shrink: 0;`;
const AttachName = styled.span`color: #0F172A; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`;
const AttachMeta = styled.span`color: #94A3B8; font-size: 11px; flex-shrink: 0;`;
const AttachAction = styled.a`
  display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px;
  color: #475569; border-radius: 6px; text-decoration: none;
  transition: all 0.15s;
  &:hover { background: #F0FDFA; color: #0F766E; }
`;
const AttachRemoveBtn = styled.button`
  display: inline-flex; align-items: center; justify-content: center;
  width: 24px; height: 24px;
  background: transparent; color: #94A3B8;
  border: 1px solid transparent; border-radius: 6px;
  font-size: 16px; line-height: 1; cursor: pointer;
  transition: all 0.15s;
  &:hover { background: #FEF2F2; color: #B91C1C; border-color: #FECACA; }
`;
const Spacer = styled.div`flex: 1;`;
const ShareFooterBtn = styled.button`
  height: 34px; padding: 0 12px;
  background: transparent; color: #475569;
  border: 1px solid #CBD5E1; border-radius: 8px;
  font-size: 13px; font-weight: 600; cursor: pointer;
  display: inline-flex; align-items: center; gap: 6px;
  &:hover { background: #F0FDFA; color: #0F766E; border-color: #99F6E4; }
`;
const DangerBtn = styled.button`
  height: 34px; padding: 0 14px;
  background: #FFFFFF; color: #B91C1C;
  border: 1px solid #FECACA; border-radius: 8px;
  font-size: 13px; font-weight: 600; cursor: pointer;
  &:hover { background: #FEF2F2; border-color: #DC2626; }
`;

// ─── 등록 모달 ───
const RequiredMark = styled.span`color: #DC2626; margin-left: 2px;`;
const OptionalMark = styled.span`color: #94A3B8; font-weight: 400; font-size: 11px; margin-left: 4px;`;
const Backdrop = styled.div`
  position: fixed; inset: 0; background: rgba(15, 23, 42, 0.08); z-index: 50;
`;
const Modal = styled.div`
  position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
  z-index: 60; width: 600px; max-width: calc(100vw - 40px); max-height: calc(100vh - 48px);
  background: #fff; border-radius: 14px; box-shadow: 0 30px 60px -20px rgba(15, 23, 42, 0.25);
  display: flex; flex-direction: column; overflow: hidden;
  @media (max-width: 640px) {
    top: 70px; bottom: 20px; left: 16px; right: 16px;
    transform: none; width: auto; max-width: none; max-height: none;
  }
`;
const ModalHeader = styled.div`
  display: flex; align-items: center; padding: 14px 18px;
  border-bottom: 1px solid #E2E8F0; flex-shrink: 0;
`;
const ModalTitle = styled.div`flex: 1; font-size: 15px; font-weight: 700; color: #0F172A; letter-spacing: -0.1px;`;
const ModalCloseBtn = styled.button`
  width: 30px; height: 30px; border: none; background: transparent; color: #64748B;
  border-radius: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center;
  &:hover { background: #F1F5F9; color: #0F172A; }
`;
const ModalBody = styled.div`padding: 16px 18px; overflow-y: auto; display: flex; flex-direction: column; gap: 14px; flex: 1; min-height: 0;`;
const ModalFooter = styled.div`padding: 14px 18px; border-top: 1px solid #E2E8F0; display: flex; justify-content: flex-end; gap: 8px;`;
const Field = styled.div`display: flex; flex-direction: column; gap: 6px; flex: 1;`;
const Label = styled.label`font-size: 13px; font-weight: 600; color: #0F172A;`;
const ErrorBox = styled.div`
  padding: 8px 12px;
  background: #FEF2F2; border: 1px solid #FECACA; border-radius: 6px;
  font-size: 12px; color: #B91C1C;
`;
const SuccessBox = styled.div`
  padding: 8px 12px;
  background: #F0FDFA; border: 1px solid #5EEAD4; border-radius: 6px;
  font-size: 12px; color: #0F766E;
`;
const TextInput = styled.input`height: 36px; padding: 0 10px; border: 1px solid #E2E8F0; border-radius: 6px; font-size: 13px; color: #0F172A; &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.15); }`;
// N+72-5 — TextArea 폐기 (RichEditor 통합)
const PrimaryBtn = styled.button`height: 36px; padding: 0 18px; background: #14B8A6; color: #FFFFFF; border: none; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; &:disabled { background: #CBD5E1; cursor: not-allowed; } &:hover:not(:disabled) { background: #0D9488; }`;
const SecondaryBtn = styled.button`height: 36px; padding: 0 14px; background: transparent; color: #475569; border: 1px solid #E2E8F0; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; &:hover { background: #F8FAFC; border-color: #CBD5E1; }`;


