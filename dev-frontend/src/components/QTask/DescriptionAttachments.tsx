// DescriptionAttachments — 업무 설명(의뢰자 영역) 댓글식 첨부
//
// 위치: TaskDetailDrawer description 섹션 안 RichEditor 아래.
// 패턴: 댓글 첨부와 완전 동일 — AttachmentField (업로드 + 기존 파일/문서 연결).
// "+ 첨부" 버튼 클릭 → inline 패널 펼침 (popup-on-popup 금지) → "추가" 버튼으로 일괄 업로드/링크.
// context='description_attach'. 결과물 영역 첨부와 완전 분리.
// 권한: description 편집 권한 (작성자/owner/admin) — 사이클 N+5 책임선 일치.

import AttachmentList from '../Common/AttachmentList';
import React, { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import { apiFetch } from '../../contexts/AuthContext';
import AttachmentField from '../Common/AttachmentField';
import { uploadErrorText } from '../../utils/uploadError';

/** 서버가 내는 '권한 없음' 코드 — 옛 이름도 같이 받는다(2026-09-07 개명). */
const NOT_PERMITTED = new Set(['only_creator_can_attach_description', 'only_creator_or_owner_can_attach_description']);

interface AttachmentRow {
  id: number;
  context: string;
  original_name: string;
  file_size: number;
  mime_type: string | null;
  uploader: { id: number; name: string } | null;
  download_url: string;
  preview_url: string | null;
  /** 문서(post) 첨부면 그 문서 id — 파일이 아니라 Q docs 로 열어야 한다 */
  post_id?: number | null;
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
    if (uploads.length === 0 && existingFileIds.length === 0 && existingPostIds.length === 0) return;
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
          // 서버 코드가 바뀌어도 문구가 사라지지 않게 **둘 다** 받는다.
          //   2026-09-07: owner 예외를 걷으면서 'only_creator_or_owner_…' → 'only_creator_…' 로 바뀌었다.
          //   코드 문자열이 갈리면 사용자는 이유 대신 "업로드 실패" 만 본다.
          if (NOT_PERMITTED.has(code)) setErrMsg(t('descAttach.error.notPermitted', { defaultValue: '의뢰 명세 첨부는 작성자만 할 수 있습니다' }) as string);
          else if (code === 'disallowed_extension') setErrMsg(t('descAttach.error.disallowedExt', { defaultValue: '허용되지 않는 파일 형식' }) as string);
          else if (code === 'file_too_large') setErrMsg(t('descAttach.error.tooLarge', { defaultValue: '파일이 너무 큽니다' }) as string);
          else setErrMsg(uploadErrorText(code, t));   // 모르는 코드도 이유를 말한다
          setSubmitting(false);
          return;
        }
      }
      // 2) 기존 워크스페이스 파일 link
      if (existingFileIds.length > 0 || existingPostIds.length > 0) {
        const lr = await apiFetch(`/api/tasks/${taskId}/attachments/link`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ file_ids: existingFileIds, post_ids: existingPostIds, context: 'description_attach' }),
        });
        if (!lr.ok) {  // upload 분기와 동일하게 link 실패도 표면화 + picker 유지(거짓 첨부 방지)
          const lj = await lr.json().catch(() => null);
          setErrMsg(NOT_PERMITTED.has(lj?.message)
            ? (t('descAttach.error.notPermitted', { defaultValue: '의뢰 명세 첨부는 작성자만 할 수 있습니다' }) as string)
            : (t('descAttach.error.failed', { defaultValue: '첨부 실패' }) as string));
          setSubmitting(false);
          return;
        }
      }

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

  if (loading) return null;
  if (list.length === 0 && !canEdit) return null;

  return (
    <Wrap>
      {/* 여는 동작·내려받기·전체 다운로드는 공용 AttachmentList — 결과물·댓글과 같은 규칙(2026-10-02) */}
      {list.length > 0 && (
        <AttachmentList layout="chips" businessId={businessId || 0} testId="task-desc-attachments"
          items={list.map((a) => ({
            id: a.id, name: a.original_name, size: a.file_size, mime: a.mime_type,
            previewUrl: a.preview_url, downloadUrl: a.download_url, postId: a.post_id ?? null,
            zipId: a.post_id ? null : `task-${a.id}`,
            canRemove: canEdit || a.uploader?.id === myId,
          }))}
          onRemove={(it) => remove(it.id)} />
      )}

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
                  /* 운영 (Irene): 문서만 골랐을 때 이 버튼이 영영 비활성이었다 —
                     existingPostIds 를 안 봤기 때문. 세 가지 중 **하나라도** 있으면 켠다. */
                  disabled={submitting || (uploads.length === 0 && existingFileIds.length === 0 && existingPostIds.length === 0)}>
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
const ActionRow = styled.div`display:flex;align-items:center;gap:8px;`;
const AttachBtn = styled.button`
  display:inline-flex;align-items:center;gap:4px;
  padding:6px 12px;background:transparent;color:#475569;
  border:1px dashed #CBD5E1;border-radius:8px;
  font-size:0.75rem;font-weight:500;cursor:pointer;font-family:inherit;
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
  font-size:0.75rem; font-weight:500; cursor:pointer; font-family:inherit;
  &:hover{background:#F1F5F9;}
`;
const PickerSubmit = styled.button`
  padding:6px 14px; background:#14B8A6; color:#FFFFFF;
  border:none; border-radius:6px;
  font-size:0.75rem; font-weight:600; cursor:pointer; font-family:inherit;
  &:hover:not(:disabled){background:#0D9488;}
  &:disabled{background:#CBD5E1;cursor:not-allowed;}
`;
const ErrLine = styled.div`margin-top:6px; font-size:0.6875rem; color:#DC2626;`;
