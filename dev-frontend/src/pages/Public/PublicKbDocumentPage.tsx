// 공유 KB 문서 미리보기 — /public/kb/:token
import { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { apiFetch, getAccessToken } from '../../contexts/AuthContext';
import SharePasswordPrompt from './SharePasswordPrompt';

interface KbPreview {
  id: number;
  title: string;
  body: string | null;
  source_type: string | null;
  file_name: string | null;
  mime_type: string | null;
  uploader?: { id: number; name: string } | null;
  workspace?: { id: number; name: string } | null;
  shared_at: string | null;
  created_at: string | null;
}

const SOURCE_LABEL_DEFAULTS: Record<string, string> = {
  manual: '직접 입력',
  faq: 'FAQ',
  policy: '정책',
  pricing: '가격',
  other: '기타',
  file: '파일',
  post: '문서',
};

const PublicKbDocumentPage = () => {
  const { t } = useTranslation('common');
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [doc, setDoc] = useState<KbPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [needPw, setNeedPw] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwBusy, setPwBusy] = useState(false);

  const fetchDoc = useCallback(async (pw?: string) => {
    if (!token) return;
    if (pw) setPwBusy(true); else setLoading(true);
    setPwError(null);
    try {
      const r = await fetch(`/api/kb-documents/public/by-token/${token}`,
        pw ? { headers: { 'X-Share-Password': pw } } : undefined);
      const j = await r.json();
      if (j.success) { setDoc(j.data); setNeedPw(false); }
      else if (r.status === 401 && j.requires_password) {
        setNeedPw(true);
        if (pw) setPwError(j.message === 'password_wrong' ? 'wrong' : null);
      } else { setError(j.message || 'not_found'); }
    } catch { setError('network'); }
    finally { setLoading(false); setPwBusy(false); }
  }, [token]);

  useEffect(() => { fetchDoc(); }, [fetchDoc]);

  useEffect(() => {
    if (!token || !doc) return;
    if (!getAccessToken()) return;
    apiFetch(`/api/kb-documents/public/by-token/${token}/auth-check`)
      .then(r => r.json())
      .then(j => {
        if (j.success && j.data?.canAccess && j.data?.appUrl) {
          setTimeout(() => navigate(j.data.appUrl), 300);
        }
      }).catch(() => { /* silent */ });
  }, [token, doc, navigate]);

  if (loading) return <Wrap><Card><Hint>{t('public.loading', { defaultValue: '불러오는 중...' }) as string}</Hint></Card></Wrap>;
  if (needPw) return <SharePasswordPrompt onSubmit={fetchDoc} busy={pwBusy} error={pwError} />;
  if (error || !doc) return (
    <Wrap><Card>
      <ErrorTitle>{t('public.notFound', { defaultValue: '링크가 만료되었거나 없는 항목입니다' }) as string}</ErrorTitle>
      <Hint>{t('public.notFoundHint', { defaultValue: '링크 작성자에게 다시 받으세요.' }) as string}</Hint>
      <CTA href="/" type="button">{t('public.goHome', { defaultValue: 'PlanQ 홈으로' }) as string}</CTA>
    </Card></Wrap>
  );

  const isAuthed = !!getAccessToken();
  const sourceLabel = doc.source_type
    ? t(`public.kb.source.${doc.source_type}`, { defaultValue: SOURCE_LABEL_DEFAULTS[doc.source_type] || doc.source_type }) as string
    : null;

  return (
    <Wrap>
      <Card>
        {doc.workspace && <WorkspaceLabel>{doc.workspace.name}</WorkspaceLabel>}
        <DocTitle>{doc.title}</DocTitle>
        <MetaRow>
          {sourceLabel && <SourcePill>{sourceLabel}</SourcePill>}
          {doc.uploader && <MetaItem>{doc.uploader.name}</MetaItem>}
          {doc.file_name && <MetaItem>· {doc.file_name}</MetaItem>}
        </MetaRow>

        {doc.body ? (
          <BodyBox>{doc.body}</BodyBox>
        ) : (
          <Hint>{t('public.kb.noBody', { defaultValue: '본문이 비어 있습니다.' }) as string}</Hint>
        )}

        <CTAArea>
          {isAuthed ? (
            <CTA href={`/talk?kb=${doc.id}`} type="button">
              {t('public.openInPlanQ', { defaultValue: 'PlanQ 에서 보기 →' }) as string}
            </CTA>
          ) : (
            <>
              <CTA href={`/login?next=${encodeURIComponent(`/public/kb/${token}`)}`} type="button">
                {t('public.login', { defaultValue: 'PlanQ 로그인' }) as string}
              </CTA>
              <CTASecondary href="/" type="button">
                {t('public.signup', { defaultValue: '무료로 시작하기' }) as string}
              </CTASecondary>
            </>
          )}
        </CTAArea>
        <Footer>{t('public.poweredBy', { defaultValue: 'PlanQ — 일이 일이 되지 않게' }) as string}</Footer>
      </Card>
    </Wrap>
  );
};

export default PublicKbDocumentPage;

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
const DocTitle = styled.h1`font-size: 22px; font-weight: 700; color: #0F172A; margin: 0 0 12px; line-height: 1.3;`;
const MetaRow = styled.div`display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 20px;`;
const SourcePill = styled.span`display: inline-flex; padding: 3px 10px; font-size: 11px; font-weight: 700; border-radius: 999px; background: #F0FDFA; color: #0F766E;`;
const MetaItem = styled.span`font-size: 12px; color: #64748B;`;
const BodyBox = styled.div`font-size: 14px; color: #334155; line-height: 1.7; padding: 16px 18px; background: #F8FAFC; border-radius: 10px; white-space: pre-wrap; word-break: break-word; max-height: 60vh; overflow-y: auto;`;
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
