// Q Mail 스레드 목록 행 직렬화 — routes/email_threads.js 에서 절출 (god-file 래칫).
//
// 폴더별 표시 분기가 여기 모인다. 특히 보낸메일함(#262)은 "상대편·미리보기·시각"이 전부
// **내가 보낸 메시지** 기준이어야 한다 — 여태 폴더와 무관하게 마지막 inbound 를 그려서
// 보낸메일함인데 받는 사람이 아니라 보낸 사람이 떴다.
const { followUpState } = require('./mailFollowUp');

function serializeThreadRow(t, { folder, senderByThread, lastOutByThread, attachCountByThread }) {

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
      if (toEmail || toName) other = { name: toName, email: toEmail };
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

module.exports = { serializeThreadRow };
