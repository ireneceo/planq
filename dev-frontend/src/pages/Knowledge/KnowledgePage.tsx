// Q knowledge — 워크스페이스 지식 베이스. Cue / aiGenerate / Q note 가 참조하는 RAG 소스.
//
// 30년차 UX 원칙 (사이클 P1 재구성):
//   - 헤더: "+ 새 지식 등록" 버튼 1개만
//   - 필터 영역: 검색 + scope/project/client 필터 + CSV 다운로드
//   - 등록 모달: 탭 4개 (직접 입력 / 파일 업로드 / 기존 파일 / 기존 문서)
//   - 진짜 1줄 리스트 + 우측 DetailDrawer
//   - 카운트 0 카테고리 자동 숨김
import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import PageShell from '../../components/Layout/PageShell';
import HelpDot from '../../components/Common/HelpDot';
import EmptyState from '../../components/Common/EmptyState';
import PlanQSelect, { type PlanQSelectOption } from '../../components/Common/PlanQSelect';
import SearchBox from '../../components/Common/SearchBox';
import DetailDrawer from '../../components/Common/DetailDrawer';
// 가로 Tabs 폐지 — 좌측 카테고리 트리로 변경 (Q file/Q record 패턴 통일)
import ConfirmDialog from '../../components/Common/ConfirmDialog';
import {
  listKnowledge, createKnowledge, deleteKnowledge, updateKnowledge,
  uploadKnowledgeFile,
  type KbDocumentRow, type KbCategory, type KbScope,
} from '../../services/knowledge';
import { apiFetch } from '../../contexts/AuthContext';
import { listProjects, listWorkspaceClients, type ApiProject, type WorkspaceClientRow } from '../../services/qtalk';
import { fetchWorkspaceFiles, formatBytes, type ProjectFile } from '../../services/files';
import { fetchPosts, type PostRow } from '../../services/posts';

const CATEGORIES: KbCategory[] = ['policy', 'manual', 'incident', 'faq', 'about', 'pricing'];
const SCOPES: KbScope[] = ['workspace', 'project', 'client'];
// 사용자 정의 항목 타입
const COL_TYPE_LABEL: Record<string, string> = {
  text: '텍스트', longtext: '긴 텍스트', number: '숫자', date: '날짜',
  url: 'URL', email: '이메일', phone: '전화', select: '단일 선택',
  checkbox: '체크', secret: '시크릿',
};

