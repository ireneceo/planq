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
import { SparkleIcon } from '../../components/Common/Icons';
import { listKbCategories } from '../../services/knowledge';
import { apiFetch } from '../../contexts/AuthContext';
import {
  listKnowledge, createKnowledge, deleteKnowledge, updateKnowledge,
  type KbDocumentRow, type KbCategory,
} from '../../services/knowledge';
import { fetchWorkspaceFiles, uploadMyFile, type ProjectFile } from '../../services/files';
import { OVERLAY_DRAWER } from '../../theme/panelWidth';

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
    return docs.filter(d => {
      const cs = catsOf(d);
      if (categoryFilter !== 'all' && !cs.includes(categoryFilter)) return false;
      if (q && !(d.title.toLowerCase().includes(q) || cs.join(' ').toLowerCase().includes(q))) return false;
      return true;
    });
  }, [docs, search, categoryFilter, catsOf]);

  // 좌측 트리 — 이 프로젝트 문서가 실제로 쓰는 카테고리 + 워크스페이스 등록분.
  //   건수 0 인 등록 카테고리도 보여준다(분류 자리가 있다는 걸 알아야 거기에 넣는다).
  const treeItems = useMemo<CategoryTreeItem[]>(() => {
    const counts: Record<string, number> = {};
    for (const d of docs) for (const c of catsOf(d)) counts[c] = (counts[c] || 0) + 1;
    const names = [...new Set([...Object.keys(counts), ...wsCats, ...CATEGORIES])];
    return names
      .map(k => ({ key: k, label: t(`category.${k}`, k) as string, count: counts[k] || 0 }))
      .sort((a, b) => (b.count - a.count) || a.label.localeCompare(b.label));
  }, [docs, wsCats, catsOf, t]);

  return (
    <Wrap>
      <Toolbar>
        <ToolbarLeft>
          <SearchBox value={search} onChange={setSearch} placeholder={t('search.placeholder', '제목·카테고리 검색') as string} />
        </ToolbarLeft>
        {/* AI 자동추가 — Q info 와 같은 모달을 scope='project' 로 재사용 (Irene 2026-09-03) */}
        <AiBtn type="button" data-testid="projinfo-ai-add" onClick={() => setAiOpen(true)}>
          <SparkleIcon size={14} />
          {t('button.aiAdd', 'AI 로 자동 추가') as string}
        </AiBtn>
        <PrimaryBtn type="button" onClick={openModal}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          {t('button.add', '정보 등록') as string}
        </PrimaryBtn>
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
              title={t('empty.title', '아직 등록된 정보가 없어요') as string}
              description={t('empty.body', '이 프로젝트에서 자주 참조하는 자료·정책·매뉴얼을 등록하면 Cue 가 답변 시 참조합니다.') as string}
            />
          )}
          {!loading && filtered.length > 0 && (
            <List>
              {filtered.map(d => (
                <Row key={d.id} $active={detailId === d.id} onClick={() => setDetailId(prev => prev === d.id ? null : d.id)}>
                  <RowTitle>{d.title}</RowTitle>
                  <RowMeta>
                    {/* 다중 카테고리 표시 — 단수만 그리면 AI 가 배열로 저장한 문서에 칩이 안 뜬다 */}
                    {catsOf(d).map(c => <CategoryChip key={c}>{t(`category.${c}`, c) as string}</CategoryChip>)}
                    {d.chunk_count > 0 && <span>· chunk {d.chunk_count}</span>}
                  </RowMeta>
                </Row>
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
        <DetailDrawer open onClose={() => setDetailId(null)} width={OVERLAY_DRAWER.default} ariaLabel={t('drawer.title', '정보 상세') as string}>
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
                  options={CATEGORIES.map(c => ({ value: c, label: t(`category.${c}`, c) as string }))}
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
const Toolbar = styled.div`display: flex; gap: 8px; justify-content: space-between; flex-wrap: wrap;`;
const ToolbarLeft = styled.div`display: flex; gap: 8px; flex: 1; min-width: 0;`;
const List = styled.div`display: flex; flex-direction: column; gap: 6px; background: #fff; border: 1px solid #E2E8F0; border-radius: 12px; overflow: hidden;`;
const Row = styled.button<{ $active: boolean }>`
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 12px 16px; background: ${p => p.$active ? '#F0FDFA' : 'transparent'}; border: none; cursor: pointer; text-align: left;
  border-bottom: 1px solid #F1F5F9;
  &:last-child { border-bottom: none; }
  &:hover { background: ${p => p.$active ? '#F0FDFA' : '#F8FAFC'}; }
`;
const RowTitle = styled.div`font-size: 0.875rem; font-weight: 600; color: #0F172A; flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`;
const RowMeta = styled.div`display: flex; gap: 8px; align-items: center; font-size: 0.75rem; color: #64748B;`;
const CategoryChip = styled.span`background: #F1F5F9; color: #475569; padding: 2px 8px; border-radius: 4px; font-size: 0.6875rem; font-weight: 500;`;
const SkBar = styled.div`background: linear-gradient(90deg, #F1F5F9 0px, #E2E8F0 40px, #F1F5F9 80px); background-size: 200px 100%; animation: sk 1.2s linear infinite; border-radius: 4px; @keyframes sk { 0% { background-position: -200px 0 } 100% { background-position: calc(200px + 100%) 0 } }`;
const AiBtn = styled.button`
  display: inline-flex; align-items: center; gap: 6px;
  height: 36px; padding: 0 12px; border-radius: 8px;
  background: #fff; color: #0F766E; border: 1px solid #99F6E4;
  font-size: 0.8125rem; font-weight: 600; cursor: pointer; white-space: nowrap;
  &:hover { background: #F0FDFA; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 1px; }
`;
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
