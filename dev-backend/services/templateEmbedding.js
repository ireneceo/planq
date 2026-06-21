// 업무 템플릿 임베딩 — AI 추천 매칭용.
// name + description + 모든 item title 을 한 문자열로 text-embedding-3-small 임베딩.
// Q Note / KB 와 동일 엔진 (services/kb_service.embedText) 재사용 (memory project_kb_engine_reuse).
const { TaskTemplate, TaskTemplateItem } = require('../models');
const { embedText } = require('./kb_service');  // embedText 는 이미 BLOB(Buffer) 반환

// 템플릿 → 매칭용 텍스트
function buildTemplateText(tpl, items) {
  const parts = [];
  if (tpl.name) parts.push(String(tpl.name));
  if (tpl.description) parts.push(String(tpl.description));
  if (tpl.category) parts.push(String(tpl.category));
  (items || []).forEach((it) => { if (it.title) parts.push(String(it.title)); });
  return parts.join('. ').slice(0, 4000);
}

// 단일 템플릿 임베딩 재계산 + 저장 (best-effort — 실패해도 throw 안 함)
async function recomputeTemplateEmbedding(templateId) {
  try {
    const tpl = await TaskTemplate.findByPk(templateId, {
      include: [{ model: TaskTemplateItem, as: 'items', attributes: ['title'] }],
    });
    if (!tpl) return false;
    const text = buildTemplateText(tpl, tpl.items || []);
    if (!text.trim()) return false;
    const blob = await embedText(text);         // OPENAI 없거나 실패 시 null, 성공 시 BLOB
    if (!blob) return false;
    await tpl.update({ embedding: blob });
    return true;
  } catch (e) {
    console.warn('[templateEmbedding] recompute failed', templateId, e.message);
    return false;
  }
}

module.exports = { buildTemplateText, recomputeTemplateEmbedding };
