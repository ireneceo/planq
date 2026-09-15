// 프로젝트 상세 — Q info (정보) 탭 (사이클 N+14)
//
// KnowledgePage 와 동일한 UI/UX (PageShell·EmptyState·AttachmentField·ShareModal·DetailDrawer 공통).
// 차이점: scope='project' 강제, project_id 자동 설정.
//   ★ 2026-09-03 (Irene) — "Q info처럼 ai로 업로드되게 해야지 카테고리도 표시되어야 하고. 좌측에"
//     좌측 카테고리 트리(components/Common/CategoryTree — Q info 와 **같은 한 벌**) + AI 자동추가 추가.
//     AI 모달은 KbAiIngestModal 을 scope='project' 로 재사용한다(한 벌 더 만들면 갈라진다).
//
// 다른 페이지의 KbDocument 와 데이터 단일 source — KnowledgePage 에서 보면 같이 보임.

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import EmptyState from '../../components/Common/EmptyState';
import PlanQSelect, { type PlanQSelectOption } from '../../components/Common/PlanQSelect';
import SearchBox from '../../components/Common/SearchBox';
import DetailDrawer from '../../components/Common/DetailDrawer';
import ShareModal from '../../components/Common/ShareModal';
import AttachmentField from '../../components/Common/AttachmentField';
import ConfirmDialog from '../../components/Common/ConfirmDialog';
import CategoryTree, { Split, MainArea, type CategoryTreeItem } from '../../components/Common/CategoryTree';
import KbAiIngestModal from '../Knowledge/KbAiIngestModal';
import AiActionButton from '../../components/Common/AiActionButton';
// 목록 행은 Q info 와 **같은 한 벌**이다 (components/Knowledge/kbListShell).
import { List, KbDocRow, catLabel } from '../../components/Knowledge/kbListShell';
import { listKbCategories } from '../../services/knowledge';
import { apiFetch } from '../../contexts/AuthContext';
import {
  listKnowledge, createKnowledge, deleteKnowledge, updateKnowledge,
  type KbDocumentRow, type KbCategory,
} from '../../services/knowledge';
import { fetchWorkspaceFiles, uploadMyFile, type ProjectFile } from '../../services/files';

const CATEGORIES: KbCategory[] = ['policy', 'manual', 'incident', 'faq', 'about', 'pricing'];

interface KbDetail extends KbDocumentRow {
  body?: string;
  attached_files?: { id: number; file_name: string; file_size: number; mime_type: string | null; storage_provider: string; external_url: string | null }[];
  attached_posts?: { id: number; title: string; project_id: number | null; category: string | null }[];
}

interface Props {
  businessId: number;
  projectId: number;
}

