// scripts/e2e/canary-mail-realtime.js — 실시간 반영 카나리 (CLAUDE.md §16 "2 브라우저 탭" 시나리오)
//
// 왜 필요한가 (#205):
//   Q Mail 목록의 silent 병합이 "서버가 더 이상 주지 않는 행은 남긴다" 였다. 그래서 A 탭에서
//   "확인 완료" 로 내린 메일이 B 탭(다른 기기 — Irene 은 데스크탑앱 + 모바일 PWA 동시 사용)에서는
//   영영 사라지지 않고, 새 행이 얹히며 목록이 30 → 31 로 계속 불어났다.
//   기존 하니스는 이걸 못 잡았다 — 한 탭만 보면 조작한 쪽에서는 정상으로 보이기 때문이다.
//
// 불변식: 한 곳에서 목록에서 내린 항목은, 열려 있는 다른 화면에서도 스스로 사라져야 한다
//   (새로고침 없이). 사라지지 않거나 목록 길이가 늘어나면 실패.
//
// 데이터 안전: 대상 스레드의 상태를 DB 로 스냅샷한 뒤, 끝나면 finally 로 반드시 되돌린다.
const b = require('./lib/browser');
const puppeteer = require('/opt/planq/dev-backend/node_modules/puppeteer');
const { execFileSync } = require('child_process');

// DB 접근은 dev-backend 를 cwd 로 한 자식 프로세스로 — .env(dotenvx) 가 그 디렉터리 기준이라
//   여기서 직접 config/database 를 require 하면 DB 변수 없이 죽는다.
function dbJson(script) {
  const out = execFileSync('node', ['-e', script], {
    cwd: '/opt/planq/dev-backend', encoding: 'utf-8', timeout: 30000,
  });
  const line = out.trim().split('\n').filter((l) => l.startsWith('__JSON__')).pop();
  return line ? JSON.parse(line.slice(8)) : null;
}

const rowIds = () => [...document.querySelectorAll('[data-testid="mail-thread-row"]')]
  .map((el) => Number(el.getAttribute('data-thread-id')));

const clickHandled = () => {
  const row = document.querySelector('[data-testid="mail-thread-row"]');
  const btn = row && row.querySelector('[data-testid="mail-row-handled"]');
  if (!btn) return null;
  const id = Number(row.getAttribute('data-thread-id'));
  btn.click();
  return id;
};

function snapshot(threadId) {
  return dbJson(`
    const { sequelize } = require('./config/database');
    (async () => {
      const [[t]] = await sequelize.query('SELECT status, reply_needed, reply_needed_reason, uncertain_reason, unread_count FROM email_threads WHERE id=${threadId}');
      const [m] = await sequelize.query('SELECT id FROM email_messages WHERE thread_id=${threadId} AND is_read=0');
      console.log('__JSON__' + JSON.stringify({ t, unreadMsgIds: m.map(x => x.id) }));
      process.exit(0);
    })();
  `);
}

function restore(threadId, snap) {
  const t = snap.t;
  const q = (v) => (v === null || v === undefined ? 'NULL' : `"${String(v).replace(/"/g, '')}"`);
  const msgSql = snap.unreadMsgIds.length
    ? `await sequelize.query('UPDATE email_messages SET is_read=0 WHERE id IN (${snap.unreadMsgIds.join(',')})');`
    : '';
  return dbJson(`
    const { sequelize } = require('./config/database');
    (async () => {
      await sequelize.query('UPDATE email_threads SET status=${q(t.status)}, reply_needed=${t.reply_needed ? 1 : 0}, reply_needed_reason=${q(t.reply_needed_reason)}, uncertain_reason=${q(t.uncertain_reason)}, unread_count=${Number(t.unread_count) || 0} WHERE id=${threadId}');
      ${msgSql}
      const [[v]] = await sequelize.query('SELECT status, unread_count FROM email_threads WHERE id=${threadId}');
      console.log('__JSON__' + JSON.stringify(v));
      process.exit(0);
    })();
  `);
}

