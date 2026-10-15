// 메일 분류 기준 목록 — **판정 엔진과 설정 화면이 같은 목록을 읽는다** (docs/MAIL_CRITERIA_DESIGN.md §3).
//
// Irene 2026-10-15: *"상세 조건들을 모두 설정에 나오게 하고 우리끼리 가지고 있지 말고 투명하게 공개하자."*
//   여태 기준은 emailTriage.js 안의 정규식 상수로만 있었고, 설정 화면은 따로 쓴 4줄 요약이었다 —
//   설명과 코드가 갈라질 수밖에 없는 모양이다(memory feedback_comment_lies_predicate_drifts).
//   그래서 기준의 **이름·폴더·끌 수 있는지·찾는 낱말**을 여기 한 곳에 둔다. 엔진(emailTriage)은 이 낱말로
//   정규식을 만들고, 설정 화면(GET /mail-criteria)은 같은 낱말을 그대로 보여 준다.
//   설명 문구는 코드에 없다 — 화면이 i18n 키 qmail:criteria.<id>.{title,desc} 로 그린다(ko/en).
//
// folder — 그 기준이 메일을 어디로 보내는가
//   reply  답변 필요 · review  확인 권장 · demote  답변 필요에서 뺌(자동·마케팅 쪽) · spam 스팸
// lockable — true 면 끌 수 없다(보이기만). 끄면 메일이 갈 곳이 없거나, 영수증이 답변 필요로 쏟아지는 기준이다.
// order — 엔진이 보는 순서 = 화면 순서(§3.3).

