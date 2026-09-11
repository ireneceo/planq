// canary-drafts — 쓰다 만 글이 남는가 · 남의 글과 섞이지 않는가 (2026-09-11)
//
//   Irene: "업무상세에서 수정요청에 내용 남기거나 댓글에 내용 남기거나 하다가 나가면 다 날라가는데
//           모든 입력란은 임시저장 되어 있게 못해?"
//   설계: docs/DRAFT_PERSISTENCE_DESIGN.md D-C6 라운드 1A — ①②③④ ⑦(로그아웃 외) ⑧⑨ ⑩1·2·3·4·5·10·11·13·15
//
// 픽스처(health-check 계정 5 · 워크스페이스 5) — 매 실행 새로 만들고 끝나면 지운다
//   T1 담당=나·진행중·컨펌자=다른 멤버 → 댓글 · 확인요청 메모 · 보류 사유 · 내 댓글 수정
//   T2 담당=다른 멤버·컨펌중·컨펌자=나 → 승인 메모 · 수정요청 메모
//   T3 담당=나·진행중 → 섞임 대조
// ★ 화면 값은 **보이는 입력란**만 읽는다(getClientRects). 탭 모드는 숨은 탭의 입력란도 DOM 에 있어
//   첫 번째 것을 읽으면 다른 인스턴스 값을 읽는다(canary-workspace-sync 첫 실행에서 겪었다).
// ★ 두 번째 창(pop)은 420px — 좁은 폭 미러 모드라 탭 스냅샷을 메인 창과 다투지 않는다. 별도 문서라
//   같은 localStorage 를 storage 이벤트로만 안다 = 팝아웃·다른 브라우저 탭과 같은 조건이다.
require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env', quiet: true });
const { sequelize } = require('/opt/planq/dev-backend/config/database');
const b = require('./lib/browser');

const USER = 5;
const BIZ = 5;
const OTHER = 1000024;
const PROJECT = 239;
const ORIGINAL = 'draft-canary 원래 댓글';
const key = (kind, ent, uid = USER, biz = BIZ) => `planq:draft:${kind}:${uid}:${biz}:${ent}`;
const SEL = (id) => `[data-testid="${id}"]`;
const CMT = SEL('task-comment-input');

const q = async (sql, rep = []) => (await sequelize.query(sql, { replacements: rep }))[0];

async function dropFixtures() {
  // 메모 검사(②-메모)가 성공 경로에서 실제로 만든 메모 — 업무가 없어도 지운다(아래 early return 앞)
  await q("DELETE FROM project_notes WHERE project_id=? AND body LIKE 'draft-canary %'", [PROJECT]).catch(() => null);
  const rows = await q("SELECT id FROM tasks WHERE business_id=? AND title LIKE 'draft-canary %'", [BIZ]);
  const ids = rows.map((r) => r.id);
  if (!ids.length) return;
  for (const t of ['task_comments', 'task_reviewers', 'task_status_history', 'task_attachments']) {
    await q(`DELETE FROM ${t} WHERE task_id IN (?)`, [ids]).catch(() => null);
  }
  await q('DELETE FROM tasks WHERE id IN (?)', [ids]);
}

async function makeFixtures() {
  await dropFixtures();
  const now = new Date();
  const ins = async (title, status, assignee, creator, project) => (await sequelize.query(
    'INSERT INTO tasks (business_id, project_id, title, status, assignee_id, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)',
    { replacements: [BIZ, project, title, status, assignee, creator, now, now] }))[0];
  const T1 = await ins('draft-canary T1', 'in_progress', USER, USER, PROJECT);
  const T2 = await ins('draft-canary T2', 'reviewing', OTHER, OTHER, null);
  const T3 = await ins('draft-canary T3', 'in_progress', USER, USER, null);
  await q('INSERT INTO task_reviewers (task_id, user_id, state, added_by_user_id, created_at, updated_at) VALUES (?,?,?,?,?,?),(?,?,?,?,?,?)',
    [T1, OTHER, 'pending', USER, now, now, T2, USER, 'pending', OTHER, now, now]);
  const C1 = (await sequelize.query('INSERT INTO task_comments (task_id, user_id, content, created_at, updated_at) VALUES (?,?,?,?,?)',
    { replacements: [T1, USER, ORIGINAL, now, now] }))[0];
  return { T1, T2, T3, C1 };
}

