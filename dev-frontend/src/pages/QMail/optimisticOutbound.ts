// 발송 낙관 반영 (2R-2) — 순수 함수. 상태 조작 규칙을 한곳에 모아 롤백 누락을 막는다.
//
// 왜: 여태 sendReply 는 POST 응답을 기다린 뒤에야 화면을 갱신했다. 운영에서는 그 POST 안에
//   실제 SMTP 왕복이 들어 있어 수 초가 걸린다 — 그동안 보낸 메일이 어디에도 보이지 않는다
//   (Irene: "메일 보낸 후 보낸 내용이 바로 화면 안바뀌고 늦어").
//   그래서 클릭 즉시 임시 카드를 넣고, 응답이 오면 **치환**한다(추가가 아니라 치환 — 안 그러면
//   같은 메일이 두 장이 된다).
//
// ★ 임시 id 는 **음수**다. 서버 id 와 절대 겹치지 않아야 치환/롤백 대상을 틀리지 않는다.
// ★ 실패하면 임시 카드를 걷어내고 작성 내용을 그대로 돌려준다 — 사용자가 쓴 글을 잃지 않는다.
import type { Message } from './MailPage';

/** 낙관 카드의 발송 상태. 서버 ENUM('pending'|'sent'|...) 과 겹치지 않는 화면 전용 값. */
export const SENDING = 'sending';

let seq = 0;
export function nextTempId(): number {
  seq += 1;
  return -seq;
}

export function makePendingMessage(input: {
  tempId: number;
  bodyHtml: string;
  bodyText: string;
  toEmails: string[];
  subject: string;
  myUserId: number | null;
}): Message {
  return {
    id: input.tempId,
    direction: 'outbound',
    from_email: null,
    from_name: null,
    to_emails: input.toEmails,
    cc_emails: [],
    subject: input.subject,
    body_html: input.bodyHtml,
    body_text: input.bodyText,
    sent_at: new Date().toISOString(),
    is_read: true,
    sent_by_user_id: input.myUserId,
    sent_by_name: null,
    delivery_status: SENDING,
    delivery_error: null,
    attachments: [],
    inline_images: [],
  } as unknown as Message;
}

type WithMessages<T> = T & { messages: Message[] };

/** 오름차순 정본의 **끝**에 붙인다 — 화면은 이 배열을 뒤집어 보여주므로 맨 위에 나타난다. */
export function insertPending<T>(detail: WithMessages<T> | null, msg: Message): WithMessages<T> | null {
  if (!detail) return detail;
  return { ...detail, messages: [...detail.messages, msg] };
}

/** 임시 카드를 걷어낸다 (발송 실패 롤백). */
export function removePending<T>(detail: WithMessages<T> | null, tempId: number): WithMessages<T> | null {
  if (!detail) return detail;
  return { ...detail, messages: detail.messages.filter((m) => m.id !== tempId) };
}

/** 임시 카드를 서버가 준 실제 메시지로 **치환**한다. 임시 카드가 이미 없으면 그대로 둔다
 *  (그 사이 loadDetail 이 권위 데이터로 덮었다는 뜻 — 여기서 붙이면 중복이 된다). */
export function replacePending<T>(
  detail: WithMessages<T> | null,
  tempId: number,
  real: Message | null,
): WithMessages<T> | null {
  if (!detail) return detail;
  const at = detail.messages.findIndex((m) => m.id === tempId);
  if (at < 0) return detail;
  const next = [...detail.messages];
  if (real) next[at] = real; else next.splice(at, 1);
  return { ...detail, messages: next };
}
