// services/mailTrustedDomains.js — 사칭 검사의 «안전한 도메인»(관계사·자회사) 단일 원천.
//
// Irene 2026-10-27: *"같은 자회사 도메인인데 이런 내용이 나와. 계속 나오잖아 … 아니라고 누르면 이 도메인 안전하게 등록하던지."*
// 설계: docs/MAIL_IMPERSONATION_DESIGN.md §10 (Fable 2026-10-27 GO-WITH-CHANGES).
//
// 저장 자리는 `businesses.permissions.mail_trusted_domains = ['x.com', …]` (새 표·새 컬럼 0 — mail_criteria.off 와 같은 JSON).
// ★ 등록할 수 있는 도메인은 «경고(warn) 스레드의 From 유사 도메인 신호» 에서 서버가 고른 것 하나뿐이다 — 사용자가 적은 값을 받지 않는다.
//   링크·Reply-To 호스트는 제시하지 않는다(피싱 링크 도메인을 «안전» 으로 만드는 길). 격리(quarantine) 상태에서는 등록 못 한다
//   — 처음 온 관계사 메일은 먼저 [스팸 아님] 으로 풀고 등록한다(피싱을 받은 순간 한 번 눌러 등록되는 길을 막는다).
// ★ 효과는 «아는 도메인» 에만 더한다(우리 주소 범위·워크스페이스 이름 검사는 넓히지 않는다). 등록한 도메인도 비교 대상으로 남아
//   그 관계사를 흉내 낸 도메인은 계속 잡힌다. 숨김·방향 제어·섞인 문자 신호는 그대로 울린다.
'use strict';

const MAX = 50;
const esc = (v) => String(v).replace(/[!%_]/g, (c) => '!' + c);   // LIKE 글자 그대로

function listOf(biz) {
  const p = biz && biz.permissions && typeof biz.permissions === 'object' ? biz.permissions : {};
  const raw = Array.isArray(p.mail_trusted_domains) ? p.mail_trusted_domains : [];
  return [...new Set(raw.map((d) => String(d || '').trim().toLowerCase()).filter(Boolean))].slice(0, MAX);
}

/** 이 스레드 판정에서 «안전한 도메인으로 등록» 을 제시할 도메인 — 없으면 null. 화면 표시와 등록 라우트가 같은 함수를 본다. */
function candidateOf(imp) {
  if (!imp || imp.level !== 'warn') return null;
  // 사람이 [스팸 아님] 으로 풀었거나 아는 상대일 때만 — 보호 사유로 받은편지함에 남은 격리 등급(다시 판정이 경고로 낮춘 것)은
  //   한 번에 등록되지 않게(Fable 완료 검증 비차단 1·2).
  if (!imp.released_at && !imp.known) return null;
  for (const s of imp.signals || []) {
    if (s.code !== 'lookalike_known_domain') continue;
    const m = String(s.detail || '').match(/^from:([^~]+)~(.+)$/);
    if (!m) continue;
    const IMP = require('./mailImpersonation');
    const domain = IMP.registrable(m[1]);
    if (!domain || !domain.includes('.')) continue;
    if (require('./emailTriage').FREE_MAIL_DOMAIN.test(domain)) continue;
    return { domain, like: m[2] };
  }
  return null;
}

/**
 * 등록 — 이 워크스페이스의 경고 스레드에서 고른 도메인을 목록에 더하고, 사칭 판정이 있는 스레드를 다시 판정한다.
 * @returns {{ok:true, domain, list, reassessed, cleared, released} | {ok:false, code}}
 */
async function add(businessId, threadId) {
  const { Business, EmailThread } = require('../models');
  const thread = await EmailThread.findOne({ where: { id: threadId, business_id: businessId } });
  if (!thread) return { ok: false, code: 'thread_not_found' };
  const cand = candidateOf(thread.impersonation);
  if (!cand) return { ok: false, code: thread.impersonation && thread.impersonation.level === 'quarantine' ? 'release_first' : 'no_candidate' };
  const biz = await Business.findByPk(businessId);
  if (!biz) return { ok: false, code: 'business_not_found' };
  const before = listOf(biz);
  const ctx = await require('./mailImpersonation').contextOf(businessId);
  if (ctx.ownDomains && ctx.ownDomains.has(cand.domain)) return { ok: false, code: 'already_own' };
  if (before.includes(cand.domain)) return { ok: true, domain: cand.domain, like: cand.like, before, list: before, ...(await reassess(businessId)) };
  if (before.length >= MAX) return { ok: false, code: 'too_many' };
  const list = [...before, cand.domain];
  await biz.update({ permissions: { ...(biz.permissions && typeof biz.permissions === 'object' ? biz.permissions : {}), mail_trusted_domains: list } });
  require('./mailImpersonation').invalidate(businessId);
  return { ok: true, domain: cand.domain, like: cand.like, before, list, ...(await reassess(businessId)) };
}

