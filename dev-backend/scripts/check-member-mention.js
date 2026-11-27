#!/usr/bin/env node
// Cue 업무 담당자 정하기 회귀 검사 — LLM 없이 규칙만(services/memberMention · cue_tools.settleTaskAssignee) · dev DB 읽기만(ws 6)
//
// Irene 2026-11-27: «큐에게 업무를 요청하면 기본적으로는 요청한 사람에게 업무가 담당이 돼야 되고 만약에 누구한테 요청 넣어
//   달라고 하면 그 사람이 담당으로 들어가야 되는데 그게 제대로 안 돌아가고 있어 … 여러 가지 경로로 이런 명칭이나 사람을 배당하는 거 고도화»
//
// 고치기 전(dev 실측): «박개발이 보내준 자료 정리» → 박개발 담당 · «이디자»(표시명 «이디자Renamed»)·«디자님»·«박 개발자»·«대표님» → 이름 못 찾음 →
//   조용히 «나» · «루아에게 요청» → 카드 없음. 양성 대조군: 옛 정확 일치(resolveAssigneeName)로 같은 이름을 돌리면 못 찾아야 한다.
// 사용: node scripts/check-member-mention.js
require('dotenv').config({ quiet: true });
const mm = require('../services/memberMention');
const cue = require('../services/cue_tools');
const { sequelize } = require('../config/database');

