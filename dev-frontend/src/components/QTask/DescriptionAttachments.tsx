// DescriptionAttachments — 업무 설명(의뢰자 영역) 댓글식 첨부
//
// 위치: TaskDetailDrawer description 섹션 안 RichEditor 아래.
// 패턴: 댓글 첨부와 완전 동일 — AttachmentField (업로드 + 기존 파일/문서 연결).
// "+ 첨부" 버튼 클릭 → inline 패널 펼침 (popup-on-popup 금지) → "추가" 버튼으로 일괄 업로드/링크.
// context='description_attach'. 결과물 영역 첨부와 완전 분리.
// 권한: description 편집 권한 (작성자/owner/admin) — 사이클 N+5 책임선 일치.

import React, { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import { apiFetch } from '../../contexts/AuthContext';
import AttachmentField from '../Common/AttachmentField';
import { useImageLightbox } from '../Common/ImageLightbox';

interface AttachmentRow {
  id: number;
  context: string;
  original_name: string;
  file_size: number;
  mime_type: string | null;
  uploader: { id: number; name: string } | null;
  download_url: string;
  preview_url: string | null;
  created_at: string;
}

interface Props {
  taskId: number;
  businessId: number | null;
  canEdit: boolean;
  myId: number;
}

const DescriptionAttachments: React.FC<Props> = ({ taskId, businessId, canEdit, myId }) => {
  const { t } = useTranslation('qtask');
  const [list, setList] = useState<AttachmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [uploads, setUploads] = useState<File[]>([]);
  const [existingFileIds, setExistingFileIds] = useState<number[]>([]);
  const [existingPostIds, setExistingPostIds] = useState<number[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const { open: openImageLightbox, lightbox: imageLightbox } = useImageLightbox();

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const r = await apiFetch(`/api/tasks/${taskId}/attachments?context=description_attach`);
      if (r.ok) {
        const j = await r.json();
        if (j.success) setList(j.data || []);
      }
    } finally { setLoading(false); }
  }, [taskId]);

  useEffect(() => { fetchList(); }, [fetchList]);

  const submit = async () => {
    if (submitting) return;
    if (uploads.length === 0 && existingFileIds.length === 0) return;
    setSubmitting(true); setErrMsg(null);
    try {
      // 1) 새 파일 업로드 — context=description_attach
      for (const f of uploads) {
        const fd = new FormData();
        fd.append('file', f, f.name);
        const ur = await apiFetch(`/api/tasks/${taskId}/attachments?context=description_attach`, {
          method: 'POST', body: fd,
        });
        if (!ur.ok) {
          const uj = await ur.json().catch(() => null);
          const code = uj?.message || 'upload_failed';
          if (code === 'only_creator_or_owner_can_attach_description') setErrMsg(t('descAttach.error.notPermitted', { defaultValue: '의뢰자 영역 첨부 권한이 없습니다' }) as string);
          else if (code === 'disallowed_extension') setErrMsg(t('descAttach.error.disallowedExt', { defaultValue: '허용되지 않는 파일 형식' }) as string);
          else if (code === 'file_too_large') setErrMsg(t('descAttach.error.tooLarge', { defaultValue: '파일이 너무 큽니다' }) as string);
          else setErrMsg(t('descAttach.error.failed', { defaultValue: '업로드 실패' }) as string);
          setSubmitting(false);
          return;
        }
      }
      // 2) 기존 워크스페이스 파일 link
      if (existingFileIds.length > 0) {
        await apiFetch(`/api/tasks/${taskId}/attachments/link`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ file_ids: existingFileIds, context: 'description_attach' }),
        });
      }
      // (참고) post 연결은 backend link 라우트가 아직 file_ids 만 받음 — 현재 댓글 패턴과 동일 한계.
      // 향후 backend 보강 시 자동 작동하도록 existingPostIds state 만 유지.

      // 성공 — 패널 닫고 비우기 + list 갱신
      setUploads([]); setExistingFileIds([]); setExistingPostIds([]);
      setPickerOpen(false);
      await fetchList();
    } finally { setSubmitting(false); }
  };

  const remove = async (id: number) => {
    try {
      const r = await apiFetch(`/api/tasks/attachments/${id}`, { method: 'DELETE' });
      if (r.ok) fetchList();
    } catch { /* silent */ }
  };

  const downloadFile = async (att: AttachmentRow) => {
    try {
      const r = await apiFetch(att.download_url);
      if (!r.ok) return;
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = att.original_name;
      document.body.appendChild(link); link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { /* silent */ }
  };

  if (loading) return null;
  if (list.length === 0 && !canEdit) return null;

  return (
    <Wrap>
      {list.length > 0 && (() => {
        // 이미지 첨부만 모아 갤러리 라이트박스
        const imgList = list.filter(a => a.mime_type?.startsWith('image/') && a.preview_url);
        const lbItems = imgList.map(a => ({ src: a.preview_url as string, alt: a.original_name }));
        return (
        <ChipList>
          {list.map((a) => {
            const isImg = a.mime_type?.startsWith('image/');
            const ext = a.original_name.split('.').pop()?.slice(0, 4).toUpperCase() || 'FILE';
            const canRemove = canEdit || a.uploader?.id === myId;
            return isImg && a.preview_url ? (
              <ImgChip key={a.id} title={a.original_name}>
                <ImgBtn type="button" onClick={() => {
                  const idx = imgList.findIndex(x => x.id === a.id);
                  openImageLightbox(lbItems, idx < 0 ? 0 : idx);
                }} aria-label={a.original_name}>
                  <ImgPreview src={a.preview_url} alt={a.original_name} />
                </ImgBtn>
                {canRemove && <ImgRemove type="button" onClick={() => remove(a.id)}
                  title={t('descAttach.remove', { defaultValue: '삭제' }) as string}
                  aria-label={t('descAttach.remove', { defaultValue: '삭제' }) as string}>×</ImgRemove>}
              </ImgChip>
            ) : (
              <FileChip key={a.id}>
                <FileChipBody type="button" onClick={() => downloadFile(a)} title={a.original_name}>
                  <FileChipExt>{ext}</FileChipExt>
                  <FileChipName>{a.original_name}</FileChipName>
                </FileChipBody>
                {canRemove && <FileChipX type="button" onClick={() => remove(a.id)}
                  title={t('descAttach.remove', { defaultValue: '삭제' }) as string}
                  aria-label={t('descAttach.remove', { defaultValue: '삭제' }) as string}>×</FileChipX>}
              </FileChip>
            );
          })}
        </ChipList>
        );
      })()}
      {imageLightbox}

      {canEdit && (
        <>
          {/* picker — 댓글 패턴과 일관: inline 펼침 (popup-on-popup 금지) */}
          {pickerOpen && businessId && (
            <PickerWrap>
              <AttachmentField
                businessId={businessId}
                uploads={uploads} onUploadsChange={setUploads}
                existingFileIds={existingFileIds} onExistingFileIdsChange={setExistingFileIds}
                includePosts
                existingPostIds={existingPostIds} onExistingPostIdsChange={setExistingPostIds}
              />
              {errMsg && <ErrLine>{errMsg}</ErrLine>}
              <PickerActions>
                <PickerCancel type="button" onClick={() => {
                  setPickerOpen(false); setUploads([]); setExistingFileIds([]); setExistingPostIds([]); setErrMsg(null);
                }}>
                  {t('common.cancel', '취소')}
                </PickerCancel>
                <PickerSubmit type="button" onClick={submit}
                  disabled={submitting || (uploads.length === 0 && existingFileIds.length === 0)}>
                  {submitting
                    ? t('descAttach.uploading', { defaultValue: '업로드 중...' })
                    : t('descAttach.submit', { defaultValue: '추가' })}
                </PickerSubmit>
              </PickerActions>
            </PickerWrap>
          )}
          {!pickerOpen && (
            <ActionRow>
              <AttachBtn type="button" onClick={() => setPickerOpen(true)}
                title={t('descAttach.add', { defaultValue: '파일·문서 첨부' }) as string}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
                </svg>
                {t('descAttach.add', { defaultValue: '파일·문서 첨부' })}
              </AttachBtn>
            </ActionRow>
          )}
        </>
      )}
    </Wrap>
  );
};

