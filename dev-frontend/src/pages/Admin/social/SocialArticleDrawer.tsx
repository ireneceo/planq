// SNS 발송 — 글 하나의 우측 패널: 링크 미리보기 이미지 · 소재 만들기 · 카드 · 채널별 소재.
//   버전(angle): 같은 글로 소재를 다시 만들면 새 버전이 생기고 옛 버전은 그대로 남는다(기본은 최신 버전).
import { useCallback, useEffect, useMemo, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import DetailDrawer from '../../../components/Common/DetailDrawer';
import ActionButton from '../../../components/Common/ActionButton';
import PlanQSelect, { type PlanQSelectOption } from '../../../components/Common/PlanQSelect';
import { onSocket } from '../../../services/socket';
import SocialPostCard from './SocialPostCard';
import {
  SOCIAL_API, socialCall, jsonInit, fetchBlobUrl, mediaPath, downloadMedia,
  type SocialChannel, type SocialPost, type SocialArticleRow,
} from './socialApi';

interface Detail { article: SocialArticleRow; posts: SocialPost[] }

interface Props {
  articleId: number | null;
  channels: SocialChannel[];
  onClose: () => void;
  onListChanged: () => void;
}

export default function SocialArticleDrawer({ articleId, channels, onClose, onListChanged }: Props) {
  const { t } = useTranslation('admin');
  const [detail, setDetail] = useState<Detail | null>(null);
  const [angle, setAngle] = useState<number | null>(null);
  const [hooks, setHooks] = useState<string[]>([]);
  const [busy, setBusy] = useState<'og' | 'draft' | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!articleId) return;
    try { setDetail(await socialCall<Detail>(`${SOCIAL_API}/articles/${articleId}`)); } catch (e) { setErr((e as Error).message); }
  }, [articleId]);

  useEffect(() => { setDetail(null); setAngle(null); setHooks([]); setErr(null); void load(); }, [load]);
  // 다른 관리자·다른 탭의 변경 — 신호(article_id)만 받고 다시 읽는다
  useEffect(() => onSocket<{ article_id?: number }>('social:changed', (d) => {
    if (d && d.article_id === articleId) void load();
  }), [articleId, load]);

  const angles = useMemo(() => Array.from(new Set((detail?.posts || []).map((p) => p.angle))).sort((a, b) => b - a), [detail]);
  const current = angle ?? angles[0] ?? null;
  const posts = useMemo(() => {
    const order = channels.map((c) => c.provider);
    return (detail?.posts || []).filter((p) => p.angle === current)
      .sort((a, b) => order.indexOf(a.provider) - order.indexOf(b.provider));
  }, [detail, current, channels]);
  const cardSource = posts.find((p) => p.media.length > 1) || posts[0];

  const errText = (code: string) => (t(`social.err.${code}`, { defaultValue: '' }) as string) || (t('social.err.generic', { code }) as string);

  const makeOg = async () => {
    if (!articleId) return;
    setBusy('og'); setErr(null);
    try { await socialCall(`${SOCIAL_API}/articles/${articleId}/og-image`, jsonInit('POST')); await load(); onListChanged(); } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  };
  const makeDraft = async () => {
    if (!articleId) return;
    setBusy('draft'); setErr(null);
    try {
      const r = await socialCall<{ hooks: string[]; angle: number }>(`${SOCIAL_API}/articles/${articleId}/drafts`, jsonInit('POST'));
      setHooks(r.hooks || []); setAngle(r.angle);
      await load(); onListChanged();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  };
  const onPostChanged = (p: SocialPost) => {
    setDetail((d) => (d ? { ...d, posts: d.posts.map((x) => (x.id === p.id ? p : x)) } : d));
    onListChanged();
  };

  const versionOptions: PlanQSelectOption[] = angles.map((a) => ({ value: String(a), label: t('social.draft.version', { n: a }) as string }));
  const a = detail?.article;

  return (
    <DetailDrawer open={!!articleId} onClose={onClose} ariaLabel={t('social.drawerLabel') as string}>
      <DetailDrawer.Header onClose={onClose}>
        <HeadTitle title={a?.title_ko}>{a?.title_ko || t('social.loading')}</HeadTitle>
      </DetailDrawer.Header>
      <DetailDrawer.Body>
        {err && <ErrLine role="alert">{errText(err)}</ErrLine>}
        {a && (
          <>
            <Section>
              <SecHead>
                <SecTitle>{t('social.og.title')}</SecTitle>
                <ActionButton tone="secondary" size="sm" loading={busy === 'og'} disabled={!!busy} onClick={makeOg} data-testid="social-og-make">
                  {a.og_image_url ? t('social.og.remake') : t('social.og.make')}
                </ActionButton>
              </SecHead>
              <SecDesc>{t('social.og.desc')}</SecDesc>
              {a.og_image_url
                ? <OgImg src={a.og_image_url} alt={t('social.og.alt', { title: a.title_ko }) as string} />
                : <OgEmpty>{t('social.ogMissing')}</OgEmpty>}
              <ArticleLink href={`/insights/${encodeURIComponent(a.slug)}`} target="_blank" rel="noopener noreferrer">{t('social.openArticle')} ↗</ArticleLink>
            </Section>

            <Section>
              <SecHead>
                <SecTitle>{t('social.draft.title')}</SecTitle>
                <ActionButton tone="primary" size="sm" loading={busy === 'draft'} disabled={!!busy} onClick={makeDraft} data-testid="social-draft-make">
                  {angles.length ? t('social.draft.makeMore') : t('social.draft.make')}
                </ActionButton>
              </SecHead>
              <SecDesc>{busy === 'draft' ? t('social.draft.making') : t('social.draft.desc')}</SecDesc>

              {hooks.length > 0 && (
                <Hooks>
                  <SubTitle>{t('social.draft.hooks')}</SubTitle>
                  <ol>{hooks.map((h) => <li key={h}>{h}</li>)}</ol>
                </Hooks>
              )}

              {angles.length > 1 && (
                <VersionRow>
                  <AxisLabel>{t('social.draft.versionAxis')}</AxisLabel>
                  <SelWrap>
                    <PlanQSelect size="sm" isSearchable={false} isClearable={false}
                      value={versionOptions.find((o) => o.value === String(current))} options={versionOptions}
                      onChange={(o) => setAngle(Number((o as PlanQSelectOption)?.value) || null)} />
                  </SelWrap>
                </VersionRow>
              )}

              {cardSource && cardSource.media.length > 0 && (
                <>
                  <SubTitle>{t('social.draft.cards')}</SubTitle>
                  <Cards>
                    {cardSource.media.map((m) => (
                      <CardThumb key={`${cardSource.id}-${m.index}`} postId={cardSource.id} idx={m.index}
                        alt={t('social.draft.cardAlt', { n: m.index + 1 }) as string}
                        downloadLabel={t('social.draft.download') as string}
                        fileName={`${a.slug}-${m.template}-${m.index + 1}.jpg`} />
                    ))}
                  </Cards>
                </>
              )}
            </Section>

            {posts.map((p) => (
              <SocialPostCard key={p.id} post={p} slug={a.slug}
                maxChars={channels.find((c) => c.provider === p.provider)?.max_chars || 5000}
                onChanged={onPostChanged} onError={setErr} />
            ))}
          </>
        )}
      </DetailDrawer.Body>
    </DetailDrawer>
  );
}

