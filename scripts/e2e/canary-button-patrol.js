// canary-button-patrol — «모든 버튼 눌러보기» 순찰 (2026-10-05)
//
//   왜: 운영 크래시는 대개 **누군가 어떤 버튼을 누른 순간** 난다(2026-10-05 Q Talk [더보기] —
//   첫 클릭에 화면 전체가 죽었는데 기능별 카나리는 그 버튼을 한 번도 누르지 않았다).
//   화면을 «여는» 크롤은 있었지만 «누르는» 순찰은 없었다.
//
// 무엇을: 워크스페이스 화면 × 환경(폰·태블릿·PC 웹 + 폰 앱·아이패드 앱 흉내)마다 보이는 버튼을 하나씩 누르고
//   ① pageerror ② 오류 화면(ErrorBoundary) ③ 빈 화면 ④ 가로 넘침 ⑤ 앱에서 우리 주소가 앱 밖(사파리)으로 나감
//   ⑥ 눌러지지 않는 버튼(다른 요소가 덮음 — 경고) 을 센다.
//
// 안전: **쓰기 요청은 전부 막는다** — /api/ 의 POST·PUT·PATCH·DELETE 는 서버에 가지 않고 409 로 돌아온다
//   (로그인·토큰 갱신·크래시 보고만 통과). 그래서 순찰이 데이터를 바꾸거나 메일·푸시를 보낼 수 없다.
//   거기에 더해 위험한 이름의 버튼(삭제·발송·결제·로그아웃·토글 …)은 누르지 않는다(두 겹).
//
// 앱 흉내: window.webkit 브리지 + Capacitor nativePromise 스텁(아이패드 앱은 Mac UA) — 2026-10-04 ipadapp 방식.
//
// 결과: run.js 계약(results 배열) + 사람이 읽는 보고서 /opt/planq/logs/patrol/patrol-YYYY-MM-DD.log
//   ENV: PATROL_ENVS=phone-web,desktop-web (일부만) · PATROL_ROUTES=/tasks,/talk · PATROL_MAX=15(화면당 버튼 수)
const fs = require('fs');
const path = require('path');
const puppeteer = require('/opt/planq/dev-backend/node_modules/puppeteer');
const b = require('./lib/browser');

const ROUTES_ALL = [
  '/dashboard', '/inbox', '/tasks', '/talk', '/mail', '/calendar', '/notes', '/docs', '/files', '/info',
  '/projects', '/sale', '/bills', '/attendance', '/signatures/received', '/notifications', '/whats-new',
  '/business/clients', '/business/members', '/business/org', '/business/settings', '/business/settings/notifications',
  '/settings', '/profile', '/profile/integrations', '/personal-vault', '/me/feedback', '/me/work-settings',
];
// ★ 상세 화면 (2026-10-07) — 목록만 돌면 기능의 대부분이 있는 **상세(업무·문서·메일·프로젝트 탭)** 를 한 번도 안 연다.
//   운영 신고는 대개 상세 안의 버튼이다. 대상 id 는 실행할 때 DB 에서 고른다(검사 계정 워크스페이스의 최신 실제 자료 —
//   카나리 이름은 뺀다). 못 고른 상세는 «미측정» 으로 보고한다(조용히 빼지 않는다).
const PROJECT_TABS = ['dashboard', 'tasks', 'calendar', 'docs', 'notes', 'files', 'info', 'report', 'history', 'transactions', 'clients', 'details', 'settings'];
async function resolveDetailRoutes(bizId) {
  const { sequelize } = require('/opt/planq/dev-backend/config/database');
  const one = async (sql) => { try { const [r] = await sequelize.query(sql, { replacements: [bizId], type: 'SELECT' }); return r || null; } catch { return null; } };
  const NOTC = (col) => `${col} NOT LIKE '%카나리%' AND ${col} NOT LIKE '%canary%' AND ${col} NOT LIKE '%Canary%'`;
  const out = []; const missing = [];
  const add = (label, row, fn) => { if (row && row.id) out.push(fn(row.id)); else missing.push(label); };
  add('업무', await one(`SELECT id FROM tasks WHERE business_id=? AND ${NOTC('title')} AND status NOT IN ('completed','canceled') ORDER BY updated_at DESC LIMIT 1`), (id) => `/tasks?task=${id}`);
  add('문서', await one(`SELECT id FROM posts WHERE business_id=? AND deleted_at IS NULL AND ${NOTC('title')} ORDER BY updated_at DESC LIMIT 1`), (id) => `/docs?post=${id}`);
  add('메일', await one(`SELECT id FROM email_threads WHERE business_id=? AND status <> 'spam' ORDER BY last_message_at DESC LIMIT 1`), (id) => `/mail?folder=all&thread=${id}`);
  add('Q info', await one(`SELECT id FROM kb_documents WHERE business_id=? AND deleted_at IS NULL AND ${NOTC('title')} ORDER BY updated_at DESC LIMIT 1`), (id) => `/info?doc=${id}`);
  add('대화방', await one(`SELECT c.id FROM conversations c WHERE c.business_id=? AND c.status='active' AND EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id=c.id) ORDER BY c.last_message_at DESC LIMIT 1`), (id) => `/talk/${id}`);
  add('고객(Q sale)', await one(`SELECT id FROM clients WHERE business_id=? AND status <> 'archived' AND ${NOTC('display_name')} ORDER BY updated_at DESC LIMIT 1`), (id) => `/sale/${id}`);
  add('표', await one(`SELECT id FROM q_records WHERE business_id=? AND ${NOTC('name')} ORDER BY updated_at DESC LIMIT 1`), (id) => `/records/${id}`);
  add('일정', await one(`SELECT id FROM calendar_events WHERE business_id=? AND ${NOTC('title')} ORDER BY start_at DESC LIMIT 1`), (id) => `/calendar?event=${id}`);
  add('청구서', await one(`SELECT id FROM invoices WHERE business_id=? ORDER BY updated_at DESC LIMIT 1`), (id) => `/bills?tab=invoices&invoice=${id}`);
  add('파일', await one(`SELECT id FROM files WHERE business_id=? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1`), (id) => `/files?file=${id}`);
  const proj = await one(`SELECT p.id FROM projects p WHERE p.business_id=? AND p.status='active' AND ${NOTC('p.name')} ORDER BY (SELECT COUNT(*) FROM tasks t WHERE t.project_id=p.id) DESC LIMIT 1`);
  if (proj) PROJECT_TABS.forEach((tab) => out.push(`/projects/p/${proj.id}?tab=${tab}`)); else missing.push('프로젝트');
  return { routes: out, missing };
}