// 낱말(정규식 조각) — 엔진과 화면이 같이 읽는다. 순서·내용을 바꾸면 판정이 바뀐다.
const TERMS = {
  direct_request: [
  '문의(드|합|가|를|사항)', '요청(드|합|이|을|사항)', '부탁\\s*(드|합)', '의뢰',
  '회신\\s*(부탁|주|바랍)', '답변\\s*(부탁|주|바랍)', '검토\\s*(부탁|요청|해\\s*주)',
  // '확인 바랍니다' 는 고지서·통지문의 상투구다 → 강한 요청으로 보지 않는다 (아는 상대면 어차피 답변 필요)
  '확인\\s*부탁', '보내\\s*주(세요|시)', '알려\\s*주(세요|시)', '주실\\s*수\\s*있',
  '견적', '계약서', '청구서', '세금계산서', '입금\\s*(확인|예정|완료)',
  '(미팅|회의|일정)\\s*(잡|조율|가능|어떠)', '가능(할까요|한가요|하신가요|하실까요)',
  '\\bcould you\\b', '\\bcan you\\b', '\\bwould you\\b', '\\bplease (send|share|review|confirm|advise|let us know)\\b',
  '\\brequest for\\b', '\\bquotation?\\b', '\\binquiry\\b', '\\bproposal\\b',
  '\\blooking forward to your (reply|response)\\b', '\\bawaiting your\\b',
  // 2026-09-11 Irene: "Ms Joanne Low 가 보낸 거 답변을 꼭 해야 하는 내용인데 답변필요에 배치가 안되었어"
  //   말레이시아·영국식 업무 영어 관용구가 목록에 없어 요청으로 안 잡혔다
  //   ("Kindly vet through and let me know if there are amendments" · "for your perusal and comments").
  //   ★ 'let me know' 단독은 넣지 않는다 — 콜드메일 상투구("let me know if you're interested")까지 잡힌다.
  //   운영 3,206통 시뮬레이션: 이 관용구만으로 뒤집히는 판정 0건(오승격 0) · 양성 대조군 2/2.
  '\\bkindly (vet|review|check|confirm|advise|revert|reply|respond|provide|send|arrange|prepare|sign|let (me|us) know)\\b',
  '\\bplease (revert|advise|vet|sign|check and confirm)\\b',
  '\\bfor your (perusal|review|comments?|approval|confirmation|signature|vetting)\\b',
  '\\blet (me|us) know if (there (are|is)|you (have|need|agree))\\b',
  '\\bdraft (agreement|contract|tenancy agreement)\\b',
  ],
  automated_relevant: [
  // 돈 — 결제·입금·증빙 (놓치면 돈이 샌다)
  '결제', '입금', '출금', '송금', '환불',   // 돈이 움직인 알림은 자동이어도 반드시 본다
  '청구서', '세금계산서', '현금영수증', '거래명세', '정산(서|\\s*내역)', '납부(\\s*안내|\\s*기한)?', '연체', '미납',
  '\\bpayment (received|failed|confirmed|due)\\b', '\\binvoice\\b', '\\breceipt\\b', '\\brefund(ed)?\\b',
  '\\bsubscription (renewed|canceled|cancelled|expiring|payment)\\b',
  // 문서·서명·계약
  '서명(\\s*요청|\\s*완료|하셨)', '전자계약', '계약(서|\\s*체결|\\s*완료)', '견적서', '제안서',
  '\\bsignature request\\b', '\\bsigned\\b', '\\bcontract\\b',
  // 보고서
  '보고서', '주간\\s*보고', '월간\\s*보고', '리포트가', '\\bweekly (report|summary|digest)\\b', '\\breport is ready\\b',
  // 발송 실패·반송 (고객에게 메일이 안 갔다는 뜻 — 반드시 봐야 한다)
  'delivery status notification', '반송', '\\bundeliverable\\b', '\\bmail delivery failed\\b',
  // 계정·운영 사고
  '서비스\\s*(장애|중단)', '보안\\s*(경고|사고|알림)', '개인정보\\s*유출', '비밀번호\\s*(재설정|변경)',
  '\\b(account|password|certificate|domain|card) (expir|suspend)', '\\bsecurity alert\\b', '\\bincident\\b',
  // #221 — **내가 움직여야 완료되는** 자동 메일. 돈이 오간 것도 사고도 아니라서 위 어느 범주에도
  //   안 걸렸고, 그래서 Apple Developer 등록 안내("등록 절차를 완료하려면 로그인…")가 자동·마케팅
  //   폴더에 묻혔다 — Irene: "무조건 확인해야 하는데 확인권장에 안 들어와서 업무 미스 했어."
  //   답장할 상대는 없으니 답변 필요가 아니라 **확인 권장**까지만 올린다.
  '등록\\s*(요청|절차|신청|승인)', '가입\\s*(승인|완료|신청)', '멤버십', '승인\\s*(요청|되었|완료)',
  '(계속|이어서)\\s*진행', '완료하려면', '조치가?\\s*필요', '확인이\\s*필요',
  '\\benrollment\\b', '\\bmembership\\b', '\\bcomplete your\\b', '\\baction (required|needed)\\b',
  '\\bcontinue your\\b', '\\bpending (approval|review|action)\\b',
  // 2026-10-11 (Fable A') — 가입·등록을 **끝내라는** 안내. GFM B2B 파트너 가입(«To complete the Sign Up process,
  //   please fill up online form»)이 어느 범주에도 안 걸려 자동함에 묻혔다.
  '\\bcomplete (the|your) [\\w -]{0,30}(process|registration|sign[- ]?up|application|onboarding|verification)\\b',
  '\\b(online|registration|application) form\\b',
  // 2026-10-11 (Fable C-4) — 돈·권한이 움직인 자동 알림. automated 경로에서만 돈다.
  '\\bpayout\\b', '\\bpayment (reminder|notification)\\b', '\\b(credit|debit) note\\b', '갱신되지\\s*않',
  '(관리|소유권|액세스)\\s*요청', '\\b(request|access) (has been )?(approved|rejected)\\b',
  ],
  security_code: [
  '인증\\s*(코드|번호)',
  '확인\\s*코드',
  '로그인\\s*(코드|번호|링크|알림|시도)',
  '일회용\\s*(비밀번호|번호)',
  '\\botp\\b',
  '2단계\\s*인증',
  '이중\\s*인증',
  '새(로운)?\\s*(기기|디바이스)(에서)?\\s*(로그인|접속)',
  '\\bverification code\\b',
  '\\bverify your (email|account|identity)\\b',
  '\\blogin code\\b',
  '\\bsign[- ]?in code\\b',
  '\\bsecurity code\\b',
  '\\bone[- ]?time (code|password|passcode|pin)\\b',
  '\\btwo[- ]?factor\\b',
  '\\bnew (device|sign[- ]?in)\\b',
  '\\baccess code\\b',
  '로그인[\\s\\S]{0,30}코드',
  '코드[\\s\\S]{0,30}로그인',
  '인증[\\s\\S]{0,20}코드',
  '코드[\\s\\S]{0,20}인증',
  // ★ 2026-09-22 (Irene: "이런 거 인증문자나 리셋 등 이런 건 확인권장으로 가야 하는데 안들어와") —
  //   비밀번호 재설정·변경 통지, 의심 로그인, 계정 복구, 이메일 확인이 빠져 있었다. Threads(Meta)의
  //   «Reset your password» 가 수신거부 헤더 때문에 marketing 으로 묻혔다(운영 스레드 3442·3443·2663).
  //   «password» 단독은 쓰지 않는다 — «비밀번호 관리자 할인» 같은 광고가 걸린다. 행위와 짝으로만.
  '비밀번호\\s*(재설정|초기화|변경|찾기)',
  '비밀번호가\\s*(변경|재설정|초기화)',
  '\\breset (your )?([\\w-]+ )?password\\b',
  '\\bpassword (reset|change|recovery)\\b',
  '\\bpassword (has been|was) (changed|reset|updated)\\b',
  '\\bchanged your password\\b',
  '\\b(suspicious|unusual) (sign[- ]?in|login|activity)\\b',
  '\\bsecurity alert\\b',
  '보안\\s*(알림|경고)',
  '\\baccount recovery\\b',
  '계정\\s*(복구|보안)',
  '\\bconfirm your (email|e-mail|email address|account)\\b',
  '이메일\\s*(주소\\s*)?(인증|확인)',
  // 2026-10-11 (Fable C-3) — «새 기기» 말고도 «새 로그인»·«새 환경» 으로 쓴다(AirAsia·네이버·Dropbox 를 놓쳤다).
  '\\bnew login( alert)?\\b', '새(로운)?\\s*(환경|위치)에서\\s*로그인', '로그인이\\s*감지',
  ],
  critical_notice: [
  '\\bpayment (has )?(failed|declined|unsuccessful|overdue|past due)', '\\b(failed|declined) payment',
  '결제(가|에)?\\s*(실패|거절)', '연체|미납|체납', '\\boverdue\\b', '\\bpast due\\b', '\\b(blocked|fraudulent) .{0,20}payment',
  '\\baction (required|needed)\\b', '조치\\s*(필요|요청)',
  '\\baccount (is |has been )?(on hold|suspended|disabled|locked|restricted|deactivated)',
  '계정이?\\s*(보류|정지|잠금|제한|비활성)', '보류\\s*상태',
  '\\bdata breach\\b', '(개인정보|정보)\\s*유출', '\\bunrecognized (device|sign[- ]?in|login)', '\\bsecurity (incident|risk)',
  '\\b(booking|reservation) (inquiry|request)\\b', '\\binquiry for\\b',
  '\\bbuild\\b.{0,40}\\b(failed|has (one or more )?issues)\\b',
  '\\b(listing|home|account)s? (has been|have been|will be|are) (hidden|unlisted|removed|deactivated)\\b', '\\bviolation of\\b',
  '\\bnew ticket\\b', '\\bhelp request\\b',
  ],
  transactional_notice: [
  'your (order|payment|parcel|shipment|delivery|refund|booking)',
  'order #?[\\w-]+ (has been|is now)', 'have you received (your |the )?order',
  '(has been|was) (delivered|shipped|dispatched|confirmed|cancell?ed)',
  'out for delivery', 'on the way', 'tracking (number|code)',
  'payment (has been )?(confirmed|received|successful)',
  // 2026-10-15 — «주문이 접수» 는 셀러 입장 알림(우리에게 들어온 주문)과 겹친다 → inbound_action 쪽으로. 여기는 완료·확인만.
  '주문(이|을)?\\s*(완료|확인)', '배송(이)? (완료|시작|출발)', '결제(가)? (완료|확인)', '발송(이)? (완료|시작)',
  // #221 — 규칙 ④(우리 주소로 직접 + 물음표)가 살아나면서 새로 노출된 오탐 계열.
  //   "안내드립니다…변경하시겠습니까?" 처럼 상투적 물음표를 단 통지가 답변 필요로 올라왔다.
  //   답장할 상대가 없는 통지이므로 여기서 막고 확인 권장으로 보낸다 (내용은 여전히 볼 가치가 있다).
  '주문\\s*승인', '\\border acknowledgment\\b',
  '운항\\s*(변경|취소|지연)', '\\bflight status change\\b', '\\bschedule change\\b',
  // PG 영수증 계열 — "결제하신 내역"·"이용내역 안내". 답장 상대가 없다.
  //   ('안내'·'확인' 전체를 잡으면 진짜 문의까지 강등되므로 '내역' 에만 건다.)
  '(결제|이용|거래)하?신?\\s*내역',
  ],
  // 2026-10-15 (Fable 설계 §4.1) — 상대의 행동이 도착했다는 알림. **제목만** 본다.
  //   «New order #» 는 우리에게 들어온 주문, «Your order …» 는 내가 산 주문(transactional_notice 가 먼저 집는다).
  inbound_action: [
    '\\bnew (orders?|messages?|inquiry|inquiries|enquiry|enquiries|leads?|bookings?|reservations?|request|reviews?|comments?|submissions?|form (entry|submission)|contact|applications?|appointments?|quote requests?|questions?|chats?|tickets?|reply|replies|response)\\b',
    '\\byou have (a |an |\\d+ )?new (orders?|messages?|inquiry|inquiries|enquiry|enquiries|bookings?|reservations?|requests?|tickets?|leads?|reviews?|comments?|repl(y|ies)|responses?|applications?|submissions?)\\b',
    '\\b(has|have) (replied|responded) to (you|your)\\b', '\\breplied to your\\b',
    '\\bsent you a (message|request|quote|inquiry|enquiry)\\b',
    '\\bcontact form\\b', '\\bform submission\\b',
    '\\byou (have )?received (a |an )?(new )?(order|inquiry|enquiry|message|booking)\\b',
    '\\border (received|placed) by\\b',
    '새(로운)?\\s*(주문|문의|예약|메시지|메세지|신청|리뷰|후기|댓글|상담|견적\\s*요청)',
    '(문의|예약|신청|주문|상담|견적|리뷰|후기)(이|가)?\\s*(접수|등록|도착|들어왔)',
    '답변이\\s*(등록|도착|달렸)', '문의하신 내용에 답변', '회신이?\\s*도착',
    '님이\\s*(답변|회신|메시지|댓글|문의)',
  ],
  // 2026-10-15 (Fable 설계 §2①) — 자동응답·접수 확인. 제목은 늘 보고, 본문(앞 600자)은 사람 메일이 아닐 때만.
  auto_ack_subject: [
    '\\bautomatic reply\\b', '\\bauto-?reply\\b', '\\bout of (the )?office\\b', '\\bautoreply\\b',
    '자동\\s*(응답|회신)', '부재\\s*중',
  ],
  auto_ack_body: [
    '\\bwe have received your (e-?mail|message|enquiry|inquiry|request)\\b',
    '\\bthank you for (reaching out|contacting|your (e-?mail|message|enquiry|inquiry|request))\\b',
    '문의(가|를)?\\s*(접수|잘 받았)', '메일(을|이)\\s*잘 받았', '접수되었습니다', '제출해 주셔서 감사',
  ],
};

