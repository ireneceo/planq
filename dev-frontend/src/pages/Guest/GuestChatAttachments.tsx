// 게스트 채팅 첨부 — 말풍선 안 그림·파일 칩 · 보내기 전 고른 파일 칩 (docs/GUEST_UPLOAD_DESIGN.md §4)
//   그림은 **토큰 아래 미리보기**(`/api/guest/:token/attachments/:id/preview?w=`)로만 본다 — 영구 공개 주소를 쓰지 않는다.
//   파일(PDF 등) 내려받기는 지금처럼 로그인이 필요하다 — 누르면 로그인 안내(부모가 줄 때) 또는 이유 한 줄.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import ImageLightbox from '../../components/Common/ImageLightbox';

export type GuestAttachment = { id: number; file_name: string; file_size: number; kind: 'image' | 'file'; has_preview: boolean };
export type GuestUploadInfo = { enabled: boolean; max_bytes: number; max_files: number; accept: string[] };

export const fmtSize = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`);

/** 보내기 전 화면 검사 — 서버와 같은 값(ctx.upload)으로. 틀리면 이유 키를 돌려준다. */
export function checkPicked(picked: File[], already: number, info: GuestUploadInfo): string | null {
  if (already + picked.length > info.max_files) return 'too_many_files';
  for (const f of picked) {
    const ext = `.${(f.name.split('.').pop() || '').toLowerCase()}`;
    if (!info.accept.includes(ext)) return 'invalid_file';
    if (f.size > info.max_bytes) return 'file_too_large';
  }
  return null;
}

export function MessageAttachments({ token, items, mine, onNeedLogin }: {
  token: string; items: GuestAttachment[]; mine: boolean; onNeedLogin?: () => void;
}) {
  const { t } = useTranslation('guest');
  const [viewing, setViewing] = useState<GuestAttachment | null>(null);
  if (!items.length) return null;
  const base = (a: GuestAttachment) => `/api/guest/${token}/attachments/${a.id}/preview`;
  return (
    <List>
      {items.map((a) => (a.kind === 'image' && a.has_preview ? (
        <ThumbBtn key={a.id} type="button" data-testid={`guest-att-thumb-${a.id}`} onClick={() => setViewing(a)}
          aria-label={t('att.view', { defaultValue: '크게 보기' }) as string}>
          <img src={`${base(a)}?w=400`} alt={a.file_name} loading="lazy" />
        </ThumbBtn>
      ) : (
        <FileChip key={a.id} type="button" $mine={mine} data-testid={`guest-att-file-${a.id}`}
          onClick={onNeedLogin} disabled={!onNeedLogin}
          title={t('att.loginToDownload', { defaultValue: '파일을 받으려면 계정이 필요해요' }) as string}>
          <ClipIcon />
          <ChipName>{a.file_name}</ChipName>
          <ChipSize>{fmtSize(a.file_size)}</ChipSize>
        </FileChip>
      )))}
      {viewing && (
        <ImageLightbox src={`${base(viewing)}?w=1600`} alt={viewing.file_name} onClose={() => setViewing(null)} />
      )}
    </List>
  );
}

export function PickedChips({ files, onRemove }: { files: File[]; onRemove: (i: number) => void }) {
  const { t } = useTranslation('guest');
  if (!files.length) return null;
  return (
    <Picked data-testid="guest-picked">
      {files.map((f, i) => (
        <PickedChip key={`${f.name}-${i}`}>
          <ClipIcon />
          <ChipName>{f.name}</ChipName>
          <ChipSize>{fmtSize(f.size)}</ChipSize>
          <RemoveBtn type="button" onClick={() => onRemove(i)} aria-label={t('att.remove', { defaultValue: '빼기' }) as string}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </RemoveBtn>
        </PickedChip>
      ))}
    </Picked>
  );
}

export const ClipIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
  </svg>
);

const List = styled.div`display:flex;flex-wrap:wrap;gap:6px;margin-top:4px;`;
const ThumbBtn = styled.button`
  padding:0;border:1px solid #E2E8F0;border-radius:10px;overflow:hidden;background:#F8FAFC;cursor:zoom-in;
  width:160px;max-width:100%;
  img{display:block;width:100%;height:auto;max-height:200px;object-fit:cover;}
`;
const FileChip = styled.button<{ $mine: boolean }>`
  display:inline-flex;align-items:center;gap:6px;max-width:100%;min-height:36px;padding:6px 10px;
  border:1px solid ${p => (p.$mine ? 'rgba(255,255,255,0.6)' : '#E2E8F0')};border-radius:8px;
  background:${p => (p.$mine ? 'rgba(255,255,255,0.15)' : '#F8FAFC')};color:inherit;font:inherit;cursor:pointer;
  &:disabled{cursor:default;}
`;
const ChipName = styled.span`font-size:0.8125rem;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:200px;`;
const ChipSize = styled.span`font-size:0.6875rem;opacity:.75;flex-shrink:0;`;
const Picked = styled.div`display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;`;
const PickedChip = styled.span`
  display:inline-flex;align-items:center;gap:6px;max-width:100%;height:36px;padding:0 4px 0 10px;
  border:1px solid #E2E8F0;border-radius:8px;background:#F8FAFC;color:#334155;
`;
const RemoveBtn = styled.button`
  width:32px;height:32px;display:inline-flex;align-items:center;justify-content:center;
  border:none;background:none;color:#64748B;border-radius:6px;cursor:pointer;
  &:hover{background:#E2E8F0;color:#0F172A;}
`;
