// 파일 미리보기 — 영상·음성(서명 URL 재생) / 이미지(라이트박스) / PDF / 그 외 폴백.
import React, { useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useImageLightbox } from '../../../components/Common/ImageLightbox';
import { extOf, isImage, isVideo, isAudio, requestMediaUrl, type ProjectFile } from '../../../services/files';
import { objectUrlFromApi } from '../../../utils/download';
import { apiFetch } from '../../../contexts/AuthContext';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

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
  // PDF — download_url 은 인증이 필요해 iframe src 로 넣으면 **401 빈 화면**이다(실측).
  //   인증 fetch 로 받아 blob URL 로 띄운다. 훅은 early return 보다 위 (React #310).
  const isPdf = file.mime_type === 'application/pdf' || extOf(file.file_name) === 'pdf';
  // ── 앱 안에서 여는 문서 (Irene 2026-08-31 "html 누르면 미리보기는 다운로드 후 …만 나와. 오픈기능이 필요해")
  //   여태 이미지·영상·음성·PDF 만 열렸고 나머지는 전부 "다운로드 후 확인" 안내로 떨어졌다.
  //   업무 파일 상당수가 여기 걸린다 — 열어보려면 매번 내려받아야 했다.
  const ext = extOf(file.file_name);
  const kind = viewerKindOf(file.mime_type, ext);
  const [text, setText] = useState<string | null>(null);
  const [textErr, setTextErr] = useState(false);
  useEffect(() => {
    if (!kind || !file.download_url || file.download_url === '#') { setText(null); return; }
    let alive = true;
    setText(null); setTextErr(false);
    (async () => {
      try {
        const r = await apiFetch(file.download_url);
        // apiFetch 는 throw 하지 않는다 — 상태를 직접 본다(안 보면 실패가 빈 화면으로 조용히 남는다).
        if (!r.ok) { if (alive) setTextErr(true); return; }
        const blob = await r.blob();
        if (blob.size > TEXT_VIEW_MAX) { if (alive) setTextErr(true); return; }
        const body = await blob.text();
        if (alive) setText(body);
      } catch { if (alive) setTextErr(true); }
    })();
    return () => { alive = false; };
  }, [kind, file.download_url]);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfFailed, setPdfFailed] = useState(false);
  useEffect(() => {
    if (!isPdf || !file.download_url || file.download_url === '#') { setPdfUrl(null); return; }
    let alive = true;
    let made: string | null = null;
    setPdfUrl(null); setPdfFailed(false);
    objectUrlFromApi(file.download_url)
      .then(u => { if (alive) { made = u; setPdfUrl(u); } else URL.revokeObjectURL(u); })
      .catch(() => { if (alive) setPdfFailed(true); });
    // blob URL 은 반드시 회수한다 — 안 하면 미리보기를 열 때마다 메모리에 파일이 쌓인다.
    return () => { alive = false; if (made) URL.revokeObjectURL(made); };
  }, [isPdf, file.download_url]);
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
  if (kind && !textErr) {
    if (text === null) return <PreviewLoading>{t('docs.preview.loadingText', { defaultValue: '여는 중…' }) as string}</PreviewLoading>;
    if (kind === 'html') {
      // ★ 남이 올린 HTML 이다 — 스크립트·폼·동일출처를 전부 막은 iframe 에서만 그린다.
      //   sandbox 속성을 빈 값으로 두면 모든 권한이 꺼진다(스크립트 실행·상위 접근 불가).
      return <PreviewIframe sandbox="" srcDoc={text} title={file.file_name} />;
    }
    if (kind === 'markdown') {
      const html = DOMPurify.sanitize(marked.parse(text, { async: false }) as string);
      return <PreviewDoc dangerouslySetInnerHTML={{ __html: html }} />;
    }
    if (kind === 'csv') return <PreviewTableWrap><CsvTable text={text} /></PreviewTableWrap>;
    return <PreviewCode>{text}</PreviewCode>;
  }
  if (isPdf && hasValidUrl(file.download_url) && !pdfFailed) {
    if (!pdfUrl) return <PreviewLoading>{t('docs.preview.loadingMedia', '재생 준비 중…')}</PreviewLoading>;
    return <PreviewIframe src={pdfUrl} title={file.file_name} />;
  }
  return (
    <PreviewFallback>
      <PvExtCircle>{extOf(file.file_name).toUpperCase() || '—'}</PvExtCircle>
      <PvFallbackHint>{textErr
        ? (t('docs.preview.tooLargeOrFailed', { defaultValue: '이 파일은 앱에서 열기에 너무 크거나 열 수 없습니다. 내려받아 확인해 주세요.' }) as string)
        : (t('docs.preview.fallbackHint', '미리보기는 다운로드 후 확인 가능합니다') as string)}</PvFallbackHint>
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

/** 앱에서 바로 열 수 있는 종류인지. null 이면 폴백(다운로드 안내). */
function viewerKindOf(mime: string | null, ext: string): 'html' | 'markdown' | 'csv' | 'text' | null {
  const m = (mime || '').toLowerCase();
  if (ext === 'html' || ext === 'htm' || m === 'text/html') return 'html';
  if (ext === 'md' || ext === 'markdown') return 'markdown';
  if (ext === 'csv' || ext === 'tsv') return 'csv';
  if (TEXT_EXTS.has(ext)) return 'text';
  // mime 이 text/* 면 확장자를 몰라도 텍스트로 연다 (log 등 임의 확장자 구제)
  if (m.startsWith('text/')) return 'text';
  return null;
}

const TEXT_EXTS = new Set([
  'txt', 'log', 'json', 'xml', 'yml', 'yaml', 'ini', 'conf', 'env', 'sql',
  'js', 'ts', 'jsx', 'tsx', 'css', 'scss', 'py', 'rb', 'go', 'java', 'c', 'h', 'cpp', 'sh',
]);
// 앱에서 여는 텍스트 상한 — 이보다 크면 브라우저가 멈춘다. 내려받아 보게 안내한다.
const TEXT_VIEW_MAX = 2 * 1024 * 1024;

/** CSV/TSV 를 표로. 따옴표 안의 구분자를 존중한다(엑셀 저장본이 흔하다). */
const CsvTable: React.FC<{ text: string }> = ({ text }) => {
  const rows = parseDelimited(text);
  if (rows.length === 0) return <PreviewCode>{text}</PreviewCode>;
  const [head, ...body] = rows;
  return (
    <table>
      <thead><tr>{head.map((c, i) => <th key={i}>{c}</th>)}</tr></thead>
      <tbody>{body.slice(0, 500).map((r, i) => (
        <tr key={i}>{head.map((_, j) => <td key={j}>{r[j] ?? ''}</td>)}</tr>
      ))}</tbody>
    </table>
  );
};

function parseDelimited(text: string): string[][] {
  const sep = text.indexOf('\t') >= 0 && text.indexOf(',') < 0 ? '\t' : ',';
  const rows: string[][] = [];
  let cur: string[] = [];
  let val = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { val += '"'; i++; } else quoted = false;
      } else val += ch;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === sep) { cur.push(val); val = ''; continue; }
    if (ch === '\n') { cur.push(val); rows.push(cur); cur = []; val = ''; continue; }
    if (ch === '\r') continue;
    val += ch;
  }
  if (val.length > 0 || cur.length > 0) { cur.push(val); rows.push(cur); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}

