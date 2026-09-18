// scripts/e2e/canary-tenant-write.js — 일괄 **쓰기**가 남의 테넌트를 고치지 않는가 (실호출 + DB 판정).
//
// ★ 왜 필요한가 (Fable 22차 소견, 2026-09-17) — 이 계열을 막는 검사 2건이 **정적(문자열) 검사**라
//   우회된다. Fable 이 실제로 우회해 보였다: 새 코드를 그대로 두고 `resolveBulkTargetIds` 앞에
//   `if (!body.all && ids.length) return { ids }` **한 줄**만 끼우면 카나리는 **총 실패 0** 으로
//   통과하는데 실호출은 `200 {"updated":0}` 이면서 **남의 19스레드 메시지 34→0** 이었다.
//   «그 줄이 있다» 와 «그 줄을 지나간다» 는 다르다.
//
// ★ `--suite tenant` 는 GET 뿐이라 쓰기 격리가 통째로 계측 밖이었다(실측: 그 파일 머리말에도
//   "읽기 전용 GET 만" 이라고 적혀 있다). 여기서 POST 세 라우트를 실제로 친다.
//
// 판정은 **응답이 아니라 DB** 다 — 2026-09-17 의 실제 결함이 바로 «응답에 흔적이 없는데
//   데이터가 바뀌는» 모양이었다(`updated:0` 이라고 답하면서 남의 메시지 3행이 읽음으로).
//   `email_threads` UPDATE 는 where 에 business_id 가 있어 0건으로 막혔지만,
//   `email_messages` UPDATE 는 `thread_id IN (...)` 뿐이라 막을 것이 없었다.
const fs = require('fs');
const { sequelize } = require('/opt/planq/dev-backend/config/database');

const BACKEND = process.env.CANARY_BACKEND || 'http://localhost:3003';
const EMAIL = 'health-check@planq.kr';
const PASSWORD = 'HealthCheck2026!';
const TOKEN_CACHE_PATH = '/tmp/.planq-health-token.json';

