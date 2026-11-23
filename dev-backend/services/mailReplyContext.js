// AI 답장(ai-suggest)이 «무엇에 답하는지» 를 고르는 한 곳.
//
// 2026-11-23 Irene: *"AI 로 답장하기 할 때 마지막 전에 우리쪽에서 보낸 메일에 대한 답을 하고 있어"*
//   원인 ① 대화 흐름을 3000자로 자를 때 **앞(옛 메일)을 남기고 뒤(최신)를 버렸다** — 통당 800자 × 6통이면
//         마지막 한두 통(우리가 보낸 것·방금 받은 것)이 통째로 빠져, 모델이 그 앞 대화에 답했다(dev 스레드 9226 실측).
//   원인 ② «마지막 받은 메일» 을 방향(inbound)만으로 골랐다 — 반송(mailer-daemon)이나, 우리 다른 주소에서
//         보내 우리 메일함에 들어온 메일(참조로 받은 우리 메일)도 «상대가 보낸 마지막 메일» 로 잡혔다.
//   → 답할 메일은 «상대가 보낸 마지막 메일»(우리 주소·반송 제외) · 대화 흐름은 **최신부터** 예산 안에 담는다.

const { Op } = require('sequelize');
const { cleanVisibleBody } = require('./emailBodyClean');
const { isBounce } = require('./emailTriage');

const PER_MSG = 800;
const BUDGET = 3000;
const MAX_MSGS = 6;

/** 이 워크스페이스의 우리 주소(메일함 본주소 + 보내는 주소 별칭) — 소문자 집합. */
async function ourAddressesOf(businessId) {
  const { EmailAccount, EmailAccountAlias } = require('../models');
  const [accs, aliases] = await Promise.all([
    EmailAccount.findAll({ where: { business_id: businessId }, attributes: ['email'], raw: true }),
    EmailAccountAlias.findAll({ where: { business_id: businessId, email: { [Op.ne]: null } }, attributes: ['email'], raw: true }),
  ]);
  return new Set([...accs, ...aliases].map((r) => String(r.email || '').trim().toLowerCase()).filter(Boolean));
}

/** 이 메일을 «우리» 가 쓴 것으로 보는가 — 보낸 방향이거나, 우리 주소에서 온 것. */
function isOurs(m, ours) {
  if (m.direction !== 'inbound') return true;
  return ours.has(String(m.from_email || '').trim().toLowerCase());
}

/**
 * 답할 메일 — 상대가 보낸 마지막 메일. msgs 는 오래된 것부터(sent_at, id).
 * 반송·우리 주소 메일을 건너뛴다. 그런 것밖에 없으면 마지막 inbound(옛 동작)로 — 막다른 길을 만들지 않는다.
 */
function pickReplyTarget(msgs, ours) {
  const rev = [...msgs].reverse();
  return rev.find((m) => !isOurs(m, ours) && !isBounce(m.from_email, m.subject))
    || rev.find((m) => m.direction === 'inbound')
    || null;
}

function bodyOf(m) {
  return cleanVisibleBody(m.body_text, m.body_html)
    || String(m.body_text || '').replace(/\s+/g, ' ').trim();
}

/**
 * 대화 흐름 — 최근 MAX_MSGS 통, 통당 PER_MSG 자, 합계 BUDGET 자. **최신부터 담는다**(넘치면 옛 메일이 빠진다).
 * 반송은 대화가 아니라 뺀다. 답할 메일에는 표시를 붙여 모델이 무엇에 답하는지 헷갈리지 않게 한다.
 * 답할 메일 뒤에 우리가 이미 보낸 메일이 있으면 그것도 보인다(그 뒤에 이어 쓰는 답장이다).
 */
function buildThreadContext(msgs, target, ours) {
  const picked = [];
  let used = 0;
  const rev = [...msgs].reverse();
  for (const m of rev) {
    if (picked.length >= MAX_MSGS) break;
    if (m.direction === 'inbound' && isBounce(m.from_email, m.subject)) continue;
    const body = bodyOf(m);
    if (!body) continue;
    const who = isOurs(m, ours) ? 'US' : 'THEM';
    const tag = target && m.id === target.id ? `[${who} — LATEST EMAIL FROM THEM, the one you are replying to]` : `[${who}]`;
    const line = `${tag} ${body.slice(0, PER_MSG)}`;
    if (used + line.length > BUDGET) {
      if (!picked.length) picked.push(line.slice(0, BUDGET));
      break;
    }
    picked.push(line);
    used += line.length + 2;
  }
  return picked.reverse().join('\n\n') || null;
}

module.exports = { ourAddressesOf, pickReplyTarget, buildThreadContext, isOurs };
