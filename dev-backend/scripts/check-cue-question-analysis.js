// Cue 질문 분석 — 순수 함수 단위 검사(DB 없음). 가명처리·태그 해석·스위치 기본값.
//   node scripts/check-cue-question-analysis.js   → 실패가 하나라도 있으면 exit 1
const {
  pseudonymize, parseClassification, analysisPrefs, workspaceDayHash,
} = require('../services/cueQuestionAnalysis');

let pass = 0; let fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass += 1; } else { fail += 1; console.log('FAIL', name, detail === undefined ? '' : JSON.stringify(detail)); }
}

// ── 가명처리 ──
const names = ['김민수', '에이컴퍼니', 'Kate Kim', '김'];
const t1 = pseudonymize('김민수님이 에이컴퍼니 견적서를 kate@acme.com 으로 보냈는데 010-1234-5678 로 전화가 와요', { names });
ok('이름 치환', !t1.includes('김민수') && !t1.includes('에이컴퍼니'), t1);
ok('이메일 치환', t1.includes('[EMAIL]') && !t1.includes('acme.com'), t1);
ok('전화 치환', t1.includes('[PHONE]') && !t1.includes('5678'), t1);
ok('한 글자 이름은 사전에서 뺀다(오탐 방지)', t1.includes('전화가'), t1);
const t2 = pseudonymize('Kate Kim asked about https://planq.kr/x?id=3 and invoice ₩1,500,000 or 300만원 or 2,000 USD', { names });
ok('영문 이름(대소문자 무시)', !/kate kim/i.test(t2), t2);
ok('URL 치환', t2.includes('[URL]') && !t2.includes('planq.kr'), t2);
ok('금액 ₩', !t2.includes('1,500,000'), t2);
ok('금액 만원', !t2.includes('300만원'), t2);
ok('금액 USD', !t2.includes('2,000'), t2);
const t3 = pseudonymize('업무 3개를 2단계로 나누려면 어떻게 하나요?', { names: [] });
ok('일반 문장은 그대로', t3 === '업무 3개를 2단계로 나누려면 어떻게 하나요?', t3);
const t4 = pseudonymize('+82 10-9876-5432 / 02-345-6789 / 01098765432', {});
ok('국제·지역·붙여쓴 전화', !/\d{4}/.test(t4), t4);
const t5 = pseudonymize('메일 a.b+c@sub.example.co.kr 의 주소 www.foo.com/bar', {});
ok('복합 이메일·www URL', t5 === '메일 [EMAIL] 의 주소 [URL]', t5);
const t6 = pseudonymize('정규식 특수문자 이름 (주)에이+', { names: ['(주)에이+'] });
ok('이름 안의 정규식 특수문자', t6.includes('[NAME]'), t6);

// ── 태그 해석 ──
const c1 = parseClassification('업무는 Q task 에서 추가합니다.\n[[cue:topic=qtask;intent=howto;ok=1]]');
ok('태그 해석 topic', c1.topic === 'qtask' && c1.intent === 'howto' && c1.ok === true && c1.classified, c1);
ok('태그는 답변에서 사라진다', c1.answer === '업무는 Q task 에서 추가합니다.', c1.answer);
const c2 = parseClassification('답변만 있음');
ok('태그 없음 = 분류 실패', c2.classified === false && c2.topic === 'unclassified' && c2.answer === '답변만 있음', c2);
const c3 = parseClassification('답\n[[cue:topic=other;intent=feature_gap;ok=0]]');
ok('other = 분류 실패(원문 보강 대상)', c3.classified === false && c3.topic === 'other' && c3.ok === false, c3);
const c4 = parseClassification('답\n[[cue:topic=hacker;intent=drop;ok=1]]');
ok('목록 밖 값은 버린다', c4.classified === false && c4.topic === 'unclassified' && c4.intent === null, c4);
const c5 = parseClassification('긴 답이 잘림 [[cue:topic=qta');
ok('잘린 꼬리 태그도 지운다', c5.answer === '긴 답이 잘림' && !c5.classified, c5);
const c6 = parseClassification('[[cue:topic=qbill;intent=howto;ok=1]]\n본문\n[[ CUE : topic=qmail ; intent=bug ; ok=1 ]]');
ok('여럿이면 마지막 태그 · 대소문자/공백 관용', c6.topic === 'qmail' && c6.intent === 'bug' && c6.answer === '본문', c6);

const c7 = parseClassification('답\n[[cue:topic=plan_billing;intent=pricing;ok=1]]');
ok('주제만 맞으면 분류(의도는 보조)', c7.classified === true && c7.intent === null, c7);

// ── 스위치 기본값 ──
ok('기본 = 주제 켬 · 원문 끔', JSON.stringify(analysisPrefs(null)) === '{"topics":true,"raw":false}');
ok('끄기', analysisPrefs({ cue_analysis: { topics: false } }).topics === false);
ok('원문은 true 일 때만', analysisPrefs({ cue_analysis: { raw: 'yes' } }).raw === false && analysisPrefs({ cue_analysis: { raw: true } }).raw === true);

// ── 해시 ──
ok('해시는 날짜마다 다르다', workspaceDayHash(5, '2026-10-07') !== workspaceDayHash(5, '2026-10-08'));
ok('해시는 워크스페이스마다 다르다', workspaceDayHash(5, '2026-10-07') !== workspaceDayHash(6, '2026-10-07'));
ok('해시에 id 가 그대로 없다', workspaceDayHash(5, '2026-10-07').length === 32);
ok('워크스페이스 없으면 null', workspaceDayHash(null, '2026-10-07') === null);

console.log(`[check-cue-question-analysis] PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);
