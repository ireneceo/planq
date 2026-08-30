// 파일 미리보기 — 영상·음성(서명 URL 재생) / 이미지(라이트박스) / PDF / 그 외 폴백.
import React, { useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useImageLightbox } from '../../../components/Common/ImageLightbox';
import { extOf, isImage, isVideo, isAudio, requestMediaUrl, type ProjectFile } from '../../../services/files';

// 이미지 리사이즈 파라미터 — DocsTab 과 같은 규칙(원본 URL 에 ?w= 를 덧붙인다).
const withW = (u: string | undefined | null, w: number): string | undefined =>
  u && u !== '#' ? `${u}${u.includes('?') ? '&' : '?'}w=${w}` : undefined;

export const PreviewArea: React.FC<{ file: ProjectFile; businessId: number }> = ({ file, businessId }) => {
  const { t } = useTranslation('qproject');
  const { open: openLightbox, lightbox } = useImageLightbox();
  // ★ 훅은 어떤 early return 보다 먼저 — 조건부 훅은 실브라우저에서만 터진다(React #310).
  const video = isVideo(file.mime_type, file.file_name);
  const audio = isAudio(file.mime_type, file.file_name);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [mediaFailed, setMediaFailed] = useState(false);
  useEffect(() => {
    if (!video && !audio) { setMediaUrl(null); setMediaFailed(false); return; }
    let alive = true;
    setMediaUrl(null); setMediaFailed(false);
    requestMediaUrl(businessId, file.id)
      .then(u => { if (!alive) return; if (u) setMediaUrl(u); else setMediaFailed(true); })
      .catch(() => { if (alive) setMediaFailed(true); });
    return () => { alive = false; };
  }, [video, audio, businessId, file.id]);

  const hasValidUrl = (u?: string) => !!u && u !== '#' && u.trim().length > 0;

  if ((video || audio) && !mediaFailed) {
    if (!mediaUrl) return <PreviewLoading>{t('docs.preview.loadingMedia', '재생 준비 중…')}</PreviewLoading>;
    return video
      ? (
        <PreviewVideo controls playsInline preload="metadata" src={mediaUrl}
          onError={() => setMediaFailed(true)} />
      ) : (
        <PreviewAudioWrap>
          <PvExtCircle>{extOf(file.file_name).toUpperCase() || '—'}</PvExtCircle>
          <audio controls preload="metadata" src={mediaUrl} onError={() => setMediaFailed(true)} />
        </PreviewAudioWrap>
      );
  }

  if (isImage(file.mime_type, file.file_name) && hasValidUrl(file.preview_url)) {
    // 클릭 시 원본(파라미터 없는 preview_url)으로 확대 라이트박스
    const full = file.preview_url!;
    return (
      <>
        <PreviewImageBtn type="button" onClick={() => openLightbox([{ src: full, alt: file.file_name }], 0)}
          title={t('docs.preview.zoom', '클릭하여 확대') as string}>
          <PreviewImage src={withW(file.preview_url, 1024)!} alt={file.file_name} />
        </PreviewImageBtn>
        {lightbox}
      </>
    );
  }
  if ((file.mime_type === 'application/pdf' || extOf(file.file_name) === 'pdf') && hasValidUrl(file.download_url)) {
    return <PreviewIframe src={file.download_url} title={file.file_name} />;
  }
  return (
    <PreviewFallback>
      <PvExtCircle>{extOf(file.file_name).toUpperCase() || '—'}</PvExtCircle>
      <PvFallbackHint>{t('docs.preview.fallbackHint', '미리보기는 다운로드 후 확인 가능합니다')}</PvFallbackHint>
    </PreviewFallback>
  );
};

const PreviewImageBtn = styled.button`display:block;width:100%;padding:0;border:none;background:none;cursor:zoom-in;`;
const PreviewImage = styled.img`width:100%;max-height:420px;object-fit:contain;background:#F8FAFC;border-radius:10px;`;
const PreviewIframe = styled.iframe`width:100%;height:420px;border:1px solid #E2E8F0;border-radius:10px;background:#F8FAFC;`;
const PreviewVideo = styled.video`
  width:100%;max-height:56vh;background:#000;border-radius:10px;display:block;
`;
const PreviewAudioWrap = styled.div`
  display:flex;flex-direction:column;align-items:center;gap:12px;padding:20px 12px;
  background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;
  audio{width:100%;}
`;
const PreviewLoading = styled.div`
  display:flex;align-items:center;justify-content:center;min-height:160px;
  background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;
  font-size:0.8125rem;color:#64748B;
`;
const PreviewFallback = styled.div`display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:40px 20px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;`;
const PvExtCircle = styled.div`width:72px;height:72px;border-radius:50%;background:#fff;border:1px solid #E2E8F0;display:flex;align-items:center;justify-content:center;font-size:1rem;font-weight:800;color:#475569;letter-spacing:.5px;`;
const PvFallbackHint = styled.div`font-size:0.75rem;color:#64748B;text-align:center;`;

export default PreviewArea;
