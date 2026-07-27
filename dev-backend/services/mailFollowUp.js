/**
 * "응답 없음 N일" — 보낸 메일에 답이 안 온 상태를 결정론적으로 계산한다.
 *
 * 왜 이것인가 (Fable 판단 2026-07-27, 읽음 확인 대안):
 *   Irene 요구는 "읽음 확인" 이었으나, 추적 픽셀은 **B2B 수신자에게 가장 부정확**하다 —
 *   Apple Mail Privacy Protection 과 기업 보안 게이트웨이(Defender·Mimecast)가 열람과 무관하게
 *   이미지를 프리페치해 **거짓 양성**을 만들고, 기업 Outlook 의 이미지 차단은 **거짓 음성**을 만든다.
 *   그 정확도로는 "후속 조치를 해야 하나" 라는 진짜 질문에 답할 수 없다.
 *
 *   반면 "마지막으로 보낸 뒤 답이 없다" 는 이미 있는 데이터(방향·시각)로 **거짓 양성/음성 없이**
 *   계산된다. 수집 항목이 0건이라 개인정보처리방침 개정도 필요 없다.
 *
 * 판정 규칙:
 *   · 스레드의 마지막 메시지가 outbound 여야 한다 (답이 왔으면 inbound 가 마지막)
 *   · **마지막 보낸 메일이 실제로 안 나갔으면(suppressed/failed/bounced) "응답 없음" 은 거짓**이다.
 *     그건 상대가 답을 안 한 게 아니라 우리가 못 보낸 것이므로 발송 문제로 따로 알린다.
 *   · 보관/스팸 스레드는 제외 — 이미 손 뗀 대화다
 *   · MIN_DAYS 미만은 노이즈 (며칠은 원래 기다린다)
 */

const MIN_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

// 실제로 상대에게 도달한 것으로 볼 수 있는 상태. 'delivered' 는 서버가 만들지 않지만 옛 데이터에 있다.
const DELIVERED_ENOUGH = new Set(['sent', 'delivered']);

// 손 뗀 대화 — 후속 조치 대상이 아니다.
const INACTIVE_STATUS = new Set(['archived', 'spam', 'closed']);

/**
 * @param {object} thread        { last_message_direction, last_message_at, status }
 * @param {object|null} lastOutbound  마지막 outbound 메시지 { delivery_status }
 * @param {Date} [now]
 * @returns {null | { kind: 'awaiting_reply', days: number } | { kind: 'delivery_problem', delivery_status: string }}
 */
function followUpState(thread, lastOutbound, now) {
  if (!thread) return null;
  if (INACTIVE_STATUS.has(String(thread.status))) return null;
  if (thread.last_message_direction !== 'outbound') return null;

  const ds = lastOutbound && lastOutbound.delivery_status;
  if (ds && !DELIVERED_ENOUGH.has(String(ds))) {
    // 못 보낸 것을 "응답 없음" 으로 표시하면 사용자가 상대를 탓하게 된다. 원인을 정확히 말한다.
    return { kind: 'delivery_problem', delivery_status: String(ds) };
  }

  const sentAt = thread.last_message_at ? new Date(thread.last_message_at) : null;
  if (!sentAt || isNaN(sentAt.getTime())) return null;
  const days = Math.floor(((now instanceof Date ? now : new Date()) - sentAt) / DAY_MS);
  if (days < MIN_DAYS) return null;
  return { kind: 'awaiting_reply', days };
}

module.exports = { followUpState, MIN_DAYS, DELIVERED_ENOUGH, INACTIVE_STATUS };
