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
  'noreply', 'donotreply', 'mailerdaemon', 'postmaster', 'notifications', 'jobalerts',
]);

/** 발송 전용 주소 모양 — **구분자를 걷어낸 통짜**로 본다.
 *
 *  ★ 2026-09-17 — 처음엔 `no`·`reply`·`do`·`not`·`system` 을 **낱말로** ROLE_WORD 에 넣었다.
 *    `no-reply@grab.com` 은 막혔지만, Fable 15차가 부작용을 실증했다 —
 *    `do.yeon@acme.co.kr` · `system.kim@corp.co.kr` · `ji.no@` · `bot.lee@` 같은 **진짜 이름**이
 *    같이 잘린다(한국 이름에 흔한 토막이다). 운영엔 아직 없지만 시간문제다.
 *  → 낱말이 아니라 **붙어 있는 모양**만 본다. `no-reply`·`do_not_reply` 는 걸리고
 *    `do.yeon`·`ji.no` 는 안 걸린다. 좁게 틀리는 쪽을 고른다. */
const SENDER_ONLY_SHAPE = /^(no|do)?n?o?t?reply|^donotreply|^noreply|noreply$|^mailer(daemon)?$|^postmaster$|^bounces?$|^auto(mated)?reply$|^notification(s)?$|^alerts?$|^jobalerts/;

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
  // 발송 전용 모양 — 구분자를 걷어낸 통짜로 본다(위 주석: 낱말로 보면 진짜 이름이 잘린다)
  if (SENDER_ONLY_SHAPE.test(local.replace(/[._-]+/g, ''))) return false;

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
 * @param {boolean} p.archived         Q mail 에서 **[확인완료]** 를 누른 스레드인가
 * @returns {{kind:'inquiry'|'candidate', reason:string}}
 */
function mailThreadVerdict({ email = null, outboundCount = 0, promoted = false, archived = false } = {}) {
  // 사람의 판단이 기계보다 위다 — 올린 것은 기준을 다시 묻지 않는다.
  if (promoted) return { kind: 'inquiry', reason: 'promoted' };
  // 우리가 한 번이라도 답했다 = 이미 관계다. (상대가 우리 메일에 회신한 경우도 이 스레드에
  //   우리 발신이 있으므로 여기서 함께 걸린다 — 축을 둘로 나누지 않는다.)
  if (Number(outboundCount) > 0) return { kind: 'inquiry', reason: 'replied' };

  // ★ **확인완료한 것에는 «개인 주소» 추정을 쓰지 않는다** (2026-09-17, Fable 15차 차단).
  //   «확인완료 + 우리 답 없음» 은 사람이 **보고 무시했다**는 가장 강한 신호다.
  //   그런데 주소 모양만 보고 관계로 읽으면, Q mail 에서 치운 은행 거래 알림·몰 회람·콜드 스팸이
  //   전부 상담으로 되살아난다 — 운영 실측(owner 계정 2개 합산) **4 → 48**, 그중 32건이 그 모양이었다.
  //   확인완료한 것은 **행위로 증명된 관계**(우리가 답했다 / 사람이 올렸다)일 때만 들인다.
  //   그래도 놓친 것은 Q mail 우클릭 [상담으로 보내기] 로 올린다 — 문은 그대로다.
  if (archived) return { kind: 'candidate', reason: 'handled_no_reply' };

  if (isPersonalSender(email)) return { kind: 'inquiry', reason: 'personal' };
  return { kind: 'candidate', reason: 'no_relationship' };
}

module.exports = { mailThreadVerdict, isPersonalSender, ROLE_WORD };
