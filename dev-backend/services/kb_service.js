// Q Talk KB (대화 자료) 서비스
// ─────────────────────────────────────────────────────────
// OpenAI 임베딩 + FTS 기반 하이브리드 검색
// Q Note 의 embedding_service.py 와 동일 패턴 (text-embedding-3-small, 1536d)
// OPENAI_API_KEY 없을 때는 graceful fallback (임베딩 없이 FTS only)

const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const KbDocument = require('../models/KbDocument');
const KbChunk = require('../models/KbChunk');
const KbPinnedFaq = require('../models/KbPinnedFaq');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const EMBED_MODEL = 'text-embedding-3-small';
const EMBED_DIM = 1536;

// ─── 임베딩 ───
async function embedText(text) {
  if (!OPENAI_API_KEY || !text) return null;
  const t = String(text).slice(0, 8000).trim();
  if (!t) return null;
  try {
    const r = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ model: EMBED_MODEL, input: t })
    });
    if (!r.ok) {
      console.warn('[kb_service] embed failed', r.status);
      return null;
    }
    const data = await r.json();
    const vec = data?.data?.[0]?.embedding;
    if (!Array.isArray(vec) || vec.length !== EMBED_DIM) return null;
    return floatsToBlob(vec);
  } catch (err) {
    console.warn('[kb_service] embed error', err.message);
    return null;
  }
}

// Float32Array → Buffer (BLOB 저장용, 6144 bytes)
function floatsToBlob(floats) {
  const buf = Buffer.alloc(floats.length * 4);
  for (let i = 0; i < floats.length; i++) buf.writeFloatLE(floats[i], i * 4);
  return buf;
}

// Buffer → Float32Array
function blobToFloats(buf) {
  if (!buf || buf.length !== EMBED_DIM * 4) return null;
  const out = new Float32Array(EMBED_DIM);
  for (let i = 0; i < EMBED_DIM; i++) out[i] = buf.readFloatLE(i * 4);
  return out;
}

// ─── 코사인 유사도 ───
function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-9);
}

// ─── 간단한 청킹 (sliding window, 공백 기준) ───
function splitIntoChunks(text, maxWords = 180, overlap = 20) {
  if (!text) return [];
  const words = String(text).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const chunks = [];
  let idx = 0;
  let chunkIndex = 0;
  while (idx < words.length) {
    const slice = words.slice(idx, idx + maxWords);
    chunks.push({
      chunk_index: chunkIndex++,
      content: slice.join(' '),
      token_count: slice.length
    });
    if (idx + maxWords >= words.length) break;
    idx += (maxWords - overlap);
  }
  return chunks;
}

// ─── 문서 인덱싱 (청크 생성 + 임베딩) ───
async function indexDocument(docId) {
  const doc = await KbDocument.findByPk(docId);
  if (!doc) throw new Error('Document not found');

  await doc.update({ status: 'indexing', error_message: null });

  try {
    const text = doc.body || '';
    if (!text.trim()) {
      await doc.update({ status: 'failed', error_message: 'Empty document body' });
      return;
    }

    // 기존 청크 삭제
    await KbChunk.destroy({ where: { kb_document_id: doc.id } });

    const chunks = splitIntoChunks(text);
    for (const c of chunks) {
      const embedding = await embedText(c.content);
      await KbChunk.create({
        kb_document_id: doc.id,
        business_id: doc.business_id,
        chunk_index: c.chunk_index,
        content: c.content,
        token_count: c.token_count,
        embedding
      });
    }

    await doc.update({ status: 'ready', chunk_count: chunks.length });
  } catch (err) {
    await doc.update({ status: 'failed', error_message: String(err.message).slice(0, 1000) });
    throw err;
  }
}

// ─── Pinned FAQ 임베딩 업데이트 ───
async function embedPinnedFaq(faq) {
  const corpus = [
    faq.question,
    faq.short_answer || '',
    Array.isArray(faq.keywords) ? faq.keywords.join(' ') : ''
  ].filter(Boolean).join('\n');
  const emb = await embedText(corpus);
  if (emb) {
    await faq.update({ embedding: emb });
  }
  return emb;
}

