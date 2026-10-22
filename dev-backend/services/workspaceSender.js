// 워크스페이스가 «자기 고객에게» 보내는 메일의 보낸 사람 — 한 벌 (2026-10-22, Fable 판정 docs/MAIL_SUBJECT_PREFIX_REVIEW.md §4)
//
// Irene: "워크스페이스 이메일 발신자로 가는 메일에는 제목부터 굳이 [PlanQ] 이런거 넣지 말자. 고객사들에게 안좋은 것 같아."
//
// 고객행 메일(청구·독촉·증빙·설문·상담 예약·서명 요청·서명 인증 코드·공유·고객 초대·게스트 답글)은
//   표시 이름 = 워크스페이스(mail_from_name → brand_name → name) · 회신 = mail_reply_to · 제목 접두어 없음.
//   보내는 **주소**는 그대로 noreply@planq.kr 이다(sendEmail) — 워크스페이스 도메인을 From 에 넣으면 SPF/DKIM 정렬이 깨진다.
// 예전에는 호출부 9곳이 같은 사슬을 복사했고, 일부는 이름이 비면 'PlanQ' 로 채워 푸터에
//   «PlanQ 에서 보낸 메일입니다» 라는 거짓 줄을 만들었다. 이름이 비면 빈 값이다 — 대체 이름은 sendEmail 한 곳(PLATFORM.brand)뿐.
// 멤버에게 가는 알림(notify·다이제스트·멤버 초대)은 여기를 쓰지 않는다 — 보낸 사람 PlanQ · 제목 [워크스페이스명] 그대로.

const SENDER_ATTRIBUTES = ['id', 'name', 'brand_name', 'mail_from_name', 'mail_reply_to'];

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function clean(v) {
  const s = String(v == null ? '' : v).trim();
  return s || '';
}

/** @returns {{ workspaceName: string, fromName: string|undefined, replyTo: string|undefined }} */
function workspaceSender(biz) {
  const workspaceName = clean(biz?.brand_name) || clean(biz?.name);
  const fromName = clean(biz?.mail_from_name) || workspaceName || undefined;
  const reply = clean(biz?.mail_reply_to);
  return { workspaceName, fromName, replyTo: EMAIL_RE.test(reply) ? reply : undefined };
}

async function loadWorkspaceSender(businessId) {
  if (!businessId) return workspaceSender(null);
  const { Business } = require('../models');
  const biz = await Business.findByPk(businessId, { attributes: SENDER_ATTRIBUTES });
  return workspaceSender(biz);
}

module.exports = { workspaceSender, loadWorkspaceSender, SENDER_ATTRIBUTES };