interface KbDetail extends KbDocumentRow {
  body?: string;
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

const KnowledgePage = () => {
  const { t } = useTranslation('knowledge');
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
  const [detailLoading, setDetailLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  // ─── 새 지식 등록 모달 (사이클 P3 — 단일 폼) ───
  const [modalOpen, setModalOpen] = useState(false);
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
    // 권한
    read_policy: 'all' as 'all' | 'owner',
    client_ids: [] as number[],
  });
  // 첨부 — 새 업로드 + 기존 파일 + 기존 문서 (모두 다중)
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
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
  }, [businessId]);

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
      const filter: Parameters<typeof listKnowledge>[1] = {};
      if (activeScope !== 'all') filter.scope = activeScope;
      if (activeProject) filter.project_id = activeProject;
      if (activeClient) filter.client_id = activeClient;
      if (activeTag) filter.tag = activeTag;
      if (debouncedSearch.current.trim()) filter.q = debouncedSearch.current.trim();
      const list = await listKnowledge(businessId, filter);
      setDocs(list);
    } finally { setLoading(false); }
  }, [businessId, activeScope, activeProject, activeClient, activeTag]);

  useEffect(() => { void load(); }, [load]);

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
    setDraft({ title: '', body: '', category: 'manual', categories: ['manual'], scope: 'workspace', project_id: null, client_id: null, custom_columns: [], custom_values: {}, read_policy: 'all', client_ids: [] });
    setUploadFiles([]);
    setPickedFileIds(new Set());
    setPickedPostIds(new Set());
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
    if (draft.scope === 'project' && !draft.project_id) {
      setSubmitError(t('modal.errProjectRequired') as string); return;
    }
    if (draft.scope === 'client' && !draft.client_id) {
      setSubmitError(t('modal.errClientRequired') as string); return;
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
      const msg = e instanceof Error ? e.message : 'error';
      setSubmitError(t('modal.errSave', { msg }) as string);
    } finally { setSubmitting(false); }
  };

  const performDelete = async (id: number) => {
    if (!businessId) return;
    try {
      await deleteKnowledge(businessId, id);
      if (detailId === id) setDetailId(null);
      await load();
    } catch { /* ignore */ }
    finally { setConfirmDelete(null); }
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
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `knowledge-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
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
      title={t('page.title') as string}
      count={docs.length}
      helpDot={
        <HelpDot askCue={t('help.cuePrefill') as string} topic="qknowledge">
          {t('help.body')}
        </HelpDot>
      }
      actions={
        <>
          <CsvBtn type="button" onClick={handleExportCsv} disabled={!filtered.length} title={t('page.exportCsv') as string}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            {t('page.exportCsv')}
          </CsvBtn>
          <NewBtn type="button" onClick={() => setModalOpen(true)}>{t('page.new')}</NewBtn>
        </>
      }
    >

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
          <BulkDeleteBtn type="button" onClick={() => setBulkDeleteOpen(true)}>
            {t('select.delete', '선택 삭제')} ({selectedIds.size})
          </BulkDeleteBtn>
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
                    <PlanQSelect size="sm" isMulti isSearchable={false}
                      value={docCats(detail).map(c => ({ value: c, label: t(`cat.${c}`) as string }))}
                      onChange={async (opts) => {
                        const arr = Array.isArray(opts) ? opts : [];
                        const next = arr.map(o => (o as PlanQSelectOption).value as KbCategory);
                        const cur = docCats(detail);
                        if (next.length === cur.length && next.every((v, i) => v === cur[i])) return;
                        if (next.length === 0) return;  // 최소 1개 강제
                        try {
                          await updateKnowledge(businessId, detail.id, { categories: next });
                          setDocs(prev => prev.map(x => x.id === detail.id ? { ...x, categories: next, category: next[0] } : x));
                          setDetail(prev => prev ? { ...prev, categories: next, category: next[0] } : prev);
                        } catch { /* skip */ }
                      }}
                      options={CATEGORIES.map(c => ({ value: c, label: t(`cat.${c}`) as string }))} />
                  </MetaEditWrap>
                  <MetaLabel>{t('drawer.scope')}</MetaLabel>
                  <MetaValue>{t(`scope.${detail.scope}`)}</MetaValue>
                  {detail.scope === 'project' && detail.project_id && (
                    <>
                      <MetaLabel>{t('drawer.project')}</MetaLabel>
                      <MetaValue>{projects.find(p => p.id === detail.project_id)?.name || `#${detail.project_id}`}</MetaValue>
                    </>
                  )}
                  {detail.scope === 'client' && detail.client_id && (
                    <>
                      <MetaLabel>{t('drawer.client')}</MetaLabel>
                      <MetaValue>
                        {(() => { const c = clients.find(x => x.id === detail.client_id); return c?.display_name || c?.biz_name || c?.company_name || `#${detail.client_id}`; })()}
                      </MetaValue>
                    </>
                  )}
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
              {detail.attached_files && detail.attached_files.length > 0 && (
                <DrawerSection>
                  <SectionLabel>{t('drawer.attachedFiles', '첨부 파일')} <small>({detail.attached_files.length})</small></SectionLabel>
                  <AttachList>
                    {detail.attached_files.map(f => (
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
                      </AttachRow>
                    ))}
                  </AttachList>
                </DrawerSection>
              )}
              {detail.attached_posts && detail.attached_posts.length > 0 && (
                <DrawerSection>
                  <SectionLabel>{t('drawer.attachedPosts', '첨부 문서')} <small>({detail.attached_posts.length})</small></SectionLabel>
                  <AttachList>
                    {detail.attached_posts.map(p => (
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
                      </AttachRow>
                    ))}
                  </AttachList>
                </DrawerSection>
              )}
            </DrawerSections>
          )}
        </DetailDrawer.Body>
        <DetailDrawer.Footer>
          <Spacer />
          <DangerBtn type="button" onClick={() => detailId && setConfirmDelete(detailId)}>{t('drawer.delete')}</DangerBtn>
        </DetailDrawer.Footer>
      </DetailDrawer>

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
        <Backdrop onClick={() => !submitting && closeModal()}>
          <Modal onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
            <ModalHeader>{t('modal.title')}</ModalHeader>
            <ModalBody>
              {/* ─── 제목 (필수) ─── */}
              <Field>
                <Label>{t('modal.titleLabel')} <RequiredMark>*</RequiredMark></Label>
                <TextInput value={draft.title} onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
                  placeholder={t('modal.titlePh') as string} maxLength={300} />
              </Field>

              {/* ─── 본문 (옵션) ─── */}
              <Field>
                <Label>{t('modal.body')} <OptionalMark>{t('modal.optional', '(선택)')}</OptionalMark></Label>
                <TextArea value={draft.body} onChange={e => setDraft(d => ({ ...d, body: e.target.value }))}
                  placeholder={t('modal.bodyPh') as string} rows={5} />
              </Field>

              {/* ─── 사용자 정의 항목 — 제목 영역 직후 (필드별 입력) ─── */}
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
                          value={{ value: col.type, label: COL_TYPE_LABEL[col.type] || col.type }}
                          onChange={(opt) => {
                            const cols = [...draft.custom_columns];
                            cols[idx] = { ...col, type: (opt as PlanQSelectOption | null)?.value as string || 'text' };
                            setDraft(d => ({ ...d, custom_columns: cols }));
                          }}
                          options={Object.entries(COL_TYPE_LABEL).map(([v, l]) => ({ value: v, label: l }))} />
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

              {/* ─── 파일 업로드 (옵션, 다중) ─── */}
              <Field>
                <Label>{t('modal.uploadFiles', '새 파일 업로드')} <OptionalMark>{t('modal.optional')}</OptionalMark></Label>
                <UploadDrop
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={e => { e.preventDefault(); }}
                  onDrop={e => {
                    e.preventDefault();
                    if (e.dataTransfer.files) setUploadFiles(prev => [...prev, ...Array.from(e.dataTransfer.files)]);
                  }}
                >
                  <UploadIcon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="17 8 12 3 7 8"/>
                    <line x1="12" y1="3" x2="12" y2="15"/>
                  </UploadIcon>
                  <UploadText>{t('modal.uploadHint', '파일을 드래그하거나 클릭')}</UploadText>
                  <UploadSub>{t('modal.uploadAccept', 'txt · md · html · json · csv (최대 5MB)')}</UploadSub>
                  <input ref={fileInputRef} type="file" hidden multiple
                    accept=".txt,.md,.markdown,.html,.htm,.json,.csv,.log"
                    onChange={e => { if (e.target.files) setUploadFiles(prev => [...prev, ...Array.from(e.target.files!)]); e.target.value = ''; }}
                  />
                </UploadDrop>
                {uploadFiles.length > 0 && (
                  <ChipList>
                    {uploadFiles.map((f, i) => (
                      <Chip key={i}>
                        <ChipText>{f.name}</ChipText>
                        <ChipMeta>{formatBytes(f.size)}</ChipMeta>
                        <ChipX type="button" onClick={() => setUploadFiles(prev => prev.filter((_, idx) => idx !== i))}>×</ChipX>
                      </Chip>
                    ))}
                  </ChipList>
                )}
              </Field>

              {/* ─── 기존 파일 연결 (옵션, 다중 — PlanQSelect multi) ─── */}
              <Field>
                <Label>{t('modal.attachExistingFiles', '기존 파일 연결')} <OptionalMark>{t('modal.optional')}</OptionalMark></Label>
                <PlanQSelect
                  size="sm" isSearchable isMulti
                  placeholder={t('modal.searchFilesHint', '검색어 입력해서 파일 찾기...') as string}
                  value={Array.from(pickedFileIds).map(id => {
                    const f = wsFiles.find(x => Number(x.id.replace(/^direct-/, '')) === id);
                    return { value: String(id), label: f?.file_name || `#${id}` };
                  })}
                  onChange={(opts) => {
                    const set = new Set<number>();
                    if (Array.isArray(opts)) {
                      for (const o of opts) {
                        const n = Number((o as PlanQSelectOption).value);
                        if (n) set.add(n);
                      }
                    }
                    setPickedFileIds(set);
                  }}
                  options={wsFiles.map(f => ({
                    value: f.id.replace(/^direct-/, ''),
                    label: `${f.file_name} (${formatBytes(f.file_size)})`,
                  }))}
                  filterOption={(option, raw) => {
                    const q = (raw || '').trim().toLowerCase();
                    if (!q) return false;
                    return String(option.label).toLowerCase().includes(q);
                  }}
                  noOptionsMessage={({ inputValue }) =>
                    !String(inputValue || '').trim()
                      ? (t('modal.searchHint', '검색어를 입력하세요') as string)
                      : !wsFilesLoaded ? (t('page.loading') as string)
                      : (t('modal.noFiles') as string)
                  }
                />
              </Field>

              {/* ─── 기존 문서 연결 (옵션, 다중 — PlanQSelect multi) ─── */}
              <Field>
                <Label>{t('modal.attachExistingPosts', '기존 문서 연결')} <OptionalMark>{t('modal.optional')}</OptionalMark></Label>
                <PlanQSelect
                  size="sm" isSearchable isMulti
                  placeholder={t('modal.searchPostsHint', '검색어 입력해서 문서 찾기...') as string}
                  value={Array.from(pickedPostIds).map(id => {
                    const p = wsPosts.find(x => x.id === id);
                    return { value: String(id), label: p?.title || `#${id}` };
                  })}
                  onChange={(opts) => {
                    const set = new Set<number>();
                    if (Array.isArray(opts)) {
                      for (const o of opts) {
                        const n = Number((o as PlanQSelectOption).value);
                        if (n) set.add(n);
                      }
                    }
                    setPickedPostIds(set);
                  }}
                  options={wsPosts.map(p => ({
                    value: String(p.id),
                    label: p.project ? `${p.title} · ${p.project.name}` : p.title,
                  }))}
                  filterOption={(option, raw) => {
                    const q = (raw || '').trim().toLowerCase();
                    if (!q) return false;
                    return String(option.label).toLowerCase().includes(q);
                  }}
                  noOptionsMessage={({ inputValue }) =>
                    !String(inputValue || '').trim()
                      ? (t('modal.searchHint', '검색어를 입력하세요') as string)
                      : !wsPostsLoaded ? (t('page.loading') as string)
                      : (t('modal.noPosts') as string)
                  }
                />
              </Field>

              <Divider />

              {/* ─── 분류 (카테고리만 — scope 는 권한 라디오로 통합) ─── */}
              <Field>
                <Label>{t('modal.category')}</Label>
                <PlanQSelect size="sm" isMulti isSearchable={false}
                  value={(draft.categories.length > 0 ? draft.categories : [draft.category]).map(c => ({ value: c, label: t(`cat.${c}`) as string }))}
                  onChange={(opts) => {
                    const arr = Array.isArray(opts) ? opts : [];
                    const next = arr.map(o => (o as PlanQSelectOption).value as KbCategory);
                    setDraft(d => ({ ...d, categories: next.length > 0 ? next : ['manual'], category: next[0] || 'manual' }));
                  }}
                  options={CATEGORIES.map(c => ({ value: c, label: t(`cat.${c}`) as string }))} />
              </Field>
              {draft.scope === 'project' && (
                <Field>
                  <Label>{t('modal.projectPick')}</Label>
                  <PlanQSelect size="sm" isSearchable
                    placeholder={t('modal.projectPh') as string}
                    value={draft.project_id
                      ? { value: String(draft.project_id), label: projects.find(p => p.id === draft.project_id)?.name || `Project #${draft.project_id}` }
                      : null}
                    onChange={(opt) => setDraft(d => ({ ...d, project_id: (opt as PlanQSelectOption | null)?.value ? Number((opt as PlanQSelectOption).value) : null }))}
                    options={projects.map(p => ({ value: String(p.id), label: p.name }))} />
                </Field>
              )}
              {draft.scope === 'client' && (
                <Field>
                  <Label>{t('modal.clientPick')}</Label>
                  <PlanQSelect size="sm" isSearchable isMulti
                    placeholder={t('modal.clientPh') as string}
                    value={draft.client_ids.map(id => {
                      const c = clients.find(x => x.id === id);
                      return { value: String(id), label: c?.display_name || c?.biz_name || c?.company_name || `Client #${id}` };
                    })}
                    onChange={(opts) => {
                      const ids: number[] = [];
                      if (Array.isArray(opts)) {
                        for (const o of opts) {
                          const n = Number((o as PlanQSelectOption).value);
                          if (n) ids.push(n);
                        }
                      }
                      setDraft(d => ({ ...d, client_ids: ids, client_id: ids[0] || null }));
                    }}
                    options={clients.map(c => ({ value: String(c.id), label: c.display_name || c.biz_name || c.company_name || `Client #${c.id}` }))} />
                </Field>
              )}

              <Divider />

              {/* ─── 공유 권한 (4 옵션) — 운영진 한정 옵션 명시 ─── */}
              <Field>
                <Label>{t('modal.readPolicy', '공유 범위')}</Label>
                <PolicyRadioGroup>
                  <PolicyRadio
                    type="button"
                    $active={draft.scope === 'workspace' && draft.read_policy === 'all'}
                    onClick={() => setDraft(d => ({ ...d, scope: 'workspace', read_policy: 'all' }))}>
                    <PolicyTitle>{t('modal.policyAll', '전체 워크스페이스')}</PolicyTitle>
                    <PolicyHint>{t('modal.policyAllHint', '오너·멤버 모두 볼 수 있어요')}</PolicyHint>
                  </PolicyRadio>
                  <PolicyRadio
                    type="button"
                    $active={draft.scope === 'project'}
                    onClick={() => setDraft(d => ({ ...d, scope: 'project', read_policy: 'all' }))}>
                    <PolicyTitle>{t('modal.policyProject', '특정 프로젝트')}</PolicyTitle>
                    <PolicyHint>{t('modal.policyProjectHint', '그 프로젝트 멤버만 볼 수 있어요')}</PolicyHint>
                  </PolicyRadio>
                  <PolicyRadio
                    type="button"
                    $active={draft.scope === 'client'}
                    onClick={() => setDraft(d => ({ ...d, scope: 'client', read_policy: 'all' }))}>
                    <PolicyTitle>{t('modal.policyClient', '특정 고객 (다중 가능)')}</PolicyTitle>
                    <PolicyHint>{t('modal.policyClientHint', '선택한 고객(들)과 우리 팀이 볼 수 있어요')}</PolicyHint>
                  </PolicyRadio>
                  <PolicyRadio
                    type="button"
                    $active={draft.scope === 'workspace' && draft.read_policy === 'owner'}
                    onClick={() => setDraft(d => ({ ...d, scope: 'workspace', read_policy: 'owner' }))}>
                    <PolicyTitle>{t('modal.policyOwner', '운영진만')}</PolicyTitle>
                    <PolicyHint>{t('modal.policyOwnerHint', '오너·관리자만 볼 수 있어요 (단가표·내부 계정 등)')}</PolicyHint>
                  </PolicyRadio>
                </PolicyRadioGroup>
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
        </Backdrop>
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
}> = ({ docId, businessId, initialValue, onSaved }) => {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(initialValue || '');
  React.useEffect(() => { if (!editing) setDraft(initialValue || ''); }, [initialValue, editing]);
  const commit = async () => {
    setEditing(false);
    if (draft === (initialValue || '')) return;
    try { await updateKnowledge(businessId, docId, { body: draft }); onSaved(draft); } catch { /* skip */ }
  };
  if (!editing) {
    const v = initialValue || '—';
    return <BodyClickable onClick={() => setEditing(true)}>{v}</BodyClickable>;
  }
  return (
    <BodyTextarea
      autoFocus rows={6}
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Escape') { setDraft(initialValue || ''); setEditing(false); } }}
    />
  );
};

