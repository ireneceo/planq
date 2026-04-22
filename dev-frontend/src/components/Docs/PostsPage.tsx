// 문서(포스팅) 공용 페이지 — 워크스페이스·프로젝트 공용
// 마스터-디테일 (좌측 목록 + 우측 편집/보기) + FilePicker 로 첨부
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useTimeFormat } from '../../hooks/useTimeFormat';
import SearchBox from '../Common/SearchBox';
import FilePicker, { type FilePickerResult } from '../Common/FilePicker';
import CategoryCombobox from '../Common/CategoryCombobox';
import { uploadMyFile, uploadProjectFile } from '../../services/files';
import ConfirmDialog from '../Common/ConfirmDialog';
import PostEditor from './PostEditor';
import {
  fetchPosts, fetchPost, createPost, updatePost, deletePost,
  attachToPost, detachFromPost, fetchPostsMeta,
  createCategory,
  type PostRow, type PostDetail, type PostsMeta,
} from '../../services/posts';

// 좌측 필터: 전체 / 내 문서 / 프로젝트 그룹 / 카테고리
type FilterSel =
  | { kind: 'all' }
  | { kind: 'mine' }
  | { kind: 'project'; projectId: number }
  | { kind: 'category'; name: string };

export type PostsScope =
  | { type: 'workspace'; businessId: number }
  | { type: 'project'; businessId: number; projectId: number };

interface Props {
  scope: PostsScope;
}