async function run() {
  const rec = { name: 'mail-realtime-remove', path: '/mail?folder=uncertain', inputs: 0, pass: 0, fail: 0, details: [] };
  let browser = null;
  let target = null;
  let snap = null;
  try {
    browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const A = await browser.newPage(); await A.setViewport({ width: 1440, height: 900 });
    const B = await browser.newPage(); await B.setViewport({ width: 1440, height: 900 });
    for (const p of [A, B]) { p.setDefaultTimeout(30000); await b.login(p); await b.goto(p, '/mail?folder=uncertain'); }
    await b.sleep(3000);

    const idsB0 = await B.evaluate(rowIds);
    if (!idsB0.length) { rec.details.push('확인권장 행 0건 — 판정 스킵(데이터 없음)'); return [rec]; }

    // 스냅샷은 클릭 **전에** 떠야 원래 상태를 담는다.
    const preId = await A.evaluate(() => {
      const row = document.querySelector('[data-testid="mail-thread-row"]');
      return row ? Number(row.getAttribute('data-thread-id')) : null;
    });
    if (!preId) { rec.details.push('확인권장 행 없음 — 판정 스킵'); return [rec]; }
    snap = snapshot(preId);
    target = await A.evaluate(clickHandled);
    if (!target) { rec.details.push('확인완료 버튼 못 찾음 — 판정 스킵'); snap = null; return [rec]; }
    if (target !== preId) { snap = snapshot(target); }
    if (!idsB0.includes(target)) { rec.details.push(`대상 ${target} 이 B 목록에 없음 — 판정 스킵`); return [rec]; }

    // 실시간 반영은 socket + 250ms debounce. 넉넉히 5초까지 본다.
    let goneAt = null;
    let lenB = idsB0.length;
    for (let i = 1; i <= 10; i++) {
      await b.sleep(500);
      const ids = await B.evaluate(rowIds);
      lenB = ids.length;
      if (!ids.includes(target)) { goneAt = i * 0.5; break; }
    }
    if (goneAt === null) {
      rec.fail++;
      rec.details.push(`🔴 A 에서 내린 메일 ${target} 이 B 화면에서 5초 안에 사라지지 않음 (B 행수 ${idsB0.length}→${lenB})`);
    } else {
      rec.pass++;
      rec.details.push(`B 화면에서 ${goneAt}s 만에 사라짐 (행수 ${idsB0.length}→${lenB})`);
      if (lenB > idsB0.length) {
        rec.fail++;
        rec.details.push(`🔴 목록이 늘어남 ${idsB0.length}→${lenB} — stale 행이 쌓이고 있다`);
      }
    }
  } catch (e) {
    // fail-closed — 하니스가 깨져도 조용히 통과하면 가드가 없는 것보다 나쁘다
    rec.fail++;
    rec.details.push('🔴 ERROR: ' + String(e.message).slice(0, 140));
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (target && snap) {
      try {
        const v = restore(target, snap);
        rec.details.push(`테스트 데이터 원복 완료 (thread ${target} → ${v && v.status}/${v && v.unread_count})`);
      } catch (e) { rec.fail++; rec.details.push('🔴 원복 실패: ' + e.message); }
    }
  }
  return [rec];
}

// ── #200 — 순서·스크롤 불변식 ────────────────────────────────────────────────
//   ① 재정렬: 기존 스레드에 새 메일이 오면(last_message_at 갱신) 목록 최상단으로 올라와야 한다.
//      옛 병합(prev 순서 유지 + 새 id 만 prepend)은 자리를 그대로 둬서 F5 전엔 안 올라왔다.
//   ② 스크롤 앵커: 그렇게 순서가 바뀌어도, 보고 있던 행은 화면의 같은 자리에 있어야 한다.
//      (순서를 왜곡해 스크롤을 지키던 옛 방식으로 되돌아가지 못하게 두 불변식을 같이 건다.)
function bumpTime(threadId) {
  return dbJson(`
    const { sequelize } = require('./config/database');
    (async () => {
      const [[t]] = await sequelize.query('SELECT last_message_at FROM email_threads WHERE id=${threadId}');
      await sequelize.query('UPDATE email_threads SET last_message_at=NOW() WHERE id=${threadId}');
      console.log('__JSON__' + JSON.stringify({ prev: t.last_message_at }));
      process.exit(0);
    })();
  `);
}

function restoreTime(threadId, prev) {
  const v = prev instanceof Date ? prev.toISOString().slice(0, 19).replace('T', ' ') : String(prev).slice(0, 19).replace('T', ' ');
  return dbJson(`
    const { sequelize } = require('./config/database');
    (async () => {
      await sequelize.query("UPDATE email_threads SET last_message_at='${v}' WHERE id=${threadId}");
      const [[t]] = await sequelize.query('SELECT last_message_at FROM email_threads WHERE id=${threadId}');
      console.log('__JSON__' + JSON.stringify(t));
      process.exit(0);
    })();
  `);
}

