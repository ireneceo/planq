// Task 첨부파일 UI — 드래그앤드롭 + 업로드 + 리스트 + 다운로드 + 삭제 + 기존 파일/문서 선택 (모두 인라인)
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import { apiFetch, useAuth } from '../../contexts/AuthContext';
import ConfirmDialog from '../Common/ConfirmDialog';
import AttachmentField from '../Common/AttachmentField';
import AttachmentList, { type AttachmentListItem } from '../Common/AttachmentList';
import { uploadErrorText } from '../../utils/uploadError';
import { formatDayTime } from '../../utils/dateFormat';

type AttachRow = {
  id: number;
  context: 'description' | 'task' | 'comment';
  comment_id: number | null;
  original_name: string;
  file_size: number;
  mime_type: string | null;
  uploader: { id: number; name: string } | null;
  download_url: string;
  preview_url: string | null;
  /** 문서(post) 첨부면 그 문서 id — 파일이 아니라 Q docs 로 열어야 한다 */
  post_id?: number | null;
  created_at: string;
};

type Props = {
  taskId: number;
  /** 이 업무의 워크스페이스 — 드로어가 받은 값. 없으면 현재 워크스페이스 */
  businessId?: number | null;
  onChangeCount?: (n: number) => void;
};

export default function TaskAttachments({ taskId, businessId: bizProp, onChangeCount }: Props) {
  const { t } = useTranslation('common');
  const { user } = useAuth();
  // ★ 2026-09-11 — 드로어가 연 업무의 워크스페이스를 쓴다. 여태 현재 워크스페이스로 고정해
  //   다른 워크스페이스 업무를 열면 첨부 미리보기·Drive 편집이 404 였다(감사 ② 어긋남).
  const businessId = Number(bizProp || user?.business_id || 0);
  const [rows, setRows] = useState<AttachRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AttachRow | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  // 인라인 picker 의 임시 staging — 픽 후 즉시 link 또는 upload, 닫음.
  const [stageUploads, setStageUploads] = useState<File[]>([]);
  const [stageExistingFileIds, setStageExistingFileIds] = useState<number[]>([]);
  const [stageExistingPostIds, setStageExistingPostIds] = useState<number[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await apiFetch(`/api/tasks/${taskId}/attachments`);
      const j = await r.json();
      if (j.success) setRows(j.data || []);
    } finally { setLoading(false); }
  }, [taskId]);

  useEffect(() => { load(); }, [load]);

  // 업로드 대상은 description(인라인 이미지)을 제외한 task/comment 첨부만 표시
  // description 이미지는 에디터 안에 인라인으로만 나타남
  const visibleRows = rows.filter(r => r.context !== 'description');

  // 여는 동작(이미지 보기 · 문서 · 파일 미리보기) · 내려받기 · 전체 다운로드는 공용 AttachmentList 가 맡는다.
  const listItems: AttachmentListItem[] = visibleRows.map((r) => ({
    id: r.id, name: r.original_name, size: r.file_size, mime: r.mime_type,
    previewUrl: r.preview_url, downloadUrl: r.download_url, postId: r.post_id ?? null,
    zipId: r.post_id ? null : `task-${r.id}`,
    sub: `${r.post_id ? (t('attachments.docKind', { defaultValue: 'Q docs 문서' }) as string) : fmtSize(r.file_size)} · ${r.uploader?.name || '-'}${!pickerOpen ? ` · ${formatDayTime(r.created_at, { year: 'always' })}` : ''}`,
  }));
  useEffect(() => { onChangeCount?.(visibleRows.length); }, [visibleRows.length, onChangeCount]);

  const upload = useCallback(async (files: FileList | File[]) => {
    if (!files || (files as FileList).length === 0) return;
    setUploading(true);
    setError(null);
    const list = Array.from(files as FileList);
    for (const f of list) {
      const fd = new FormData();
      fd.append('file', f, f.name);
      try {
        const r = await apiFetch(`/api/tasks/${taskId}/attachments?context=task`, { method: 'POST', body: fd });
        const j = await r.json();
        if (!r.ok || !j.success) {
          // 코드를 그대로 보여 주면 사용자는 이유를 모른다 — 공용 문장 변환을 거친다(2026-09-14)
          setError(uploadErrorText(j?.message, t));
        }
      } catch (e) {
        setError((e as Error).message);
      }
    }
    setUploading(false);
    load();
  }, [taskId, load]);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = e.dataTransfer?.files;
    if (files) upload(files);
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    setPendingDelete(null);
    const r = await apiFetch(`/api/tasks/attachments/${id}`, { method: 'DELETE' });
    const j = await r.json();
    if (j.success) setRows(prev => prev.filter(x => x.id !== id));
  };

  return (
    <Wrap>
      <Head>
        <Title>{t('attachments.title')} {visibleRows.length > 0 && <Count>({visibleRows.length})</Count>}</Title>
        {/* "+ 파일 추가" 토글 — 인라인 폼의 "+ 파일·문서 첨부" 와 동일 패턴 (열고 닫기). */}
        <AddBtn type="button" onClick={() => setPickerOpen(v => !v)} disabled={uploading} $active={pickerOpen}>
          {pickerOpen ? '× ' : '+ '}{t('attachments.add')}
        </AddBtn>
        <input ref={inputRef} type="file" multiple hidden
          onChange={e => e.target.files && upload(e.target.files)} />
      </Head>
      {/* 파일 리스트 — 표시할 게 있을 때만 렌더 (빈 영역 공백 제거).
          loading / 파일 있음 / "첨부된 파일 없음" (picker 닫힌 상태만) / 업로드중 / 에러 */}
      {(loading || visibleRows.length > 0 || (visibleRows.length === 0 && !pickerOpen) || uploading || error) && (
        <ListArea
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          $over={dragOver}
        >
          {loading && <Dim>{t('attachments.loading')}</Dim>}
          {!loading && visibleRows.length === 0 && !pickerOpen && <Dim>{t('attachments.empty', '첨부된 파일 없음')}</Dim>}
          {!loading && visibleRows.length > 0 && (
            <AttachmentList items={listItems} businessId={businessId} layout="rows" testId="task-attachments"
              onRemove={(it) => { const row = visibleRows.find((x) => x.id === it.id); if (row) setPendingDelete(row); }} />
          )}
          {uploading && <Uploading>{t('attachments.uploading')}</Uploading>}
          {error && <Err>{error}</Err>}
        </ListArea>
      )}
      <ConfirmDialog
        isOpen={!!pendingDelete}
        onClose={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
        title={t('attachments.deleteConfirmTitle')}
        message={t('attachments.deleteConfirmMsg', { name: pendingDelete?.original_name || '' })}
        confirmText={t('attachments.delete')}
        cancelText={t('attachments.cancel')}
        variant="danger"
      />
      {pickerOpen && (
        <PickerInline>
          {/* 인라인 추가 폼과 동일 — 별도 submit/cancel 버튼 없음.
              파일 픽 / 기존 파일·문서 선택 즉시 자동 처리 (업로드 또는 link). */}
          <AttachmentField
            businessId={businessId}
            uploads={stageUploads}
            onUploadsChange={(files) => {
              // 새 파일 추가 시 즉시 업로드 + 스테이지 비우기
              setStageUploads(files);
              if (files.length > 0) {
                upload(files);
                setStageUploads([]);
              }
            }}
            existingFileIds={stageExistingFileIds}
            onExistingFileIdsChange={async (ids) => {
              const newIds = ids.filter((id) => !stageExistingFileIds.includes(id));
              setStageExistingFileIds(ids);
              if (newIds.length > 0) {
                setUploading(true);
                try {
                  const res = await apiFetch(`/api/tasks/${taskId}/attachments/link`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ file_ids: newIds, context: 'task' })
                  });
                  const j = await res.json();
                  if (!j.success) setError(j?.message || 'link_failed');
                  await load();
                } finally {
                  setUploading(false);
                  setStageExistingFileIds([]);
                }
              }
            }}
            includePosts
            existingPostIds={stageExistingPostIds}
            onExistingPostIdsChange={async (ids) => {
              // ★ 여태 고른 문서를 **서버로 보내지 않았다** — 첨부했다고 믿는데 조용히 사라졌다
              //   (Irene 2026-08-31). 파일과 같은 link 경로를 쓴다.
              const newIds = ids.filter((id) => !stageExistingPostIds.includes(id));
              setStageExistingPostIds(ids);
              if (newIds.length === 0) return;
              setUploading(true);
              try {
                const res = await apiFetch(`/api/tasks/${taskId}/attachments/link`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ post_ids: newIds, context: 'task' }),
                });
                const j = await res.json();
                if (!res.ok || !j.success) setError(j?.message || 'link_failed');
                await load();
              } finally {
                setUploading(false);
                setStageExistingPostIds([]);
              }
            }}
          />
        </PickerInline>
      )}
    </Wrap>
  );
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const Wrap = styled.div`padding:14px 20px;border-bottom:1px solid #F1F5F9;`;
const Head = styled.div`display:flex;align-items:center;gap:8px;`;
const Title = styled.div`font-size:0.75rem;font-weight:700;color:#64748B;flex:1;`;
const Count = styled.span`color:#0F766E;font-weight:600;`;
const AddBtn = styled.button<{ $active?: boolean }>`padding:4px 10px;font-size:0.6875rem;font-weight:600;color:${p=>p.$active?'#FFF':'#0F766E'};background:${p=>p.$active?'#14B8A6':'#F0FDFA'};border:1px solid ${p=>p.$active?'#0D9488':'#99F6E4'};border-radius:6px;cursor:pointer;&:hover:not(:disabled){background:${p=>p.$active?'#0D9488':'#CCFBF1'};}&:disabled{opacity:0.5;cursor:not-allowed;}`;
const ListArea = styled.div<{$over:boolean}>`border:1px ${p=>p.$over?'solid':'dashed'} ${p=>p.$over?'#14B8A6':'transparent'};border-radius:8px;background:${p=>p.$over?'#F0FDFA':'transparent'};transition:all 0.15s;`;
// 인라인 picker — 모달 대신 같은 영역에 펼쳐짐 (Irene: popup-on-popup 금지).
const PickerInline = styled.div`margin-top:8px;background:#FAFBFC;border:1px solid #E2E8F0;border-radius:10px;padding:12px;`;
const Dim = styled.div`font-size:0.75rem;color:#94A3B8;text-align:center;padding:14px 0;`;
const Uploading = styled.div`margin-top:6px;font-size:0.6875rem;color:#0D9488;`;
const Err = styled.div`margin-top:6px;font-size:0.6875rem;color:#DC2626;`;
