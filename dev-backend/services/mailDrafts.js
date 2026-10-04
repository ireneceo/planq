// Q mail 초안(email_drafts) 쓰기 — **한 벌** (2026-10-04, AI 에이전트 M3-c · 설계 docs/AI_AGENT_M3_DESIGN.md §3.4).
//
//   (business × user × thread) 한 칸. thread_id 없음 = 새 메일(compose) 초안, 있음 = 그 스레드 답장 초안.
//   사람의 자동저장(PUT /:biz/email-drafts)과 AI 앱의 create_mail_reply_draft 가 **이 함수**를 지난다 —
//   라우트 안에 두면 AI 도구가 모델을 직접 쓰게 된다(행동 계층 규약 · 가드 agentsurface ①).
//   ★ 초안은 개인 칸이다 — 방송하지 않는다. 발송은 email_messages 가 원장이다(여기서 보내지 않는다).
const { EmailDraft } = require('../models');

function draftThreadKey(v) { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; }

/** 본인 초안 1건(없으면 null) */
async function findDraft({ businessId, userId, threadId }) {
  return EmailDraft.findOne({ where: { business_id: businessId, user_id: userId, thread_id: draftThreadKey(threadId) } });
}

/** upsert — 있으면 fields 로 덮고, 없으면 만든다. @returns {Promise<EmailDraft>} */
async function upsertDraft({ businessId, userId, threadId, fields }) {
  const tid = draftThreadKey(threadId);
  const [draft, created] = await EmailDraft.findOrCreate({
    where: { business_id: businessId, user_id: userId, thread_id: tid },
    defaults: { business_id: businessId, user_id: userId, thread_id: tid, ...fields },
  });
  if (!created) await draft.update(fields);
  return draft;
}

/** 초안 본문이 «비어 있는가» — 태그·공백·&nbsp; 만 있으면 빈 것(답장 폼이 빈 에디터를 <p></p> 로 저장한다). */
function isBlankHtml(html) {
  if (html == null) return true;
  return !String(html).replace(/<[^>]*>/g, '').replace(/&nbsp;| /g, ' ').trim();
}

module.exports = { draftThreadKey, findDraft, upsertDraft, isBlankHtml };
