// 첨부 목록 — 업무 결과물·의뢰 명세·댓글이 **같은 동작**을 쓰는 한 벌 (2026-10-02).
//
// Irene: *"업무상세에 첨부된 첨부파일 리스트에서 이미지 누르면 이미지가 열리는데 리스트 누르면 우측 팝업이
//   또 뜨네. 같이 이미지 열려야지. 그리고 다운로드 링크가 리스트에 있어야지 없어. 전체 다운로드 버튼도
//   있어야 해. … 체계적으로 제대로 정리해서 모든 곳에 같이 적용해줘. 모든 경험이 그대로 이어지고 통일되게."*
//
// 여태 세 곳이 각자 그렸다 — 결과물은 행을 누르면 미리보기 패널, 의뢰 명세는 칩, 댓글은 파일을 누르면
// **곧바로 내려받았다.** 같은 «첨부» 인데 자리마다 누르면 다른 일이 일어났다. 이제 규칙은 여기 하나다:
//   · 이미지 = 썸네일을 누르든 이름을 누르든 **이미지 보기**(같은 목록 안 이미지끼리 넘겨 본다)
//   · 문서(Q docs) = 문서 미리보기
//   · 그 외 파일 = 파일 미리보기 패널(안에서 내려받기·새 탭)
//   · 모든 파일 행에 **내려받기** 버튼, 받을 것이 둘 이상이면 머리에 **전체 다운로드**(묶음 zip — 기존
//     `/api/files/:biz/bulk-download`, 새 API 없음)
// 이미지 보기·미리보기를 닫으면 **열려 있던 패널은 그대로** — 둘 다 공용 Esc 스택을 쓴다.
//
// 모양은 두 가지(`layout`) — 'rows'(결과물: 한 줄에 하나) / 'chips'(의뢰 명세·댓글: 촘촘히). 동작은 같다.
import React, { useMemo, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { apiFetch, useAuth } from '../../contexts/AuthContext';
import { downloadBlob } from '../../utils/download';
import { bulkDownloadZip } from '../../services/files';
import { useImageLightbox } from './ImageLightbox';
import AttachmentPreviewDrawer, { type PreviewAttachment } from './AttachmentPreviewDrawer';
import PostPreviewModal from '../Docs/PostPreviewModal';

export interface AttachmentListItem {
  id: number;
  name: string;
  size?: number | null;
  mime?: string | null;
  /** 이미지 미리보기 주소(있으면 이미지로 연다) */
  previewUrl?: string | null;
  /** 인증 다운로드 주소 — 없으면 내려받기 버튼을 그리지 않는다(문서 등) */
  downloadUrl?: string | null;
  /** Q docs 문서 첨부 */
  postId?: number | null;
  /** 묶음 다운로드 id ('task-45' · 'chat-12') */
  zipId?: string | null;
  fileId?: number | null;
  driveEditable?: boolean;
  /** 이름 아래 한 줄(크기·올린 사람·시각 등) — rows 에서만 */
  sub?: React.ReactNode;
  canRemove?: boolean;
}

interface Props {
  items: AttachmentListItem[];
  businessId: number;
  layout?: 'rows' | 'chips';
  onRemove?: (item: AttachmentListItem) => void;
  /** 머리줄(제목 등)을 호출부가 그릴 때 그 오른쪽에 붙일 수 있게 — 기본은 목록 위 한 줄 */
  hideDownloadAll?: boolean;
  testId?: string;
}

const isImage = (it: AttachmentListItem) => !!it.previewUrl && !!(it.mime || '').startsWith('image/');
const extOf = (name: string) => (name.split('.').pop() || 'FILE').slice(0, 4).toUpperCase();
const fmtSize = (n?: number | null) => {
  if (!n) return '';
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
};

/**
 * 「전체 다운로드 (N)」 한 벌 — 목록 모양이 다른 곳(채팅 말풍선·메일 메시지)도 **같은 버튼·같은 묶음**을 쓴다.
 * 묶음 id(`task-12` · `chat-34` · `direct-56`)를 받아 기존 `/bulk-download` 로 zip 한 번에 받는다.
 */
export function DownloadAllButton({ businessId, zipIds, testId }: { businessId: number; zipIds: string[]; testId?: string }) {
  const { t } = useTranslation('common');
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);
  // 고객은 그리지 않는다 — 묶음 라우트가 멤버 이상만 받는다(checkBusinessAccess). 그리면 늘 실패한다(Fable 2026-10-02).
  if (zipIds.length < 2 || user?.business_role === 'client') return null;
  const run = async () => {
    if (busy) return;
    setBusy(true); setErr(false);
    try { const r = await bulkDownloadZip(businessId, zipIds); if (!r.ok) setErr(true); }
    catch { setErr(true); }
    finally { setBusy(false); }
  };
  return (
    <AllRow>
      <AllBtn type="button" onClick={() => void run()} disabled={busy} data-testid={testId}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M12 3v12" /><polyline points="7 10 12 15 17 10" /><path d="M5 21h14" />
        </svg>
        {busy
          ? (t('attachList.downloadingAll', { defaultValue: '묶는 중…' }) as string)
          : (t('attachList.downloadAll', { defaultValue: '전체 다운로드 ({{n}})', n: zipIds.length }) as string)}
      </AllBtn>
      {err && <Err role="alert">{t('attachList.downloadFailed', { defaultValue: '내려받지 못했어요. 다시 시도해 주세요.' }) as string}</Err>}
    </AllRow>
  );
}

