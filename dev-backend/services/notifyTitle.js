// services/notifyTitle.js — 알림 제목 규약의 단일 원천.
//
// 왜 있는가 (운영 #281 · #214)
//   Irene: "채팅인지 메일인지 몰라서 헷갈려." / "어떤 곳의 어떤 목적의 어떤 발송처인지 전수검사해서 재정리해."
//   실측 결과 제목 형식이 **약 30종 · 20여 파일**로 제각각이었다. 메일은 `확인 권장 — {발신자}`,
//   업무는 `{행위 문장}`, 채팅은 `{보낸사람} · {방이름}` … 어느 기능에서 온 알림인지 제목에 없다.
//
// 규약
//   `{기능 라벨} · {행위}`  예) `Q Mail · 답변 필요 · 홍길동`
//                              `Q Task · 컨펌 요청 · "로고 수정"`
//   - **첫 토큰이 항상 기능명** — 알림 목록을 훑을 때 출처가 먼저 읽힌다.
//   - 워크스페이스명은 제목에 넣지 않는다. 본문 접두(`[워프로랩]`, emailService.subjectPrefix)가 담당한다.
//   - OS 알림에 사이트/앱 이름을 **우리가 덧붙이지 않는다** — 브라우저·OS 알림 크롬이 이미 표기한다.
//     (사용자가 본 "확인 권장 — PlanQ" 의 'PlanQ' 는 브라우저가 아니라 메일 발신자명이었다.)
//
// ★ 언어 해석 시점 (Fable 게이트 치명-3)
//   알림 제목은 `notifications.title` 에 **문자열로 박제**되고 push payload 로 그대로 나간다.
//   프론트 t() 로는 push·email·이미 저장된 row 를 번역할 수 없다. 그래서 **발송 시점에
//   수신자의 User.language 로 해석**한다. 호출부는 lang 을 넘기고, 모르면 'ko' 로 떨어진다.

const FEATURES = {
  mail: { ko: 'Q Mail', en: 'Q Mail' },
  task: { ko: 'Q Task', en: 'Q Task' },
  chat: { ko: 'Q Talk', en: 'Q Talk' },
  calendar: { ko: 'Q Calendar', en: 'Q Calendar' },
  bill: { ko: 'Q Bill', en: 'Q Bill' },
  docs: { ko: 'Q docs', en: 'Q docs' },
  note: { ko: 'Q Note', en: 'Q Note' },
  system: { ko: '시스템', en: 'System' },
};

// 행위 라벨 — ko/en 양쪽 필수 (CLAUDE.md i18n 규칙).
//   ★ 백엔드 문자열은 i18n 가드(`--category=i18n`)가 보지 않는 사각지대다
//     (가드는 dev-frontend/src 만 walk 한다). 여기 표가 사실상의 정본이므로
//     새 행위를 추가할 때 en 을 빼먹지 말 것.
const ACTIONS = {
  // Q Mail
  mail_reply_needed: { ko: '답변 필요', en: 'Reply needed' },
  mail_review: { ko: '확인 권장', en: 'Review suggested' },
  mail_account_failed: { ko: '계정 동기화 실패', en: 'Account sync failed' },
  mail_account_reauth: { ko: '재연결 필요', en: 'Reconnect required' },
  // Q Task
  task_assigned: { ko: '새 업무 배정', en: 'Assigned to you' },
  task_ack: { ko: '요청 확인함', en: 'Request acknowledged' },
  task_review_request: { ko: '컨펌 요청', en: 'Approval requested' },
  task_review_canceled: { ko: '컨펌 요청 취소', en: 'Approval request canceled' },
  task_approved: { ko: '컨펌 승인', en: 'Approved' },
  task_revision: { ko: '수정 요청', en: 'Changes requested' },
  task_completed: { ko: '완료', en: 'Completed' },
  task_due_changed: { ko: '마감일 변경', en: 'Due date changed' },
  task_comment: { ko: '새 댓글', en: 'New comment' },
  task_mention: { ko: '멘션', en: 'Mentioned you' },
  task_hold: { ko: '보류', en: 'On hold' },
  task_external_review: { ko: '외부 컨펌 대기', en: 'Awaiting external approval' },
  task_external_review_done: { ko: '외부 컨펌 종료', en: 'External approval finished' },
  task_resumed: { ko: '보류 해제', en: 'Resumed' },
  task_recurring_created: { ko: '정기 업무 생성', en: 'Recurring task created' },
  task_reviewer_added: { ko: '컨펌자 지정', en: 'Added as approver' },
  task_comment_mention: { ko: '댓글 멘션', en: 'Mentioned in a comment' },
  // Q docs / 공유
  share_expiry_soon: { ko: '공유 링크 만료 임박', en: 'Share link expiring soon' },
  // Q Talk
  chat_message: { ko: '새 메시지', en: 'New message' },
  chat_mention: { ko: '멘션', en: 'Mentioned you' },
  // Q Calendar
  calendar_invite: { ko: '일정 초대', en: 'Event invitation' },
  calendar_soon: { ko: '곧 시작', en: 'Starting soon' },
  calendar_response: { ko: '참석 응답', en: 'RSVP' },
  // Q Bill
  bill_payment_notice: { ko: '송금 통보', en: 'Payment notice' },
  bill_receipt_request: { ko: '증빙 발행 요청', en: 'Receipt requested' },
  bill_receipt_issued: { ko: '증빙 발행 완료', en: 'Receipt issued' },
  bill_invoice_sent: { ko: '청구서 도착', en: 'Invoice received' },
  bill_paid: { ko: '결제 완료', en: 'Payment received' },
  bill_recurring_review: { ko: '정기 청구서 검토', en: 'Recurring invoice review' },
};

function pickLang(lang) {
  const l = String(lang || '').split('-')[0].toLowerCase();
  return l === 'en' ? 'en' : 'ko';
}

/**
 * 알림 제목을 규약대로 만든다.
 *   buildTitle({ feature: 'task', action: 'task_due_changed', subject: '"로고 수정"', lang: 'ko' })
 *     → 'Q Task · 마감일 변경 · "로고 수정"'
 *
 * @param {string} feature FEATURES 키 (mail/task/chat/calendar/bill/docs/note/system)
 * @param {string} action  ACTIONS 키. 표에 없으면 rawAction 문자열을 그대로 쓴다.
 * @param {string} [subject] 대상 이름(업무명·발신자·방이름 등). 없으면 생략.
 * @param {string} [lang]  수신자 언어 (User.language). 기본 ko.
 * @param {string} [rawAction] ACTIONS 에 아직 없는 행위를 임시로 넘길 때.
 */
function buildTitle({ feature, action, subject, lang, rawAction }) {
  const L = pickLang(lang);
  const f = FEATURES[feature]?.[L] || FEATURES[feature]?.ko || '';
  const a = ACTIONS[action]?.[L] || ACTIONS[action]?.ko || rawAction || '';
  const parts = [f, a].filter(Boolean);
  const s = String(subject || '').trim();
  if (s) parts.push(s.length > 60 ? `${s.slice(0, 60)}…` : s);
  return parts.join(' · ');
}

/** 수신자 언어 조회 — notify() 가 발송 직전에 쓴다. 실패해도 ko 로 떨어진다. */
async function recipientLang(userId) {
  try {
    const { User } = require('../models');
    const u = await User.findByPk(userId, { attributes: ['language'] });
    return pickLang(u?.language);
  } catch { return 'ko'; }
}

module.exports = { buildTitle, recipientLang, FEATURES, ACTIONS };