const WS = 6;
let fail = 0; let pass = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && detail ? ' — ' + detail : ''}`);
  if (ok) pass += 1; else fail += 1;
}

(async () => {
  const [[{ id: owner }]] = await sequelize.query("SELECT id FROM users WHERE email='owner@test.planq.kr'");
  const [[{ id: m1 }]] = await sequelize.query("SELECT id FROM users WHERE email='member1@test.planq.kr'");
  const [[{ id: m2 }]] = await sequelize.query("SELECT id FROM users WHERE email='member2@test.planq.kr'");
  const pool = await mm.memberPool(WS);
  const nameOf = (id) => pool.find((m) => m.user_id === id)?.display_name;
  const m1Name = nameOf(m1); const m2Name = nameOf(m2);
  const m1Head = (m1Name.match(/^[가-힣]+/) || [''])[0];   // «이디자Renamed» → «이디자»
  const m2Head = (m2Name.match(/^[가-힣]+/) || [''])[0];
  check('시험 워크스페이스 멤버 풀에 고객·AI 없음', pool.every((m) => m.role !== 'ai' && m.role !== 'client'));

  // ① 이름 해석 — 한 사람으로 정해져야 하는 것 / 정하지 말아야 하는 것
  const R = (said) => mm.resolveSaid(said, pool, { askerId: owner });
  const want = [
    [`${m2Head}님께`, m2], [`${m1Head}한테`, m1], [`${m1Head.slice(1)}님`, m1], [`${m2Head[0]} 개발자`, null],
    ['나', owner], ['루아', null], ['지원팀', null],
  ];
  for (const [said, id] of want) {
    const r = R(said);
    if (id === null && said.endsWith('개발자')) continue;   // 직함 해석은 job_title/expertise 가 있어야 — 아래 ③ 에서 따로
    check(`이름 «${said}» → ${id ?? '없음'}`, (r.userId ?? null) === id, `${r.status} ${r.userId}`);
  }
  // 한 글자 오차(3자 이상)
  const typo = `${m2Head.slice(0, 2)}${m2Head[2] === '발' ? '빌' : '발'}`;
  check(`한 글자 오차 «${typo}» → ${m2Name}`, R(typo).userId === m2, JSON.stringify(R(typo)));

  // ② 문장에서 지목 찾기 — 언급만 된 것은 지목이 아니다
  const T = (s) => mm.findTargets(s);
  check('«OO님께 … 요청해줘» = 지목', T(`${m2Head}님께 로그인 오류 확인 요청해줘`)[0] === m2Head);
  check('«OO이 보내준 자료 정리» ≠ 지목', T(`${m2Head}이 보내준 자료 정리하는 업무 만들어줘`).length === 0);
  check('«OO한테 받은 파일 정리» ≠ 지목', T(`${m2Head}한테 받은 파일 정리 업무 넣어줘`).length === 0);
  check('«이번 주까지 루아에게 요청» → 루아', T('이번 주까지 루아에게 견적서 검토 요청해줘')[0] === '루아');
  check('«담당자는 OO으로» = 지목', R(T(`담당자는 ${m1Head}으로 해서 세금계산서 발행 업무 추가`)[0] || '').userId === m1);

  // ③ 직함 — 직함 칸이 있으면 그 사람(가짜 풀 — 실데이터 직함을 건드리지 않는다)
  const fake = [
    { user_id: 1, role: 'owner', display_name: '김대표', names: ['김대표'], job_title: null, expertise: null },
    { user_id: 2, role: 'member', display_name: '이지은', names: ['이지은'], job_title: '디자이너', expertise: null },
    { user_id: 3, role: 'member', display_name: '박민수', names: ['박민수'], job_title: null, expertise: '백엔드 개발' },
    { user_id: 4, role: 'member', display_name: '박하늘', names: ['박하늘'], job_title: '마케터', expertise: null },
  ];
  const F = (s, asker = 4) => mm.resolveSaid(s, fake, { askerId: asker }).userId ?? null;
  check('«대표님» → 대표(owner)', F('대표님') === 1);
  check('«디자이너한테» → 디자이너', F('디자이너한테') === 2);
  check('«박 개발자» → 박○○ 중 개발', F('박 개발자') === 3);
  check('«박님» (박이 둘) → 정하지 않음', F('박님') === null);
  check('«지은님» → 성 뺀 이름', F('지은님') === 2);

  // ④ 업무 담당자 정하기(settleTaskAssignee) — 모델 인자 + 사용자 말
  const S = async (args, said, text, taskCount = 1) => {
    const a = { title: 'x', ...args };
    const r = await cue.settleTaskAssignee(WS, a, said, { lastText: text, userText: text, askerId: owner, taskCount });
    return { a, r };
  };
  let x = await S({ assignee_user_id: m2 }, null, `${m2Head}이 보내준 자료 정리하는 업무 만들어줘`);
  check('모델이 «언급만 된» 사람을 골랐다 → 비움(= 나)', !x.a.assignee_user_id, JSON.stringify(x.a));
  x = await S({}, `${m1Head}`, `${m1Head}한테 배너 시안 부탁해줘`);
  check(`모델이 이름 «${m1Head}» 만 줬다(표시명 ${m1Name}) → 그 사람`, x.a.assignee_user_id === m1, JSON.stringify(x.a));
  x = await S({}, null, `${m1Head.slice(1)}님께 상세페이지 수정 요청 넣어줘`);
  check('모델이 비웠는데 말에 지목 하나 → 그 사람', x.a.assignee_user_id === m1, JSON.stringify(x.a));
  x = await S({ title: '견적서 검토 요청', as_request: true }, '루아', '루아에게 견적서 검토 요청해줘');
  check('못 찾은 이름 → 비움 + 카드 안내 + «요청 대상» 설명', !x.a.assignee_user_id && !x.a.as_request && x.r.notes.some((n) => n.key === 'assignee_unresolved' && n.names === '루아') && /요청 대상: 루아/.test(x.a.description || ''), JSON.stringify(x));
  x = await S({ assignee_user_id: owner, as_request: true }, null, '내 업무로 보고서 작성 추가해줘');
  check('담당 = 나 → 요청 아님', !x.a.assignee_user_id && !x.a.as_request, JSON.stringify(x.a));
  x = await S({ title: '로그인 오류 확인 요청', as_request: true, assignee_user_id: m2 }, null, `${m2Head}님께 로그인 오류 확인 요청해줘`);
  check('요청 업무 제목 끝 «요청» 뗌', x.a.title === '로그인 오류 확인' && x.a.assignee_user_id === m2, JSON.stringify(x.a));
  x = await S({ assignee_user_id: m1 }, null, '경쟁사 비교표 이번 주까지 정리하는 업무 추가해줘');
  check('말에 없는 사람을 모델이 골랐다 → 비움', !x.a.assignee_user_id, JSON.stringify(x.a));
  x = await S({ assignee_user_id: m2 }, null, `1. ${m2Head}한테 API 문서 정리 요청\n2. ${m1Head}한테 아이콘 수정 요청`, 2);
  check('여러 건 — 모델이 고른 지목 사람은 그대로', x.a.assignee_user_id === m2, JSON.stringify(x.a));
  x = await S({}, null, `1. ${m2Head}한테 API 문서 정리 요청\n2. ${m1Head}한테 아이콘 수정 요청`, 2);
  check('여러 건 — 모델이 비운 항목을 아무에게나 채우지 않음', !x.a.assignee_user_id, JSON.stringify(x.a));

  // ⑤ 양성 대조군 — 옛 정확 일치는 같은 이름을 못 찾는다(이 검사가 «원래 되던 것» 만 재고 있지 않다는 증거)
  //   (옛 cue_tools·task_extractor 1차 = 표시명/계정명과 글자 그대로 같은지만 봤다 — 그 술어를 여기 그대로 둔다)
  const oldExact = (said) => pool.find((m) => m.names.some((n) => String(n).trim() === String(said).trim()))?.user_id || null;
  const ctrl = [m1Head, `${m1Head.slice(1)}님`, `${m2Head}님께`].map(oldExact);
  check('대조군: 옛 정확 일치는 같은 이름들을 못 찾음(새 규칙만 찾음)', (m1Head === m1Name || !ctrl[0]) && !ctrl[1] && !ctrl[2], JSON.stringify(ctrl));
  check('대조군: 새 규칙은 그 이름들을 찾음', R(m1Head).userId === m1 && R(`${m1Head.slice(1)}님`).userId === m1 && R(`${m2Head}님께`).userId === m2);

  console.log(`\n${pass} PASS · ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
