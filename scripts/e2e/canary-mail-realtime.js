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
    rec.details.push('ERROR: ' + String(e.message).slice(0, 140));
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

module.exports = { run, name: 'mail-realtime' };

if (require.main === module) {
  run().then((res) => {
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
