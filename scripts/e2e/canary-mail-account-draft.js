// canary-mail-account-draft — 메일 계정 등록 폼 · 새 프로젝트 창의 입력이 닫기·새로고침·연결 실패에도 남는가 · 비밀번호는 안 남는가 (2026-11-14)
//
//   Irene: "이메일 설정이나 어떤 정보를 많이 넣는 화면에서 안될 수도 있는데 임시저장이라도 하게 해줘야 해.
//           자동으로 저장되거나. 다 날라가서 너무 불편해."
//   폼: dev-frontend/src/pages/Settings/MailAccountEditForm.tsx · kind 'mail-account-form'(hooks/draftKinds.ts)
//
//   ① 입력 → 저장본에 이메일·아이디가 있고 **비밀번호 문자열은 local/sessionStorage 어디에도 없다**
//   ② [취소] 로 닫고 다시 열기 → 이메일·아이디 복원 · 비밀번호 칸 빈칸 · 복원 줄 보임
//   ③ 새로고침 뒤 다시 열기 → ②와 같음
//   ④ [등록] → 연결 실패(가짜 서버) → 닫고 다시 열기 → 남아 있음
//   ⑤ 복원 줄 [지우고 처음부터] → 저장본 삭제 · 이메일 칸 빈칸
//   ⑥ 복원 줄이 폰 390 · 태블릿 768 · 데스크탑 1440 에서 실제로 보인다(elementFromPoint)
//   ⑦ 처음 열고 아무것도 안 넣으면 저장본이 생기지 않는다(빈 초안 0)
const b = require('./lib/browser');

const PATH = '/business/settings/mail-accounts?scope=personal';
const SECRET = 'mailsecret8842zz';
const EMAIL = 'draft-canary@planq-canary.invalid';
const SEL = (id) => `[data-testid="${id}"]`;
const KIND = 'planq:draft:mail-account-form:';

const draftKeys = (p) => p.evaluate((k) => Object.keys(localStorage).filter((x) => x.startsWith(k)), KIND);
const clearDrafts = (p) => p.evaluate((k) => Object.keys(localStorage).filter((x) => x.startsWith(k)).forEach((x) => localStorage.removeItem(x)), KIND);
const storageHas = (p, s) => p.evaluate((needle) => {
  const vals = [];
  for (const st of [localStorage, sessionStorage]) for (let i = 0; i < st.length; i++) vals.push(`${st.key(i)}=${st.getItem(st.key(i))}`);
  return vals.some((v) => v.includes(needle));
}, s);
const valueOf = (p, id) => p.evaluate((s) => {
  const el = [...document.querySelectorAll(s)].find((e) => e.getClientRects().length > 0);
  return el ? el.value : null;
}, SEL(id));
const visible = (p, id) => p.evaluate((s) => {
  const el = [...document.querySelectorAll(s)].find((e) => e.getClientRects().length > 0);
  if (!el) return false;
  el.scrollIntoView({ block: 'center' });
  const r = el.getBoundingClientRect();
  const hit = document.elementFromPoint(r.left + Math.min(10, r.width / 2), r.top + Math.min(6, r.height / 2));
  return r.width > 0 && r.height > 0 && !!hit && (hit === el || el.contains(hit));
}, SEL(id));
const waitFor = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await b.sleep(200); } return false; };

async function openAdd(p) {
  const ok = await waitFor(() => p.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((e) => e.getClientRects().length > 0
      && /^(\+\s*)?(계정 추가|첫 계정 등록|Add account|Add your first account)/i.test((e.textContent || '').trim()));
    if (!btn) return false; btn.click(); return true;
  }).catch(() => false), 10000);
  if (!ok) throw new Error('[계정 추가] 버튼이 안 보인다');
  if (!(await waitFor(async () => (await valueOf(p, 'mail-account-email')) !== null))) throw new Error('등록 폼이 안 열렸다');
  await b.sleep(300);
}
async function typeInto(p, id, text) {
  const h = (await p.evaluateHandle((s) => [...document.querySelectorAll(s)].find((e) => e.getClientRects().length > 0) || null, SEL(id))).asElement();
  if (!h) throw new Error(`입력란이 안 보인다: ${id}`);
  await h.click({ clickCount: 3 });
  await p.keyboard.press('Backspace');
  await h.type(text);
}
async function clickId(p, id) {
  await p.evaluate((s) => { const el = [...document.querySelectorAll(s)].find((e) => e.getClientRects().length > 0); if (el) el.click(); }, SEL(id));
}
async function closeForm(p) {
  await clickId(p, 'mail-account-cancel');
  return waitFor(async () => (await valueOf(p, 'mail-account-email')) === null, 5000);
}

