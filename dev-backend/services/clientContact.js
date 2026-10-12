// 고객에게 메일을 보낼 주소 — **한 함수**(docs/SURVEY_V2_DESIGN.md §5.1).
//
// 순서: 계정 이메일(Client.user_id → User.email) → 초대 이메일(clients.invite_email) → 프로젝트 고객 담당 이메일(project_clients.contact_email).
//   ★ tax_invoice_email·billing_contact_email 은 회계 주소라 쓰지 않는다(리뷰·만족도 메일이 회계 담당에게 가면 안 된다).
//   지금 같은 폴백 사슬이 여러 곳에 손으로 흩어져 있다(saleInbox·project_actions 등) — 설문부터 이 함수를 쓴다.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const clean = (v) => {
  const s = String(v || '').trim();
  return s && s.length <= 254 && EMAIL_RE.test(s) ? s : null;
};

/** 이 고객의 보낼 주소(없으면 null). client 는 인스턴스든 평범한 객체든 된다. user = 미리 읽어 둔 User(선택). */
async function primaryEmailOf(client, projectClient = null, user = undefined) {
  if (!client) return null;
  let u = user;
  if (u === undefined && client.user_id) {
    const { User } = require('../models');
    u = await User.findByPk(client.user_id, { attributes: ['id', 'email'] });
  }
  return clean(u && u.email) || clean(client.invite_email) || clean(projectClient && projectClient.contact_email) || null;
}

/** 화면에 보일 이름 — 표시명 → 회사명 → 이메일. */
function displayNameOf(client) {
  if (!client) return '';
  return String(client.display_name || client.company_name || client.invite_email || '').trim().slice(0, 100);
}

module.exports = { primaryEmailOf, displayNameOf, cleanEmail: clean };
