// 문서 편집 폼 안 인라인 첨부 추가 섹션
// - 위: 드롭존 (클릭/드래그 업로드)
// - 아래: 기존 파일 검색 + 리스트 (클릭 시 [+] 로 즉시 추가)
// 선택된 파일 표시는 호출부가 관리. 이 컴포넌트는 onPickFiles/onPickExisting 만 emit.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { fetchWorkspaceFiles, formatBytes, type ProjectFile } from '../../services/files';

interface Props {
  businessId: number;
  excludeIds?: number[];        // 이미 선택된 file_id 목록 — 리스트에서 비활성 표시
  onPickFiles: (files: File[]) => void;
  onPickExisting: (fileIds: number[]) => void;
  accept?: string;
  hide?: boolean;               // 접힘 상태
}

const InlineAttachPicker: React.FC<Props> = ({ businessId, excludeIds = [], onPickFiles, onPickExisting, accept, hide }) => {
  const { t } = useTranslation('qdocs');
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const excludeSet = useMemo(() => new Set(excludeIds), [excludeIds]);

  useEffect(() => {
    if (hide) return;
    setLoading(true);
    fetchWorkspaceFiles(businessId)
      .then(fs => setFiles(fs.filter(f => f.source === 'direct')))
      .finally(() => setLoading(false));
  }, [businessId, hide]);

  const filtered = useMemo(() => {
    if (!query.trim()) return files;
    const q = query.toLowerCase();
    return files.filter(f => f.file_name.toLowerCase().includes(q));
  }, [files, query]);

  if (hide) return null;

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    if (e.dataTransfer?.files?.length) onPickFiles(Array.from(e.dataTransfer.files));
  };
  const handlePick = (fileIdStr: string) => {
    const fid = Number(fileIdStr.replace(/^direct-/, ''));
    if (!fid || excludeSet.has(fid)) return;
    onPickExisting([fid]);
  };

  return (
    <Wrap>
      <Drop
        $over={dragOver}
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
      >
        <DropIcon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="17 8 12 3 7 8"/>
          <line x1="12" y1="3" x2="12" y2="15"/>
        </DropIcon>
        <DropText>{t('inlineAttach.dropHint', '파일을 드래그하거나 클릭해서 업로드') as string}</DropText>
        <DropSub>{t('inlineAttach.dropSub', '여러 파일 동시 선택 · 최대 50MB / 건') as string}</DropSub>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={accept}
          hidden
          onChange={e => {
            if (e.target.files?.length) onPickFiles(Array.from(e.target.files));
            e.target.value = '';
          }}
        />
      </Drop>

      <Divider>
        <DividerLine />
        <DividerText>{t('inlineAttach.existingSection', '기존 파일에서 선택') as string}</DividerText>
        <DividerLine />
      </Divider>

      <SearchRow>
        <SearchIcon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </SearchIcon>
        <SearchInput
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={t('inlineAttach.searchPlaceholder', '파일명 검색') as string}
        />
      </SearchRow>

      <FileList>
        {loading ? (
          <Dim>{t('inlineAttach.loading', '로딩 중…') as string}</Dim>
        ) : filtered.length === 0 ? (
          <Dim>{query ? t('inlineAttach.noResult', '검색 결과 없음') : t('inlineAttach.empty', '아직 워크스페이스에 파일이 없습니다')}</Dim>
        ) : (
          filtered.map(f => {
            const fid = Number(f.id.replace(/^direct-/, ''));
            const already = excludeSet.has(fid);
            return (
              <Row key={f.id} $disabled={already} onClick={() => !already && handlePick(f.id)} role="button" tabIndex={already ? -1 : 0}
                aria-disabled={already}>
                <Name title={f.file_name}>{f.file_name}</Name>
                {f.project_context && (
                  <Tag $color={f.project_context.color || '#14B8A6'}>{f.project_context.name}</Tag>
                )}
                <Size>{formatBytes(f.file_size)}</Size>
                {already
                  ? <AddedMark>{t('inlineAttach.added', '추가됨') as string}</AddedMark>
                  : <PlusBtn type="button" onClick={(e) => { e.stopPropagation(); handlePick(f.id); }} aria-label="추가">+</PlusBtn>}
              </Row>
            );
          })
        )}
      </FileList>
    </Wrap>
  );
};

