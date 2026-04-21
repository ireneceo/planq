// 프로젝트 문서 허브 — 직접 업로드 + Q Talk / Q Task / Q Note 자동 집계
// Phase 1 UI Mock (services/files.ts 의 MOCK_PROJECT_FILES 사용)
// 기능: 좌측 폴더 트리 · 대량 선택/삭제/이동 · 그리드/리스트 · 드로어 미리보기
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useTimeFormat } from '../../hooks/useTimeFormat';
import DetailDrawer from '../../components/Common/DetailDrawer';
import EmptyState from '../../components/Common/EmptyState';
import PlanQSelect from '../../components/Common/PlanQSelect';
import SearchBox from '../../components/Common/SearchBox';
import {
  fetchProjectFiles, uploadProjectFile, deleteProjectFile, bulkDeleteFiles,
  fetchFolders, createFolder, renameFolder, deleteFolder, moveFile,
  formatBytes, extOf, isImage,
  type ProjectFile, type FileSource, type FileFolder,
} from '../../services/files';

type SortKey = 'recent' | 'name' | 'size';
type ViewMode = 'grid' | 'list';
// 폴더 선택 상태: 'all' = 전체 | 'direct' = 직접 업로드 루트 | `src:chat` etc | number = 사용자 폴더 id
type FolderSel = 'all' | 'direct' | `src:${FileSource}` | number;

interface Props {
  projectId: number;
  businessId: number;
}

