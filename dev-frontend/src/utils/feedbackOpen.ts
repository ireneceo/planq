// 피드백 진입점 — "여기서 문제가 났다" 를 그 자리에서 바로 보낼 수 있게.
//
// 왜 필요한가 (Irene 2026-09-03): "우리 피드백 달라고 해서 바로 피드백으로 연결하는 거
//   여기 저기 적합한 상황에 나오게 구상할 수 있어?"
//   여태 피드백은 우측 하단 버튼 하나뿐이었다. 오류를 만난 사용자가 그 버튼을 찾아 누르고,
//   무슨 화면에서 뭘 하다 그랬는지 **다시 글로 적어야** 했다. 대부분은 그냥 안 쓴다.
//
// 그래서: 오류가 난 자리에서 바로 열고, 무엇이 어디서 잘못됐는지는 화면이 실어 보낸다.
//
// ★ 여기에 사용자 데이터 본문(메일 내용·문서 본문·고객명 등)을 담지 말 것.
//   서버(routes/feedback.js sanitizeErrorContext)가 허용 키만 남기지만, 애초에 보내지 않는다.

/** 피드백 폼이 함께 받을 사건 맥락. 서버 CTX_KEYS 와 같은 목록이다. */
export interface FeedbackContext {
  /** 어느 기능인가 — 'qbill' | 'qtalk' | 'qdocs' … */
  area?: string;
  /** 무엇을 하다 났나 — 'invoice_send' | 'file_open' … */
  action?: string;
  /** 서버 코드 또는 HTTP 상태 */
  code?: string | number;
  /** 사용자에게 보인 오류 문구 */
  message?: string;
  entity_type?: string;
  entity_id?: string | number;
  status?: string;
  detail?: string;
}

export const FEEDBACK_OPEN_EVENT = 'planq:feedback-open';

export interface FeedbackOpenDetail {
  context?: FeedbackContext;
  /** 본문에 미리 채울 문장. 없으면 맥락으로 만든다. */
  prefill?: string;
  /** 분류 기본값 */
  category?: 'bug' | 'improve' | 'feature' | 'other';
}

/** 맥락을 사람이 읽는 한 줄로. 폼 본문 상단에 들어간다. */
export function describeContext(ctx?: FeedbackContext): string {
  if (!ctx) return '';
  const bits: string[] = [];
  if (ctx.area) bits.push(ctx.area);
  if (ctx.action) bits.push(ctx.action);
  if (ctx.entity_type && ctx.entity_id != null) bits.push(`${ctx.entity_type}#${ctx.entity_id}`);
  if (ctx.code != null) bits.push(String(ctx.code));
  const head = bits.join(' · ');
  const msg = ctx.message ? `\n${ctx.message}` : '';
  return head || msg ? `${head}${msg}` : '';
}

/**
 * 피드백 폼을 연다. 어디서든 부를 수 있다.
 * ★ 단일 진입점이다 — 각 화면이 드로어를 직접 여는 코드를 따로 쓰면 반드시 갈라진다
 *   (알림·새 소식 드롭다운이 서로를 베껴 갈라졌던 것과 같은 모양).
 */
export function openFeedback(detail: FeedbackOpenDetail = {}): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<FeedbackOpenDetail>(FEEDBACK_OPEN_EVENT, { detail }));
}