// ★ 고객 역할 (2026-10-07) — 순찰이 owner 로만 돌아 고객 화면은 아무도 안 눌러 봤다(2026-10-06 고객 채팅 목록 실종 신고).
//   실행마다 임시 고객 계정 + 그 고객에 연결된 프로젝트·고객 채팅방·업무를 만들고 끝에서 지운다.
const CLIENT_ROUTES = ['/home', '/talk', '/projects', '/tasks', '/notifications', '/profile'];
async function makeClientFixture(bizId, ownerId) {
  const { sequelize } = require('/opt/planq/dev-backend/config/database');
  const q = (sql, rep) => sequelize.query(sql, { replacements: rep });
  const bcrypt = require('/opt/planq/dev-backend/node_modules/bcryptjs');
  const ts = Date.now();
  const cred = { email: `patrol-client-${ts}@example.com`, password: `PatrolC${ts}!x` };
  const ids = {};
  const [ps] = await sequelize.query('SELECT terms_version, privacy_version FROM platform_settings LIMIT 1', { type: 'SELECT' });
  const [uid] = await q(`INSERT INTO users (email, password_hash, name, username, platform_role, email_verified_at, active_business_id,
      terms_accepted_at, terms_version, privacy_accepted_at, privacy_version, created_at, updated_at)
      VALUES (?, ?, '순찰 고객', ?, 'user', NOW(), ?, NOW(), ?, NOW(), ?, NOW(), NOW())`,
    [cred.email, await bcrypt.hash(cred.password, 10), `patrolc${ts}`, bizId, ps?.terms_version || '1.0', ps?.privacy_version || '1.0']);
  ids.user = uid;
  const [cid] = await q(`INSERT INTO clients (business_id, user_id, display_name, invite_email, invited_by, status, created_at, updated_at)
      VALUES (?, ?, '순찰 고객', ?, ?, 'active', NOW(), NOW())`, [bizId, uid, cred.email, ownerId]);
  ids.client = cid;
  const [pid] = await q(`INSERT INTO projects (business_id, name, status, owner_user_id, created_at, updated_at) VALUES (?, '순찰 고객 프로젝트', 'active', ?, NOW(), NOW())`, [bizId, ownerId]);
  ids.project = pid;
  await q('INSERT INTO project_members (project_id, user_id, is_pm, created_at, updated_at) VALUES (?, ?, 1, NOW(), NOW())', [pid, ownerId]).catch(() => null);
  await q('INSERT INTO project_clients (project_id, client_id, contact_user_id) VALUES (?, ?, ?)', [pid, cid, uid]);
  const [conv] = await q(`INSERT INTO conversations (business_id, project_id, client_id, title, channel_type, status, last_message_at, created_at, updated_at)
      VALUES (?, ?, ?, '순찰 고객 채널', 'customer', 'active', NOW(), NOW(), NOW())`, [bizId, pid, cid]);
  ids.conv = conv;
  await q("INSERT INTO conversation_participants (conversation_id, user_id, role, joined_at, created_at) VALUES (?, ?, 'owner', NOW(), NOW()), (?, ?, 'client', NOW(), NOW())", [conv, ownerId, conv, uid]);
  await q("INSERT INTO messages (conversation_id, sender_id, content, created_at, updated_at) VALUES (?, ?, '순찰 고객 채널 첫 메시지', NOW(), NOW())", [conv, ownerId]).catch(() => null);
  const [tid] = await q(`INSERT INTO tasks (business_id, project_id, title, status, created_by, assignee_id, created_at, updated_at)
      VALUES (?, ?, '순찰 고객 요청 업무', 'not_started', ?, ?, NOW(), NOW())`, [bizId, pid, uid, ownerId]).catch(() => [null]);
  ids.task = tid;
  const routes = [...CLIENT_ROUTES, `/talk/${conv}`, `/projects/p/${pid}`];
  if (tid) routes.push(`/tasks?task=${tid}`);
  return { cred, ids, routes };
}
async function dropClientFixture(ids) {
  const { sequelize } = require('/opt/planq/dev-backend/config/database');
  const q = (sql, rep) => sequelize.query(sql, { replacements: rep }).catch(() => null);
  if (ids.task) { await q('DELETE FROM task_status_history WHERE task_id = ?', [ids.task]); await q('DELETE FROM tasks WHERE id = ?', [ids.task]); }
  if (ids.conv) { await q('DELETE FROM messages WHERE conversation_id = ?', [ids.conv]); await q('DELETE FROM conversation_participants WHERE conversation_id = ?', [ids.conv]); await q('DELETE FROM conversations WHERE id = ?', [ids.conv]); }
  if (ids.project) {
    const rows = await sequelize.query('SELECT id FROM conversations WHERE project_id = ?', { replacements: [ids.project], type: 'SELECT' }).catch(() => []);
    for (const r of rows || []) { await q('DELETE FROM messages WHERE conversation_id = ?', [r.id]); await q('DELETE FROM conversation_participants WHERE conversation_id = ?', [r.id]); await q('DELETE FROM conversations WHERE id = ?', [r.id]); }
    await q('DELETE FROM project_clients WHERE project_id = ?', [ids.project]); await q('DELETE FROM project_members WHERE project_id = ?', [ids.project]);
    await q('DELETE FROM projects WHERE id = ?', [ids.project]);
  }
  if (ids.client) await q('DELETE FROM clients WHERE id = ?', [ids.client]);
  if (ids.user) {
    await q('DELETE FROM notifications WHERE user_id = ?', [ids.user]); await q('DELETE FROM refresh_tokens WHERE user_id = ?', [ids.user]);
    await q('DELETE FROM users WHERE id = ?', [ids.user]);
  }
  const [left] = await sequelize.query('SELECT COUNT(*) n FROM users WHERE id = ?', { replacements: [ids.user || 0], type: 'SELECT' }).catch(() => [{ n: -1 }]);
  return Number(left?.n) === 0;
}

