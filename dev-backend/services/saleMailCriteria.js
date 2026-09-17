// saleMailCriteria — "이 메일을 영업 상담으로 **자동으로** 들일 것인가"
//
// Irene 2026-09-16: *"Q sale에서 상담리스트에서 메일이 너무 쓸데없이 많이 들어와.
//   그냥 신청하라는 홍보메일도 가져오면 어떻게 해? 영업 상담으로 가져오는 기준설정 좀 잡아봐."*
//
// ★ 키워드로 가르지 않는다. 그 길은 이미 두 번 걸었고 두 번 다 샜다 —
//   발송전용 주소 패턴(`AUTOMATED_SENDER`)을 늘리고, 광고 표기·List-* 헤더를 보탰는데도
//   운영 실측(2026-09-16, 고객 미연결 `triage='human'` 32건)에서 상담 목록에 오른 것은:
//     · `[With Min]: New order #3162~3171` 쇼핑몰 주문 알림 10건 (`help@withmin.info`)
//     · 11번가 개인정보 통지 · 롯데카드 약관 · MS 약관 · 삼성생명 안내 · Tripadvisor 광고
//     · **[한국무역협회] 수출상담회 참가 신청** ← Irene 이 말한 "신청하라는 홍보메일" 바로 그것
//   진짜 문의는 7건뿐이었고, 그중 5건이 **우리가 이미 회신했거나 개인 주소**였다.
//   패턴을 더 늘리면 진짜 문의를 떨어뜨린다(2026-09-12 실측: 과한 기준이 903 → 10 으로 잘랐다).
//
// 그래서 축을 **관계**로 바꾼다. 자동으로 들어오는 것은 관계가 증명된 것뿐이고,
// 나머지는 버리지 않고 **「후보」** 로 모아 사람이 한 번 눌러 올린다(routes/sale_save.js `inbox/promote`).
// 좁힌 기준의 대가를 갚을 문이 있어야 기준을 좁힐 수 있다 — 둘은 한 벌이다.
//
// ★ 판정은 여기 한 곳이다. `saleInbox` 는 목록과 **집계**를 각각 도는데(공식이 두 벌이면 이미
//   갈라져 있다 — memory feedback_same_value_multiple_formulas) 둘 다 이 함수를 부른다.

const { FREE_MAIL_DOMAIN } = require('./emailTriage');

/** 역할·브랜드 계정의 local-part. 사람 이름이 아니라 **자리**를 가리키는 말이다. */
const ROLE_WORD = new Set([
  'help', 'hello', 'hi', 'support', 'info', 'information', 'sales', 'sale', 'savings', 'news',
  'newsletter', 'order', 'orders', 'billing', 'account', 'accounts', 'service', 'services',
  'team', 'contact', 'shop', 'store', 'care', 'cs', 'customer', 'marketing', 'event', 'events',
  'promo', 'promotion', 'notice', 'member', 'members', 'master', 'webmaster', 'security',
  'hr', 'recruit', 'careers', 'job', 'jobs', 'office', 'mail', 'email', 'center', 'centre',
  'admin', 'administrator', 'welcome', 'invite', 'invoice', 'payment', 'pay', 'delivery',
  'shipping', 'return', 'refund', 'partner', 'partners', 'biz', 'business', 'global', 'kr', 'korea',
  // ★ 2026-09-17 — **발송전용 주소가 «개인» 으로 새고 있었다.**
  //   `no-reply@grab.com` 은 `.`·`-` 로 쪼개면 토큰이 ['no','reply'] 인데 둘 다 이 목록 밖이라
  //   «역할어만으로 된 주소» 판정을 빠져나가 개인 주소가 됐다. 운영 실측 — 이런 모양이
  //   marketing/personal 로 잡힌 것이 biz1 252건 · biz5 169건.
  //   지금은 `triage='human'` 조건이 우연히 막아 주고 있을 뿐이라, 그 조건을 조금만 넓히면
  //   상담 목록이 250건 늘어난다. 막아 주는 것이 있다고 새는 곳을 두지 않는다.
  'no', 'noreply', 'reply', 'donotreply', 'do', 'not', 'nreply', 'auto', 'automated', 'robot', 'bot',
  'notification', 'notifications', 'alert', 'alerts', 'jobalerts', 'messages', 'message',
  'mailer', 'mailerdaemon', 'daemon', 'postmaster', 'bounce', 'bounces', 'system', 'noresponse',
]);