const DocsTab: React.FC<Props> = ({ projectId, businessId }) => {
  const { t } = useTranslation('qproject');
  const tr: (k: string, fb?: string) => string = (k, fb) => t(k, (fb ?? '') as string) as unknown as string;
  const { formatDate } = useTimeFormat();

  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [folders, setFolders] = useState<FileFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<ViewMode>('grid');
  const [folderSel, setFolderSel] = useState<FolderSel>('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('recent');
  const [preview, setPreview] = useState<ProjectFile | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [deleteConfirm, setDeleteConfirm] = useState<ProjectFile | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [moveTargetOpen, setMoveTargetOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([fetchProjectFiles(projectId), fetchFolders(projectId)]).then(([fs, fd]) => {
      if (!cancelled) { setFiles(fs); setFolders(fd); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [projectId]);

  // 선택 모드 종료 시 선택 초기화
  useEffect(() => { if (!selectMode) setSelectedIds(new Set()); }, [selectMode]);

  const counts = useMemo(() => {
    const byFolder: Record<number, number> = {};
    let directRoot = 0;
    const bySrc: Record<FileSource, number> = { direct: 0, chat: 0, task: 0, meeting: 0 };
    for (const f of files) {
      bySrc[f.source]++;
      if (f.source === 'direct') {
        if (f.folder_id == null) directRoot++;
        else byFolder[f.folder_id] = (byFolder[f.folder_id] || 0) + 1;
      }
    }
    return { total: files.length, bySrc, byFolder, directRoot };
  }, [files]);

  const filteredByFolder = useMemo(() => {
    if (folderSel === 'all') return files;
    if (folderSel === 'direct') return files.filter(f => f.source === 'direct' && f.folder_id == null);
    if (typeof folderSel === 'string' && folderSel.startsWith('src:')) {
      const src = folderSel.slice(4) as FileSource;
      return files.filter(f => f.source === src);
    }
    return files.filter(f => f.source === 'direct' && f.folder_id === folderSel);
  }, [files, folderSel]);

  const visible = useMemo(() => {
    let r = filteredByFolder.slice();
    if (query.trim()) {
      const q = query.toLowerCase();
      r = r.filter(f => f.file_name.toLowerCase().includes(q));
    }
    if (sort === 'name') r.sort((a, b) => (a.file_name || '').localeCompare(b.file_name || ''));
    else if (sort === 'size') r.sort((a, b) => (b.file_size || 0) - (a.file_size || 0));
    else r.sort((a, b) => (b.uploaded_at || '').localeCompare(a.uploaded_at || ''));
    return r;
  }, [filteredByFolder, query, sort]);

  const selectedFiles = useMemo(() => files.filter(f => selectedIds.has(f.id)), [files, selectedIds]);
  const selectedDeletable = selectedFiles.filter(f => f.deletable);

  const handleFiles = useCallback(async (fileList: FileList | File[]) => {
    const arr = Array.from(fileList);
    if (arr.length === 0) return;
    const targetFolderId = typeof folderSel === 'number' ? folderSel : null;
    setUploadingCount(n => n + arr.length);
    for (const f of arr) {
      try {
        const r = await uploadProjectFile(businessId, projectId, f, { folderId: targetFolderId });
        if (r.success && r.file) setFiles(prev => [r.file!, ...prev]);
      } finally { setUploadingCount(n => n - 1); }
    }
  }, [businessId, projectId, folderSel]);

  const toggleSelect = (id: string, e?: React.MouseEvent) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    void e;
  };
  const selectAllVisible = () => setSelectedIds(new Set(visible.map(f => f.id)));
  const clearSelection = () => setSelectedIds(new Set());

  const onBulkDeleteConfirmed = useCallback(async () => {
    const ids = selectedDeletable.map(f => f.id);
    if (ids.length === 0) { setBulkDeleteOpen(false); return; }
    await bulkDeleteFiles(businessId, ids);
    setFiles(prev => prev.filter(f => !selectedIds.has(f.id) || !f.deletable));
    setSelectedIds(new Set());
    setBulkDeleteOpen(false);
  }, [selectedDeletable, businessId, selectedIds]);

  const onMoveTo = useCallback(async (targetFolderId: number | null) => {
    for (const f of selectedDeletable) {
      await moveFile(businessId, f.id, targetFolderId);
    }
    setFiles(prev => prev.map(f => selectedDeletable.find(s => s.id === f.id) ? { ...f, folder_id: targetFolderId } : f));
    setSelectedIds(new Set());
    setMoveTargetOpen(false);
  }, [selectedDeletable, businessId]);

  const onDeleteConfirmed = useCallback(async () => {
    if (!deleteConfirm) return;
    const ok = await deleteProjectFile(businessId, deleteConfirm.id);
    if (ok) {
      setFiles(prev => prev.filter(f => f.id !== deleteConfirm.id));
      if (preview?.id === deleteConfirm.id) setPreview(null);
    }
    setDeleteConfirm(null);
  }, [deleteConfirm, businessId, preview]);

  const isEmpty = !loading && files.length === 0;

  return (
    <Wrap
      onDragEnter={e => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={e => { if (e.currentTarget.contains(e.relatedTarget as Node)) return; setDragOver(false); }}
      onDragOver={e => e.preventDefault()}
      onDrop={e => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
    >
      {/* 드롭 오버레이 (전역 드래그 중 표시) */}
      {dragOver && <DragOverlay>
        <DragOverlayInner>
          <DzIcon $large>
            <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          </DzIcon>
          <div>{t('docs.drop.release', '여기에 놓아 업로드')}</div>
        </DragOverlayInner>
      </DragOverlay>}

      {/* 업로드 영역 — 파일 있을 때는 compact */}
      {isEmpty ? (
        <Dropzone $drag={dragOver} onClick={() => inputRef.current?.click()}
          role="button" tabIndex={0}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click(); }}>
          <DzIcon>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          </DzIcon>
          <DzTitle>{t('docs.drop.title', '파일을 여기에 드롭하거나 클릭해 선택')}</DzTitle>
          <DzHint>{t('docs.drop.hint', '최대 50MB · 여러 파일 동시 업로드')}</DzHint>
          {uploadingCount > 0 && <DzBadge>{t('docs.drop.uploading', '{{n}}개 업로드 중…', { n: uploadingCount })}</DzBadge>}
        </Dropzone>
      ) : (
        <CompactBar>
          <CompactUploadBtn type="button" onClick={() => inputRef.current?.click()}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            {t('docs.drop.upload', '업로드')}
          </CompactUploadBtn>
          <CompactHint>{t('docs.drop.compactHint', '여기나 리스트 영역에 파일을 끌어다 놓아도 됩니다')}</CompactHint>
          {uploadingCount > 0 && <DzBadge>{t('docs.drop.uploading', '{{n}}개 업로드 중…', { n: uploadingCount })}</DzBadge>}
        </CompactBar>
      )}
      <input ref={inputRef} type="file" multiple hidden
        onChange={e => { if (e.target.files) handleFiles(e.target.files); e.target.value = ''; }} />

      {/* 툴바 */}
      <Toolbar>
        <SearchBox
          value={query}
          onChange={setQuery}
          placeholder={tr('docs.search', '파일 검색')}
          width={260}
        />
        <SortWrap>
          <PlanQSelect
            size="sm"
            value={{ value: sort, label: sortLabel(sort, tr) }}
            onChange={v => { const nv = (v as { value?: SortKey } | null)?.value; if (nv) setSort(nv); }}
            options={[
              { value: 'recent', label: t('docs.sort.recent', '최근 순') },
              { value: 'name', label: t('docs.sort.name', '이름 순') },
              { value: 'size', label: t('docs.sort.size', '크기 순') },
            ]}
          />
        </SortWrap>
        <ViewToggle role="group" aria-label="view">
          <VT $active={view === 'grid'} type="button" onClick={() => setView('grid')} title={tr('docs.view.grid', '그리드')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
              <rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
            </svg>
          </VT>
          <VT $active={view === 'list'} type="button" onClick={() => setView('list')} title={tr('docs.view.list', '리스트')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" />
              <line x1="8" y1="18" x2="21" y2="18" /><circle cx="4" cy="6" r="1" />
              <circle cx="4" cy="12" r="1" /><circle cx="4" cy="18" r="1" />
            </svg>
          </VT>
        </ViewToggle>
        <SelectToggle $on={selectMode} type="button" onClick={() => setSelectMode(v => !v)}>
          {selectMode ? t('docs.bulk.exit', '선택 종료') : t('docs.bulk.enter', '선택')}
        </SelectToggle>
      </Toolbar>

      {/* Split: 좌 폴더 트리 + 우 파일 영역 */}
      <Split>
        <FolderTreePanel>
          <FolderTree
            folders={folders}
            counts={counts}
            total={counts.total}
            selected={folderSel}
            onSelect={sel => { setFolderSel(sel); clearSelection(); }}
            onCreate={async (parentId, name) => {
              const f = await createFolder(projectId, name, parentId);
              setFolders(prev => [...prev, f]);
            }}
            onRename={async (id, name) => {
              await renameFolder(id, name);
              setFolders(prev => prev.map(f => f.id === id ? { ...f, name } : f));
            }}
            onDelete={async (id) => {
              await deleteFolder(id);
              setFolders(prev => prev.filter(f => f.id !== id));
              setFiles(prev => prev.map(f => f.folder_id === id ? { ...f, folder_id: null } : f));
              if (folderSel === id) setFolderSel('direct');
            }}
            tr={tr}
          />
        </FolderTreePanel>

        <FilesArea>
          {selectMode && selectedIds.size > 0 && (
            <BulkBar>
              <BulkBarLeft>
                <strong>{t('docs.bulk.selected', '{{n}}개 선택됨', { n: selectedIds.size })}</strong>
                <span>· {t('docs.bulk.deletable', '삭제 가능 {{n}}개', { n: selectedDeletable.length })}</span>
              </BulkBarLeft>
              <BulkBarRight>
                <BulkBtn type="button" onClick={selectAllVisible}>{t('docs.bulk.selectAll', '전체 선택')}</BulkBtn>
                <BulkBtn type="button" onClick={clearSelection}>{t('docs.bulk.clear', '해제')}</BulkBtn>
                <BulkBtnSep />
                <BulkBtn type="button" disabled={selectedDeletable.length === 0} onClick={() => setMoveTargetOpen(true)}>
                  {t('docs.bulk.move', '이동')}
                </BulkBtn>
                <BulkBtn $danger type="button" disabled={selectedDeletable.length === 0} onClick={() => setBulkDeleteOpen(true)}>
                  {t('docs.bulk.delete', '삭제')}
                </BulkBtn>
              </BulkBarRight>
            </BulkBar>
          )}

          {loading ? (
            view === 'grid' ? (
              <Grid>
                {Array.from({ length: 6 }).map((_, i) => (
                  <SkeletonCard key={i}>
                    <SkThumb /><SkLine $w="70%" /><SkLine $w="45%" />
                  </SkeletonCard>
                ))}
              </Grid>
            ) : (
              <ListTable>
                {Array.from({ length: 6 }).map((_, i) => (
                  <SkeletonRow key={i}>
                    <SkIcon /><SkLine $w="40%" /><SkLine $w="15%" /><SkLine $w="12%" />
                  </SkeletonRow>
                ))}
              </ListTable>
            )
          ) : visible.length === 0 ? (
            files.length === 0 ? (
              <EmptyState
                icon={<EmptyIcon />}
                title={t('docs.empty.title', '아직 파일이 없어요')}
                description={t('docs.empty.desc', '드롭존에 파일을 떨어뜨리거나, 채팅·업무·회의에 첨부하면 여기에 모입니다')}
              />
            ) : (
              <Dim>{t('docs.empty.filtered', '조건에 맞는 파일이 없습니다')}</Dim>
            )
          ) : view === 'grid' ? (
            <Grid>
              {visible.map(f => {
                const checked = selectedIds.has(f.id);
                return (
                  <Card key={f.id} $selected={checked}
                    onClick={e => selectMode ? toggleSelect(f.id, e) : setPreview(f)}>
                    {selectMode && (
                      <CardCheck onClick={e => e.stopPropagation()}>
                        <input type="checkbox" checked={checked} onChange={() => toggleSelect(f.id)} disabled={!f.deletable} />
                      </CardCheck>
                    )}
                    {(() => {
                      const img = isImage(f.mime_type, f.file_name);
                      const valid = !!f.preview_url && f.preview_url !== '#';
                      return (
                        <Thumb $src={img && valid ? f.preview_url : undefined}>
                          {!(img && valid) && <FileExtIcon ext={extOf(f.file_name)} size={56} large />}
                          <SourceTag $src={f.source}>{sourceShortLabel(f.source, tr)}</SourceTag>
                        </Thumb>
                      );
                    })()}
                    <CardName title={f.file_name}>{f.file_name}</CardName>
                    <CardMeta><span>{formatBytes(f.file_size)}</span><span>·</span><span>{f.uploader_name}</span></CardMeta>
                    <CardMeta><span>{formatDate(f.uploaded_at)}</span></CardMeta>
                  </Card>
                );
              })}
            </Grid>
          ) : (
            <ListTable>
              <ListHead $selectMode={selectMode}>
                {selectMode && <HCChk>
                  <input type="checkbox"
                    checked={visible.length > 0 && visible.every(v => selectedIds.has(v.id))}
                    onChange={e => e.target.checked ? selectAllVisible() : clearSelection()} />
                </HCChk>}
                <HCName>{t('docs.col.name', '파일명')}</HCName>
                <HCSrc>{t('docs.col.source', '출처')}</HCSrc>
                <HCSize>{t('docs.col.size', '크기')}</HCSize>
                <HCUp>{t('docs.col.uploader', '업로더')}</HCUp>
                <HCDate>{t('docs.col.date', '업로드')}</HCDate>
                <HCAct />
              </ListHead>
              {visible.map(f => {
                const checked = selectedIds.has(f.id);
                return (
                  <ListRow key={f.id} $selected={checked}
                    $selectMode={selectMode}
                    onClick={() => selectMode ? toggleSelect(f.id) : setPreview(f)}>
                    {selectMode && <RowChk onClick={e => e.stopPropagation()}>
                      <input type="checkbox" checked={checked} onChange={() => toggleSelect(f.id)} disabled={!f.deletable} />
                    </RowChk>}
                    <RowName>
                      <FileExtIcon ext={extOf(f.file_name)} size={32} />
                      <RowNameText title={f.file_name}>{f.file_name}</RowNameText>
                    </RowName>
                    <RowSrc>
                      <SourcePill $src={f.source}>{sourceShortLabel(f.source, tr)}</SourcePill>
                      {f.context && <RowCtx title={f.context.label}>{f.context.label}</RowCtx>}
                    </RowSrc>
                    <RowSize>{formatBytes(f.file_size)}</RowSize>
                    <RowUp>{f.uploader_name}</RowUp>
                    <RowDate>{formatDate(f.uploaded_at)}</RowDate>
                    <RowAct>
                      {f.deletable && !selectMode && (
                        <IconBtn type="button" title={tr('docs.delete', '삭제')}
                          onClick={e => { e.stopPropagation(); setDeleteConfirm(f); }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                            <path d="M10 11v6M14 11v6" />
                          </svg>
                        </IconBtn>
                      )}
                    </RowAct>
                  </ListRow>
                );
              })}
            </ListTable>
          )}
        </FilesArea>
      </Split>

      {/* 미리보기 드로어 */}
      <DetailDrawer open={!!preview} onClose={() => setPreview(null)} width={520} ariaLabel={tr('docs.preview.aria', '파일 미리보기')}>
        {preview && (
          <>
            <DetailDrawer.Header onClose={() => setPreview(null)}>
              <PvHeaderInner>
                <PvHeaderText>
                  <PvTitle>{preview.file_name}</PvTitle>
                  <PvSubRow>
                    <SourcePill $src={preview.source}>{sourceShortLabel(preview.source, tr)}</SourcePill>
                    <PvSub>{formatBytes(preview.file_size)} · {preview.uploader_name}</PvSub>
                  </PvSubRow>
                </PvHeaderText>
                <PvActions>
                  <HeaderIconBtn as="a" href={preview.download_url} download
                    title={tr('docs.download', '다운로드')} aria-label={tr('docs.download', '다운로드')}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                  </HeaderIconBtn>
                  {preview.deletable && (
                    <HeaderIconBtn $danger type="button" onClick={() => setDeleteConfirm(preview)}
                      title={tr('docs.delete', '삭제')} aria-label={tr('docs.delete', '삭제')}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                        <path d="M10 11v6M14 11v6" />
                      </svg>
                    </HeaderIconBtn>
                  )}
                </PvActions>
              </PvHeaderInner>
            </DetailDrawer.Header>
            <DetailDrawer.Body>
              <PreviewArea file={preview} />
              <MetaList>
                <MetaItem><MetaKey>{t('docs.col.uploader', '업로더')}</MetaKey><MetaVal>{preview.uploader_name}</MetaVal></MetaItem>
                <MetaItem><MetaKey>{t('docs.col.date', '업로드')}</MetaKey><MetaVal>{formatDate(preview.uploaded_at)}</MetaVal></MetaItem>
                <MetaItem><MetaKey>{t('docs.col.size', '크기')}</MetaKey><MetaVal>{formatBytes(preview.file_size)}</MetaVal></MetaItem>
                <MetaItem><MetaKey>{t('docs.col.mime', '형식')}</MetaKey><MetaVal>{preview.mime_type || '—'}</MetaVal></MetaItem>
                {preview.context && <MetaItem>
                  <MetaKey>{t('docs.col.context', '출처')}</MetaKey><MetaVal>{preview.context.label}</MetaVal>
                </MetaItem>}
              </MetaList>
            </DetailDrawer.Body>
          </>
        )}
      </DetailDrawer>

      {/* 단일 삭제 확인 */}
      {deleteConfirm && (
        <Modal onMouseDown={e => { if (e.target === e.currentTarget) setDeleteConfirm(null); }}>
          <Dialog>
            <DTitle>{t('docs.confirmDelete.title', '파일을 삭제할까요?')}</DTitle>
            <DBody>
              <p><strong>{deleteConfirm.file_name}</strong></p>
              <p>{t('docs.confirmDelete.desc', '삭제한 파일은 복구할 수 없습니다')}</p>
            </DBody>
            <DFooter>
              <SecondaryBtn type="button" onClick={() => setDeleteConfirm(null)}>{t('members.cancel', '취소')}</SecondaryBtn>
              <DangerBtn type="button" onClick={onDeleteConfirmed}>{t('docs.delete', '삭제')}</DangerBtn>
            </DFooter>
          </Dialog>
        </Modal>
      )}

      {/* 대량 삭제 확인 */}
      {bulkDeleteOpen && (
        <Modal onMouseDown={e => { if (e.target === e.currentTarget) setBulkDeleteOpen(false); }}>
          <Dialog>
            <DTitle>{t('docs.bulkDelete.title', '{{n}}개 파일을 삭제할까요?', { n: selectedDeletable.length })}</DTitle>
            <DBody>
              <BulkFileList>
                {selectedDeletable.slice(0, 5).map(f => (
                  <BulkFileItem key={f.id}>• {f.file_name}</BulkFileItem>
                ))}
                {selectedDeletable.length > 5 && (
                  <BulkFileMore>{t('docs.bulkDelete.more', '외 {{n}}개', { n: selectedDeletable.length - 5 })}</BulkFileMore>
                )}
              </BulkFileList>
              <p>{t('docs.confirmDelete.desc', '삭제한 파일은 복구할 수 없습니다')}</p>
            </DBody>
            <DFooter>
              <SecondaryBtn type="button" onClick={() => setBulkDeleteOpen(false)}>{t('members.cancel', '취소')}</SecondaryBtn>
              <DangerBtn type="button" onClick={onBulkDeleteConfirmed}>{t('docs.delete', '삭제')}</DangerBtn>
            </DFooter>
          </Dialog>
        </Modal>
      )}

      {/* 대량 이동 */}
      {moveTargetOpen && (
        <Modal onMouseDown={e => { if (e.target === e.currentTarget) setMoveTargetOpen(false); }}>
          <Dialog>
            <DTitle>{t('docs.move.title', '이동할 폴더 선택')}</DTitle>
            <DBody>
              <MoveTargetList>
                <MoveTargetRow type="button" onClick={() => onMoveTo(null)}>
                  <span>{t('docs.folder.directRoot', '내 업로드')}</span>
                </MoveTargetRow>
                {folders.filter(f => f.parent_id === null).map(f => (
                  <React.Fragment key={f.id}>
                    <MoveTargetRow type="button" onClick={() => onMoveTo(f.id)}>
                      <MoveTargetIcon><FolderSvg /></MoveTargetIcon><span>{f.name}</span>
                    </MoveTargetRow>
                    {folders.filter(c => c.parent_id === f.id).map(c => (
                      <MoveTargetRow key={c.id} type="button" onClick={() => onMoveTo(c.id)} style={{ paddingLeft: 34 }}>
                        <MoveTargetIcon><FolderSvg /></MoveTargetIcon><span>{c.name}</span>
                      </MoveTargetRow>
                    ))}
                  </React.Fragment>
                ))}
              </MoveTargetList>
            </DBody>
            <DFooter>
              <SecondaryBtn type="button" onClick={() => setMoveTargetOpen(false)}>{t('members.cancel', '취소')}</SecondaryBtn>
            </DFooter>
          </Dialog>
        </Modal>
      )}
    </Wrap>
  );
};

export default DocsTab;

// ─── 폴더 트리 컴포넌트 ───

interface FolderTreeProps {
  folders: FileFolder[];
  counts: { total: number; bySrc: Record<FileSource, number>; byFolder: Record<number, number>; directRoot: number };
  total: number;
  selected: FolderSel;
  onSelect: (sel: FolderSel) => void;
  onCreate: (parentId: number | null, name: string) => Promise<void>;
  onRename: (id: number, name: string) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  tr: (k: string, fb?: string) => string;
}

const FolderTree: React.FC<FolderTreeProps> = ({ folders, counts, total, selected, onSelect, onCreate, onRename, onDelete, tr }) => {
  const [creatingParent, setCreatingParent] = useState<number | null | undefined>(undefined);
  const [newName, setNewName] = useState('');
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<FileFolder | null>(null);

  const rootFolders = folders.filter(f => f.parent_id === null);
  const childrenOf = (id: number) => folders.filter(f => f.parent_id === id);

  const startCreate = (parentId: number | null) => {
    setCreatingParent(parentId); setNewName('');
  };
  const commitCreate = async () => {
    if (!newName.trim()) { setCreatingParent(undefined); return; }
    await onCreate(creatingParent ?? null, newName.trim());
    setCreatingParent(undefined); setNewName('');
  };
  const startRename = (f: FileFolder) => { setRenamingId(f.id); setRenameDraft(f.name); };
  const commitRename = async () => {
    if (renamingId == null) return;
    const name = renameDraft.trim();
    if (name) await onRename(renamingId, name);
    setRenamingId(null);
  };

  const renderFolder = (f: FileFolder, depth: number): React.ReactNode => {
    const sel = selected === f.id;
    const children = childrenOf(f.id);
    const count = counts.byFolder[f.id] || 0;
    return (
      <React.Fragment key={f.id}>
        <FolderRow $selected={sel} style={{ paddingLeft: 8 + depth * 14 }}
          onClick={() => onSelect(f.id)}>
          <FolderIconWrap $selected={sel}>{sel ? <FolderOpenSvg /> : <FolderSvg />}</FolderIconWrap>
          {renamingId === f.id ? (
            <RenameInput autoFocus value={renameDraft}
              onClick={e => e.stopPropagation()}
              onChange={e => setRenameDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
                if (e.key === 'Escape') setRenamingId(null);
              }} />
          ) : (
            <>
              <FolderName onDoubleClick={e => { e.stopPropagation(); startRename(f); }}>{f.name}</FolderName>
              {count > 0 && <FolderCount>{count}</FolderCount>}
              <FolderActions $visible={sel} onClick={e => e.stopPropagation()}>
                <FolderMiniBtn type="button" title={tr('docs.folder.newChild', '하위 폴더')} onClick={() => startCreate(f.id)} aria-label={tr('docs.folder.newChild', '하위 폴더')}><PlusSvg /></FolderMiniBtn>
                <FolderMiniBtn type="button" title={tr('docs.folder.rename', '이름 변경')} onClick={() => startRename(f)} aria-label={tr('docs.folder.rename', '이름 변경')}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
                </FolderMiniBtn>
                <FolderMiniBtn type="button" $danger title={tr('docs.folder.delete', '삭제')} onClick={() => setDeleteTarget(f)} aria-label={tr('docs.folder.delete', '삭제')}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
                </FolderMiniBtn>
              </FolderActions>
            </>
          )}
        </FolderRow>
        {children.map(c => renderFolder(c, depth + 1))}
        {creatingParent === f.id && (
          <FolderRow style={{ paddingLeft: 8 + (depth + 1) * 14 }}>
            <FolderIconWrap><FolderSvg /></FolderIconWrap>
            <RenameInput autoFocus placeholder={tr('docs.folder.placeholder', '폴더 이름')} value={newName}
              onChange={e => setNewName(e.target.value)} onBlur={commitCreate}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); commitCreate(); }
                if (e.key === 'Escape') setCreatingParent(undefined);
              }} />
          </FolderRow>
        )}
      </React.Fragment>
    );
  };

  const fileCountInFolder = (folderId: number): number => counts.byFolder[folderId] || 0;

  const directTotal = counts.bySrc.direct;

  return (
    <>
      <TreeRoot>
        <FolderRow $selected={selected === 'all'} onClick={() => onSelect('all')}>
          <FolderIconWrap $selected={selected === 'all'}><AllSvg /></FolderIconWrap>
          <FolderName>{tr('docs.folder.all', '전체')}</FolderName>
          <FolderCount>{total}</FolderCount>
        </FolderRow>

        <TreeDivider />

        {/* 내 업로드 — "직접 업로드" 섹션헤더 + 루트 항목 통합 */}
        <FolderRow $selected={selected === 'direct'} onClick={() => onSelect('direct')}>
          <FolderIconWrap $selected={selected === 'direct'}>{selected === 'direct' ? <FolderOpenSvg /> : <FolderSvg />}</FolderIconWrap>
          <FolderName>{tr('docs.folder.directRoot', '내 업로드')}</FolderName>
          {directTotal > 0 && <FolderCount>{directTotal}</FolderCount>}
          <FolderActions $visible={selected === 'direct'} onClick={e => e.stopPropagation()}>
            <FolderMiniBtn type="button" title={tr('docs.folder.new', '새 폴더')} aria-label={tr('docs.folder.new', '새 폴더')} onClick={() => startCreate(null)}>
              <PlusSvg size={12} />
            </FolderMiniBtn>
          </FolderActions>
        </FolderRow>
        {creatingParent === null && (
          <FolderRow style={{ paddingLeft: 22 }}>
            <FolderIconWrap><FolderSvg /></FolderIconWrap>
            <RenameInput autoFocus placeholder={tr('docs.folder.placeholder', '폴더 이름')} value={newName}
              onChange={e => setNewName(e.target.value)} onBlur={commitCreate}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); commitCreate(); }
                if (e.key === 'Escape') setCreatingParent(undefined);
              }} />
          </FolderRow>
        )}
        {rootFolders.map(f => renderFolder(f, 1))}

        <TreeDivider />

        {(['chat', 'task', 'meeting'] as FileSource[]).map(src => (
          <FolderRow key={src} $selected={selected === `src:${src}`} onClick={() => onSelect(`src:${src}`)}>
            <FolderIconWrap $sys={src} $selected={selected === `src:${src}`}><SystemFolderIcon src={src} /></FolderIconWrap>
            <FolderName>{sourceShortLabel(src, tr)}</FolderName>
            {counts.bySrc[src] > 0 && <FolderCount>{counts.bySrc[src]}</FolderCount>}
          </FolderRow>
        ))}
      </TreeRoot>

      {deleteTarget && (
        <Modal onMouseDown={e => { if (e.target === e.currentTarget) setDeleteTarget(null); }}>
          <Dialog>
            <DTitle>{tr('docs.folder.deleteTitle', '폴더를 삭제할까요?')}</DTitle>
            <DBody>
              <p><strong>{deleteTarget.name}</strong></p>
              {fileCountInFolder(deleteTarget.id) > 0 ? (
                <p>{deleteWithFilesMessage(fileCountInFolder(deleteTarget.id), tr)}</p>
              ) : (
                <p>{tr('docs.folder.deleteEmpty', '이 폴더는 비어있습니다')}</p>
              )}
            </DBody>
            <DFooter>
              <SecondaryBtn type="button" onClick={() => setDeleteTarget(null)}>{tr('members.cancel', '취소')}</SecondaryBtn>
              <DangerBtn type="button" onClick={async () => { await onDelete(deleteTarget.id); setDeleteTarget(null); }}>
                {tr('docs.delete', '삭제')}
              </DangerBtn>
            </DFooter>
          </Dialog>
        </Modal>
      )}
    </>
  );
};