async function remove(businessId, domain) {
  const { Business } = require('../models');
  const biz = await Business.findByPk(businessId);
  if (!biz) return { ok: false, code: 'business_not_found' };
  const before = listOf(biz);
  const d = String(domain || '').trim().toLowerCase();
  if (!before.includes(d)) return { ok: false, code: 'not_found' };
  const list = before.filter((x) => x !== d);
  const perms = { ...(biz.permissions && typeof biz.permissions === 'object' ? biz.permissions : {}), mail_trusted_domains: list };
  if (!list.length) delete perms.mail_trusted_domains;     // 비면 칸을 지운다(처음 상태 그대로)
  await biz.update({ permissions: perms });
  require('./mailImpersonation').invalidate(businessId);
  // 빼면 그 도메인에서 온 스레드에 배지가 다시 붙는다 — 격리는 다시 하지 않는다(사람이 이미 본 메일이다).
  return { ok: true, before, list, ...(await reassess(businessId, { fromDomain: d })) };
}

/**
 * 다시 판정 — 소급 스크립트(retriage-impersonation)와 같은 판정 함수(assessThread + isKnownContact).
 *   기본: 사칭 판정이 있는 스레드 전부. fromDomain: 그 도메인에서 받은 스레드(빼기 — 판정이 비어 있던 것도 본다).
 *   격리가 풀리는 것은 spam_origin='impersonation' 인 스레드만(mailSpamRelease.releaseQuarantined). 업체 스팸은 건드리지 않는다.
 *   새로 격리하지는 않는다 — 등급은 배지(impersonation)로만 고친다.
 */
async function reassess(businessId, { fromDomain = null } = {}) {
  const { Op } = require('sequelize');
  const { EmailThread, EmailMessage } = require('../models');
  const { sequelize } = require('../config/database');
  const IMP = require('./mailImpersonation');
  const { isKnownContact } = require('./emailImapCron');
  let ids;
  if (fromDomain) {
    const [rows] = await sequelize.query(
      `SELECT DISTINCT thread_id id FROM email_messages
        WHERE business_id = ? AND direction = 'inbound' AND (LOWER(from_email) LIKE ? ESCAPE '!' OR LOWER(from_email) LIKE ? ESCAPE '!') LIMIT 2000`,
      { replacements: [businessId, `%@${esc(fromDomain)}`, `%.${esc(fromDomain)}`] });
    ids = rows.map((r) => r.id);
  } else {
    ids = (await EmailThread.findAll({
      where: { business_id: businessId, impersonation: { [Op.ne]: null } }, attributes: ['id'], limit: 2000, raw: true,
    })).map((r) => r.id);
  }
  // 사람이 [스팸 아님] 으로 푼 스레드 — 등록으로 판정이 비었다가 빼면서 다시 붙을 때 «풀어 줌» 을 되살린다(감사 기록이 원천).
  const [ns] = ids.length ? await sequelize.query(
    `SELECT target_id id, MAX(created_at) at FROM audit_logs
      WHERE business_id = ? AND action = 'mail.mark_not_spam' AND target_type = 'email_thread' AND target_id IN (?) GROUP BY target_id`,
    { replacements: [businessId, ids.map(String)] }) : [[]];
  const notSpamAt = new Map(ns.map((r) => [Number(r.id), new Date(r.at).toISOString()]));
  let reassessed = 0; let cleared = 0; let released = 0;
  for (const id of ids) {
    const th = await EmailThread.findByPk(id);
    if (!th) continue;
    const last = await EmailMessage.findOne({ where: { thread_id: th.id, direction: 'inbound' }, order: [['id', 'DESC']], attributes: ['from_email'] });
    const known = last ? await isKnownContact(businessId, last.from_email) : false;
    let next = await IMP.assessThread(th, { known });
    if (next && next.level === 'quarantine' && !(th.status === 'spam' && th.spam_origin === 'impersonation')) {
      next = { ...next, level: 'warn' };     // 다시 판정은 격리하지 않는다
    }
    reassessed += 1;
    if (th.status === 'spam' && th.spam_origin === 'impersonation' && (!next || next.level !== 'quarantine')) {
      await require('./mailSpamRelease').releaseQuarantined(th);
      released += 1;
    }
    const prev = th.impersonation;
    if (next && prev && prev.released_at) next = { ...next, released_at: prev.released_at };
    else if (next && !next.released_at && notSpamAt.has(th.id)) next = { ...next, released_at: notSpamAt.get(th.id) };
    if (JSON.stringify(prev && prev.signals) !== JSON.stringify(next && next.signals) || (!!prev) !== (!!next)) {
      await th.update({ impersonation: next });
      if (prev && !next) cleared += 1;
    }
  }
  return { reassessed, cleared, released };
}

module.exports = { listOf, candidateOf, add, remove, reassess, MAX };
