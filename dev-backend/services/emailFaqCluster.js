// Q Mail M4 — FAQ 자동 클러스터링 (사이클 N+80)
//   답변 완료된 메일 스레드(inbound 질문 + outbound 답장)에서 반복 질문을 임베딩 클러스터링.
//   유사도 ≥ 0.85 · 크기 ≥ 3 → FAQ 후보(EmailFaqSuggestion pending) 제안.
//   답변은 LLM 생성 없이 '실제 outbound 답장' 재사용 (memory feedback_ai_minimal_usage).
//   임베딩은 email_messages.faq_embedding 에 캐시 → 메시지당 1회만 (재실행 재사용).
const { Op } = require('sequelize');
const cron = require('node-cron');
const { EmailMessage, EmailAccount, EmailFaqSuggestion } = require('../models');
const { embedText, blobToFloats, cosineSimilarity } = require('./kb_service');

const SIM_THRESHOLD = 0.85;   // 클러스터 유사도
const MIN_CLUSTER = 3;        // FAQ 후보 최소 반복 횟수
const MAX_INBOUND = 200;      // 워크스페이스당 비용 상한
const WINDOW_DAYS = 90;

function clean(text) {
  if (!text) return '';
  // 인용/서명/줄바꿈 잡음 최소 제거 + 길이 컷 (임베딩 안정화)
  return String(text).replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 1500);
}

// 한 워크스페이스 FAQ 클러스터링 1회 실행
async function clusterForBusiness(businessId) {
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  // 1) 최근 inbound 질문 (상한)
  const inbound = await EmailMessage.findAll({
    where: { business_id: businessId, direction: 'inbound', sent_at: { [Op.gte]: since } },
    order: [['sent_at', 'DESC']],
    limit: MAX_INBOUND,
  });
  if (inbound.length < MIN_CLUSTER) return { businessId, candidates: 0, reason: 'too_few_inbound' };

  // 2) 해당 스레드들의 outbound 답장 (가장 이른 답장 = 표준 답변)
  const threadIds = [...new Set(inbound.map((m) => m.thread_id))];
  const outbound = await EmailMessage.findAll({
    where: { business_id: businessId, direction: 'outbound', thread_id: { [Op.in]: threadIds } },
    attributes: ['thread_id', 'body_text', 'sent_at'],
    order: [['sent_at', 'ASC']],
  });
  const answerByThread = new Map();
  for (const o of outbound) { if (!answerByThread.has(o.thread_id)) answerByThread.set(o.thread_id, o); }

  // 3) '답변 완료' inbound 만 (스레드에 자기 이후 outbound 존재) + 임베딩 확보(캐시)
  const items = [];
  for (const m of inbound) {
    const ans = answerByThread.get(m.thread_id);
    if (!ans || new Date(ans.sent_at) <= new Date(m.sent_at)) continue; // 답장 없음
    const qtext = clean(`${m.subject || ''}\n${m.body_text || ''}`);
    if (qtext.length < 10) continue;
    let emb = m.faq_embedding;
    if (!emb) {
      emb = await embedText(qtext); // BLOB 반환
      if (emb) { try { await m.update({ faq_embedding: emb }); } catch { /* ignore */ } }
    }
    const vec = emb ? blobToFloats(emb) : null;
    if (!vec) continue;
    items.push({ threadId: m.thread_id, question: (m.subject || qtext).slice(0, 480), vec, answer: clean(ans.body_text) });
  }
  if (items.length < MIN_CLUSTER) return { businessId, candidates: 0, reason: 'too_few_answered' };

  // 4) 그리디 클러스터링 (유사도 ≥ 0.85)
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
  if (clusters.length === 0) return { businessId, candidates: 0, reason: 'no_cluster' };

  // 5) 기존 제안 로드 (thread 중첩 dedup)
  const recentDismiss = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const existing = await EmailFaqSuggestion.findAll({
    where: {
      business_id: businessId,
      [Op.or]: [
        { status: { [Op.in]: ['pending', 'accepted'] } },
        { status: 'dismissed', updated_at: { [Op.gte]: recentDismiss } },
      ],
    },
  });

  let created = 0;
  let updated = 0;
  for (const cl of clusters) {
    const members = cl.map((idx) => items[idx]);
    const clThreadIds = [...new Set(members.map((m) => m.threadId))];
    // medoid = 클러스터 내 평균 유사도 최대 (대표 질문/답변)
    let bestIdx = 0; let bestAvg = -1;
    for (let a = 0; a < members.length; a++) {
      let s = 0;
      for (let b = 0; b < members.length; b++) if (a !== b) s += cosineSimilarity(members[a].vec, members[b].vec);
      const avg = members.length > 1 ? s / (members.length - 1) : 0;
      if (avg > bestAvg) { bestAvg = avg; bestIdx = a; }
    }
    const rep = members[bestIdx];

    // dedup: 기존 제안과 thread 중첩 시 갱신/스킵
    const overlap = existing.find((e) => {
      const src = Array.isArray(e.source_thread_ids) ? e.source_thread_ids : [];
      return src.some((id) => clThreadIds.includes(id));
    });
    if (overlap) {
      if (overlap.status === 'pending') {
        const mergedThreads = [...new Set([...(overlap.source_thread_ids || []), ...clThreadIds])];
        await overlap.update({ occurrence_count: mergedThreads.length, source_thread_ids: mergedThreads, question: rep.question, answer: rep.answer });
        updated++;
      }
      // accepted/dismissed(7일 내) → 스킵
      continue;
    }
    await EmailFaqSuggestion.create({
      business_id: businessId,
      question: rep.question,
      answer: rep.answer || '(답변 본문 없음)',
      source_thread_ids: clThreadIds,
      occurrence_count: clThreadIds.length,
      status: 'pending',
    });
    created++;
  }
  return { businessId, candidates: clusters.length, created, updated };
}

// 전 워크스페이스 (이메일 계정 보유) 클러스터링
async function runFaqClustering() {
  const accounts = await EmailAccount.findAll({ attributes: ['business_id'], group: ['business_id'] });
  const bizIds = [...new Set(accounts.map((a) => a.business_id).filter(Boolean))];
  const results = [];
  for (const bizId of bizIds) {
    try { results.push(await clusterForBusiness(bizId)); }
    catch (e) { console.warn('[emailFaqCluster] biz', bizId, e.message); results.push({ businessId: bizId, error: e.message }); }
  }
  const totalCreated = results.reduce((s, r) => s + (r.created || 0), 0);
  console.log(`[emailFaqCluster] ${bizIds.length} biz, FAQ 후보 신규 ${totalCreated}건`);
  return { businesses: bizIds.length, totalCreated, results };
}

function initEmailFaqCron() {
  // 매일 04:10 KST — IMAP 수집(상시) 이후 한산한 시간
  cron.schedule('10 4 * * *', () => { runFaqClustering().catch((e) => console.error('[emailFaqCluster] cron', e.message)); }, { timezone: 'Asia/Seoul' });
  console.log('[emailFaqCluster] cron registered (daily 04:10 KST)');
}

module.exports = { runFaqClustering, clusterForBusiness, initEmailFaqCron };