// ─── 프리뷰 ───

const PreviewArea: React.FC<{ file: ProjectFile }> = ({ file }) => {
  const hasValidUrl = (u?: string) => !!u && u !== '#' && u.trim().length > 0;
  if (isImage(file.mime_type, file.file_name) && hasValidUrl(file.preview_url)) {
    return <PreviewImage src={file.preview_url!} alt={file.file_name} />;
  }
  if ((file.mime_type === 'application/pdf' || extOf(file.file_name) === 'pdf') && hasValidUrl(file.download_url)) {
    return <PreviewIframe src={file.download_url} title={file.file_name} />;
  }
  return (
    <PreviewFallback>
      <PvExtCircle>{extOf(file.file_name).toUpperCase() || '—'}</PvExtCircle>
      <PvFallbackHint>미리보기는 다운로드 후 확인 가능합니다</PvFallbackHint>
    </PreviewFallback>
  );
};

// ─── helpers ───

function sortLabel(s: SortKey, t: (k: string, fb?: string) => string): string {
  if (s === 'name') return t('docs.sort.name', '이름 순');
  if (s === 'size') return t('docs.sort.size', '크기 순');
  return t('docs.sort.recent', '최근 순');
}

function sourceShortLabel(s: FileSource, t: (k: string, fb?: string) => string): string {
  if (s === 'chat') return t('docs.source.chat', '채팅');
  if (s === 'task') return t('docs.source.task', '업무');
  if (s === 'meeting') return t('docs.source.meeting', '회의');
  return t('docs.source.direct', '직접');
}