const splitLocal = (local) => String(local || '').split(/[._-]+/).filter(Boolean);

/**
 * 보낸 사람이 **개인**인가 — 회사의 자리(role)가 아니라 한 사람의 주소인가.
 *
 * 두 갈래만 인정한다(느슨하게 잡으면 기준이 없는 것과 같다):
 *  ① 무료메일(gmail·naver…)의 개인 계정 — 실측에서 진짜 문의 2건이 정확히 이 모양이었다
 *     (`tropicanaavenue21@gmail.com` 수도요금 문의 · `joannelow98@gmail.com` 임대차 초안).
 *  ② 회사 도메인인데 local-part 가 **이름 두 토막 이상**(`joanne.low`·`ahmadaqmalbin.shaifulkharidan`).
 *     단, 토막이 전부 역할어면 이름이 아니다 — `email_center@lottecardmailcenter.net` 이 그 함정이다.
 *
 * ★ 단일 토막 회사 주소(`peichin@aimcoffee.com`)는 **후보로 떨어진다.** 진짜 문의일 수 있지만
 *   `tara@reworkhome.com`(뉴스레터)와 기계적으로 구별되지 않는다. 구별 못 하는 것을 구별한 척
 *   하지 않고, 사람이 한 번 눌러 올리게 한다.
 */
function isPersonalSender(email) {
  const addr = String(email || '').trim().toLowerCase();
  const at = addr.lastIndexOf('@');
  if (at <= 0) return false;
  const local = addr.slice(0, at);
  const domain = addr.slice(at + 1);
  if (!domain) return false;

  const tokens = splitLocal(local);
  if (!tokens.length) return false;
  // 역할어 하나로만 된 주소는 사람이 아니다 (help@ · info@ · savings@)
  const allRole = tokens.every((tk) => ROLE_WORD.has(tk));
  if (allRole) return false;

  if (FREE_MAIL_DOMAIN.test(domain)) {
    // 무료메일이어도 역할어 주소는 개인이 아니다(info@gmail.com 류)
    return true;
  }

  // 회사 도메인 — 발송 계정은 흔히 **도메인 이름을 그대로** 쓴다(11st@…11st · hanacard@hanacard · idbins@dbins)
  const domainRoot = domain.split('.').filter((p) => !/^(co|com|net|org|kr|jp|my|info|biz|io|dev)$/.test(p)).pop()
    || domain.split('.')[0];
  if (domainRoot && local.replace(/[._-]+/g, '').includes(domainRoot.replace(/[^a-z0-9]/g, ''))) return false;

  // 이름 두 토막 이상 + 숫자로 범벅이 아닌 것
  const nameish = tokens.filter((tk) => /^[a-z가-힣]{2,}$/.test(tk) && !ROLE_WORD.has(tk));
  return nameish.length >= 2;
}

/**
 * 한 메일 스레드의 판정.
 * @param {object} p
 * @param {string} p.email            바깥 사람의 주소
 * @param {number} p.outboundCount    이 스레드에서 **우리가 보낸** 메일 수
 * @param {boolean} p.promoted        사람이 [상담으로 보내기] 를 눌렀는가
 * @returns {{kind:'inquiry'|'candidate', reason:string}}
 */
function mailThreadVerdict({ email = null, outboundCount = 0, promoted = false } = {}) {
  // 사람의 판단이 기계보다 위다 — 올린 것은 기준을 다시 묻지 않는다.
  if (promoted) return { kind: 'inquiry', reason: 'promoted' };
  // 우리가 한 번이라도 답했다 = 이미 관계다. (상대가 우리 메일에 회신한 경우도 이 스레드에
  //   우리 발신이 있으므로 여기서 함께 걸린다 — 축을 둘로 나누지 않는다.)
  if (Number(outboundCount) > 0) return { kind: 'inquiry', reason: 'replied' };
  if (isPersonalSender(email)) return { kind: 'inquiry', reason: 'personal' };
  return { kind: 'candidate', reason: 'no_relationship' };
}

module.exports = { mailThreadVerdict, isPersonalSender, ROLE_WORD };
