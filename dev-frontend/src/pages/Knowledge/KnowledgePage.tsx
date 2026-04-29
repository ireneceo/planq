// Q knowledge — 워크스페이스 지식 베이스. Cue / aiGenerate / Q note 가 참조하는 RAG 소스.
//
// 30년차 UX 원칙 (사이클 P1 재구성):
//   - 헤더: "+ 새 지식 등록" 버튼 1개만
//   - 필터 영역: 검색 + scope/project/client 필터 + CSV 다운로드
//   - 등록 모달: 탭 4개 (직접 입력 / 파일 업로드 / 기존 파일 / 기존 문서)
//   - 진짜 1줄 리스트 + 우측 DetailDrawer
//   - 카운트 0 카테고리 자동 숨김
import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import PageShell from '../../components/Layout/PageShell';
import HelpDot from '../../components/Common/HelpDot';
import EmptyState from '../../components/Common/EmptyState';
import PlanQSelect, { type PlanQSelectOption } from '../../components/Common/PlanQSelect';
import DetailDrawer from '../../components/Common/DetailDrawer';
import { Tabs, Tab, Badge } from '../../components/Common/TabComponents';
import ConfirmDialog from '../../components/Common/ConfirmDialog';
import {
  listKnowledge, createKnowledge, deleteKnowledge,
  uploadKnowledgeFile,
  type KbDocumentRow, type KbCategory, type KbScope,
} from '../../services/knowledge';
import { apiFetch } from '../../contexts/AuthContext';
import { listProjects, listWorkspaceClients, type ApiProject, type WorkspaceClientRow } from '../../services/qtalk';
import { fetchWorkspaceFiles, formatBytes, type ProjectFile } from '../../services/files';
import { fetchPosts, type PostRow } from '../../services/posts';

const CATEGORIES: KbCategory[] = ['policy', 'manual', 'incident', 'faq', 'about', 'pricing'];
const SCOPES: KbScope[] = ['workspace', 'project', 'client'];

interface KbDetail extends KbDocumentRow {
  body?: string;
  file_name?: string | null;
  file_size?: number | null;
  uploaded_by?: number;
  chunks?: { id: number; chunk_index: number; section_title: string | null; token_count: number }[];
  attached_files?: { id: number; file_name: string; file_size: number; mime_type: string | null; storage_provider: string; external_url: string | null }[];
  attached_posts?: { id: number; title: string; project_id: number | null; category: string | null }[];
}