const ProjectKnowledgeTab: React.FC<Props> = ({ businessId, projectId }) => {
  const { t } = useTranslation('knowledge');
  const [docs, setDocs] = useState<KbDocumentRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  // 정렬 — Q info 와 같은 3종(최근/이름/오래된). 툴바에서 빠져 있으면 같은 자료인데 순서가 달라 보인다.
  const [sortKey, setSortKey] = useState<'recent' | 'title' | 'oldest'>('recent');
  const [aiOpen, setAiOpen] = useState(false);
  // 좌측 트리에 쓸 카테고리 — 워크스페이스 등록분(Q info 와 같은 엔드포인트) ∪ 이 프로젝트 문서가 쓰는 값
  const [wsCats, setWsCats] = useState<string[]>([]);

  // detail drawer
  const [detailId, setDetailId] = useState<number | null>(null);
  const [detail, setDetail] = useState<KbDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  // 등록 모달
  const [modalOpen, setModalOpen] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const [draftCategory, setDraftCategory] = useState<KbCategory>('manual');
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [pickedFileIds, setPickedFileIds] = useState<number[]>([]);
  const [pickedPostIds, setPickedPostIds] = useState<number[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [wsFiles, setWsFiles] = useState<ProjectFile[]>([]);
  // 첨부 검색에 wsPosts 가 AttachmentField 내부에서 fetch — 별도 prefetch 불필요

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await listKnowledge(businessId, { scope: 'project', project_id: projectId });
      setDocs(rows);
    } finally { setLoading(false); }
  }, [businessId, projectId]);

  useEffect(() => { load(); }, [load]);

  // detail fetch
  useEffect(() => {
    if (!detailId) { setDetail(null); return; }
    setDetailLoading(true);
    apiFetch(`/api/businesses/${businessId}/kb/documents/${detailId}`)
      .then(r => r.json())
      .then(j => { if (j.success) setDetail(j.data); })
      .finally(() => setDetailLoading(false));
  }, [detailId, businessId]);

  // 모달 열 때 wsFiles fetch (AttachmentField 와 공유)
  useEffect(() => {
    if (!modalOpen) return;
    fetchWorkspaceFiles(businessId).then(fs => setWsFiles(fs.filter(f => f.source === 'direct'))).catch(() => null);
  }, [modalOpen, businessId]);

  const openModal = () => {
    setDraftTitle(''); setDraftBody(''); setDraftCategory('manual');
    setUploadFiles([]); setPickedFileIds([]); setPickedPostIds([]);
    setModalOpen(true);
  };
  const closeModal = () => { if (!submitting) setModalOpen(false); };

  const submit = async () => {
    if (!draftTitle.trim()) return;
    const hasContent = draftBody.trim() || uploadFiles.length > 0 || pickedFileIds.length > 0 || pickedPostIds.length > 0;
    if (!hasContent) return;
    setSubmitting(true);
    try {
      const meta = {
        category: draftCategory,
        categories: [draftCategory],
        scope: 'project' as const,
        project_id: projectId,
      };
      // 새 업로드 → 표준 File 등록 → file_id 합치기 (KnowledgePage 와 동일 패턴)
      const newFileIds: number[] = [];
      for (const file of uploadFiles) {
        try {
          const r = await uploadMyFile(businessId, file);
          if (r.success && r.file) {
            const fid = Number(String(r.file.id).replace(/^direct-/, ''));
            if (Number.isFinite(fid)) newFileIds.push(fid);
          }
        } catch { /* skip */ }
      }
      const allFileIds = [...pickedFileIds, ...newFileIds];

      await createKnowledge(businessId, {
        title: draftTitle.trim(),
        body: draftBody.trim() || undefined,
        attached_file_ids: allFileIds.length > 0 ? allFileIds : undefined,
        attached_post_ids: pickedPostIds.length > 0 ? pickedPostIds : undefined,
        ...meta,
      });
      await load();
      setModalOpen(false);
    } finally { setSubmitting(false); }
  };

  useEffect(() => {
    let alive = true;
    listKbCategories(businessId)
      .then(r => { if (alive) setWsCats([...(r.master || []).map(m => m.name), ...(r.orphan || [])]); })
      .catch(() => { /* 실패해도 문서가 쓰는 카테고리로 트리는 그려진다 */ });
    return () => { alive = false; };
  }, [businessId]);

  const performDelete = async (id: number) => {
    try {
      await deleteKnowledge(businessId, id);
      if (detailId === id) setDetailId(null);
      await load();
    } finally { setConfirmDelete(null); }
  };

  // 문서 한 건의 카테고리들 — 백엔드가 다중(categories)로 내려주고 단수(category)는 하위호환.
  //   ★ 단수만 읽으면 다중으로 저장된 문서가 트리에서 통째로 사라진다(AI 자동추가는 배열로 저장한다).
  const catsOf = useCallback((d: KbDocumentRow): string[] => {
    const multi = (d as { categories?: string[] }).categories;
    if (Array.isArray(multi) && multi.length) return multi;
    return d.category ? [d.category] : [];
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const arr = docs.filter(d => {
      const cs = catsOf(d);
      if (categoryFilter !== 'all' && !cs.includes(categoryFilter)) return false;
      if (q && !(d.title.toLowerCase().includes(q) || cs.join(' ').toLowerCase().includes(q))) return false;
      return true;
    });
    const at = (d: KbDocumentRow) => new Date(d.updated_at || d.created_at).getTime() || 0;
    return [...arr].sort((a, b) =>
      sortKey === 'title' ? a.title.localeCompare(b.title)
      : sortKey === 'oldest' ? at(a) - at(b)
      : at(b) - at(a));
  }, [docs, search, categoryFilter, catsOf, sortKey]);

  // 행 우측 메타 — 첨부 수 + 수정일. 스코프·프로젝트명은 적지 않는다(여기가 그 프로젝트다).
  const rowMeta = useCallback((d: KbDocumentRow): string => {
    const parts: string[] = [];
    const fileCount = Array.isArray(d.attached_file_ids) ? d.attached_file_ids.length : 0;
    const postCount = Array.isArray(d.attached_post_ids) ? d.attached_post_ids.length : 0;
    if (fileCount + postCount > 0) parts.push(t('row.attached', '첨부 {{n}}', { n: fileCount + postCount }) as string);
    if (d.chunk_count > 0) parts.push(`chunk ${d.chunk_count}`);
    const when = d.updated_at || d.created_at;
    if (when) { const dt = new Date(when); if (!isNaN(dt.getTime())) parts.push(dt.toLocaleDateString()); }
    return parts.join(' · ');
  }, [t]);

  // 좌측 트리 — **이 프로젝트 문서가 실제로 쓰는 카테고리만.**
  //
  // ★ 2026-09-13 (Irene: *"프로젝트 > 정보 탭에 좌측 카테고리가 이상해. 해당 프로젝트와
  //   상관있는 것만 나와야 하는데 온갖거 다나와. 그리고 없는 건 안나와야 하는데 나오고."*)
  //   여태 `이 프로젝트 문서의 카테고리 ∪ 워크스페이스 등록분 ∪ 하드코딩 6종` 을 **모두 합쳤다.**
  //   그래서 이 프로젝트와 아무 상관없는 분류가 줄줄이 나왔고, 건수 0 인 것도 남았다.
  //   "분류 자리가 있다는 걸 알아야 거기에 넣는다" 는 이유로 0건을 보여줬는데 —
  //   **넣는 자리는 문서 편집 폼의 카테고리 셀렉트**다(거기는 여전히 전체 목록을 준다).
  //   목록 왼쪽의 트리는 **거르는 자리**이고, 거를 것이 없는 항목은 거기 있을 이유가 없다.
  const treeItems = useMemo<CategoryTreeItem[]>(() => {
    const counts: Record<string, number> = {};
    for (const d of docs) for (const c of catsOf(d)) counts[c] = (counts[c] || 0) + 1;
    return Object.keys(counts)
      // 라벨은 Q info 와 같은 함수(catLabel) — 여기만 `category.*` 키를 보고 있어서
      //   기본 6종도 번역이 안 붙고 원문 키("policy")가 그대로 나왔다.
      .map(k => ({ key: k, label: catLabel(t, k), count: counts[k] }))
      .sort((a, b) => (b.count - a.count) || a.label.localeCompare(b.label));
  }, [docs, catsOf, t]);

  return (
    <Wrap>
      <Toolbar>
        {/* ★ 2026-09-15 (Irene: *"정보등록은 최근순 필터가 왜 우측에 있지? 필터 왼쪽 버튼 우측,
            버튼 표시 방법 통일."*) — 정렬 셀렉트는 **필터**라 왼쪽, 버튼만 오른쪽 끝이다.
            문서·파일 탭과 같은 계약(components/Docs/assetTabLayout 의 Toolbar/ToolbarRight). */}
        <ToolbarLeft>
          <SearchBox value={search} onChange={setSearch} placeholder={t('search.placeholder', '제목·카테고리 검색') as string} />
          <SortWrap>
            <PlanQSelect
              size="sm" isSearchable={false}
              value={{
                value: sortKey,
                label: sortKey === 'title' ? (t('sort.title', '이름 순') as string)
                  : sortKey === 'oldest' ? (t('sort.oldest', '오래된 순') as string)
                  : (t('sort.recent', '최근 순') as string),
              }}
              onChange={(opt) => setSortKey((((opt as PlanQSelectOption | null)?.value) as 'recent' | 'title' | 'oldest') || 'recent')}
              options={[
                { value: 'recent', label: t('sort.recent', '최근 순') as string },
                { value: 'title', label: t('sort.title', '이름 순') as string },
                { value: 'oldest', label: t('sort.oldest', '오래된 순') as string },
              ]}
            />
          </SortWrap>
        </ToolbarLeft>
        <ToolbarRight>
        {/* AI 자동추가 — 버튼도 모달도 Q info 와 같은 것을 쓴다.
            ★ 2026-09-13 (Irene: *"AI로 자동추가는 버튼색도 아이콘도 안맞아. Q info랑 매칭해봐."*)
              여기만 흰 배경 + 민트 테두리 + SparkleIcon 으로 따로 그려져 있었다. AI 진입점의
              색·아이콘은 `components/Common/AiActionButton` 한 곳이 정한다(Coral 그라디언트 + 5각 별). */}
        <AiActionButton
          size="filter"
          testId="projinfo-ai-add"
          onClick={() => setAiOpen(true)}
          label={t('button.aiAdd', 'AI 로 자동 추가') as string}
          title={t('button.aiAddHint', '붙여넣은 내용이나 텍스트 파일을 AI 가 토픽별로 정리해 추가합니다') as string}
        />
        <PrimaryBtn type="button" onClick={openModal}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          {t('button.add', '정보 등록') as string}
        </PrimaryBtn>
        </ToolbarRight>
      </Toolbar>

      {/* 좌측 카테고리 트리 + 본문 — Q info 와 같은 껍데기(components/Common/CategoryTree) */}
      <Split>
        <CategoryTree
          items={treeItems}
          allLabel={t('filter.all', '모든 카테고리') as string}
          allCount={docs.length}
          active={categoryFilter}
          onSelect={setCategoryFilter}
        />
        <MainArea>
          {loading && <SkBar style={{ width: '100%', height: 48 }} />}
          {!loading && filtered.length === 0 && (
            <EmptyState
              icon={<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 6.253v13"/><path d="M12 6.253C10.832 5.477 9.246 5 7.5 5 5.754 5 4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253"/><path d="M12 6.253C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18s-3.332.477-4.5 1.253"/></svg>}
              title={t('empty.title', '아직 등록된 정보가 없어요') as string}
              description={t('empty.body', '이 프로젝트에서 자주 참조하는 자료·정책·매뉴얼을 등록하면 Cue 가 답변 시 참조합니다.') as string}
              ctaLabel={t('empty.cta', '정보 등록') as string}
              onCta={openModal}
            />
          )}
          {!loading && filtered.length > 0 && (
            <List>
              {/* 행은 Q info 와 같은 컴포넌트다 — 커스텀 항목·보안등급·권한/상태 칩·삭제까지 같이 온다.
                  메타 문자열은 화면이 만든다: 여기서는 "프로젝트: X" 를 또 적을 이유가 없다. */}
              {filtered.map(d => (
                <KbDocRow
                  key={d.id}
                  doc={d}
                  search={search}
                  active={detailId === d.id}
                  meta={rowMeta(d)}
                  onOpen={() => setDetailId(prev => prev === d.id ? null : d.id)}
                  onDelete={() => setConfirmDelete(d.id)}
                />
              ))}
            </List>
          )}
        </MainArea>
      </Split>

      {aiOpen && (
        <KbAiIngestModal
          businessId={businessId}
          scope="project"
          projectId={projectId}
          onClose={() => setAiOpen(false)}
          onSaved={() => { setAiOpen(false); load(); }}
        />
      )}

      {/* 상세 drawer — KnowledgePage 와 동일 패턴 (작은 버전) */}
      {detailId !== null && (
        <DetailDrawer open onClose={() => setDetailId(null)} ariaLabel={t('drawer.title', '정보 상세') as string}>
          <DetailDrawer.Header onClose={() => setDetailId(null)}>
            <DrawerTitle>{detail?.title || '...'}</DrawerTitle>
          </DetailDrawer.Header>
          <DetailDrawer.Body>
            {detailLoading && <SkBar style={{ width: '100%', height: 32 }} />}
            {!detailLoading && detail && (
              <DrawerSections>
                <DrawerSection>
                  <SectionLabel>{t('drawer.body', '본문') as string}</SectionLabel>
                  <DrawerBody>{detail.body || '—'}</DrawerBody>
                </DrawerSection>
                <DrawerSection>
                  <SectionLabel>{t('drawer.attached', '첨부 파일·문서') as string}</SectionLabel>
                  <AttachmentField
                    businessId={businessId}
                    uploads={[]}
                    onUploadsChange={async (files) => {
                      if (files.length === 0) return;
                      const newFileIds: number[] = [];
                      const newAttached: KbDetail['attached_files'] = [];
                      for (const file of files) {
                        try {
                          const r = await uploadMyFile(businessId, file);
                          if (r.success && r.file) {
                            const fid = Number(String(r.file.id).replace(/^direct-/, ''));
                            if (Number.isFinite(fid)) {
                              newFileIds.push(fid);
                              newAttached!.push({
                                id: fid, file_name: r.file.file_name, file_size: r.file.file_size,
                                mime_type: r.file.mime_type || null, storage_provider: r.file.storage_provider || 'planq', external_url: null,
                              });
                            }
                          }
                        } catch { /* skip */ }
                      }
                      if (newFileIds.length === 0) return;
                      const next = Array.from(new Set([...(detail.attached_file_ids || []), ...newFileIds]));
                      await updateKnowledge(businessId, detail.id, { attached_file_ids: next });
                      setDetail(prev => prev ? { ...prev, attached_file_ids: next, attached_files: [...(prev.attached_files || []), ...(newAttached || [])] } : prev);
                    }}
                    existingFileIds={detail.attached_file_ids || []}
                    onExistingFileIdsChange={async (ids) => {
                      const current = detail.attached_file_ids || [];
                      const added = ids.filter(id => !current.includes(id));
                      if (added.length === 0) return;
                      const next = Array.from(new Set([...current, ...added]));
                      await updateKnowledge(businessId, detail.id, { attached_file_ids: next });
                      const addedMeta = added.map(id => wsFiles.find(f => Number(String(f.id).replace(/^direct-/, '')) === id))
                        .filter((f): f is ProjectFile => !!f)
                        .map(f => ({ id: Number(String(f.id).replace(/^direct-/, '')), file_name: f.file_name, file_size: f.file_size, mime_type: f.mime_type || null, storage_provider: f.storage_provider || 'planq', external_url: f.external_url || null }));
                      setDetail(prev => prev ? { ...prev, attached_file_ids: next, attached_files: [...(prev.attached_files || []), ...addedMeta] } : prev);
                    }}
                    includePosts
                    existingPostIds={detail.attached_post_ids || []}
                    onExistingPostIdsChange={async (ids) => {
                      const current = detail.attached_post_ids || [];
                      const added = ids.filter(id => !current.includes(id));
                      if (added.length === 0) return;
                      const next = Array.from(new Set([...current, ...added]));
                      await updateKnowledge(businessId, detail.id, { attached_post_ids: next });
                      setDetail(prev => prev ? { ...prev, attached_post_ids: next } : prev);
                    }}
                  />
                </DrawerSection>
              </DrawerSections>
            )}
          </DetailDrawer.Body>
          <DetailDrawer.Footer>
            <SecondaryBtn type="button" onClick={() => setShareOpen(true)}>
              {t('drawer.share', '공유') as string}
            </SecondaryBtn>
            <Spacer />
            <DangerBtn type="button" onClick={() => detail && setConfirmDelete(detail.id)}>
              {t('drawer.delete', '삭제') as string}
            </DangerBtn>
          </DetailDrawer.Footer>
        </DetailDrawer>
      )}

      {/* 공유 모달 — 통합 컴포넌트 */}
      {detail && shareOpen && (
        <ShareModal open entityType="kb_document" entityId={detail.id} entityTitle={detail.title} onClose={() => setShareOpen(false)} />
      )}

      {/* 삭제 확인 — 공통 컴포넌트 */}
      {confirmDelete !== null && (
        <ConfirmDialog
          isOpen={true}
          title={t('confirm.deleteTitle', '정보를 삭제할까요?') as string}
          message={t('confirm.deleteBody', '연결된 첨부는 그대로 남고, 이 정보 항목만 삭제됩니다.') as string}
          confirmText={t('confirm.delete', '삭제') as string}
          cancelText={t('confirm.cancel', '취소') as string}
          variant="danger"
          onConfirm={() => { if (confirmDelete) performDelete(confirmDelete); }}
          onClose={() => setConfirmDelete(null)}
        />
      )}

      {/* 등록 모달 — KnowledgePage 의 등록 폼 작은 버전 */}
      {modalOpen && (
        <>
          <Backdrop onClick={closeModal} />
          <Modal role="dialog" aria-label={t('modal.title', '정보 등록') as string}>
            <ModalHeader>
              <ModalTitle>{t('modal.title', '정보 등록') as string}</ModalTitle>
              <CloseBtn type="button" onClick={closeModal}>×</CloseBtn>
            </ModalHeader>
            <ModalBody>
              <Field>
                <Label>{t('form.title', '제목') as string}<Req>*</Req></Label>
                <Input value={draftTitle} onChange={e => setDraftTitle(e.target.value)} placeholder={t('form.titlePh', '예: 환불 정책') as string} autoFocus />
              </Field>
              <Field>
                <Label>{t('form.category', '카테고리') as string}</Label>
                <PlanQSelect size="sm"
                  value={{ value: draftCategory, label: t(`category.${draftCategory}`, draftCategory) as string }}
                  onChange={(opt) => setDraftCategory((opt as PlanQSelectOption | null)?.value as KbCategory || 'manual')}
                  /* 넣는 자리는 여기다 — 워크스페이스 등록분까지 **전부** 고를 수 있어야 한다.
                     (거르는 자리인 좌측 트리는 이 프로젝트가 실제로 쓰는 것만 보여준다) */
                  options={[...new Set([...CATEGORIES, ...wsCats])]
                    .map(c => ({ value: c, label: t(`category.${c}`, c) as string }))}
                />
              </Field>
              <Field>
                <Label>{t('form.body', '본문') as string}</Label>
                <Textarea rows={5} value={draftBody} onChange={e => setDraftBody(e.target.value)} placeholder={t('form.bodyPh', '본문을 입력하세요 (선택)') as string} />
              </Field>
              <Field>
                <Label>{t('form.attach', '자료 첨부') as string}</Label>
                <AttachmentField
                  businessId={businessId}
                  uploads={uploadFiles}
                  onUploadsChange={setUploadFiles}
                  existingFileIds={pickedFileIds}
                  onExistingFileIdsChange={setPickedFileIds}
                  includePosts
                  existingPostIds={pickedPostIds}
                  onExistingPostIdsChange={setPickedPostIds}
                  workspaceFiles={wsFiles}
                />
              </Field>
            </ModalBody>
            <ModalFooter>
              <SecondaryBtn type="button" onClick={closeModal} disabled={submitting}>{t('modal.cancel', '취소') as string}</SecondaryBtn>
              <PrimaryBtn type="button" onClick={submit} disabled={submitting || !draftTitle.trim()}>
                {submitting ? t('modal.saving', '저장 중…') as string : t('modal.save', '등록') as string}
              </PrimaryBtn>
            </ModalFooter>
          </Modal>
        </>
      )}
    </Wrap>
  );
};