function deleteWithFilesMessage(n: number, tr: (k: string, fb?: string) => string): string {
  // i18n 에 {{n}} 이 들어간 문구를 tr(2 arg) 로 단순 치환
  const tpl = tr('docs.folder.deleteWithFiles', '이 폴더 안 {{n}}개 파일은 “직접 업로드 루트”로 옮겨집니다');
  return tpl.replace('{{n}}', String(n));
}

function srcStyle(s: FileSource): string {
  switch (s) {
    case 'chat':    return 'background:#E0F2FE;color:#075985;';
    case 'task':    return 'background:#FEF3C7;color:#92400E;';
    case 'meeting': return 'background:#F3E8FF;color:#6B21A8;';
    default:        return 'background:#F0FDFA;color:#0F766E;';
  }
}

// ─── SVG 아이콘 (Lucide 스타일) ───

const FolderSvg: React.FC<{ size?: number }> = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </svg>
);
const FolderOpenSvg: React.FC<{ size?: number }> = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 14l1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" />
  </svg>
);
const ChatSvg: React.FC<{ size?: number }> = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);
const TaskSvg: React.FC<{ size?: number }> = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 11 12 14 22 4" />
    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
  </svg>
);
const MicSvg: React.FC<{ size?: number }> = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <line x1="12" y1="19" x2="12" y2="23" />
    <line x1="8" y1="23" x2="16" y2="23" />
  </svg>
);
const AllSvg: React.FC<{ size?: number }> = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
    <rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
  </svg>
);
const PlusSvg: React.FC<{ size?: number }> = ({ size = 12 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
);

// 폴더 트리용 아이콘 (시스템/일반 구분)
const SystemFolderIcon: React.FC<{ src: FileSource; size?: number }> = ({ src, size = 14 }) => {
  if (src === 'chat') return <ChatSvg size={size} />;
  if (src === 'task') return <TaskSvg size={size} />;
  if (src === 'meeting') return <MicSvg size={size} />;
  return <FolderSvg size={size} />;
};

// 확장자별 색상 아이콘 (Notion/Linear 패턴)
type ExtPalette = { bg: string; fg: string };
function extPalette(ext: string): ExtPalette {
  const e = ext.toLowerCase();
  if (['pdf'].includes(e)) return { bg: '#FEE2E2', fg: '#B91C1C' };
  if (['doc', 'docx'].includes(e)) return { bg: '#DBEAFE', fg: '#1D4ED8' };
  if (['xls', 'xlsx', 'csv'].includes(e)) return { bg: '#D1FAE5', fg: '#047857' };
  if (['ppt', 'pptx'].includes(e)) return { bg: '#FED7AA', fg: '#C2410C' };
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(e)) return { bg: '#E9D5FF', fg: '#6D28D9' };
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(e)) return { bg: '#FCE7F3', fg: '#BE185D' };
  if (['mp3', 'wav', 'm4a'].includes(e)) return { bg: '#FEF9C3', fg: '#854D0E' };
  if (['mp4', 'mov', 'webm'].includes(e)) return { bg: '#E0E7FF', fg: '#4338CA' };
  if (['txt', 'md'].includes(e)) return { bg: '#F1F5F9', fg: '#475569' };
  return { bg: '#F1F5F9', fg: '#64748B' };
}
const FileExtIcon: React.FC<{ ext: string; size?: number; large?: boolean }> = ({ ext, size = 32, large }) => {
  const p = extPalette(ext);
  const label = (ext || '—').toUpperCase().slice(0, 4);
  return (
    <FileExtBox style={{ width: size, height: size, background: p.bg, color: p.fg, fontSize: large ? 13 : 10 }}>
      {label}
    </FileExtBox>
  );
};
const FileExtBox = styled.div`
  display:flex;align-items:center;justify-content:center;
  border-radius:7px;font-weight:800;letter-spacing:.3px;flex-shrink:0;
`;

