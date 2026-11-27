// services/clientMailState.js — 등록 고객의 메일 상태 **한 벌** (2026-11-27 · Fable 설계 C · docs/QSALE_CLIENT_TOUCHPOINT_DESIGN.md)
//
// Irene: «고객이 먼저 등록이 되고 고객이 가진 정보에서 온 이메일이나 문의는 상담문의 내용으로 자동으로 가져오게»
//   메일은 client_id 로 이미 고객에 붙는다(services/mailLink). 이 함수는 «그 고객 메일 중 지금 답할 것이 있나» 를
//   **보는 사람 기준**으로 말한다 — 상담 목록 고객 행(saleInbox.listConsults)과 확인필요 영업 버킷(todo/saleBucket ①)이 같은 함수를 쓴다.
//
// ★ 범위 = business + client + **보는 사람이 볼 수 있는 메일함**(accessibleAccountIds) + 비스팸.
//   연결은 워크스페이스 전체지만 노출은 계정 축이다 — 남의 개인 메일함 메일의 제목·미리보기·«답할 차례» 가 새지 않는다.
// ★ pending = Q mail «답변 필요» 폴더와 **같은 술어**(mailFolders.folderOf) — 새 술어를 만들지 않는다.
// ★ client_interactions 로 복사하지 않는다(상담은 기록, 메일은 이미 고객 허브에 붙어 있다 — 복사는 두 벌).
const { Op } = require('sequelize');

/**
 * @param {number} businessId
 * @param {number[]} clientIds  비면 빈 Map
 * @param {{userId:number}} opts
 * @returns {Promise<Map<number, {pending:boolean, replied:boolean, latest:{thread_id:number, subject:string|null, preview:string|null, at:Date|null, direction:string|null}|null}>>}
 */
async function mailStateByClient(businessId, clientIds, { userId } = {}) {
  const out = new Map();
  const ids = [...new Set((clientIds || []).map(Number).filter(Boolean))];
  if (!ids.length || !userId) return out;
  const { EmailThread, EmailMessage } = require('../models');
  const { accessibleAccountIds } = require('./clientTimeline');
  const { folderOf } = require('./mailFolders');
  const acct = await accessibleAccountIds(businessId, userId);
  if (!acct.length) return out;
  const threads = await EmailThread.findAll({
    where: {
      business_id: businessId,
      client_id: { [Op.in]: ids },
      account_id: { [Op.in]: acct },
      status: { [Op.ne]: 'spam' },
    },
    attributes: ['id', 'client_id', 'status', 'reply_needed', 'triage', 'last_message_direction',
      'last_message_at', 'subject', 'last_message_preview'],
    order: [['last_message_at', 'DESC']],
    limit: 5000,
  });
  if (!threads.length) return out;
  const repliedThreads = new Set((await EmailMessage.findAll({
    where: {
      business_id: businessId,
      thread_id: { [Op.in]: threads.map((t) => t.id) },
      direction: 'outbound',
      internal_only: false,
    },
    attributes: ['thread_id'], group: ['thread_id'], raw: true,
  })).map((r) => Number(r.thread_id)));
  for (const t of threads) {
    const cid = Number(t.client_id);
    let st = out.get(cid);
    if (!st) {
      // 첫 줄이 최신(last_message_at DESC)
      st = {
        pending: false, replied: false,
        latest: { thread_id: t.id, subject: t.subject || null, preview: t.last_message_preview || null, at: t.last_message_at || null, direction: t.last_message_direction || null },
      };
      out.set(cid, st);
    }
    if (folderOf(t) === 'reply_needed') st.pending = true;
    if (repliedThreads.has(Number(t.id))) st.replied = true;
  }
  return out;
}

/**
 * 메일로 답할 차례인 고객 id — 상담 목록이 «진행 중 단계가 아닌» 고객(none·won·lost)을 그 동안만 행으로 넣을 때 쓴다.
 *   pending 술어는 mailStateByClient 와 같다(folderOf 의 reply_needed 가지 = reply_needed ∧ status open|uncertain).
 */
async function pendingMailClientIds(businessId, { userId } = {}) {
  if (!userId) return [];
  const { EmailThread } = require('../models');
  const { accessibleAccountIds } = require('./clientTimeline');
  const acct = await accessibleAccountIds(businessId, userId);
  if (!acct.length) return [];
  const rows = await EmailThread.findAll({
    where: {
      business_id: businessId,
      client_id: { [Op.ne]: null },
      account_id: { [Op.in]: acct },
      reply_needed: true,
      status: { [Op.in]: ['open', 'uncertain'] },
    },
    attributes: ['client_id'], group: ['client_id'], raw: true, limit: 2000,
  });
  return rows.map((r) => Number(r.client_id));
}

module.exports = { mailStateByClient, pendingMailClientIds };
