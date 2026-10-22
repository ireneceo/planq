// mailRetriage — 저장된 스레드를 **지금 기준으로 다시 판정**하는 한 벌 (docs/MAIL_CRITERIA_DESIGN.md §6)
//
// 쓰는 곳 셋: 운영 재판정 스크립트(scripts/retriage-mail.js) · 설정 «기준 끄기/켜기» 미리보기 · 그 소급.
//   여태 이 로직은 스크립트 안에만 있었다. 기준을 끄고 켜는 문이 생기면서 같은 판정을 화면에서도 돌려야 해
//   여기로 옮겼다 — 베끼면 «스크립트는 A, 화면 소급은 B» 가 된다.
//
// ★ 사람이 판단한 것은 건드리지 않는다(10-11 점검과 같은 원칙): 확인완료(archived)·스팸·답변 완료(dismissed)·
//   처리(handled)·규칙(rule)·답장함(replied)·보류(holding)·손으로 올림(manual)·담당 지정.
const { Op } = require('sequelize');
const { EmailThread, EmailMessage, EmailAccount, EmailThreadParticipant } = require('../models');
const T = require('./emailTriage');
const { applyRules } = require('./mailSenderRules');

const HUMAN_REASONS = ['dismissed', 'handled', 'rule', 'replied', 'holding', 'manual'];

/** 재판정 대상 스레드 where — 열린 것 중 사람이 손대지 않은 것. */
function eligibleWhere(extra = {}) {
  return {
    [Op.and]: [
      { rule_id: null, status: { [Op.in]: ['open', 'uncertain'] } },
      { [Op.or]: [{ reply_needed_reason: null }, { reply_needed_reason: { [Op.notIn]: HUMAN_REASONS } }] },
      { [Op.or]: [{ uncertain_reason: null }, { uncertain_reason: { [Op.ne]: 'manual' } }] },
      extra,
    ],
  };
}

/** 폴더 — 화면 폴더 정의(services/mailFolders)와 같은 뜻을 한 행에 대해. */
function folderOfRow(r) {
  if (r.status === 'spam') return 'spam';
  if (r.status === 'archived') return 'archived';
  if (r.reply_needed) return 'reply';
  if (r.status === 'uncertain') return 'review';
  return ['automated', 'marketing'].includes(r.triage) ? 'auto' : 'review';
}

/** 워크스페이스별 «우리 주소» — 수집 경로와 같은 함수(buildOwnEmailSet·buildOwnAddressMatcher). */
async function buildContext(businessIds) {
  const own = new Map(); const matcher = new Map();
  for (const b of new Set(businessIds.map(Number))) {
    own.set(b, [...(await T.buildOwnEmailSet(b))]);
    matcher.set(b, await T.buildOwnAddressMatcher(b));
  }
  return { own, matcher };
}

/** 담당 지정된 스레드 id — 재판정에서 뺀다. */
async function assignedIds(threadIds) {
  if (!threadIds.length) return new Set();
  const rows = await EmailThreadParticipant.findAll({
    where: { thread_id: { [Op.in]: threadIds }, is_assigned: true }, attributes: ['thread_id'],
  });
  return new Set(rows.map((p) => p.thread_id));
}

/** 스레드들의 마지막 받은 메일을 한 번에 읽는다 — 메일마다 묻지 않는다(수천 통을 돌 때 쿼리 수가 곧 시간이다). */
async function lastInboundOf(threadIds) {
  const out = new Map();
  if (!threadIds.length) return out;
  const { sequelize } = require('../config/database');
  const [ids] = await sequelize.query(
    `SELECT thread_id, MAX(id) AS id FROM email_messages
      WHERE thread_id IN (?) AND direction = 'inbound' GROUP BY thread_id`,
    { replacements: [threadIds] });
  if (!ids.length) return out;
  // 같은 스레드의 받은 메일 중 **가장 늦게 보낸 것**을 고른다(id 가 아니라 sent_at — 가져온 순서가 보낸 순서와 다를 수 있다).
  const msgs = await EmailMessage.findAll({ where: { thread_id: { [Op.in]: threadIds }, direction: 'inbound' },
    attributes: ['id', 'thread_id', 'sent_at'] });
  const best = new Map();
  for (const m of msgs) {
    const cur = best.get(m.thread_id);
    if (!cur || new Date(m.sent_at) > new Date(cur.sent_at)) best.set(m.thread_id, m);
  }
  const full = await EmailMessage.findAll({ where: { id: { [Op.in]: [...best.values()].map((m) => m.id) } } });
  for (const m of full) out.set(m.thread_id, m);
  return out;
}

/**
 * 한 스레드를 다시 판정한다(쓰지 않는다). offList 마다 결과를 돌려준다 — 끄기 전/후를 한 번에 재려고.
 *   msg 를 주면 메시지를 다시 읽지 않는다(lastInboundOf 로 한꺼번에 읽은 것).
 * @returns {null | { repliedLast:boolean, results: Array<{tr, fields, folder, criterion}> }}
 */
