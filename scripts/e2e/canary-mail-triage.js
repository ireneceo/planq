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

  return out;
}

module.exports = { name: 'canary-mail-triage', run };
