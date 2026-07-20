import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import PageShell from '../../components/Layout/PageShell';
import { useImageLightbox } from '../../components/Common/ImageLightbox';
import { fetchWikiArticle, type WikiArticleDetail, type WikiBlock } from '../../services/wiki';
import { mediaPhone } from '../../theme/breakpoints';
import { useAuth } from '../../contexts/AuthContext';

export default function WikiArticlePage() {
  const { slug = '' } = useParams();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation('wiki');
  const { open: openLightbox, lightbox } = useImageLightbox();
  // 위키 본문은 비회원에게 완전 공개다. 다만 '화면 열기'는 로그인해야 닿는 앱 화면으로 점프하므로
  // 비회원에겐 아예 숨긴다 (로그인 벽 문구를 띄우지 않는다 — Irene 결정).
  const { user } = useAuth();

  const [article, setArticle] = useState<WikiArticleDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true); setStatus(null);
    window.scrollTo(0, 0);
    fetchWikiArticle(slug)
      .then((a) => { if (alive) setArticle(a); })
      .catch((e: Error & { status?: number }) => { if (alive) setStatus(e.status || 500); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [slug]);

  const lang = (i18n.language || 'ko').slice(0, 2) === 'en' ? 'en' : 'ko';
  const blockText = (b: WikiBlock) => (lang === 'en' ? b.text_en : b.text_ko) || b.text_ko || b.text_en || '';
  const blockCaption = (b: WikiBlock) => (lang === 'en' ? b.caption_en : b.caption_ko) || b.caption_ko || b.caption_en || '';

  return (
    <PageShell title={t('page.title')}>
      <Back onClick={() => navigate('/wiki')}>← {t('article.back')}</Back>

      {loading ? (
        <Muted>{t('page.loading')}</Muted>
      ) : status === 401 ? (
        <Muted>{t('article.loginRequired')}</Muted>
      ) : status || !article ? (
        <Muted>{t('article.notFound')}</Muted>
      ) : (
        <Wrap>
          {article.category && <Eyebrow>{article.category.title}</Eyebrow>}
          <Title>{article.title}</Title>
          {article.summary && <Lead>{article.summary}</Lead>}
          {article.linked_route && user && (
            <OpenScreen onClick={() => navigate(article.linked_route as string)}>
              {t('article.openScreen')} →
            </OpenScreen>
          )}

          <Body>
            {(() => {
              // 이미지 블록 클릭 시 확대 라이트박스 (전체 이미지 갤러리로 묶음)
              const imgs = (article.body || []).filter(b => b.type === 'image' && b.file_id)
                .map(b => ({ src: `/api/wiki/image/${b.file_id}`, alt: blockCaption(b) }));
              return (article.body || []).map((b, i) => {
                if (b.type === 'heading') return <H3 key={i}>{blockText(b)}</H3>;
                if (b.type === 'callout') return <Callout key={i}>{blockText(b)}</Callout>;
                if (b.type === 'step') return <Step key={i}><span>{i + 1}</span><p>{blockText(b)}</p></Step>;
                if (b.type === 'image') {
                  const cap = blockCaption(b);
                  const src = `/api/wiki/image/${b.file_id}`;
                  return b.file_id ? (
                    <Figure key={i}>
                      <ImgBtn type="button" onClick={() => openLightbox(imgs, Math.max(0, imgs.findIndex(x => x.src === src)))}
                        title={t('article.zoom', { defaultValue: '클릭하여 확대' }) as string}>
                        <img src={src} alt={cap} loading="lazy" />
                      </ImgBtn>
                      {cap && <figcaption>{cap}</figcaption>}
                    </Figure>
                  ) : null;
                }
                return <P key={i}>{blockText(b)}</P>;
              });
            })()}
          </Body>
          {lightbox}

          {article.related && article.related.length > 0 && (
            <Related>
              <RelatedHead>{t('article.related')}</RelatedHead>
              <RelatedList>
                {article.related.map((r) => (
                  <RelatedItem key={r.id} onClick={() => navigate(`/wiki/a/${r.slug}`)}>
                    <span>{r.title}</span>
                    {r.summary && <small>{r.summary}</small>}
                  </RelatedItem>
                ))}
              </RelatedList>
            </Related>
          )}
        </Wrap>
      )}
    </PageShell>
  );
}

const Back = styled.button`
  border: 0; background: none; color: #64748b; font-size: 13px; font-weight: 600; cursor: pointer; padding: 0 0 16px;
  &:hover { color: #F43F5E; }
`;
const Wrap = styled.article` max-width: 760px; `;
const Eyebrow = styled.div` font-size: 12px; font-weight: 700; color: #F43F5E; margin-bottom: 8px; `;
const Title = styled.h1` font-size: 26px; font-weight: 800; color: #0f172a; margin: 0 0 10px; line-height: 1.3; `;
const Lead = styled.p` font-size: 15px; color: #475569; line-height: 1.6; margin: 0 0 18px; `;
const OpenScreen = styled.button`
  border: 1px solid #F43F5E; background: #fff; color: #F43F5E; font-size: 13px; font-weight: 700; border-radius: 8px;
  padding: 9px 16px; cursor: pointer; margin-bottom: 24px;
  &:hover { background: #FFF1F2; }
`;
const Body = styled.div` display: flex; flex-direction: column; gap: 14px; `;
const H3 = styled.h3` font-size: 17px; font-weight: 700; color: #0f172a; margin: 12px 0 0; `;
const P = styled.p` font-size: 15px; color: #334155; line-height: 1.7; margin: 0; `;
const Callout = styled.div`
  background: #FFF7ED; border-left: 3px solid #fb923c; border-radius: 0 8px 8px 0; padding: 12px 16px;
  font-size: 14px; color: #7c2d12; line-height: 1.6;
`;
const Step = styled.div`
  display: flex; gap: 12px; align-items: flex-start;
  span { flex-shrink: 0; width: 24px; height: 24px; border-radius: 999px; background: #F43F5E; color: #fff; font-size: 13px; font-weight: 700; display: flex; align-items: center; justify-content: center; }
  p { margin: 0; font-size: 15px; color: #334155; line-height: 1.6; padding-top: 1px; }
`;
const Figure = styled.figure`
  margin: 8px 0; border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden;
  img { display: block; width: 100%; height: auto; }
  figcaption { font-size: 12px; color: #94a3b8; padding: 8px 12px; }
`;
const ImgBtn = styled.button` display: block; width: 100%; padding: 0; border: none; background: none; cursor: zoom-in; `;
const Related = styled.section` margin-top: 36px; border-top: 1px solid #e2e8f0; padding-top: 20px; `;
const RelatedHead = styled.h4` font-size: 14px; font-weight: 700; color: #0f172a; margin: 0 0 12px; `;
const RelatedList = styled.div`
  display: grid; grid-template-columns: 1fr 1fr; gap: 10px;
  ${mediaPhone} { grid-template-columns: 1fr; }
`;
const RelatedItem = styled.button`
  text-align: left; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px 14px; cursor: pointer;
  display: flex; flex-direction: column; gap: 3px;
  span { font-size: 14px; font-weight: 600; color: #0f172a; }
  small { font-size: 12px; color: #94a3b8; line-height: 1.4; }
  &:hover { border-color: #F43F5E; }
`;
const Muted = styled.div` color: #94a3b8; font-size: 14px; padding: 40px 0; text-align: center; `;
