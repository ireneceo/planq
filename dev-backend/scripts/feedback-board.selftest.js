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

eq('1 접수·needs_fix', pick(one(fb({ triage_verdict: 'needs_fix' }))), ['개발 필요', true, '관리자 화면에서 개발 진행(승인)·보류 정하기']);
eq('2 검토중·already_fixed', pick(one(fb({ status: 'reviewing', triage_verdict: 'already_fixed' }))), ['이미 해결', true, '초안대로 답장하고 완료로 닫기']);
eq('3 needs_decision', pick(one(fb({ triage_verdict: 'needs_decision' }))), ['결정 필요', true, '글 읽고 관리자 화면에서 진행·보류 정하기']);
eq('4a not_dev', pick(one(fb({ triage_verdict: 'not_dev' }))), ['답장만 필요', true, '초안대로 답장']);
eq('4b 문의(inquiry)·조사 없음', pick(one(fb({ kind: 'inquiry' }))), ['답장만 필요', true, '초안대로 답장']);
eq('5a 조사 없음·24시간 안', pick(one(fb({ created_at: YOUNG }))), ['확인 중', false, 'AI 원인 조사 기다리는 중']);
eq('5b 조사 unclear·24시간 넘음', pick(one(fb({ triage_verdict: 'unclear' }))), ['확인 중', true, '글 읽고 관리자 화면에서 진행·보류 정하기']);
const q = one(fb({ id: 7, status: 'queued', approved_at: OLD }));
eq('6a 진행대기', [...pick(q), q.queueRef], ['개발 필요', false, '개발 대기열 fb#7 에서 고치는 중', 'fb#7']);
eq('6b 진행대기·already_fixed', pick(one(fb({ id: 7, status: 'queued', triage_verdict: 'already_fixed' })))[0], '이미 해결');
eq('7 반영중', pick(one(fb({ status: 'in_progress' }))), ['개발 필요', false, '고쳤음 — 다음 배포 뒤 닫힘']);
eq('8 반영중 + 답 없는 후속 글', pick(one(fb({ status: 'in_progress', open_followups: 1 }))), ['개발 필요', true, '고객 추가 글에 답장 · 고쳤음 — 다음 배포 뒤 닫힘']);
eq('9 손님 문의 new', pick(one({ src: 'landing', id: 3, status: 'new', created_at: OLD, body: 'x' })), ['답장만 필요', true, '관리자 > 문의에서 메일로 회신']);
eq('10a 손님 문의 in_progress·회신 전', pick(one({ src: 'landing', id: 3, status: 'in_progress', created_at: OLD })), ['답장만 필요', true, '관리자 > 문의에서 메일로 회신']);
eq('10b 손님 문의 회신함(옛 내부 노트) → 닫기', pick(one({ src: 'landing', id: 3, status: 'in_progress', replied_at: OLD, created_at: OLD })), ['이미 해결', false, '회신함 — 시간 날 때 관리자 > 문의에서 완료로 닫기']);
const direct = one({ src: 'landing', id: 76, status: 'in_progress', replied_at: null, replies_sent: 1, last_reply_at: YOUNG, created_at: OLD });
eq('10c 직접 회신 sent(replied_at 없음) → 회신함·닫기', [...pick(direct), direct.replied, direct.link],
  ['이미 해결', false, '회신함 — 시간 날 때 관리자 > 문의에서 완료로 닫기', '자동 접수 메일 · 회신함(11-15)', 'https://planq.kr/admin/inquiries?status=in_progress&inquiry=76']);