async function runOrder() {
  const rec = { name: 'mail-realtime-reorder', path: '/mail?folder=all', inputs: 0, pass: 0, fail: 0, details: [] };
  let browser = null; let target = null; let prevTime = null;
  try {
    browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const B = await browser.newPage(); await B.setViewport({ width: 1440, height: 900 });
    B.setDefaultTimeout(30000);
    await b.login(B); await b.goto(B, '/mail?folder=all');
    await b.sleep(3000);

    const ids0 = await B.evaluate(rowIds);
    if (ids0.length < 6) { rec.details.push(`행 ${ids0.length}건 — 판정 스킵(데이터 부족)`); return [rec]; }

    // ① 재정렬 — 중간 행에 새 메일이 온 상황
    target = ids0[4];
    prevTime = bumpTime(target).prev;
    await B.evaluate(() => window.dispatchEvent(new Event('mail:refresh')));
    let topOk = false; let ids1 = ids0;
    for (let i = 0; i < 10; i++) {
      await b.sleep(400);
      ids1 = await B.evaluate(rowIds);
      if (ids1[0] === target) { topOk = true; break; }
    }
    if (topOk) { rec.pass++; rec.details.push(`갱신된 스레드 ${target} 이 최상단으로 이동 (옛 위치 index 4)`); }
    else { rec.fail++; rec.details.push(`🔴 갱신된 스레드 ${target} 이 최상단으로 안 올라옴 — 서버 순서를 버리는 병합 회귀 (현재 top=${ids1[0]})`); }

    // ② 스크롤 앵커 — 목록 중간을 보고 있을 때 순서가 바뀌어도 보던 행이 제자리
    await B.evaluate(() => {
      const el = document.querySelector('[data-testid="mail-thread-row"]')?.parentElement;
      if (el) el.scrollTop = 600;
    });
    await b.sleep(400);
    const before = await B.evaluate(() => {
      const rows = [...document.querySelectorAll('[data-testid="mail-thread-row"]')];
      const el = rows[0]?.parentElement;
      if (!el) return null;
      const elTop = el.getBoundingClientRect().top;
      const hit = rows.find((r) => r.getBoundingClientRect().bottom > elTop + 1);
      return hit ? { id: Number(hit.getAttribute('data-thread-id')), top: hit.getBoundingClientRect().top - elTop, scrollTop: el.scrollTop } : null;
    });
    if (!before || before.scrollTop < 100) {
      rec.details.push('목록이 짧아 스크롤 판정 스킵');
    } else {
      // ★ 앵커보다 **아래**에 있던 스레드를 갱신 → 최상단으로 올라오며 앵커 위 콘텐츠가 한 행 늘어난다.
      //   앵커 보정이 없으면 보던 행이 정확히 한 행 높이만큼 아래로 밀린다(= 화면이 튄다).
      const anchorIdx = ids1.indexOf(before.id);
      const other = ids1.slice(anchorIdx + 1).find((id) => id !== target) || ids1.find((id) => id !== before.id && id !== target);
      const otherPrev = bumpTime(other).prev;
      await B.evaluate(() => window.dispatchEvent(new Event('mail:refresh')));
      await b.sleep(2500);
      const after = await B.evaluate((anchorId) => {
        const rows = [...document.querySelectorAll('[data-testid="mail-thread-row"]')];
        const el = rows[0]?.parentElement;
        if (!el) return null;
        const elTop = el.getBoundingClientRect().top;
        const row = rows.find((r) => Number(r.getAttribute('data-thread-id')) === anchorId);
        return row ? { top: row.getBoundingClientRect().top - elTop, scrollTop: el.scrollTop } : null;
      }, before.id);
      restoreTime(other, otherPrev);
      if (!after) { rec.details.push(`앵커 행 ${before.id} 이 목록에서 사라짐 — 스크롤 판정 스킵`); }
      else {
        const drift = Math.abs(after.top - before.top);
        if (drift <= 80) { rec.pass++; rec.details.push(`스크롤 앵커 유지 — 보던 행 ${before.id} 위치 ${Math.round(before.top)}px → ${Math.round(after.top)}px (drift ${Math.round(drift)}px)`); }
        else { rec.fail++; rec.details.push(`🔴 화면이 튐 — 보던 행 ${before.id} 이 ${Math.round(before.top)}px → ${Math.round(after.top)}px (drift ${Math.round(drift)}px)`); }
      }
    }
  } catch (e) {
    // fail-closed — 하니스가 깨져도 조용히 통과하면 가드가 없는 것보다 나쁘다
    rec.fail++;
    rec.details.push('🔴 ERROR: ' + String(e.message).slice(0, 140));
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (target && prevTime) {
      try { const v = restoreTime(target, prevTime); rec.details.push(`원복 완료 (thread ${target} last_message_at → ${v && v.last_message_at})`); }
      catch (e) { rec.fail++; rec.details.push('🔴 원복 실패: ' + e.message); }
    }
  }
  return [rec];
}

async function runAll() {
  const a = await run();
  const c = await runOrder();
  return [...a, ...c];
}

module.exports = { run: runAll, name: 'mail-realtime' };

if (require.main === module) {
  runAll().then((res) => {
    let fail = 0;
    console.log('\n=== 메일 실시간 반영 카나리 ===');
    for (const r of res) {
      console.log(`${r.fail > 0 ? '❌' : (r.pass > 0 ? '✅' : '⚪')} ${r.name} (${r.path})`);
      r.details.forEach((d) => console.log('     └ ' + d));
      fail += r.fail;
    }
    console.log(`\n총 실패: ${fail}`);
    process.exit(fail > 0 ? 1 : 0);
  }).catch((e) => { console.error('FATAL', e.message); process.exit(2); });
}