const PreviewCode = styled.pre`
  margin:0;padding:14px;max-height:420px;overflow:auto;
  background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:0.75rem;line-height:1.6;color:#0F172A;
  white-space:pre-wrap;word-break:break-word;
`;
const PreviewDoc = styled.div`
  padding:16px;max-height:420px;overflow:auto;
  background:#fff;border:1px solid #E2E8F0;border-radius:10px;
  font-size:0.875rem;line-height:1.7;color:#0F172A;
  h1,h2,h3{margin:1em 0 .5em;font-weight:700;}
  p{margin:.6em 0;} ul,ol{padding-left:1.4em;margin:.6em 0;}
  code{background:#F1F5F9;padding:1px 4px;border-radius:4px;font-size:.9em;}
  pre{background:#F8FAFC;padding:12px;border-radius:8px;overflow:auto;}
  img{max-width:100%;} table{border-collapse:collapse;} td,th{border:1px solid #E2E8F0;padding:6px 8px;}
`;
const PreviewTableWrap = styled.div`
  max-height:420px;overflow:auto;background:#fff;border:1px solid #E2E8F0;border-radius:10px;
  table{border-collapse:collapse;width:100%;font-size:0.75rem;}
  th,td{border:1px solid #E2E8F0;padding:6px 8px;text-align:left;white-space:nowrap;}
  th{background:#F8FAFC;font-weight:700;position:sticky;top:0;}
`;

export default PreviewArea;
