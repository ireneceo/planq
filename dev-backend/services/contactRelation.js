// contactRelation — «이 주소는 누구인가» 의 **단일 원천** (#449·#450, docs/SALES_INTAKE_DESIGN.md §2.3)
//
// Q sales 상담 판정(saleMailCriteria.mailThreadVerdict)과 Q mail 답변필요 판정(emailTriage.needsReply ④)이
// «보낸 사람이 사람인가» 를 각자 갖고 있었다 — 상담엔 역할 주소 배제가 있고 메일 ④ 에는 없어,
// 메일 답변필요(미연결) 7건 중 6건이 약관·항공사 안내 같은 역할 주소였다(운영 2026-10-02 실측).
// 같은 질문은 이 파일 한 곳에서 답한다. «아는 상대»(고객·멤버·우리가 보낸 적 있는 주소)도 여기서 내보낸다.
//
// ★ 키워드로 가르지 않는다(saleMailCriteria 머리말의 2026-09-16 결정 그대로).

// 지연 require — emailTriage 가 이 파일을 부른다(순환).
const freeMailDomain = () => require('./emailTriage').FREE_MAIL_DOMAIN;

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

  if (freeMailDomain().test(domain)) {
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

/** 고객·멤버·우리가 보낸 적 있는 주소 — 메일 수집·재판정이 쓰는 그 함수(emailImapCron)를 그대로 내보낸다. */
function knownContact(businessId, email) {
  return require('./emailImapCron').isKnownContact(businessId, email);
}

module.exports = { isPersonalSender, knownContact, ROLE_WORD };
