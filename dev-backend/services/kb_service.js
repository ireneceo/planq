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

// LLM·임베딩 호출은 게이트웨이 단일 지점을 지난다 (services/llm.js).
const { callLLM, embed: gatewayEmbed, isEnabled, EMBED_MODEL } = require('./llm');
const EMBED_DIM = 1536;

// ─── 임베딩 — 게이트웨이(services/llm.js) 경유 ───
async function embedText(text) {
  if (!isEnabled() || !text) return null;
  const vec = await gatewayEmbed(text);   // 실패 시 null (게이트웨이가 재시도까지 하고도 실패)
  if (!Array.isArray(vec) || vec.length !== EMBED_DIM) return null;
  return floatsToBlob(vec);
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
    let insertedCount = 0;
    for (const c of chunks) {
      const embedding = await embedText(c.content);
      // N+68 — race-safe: embed 동안 doc 삭제됐을 가능성. final check + FK catch.
      const stillExists = await KbDocument.findByPk(doc.id, { attributes: ['id'] });
      if (!stillExists) {
        console.log(`[kb] doc #${doc.id} deleted during indexing, abort`);
        return;
      }
      try {
        await KbChunk.create({
          kb_document_id: doc.id,
          business_id: doc.business_id,
          chunk_index: c.chunk_index,
          content: c.content,
          token_count: c.token_count,
          embedding
        });
        insertedCount++;
      } catch (e) {
        if (e.name === 'SequelizeForeignKeyConstraintError') {
          console.log(`[kb] FK race — doc #${doc.id} deleted, abort indexing`);
          return;
        }
        throw e;
      }
    }

    // 최종 status update 도 doc 존재 시만
    try {
      await doc.update({ status: 'ready', chunk_count: insertedCount });
    } catch (e) { /* doc 삭제됐으면 무시 */ }
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

// ─── D-5: 워크스페이스 KB 총량 (작은 KB 는 임베딩 검색을 건너뛴다) ───
//   총 content 바이트가 임계 미만이면 벡터 검색으로 top-K 를 고르는 대신 KB 를 전량 주입한다.
//   벡터 미스가 없어 재현율 100% 이고, 임베딩 API 호출(비용·지연) 자체를 없앤다.
//   임계 초과 시에만 embedText + 200 후보 캡 + 코사인 정렬(기존 경로 그대로).
//   임계값은 튜닝 다이얼 — 프롬프트 주입 비용이 부담되면 낮춘다.
const SMALL_KB_BYTES = 100 * 1024;          // 100KB 미만이면 전량 주입
const KB_SIZE_TTL_MS = 60 * 1000;           // 총량 캐시 60s — 매 검색마다 SUM 재실행 회피
const _kbSizeCache = new Map();             // businessId -> { bytes, at }

async function getWorkspaceKbBytes(businessId) {
  const hit = _kbSizeCache.get(businessId);
  if (hit && Date.now() - hit.at < KB_SIZE_TTL_MS) return hit.bytes;
  const row = await KbChunk.findOne({
    where: { business_id: businessId },
    attributes: [[sequelize.fn('COALESCE', sequelize.fn('SUM', sequelize.fn('LENGTH', sequelize.col('content'))), 0), 'bytes']],
    raw: true,
  });
  const bytes = Number(row?.bytes || 0);
  _kbSizeCache.set(businessId, { bytes, at: Date.now() });
  return bytes;
}

// ─── 하이브리드 검색 ───
// 1) Pinned FAQ 에서 임베딩 top-K
// 2) KbChunk 에서 임베딩 top-K + LIKE 폴백 (작은 KB 는 임베딩 없이 전량)
// 3) 코사인 정렬 후 tier 별로 반환
async function hybridSearch(businessId, query, opts = {}) {
  const limit = opts.limit || 5;
  // 사이클 G — 스코프 우선순위: client → project → workspace.
  // 컨텍스트(opts) 에 project_id / client_id 있으면 그 스코프의 KbDocument 우선 가중.
  // 더 좁은 스코프는 정밀도 ↑, 더 넓은 스코프는 재현율 ↑. threshold 0.78.
  const ctxProjectId = opts.project_id || null;
  const ctxClientId = opts.client_id || null;
  const ctxCategory = opts.category || null;
  // 권한 필터 (P0 에이전트 권한 모델) — 호출자가 access_scope.kbDocumentsListWhereByLevel(scope) 를
  //   넘기면 "그 사람이 볼 수 있는 KbDocument" 로만 검색을 좁힌다. 아래 scope 가중(OR)과 AND 로 결합.
  //   Cue 처럼 사람 대신 검색하는 경로가 워크스페이스 전체를 긁는 것을 차단.
  const permDocWhere = opts.docWhere || null;
  // D-5 — 작은 KB(총 content < 100KB) 는 임베딩 없이 스코프 내 청크를 전량 주입한다.
  //   아래 청크 fetch(필터·캡)·정렬(기본점수)·반환(슬라이스)이 smallKb 로 분기한다.
  const totalKbBytes = await getWorkspaceKbBytes(businessId);
  const smallKb = totalKbBytes > 0 && totalKbBytes < SMALL_KB_BYTES;
  const queryEmbedding = smallKb ? null : await embedText(query);

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
  if (!queryEmbedding && !smallKb) {
    // 임베딩 불가(대형 KB·OPENAI 미설정) — 키워드 LIKE 로 후보를 좁힌다.
    // smallKb 는 필터 없이 스코프 내 전량 fetch (전량 주입).
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

  // 권한 필터가 있으면 AND 결합 (두 개의 Op.or 이 한 객체에서 충돌하지 않게 감싼다)
  const effectiveDocWhere = permDocWhere ? { [Op.and]: [docWhere, permDocWhere] } : docWhere;

  const chunks = await KbChunk.findAll({
    where: chunkWhere,
    limit: smallKb ? 500 : 200,   // 임계초과만 200 후보 캡. smallKb 는 <100KB 라 청크 수 자체가 적음(안전 상한 500)
    order: [['id', 'DESC']],
    include: [{
      model: KbDocument,
      attributes: ['title', 'id', 'category', 'scope', 'project_id', 'client_id'],
      where: effectiveDocWhere,
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
    if (score === 0 && smallKb) {
      // 전량 주입 — 키워드 미스여도 작은 KB 는 통째로 컨텍스트에 넣는다(기본 점수, 매칭보다 낮게)
      score = 0.35;
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
  // smallKb: 전량 주입 — 청크는 top-K 로 자르지 않고 스코프 내 전량 반환(<100KB 라 bounded)
  const chunkLimit = smallKb ? scoredChunks.length : limit;
  const topChunks = scoredChunks.filter(c => c.score >= 0.3).slice(0, chunkLimit);

  return {
    pinned_faqs: topFaqs,
    kb_chunks: topChunks,
    has_results: topFaqs.length > 0 || topChunks.length > 0
  };
}

// ─── 사이클 P3 — LLM 자동 태그 추출 ───
// 제목 + 본문 → 키워드 5~8개 (gpt-4o-mini, ≈ ₩0.0002/문서).
// 백그라운드로 호출. KbDocument.tags 에 JSON 저장.
async function extractTags(docId) {
  const doc = await KbDocument.findByPk(docId);
  if (!doc) return;
  // 워크스페이스 Cue 한도 검사 — abuse 방지 (대량 KB 등록 시 무제한 LLM 호출 차단).
  // 한도 초과 또는 OPENAI 미설정 시 본문 빈도 기반 fallback.
  let overLimit = false;
  try {
    const cueOrch = require('./cue_orchestrator');
    const usage = await cueOrch.checkUsageLimit(doc.business_id);
    overLimit = usage.over;
  } catch { /* checkUsageLimit 실패 시 통과 (best-effort) */ }
  if (!isEnabled() || overLimit) {
    const tags = simpleKeywordExtract(`${doc.title || ''}\n${doc.body || ''}`);
    if (tags.length) await doc.update({ tags });
    return;
  }
  try {
    const text = `${doc.title || ''}\n${(doc.body || '').slice(0, 4000)}`;
    const { content: raw, fallback, input_tokens, output_tokens, model } = await callLLM({
      purpose: 'kb_tags',
      messages: [
        { role: 'system', content: '당신은 한국어/영어 혼용 문서에서 핵심 키워드를 추출하는 도구입니다. JSON 만 출력하세요.' },
        { role: 'user', content: `다음 문서에서 검색·필터에 쓸 핵심 키워드 5~8개를 추출해 JSON 배열로만 답하세요. 키워드는 명사 또는 짧은 명사구. 일반적이지 않고 문서 고유의 식별 가치가 있는 것 우선.\n\n문서:\n${text}\n\n출력 형식:\n["키워드1","키워드2",...]` },
      ],
      json: true,
      fallback: '',
    });
    if (fallback) { console.warn('[kb_service] 태그 추출 실패 — 태그 없이 진행'); return; }
    let tags = [];
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) tags = parsed;
      else if (Array.isArray(parsed.tags)) tags = parsed.tags;
      else if (Array.isArray(parsed.keywords)) tags = parsed.keywords;
      else {
        // 첫 array 찾기
        for (const v of Object.values(parsed)) {
          if (Array.isArray(v)) { tags = v; break; }
        }
      }
    } catch (e) { console.warn('[kb_service] tag parse failed', e.message); }
    tags = tags.filter(t => typeof t === 'string').map(t => String(t).trim().slice(0, 40)).filter(Boolean).slice(0, 8);
    if (tags.length) await doc.update({ tags });
    // 사용량 기록 — Cue 월 한도와 같은 카운터 (kb_embed 카테고리)
    try {
      const cueOrch = require('./cue_orchestrator');
      await cueOrch.recordUsage(doc.business_id, 'kb_embed', model, input_tokens || 0, output_tokens || 0);
    } catch (e) { console.warn('[kb_service] recordUsage failed', e.message); }
  } catch (err) {
    console.warn('[kb_service] extractTags error', err.message);
  }
}

// LLM 미설정 시 fallback — 한글/영문 단어 빈도 기반 (stopword 제거)
const KO_STOP = new Set(['은','는','이','가','을','를','의','에','에서','으로','로','과','와','도','만','게','이다','있다','없다','한다','됩니다','입니다','그리고','또한','그러나','때문','그럼','이런','저런','어떤','모든','다음','관련','내용','경우','내용을','이를']);
const EN_STOP = new Set(['the','a','an','and','or','but','if','of','to','in','on','at','for','with','by','from','as','is','are','was','were','be','been','have','has','had','do','does','did','this','that','these','those','it','its','their','they','them','we','us','our','you','your','he','she','his','her','will','would','should','could','may','might','can','about','into','through','during','before','after','above','below','between','out','off','over','under','again','further','then','once']);
function simpleKeywordExtract(text) {
  const tokens = String(text).toLowerCase().split(/[\s,.!?;:()\[\]{}<>"'`\\\/—–\-_=*&^%$#@~+|]+/u).filter(Boolean);
  const counts = new Map();
  for (const tok of tokens) {
    if (tok.length < 2) continue;
    if (KO_STOP.has(tok) || EN_STOP.has(tok)) continue;
    if (/^\d+$/.test(tok)) continue;
    counts.set(tok, (counts.get(tok) || 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([w]) => w);
}

module.exports = {
  embedText,
  embedPinnedFaq,
  indexDocument,
  extractTags,
  hybridSearch,
  getWorkspaceKbBytes,   // D-5 — 워크스페이스 KB 총량(작은 KB 게이트). 검증·재사용용 노출
  splitIntoChunks,
  cosineSimilarity,
  blobToFloats,
  floatsToBlob,
  EMBED_DIM,
  EMBED_MODEL
};
