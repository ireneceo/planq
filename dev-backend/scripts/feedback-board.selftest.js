#!/usr/bin/env node
// services/feedbackBoard 판정 자체 시험 — 설계 docs/FEEDBACK_AUTOREPLY_BOARD_DESIGN.md §2-2 표 줄마다 1건 + 검사 양성 대조.
//   node scripts/feedback-board.selftest.js   (DB·네트워크 없음, 실패 있으면 exit 1)
const { buildItems, checkForPost } = require('../services/feedbackBoard');

const NOW = Date.parse('2026-11-15T12:00:00Z');
const OLD = '2026-11-10T00:00:00Z';
const YOUNG = '2026-11-15T06:00:00Z';
const fb = (o) => ({ src: 'fb', id: 1, kind: 'feedback', status: 'pending', created_at: OLD, title: '원래 제목입니다', body: '본문 원문 앞부분이 여기에 있습니다 길게', answered: 0, open_followups: 0, followups: 0, ws: '시험 워크스페이스', ...o });
const one = (r) => buildItems([r], { now: NOW }).items[0];

let pass = 0; let fail = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else { fail++; console.log(`FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
}
const pick = (it) => it && [it.verdict, it.needsIrene, it.next];

eq('1 접수·needs_fix', pick(one(fb({ triage_verdict: 'needs_fix' }))), ['개발 필요', true, '승인하면 대기열로 — 관리자 > 사용자 피드백']);
eq('2 검토중·already_fixed', pick(one(fb({ status: 'reviewing', triage_verdict: 'already_fixed' }))), ['이미 해결', true, '답하고 닫기 — 관리자 화면']);
eq('3 needs_decision', pick(one(fb({ triage_verdict: 'needs_decision' }))), ['결정 필요', true, '결정 후 승인/보류']);
eq('4a not_dev', pick(one(fb({ triage_verdict: 'not_dev' }))), ['답장만 필요', true, '답글 달기 — 관리자 화면']);
eq('4b 문의(inquiry)·조사 없음', pick(one(fb({ kind: 'inquiry' }))), ['답장만 필요', true, '답글 달기 — 관리자 화면']);
eq('5a 조사 없음·24시간 안', pick(one(fb({ created_at: YOUNG }))), ['확인 중', false, 'AI 조사 기다림']);
eq('5b 조사 unclear·24시간 넘음', pick(one(fb({ triage_verdict: 'unclear' }))), ['확인 중', true, '조사 없이 승인 판단']);
const q = one(fb({ id: 7, status: 'queued', approved_at: OLD }));
eq('6a 진행대기', [...pick(q), q.queueRef], ['개발 필요', false, '대기열 fb#7 에서 진행', 'fb#7']);
eq('6b 진행대기·already_fixed', pick(one(fb({ id: 7, status: 'queued', triage_verdict: 'already_fixed' })))[0], '이미 해결');
eq('7 반영중', pick(one(fb({ status: 'in_progress' }))), ['개발 필요', false, '배포되면 닫힘']);
eq('8 반영중 + 답 없는 후속 글', pick(one(fb({ status: 'in_progress', open_followups: 1 }))), ['개발 필요', true, '추가 글에 답 필요 · 배포되면 닫힘']);
eq('9 손님 문의 new', pick(one({ src: 'landing', id: 3, status: 'new', created_at: OLD, body: 'x' })), ['답장만 필요', true, '관리자 > 문의에서 메일로 회신']);
eq('10a 손님 문의 in_progress·회신 전', pick(one({ src: 'landing', id: 3, status: 'in_progress', created_at: OLD })), ['답장만 필요', true, '관리자 > 문의에서 메일로 회신']);
eq('10b 손님 문의 회신함', pick(one({ src: 'landing', id: 3, status: 'in_progress', replied_at: OLD, created_at: OLD })), ['이미 해결', false, '없음 — 닫기만']);
eq('11 닫힌 상태는 줄 없음', buildItems([fb({ status: 'done' })], { now: NOW }).items.length, 0);
eq('12 replied 답함/접수 확인', [one(fb({ answered: 1, responded_at: OLD })).replied, one(fb({ ack_sent_at: YOUNG })).replied], ['답함(11-10)', '접수 확인 나감(11-15)']);
// 정렬·100건
const many = Array.from({ length: 130 }, (_, i) => fb({ id: i + 1, status: i % 2 ? 'queued' : 'pending', created_at: OLD }));
const b = buildItems(many, { now: NOW });
eq('13 100건 자름·전체 수', [b.items.length, b.total, b.items[0].needsIrene], [100, 130, true]);
// 개인정보 칸 없음
eq('14 who 에 이름·메일 없음', one(fb({})).who, '로그인 사용자 · 시험 워크스페이스');

// --post 검사 (양성 대조)
const base = buildItems([fb({ id: 1 }), fb({ id: 2, status: 'queued' })], { now: NOW }).items;
const fill = (patch) => base.map((x) => ({ ...x, title: '우리 말 요약', ...patch(x) }));
eq('15 정상은 통과', checkForPost(fill(() => ({})), base).ok, true);
eq('16 메일 주소 무늬 거절', checkForPost(fill((x) => (x.ref === 'fb#1' ? { draft: '연락 a.b@example.com 로' } : {})), base).ok, false);
eq('17 원문 제목 그대로 거절', checkForPost(fill((x) => (x.ref === 'fb#1' ? { title: '원래 제목입니다' } : {})), base).ok, false);
eq('18 원문 본문 앞 그대로 거절', checkForPost(fill((x) => (x.ref === 'fb#1' ? { title: '본문 원문 앞부분이 여기에 있습니다' } : {})), base).ok, false);
eq('19 빈 title 거절', checkForPost(fill((x) => (x.ref === 'fb#1' ? { title: '' } : {})), base).ok, false);
eq('20 판단 낱말 밖 거절', checkForPost(fill((x) => (x.ref === 'fb#1' ? { verdict: '급함' } : {})), base).ok, false);
eq('21 비밀값 무늬 거절', checkForPost(fill((x) => (x.ref === 'fb#1' ? { basis: 'key sk-abcdefghijklmnopqrstuv' } : {})), base).ok, false);
const tamper = checkForPost(fill((x) => ({ needsIrene: !x.needsIrene, queueRef: 'fb#999' })), base);
eq('22 needsIrene·queueRef 는 기계 값으로', tamper.items.map((x) => [x.needsIrene, x.queueRef]), base.map((x) => [x.needsIrene, x.queueRef]));
eq('23 줄 빠짐 거절', checkForPost(fill(() => ({})).slice(0, 1), base).ok, false);
eq('24 내부 칸(_orig) 안 나감', Object.keys(checkForPost(fill(() => ({})), base).items[0]).some((k) => k.startsWith('_')), false);

console.log(`feedback-board selftest: ${pass} pass · ${fail} fail`);
process.exit(fail ? 1 : 0);