/** 카탈로그 — 화면 순서 = 엔진 순서. id 는 email_threads.triage_criterion 에 그대로 남는다. */
const CATALOG = [
  // ── 사칭 의심 격리 (모든 기준보다 먼저 — In-Reply-To 를 꾸며 우리 대화에 끼는 것도 막는다). 끄면 격리만 꺼지고 경고 배지는 남는다.
  //   판정은 services/mailImpersonation.assess 한 함수(docs/MAIL_IMPERSONATION_DESIGN.md).
  { id: 'impersonation', folder: 'spam', lockable: false, order: 5,
    examples: ['보낸 사람 «Ama[숨은 글자]zon.co.jp» · 한 글자 다른 «gitconsu1ting.group» · 키릴 «аррӏе.com»'] },
  // ── 답변 필요
  { id: 'thread_reply', folder: 'reply', lockable: true, order: 10 },
  { id: 'known_contact', folder: 'reply', lockable: true, order: 20 },
  { id: 'inbound_action', folder: 'reply', lockable: false, order: 30, terms: ['inbound_action'],
    examples: ['[With Min]: New order #3171', '[와디즈] 문의하신 내용에 답변이 도착했어요.', 'You have a new ticket 10050'] },
  { id: 'direct_request', folder: 'reply', lockable: false, order: 40, terms: ['direct_request'] },
  // ── 확인 권장
  { id: 'spam_rescue', folder: 'review', lockable: false, order: 50 },
  { id: 'security_code', folder: 'review', lockable: false, order: 60, terms: ['security_code'] },
  { id: 'critical_notice', folder: 'review', lockable: false, order: 70, terms: ['critical_notice'] },
  { id: 'auto_ack', folder: 'review', lockable: false, order: 80, terms: ['auto_ack_subject', 'auto_ack_body'],
    examples: ['Thank you for reaching out to Aspiration. We have received your email in good order.', 'Automatic reply: …'] },
  { id: 'automated_relevant', folder: 'review', lockable: false, order: 90, terms: ['automated_relevant'] },
  { id: 'platform_notice', folder: 'review', lockable: false, order: 100 },
  { id: 'unclear_intent', folder: 'review', lockable: true, order: 110 },
  // ── 답변 필요에서 뺌 (자동·마케팅 쪽)
  { id: 'ad_prefix', folder: 'demote', lockable: true, order: 120, examples: ['(광고) …'] },
  { id: 'bulk_headers', folder: 'demote', lockable: true, order: 130 },
  { id: 'bulk_body', folder: 'demote', lockable: false, order: 140 },
  { id: 'automated_sender', folder: 'demote', lockable: true, order: 150 },
  { id: 'transactional_notice', folder: 'demote', lockable: false, order: 160, terms: ['transactional_notice'] },
  { id: 'self_sender', folder: 'demote', lockable: true, order: 170 },
  { id: 'bounce', folder: 'demote', lockable: true, order: 180 },
  // ── 스팸
  { id: 'spam_filter', folder: 'spam', lockable: true, order: 190 },
];

