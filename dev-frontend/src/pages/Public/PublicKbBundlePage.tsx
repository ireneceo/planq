// 공유 KB(인포) 번들(다건/카테고리) 미리보기 — /public/kb-bundle/:token
// 리스트 → 항목 클릭 → 상세. 문서 공개 페이지(PublicPostPage)와 동일 레이아웃.
import { useEffect, useMemo, useState } from 'react';
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

function toHtml(v: string): string {
  const isHtml = /<[a-z][\s\S]*>/i.test(v);
  return isHtml ? v : `<p>${v.replace(/\n/g, '<br/>')}</p>`;
}
function toSnippet(v: string | null): string {
  if (!v) return '';
  return v.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
}

const PublicKbBundlePage = () => {
  const { t } = useTranslation('common');
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<BundleData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState<{ at: string | null } | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);

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

  const selected = useMemo(
    () => (selectedId != null && data ? data.documents.find((d) => d.id === selectedId) || null : null),
    [selectedId, data]
  );

  if (loading) return <Center>{t('public.loading', { defaultValue: '불러오는 중...' }) as string}</Center>;
  if (expired) return <ExpiredShareLink expiredAt={expired.at} />;
  if (error || !data) return (
    <Center>
      <div style={{ textAlign: 'center' }}>
        <ErrorTitle>{t('public.notFound', { defaultValue: '링크가 만료되었거나 없는 항목입니다' }) as string}</ErrorTitle>
        <Hint>{t('public.notFoundHint', { defaultValue: '링크 작성자에게 다시 받으세요.' }) as string}</Hint>
      </div>
    </Center>
  );

  const heading = data.title || data.category || (t('public.kb.bundleTitle', { defaultValue: '공유 자료' }) as string);

  return (
    <Page>
      <Toolbar className="no-print">
        <Brand src="/planQ-slogan_color.svg" alt="PlanQ" />
        <ToolbarSpacer />
        {selected && (
          <PlainBtn type="button" onClick={() => setSelectedId(null)}>
            ← {t('public.kb.backToList', { defaultValue: '목록으로' }) as string}
          </PlainBtn>
        )}
        <PrimaryBtn type="button" onClick={() => window.open('https://planq.kr', '_blank')}>
          {t('public.promoCta', { defaultValue: '플랜큐 바로가기' }) as string}
        </PrimaryBtn>
      </Toolbar>

      <PromoBar className="no-print">
        <PromoText>{t('public.promoCopy', { defaultValue: '업무, 프로젝트, 사람, 시간, 고객, 청구를 하나로 연결해 시간을 돈으로 바꾸는 수익성 엔진' }) as string}</PromoText>
        <PromoLink href="https://planq.kr" target="_blank" rel="noreferrer">
          {t('public.promoCta', { defaultValue: '플랜큐 바로가기' }) as string} <span aria-hidden="true">→</span>
        </PromoLink>
      </PromoBar>

      <DocFrame>
        {!selected ? (
          <>
            {data.workspace && <WorkspaceLabel>{data.workspace.name}</WorkspaceLabel>}
            <DocTitle>{heading}</DocTitle>
            <DocMeta>{t('public.kb.bundleCount', { count: data.count, defaultValue: '{{count}}개 자료' }) as string}</DocMeta>

            {data.documents.length === 0 ? (
              <Hint>{t('public.kb.bundleEmpty', { defaultValue: '공유된 자료가 없습니다.' }) as string}</Hint>
            ) : (
              <List>
                {data.documents.map((doc, i) => (
                  <Row key={doc.id} type="button" onClick={() => setSelectedId(doc.id)}>
                    <RowIndex>{i + 1}</RowIndex>
                    <RowMain>
                      <RowTitle>{doc.title}</RowTitle>
                      {doc.categories?.length > 0 && (
                        <RowCats>{doc.categories.map((c) => <CatPill key={c}>{c}</CatPill>)}</RowCats>
                      )}
                      {toSnippet(doc.body) && <RowSnippet>{toSnippet(doc.body)}</RowSnippet>}
                    </RowMain>
                    <RowArrow aria-hidden="true">→</RowArrow>
                  </Row>
                ))}
              </List>
            )}
          </>
        ) : (
          <>
            <BackInline type="button" onClick={() => setSelectedId(null)}>
              ← {t('public.kb.backToList', { defaultValue: '목록으로' }) as string}
            </BackInline>
            <DocTitle>{selected.title}</DocTitle>
            <DocMeta>
              {selected.categories?.length > 0 && selected.categories.map((c) => <SourcePill key={c}>{c}</SourcePill>)}
              {selected.file_name && <span>{selected.file_name}</span>}
            </DocMeta>
            {selected.body ? (
              <Body dangerouslySetInnerHTML={{ __html: toHtml(selected.body) }} />
            ) : (
              <Hint>{t('public.kb.noBody', { defaultValue: '본문이 비어 있습니다.' }) as string}</Hint>
            )}
          </>
        )}
      </DocFrame>
    </Page>
  );
};

export default PublicKbBundlePage;