export default DescriptionAttachments;

// ─── Styled ───
const Wrap = styled.div`margin-top:8px;`;
const ChipList = styled.div`display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px;`;
const FileChip = styled.div`display:inline-flex;align-items:center;gap:0;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:8px;overflow:hidden;`;
const FileChipBody = styled.button`
  display:inline-flex;align-items:center;gap:6px;padding:6px 8px;
  background:transparent;border:none;cursor:pointer;font-family:inherit;
  max-width:240px;
  &:hover{background:#F8FAFC;}
`;
const FileChipExt = styled.span`
  display:inline-flex;align-items:center;justify-content:center;
  min-width:34px;height:20px;padding:0 6px;border-radius:4px;
  background:#F1F5F9;color:#475569;font-size:10px;font-weight:700;letter-spacing:0.3px;flex-shrink:0;
`;
const FileChipName = styled.span`font-size:12px;color:#0F172A;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`;
const FileChipX = styled.button`
  display:inline-flex;align-items:center;justify-content:center;
  width:24px;height:32px;background:transparent;border:none;border-left:1px solid #E2E8F0;
  color:#94A3B8;font-size:14px;cursor:pointer;font-family:inherit;
  &:hover{background:#FEE2E2;color:#DC2626;}
`;
const ImgChip = styled.div`position:relative;display:inline-block;border-radius:8px;overflow:hidden;border:1px solid #E2E8F0;`;
const ImgBtn = styled.button`
  all: unset; display: block; cursor: zoom-in;
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 2px; }
`;
const ImgPreview = styled.img`display:block;width:64px;height:64px;object-fit:cover;`;
const ImgRemove = styled.button`
  position:absolute;top:2px;right:2px;
  width:20px;height:20px;border-radius:10px;
  background:rgba(0,0,0,0.5);color:#FFFFFF;border:none;cursor:pointer;
  font-size:14px;line-height:1;font-family:inherit;
  &:hover{background:rgba(220,38,38,0.85);}
`;
const ActionRow = styled.div`display:flex;align-items:center;gap:8px;`;
const AttachBtn = styled.button`
  display:inline-flex;align-items:center;gap:4px;
  padding:6px 12px;background:transparent;color:#475569;
  border:1px dashed #CBD5E1;border-radius:8px;
  font-size:12px;font-weight:500;cursor:pointer;font-family:inherit;
  transition:background 0.15s, border-color 0.15s, color 0.15s;
  &:hover{background:#F0FDFA;color:#0F766E;border-color:#14B8A6;border-style:solid;}
`;
const PickerWrap = styled.div`
  margin-top:6px; padding:10px;
  background:#F8FAFC; border:1px solid #E2E8F0; border-radius:8px;
`;
const PickerActions = styled.div`display:flex;justify-content:flex-end;gap:6px;margin-top:8px;`;
const PickerCancel = styled.button`
  padding:6px 12px; background:#FFFFFF; color:#64748B;
  border:1px solid #E2E8F0; border-radius:6px;
  font-size:12px; font-weight:500; cursor:pointer; font-family:inherit;
  &:hover{background:#F1F5F9;}
`;
const PickerSubmit = styled.button`
  padding:6px 14px; background:#14B8A6; color:#FFFFFF;
  border:none; border-radius:6px;
  font-size:12px; font-weight:600; cursor:pointer; font-family:inherit;
  &:hover:not(:disabled){background:#0D9488;}
  &:disabled{background:#CBD5E1;cursor:not-allowed;}
`;
const ErrLine = styled.div`margin-top:6px; font-size:11px; color:#DC2626;`;
