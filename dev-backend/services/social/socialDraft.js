// 인사이트 글 → SNS 소재 초안 (docs/SNS_PUBLISH_DESIGN.md §6).
//   글 본문 → { hooks[5], cards[4](템플릿별 문구), channels{provider: 본문} }. 사람이 보고 고친 뒤 승인한다.
//   ★ 숫자를 지어내지 않는다 — 숫자 카드는 글에 있는 숫자만, 없으면 «핵심 N가지» 같은 개수로.
//   ★ 본문에 URL 을 쓰지 않게 하고, 써도 지운다 — 링크는 서버가 utm 을 붙여 채널 규칙대로 붙인다(channels.linkUrlFor).
const { callLLM } = require('../llm');
const { blocksToParagraphs } = require('../seoArtifacts');
const { CHANNELS, channelOf, linkUrlFor } = require('./channels');
const { TEMPLATE_KEYS } = require('./cardTemplates');

const SYSTEM = `너는 B2B SaaS «PlanQ»(업무관리·고객 소통 통합 도구)의 소셜 마케터다. 회사 블로그(인사이트) 글 하나를 SNS 채널별 게시물로 다시 쓴다.
원칙:
- 독자는 소규모 사업자·에이전시·프리랜서 팀 대표와 실무자. 첫 줄(훅)에서 손을 멈추게 한다. 과장·낚시·이모지 남발 금지(채널당 0~3개).
- 글에 없는 사실·통계·고객 사례를 지어내지 않는다. 숫자는 글에 있는 것만 쓴다. 없으면 «핵심 3가지» 처럼 글의 항목 수를 쓴다.
- URL·링크·해시 주소를 본문에 쓰지 않는다(링크는 시스템이 붙인다). 해시태그는 instagram·threads 에만 3~6개.
- 한국어로 쓴다.
채널별:
- linkedin: 전문가 어조, 짧은 문단, 1,200자 이내. 마지막 줄은 «자세한 내용은 첫 댓글 링크에서».
- facebook: 친근한 설명형, 600자 이내.
- instagram: 카드 넘겨보기를 유도, 800자 이내, 마지막에 «프로필 링크에서 전문 보기» + 해시태그.
- threads: 대화체 한 덩어리, 공백 포함 380자 이내(엄격), 해시태그 1~3개.
- naver: 블로그 원고. 제목 줄 1개 + 소제목 2~4개가 있는 본문 1,500~2,500자. 원문을 그대로 베끼지 말고 요약·재구성.
- kakao: 채널 메시지, 300자 이내, 한 가지 행동 유도.
카드 4장(이미지에 들어갈 문구, 짧게):
- problem: { tag(8자 이내), headline(35자 이내 질문형), sub(60자 이내) }
- checklist: { tag(8자), title(30자 이내), items: 3~5개(각 30자 이내) }
- beforeafter: { title(30자 이내), before_label(6자), after_label(6자), before: 2~3개(각 25자 이내), after: 2~3개(각 25자 이내) }
- number: { tag(8자), number(6자 이내, 예 «3가지»·«40%»), caption(30자 이내), sub(60자 이내) }
JSON 만 출력: {"hooks":[5개 문자열],"cards":[{"template":"problem",...},{"template":"checklist",...},{"template":"beforeafter",...},{"template":"number",...}],"channels":{"linkedin":"","facebook":"","instagram":"","threads":"","naver":"","kakao":""}}`;

const URL_RE = /\bhttps?:\/\/\S+/gi;
const clean = (s, max) => String(s == null ? '' : s).replace(URL_RE, '').replace(/[ \t]+\n/g, '\n').trim().slice(0, max);
const cleanList = (arr, n, max) => (Array.isArray(arr) ? arr : []).map((x) => clean(x, max)).filter(Boolean).slice(0, n);

function normalizeCard(c, template) {
  const x = c && typeof c === 'object' ? c : {};
  switch (template) {
    case 'problem': return { template, tag: clean(x.tag, 16), headline: clean(x.headline, 80), sub: clean(x.sub, 140) };
    case 'checklist': return { template, tag: clean(x.tag, 16), title: clean(x.title, 70), items: cleanList(x.items, 5, 70) };
    case 'beforeafter': return {
      template, title: clean(x.title, 70), before_label: clean(x.before_label, 12), after_label: clean(x.after_label, 12),
      before: cleanList(x.before, 3, 60), after: cleanList(x.after, 3, 60),
    };
    case 'number': return { template, tag: clean(x.tag, 16), number: clean(x.number, 12), caption: clean(x.caption, 70), sub: clean(x.sub, 140) };
    default: return null;
  }
}

/** 카드가 쓸모 있는가 — 빈 칸이 있으면 렌더하지 않는다(빈 카드가 나가는 것보다 실패가 낫다). */
function cardComplete(c) {
  if (!c) return false;
  if (c.template === 'problem') return !!(c.headline && c.sub);
  if (c.template === 'checklist') return !!(c.title && c.items.length >= 3);
  if (c.template === 'beforeafter') return !!(c.title && c.before.length && c.after.length);
  if (c.template === 'number') return !!(c.number && c.caption);
  return false;
}

/** 채널 본문 + 서버가 붙이는 링크. linkedin 은 링크를 첫 댓글로, instagram 은 링크를 붙이지 않는다(누를 수 없다). */
function composeChannel(provider, body, slug) {
  const ch = channelOf(provider);
  const link = linkUrlFor(slug, provider);
  const text = clean(body, ch.maxChars);
  if (provider === 'linkedin') return { body: text, first_comment: link, link_url: link };
  if (!ch.linkInBody) return { body: text, first_comment: null, link_url: link };
  return { body: `${text}\n\n${link}`, first_comment: null, link_url: link };
}

/**
 * @returns {{ ok:true, hooks, cards, channels:{[provider]:{body, first_comment, link_url}} } | { ok:false, reason }}
 */
async function draftForArticle(article) {
  const paras = blocksToParagraphs(article.body_ko, 'ko', 12_000);
  const user = [
    `제목: ${article.title_ko}`,
    article.summary_ko ? `요약: ${article.summary_ko}` : '',
    `분류: ${article.blog_category || '인사이트'}`,
    '본문:',
    paras.join('\n'),
  ].filter(Boolean).join('\n');
  const r = await callLLM({
    purpose: 'social_draft',
    json: true,
    messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }],
  });
  if (r.fallback || !r.content) return { ok: false, reason: 'llm_unavailable' };
  let j;
  try { j = JSON.parse(r.content); } catch { return { ok: false, reason: 'llm_bad_json' }; }
  const byTpl = {};
  for (const c of Array.isArray(j.cards) ? j.cards : []) if (c && TEMPLATE_KEYS.includes(c.template) && !byTpl[c.template]) byTpl[c.template] = c;
  const cards = TEMPLATE_KEYS.map((t) => normalizeCard(byTpl[t], t)).filter(cardComplete);
  if (!cards.length) return { ok: false, reason: 'llm_no_cards' };
  const channels = {};
  for (const ch of CHANNELS) {
    const body = j.channels && j.channels[ch.provider];
    if (typeof body === 'string' && body.trim()) channels[ch.provider] = composeChannel(ch.provider, body, article.slug);
  }
  if (!Object.keys(channels).length) return { ok: false, reason: 'llm_no_channels' };
  return { ok: true, hooks: cleanList(j.hooks, 5, 120), cards, channels };
}

module.exports = { draftForArticle, normalizeCard, cardComplete, composeChannel };
