// KNOWLEDGE_LOOP 축1 — Cue 워크스페이스 지식 (docs/KNOWLEDGE_LOOP_DESIGN.md)
//   - getActiveCards: active 카드 → buildCueContext 주입
//   - getWorkPatternPromptBlock: 카테고리별 실측 소요시간 통계 → AI 업무 추가/시간 추정 프롬프트 주입
//   - mineWorkPatterns: 완료 업무 실측(actual_hours) SQL 통계 → pending 카드 제안 (LLM 없음 — AI 최소사용)
const { Op } = require('sequelize');
const cron = require('node-cron');

const MIN_SAMPLES = 5;      // 표본 미만 카테고리는 제안하지 않음
const WINDOW_DAYS = 180;
const MAX_CARDS_IN_PROMPT = 10;

async function getActiveCards(businessId, limit = MAX_CARDS_IN_PROMPT) {
  const { CueKnowledge } = require('../models');
  return CueKnowledge.findAll({
    where: { business_id: businessId, status: 'active' },
    order: [['updated_at', 'DESC']],
    limit,
  });
}

// active 카드 → 프롬프트 섹션 텍스트 (없으면 '')
async function buildKnowledgeBlock(businessId) {
  try {
    const cards = await getActiveCards(businessId);
    if (!cards.length) return '';
    const lines = cards.map((c) => `- [${c.kind}] ${c.title}: ${String(c.body).slice(0, 300)}`);
    return `# 워크스페이스 지식 (팀이 확정한 사실 — 답변에 우선 반영)\n${lines.join('\n')}`;
  } catch (e) {
    console.warn('[cueKnowledge] block build failed:', e.message);
    return '';
  }
}

// 카테고리별 실측 소요시간 통계 (완료 업무, actual_hours > 0)
async function computeWorkPatternStats(businessId) {
  const { sequelize } = require('../config/database');
  const [rows] = await sequelize.query(
    `SELECT category, COUNT(*) n, ROUND(AVG(actual_hours),1) avg_h,
            ROUND(MIN(actual_hours),1) min_h, ROUND(MAX(actual_hours),1) max_h
     FROM tasks
     WHERE business_id = ? AND status = 'completed' AND actual_hours > 0
       AND category IS NOT NULL AND category != ''
       AND updated_at >= NOW() - INTERVAL ${WINDOW_DAYS} DAY
     GROUP BY category HAVING n >= ${MIN_SAMPLES}
     ORDER BY n DESC LIMIT 20`,
    { replacements: [businessId] },
  );
  return rows;
}

// AI 업무 추가·시간 추정 프롬프트용 실측 통계 블록 (없으면 '')
async function getWorkPatternPromptBlock(businessId) {
  try {
    if (!businessId) return '';
    const stats = await computeWorkPatternStats(businessId);
    if (!stats.length) return '';
    const lines = stats.map((s) => `- ${s.category}: 평균 ${s.avg_h}h (${s.min_h}~${s.max_h}h, 완료 ${s.n}건 실측)`);
    return `\n\n[이 워크스페이스의 카테고리별 실측 소요시간 — estimated_hours 판단에 우선 사용]\n${lines.join('\n')}`;
  } catch (e) {
    console.warn('[cueKnowledge] work pattern block failed:', e.message);
    return '';
  }
}

// 주간 채굴 — work_pattern pending 카드 제안 (카테고리당 1장, 기존 active/pending 있으면 갱신·스킵)
async function mineWorkPatterns(businessId) {
  const { CueKnowledge } = require('../models');
  const stats = await computeWorkPatternStats(businessId);
  let created = 0;
  let updated = 0;
  for (const s of stats) {
    const title = `${s.category} 업무 실측 소요시간`;
    const body = `이 워크스페이스에서 "${s.category}" 카테고리 업무는 평균 ${s.avg_h}시간 걸립니다 (범위 ${s.min_h}~${s.max_h}h, 최근 ${WINDOW_DAYS}일 완료 ${s.n}건 실측 기준).`;
    const existing = await CueKnowledge.findOne({
      where: sequelizeCategoryWhere(businessId, s.category),
      order: [['id', 'DESC']],
    });
    if (existing) {
      if (existing.status === 'pending') { await existing.update({ title, body, meta: { ...existing.meta, ...s } }); updated++; }
      // active(수락됨) → 사람이 확정한 카드 유지, 통계만 meta 갱신
      else if (existing.status === 'active') { await existing.update({ meta: { ...existing.meta, ...s } }); }
      continue;
    }
    await CueKnowledge.create({
      business_id: businessId,
      kind: 'work_pattern',
      title, body,
      source: 'auto_mined',
      status: 'pending',
      meta: { category: s.category, ...s },
    });
    created++;
  }
  return { businessId, stats: stats.length, created, updated };
}

function sequelizeCategoryWhere(businessId, category) {
  const { sequelize } = require('../config/database');
  return {
    business_id: businessId,
    kind: 'work_pattern',
    status: { [Op.in]: ['pending', 'active'] },
    [Op.and]: [sequelize.where(sequelize.fn('JSON_UNQUOTE', sequelize.fn('JSON_EXTRACT', sequelize.col('meta'), sequelize.literal('"$.category"'))), category)],
  };
}

async function runKnowledgeMining() {
  const { Business } = require('../models');
  const bizIds = (await Business.findAll({ attributes: ['id'] })).map((b) => b.id);
  const results = [];
  for (const id of bizIds) {
    try { results.push(await mineWorkPatterns(id)); }
    catch (e) { console.warn('[cueKnowledge] mine biz', id, e.message); }
  }
  const created = results.reduce((s, r) => s + (r.created || 0), 0);
  console.log(`[cueKnowledge] mining — ${bizIds.length} biz, pending 제안 ${created}건`);
  return { businesses: bizIds.length, created, results };
}

function initCueKnowledgeCron() {
  // 주 1회 월 05:20 KST — wikiQuestionCluster(05:00) 이후
  cron.schedule('20 5 * * 1', () => {
    runKnowledgeMining().catch((e) => console.error('[cueKnowledge] cron', e.message));
  }, { timezone: 'Asia/Seoul' });
  console.log('[cueKnowledge] cron registered (Mon 05:20 KST)');
}

module.exports = { getActiveCards, buildKnowledgeBlock, getWorkPatternPromptBlock, computeWorkPatternStats, mineWorkPatterns, runKnowledgeMining, initCueKnowledgeCron };
