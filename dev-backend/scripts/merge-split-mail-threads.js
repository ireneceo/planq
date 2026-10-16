// 갈라진 옛 메일 스레드 합치기 — 2026-10-16 (Fable 설계 판정 DESIGN-OK, 필수 3~10)
//
// Irene: "새로 온 메일이 이전 메일이랑 연결해서 안보여주는데? 계속 소통중인데 알 수가 없어." → «권고대로»(합친다).
//   새 메일은 services/emailImapCron.findOrCreateThread 가 이제 묶는다. 이 스크립트는 **고치기 전에 이미 갈라진** 대화를 모은다.
//
// 사용:
//   node scripts/merge-split-mail-threads.js                      # 미리보기(기본) — 아무것도 안 바꾼다
//   node scripts/merge-split-mail-threads.js --apply [--expect=<미리보기 plan json>]
//   node scripts/merge-split-mail-threads.js --undo=<run_id>
//   공통: --business=<id> · --group-cap=20 · --only=<스레드 id,…>(시험용 — 그 스레드가 든 묶음만) · --json(apply 때도 plan 저장)
//
// 묶는 규칙(헤더만 — 제목 일치는 링크가 아니다):
//   메시지 m 의 In-Reply-To + References 전부가 가리키는 메시지 p 가 같은 워크스페이스·같은 메일함(account)의 다른 스레드에 있으면 둘은 한 대화.
//   링크 끝점에서 빼는 메시지: 업체 스팸함 · 스팸/격리 스레드 · 반송(emailTriage.isBounce — 반송 288건이 주문 메일 수십 개를 한 덩어리로 엮었다).
// 건너뛰는 묶음(SKIP): 고객·프로젝트가 서로 다름 · 공개 범위(vlevel·대상)가 다름 · 공유 링크가 있음 · 크기 > cap ·
//   워크스페이스 삭제됨 · (--expect 를 주면) 미리보기 뒤 구성이 바뀜.
// 합치는 규칙: 상태 계열 = «가장 최근 메일을 가진 스레드» 값 하나 · 카운터는 메시지에서 다시 셈 · 별표 OR · 라벨 합집합 ·
//   참여자(담당 1명·팔로우 OR·읽음 MAX) · 초안 사람당 1개(나머지는 ledger 에 본문째) · 업무·후보·노트·이슈·FAQ·알림 링크 옮김 ·
//   상담 판단(mail.triage_correct)은 감사 원장을 고치지 않고 append · 죽은 스레드 행은 삭제 + email_thread_redirects(옛 링크).
// 그룹 하나 = 트랜잭션 하나. 되돌리기 정보는 scripts/out/mail-thread-merge-<run_id>.json.
'use strict';
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { sequelize } = require('../config/database');
const { isBounce } = require('../services/emailTriage');
const { mergeParticipants } = require('../services/emailAddress');
const { buildPreview } = require('../services/emailBodyClean');
const { writeAudit } = require('../services/auditService');

const arg = (k) => { const a = process.argv.find((x) => x === `--${k}` || x.startsWith(`--${k}=`)); if (!a) return null; return a.includes('=') ? a.slice(a.indexOf('=') + 1) : true; };
const APPLY = !!arg('apply');
const UNDO = arg('undo');
const BIZ = arg('business') ? Number(arg('business')) : null;
const CAP = Number(arg('group-cap') || 20);
const EXPECT = arg('expect');
const ONLY = arg('only') ? new Set(String(arg('only')).split(',').map(Number)) : null;   // 시험용 — 이 스레드가 든 묶음만
const OUT_DIR = path.join(__dirname, 'out');
const Q = (sql, rep, t) => sequelize.query(sql, { replacements: rep, type: sequelize.QueryTypes.SELECT, ...(t ? { transaction: t } : {}) });
const X = (sql, rep, t) => sequelize.query(sql, { replacements: rep, ...(t ? { transaction: t } : {}) });
const asArr = (v) => { if (v == null) return null; if (typeof v === 'string') { try { return JSON.parse(v); } catch { return null; } } return v; };
const sameJson = (a, b) => JSON.stringify(asArr(a) ?? null) === JSON.stringify(asArr(b) ?? null);
const ids = (v) => String(v || '').split(/\s+/).map((x) => x.trim()).filter(Boolean);

