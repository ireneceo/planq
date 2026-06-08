// 공유 KB 번들(다건/카테고리) 미리보기 — /public/kb-bundle/:token
// 문서처럼 여러 인포를 한 페이지에 read-only 노출 (#6).
import { useEffect, useState } from 'react';
import styled from 'styled-components';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import ExpiredShareLink from '../../components/Common/ExpiredShareLink';

interface BundleDoc {
  id: number;
  title: string;
  body: string | null;
  source_type: string | null;
  file_name: string | null;
  categories: string[];
  created_at: string | null;
}
interface BundleData {
  kind: 'selection' | 'category';
  title: string | null;
  category: string | null;
  workspace?: { id: number; name: string } | null;
  count: number;
  documents: BundleDoc[];
}

const PublicKbBundlePage = () => {
  const { t } = useTranslation('common');
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<BundleData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState<{ at: string | null } | null>(null);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/kb-bundle/public/by-token/${token}`)
      .then(async (r) => {
        const j = await r.json();
        if (j.success) { setData(j.data); }
        else if (r.status === 410 && j.code === 'share_expired') setExpired({ at: j.expired_at || null });
        else setError(j.message || 'not_found');
      })
      .catch(() => setError('network'))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) return <Wrap><Card><Hint>{t('public.loading', { defaultValue: '불러오는 중...' }) as string}</Hint></Card></Wrap>;
  if (expired) return <ExpiredShareLink expiredAt={expired.at} />;
  if (error || !data) return (
    <Wrap><Card>
      <ErrorTitle>{t('public.notFound', { defaultValue: '링크가 만료되었거나 없는 항목입니다' }) as string}</ErrorTitle>
      <Hint>{t('public.notFoundHint', { defaultValue: '링크 작성자에게 다시 받으세요.' }) as string}</Hint>
      <CTA href="/" type="button">{t('public.goHome', { defaultValue: 'PlanQ 홈으로' }) as string}</CTA>
    </Card></Wrap>
  );

  const heading = data.title || data.category || (t('public.kb.bundleTitle', { defaultValue: '공유 자료' }) as string);

  return (
    <Wrap>
      <Card>
        {data.workspace && <WorkspaceLabel>{data.workspace.name}</WorkspaceLabel>}
        <BundleTitle>{heading}</BundleTitle>
        <BundleMeta>{t('public.kb.bundleCount', { count: data.count, defaultValue: '{{count}}개 자료' }) as string}</BundleMeta>

        {data.documents.length === 0 ? (
          <Hint>{t('public.kb.bundleEmpty', { defaultValue: '공유된 자료가 없습니다.' }) as string}</Hint>
        ) : (
          data.documents.map((doc, i) => (
            <DocBlock key={doc.id}>
              <DocIndex>{i + 1}</DocIndex>
              <DocMain>
                <DocTitle>{doc.title}</DocTitle>
                {doc.categories?.length > 0 && (
                  <DocCats>{doc.categories.map((c) => <CatPill key={c}>{c}</CatPill>)}</DocCats>
                )}
                {doc.body ? <DocBody>{doc.body}</DocBody> : <Hint>{t('public.kb.noBody', { defaultValue: '본문이 비어 있습니다.' }) as string}</Hint>}
              </DocMain>
            </DocBlock>
          ))
        )}

        <Footer>{t('public.poweredBy', { defaultValue: 'PlanQ — 일이 일이 되지 않게' }) as string}</Footer>
      </Card>
    </Wrap>
  );
};

export default PublicKbBundlePage;

const Wrap = styled.div`
  min-height: 100vh; background: #F8FAFC;
  display: flex; align-items: flex-start; justify-content: center; padding: 40px 20px;
  @media (max-width: 640px) { padding: 16px; }
`;
const Card = styled.div`
  width: 100%; max-width: 760px;
  background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 14px;
  padding: 28px 32px; box-shadow: 0 4px 12px rgba(0,0,0,0.06);
  @media (max-width: 640px) { padding: 20px 16px; }
`;
const WorkspaceLabel = styled.div`font-size: 11px; font-weight: 700; color: #94A3B8; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px;`;
const BundleTitle = styled.h1`font-size: 22px; font-weight: 700; color: #0F172A; margin: 0 0 6px; line-height: 1.3;`;
const BundleMeta = styled.div`font-size: 12px; color: #64748B; margin-bottom: 20px;`;
const DocBlock = styled.div`
  display: grid; grid-template-columns: 28px 1fr; gap: 12px;
  padding: 18px 0; border-top: 1px solid #E2E8F0;
  &:first-of-type { border-top: none; }
`;
const DocIndex = styled.div`
  width: 24px; height: 24px; border-radius: 999px;
  display: flex; align-items: center; justify-content: center;
  background: #F0FDFA; color: #0F766E; font-size: 12px; font-weight: 700;
`;
const DocMain = styled.div`min-width: 0;`;
const DocTitle = styled.h2`font-size: 16px; font-weight: 700; color: #0F172A; margin: 0 0 8px; line-height: 1.4;`;
const DocCats = styled.div`display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px;`;
const CatPill = styled.span`display: inline-flex; padding: 3px 10px; font-size: 11px; font-weight: 600; border-radius: 999px; background: #F0FDFA; color: #0F766E;`;
const DocBody = styled.div`font-size: 14px; color: #334155; line-height: 1.7; white-space: pre-wrap; word-break: break-word;`;
const Hint = styled.div`font-size: 12px; color: #94A3B8; padding: 12px 0;`;
const ErrorTitle = styled.div`font-size: 18px; font-weight: 700; color: #0F172A; margin-bottom: 8px;`;
const CTA = styled.a`
  display: inline-flex; align-items: center; min-height: 44px; padding: 10px 20px;
  background: #14B8A6; color: #fff; font-size: 13px; font-weight: 700;
  border-radius: 8px; text-decoration: none; transition: background 0.15s;
  &:hover { background: #0D9488; }
`;
const Footer = styled.div`font-size: 11px; color: #94A3B8; text-align: center; margin-top: 24px;`;