export default ProjectKnowledgeTab;

// ── styled ────────────────────────────────────────────────
const Wrap = styled.div`display: flex; flex-direction: column; gap: 16px;`;
/* 한 줄 계약 = [검색][필터] …밀어내기… [버튼]. space-between 을 쓰면 가운데 것이 흩어지므로
   오른쪽 묶음의 margin-left:auto 하나로 민다(문서·파일 탭과 같은 방식). */
const Toolbar = styled.div`display: flex; align-items: center; column-gap: 8px; row-gap: 8px; flex-wrap: wrap;`;
const ToolbarLeft = styled.div`display: flex; align-items: center; gap: 8px; min-width: 0;`;
const ToolbarRight = styled.div`margin-left: auto; display: inline-flex; align-items: center; gap: 8px; flex-shrink: 0;`;
const SortWrap = styled.div`min-width: 132px;`;
const SkBar = styled.div`background: linear-gradient(90deg, #F1F5F9 0px, #E2E8F0 40px, #F1F5F9 80px); background-size: 200px 100%; animation: sk 1.2s linear infinite; border-radius: 4px; @keyframes sk { 0% { background-position: -200px 0 } 100% { background-position: calc(200px + 100%) 0 } }`;
const PrimaryBtn = styled.button`display: inline-flex; align-items: center; gap: 6px; height: 36px; padding: 0 16px; background: #14B8A6; color: #fff; border: none; border-radius: 8px; font-size: 0.8125rem; font-weight: 600; cursor: pointer; &:hover:not(:disabled) { background: #0D9488; } &:disabled { opacity: 0.5; cursor: not-allowed; }`;
const SecondaryBtn = styled.button`height: 36px; padding: 0 14px; background: transparent; color: #475569; border: 1px solid #E2E8F0; border-radius: 8px; font-size: 0.8125rem; font-weight: 600; cursor: pointer; &:hover { background: #F8FAFC; border-color: #CBD5E1; }`;
const DangerBtn = styled.button`height: 36px; padding: 0 14px; background: transparent; color: #DC2626; border: 1px solid #FECACA; border-radius: 8px; font-size: 0.8125rem; font-weight: 600; cursor: pointer; &:hover { background: #FEF2F2; }`;
const Spacer = styled.div`flex: 1;`;
const DrawerTitle = styled.div`font-size: 1rem; font-weight: 700; color: #0F172A;`;
const DrawerSections = styled.div`display: flex; flex-direction: column; gap: 18px;`;
const DrawerSection = styled.div`display: flex; flex-direction: column; gap: 8px;`;
const SectionLabel = styled.div`font-size: 0.75rem; font-weight: 600; color: #475569;`;
const DrawerBody = styled.div`font-size: 0.8125rem; color: #0F172A; line-height: 1.6; white-space: pre-wrap;`;
const Backdrop = styled.div`position: fixed; inset: 0; background: rgba(15,23,42,0.08); z-index: 1000;`;
const Modal = styled.div`position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 1000; width: 560px; max-width: calc(100vw - 40px); max-height: calc(100vh - 48px); background: #fff; border-radius: 14px; box-shadow: 0 30px 60px -20px rgba(15,23,42,0.25); display: flex; flex-direction: column; overflow: hidden; @media (max-width: 640px) { top: 70px; bottom: 20px; left: 16px; right: 16px; transform: none; width: auto; max-width: none; max-height: none; }`;
const ModalHeader = styled.div`display: flex; align-items: center; padding: 14px 18px; border-bottom: 1px solid #E2E8F0;`;
const ModalTitle = styled.div`flex: 1; font-size: 0.9375rem; font-weight: 700; color: #0F172A;`;
const CloseBtn = styled.button`
  /* touch-target-44: 폰 터치 타깃 (theme/tokens CONTROL.touchMin). 데스크탑 크기는 그대로. */
  @media (max-width: 640px) { min-width: 44px; min-height: 44px; }
width: 30px; height: 30px; border: none; background: transparent; color: #64748B; border-radius: 6px; cursor: pointer; font-size: 1.125rem; &:hover { background: #F1F5F9; color: #0F172A; }`;
const ModalBody = styled.div`padding: 16px 18px; overflow-y: auto; display: flex; flex-direction: column; gap: 14px; flex: 1; min-height: 0;`;
const ModalFooter = styled.div`padding: 14px 18px; border-top: 1px solid #E2E8F0; display: flex; justify-content: flex-end; gap: 8px;`;
const Field = styled.div`display: flex; flex-direction: column; gap: 6px;`;
const Label = styled.label`font-size: 0.8125rem; font-weight: 600; color: #0F172A;`;
const Req = styled.span`color: #DC2626; margin-left: 2px;`;
const Input = styled.input`height: 36px; padding: 0 10px; border: 1px solid #E2E8F0; border-radius: 6px; font-size: 0.8125rem; &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.15); }`;
const Textarea = styled.textarea`padding: 8px 10px; border: 1px solid #E2E8F0; border-radius: 6px; font-size: 0.8125rem; font-family: inherit; resize: vertical; &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.15); }`;
