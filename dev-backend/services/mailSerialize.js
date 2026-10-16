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
  if (folder !== 'sent' || !lastOutByThread || lastOutByThread.size === 0) return new Map();

  const wanted = new Set();
  for (const v of lastOutByThread.values()) {
    const to = Array.isArray(v.to_emails) ? v.to_emails : [];
    const first = to[0];
    const em = typeof first === 'string' ? first : (first && first.email);
    if (em) wanted.add(String(em).trim().toLowerCase());
  }
  return resolveNamesForEmails([...wanted], businessId);
}

// 주소 → 워크스페이스가 아는 이름(위 ①②와 같은 규칙). 보낸메일함 밖에서도 쓴다(2026-10-16 — 이름 없는 상대·검색한 주소).
async function resolveNamesForEmails(emailList, businessId) {
  const nameByEmail = new Map();
  const emails = [...new Set((emailList || []).map((e) => String(e || '').trim().toLowerCase()).filter(Boolean))];
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

// ★ 2026-10-16 — 주소로 검색하면 «그 주소의 사람» 을 보낸 사람 자리에 그린다.
//   Irene: "이메일주소로 검색해서 해당 내용만 보면 보낸사람 이름이 제대로 안나와."
//   목록의 보낸 사람 자리는 «마지막으로 받은 메일의 발신자» 라, 그 주소가 참조(Cc)·받는 사람·앞선 메일에만 있는
//   스레드는 **다른 사람 이름**(동료·담당 교사·나 자신)이 떴다 — 검색한 사람이 누구와 오간 메일인지 목록에서 안 보였다.
//   검색어 중 «@» 가 든 토큰이 이 스레드의 발신·수신·참조 주소에 들어 있으면 그 사람을 고른다(최근 메시지부터).
//   이름은 스레드 안에서 그 주소가 **보낸** 메일의 이름 → (없으면) 받는 칸에 적힌 이름 순. 비면 호출부가 워크스페이스 이름으로 채운다.
//   반환: Map(thread_id → [{ email, name }] 최근 순) — 우리 주소 걸러 내기는 행(계정)을 아는 serializeThreadRow 가 한다.
async function searchPartiesByThread({ q, threadIds, businessId }) {
  const out = new Map();
  const needles = String(q || '').trim().slice(0, 100).split(/\s+/)
    .map((x) => x.trim().toLowerCase()).filter((x) => x.includes('@')).slice(0, 4);
  if (!needles.length || !threadIds || !threadIds.length) return out;
  const rows = await sequelize.query(
    `SELECT thread_id, direction, from_email, from_name, to_emails, cc_emails
       FROM email_messages
      WHERE business_id = :bid AND thread_id IN (:ids)
      ORDER BY id DESC`,
    { replacements: { bid: businessId, ids: threadIds }, type: sequelize.QueryTypes.SELECT },
  );
  const asList = (v) => {
    if (!v) return [];
    let arr = v;
    if (typeof v === 'string') { try { arr = JSON.parse(v); } catch { return []; } }
    return Array.isArray(arr) ? arr.map((x) => (typeof x === 'string' ? { email: x, name: null } : x)).filter(Boolean) : [];
  };
  const hit = (em) => { const e = String(em || '').toLowerCase(); return !!e && needles.some((n) => e.includes(n)); };
  const perThread = new Map();   // tid → Map(email → { email, sentName, listedName })
  for (const r of rows) {
    if (!perThread.has(r.thread_id)) perThread.set(r.thread_id, new Map());
    const bucket = perThread.get(r.thread_id);
    const touch = (email, name, asSender) => {
      if (!hit(email)) return;
      const key = String(email).trim().toLowerCase();
      if (!bucket.has(key)) bucket.set(key, { email: key, sentName: null, listedName: null });
      const b = bucket.get(key);
      const nm = String(name || '').trim();
      if (!nm || nm.toLowerCase() === key) return;
      if (asSender) { if (!b.sentName) b.sentName = nm; } else if (!b.listedName) b.listedName = nm;
    };
    touch(r.from_email, r.from_name, true);
    for (const x of [...asList(r.to_emails), ...asList(r.cc_emails)]) touch(x.email, x.name, false);
  }
  for (const [tid, bucket] of perThread.entries()) {
    if (bucket.size) out.set(tid, [...bucket.values()].map((b) => ({ email: b.email, name: b.sentName || b.listedName || null })));
  }
  return out;
}

function serializeThreadRow(t, { folder, senderByThread, lastOutByThread, attachCountByThread, nameByEmail, searchParties = null }) {

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
    // 받은 메일 폴더의 시각 = 정렬 키(마지막으로 받은 시각, services/mailFolders receivedOrder).
    //   목록 라우트가 last_received_at 을 싣지 않은 호출부(검색 등)는 종전대로 마지막 시각.
    let stamp = (folder !== 'sent' && obj.last_received_at) ? obj.last_received_at : obj.last_message_at;
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
    // 주소로 검색했으면 그 주소의 사람(위 searchPartiesByThread). 우리 메일함 주소는 고르지 않는다.
    const sp = searchParties ? (searchParties.get(obj.id) || []).find((x) => x.email !== myAddr) : null;
    if (sp) {
      const same = other && String(other.email || '').toLowerCase() === sp.email;
      other = { name: (same && other.name) || sp.name || null, email: sp.email };
    }
    // 보낸메일함 행의 «어디서 보냈나» — 마지막 보낸 메일(필터가 있으면 그 쪽의 마지막) 기준. 받은 메일 폴더에는 싣지 않는다.
    const sentVia = folder === 'sent' && out ? (out.via || null) : null;
    return {
      id: obj.id,
      subject: obj.subject,
      last_message_preview: preview,
      last_message_at: stamp,
      last_message_direction: obj.last_message_direction,
      sent_via: sentVia,
      received_at_email: obj.received_at_email || null,   // 별칭별 보기 — 이 대화가 들어온 우리 주소
      // 읽음 추적 대신 쓰는 결정론적 신호 — services/mailFollowUp 참조
      follow_up: followUpState(obj, lastOutByThread.get(obj.id) || null),
      // #384 — 화면이 현재 설정을 보여주고 바꿀 수 있게 그대로 내려준다.
      //   null = 기본값 사용 · 0 = 끔 · N = N일. 뜻은 services/mailFollowUp.thresholdFor 가 정본.
      follow_up_days: obj.follow_up_days ?? null,
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
      // ★ 2026-09-15 — 검색은 폴더를 넘는다(routes/email_threads). 그러면 결과 행은 **자기 자리**를
      //   말해야 한다. 안 그러면 확인권장에서 검색했는데 나온 메일이 어디 것인지 알 수 없다.
      //   판정은 services/mailFolders.folderOf **한 곳** — folderWhere 와 같은 파일에 둬서
      //   폴더 정의가 바뀔 때 같이 바뀌게 했다(memory feedback_same_value_multiple_formulas).
      folder: require('./mailFolders').folderOf(obj),
      client: obj.Client,
      project: obj.Project,
      uncertain_reason: obj.uncertain_reason,
      spam_score: obj.spam_score,
      triage: obj.triage,
      // 2026-10-15 — 스팸 폴더 행이 «왜» 를 말한다(사칭 격리·업체 스팸·기준 id). docs/MAIL_IMPERSONATION_DESIGN.md §3·§6
      spam_origin: obj.spam_origin || null,
      triage_criterion: obj.triage_criterion || null,
      impersonation: require('./mailImpersonation').rowView(obj.impersonation),
    };
}

module.exports = { serializeThreadRow, resolveRecipientNames, resolveNamesForEmails, searchPartiesByThread };