// ─── styled ───

const Wrap = styled.div`display:flex;flex-direction:column;gap:12px;`;

const Dropzone = styled.div<{ $drag: boolean }>`
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:4px;padding:32px 20px;background:${p => p.$drag ? '#F0FDFA' : '#F8FAFC'};
  border:1.5px dashed ${p => p.$drag ? '#14B8A6' : '#CBD5E1'};border-radius:12px;
  cursor:pointer;transition:background .15s, border-color .15s;
  &:hover{background:#F0FDFA;border-color:#14B8A6;}
  &:focus-visible{outline:2px solid #14B8A6;outline-offset:2px;}
`;
const DzIcon = styled.div<{ $large?: boolean }>`color:#14B8A6;margin-bottom:${p => p.$large ? 12 : 2}px;`;
const DzTitle = styled.div`font-size:13px;font-weight:600;color:#0F172A;`;
const DzHint = styled.div`font-size:11px;color:#64748B;`;
const DzBadge = styled.div`margin-top:4px;padding:3px 10px;background:#0F766E;color:#fff;border-radius:999px;font-size:11px;font-weight:600;`;

const CompactBar = styled.div`
  display:flex;align-items:center;gap:12px;flex-wrap:wrap;
  padding:8px 12px;background:#F8FAFC;border:1px dashed #CBD5E1;border-radius:10px;
`;
const CompactUploadBtn = styled.button`
  display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 14px;
  background:#14B8A6;color:#fff;border:none;border-radius:8px;
  font-size:12px;font-weight:600;cursor:pointer;
  &:hover{background:#0D9488;}
  &:focus-visible{outline:2px solid #0D9488;outline-offset:2px;}
`;
const CompactHint = styled.div`font-size:11px;color:#94A3B8;flex:1;min-width:0;`;