// ─── 하이브리드 검색 ───
// 1) Pinned FAQ 에서 임베딩 top-K
// 2) KbChunk 에서 임베딩 top-K + LIKE 폴백
// 3) 코사인 정렬 후 tier 별로 반환
async function hybridSearch(businessId, query, opts = {}) {
  const limit = opts.limit || 5;
  // 사이클 G — 스코프 우선순위: client → project → workspace.
  // 컨텍스트(opts) 에 project_id / client_id 있으면 그 스코프의 KbDocument 우선 가중.
  // 더 좁은 스코프는 정밀도 ↑, 더 넓은 스코프는 재현율 ↑. threshold 0.78.
  const ctxProjectId = opts.project_id || null;
  const ctxClientId = opts.client_id || null;
  const ctxCategory = opts.category || null;
  const queryEmbedding = await embedText(query);

  // ─── Pinned FAQ ───
  const faqs = await KbPinnedFaq.findAll({
    where: { business_id: businessId },
    limit: 50,
    order: [['updated_at', 'DESC']]
  });

  const scoredFaqs = [];
  for (const f of faqs) {
    let score = 0;
    if (queryEmbedding && f.embedding) {
      const qv = blobToFloats(queryEmbedding);
      const fv = blobToFloats(f.embedding);
      if (qv && fv) score = cosineSimilarity(qv, fv);
    }
    // LIKE 폴백 (키워드 매칭)
    if (score === 0 && String(f.question).toLowerCase().includes(String(query).toLowerCase())) {
      score = 0.6;
    }
    scoredFaqs.push({
      tier: 'pinned_faq',
      score,
      faq_id: f.id,
      question: f.question,
      answer: f.answer,
      short_answer: f.short_answer,
      keywords: f.keywords
    });
  }

  // ─── KB Chunks ───
  const chunkWhere = { business_id: businessId };
  if (!queryEmbedding) {
    // 임베딩 없으면 content LIKE 폴백
    chunkWhere.content = { [Op.like]: `%${String(query).slice(0, 80)}%` };
  }
  // 스코프·카테고리 필터 — KbDocument 의 컬럼 기반 (sub-include where)
  const docWhere = {};
  if (ctxCategory) docWhere.category = ctxCategory;
  // 스코프 정책: ctx 스코프가 명시된 경우 — 해당 스코프 + workspace 공통 모두 포함
  // (좁은 스코프 = 정밀, workspace = fallback)
  const scopeOr = [{ scope: 'workspace' }];
  if (ctxProjectId) scopeOr.push({ scope: 'project', project_id: ctxProjectId });
  if (ctxClientId) scopeOr.push({ scope: 'client', client_id: ctxClientId });
  docWhere[Op.or] = scopeOr;

  const chunks = await KbChunk.findAll({
    where: chunkWhere,
    limit: 200,
    order: [['id', 'DESC']],
    include: [{
      model: KbDocument,
      attributes: ['title', 'id', 'category', 'scope', 'project_id', 'client_id'],
      where: docWhere,
      required: true,
    }]
  });

  const scoredChunks = [];
  for (const c of chunks) {
    let score = 0;
    if (queryEmbedding && c.embedding) {
      const qv = blobToFloats(queryEmbedding);
      const cv = blobToFloats(c.embedding);
      if (qv && cv) score = cosineSimilarity(qv, cv);
    }
    if (score === 0 && String(c.content).toLowerCase().includes(String(query).toLowerCase())) {
      score = 0.5;
    }
    if (score > 0) {
      // 스코프 가중: client > project > workspace
      const docScope = c.KbDocument?.scope;
      let scopeBoost = 1.0;
      if (docScope === 'client' && ctxClientId === c.KbDocument?.client_id) scopeBoost = 1.20;
      else if (docScope === 'project' && ctxProjectId === c.KbDocument?.project_id) scopeBoost = 1.10;
      // 카테고리 일치 추가 가중
      if (ctxCategory && c.KbDocument?.category === ctxCategory) scopeBoost *= 1.05;
      scoredChunks.push({
        tier: 'kb_rag',
        score: score * scopeBoost,
        raw_score: score,
        scope: docScope,
        chunk_id: c.id,
        document_id: c.kb_document_id,
        document_title: c.KbDocument?.title || '',
        category: c.KbDocument?.category,
        section_title: c.section_title,
        snippet: String(c.content).slice(0, 300)
      });
    }
  }

  // 정렬
  scoredFaqs.sort((a, b) => b.score - a.score);
  scoredChunks.sort((a, b) => b.score - a.score);

  const topFaqs = scoredFaqs.filter(f => f.score >= 0.3).slice(0, limit);
  const topChunks = scoredChunks.filter(c => c.score >= 0.3).slice(0, limit);

  return {
    pinned_faqs: topFaqs,
    kb_chunks: topChunks,
    has_results: topFaqs.length > 0 || topChunks.length > 0
  };
}

module.exports = {
  embedText,
  embedPinnedFaq,
  indexDocument,
  hybridSearch,
  splitIntoChunks,
  cosineSimilarity,
  blobToFloats,
  floatsToBlob,
  EMBED_DIM,
  EMBED_MODEL
};