const KnowledgePage = () => {
  const { t } = useTranslation('knowledge');
  const { user } = useAuth();
  const businessId = user?.business_id ? Number(user.business_id) : null;

  // ─── 리스트 + 필터 상태 ───
  const [docs, setDocs] = useState<KbDocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCat, setActiveCat] = useState<KbCategory | 'all'>('all');
  const [activeScope, setActiveScope] = useState<KbScope | 'all'>('all');
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
    category: 'manual' as KbCategory, scope: 'workspace' as KbScope,
    project_id: null as number | null, client_id: null as number | null,
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

  // ─── 카테고리 탭 (0 카운트 숨김) ───
  const categoryCounts = useMemo(() => {
    const c: Record<string, number> = { all: docs.length };
    for (const cat of CATEGORIES) c[cat] = docs.filter(d => d.category === cat).length;
    return c;
  }, [docs]);
  const visibleCategories = useMemo(() => CATEGORIES.filter(cat => categoryCounts[cat] > 0), [categoryCounts]);

  const filtered = useMemo(() => (
    activeCat === 'all' ? docs : docs.filter(d => d.category === activeCat)
  ), [docs, activeCat]);

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
    setDraft({ title: '', body: '', category: 'manual', scope: 'workspace', project_id: null, client_id: null });
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
        category: draft.category,
        scope: draft.scope,
        project_id: draft.scope === 'project' ? draft.project_id : null,
        client_id: draft.scope === 'client' ? draft.client_id : null,
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
    const parts: string[] = [];
    parts.push(t(`cat.${d.category}`) as string);
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
    parts.push(`${d.chunk_count} chunks`);
    parts.push(new Date(d.updated_at).toLocaleDateString());
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
          <SearchInput
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('page.searchPh') as string}
          />
          <FilterField>
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
          </FilterField>
          {activeScope === 'project' && (
            <FilterField>
              <PlanQSelect
                size="sm" isSearchable
                placeholder={t('page.allProjects') as string}
                value={activeProject ? { value: String(activeProject), label: projects.find(p => p.id === activeProject)?.name || `#${activeProject}` } : null}
                onChange={(opt) => setActiveProject((opt as PlanQSelectOption | null)?.value ? Number((opt as PlanQSelectOption).value) : null)}
                options={[{ value: '', label: t('page.allProjects') as string }, ...projects.map(p => ({ value: String(p.id), label: p.name }))]}
              />
            </FilterField>
          )}
          {activeScope === 'client' && (
            <FilterField>
              <PlanQSelect
                size="sm" isSearchable
                placeholder={t('page.allClients') as string}
                value={activeClient ? { value: String(activeClient), label: (() => { const c = clients.find(x => x.id === activeClient); return c?.display_name || c?.biz_name || c?.company_name || `#${activeClient}`; })() } : null}
                onChange={(opt) => setActiveClient((opt as PlanQSelectOption | null)?.value ? Number((opt as PlanQSelectOption).value) : null)}
                options={[{ value: '', label: t('page.allClients') as string }, ...clients.map(c => ({ value: String(c.id), label: c.display_name || c.biz_name || c.company_name || `#${c.id}` }))]}
              />
            </FilterField>
          )}
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

      {/* ─── 표준 카테고리 탭 (count=0 인 탭 자동 숨김) ─── */}
      <Tabs>
        <Tab active={activeCat === 'all'} onClick={() => setActiveCat('all')}>
          {t('cat.all')} <Badge count={categoryCounts.all} showZero />
        </Tab>
        {visibleCategories.map(cat => (
          <Tab key={cat} active={activeCat === cat} onClick={() => setActiveCat(cat)}>
            {t(`cat.${cat}`)} <Badge count={categoryCounts[cat]} />
          </Tab>
        ))}
      </Tabs>

      {/* ─── 활성 태그 필터 표시 (클릭 시 해제) ─── */}
      {activeTag && (
        <ActiveTagBar>
          <ActiveTagLabel>{t('page.tagFilter', '태그')}:</ActiveTagLabel>
          <ActiveTagChip onClick={() => setActiveTag(null)} title={t('page.clearTag', '태그 필터 해제') as string}>
            #{activeTag}
            <ActiveTagX>×</ActiveTagX>
          </ActiveTagChip>
        </ActiveTagBar>
      )}

      {/* ─── 1줄 리스트 ─── */}
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
           {filtered.map(d => (
             <Row
               key={d.id}
               $active={detailId === d.id}
               onClick={() => setDetailId(prev => prev === d.id ? null : d.id)}
             >
               <RowTitle>{d.title}</RowTitle>
               <RowMeta>{renderRowMeta(d)}</RowMeta>
               {Array.isArray(d.tags) && d.tags.length > 0 && (
                 <RowTags>
                   {d.tags.slice(0, 3).map(tag => (
                     <TagChip
                       key={tag}
                       $active={activeTag === tag}
                       onClick={(e) => {
                         e.stopPropagation();
                         setActiveTag(prev => prev === tag ? null : tag);
                       }}
                     >
                       #{tag}
                     </TagChip>
                   ))}
                   {d.tags.length > 3 && <TagMore>+{d.tags.length - 3}</TagMore>}
                 </RowTags>
               )}
               <Status $s={d.status}>{t(`status.${d.status}`)}</Status>
             </Row>
           ))}
         </List>
       )}

      {/* ─── 우측 DetailDrawer ─── */}
      <DetailDrawer
        open={!!detailId}
        onClose={() => setDetailId(null)}
        width={520}
        ariaLabel={t('drawer.title') as string}
      >
        <DetailDrawer.Header onClose={() => setDetailId(null)}>
          <DrawerTitle>{detail?.title || t('drawer.title')}</DrawerTitle>
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
                  <MetaValue>{t(`cat.${detail.category}`)}</MetaValue>
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
                  <MetaLabel>{t('drawer.chunkCount')}</MetaLabel>
                  <MetaValue>{detail.chunk_count}</MetaValue>
                  <MetaLabel>{t('drawer.createdAt')}</MetaLabel>
                  <MetaValue>{new Date(detail.created_at).toLocaleString()}</MetaValue>
                  <MetaLabel>{t('drawer.updatedAt')}</MetaLabel>
                  <MetaValue>{new Date(detail.updated_at).toLocaleString()}</MetaValue>
                </MetaGrid>
              </DrawerSection>
              <DrawerSection>
                <SectionLabel>{t('drawer.body')}</SectionLabel>
                <BodyBox>{detail.body || '—'}</BodyBox>
              </DrawerSection>
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
              {detail.chunks && detail.chunks.length > 0 && (
                <DrawerSection>
                  <SectionLabel>{t('drawer.chunks')} <small>({detail.chunks.length})</small></SectionLabel>
                  <ChunkList>
                    {detail.chunks.map(ch => (
                      <ChunkRow key={ch.id}>
                        <ChunkIdx>#{ch.chunk_index}</ChunkIdx>
                        <ChunkTitle>{ch.section_title || '—'}</ChunkTitle>
                        <ChunkTokens>{ch.token_count}t</ChunkTokens>
                      </ChunkRow>
                    ))}
                  </ChunkList>
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

              {/* ─── 공통: 분류 (한 번만) ─── */}
              <FieldRow>
                <Field>
                  <Label>{t('modal.category')}</Label>
                  <PlanQSelect size="sm" isSearchable={false}
                    value={{ value: draft.category, label: t(`cat.${draft.category}`) as string }}
                    onChange={(opt) => setDraft(d => ({ ...d, category: ((opt as PlanQSelectOption | null)?.value as KbCategory) || 'manual' }))}
                    options={CATEGORIES.map(c => ({ value: c, label: t(`cat.${c}`) as string }))} />
                </Field>
                <Field>
                  <Label>{t('modal.scope')}</Label>
                  <PlanQSelect size="sm" isSearchable={false}
                    value={{ value: draft.scope, label: t(`scope.${draft.scope}`) as string }}
                    onChange={(opt) => setDraft(d => ({ ...d, scope: ((opt as PlanQSelectOption | null)?.value as KbScope) || 'workspace' }))}
                    options={SCOPES.map(s => ({ value: s, label: t(`scope.${s}`) as string }))} />
                </Field>
              </FieldRow>
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
                  <PlanQSelect size="sm" isSearchable
                    placeholder={t('modal.clientPh') as string}
                    value={draft.client_id
                      ? { value: String(draft.client_id), label: (() => { const c = clients.find(x => x.id === draft.client_id); return c?.display_name || c?.biz_name || c?.company_name || `Client #${draft.client_id}`; })() }
                      : null}
                    onChange={(opt) => setDraft(d => ({ ...d, client_id: (opt as PlanQSelectOption | null)?.value ? Number((opt as PlanQSelectOption).value) : null }))}
                    options={clients.map(c => ({ value: String(c.id), label: c.display_name || c.biz_name || c.company_name || `Client #${c.id}` }))} />
                </Field>
              )}

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