const IPAD_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)';
const PHONE_APP_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
const ENVS_ALL = [
  { n: 'phone-web', vp: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' },
  { n: 'tablet-web', vp: { width: 820, height: 1180, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
  { n: 'desktop-web', vp: { width: 1440, height: 900 } },
  { n: 'phone-app', vp: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, ua: PHONE_APP_UA, native: true },
  { n: 'ipad-app', vp: { width: 1180, height: 820, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, ua: IPAD_UA, native: true },
  // 고객 역할 — 폰·PC 두 폭이면 충분하다(고객 화면 수가 적다)
  { n: 'phone-client', vp: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, client: true },
  { n: 'desktop-client', vp: { width: 1440, height: 900 }, client: true },
];

// 누르지 않는 버튼 — 이름(글자·aria-label·title)으로 거른다. 쓰기는 이미 막혀 있지만 두 겹으로.
const DANGER = /삭제|제거|지우기|휴지통|비우기|탈퇴|해지|해제|로그아웃|발송|보내기|전송|재발송|초대|결제|구매|업그레이드|환불|승인|반려|완료 처리|최종 완료|확인완료|모두 읽음|모두 확인|일괄|녹음|마이크|카메라|화면 공유|다운로드|내려받기|인쇄|delete|remove|trash|empty|logout|log out|sign out|send|invite|pay|purchase|upgrade|refund|approve|reject|archive|download|print|record/i;

const BASE_HOST = new URL(b.BASE).host;
const today = () => new Date().toISOString().slice(0, 10);

async function setupPage(ctx, env) {
  const page = await ctx.newPage();
  page.setDefaultTimeout(20000);
  if (env.ua) await page.setUserAgent(env.ua);
  await page.setViewport(env.vp);
  if (env.native) {
    await page.evaluateOnNewDocument(() => {
      window.__nativeCalls = [];
      const rec = (pl, me, op) => { try { window.__nativeCalls.push({ p: pl, m: me, url: op && op.url }); } catch {} return Promise.resolve({}); };
      window.Capacitor = { nativePromise: rec, nativeCallback: (pl, me, op) => { rec(pl, me, op); return String(Math.random()); }, PluginHeaders: [{ name: 'Browser', methods: [{ name: 'open', rtype: 'promise' }, { name: 'close', rtype: 'promise' }, { name: 'addListener', rtype: 'callback' }, { name: 'removeAllListeners', rtype: 'promise' }] }] };
      window.webkit = { messageHandlers: { bridge: { postMessage(m) {
        try { window.__nativeCalls.push({ p: m.pluginId, m: m.methodName, url: m.options && m.options.url }); } catch {}
        setTimeout(() => { try { window.Capacitor.fromNative({ callbackId: m.callbackId, pluginId: m.pluginId, methodName: m.methodName, success: true, data: {} }); } catch {} }, 0);
      } } } };
    });
  }
  // ★ 쓰기 차단 — 순찰은 아무것도 바꾸지 않는다.
  await page.setRequestInterception(true);
  page.__blocked = 0;
  page.__reqs = 0;
  page.on('request', (r) => {
    if (/\/api\//.test(r.url())) page.__reqs += 1;
    const u = r.url();
    const m = r.method();
    if (m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS' && /\/api\//.test(u)
      && !/\/api\/auth\/(login|refresh|logout-all-check)|\/api\/client-errors/.test(u)) {
      page.__blocked += 1;
      return r.respond({ status: 409, contentType: 'application/json', body: JSON.stringify({ success: false, message: 'patrol_write_blocked' }) }).catch(() => null);
    }
    // 앱 흉내에서 외부(구글 등) 리소스는 그대로 둔다
    r.continue().catch(() => null);
  });
  return page;
}

// 화면 상태 — 오류 화면·빈 화면·가로 넘침
const SCREEN_STATE = () => {
  const boundary = [...document.querySelectorAll('[role="alert"]')].some((a) => a.querySelectorAll('button').length >= 2 && /다시 시도|Try again|Retry/.test(a.innerText));
  const main = document.querySelector('main') || document.body;
  const text = (main.innerText || '').replace(/\s+/g, '').length;
  const overflow = document.documentElement.scrollWidth - window.innerWidth;
  return { boundary, text, overflow };
};

// 화면을 크게 덮는 고정 요소 수 — 누른 뒤 늘었고 Esc 로도 안 줄면 (폰 메뉴 덮개 등) 화면을 다시 연다
const OVERLAY_SIG = () => [...document.querySelectorAll('body *')].filter((e) => {
  const cs = getComputedStyle(e);
  if (cs.position !== 'fixed' || cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
  const r = e.getBoundingClientRect();
  return r.width * r.height >= innerWidth * innerHeight * 0.4;
}).length;

// 누를 후보에 번호를 매긴다 — 보이고(불투명도 사슬·크기) 위험하지 않은 버튼. 내비게이션·탭바는 뺀다(화면 이동은 경로 순회가 맡는다).
const MARK = (maxN, dangerSrc, doneNames = [], scope = 'content') => {
  const danger = new RegExp(dangerSrc, 'i');
  const done = new Set(doneNames);
  // 범위 — 'content': 화면 본문(data-pq-content, 보이는 탭 것만) · 'chrome': 그 밖(머리줄·탭바 — 환경마다 한 번)
  const roots = [...document.querySelectorAll('[data-pq-content]')].filter((r) => !r.closest('[aria-hidden="true"]'));
  const inContent = (el) => roots.some((r) => r.contains(el));
  document.querySelectorAll('[data-patrol-idx]').forEach((e) => e.removeAttribute('data-patrol-idx'));
  const vis = (el) => {
    for (let e = el; e && e !== document.body; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.opacity === '0' || cs.visibility === 'hidden' || cs.display === 'none') return false;
    }
    const r = el.getBoundingClientRect();
    return r.width >= 4 && r.height >= 4;
  };
  const nameOf = (el) => ((el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('title') || '') + ' ' + (el.innerText || '')).replace(/\s+/g, ' ').trim().slice(0, 60);
  // ★ 상세가 열린 채 시작하는 화면(/tasks?task=…)에서는 **위에 뜬 창 안의 버튼만** 누른다 — 창 뒤 목록 버튼은
  //   사용자도 못 누른다(창이 덮고 있다). 안 그러면 «덮임» 경고가 쏟아져 진짜 경고가 묻힌다(2026-10-07 고객 순찰).
  const openOv = [...document.querySelectorAll('[aria-modal="true"], [data-pq-drawer-panel]')]
    .filter((e) => !e.closest('[aria-hidden="true"]') && e.getBoundingClientRect().width > 40 && getComputedStyle(e).visibility !== 'hidden');
  const topOv = openOv.length ? openOv[openOv.length - 1] : null;
  if (topOv && scope === 'chrome') return [];
  const all = [...(topOv || document).querySelectorAll('button, [role="button"], [role="tab"], [role="menuitem"]')];
  const out = [];
  const seen = new Set();
  for (const el of all) {
    if (out.length >= maxN) break;
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
    if (!topOv && (scope === 'content' ? !inContent(el) : (inContent(el) || el.closest('[aria-hidden="true"]')))) continue;
    if (el.closest('nav, aside[data-sidebar], [data-testid^="nav-"], [data-testid="tab-bar"], [data-tabbar], [role="tablist"][data-chrome]')) continue;
    if (el.getAttribute('role') === 'switch' || el.closest('[role="switch"]')) continue;
    // 대상이 지워졌다고 화면이 이미 말한 알림 — 눌러도 이동하지 않는 것이 정답이다
    if (el.closest('[data-target-missing]')) continue;
    // ★ type 이 없는 <button> 은 기본이 submit 이다 — type 만 보면 앱 버튼 거의 전부가 빠진다(양성 대조군이 잡았다).
    //   실제로 폼을 제출하는 것만 뺀다.
    if (el.type === 'submit' && el.form) continue;
    if (!vis(el)) continue;
    const name = nameOf(el);
    if (!name || danger.test(name)) continue;
    const key = name + '|' + el.tagName;
    if (seen.has(key)) continue;   // 같은 이름 버튼(행마다 반복)은 하나만
    if (done.has(name)) continue;  // 앞 화면에서 이미 누른 것(머리줄·공용 크롬) — 화면마다 다시 누르지 않는다
    seen.add(key);
    el.setAttribute('data-patrol-idx', String(out.length));
    out.push(name);
  }
  return out;
};

// ★ 연 상태 판정 (2026-10-07) — 운영 신고 30일치(#433·#435·#436·#437·#441·#443·#446·#448·#451)는 거의 전부
//   «화면» 이 아니라 **버튼을 눌러 연 창**(우측 패널·모달·답장 작성)의 모양이었다. 순찰은 그 창을 열기만 하고
//   오류·빈 화면만 봤다. 이제 연 창마다 잰다:
//   ① 창이 화면 밖으로 나감 ② 창의 위·아래 끝이 다른 것(앱 머리줄 등)에 가려짐 ③ 창 안 내용이 오른쪽으로 잘림
//   ④ 폰에서 우측 패널이 전면을 덮지 않음(위 여백·아래 여백 — CLAUDE.md «폰 상세 패널은 앱 헤더를 덮는 전면»)
const OPENED_SIG = () => {
  const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 40 && r.height > 40 && cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0'; };
  return [...document.querySelectorAll('[aria-modal="true"], [data-pq-drawer-panel]')].filter((e) => !e.closest('[aria-hidden="true"]') && vis(e)).length;
};
const OPENED_JUDGE = () => {
  const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 40 && r.height > 40 && cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0'; };
  const all = [...document.querySelectorAll('[data-pq-drawer-panel], [aria-modal="true"]')].filter((e) => !e.closest('[aria-hidden="true"]') && vis(e));
  if (!all.length) return null;
  // 맨 위 창 = 문서 순서상 마지막(포털은 body 끝에 붙는다). 백드롭처럼 화면 전체를 덮는 투명 껍데기는 그 안의 패널로 내려간다.
  let ov = all[all.length - 1];
  const inner = ov.querySelector('[data-pq-drawer-panel]');
  if (inner && vis(inner)) ov = inner;
  const r = ov.getBoundingClientRect();
  const W = innerWidth, H = innerHeight;
  const out = [];
  const name = (ov.getAttribute('aria-label') || ov.getAttribute('data-testid') || ov.tagName).slice(0, 40);
  if (r.left < -2 || r.top < -2 || r.right > W + 2 || r.bottom > H + 2) out.push(`창이 화면 밖으로 나감 (${Math.round(r.left)},${Math.round(r.top)})-(${Math.round(r.right)},${Math.round(r.bottom)}) / 화면 ${W}×${H}`);
  const own = (h) => !!h && (ov.contains(h) || h.closest('[data-pq-portal], [role="menu"], [role="listbox"], [role="tooltip"]'));
  const cx = Math.min(W - 2, Math.max(2, r.left + r.width / 2));
  const yTop = Math.max(1, r.top + 6), yBot = Math.min(H - 2, r.bottom - 6);
  const hTop = document.elementFromPoint(cx, yTop), hBot = document.elementFromPoint(cx, yBot);
  const tag = (h) => h ? (h.getAttribute('data-testid') || h.getAttribute('aria-label') || h.tagName + '.' + String(h.className || '').split(' ')[0]).slice(0, 50) : 'null';
  if (r.height > 80 && !own(hTop)) out.push(`창 윗부분이 다른 것에 가려짐 — ${tag(hTop)}`);
  if (r.height > 80 && !own(hBot)) out.push(`창 아랫부분이 다른 것에 가려짐 — ${tag(hBot)}`);
  // ③ 오른쪽으로 잘린 내용 — 가로 스크롤 상자 안은 의도된 것이라 뺀다
  const scrollsX = (e) => { for (let x = e.parentElement; x && x !== ov.parentElement; x = x.parentElement) { const o = getComputedStyle(x).overflowX; if (o === 'auto' || o === 'scroll') return true; } return false; };
  const cut = [];
  for (const e of ov.querySelectorAll('button, a, input, textarea, select, [contenteditable="true"], h1, h2, h3, label, p, span')) {
    const er = e.getBoundingClientRect();
    if (er.width < 4 || er.height < 4) continue;
    if (er.left < r.right - 2 && er.right > r.right + 2 && !scrollsX(e)) cut.push(((e.innerText || e.getAttribute('aria-label') || e.tagName) + '').replace(/\s+/g, ' ').slice(0, 24));
    if (cut.length >= 3) break;
  }
  if (cut.length) out.push(`창 안 내용이 오른쪽으로 잘림 — ${cut.join(' / ')}`);
  // ④ 폰 우측 패널 = 전면
  if (W <= 640 && ov.hasAttribute('data-pq-drawer-panel')) {
    if (r.width < W - 2) out.push(`폰 우측 패널이 화면 폭을 다 안 씀 (${Math.round(r.width)}/${W})`);
    const safeTop = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--pq-safe-top')) || 0;
    if (r.top > safeTop + 2) out.push(`폰 우측 패널 위에 빈자리 ${Math.round(r.top - safeTop)}px — 앱 머리줄을 덮어야 한다`);
    if (r.bottom < H - 2) out.push(`폰 우측 패널 아래에 빈자리 ${Math.round(H - r.bottom)}px`);
  }
  return { name, issues: out };
};

async function patrolEnv(browser, env, routes, maxN, report, creds) {
  const ctx = await browser.createBrowserContext();
  const page = await setupPage(ctx, env);
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message || e).slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error' && /\[ErrorBoundary\]/.test(m.text())) errs.push('boundary: ' + m.text().slice(0, 180)); });
  let newTargets = 0;
  ctx.on('targetcreated', (t) => { if (t.type() === 'page' && t !== page.target()) newTargets += 1; });
  const findings = [];   // { route, button, kind, detail, severity }
  const doneSet = new Set();   // 이 환경에서 이미 누른 버튼 이름
  let clicked = 0;
  let openedJudged = 0;   // 모양을 잰 «연 창» 수 — 0 이면 그 판정은 미측정이다
  try {
    await b.login(page, creds || b.CREDS);
    await b.goto(page, env.client ? '/home' : '/dashboard');
    await b.dismissBlockers(page).catch(() => null);
    // 머리줄·탭바(공용 크롬)는 환경마다 한 번만 — 화면마다 누르면 예산을 다 먹는다
    const units = [{ route: env.client ? '/home' : '/dashboard', scope: 'chrome' }, ...routes.map((r) => ({ route: r, scope: 'content' }))];
    for (const { route, scope } of units) {
     // 한 화면이 멈추면(브라우저 응답 없음) 그 화면만 기록하고 다음 화면으로 — 환경 전체를 끝내지 않는다
     try {
      const e0 = errs.length;
      await b.goto(page, route);
      await b.dismissBlockers(page).catch(() => null);
      await b.sleep(800);
      const st = await page.evaluate(SCREEN_STATE);
      if (st.boundary) findings.push({ route, button: '(열기)', kind: '오류 화면', detail: errs.slice(e0).join(' / ').slice(0, 200), severity: 'FAIL' });
      if (st.text < 20) findings.push({ route, button: '(열기)', kind: '빈 화면', detail: `글자 ${st.text}`, severity: 'FAIL' });
      if (st.overflow > 1) findings.push({ route, button: '(열기)', kind: '가로 넘침', detail: `${st.overflow}px`, severity: 'FAIL' });
      if (errs.length > e0 && !st.boundary) findings.push({ route, button: '(열기)', kind: 'pageerror', detail: errs.slice(e0).join(' / ').slice(0, 200), severity: 'FAIL' });
      if (st.boundary) continue;

      // 양성 대조군 — 누르면 던지는 버튼을 심는다. 순찰이 이것을 못 잡으면 초록은 거짓이다.
      if (process.env.PATROL_CONTROL === '1' && scope === 'content') {
        await page.evaluate(() => {
          const host = [...document.querySelectorAll('[data-pq-content]')].find((r) => !r.closest('[aria-hidden="true"]')) || document.body;
          const btn = document.createElement('button');
          btn.textContent = 'patrol-control';
          btn.style.cssText = 'position:relative;z-index:2147483646;padding:8px';
          btn.addEventListener('click', () => { setTimeout(() => { throw new Error('patrol-control-crash'); }, 0); });
          host.prepend(btn);
        });
      }
      const markN = process.env.PATROL_CONTROL === '1' ? Math.max(maxN, 60) : maxN;
      const doneSnap = [...doneSet];
      const names = await page.evaluate(MARK, markN, DANGER.source, doneSnap, scope);
      names.forEach((nm) => doneSet.add(nm));
      if (process.env.PATROL_DEBUG) console.error('[patrol]', env.n, route, scope, names.length, JSON.stringify(names));
      for (let i = 0; i < names.length; i++) {
        const name = names[i];
        // 앞 버튼이 화면을 바꿨으면 다시 연 뒤 다시 번호를 매긴다(같은 규칙이라 같은 번호가 같은 버튼이다)
        let el = await page.$(`[data-patrol-idx="${i}"]`);
        const elName = el ? await el.evaluate((x, src) => ((x.getAttribute('aria-label') || '') + ' ' + (x.getAttribute('title') || '') + ' ' + (x.innerText || '')).replace(/\s+/g, ' ').trim().slice(0, 60), DANGER.source) : null;
        if (!el || elName !== name) {
          // 앞 버튼이 화면을 바꿨다 — 다시 열고 **이름으로** 같은 버튼을 찾는다(순서는 바뀔 수 있다). 없으면 이 버튼만 건너뛴다.
          await b.goto(page, route); await b.sleep(500);
          const again = await page.evaluate(MARK, 999, DANGER.source, doneSnap.filter((d) => !names.includes(d)), scope);
          const j = again.indexOf(name);
          if (process.env.PATROL_DEBUG && j < 0) console.error('[patrol] gone after reopen', route, name);
          if (j < 0) continue;
          el = await page.$(`[data-patrol-idx="${j}"]`);
          if (!el) continue;
        }
        // ★ 스크롤이 끝난 뒤에 잰다 — scroll-behavior:smooth 인 상자에서 곧바로 재면 움직이는 중의 좌표라
        //   옆 요소가 «덮었다» 로 나왔다(2026-10-07 거짓 경고 — 같은 버튼이 폭마다 다른 덮개로 보고됐다).
        await el.evaluate((x) => x.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })).catch(() => null);
        await b.sleep(350);
        const pt = await el.evaluate((x) => {
          const r = x.getBoundingClientRect();
          const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
          const h = document.elementFromPoint(cx, cy);
          // 안쪽 요소가 바깥 버튼 안에 들어 있으면(h ⊃ x) 누르는 곳은 같은 버튼이다 — 덮인 것이 아니다
          return { x: cx, y: cy, hit: !!h && (h === x || x.contains(h) || h.contains(x)), cover: h ? (h.getAttribute('aria-label') || h.getAttribute('data-testid') || h.tagName) : null, inView: cx >= 0 && cy >= 0 && cx <= innerWidth && cy <= innerHeight };
        });
        // 화면 밖 = 접힌 서랍(폰 사이드바 등) 속 버튼 — 사용자도 못 누르는 자리라 판정하지 않는다
        if (!pt.inView) continue;
        if (!pt.hit) {
          findings.push({ route, button: name, kind: '눌러지지 않음', detail: `덮은 것: ${pt.cover}`, severity: 'WARN' });
          continue;
        }
        const e1 = errs.length;
        const t1 = newTargets;
        const nc1 = env.native ? await page.evaluate(() => (window.__nativeCalls || []).length) : 0;
        const p1 = await page.evaluate(() => location.pathname + location.search);
        // «눌러도 반응 없음» 판정용 — 화면 변화·요청·주소·새 창 어느 것도 없으면 죽은 버튼이다(2026-10-05 Irene:
        //   «이런 문제를 내가 찾기 전에 너가 안돼?» — 상담 «메일에서 보기» 신고)
        const r1 = page.__reqs;
        await page.evaluate(() => {
          window.__pqMut = 0;
          if (window.__pqObs) window.__pqObs.disconnect();
          window.__pqObs = new MutationObserver((m) => { window.__pqMut += m.length; });
          window.__pqObs.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
        });
        const o1 = await page.evaluate(OVERLAY_SIG);
        const op1 = await page.evaluate(OPENED_SIG).catch(() => 0);
        // 파일 고르기 창 — DOM 이 안 바뀌어도 반응이다(업로드·사진 올리기). 창은 곧바로 닫는다.
        let chooser = false;
        const fcP = page.waitForFileChooser({ timeout: 900 }).then((c) => { chooser = true; return c.cancel(); }).catch(() => null);
        const dl1 = browser.__downloads || 0;
        try {
          if (env.vp.hasTouch) await page.touchscreen.tap(pt.x, pt.y); else await page.mouse.click(pt.x, pt.y);
        } catch { continue; }
        clicked += 1;
        await b.sleep(700);
        await fcP;
        const downloaded = (browser.__downloads || 0) > dl1;
        const after = await page.evaluate(SCREEN_STATE).catch(() => ({ boundary: false, text: 999, overflow: 0 }));
        const react = await page.evaluate(() => ({
          mut: window.__pqMut || 0,
          url: location.pathname + location.search,
          // 눌렀더니 «찾을 수 없음·권한 없음·오류» 상세 화면 — 공용 DetailFallback 의 손잡이(하니스 계약)
          fallback: [...document.querySelectorAll('[data-testid="detail-fallback-notfound"],[data-testid="detail-fallback-forbidden"],[data-testid="detail-fallback-error"]')]
            .filter((e) => !e.closest('[aria-hidden="true"]') && e.getBoundingClientRect().width > 0).map((e) => e.getAttribute('data-testid')),
        })).catch(() => ({ mut: 1, url: '', fallback: [] }));
        // 새로 열린 창이 있으면 그 모양을 잰다 — 열리는 애니메이션(약 250ms)이 끝난 뒤
        if ((await page.evaluate(OPENED_SIG).catch(() => 0)) > op1) {
          await b.sleep(300);
          const oj = await page.evaluate(OPENED_JUDGE).catch(() => null);
          if (oj && oj.issues.length) findings.push({ route, button: name, kind: '연 창 모양', detail: `[${oj.name}] ${oj.issues.join(' · ')}`.slice(0, 260), severity: 'FAIL' });
          openedJudged += 1;
        }
        if (react.fallback.length) findings.push({ route, button: name, kind: '눌렀더니 찾을 수 없음', detail: `${react.fallback.join(',')} @ ${react.url}`, severity: 'FAIL' });
        // 이미 선택된 탭·필터를 다시 누른 것은 반응이 없는 게 정상이다(aria-selected/pressed/current)
        const alreadyOn = await el.evaluate((x) => ['aria-selected', 'aria-pressed', 'aria-current'].some((k) => { const v = x.getAttribute(k); return v && v !== 'false'; })).catch(() => false);
        if (!alreadyOn && !chooser && !downloaded && react.mut === 0 && page.__reqs === r1 && react.url === p1 && newTargets === t1) {
          findings.push({ route, button: name, kind: '눌러도 반응 없음', detail: '화면 변화·요청·이동 0', severity: 'WARN' });
        }
        const newErrs = errs.slice(e1);
        if (after.boundary) findings.push({ route, button: name, kind: '오류 화면', detail: newErrs.join(' / ').slice(0, 200), severity: 'FAIL' });
        else if (newErrs.length) findings.push({ route, button: name, kind: 'pageerror', detail: newErrs.join(' / ').slice(0, 200), severity: 'FAIL' });
        if (env.native) {
          const calls = await page.evaluate((n) => (window.__nativeCalls || []).slice(n), nc1);
          // 우리 **화면** 주소가 인앱 브라우저로 가면 결함이다(앱 탭으로 열려야 한다 — services/nativeLinks).
          //   우리 /api/·/uploads/ (PDF·첨부)는 설계상 인앱 브라우저로 연다(SPA 탭으로 열면 빈 탭) — 정상.
          const ours = calls.filter((c) => {
            if (c.p !== 'Browser' || c.m !== 'open' || !c.url) return false;
            let u; try { u = new URL(c.url, b.BASE); } catch { return false; }
            if (u.host !== BASE_HOST) return false;
            return !/^\/(api|uploads)\//.test(u.pathname);
          });
          if (ours.length) findings.push({ route, button: name, kind: '앱 밖으로 나감', detail: ours.map((c) => c.url).join(', ').slice(0, 200), severity: 'FAIL' });
          if (newTargets > t1) findings.push({ route, button: name, kind: '앱에서 새 창', detail: `${newTargets - t1}개`, severity: 'FAIL' });
        }
        // 정리 — 열린 것 닫기, 새 창 닫기, 화면이 바뀌었으면 다시 연다
        for (const pg of await ctx.pages()) if (pg !== page) await pg.close().catch(() => null);
        await page.keyboard.press('Escape').catch(() => null);
        await b.sleep(150);
        await page.keyboard.press('Escape').catch(() => null);
        await b.sleep(150);
        const p2 = await page.evaluate(() => location.pathname + location.search).catch(() => '');
        const stillModal = await page.evaluate(() => !!document.querySelector('[aria-modal="true"]')).catch(() => false);
        const o2 = await page.evaluate(OVERLAY_SIG).catch(() => 0);
        if (after.boundary || p2 !== p1 || stillModal || o2 > o1) { await b.goto(page, route); await b.sleep(400); await page.evaluate(MARK, markN, DANGER.source, doneSnap, scope); }
      }
     } catch (e) {
      findings.push({ route, button: '-', kind: '화면 응답 없음', detail: String(e.message || e).slice(0, 160), severity: 'FAIL' });
      try { await b.goto(page, env.client ? '/home' : '/dashboard'); } catch { /* 다음 화면에서 다시 연다 */ }
     }
    }
  } catch (e) {
    findings.push({ route: '-', button: '-', kind: 'FATAL', detail: String(e.message || e).slice(0, 200), severity: 'FAIL' });
  } finally {
    report.push({ env: env.n, clicked, blocked: page.__blocked, findings, openedJudged });
    await ctx.close().catch(() => null);
  }
}

async function run() {
  const baseRoutes = process.env.PATROL_ROUTES ? process.env.PATROL_ROUTES.split(',') : ROUTES_ALL;
  const envs = process.env.PATROL_ENVS ? ENVS_ALL.filter((e) => process.env.PATROL_ENVS.split(',').includes(e.n)) : ENVS_ALL;
  const maxN = Number(process.env.PATROL_MAX || 15);
  const report = [];
  const pre = [];   // 픽스처 단계 판정(상세 대상 못 고름 · 고객 픽스처 실패 · 정리 실패)
  // 상세 화면 대상 — 검사 계정의 현재 워크스페이스에서 고른다
  let detail = { routes: [], missing: [] };
  let bizId = null; let ownerId = null;
  try {
    const { sequelize } = require('/opt/planq/dev-backend/config/database');
    const [u] = await sequelize.query('SELECT id, active_business_id FROM users WHERE email = ?', { replacements: [b.CREDS.email], type: 'SELECT' });
    bizId = u?.active_business_id; ownerId = u?.id;
    if ((!process.env.PATROL_ROUTES || process.env.PATROL_DETAIL_ONLY === '1') && process.env.PATROL_DETAIL !== '0' && bizId) detail = await resolveDetailRoutes(bizId);
  } catch (e) { pre.push({ name: '상세 화면 대상 고르기', fail: 1, details: [String(e.message || e).slice(0, 160)] }); }
  if (detail.missing.length) pre.push({ name: `상세 화면 대상 못 고름 ${detail.missing.length}`, unmeasured: true, details: [detail.missing.join(' · ')] });
  // PATROL_DETAIL_ONLY=1 — 상세 화면만(검사기 점검·빠른 재확인용)
  const ownerRoutes = process.env.PATROL_DETAIL_ONLY === '1' ? detail.routes : [...baseRoutes, ...detail.routes];
  let fixture = null;
  const browser = await puppeteer.launch({ headless: 'new', protocolTimeout: 120000, args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  // 내려받기 감지 — 눌렀더니 파일이 내려온 버튼은 «반응 없음» 이 아니다(받은 파일은 지운다)
  const dlDir = fs.mkdtempSync('/tmp/patrol-dl-');
  try {
    const bs = await browser.target().createCDPSession();
    await bs.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: dlDir, eventsEnabled: true });
    bs.on('Browser.downloadWillBegin', () => { browser.__downloads = (browser.__downloads || 0) + 1; });
  } catch { /* 감지 못 하면 경고가 조금 늘 뿐이다 */ }
  try {
    for (const env of envs) {
      if (env.client) {
        if (!fixture) {
          try { fixture = await makeClientFixture(bizId, ownerId); } catch (e) { pre.push({ name: '고객 픽스처 만들기', fail: 1, details: [String(e.message || e).slice(0, 160)] }); }
        }
        if (!fixture) continue;
        const cr = process.env.PATROL_ROUTES ? baseRoutes : fixture.routes;
        await patrolEnv(browser, env, cr, maxN, report, fixture.cred);
      } else {
        await patrolEnv(browser, env, ownerRoutes, maxN, report);
      }
    }
  } finally {
    await browser.close().catch(() => null);
    try { fs.rmSync(dlDir, { recursive: true, force: true }); } catch { /* */ }
    if (fixture) {
      const ok = await dropClientFixture(fixture.ids).catch(() => false);
      pre.push({ name: '고객 픽스처 정리', fail: ok ? 0 : 1, details: [ok ? '지움' : '🔴 임시 고객 계정이 남았다'] });
    }
  }

  // 사람이 읽는 보고서
  const lines = [`# 버튼 순찰 ${new Date().toISOString()}`, `화면 ${ownerRoutes.length}(상세 ${detail.routes.length} 포함${detail.missing.length ? ' · 못 고른 상세: ' + detail.missing.join(',') : ''}) · 고객 화면 ${fixture ? fixture.routes.length : 0} × 환경 ${envs.map((e) => e.n).join(', ')} · 화면당 최대 ${maxN}개`, ''];
  for (const r of report) {
    const fails = r.findings.filter((f) => f.severity === 'FAIL');
    const warns = r.findings.filter((f) => f.severity === 'WARN');
    lines.push(`## ${r.env} — 누름 ${r.clicked} · 연 창 ${r.openedJudged} · 막은 쓰기 ${r.blocked} · 실패 ${fails.length} · 경고 ${warns.length}`);
    for (const f of [...fails, ...warns]) lines.push(`- [${f.severity}] ${f.route} · «${f.button}» · ${f.kind} — ${f.detail}`);
    lines.push('');
  }
  try {
    const dir = '/opt/planq/logs/patrol';
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `patrol-${today()}${process.env.PATROL_TAG ? "-" + process.env.PATROL_TAG : ""}.log`), lines.join('\n'));
  } catch { /* 보고서 실패는 판정에 영향 없음 */ }

  const results = [...pre];
  for (const r of report) {
    const fails = r.findings.filter((f) => f.severity === 'FAIL');
    const warns = r.findings.filter((f) => f.severity === 'WARN');
    // ★ 하나도 못 눌렀으면 초록이 아니다 — 미측정이다
    results.push({ name: `${r.env} · 연 창 ${r.openedJudged}개 모양 잼`, unmeasured: r.openedJudged === 0, details: [r.openedJudged === 0 ? '⚪ 연 창이 하나도 없었다 — 판정이 안 돌았다' : '창 밖·가림·잘림·폰 전면'] });
    results.push({ name: `${r.env} · 버튼 ${r.clicked}개 눌러 봄`, fail: r.clicked === 0 ? 1 : 0, details: [r.clicked === 0 ? '미측정 — 누른 버튼 0' : `막은 쓰기 ${r.blocked}`] });
    results.push({ name: `${r.env} · 오류·빈 화면·넘침·앱 이탈 0`, fail: fails.length ? 1 : 0, details: fails.length ? fails.slice(0, 12).map((f) => `${f.route} «${f.button}» ${f.kind} — ${f.detail}`) : ['없음'] });
    if (warns.length) results.push({ name: `${r.env} · (경고) 눌러지지 않음·반응 없음 ${warns.length}`, fail: 0, details: warns.slice(0, 8).map((f) => `${f.route} «${f.button}» ${f.detail}`) });
  }
  return results;
}

module.exports = { run, name: 'canary-button-patrol', DANGER, MARK };