async function run() {
  const results = [];
  const push = (name, ok, msg) => results.push({ name, fail: ok ? 0 : 1, details: [msg] });
  let browser = null;
  try {
    const launched = await b.launch();
    browser = launched.browser;
    const p = launched.page;
    await p.setViewport({ width: 1440, height: 900 });
    await b.login(p);
    await b.goto(p, PATH);
    await clearDrafts(p);

    // ⑦ 빈 초안 0
    await openAdd(p);
    await b.sleep(1200);
    const emptyKeys = await draftKeys(p);
    await closeForm(p);
    await b.sleep(400);
    const emptyAfterClose = await draftKeys(p);
    push('⑦ 아무것도 안 넣으면 저장본 없음', emptyKeys.length === 0 && emptyAfterClose.length === 0, `열린 동안 ${emptyKeys.length} · 닫은 뒤 ${emptyAfterClose.length}`);

    // ① 입력 → 저장본
    await openAdd(p);
    await typeInto(p, 'mail-account-email', EMAIL);
    await typeInto(p, 'mail-account-from-name', '[확인용] 초안 카나리');
    await typeInto(p, 'mail-account-imap-pw', SECRET);
    await typeInto(p, 'mail-account-smtp-pw', SECRET + 'S');
    await b.sleep(1200);
    const keys1 = await draftKeys(p);
    const raw1 = keys1.length ? await p.evaluate((k) => localStorage.getItem(k), keys1[0]) : '';
    const leak1 = await storageHas(p, SECRET);
    push('① 저장본에 이메일·아이디 있음 · 비밀번호 문자열 0건',
      keys1.length === 1 && raw1.includes(EMAIL) && raw1.includes('imap_username') && !leak1,
      `키 ${keys1.length}개(${keys1[0] || '-'}) · 이메일 포함=${raw1.includes(EMAIL)} · 비밀번호 유출=${leak1}`);

    // ② 취소로 닫고 다시 열기
    const closed = await closeForm(p);
    await openAdd(p);
    const v2 = { email: await valueOf(p, 'mail-account-email'), user: await valueOf(p, 'mail-account-imap-user'), pw: await valueOf(p, 'mail-account-imap-pw'), from: await valueOf(p, 'mail-account-from-name') };
    const note2 = await visible(p, 'mail-account-draft-restored');
    push('② [취소] 뒤 다시 열면 복원 · 비밀번호 빈칸 · 복원 줄',
      closed && v2.email === EMAIL && v2.user === EMAIL && v2.from === '[확인용] 초안 카나리' && v2.pw === '' && note2,
      `닫힘=${closed} · ${JSON.stringify(v2)} · 복원 줄=${note2}`);

    // ③ 새로고침
    await b.goto(p, PATH);
    await openAdd(p);
    const v3 = { email: await valueOf(p, 'mail-account-email'), pw: await valueOf(p, 'mail-account-imap-pw') };
    const note3 = await visible(p, 'mail-account-draft-restored');
    push('③ 새로고침 뒤에도 복원', v3.email === EMAIL && v3.pw === '' && note3, `${JSON.stringify(v3)} · 복원 줄=${note3}`);

    // ④ 연결 실패 뒤 닫고 다시 열기
    await typeInto(p, 'mail-account-imap-pw', SECRET);
    await clickId(p, 'mail-account-submit');
    const failed = await waitFor(async () => p.evaluate(() => !!document.querySelector('[data-testid="mail-form-alert"]')), 60000);
    await closeForm(p);
    await openAdd(p);
    const v4 = await valueOf(p, 'mail-account-email');
    const leak4 = await storageHas(p, SECRET);
    push('④ 연결 실패 → 닫기 → 다시 열기 = 남아 있음 · 비밀번호 0건', failed && v4 === EMAIL && !leak4, `실패 경고=${failed} · 이메일=${v4} · 유출=${leak4}`);

    // ⑥ 3폭 가시성
    const widths = [];
    for (const vp of [{ width: 390, height: 844, isMobile: true, hasTouch: true }, { width: 768, height: 1024 }, { width: 1440, height: 900 }]) {
      await p.setViewport(vp);
      await b.sleep(900);
      // 폭이 바뀌면(탭 모드 ↔ 미러 모드) 화면이 다시 그려져 드로어가 닫힌다 — 다시 열어도 초안이 남아 있어야 한다
      if ((await valueOf(p, 'mail-account-email')) === null) await openAdd(p);
      widths.push(`${vp.width}=${await visible(p, 'mail-account-draft-restored')}`);
      await p.screenshot({ path: `${process.env.CLAUDE_JOB_DIR ? process.env.CLAUDE_JOB_DIR + '/tmp' : '/tmp'}/mail-draft-${vp.width}.png` }).catch(() => null);
    }
    push('⑥ 복원 줄 3폭에서 보임', widths.every((w) => w.endsWith('true')), widths.join(' · '));
    await p.setViewport({ width: 1440, height: 900 });
    await b.sleep(900);
    if ((await valueOf(p, 'mail-account-email')) === null) await openAdd(p);

    // ⑤ 지우기
    await clickId(p, 'mail-account-draft-restored-discard');
    await b.sleep(400);
    const v5 = await valueOf(p, 'mail-account-email');
    const note5 = await visible(p, 'mail-account-draft-restored');
    const keys5 = await draftKeys(p);
    await closeForm(p);
    await b.sleep(400);
    const keys5b = await draftKeys(p);
    push('⑤ [지우고 처음부터] → 저장본 삭제 · 칸 빈칸 · 줄 사라짐',
      v5 === '' && !note5 && keys5.length === 0 && keys5b.length === 0,
      `이메일=${JSON.stringify(v5)} · 줄=${note5} · 키 ${keys5.length}→닫은 뒤 ${keys5b.length}`);
    await clearDrafts(p);

    // ── 새 프로젝트 창 (kind 'project-create') — P1 입력 저장본 · P2 Esc 닫고 새로고침해 다시 열기 · P3 지우기 · P4 만들기 성공 = 저장본 삭제 ──
    const PK = 'planq:draft:project-create:';
    const pKeys = () => p.evaluate((k) => Object.keys(localStorage).filter((x) => x.startsWith(k)), PK);
    const PNAME = `[확인용] 초안 프로젝트 ${Date.now() % 100000}`;
    const openNew = async () => {
      await b.goto(p, '/projects?new=1');
      if (!(await waitFor(async () => (await valueOf(p, 'project-create-name')) !== null, 10000))) throw new Error('새 프로젝트 창이 안 열렸다');
      await b.sleep(500);
    };
    await p.evaluate((k) => Object.keys(localStorage).filter((x) => x.startsWith(k)).forEach((x) => localStorage.removeItem(x)), PK);
    await openNew();
    await b.sleep(1000);
    const pEmpty = (await pKeys()).length;
    await typeInto(p, 'project-create-name', PNAME);
    await typeInto(p, 'project-create-desc', '초안 설명 줄');
    await b.sleep(1000);
    const pk1 = await pKeys();
    const pr1 = pk1.length ? await p.evaluate((k) => localStorage.getItem(k), pk1[0]) : '';
    push('P1 새 프로젝트 — 열기만 하면 저장본 0 · 입력하면 저장본', pEmpty === 0 && pk1.length === 1 && pr1.includes(PNAME) && pr1.includes('초안 설명 줄'),
      `열기만=${pEmpty} · 입력 뒤 키 ${pk1.length}(${pk1[0] || '-'})`);
    await p.keyboard.press('Escape');
    await b.sleep(600);
    await openNew();
    const pv2 = { name: await valueOf(p, 'project-create-name'), desc: await valueOf(p, 'project-create-desc'), note: await visible(p, 'project-create-draft') };
    push('P2 Esc 로 닫고 새로고침해 다시 열면 복원 · 복원 줄', pv2.name === PNAME && pv2.desc === '초안 설명 줄' && pv2.note, JSON.stringify(pv2));
    await clickId(p, 'project-create-draft-discard');
    await b.sleep(800);
    const pv3 = { name: await valueOf(p, 'project-create-name'), note: await visible(p, 'project-create-draft'), keys: (await pKeys()).length };
    push('P3 [지우고 처음부터] → 칸 빈칸 · 줄 사라짐 · 저장본 0', pv3.name === '' && !pv3.note && pv3.keys === 0, JSON.stringify(pv3));
    await typeInto(p, 'project-create-name', PNAME);
    await b.sleep(900);
    const before4 = (await pKeys()).length;
    const clicked = await p.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((e) => e.getClientRects().length > 0 && /^(프로젝트 생성|Create project)$/i.test((e.textContent || '').trim()));
      if (!btn) return false; btn.click(); return true;
    });
    const created = await waitFor(async () => /\/projects\/p\/\d+/.test(p.url()), 15000);
    await b.sleep(800);
    const after4 = (await pKeys()).length;
    push('P4 만들기 성공 → 저장본 삭제', before4 === 1 && clicked && created && after4 === 0, `만들기 전 키 ${before4} · 눌림=${clicked} · 상세로 감=${created}(${p.url()}) · 뒤 키 ${after4}`);
  } catch (e) {
    results.push({ name: '실행', fatal: 1, details: [e.message] });
  } finally {
    if (browser) await browser.close().catch(() => null);
  }
  return results;
}

module.exports = { run, name: 'canary-mail-account-draft' };

if (require.main === module) {
  run().then((res) => {
    let bad = 0;
    console.log('\n=== 메일 계정 폼 임시저장 카나리 ===\n');
    for (const r of res) {
      const isBad = (r.fail || 0) + (r.fatal || 0) > 0;
      if (isBad) bad++;
      console.log(`${isBad ? '❌' : '✅'} ${r.name}`);
      (r.details || []).forEach((d) => console.log('     └ ' + d));
    }
    console.log(`\n총 문제: ${bad}`);
    process.exit(bad > 0 ? 1 : 0);
  }).catch((e) => { console.error('FATAL', e.message); process.exit(2); });
}
