// Q Mail 스레드 목록 행 직렬화 — routes/email_threads.js 에서 절출 (god-file 래칫).
//
// 폴더별 표시 분기가 여기 모인다. 특히 보낸메일함(#262)은 "상대편·미리보기·시각"이 전부
// **내가 보낸 메시지** 기준이어야 한다 — 여태 폴더와 무관하게 마지막 inbound 를 그려서
// 보낸메일함인데 받는 사람이 아니라 보낸 사람이 떴다.
const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const { followUpState } = require('./mailFollowUp');

// 운영 #324 — "보낸메일 탭은 왜 표시이름이 달라? 제대로 받는 표시이름을 보이지 않는 것 같아."
//
//   원인: outbound 의 `to_emails` 에는 **주소 문자열만** 들어간다(발송 라우트가 그렇게 저장한다).
//   그래서 보낸메일함은 이름 자리에 늘 raw 주소가 떴고, 받은메일함은 헤더의 from_name 을 써서
//   같은 사람이 탭마다 다른 이름으로 보였다.
//
//   → 워크스페이스가 **이미 아는 이름**으로 해석한다. 우선순위는 받은메일함과 같은 원천을 먼저:
//     ① 그 사람이 우리에게 보냈을 때의 최신 from_name (= 받은메일함이 그리는 바로 그 이름 → 탭 간 일치)
//     ② 고객 카드의 표시명/회사명
//   둘 다 없으면 담지 않는다 — 프론트가 주소를 그대로 그린다(없는 이름을 지어내지 않는다).
//   N+1 금지 — 폴더 목록당 최대 2쿼리.
async function resolveRecipientNames({ folder, lastOutByThread, businessId }) {
  const nameByEmail = new Map();
  if (folder !== 'sent' || !lastOutByThread || lastOutByThread.size === 0) return nameByEmail;

  const wanted = new Set();
  for (const v of lastOutByThread.values()) {
    const to = Array.isArray(v.to_emails) ? v.to_emails : [];
    const first = to[0];
    const em = typeof first === 'string' ? first : (first && first.email);
    if (em) wanted.add(String(em).trim().toLowerCase());
  }
  const emails = [...wanted];
  if (!emails.length) return nameByEmail;

  const inboundNames = await sequelize.query(
    `SELECT em.from_email, em.from_name
       FROM email_messages em
       JOIN (SELECT LOWER(from_email) AS le, MAX(id) AS mid
               FROM email_messages
              WHERE business_id = :bid AND direction = 'inbound'
                AND LOWER(from_email) IN (:emails)
                AND from_name IS NOT NULL AND from_name <> ''
           GROUP BY LOWER(from_email)) last ON last.mid = em.id`,
    { replacements: { bid: businessId, emails }, type: sequelize.QueryTypes.SELECT }
  );
  for (const r of inboundNames) {
    if (r.from_name) nameByEmail.set(String(r.from_email).trim().toLowerCase(), r.from_name);
  }

  const missing = emails.filter((e) => !nameByEmail.has(e));
  if (missing.length) {
    const { Client } = require('../models');
    const cRows = await Client.findAll({
      where: {
        business_id: businessId,
        [Op.or]: [
          { invite_email: { [Op.in]: missing } },
          { billing_contact_email: { [Op.in]: missing } },
        ],
      },
      attributes: ['display_name', 'company_name', 'invite_email', 'billing_contact_email'],
    });
    for (const cl of cRows) {
      const nm = cl.display_name || cl.company_name;
      if (!nm) continue;
      for (const key of [cl.invite_email, cl.billing_contact_email]) {
        const k = String(key || '').trim().toLowerCase();
        if (k && missing.includes(k) && !nameByEmail.has(k)) nameByEmail.set(k, nm);
      }
    }
  }
  return nameByEmail;
}

function serializeThreadRow(t, { folder, senderByThread, lastOutByThread, attachCountByThread, nameByEmail }) {

    const obj = t.toJSON();
    const myAddr = String(obj.EmailAccount?.email || '').toLowerCase();
    const parts = Array.isArray(obj.participants) ? obj.participants : [];
    const fromParts = parts.find(p => p?.email && String(p.email).toLowerCase() !== myAddr) || parts[0] || null;
    let other = senderByThread.get(obj.id) || (fromParts ? { name: fromParts.name || null, email: fromParts.email || null } : null);
    // #262 — 보낸메일함에서는 상대편 = **내가 보낸 사람(수신자)** 이다.
    //   여태 폴더와 무관하게 마지막 inbound 발신자를 그려서, 보낸메일함인데 "받는 사람"이 아니라
    //   "보낸 사람"이 뜨고 미리보기·시각도 상대가 답장한 것이 나왔다.
    const out = lastOutByThread.get(obj.id) || null;
    let preview = obj.last_message_preview;
    let stamp = obj.last_message_at;
    if (folder === 'sent' && out) {
      const to = Array.isArray(out.to_emails) ? out.to_emails : [];
      const first = to[0] || null;
      const toEmail = typeof first === 'string' ? first : (first?.email || null);
      const toName = typeof first === 'string' ? null : (first?.name || null);
      // 운영 #324 — to_emails 에는 주소만 들어 있어 toName 이 거의 항상 null 이다.
      //   호출부가 해석해 넘긴 이름(받은메일함과 같은 원천)을 쓴다. 없으면 null 로 두고
      //   프론트가 주소를 그대로 그린다 — 이름을 지어내지 않는다.
      const resolvedName = toName
        || (toEmail && nameByEmail ? nameByEmail.get(String(toEmail).trim().toLowerCase()) : null)
        || null;
      if (toEmail || resolvedName) other = { name: resolvedName, email: toEmail };
      if (out.preview) preview = out.preview;
      if (out.sent_at) stamp = out.sent_at;
    }
    return {
      id: obj.id,
      subject: obj.subject,
      last_message_preview: preview,
      last_message_at: stamp,
      last_message_direction: obj.last_message_direction,
      received_at_email: obj.received_at_email || null,   // 별칭별 보기 — 이 대화가 들어온 우리 주소
      // 읽음 추적 대신 쓰는 결정론적 신호 — services/mailFollowUp 참조
      follow_up: followUpState(obj, lastOutByThread.get(obj.id) || null),
      status: obj.status,
      reply_needed: obj.reply_needed,
      reply_needed_at: obj.reply_needed_at,
      reply_needed_reason: obj.reply_needed_reason,
      rule_id: obj.rule_id || null,        // 학습 규칙으로 분류된 건지 (화면 표시)
      is_starred: obj.is_starred,
      unread_count: obj.unread_count || 0,
      message_count: obj.message_count || 0,
      attachment_count: attachCountByThread.get(obj.id) || 0,   // #215-I
      labels: obj.labels || [],
      account: obj.EmailAccount,
      counterpart: other ? { name: other.name || null, email: other.email || null } : null,
      client: obj.Client,
      project: obj.Project,
      uncertain_reason: obj.uncertain_reason,
      spam_score: obj.spam_score,
      triage: obj.triage,
    };
}

module.exports = { serializeThreadRow, resolveRecipientNames };
