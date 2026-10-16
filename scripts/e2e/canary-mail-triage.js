// scripts/e2e/canary-mail-triage.js — 메일 판정 카나리 (조용히 죽는 계열 차단).
//
//   이 판정은 "통과했는데 실제로는 눈을 감고 있는" 사고가 반복된 곳이다:
//     ① mailparser 는 List-* 헤더를 'list' 키 하나로 접는다 → headers.get('list-unsubscribe') 는
//        **항상 undefined**. 광고 판정의 1순위 신호가 릴리즈 이후 한 번도 발동한 적이 없었다.
//        손으로 만든 Map 으로 테스트하면 절대 안 잡힌다 → **실 mailparser 출력**으로 검증한다.
//     ② 재판정 경로는 헤더가 없으면 눈을 감는다 → 저장된 분류를 신뢰해야 한다 (다시 계산하면
//        광고가 사람 메일로 뒤집힌다. 실제로 109건이 뒤집혀 백업에서 복원했다).
//
//   시드 불필요 (순수 판정 함수만) — 데이터 원복 이슈 없음.
require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env' });
const { simpleParser } = require('/opt/planq/dev-backend/node_modules/mailparser');
const t = require('/opt/planq/dev-backend/services/emailTriage');
const { classify } = require('/opt/planq/dev-backend/services/emailSpamFilter');

const OWN = ['help@irenewp.com'];

function mail(lines, body = '본문입니다.') {
  return [...lines, 'Message-ID: <canary-1@qa.local>', '', body].join('\r\n');
}