const DragOverlay = styled.div`
  position:fixed;inset:0;z-index:60;background:rgba(15,23,42,0.55);
  display:flex;align-items:center;justify-content:center;pointer-events:none;
`;
const DragOverlayInner = styled.div`
  display:flex;flex-direction:column;align-items:center;gap:12px;
  padding:32px 48px;background:#fff;border:2px dashed #14B8A6;border-radius:16px;
  font-size:15px;font-weight:700;color:#0F766E;
`;

const Toolbar = styled.div`
  display:flex;align-items:center;gap:8px;flex-wrap:wrap;
  padding:8px 12px;background:#fff;border:1px solid #E2E8F0;border-radius:10px;
`;
const SortWrap = styled.div`width:130px;`;
const ViewToggle = styled.div`display:inline-flex;background:#F1F5F9;border:1px solid #E2E8F0;border-radius:8px;padding:2px;gap:2px;`;
const VT = styled.button<{ $active: boolean }>`
  width:30px;height:26px;display:flex;align-items:center;justify-content:center;
  background:${p => p.$active ? '#fff' : 'transparent'};
  color:${p => p.$active ? '#0F172A' : '#94A3B8'};
  border:none;border-radius:6px;cursor:pointer;
  box-shadow:${p => p.$active ? '0 1px 2px rgba(15,23,42,.06)' : 'none'};
  &:hover{color:#0F172A;}
  &:focus-visible{outline:2px solid #14B8A6;outline-offset:1px;}
`;
const SelectToggle = styled.button<{ $on: boolean }>`
  height:30px;padding:0 14px;
  background:${p => p.$on ? '#0F172A' : '#fff'};
  color:${p => p.$on ? '#fff' : '#0F172A'};
  border:1px solid ${p => p.$on ? '#0F172A' : '#CBD5E1'};
  border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;
  &:hover{border-color:${p => p.$on ? '#1E293B' : '#94A3B8'};}
  &:focus-visible{outline:2px solid #14B8A6;outline-offset:2px;}
`;

// Split layout
const Split = styled.div`
  display:grid;grid-template-columns:220px 1fr;gap:12px;align-items:start;
  @media (max-width: 900px){ grid-template-columns:1fr; }
`;
const FolderTreePanel = styled.div`
  background:#fff;border:1px solid #E2E8F0;border-radius:10px;padding:6px;
  position:sticky;top:8px;
  max-height:calc(100vh - 180px);overflow-y:auto;
  @media (max-width: 900px){ position:static;max-height:none; }
`;
const FilesArea = styled.div`display:flex;flex-direction:column;gap:10px;min-width:0;`;

