// #194 제품 공지/체인지로그 — 'updates' 카테고리 + 첫 공지 seed (멱등, slug upsert).
//   콘텐츠는 help_articles(blog_category='updates') 로 저장 — 별도 CMS 없음.
//   위키 KB 오염 방지: indexArticle 호출 안 함(updates 는 위키 검색/RAG 대상 아님).
//   운영 적용: node seed-changelog.js
require('dotenv').config();
const { sequelize } = require('./config/database');
const HelpCategory = require('./models/HelpCategory');
const HelpArticle = require('./models/HelpArticle');

// 블록 헬퍼 — body_ko/body_en 은 언어별 배열(블록마다 text_{lang})
const koBlocks = (arr) => arr.map((b) => ({ type: b.type, text_ko: b.ko }));
const enBlocks = (arr) => arr.map((b) => ({ type: b.type, text_en: b.en }));

async function run() {
  await sequelize.authenticate();

  // 1) 'updates' 카테고리 (위키 목록에서는 제외됨 — routes/wiki.js)
  const [cat] = await HelpCategory.findOrCreate({
    where: { slug: 'updates' },
    defaults: {
      slug: 'updates',
      title_ko: '제품 소식', title_en: 'What\'s new',
      summary_ko: 'PlanQ의 새 기능과 개선 소식', summary_en: 'New features and improvements in PlanQ',
      icon: 'megaphone', sort_order: 999,
    },
  });

  // 2) 첫 공지 — "새 소식" 채널 오픈 안내 (실제 콘텐츠, Irene 이 관리자에서 편집 가능)
  const blocks = [
    { type: 'text', ko: '이제 PlanQ의 새로운 기능과 개선 소식을 이 곳에서 바로 확인할 수 있어요. 사이드바 상단의 확성기 아이콘을 누르면 언제든 최신 소식을 볼 수 있습니다.',
      en: 'You can now catch up on new PlanQ features and improvements right here. Tap the megaphone icon at the top of the sidebar anytime to see the latest updates.' },
    { type: 'heading', ko: '어디서 볼 수 있나요?', en: 'Where can I find it?' },
    { type: 'step', ko: '앱 안 — 사이드바 상단 확성기 아이콘 → "새 소식" 패널', en: 'In-app — the megaphone icon at the top of the sidebar opens the "What\'s new" panel.' },
    { type: 'step', ko: '웹 — planq.kr/changelog 에서 전체 소식을 모아볼 수 있어요', en: 'On the web — browse all updates at planq.kr/changelog.' },
    { type: 'callout', ko: '새 소식이 있으면 확성기 아이콘에 빨간 배지로 알려드려요.', en: 'A red badge on the megaphone icon lets you know when there\'s something new.' },
  ];

  const slug = 'welcome-whats-new';
  const payload = {
    slug,
    category_id: cat.id,
    title_ko: '‘새 소식’ 으로 업데이트를 한눈에', title_en: 'Keep up with updates in ‘What’s new’',
    summary_ko: 'PlanQ의 새 기능·개선 소식을 앱과 웹에서 바로 확인하세요.',
    summary_en: 'See new PlanQ features and improvements in-app and on the web.',
    body_ko: koBlocks(blocks),
    body_en: enBlocks(blocks),
    visibility: 'public',
    is_published: true,
    blog_category: 'updates',
    blog_published_at: new Date(),
    est_minutes: 1,
    sort_order: 0,
  };

  const existing = await HelpArticle.findOne({ where: { slug } });
  if (existing) {
    // 발행일(blog_published_at)은 최초값 보존 — 재실행해도 "새 소식"으로 재부상하지 않게
    const { blog_published_at, ...rest } = payload;
    await existing.update({ ...rest, blog_published_at: existing.blog_published_at || blog_published_at });
    console.log('updated:', slug, 'cat', cat.id);
  } else {
    await HelpArticle.create(payload);
    console.log('created:', slug, 'cat', cat.id);
  }

  process.exit(0);
}
run().catch((e) => { console.error('seed-changelog FAIL', e); process.exit(1); });