const Page = styled.div`min-height: 100vh; background: #F8FAFC; padding: 0 0 40px 0;`;
const Toolbar = styled.div`
  display: flex; align-items: center; gap: 8px; padding: 12px 24px;
  background: #FFF; border-bottom: 1px solid #E2E8F0;
  position: sticky; top: 0; z-index: 10;
`;
const Brand = styled.img`display:block;width:120px;height:auto;user-select:none;`;
const ToolbarSpacer = styled.div`flex:1;`;
const PrimaryBtn = styled.button`
  display: inline-flex; align-items: center; min-height: 44px;
  padding: 8px 16px; font-size: 13px; font-weight: 700; color: #FFFFFF;
  border: none; border-radius: 8px; background: #14B8A6; cursor: pointer;
  &:hover { background: #0D9488; }
`;
const PlainBtn = styled.button`
  display: inline-flex; align-items: center; min-height: 44px;
  padding: 8px 16px; font-size: 13px; font-weight: 600; color: #334155;
  border: 1px solid #E2E8F0; border-radius: 8px; background: #FFF; cursor: pointer;
  &:hover { border-color: #14B8A6; color: #0F766E; }
`;
const PromoBar = styled.div`
  display: flex; align-items: center; gap: 14px;
  padding: 9px 24px; background: #F0FDFA; border-bottom: 1px solid #99F6E4;
  font-size: 12px; color: #475569; line-height: 1.5;
  @media (max-width: 640px) { padding: 9px 16px; gap: 10px; flex-wrap: wrap; }
`;
const PromoText = styled.span`
  flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  @media (max-width: 640px) { white-space: normal; }
`;
const PromoLink = styled.a`
  flex-shrink: 0; color: #0F766E; font-weight: 700; text-decoration: none; white-space: nowrap;
  &:hover { color: #115E59; text-decoration: underline; }
  span { margin-left: 4px; }
`;
const DocFrame = styled.article`
  max-width: 820px; margin: 32px auto; background: #FFF; border: 1px solid #E2E8F0;
  border-radius: 12px; padding: 40px 48px; box-shadow: 0 4px 12px rgba(0,0,0,0.04);
  color: #0F172A;
  @media (max-width: 640px) { padding: 24px 20px; margin: 16px; }
`;
const WorkspaceLabel = styled.div`font-size: 11px; font-weight: 700; color: #94A3B8; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px;`;
const DocTitle = styled.h1`font-size: 24px; font-weight: 700; color: #0F172A; margin: 0 0 6px 0; line-height: 1.3;`;
const DocMeta = styled.div`display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-size: 12px; color: #64748B; margin: 0 0 20px 0;`;
const SourcePill = styled.span`display: inline-flex; padding: 3px 10px; font-size: 11px; font-weight: 700; border-radius: 999px; background: #F0FDFA; color: #0F766E;`;
const List = styled.div`display: flex; flex-direction: column; gap: 8px;`;
const Row = styled.button`
  display: grid; grid-template-columns: 28px 1fr 18px; gap: 12px; align-items: center;
  width: 100%; text-align: left; cursor: pointer;
  padding: 14px 16px; background: #FFF; border: 1px solid #E2E8F0; border-radius: 10px;
  transition: border-color 0.15s, background 0.15s;
  &:hover { border-color: #14B8A6; background: #F0FDFA; }
`;
const RowIndex = styled.div`
  width: 24px; height: 24px; border-radius: 999px;
  display: flex; align-items: center; justify-content: center;
  background: #F0FDFA; color: #0F766E; font-size: 12px; font-weight: 700;
`;
const RowMain = styled.div`min-width: 0;`;
const RowTitle = styled.div`font-size: 15px; font-weight: 700; color: #0F172A; line-height: 1.4;`;
const RowCats = styled.div`display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px;`;
const CatPill = styled.span`display: inline-flex; padding: 2px 8px; font-size: 11px; font-weight: 600; border-radius: 999px; background: #F0FDFA; color: #0F766E;`;
const RowSnippet = styled.div`font-size: 12px; color: #64748B; line-height: 1.5; margin-top: 6px; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;`;
const RowArrow = styled.div`color: #CBD5E1; font-size: 16px; text-align: center;`;
const BackInline = styled.button`
  background: none; border: none; cursor: pointer; padding: 0; margin: 0 0 14px;
  font-size: 13px; font-weight: 600; color: #0F766E;
  &:hover { text-decoration: underline; }
`;
const Body = styled.div`
  font-size: 14px; color: #334155; line-height: 1.7;
  overflow-wrap: anywhere; word-break: break-word;
  & p { margin: 0 0 10px; }
  & p:last-child { margin-bottom: 0; }
  & ul, & ol { padding-left: 22px; margin: 8px 0; }
  & h1 { font-size: 22px; font-weight: 700; margin: 16px 0 6px; }
  & h2 { font-size: 18px; font-weight: 700; margin: 14px 0 6px; }
  & h3 { font-size: 15px; font-weight: 700; margin: 12px 0 4px; }
  & img { max-width: 100%; height: auto; border-radius: 8px; margin: 8px 0; }
  & a { color: #0D9488; text-decoration: underline; overflow-wrap: anywhere; }
  & table { border-collapse: collapse; width: 100%; margin: 12px 0; font-size: 13px; }
  & td, & th { border: 1px solid #E2E8F0; padding: 8px 10px; }
  & blockquote { border-left: 3px solid #14B8A6; padding: 4px 12px; background: #F0FDFA; border-radius: 0 6px 6px 0; color: #475569; }
`;
const Hint = styled.div`font-size: 13px; color: #94A3B8; padding: 12px 0;`;
const ErrorTitle = styled.div`font-size: 18px; font-weight: 700; color: #0F172A; margin-bottom: 8px;`;
const Center = styled.div`min-height:60vh;display:flex;align-items:center;justify-content:center;color:#64748B;font-size:14px;`;