async function judgeThread(th, ctx, offList, { businessId, msg: givenMsg } = {}) {
  const bizId = Number(businessId || th.business_id);
  const msg = givenMsg !== undefined ? givenMsg
    : await EmailMessage.findOne({ where: { thread_id: th.id, direction: 'inbound' }, order: [['sent_at', 'DESC']] });
  if (!msg) return null;
  // 마지막 메시지가 우리 답장이면 답변 필요로 올리지 않는다(#200 부활 차단). 스레드의 마지막 방향 칸이 그 값이다.
  const repliedLast = th.last_message_direction === 'outbound';
  const fromEmail = msg.from_email || '';
  const { headers, complete } = T.headersFromMessage(msg);
  // «아는 상대» 는 보낸 사람마다 한 번만 묻는다 — 한 번 도는 동안 같은 주소가 수백 번 나온다(관계 조회가 비싸다).
  const kkey = `${bizId}|${String(fromEmail).toLowerCase()}`;
  if (!ctx.known) ctx.known = new Map();
  if (!ctx.known.has(kkey)) ctx.known.set(kkey, await require('./emailImapCron').isKnownContact(bizId, fromEmail));
  const known = ctx.known.get(kkey);
  const bodyText = T.triageBodyOf(msg.body_text, msg.body_html);
  const results = [];
  for (const off of offList) {
    const base = T.retriageStored({
      triage: th.triage,
      subject: msg.subject || th.subject,
      bodyText,
      fromEmail, headers, headersComplete: complete,
      ownEmails: ctx.own.get(bizId) || [], ownMatcher: ctx.matcher.get(bizId) || null,
      isKnownContact: known, off,
    });
    const tr = await applyRules(bizId, fromEmail, base, {
      subject: msg.subject, bodyText: msg.body_text, noRecord: !!ctx.noRecord,
      ...(ctx.rules && ctx.rules.has(bizId) ? { rules: ctx.rules.get(bizId) } : {}),
    });
    const nextReply = repliedLast ? false : !!tr.reply_needed;
    const nextStatus = tr.status || th.status;
    // triage 는 marketing 으로 가는 단방향만 저장한다(#200 — 헤더 없는 옛 메일이 사람 메일로 뒤집히지 않게).
    const nextTriage = (tr.triage === 'marketing' && th.triage !== 'marketing') ? 'marketing' : th.triage;
    const criterion = tr.rule_applied ? 'rule' : (tr.criterion || null);
    const fields = {
      reply_needed: nextReply, status: nextStatus, triage: nextTriage,
      uncertain_reason: tr.uncertain_reason || null, triage_criterion: criterion,
    };
    results.push({ tr, fields, criterion, folder: folderOfRow({ ...fields, triage: nextTriage }) });
  }
  return { repliedLast, results };
}

/** 규칙을 워크스페이스별로 한 번 읽어 둔다(judgeThread 가 메일마다 묻지 않게). */
async function preloadRules(ctx, businessIds) {
  const { MailSenderRule } = require('../models');
  ctx.rules = new Map();
  for (const b of new Set(businessIds.map(Number))) {
    ctx.rules.set(b, await MailSenderRule.findAll({ where: { business_id: b } }));
  }
}

/** 판정 결과를 스레드에 쓴다 — 답변 필요가 새로 켜지면 이유 'inbound', 꺼지면 'retriage'. */
async function writeFields(th, fields) {
  const patch = { ...fields };
  if (fields.reply_needed && !th.reply_needed) { patch.reply_needed_reason = 'inbound'; patch.reply_needed_at = new Date(); }
  else if (!fields.reply_needed && th.reply_needed) patch.reply_needed_reason = 'retriage';
  await th.update(patch);
}

/**
 * 설정에서 기준 하나를 켜거나 끌 때 — **그 기준 때문에** 폴더가 달라지는 스레드만 고른다.
 *   끄기 전(offBefore)과 후(offAfter)를 같은 스레드에 둘 다 돌려, 폴더가 다르고 둘 중 한쪽 기준이 그 id 인 것만.
 *   (저장된 값과 비교하지 않는다 — 그러면 이 기준과 무관한 옛 드리프트까지 같이 옮겨진다.)
 *   상한 limit — 최근 메일부터. 넘으면 capped.
 */
