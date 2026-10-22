// 공개 링크 미리보기(OG)의 **대상 판정 한 곳** — #362 · #373
//
// 왜 이 파일이 생겼나: 같은 "공개 발행 글" 조건이 세 곳에 흩어져 있었다 —
//   routes/blog.js(목록·본문) · routes/og.js(사람용 SPA 렌더) · middleware/ogMeta.js(크롤러용).
//   조건이 갈라지면 "브라우저에선 보이는데 카톡 미리보기엔 안 나오는" 글이 생기고,
//   더 나쁘게는 **미발행 글이 크롤러에게만 새는** 방향으로도 갈라질 수 있다.
//   공개 여부를 정하는 술어는 한 벌이어야 한다.
const { Op } = require('sequelize');

/** 랜딩 인사이트(블로그)에 실제로 공개된 글인가 — routes/blog.js BLOG_WHERE 와 같은 조건 */
function publishedInsightWhere(slug) {
  return {
    slug: String(slug || '').slice(0, 200),
    blog_published_at: { [Op.ne]: null },
    is_published: true,
    visibility: 'public',
  };
}

/**
 * 글별 링크 미리보기 이미지 주소 — 없으면 null(부르는 쪽이 플랫폼 기본 이미지로 떨어진다).
 *   공개 문은 GET /api/insights/:slug/og.jpg 하나(routes/insight_og.js — 같은 publishedInsightWhere 로 판정).
 *   ?v= 는 다시 만들 때 SNS·메신저 캐시를 넘기려는 것(updated_at 초). 봇 응답(ogMeta)과 정적 페이지(seoArtifacts)가 같이 쓴다.
 */
function insightOgImageUrl(a) {
  if (!a || !a.og_image_path || !a.slug) return null;
  const origin = String(process.env.APP_URL || 'https://planq.kr').replace(/\/+$/, '');
  const at = a.updatedAt || a.updated_at;
  const v = at ? Math.floor(new Date(at).getTime() / 1000) : 0;
  return `${origin}/api/insights/${encodeURIComponent(a.slug)}/og.jpg${v ? `?v=${v}` : ''}`;
}

/**
 * slug → 미리보기에 쓸 제목·설명. 공개 대상이 아니면 null.
 *
 * ★ 노출 범위는 **제목과 요약까지**다. 본문을 넣지 않는 이유는 링크가 채팅방에 붙는 순간
 *   참여자 전원이 보기 때문 — 미리보기는 "무엇에 대한 글인가" 까지만 알려주면 된다.
 */
async function resolveInsight(slug) {
  try {
    const HelpArticle = require('../models/HelpArticle');
    const a = await HelpArticle.findOne({
      where: publishedInsightWhere(slug),
      attributes: ['slug', 'title_ko', 'title_en', 'summary_ko', 'summary_en', 'og_image_path', 'updatedAt'],
    });
    if (!a) return null;
    const title = a.title_ko || a.title_en;
    if (!title) return null;
    return {
      slug: a.slug,
      title: String(title),
      description: String(a.summary_ko || a.summary_en || '') || null,
      image: insightOgImageUrl(a),
    };
  } catch (e) {
    console.warn('[ogSources] resolveInsight', e.message);
    return null;
  }
}

module.exports = { publishedInsightWhere, resolveInsight, insightOgImageUrl };