// ── 화면 도구 ──
const probe = (p, sel) => p.evaluate((s) => {
  const el = [...document.querySelectorAll(s)].find((e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden');
  if (!el) return null;
  el.scrollIntoView({ block: 'center' });
  const r = el.getBoundingClientRect();
  const hit = document.elementFromPoint(r.left + Math.min(12, r.width / 2), r.top + Math.min(8, r.height / 2));
  return {
    value: el.value, seen: r.width > 0 && r.height > 0 && !!hit && (hit === el || el.contains(hit)),
    focused: document.activeElement === el, hasFocus: document.hasFocus(),
  };
}, sel).catch(() => null);
const allValues = (p, sel) => p.evaluate((s) => [...document.querySelectorAll(s)].map((e) => ({ v: e.value, shown: e.getClientRects().length > 0 })), sel).catch(() => []);
async function handleOf(p, sel) {
  const h = await p.evaluateHandle((s) => [...document.querySelectorAll(s)].find((e) => e.getClientRects().length > 0) || null, sel);
  return h.asElement();
}
async function typeInto(p, sel, text, { selectAll = false } = {}) {
  const h = await handleOf(p, sel);
  if (!h) throw new Error(`입력란이 안 보인다: ${sel}`);
  await h.focus();
  await p.keyboard.down('Control');
  await p.keyboard.press(selectAll ? 'KeyA' : 'End');
  await p.keyboard.up('Control');
  if (selectAll) await p.keyboard.press('Backspace');
  if (text) await p.keyboard.type(text);
}
async function click(p, sel) { const h = await handleOf(p, sel); if (!h) return false; await h.click(); return true; }
const rec = (p, k) => p.evaluate((kk) => { try { return JSON.parse(localStorage.getItem(kk)); } catch { return 'BAD'; } }, k);
const rawOf = (p, k) => p.evaluate((kk) => localStorage.getItem(kk), k);
const draftKeys = (p) => p.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('planq:draft:')).sort());
const setRaw = (p, k, v) => p.evaluate((kk, vv) => {
  if (vv === null) localStorage.removeItem(kk); else localStorage.setItem(kk, typeof vv === 'string' ? vv : JSON.stringify(vv));
}, k, v);
const v2 = (value, ago = 0) => ({ v: 2, value, editedAt: Date.now() - ago });
async function waitFor(fn, ms = 8000, step = 200) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try { if (await fn()) return true; } catch { /* 이동 중 */ }
    await b.sleep(step);
  }
  return false;
}
// 탭 모드는 pane 마다 MemoryRouter 라 window.history 로는 안 움직인다 — 앱의 내비 통로를 쓴다
async function nav(p, path) {
  const ok = await p.evaluate((pp) => { try { if (window.__pqTab) { window.__pqTab.navigateActive(pp); return true; } } catch { /* noop */ } return false; }, path);
  if (!ok) await b.gotoSPA(p, path); else await b.sleep(1000);
}
async function openTask(p, id, { full = false } = {}) {
  if (full) await b.goto(p, `/tasks?task=${id}`); else await nav(p, `/tasks?task=${id}`);
  // 같은 업무 드로어가 이미 떠 있으면 제목으로 바뀐 것을 확인한다
  return waitFor(async () => !!(await probe(p, CMT)) && (await p.evaluate((t) => document.body.innerText.includes(t), `draft-canary T${id === FX.T1 ? 1 : id === FX.T2 ? 2 : 3}`)), 15000);
}
async function closeTask(p) {
  await nav(p, '/tasks');
  if (await waitFor(async () => !(await probe(p, CMT)), 3000)) return true;
  await p.keyboard.press('Escape');
  return waitFor(async () => !(await probe(p, CMT)), 3000);
}
// ★ 대상 업무의 쓰기만 센다 — 첫 실행에서 /tasks 화면 자체의 `POST /api/tasks/priority/reindex` 를
//   "복원이 저장을 불렀다" 로 셌다(초안과 무관한 페이지 부팅 동작). 판정은 복원한 그 업무에 대해서만.
function watchWrites(p, ids) {
  const list = [];
  const re = new RegExp(`/api/tasks/(${ids.join('|')})(/|\\?|$)`);
  const on = (r) => { if (r.method() !== 'GET' && re.test(r.url())) list.push(`${r.method()} ${r.url().replace(/^https?:\/\/[^/]+/, '')}`); };
  p.on('request', on);
  return { list, stop: () => p.off('request', on) };
}
const DEBOUNCE = 750;

let FX = {};