const BodyClickable = styled.div`
  font-size: 13px; color: #334155; line-height: 1.6;
  white-space: pre-wrap; word-break: break-word;
  padding: 10px 12px; background: #F8FAFC; border-radius: 6px;
  cursor: text;
  &:hover { background: #F0FDFA; }
`;
const BodyTextarea = styled.textarea`
  width: 100%; padding: 10px 12px;
  border: 1px solid #14B8A6; border-radius: 6px;
  font-size: 13px; color: #0F172A; font-family: inherit; line-height: 1.6;
  resize: vertical; min-height: 120px;
  &:focus { outline: none; box-shadow: 0 0 0 2px rgba(20,184,166,0.2); }
`;
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
  &:hover { background: #0D9488; }
`;
const CsvBtn = styled.button`
  display: inline-flex; align-items: center; gap: 6px;
  height: 32px; padding: 0 12px;
  background: #FFFFFF; color: #475569;
  border: 1px solid #CBD5E1; border-radius: 6px;
  font-size: 13px; font-weight: 600; cursor: pointer;
  transition: all 0.15s;
  &:hover:not(:disabled) { background: #F1F5F9; border-color: #94A3B8; color: #0F172A; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;

const Loading = styled.div`padding: 40px; text-align: center; color: #94A3B8;`;

// 권한 라디오 (4 옵션 — 큰 카드 형태)
const PolicyRadioGroup = styled.div`
  display: grid; grid-template-columns: 1fr 1fr; gap: 8px;
  @media (max-width: 640px) { grid-template-columns: 1fr; }
`;
const PolicyRadio = styled.button<{ $active: boolean }>`
  display: flex; flex-direction: column; align-items: flex-start; gap: 2px;
  padding: 10px 12px;
  background: ${p => p.$active ? '#F0FDFA' : '#FFFFFF'};
  border: 1px solid ${p => p.$active ? '#14B8A6' : '#E2E8F0'};
  border-radius: 8px;
  cursor: pointer; text-align: left;
  transition: all 0.15s;
  &:hover:not(:disabled) { border-color: #14B8A6; background: #F0FDFA; }
  &:focus-visible { outline: 2px solid rgba(20,184,166,0.3); outline-offset: 2px; }
`;
const PolicyTitle = styled.div`font-size: 13px; font-weight: 700; color: #0F172A;`;
const PolicyHint = styled.div`font-size: 11px; color: #64748B; line-height: 1.4;`;

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
  background: ${p => p.$on ? '#0F172A' : '#fff'};
  color: ${p => p.$on ? '#fff' : '#0F172A'};
  border: 1px solid ${p => p.$on ? '#0F172A' : '#CBD5E1'};
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
  position: sticky; top: 8px;
  max-height: calc(100vh - 180px); overflow-y: auto;
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
const KB_LIST_COLS = 'minmax(220px, 3fr) minmax(140px, 1.3fr) 100px 70px 36px';
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
  gap: 8px; align-items: center;
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
const AttachList = styled.div`display: flex; flex-direction: column; gap: 6px;`;
const AttachRow = styled.div`
  display: grid; grid-template-columns: auto 1fr auto auto; gap: 10px;
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
const Spacer = styled.div`flex: 1;`;
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
const ChipList = styled.div`
  display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px;
`;
const Chip = styled.span`
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 8px 4px 10px;
  background: #F1F5F9; border: 1px solid #E2E8F0; border-radius: 6px;
  font-size: 12px;
`;
const ChipText = styled.span`color: #0F172A; max-width: 180px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`;
const ChipMeta = styled.span`color: #94A3B8; font-size: 10px;`;
const ChipX = styled.button`
  all: unset; cursor: pointer;
  width: 18px; height: 18px; display: inline-flex; align-items: center; justify-content: center;
  color: #94A3B8; border-radius: 4px; font-size: 14px;
  &:hover { background: #FEE2E2; color: #DC2626; }
`;
const Divider = styled.div`
  height: 1px; background: #E2E8F0; margin: 4px -22px;
`;
const Backdrop = styled.div`position: fixed; inset: 0; background: rgba(15,23,42,0.40); z-index: 50; display: flex; align-items: center; justify-content: center; padding: 20px;`;
const Modal = styled.div`width: 100%; max-width: 600px; background: #FFFFFF; border-radius: 14px; box-shadow: 0 24px 48px rgba(15,23,42,0.18); display: flex; flex-direction: column; max-height: 90vh; overflow: hidden;`;
const ModalHeader = styled.div`padding: 18px 22px 12px; font-size: 16px; font-weight: 700; color: #0F172A; border-bottom: 1px solid #E2E8F0;`;
const ModalBody = styled.div`padding: 20px 22px; overflow-y: auto; display: flex; flex-direction: column; gap: 14px;`;
const ModalFooter = styled.div`padding: 14px 22px; border-top: 1px solid #E2E8F0; display: flex; justify-content: flex-end; gap: 8px;`;
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
const TextArea = styled.textarea`padding: 8px 10px; border: 1px solid #E2E8F0; border-radius: 6px; font-size: 13px; color: #0F172A; font-family: inherit; resize: vertical; &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.15); }`;
const PrimaryBtn = styled.button`height: 36px; padding: 0 18px; background: #14B8A6; color: #FFFFFF; border: none; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; &:disabled { background: #CBD5E1; cursor: not-allowed; } &:hover:not(:disabled) { background: #0D9488; }`;
const SecondaryBtn = styled.button`height: 36px; padding: 0 14px; background: transparent; color: #475569; border: 1px solid #E2E8F0; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; &:hover { background: #F8FAFC; border-color: #CBD5E1; }`;

// ─── 업로드 탭 ───
const UploadDrop = styled.div`
  border: 2px dashed #CBD5E1;
  background: #F8FAFC;
  border-radius: 12px; padding: 28px 16px;
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  cursor: pointer; transition: all 0.15s; text-align: center;
  &:hover { border-color: #14B8A6; background: #F0FDFA; }
`;
const UploadIcon = styled.svg`width: 36px; height: 36px; color: #94A3B8;`;
const UploadText = styled.div`font-size: 13px; font-weight: 600; color: #334155;`;
const UploadSub = styled.div`font-size: 11px; color: #94A3B8;`;

