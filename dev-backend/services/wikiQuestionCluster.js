// KNOWLEDGE_LOOP 축2 — Q위키 자기강화 루프 (docs/KNOWLEDGE_LOOP_DESIGN.md)
//   미답변·불만족 Q helper 질문을 임베딩 클러스터링(≥0.85, ≥3건 — emailFaqCluster 와 동일 원리)
//   → 클러스터별 위키 초안 자동 생성 (is_published=false, origin='auto_cluster')
//   → platform_admin 검토·발행 시 기존 admin_wiki 흐름이 재임베딩까지 처리.
//   LLM 은 초안 생성 시점에만 사용 (gpt-4o-mini). 자동 발행은 하지 않는다 (사람 승인 게이트).
const { Op } = require('sequelize');
const cron = require('node-cron');
const { HelpQuestionLog, HelpArticle, HelpCategory } = require('../models');
const { embedText, blobToFloats, cosineSimilarity } = require('./kb_service');

const SIM_THRESHOLD = 0.85;
const MIN_CLUSTER = 3;
const WINDOW_DAYS = 30;
const MAX_LOGS = 500;
// LLM 호출은 게이트웨이 단일 지점을 지난다 (services/llm.js).
const { callLLM, isEnabled } = require('./llm');

// 초안이 쌓이는 카테고리 (관리자가 발행 시 올바른 카테고리로 이동)
async function ensureSuggestedCategory() {
  const [cat] = await HelpCategory.findOrCreate({
    where: { slug: 'suggested' },
    defaults: { slug: 'suggested', title_ko: '제안됨 (검토 대기)', title_en: 'Suggested (pending review)', sort_order: 99 },
  });
  return cat;
}