async function run() {
  const results = [];
  const push = (name, ok, msg) => results.push({ name, fail: ok ? 0 : 1, details: [msg] });
  let browser = null;
  try {
    FX = await makeFixtures();
    const { T1, T2, T3, C1 } = FX;
    const launched = await b.launch();
    browser = launched.browser;
    const main = launched.page;
    await main.setViewport({ width: 1440, height: 900 });
    const pageErrors = [];
    main.on('pageerror', (e) => pageErrors.push(e.message));
    await b.login(main);
    // 탭 스토어 훅은 이 플래그가 있을 때만 window 에 붙는다(tabStore.ts 끝) — 없으면 ④(a) 를 못 잰다(첫 실행에서 계측 불가로 떨어졌다)
    await main.evaluate(() => localStorage.setItem('planq_tabs_spike', '1'));
    await b.goto(main, '/tasks');
    await main.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('planq:draft:') && k !== 'planq:draft:owner').forEach((k) => localStorage.removeItem(k)));

    // ── ① 업무 상세 6입력 — 입력 → 닫기 → 새 문서로 다시 열기 ──
    const t1 = { comment: '①댓글 남겨둔다', submit: '①확인요청 메모', hold: '①보류 사유', edit: ' ①수정중' };
    await openTask(main, T1, { full: true });
    await typeInto(main, CMT, t1.comment);
    await click(main, SEL('task-submit-open'));
    await waitFor(async () => !!(await probe(main, SEL('task-submit-note'))), 4000);
    await typeInto(main, SEL('task-submit-note'), t1.submit);
    await click(main, SEL('task-hold'));
    await waitFor(async () => !!(await probe(main, SEL('task-hold-reason'))), 4000);
    await typeInto(main, SEL('task-hold-reason'), t1.hold);
    await click(main, SEL('task-comment-more'));
    await click(main, SEL('task-comment-edit-open'));
    await waitFor(async () => !!(await probe(main, SEL('task-comment-edit'))), 4000);
    await typeInto(main, SEL('task-comment-edit'), t1.edit);
    await b.sleep(DEBOUNCE);
    const stored1 = {
      comment: (await rec(main, key('task-comment', T1)))?.value,
      submit: (await rec(main, key('task-submit-note', T1)))?.value,
      hold: (await rec(main, key('task-hold-reason', T1)))?.value,
      edit: await rec(main, key('task-comment-edit', C1)),
    };
    push('① 입력 즉시 저장본 — 댓글·확인요청·보류·댓글수정(base=원문)',
      stored1.comment === t1.comment && stored1.submit === t1.submit && stored1.hold === t1.hold
        && stored1.edit?.value === ORIGINAL + t1.edit && stored1.edit?.base === ORIGINAL,
      JSON.stringify({ ...stored1, edit: stored1.edit && { value: stored1.edit.value, base: stored1.edit.base } }));
    const closed1 = await closeTask(main);
    const w1 = watchWrites(main, [T1, C1]);
    await openTask(main, T1, { full: true });
    await b.sleep(600);
    const c1 = await probe(main, CMT);
    const s1 = await probe(main, SEL('task-submit-note'));
    const h1 = await probe(main, SEL('task-hold-reason'));
    const notes1 = await main.evaluate(() => [...document.querySelectorAll('[data-testid="draft-note"]')].filter((e) => e.getClientRects().length > 0).length);
    await click(main, SEL('task-comment-more'));
    await click(main, SEL('task-comment-edit-open'));
    await waitFor(async () => !!(await probe(main, SEL('task-comment-edit'))), 4000);
    const e1 = await probe(main, SEL('task-comment-edit'));
    await b.sleep(3000);
    w1.stop();
    push('① 닫고 새 문서로 다시 열기 — 네 입력 모두 되살아나 **보인다**(좌표) + 복원 줄',
      closed1 && c1?.value === t1.comment && c1?.seen && s1?.value === t1.submit && s1?.seen && h1?.value === t1.hold && h1?.seen
        && e1?.value === ORIGINAL + t1.edit && notes1 >= 3,
      `닫힘=${closed1} 댓글=${JSON.stringify(c1)} 확인요청=${JSON.stringify(s1)} 보류=${JSON.stringify(h1)} 수정=${e1?.value} 복원줄=${notes1}`);
    push('① 복원만으로 서버 저장 0건(3초)', w1.list.length === 0, w1.list.join(' | ') || '0건');
    await main.keyboard.press('Escape');
    await click(main, SEL('task-comment-more')); // 메뉴가 열려 있으면 닫는다(무해)
    await main.keyboard.press('Escape');

    // T2 — 승인·수정요청 메모
    const t2 = { approve: '①승인 메모', revision: '①수정요청 메모' };
    await openTask(main, T2);
    await click(main, SEL('task-approve-open'));
    await waitFor(async () => !!(await probe(main, SEL('task-approve-note'))), 4000);
    await typeInto(main, SEL('task-approve-note'), t2.approve);
    await click(main, SEL('task-revision-open'));
    await waitFor(async () => !!(await probe(main, SEL('task-revision-note'))), 4000);
    await typeInto(main, SEL('task-revision-note'), t2.revision);
    await b.sleep(DEBOUNCE);
    await closeTask(main);
    await openTask(main, T2, { full: true });
    await b.sleep(600);
    const a2 = await probe(main, SEL('task-approve-note'));
    const r2 = await probe(main, SEL('task-revision-note'));
    push('① 승인·수정요청 메모 — 다시 열면 폼이 열린 채 보인다', a2?.value === t2.approve && a2?.seen && r2?.value === t2.revision && r2?.seen,
      `승인=${JSON.stringify(a2)} 수정요청=${JSON.stringify(r2)}`);

    // ① 드로어를 연 채 다른 업무로 넘어갔다 돌아와도 떠나는 업무의 수정요청 메모가 남는다
    //   (업무 전환 이펙트가 revisionDraft.clear() 를 불렀다 — 그 순간 초안 키는 아직 떠나는 업무 것이다)
    await openTask(main, T3);
    await b.sleep(DEBOUNCE);
    const r2switchStored = (await rec(main, key('task-revision-note', T2)))?.value;
    await openTask(main, T2);
    await b.sleep(600);
    const r2back = await probe(main, SEL('task-revision-note'));
    push('① 드로어를 연 채 다른 업무로 넘어갔다 돌아와도 수정요청 메모가 남는다',
      r2switchStored === t2.revision && r2back?.value === t2.revision && !!r2back?.seen,
      `전환 뒤 저장본=${JSON.stringify(r2switchStored)} 돌아와서=${JSON.stringify(r2back)}`);

    // ① 폰 — 같은 규칙이 좁은 폭에서도
    const phone = await browser.newPage();
    await phone.setViewport(b.MOBILE_VP);
    await b.goto(phone, `/tasks?task=${T3}`);
    await waitFor(async () => !!(await probe(phone, CMT)), 15000);
    await typeInto(phone, CMT, '①폰 댓글');
    await b.sleep(DEBOUNCE);
    await b.goto(phone, `/tasks?task=${T3}`);
    await waitFor(async () => !!(await probe(phone, CMT)), 15000);
    await b.sleep(500);
    const ph = await probe(phone, CMT);
    const cleared = await click(phone, SEL('draft-clear'));
    await b.sleep(400);
    const phAfter = await probe(phone, CMT);
    const phKey = await rawOf(phone, key('task-comment', T3));
    push('① 폰 375px — 되살아나 보인다 · "지우기" 누르면 입력칸·저장본 둘 다 빈다',
      ph?.value === '①폰 댓글' && ph?.seen && cleared && phAfter?.value === '' && phKey === null,
      `복원=${JSON.stringify(ph)} 지우기버튼=${cleared} 뒤=${phAfter?.value} 저장본=${phKey}`);
    await phone.close();

    // ── ② 제출 — 실패(4xx)면 남고 성공이면 빈다 ──
    await openTask(main, T1);
    const cval = (await probe(main, CMT))?.value;
    await main.setRequestInterception(true);
    const block = (r) => {
      if (r.isInterceptResolutionHandled()) return;
      if (r.method() === 'POST' && r.url().includes(`/api/tasks/${T1}/comments`)) return r.respond({ status: 400, contentType: 'application/json', body: '{"success":false,"message":"canary"}' });
      return r.continue();
    };
    main.on('request', block);
    await click(main, SEL('task-comment-send'));
    await b.sleep(1500);
    const failVal = (await probe(main, CMT))?.value;
    const failKey = (await rec(main, key('task-comment', T1)))?.value;
    main.off('request', block);
    await main.setRequestInterception(false);
    push('② 제출 실패(400) — 입력칸·저장본 그대로', cval === t1.comment && failVal === t1.comment && failKey === t1.comment, `전=${cval} 뒤=${failVal} 저장본=${failKey}`);
    await click(main, SEL('task-comment-send'));
    const emptied = await waitFor(async () => (await probe(main, CMT))?.value === '', 6000);
    const okKey = await rawOf(main, key('task-comment', T1));
    const [[cnt]] = await sequelize.query('SELECT COUNT(*) n FROM task_comments WHERE task_id=? AND content=?', { replacements: [T1, t1.comment] });
    push('② 제출 성공 — 입력칸 빈다 · 저장본 삭제 · 댓글 1건', emptied && okKey === null && Number(cnt.n) === 1, `빈칸=${emptied} 저장본=${okKey} DB=${cnt.n}`);

    // ── ②-메모 — NoteThread(Q Talk 우측 패널) 저장 실패면 글이 남고, 성공이면 빈다 ──
    //   onAdd 핸들러 셋(Q Talk·메일 이슈·메일 메모)이 실패를 삼켜 NoteThread 가 **무조건** 비웠다 →
    //   onAdd 는 성공 여부(boolean)를 돌려주고 NoteThread 는 true 일 때만 비운다. 양방향으로 잰다.
    {
      const NOTE = SEL('note-input');
      const noteText = 'draft-canary ②메모';
      const noteKey = key('qtalk-note', `p${PROJECT}`);
      const [convRow] = await q('SELECT c.id FROM conversations c JOIN conversation_participants p ON p.conversation_id=c.id AND p.user_id=? WHERE c.business_id=? AND c.project_id=? ORDER BY c.id DESC LIMIT 1', [USER, BIZ, PROJECT]);
      const path = require('path');
      const titles = ['ko', 'en'].map((l) => require(path.join(__dirname, `../../dev-frontend/public/locales/${l}/qtalk.json`)).right.notes.title);
      await setRaw(main, noteKey, null);
      await main.evaluate(() => localStorage.setItem('qtalk_right_collapsed', '0'));
      await b.goto(main, `/talk/${convRow?.id}`);
      // 메모가 없으면 섹션이 접힌 채 시작하고, 접히면 자식을 그리지 않는다 — 제목(로케일 값)으로 헤더를 찾아 편다
      const opened = await waitFor(async () => {
        if (await probe(main, NOTE)) return true;
        await main.evaluate((ts) => {
          const head = [...document.querySelectorAll('[role="button"][aria-expanded="false"]')]
            .find((el) => ts.some((x) => (el.textContent || '').trim().startsWith(x)));
          if (head) head.click();
        }, titles);
        return !!(await probe(main, NOTE));
      }, 15000);
      if (!opened) {
        push('②-메모 저장 실패 — 입력칸·초안 그대로', false, `메모 입력칸을 못 찾음(대화=${convRow?.id}) — 계측 불가`);
      } else {
        await typeInto(main, NOTE, noteText);
        await b.sleep(DEBOUNCE);
        await main.setRequestInterception(true);
        const blockNote = (r) => {
          if (r.isInterceptResolutionHandled()) return;
          if (r.method() === 'POST' && r.url().includes(`/api/projects/${PROJECT}/notes`)) return r.respond({ status: 400, contentType: 'application/json', body: '{"success":false,"message":"canary"}' });
          return r.continue();
        };
        main.on('request', blockNote);
        await click(main, SEL('note-send'));
        await b.sleep(1500);
        const nFailVal = (await probe(main, NOTE))?.value;
        const nFailKey = (await rec(main, noteKey))?.value;
        main.off('request', blockNote);
        await main.setRequestInterception(false);
        push('②-메모 저장 실패(400) — 입력칸·초안 그대로', nFailVal === noteText && nFailKey === noteText, `뒤=${nFailVal} 저장본=${nFailKey}`);
        await click(main, SEL('note-send'));
        const nEmptied = await waitFor(async () => (await probe(main, NOTE))?.value === '', 6000);
        const nOkKey = await rawOf(main, noteKey);
        const [nCnt] = await q('SELECT COUNT(*) n FROM project_notes WHERE project_id=? AND body=?', [PROJECT, noteText]);
        push('②-메모 저장 성공 — 입력칸 빈다 · 초안 삭제 · 메모 1건(판정이 비움을 본다)', nEmptied && nOkKey === null && Number(nCnt.n) === 1, `빈칸=${nEmptied} 저장본=${nOkKey} DB=${nCnt.n}`);
      }
      await main.evaluate(() => localStorage.removeItem('qtalk_right_collapsed'));
      await openTask(main, T1, { full: true });
    }

    // ── ③ 섞임 ──
    await typeInto(main, CMT, '③T1 전용');
    await b.sleep(DEBOUNCE);
    await openTask(main, T3);
    const onT3 = (await probe(main, CMT))?.value;
    await setRaw(main, key('task-comment', T3, OTHER), v2('③다른 사용자 글'));
    await setRaw(main, key('task-comment', T3, USER, 73), v2('③다른 워크스페이스 글'));
    await openTask(main, T1);
    await openTask(main, T3);
    const foreign = (await probe(main, CMT))?.value;
    await setRaw(main, key('task-comment', T3), v2('③내 글'));
    await openTask(main, T1);
    const backT1 = (await probe(main, CMT))?.value;
    await openTask(main, T3);
    const mine = (await probe(main, CMT))?.value;
    push('③ 다른 업무·다른 사용자·다른 워크스페이스 글은 안 보인다 · 내 글은 보인다(양성)',
      onT3 === '' && foreign === '' && backT1 === '③T1 전용' && mine === '③내 글',
      `T3=${JSON.stringify(onT3)} 남의것=${JSON.stringify(foreign)} T1복귀=${backT1} 내것=${mine}`);
    await click(main, SEL('draft-clear'));
    await setRaw(main, key('task-comment', T3, OTHER), null);
    await setRaw(main, key('task-comment', T3, USER, 73), null);

    // ── ⑧ 댓글 수정 — 원문이 다른 곳에서 바뀌면 옛 초안을 버리고 알린다 ──
    await openTask(main, T1);
    await click(main, SEL('task-comment-more'));
    await click(main, SEL('task-comment-edit-open'));
    await waitFor(async () => !!(await probe(main, SEL('task-comment-edit'))), 4000);
    const e8 = (await probe(main, SEL('task-comment-edit')))?.value;
    await typeInto(main, SEL('task-comment-edit'), ' ⑧편집');
    await b.sleep(DEBOUNCE);
    const k8 = await rec(main, key('task-comment-edit', C1));
    await closeTask(main);
    const CHANGED = 'draft-canary 다른 곳에서 바뀐 원문';
    await q('UPDATE task_comments SET content=? WHERE id=?', [CHANGED, C1]);
    await openTask(main, T1, { full: true });
    await click(main, SEL('task-comment-more'));
    await click(main, SEL('task-comment-edit-open'));
    await waitFor(async () => !!(await probe(main, SEL('task-comment-edit'))), 4000);
    await b.sleep(400);
    const after8 = (await probe(main, SEL('task-comment-edit')))?.value;
    const note8 = await main.evaluate(() => [...document.querySelectorAll('[data-testid="draft-note"]')].some((e) => e.getClientRects().length > 0));
    const gone8 = await rawOf(main, key('task-comment-edit', C1));
    // e8 은 원문 그대로여야 한다 — ① 끝에서 Esc 로 수정을 취소하면 수정 초안도 지운다(첫 실행에서 판정이 틀렸다)
    push('⑧ 원문이 바뀌면 옛 수정 초안을 버린다 · 알림 줄 · 저장본 삭제',
      e8 === ORIGINAL && k8?.base === ORIGINAL && after8 === CHANGED && note8 && gone8 === null,
      `열때=${e8} 저장base=${k8?.base} 다시열때=${after8} 알림줄=${note8} 저장본=${gone8}`);
    await main.keyboard.press('Escape');

    // ── ⑨ 옛 키 이관 ──
    await closeTask(main);
    await setRaw(main, key('task-comment', T1), null);
    await setRaw(main, `planq:draft:task-comment:${USER}:${T1}`, { value: '⑨ 옛 키 글', savedAt: Date.now() });
    await openTask(main, T1);
    await b.sleep(500);
    const mig = (await probe(main, CMT))?.value;
    const migNew = (await rec(main, key('task-comment', T1)))?.value;
    const migOld = await rawOf(main, `planq:draft:task-comment:${USER}:${T1}`);
    push('⑨ 옛 키(워크스페이스 축 없음) → 새 키로 옮기고 옛 키 삭제', mig === '⑨ 옛 키 글' && migNew === '⑨ 옛 키 글' && migOld === null,
      `화면=${mig} 새키=${migNew} 옛키=${migOld}`);

    // ── ⑩13 같은 ms · 시계 역행 — 마지막 입력이 저장본에 착지 ──
    await typeInto(main, CMT, '', { selectAll: true });
    await main.evaluate(() => { window.__origNow = Date.now; const F = Date.now(); Date.now = () => F; });
    await typeInto(main, CMT, 'a');
    await b.sleep(DEBOUNCE);
    await typeInto(main, CMT, 'b');
    await b.sleep(DEBOUNCE);
    const same = { screen: (await probe(main, CMT))?.value, stored: (await rec(main, key('task-comment', T1)))?.value };
    await main.evaluate(() => { const F = window.__origNow() - 120000; Date.now = () => F; });
    await typeInto(main, CMT, 'c');
    await b.sleep(DEBOUNCE);
    const back = { screen: (await probe(main, CMT))?.value, stored: (await rec(main, key('task-comment', T1)))?.value };
    await main.evaluate(() => { Date.now = window.__origNow; });
    push('⑩13 시계 고정·역행에도 마지막 입력이 저장본에 착지', same.screen === 'ab' && same.stored === 'ab' && back.screen === 'abc' && back.stored === 'abc',
      `고정 ${JSON.stringify(same)} · 역행 ${JSON.stringify(back)}`);

    // ── ④(a) 같은 문서 keep-alive 두 탭 — 양성 대조군(같은 문서 이벤트 차단) 포함 ──
    const hasTabs = await main.evaluate(() => !!window.__pqTab && !window.__pqTab.getSnapshot().mirror);
    const sameDocRound = async (blocked) => {
      await setRaw(main, key('task-comment', T1), null);
      await openTask(main, T1, { full: true });
      await main.evaluate(() => {
        const s = window.__pqTab.getSnapshot();
        s.tabs.filter((t) => t.id !== s.activeId).forEach((t) => window.__pqTab.closeTab(t.id));
      });
      if (blocked) {
        // 차단이 실제로 걸렸는지 따로 센다 — 안 세면 "차단했는데 안 뒤집혔다" 와 "차단이 안 걸렸다" 가 구별되지 않는다
        // ★ 발송 자체를 막는다. window 에 capture 리스너로 stopImmediatePropagation 하는 방식은 이벤트가 window
        //   **자신**에게 발송되어(at-target) 먼저 등록된 훅 리스너가 먼저 받을 수 있다 — 3차 실행에서
        //   차단 3회가 찍혔는데도 숨은 탭이 새 글을 받았다.
        await main.evaluate(() => {
          window.__pqDraftBlocked = 0;
          const orig = window.dispatchEvent.bind(window);
          window.dispatchEvent = (e) => {
            if (e && e.type === 'planq:draft-written') { window.__pqDraftBlocked += 1; return true; }
            return orig(e);
          };
          window.__pqDraftUnblock = () => { window.dispatchEvent = orig; };
        });
      }
      const tab1 = await main.evaluate(() => window.__pqTab.getSnapshot().activeId);
      await typeInto(main, CMT, 'A1');
      await b.sleep(DEBOUNCE);
      await main.evaluate((p) => window.__pqTab.newTab(p), `/projects/p/${PROJECT}?tab=tasks&task=${T1}`);
      await waitFor(async () => (await allValues(main, CMT)).length >= 2 && (await probe(main, CMT))?.value === 'A1', 15000);
      await typeInto(main, CMT, 'B');
      await b.sleep(DEBOUNCE);
      const both = await allValues(main, CMT);
      await main.evaluate((id) => window.__pqTab.setActive(id), tab1);
      await b.sleep(800);
      // 전환 직후 — 숨은 탭이 A1 을 들고 돌아왔는지(차단이 먹었다) 아니면 다시 읽었는지(재마운트 등 다른 경로)
      const afterSwitch = await allValues(main, CMT);
      await typeInto(main, CMT, 'x');
      await b.sleep(DEBOUNCE);
      await closeTask(main);
      await b.sleep(300);
      // 되돌린다 — 안 되돌리면 같은 문서에서 이어지는 ⑩ 구간의 동기화까지 막혀 엉뚱한 곳이 빨개진다
      const blockedHits = blocked ? await main.evaluate(() => { const n = window.__pqDraftBlocked; window.__pqDraftUnblock?.(); return n; }) : null;
      return { both, afterSwitch, blockedHits, final: (await rec(main, key('task-comment', T1)))?.value };
    };
    if (hasTabs) {
      const ok4 = await sameDocRound(false);
      const hiddenSynced = ok4.both.filter((x) => !x.shown).every((x) => x.v === 'A1B') && ok4.both.length >= 2;
      push('④(a) 같은 문서 두 탭 — 숨은 탭도 새 글을 받고, 거기서 이어 쓰면 B 가 안 사라진다',
        hiddenSynced && ok4.final === 'A1Bx', `인스턴스=${JSON.stringify(ok4.both)} 전환후=${JSON.stringify(ok4.afterSwitch)} 최종=${ok4.final}`);
      const bad4 = await sameDocRound(true);
      push('④(a) 양성 대조군 — 같은 문서 이벤트를 막으면 B 의 글이 사라진다(판정이 뒤집힌다)',
        bad4.final === 'A1x', `차단 횟수=${bad4.blockedHits} 인스턴스=${JSON.stringify(bad4.both)} 전환후=${JSON.stringify(bad4.afterSwitch)} 최종=${bad4.final} (기대 A1x = B 유실 재현)`);
      await b.goto(main, '/tasks');
      await main.evaluate(() => { const s = window.__pqTab.getSnapshot(); s.tabs.filter((t) => t.id !== s.activeId).forEach((t) => window.__pqTab.closeTab(t.id)); });
    } else {
      push('④(a) 같은 문서 두 탭', false, '탭 모드 훅(__pqTab)이 없거나 미러 모드 — 계측 불가');
    }

    // ── 두 문서(메인 + 팝아웃 폭 창) ──
    const newPop = async () => {
      const p = await browser.newPage();
      await p.setViewport({ width: 420, height: 720 });
      await b.goto(p, `/tasks?task=${T1}`);
      await waitFor(async () => !!(await probe(p, CMT)), 15000);
      return p;
    };
    await setRaw(main, key('task-comment', T1), null);
    await openTask(main, T1, { full: true });
    let pop = await newPop();

    // ⑩1 A 편집 → B 이어 편집 → A 창 닫기 → 저장본 == B 글
    await main.bringToFront();
    await typeInto(main, CMT, 'A10');
    await b.sleep(DEBOUNCE);
    const popSaw = await waitFor(async () => (await probe(pop, CMT))?.value === 'A10', 3000);
    await pop.bringToFront();
    await typeInto(pop, CMT, 'B');
    await b.sleep(1500);
    await b.goto(main, '/tasks');
    await b.sleep(400);
    const s101 = (await rec(pop, key('task-comment', T1)))?.value;
    push('⑩1 A 편집 → B 이어 편집 → A 창 닫기 → 저장본 == B 글', popSaw && s101 === 'A10B', `B가 A글 받음=${popSaw} 최종=${s101}`);

    // ⑩2 B 가 전부 지움 → A 도 빈칸(툼스톤) → A 가 다시 쓰고 닫으면 A 글
    await openTask(main, T1, { full: true });
    await pop.bringToFront();
    await typeInto(pop, CMT, '', { selectAll: true });
    await b.sleep(DEBOUNCE);
    const tomb = await rec(pop, key('task-comment', T1));
    const aEmpty = await waitFor(async () => (await probe(main, CMT))?.value === '', 3000);
    await main.bringToFront();
    await typeInto(main, CMT, 'A2');
    await b.sleep(DEBOUNCE);
    const aScreen = (await probe(main, CMT))?.value;
    // 단독 재현(scratchpad debug-tomb)에서는 통과하고 전 구간에서만 실패했다 — 실패하면 인스턴스 전부와 저장본을 남긴다
    const diag102 = aScreen === 'A2' ? '' : ` · 진단 인스턴스=${JSON.stringify(await allValues(main, CMT))} 저장본=${await rawOf(main, key('task-comment', T1))} active=${await main.evaluate(() => (document.activeElement && document.activeElement.getAttribute('data-testid')) || document.activeElement?.tagName)}`;
    await b.goto(main, '/tasks');
    await b.sleep(400);
    const s102 = (await rec(pop, key('task-comment', T1)))?.value;
    push('⑩2 지운 것은 툼스톤으로 전해진다 · 그 뒤 A 가 쓴 글이 남는다(화면 == 저장본)',
      tomb && tomb.value === '' && aEmpty && aScreen === 'A2' && s102 === 'A2', `툼스톤=${JSON.stringify(tomb)} A빈칸=${aEmpty} A화면=${aScreen} 최종=${s102}${diag102}`);

    // ⑩3 A 창이 포커스를 잃고 입력란은 activeElement 인 채 — B 쓰기가 즉시 반영 · 돌아와 한 글자
    const opened103 = await openTask(main, T1, { full: true });
    await main.bringToFront();
    const h103 = await handleOf(main, CMT);
    // 1B 첫 회귀에서 여기서 null.focus() 로 FATAL — 이유를 남기고 멈춘다(로그인 화면으로 튕겼는지·드로어가 안 열렸는지)
    if (!h103) {
      const where = await main.evaluate(() => ({ url: location.pathname + location.search, text: (document.body?.innerText || '').slice(0, 160).replace(/\s+/g, ' ') })).catch(() => ({}));
      throw new Error(`⑩3 업무 입력란 없음 — openTask=${opened103} url=${where.url} 화면="${where.text}"`);
    }
    await h103.focus();
    await pop.bringToFront();
    await b.sleep(300);
    const pre3 = await probe(main, CMT);
    await typeInto(pop, CMT, 'B3', { selectAll: true });
    await b.sleep(DEBOUNCE);
    const got3 = await waitFor(async () => (await probe(main, CMT))?.value === 'B3', 3000);
    await main.bringToFront();
    await typeInto(main, CMT, 'x');
    await b.sleep(DEBOUNCE);
    const s103 = (await rec(main, key('task-comment', T1)))?.value;
    push('⑩3 포커스 잃은 창(입력란은 activeElement)도 즉시 새 글 · 돌아와 이어 쓰면 B3x',
      !!pre3 && pre3.hasFocus === false && pre3.focused === true && got3 && s103 === 'B3x',
      `조건 hasFocus=${pre3?.hasFocus} activeElement=${pre3?.focused} · 반영=${got3} · 최종=${s103}`);

    // ⑩11 팝아웃에서 쓰고 곧바로 닫기(디바운스 전) → pagehide 가 쓴다 → 메인 화면에 온다
    await (await handleOf(main, CMT)).focus();
    await pop.bringToFront();
    await typeInto(pop, CMT, 'P11', { selectAll: true });
    const before11 = (await rec(main, key('task-comment', T1)))?.value;
    await pop.close({ runBeforeUnload: true });
    const got11 = await waitFor(async () => (await probe(main, CMT))?.value === 'P11', 4000);
    const s1011 = (await rec(main, key('task-comment', T1)))?.value;
    push('⑩11 팝아웃을 디바운스 전에 닫아도 글이 남고 메인 화면에 온다', before11 !== 'P11' && got11 && s1011 === 'P11',
      `닫기 직전 저장본=${before11} · 메인 반영=${got11} · 최종=${s1011}`);

    // ⑩15 한글 조합 중에는 남의 쓰기를 미루고, 조합이 끝나면 반영
    pop = await newPop();
    await main.bringToFront();
    await main.evaluate((s) => { const el = [...document.querySelectorAll(s)].find((e) => e.getClientRects().length > 0); el.focus(); el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' })); }, CMT);
    const mid0 = (await probe(main, CMT))?.value;
    await pop.bringToFront();
    await typeInto(pop, CMT, 'B15', { selectAll: true });
    await b.sleep(DEBOUNCE + 300);
    const mid = (await probe(main, CMT))?.value;
    await main.evaluate((s) => { const el = [...document.querySelectorAll(s)].find((e) => e.getClientRects().length > 0); el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '' })); }, CMT);
    const got15 = await waitFor(async () => (await probe(main, CMT))?.value === 'B15', 2000);
    push('⑩15 조합 중에는 화면을 안 바꾸고, 조합이 끝나면 새 글', mid === mid0 && mid !== 'B15' && got15, `조합중=${mid} (전 ${mid0}) · 끝난뒤=${got15}`);
    await pop.close();

    // ── ⑩4 사칭 창 — 청소·센티널 건드리지 않고 초안도 안 남긴다 ──
    const K999 = key('task-comment', '888', 999);
    await setRaw(main, K999, v2('관리자 브라우저에 있던 남의 키'));
    await setRaw(main, key('task-comment', T1), null);
    const keysBefore = await draftKeys(main);
    const ownerBefore = await rawOf(main, 'planq:draft:owner');
    const imp = await browser.newPage();
    await imp.setViewport({ width: 420, height: 720 });
    await imp.evaluateOnNewDocument(() => { try { sessionStorage.setItem('impersonate_pending', JSON.stringify({ original_token: '' })); } catch { /* noop */ } });
    await b.goto(imp, `/tasks?task=${T1}`);
    await waitFor(async () => !!(await probe(imp, CMT)), 15000);
    await typeInto(imp, CMT, '사칭 창 입력');
    await b.sleep(DEBOUNCE + 300);
    await imp.close({ runBeforeUnload: true });
    await b.sleep(300);
    const keysAfter = await draftKeys(main);
    const ownerAfter = await rawOf(main, 'planq:draft:owner');
    push('⑩4 사칭 창 — 남의 키 청소 안 함 · 센티널 불변 · 입력해도 초안 0',
      keysAfter.includes(K999) && JSON.stringify(keysAfter) === JSON.stringify(keysBefore) && ownerAfter === ownerBefore,
      `키 전=${keysBefore.length} 뒤=${keysAfter.length} 남의키 유지=${keysAfter.includes(K999)} · owner ${ownerBefore}→${ownerAfter}`);

    // ── ⑦ 정체 확정 청소 + ⑨ uid0·TTL + ⑩10 센티널 — 부팅(=로그인·가입·OAuth 가 모두 지나는 문) ──
    const seeds = {
      other: key('task-comment', '777', 999), fwdOther: 'qmail-fwd-999-1', meeting: 'qnote_meeting_draft_v1',
      uid0: 'planq:draft:mail-issue:0:123', mine: key('task-comment', '776'),
      expired: key('task-comment', '999999'), fresh: key('task-comment', '999998'),
    };
    await setRaw(main, seeds.other, v2('남'));
    await setRaw(main, seeds.fwdOther, { value: { body: '남' }, savedAt: Date.now() });
    await setRaw(main, seeds.meeting, '{"title":"옛"}');
    await setRaw(main, seeds.uid0, { value: 'uid0', savedAt: Date.now() });
    await setRaw(main, seeds.mine, v2('내 것'));
    await setRaw(main, seeds.expired, v2('만료', 8 * 24 * 3600 * 1000));
    await setRaw(main, seeds.fresh, v2('신선', 3600 * 1000));
    await b.goto(main, '/tasks');
    await b.sleep(1200);
    const left = {};
    for (const [n, k] of Object.entries(seeds)) left[n] = (await rawOf(main, k)) !== null;
    const owner = await rawOf(main, 'planq:draft:owner');
    push('⑦ 부팅 — 남의 초안·옛 전달 키·회의 옛 키·uid0 삭제 / 내 것 유지',
      !left.other && !left.fwdOther && !left.meeting && !left.uid0 && left.mine && !(await rawOf(main, K999)), JSON.stringify(left));
    push('⑨ 부팅 TTL — 만료 삭제 · 미만료 유지 · ⑩10 센티널 존재', !left.expired && left.fresh && owner === String(USER), `만료=${left.expired} 신선=${left.fresh} owner=${owner}`);
    await setRaw(main, seeds.mine, null);
    await setRaw(main, seeds.fresh, null);

    // ── ⑨ quota — 저장소가 차 있어도 입력은 막히지 않는다 ──
    await openTask(main, T1, { full: true });
    const errBefore = pageErrors.length;
    const filled = await main.evaluate(() => {
      const chunk = 'x'.repeat(512 * 1024);
      let i = 0; let hit = false;
      try { for (; i < 40; i++) localStorage.setItem(`canary-fill-${i}`, chunk); } catch { hit = true; }
      return { n: i, hit };
    });
    await typeInto(main, CMT, 'Q', { selectAll: true });
    await b.sleep(DEBOUNCE);
    const qv = (await probe(main, CMT))?.value;
    await main.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('canary-fill-')).forEach((k) => localStorage.removeItem(k)));
    push('⑨ quota 가득 — 예외 0 · 입력은 된다', filled.hit && pageErrors.length === errBefore && qv === 'Q',
      `quota 도달=${filled.hit}(${filled.n}칸) · pageerror +${pageErrors.length - errBefore} · 화면=${qv}`);

    // ── ⑦ 민감 화면 — 로그인 입력은 어떤 저장소에도 안 남는다 ──
    const ctx = browser.createBrowserContext ? await browser.createBrowserContext() : await browser.createIncognitoBrowserContext();
    const lp = await ctx.newPage();
    await lp.goto(`${b.BASE}/login`, { waitUntil: 'domcontentloaded' });
    await waitFor(async () => !!(await lp.$('input[type="password"]')), 10000);
    const SECRET = 'canarysecret7731';
    await lp.type('input[type="password"]', SECRET);
    const emailSel = (await lp.$('input[type="email"]')) ? 'input[type="email"]' : 'input:not([type="password"])';
    await lp.type(emailSel, `${SECRET}@example.com`);
    await b.sleep(1500);
    const leaked = await lp.evaluate((s) => {
      const vals = [];
      for (const st of [localStorage, sessionStorage]) for (let i = 0; i < st.length; i++) vals.push(`${st.key(i)}=${st.getItem(st.key(i))}`);
      return { hit: vals.some((v) => v.includes(s)), n: vals.length };
    }, SECRET);
    push('⑦ 로그인 화면 입력 — local/sessionStorage 어디에도 없다', !leaked.hit, `저장소 항목 ${leaked.n}개 · 포함=${leaked.hit}`);
    await ctx.close();

    // ── ⑩5 다른 창이 로그아웃 → 같은 사람 재로그인 → 살아 있던 창의 초안이 다시 저장된다 ──
    await setRaw(main, key('task-comment', T1), null);
    await openTask(main, T1, { full: true });
    const out = await browser.newPage();
    await out.setViewport({ width: 1440, height: 900 });
    await b.goto(out, '/dashboard');
    await main.bringToFront();
    await typeInto(main, CMT, 'L1');
    await b.sleep(DEBOUNCE);
    const hadKey = (await rawOf(main, key('task-comment', T1))) !== null;
    await out.bringToFront();
    const menuOpened = await out.evaluate(() => {
      const btn = [...document.querySelectorAll('button[aria-haspopup="menu"]')].find((e) => /계정 메뉴|Account menu/i.test(e.getAttribute('aria-label') || '') && e.getClientRects().length > 0);
      if (!btn) return false; btn.click(); return true;
    });
    await b.sleep(500);
    const loggedOutClick = await out.evaluate(() => {
      const item = [...document.querySelectorAll('[role="menuitem"]')].find((e) => /로그아웃|Log ?out|Sign out/i.test(e.textContent || ''));
      if (!item) return false; item.click(); return true;
    });
    const atLogin = await waitFor(async () => out.url().includes('/login'), 10000);
    await b.sleep(800);
    const purged = (await rawOf(main, key('task-comment', T1))) === null;
    await main.bringToFront();
    await typeInto(main, CMT, 'S');
    await b.sleep(DEBOUNCE + 300);
    const suppressedOk = (await rawOf(main, key('task-comment', T1))) === null;
    await b.login(out);
    await b.goto(out, '/dashboard');
    await b.sleep(1500);
    await main.bringToFront();
    await typeInto(main, CMT, 'R');
    await b.sleep(DEBOUNCE + 300);
    const resumed = (await rec(main, key('task-comment', T1)))?.value;
    push('⑩5 다른 창 로그아웃 → 초안 삭제·정지 / 같은 사람 재로그인 → 살아 있던 창이 다시 저장',
      hadKey && menuOpened && loggedOutClick && atLogin && purged && suppressedOk && resumed === 'L1SR',
      `로그아웃 전 키=${hadKey} 메뉴=${menuOpened} 클릭=${loggedOutClick} /login=${atLogin} 삭제=${purged} 정지중 저장0=${suppressedOk} 재로그인 뒤=${resumed}`);
    await out.close();

    push('pageerror 0 (전 구간)', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | ') || '0');
  } catch (e) {
    results.push({ name: 'canary-drafts', fail: 0, fatal: 1, details: ['FATAL ' + e.message] });
  } finally {
    if (browser) await browser.close().catch(() => null);
    await dropFixtures().catch(() => null);
  }
  return results;
}

module.exports = { run, name: 'canary-drafts' };

if (require.main === module) {
  run().then((res) => {
    let bad = 0;
    console.log('\n=== 입력 임시저장 카나리 ===\n');
    for (const r of res) {
      const isBad = (r.fail || 0) + (r.fatal || 0) > 0;
      if (isBad) bad++;
      console.log(`${isBad ? '❌' : '✅'} ${r.name}`);
      (r.details || []).forEach((d) => console.log('     └ ' + d));
    }
    console.log(`\n총 문제: ${bad}`);
    sequelize.close().catch(() => null);
    process.exit(bad > 0 ? 1 : 0);
  }).catch((e) => { console.error('FATAL', e.message); process.exit(2); });
}
