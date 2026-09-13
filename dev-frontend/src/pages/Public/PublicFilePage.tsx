// 공유 file 미리보기 — /public/files/:token
//
// 메타 + 다운로드 + 이미지/PDF inline preview + Smart Routing.
import { useCallback, useEffect, useState, useRef } from 'react';
import styled from 'styled-components';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getAccessToken } from '../../contexts/AuthContext';
import SharePasswordPrompt from './SharePasswordPrompt';
import PublicPageShell, { PublicCenter, PublicWorkspaceLabel } from '../../components/Layout/PublicPageShell';
import ExpiredShareLink from '../../components/Common/ExpiredShareLink';
// 링크를 열어 둔 채 원본이 바뀌면 보이는 것도 바뀐다(공개 페이지 공통 계약)
import { usePublicRevalidate } from '../../hooks/usePublicRevalidate';

interface FilePreview {
  id: number;
  file_name: string;
  mime_type: string | null;
  file_size: number;
  storage_provider: string;
  uploader?: { id: number; name: string } | null;
  workspace?: { id: number; name: string } | null;
  shared_at: string | null;
  created_at: string | null;
  /** 서버가 정한 미리보기 가능 여부 — 화면은 mime 로 다시 판단하지 않는다 (2026-09-03) */
  preview_kind?: 'image' | 'pdf' | null;
}

const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
};

// ★ mime 판정은 서버(preview_kind)가 한다 — 화면이 다시 판단하면 술어가 두 벌이 되어 갈라진다.
//   여기 있던 isImage/isPdf 는 그래서 제거했다(2026-09-03).

