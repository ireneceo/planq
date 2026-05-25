// 공통 첨부 입력 — KnowledgePage 새 지식 등록 폼과 동일한 visual.
// "새 파일 업로드 (드롭존)" + "기존 파일 연결 (PlanQSelect isMulti, 검색)" 두 영역을 한 폼 안에 같이 표시.
//
// 사용처: KnowledgePage / PostAiModal 자료정리 / TaskAttachments / Q Note 자료 등.
// 호출부가 uploads (File[]) 와 existingFileIds (number[]) 상태를 관리.
//
// Props:
//   uploads / onUploadsChange — 로컬 업로드 staged
//   existingFileIds / onExistingFileIdsChange — 워크스페이스 파일 ID 들
//   businessId — fetchWorkspaceFiles 대상
//   accept (옵션) — input accept
//   uploadHint (옵션) — 드롭존 메인 텍스트 i18n 결과
//   uploadAcceptHint (옵션) — 드롭존 보조 텍스트
//   searchPlaceholder (옵션) — PlanQSelect placeholder
//   disabled
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import type { ChangeEvent, DragEvent } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import PlanQSelect, { type PlanQSelectOption } from './PlanQSelect';
import { fetchWorkspaceFiles, formatBytes, type ProjectFile } from '../../services/files';
import { fetchPosts, type PostRow } from '../../services/posts';

interface Props {
  businessId: number;
  uploads: File[];
  onUploadsChange: (next: File[]) => void;
  existingFileIds: number[];
  onExistingFileIdsChange: (ids: number[]) => void;
  // 옵션: 기존 문서(post) 도 같이 첨부 가능하게 — Q Talk 채팅 등에서 사용
  includePosts?: boolean;
  existingPostIds?: number[];
  onExistingPostIdsChange?: (ids: number[]) => void;
  accept?: string;
  uploadHint?: string;
  uploadAcceptHint?: string;
  searchPlaceholder?: string;
  /** @deprecated 통합 검색 — searchPlaceholder 만 사용 */
  searchPostsPlaceholder?: string;
  disabled?: boolean;
  // 호출부에서 파일 메타가 필요하면 받음 (선택). 안 주면 내부에서 fetch 한 결과로 표시.
  workspaceFiles?: ProjectFile[];
}

const AttachmentField: React.FC<Props> = ({
  businessId, uploads, onUploadsChange,
  existingFileIds, onExistingFileIdsChange,
  includePosts = false, existingPostIds = [], onExistingPostIdsChange,
  accept, uploadHint, uploadAcceptHint, searchPlaceholder, disabled,
  workspaceFiles: providedFiles,
}) => {
  // searchPostsPlaceholder is deprecated — 통합 검색에서는 searchPlaceholder 만 사용
  const { t } = useTranslation('common');
  const [internalFiles, setInternalFiles] = useState<ProjectFile[]>([]);
  const [posts, setPosts] = useState<PostRow[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const wsFiles = providedFiles ?? internalFiles;

  useEffect(() => {
    if (providedFiles) return; // 외부 제공이면 fetch 생략
    let cancelled = false;
    fetchWorkspaceFiles(businessId)
      .then(fs => { if (!cancelled) setInternalFiles(fs.filter(f => f.source === 'direct')); })
      .catch(() => { /* skip */ });
    return () => { cancelled = true; };
  }, [businessId, providedFiles]);

  useEffect(() => {
    if (!includePosts) return;
    let cancelled = false;
    fetchPosts(businessId, {})
      .then(ps => { if (!cancelled) setPosts(ps); })
      .catch(() => { /* skip */ });
    return () => { cancelled = true; };
  }, [businessId, includePosts]);

  const fileOptions: PlanQSelectOption[] = useMemo(() =>
    wsFiles.map(f => ({
      value: String(f.id).replace('direct-', ''),
      label: `${f.file_name} (${formatBytes(f.file_size)})`,
    })),
    [wsFiles]
  );

  const valueOptions = useMemo(() =>
    existingFileIds.map(id => {
      const f = wsFiles.find(x => Number(String(x.id).replace('direct-', '')) === id);
      return { value: String(id), label: f ? `${f.file_name} (${formatBytes(f.file_size)})` : `#${id}` };
    }),
    [existingFileIds, wsFiles]
  );

  const addUploads = useCallback((fs: FileList | File[]) => {
    const arr = Array.from(fs);
    if (arr.length === 0) return;
    onUploadsChange([...uploads, ...arr]);
  }, [uploads, onUploadsChange]);

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault(); setDragOver(false);
    if (disabled) return;
    if (e.dataTransfer.files) addUploads(e.dataTransfer.files);
  };
  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault(); if (!disabled) setDragOver(true);
  };
  const onDragLeave = () => setDragOver(false);
  const onFileInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addUploads(e.target.files);
    e.target.value = '';
  };
  const removeUpload = (idx: number) =>
    onUploadsChange(uploads.filter((_, i) => i !== idx));

  return (
    <Wrap>
      <UploadDrop
        $dragOver={dragOver}
        onClick={() => !disabled && inputRef.current?.click()}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
      >
        <UploadIcon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="17 8 12 3 7 8"/>
          <line x1="12" y1="3" x2="12" y2="15"/>
        </UploadIcon>
        <UploadText>{uploadHint || (t('attach.uploadHint', '파일을 드래그하거나 클릭') as string)}</UploadText>
        <UploadSub>{uploadAcceptHint || (t('attach.uploadAccept', '여러 파일 한번에 가능') as string)}</UploadSub>
        <input
          ref={inputRef}
          type="file"
          hidden
          multiple
          accept={accept}
          onChange={onFileInputChange}
          disabled={disabled}
        />
      </UploadDrop>

      {uploads.length > 0 && (
        <ChipList>
          {uploads.map((f, i) => (
            <UploadChipItem key={i} file={f} onRemove={() => removeUpload(i)} disabled={disabled} />
          ))}
        </ChipList>
      )}

      <FieldGap />

      {/* 통합 검색 — 파일 + (옵션) 문서 한 셀렉트 안에서 같이 검색·선택. 옵션에 [파일]/[문서] 타입 chip 표시. */}
      <PlanQSelect
        size="sm" isSearchable isMulti
        placeholder={searchPlaceholder || (
          includePosts
            ? (t('attach.searchUnifiedPlaceholder', '기존 파일·문서 검색해서 추가...') as string)
            : (t('attach.searchPlaceholder', '기존 파일 검색해서 추가...') as string)
        )}
        value={[
          ...valueOptions.map(o => ({ value: `f:${o.value}`, label: o.label })),
          ...(includePosts ? existingPostIds.map(id => {
            const p = posts.find(x => x.id === id);
            return { value: `p:${id}`, label: p?.title || `#${id}` };
          }) : []),
        ]}
        onChange={(opts) => {
          const fileIds: number[] = [];
          const postIds: number[] = [];
          if (Array.isArray(opts)) {
            for (const o of opts) {
              const v = String((o as PlanQSelectOption).value);
              if (v.startsWith('f:')) {
                const n = Number(v.slice(2));
                if (n) fileIds.push(n);
              } else if (v.startsWith('p:')) {
                const n = Number(v.slice(2));
                if (n) postIds.push(n);
              }
            }
          }
          onExistingFileIdsChange(fileIds);
          if (includePosts && onExistingPostIdsChange) onExistingPostIdsChange(postIds);
        }}
        options={[
          ...fileOptions.map(o => ({ value: `f:${o.value}`, label: `[${t('attach.typeFile', '파일')}] ${o.label}` })),
          ...(includePosts ? posts.map(p => ({
            value: `p:${p.id}`,
            label: `[${t('attach.typePost', '문서')}] ${p.title}`,
          })) : []),
        ]}
        isDisabled={disabled}
        filterOption={(option, raw) => {
          const q = (raw || '').trim().toLowerCase();
          if (!q) return true;   // 빈 검색이면 전체 옵션 표시 (사용자가 무엇이 있는지 볼 수 있도록)
          return String(option.label).toLowerCase().includes(q);
        }}
        noOptionsMessage={() => (t('attach.noResults', '결과 없음') as string)}
      />
    </Wrap>
  );
};

