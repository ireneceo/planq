// 공유 KB(인포) 번들(다건/카테고리) 미리보기 — /public/kb-bundle/:token
// 리스트 → 항목 클릭 → 상세. 문서 공개 페이지(PublicPostPage)와 동일 레이아웃.
import { useEffect, useMemo, useState, useCallback } from 'react';
import styled from 'styled-components';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PublicPageShell, { PublicCenter, PublicWorkspaceLabel, PublicTitle, PublicMeta, PublicBtn } from '../../components/Layout/PublicPageShell';
import ExpiredShareLink from '../../components/Common/ExpiredShareLink';
import { sanitizeRichText } from '../../utils/sanitizeHtml';
// 링크를 열어 둔 채 원본이 바뀌면 보이는 것도 바뀐다(공개 페이지 공통 계약)
import { usePublicRevalidate } from '../../hooks/usePublicRevalidate';

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

// 공개 페이지 — 사용자 작성 HTML 은 반드시 정화 후 렌더 (여태 원문 그대로 넣어 script/onerror 가 실행 가능했다)
function toHtml(v: string): string {
  return sanitizeRichText(v);
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

  const load = useCallback(async (silent = false) => {
    if (!token) return;
    if (!silent) setLoading(true);
    try {
      const r = await fetch(`/api/kb-bundle/public/by-token/${token}`);
      const j = await r.json();
      if (j.success) { setData(j.data); setError(null); }
      else if (r.status === 410 && j.code === 'share_expired') setExpired({ at: j.expired_at || null });
      else if (!silent) setError(j.message || 'not_found');
    } catch {
      if (!silent) setError('network');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);
  // 링크를 열어 둔 채 원본이 바뀌면 보이는 것도 바뀐다(공개 페이지 공통 계약)
  usePublicRevalidate(() => load(true), { enabled: !!data });

  const selected = useMemo(
    () => (selectedId != null && data ? data.documents.find((d) => d.id === selectedId) || null : null),
    [selectedId, data]
  );

  if (loading) return <PublicCenter>{t('public.loading', { defaultValue: '불러오는 중...' }) as string}</PublicCenter>;
  if (expired) return <ExpiredShareLink expiredAt={expired.at} />;
  if (error || !data) return (
    <PublicCenter>
      <div style={{ textAlign: 'center' }}>
        <ErrorTitle>{t('public.notFound', { defaultValue: '링크가 만료되었거나 없는 항목입니다' }) as string}</ErrorTitle>
        <Hint>{t('public.notFoundHint', { defaultValue: '링크 작성자에게 다시 받으세요.' }) as string}</Hint>
      </div>
    </PublicCenter>
  );

  const heading = data.title || data.category || (t('public.kb.bundleTitle', { defaultValue: '공유 자료' }) as string);

  return (
    <PublicPageShell
      promo
      actions={(
        <>
          {selected && (
            <PublicBtn type="button" onClick={() => setSelectedId(null)}>
              ← {t('public.kb.backToList', { defaultValue: '목록으로' }) as string}
            </PublicBtn>
          )}
          <PublicBtn $primary type="button" onClick={() => window.open('https://planq.kr', '_blank')}>
            {t('public.promoCta', { defaultValue: '플랜큐 바로가기' }) as string}
          </PublicBtn>
        </>
      )}
    >
      <>
        {!selected ? (
          <>
            {data.workspace && <PublicWorkspaceLabel>{data.workspace.name}</PublicWorkspaceLabel>}
            <PublicTitle>{heading}</PublicTitle>
            <PublicMeta>{t('public.kb.bundleCount', { count: data.count, defaultValue: '{{count}}개 자료' }) as string}</PublicMeta>

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
            <PublicTitle>{selected.title}</PublicTitle>
            <PublicMeta>
              {selected.categories?.length > 0 && selected.categories.map((c) => <SourcePill key={c}>{c}</SourcePill>)}
              {selected.file_name && <span>{selected.file_name}</span>}
            </PublicMeta>
            {selected.body ? (
              <Body dangerouslySetInnerHTML={{ __html: toHtml(selected.body) }} />
            ) : (
              <Hint>{t('public.kb.noBody', { defaultValue: '본문이 비어 있습니다.' }) as string}</Hint>
            )}
          </>
        )}
      </>
    </PublicPageShell>
  );
};

export default PublicKbBundlePage;

const RowMain = styled.div`min-width: 0;`;
const RowTitle = styled.div`font-size: 0.9375rem; font-weight: 700; color: #0F172A; line-height: 1.4;`;
const RowCats = styled.div`display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px;`;
const CatPill = styled.span`display: inline-flex; padding: 2px 8px; font-size: 0.6875rem; font-weight: 600; border-radius: 999px; background: #F0FDFA; color: #0F766E;`;
const RowSnippet = styled.div`font-size: 0.75rem; color: #64748B; line-height: 1.5; margin-top: 6px; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;`;
const RowArrow = styled.div`color: #CBD5E1; font-size: 1rem; text-align: center;`;
const BackInline = styled.button`
  background: none; border: none; cursor: pointer; padding: 0; margin: 0 0 14px;
  font-size: 0.8125rem; font-weight: 600; color: #0F766E;
  &:hover { text-decoration: underline; }
`;
const Body = styled.div`
  font-size: 0.875rem; color: #334155; line-height: 1.7;
  overflow-wrap: anywhere; word-break: break-word;
  & p { margin: 0 0 10px; }
  & p:last-child { margin-bottom: 0; }
  & ul, & ol { padding-left: 22px; margin: 8px 0; }
  & h1 { font-size: 1.375rem; font-weight: 700; margin: 16px 0 6px; }
  & h2 { font-size: 1.125rem; font-weight: 700; margin: 14px 0 6px; }
  & h3 { font-size: 0.9375rem; font-weight: 700; margin: 12px 0 4px; }
  & img { max-width: 100%; height: auto; border-radius: 8px; margin: 8px 0; }
  & a { color: #0D9488; text-decoration: underline; overflow-wrap: anywhere; }
  & table { border-collapse: collapse; width: 100%; margin: 12px 0; font-size: 0.8125rem; }
  & td, & th { border: 1px solid #E2E8F0; padding: 8px 10px; }
  & blockquote { border-left: 3px solid #14B8A6; padding: 4px 12px; background: #F0FDFA; border-radius: 0 6px 6px 0; color: #475569; }
`;
const Hint = styled.div`font-size: 0.8125rem; color: #94A3B8; padding: 12px 0;`;
const ErrorTitle = styled.div`font-size: 1.125rem; font-weight: 700; color: #0F172A; margin-bottom: 8px;`;
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
  background: #F0FDFA; color: #0F766E; font-size: 0.75rem; font-weight: 700;
`;
const SourcePill = styled.span`display: inline-flex; padding: 3px 10px; font-size: 0.6875rem; font-weight: 700; border-radius: 999px; background: #F0FDFA; color: #0F766E;`;
