// M3-A 답장 라우트 검증 — 실 SMTP 발송 (자기 주소) + 스레드 연결 + reply_needed 해제
// 비번 변경 없이 JWT 직접 서명. 끝에 thread state 원복 (feedback_test_data_restore).
require('dotenv').config();
const jwt = require('jsonwebtoken');
const { EmailThread, EmailMessage } = require('./models');
const { sequelize } = require('./config/database');

const BASE = 'http://localhost:3003';
const BIZ = 5;
const THREAD = 154;
const USER_ID = 5;            // business 5 owner
const SELF = 'help+qmailtest@irenewp.com';  // 자기 주소로 발송 (외부 스팸 X)

async function main() {
  const token = jwt.sign({ userId: USER_ID }, process.env.JWT_SECRET, { expiresIn: '10m' });

  // 사전: 현재 thread 상태 스냅샷 + reply_needed=true 로 세팅 (해제 증명)
  const before = await EmailThread.findByPk(THREAD);
  const snapshot = {
    reply_needed: before.reply_needed,
    reply_needed_reason: before.reply_needed_reason,
    status: before.status,
    message_count: before.message_count,
    last_message_direction: before.last_message_direction,
    last_message_preview: before.last_message_preview,
    last_message_at: before.last_message_at,
  };
  await before.update({ reply_needed: true, reply_needed_reason: '검증용 임시', status: 'open' });
  const msgsBefore = await EmailMessage.count({ where: { thread_id: THREAD } });
  console.log('PRE: reply_needed=true 세팅, msgs=', msgsBefore);

  // 답장 발송 (to 명시 — 자기 주소)
  const r = await fetch(`${BASE}/api/businesses/${BIZ}/email-threads/${THREAD}/messages`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      body_html: '<p>PlanQ Q Mail M3-A 답장 발송 검증 메일입니다. (자동 테스트)</p>',
      to: [SELF],
    }),
  });
  const j = await r.json();
  console.log('POST /messages →', r.status, JSON.stringify(j));

  let pass = true;
  const check = (label, cond) => { console.log(cond ? `  ✅ ${label}` : `  ❌ ${label}`); if (!cond) pass = false; };

  check('HTTP 200 + success', r.status === 200 && j.success);
  if (j.success) {
    check('delivery_status=sent', j.data.delivery_status === 'sent');
    check('message_id 존재', !!j.data.message_id);
    check('rejected 없음', !j.data.rejected || j.data.rejected.length === 0);
  }

  // DB 검증
  const after = await EmailThread.findByPk(THREAD);
  const msgsAfter = await EmailMessage.count({ where: { thread_id: THREAD } });
  const outMsg = await EmailMessage.findOne({ where: { thread_id: THREAD, direction: 'outbound' }, order: [['id', 'DESC']] });

  check('outbound 메시지 +1', msgsAfter === msgsBefore + 1);
  check('reply_needed 해제됨', after.reply_needed === false);
  check('last_message_direction=outbound', after.last_message_direction === 'outbound');
  check('message_count 증가', after.message_count === snapshot.message_count + 1);
  if (outMsg) {
    check('outbound in_reply_to 연결', !!outMsg.in_reply_to);
    check('outbound from_email=계정', outMsg.from_email === 'help@irenewp.com');
    check('outbound sent_by_user_id=나', outMsg.sent_by_user_id === USER_ID);
    check('outbound to_emails=자기주소', Array.isArray(outMsg.to_emails) && outMsg.to_emails.includes(SELF));
  }

  // 경계: 빈 본문 → 400
  const r2 = await fetch(`${BASE}/api/businesses/${BIZ}/email-threads/${THREAD}/messages`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ body_html: '   ' }),
  });
  check('빈 본문 → 400', r2.status === 400);

  // 멀티테넌트: 다른 business(999) 로 같은 thread → 404
  const r3 = await fetch(`${BASE}/api/businesses/999/email-threads/${THREAD}/messages`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ body_html: '<p>x</p>' }),
  });
  check('타 워크스페이스 차단 (403/404)', r3.status === 403 || r3.status === 404);

  console.log('\n=== 원복 ===');
  // 보낸 메시지 1건 제거 + thread 스냅샷 복원 (검증 흔적 정리)
  if (outMsg && msgsAfter === msgsBefore + 1) {
    await EmailMessage.destroy({ where: { id: outMsg.id } });
    console.log('  outbound 테스트 메시지 삭제:', outMsg.id);
  }
  await after.update(snapshot);
  console.log('  thread 154 스냅샷 복원 완료');

  console.log('\n' + (pass ? '✅ 전체 통과' : '❌ 실패 항목 있음'));
  await sequelize.close();
  process.exit(pass ? 0 : 1);
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