const BY_ID = new Map(CATALOG.map((c) => [c.id, c]));
const TOGGLEABLE = new Set(CATALOG.filter((c) => !c.lockable).map((c) => c.id));

const _re = new Map();
/** 낱말 묶음 → 정규식 (대소문자 무시). 한 번 만들어 둔다. */
function regexOf(termKey) {
  if (!_re.has(termKey)) {
    const list = TERMS[termKey];
    if (!list) throw new Error('mailCriteriaCatalog: unknown terms ' + termKey);
    _re.set(termKey, new RegExp(list.join('|'), 'i'));
  }
  return _re.get(termKey);
}

/** 화면에 보일 낱말 — 정규식 기호를 걷어 사람이 읽을 수 있게(뜻은 그대로). */
function readableTerm(src) {
  return String(src)
    .replace(/\\b/g, '')
    .replace(/\\s\*/g, ' ').replace(/\\s\+/g, ' ').replace(/\\s/g, ' ')
    .replace(/\\d\+/g, 'N').replace(/\\w/g, '…').replace(/\[\\s\\S\]\{\d+,\d+\}/g, ' … ')
    .replace(/\.\{\d+,\d+\}/g, ' … ').replace(/\\-/g, '-')
    .replace(/\s{2,}/g, ' ').trim();
}

/** 설정 화면용 — 메타 + 사람이 읽는 낱말. */
function listCatalog() {
  return CATALOG.map((c) => ({
    id: c.id, folder: c.folder, lockable: !!c.lockable, order: c.order,
    examples: c.examples || [],
    terms: (c.terms || []).flatMap((k) => TERMS[k].map(readableTerm)),
  }));
}

/** 이 기준이 켜져 있는가 — off 는 Set(꺼진 id). 잠긴 기준은 늘 켜짐. */
function isOn(id, off) {
  if (!off || !TOGGLEABLE.has(id)) return true;
  return !(off instanceof Set ? off.has(id) : (Array.isArray(off) && off.includes(id)));
}

module.exports = { CATALOG, BY_ID, TOGGLEABLE, TERMS, regexOf, readableTerm, listCatalog, isOn };
