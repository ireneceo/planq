// 옛 규칙으로 분류된 메일 스레드를 지금 규칙으로 다시 판정한다 (멱등).
//
// 새 분류(사이클: WORK_SIGNAL + 아는 상대 + 학습 규칙)가 들어오기 전에 동기화된 스레드는
// "뉴스레터·자동발송인데 답변 필요" 로 켜져 있다 → 답변 필요 폴더와 확인 필요 인박스가 무용지물.
// 원본 메일은 건드리지 않고 분류 필드만 다시 계산한다. 사람이 손댄 흔적(답변함·규칙·스팸 표시,
// 담당자 지정)은 존중해서 건드리지 않는다.
//
//   node scripts/retriage-mail.js            # 미리보기 (변경 없음)
//   node scripts/retriage-mail.js --apply    # 실제 반영
require('dotenv').config();
const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const { EmailThread, EmailMessage, EmailAccount, EmailThreadParticipant } = require('../models');
const { retriageStored, headersFromMessage } = require('../services/emailTriage');
const { applyRules } = require('../services/mailSenderRules');
const { isKnownContact } = require('../services/emailImapCron');

const APPLY = process.argv.includes('--apply');

(async () => {
  const accounts = await EmailAccount.findAll({ where: { is_active: true }, attributes: ['id', 'business_id', 'email'] });
  const accMap = new Map(accounts.map(a => [a.id, a]));
  const ownEmailsByBiz = new Map();
  accounts.forEach(a => {
    const list = ownEmailsByBiz.get(a.business_id) || [];
    list.push(String(a.email).toLowerCase());
    ownEmailsByBiz.set(a.business_id, list);
  });

  // 사람이 이미 처리한 스레드는 제외 — reply_needed_reason 이 'rule'/'backfill' 이거나
  // 담당자가 지정된 건 사용자의 판단이므로 그대로 둔다.
  // 대상: ①답변 필요로 켜진 것(과잉 분류 해제) ②자동·마케팅으로 밀려난 것(내용이 업무면 확인 권장으로 승격)
  // 대상: 열린 메일 전부(답변 필요·확인 권장·자동). 단 **사람이 직접 내린 건 건드리지 않는다** —
  //   "답변 완료"(dismissed) · "확인 완료"(handled) · 학습 규칙(rule) 은 사용자의 판단이다.
  //   여태 human+확인 권장 스레드가 대상에서 빠져 있어, 규칙이 개선돼도 답변 필요로 승격되지 않았다
  //   (실제 사례: "[해지관련 문의]" 가 확인 권장에 갇혀 있었다).
  const threads = await EmailThread.findAll({
    where: {
      rule_id: null,
      status: { [Op.in]: ['open', 'uncertain'] },
      [Op.or]: [
        { reply_needed_reason: null },
        { reply_needed_reason: { [Op.notIn]: ['dismissed', 'handled', 'rule'] } },
      ],
    },
    order: [['id', 'ASC']],
  });
  const assigned = new Set((await EmailThreadParticipant.findAll({
    where: { thread_id: { [Op.in]: threads.map(t => t.id).concat([0]) }, is_assigned: true },
    attributes: ['thread_id'],
  })).map(p => p.thread_id));

  // 백필(과거 메일)은 "읽기만" 이 정책인데 reply_needed=1 로 남은 모순 행 정리 (옛 동기화 잔재)
  const backfillStuck = await EmailThread.count({ where: { reply_needed: true, reply_needed_reason: 'backfill' } });
  if (APPLY && backfillStuck > 0) {
    await EmailThread.update({ reply_needed: false }, { where: { reply_needed: true, reply_needed_reason: 'backfill' } });
  }
  console.log(`백필인데 답변 필요로 켜져 있던 스레드: ${backfillStuck}건${APPLY ? ' → 해제' : ''}`);

  let changed = 0, kept = 0, skipped = 0, withHeaders = 0;
  const samples = [];
  for (const th of threads) {
    if (assigned.has(th.id)) { skipped++; continue; }
    const acc = accMap.get(th.account_id);
    if (!acc) { skipped++; continue; }
    const msg = await EmailMessage.findOne({
      where: { thread_id: th.id, direction: 'inbound' },
      order: [['sent_at', 'DESC']],
    });
    if (!msg) { skipped++; continue; }
    const fromEmail = msg.from_email || '';
    // 판정용 헤더 복원 — 단일 헬퍼. 저장된 헤더(triage_headers)가 있으면 complete=true 가 되어
    //   triage 부터 처음부터 다시 계산한다. 헤더가 없는 옛 메일은 저장된 triage 를 신뢰한다.
    const { headers, complete } = headersFromMessage(msg);
    const known = await isKnownContact(acc.business_id, fromEmail);
    const base = retriageStored({
      triage: th.triage,
      subject: msg.subject || th.subject,
      bodyText: msg.body_text || '',
      fromEmail,
      headers,
      headersComplete: complete,
      ownEmails: ownEmailsByBiz.get(acc.business_id) || [],
      isKnownContact: known,
    });
    if (complete) withHeaders++;
    const tr = await applyRules(acc.business_id, fromEmail, base);
    const nextStatus = tr.status || th.status;
    const nextReply = !!tr.reply_needed;
    // 바뀐 게 없으면 건드리지 않는다 (멱등)
    if (nextReply === !!th.reply_needed && nextStatus === th.status) { kept++; continue; }
    changed++;
    if (samples.length < 8) {
      const to = nextReply ? '답변 필요' : (nextStatus === 'uncertain' ? '확인 권장' : nextStatus);
      samples.push(`${th.id} | ${(th.subject || '').slice(0, 30)} | ${fromEmail} → ${to}`);
    }
    if (APPLY) {
      await th.update({
        reply_needed: nextReply,
        reply_needed_reason: nextReply ? (th.reply_needed_reason || 'inbound') : 'retriage',
        status: nextStatus,
        uncertain_reason: tr.uncertain_reason || null,
        rule_id: tr.rule_id || null,
      });
    }
  }
  console.log(`대상 ${threads.length}건 — 그대로 ${kept} · 재분류 ${changed} · 건너뜀(담당자·데이터없음) ${skipped}`);
  console.log(`헤더로 완전 재판정한 스레드: ${withHeaders}건 (나머지는 헤더 없는 옛 메일 → 저장된 분류 신뢰)`);
  if (samples.length) console.log('해제 예시:\n  ' + samples.join('\n  '));
  console.log(APPLY ? '→ 반영 완료' : '→ 미리보기 (반영하려면 --apply)');
  await sequelize.close();
})();
