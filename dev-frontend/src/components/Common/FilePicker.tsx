// 공용 파일 선택 모달 — "업로드" 탭 + "기존 파일" 탭 2종
// 호출부가 onPick 으로 선택 결과를 받아 자체 API 호출.
//   - uploaded: 로컬 File 배열 (멀티 업로드)
//   - existing: 워크스페이스에 이미 있는 파일 id 배열 (참조 링크)
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import DetailDrawer from './DetailDrawer';
import SearchBox from './SearchBox';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { useEscapeStack } from '../../hooks/useEscapeStack';
import { fetchWorkspaceFiles, formatBytes, type ProjectFile } from '../../services/files';

export interface FilePickerResult {
  uploaded?: File[];
  existingFileIds?: number[];
}

interface Props {
  open: boolean;
  onClose: () => void;
  businessId: number;
  onPick: (result: FilePickerResult) => Promise<void> | void;
  title?: string;
  accept?: string;                 // <input accept="...">
  multiple?: boolean;              // default true
  mode?: 'both' | 'upload' | 'existing';  // default 'both'
  variant?: 'drawer' | 'modal';    // default 'drawer' — 편집 폼 내부엔 'modal' 권장
}

type Tab = 'upload' | 'existing';

const FilePicker: React.FC<Props> = ({
  open, onClose, businessId, onPick, title, accept, multiple = true, mode = 'both', variant = 'drawer',
}) => {
  const { t } = useTranslation('common');
  const [tab, setTab] = useState<Tab>(mode === 'existing' ? 'existing' : 'upload');
  const [uploads, setUploads] = useState<File[]>([]);
  const [existing, setExisting] = useState<ProjectFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setUploads([]);
      setPicked(new Set());
      setQuery('');
      setTab(mode === 'existing' ? 'existing' : 'upload');
    }
  }, [open, mode]);

  useEffect(() => {
    if (!open || tab !== 'existing') return;
    setLoading(true);
    fetchWorkspaceFiles(businessId)
      .then(fs => setExisting(fs.filter(f => f.source === 'direct')))
      .finally(() => setLoading(false));
  }, [open, tab, businessId]);

  const filteredExisting = useMemo(() => {
    if (!query.trim()) return existing;
    const q = query.toLowerCase();
    return existing.filter(f => f.file_name.toLowerCase().includes(q));
  }, [existing, query]);

  const togglePick = (fileId: number) => {
    setPicked(prev => {
      const next = new Set(prev);
      if (next.has(fileId)) next.delete(fileId);
      else {
        if (!multiple) next.clear();
        next.add(fileId);
      }
      return next;
    });
  };

  const addUploads = useCallback((fs: FileList | File[]) => {
    const arr = Array.from(fs);
    if (arr.length === 0) return;
    setUploads(prev => (multiple ? [...prev, ...arr] : arr.slice(0, 1)));
  }, [multiple]);

  const removeUpload = (i: number) => setUploads(prev => prev.filter((_, idx) => idx !== i));

  const canSubmit = tab === 'upload' ? uploads.length > 0 : picked.size > 0;

  const onSubmit = async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    try {
      if (tab === 'upload') await onPick({ uploaded: uploads });
      else await onPick({ existingFileIds: Array.from(picked) });
      onClose();
    } finally { setSubmitting(false); }
  };

  const headerNode = <Title>{title || t('filepicker.title', '파일 선택')}</Title>;
  const tabsNode = mode === 'both' && (
    <TabBar>
      <TabBtn type="button" $active={tab === 'upload'} onClick={() => setTab('upload')}>
        {t('filepicker.tab.upload', '업로드')}
      </TabBtn>
      <TabBtn type="button" $active={tab === 'existing'} onClick={() => setTab('existing')}>
        {t('filepicker.tab.existing', '기존 파일')}
      </TabBtn>
    </TabBar>
  );
  const bodyNode = tab === 'upload' ? (
    <UploadPane
      uploads={uploads}
      dragOver={dragOver}
      onDragOver={e => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={e => {
        e.preventDefault(); setDragOver(false);
        if (e.dataTransfer?.files) addUploads(e.dataTransfer.files);
      }}
      onPickLocal={() => inputRef.current?.click()}
      onRemove={removeUpload}
      accept={accept}
      multiple={multiple}
      inputRef={inputRef}
      onInputChange={e => e.target.files && addUploads(e.target.files)}
    />
  ) : (
    <ExistingPane
      files={filteredExisting}
      loading={loading}
      query={query}
      onQueryChange={setQuery}
      picked={picked}
      onToggle={togglePick}
      multiple={multiple}
    />
  );
  const footerNode = (
    <>
      <Spacer />
      <SecondaryBtn type="button" disabled={submitting} onClick={onClose}>{t('cancel', '취소') as string}</SecondaryBtn>
      <PrimaryBtn type="button" disabled={!canSubmit || submitting} onClick={onSubmit}>
        {submitting ? t('saving', '처리 중…') as string
          : tab === 'upload' ? t('filepicker.upload', `업로드 ({{n}})`, { n: uploads.length }) as string
          : t('filepicker.attach', `첨부 ({{n}})`, { n: picked.size }) as string}
      </PrimaryBtn>
    </>
  );

  if (variant === 'modal') {
    return (
      <ModalShell
        open={open}
        onClose={onClose}
        title={title || (t('filepicker.title', '파일 선택') as string)}
        headerExtra={tabsNode}
        body={bodyNode}
        footer={footerNode}
      />
    );
  }

  return (
    <DetailDrawer open={open} onClose={onClose} width={520} ariaLabel={title || t('filepicker.title', '파일 선택') as string}>
      <DetailDrawer.Header onClose={onClose}>
        {headerNode}
      </DetailDrawer.Header>
      {tabsNode}
      <DetailDrawer.Body>{bodyNode}</DetailDrawer.Body>
      <DetailDrawer.Footer>{footerNode}</DetailDrawer.Footer>
    </DetailDrawer>
  );
};

