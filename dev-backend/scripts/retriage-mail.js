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
const { triageInbound } = require('../services/emailTriage');
const { applyRules } = require('../services/mailSenderRules');

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
  const threads = await EmailThread.findAll({
    where: { reply_needed: true, status: { [Op.in]: ['open', 'uncertain'] }, rule_id: null },
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

  let changed = 0, kept = 0, skipped = 0;
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
    const base = triageInbound({
      subject: msg.subject || th.subject,
      bodyText: msg.body_text || '',
      fromEmail,
      headers: msg.headers || {},
      ownEmails: ownEmailsByBiz.get(acc.business_id) || [],
      isKnownContact: false,   // 보수적으로: 아는 상대 판정은 동기화 시점 정보라 재계산하지 않는다
    });
    const tr = await applyRules(acc.business_id, fromEmail, base);
    if (tr.reply_needed) { kept++; continue; }
    changed++;
    if (samples.length < 8) samples.push(`${th.id} | ${(th.subject || '').slice(0, 34)} | ${fromEmail} → ${tr.status}/${tr.triage || base.triage || '-'}`);
    if (APPLY) {
      await th.update({
        reply_needed: false,
        reply_needed_reason: 'retriage',
        status: tr.status || th.status,
        triage: tr.triage || th.triage,
        uncertain_reason: tr.uncertain_reason || null,
        rule_id: tr.rule_id || null,
      });
    }
  }
  console.log(`대상 ${threads.length}건 — 답변 필요 유지 ${kept} · 해제 ${changed} · 건너뜀(담당자·데이터없음) ${skipped}`);
  if (samples.length) console.log('해제 예시:\n  ' + samples.join('\n  '));
  console.log(APPLY ? '→ 반영 완료' : '→ 미리보기 (반영하려면 --apply)');
  await sequelize.close();
})();
