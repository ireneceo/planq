// #215 — 받은/보낸 메일의 첨부 칩 목록 (미리보기 · 내려받기).
//
// 설계: docs/QMAIL_ATTACHMENT_DESIGN_215.md §2-2, §4-1
//
// ★ 전달 방식은 **인증 blob → objectURL** 이다. 무인증 capability URL(task 첨부의
//   `/api/tasks/public/attach/:storedName` 선례)을 복제하지 않는다 — 대상이 세금계산서·부가세 납부서·
//   매입매출장이라 "추측 불가한 URL" 만으로는 부족하다(로그·브라우저 히스토리·프록시에 남고 만료가 없다).
//   기존 download 라우트가 이미 authenticateToken + attachWorkspaceScope + canAccessFileByLevel 을
//   통과시키므로, 신규 엔드포인트 0 으로 검증된 게이트를 그대로 탄다.
//
// 미리보기 대상 화이트리스트: image/*(라이트박스) + application/pdf(브라우저 내장 뷰어). 그 외는 내려받기.
//   SVG 는 <img> 컨텍스트로만 렌더된다 — iframe/object 는 스크립트 실행 표면이라 금지.
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../contexts/AuthContext';
import { downloadBlob } from '../../utils/download';
import { useImageLightbox } from '../../components/Common/ImageLightbox';
import { Attachments, Attachment, AttachmentGroup, AttachDownloadBtn, AttachErr, ClipIcon } from './MailPage.styles';

export interface MailAttachment {
  id: number;
  file_id: number | null;
  file_name: string;
  file_size: number;
  mime_type: string;
}

interface Props {
  businessId: number;
  attachments: MailAttachment[];
}

const PREVIEW_MAX_BYTES = 15 * 1024 * 1024;   // 이 이상은 미리보기 대신 내려받기

const isPreviewable = (a: MailAttachment): boolean => {
  const mime = String(a.mime_type || '').toLowerCase();
  return !!a.file_id
    && (mime.startsWith('image/') || mime === 'application/pdf')
    && (a.file_size || 0) <= PREVIEW_MAX_BYTES;
};

const MessageAttachments: React.FC<Props> = ({ businessId, attachments }) => {
  const { t } = useTranslation('qmail');
  const objUrlsRef = useRef<Map<number, string>>(new Map());
  const [attachErr, setAttachErr] = useState<Record<number, boolean>>({});
  const { open: openLightbox, lightbox } = useImageLightbox();

  const flagAttachErr = useCallback((attId: number) => {
    setAttachErr(prev => ({ ...prev, [attId]: true }));
    window.setTimeout(() => setAttachErr(prev => { const n = { ...prev }; delete n[attId]; return n; }), 4000);
  }, []);

  // file_id → objectURL (탭 수명 내 캐시). 실패 시 null.
  const fetchObjectUrl = useCallback(async (fileId: number): Promise<string | null> => {
    const cached = objUrlsRef.current.get(fileId);
    if (cached) return cached;
    const r = await apiFetch(`/api/files/${businessId}/${fileId}/download`);
    if (!r.ok) return null;              // apiFetch 는 throw 하지 않는다 — res.ok 를 반드시 본다
    const url = URL.createObjectURL(await r.blob());
    objUrlsRef.current.set(fileId, url);
    return url;
  }, [businessId]);

  // 언마운트(스레드·메시지 전환 포함) 시 objectURL 전량 해제 — 누수 차단
  useEffect(() => {
    const map = objUrlsRef.current;
    return () => { map.forEach(u => URL.revokeObjectURL(u)); map.clear(); };
  }, []);

  const download = useCallback(async (a: MailAttachment) => {
    if (!a.file_id) return;
    try {
      const r = await apiFetch(`/api/files/${businessId}/${a.file_id}/download`);
      if (!r.ok) throw new Error('download_failed');
      await downloadBlob(await r.blob(), a.file_name || 'attachment');
    } catch {
      // 여태 조용히 삼켜서, 실패해도 사용자는 아무 일도 안 일어난 화면만 봤다.
      flagAttachErr(a.id);
    }
  }, [businessId, flagAttachErr]);

  // 칩 본체 클릭 — 이미지는 라이트박스, PDF 는 새 탭, 그 외는 내려받기.
  const preview = useCallback(async (a: MailAttachment) => {
    if (!a.file_id) return;
    if (!isPreviewable(a)) { await download(a); return; }   // 큰 파일은 fetch 전에 차단
    const mime = String(a.mime_type || '').toLowerCase();
    try {
      if (mime.startsWith('image/')) {
        // 같은 메시지의 이미지 첨부를 모아 갤러리로 — 좌우 이동이 자연스럽다.
        const imgs = attachments.filter(x => isPreviewable(x) && String(x.mime_type || '').toLowerCase().startsWith('image/'));
        const urls = await Promise.all(imgs.map(x => fetchObjectUrl(x.file_id as number)));
        const ok = imgs.map((x, i) => ({ x, src: urls[i] })).filter(p => !!p.src);
        if (!ok.length) { flagAttachErr(a.id); return; }
        const idx = Math.max(0, ok.findIndex(p => p.x.id === a.id));
        openLightbox(ok.map(p => ({ src: p.src as string, alt: p.x.file_name })), idx);
        return;
      }
      // PDF — 브라우저 내장 뷰어(별도 origin sandbox). 팝업 차단 시 내려받기로 폴백.
      const url = await fetchObjectUrl(a.file_id);
      if (!url) { flagAttachErr(a.id); return; }
      const w = window.open(url, '_blank', 'noopener');
      if (!w) await download(a);
    } catch {
      flagAttachErr(a.id);
    }
  }, [attachments, download, fetchObjectUrl, flagAttachErr, openLightbox]);

  if (!attachments.length) return null;

  return (
    <>
      <Attachments>
        {attachments.map(a => {
          const canPreview = isPreviewable(a);
          return (
            <AttachmentGroup key={a.id}>
              <Attachment
                as="button"
                type="button"
                data-testid="mail-attach-chip"
                onClick={() => (canPreview ? preview(a) : download(a))}
                disabled={!a.file_id}
                title={!a.file_id ? undefined : (canPreview
                  ? (t('attachment.preview', { defaultValue: '미리보기' }) as string)
                  : (t('attachment.download', { defaultValue: '내려받기' }) as string))}
              >
                <ClipIcon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></ClipIcon>
                {a.file_name || (t('attachment.fallback', { defaultValue: '첨부파일' }) as string)}
                {a.file_size ? ` (${Math.round(a.file_size / 1024)} KB)` : ''}
              </Attachment>
              {canPreview && (
                <AttachDownloadBtn
                  type="button"
                  data-testid="mail-attach-download"
                  onClick={() => download(a)}
                  title={t('attachment.download', { defaultValue: '내려받기' }) as string}
                  aria-label={`${a.file_name} ${t('attachment.download', { defaultValue: '내려받기' })}`}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                </AttachDownloadBtn>
              )}
              {attachErr[a.id] && (
                <AttachErr role="status">{t('attachment.downloadFailed', { defaultValue: '내려받지 못했어요' }) as string}</AttachErr>
              )}
            </AttachmentGroup>
          );
        })}
      </Attachments>
      {/* 공통 ImageLightbox — Esc·백드롭·swipe-down 닫기, zoom/pan 내장 */}
      {lightbox}
    </>
  );
};

export default MessageAttachments;