async function getToken() {
  try {
    const c = JSON.parse(fs.readFileSync(TOKEN_CACHE_PATH, 'utf-8'));
    if (c.expires_at > Date.now() && c.token) return c.token;
  } catch { /* no cache */ }
  const res = await fetch(`${BACKEND}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (res.status !== 200) throw new Error(`login ${res.status}`);
  const d = await res.json();
  try {
    fs.writeFileSync(TOKEN_CACHE_PATH, JSON.stringify({
      token: d.data.token, user_id: d.data.user?.id, expires_at: Date.now() + 12 * 60 * 1000,
    }));
  } catch { /* ignore */ }
  return d.data.token;
}

const q = (sql, replacements = []) => sequelize.query(sql, { replacements }).then(([r]) => r);

/** 피해자 스냅샷 — 메시지 미읽음 수 + 스레드의 세 필드. 이 셋이 일괄 3라우트가 건드리는 전부다. */
async function snapshot(ids) {
  if (!ids.length) return { msgUnread: 0, threads: [] };
  const ph = ids.map(() => '?').join(',');
  const [m] = await q(`SELECT COUNT(*) n FROM email_messages WHERE thread_id IN (${ph}) AND is_read = 0`, ids);
  const threads = await q(
    `SELECT id, unread_count, status, reply_needed FROM email_threads WHERE id IN (${ph}) ORDER BY id`, ids);
  return { msgUnread: Number(m.n), threads };
}
const same = (a, b) => a.msgUnread === b.msgUnread && JSON.stringify(a.threads) === JSON.stringify(b.threads);

async function post(token, bizId, action, body) {
  const res = await fetch(`${BACKEND}/api/businesses/${bizId}/email-threads/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  let json = null; try { json = await res.json(); } catch { /* ignore */ }
  return { status: res.status, json };
}

const ACTIONS = ['bulk-read', 'bulk-handled', 'bulk-dismiss'];

// ★ 2026-09-18 (Fable 24차 비차단 소견) — **«같은 워크스페이스 안 남의 사적 계정»** 축.
//   `resolveBulkTargetIds` 의 `acctIds.includes(picked)` 를 없애면 `account_id` 가 **넓히는 문**이 된다.
//   그런데 그 회귀를 심어도 이 카나리는 **초록**이었다 — 크로스테넌트는 `business_id` 술어가
//   여전히 막아 표본이 안 바뀌기 때문이다. 그 회귀가 실제로 여는 것은 **내 워크스페이스 안에 있는
//   다른 사람의 사적 메일 계정**(L1 축)인데, dev 에 그런 자료가 0건이라 실증 자체가 불가능했다.
//   → 「검사는 도는데 비교할 대상이 없어 늘 참」 = memory `feedback_guard_key_never_matches` 계열.
//   그래서 **픽스처를 직접 만든다.** 만들고 반드시 지운다(남긴 상태가 다음 검사를 죽인다).
//   ★ `q()` 는 sequelize 결과의 첫 원소를 돌려준다 — SELECT 면 rows, **INSERT 면 insertId**(배열 아님).
//     배열로 분해하면 `is not iterable` 로 죽는다(2026-09-18 실제로 겪었고 fail-closed 가 ⚪ 로 잡았다).
async function seedPrivateAccount(businessId, actorId) {
  const tag = `tw${Date.now()}`;
  const uid = await q(
    `INSERT INTO users (email, password_hash, name, username, platform_role, created_at, updated_at)
     VALUES (?, 'x', 'TenantWrite Fixture', ?, 'user', NOW(), NOW())`,
    [`${tag}@test.planq.kr`, tag]);
  if (uid === actorId) throw new Error('픽스처 소유자가 배우와 같다');
  await q(`INSERT INTO business_members (business_id, user_id, role, created_at, updated_at)
           VALUES (?, ?, 'member', NOW(), NOW())`, [businessId, uid]);
  // owner_user_id = 남의 id → accessibleAccountIds 가 배우에게 주지 않는 **사적 계정**
  const acctId = await q(
    `INSERT INTO email_accounts (business_id, email, display_name, imap_host, imap_username,
                                 owner_user_id, is_active, created_at, updated_at)
     VALUES (?, ?, 'TW Fixture', 'imap.invalid', ?, ?, 0, NOW(), NOW())`,
    [businessId, `${tag}@private.test`, `${tag}@private.test`, uid]);
  const threadIds = [];
  for (let i = 0; i < 2; i++) {
    const tid = await q(
      `INSERT INTO email_threads (business_id, account_id, subject, status, unread_count,
                                  message_count, reply_needed, is_starred, created_at, updated_at)
       VALUES (?, ?, ?, 'open', 2, 2, 1, 0, NOW(), NOW())`,
      [businessId, acctId, `${tag} 사적 스레드 ${i}`]);
    threadIds.push(tid);
    for (let m = 0; m < 2; m++) {
      await q(
        `INSERT INTO email_messages (business_id, thread_id, message_id, direction, delivery_status,
                                     is_read, to_emails, sent_at, created_at, updated_at)
         VALUES (?, ?, ?, 'inbound', 'delivered', 0, '[]', NOW(), NOW(), NOW())`,
        [businessId, tid, `<${tag}-${i}-${m}@private.test>`]);
    }
  }
  return { uid, acctId, threadIds };
}

async function dropPrivateAccount(f) {
  if (!f) return;
  try {
    if (f.threadIds?.length) {
      const ph = f.threadIds.map(() => '?').join(',');
      await q(`DELETE FROM email_messages WHERE thread_id IN (${ph})`, f.threadIds);
      await q(`DELETE FROM email_threads WHERE id IN (${ph})`, f.threadIds);
    }
    if (f.acctId) await q('DELETE FROM email_accounts WHERE id = ?', [f.acctId]);
    if (f.uid) {
      await q('DELETE FROM business_members WHERE user_id = ?', [f.uid]);
      await q('DELETE FROM users WHERE id = ?', [f.uid]);
    }
  } catch { /* 정리 실패는 검사 결과를 바꾸지 않는다 — 남으면 다음 실행이 새 tag 로 만든다 */ }
}

async function run() {
  const results = [];
  const push = (name, ok, msg) => results.push({ name, fail: ok ? 0 : 1, details: msg ? [msg] : [] });
  const unmeasured = (name, why) => results.push({ name, unmeasured: true, details: [why] });

  // 배우 — health-check 계정과 그 소속 워크스페이스
  const [actor] = await q('SELECT id, platform_role FROM users WHERE email = ?', [EMAIL]);
  if (!actor) return [{ name: 'canary-tenant-write', fail: 1, details: [`테스트 계정(${EMAIL}) 없음`] }];
  if (actor.platform_role === 'platform_admin') {
    return [{ name: 'canary-tenant-write', fail: 1, details: ['health-check 가 platform_admin — 격리 검증 불가'] }];
  }
  const mine = await q('SELECT business_id FROM business_members WHERE user_id = ?', [actor.id]);
  const myBizIds = mine.map((r) => r.business_id);
  if (!myBizIds.length) return [{ name: 'canary-tenant-write', fail: 1, details: ['소속 워크스페이스 없음'] }];

  // 배우가 실제로 일괄 처리를 할 수 있는 워크스페이스 — 접근 가능 계정에 미읽음 스레드가 있는 곳
  const ph = myBizIds.map(() => '?').join(',');
  const [home] = await q(
    `SELECT t.business_id AS biz, COUNT(*) n FROM email_threads t
       JOIN email_accounts a ON a.id = t.account_id
      WHERE t.business_id IN (${ph}) AND (a.owner_user_id IS NULL OR a.owner_user_id = ?)
        AND t.unread_count > 0
      GROUP BY t.business_id ORDER BY n DESC LIMIT 1`, [...myBizIds, actor.id]);
  if (!home) return [{ name: 'canary-tenant-write', unmeasured: true, details: ['배우에게 미읽음 스레드가 없다 — 판정 불가'] }];
  const myBiz = home.biz;

  // 피해자 — 배우가 **속하지 않은** 워크스페이스. 각 액션이 실제로 바꿀 수 있는 행만 고른다.
  //   ★ 「바꿀 것이 없는 행」을 고르면 "안 바뀌었다" 가 공허해진다(빈 fixture 거짓 판정).
  //     실제로 첫 판에서 `unread_count ASC` 가 미읽음 0인 행만 집어 누출 판정이 뜻을 잃었다 —
  //     내장 fail-closed 가드가 ⚪ 로 잡아 줬다. **누출 벡터(미읽음 메시지)를 반드시 포함시킨다.**
  const leakable = await q(
    `SELECT t.id, (SELECT COUNT(*) FROM email_messages m WHERE m.thread_id = t.id AND m.is_read = 0) um
       FROM email_threads t WHERE t.business_id NOT IN (${ph})
      HAVING um > 0 ORDER BY um ASC, t.id ASC LIMIT 4`, myBizIds);
  const dismissable = await q(
    `SELECT id FROM email_threads WHERE business_id NOT IN (${ph}) AND reply_needed = 1
      ORDER BY id ASC LIMIT 2`, myBizIds);
  const archivable = await q(
    `SELECT id FROM email_threads WHERE business_id NOT IN (${ph}) AND status <> 'archived'
      ORDER BY id ASC LIMIT 2`, myBizIds);
  const victimIds = [...new Set([...leakable, ...dismissable, ...archivable].map((r) => r.id))];
  if (victimIds.length < 2) return [{ name: 'canary-tenant-write', unmeasured: true, details: ['타 워크스페이스 스레드 부족 — 판정 불가'] }];

  const token = await getToken();
  const before = await snapshot(victimIds);
  // ★ 빈 fixture 로 "0건이라 통과" 를 막는다 — 피해자에 바꿀 것이 실제로 있어야 검사가 뜻을 갖는다
  const canDismiss = before.threads.some((t) => Number(t.reply_needed) === 1);
  const canArchive = before.threads.some((t) => t.status !== 'archived');
  if (before.msgUnread === 0) {
    unmeasured('피해자 표본', `미읽음 메시지 0건 — 바뀔 것이 없어 판정 불가 (스레드 ${victimIds.length}건)`);
  } else {
    push('피해자 표본 — 바꿀 것이 실제로 있다', canDismiss && canArchive,
      `스레드 ${victimIds.length}건 · 미읽음 메시지 ${before.msgUnread}행 · 답변필요 ${canDismiss ? '있음' : '없음'} · 미보관 ${canArchive ? '있음' : '없음'}`);
  }

  // ── ① 크로스테넌트: 세 라우트 모두 400 + 피해자 DB 무변경
  for (const action of ACTIONS) {
    const r = await post(token, myBiz, action, { thread_ids: victimIds });
    const after = await snapshot(victimIds);
    const untouched = same(before, after);
    push(`${action} — 남의 스레드 id 는 거부`, r.status === 400 && untouched,
      `HTTP ${r.status} ${JSON.stringify(r.json?.message ?? r.json?.data ?? '')} · 피해자 미읽음 ${before.msgUnread}→${after.msgUnread}` +
      (untouched ? '' : ' ← ❌ 남의 데이터가 바뀌었다'));
  }

  // ── ② `account_id` 가 **넓히는 문**이 되지 않는가 — 축은 «같은 워크스페이스 안 남의 사적 계정».
  //     타 워크스페이스 축은 ①이 이미 본다(중복). 여기서만 드러나는 것은 L1(사적 계정) 누출이다.
  let fixture = null;
  try {
    fixture = await seedPrivateAccount(myBiz, actor.id);
    const privBefore = await snapshot(fixture.threadIds);
    if (privBefore.msgUnread === 0) {
      unmeasured('사적 계정 픽스처', '미읽음 메시지 0건 — 바뀔 것이 없어 판정 불가');
    } else {
      // ⓐ account_id 로 **콕 집어** 지정 — 여기가 `acctIds.includes(picked)` 가 지키는 자리다
      const rA = await post(token, myBiz, 'bulk-read',
        { thread_ids: fixture.threadIds, account_id: fixture.acctId });
      const afterA = await snapshot(fixture.threadIds);
      push('같은 워크스페이스 — 남의 사적 계정을 account_id 로 집어도 안 열린다',
        rA.status === 400 && same(privBefore, afterA),
        `HTTP ${rA.status} ${JSON.stringify(rA.json?.message ?? '')} · 사적 미읽음 ${privBefore.msgUnread}→${afterA.msgUnread}` +
        (same(privBefore, afterA) ? '' : ' ← ❌ 남의 사적 메일이 바뀌었다'));

      // ⓑ account_id 없이 스레드 id 만 — 계정 범위(acctScope)가 기본으로 막는가
      //   ★ 기준선을 **바로 직전 상태**로 다시 잡는다. ⓐ 가 이미 샜다면 그 결과를 물려받아
      //     ⓑ 까지 빨간불이 되어 «어느 호출이 샜는지» 를 못 가른다(2026-09-18 실측으로 걸렸다).
      const midB = await snapshot(fixture.threadIds);
      const rB = await post(token, myBiz, 'bulk-read', { thread_ids: fixture.threadIds });
      const afterB = await snapshot(fixture.threadIds);
      push('같은 워크스페이스 — 남의 사적 스레드 id 만 보내도 안 열린다',
        rB.status === 400 && same(midB, afterB),
        `HTTP ${rB.status} · 사적 미읽음 ${midB.msgUnread}→${afterB.msgUnread}` +
        (same(midB, afterB) ? '' : ' ← ❌ 남의 사적 메일이 바뀌었다'));
    }
  } catch (e) {
    unmeasured('같은 워크스페이스 사적 계정 축', `픽스처 생성 실패 — ${String(e.message).slice(0, 90)}`);
  } finally {
    await dropPrivateAccount(fixture);
  }

  // ── ③ 음성 대조군 — 내 것 1건은 **실제로 처리된다**(400 이 «라우트가 죽어서» 가 아님을 증명)
  //     + 섞어 보내면 내 것만 처리되고 남의 것은 그대로다.
  const [own] = await q(
    `SELECT t.id FROM email_threads t JOIN email_accounts a ON a.id = t.account_id
      WHERE t.business_id = ? AND (a.owner_user_id IS NULL OR a.owner_user_id = ?)
        AND t.unread_count > 0 ORDER BY t.unread_count ASC, t.id ASC LIMIT 1`, [myBiz, actor.id]);
  if (!own) {
    unmeasured('음성 대조군 — 내 스레드는 처리된다', '배우 소속에 미읽음 스레드 없음');
  } else {
    // 원복을 위해 지금 상태를 정확히 기록한다
    const ownBefore = (await q('SELECT id, unread_count, status, reply_needed FROM email_threads WHERE id = ?', [own.id]))[0];
    const ownMsgs = (await q('SELECT id FROM email_messages WHERE thread_id = ? AND is_read = 0', [own.id])).map((r) => r.id);
    try {
      const r = await post(token, myBiz, 'bulk-read', { thread_ids: [own.id, ...victimIds] });
      const ownAfter = (await q('SELECT unread_count FROM email_threads WHERE id = ?', [own.id]))[0];
      const victimAfter = await snapshot(victimIds);
      push('섞어 보내기 — 내 것만 처리되고 남의 것은 그대로',
        r.status === 200 && Number(ownAfter.unread_count) === 0 && same(before, victimAfter),
        `HTTP ${r.status} updated=${r.json?.data?.updated} · 내 스레드 미읽음 ${ownBefore.unread_count}→${ownAfter.unread_count}` +
        ` · 피해자 ${before.msgUnread}→${victimAfter.msgUnread}`);
    } finally {
      // 데이터 원복 — 카나리가 남긴 상태가 다음 검사를 죽인다
      if (ownMsgs.length) {
        await q(`UPDATE email_messages SET is_read = 0 WHERE id IN (${ownMsgs.map(() => '?').join(',')})`, ownMsgs);
      }
      await q('UPDATE email_threads SET unread_count = ?, status = ?, reply_needed = ? WHERE id = ?',
        [ownBefore.unread_count, ownBefore.status, ownBefore.reply_needed, own.id]);
    }
  }

  // ── ④ 시작=끝 체크섬. 위 검사들이 각자 스냅샷을 봤어도, 전체가 제자리인지 한 번 더 본다.
  const end = await snapshot(victimIds);
  push('피해자 전체 체크섬 — 시작 = 끝', same(before, end),
    `미읽음 ${before.msgUnread} → ${end.msgUnread} · 스레드 ${before.threads.length}행`);

  return results;
}

module.exports = { run, name: 'canary-tenant-write' };
