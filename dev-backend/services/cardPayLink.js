// services/cardPayLink.js — 청구서 «외부 카드 결제 링크» + «대금 받는 곳» 한 벌 (2026-10-15).
//
// Irene: *"스트라이프는 그대로 두고 … 결제링크 만들어서 사용하는 간단한 결제솔루션 … 한국 고객에게 적합한거"*
//        *"워크스페이스에서 카드결제 과정에 대금 수신자 정보가 표시되어야지. 미리 설정에 입력한 걸로."*
//
// - 링크는 워크스페이스가 국내 결제 대행사(토스페이먼츠 링크페이·페이앱 등) 화면에서 만든 주소다.
//   PlanQ 는 그 주소를 고객용 청구서 화면 버튼으로 보여 줄 뿐 — 결제 결과를 받지 않으므로
//   «결제 완료» 는 지금처럼 발행자가 표시한다(자동 확정은 결제 API 연동 = 별도 설계).
// - 외부 주소를 DB 에 넣기 전에 https + 알려진 결제 대행사 도메인만 받는다(운영 안정성 4번).
//   목록에 없는 대행사는 여기 한 줄을 더한다 — 화면·라우트에 사본을 두지 않는다.
// - «대금 받는 곳» 은 결제 수단마다 다르다: Stripe 계정의 법인과 국내 대행사에 가입한 법인이
//   같지 않을 수 있다(PlanQ 자신이 그렇다 — 카드=말레이시아 법인, 계좌=한국 법인).
//   그래서 수단별로 저장하고, 비어 있으면 아무 이름도 지어내지 않는다(Stripe) /
//   청구서 공급자와 같다고 본다(링크 — 대개 그 사업자가 직접 가입한다).

// 결제 대행사 도메인(이 도메인 또는 그 하위 도메인). 바꾸면 ko/en 안내 문구(qbill settings.cardLink.domains)도 같이 본다.
const ALLOWED_PAY_DOMAINS = [
  'tosspayments.com', 'toss.im',            // 토스페이먼츠 링크페이
  'payapp.kr',                              // 페이앱
  'inicis.com',                             // KG이니시스
  'nicepay.co.kr', 'nicepay.com',           // 나이스페이
  'kcp.co.kr',                              // NHN KCP
  'kakaopay.com',                           // 카카오페이
  'naver.com',                              // 네이버페이
  'portone.io', 'iamport.kr',               // 포트원
  'payco.com',                              // 페이코
  'stripe.com',                             // Stripe Payment Links (buy.stripe.com)
  'paypal.com', 'paypal.me',                // PayPal
];

const MAX_URL = 500;

// 결과: { url } 정상(빈 값이면 url=null = 지우기) | { error } 거절 사유 코드
function normalizeCardPayUrl(raw) {
  if (raw === undefined) return { error: 'missing' };
  if (raw === null) return { url: null };
  const s = String(raw).trim();
  if (!s) return { url: null };
  if (s.length > MAX_URL) return { error: 'too_long' };
  let u;
  try { u = new URL(s); } catch { return { error: 'invalid_url' }; }
  if (u.protocol !== 'https:') return { error: 'https_only' };
  if (u.username || u.password) return { error: 'invalid_url' };
  const host = u.hostname.toLowerCase();
  const ok = ALLOWED_PAY_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
  if (!ok) return { error: 'domain_not_allowed' };
  return { url: u.toString() };
}

const PAYEE_KINDS = ['stripe', 'link'];

// businesses.card_payees 저장값 정규화 — { stripe:{name,reg_no}, link:{name,reg_no} }. 빈 칸은 null.
function normalizePayees(input, prev) {
  const base = (prev && typeof prev === 'object') ? prev : {};
  const out = {};
  for (const k of PAYEE_KINDS) {
    const src = (input && typeof input === 'object' && input[k] !== undefined) ? input[k] : base[k];
    const name = src && src.name ? String(src.name).trim().slice(0, 200) : null;
    const regNo = src && src.reg_no ? String(src.reg_no).trim().slice(0, 100) : null;
    out[k] = (name || regNo) ? { name, reg_no: regNo } : null;
  }
  return out;
}

// 고객용 청구서 화면에 보이는 «대금 받는 곳». sender = invoiceSender.senderBlockOf(business).
//   stripe: 설정한 값만(없으면 null — Stripe 결제 화면이 Stripe 계정의 공개 상호를 보여 준다).
//   link:   설정한 값, 없으면 청구서 공급자(법인명·사업자등록번호).
function payeesForPublic(business, sender) {
  const raw = business && (typeof business.get === 'function' ? business.get('card_payees') : business.card_payees);
  const p = normalizePayees(raw, null);
  const fallbackLink = sender && (sender.biz_name || sender.name)
    ? { name: sender.biz_name || sender.name, reg_no: sender.tax_id || null }
    : null;
  return { stripe: p.stripe, link: p.link || fallbackLink };
}

module.exports = { ALLOWED_PAY_DOMAINS, normalizeCardPayUrl, normalizePayees, payeesForPublic, PAYEE_KINDS };