// N+63 — 이미지 미리보기. 사용자 호소 "요청 추가 시 이미지 첨부 시 미리보기가 표시되지 않고 파일 아이콘으로만 노출".
// 이미지 mime 만 createObjectURL → thumbnail, 비이미지는 기존 아이콘.
// blob URL leak 방지 — unmount 시 revoke.
const UploadChipItem: React.FC<{ file: File; onRemove: () => void; disabled?: boolean }> = ({ file, onRemove, disabled }) => {
  const previewUrl = useMemo(() => {
    if (file.type && file.type.startsWith('image/')) {
      try { return URL.createObjectURL(file); } catch { return null; }
    }
    return null;
  }, [file]);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);
  return (
    <Chip>
      {previewUrl ? (
        <ChipThumb src={previewUrl} alt={file.name} />
      ) : (
        <ChipFileIcon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </ChipFileIcon>
      )}
      <ChipText>{file.name}</ChipText>
      <ChipMeta>{formatBytes(file.size)}</ChipMeta>
      <ChipX type="button" onClick={onRemove} disabled={disabled}>×</ChipX>
    </Chip>
  );
};

export default AttachmentField;

// ─── styled (KnowledgePage 새 지식 등록 폼과 동일) ───
const Wrap = styled.div`display: flex; flex-direction: column; gap: 0;`;
const UploadDrop = styled.div<{ $dragOver?: boolean }>`
  border: 2px dashed ${p => p.$dragOver ? '#14B8A6' : '#CBD5E1'};
  background: ${p => p.$dragOver ? '#F0FDFA' : '#F8FAFC'};
  border-radius: 12px; padding: 28px 16px;
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  cursor: pointer; transition: all 0.15s; text-align: center;
  &:hover { border-color: #14B8A6; background: #F0FDFA; }
`;
const UploadIcon = styled.svg`width: 36px; height: 36px; color: #94A3B8;`;
const UploadText = styled.div`font-size: 13px; font-weight: 600; color: #334155;`;
const UploadSub = styled.div`font-size: 11px; color: #94A3B8;`;
const ChipList = styled.div`
  display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px;
`;
const Chip = styled.span`
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 8px 4px 10px;
  background: #F1F5F9; border: 1px solid #E2E8F0; border-radius: 6px;
  font-size: 12px;
`;
// N+63 — 이미지 첨부 시 thumbnail (40x40, 모서리 둥글게)
const ChipThumb = styled.img`
  width: 40px; height: 40px; object-fit: cover;
  border-radius: 6px; margin: -2px 2px -2px -4px;
  background: #F1F5F9;
`;
const ChipFileIcon = styled.svg`
  width: 14px; height: 14px; color: #64748B; flex-shrink: 0;
`;
const ChipText = styled.span`color: #0F172A; max-width: 180px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`;
const ChipMeta = styled.span`color: #94A3B8; font-size: 10px;`;
const ChipX = styled.button`
  all: unset; cursor: pointer;
  width: 18px; height: 18px; display: inline-flex; align-items: center; justify-content: center;
  color: #94A3B8; border-radius: 4px; font-size: 14px;
  &:hover { background: #FEE2E2; color: #DC2626; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
const FieldGap = styled.div`height: 12px;`;