// ── 1. 묶음 찾기 ───────────────────────────────────────────────
async function findGroups() {
  const bizCond = BIZ ? 'AND t.business_id = :biz' : '';
  const threads = await Q(`SELECT t.* FROM email_threads t JOIN businesses b ON b.id = t.business_id
     WHERE b.deleted_at IS NULL ${bizCond}`, { biz: BIZ });
  const tById = new Map(threads.map((t) => [t.id, t]));
  const badThread = (t) => !t || t.status === 'spam' || t.spam_origin
    || ((asArr(t.impersonation) || {}).level === 'quarantine');
  const msgs = await Q(`SELECT m.id, m.thread_id, m.business_id, m.message_id, m.in_reply_to, m.references_chain,
       m.source_folder, m.from_email, m.subject, m.sent_at
     FROM email_messages m JOIN email_threads t ON t.id = m.thread_id JOIN businesses b ON b.id = t.business_id
     WHERE b.deleted_at IS NULL ${bizCond}`, { biz: BIZ });
  const usable = (m) => m && m.source_folder !== 'spam' && !badThread(tById.get(m.thread_id)) && !isBounce(m.from_email, m.subject);
  const byMid = new Map();
  for (const m of msgs) if (usable(m) && m.message_id) byMid.set(`${m.business_id}|${m.message_id}`, m);
  const parent = new Map();
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const add = (x) => { if (!parent.has(x)) parent.set(x, x); };
  for (const m of msgs) {
    if (!usable(m)) continue;
    const tm = tById.get(m.thread_id);
    for (const ref of new Set([...ids(m.in_reply_to), ...ids(m.references_chain)])) {
      const p = byMid.get(`${m.business_id}|${ref}`);
      if (!p || p.thread_id === m.thread_id) continue;
      if (tById.get(p.thread_id).account_id !== tm.account_id) continue;   // 같은 메일함만
      add(m.thread_id); add(p.thread_id);
      parent.set(find(p.thread_id), find(m.thread_id));
    }
  }
  const groups = new Map();
  for (const x of parent.keys()) { const r = find(x); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(x); }
  const lastMsg = new Map();   // thread → 가장 최근 메시지(sent_at, id)
  for (const m of msgs) {
    const cur = lastMsg.get(m.thread_id);
    const k = [new Date(m.sent_at).getTime(), m.id];
    if (!cur || k[0] > cur[0] || (k[0] === cur[0] && k[1] > cur[1])) lastMsg.set(m.thread_id, k);
  }
  const msgCount = new Map(); for (const m of msgs) msgCount.set(m.thread_id, (msgCount.get(m.thread_id) || 0) + 1);
  return [...groups.values()].filter((g) => g.length > 1).map((g) => g.sort((a, b) => a - b))
    .map((g) => ({ threads: g.map((id) => tById.get(id)), lastMsg, msgCount }));
}