export default function AttachmentList({ items, businessId, layout = 'rows', onRemove, hideDownloadAll, testId }: Props) {
  const { t } = useTranslation('common');
  const { open: openLightbox, lightbox } = useImageLightbox();
  const [filePreview, setFilePreview] = useState<PreviewAttachment | null>(null);
  const [docPreview, setDocPreview] = useState<{ id: number; title: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const images = useMemo(() => items.filter(isImage), [items]);
  const downloadable = useMemo(() => items.filter((it) => !!it.downloadUrl && !it.postId), [items]);

  const download = async (it: { downloadUrl?: string | null; name: string }) => {
    if (!it.downloadUrl) return;
    setErr(null);
    try {
      const r = await apiFetch(it.downloadUrl);
      if (!r.ok) throw new Error(String(r.status));
      await downloadBlob(await r.blob(), it.name);
    } catch { setErr(t('attachList.downloadFailed', { defaultValue: '내려받지 못했어요. 다시 시도해 주세요.' }) as string); }
  };

  // 묶음 id 가 없는 첨부가 섞였을 때만 쓰는 대체 경로 — 하나씩 받는다(묶음이면 DownloadAllButton).
  const downloadAll = async () => {
    if (busy || downloadable.length === 0) return;
    setBusy(true); setErr(null);
    try { for (const it of downloadable) await download(it); }
    finally { setBusy(false); }
  };

  const open = (it: AttachmentListItem) => {
    if (it.postId) { setDocPreview({ id: it.postId, title: it.name }); return; }
    if (isImage(it)) {
      const idx = images.findIndex((x) => x.id === it.id);
      openLightbox(images.map((x) => ({ src: x.previewUrl as string, alt: x.name })), idx < 0 ? 0 : idx);
      return;
    }
    setFilePreview({
      id: it.id, original_name: it.name, file_size: it.size || 0, mime_type: it.mime || null,
      download_url: it.downloadUrl || '', preview_url: it.previewUrl || null,
      file_id: it.fileId ?? null, drive_editable: it.driveEditable,
    });
  };

  if (items.length === 0) return null;
  const dlLabel = t('attachList.download', { defaultValue: '내려받기' }) as string;
  const rmLabel = t('attachList.remove', { defaultValue: '삭제' }) as string;

  const DlIcon = (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3v12" /><polyline points="7 10 12 15 17 10" /><path d="M5 21h14" />
    </svg>
  );

  return (
    <Wrap data-testid={testId}>
      {!hideDownloadAll && downloadable.length > 1 && downloadable.every((it) => !!it.zipId) && (
        <DownloadAllButton businessId={businessId} zipIds={downloadable.map((it) => it.zipId as string)}
          testId={testId ? `${testId}-download-all` : undefined} />
      )}
      {!hideDownloadAll && downloadable.length > 1 && !downloadable.every((it) => !!it.zipId) && (
        <AllRow>
          <AllBtn type="button" onClick={() => void downloadAll()} disabled={busy} data-testid={testId ? `${testId}-download-all` : undefined}>
            {DlIcon}
            {busy
              ? (t('attachList.downloadingAll', { defaultValue: '묶는 중…' }) as string)
              : (t('attachList.downloadAll', { defaultValue: '전체 다운로드 ({{n}})', n: downloadable.length }) as string)}
          </AllBtn>
        </AllRow>
      )}
      {layout === 'rows' ? (
        <Rows>
          {items.map((it) => (
            <Row key={it.id} data-attach-row>
              <ThumbBtn type="button" onClick={() => open(it)} aria-label={it.name}>
                {isImage(it) ? <Thumb src={it.previewUrl as string} alt="" loading="lazy" />
                  : <Ext>{it.postId ? (t('attachList.doc', { defaultValue: '문서' }) as string) : extOf(it.name)}</Ext>}
              </ThumbBtn>
              <Meta type="button" onClick={() => open(it)} title={it.name}>
                <Name>{it.name}</Name>
                {(it.sub || it.size) && <Sub>{it.sub ?? fmtSize(it.size)}</Sub>}
              </Meta>
              {it.downloadUrl && !it.postId && (
                <IconBtn type="button" onClick={() => void download(it)} title={dlLabel} aria-label={`${dlLabel}: ${it.name}`} data-attach-download>{DlIcon}</IconBtn>
              )}
              {onRemove && it.canRemove !== false && (
                <IconBtn type="button" $danger onClick={() => onRemove(it)} title={rmLabel} aria-label={`${rmLabel}: ${it.name}`}>×</IconBtn>
              )}
            </Row>
          ))}
        </Rows>
      ) : (
        <Chips>
          {items.map((it) => isImage(it) ? (
            <ImgChip key={it.id} data-attach-row>
              <ImgBtn type="button" onClick={() => open(it)} aria-label={it.name} title={it.name}>
                <Thumb src={it.previewUrl as string} alt="" loading="lazy" />
              </ImgBtn>
              <ImgTools>
                {it.downloadUrl && (
                  <MiniBtn type="button" onClick={() => void download(it)} title={dlLabel} aria-label={`${dlLabel}: ${it.name}`} data-attach-download>{DlIcon}</MiniBtn>
                )}
                {onRemove && it.canRemove !== false && (
                  <MiniBtn type="button" onClick={() => onRemove(it)} title={rmLabel} aria-label={`${rmLabel}: ${it.name}`}>×</MiniBtn>
                )}
              </ImgTools>
            </ImgChip>
          ) : (
            <FileChip key={it.id} data-attach-row>
              <ChipBody type="button" onClick={() => open(it)} title={it.name}>
                <ChipExt>{it.postId ? (t('attachList.doc', { defaultValue: '문서' }) as string) : extOf(it.name)}</ChipExt>
                <ChipName>{it.name}</ChipName>
              </ChipBody>
              {it.downloadUrl && !it.postId && (
                <ChipIcon type="button" onClick={() => void download(it)} title={dlLabel} aria-label={`${dlLabel}: ${it.name}`} data-attach-download>{DlIcon}</ChipIcon>
              )}
              {onRemove && it.canRemove !== false && (
                <ChipIcon type="button" onClick={() => onRemove(it)} title={rmLabel} aria-label={`${rmLabel}: ${it.name}`}>×</ChipIcon>
              )}
            </FileChip>
          ))}
        </Chips>
      )}
      {err && <Err role="alert">{err}</Err>}
      {lightbox}
      {docPreview && <PostPreviewModal postId={docPreview.id} title={docPreview.title} onClose={() => setDocPreview(null)} />}
      <AttachmentPreviewDrawer
        attachment={filePreview}
        businessId={businessId}
        onClose={() => setFilePreview(null)}
        onDownload={(a) => void download({ downloadUrl: a.download_url, name: a.original_name })}
      />
    </Wrap>
  );
}

const Wrap = styled.div`display: flex; flex-direction: column; gap: 6px; min-width: 0;`;
const AllRow = styled.div`display: flex; justify-content: flex-end; align-items: center; gap: 8px;`;
const AllBtn = styled.button`
  display: inline-flex; align-items: center; gap: 6px;
  height: 32px; padding: 0 10px; border-radius: 8px; cursor: pointer; font-family: inherit;
  background: #fff; border: 1px solid #E2E8F0; color: #334155; font-size: 0.75rem; font-weight: 600;
  &:hover:not(:disabled) { border-color: #14B8A6; color: #0F766E; }
  &:disabled { opacity: 0.6; cursor: default; }
  svg { width: 14px; }
`;
const Rows = styled.div`display: flex; flex-direction: column; gap: 6px;`;
const Row = styled.div`
  display: flex; align-items: center; gap: 10px; min-width: 0;
  padding: 6px 8px; border: 1px solid #E2E8F0; border-radius: 8px; background: #fff;
  &:hover { border-color: #CBD5E1; }
`;
const ThumbBtn = styled.button`
  flex-shrink: 0; width: 40px; height: 40px; padding: 0; border: none; border-radius: 6px;
  background: #F1F5F9; overflow: hidden; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
`;
const Thumb = styled.img`width: 100%; height: 100%; object-fit: cover; display: block;`;
const Ext = styled.span`font-size: 0.625rem; font-weight: 700; color: #475569;`;
const Meta = styled.button`
  flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 1px;
  background: none; border: none; padding: 0; cursor: pointer; font-family: inherit; text-align: left;
`;
const Name = styled.span`
  max-width: 100%; font-size: 0.8125rem; font-weight: 600; color: #0F172A;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
`;
const Sub = styled.span`max-width: 100%; font-size: 0.6875rem; color: #94A3B8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`;
const IconBtn = styled.button<{ $danger?: boolean }>`
  flex-shrink: 0; width: 32px; height: 32px; border-radius: 6px; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  background: transparent; border: 1px solid transparent; color: #64748B; font-size: 1rem; font-family: inherit;
  &:hover { border-color: #E2E8F0; color: ${(p) => (p.$danger ? '#DC2626' : '#0F766E')}; background: #F8FAFC; }
  svg { width: 16px; }
  @media (max-width: 640px) { width: 40px; height: 40px; }
`;
const Chips = styled.div`display: flex; flex-wrap: wrap; gap: 6px;`;
const ImgChip = styled.div`
  position: relative; width: 72px; aspect-ratio: 1; border-radius: 8px; overflow: hidden;
  border: 1px solid #E2E8F0; background: #F8FAFC;
  &:hover > div, &:focus-within > div { opacity: 1; }
`;
const ImgBtn = styled.button`width: 100%; height: 100%; padding: 0; border: none; cursor: zoom-in; background: none;`;
const ImgTools = styled.div`
  position: absolute; top: 3px; right: 3px; display: flex; gap: 3px;
  opacity: 0; transition: opacity .12s;
  /* 터치 기기는 hover 가 없다 — 폭으로 갈라 늘 보인다(헤드리스가 hover:none 으로 뜨는 함정 회피) */
  @media (max-width: 1024px) { opacity: 1; }
`;
const MiniBtn = styled.button`
  padding: 5px; border-radius: 6px; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  background: rgba(15,23,42,0.6); border: none; color: #fff; font-size: 0.875rem; font-family: inherit;
  svg { width: 13px; }
`;
const FileChip = styled.div`
  display: inline-flex; align-items: center; max-width: 100%; min-width: 0;
  border: 1px solid #E2E8F0; border-radius: 8px; background: #fff;
  &:hover { border-color: #CBD5E1; }
`;
const ChipBody = styled.button`
  display: inline-flex; align-items: center; gap: 6px; min-width: 0;
  padding: 6px 4px 6px 8px; background: none; border: none; cursor: pointer; font-family: inherit;
`;
const ChipExt = styled.span`
  flex-shrink: 0; font-size: 0.625rem; font-weight: 700; color: #475569;
  padding: 1px 5px; border-radius: 4px; background: #F1F5F9;
`;
const ChipName = styled.span`
  min-width: 0; max-width: 220px; font-size: 0.75rem; font-weight: 600; color: #0F172A;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
`;
const ChipIcon = styled.button`
  flex-shrink: 0; width: 32px; height: 32px; padding: 0; border: none; background: none; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center; color: #64748B; font-size: 0.9375rem; font-family: inherit;
  &:hover { color: #0F766E; }
  svg { width: 14px; }
`;
const Err = styled.div`font-size: 0.75rem; color: #B91C1C;`;