const PostsPage: React.FC<Props> = ({ scope }) => {
  const { t } = useTranslation('qdocs');
  const { formatDate } = useTimeFormat();

  const [rows, setRows] = useState<PostRow[]>([]);
  const [meta, setMeta] = useState<PostsMeta>({ total: 0, myCount: 0, categories: [], projects: [] });
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterSel>({ kind: 'all' });
  const [activeId, setActiveId] = useState<number | null>(null);
  const [detail, setDetail] = useState<PostDetail | null>(null);
  const [mode, setMode] = useState<'view' | 'edit' | 'new'>('view');
  const [titleDraft, setTitleDraft] = useState('');
  const [contentDraft, setContentDraft] = useState<unknown>(null);
  const [categoryDraft, setCategoryDraft] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PostDetail | null>(null);
  const [newCatOpen, setNewCatOpen] = useState(false);
  const [newCatDraft, setNewCatDraft] = useState('');
  const submittingRef = useRef(false);

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
      if (filter.kind === 'mine') apiFilter.mine = true;
      else if (filter.kind === 'project') apiFilter.projectId = filter.projectId;
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
    if (!activeId) { setDetail(null); setMode('view'); return; }
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
    setError(null);
  };

  const startEdit = () => {
    if (!detail) return;
    setMode('edit');
    setTitleDraft(detail.title);
    setContentDraft(detail.content_json);
    setCategoryDraft(detail.category || '');
    setError(null);
  };

  const cancelEdit = () => {
    if (mode === 'new') {
      setMode('view');
      setTitleDraft('');
      setContentDraft(null);
      setCategoryDraft('');
    } else if (detail) {
      setMode('view');
      setTitleDraft(detail.title);
      setContentDraft(detail.content_json);
      setCategoryDraft(detail.category || '');
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
        const projectId = scope.type === 'project' ? scope.projectId : null;
        const created = await createPost({
          business_id: scope.businessId,
          project_id: projectId,
          title: titleDraft.trim(),
          content_json: contentDraft as any,
          category: categoryVal,
        });
        setDetail(created);
        setActiveId(created.id);
        setMode('view');
        await load(); await loadMeta();
      } else if (mode === 'edit' && detail) {
        const patched = await updatePost(detail.id, {
          title: titleDraft.trim(),
          content_json: contentDraft as any,
          category: categoryVal,
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

  const onAttach = async (r: FilePickerResult) => {
    if (!detail) return;
    const fileIdsToAttach: number[] = [];

    // 1) 새로 업로드할 파일들 → Q file 로 먼저 업로드 후 file_id 수집
    if (r.uploaded && r.uploaded.length > 0) {
      for (const f of r.uploaded) {
        const result = scope.type === 'project'
          ? await uploadProjectFile(scope.businessId, scope.projectId, f)
          : await uploadMyFile(scope.businessId, f);
        if (result.success && result.file) {
          const fid = Number(result.file.id.replace(/^direct-/, ''));
          if (fid) fileIdsToAttach.push(fid);
        }
      }
    }

    // 2) 기존 파일 선택
    if (r.existingFileIds && r.existingFileIds.length > 0) {
      fileIdsToAttach.push(...r.existingFileIds);
    }

    if (fileIdsToAttach.length > 0) {
      await attachToPost(detail.id, fileIdsToAttach);
      const reloaded = await fetchPost(detail.id);
      setDetail(reloaded);
    }
  };

  const detachOne = async (attId: number) => {
    if (!detail) return;
    await detachFromPost(detail.id, attId);
    const reloaded = await fetchPost(detail.id);
    setDetail(reloaded);
  };

  const filtered = useMemo(() => rows, [rows]);

  return (
    <Layout>
      <ListPane>
        <ListHeader>
          <SearchBox value={query} onChange={setQuery} placeholder={t('search.placeholder', '제목·내용 검색') as string} />
          <NewBtn type="button" onClick={startNew}>+ {t('new', '새 문서')}</NewBtn>
        </ListHeader>

        <FilterSection>
          <FilterGroupLabel>{t('filter.basic', '기본') as string}</FilterGroupLabel>
          <Chip type="button" $active={filter.kind === 'all'} onClick={() => setFilter({ kind: 'all' })}>
            {t('filter.all', '전체') as string}
            <Count>{meta.total}</Count>
          </Chip>
          <Chip type="button" $active={filter.kind === 'mine'} onClick={() => setFilter({ kind: 'mine' })}>
            {t('filter.mine', '내 문서') as string}
            {meta.myCount > 0 && <Count>{meta.myCount}</Count>}
          </Chip>

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

          <FilterGroupLabel>{t('filter.byCategory', '카테고리') as string}</FilterGroupLabel>
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
        </FilterSection>

        {loading ? (
          <Dim>{t('loading', '로딩 중…')}</Dim>
        ) : filtered.length === 0 ? (
          <EmptyBox>
            <EmptyIcon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
            </EmptyIcon>
            <EmptyText>{t('list.empty', '아직 작성된 문서가 없습니다')}</EmptyText>
            <PrimaryBtn type="button" onClick={startNew}>+ {t('list.createFirst', '첫 문서 작성')}</PrimaryBtn>
          </EmptyBox>
        ) : (
          <RowList>
            {filtered.map(r => (
              <RowItem
                key={r.id}
                $active={activeId === r.id}
                onClick={() => setActiveId(activeId === r.id ? null : r.id)}
              >
                <RowTitle>
                  {r.is_pinned && <PinTag>📌</PinTag>}
                  {r.title}
                </RowTitle>
                <RowPreview>{r.content_preview || t('list.noContent', '내용 없음')}</RowPreview>
                <RowMeta>
                  <span>{r.author?.name || '—'}</span>
                  <span>·</span>
                  <span>{formatDate(r.updated_at)}</span>
                  {r.project && (
                    <ProjectTag $color={r.project.color || '#14B8A6'}>{r.project.name}</ProjectTag>
                  )}
                  {r.category && <CategoryMini>#{r.category}</CategoryMini>}
                </RowMeta>
              </RowItem>
            ))}
          </RowList>
        )}
      </ListPane>

      <DetailPane>
        {mode === 'new' || (mode === 'edit' && detail) ? (
          <EditArea>
            <EditHead>
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
            </EditHead>
            <CategoryCombobox
              value={categoryDraft}
              onChange={setCategoryDraft}
              options={meta.categories.map(c => c.name)}
              placeholder={t('categoryPlaceholder', '카테고리 (예: 매뉴얼, 가이드, 회의록)') as string}
            />
            {error && <ErrorBar>{error}</ErrorBar>}
            <PostEditor value={contentDraft} onChange={setContentDraft} placeholder={t('contentPlaceholder', '본문을 작성하세요…') as string} />

            {/* 편집 모드에서도 첨부 섹션 노출 — 기존/신규 문서 모두 */}
            {mode === 'edit' && detail && (
              <AttachSection>
                <AttachHead>
                  <AttachTitle>{t('attachments', '첨부 파일')}</AttachTitle>
                  <SecondaryBtn type="button" onClick={() => setPickerOpen(true)}>+ {t('attachAdd', '첨부 추가')}</SecondaryBtn>
                </AttachHead>
                {detail.attachments.length === 0 ? (
                  <Dim>{t('attachmentsEmpty', '첨부 파일이 없습니다')}</Dim>
                ) : (
                  <AttachList>
                    {detail.attachments.map(a => (
                      <AttachRow key={a.id}>
                        <AttachName href={a.file?.download_url || '#'} target="_blank" rel="noreferrer">
                          {a.file?.file_name || '—'}
                        </AttachName>
                        <RemoveBtn type="button" onClick={() => detachOne(a.id)} title="제거">×</RemoveBtn>
                      </AttachRow>
                    ))}
                  </AttachList>
                )}
              </AttachSection>
            )}
            {mode === 'new' && (
              <Dim style={{ padding: '12px 2px' }}>
                {t('attachmentHintNew', '문서 저장 후 첨부 파일을 추가할 수 있습니다') as string}
              </Dim>
            )}
          </EditArea>
        ) : detail ? (
          <ViewArea>
            <ViewHead>
              <ViewTitle>
                {detail.is_pinned && <PinTag>📌</PinTag>}
                {detail.title}
              </ViewTitle>
              <ViewActions>
                <SecondaryBtn type="button" onClick={startEdit}>{t('edit', '편집')}</SecondaryBtn>
                <DangerBtn type="button" onClick={() => setDeleteTarget(detail)}>{t('delete', '삭제')}</DangerBtn>
              </ViewActions>
            </ViewHead>
            <ViewMeta>
              <span>{detail.author?.name || '—'}</span>
              <span>·</span>
              <span>{formatDate(detail.created_at)}</span>
              {detail.editor && detail.editor.id !== detail.author?.id && (
                <><span>·</span><span>{t('editedBy', '수정: {{name}}', { name: detail.editor.name })}</span></>
              )}
              {detail.project && (
                <ProjectTag $color={detail.project.color || '#14B8A6'}>{detail.project.name}</ProjectTag>
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
            </ViewMeta>
            <PostEditor value={detail.content_json} onChange={() => {}} editable={false} />

            <AttachSection>
              <AttachHead>
                <AttachTitle>{t('attachments', '첨부 파일')}</AttachTitle>
                <SecondaryBtn type="button" onClick={() => setPickerOpen(true)}>+ {t('attachAdd', '첨부 추가')}</SecondaryBtn>
              </AttachHead>
              {detail.attachments.length === 0 ? (
                <Dim>{t('attachmentsEmpty', '첨부 파일이 없습니다')}</Dim>
              ) : (
                <AttachList>
                  {detail.attachments.map(a => (
                    <AttachRow key={a.id}>
                      <AttachName href={a.file?.download_url || '#'} target="_blank" rel="noreferrer">
                        {a.file?.file_name || '—'}
                      </AttachName>
                      <RemoveBtn type="button" onClick={() => detachOne(a.id)} title="제거">×</RemoveBtn>
                    </AttachRow>
                  ))}
                </AttachList>
              )}
            </AttachSection>
          </ViewArea>
        ) : (
          <Placeholder>
            <PlaceholderIcon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="16" y1="13" x2="8" y2="13"/>
              <line x1="16" y1="17" x2="8" y2="17"/>
            </PlaceholderIcon>
            <PlaceholderText>{t('selectOrCreate', '왼쪽 목록에서 문서를 선택하거나 새 문서를 작성하세요')}</PlaceholderText>
          </Placeholder>
        )}
      </DetailPane>

      <FilePicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        businessId={scope.businessId}
        variant="modal"
        title={t('filepicker.attachTitle', '첨부할 파일 선택') as string}
        onPick={onAttach}
      />
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
    </Layout>
  );
};

export default PostsPage;

// ─── styled ───
const Layout = styled.div`
  display: grid; grid-template-columns: 320px 1fr; gap: 16px;
  align-items: start;
  @media (max-width: 900px) { grid-template-columns: 1fr; }
`;
const ListPane = styled.div`
  background: #fff; border: 1px solid #E2E8F0; border-radius: 14px;
  display: flex; flex-direction: column; overflow: hidden;
`;
const ListHeader = styled.div`
  padding: 12px; display: flex; gap: 8px; border-bottom: 1px solid #F1F5F9;
  > *:first-child { flex: 1; }
`;
const NewBtn = styled.button`
  height: 34px; padding: 0 12px; background: #14B8A6; color: #fff;
  border: none; border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer;
  white-space: nowrap;
  &:hover { background: #0D9488; }
`;
const FilterSection = styled.div`
  padding: 10px 12px; border-bottom: 1px solid #F1F5F9;
  display: flex; flex-wrap: wrap; gap: 6px; align-items: center;
  max-height: 180px; overflow-y: auto;
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
  background: rgba(255, 255, 255, 0.25);
  padding: 0 6px; border-radius: 999px; font-size: 10px; font-weight: 700;
  ${Chip}:not([aria-pressed="true"]) & {
    background: rgba(15, 23, 42, 0.08); color: #64748B;
  }
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
const CategoryTag = styled.button`
  all: unset; cursor: pointer;
  display: inline-flex; align-items: center; padding: 2px 8px;
  background: #F0FDFA; color: #0F766E;
  border-radius: 999px; font-size: 11px; font-weight: 600;
  &:hover { background: #CCFBF1; }
`;
const CategoryMini = styled.span`
  display: inline-flex; padding: 1px 6px; background: #F0FDFA; color: #0F766E;
  border-radius: 999px; font-size: 10px; font-weight: 600;
`;
const RowList = styled.div`display: flex; flex-direction: column; max-height: calc(100vh - 240px); overflow-y: auto;`;
const RowItem = styled.button<{ $active: boolean }>`
  all: unset; cursor: pointer; padding: 12px 14px;
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
const RowMeta = styled.div`margin-top: 6px; display: flex; align-items: center; gap: 4px; font-size: 11px; color: #94A3B8; flex-wrap: wrap;`;
const PinTag = styled.span`font-size: 11px;`;
const ProjectTag = styled.span<{ $color: string }>`
  display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px;
  background: #F1F5F9; color: #475569; border-radius: 999px; font-size: 10px; font-weight: 600;
  &::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: ${p => p.$color}; }
`;
const Dim = styled.div`padding: 24px 16px; color: #94A3B8; font-size: 12px; text-align: center;`;

const DetailPane = styled.div`
  background: transparent; min-height: 400px;
`;
const EditArea = styled.div`display: flex; flex-direction: column; gap: 12px;`;
const EditHead = styled.div`display: flex; gap: 8px; align-items: center;`;
const TitleInput = styled.input`
  flex: 1; height: 44px; padding: 0 14px;
  background: #fff; border: 1px solid #E2E8F0; border-radius: 10px;
  font-size: 18px; font-weight: 700; color: #0F172A;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 2px rgba(20,184,166,0.15); }
`;
const EditActions = styled.div`display: flex; gap: 8px;`;

const ViewArea = styled.div`display: flex; flex-direction: column; gap: 12px;`;
const ViewHead = styled.div`display: flex; gap: 8px; align-items: flex-start;`;
const ViewTitle = styled.h1`
  flex: 1; margin: 0; font-size: 22px; font-weight: 700; color: #0F172A;
  display: flex; align-items: center; gap: 8px;
`;
const ViewActions = styled.div`display: flex; gap: 8px;`;
const ViewMeta = styled.div`display: flex; align-items: center; gap: 8px; font-size: 12px; color: #94A3B8; flex-wrap: wrap;`;

const AttachSection = styled.section`
  background: #fff; border: 1px solid #E2E8F0; border-radius: 12px; padding: 14px 16px;
`;
const AttachHead = styled.div`display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px;`;
const AttachTitle = styled.div`font-size: 13px; font-weight: 700; color: #334155;`;
const AttachList = styled.div`display: flex; flex-direction: column; gap: 6px;`;
const AttachRow = styled.div`
  display: flex; align-items: center; gap: 8px; padding: 8px 12px;
  background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px;
`;
const AttachName = styled.a`
  flex: 1; min-width: 0; font-size: 13px; color: #0F172A; text-decoration: none;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  &:hover { color: #0F766E; text-decoration: underline; }
`;
const RemoveBtn = styled.button`
  all: unset; cursor: pointer; width: 22px; height: 22px;
  display: flex; align-items: center; justify-content: center;
  color: #94A3B8; border-radius: 4px; font-size: 16px;
  &:hover { background: #FEE2E2; color: #DC2626; }
`;

const Placeholder = styled.div`
  background: #fff; border: 1px dashed #CBD5E1; border-radius: 14px;
  padding: 64px 24px; display: flex; flex-direction: column; align-items: center; gap: 10px;
`;
const PlaceholderIcon = styled.svg`width: 36px; height: 36px; color: #94A3B8;`;
const PlaceholderText = styled.div`font-size: 13px; color: #64748B; text-align: center; max-width: 320px; line-height: 1.5;`;

const EmptyBox = styled.div`
  padding: 40px 20px; display: flex; flex-direction: column; align-items: center; gap: 10px;
`;
const EmptyIcon = styled.svg`width: 32px; height: 32px; color: #94A3B8;`;
const EmptyText = styled.div`font-size: 12px; color: #94A3B8;`;
const ErrorBar = styled.div`font-size: 12px; color: #DC2626; background: #FEF2F2; padding: 8px 12px; border-radius: 6px;`;

const PrimaryBtn = styled.button`
  height: 34px; padding: 0 14px; background: #14B8A6; color: #fff; border: none; border-radius: 8px;
  font-size: 13px; font-weight: 600; cursor: pointer;
  &:hover:not(:disabled) { background: #0D9488; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
const SecondaryBtn = styled.button`
  height: 30px; padding: 0 12px; background: #fff; color: #0F172A;
  border: 1px solid #CBD5E1; border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer;
  &:hover:not(:disabled) { background: #F8FAFC; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
const DangerBtn = styled.button`
  height: 30px; padding: 0 12px; background: #fff; color: #DC2626;
  border: 1px solid #FCA5A5; border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer;
  &:hover:not(:disabled) { background: #FEF2F2; border-color: #DC2626; }
`;
