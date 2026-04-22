// Task 첨부파일 UI — 드래그앤드롭 + 업로드 + 리스트 + 다운로드 + 삭제 + 기존 파일 선택
import { useCallback, useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { apiFetch, useAuth } from '../../contexts/AuthContext';
import ConfirmDialog from '../Common/ConfirmDialog';
import FilePicker, { type FilePickerResult } from '../Common/FilePicker';

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
  created_at: string;
};

type Props = {
  taskId: number;
  onChangeCount?: (n: number) => void;
};

export default function TaskAttachments({ taskId, onChangeCount }: Props) {
  const { user } = useAuth();
  const businessId = user?.business_id || 0;
  const [rows, setRows] = useState<AttachRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AttachRow | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
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
          setError(j?.message || 'upload_failed');
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

  const fmtSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    setPendingDelete(null);
    const r = await apiFetch(`/api/tasks/attachments/${id}`, { method: 'DELETE' });
    const j = await r.json();
    if (j.success) setRows(prev => prev.filter(x => x.id !== id));
  };

  const download = async (row: AttachRow) => {
    // 브라우저에서 그냥 링크 열기 — 서버가 Content-Disposition 으로 다운로드 강제
    try {
      const r = await apiFetch(row.download_url);
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = row.original_name;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch { /* silent */ }
  };

  return (
    <Wrap>
      <Head>
        <Title>첨부파일 {visibleRows.length > 0 && <Count>({visibleRows.length})</Count>}</Title>
        <AddBtn type="button" onClick={() => setPickerOpen(true)} disabled={uploading}>
          + 파일 추가
        </AddBtn>
        <input ref={inputRef} type="file" multiple hidden
          onChange={e => e.target.files && upload(e.target.files)} />
      </Head>
      <Drop
        $over={dragOver}
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        {loading ? <Dim>로드 중...</Dim> :
          visibleRows.length === 0 ? <Dim>여기로 파일을 드래그하거나 [+ 파일 추가] 클릭</Dim> : (
            <List>
              {visibleRows.map(r => {
                const isImg = r.mime_type?.startsWith('image/');
                return (
                  <Row key={r.id}>
                    {isImg && r.preview_url ? (
                      <PreviewImg src={r.preview_url} alt={r.original_name} onClick={() => download(r)} />
                    ) : (
                      <FileIcon>{extIcon(r.original_name)}</FileIcon>
                    )}
                    <Meta onClick={() => download(r)}>
                      <Name>{r.original_name}</Name>
                      <Sub>{fmtSize(r.file_size)} · {r.uploader?.name || '-'} · {new Date(r.created_at).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })}</Sub>
                    </Meta>
                    <DelBtn type="button" onClick={() => setPendingDelete(r)} title="삭제">×</DelBtn>
                  </Row>
                );
              })}
            </List>
          )}
        {uploading && <Uploading>업로드 중...</Uploading>}
        {error && <Err>{error}</Err>}
      </Drop>
      <ConfirmDialog
        isOpen={!!pendingDelete}
        onClose={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
        title="파일 삭제"
        message={`"${pendingDelete?.original_name}" 파일을 삭제할까요?`}
        confirmText="삭제"
        cancelText="취소"
        variant="danger"
      />
      <FilePicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        businessId={businessId}
        onPick={async (r: FilePickerResult) => {
          if (r.uploaded && r.uploaded.length > 0) {
            await upload(r.uploaded);
          }
          if (r.existingFileIds && r.existingFileIds.length > 0) {
            setUploading(true);
            try {
              const res = await apiFetch(`/api/tasks/${taskId}/attachments/link`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ file_ids: r.existingFileIds, context: 'task' })
              });
              const j = await res.json();
              if (!j.success) setError(j?.message || 'link_failed');
              load();
            } finally { setUploading(false); }
          }
        }}
      />
    </Wrap>
  );
}

function extIcon(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  if (['pdf'].includes(ext)) return 'PDF';
  if (['doc', 'docx'].includes(ext)) return 'DOC';
  if (['xls', 'xlsx', 'csv'].includes(ext)) return 'XLS';
  if (['ppt', 'pptx'].includes(ext)) return 'PPT';
  if (['zip'].includes(ext)) return 'ZIP';
  if (['txt', 'md'].includes(ext)) return 'TXT';
  return (ext || 'FILE').slice(0, 3).toUpperCase();
}

const Wrap = styled.div`padding:14px 20px;border-bottom:1px solid #F1F5F9;`;
const Head = styled.div`display:flex;align-items:center;gap:8px;margin-bottom:8px;`;
const Title = styled.div`font-size:12px;font-weight:700;color:#64748B;flex:1;`;
const Count = styled.span`color:#0F766E;font-weight:600;`;
const AddBtn = styled.button`padding:4px 10px;font-size:11px;font-weight:600;color:#0F766E;background:#F0FDFA;border:1px solid #99F6E4;border-radius:6px;cursor:pointer;&:hover:not(:disabled){background:#CCFBF1;}&:disabled{opacity:0.5;cursor:not-allowed;}`;
const Drop = styled.div<{$over:boolean}>`
  border:1px dashed ${p => p.$over ? '#14B8A6' : '#E2E8F0'};
  background:${p => p.$over ? '#F0FDFA' : '#FAFBFC'};
  border-radius:8px;padding:10px;min-height:64px;
  transition:background 0.15s, border-color 0.15s;
`;
const Dim = styled.div`font-size:12px;color:#94A3B8;text-align:center;padding:14px 0;`;
const List = styled.div`display:flex;flex-direction:column;gap:6px;`;
const Row = styled.div`display:flex;align-items:center;gap:10px;padding:6px 8px;background:#FFF;border:1px solid #E2E8F0;border-radius:6px;`;
const PreviewImg = styled.img`width:36px;height:36px;object-fit:cover;border-radius:4px;flex-shrink:0;cursor:pointer;`;
const FileIcon = styled.div`width:36px;height:36px;flex-shrink:0;display:flex;align-items:center;justify-content:center;background:#F1F5F9;color:#475569;font-size:10px;font-weight:700;border-radius:4px;`;
const Meta = styled.div`flex:1;min-width:0;cursor:pointer;`;
const Name = styled.div`font-size:13px;color:#0F172A;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`;
const Sub = styled.div`font-size:11px;color:#94A3B8;`;
const DelBtn = styled.button`width:24px;height:24px;display:flex;align-items:center;justify-content:center;background:transparent;border:none;color:#94A3B8;cursor:pointer;border-radius:4px;font-size:16px;&:hover{background:#FEE2E2;color:#DC2626;}`;
const Uploading = styled.div`margin-top:6px;font-size:11px;color:#0D9488;`;
const Err = styled.div`margin-top:6px;font-size:11px;color:#DC2626;`;