async function criterionImpact(businessId, criterionId, offBefore, offAfter, { apply = false, limit = 20000 } = {}) {
  const bizId = Number(businessId);
  const accounts = await EmailAccount.findAll({ where: { business_id: bizId }, attributes: ['id'] });
  const accIds = accounts.map((a) => a.id);
  if (!accIds.length) return { scanned: 0, moved: 0, capped: false, samples: [], by: {} };
  const rows = await EmailThread.findAll({
    where: eligibleWhere({ business_id: bizId, account_id: { [Op.in]: accIds } }),
    order: [['last_message_at', 'DESC']], limit: limit + 1,
  });
  const capped = rows.length > limit;
  const threads = rows.slice(0, limit);
  const assigned = await assignedIds(threads.map((t) => t.id));
  const ctx = await buildContext([bizId]);
  ctx.noRecord = !apply;   // 미리보기는 규칙 적중 수를 올리지 않는다
  await preloadRules(ctx, [bizId]);
  let moved = 0; const samples = []; const by = {};
  const CHUNK = 300;
  for (let i = 0; i < threads.length; i += CHUNK) {
    const part = threads.slice(i, i + CHUNK).filter((t) => !assigned.has(t.id));
    const msgs = await lastInboundOf(part.map((t) => t.id));
    for (const th of part) {
      const msg = msgs.get(th.id) || null;
      if (!msg) continue;
      const j = await judgeThread(th, ctx, [offBefore, offAfter], { businessId: bizId, msg });
      if (!j) continue;
      const [b, a] = j.results;
      if (b.folder === a.folder) continue;
      if (b.criterion !== criterionId && a.criterion !== criterionId) continue;
      moved++;
      const k = `${b.folder}>${a.folder}`;
      by[k] = (by[k] || 0) + 1;
      if (samples.length < 5) samples.push({ id: th.id, subject: th.subject, from: b.folder, to: a.folder });
      if (apply) await writeFields(th, a.fields);
    }
  }
  return { scanned: threads.length, moved, capped, samples, by };
}

/**
 * 새로 연결한 계정의 «지난 메일(읽기만)» 중 최근 것을 한 번 다시 재서 **답변 필요로 올리기만** 한다 (2026-10-22 Fable D3).
 *   첫 가져오기 30일은 답변 필요를 끈다(옛 결정 — 수백 건이 한꺼번에 오면 폴더가 무용지물). 그런데 받은편지함을 보낸편지함보다
 *   먼저 가져와 그 순간엔 «우리가 메일 보낸 상대» 를 몰랐고, 그래서 정말 답할 메일까지 확인 권장에 남았다(운영 ws17 33건).
 *   → 받은·보낸 첫 가져오기가 끝난 뒤, 마지막 받은 메일이 기준 시각 − windowDays 안이고 마지막이 우리 답장이 아닌 것만.
 *   다른 폴더로 옮기지 않는다(올리기만). 쓰기는 writeFields(이유 'inbound') · 알림 없음(백필과 같다).
 *   자동 경로(emailImapCron 첫 동기화 뒤)와 운영 일회 스크립트(scripts/promote-backfill-replies.js)가 이 함수 하나를 쓴다.
 * @returns {{ scanned:number, promoted:number, rows:Array<{id,subject,criterion,last_inbound_at}> }}
 */
async function promoteBackfillReplies({ accountId, baseAt = new Date(), windowDays = 14, apply = true } = {}) {
  const account = await EmailAccount.findByPk(Number(accountId), { attributes: ['id', 'business_id'] });
  if (!account) return { scanned: 0, promoted: 0, rows: [] };
  const bizId = Number(account.business_id);
  const since = new Date(new Date(baseAt).getTime() - windowDays * 86400000);
  const threads = await EmailThread.findAll({
    where: eligibleWhere({
      business_id: bizId, account_id: account.id, reply_needed: false, reply_needed_reason: 'backfill',
      // NULL(옛 행)도 대상 — SQL `<> 'outbound'` 는 NULL 을 빼므로 따로 넣는다. 마지막이 우리 답장인지는 judgeThread 가 다시 본다.
      [Op.or]: [{ last_message_direction: { [Op.ne]: 'outbound' } }, { last_message_direction: null }],
    }),
    order: [['last_message_at', 'DESC']],
  });
  const assigned = await assignedIds(threads.map((t) => t.id));
  const ctx = await buildContext([bizId]);
  ctx.noRecord = !apply;
  await preloadRules(ctx, [bizId]);
  const off = await require('./mailCriteria').offFor(bizId);
  const msgs = await lastInboundOf(threads.map((t) => t.id));
  const rows = [];
  let scanned = 0;
  for (const th of threads) {
    if (assigned.has(th.id)) continue;
    const msg = msgs.get(th.id) || null;
    if (!msg || !msg.sent_at || new Date(msg.sent_at) < since) continue;
    scanned++;
    const j = await judgeThread(th, ctx, [off], { businessId: bizId, msg });
    if (!j || j.repliedLast) continue;
    const r = j.results[0];
    if (!r.fields.reply_needed) continue;
    rows.push({ id: th.id, subject: th.subject, criterion: r.criterion, last_inbound_at: msg.sent_at });
    if (apply) await writeFields(th, r.fields);
  }
  return { scanned, promoted: rows.length, rows };
}

module.exports = { eligibleWhere, folderOfRow, buildContext, assignedIds, judgeThread, lastInboundOf, preloadRules, writeFields, criterionImpact, promoteBackfillReplies, HUMAN_REASONS };
