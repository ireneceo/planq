// Q위키 (Q Wiki) 검색 서비스
// ─────────────────────────────────────────────────────────
// FULLTEXT(ngram) 키워드 검색 + KB 임베딩(text-embedding-3-small) 시맨틱 검색 하이브리드.
// 임베딩은 kb_chunks 재사용 (source_type='wiki', source_id=article.id, business_id=NULL).
// memory: project_kb_engine_reuse, feedback_ai_minimal_usage (LLM 호출 최소화)

const { sequelize } = require('../config/database');
const HelpArticle = require('../models/HelpArticle');
const KbChunk = require('../models/KbChunk');
const { embedText, splitIntoChunks, cosineSimilarity, blobToFloats } = require('./kb_service');

// ─── body 블록(JSON) → 평문 ───
// 블록: { type:'heading'|'text'|'step'|'callout', text_ko, text_en } / { type:'image', caption_ko, ... }
function blocksToText(blocks, lang) {
  if (!Array.isArray(blocks)) return '';
  const parts = [];
  for (const b of blocks) {
    if (!b || typeof b !== 'object') continue;
    const v = b[`text_${lang}`] || b[`caption_${lang}`] || b.text || b.caption || '';
    if (v) parts.push(String(v));
  }
  return parts.join('\n');
}

// article 1건의 검색용 통합 텍스트 (ko+en 양쪽 — 언어 무관 검색).
function articleSearchText(article) {
  const segs = [
    article.title_ko, article.title_en,
    article.summary_ko, article.summary_en,
    blocksToText(article.body_ko, 'ko'),
    blocksToText(article.body_en, 'en'),
  ];
  return segs.filter(Boolean).join('\n').trim();
}

// ─── 임베딩 인덱싱 — article 본문을 kb_chunks(source_type='wiki') 에 저장 ───
async function indexArticle(articleId) {
  const article = await HelpArticle.findByPk(articleId);
  if (!article) return { ok: false, reason: 'not_found' };

  // 기존 wiki 청크 제거 (멱등 재인덱싱)
  await KbChunk.destroy({ where: { source_type: 'wiki', source_id: article.id } });

  const text = articleSearchText(article);
  if (!text) return { ok: true, chunks: 0 };

  const chunks = splitIntoChunks(text);
  let inserted = 0;
  for (const c of chunks) {
    const embedding = await embedText(c.content);  // 키 없으면 null → FTS only
    await KbChunk.create({
      kb_document_id: null,
      source_type: 'wiki',
      source_id: article.id,
      business_id: null,
      chunk_index: c.chunk_index,
      content: c.content,
      token_count: c.token_count,
      embedding,
    });
    inserted++;
  }
  return { ok: true, chunks: inserted };
}

async function removeArticleIndex(articleId) {
  await KbChunk.destroy({ where: { source_type: 'wiki', source_id: articleId } });
}

// ─── FULLTEXT(ngram) 키워드 검색 → { id: relevanceScore } ───
async function ftsSearchScores(query, { onlyPublic }) {
  const q = String(query || '').trim();
  if (!q) return {};
  const pubClause = onlyPublic ? "AND visibility = 'public'" : '';
  try {
    const [rows] = await sequelize.query(
      `SELECT id, MATCH(title_ko, summary_ko, title_en, summary_en) AGAINST (:q IN NATURAL LANGUAGE MODE) AS score
       FROM help_articles
       WHERE is_published = 1 ${pubClause}
         AND MATCH(title_ko, summary_ko, title_en, summary_en) AGAINST (:q IN NATURAL LANGUAGE MODE)
       LIMIT 50`,
      { replacements: { q } }
    );
    const out = {};
    for (const r of rows) out[r.id] = Number(r.score) || 0;
    return out;
  } catch (err) {
    // ngram 토큰 부족 등 → LIKE fallback
    console.warn('[wikiSearch] FTS failed, LIKE fallback:', err.message);
    const like = `%${q}%`;
    const [rows] = await sequelize.query(
      `SELECT id FROM help_articles
       WHERE is_published = 1 ${pubClause}
         AND (title_ko LIKE :like OR summary_ko LIKE :like OR title_en LIKE :like OR summary_en LIKE :like)
       LIMIT 50`,
      { replacements: { like } }
    );
    const out = {};
    for (const r of rows) out[r.id] = 0.5;
    return out;
  }
}

// ─── 시맨틱 검색 (wiki 청크 임베딩) → { id: cosineScore } ───
async function semanticSearchScores(query, { onlyPublic }) {
  const qBlob = await embedText(query);
  if (!qBlob) return {};  // 키 없음 → 시맨틱 skip
  const qVec = blobToFloats(qBlob);
  if (!qVec) return {};

  // 발행된 (+ public 필터) article 의 wiki 청크만
  const pubClause = onlyPublic ? "AND a.visibility = 'public'" : '';
  // type:SELECT → 결과는 rows 배열 직접 반환 (구조분해 금지)
  const rows = await sequelize.query(
    `SELECT c.source_id AS article_id, c.embedding
     FROM kb_chunks c
     JOIN help_articles a ON a.id = c.source_id
     WHERE c.source_type = 'wiki' AND c.embedding IS NOT NULL
       AND a.is_published = 1 ${pubClause}`,
    { type: sequelize.QueryTypes.SELECT }
  );
  const best = {};
  for (const r of rows) {
    const v = blobToFloats(r.embedding);
    if (!v) continue;
    const score = cosineSimilarity(qVec, v);
    if (best[r.article_id] === undefined || score > best[r.article_id]) best[r.article_id] = score;
  }
  return best;
}

// ─── 하이브리드 검색 → 정렬된 article id 배열 ───
// FTS 점수(정규화) + 시맨틱 코사인을 가중 합산. 둘 중 하나만 있어도 동작.
async function searchArticleIds(query, { onlyPublic = false, limit = 20 } = {}) {
  const q = String(query || '').trim();
  if (!q) return [];

  const [fts, sem] = await Promise.all([
    ftsSearchScores(q, { onlyPublic }),
    semanticSearchScores(q, { onlyPublic }),
  ]);

  // FTS 점수 정규화 (0~1)
  const ftsVals = Object.values(fts);
  const ftsMax = ftsVals.length ? Math.max(...ftsVals) : 0;

  // 시맨틱은 모든 article 에 cosine>0 을 주므로 임계치로 약한 매칭은 제외 (노이즈 차단).
  // FTS hit 은 키워드 일치이므로 임계치 무관하게 항상 채택.
  const SEM_THRESHOLD = 0.30;
  const ids = new Set([
    ...Object.keys(fts).map(Number),
    ...Object.entries(sem).filter(([, v]) => v >= SEM_THRESHOLD).map(([id]) => Number(id)),
  ]);
  const scored = [];
  for (const id of ids) {
    const ftsNorm = ftsMax > 0 ? (fts[id] || 0) / ftsMax : (fts[id] ? 1 : 0);
    const semScore = sem[id] || 0;
    const combined = ftsNorm * 0.55 + semScore * 0.45;
    scored.push({ id, score: combined });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.id);
}

module.exports = {
  blocksToText,
  articleSearchText,
  indexArticle,
  removeArticleIndex,
  ftsSearchScores,
  semanticSearchScores,
  searchArticleIds,
};
