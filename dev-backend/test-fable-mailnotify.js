// Fable 구현 검증 게이트 — #203/#207 실호출 테스트 (검증 후 rm + 데이터 원복)
require('dotenv').config();
const { sequelize } = require('./config/database');
const { EmailAccount, EmailThread, Notification } = require('./models');
const { notifyInboundMail, HOURLY_CAP } = require('./services/mailNotify');

const MARK = 'FABLE-GATE-' + Date.now();
let fails = 0;
function check(name, cond, detail) {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (detail ? ' | ' + detail : ''));
  if (!cond) fails += 1;
}

async function q(sql, repl) { const [rows] = await sequelize.query(sql, { replacements: repl }); return rows; }

(async () => {
  const wmNoti = (await q('SELECT COALESCE(MAX(id),0) m FROM notifications'))[0].m;
  const wmMail = (await q('SELECT COALESCE(MAX(id),0) m FROM email_logs'))[0].m;
  const wmPush = (await q('SELECT COALESCE(MAX(id),0) m FROM push_logs'))[0].m;

  const acct32 = await EmailAccount.findByPk(32);   // 개인 (owner user 3, biz 3)
  const acct14 = await EmailAccount.findByPk(14);   // 회사 공용 (biz 3, inactive — sync 안 도는 안전 계정)
  const thread = await EmailThread.findByPk(3823);  // biz 3 실 스레드
  const orig14 = { email: acct14.email, notify_scope: acct14.notify_scope };
  const orig32 = { notify_scope: acct32.notify_scope };
  const replyFields = { reply_needed: true, status: 'open', triage: 'human' };

  // ── A. 개인 계정 격리 (핵심 반증 대상) ──
  const rA = await notifyInboundMail({ account: acct32, thread, fromName: 'Fable', fromEmail: 'fable@example.org', subject: MARK + '-A', fields: replyFields });
  const rowsA = await q("SELECT user_id FROM notifications WHERE id > :wm AND event_kind='mail' AND body = :b", { wm: wmNoti, b: MARK + '-A' });
  const uidsA = [...new Set(rowsA.map(r => r.user_id))].sort();
  check('A 개인계정 → owner(3) 1명만', JSON.stringify(uidsA) === '[3]', 'got=' + JSON.stringify(uidsA) + ' sent=' + rA.sent);
  const leakA = await q("SELECT COUNT(*) c FROM notifications WHERE id > :wm AND event_kind='mail' AND body = :b AND user_id != 3", { wm: wmNoti, b: MARK + '-A' });
  check('A 타 멤버 누출 0건', Number(leakA[0].c) === 0, 'leak=' + leakA[0].c);

  // ── B. 회사 계정 → 사람 멤버 전원, AI 제외 ──
  const rB = await notifyInboundMail({ account: acct14, thread, fromName: 'Fable', fromEmail: 'fable@example.org', subject: MARK + '-B', fields: replyFields });
  const rowsB = await q("SELECT DISTINCT user_id FROM notifications WHERE id > :wm AND event_kind='mail' AND body = :b", { wm: wmNoti, b: MARK + '-B' });
  const uidsB = rowsB.map(r => r.user_id).sort((a, b2) => a - b2);
  // 활성 멤버 = 3,7,16,17 (15·58 은 removed_at 찍힘 — defaultScope 가 제외해야 정상)
  check('B 회사계정 → 활성 사람 멤버 전원(3,7,16,17)', JSON.stringify(uidsB) === '[3,7,16,17]', 'got=' + JSON.stringify(uidsB) + ' sent=' + rB.sent);
  check('B Cue AI(11) 제외', !uidsB.includes(11));
  check('B 제거된 멤버(15,58) 제외', !uidsB.includes(15) && !uidsB.includes(58));

  // ── C. scope 게이트 ──
  await acct14.update({ notify_scope: 'reply_only' });
  const rC1 = await notifyInboundMail({ account: acct14, thread, fromEmail: 'f@e.org', subject: MARK + '-C1', fields: { reply_needed: false, status: 'uncertain', triage: 'human' } });
  check('C1 reply_only 에서 확인권장 차단', rC1.sent === 0, 'reason=' + rC1.reason);
  await acct14.update({ notify_scope: 'recommended' });
  const rC2 = await notifyInboundMail({ account: acct14, thread, fromEmail: 'f@e.org', subject: MARK + '-C2', fields: { reply_needed: false, status: 'open', triage: 'marketing' } });
  check('C2 recommended 에서 광고 차단', rC2.sent === 0, 'reason=' + rC2.reason);
  const rC3 = await notifyInboundMail({ account: acct14, thread, fromEmail: 'f@e.org', subject: MARK + '-C3', fields: { reply_needed: false, status: 'spam', triage: 'spam' } });
  check('C3 스팸 차단 (all 이어도)', rC3.sent === 0, 'reason=' + rC3.reason);
  await acct14.update({ notify_scope: 'all' });
  const rC4 = await notifyInboundMail({ account: acct14, thread, fromEmail: 'f@e.org', subject: MARK + '-C4', fields: { reply_needed: false, status: 'open', triage: 'marketing' } });
  const rowsC4 = await q("SELECT COUNT(DISTINCT user_id) c FROM notifications WHERE id > :wm AND event_kind='mail' AND body = :b", { wm: wmNoti, b: MARK + '-C4' });
  check('C4 all 에서 광고 통과 (활성 사람 멤버 4)', Number(rowsC4[0].c) === 4, 'got=' + rowsC4[0].c);
  // C4 는 review 아님(other) — email 채널이 눌렸는지 (reply 만 email)
  const mailC4 = await q('SELECT COUNT(*) c FROM email_logs WHERE id > :wm AND subject LIKE :s', { wm: wmMail, s: '%' + MARK + '-C4%' });
  check('C4 광고는 email 채널 0건 (inbox/push만)', Number(mailC4[0].c) === 0, 'emails=' + mailC4[0].c);

  // ── D. email 루프 가드 — 수신자 로그인 주소 == 계정 주소 ──
  await acct14.update({ email: 'member1@test.planq.kr', notify_scope: 'recommended' });
  const wmMail2 = (await q('SELECT COALESCE(MAX(id),0) m FROM email_logs'))[0].m;
  await notifyInboundMail({ account: acct14, thread, fromEmail: 'f@e.org', subject: MARK + '-D', fields: replyFields });
  const mailD = await q('SELECT to_email, status FROM email_logs WHERE id > :wm', { wm: wmMail2 });
  const toSet = mailD.map(r => r.to_email);
  check('D reply 는 email 시도 발생 (타 멤버)', toSet.length >= 1, 'to=' + JSON.stringify(toSet));
  check('D 루프 가드 — member1(계정주소 동일) email 0건', !toSet.includes('member1@test.planq.kr'), 'to=' + JSON.stringify(toSet));
  await acct14.update({ email: orig14.email, notify_scope: orig14.notify_scope });

  // ── E. 시간당 캡 (acct32, 개인 1수신자 — 이 프로세스에서 A 로 1회 소진) ──
  let sentCount = 1; // A
  let capHit = null;
  for (let i = 0; i < HOURLY_CAP + 3; i++) {
    const r = await notifyInboundMail({ account: acct32, thread, fromEmail: 'f@e.org', subject: MARK + '-E' + i, fields: { reply_needed: false, status: 'uncertain', triage: 'human' } });
    if (r.reason === 'hourly_cap') { capHit = sentCount; break; }
    sentCount += 1;
  }
  check('E 시간당 캡 — ' + HOURLY_CAP + '건 후 차단', capHit === HOURLY_CAP, 'capHit_after=' + capHit);

  // ── F. 링크·본문 형식 ──
  const sample = await q("SELECT link, title, body FROM notifications WHERE id > :wm AND event_kind='mail' AND body = :b LIMIT 1", { wm: wmNoti, b: MARK + '-A' });
  check('F link=/mail?thread=3823', sample[0] && sample[0].link.includes('/mail?thread=3823'), 'link=' + (sample[0] || {}).link);
  check('F body=제목만 (본문 미포함)', sample[0] && sample[0].body === MARK + '-A');

  // ── G. push 시도 실재 (§13 — user 3 active sub 보유) ──
  await new Promise(r => setTimeout(r, 3000));
  const pushG = await q('SELECT COUNT(*) c FROM push_logs WHERE id > :wm AND user_id = 3', { wm: wmPush });
  check('G PushLog 시도 ≥ 1 (user 3)', Number(pushG[0].c) >= 1, 'rows=' + pushG[0].c);

  // ── H. 옛 event_kind 회귀 — message ──
  const { notify } = require('./routes/notifications');
  await notify({ userId: 3, businessId: 3, eventKind: 'message', title: MARK + '-H', body: 'regression', link: '/talk' });
  const rowsH = await q("SELECT COUNT(*) c FROM notifications WHERE id > :wm AND event_kind='message' AND title = :t", { wm: wmNoti, t: MARK + '-H' });
  check('H 기존 kind(message) 정상 insert', Number(rowsH[0].c) === 1, 'rows=' + rowsH[0].c);

  // ── 원복 ──
  const del1 = await q('DELETE FROM notifications WHERE id > :wm AND (body LIKE :m OR title LIKE :m)', { wm: wmNoti, m: MARK + '%' });
  await q('DELETE FROM email_logs WHERE id > :wm AND subject LIKE :m', { wm: wmMail, m: '%' + MARK + '%' });
  await q('DELETE FROM push_logs WHERE id > :wm AND payload_title LIKE :m', { wm: wmPush, m: '%' + MARK + '%' });
  const remain = await q('SELECT COUNT(*) c FROM notifications WHERE body LIKE :m OR title LIKE :m', { m: MARK + '%' });
  const acct14f = await EmailAccount.findByPk(14);
  const acct32f = await EmailAccount.findByPk(32);
  check('원복 — 테스트 알림 잔존 0', Number(remain[0].c) === 0);
  check('원복 — acct14 email/scope 복구', acct14f.email === orig14.email && acct14f.notify_scope === orig14.notify_scope);
  check('원복 — acct32 scope 불변', acct32f.notify_scope === orig32.notify_scope);

  console.log(fails === 0 ? 'ALL PASS' : 'FAILURES: ' + fails);
  await sequelize.close();
  process.exit(fails === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