// ─── styled ───
const NewBtn = styled.button`
  height: 32px; padding: 0 14px;
  background: #14B8A6; color: #FFFFFF;
  border: none; border-radius: 6px;
  font-size: 13px; font-weight: 600; cursor: pointer;
  &:hover { background: #0D9488; }
`;
const SearchInput = styled.input`
  width: 200px; height: 32px; padding: 0 10px;
  border: 1px solid #E2E8F0; border-radius: 6px;
  font-size: 13px; color: #0F172A;
  background: #FFFFFF;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.15); }
`;
const FilterField = styled.div`min-width: 160px;`;
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

const List = styled.div`display: flex; flex-direction: column; gap: 0;`;
const Row = styled.div<{ $active: boolean }>`
  cursor: pointer;
  display: grid;
  grid-template-columns: minmax(200px, 1.5fr) minmax(120px, 1fr) minmax(80px, auto) auto;
  gap: 12px; align-items: center;
  padding: 12px 16px;
  background: ${p => p.$active ? '#F0FDFA' : '#FFFFFF'};
  border-bottom: 1px solid #E2E8F0;
  transition: background 0.12s;
  &:first-child { border-top: 1px solid #E2E8F0; }
  &:hover { background: ${p => p.$active ? '#F0FDFA' : '#F8FAFC'}; }
`;
const RowTags = styled.div`
  display: flex; align-items: center; gap: 4px; flex-wrap: nowrap;
  min-width: 0; overflow: hidden;
`;
const TagChip = styled.span<{ $active: boolean }>`
  display: inline-flex; align-items: center;
  padding: 2px 8px; border-radius: 999px;
  font-size: 11px; font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
  background: ${p => p.$active ? '#14B8A6' : '#F0FDFA'};
  color: ${p => p.$active ? '#FFFFFF' : '#0F766E'};
  &:hover { background: ${p => p.$active ? '#0D9488' : '#CCFBF1'}; }
`;
const TagMore = styled.span`
  font-size: 11px; color: #94A3B8; padding: 0 2px;
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
`;
const RowMeta = styled.div`
  font-size: 12px; color: #64748B;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
`;
const Status = styled.span<{ $s: string }>`
  flex-shrink: 0;
  padding: 2px 8px; border-radius: 999px; font-size: 10px; font-weight: 600;
  ${p => p.$s === 'ready' ? 'background:#DCFCE7;color:#166534;' :
        p.$s === 'indexing' ? 'background:#FEF3C7;color:#92400E;' :
        p.$s === 'failed' ? 'background:#FEE2E2;color:#B91C1C;' :
        'background:#F1F5F9;color:#64748B;'}
`;

// ─── DetailDrawer 내부 ───
const DrawerTitle = styled.div`font-size: 16px; font-weight: 700; color: #0F172A;`;
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
const BodyBox = styled.pre`
  margin: 0; padding: 12px;
  background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px;
  font-size: 13px; color: #0F172A;
  font-family: inherit;
  white-space: pre-wrap; word-break: break-word;
  max-height: 360px; overflow-y: auto;
`;
const ChunkList = styled.div`display: flex; flex-direction: column; gap: 4px;`;
const ChunkRow = styled.div`
  display: grid; grid-template-columns: auto 1fr auto;
  gap: 12px; align-items: center;
  padding: 8px 12px;
  background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 6px;
  font-size: 12px;
`;
const ChunkIdx = styled.div`color: #64748B; font-weight: 600;`;
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
const ChunkTitle = styled.div`color: #0F172A; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`;
const ChunkTokens = styled.div`color: #94A3B8; font-size: 11px;`;
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
const FieldRow = styled.div`display: flex; gap: 12px;`;
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