export default InlineAttachPicker;

const Wrap = styled.div`
  background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 12px;
  padding: 14px; display: flex; flex-direction: column; gap: 12px;
`;
const Drop = styled.div<{ $over: boolean }>`
  border: 2px dashed ${p => p.$over ? '#14B8A6' : '#CBD5E1'};
  background: ${p => p.$over ? '#F0FDFA' : '#fff'};
  border-radius: 10px; padding: 20px 12px;
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  cursor: pointer; transition: all 0.15s; text-align: center;
  &:hover { border-color: #14B8A6; background: #F0FDFA; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 2px; }
`;
const DropIcon = styled.svg`width: 28px; height: 28px; color: #94A3B8;`;
const DropText = styled.div`font-size: 12px; font-weight: 600; color: #334155;`;
const DropSub = styled.div`font-size: 10px; color: #94A3B8;`;

const Divider = styled.div`display: flex; align-items: center; gap: 8px; padding: 0 4px;`;
const DividerLine = styled.div`flex: 1; height: 1px; background: #E2E8F0;`;
const DividerText = styled.div`font-size: 10px; font-weight: 700; color: #94A3B8; text-transform: uppercase; letter-spacing: 0.3px;`;

const SearchRow = styled.div`
  display: flex; align-items: center; gap: 6px;
  background: #fff; border: 1px solid #E2E8F0; border-radius: 8px; padding: 0 10px;
  height: 32px;
  &:focus-within { border-color: #14B8A6; box-shadow: 0 0 0 2px rgba(20,184,166,0.15); }
`;
const SearchIcon = styled.svg`width: 14px; height: 14px; color: #94A3B8; flex-shrink: 0;`;
const SearchInput = styled.input`
  flex: 1; border: none; background: transparent; outline: none;
  font-size: 12px; color: #0F172A;
  &::placeholder { color: #94A3B8; }
`;

const FileList = styled.div`
  display: flex; flex-direction: column; gap: 4px;
  max-height: 280px; overflow-y: auto; background: #fff;
  border: 1px solid #E2E8F0; border-radius: 8px; padding: 4px;
`;
const Row = styled.div<{ $disabled: boolean }>`
  display: flex; align-items: center; gap: 8px; padding: 8px 10px;
  border-radius: 6px; cursor: ${p => p.$disabled ? 'not-allowed' : 'pointer'};
  opacity: ${p => p.$disabled ? 0.5 : 1};
  &:hover { background: ${p => p.$disabled ? 'transparent' : '#F0FDFA'}; }
`;
const Name = styled.div`flex: 1; min-width: 0; font-size: 12px; color: #0F172A; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`;
const Tag = styled.span<{ $color: string }>`
  display: inline-flex; align-items: center; gap: 4px; padding: 1px 7px;
  background: #F1F5F9; color: #475569; border-radius: 999px;
  font-size: 10px; font-weight: 600; flex-shrink: 0; max-width: 100px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  &::before { content: ''; width: 5px; height: 5px; border-radius: 50%; background: ${p => p.$color}; }
`;
const Size = styled.div`font-size: 10px; color: #94A3B8; flex-shrink: 0;`;
const PlusBtn = styled.button`
  all: unset; cursor: pointer; width: 22px; height: 22px;
  display: flex; align-items: center; justify-content: center;
  color: #0F766E; background: #F0FDFA; border: 1px solid #99F6E4; border-radius: 6px;
  font-size: 14px; font-weight: 700; flex-shrink: 0;
  &:hover { background: #CCFBF1; color: #0D9488; }
`;
const AddedMark = styled.div`
  padding: 2px 8px; font-size: 10px; font-weight: 600; color: #94A3B8;
  background: #F1F5F9; border-radius: 999px; flex-shrink: 0;
`;
const Dim = styled.div`padding: 14px 4px; text-align: center; color: #94A3B8; font-size: 11px;`;