// 사람 흔적 수 — 생존자 고르기
async function traces(tids) {
  const cnt = async (sql) => new Map((await Q(sql, { ids: tids })).map((r) => [Number(r.k), Number(r.n)]));
  const parts = [
    await cnt('SELECT email_thread_id k, COUNT(*) n FROM tasks WHERE email_thread_id IN (:ids) GROUP BY 1'),
    await cnt('SELECT email_thread_id k, COUNT(*) n FROM task_candidates WHERE email_thread_id IN (:ids) GROUP BY 1'),
    await cnt('SELECT email_thread_id k, COUNT(*) n FROM project_notes WHERE email_thread_id IN (:ids) GROUP BY 1'),
    await cnt('SELECT email_thread_id k, COUNT(*) n FROM project_issues WHERE email_thread_id IN (:ids) GROUP BY 1'),
    await cnt('SELECT thread_id k, COUNT(*) n FROM email_thread_participants WHERE thread_id IN (:ids) GROUP BY 1'),
    await cnt('SELECT thread_id k, COUNT(*) n FROM email_drafts WHERE thread_id IN (:ids) GROUP BY 1'),
    await cnt("SELECT target_id k, COUNT(*) n FROM audit_logs WHERE target_type = 'email_thread' AND action = 'mail.triage_correct' AND target_id IN (:ids) GROUP BY 1"),
  ];
  return parts;
}

async function planGroup(g) {
  const { threads, lastMsg, msgCount } = g;
  const tids = threads.map((t) => t.id);
  const plan = { business_id: threads[0].business_id, account_id: threads[0].account_id, threads: tids,
    signature: tids.map((id) => `${id}:${msgCount.get(id) || 0}`).join(','), subject: threads[0].subject, skip: null };
  if (tids.length > CAP) { plan.skip = `group_cap(${tids.length}>${CAP})`; return plan; }
  const distinct = (k) => [...new Set(threads.map((t) => t[k]).filter((v) => v != null).map(String))];
  if (distinct('client_id').length > 1) plan.skip = 'client_conflict';
  else if (distinct('project_id').length > 1) plan.skip = 'project_conflict';
  else if (distinct('vlevel').length > 1) plan.skip = 'vlevel_conflict';
  else if (threads.some((t) => !sameJson(t.target_member_ids, threads[0].target_member_ids))) plan.skip = 'target_members_conflict';
  else if (threads.some((t) => t.share_token)) plan.skip = 'share_token';
  if (plan.skip) return plan;
  const tr = await traces(tids);
  const score = (t) => tr.reduce((a, m) => a + (m.get(t.id) || 0), 0)
    + ((asArr(t.labels) || []).length) + (t.is_starred ? 1 : 0);
  const firstAt = async () => new Map((await Q('SELECT thread_id k, MIN(sent_at) a FROM email_messages WHERE thread_id IN (:ids) GROUP BY 1', { ids: tids })).map((r) => [r.k, new Date(r.a).getTime()]));
  const fa = await firstAt();
  const ranked = [...threads].sort((a, b) => (score(b) - score(a)) || ((fa.get(a.id) ?? Infinity) - (fa.get(b.id) ?? Infinity)) || (a.id - b.id));
  const survivor = ranked[0];
  const latest = [...threads].sort((a, b) => {
    const ka = lastMsg.get(a.id) || [0, 0]; const kb = lastMsg.get(b.id) || [0, 0];
    return (kb[0] - ka[0]) || (kb[1] - ka[1]);
  })[0];
  plan.survivor = survivor.id;
  plan.survivor_reason = `traces=${score(survivor)} first_at=${new Date(fa.get(survivor.id) || 0).toISOString()}`;
  plan.dead = tids.filter((id) => id !== survivor.id);
  plan.latest = latest.id;
  plan.members = threads.map((t) => ({ id: t.id, status: t.status, reply_needed: !!t.reply_needed, messages: msgCount.get(t.id) || 0, traces: score(t) }));
  return plan;
}

