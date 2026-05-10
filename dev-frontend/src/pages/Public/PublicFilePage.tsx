// 공유 file 미리보기 — /public/files/:token
//
// 메타 + 다운로드 + 이미지/PDF inline preview + Smart Routing.
import { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { apiFetch, getAccessToken } from '../../contexts/AuthContext';
import SharePasswordPrompt from './SharePasswordPrompt';

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
}

const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
};

const isImage = (mime: string | null) => !!mime && mime.startsWith('image/');
const isPdf   = (mime: string | null) => mime === 'application/pdf';

const PublicFilePage = () => {
  const { t } = useTranslation('common');
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [file, setFile] = useState<FilePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [needPw, setNeedPw] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwBusy, setPwBusy] = useState(false);
  const [verifiedPw, setVerifiedPw] = useState<string | null>(null);

  const fetchFile = useCallback(async (pw?: string) => {
    if (!token) return;
    if (pw) setPwBusy(true); else setLoading(true);
    setPwError(null);
    try {
      const r = await fetch(`/api/files/public/by-token/${token}`,
        pw ? { headers: { 'X-Share-Password': pw } } : undefined);
      const j = await r.json();
      if (j.success) {
        setFile(j.data);
        setNeedPw(false);
        if (pw) setVerifiedPw(pw);
      } else if (r.status === 401 && j.requires_password) {
        setNeedPw(true);
        if (pw) setPwError(j.message === 'password_wrong' ? 'wrong' : null);
      } else {
        setError(j.message || 'not_found');
      }
    } catch { setError('network'); }
    finally { setLoading(false); setPwBusy(false); }
  }, [token]);

  useEffect(() => { fetchFile(); }, [fetchFile]);

  // Smart Routing
  useEffect(() => {
    if (!token || !file) return;
    if (!getAccessToken()) return;
    apiFetch(`/api/files/public/by-token/${token}/auth-check`)
      .then(r => r.json())
      .then(j => {
        if (j.success && j.data?.canAccess && j.data?.appUrl) {
          setTimeout(() => navigate(j.data.appUrl), 300);
        }
      }).catch(() => { /* silent */ });
  }, [token, file, navigate]);

  if (loading) return <Wrap><Card><Hint>{t('public.loading', { defaultValue: '불러오는 중...' }) as string}</Hint></Card></Wrap>;
  if (needPw) return <SharePasswordPrompt onSubmit={fetchFile} busy={pwBusy} error={pwError} />;
  if (error || !file) return (
    <Wrap><Card>
      <ErrorTitle>{t('public.notFound', { defaultValue: '링크가 만료되었거나 없는 항목입니다' }) as string}</ErrorTitle>
      <Hint>{t('public.notFoundHint', { defaultValue: '링크 작성자에게 다시 받으세요.' }) as string}</Hint>
      <CTA href="/" type="button">{t('public.goHome', { defaultValue: 'PlanQ 홈으로' }) as string}</CTA>
    </Card></Wrap>
  );

  const isAuthed = !!getAccessToken();
  const pwQ = verifiedPw ? `&p=${encodeURIComponent(verifiedPw)}` : '';
  const downloadUrl = `/api/files/public/by-token/${token}/download${verifiedPw ? `?p=${encodeURIComponent(verifiedPw)}` : ''}`;
  const inlineUrl = `/api/files/public/by-token/${token}/download?inline=1${pwQ}`;

  return (
    <Wrap>
      <Card>
        {file.workspace && <WorkspaceLabel>{file.workspace.name}</WorkspaceLabel>}
        <FileTitle>{file.file_name}</FileTitle>
        <MetaRow>
          <MetaItem>{formatSize(file.file_size)}</MetaItem>
          {file.mime_type && <MetaItem>{file.mime_type}</MetaItem>}
          {file.uploader && <MetaItem>· {file.uploader.name}</MetaItem>}
        </MetaRow>

        {isImage(file.mime_type) && (
          <PreviewBox>
            <PreviewImg src={inlineUrl} alt={file.file_name} />
          </PreviewBox>
        )}
        {isPdf(file.mime_type) && (
          <PreviewBox>
            <PreviewIframe src={inlineUrl} title={file.file_name} />
          </PreviewBox>
        )}

        <CTAArea>
          <CTA href={downloadUrl} type="button">
            {t('public.file.download', { defaultValue: '다운로드' }) as string}
          </CTA>
          {isAuthed ? (
            <CTASecondary href={`/file?file=${file.id}`} type="button">
              {t('public.openInPlanQ', { defaultValue: 'PlanQ 에서 보기 →' }) as string}
            </CTASecondary>
          ) : (
            <CTASecondary href={`/login?next=${encodeURIComponent(`/public/files/${token}`)}`} type="button">
              {t('public.login', { defaultValue: 'PlanQ 로그인' }) as string}
            </CTASecondary>
          )}
        </CTAArea>
        <Footer>{t('public.poweredBy', { defaultValue: 'PlanQ — 일이 일이 되지 않게' }) as string}</Footer>
      </Card>
    </Wrap>
  );
};

export default PublicFilePage;

const Wrap = styled.div`
  min-height: 100vh; background: #F8FAFC;
  display: flex; align-items: flex-start; justify-content: center; padding: 40px 20px;
  @media (max-width: 640px) { padding: 16px; }
`;
const Card = styled.div`
  width: 100%; max-width: 720px;
  background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 14px;
  padding: 28px 32px; box-shadow: 0 4px 12px rgba(0,0,0,0.06);
  @media (max-width: 640px) { padding: 20px 16px; }
`;
const WorkspaceLabel = styled.div`font-size: 11px; font-weight: 700; color: #94A3B8; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px;`;
const FileTitle = styled.h1`font-size: 20px; font-weight: 700; color: #0F172A; margin: 0 0 12px; line-height: 1.3; word-break: break-all;`;
const MetaRow = styled.div`display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 20px;`;
const MetaItem = styled.span`font-size: 12px; color: #64748B;`;
const PreviewBox = styled.div`margin: 16px 0; border: 1px solid #E2E8F0; border-radius: 10px; overflow: hidden; background: #F8FAFC;`;
const PreviewImg = styled.img`width: 100%; height: auto; max-height: 70vh; display: block; object-fit: contain;`;
const PreviewIframe = styled.iframe`width: 100%; height: 70vh; border: 0;`;
const CTAArea = styled.div`display: flex; gap: 8px; margin: 24px 0 12px; flex-wrap: wrap;`;
const CTA = styled.a`
  display: inline-flex; align-items: center; padding: 10px 20px;
  background: #14B8A6; color: #fff; font-size: 13px; font-weight: 700;
  border-radius: 8px; text-decoration: none;
  transition: background 0.15s;
  &:hover { background: #0D9488; }
`;
const CTASecondary = styled.a`
  display: inline-flex; align-items: center; padding: 10px 20px;
  background: #fff; color: #334155; font-size: 13px; font-weight: 600;
  border: 1px solid #E2E8F0; border-radius: 8px; text-decoration: none;
  &:hover { border-color: #CBD5E1; background: #F8FAFC; }
`;
const Hint = styled.div`font-size: 12px; color: #94A3B8; padding: 12px 0;`;
const ErrorTitle = styled.div`font-size: 18px; font-weight: 700; color: #0F172A; margin-bottom: 8px;`;
const Footer = styled.div`font-size: 11px; color: #94A3B8; text-align: center; margin-top: 12px;`;