// 센터 모달 껍데기 — 편집 폼 안에서 호출할 때 사용
const ModalShell: React.FC<{
  open: boolean; onClose: () => void;
  title: string;
  headerExtra?: React.ReactNode;
  body: React.ReactNode;
  footer: React.ReactNode;
}> = ({ open, onClose, title, headerExtra, body, footer }) => {
  useBodyScrollLock(open);
  useEscapeStack(open, onClose);
  if (!open) return null;
  return (
    <ModalBackdrop onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <ModalBox role="dialog" aria-modal="true" aria-label={title} onMouseDown={e => e.stopPropagation()}>
        <ModalHeader>
          <ModalTitle>{title}</ModalTitle>
          <ModalClose type="button" onClick={onClose} aria-label="닫기">×</ModalClose>
        </ModalHeader>
        {headerExtra}
        <ModalBody>{body}</ModalBody>
        <ModalFooter>{footer}</ModalFooter>
      </ModalBox>
    </ModalBackdrop>
  );
};

export default FilePicker;

// ─── Upload Pane ───
const UploadPane: React.FC<{
  uploads: File[]; dragOver: boolean; multiple: boolean; accept?: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  onPickLocal: () => void;
  onRemove: (i: number) => void;
  onInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}> = ({ uploads, dragOver, multiple, accept, inputRef, onDragOver, onDragLeave, onDrop, onPickLocal, onRemove, onInputChange }) => {
  const { t } = useTranslation('common');
  return (
    <PaneWrap>
      <Drop $over={dragOver} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop} onClick={onPickLocal} role="button" tabIndex={0}>
        <DropIcon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="17 8 12 3 7 8"/>
          <line x1="12" y1="3" x2="12" y2="15"/>
        </DropIcon>
        <DropText>{t('filepicker.dropHint', '파일을 여기로 드래그하거나 클릭하여 선택')}</DropText>
        <DropSub>{t('filepicker.dropSub', '여러 파일 동시 선택 가능 · 최대 50MB / 건')}</DropSub>
        <input ref={inputRef} type="file" multiple={multiple} accept={accept} hidden onChange={onInputChange} />
      </Drop>
      {uploads.length > 0 && (
        <FileList>
          {uploads.map((f, i) => (
            <UploadRow key={i}>
              <Name>{f.name}</Name>
              <Size>{formatBytes(f.size)}</Size>
              <RemoveBtn type="button" onClick={() => onRemove(i)} title="제거" aria-label="제거">×</RemoveBtn>
            </UploadRow>
          ))}
        </FileList>
      )}
    </PaneWrap>
  );
};