// ── 2. 한 묶음 합치기(트랜잭션 하나) ────────────────────────────────
async function applyGroup(plan, runId) {
  const S = plan.survivor; const dead = plan.dead; const all = plan.threads; const biz = plan.business_id;
  return sequelize.transaction(async (t) => {
    const rows = await Q('SELECT * FROM email_threads WHERE id IN (:all) FOR UPDATE', { all }, t);
    if (rows.length !== all.length) throw new Error('threads_changed');
    const counts = await Q('SELECT thread_id k, COUNT(*) n FROM email_messages WHERE thread_id IN (:all) GROUP BY 1', { all }, t);
    const sig = all.map((id) => `${id}:${Number((counts.find((c) => c.k === id) || {}).n || 0)}`).join(',');
    if (sig !== plan.signature) throw new Error('group_changed_since_plan');
    const byId = new Map(rows.map((r) => [r.id, r]));
    const sv = byId.get(S); const latest = byId.get(plan.latest);
    // ledger 스냅샷(되돌리기용)
    const L = { run_id: runId, business_id: biz, survivor: S, dead, survivor_row: sv, dead_rows: dead.map((id) => byId.get(id)) };
    L.messages = await Q('SELECT id, thread_id FROM email_messages WHERE thread_id IN (:dead)', { dead }, t);
    L.participants = await Q('SELECT * FROM email_thread_participants WHERE thread_id IN (:all)', { all }, t);
    L.drafts = await Q('SELECT * FROM email_drafts WHERE thread_id IN (:all)', { all }, t);
    L.refs = {};
    for (const tb of ['tasks', 'task_candidates', 'project_notes', 'project_issues']) {
      L.refs[tb] = await Q(`SELECT id, email_thread_id FROM ${tb} WHERE email_thread_id IN (:dead)`, { dead }, t);
    }
    const faq = await Q('SELECT id, source_thread_ids, occurrence_count FROM email_faq_suggestions WHERE business_id = :biz AND source_thread_ids IS NOT NULL', { biz }, t);
    L.faq = faq.filter((f) => (asArr(f.source_thread_ids) || []).some((x) => dead.includes(Number(x))));
    const deadRe = new RegExp(`thread=(${dead.join('|')})(?![0-9])`);
    const nRows = await sequelize.query(`SELECT id, link, entity_type, entity_id FROM notifications WHERE business_id = ?
        AND ((entity_type = 'email_thread' AND entity_id IN (${dead.map(() => '?').join(',')})) OR ${dead.map(() => 'link LIKE ?').join(' OR ')})`,
    { replacements: [biz, ...dead, ...dead.map((id) => `%thread=${id}%`)], type: sequelize.QueryTypes.SELECT, transaction: t });
    L.notifications = nRows.filter((n) => (n.entity_type === 'email_thread' && dead.includes(Number(n.entity_id))) || deadRe.test(String(n.link || '')));
    L.redirects_repointed = await Q('SELECT old_thread_id, new_thread_id FROM email_thread_redirects WHERE new_thread_id IN (:dead)', { dead }, t);

    // ① 메시지
    await X('UPDATE email_messages SET thread_id = :S WHERE thread_id IN (:dead)', { S, dead }, t);
    // ② 참여자 — 사람당 한 행. 담당은 «가장 최근 메일 스레드» 의 담당 1명(없으면 최근 순으로 첫 담당).
    const order = [plan.latest, ...all.filter((id) => id !== plan.latest)];
    const assignee = (() => { for (const tid of order) { const a = L.participants.find((p) => p.thread_id === tid && p.is_assigned); if (a) return a.user_id; } return null; })();
    const byUser = new Map();
    for (const p of L.participants) {
      const cur = byUser.get(p.user_id) || { user_id: p.user_id, is_following: 0, last_read_message_id: null, last_read_at: null };
      cur.is_following = cur.is_following || (p.is_following ? 1 : 0);
      if (p.last_read_message_id != null && (cur.last_read_message_id == null || p.last_read_message_id > cur.last_read_message_id)) cur.last_read_message_id = p.last_read_message_id;
      if (p.last_read_at && (!cur.last_read_at || new Date(p.last_read_at) > new Date(cur.last_read_at))) cur.last_read_at = p.last_read_at;
      byUser.set(p.user_id, cur);
    }
    L.dropped_assignees = [...new Set(L.participants.filter((p) => p.is_assigned && p.user_id !== assignee).map((p) => p.user_id))];
    if (L.participants.length) {
      await X('DELETE FROM email_thread_participants WHERE thread_id IN (:all)', { all }, t);
      for (const u of byUser.values()) {
        await X(`INSERT INTO email_thread_participants (thread_id, user_id, is_assigned, is_following, last_read_message_id, last_read_at,
            is_viewing, viewing_started_at, is_drafting, drafting_started_at, created_at, updated_at)
          VALUES (:S, :uid, :asg, :fol, :lrm, :lra, 0, NULL, 0, NULL, NOW(), NOW())`,
        { S, uid: u.user_id, asg: u.user_id === assignee ? 1 : 0, fol: u.is_following ? 1 : 0, lrm: u.last_read_message_id, lra: u.last_read_at }, t);
      }
    }
    // ③ 초안 — 사람당 최신 1개만(나머지는 ledger 에 본문째 남기고 지운다)
    const keep = new Map();
    for (const d of L.drafts) { const k = keep.get(d.user_id); if (!k || new Date(d.updated_at) > new Date(k.updated_at)) keep.set(d.user_id, d); }
    L.dropped_drafts = L.drafts.filter((d) => keep.get(d.user_id).id !== d.id).map((d) => d.id);
    if (L.dropped_drafts.length) await X('DELETE FROM email_drafts WHERE id IN (:ids)', { ids: L.dropped_drafts }, t);
    await X('UPDATE email_drafts SET thread_id = :S WHERE thread_id IN (:dead)', { S, dead }, t);
    // ④ 업무·후보·노트·이슈
    for (const tb of ['tasks', 'task_candidates', 'project_notes', 'project_issues']) {
      await X(`UPDATE ${tb} SET email_thread_id = :S WHERE email_thread_id IN (:dead)`, { S, dead }, t);
    }
    // ⑤ FAQ 근거 스레드
    for (const f of L.faq) {
      const next = [...new Set((asArr(f.source_thread_ids) || []).map((x) => (dead.includes(Number(x)) ? S : Number(x))))];
      await X('UPDATE email_faq_suggestions SET source_thread_ids = :j, occurrence_count = :n WHERE id = :id', { j: JSON.stringify(next), n: next.length, id: f.id }, t);
    }
    // ⑥ 알림 링크·대상
    for (const n of L.notifications) {
      const link = n.link ? String(n.link).replace(new RegExp(`thread=(${dead.join('|')})(?![0-9])`, 'g'), `thread=${S}`) : n.link;
      const ent = n.entity_type === 'email_thread' && dead.includes(Number(n.entity_id)) ? S : n.entity_id;
      await X('UPDATE notifications SET link = :link, entity_id = :ent WHERE id = :id', { link, ent, id: n.id }, t);
    }
    // ⑦ 상담 판단 — 감사 원장은 고치지 않고 append(saleInbox.latestMailJudgments 가 최신 1건을 읽는다)
    const judg = await Q(`SELECT id, target_id, user_id, new_value, created_at FROM audit_logs
        WHERE target_type = 'email_thread' AND action = 'mail.triage_correct' AND target_id IN (:all) ORDER BY created_at DESC, id DESC`, { all }, t);
    L.appended_audit = [];
    if (judg.length) {
      const top = judg[0];
      const svTop = judg.find((j) => Number(j.target_id) === S);
      if (!svTop || svTop.id !== top.id) {
        const nv = { ...(asArr(top.new_value) || {}), merged_from: Number(top.target_id), merge_run_id: runId };
        const row = await writeAudit({ action: 'mail.triage_correct', targetType: 'email_thread', targetId: S, businessId: biz, userId: top.user_id, newValue: nv }, { transaction: t });
        L.appended_audit.push(row.id);
      }
    }
    // ⑧ 생존자 행 — 상태 계열은 최근 스레드 값 하나, 카운터는 메시지에서
    const agg = (await Q(`SELECT COUNT(*) n, SUM(is_read = 0) u FROM email_messages WHERE thread_id = :S`, { S }, t))[0];
    const last = (await Q('SELECT id, direction, sent_at, body_text, body_html FROM email_messages WHERE thread_id = :S ORDER BY sent_at DESC, id DESC LIMIT 1', { S }, t))[0];
    const firstNonNull = (k) => { for (const id of order) { const v = byId.get(id)[k]; if (v != null) return v; } return null; };
    const labels = [...new Set(rows.flatMap((r) => asArr(r.labels) || []))].slice(0, 20);
    let parts = []; for (const r of [sv, ...rows.filter((r) => r.id !== S)]) parts = mergeParticipants(parts, asArr(r.participants) || []);
    const cursors = rows.map((r) => r.last_extracted_email_message_id);
    const set = {
      status: latest.status, reply_needed: latest.reply_needed, reply_needed_reason: latest.reply_needed_reason, reply_needed_at: latest.reply_needed_at,
      triage: latest.triage, triage_criterion: latest.triage_criterion, uncertain_reason: latest.uncertain_reason, rule_id: latest.rule_id, spam_score: latest.spam_score,
      is_starred: rows.some((r) => r.is_starred) ? 1 : 0,
      labels: labels.length ? JSON.stringify(labels) : null,
      follow_up_days: latest.follow_up_days != null ? latest.follow_up_days : firstNonNull('follow_up_days'),
      client_id: firstNonNull('client_id'), project_id: firstNonNull('project_id'),
      impersonation: sv.impersonation != null ? JSON.stringify(asArr(sv.impersonation)) : (firstNonNull('impersonation') != null ? JSON.stringify(asArr(firstNonNull('impersonation'))) : null),
      received_at_email: sv.received_at_email || firstNonNull('received_at_email'),
      ai_summary: null, ai_summary_at: null, ai_summary_model: null,
      last_extracted_email_message_id: cursors.some((c) => c == null) ? null : Math.min(...cursors),
      participants: JSON.stringify(parts),
      message_count: Number(agg.n) || 0, unread_count: Number(agg.u) || 0,
      last_message_at: last ? last.sent_at : sv.last_message_at,
      last_message_direction: last ? last.direction : sv.last_message_direction,
      last_message_preview: last ? (buildPreview(last.body_text, last.body_html, 500) || null) : sv.last_message_preview,
    };
    await X(`UPDATE email_threads SET ${Object.keys(set).map((k) => `\`${k}\` = :${k}`).join(', ')}, updated_at = NOW() WHERE id = :S`, { ...set, S }, t);
    // ⑨ 옛 링크 — 체인을 만들지 않는다
    await X('UPDATE email_thread_redirects SET new_thread_id = :S WHERE new_thread_id IN (:dead)', { S, dead }, t);
    for (const d of dead) {
      await X('INSERT INTO email_thread_redirects (old_thread_id, new_thread_id, business_id, run_id, created_at) VALUES (:d, :S, :biz, :run, NOW())', { d, S, biz, run: runId }, t);
    }
    // ⑩ 죽은 행 삭제 — 직전에 CASCADE/SET NULL 이 실데이터를 지울 길이 없는지 확인
    for (const [tb, col] of [['email_messages', 'thread_id'], ['email_thread_participants', 'thread_id'], ['email_drafts', 'thread_id'], ['task_candidates', 'email_thread_id']]) {
      const n = Number((await Q(`SELECT COUNT(*) n FROM ${tb} WHERE ${col} IN (:dead)`, { dead }, t))[0].n);
      if (n) throw new Error(`refs_left:${tb}=${n}`);
    }
    await X('DELETE FROM email_threads WHERE id IN (:dead)', { dead }, t);
    const au = await writeAudit({ action: 'mail.thread_merge', targetType: 'email_thread', targetId: S, businessId: biz,
      newValue: { merged: dead, run_id: runId, reason: 'header_link', ledger: `scripts/out/mail-thread-merge-${runId}.json`,
        dropped_assignees: L.dropped_assignees, dropped_drafts: L.dropped_drafts } }, { transaction: t });
    L.merge_audit_id = au.id;
    return L;
  });
}

// ── 3. 되돌리기 ────────────────────────────────────────────────
async function insertRow(table, row, t) {
  const cols = Object.keys(row);
  const val = (v) => (v != null && typeof v === 'object' && !(v instanceof Date) ? JSON.stringify(v) : v);
  await sequelize.query(`INSERT INTO ${table} (${cols.map((c) => `\`${c}\``).join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
    { replacements: cols.map((c) => val(row[c])), transaction: t });
}
const revive = (row) => { const out = { ...row }; for (const k of Object.keys(out)) if (typeof out[k] === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/.test(out[k])) out[k] = new Date(out[k]); return out; };

async function undoRun(runId) {
  const file = path.join(OUT_DIR, `mail-thread-merge-${runId}.json`);
  const led = JSON.parse(fs.readFileSync(file, 'utf8'));
  let ok = 0;
  for (const L of led.groups.slice().reverse()) {
    await sequelize.transaction(async (t) => {
      const S = L.survivor; const dead = L.dead;
      for (const r of L.dead_rows) await insertRow('email_threads', revive(r), t);
      const sv = revive(L.survivor_row); const cols = Object.keys(sv).filter((c) => c !== 'id');
      const val = (v) => (v != null && typeof v === 'object' && !(v instanceof Date) ? JSON.stringify(v) : v);
      await sequelize.query(`UPDATE email_threads SET ${cols.map((c) => `\`${c}\` = ?`).join(', ')} WHERE id = ?`, { replacements: [...cols.map((c) => val(sv[c])), S], transaction: t });
      for (const m of L.messages) await X('UPDATE email_messages SET thread_id = :tid WHERE id = :id', { tid: m.thread_id, id: m.id }, t);
      await X('DELETE FROM email_thread_participants WHERE thread_id IN (:all)', { all: [S, ...dead] }, t);
      for (const p of L.participants) await insertRow('email_thread_participants', revive(p), t);
      await X('DELETE FROM email_drafts WHERE id IN (:ids)', { ids: L.drafts.length ? L.drafts.map((d) => d.id) : [0] }, t);
      for (const d of L.drafts) await insertRow('email_drafts', revive(d), t);
      for (const [tb, list] of Object.entries(L.refs)) for (const r of list) await X(`UPDATE ${tb} SET email_thread_id = :tid WHERE id = :id`, { tid: r.email_thread_id, id: r.id }, t);
      for (const f of L.faq) await X('UPDATE email_faq_suggestions SET source_thread_ids = :j, occurrence_count = :n WHERE id = :id', { j: JSON.stringify(asArr(f.source_thread_ids)), n: f.occurrence_count, id: f.id }, t);
      for (const n of L.notifications) await X('UPDATE notifications SET link = :link, entity_id = :ent WHERE id = :id', { link: n.link, ent: n.entity_id, id: n.id }, t);
      await X('DELETE FROM email_thread_redirects WHERE run_id = :run AND old_thread_id IN (:dead)', { run: runId, dead }, t);
      for (const r of L.redirects_repointed) await X('UPDATE email_thread_redirects SET new_thread_id = :n WHERE old_thread_id = :o', { n: r.new_thread_id, o: r.old_thread_id }, t);
      // 이 병합이 만든 판단 사본만 거둔다(원판단 행은 원래 스레드 번호를 그대로 가리키고 있다)
      if (L.appended_audit.length) await X("DELETE FROM audit_logs WHERE id IN (:ids) AND action = 'mail.triage_correct'", { ids: L.appended_audit }, t);
      await writeAudit({ action: 'mail.thread_merge_undo', targetType: 'email_thread', targetId: S, businessId: L.business_id, newValue: { restored: dead, run_id: runId } }, { transaction: t });
    });
    ok += 1;
  }
  console.log(`[merge-split-mail-threads] undo ${runId}: ${ok} groups restored`);
}

// ── main ─────────────────────────────────────────────────────
(async () => {
  try {
    if (UNDO) { await undoRun(String(UNDO)); await sequelize.close(); process.exit(0); }
    const groups = await findGroups();
    const picked = ONLY ? groups.filter((g) => g.threads.some((t) => ONLY.has(t.id))) : groups;
    const plans = []; for (const g of picked) plans.push(await planGroup(g));
    const toMerge = plans.filter((p) => !p.skip);
    const sizes = {}; for (const p of plans) sizes[p.threads.length] = (sizes[p.threads.length] || 0) + 1;
    console.log(`[merge-split-mail-threads] ${APPLY ? 'APPLY' : 'DRY-RUN'} business=${BIZ || 'all'} cap=${CAP}`);
    console.log(`  묶음 ${plans.length} (스레드 ${plans.reduce((a, p) => a + p.threads.length, 0)}) · 합칠 것 ${toMerge.length} (없어질 스레드 ${toMerge.reduce((a, p) => a + p.dead.length, 0)}) · 건너뜀 ${plans.length - toMerge.length} · 크기 분포 ${JSON.stringify(sizes)}`);
    for (const p of plans) {
      console.log(`  ${p.skip ? 'SKIP ' + p.skip : 'MERGE'} biz=${p.business_id} acc=${p.account_id} «${String(p.subject || '').slice(0, 40)}» threads=[${p.threads.join(',')}]`
        + (p.skip ? '' : ` → ${p.survivor} (${p.survivor_reason}; 상태는 ${p.latest} 기준) ${JSON.stringify(p.members)}`));
    }
    if (arg('json') || !APPLY) {
      fs.mkdirSync(OUT_DIR, { recursive: true });
      const f = path.join(OUT_DIR, `mail-thread-merge-plan-${Date.now()}.json`);
      fs.writeFileSync(f, JSON.stringify({ business: BIZ, cap: CAP, plans }, null, 1));
      console.log(`  plan: ${path.relative(path.join(__dirname, '..'), f)}`);
    }
    if (!APPLY) { await sequelize.close(); process.exit(0); }
    const expected = EXPECT ? new Set(JSON.parse(fs.readFileSync(String(EXPECT), 'utf8')).plans.filter((p) => !p.skip).map((p) => p.signature)) : null;
    const runId = `${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}-${process.pid}`;
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const ledFile = path.join(OUT_DIR, `mail-thread-merge-${runId}.json`);
    const ledger = { run_id: runId, started_at: new Date().toISOString(), groups: [], failed: [], skipped_changed: [] };
    const flush = () => fs.writeFileSync(ledFile, JSON.stringify(ledger));
    for (const p of toMerge) {
      if (expected && !expected.has(p.signature)) { ledger.skipped_changed.push(p.threads); console.log(`  SKIP changed_since_dry_run [${p.threads}] — 다시 미리보기 하세요`); continue; }
      try { ledger.groups.push(await applyGroup(p, runId)); flush(); console.log(`  merged [${p.dead}] → ${p.survivor}`); } catch (e) { ledger.failed.push({ threads: p.threads, error: e.message }); flush(); console.log(`  FAIL [${p.threads}] ${e.message}`); }
    }
    flush();
    console.log(`  run_id=${runId} merged=${ledger.groups.length} failed=${ledger.failed.length} changed=${ledger.skipped_changed.length} ledger=${path.relative(path.join(__dirname, '..'), ledFile)}`);
    await sequelize.close(); process.exit(ledger.failed.length ? 2 : 0);
  } catch (e) { console.error('[merge-split-mail-threads] 실패:', e.stack || e.message); process.exit(1); }
})();