async function run() {
  const out = [];
  // 러너 계약: fail>0 이면 게이트 실패. route 를 채워야 detail 이 출력된다 (printSuite).
  const ok = (name, cond, detail = '') => out.push({
    name, route: name, fail: cond ? 0 : 1,
    detail: cond ? `— ${detail || 'OK'}` : `— 실패 ${detail}`,
  });

  // ① 실 mailparser — List-Unsubscribe 만 있는 뉴스레터 (Precedence 없음: 가장 흔한 형태)
  const news = await simpleParser(mail([
    'From: News <news@shop.example.org>', 'To: help@irenewp.com', 'Subject: Weekly deals',
    'List-Unsubscribe: <https://shop.example.org/unsub?u=abc>',
  ]));
  ok('실 mailparser — List-Unsubscribe 만으로 광고 판정', t.isMarketing(news.headers) === true,
    `isMarketing=${t.isMarketing(news.headers)}`);
  const picked = t.pickTriageHeaders(news.headers);
  ok('판정용 헤더가 저장 대상에 담긴다', !!picked['list-unsubscribe'], JSON.stringify(picked));

  // ② 자동 발송 헤더 (RFC 3834)
  const auto = await simpleParser(mail([
    'From: System <system@vendor.example.org>', 'To: help@irenewp.com', 'Subject: 처리 완료',
    'Auto-Submitted: auto-generated',
  ]));
  ok('Auto-Submitted → 자동 발송 판정', t.isAutomated(auto.headers, 'system@vendor.example.org', new Set(OWN)) === true);

  // ③ 사람이 보낸 문의는 살아 있어야 한다 (과잉 차단 카나리 — 판정이 다 막아버리면 이 기능은 죽는다)
  const human = await simpleParser(mail([
    'From: 김대표 <ceo@client.example.org>', 'To: help@irenewp.com', 'Subject: 견적 문의드립니다',
  ], '안녕하세요. 견적서 보내주실 수 있을까요? 회신 부탁드립니다.'));
  ok('사람 문의 → 답변 필요 (과잉 차단 아님)', t.needsReply({
    subject: human.subject, bodyText: human.text, fromEmail: 'ceo@client.example.org',
    headers: human.headers, ownEmails: new Set(OWN), isKnownContact: true,
  }) === true);

  // ④ 반송은 In-Reply-To 를 달고 온다 — "우리 대화 회신" 으로 통과하면 안 된다
  ok('반송 → 답변 필요 아님', t.isBounce('mailer-daemon@googlemail.com', 'Delivery Status Notification (Failure)') === true);

  // ⑤ 재판정 — 헤더 없는 옛 메일은 저장된 분류를 신뢰한다 (광고가 사람 메일로 뒤집히던 사고)
  const legacy = t.retriageStored({
    triage: 'marketing', subject: '뉴스레터', bodyText: '문의드립니다. 회신 부탁드립니다.',
    fromEmail: 'news@shop.example.org', headers: { to: OWN[0] }, headersComplete: false,
    ownEmails: OWN, isKnownContact: true,
  });
  ok('헤더 없는 옛 메일 — 저장된 분류 유지', legacy.triage === 'marketing' && legacy.reply_needed === false,
    `triage=${legacy.triage}`);

  // ⑥ 재판정 — 헤더가 있으면 처음부터 다시 판정한다 (제목 패턴 우회 없이 광고로 정정)
  const fresh = t.retriageStored({
    triage: 'human', subject: 'Weekly deals', bodyText: '지금 구독 중이십니다.',
    fromEmail: 'news@shop.example.org',
    headers: { ...picked, to: OWN[0] }, headersComplete: true,
    ownEmails: OWN, isKnownContact: true,
  });
  ok('헤더 있는 메일 — 광고로 정정', fresh.triage === 'marketing' && fresh.reply_needed === false,
    `triage=${fresh.triage}`);

  // ═══ #221 — 인입 경로(mailparser Map) vs 재판정 경로(평문 객체) 입력 일치 ═══
  //   이 결함이 릴리즈까지 간 이유가 바로 여기 가드가 없어서였다. `isAddressedToUs`·`isThreadReply`
  //   두 술어만 직접 프로퍼티 접근이라 **Map 에서 항상 false** 였고, 수집 시점에 규칙 ①·④가
  //   영구 미발동했다(실측 22 스레드, 11건이 사용자에게 안 보임 — 세무사 납부서·청구서 전달 포함).
  //   손으로 만든 객체로 테스트하면 절대 안 잡힌다 → **실 mailparser 출력**으로 검증한다.
  const direct = await simpleParser(mail([
    'From: 세무사 <tax@acct.example.org>', 'To: help@irenewp.com', 'Subject: 원천세 신고 완료 안내 및 납부서',
    'X-Spam-Score: 0.1',
  ], '납부기한까지 납부해주세요. 확인 부탁드립니다. 문의 있으신가요?'));

  ok('인입 Map 을 그대로 넘기면 "직접 수신" 판정이 죽는다 (회귀 재현)',
    t.isAddressedToUs(direct.headers, new Set(OWN)) === false,
    '이 줄이 실패하면 술어가 Map 을 읽게 된 것 — 아래 정규화 계약을 다시 볼 것');

  const norm = t.normalizeHeaders({
    headers: direct.headers, toEmails: direct.to, inReplyTo: direct.inReplyTo, references: direct.references,
  });
  ok('정규화 후에는 "우리 주소로 직접 수신" 이 잡힌다',
    t.isAddressedToUs(norm, new Set(OWN)) === true, JSON.stringify(norm.to));
  ok('정규화 객체에 x-spam-* 가 보존된다 (외부 스팸 점수 실명 차단)',
    norm['x-spam-score'] === '0.1', JSON.stringify(norm['x-spam-score']));

  // 스팸 점수는 Map·객체 양쪽에서 같은 값이어야 한다 — 한쪽만 읽으면 인입/재판정이 갈라진다
  const spam = await simpleParser(mail([
    'From: bad <x@spam.example.org>', 'To: help@irenewp.com', 'Subject: 당첨',
    'X-Spam-Score: 9.4',
  ]));
  const viaMap = classify({ subject: spam.subject, bodyText: spam.text, fromEmail: 'x@spam.example.org', headers: spam.headers });
  const viaObj = classify({ subject: spam.subject, bodyText: spam.text, fromEmail: 'x@spam.example.org',
    headers: t.normalizeHeaders({ headers: spam.headers, toEmails: spam.to }) });
  ok('스팸 점수 — Map/객체 동일 판정', viaMap.spam_score === viaObj.spam_score && viaMap.status === viaObj.status,
    `map=${JSON.stringify(viaMap)} obj=${JSON.stringify(viaObj)}`);

  // ═══ #221 — 콜드메일의 가짜 회신 헤더 ═══
  //   발송기가 자기 도메인 Message-ID 를 In-Reply-To 에 지어 넣어 "우리 대화 회신" 으로 위장한다.
  //   ★ 판별자는 "우리 DB 에 그 ID 가 있는가" 가 아니다 — 플랫폼이 SMTP 로 보낸 메일은 DB 에 없어서
  //     정당한 고객 회신이 강등된다(실측 2건). 지문은 **자기 도메인 자작 참조**다.
  const forged = await simpleParser(mail([
    'From: Sales <rep@coldmail.example.org>', 'To: help@irenewp.com', 'Subject: RE: partnership',
    'In-Reply-To: <fake-1@coldmail.example.org>',
  ], '혹시 관심 있으신가요?'));
  const fHeaders = t.normalizeHeaders({ headers: forged.headers, toEmails: forged.to, inReplyTo: forged.inReplyTo });
  ok('자기 도메인 자작 참조 → 회신으로 인정하지 않음',
    t.isForgedReplyRef(fHeaders, 'rep@coldmail.example.org') === true);

  const genuine = await simpleParser(mail([
    'From: 고객 <ceo@client.example.org>', 'To: help@irenewp.com', 'Subject: Re: 청구서 안내',
    'In-Reply-To: <inv-2026-0003@irenewp.com>',
  ], '입금했습니다.'));
  const gHeaders = t.normalizeHeaders({ headers: genuine.headers, toEmails: genuine.to, inReplyTo: genuine.inReplyTo });
  ok('우리가 보낸 메일에 대한 회신은 살아 있다 (과잉 차단 아님)',
    t.isForgedReplyRef(gHeaders, 'ceo@client.example.org') === false);
  ok('그 회신은 답변 필요로 올라온다', t.needsReply({
    subject: genuine.subject, bodyText: genuine.text, fromEmail: 'ceo@client.example.org',
    headers: gHeaders, ownEmails: new Set(OWN), isKnownContact: false,
  }) === true);

  // ═══ #221 — 자동 발송이어도 "내 조치가 남은" 것은 확인 권장으로 올린다 ═══
  ok('등록·승인 진행 안내 → 업무 관련 판정',
    t.hasBusinessRelevance('Apple Developer Program 등록을 계속 진행하세요.',
      '등록 절차를 완료하려면 개발자 계정에 로그인하세요.') === true);
  ok('평범한 알림은 여전히 아님 (과잉 승격 아님)',
    t.hasBusinessRelevance('새 기능이 추가되었습니다', '이번 업데이트에서는 화면이 개선되었습니다.') === false);

  // ═══ 2026-10-11 메일 분류 대점검 (docs/MAIL_TRIAGE_AUDIT_2026-10-11.md · Fable 설계) ═══
  const tri = async (lines, html, extra = {}) => {
    const raw = [...lines, 'Message-ID: <canary-x@qa.local>', 'MIME-Version: 1.0',
      'Content-Type: text/html; charset=utf-8', '', html].join('\r\n');
    const p = await simpleParser(raw);
    const hdr = t.normalizeHeaders({ headers: p.headers, toEmails: p.to });
    // extra.htmlOnly — 저장본처럼 text 가 없는 HTML 전용 메일(dev 실측 28%)의 경로를 잰다.
    return t.triageInbound({ subject: p.subject, bodyText: t.triageBodyOf(extra.htmlOnly ? null : p.text, p.html), fromEmail: extra.from,
      headers: hdr, ownEmails: new Set(OWN), ownMatcher: { emails: OWN, domains: [] }, isKnownContact: !!extra.known, off: extra.off || null });
  };
  // ① 이번 신고 — SendGrid 헤더만 · HTML 전용 · 가입 완료 요청 → 확인 권장
  const gfm = await tri(['From: GFM B2B Support <gfmsupport@rgtech.example.my>', 'To: help@irenewp.com',
    'Subject: GFM B2B PORTAL - Online Sign Up', 'X-SG-EID: abc'],
    '<p>Partner Code : G4049</p><p>To complete the Sign Up process, please fill up online form.</p><p>Please do not reply.</p>',
    { from: 'gfmsupport@rgtech.example.my', htmlOnly: true });
  ok('ESP 헤더 + 가입 완료 안내(HTML 전용) → 확인 권장', gfm.status === 'uncertain' && gfm.triage === 'automated' && !gfm.reply_needed,
    JSON.stringify(gfm));
  // ② 수신거부 헤더가 붙은 결제 실패 → 꼭 확인(critical_notice)
  const fail = await tri(['From: Netflix <info@account.netflix.example>', 'To: help@irenewp.com',
    'Subject: Your payment failed', 'List-Unsubscribe: <https://x.example/u>'], '<p>Update your card.</p>',
    { from: 'info@account.netflix.example' });
  ok('List-Unsubscribe + 결제 실패 제목 → 확인 권장(critical_notice)', fail.status === 'uncertain' && fail.uncertain_reason === 'critical_notice',
    JSON.stringify(fail));
  // ③ 음성 — (광고) 표기 + action required → 광고 그대로
  const ad = await tri(['From: Promo <promo@shop.example.org>', 'To: help@irenewp.com',
    'Subject: (광고) Action required: 30% 할인 마감', 'List-Unsubscribe: <https://x.example/u>'], '<p>sale</p>',
    { from: 'promo@shop.example.org' });
  ok('(광고) + action required → 자동·마케팅 그대로', ad.triage === 'marketing' && ad.status === 'open', JSON.stringify(ad));
  // ④ 음성 — 순수 뉴스레터
  const nl = await tri(['From: Weekly <hello@brand.example.org>', 'To: help@irenewp.com',
    'Subject: This week in design', 'List-Unsubscribe: <https://x.example/u>'], '<p>Top stories</p><a href="https://x">unsubscribe</a>',
    { from: 'hello@brand.example.org' });
  ok('순수 뉴스레터 → 자동·마케팅 그대로', nl.triage === 'marketing' && nl.status === 'open', JSON.stringify(nl));
  // ⑤ 아는 상대의 HTML 답장(본문에 unsubscribe 문구) → 답변 필요 유지 (과잉 차단 아님)
  const known = await tri(['From: 고객 <ceo@client.example.org>', 'To: help@irenewp.com', 'Subject: Re: 견적',
    'In-Reply-To: <q-1@irenewp.com>'],
    '<p>견적서 확인했습니다. 다음 주 미팅 가능할까요?</p><blockquote>... unsubscribe https://x.example/u</blockquote>',
    { from: 'ceo@client.example.org', known: true, htmlOnly: true });
  ok('아는 상대 HTML 전용 답장(인용에 수신거부) → 답변 필요 유지', known.reply_needed === true, JSON.stringify(known));
  // ⑥ 헤더 없는 재판정 경로에서도 같은 규칙
  const legacyC = t.retriageStored({ triage: 'marketing', subject: 'Payment Overdue', bodyText: '', fromEmail: 'noreply@isp.example',
    headers: {}, headersComplete: false, ownEmails: OWN });
  ok('헤더 없는 재판정 — 연체 제목 → 확인 권장(critical_notice)', legacyC.status === 'uncertain' && legacyC.uncertain_reason === 'critical_notice',
    JSON.stringify(legacyC));
  const legacyS = t.retriageStored({ triage: 'marketing', subject: 'New login alert', bodyText: '', fromEmail: 'noreply@air.example',
    headers: {}, headersComplete: false, ownEmails: OWN });
  ok('헤더 없는 재판정 — 새 로그인 → 확인 권장(security_code)', legacyS.uncertain_reason === 'security_code', JSON.stringify(legacyS));

  // ═══ 2026-10-15 분류 기준 공개·새 기준 (docs/MAIL_CRITERIA_DESIGN.md §10.2) ═══
  //   양성(올라와야 한다)
  const ack = await tri(['From: Help Desk <studenthelpdesk+canned.response@school.example.my>', 'To: help@irenewp.com',
    'Subject: Re: Request for Confirmation of Student Enrollment', 'Auto-Submitted: auto-replied', 'Precedence: bulk'],
    '<p>Thank you for reaching out to Aspiration. We have received your email in good order.</p>',
    { from: 'studenthelpdesk+canned.response@school.example.my', htmlOnly: true });
  ok('자동응답(auto-replied + Precedence bulk) → 확인 권장 auto_ack (광고 아님)',
    ack.status === 'uncertain' && ack.criterion === 'auto_ack' && ack.triage !== 'marketing', JSON.stringify(ack));
  const ooo = await tri(['From: Kim <noreply@corp.example.org>', 'To: help@irenewp.com', 'Subject: Automatic reply: 견적 건'],
    '<p>I am out of office.</p>', { from: 'noreply@corp.example.org' });
  ok('«Automatic reply:» 제목(헤더 없음) → 확인 권장 auto_ack', ooo.criterion === 'auto_ack' && ooo.status === 'uncertain', JSON.stringify(ooo));
  const order = await tri(['From: With Min <help@withmin.example>', 'To: help@irenewp.com', 'Subject: [With Min]: New order #3171'],
    '<p>You have received an order.</p>', { from: 'help@withmin.example' });
  ok('셀러 «New order #» (역할 주소) → 답변 필요 inbound_action', order.reply_needed === true && order.criterion === 'inbound_action', JSON.stringify(order));
  const ticket = await tri(['From: Tidio <no-reply@notifications.tidio.example>', 'To: help@irenewp.com',
    'Subject: You have a new ticket 10050', 'List-Unsubscribe: <https://x.example/u>'], '<p>Hey</p>',
    { from: 'no-reply@notifications.tidio.example' });
  ok('수신거부 헤더 + «You have a new ticket» → 답변 필요 (marketing 이어도)', ticket.reply_needed === true && ticket.criterion === 'inbound_action', JSON.stringify(ticket));
  const wadiz = await tri(['From: 와디즈 <info@wadiz.example>', 'To: help@irenewp.com', 'Subject: [와디즈] 문의하신 내용에 답변이 도착했어요.'],
    '<p>답변 확인</p>', { from: 'info@wadiz.example' });
  ok('«문의하신 내용에 답변이 도착» → 답변 필요', wadiz.reply_needed === true, JSON.stringify(wadiz));
  const rescueRaw = { subject: '무료 쿠폰 당첨 카지노 대출', bodyText: '무료 쿠폰 당첨 카지노 대출 비아그라 클릭', fromEmail: 'ceo@client.example.org', headers: { 'x-spam-flag': 'YES', 'x-spam-score': '9' } };
  const spamKnown = t.triageInbound({ ...rescueRaw, ownEmails: new Set(OWN), isKnownContact: true });
  const spamStranger = t.triageInbound({ ...rescueRaw, ownEmails: new Set(OWN), isKnownContact: false });
  ok('스팸 판정 + 아는 상대 → 확인 권장 spam_rescue (triage spam 유지)',
    spamStranger.status === 'spam' ? (spamKnown.status === 'uncertain' && spamKnown.criterion === 'spam_rescue' && spamKnown.triage === 'spam') : false,
    `known=${JSON.stringify(spamKnown)} stranger=${spamStranger.status}`);
  //   음성(올라오면 안 된다)
  ok('스팸 + 모르는 상대 → 스팸 그대로(주소 모양으로 구제 안 함)', spamStranger.status === 'spam', spamStranger.status);
  const platform = process.env.SMTP_FROM || 'help@irenewp.com';
  const pq = await tri([`From: PlanQ <${platform}>`, 'To: owner@client.example.org', 'Subject: [워프로랩] Q Talk · 새 메시지 · 김대표'],
    '<p>새 메시지가 도착했습니다</p>', { from: platform });
  ok('PlanQ 자체 알림 «새 메시지» → 답변 필요 아님', pq.reply_needed !== true && pq.criterion !== 'inbound_action', JSON.stringify(pq));
  const bought = await tri(['From: Shopee <info@mail.shopee.example>', 'To: help@irenewp.com', 'Subject: Your order #2201 has been delivered'],
    '<p>Delivered</p>', { from: 'info@mail.shopee.example' });
  ok('내가 산 주문 «Your order … delivered» → 답변 필요 아님', bought.reply_needed !== true, JSON.stringify(bought));
  const adOrder = await tri(['From: Promo <promo@shop.example.org>', 'To: help@irenewp.com', 'Subject: (광고) 새 주문 이벤트!'],
    '<p>sale</p>', { from: 'promo@shop.example.org' });
  ok('(광고) 새 주문 이벤트 → 답변 필요 아님', adOrder.reply_needed !== true && adOrder.triage === 'marketing', JSON.stringify(adOrder));
  const dsn = await tri(['From: Mail Delivery Subsystem <mailer-daemon@googlemail.example>', 'To: help@irenewp.com',
    'Subject: Delivery Status Notification (Failure)', 'Auto-Submitted: auto-replied'], '<p>Address not found</p>',
    { from: 'mailer-daemon@googlemail.example' });
  ok('반송(auto-replied) → auto_ack 아님', dsn.criterion !== 'auto_ack', JSON.stringify(dsn));
  const humanThanks = await tri(['From: Officer <joanne.low@school.example.my>', 'To: help@irenewp.com', 'Subject: Re: Enrollment letter',
    'In-Reply-To: <q-9@irenewp.com>'], '<p>Thank you for contacting us, here is the enrollment letter you requested.</p>',
    { from: 'joanne.low@school.example.my', htmlOnly: true });
  ok('사람의 회신 «Thank you for contacting us…» → 답변 필요(auto_ack 아님)', humanThanks.reply_needed === true && humanThanks.criterion !== 'auto_ack', JSON.stringify(humanThanks));
  const roleNotice = await tri(['From: 세무사 <mail@jisungtax.example>', 'To: help@irenewp.com', 'Subject: [요청] 부가가치세 자료 요청'],
    '<p>자료를 보내 주세요.</p>', { from: 'mail@jisungtax.example' });
  ok('역할 주소의 요청(관계 없음) → 확인 권장 unclear_intent (결정 ④ 유지)', roleNotice.status === 'uncertain' && roleNotice.reply_needed !== true, JSON.stringify(roleNotice));
  //   끄기 — 꺼진 기준은 없는 것처럼 돈다(양방향)
  const orderOff = await tri(['From: With Min <help@withmin.example>', 'To: help@irenewp.com', 'Subject: [With Min]: New order #3171'],
    '<p>You have received an order.</p>', { from: 'help@withmin.example', off: new Set(['inbound_action']) });
  ok('inbound_action 끄면 → 답변 필요 아님 · 켜면(위) 답변 필요', orderOff.reply_needed !== true && order.reply_needed === true, JSON.stringify(orderOff));
  const ackOff = await tri(['From: Help Desk <studenthelpdesk+canned.response@school.example.my>', 'To: help@irenewp.com',
    'Subject: Re: Request', 'Auto-Submitted: auto-replied', 'Precedence: bulk'],
    '<p>We have received your email in good order.</p>', { from: 'studenthelpdesk+canned.response@school.example.my', htmlOnly: true, off: ['auto_ack'] });
  ok('auto_ack 끄면 → 자동 폴더(확인 권장 아님)', ackOff.status === 'open' && ackOff.criterion !== 'auto_ack', JSON.stringify(ackOff));
  const lockedOff = t.triageInbound({ subject: 'Re: 견적', bodyText: '견적 보내 주실 수 있나요?', fromEmail: 'ceo@client.example.org',
    headers: { 'in-reply-to': '<q-1@irenewp.com>' }, ownEmails: new Set(OWN), isKnownContact: true, off: ['thread_reply', 'known_contact'] });
  ok('잠긴 기준은 off 에 넣어도 꺼지지 않는다', lockedOff.reply_needed === true, JSON.stringify(lockedOff));
  // ═══ 2026-10-16 일정 안내(schedule_notice) — 예약 확정 안내가 자동 폴더에 묻혔다(IKEA appointment) ═══
  const ikea = await tri(['From: IKEA <noreply@booking.email.ikea.example>', 'To: help@irenewp.com',
    'Subject: Thanks for confirming your Kitchen planning appointment with us.'],
    '<p>Appointment number: KP437429</p><p>Appointment date: 17 October 2026</p><p>Kindly prepare your floor plan.</p>',
    { from: 'noreply@booking.email.ikea.example', htmlOnly: true });
  ok('예약 확정 안내(noreply) → 확인 권장 schedule_notice', ikea.status === 'uncertain' && ikea.criterion === 'schedule_notice', JSON.stringify(ikea));
  const bodyOnly = await tri(['From: Clinic <noreply@clinic.example>', 'To: help@irenewp.com', 'Subject: Your visit details'],
    '<p>Booking number: A-1029</p><p>Date: 3 Nov</p>', { from: 'noreply@clinic.example', htmlOnly: true });
  ok('제목은 평범해도 본문 «Booking number:» 칸 → schedule_notice(자동 발송)', bodyOnly.criterion === 'schedule_notice', JSON.stringify(bodyOnly));
  const krResv = await tri(['From: NOL <noreply@nol.example>', 'To: help@irenewp.com', 'Subject: [NOL] 예약확인서 - 호텔 / 체크인 : 2026.07.17'],
    '<p>예약 안내</p>', { from: 'noreply@nol.example' });
  ok('한국어 «예약확인서 … 체크인 :» → schedule_notice', krResv.criterion === 'schedule_notice', JSON.stringify(krResv));
  //   음성 — 광고·바우처는 올라오면 안 된다
  const adVisit = await tri(['From: Guide <news@guide.example>', 'To: help@irenewp.com', 'Subject: 10 restaurants worth a visit right now',
    'List-Unsubscribe: <https://guide.example/u>'], '<p>Book your table today</p>', { from: 'news@guide.example' });
  ok('광고 «worth a visit» → schedule_notice 아님', adVisit.criterion !== 'schedule_notice', JSON.stringify(adVisit));
  const voucher = await tri(['From: Air <noreply@air.example>', 'To: help@irenewp.com', 'Subject: Free Duty-free Voucher from Add-On Bundle Booking No: GH8THN'],
    '<p>Enjoy your voucher</p>', { from: 'noreply@air.example' });
  ok('바우처 «Booking No:»(제목, 확정 낱말 없음) → schedule_notice 아님', voucher.criterion !== 'schedule_notice', JSON.stringify(voucher));
  const mktBody = await tri(['From: Promo <promo@hotel.example>', 'To: help@irenewp.com', 'Subject: Summer deals',
    'List-Unsubscribe: <https://hotel.example/u>'], '<p>Booking number: use code SUMMER</p>', { from: 'promo@hotel.example' });
  ok('대량 발송은 본문 칸 이름으로 안 올린다 → schedule_notice 아님', mktBody.criterion !== 'schedule_notice', JSON.stringify(mktBody));
  const ikeaOff = await tri(['From: IKEA <noreply@booking.email.ikea.example>', 'To: help@irenewp.com',
    'Subject: Thanks for confirming your Kitchen planning appointment with us.'], '<p>Appointment date: 17 October 2026</p>',
    { from: 'noreply@booking.email.ikea.example', htmlOnly: true, off: ['schedule_notice'] });
  ok('schedule_notice 끄면 → 자동 폴더 · 켜면(위) 확인 권장', ikeaOff.status === 'open' && ikeaOff.criterion !== 'schedule_notice' && ikea.criterion === 'schedule_notice', JSON.stringify(ikeaOff));
  const ikeaLegacy = t.retriageStored({ triage: 'automated', subject: 'We\'re pleased to confirm your appointment with us.', bodyText: '',
    fromEmail: 'noreply@booking.email.ikea.example', headers: {}, headersComplete: false, ownEmails: OWN });
  ok('헤더 없는 재판정 — 예약 확정 → 확인 권장(schedule_notice)', ikeaLegacy.criterion === 'schedule_notice' && ikeaLegacy.status === 'uncertain', JSON.stringify(ikeaLegacy));
  //   카탈로그 — 엔진이 쓰는 기준 id 가 전부 목록에 있다(설명과 코드가 갈라지지 않게)
  const CAT = require('/opt/planq/dev-backend/services/mailCriteriaCatalog');
  const seen = [ack, ooo, order, ticket, wadiz, spamKnown, spamStranger, pq, bought, adOrder, dsn, humanThanks, roleNotice, orderOff, ackOff, lockedOff, ikea, bodyOnly, krResv, ikeaOff, ikeaLegacy, gfm, fail, ad, nl, known]
    .map((r) => r.criterion).filter(Boolean);
  const missing = [...new Set(seen)].filter((id) => !CAT.BY_ID.has(id));
  ok('판정이 낸 기준 id 가 전부 카탈로그에 있다', missing.length === 0, missing.join(',') || `${new Set(seen).size}종`);

  return out;
}

module.exports = { name: 'canary-mail-triage', run };
