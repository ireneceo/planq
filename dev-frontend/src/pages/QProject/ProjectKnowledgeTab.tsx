// 프로젝트 상세 — Q info (정보) 탭 (사이클 N+14)
//
// KnowledgePage 와 동일한 UI/UX (PageShell·EmptyState·AttachmentField·ShareModal·DetailDrawer 공통).
// 차이점: scope='project' 강제, project_id 자동 설정, 카테고리/스코프 필터 빼고 단순화.
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
  const [categoryFilter, setCategoryFilter] = useState<KbCategory | 'all'>('all');

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

  const performDelete = async (id: number) => {
    try {
      await deleteKnowledge(businessId, id);
      if (detailId === id) setDetailId(null);
      await load();
    } finally { setConfirmDelete(null); }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return docs.filter(d => {
      if (categoryFilter !== 'all' && d.category !== categoryFilter) return false;
      if (q && !(d.title.toLowerCase().includes(q) || (d.category || '').toLowerCase().includes(q))) return false;
      return true;
    });
  }, [docs, search, categoryFilter]);

  return (
    <Wrap>
      <Toolbar>
        <ToolbarLeft>
          <SearchBox value={search} onChange={setSearch} placeholder={t('search.placeholder', '제목·카테고리 검색') as string} />
          <PlanQSelect size="sm"
            value={{ value: categoryFilter, label: categoryFilter === 'all' ? t('filter.all', '모든 카테고리') as string : t(`category.${categoryFilter}`, categoryFilter) as string }}
            onChange={(opt) => setCategoryFilter((opt as PlanQSelectOption | null)?.value as KbCategory | 'all' || 'all')}
            options={[
              { value: 'all', label: t('filter.all', '모든 카테고리') as string },
              ...CATEGORIES.map(c => ({ value: c, label: t(`category.${c}`, c) as string })),
            ]}
          />
        </ToolbarLeft>
        <PrimaryBtn type="button" onClick={openModal}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          {t('button.add', '정보 등록') as string}
        </PrimaryBtn>
      </Toolbar>

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
                {d.category && <CategoryChip>{t(`category.${d.category}`, d.category) as string}</CategoryChip>}
                {d.chunk_count > 0 && <span>· chunk {d.chunk_count}</span>}
              </RowMeta>
            </Row>
          ))}
        </List>
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
const RowTitle = styled.div`font-size: 14px; font-weight: 600; color: #0F172A; flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`;
const RowMeta = styled.div`display: flex; gap: 8px; align-items: center; font-size: 12px; color: #64748B;`;
const CategoryChip = styled.span`background: #F1F5F9; color: #475569; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 500;`;
const SkBar = styled.div`background: linear-gradient(90deg, #F1F5F9 0px, #E2E8F0 40px, #F1F5F9 80px); background-size: 200px 100%; animation: sk 1.2s linear infinite; border-radius: 4px; @keyframes sk { 0% { background-position: -200px 0 } 100% { background-position: calc(200px + 100%) 0 } }`;
const PrimaryBtn = styled.button`display: inline-flex; align-items: center; gap: 6px; height: 36px; padding: 0 16px; background: #14B8A6; color: #fff; border: none; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; &:hover:not(:disabled) { background: #0D9488; } &:disabled { opacity: 0.5; cursor: not-allowed; }`;
const SecondaryBtn = styled.button`height: 36px; padding: 0 14px; background: transparent; color: #475569; border: 1px solid #E2E8F0; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; &:hover { background: #F8FAFC; border-color: #CBD5E1; }`;
const DangerBtn = styled.button`height: 36px; padding: 0 14px; background: transparent; color: #DC2626; border: 1px solid #FECACA; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; &:hover { background: #FEF2F2; }`;
const Spacer = styled.div`flex: 1;`;
const DrawerTitle = styled.div`font-size: 16px; font-weight: 700; color: #0F172A;`;
const DrawerSections = styled.div`display: flex; flex-direction: column; gap: 18px;`;
const DrawerSection = styled.div`display: flex; flex-direction: column; gap: 8px;`;
const SectionLabel = styled.div`font-size: 12px; font-weight: 600; color: #475569;`;
const DrawerBody = styled.div`font-size: 13px; color: #0F172A; line-height: 1.6; white-space: pre-wrap;`;
const Backdrop = styled.div`position: fixed; inset: 0; background: rgba(15,23,42,0.08); z-index: 1000;`;
const Modal = styled.div`position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 1000; width: 560px; max-width: calc(100vw - 40px); max-height: calc(100vh - 48px); background: #fff; border-radius: 14px; box-shadow: 0 30px 60px -20px rgba(15,23,42,0.25); display: flex; flex-direction: column; overflow: hidden; @media (max-width: 640px) { top: 70px; bottom: 20px; left: 16px; right: 16px; transform: none; width: auto; max-width: none; max-height: none; }`;
const ModalHeader = styled.div`display: flex; align-items: center; padding: 14px 18px; border-bottom: 1px solid #E2E8F0;`;
const ModalTitle = styled.div`flex: 1; font-size: 15px; font-weight: 700; color: #0F172A;`;
const CloseBtn = styled.button`width: 30px; height: 30px; border: none; background: transparent; color: #64748B; border-radius: 6px; cursor: pointer; font-size: 18px; &:hover { background: #F1F5F9; color: #0F172A; }`;
const ModalBody = styled.div`padding: 16px 18px; overflow-y: auto; display: flex; flex-direction: column; gap: 14px; flex: 1; min-height: 0;`;
const ModalFooter = styled.div`padding: 14px 18px; border-top: 1px solid #E2E8F0; display: flex; justify-content: flex-end; gap: 8px;`;
const Field = styled.div`display: flex; flex-direction: column; gap: 6px;`;
const Label = styled.label`font-size: 13px; font-weight: 600; color: #0F172A;`;
const Req = styled.span`color: #DC2626; margin-left: 2px;`;
const Input = styled.input`height: 36px; padding: 0 10px; border: 1px solid #E2E8F0; border-radius: 6px; font-size: 13px; &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.15); }`;
const Textarea = styled.textarea`padding: 8px 10px; border: 1px solid #E2E8F0; border-radius: 6px; font-size: 13px; font-family: inherit; resize: vertical; &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.15); }`;