eq('10d 직접 회신 0건·replied_at 없음 → 회신 아직', one({ src: 'landing', id: 4, status: 'in_progress', replies_sent: 0, created_at: OLD }).replied, '자동 접수 메일 · 회신 아직');
eq('10e 답함 + 후속 0 → 급하지 않음(Irene 필요 아님)', pick(one(fb({ status: 'reviewing', answered: 1, responded_at: OLD }))), ['확인 중', false, '답함 · 급한 일 없음 — 시간 날 때 관리자 화면에서 진행·보류·닫기']);
eq('10e2 문의 답함 → 이미 해결·닫기', pick(one(fb({ kind: 'inquiry', answered: 1, responded_at: OLD })))[0], '이미 해결');
eq('10f 답함 + 답 없는 후속 → 후속 답 먼저', pick(one(fb({ status: 'reviewing', answered: 1, open_followups: 1 })))[2], '고객 추가 글에 답장 · 글 읽고 관리자 화면에서 진행·보류 정하기');
eq('10g 진행대기는 답함이어도 닫기 대기 아님', pick(one(fb({ status: 'queued', answered: 1 })))[2], '개발 대기열 fb#1 에서 고치는 중');
const ord = buildItems([
  { src: 'landing', id: 9, status: 'in_progress', replies_sent: 1, created_at: '2026-11-14T00:00:00Z' },
  fb({ id: 2, status: 'queued', created_at: '2026-11-14T00:00:00Z' }),
  fb({ id: 3, created_at: OLD }),
], { now: NOW }).items.map((x) => x.ref);
eq('10h 정렬 — Irene 필요 → 닫기만 남음 → 진행 중', ord, ['fb#3', 'landing#9', 'fb#2']);
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
const rev = checkForPost(fill(() => ({})).reverse(), base);
eq('25 올릴 때 기계 순서 유지', rev.items.map((x) => x.ref), base.map((x) => x.ref));
eq('24 내부 칸(_orig) 안 나감', Object.keys(checkForPost(fill(() => ({})), base).items[0]).some((k) => k.startsWith('_')), false);

// 2026-11-16 — 근거(basis)·운영 반영·환불 기록
const dep = (c) => (c.startsWith('aaa') ? true : c.startsWith('bbb') ? false : null);
const af = (c) => buildItems([fb({ triage_verdict: 'already_fixed', triage_at: OLD, fixed_commit: c })], { now: NOW, isDeployed: dep }).items[0];
eq('26a 이미 고쳐짐·운영 반영됨 → 답장', [af('aaa1111222').needsIrene, af('aaa1111222').basis], [true, 'AI 조사(11-10): 이미 고쳐짐 — 커밋 aaa1111 운영 반영됨 · 접수']);
eq('26b 이미 고쳐짐·배포 전 → Irene 필요 아님', pick(af('bbb2222333')), ['이미 해결', false, '고친 것이 다음 배포에 나감 — 배포 뒤 답장']);
eq('26c 반영 여부 모름 → 답장(근거에 «모름»)', [af('ccc3333444').needsIrene, af('ccc3333444').basis.includes('운영 반영 여부 모름')], [true, true]);
eq('27 조사·답 없음 basis 는 일수', one(fb({})).basis, '원인 조사·답 없이 5일째 · 접수');
eq('28 basis 에 «AI 조사 없음» 같은 내부 표시 없음', one(fb({ status: 'reviewing', answered: 1, responded_at: OLD })).basis, '답함(11-10) · 그 뒤 고객 새 글 없음 · 검토중');
const rf = (refund) => one({ src: 'landing', id: 2, status: 'new', source: 'plan_refund', created_at: OLD, refund });
eq('29a 환불 문의·환불됨 → 이미 해결·근거', [...pick(rf({ id: 21, status: 'refunded', amount: '9900.00', refunded_at: '2026-10-22T01:33:01Z' })), rf({ id: 21, status: 'refunded', amount: '9900.00', refunded_at: '2026-10-22T01:33:01Z' }).basis],
  ['이미 해결', true, '환불 끝남 — 초안대로 회신하고 닫기', '결제 #21(9,900원) 환불됨(10-22) — 운영 결제 기록 · 아직 회신 안 함(5일째) · 새 문의']);
eq('29b 환불 문의·환불 기록 없음 → 결정 필요', pick(rf(null)), ['결정 필요', true, '관리자 > 결제에서 환불 여부 정하고 회신']);
eq('29c 환불 칸이 문자열 JSON 이어도', rf('{"id":3,"status":"refunded","amount":1,"refunded_at":null}').verdict, '이미 해결');
eq('30 basis 200자 이하', one(fb({ triage_verdict: 'needs_fix', triage_at: OLD, open_followups: 3 })).basis.length <= 200, true);

console.log(`feedback-board selftest: ${pass} pass · ${fail} fail`);
process.exit(fail ? 1 : 0);