function CardThumb({ postId, idx, alt, downloadLabel, fileName }: { postId: number; idx: number; alt: string; downloadLabel: string; fileName: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null;
    let alive = true;
    fetchBlobUrl(mediaPath(postId, idx)).then((u) => { url = u; if (alive) setSrc(u); else URL.revokeObjectURL(u); }).catch(() => {});
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [postId, idx]);
  return (
    <Thumb>
      {src ? <img src={src} alt={alt} /> : <ThumbPh aria-label={alt} />}
      <ThumbBtn type="button" onClick={() => { void downloadMedia(postId, idx, fileName); }}>{downloadLabel}</ThumbBtn>
    </Thumb>
  );
}

const HeadTitle = styled.div`
  font-size: 1rem; font-weight: 700; color: #0F172A; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
`;
const ErrLine = styled.div`
  margin-bottom: 12px; padding: 10px 12px; border-radius: 8px; background: #FFF1F2; color: #BE123C; font-size: 0.8125rem;
`;
const Section = styled.section`
  display: flex; flex-direction: column; gap: 8px; padding-bottom: 16px; margin-bottom: 16px; border-bottom: 1px solid #E2E8F0;
`;
const SecHead = styled.div`display: flex; align-items: center; justify-content: space-between; gap: 8px;`;
const SecTitle = styled.h3`margin: 0; font-size: 0.875rem; font-weight: 700; color: #0F172A;`;
const SecDesc = styled.p`margin: 0; font-size: 0.75rem; color: #64748B; line-height: 1.55;`;
const SubTitle = styled.div`font-size: 0.75rem; font-weight: 600; color: #475569; margin-top: 4px;`;
const OgImg = styled.img`width: 100%; aspect-ratio: 1200 / 630; object-fit: cover; border-radius: 8px; border: 1px solid #E2E8F0;`;
const OgEmpty = styled.div`
  width: 100%; aspect-ratio: 1200 / 630; border-radius: 8px; border: 1px dashed #CBD5E1; background: #F8FAFC;
  display: flex; align-items: center; justify-content: center; font-size: 0.8125rem; color: #94A3B8;
`;
const ArticleLink = styled.a`font-size: 0.75rem; color: #0D9488; align-self: flex-start;`;
const Hooks = styled.div`
  background: #F0FDFA; border-radius: 8px; padding: 10px 12px;
  ol { margin: 6px 0 0; padding-left: 18px; font-size: 0.8125rem; color: #0F172A; line-height: 1.6; }
`;
const VersionRow = styled.div`display: flex; align-items: center; gap: 8px;`;
const AxisLabel = styled.span`font-size: 0.75rem; color: #64748B;`;
const SelWrap = styled.div`width: 140px;`;
const Cards = styled.div`display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px;`;
const Thumb = styled.figure`
  margin: 0; position: relative; border-radius: 8px; overflow: hidden; border: 1px solid #E2E8F0; background: #F8FAFC;
  img { display: block; width: 100%; aspect-ratio: 1080 / 1350; object-fit: cover; }
`;
const ThumbPh = styled.div`width: 100%; aspect-ratio: 1080 / 1350;`;
const ThumbBtn = styled.button`
  position: absolute; right: 6px; bottom: 6px; height: 32px; padding: 0 10px; border-radius: 6px; border: 1px solid #E2E8F0;
  background: rgba(255,255,255,.95); font-size: 0.75rem; color: #0F172A; cursor: pointer;
  &:hover { background: #fff; border-color: #14B8A6; }
`;
