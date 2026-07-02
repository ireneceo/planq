// KNOWLEDGE_LOOP 축3 — 랜딩 블로그 글 상세 (/blog/:slug). 소스 = Q위키 발행분.
// 블록 렌더는 WikiArticlePage 와 같은 구조 (heading/text/step/callout/image), 랜딩 톤(teal).
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import LandingLayout from '../../components/Landing/LandingLayout';
import type { BlogPostCard } from './BlogPage';

interface BlogBlock {
  type: 'heading' | 'text' | 'step' | 'callout' | 'image';
  text_ko?: string; text_en?: string;
  caption_ko?: string; caption_en?: string;
  file_id?: number;
}
interface BlogPostDetail extends BlogPostCard {
  body_ko?: BlogBlock[] | null;
  body_en?: BlogBlock[] | null;
}

const BlogPostPage: React.FC = () => {
  const { slug = '' } = useParams();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation('landing');
  const [post, setPost] = useState<BlogPostDetail | null>(null);
  const [status, setStatus] = useState<'loading' | 'ok' | 'notfound'>('loading');

  const lang = (i18n.language || 'ko').slice(0, 2) === 'en' ? 'en' : 'ko';

  useEffect(() => {
    let alive = true;
    setStatus('loading');
    window.scrollTo(0, 0);
    fetch(`/api/blog/posts/${encodeURIComponent(slug)}`)
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        if (j.success) { setPost(j.data); setStatus('ok'); } else setStatus('notfound');
      })
      .catch(() => { if (alive) setStatus('notfound'); });
    return () => { alive = false; };
  }, [slug]);

  // SEO — 제목/설명 meta (랜딩 공개 페이지)
  useEffect(() => {
    if (!post) return;
    const title = (lang === 'en' ? post.title_en : post.title_ko) || post.title_ko;
    const desc = (lang === 'en' ? post.summary_en : post.summary_ko) || post.summary_ko || '';
    const prevTitle = document.title;
    document.title = `${title} | PlanQ`;
    let meta = document.querySelector('meta[name="description"]') as HTMLMetaElement | null;
    const prevDesc = meta?.content;
    if (desc) {
      if (!meta) { meta = document.createElement('meta'); meta.name = 'description'; document.head.appendChild(meta); }
      meta.content = String(desc);
    }
    return () => {
      document.title = prevTitle;
      if (meta && prevDesc !== undefined) meta.content = prevDesc;
    };
  }, [post, lang]);

  const blocks: BlogBlock[] = (lang === 'en' ? post?.body_en : post?.body_ko) || post?.body_ko || post?.body_en || [];
  const blockText = (b: BlogBlock) => (lang === 'en' ? b.text_en : b.text_ko) || b.text_ko || b.text_en || '';
  let stepNo = 0;

  return (
    <LandingLayout transparentTop={false}>
      <ArticleSection>
        <Container>
          <Back type="button" onClick={() => navigate('/blog')}>← {t('blogPost.back', '인사이트 목록으로')}</Back>
          {status === 'loading' ? (
            <Muted>{t('blogPost.loading', '불러오는 중…')}</Muted>
          ) : status === 'notfound' || !post ? (
            <Muted>{t('blogPost.notFound', '글을 찾을 수 없습니다.')}</Muted>
          ) : (
            <ArticleWrap>
              {post.blog_category && <Eyebrow>{t(`blogPage.categories.${post.blog_category}`, post.blog_category)}</Eyebrow>}
              <Title>{(lang === 'en' ? post.title_en : post.title_ko) || post.title_ko}</Title>
              <Meta>
                <span>{new Date(post.published_at).toLocaleDateString(lang === 'en' ? 'en-US' : 'ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
                {post.est_minutes ? <span>· {t('blogPage.readMinutes', '{{n}}분', { n: post.est_minutes })}</span> : null}
              </Meta>
              {((lang === 'en' ? post.summary_en : post.summary_ko) || post.summary_ko) && (
                <Lead>{(lang === 'en' ? post.summary_en : post.summary_ko) || post.summary_ko}</Lead>
              )}
              <Body>
                {blocks.map((b, i) => {
                  if (b.type === 'heading') { stepNo = 0; return <H3 key={i}>{blockText(b)}</H3>; }
                  if (b.type === 'callout') return <Callout key={i}>{blockText(b)}</Callout>;
                  if (b.type === 'step') { stepNo += 1; return <Step key={i}><span>{stepNo}</span><p>{blockText(b)}</p></Step>; }
                  if (b.type === 'image' && b.file_id) {
                    const cap = (lang === 'en' ? b.caption_en : b.caption_ko) || b.caption_ko || '';
                    return (
                      <Figure key={i}>
                        <img src={`/api/wiki/image/${b.file_id}`} alt={cap} loading="lazy" />
                        {cap && <figcaption>{cap}</figcaption>}
                      </Figure>
                    );
                  }
                  return <P key={i}>{blockText(b)}</P>;
                })}
              </Body>
              <CtaBand>
                <CtaTitle>{t('blogPost.ctaTitle', '읽는 것보다 써 보는 게 빠릅니다')}</CtaTitle>
                <CtaBtn to="/register">{t('blogPage.cta.btn', '무료로 시작하기')}</CtaBtn>
              </CtaBand>
            </ArticleWrap>
          )}
        </Container>
      </ArticleSection>
    </LandingLayout>
  );
};

export default BlogPostPage;

// ─── styled ───
const Container = styled.div`max-width: 760px; margin: 0 auto; padding: 0 24px; @media (max-width: 640px) { padding: 0 16px; }`;
const ArticleSection = styled.section`padding: 110px 0 80px; background: #FFFFFF;`;
const Back = styled.button`
  border: 0; background: none; color: #64748B; font-size: 13px; font-weight: 600; cursor: pointer; padding: 0 0 20px;
  &:hover { color: #0D9488; }
`;
const ArticleWrap = styled.article``;
const Eyebrow = styled.div`
  font-family: 'Outfit', sans-serif;
  font-size: 12px; font-weight: 600; color: #0D9488; letter-spacing: 1.5px; margin-bottom: 10px; text-transform: uppercase;
`;
const Title = styled.h1`font-size: 36px; font-weight: 700; color: #0F172A; line-height: 1.35; margin: 0 0 12px; word-break: keep-all; @media (max-width: 768px) { font-size: 27px; }`;
const Meta = styled.div`display: flex; gap: 5px; font-size: 13px; color: #94A3B8; margin-bottom: 18px;`;
const Lead = styled.p`font-size: 17px; color: #475569; line-height: 1.7; margin: 0 0 28px; word-break: keep-all;`;
const Body = styled.div`display: flex; flex-direction: column; gap: 16px;`;
const H3 = styled.h3`font-size: 21px; font-weight: 700; color: #0F172A; margin: 18px 0 0;`;
const P = styled.p`font-size: 16px; color: #334155; line-height: 1.8; margin: 0;`;
const Callout = styled.div`
  background: #F0FDFA; border-left: 3px solid #14B8A6; border-radius: 0 8px 8px 0; padding: 14px 18px;
  font-size: 15px; color: #134E4A; line-height: 1.7;
`;
const Step = styled.div`
  display: flex; gap: 12px; align-items: flex-start;
  span { flex-shrink: 0; width: 26px; height: 26px; border-radius: 999px; background: #14B8A6; color: #fff; font-size: 13px; font-weight: 700; display: flex; align-items: center; justify-content: center; }
  p { margin: 0; font-size: 16px; color: #334155; line-height: 1.7; padding-top: 2px; }
`;
const Figure = styled.figure`
  margin: 8px 0; border: 1px solid #E2E8F0; border-radius: 12px; overflow: hidden;
  img { display: block; width: 100%; height: auto; }
  figcaption { font-size: 12px; color: #94A3B8; padding: 8px 12px; }
`;
const Muted = styled.div`color: #94A3B8; font-size: 14px; padding: 60px 0; text-align: center;`;
const CtaBand = styled.div`
  margin-top: 48px; padding: 36px 28px; border-radius: 16px; text-align: center;
  background: linear-gradient(160deg, #0F172A 0%, #134E4A 100%);
  display: flex; flex-direction: column; align-items: center; gap: 16px;
`;
const CtaTitle = styled.h2`font-size: 22px; font-weight: 700; color: #FFFFFF; margin: 0; word-break: keep-all;`;
const CtaBtn = styled(Link)`
  padding: 13px 36px; border-radius: 999px; background: #14B8A6; color: #FFFFFF;
  font-size: 15px; font-weight: 500; text-decoration: none;
  &:hover { background: #0D9488; }
`;