const PublicFilePage = () => {
  const { t } = useTranslation('common');
  const { token } = useParams<{ token: string }>();
  const [file, setFile] = useState<FilePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [needPw, setNeedPw] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwBusy, setPwBusy] = useState(false);
  const [verifiedPw, setVerifiedPw] = useState<string | null>(null);
  const [expired, setExpired] = useState<{ at: string | null } | null>(null);

  const pwRef = useRef<string | undefined>(undefined);
  const fetchFile = useCallback(async (pw?: string, silent = false) => {
    if (!token) return;
    // silent = **다시 읽기**. 보고 있는 화면을 스피너·비밀번호 창으로 되돌리지 않는다.
    if (!silent) { if (pw) setPwBusy(true); else setLoading(true); setPwError(null); }
    try {
      const r = await fetch(`/api/files/public/by-token/${token}`,
        pw ? { headers: { 'X-Share-Password': pw } } : undefined);
      const j = await r.json();
      if (j.success) { pwRef.current = pw;
        setFile(j.data);
        setNeedPw(false);
        if (pw) setVerifiedPw(pw);
      } else if (r.status === 410 && j.code === 'share_expired') {
        setExpired({ at: j.expired_at || null });
      } else if (r.status === 401 && j.requires_password) {
        if (silent) return;   // 이미 열어 본 화면을 잠금 화면으로 되돌리지 않는다
        setNeedPw(true);
        if (pw) setPwError(j.message === 'password_wrong' ? 'wrong' : null);
      } else if (!silent) {
        setError(j.message || 'not_found');
      }
    } catch { if (!silent) setError('network'); }
    finally { if (!silent) { setLoading(false); setPwBusy(false); } }
  }, [token]);

  useEffect(() => { void fetchFile(); }, [fetchFile]);
  // 링크를 열어 둔 채 원본이 바뀌면 보이는 것도 바뀐다(공개 페이지 공통 계약).
  //   비밀번호로 연 화면은 **같은 자격으로** 다시 읽는다 — 안 그러면 갱신이 곧 잠금이 된다.
  usePublicRevalidate(() => fetchFile(pwRef.current, true), { enabled: !!file });

  // N+95 fix — 옛 자동 redirect 제거 (로그인해도 공유 뷰가 따로 보여야). authed 는 아래 CTA 로 명시 이동.

  // ★ 훅은 **early return 위**에 둔다 — 아래에 두면 로딩→본문 전환에서 훅 개수가 달라져
  //   React #310(Rendered more hooks than during the previous render)으로 화면이 통째로 죽는다.
  //   타입검사·빌드는 통과하고 **실브라우저에서만** 드러난다(memory feedback_hooks_after_early_return).
  const inlineUrlEarly = `/api/files/public/by-token/${token}/download?inline=1${verifiedPw ? `&p=${encodeURIComponent(verifiedPw)}` : ''}`;
  // ★ 미리보기를 blob 으로 받아 둔다 — 실패를 알 수 있는 유일한 방법이다(iframe 은 onerror 가 없다).
  //   서버가 준 preview_kind 가 없으면 시도하지 않는다(술어는 서버 한 곳).
  const [previewState, setPreviewState] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  useEffect(() => {
    const kind = file?.preview_kind;
    if (!kind) { setPreviewState('idle'); return; }
    let alive = true;
    let made: string | null = null;
    setPreviewState('loading');
    fetch(inlineUrlEarly)
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
      .then((b) => {
        if (!alive) return;
        made = URL.createObjectURL(b);
        setBlobUrl(made);
        setPreviewState('ready');
      })
      .catch(() => { if (alive) setPreviewState('failed'); });
    return () => {
      alive = false;
      // ★ 만든 objectURL 은 반드시 회수한다 — 안 그러면 탭을 열어 둘수록 메모리가 샌다
      if (made) URL.revokeObjectURL(made);
    };
  }, [file?.preview_kind, inlineUrlEarly]);

  if (loading) return <PublicCenter>{t('public.loading', { defaultValue: '불러오는 중...' }) as string}</PublicCenter>;
  if (expired) return <ExpiredShareLink expiredAt={expired.at} />;
  if (needPw) return <SharePasswordPrompt onSubmit={fetchFile} busy={pwBusy} error={pwError} />;
  if (error || !file) return (
    <PublicPageShell layout="card" width="sm" brand={false}>
      <ErrorTitle>{t('public.notFound', { defaultValue: '링크가 만료되었거나 없는 항목입니다' }) as string}</ErrorTitle>
      <Hint>{t('public.notFoundHint', { defaultValue: '링크 작성자에게 다시 받으세요.' }) as string}</Hint>
      <CTA href="/" type="button">{t('public.goHome', { defaultValue: 'PlanQ 홈으로' }) as string}</CTA>
    </PublicPageShell>
  );

  const isAuthed = !!getAccessToken();
  const downloadUrl = `/api/files/public/by-token/${token}/download${verifiedPw ? `?p=${encodeURIComponent(verifiedPw)}` : ''}`;



  return (
    <PublicPageShell layout="card" width="lg" brand={false}>
      <>
        {file.workspace && <PublicWorkspaceLabel>{file.workspace.name}</PublicWorkspaceLabel>}
        <FileTitle>{file.file_name}</FileTitle>
        <MetaRow>
          <MetaItem>{formatSize(file.file_size)}</MetaItem>
          {file.mime_type && <MetaItem>{file.mime_type}</MetaItem>}
          {file.uploader && <MetaItem>· {file.uploader.name}</MetaItem>}
        </MetaRow>

        {/* ★ 미리보기는 **blob 으로 받아서** 그린다 (운영 신고 2026-09-03 — Irene: "pdf인데 왜 미리보기가 안나와? 엑박이 나와").
            URL 을 <img>/<iframe> 에 직접 물리면, 그 URL 이 외부(구글 드라이브)로 튀거나 실패해도
            **iframe 은 onerror 가 없어 우리가 알 수 없다.** 사용자에게는 엑박 = 고장과 구별되지 않는다.
            fetch → 2xx 면 blob:(CSP frame-src 에 이미 허용) 으로 그리고, 아니면 실패를 말한다. */}
        {previewState === 'loading' && (
          <PreviewNote>{t('public.file.previewLoading', '미리보기 준비 중…') as string}</PreviewNote>
        )}
        {previewState === 'ready' && blobUrl && file.preview_kind === 'image' && (
          <PreviewBox>
            <PreviewImg src={blobUrl} alt={file.file_name} />
          </PreviewBox>
        )}
        {previewState === 'ready' && blobUrl && file.preview_kind === 'pdf' && (
          <PreviewBox>
            <PreviewIframe src={blobUrl} title={file.file_name} />
          </PreviewBox>
        )}
        {previewState === 'failed' && (
          <PreviewNote data-testid="file-preview-unavailable">
            {t('public.file.previewUnavailable', '미리보기를 만들 수 없어요. 파일을 내려받아 확인해 주세요.') as string}
          </PreviewNote>
        )}

        <CTAArea>
          <CTA href={downloadUrl} type="button">
            {t('public.file.download', { defaultValue: '다운로드' }) as string}
          </CTA>
          {isAuthed ? (
            <CTASecondary href={`/files?file=${file.id}`} type="button">
              {t('public.openInPlanQ', { defaultValue: 'PlanQ 에서 보기 →' }) as string}
            </CTASecondary>
          ) : (
            <CTASecondary href={`/login?next=${encodeURIComponent(`/public/files/${token}`)}`} type="button">
              {t('public.login', { defaultValue: 'PlanQ 로그인' }) as string}
            </CTASecondary>
          )}
        </CTAArea>
        <Footer>{t('public.poweredBy', { defaultValue: 'PlanQ — 일이 일이 되지 않게' }) as string}</Footer>
      </>
    </PublicPageShell>
  );
};