function draftSlug(repQuestion) {
  const base = String(repQuestion).toLowerCase().replace(/[^a-z0-9가-힣]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'draft';
  return `auto-${base}-${Date.now().toString(36)}`.slice(0, 80);
}

// 클러스터 → 위키 초안 (ko/en, 위키 body 블록 형식)
async function generateDraft(questions) {
  if (!isEnabled()) return null;
  const { content, fallback } = await callLLM({
    purpose: 'wiki_cluster',
    json: true,
    timeoutMs: 60_000,   // 옛 호출부 값 보존 (초안 생성은 길다)
    messages: [
      {
        role: 'system',
        content: `You draft help-center articles for PlanQ (B2B work-management SaaS). Users repeatedly asked the questions below but the wiki had no good answer. Write ONE article draft that answers them. You may not know PlanQ internals — write the best general structure and mark uncertain spots with [확인 필요]. Return JSON:
{"title_ko":"...","title_en":"...","summary_ko":"<=200자","summary_en":"...","body_ko":[{"type":"text","text_ko":"..."},{"type":"step","text_ko":"..."}],"body_en":[{"type":"text","text_en":"..."},{"type":"step","text_en":"..."}]}
block types: heading|text|step|callout. 3~8 blocks per language.`,
      },
      { role: 'user', content: `반복 질문들:\n${questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}` },
    ],
    fallback: '',
  });
  if (fallback) return null;
  try {
    const d = JSON.parse(content || '{}');
    if (!d.title_ko || !d.title_en) return null;
    return d;
  } catch { return null; }
}

async function runWikiQuestionClustering() {
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const logs = await HelpQuestionLog.findAll({
    where: {
      created_at: { [Op.gte]: since },
      processed_article_id: null,
      [Op.or]: [{ answered: false }, { feedback: 'not_helpful' }],
    },
    order: [['created_at', 'DESC']],
    limit: MAX_LOGS,
  });
  if (logs.length < MIN_CLUSTER) return { clusters: 0, created: 0, reason: 'too_few_logs' };

  // 임베딩 (질문은 짧아 캐시 없이 매회 — 상한 500)
  const items = [];
  for (const l of logs) {
    const emb = await embedText(String(l.question).slice(0, 500));
    const vec = emb ? blobToFloats(emb) : null;
    if (vec) items.push({ log: l, vec });
  }
  if (items.length < MIN_CLUSTER) return { clusters: 0, created: 0, reason: 'embedding_unavailable' };

  // 그리디 클러스터링
  const used = new Array(items.length).fill(false);
  const clusters = [];
  for (let i = 0; i < items.length; i++) {
    if (used[i]) continue;
    const cluster = [i];
    used[i] = true;
    for (let j = i + 1; j < items.length; j++) {
      if (used[j]) continue;
      if (cosineSimilarity(items[i].vec, items[j].vec) >= SIM_THRESHOLD) { cluster.push(j); used[j] = true; }
    }
    if (cluster.length >= MIN_CLUSTER) clusters.push(cluster);
  }
  if (!clusters.length) return { clusters: 0, created: 0, reason: 'no_cluster' };

  const cat = await ensureSuggestedCategory();
  let created = 0;
  for (const cl of clusters) {
    const members = cl.map((idx) => items[idx]);
    // medoid = 평균 유사도 최대 (대표 질문)
    let bestIdx = 0; let bestAvg = -1;
    for (let a = 0; a < members.length; a++) {
      let s = 0;
      for (let b = 0; b < members.length; b++) if (a !== b) s += cosineSimilarity(members[a].vec, members[b].vec);
      const avg = members.length > 1 ? s / (members.length - 1) : 0;
      if (avg > bestAvg) { bestAvg = avg; bestIdx = a; }
    }
    const rep = members[bestIdx].log;
    const sampleQuestions = [...new Set(members.map((m) => m.log.question))].slice(0, 5);

    const draft = await generateDraft(sampleQuestions);
    if (!draft) continue;

    const article = await HelpArticle.create({
      slug: draftSlug(draft.title_en || rep.question),
      category_id: cat.id,
      title_ko: String(draft.title_ko).slice(0, 160),
      title_en: String(draft.title_en).slice(0, 160),
      summary_ko: draft.summary_ko ? String(draft.summary_ko).slice(0, 400) : null,
      summary_en: draft.summary_en ? String(draft.summary_en).slice(0, 400) : null,
      body_ko: Array.isArray(draft.body_ko) ? draft.body_ko : null,
      body_en: Array.isArray(draft.body_en) ? draft.body_en : null,
      visibility: 'authenticated',
      is_published: false, // 사람 승인 게이트 — 검토·발행은 admin
      origin: 'auto_cluster',
      origin_meta: {
        question_samples: sampleQuestions,
        occurrence_count: members.length,
        log_ids: members.map((m) => m.log.id),
        generated_at: new Date().toISOString(),
      },
    });
    await HelpQuestionLog.update(
      { processed_article_id: article.id },
      { where: { id: members.map((m) => m.log.id) } },
    );
    created++;
  }

  if (created > 0) {
    try {
      const { notifyPlatformAdmins } = require('./platformNotify');
      await notifyPlatformAdmins({
        eventKind: 'feedback',
        title: `Q위키 초안 ${created}건 자동 제안`,
        body: '반복 질문 클러스터에서 위키 초안이 생성되었습니다. 검토 후 발행해 주세요.',
        link: '/admin/wiki',
      });
    } catch (e) { console.warn('[wikiQuestionCluster] notify failed:', e.message); }
  }
  console.log(`[wikiQuestionCluster] logs ${logs.length}, clusters ${clusters.length}, drafts ${created}`);
  return { logs: logs.length, clusters: clusters.length, created };
}

function initWikiQuestionCron() {
  // 주 1회 월요일 05:00 KST — emailFaqCluster(04:10) 이후
  cron.schedule('0 5 * * 1', () => {
    runWikiQuestionClustering().catch((e) => console.error('[wikiQuestionCluster] cron', e.message));
  }, { timezone: 'Asia/Seoul' });
  console.log('[wikiQuestionCluster] cron registered (Mon 05:00 KST)');
}

module.exports = { runWikiQuestionClustering, initWikiQuestionCron };