const TreeRoot = styled.div`display:flex;flex-direction:column;gap:1px;`;
const TreeDivider = styled.div`height:1px;background:#F1F5F9;margin:6px 0;`;
const FolderRow = styled.div<{ $selected?: boolean }>`
  display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;cursor:pointer;min-height:30px;
  background:${p => p.$selected ? '#F0FDFA' : 'transparent'};
  color:${p => p.$selected ? '#0F766E' : '#0F172A'};
  &:hover{background:${p => p.$selected ? '#F0FDFA' : '#F8FAFC'};}
  &:focus-visible{outline:2px solid #14B8A6;outline-offset:-2px;}
`;
const FolderIconWrap = styled.div<{ $selected?: boolean; $sys?: FileSource }>`
  flex-shrink:0;display:flex;align-items:center;justify-content:center;
  color:${p => {
    if (p.$sys === 'chat') return '#0EA5E9';
    if (p.$sys === 'task') return '#F59E0B';
    if (p.$sys === 'meeting') return '#A855F7';
    return p.$selected ? '#0D9488' : '#64748B';
  }};
`;
const FolderName = styled.div`
  flex:1;min-width:0;font-size:12px;font-weight:500;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
`;
const FolderCount = styled.span`
  font-size:10px;color:#94A3B8;font-weight:600;padding:1px 6px;background:#F1F5F9;border-radius:999px;
`;
const FolderActions = styled.div<{ $visible?: boolean }>`
  display:flex;gap:2px;opacity:${p => p.$visible ? 1 : 0};transition:opacity .1s;flex-shrink:0;
`;
const FolderMiniBtn = styled.button<{ $danger?: boolean }>`
  width:22px;height:22px;display:flex;align-items:center;justify-content:center;
  background:transparent;border:none;border-radius:4px;cursor:pointer;color:#64748B;
  line-height:1;
  &:hover{background:${p => p.$danger ? '#FEE2E2' : '#E2E8F0'};color:${p => p.$danger ? '#DC2626' : '#0F172A'};}
  &:focus-visible{outline:2px solid #14B8A6;outline-offset:1px;}
`;
const RenameInput = styled.input`
  flex:1;min-width:0;height:24px;padding:0 6px;
  background:#fff;border:1px solid #14B8A6;border-radius:4px;font-size:12px;color:#0F172A;
  &:focus{outline:none;}
`;

/* Skeleton */
const skShimmer = `@keyframes sk-shimmer{0%{background-position:-200px 0;}100%{background-position:calc(200px + 100%) 0;}}`;
const SkeletonCard = styled.div`
  background:#fff;border:1px solid #E2E8F0;border-radius:10px;padding:0 0 10px;
  display:flex;flex-direction:column;gap:6px;
  ${skShimmer}
`;
const SkThumb = styled.div`
  aspect-ratio:16/10;background:linear-gradient(90deg, #F1F5F9 0px, #E2E8F0 40px, #F1F5F9 80px);
  background-size:200px 100%;animation:sk-shimmer 1.2s linear infinite;
  border-radius:10px 10px 0 0;
`;
const SkLine = styled.div<{ $w: string }>`
  height:10px;width:${p => p.$w};margin:0 10px;border-radius:4px;
  background:linear-gradient(90deg, #F1F5F9 0px, #E2E8F0 40px, #F1F5F9 80px);
  background-size:200px 100%;animation:sk-shimmer 1.2s linear infinite;
`;
const SkeletonRow = styled.div`
  display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid #F1F5F9;
  ${skShimmer}
  &:last-child{border-bottom:none;}
`;
const SkIcon = styled.div`
  width:32px;height:32px;border-radius:7px;flex-shrink:0;
  background:linear-gradient(90deg, #F1F5F9 0px, #E2E8F0 40px, #F1F5F9 80px);
  background-size:200px 100%;animation:sk-shimmer 1.2s linear infinite;
`;

// Bulk bar
const BulkBar = styled.div`
  position:sticky;top:0;z-index:5;
  display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;
  padding:10px 14px;background:#0F172A;color:#fff;border-radius:10px;
  box-shadow:0 4px 12px rgba(15,23,42,.12);
`;
const BulkBarLeft = styled.div`display:flex;gap:8px;align-items:baseline;font-size:13px;
  strong{font-weight:700;}
  span{color:#94A3B8;font-size:11px;}
`;
const BulkBarRight = styled.div`display:flex;gap:6px;align-items:center;flex-wrap:wrap;`;
const BulkBtnSep = styled.div`width:1px;height:18px;background:rgba(255,255,255,0.15);margin:0 4px;`;
const BulkBtn = styled.button<{ $danger?: boolean }>`
  height:28px;padding:0 12px;background:${p => p.$danger ? '#DC2626' : 'rgba(255,255,255,0.08)'};
  color:${p => p.$danger ? '#fff' : '#E2E8F0'};
  border:1px solid ${p => p.$danger ? '#DC2626' : 'rgba(255,255,255,0.12)'};
  border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;
  &:hover:not(:disabled){background:${p => p.$danger ? '#B91C1C' : 'rgba(255,255,255,0.14)'};}
  &:disabled{opacity:.4;cursor:not-allowed;}
`;

const Grid = styled.div`display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;`;
const Card = styled.div<{ $selected?: boolean }>`
  position:relative;background:#fff;
  border:2px solid ${p => p.$selected ? '#14B8A6' : '#E2E8F0'};
  border-radius:10px;overflow:hidden;cursor:pointer;
  display:flex;flex-direction:column;transition:border-color .15s, box-shadow .15s;
  &:hover{border-color:${p => p.$selected ? '#14B8A6' : '#14B8A6'};box-shadow:0 2px 8px rgba(20,184,166,.08);}
`;
const CardCheck = styled.div`
  position:absolute;top:6px;right:6px;z-index:2;
  width:24px;height:24px;display:flex;align-items:center;justify-content:center;
  background:rgba(255,255,255,0.92);border-radius:4px;
`;
const Thumb = styled.div<{ $src?: string }>`
  position:relative;aspect-ratio:16/10;
  background:${p => p.$src ? `center/cover no-repeat url(${p.$src}), #F8FAFC` : '#F8FAFC'};
  display:flex;align-items:center;justify-content:center;
`;
const SourceTag = styled.div<{ $src: FileSource }>`
  position:absolute;top:8px;left:8px;padding:2px 8px;border-radius:999px;
  font-size:10px;font-weight:700;letter-spacing:.2px;${p => srcStyle(p.$src)}
`;
const CardName = styled.div`padding:8px 10px 2px;font-size:13px;font-weight:600;color:#0F172A;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`;
const CardMeta = styled.div`padding:0 10px;font-size:11px;color:#64748B;display:flex;gap:4px;
  &:last-child{padding-bottom:10px;margin-top:2px;}
`;