export default PublicFilePage;

const FileTitle = styled.h1`font-size: 1.25rem; font-weight: 700; color: #0F172A; margin: 0 0 12px; line-height: 1.3; word-break: break-all;`;
const MetaRow = styled.div`display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 20px;`;
const MetaItem = styled.span`font-size: 0.75rem; color: #64748B;`;
const PreviewBox = styled.div`margin: 16px 0; border: 1px solid #E2E8F0; border-radius: 10px; overflow: hidden; background: #F8FAFC;`;
const PreviewNote = styled.div`
  padding: 14px 16px; border-radius: 8px;
  background: #F8FAFC; border: 1px solid #E2E8F0;
  color: #64748B; font-size: 0.8125rem; line-height: 1.6; text-align: center;
`;
const PreviewImg = styled.img`width: 100%; height: auto; max-height: 70vh; display: block; object-fit: contain;`;
const PreviewIframe = styled.iframe`width: 100%; height: 70vh; border: 0;`;
const CTAArea = styled.div`display: flex; gap: 8px; margin: 24px 0 12px; flex-wrap: wrap;`;
const CTA = styled.a`
  display: inline-flex; align-items: center; min-height: 44px; padding: 10px 20px;
  background: #14B8A6; color: #fff; font-size: 0.8125rem; font-weight: 700;
  border-radius: 8px; text-decoration: none;
  transition: background 0.15s;
  &:hover { background: #0D9488; }
`;
const CTASecondary = styled.a`
  display: inline-flex; align-items: center; min-height: 44px; padding: 10px 20px;
  background: #fff; color: #334155; font-size: 0.8125rem; font-weight: 600;
  border: 1px solid #E2E8F0; border-radius: 8px; text-decoration: none;
  &:hover { border-color: #CBD5E1; background: #F8FAFC; }
`;
const Hint = styled.div`font-size: 0.75rem; color: #94A3B8; padding: 12px 0;`;
const ErrorTitle = styled.div`font-size: 1.125rem; font-weight: 700; color: #0F172A; margin-bottom: 8px;`;
const Footer = styled.div`font-size: 0.6875rem; color: #94A3B8; text-align: center; margin-top: 12px;`;
