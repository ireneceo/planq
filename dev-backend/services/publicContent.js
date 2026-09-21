// 공개 콘텐츠 조회 조건 — 인사이트(blog) 라우트와 검색용 페이지·사이트맵 생성(seoArtifacts)이 **같은 조건**을 쓴다.
//   두 곳에 따로 적으면 «화면엔 없는 글이 사이트맵에 있다» 가 생긴다(같은 값의 공식이 두 벌).
//   (routes/blog.js 에서 그대로 옮겼다 — 값 변경 없음, 2026-09-21)
const { Op } = require('sequelize');

const BLOG_EXCLUDED_CATEGORIES = ['how-to'];

const BLOG_WHERE = {
  blog_published_at: { [Op.ne]: null },
  is_published: true,
  visibility: 'public',
  // NULL 안전 — `NOT IN` 은 NULL 에 대해 NULL(=거짓)이라, 그냥 쓰면 카테고리 미지정 글이 통째로 사라진다.
  [Op.or]: [
    { blog_category: null },
    { blog_category: { [Op.notIn]: BLOG_EXCLUDED_CATEGORIES } },
  ],
};


// 위키 — 게스트(검색 봇)가 볼 수 있는 것: 발행 + public (routes/wiki.js visibilityWhere 의 게스트 분기와 같다)
const WIKI_PUBLIC_WHERE = { is_published: true, visibility: 'public' };

module.exports = { BLOG_EXCLUDED_CATEGORIES, BLOG_WHERE, WIKI_PUBLIC_WHERE };
