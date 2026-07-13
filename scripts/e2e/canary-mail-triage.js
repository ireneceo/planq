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

  return out;
}

module.exports = { name: 'canary-mail-triage', run };