const ListTable = styled.div`background:#fff;border:1px solid #E2E8F0;border-radius:10px;overflow:hidden;`;
const LIST_COLS = 'minmax(200px,3fr) minmax(140px,1.3fr) 80px 90px 100px 36px';
const ListHead = styled.div<{ $selectMode?: boolean }>`
  display:grid;
  grid-template-columns:${p => p.$selectMode ? `36px ${LIST_COLS}` : LIST_COLS};
  gap:8px;padding:10px 14px;background:#F8FAFC;border-bottom:1px solid #E2E8F0;
  font-size:11px;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:.3px;
`;
const HCChk = styled.div``;
const HCName = styled.div``;
const HCSrc = styled.div``;
const HCSize = styled.div``;
const HCUp = styled.div``;
const HCDate = styled.div``;
const HCAct = styled.div``;
const ListRow = styled.div<{ $selected?: boolean; $selectMode?: boolean }>`
  display:grid;
  grid-template-columns:${p => p.$selectMode ? `36px ${LIST_COLS}` : LIST_COLS};
  gap:8px;padding:10px 14px;align-items:center;cursor:pointer;
  border-bottom:1px solid #F1F5F9;background:${p => p.$selected ? '#F0FDFA' : 'transparent'};
  &:last-child{border-bottom:none;}
  &:hover{background:${p => p.$selected ? '#F0FDFA' : '#F8FAFC'};}
`;
const RowChk = styled.div`display:flex;justify-content:center;`;
const RowName = styled.div`display:flex;align-items:center;gap:10px;min-width:0;`;
const RowNameText = styled.div`font-size:13px;font-weight:600;color:#0F172A;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;`;
const RowSrc = styled.div`display:flex;align-items:center;gap:6px;min-width:0;`;
const SourcePill = styled.span<{ $src: FileSource }>`padding:2px 8px;border-radius:999px;font-size:10px;font-weight:700;letter-spacing:.2px;${p => srcStyle(p.$src)}`;
const RowCtx = styled.span`font-size:11px;color:#64748B;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;`;
const RowSize = styled.div`font-size:12px;color:#475569;`;
const RowUp = styled.div`font-size:12px;color:#475569;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`;
const RowDate = styled.div`font-size:12px;color:#64748B;`;
const RowAct = styled.div`display:flex;justify-content:flex-end;`;
const IconBtn = styled.button`
  width:28px;height:28px;display:flex;align-items:center;justify-content:center;
  background:transparent;border:none;color:#94A3B8;border-radius:6px;cursor:pointer;
  &:hover{background:#FEE2E2;color:#DC2626;}
`;

const Dim = styled.div`padding:30px;text-align:center;font-size:13px;color:#94A3B8;background:#fff;border:1px solid #E2E8F0;border-radius:10px;`;

// 드로어 내부
const PvHeaderInner = styled.div`display:flex;align-items:flex-start;gap:10px;min-width:0;width:100%;`;
const PvHeaderText = styled.div`flex:1;min-width:0;display:flex;flex-direction:column;gap:6px;`;
const PvTitle = styled.div`font-size:15px;font-weight:700;color:#0F172A;word-break:break-all;`;
const PvSubRow = styled.div`display:flex;align-items:center;gap:8px;flex-wrap:wrap;`;
const PvSub = styled.div`font-size:12px;color:#64748B;`;
const PvActions = styled.div`display:flex;gap:4px;flex-shrink:0;`;
const HeaderIconBtn = styled.button<{ $danger?: boolean }>`
  width:32px;height:32px;display:inline-flex;align-items:center;justify-content:center;
  background:transparent;color:${p => p.$danger ? '#DC2626' : '#475569'};
  border:1px solid #E2E8F0;border-radius:8px;cursor:pointer;text-decoration:none;
  transition:background .15s, border-color .15s, color .15s;
  &:hover{
    background:${p => p.$danger ? '#FEF2F2' : '#F1F5F9'};
    color:${p => p.$danger ? '#DC2626' : '#0F172A'};
    border-color:${p => p.$danger ? '#FCA5A5' : '#CBD5E1'};
  }
  @media (max-width: 640px){ width:40px;height:40px; }
`;
const PreviewImage = styled.img`width:100%;max-height:420px;object-fit:contain;background:#F8FAFC;border-radius:10px;`;
const PreviewIframe = styled.iframe`width:100%;height:420px;border:1px solid #E2E8F0;border-radius:10px;background:#F8FAFC;`;
const PreviewFallback = styled.div`display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:40px 20px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;`;
const PvExtCircle = styled.div`width:72px;height:72px;border-radius:50%;background:#fff;border:1px solid #E2E8F0;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:800;color:#475569;letter-spacing:.5px;`;
const PvFallbackHint = styled.div`font-size:12px;color:#64748B;text-align:center;`;
const MetaList = styled.div`display:flex;flex-direction:column;gap:10px;`;
const MetaItem = styled.div`display:flex;align-items:flex-start;gap:10px;font-size:13px;`;
const MetaKey = styled.div`flex:0 0 74px;font-size:11px;font-weight:700;color:#94A3B8;text-transform:uppercase;letter-spacing:.3px;padding-top:2px;`;
const MetaVal = styled.div`color:#0F172A;word-break:break-all;`;

// Buttons
const SecondaryBtn = styled.button`
  height:34px;padding:0 14px;background:#fff;color:#0F172A;
  border:1px solid #CBD5E1;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;
  display:inline-flex;align-items:center;justify-content:center;text-decoration:none;
  &:hover{background:#F8FAFC;}
`;
const DangerBtn = styled.button`
  height:34px;padding:0 14px;background:#fff;color:#DC2626;
  border:1px solid #FCA5A5;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;
  &:hover{background:#FEF2F2;border-color:#DC2626;}
`;

// Modals (단일/대량 삭제 / 이동)
const Modal = styled.div`
  position:fixed;inset:0;z-index:80;background:rgba(15,23,42,.24);
  display:flex;align-items:center;justify-content:center;padding:20px;
`;
const Dialog = styled.div`
  background:#fff;border-radius:14px;width:100%;max-width:460px;
  box-shadow:0 20px 50px rgba(15,23,42,.2);
  display:flex;flex-direction:column;overflow:hidden;max-height:80vh;
`;
const DTitle = styled.div`padding:18px 20px 10px;font-size:15px;font-weight:700;color:#0F172A;`;
const DBody = styled.div`
  padding:0 20px 16px;font-size:13px;color:#475569;line-height:1.5;overflow-y:auto;
  strong{color:#0F172A;}
  p{margin:4px 0;}
`;
const DFooter = styled.div`padding:12px 20px;border-top:1px solid #EEF2F6;display:flex;gap:8px;justify-content:flex-end;`;

const BulkFileList = styled.ul`list-style:none;padding:0;margin:8px 0 12px;display:flex;flex-direction:column;gap:4px;`;
const BulkFileItem = styled.li`font-size:12px;color:#0F172A;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`;
const BulkFileMore = styled.li`font-size:11px;color:#94A3B8;`;

const MoveTargetList = styled.div`display:flex;flex-direction:column;gap:2px;max-height:320px;overflow-y:auto;`;
const MoveTargetRow = styled.button`
  display:flex;align-items:center;gap:8px;padding:10px 12px;
  background:transparent;border:1px solid transparent;border-radius:8px;
  cursor:pointer;font-size:13px;color:#0F172A;text-align:left;
  &:hover{background:#F8FAFC;border-color:#E2E8F0;}
`;
const MoveTargetIcon = styled.span`display:inline-flex;color:#64748B;flex-shrink:0;`;

const EmptyIcon: React.FC = () => (
  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
  </svg>
);