// ─── Existing Pane ───
const ExistingPane: React.FC<{
  files: ProjectFile[]; loading: boolean; query: string; multiple: boolean;
  onQueryChange: (q: string) => void;
  picked: Set<number>;
  onToggle: (fileId: number) => void;
}> = ({ files, loading, query, multiple, onQueryChange, picked, onToggle }) => {
  const { t } = useTranslation('common');
  return (
    <PaneWrap>
      <SearchBox value={query} onChange={onQueryChange} placeholder={t('filepicker.searchPlaceholder', '파일명 검색') as string} />
      {loading ? (
        <Hint>{t('loading', '로딩 중…')}</Hint>
      ) : files.length === 0 ? (
        <Hint>{t('filepicker.existingEmpty', '워크스페이스에 아직 업로드된 파일이 없습니다')}</Hint>
      ) : (
        <FileList>
          {files.map(f => {
            const fileId = Number(f.id.replace(/^direct-/, ''));
            if (!fileId) return null;
            const isPicked = picked.has(fileId);
            return (
              <ExistRow key={f.id} $active={isPicked} onClick={() => onToggle(fileId)} role="option" aria-selected={isPicked}>
                <CheckMark $active={isPicked} $multiple={multiple} aria-hidden>
                  {isPicked && (
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </CheckMark>
                <Name title={f.file_name}>{f.file_name}</Name>
                {f.project_context && <ProjectTag $color={f.project_context.color || '#14B8A6'}>{f.project_context.name}</ProjectTag>}
                <Size>{formatBytes(f.file_size)}</Size>
              </ExistRow>
            );
          })}
        </FileList>
      )}
    </PaneWrap>
  );
};

// ─── styled ───
const Title = styled.div`font-size: 15px; font-weight: 700; color: #0F172A;`;
const TabBar = styled.div`
  display: flex; gap: 4px; padding: 8px 16px 0; border-bottom: 1px solid #EEF2F6; background: #fff;
`;
const TabBtn = styled.button<{ $active: boolean }>`
  all: unset; cursor: pointer; padding: 8px 14px;
  font-size: 13px; font-weight: 600; color: ${p => p.$active ? '#0F766E' : '#64748B'};
  border-bottom: 2px solid ${p => p.$active ? '#14B8A6' : 'transparent'};
  margin-bottom: -1px;
  &:hover { color: ${p => p.$active ? '#0F766E' : '#0F172A'}; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 2px; border-radius: 4px; }
`;
const PaneWrap = styled.div`display: flex; flex-direction: column; gap: 12px; padding: 16px 20px;`;
const Drop = styled.div<{ $over: boolean }>`
  border: 2px dashed ${p => p.$over ? '#14B8A6' : '#CBD5E1'};
  background: ${p => p.$over ? '#F0FDFA' : '#F8FAFC'};
  border-radius: 12px; padding: 32px 16px;
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  cursor: pointer; transition: all 0.15s; text-align: center;
  &:hover { border-color: #14B8A6; background: #F0FDFA; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 2px; }
`;
const DropIcon = styled.svg`width: 40px; height: 40px; color: #94A3B8;`;
const DropText = styled.div`font-size: 13px; font-weight: 600; color: #334155;`;
const DropSub = styled.div`font-size: 11px; color: #94A3B8;`;
const FileList = styled.div`display: flex; flex-direction: column; gap: 6px; max-height: 360px; overflow-y: auto;`;
const UploadRow = styled.div`
  display: flex; align-items: center; gap: 10px; padding: 10px 12px;
  background: #fff; border: 1px solid #E2E8F0; border-radius: 8px;
`;
const ExistRow = styled.button<{ $active: boolean }>`
  all: unset; cursor: pointer;
  display: flex; align-items: center; gap: 10px; padding: 10px 12px;
  background: ${p => p.$active ? '#F0FDFA' : '#fff'};
  border: 1px solid ${p => p.$active ? '#14B8A6' : '#E2E8F0'};
  border-radius: 8px; transition: all 0.15s;
  &:hover { border-color: ${p => p.$active ? '#14B8A6' : '#CBD5E1'}; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 2px; }
`;
const CheckMark = styled.div<{ $active: boolean; $multiple: boolean }>`
  width: 18px; height: 18px; border-radius: ${p => p.$multiple ? '4px' : '50%'};
  border: 1.5px solid ${p => p.$active ? '#14B8A6' : '#CBD5E1'};
  background: ${p => p.$active ? '#14B8A6' : '#fff'};
  color: #fff;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  transition: all 0.15s;
`;
const Name = styled.div`flex: 1; min-width: 0; font-size: 13px; color: #0F172A; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`;
const Size = styled.div`font-size: 11px; color: #94A3B8; flex-shrink: 0;`;
const ProjectTag = styled.span<{ $color: string }>`
  display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px;
  background: #F1F5F9; color: #475569; border-radius: 999px;
  font-size: 10px; font-weight: 600;
  flex-shrink: 0; max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  &::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: ${p => p.$color}; }
`;
const RemoveBtn = styled.button`
  all: unset; cursor: pointer;
  width: 22px; height: 22px; display: flex; align-items: center; justify-content: center;
  color: #94A3B8; border-radius: 4px; font-size: 16px;
  &:hover { background: #FEE2E2; color: #DC2626; }
`;
const Hint = styled.div`font-size: 12px; color: #94A3B8; text-align: center; padding: 24px 0;`;
const Spacer = styled.div`flex: 1;`;
const PrimaryBtn = styled.button`
  height: 34px; padding: 0 16px; background: #14B8A6; color: #fff; border: none; border-radius: 8px;
  font-size: 13px; font-weight: 600; cursor: pointer;
  &:hover:not(:disabled) { background: #0D9488; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
  &:focus-visible { outline: 2px solid #0D9488; outline-offset: 2px; }
`;
const SecondaryBtn = styled.button`
  height: 34px; padding: 0 14px; background: #fff; color: #0F172A;
  border: 1px solid #CBD5E1; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer;
  &:hover:not(:disabled) { background: #F8FAFC; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;

// ─── Center Modal 전용 스타일 ───
const ModalBackdrop = styled.div`
  position: fixed; inset: 0; z-index: 100;
  background: rgba(15, 23, 42, 0.35);
  display: flex; align-items: center; justify-content: center; padding: 20px;
  animation: fadeIn 0.15s ease-out;
  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
`;
const ModalBox = styled.div`
  background: #fff; border-radius: 14px; width: 100%; max-width: 560px;
  box-shadow: 0 20px 50px rgba(15, 23, 42, 0.22);
  display: flex; flex-direction: column; overflow: hidden;
  max-height: calc(100vh - 40px);
  animation: popIn 0.15s ease-out;
  @keyframes popIn { from { transform: translateY(8px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
`;
const ModalHeader = styled.div`
  padding: 14px 20px; border-bottom: 1px solid #EEF2F6;
  display: flex; align-items: center; gap: 12px;
`;
const ModalTitle = styled.div`flex: 1; font-size: 15px; font-weight: 700; color: #0F172A;`;
const ModalClose = styled.button`
  all: unset; cursor: pointer;
  width: 28px; height: 28px; display: flex; align-items: center; justify-content: center;
  color: #94A3B8; border-radius: 6px; font-size: 20px;
  &:hover { background: #F1F5F9; color: #0F172A; }
`;
const ModalBody = styled.div`
  flex: 1; min-height: 0; overflow-y: auto;
`;
const ModalFooter = styled.div`
  padding: 12px 20px; border-top: 1px solid #EEF2F6;
  display: flex; gap: 8px; align-items: center;
`;
