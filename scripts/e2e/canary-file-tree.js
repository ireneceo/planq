// 좌측 트리 — 프로젝트 1줄 · 캐럿 펼침 · 캐럿 클릭이 목록을 안 바꾼다.
// ★ 픽스처를 **먼저** 만들고 /files 는 **한 번만** 연다 — 파일이 1400건이라 여는 것 자체가 무겁다.
// ★ 대상 프로젝트는 «파일이 있는 프로젝트» 다. 그래야 좌측 목록에 실제로 뜬다
//   (DB 에서 아무거나 집었다가 캐럿 없음을 결함으로 잘못 읽었다).
// ★ 열 정렬도 잰다 — 이름의 왼쪽 끝 / 숫자의 오른쪽 끝이 전 행에서 같은 x 인가.
//   행마다 그리드 칸 수가 다르면 열이 갈라진다. 2026-09-20 에 프로젝트 행에만 펼침 칸을 더해
//   **동그라미가 «이름 칸»(1fr)을 차지**했고, 이름이 오른쪽으로 밀려 «우측정렬» 로 보였다.
//
// ★★ **양성 대조군은 «끄는» 방식이어야 하고, 넣은 뒤 빌드 종료코드를 먼저 본다.**
//   같은 날 대조군이 네 번 헛돌았고 **둘이 같은 원인**이었다 — «코드를 지우는» 대조군은
//   미사용 변수(TS6133)로 **빌드가 실패**하고, 그러면 옛 번들이 그대로 서빙돼 판정이
//   **거짓 초록**이 된다. "검사기가 결함을 못 잡는다" 로 결론 낼 뻔했다.
//   이 검사의 올바른 대조군: `FolderRow` 의 `grid-template-columns` 를 옛 4칸으로 되돌린다.
//   변수는 전부 쓰이므로 빌드가 통과하고, 이름 왼쪽 끝이 **408/393/312/433 으로 흩어진다**(실측).
//   (나머지 둘: 화면에 안 뜨는 프로젝트를 DB 에서 골랐다 · 그려지지 않는 분기를 건드렸다.)
const b = require('/opt/planq/scripts/e2e/lib/browser');
require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env' });
const { sequelize } = require('/opt/planq/dev-backend/config/database');
const TAG = 'ZTR' + Date.now();
async function run() {
  const results = [];
  const [top] = await sequelize.query(`SELECT f.project_id pid, f.business_id biz, COUNT(*) n
      FROM files f WHERE f.project_id IS NOT NULL AND f.deleted_at IS NULL AND f.business_id IN (5,73)
      GROUP BY f.project_id, f.business_id ORDER BY n DESC LIMIT 1`);
  if (!top.length) { results.push({ name: '좌측 트리', fail: 0, details: ['⬜ 미측정 — 파일이 달린 프로젝트가 없다'] }); return results; }
  const { pid, biz } = top[0];
  const [me] = await sequelize.query('SELECT user_id FROM business_members WHERE business_id=:b LIMIT 1', { replacements: { b: biz } });
  await sequelize.query('INSERT INTO file_folders (business_id,project_id,parent_id,name,sort_order,created_by,created_at,updated_at) VALUES (:b,:p,NULL,:n,0,:u,NOW(),NOW())',
    { replacements: { b: biz, p: pid, n: TAG + '-상위', u: me[0].user_id } });
  const [f1] = await sequelize.query('SELECT id FROM file_folders WHERE name=:n', { replacements: { n: TAG + '-상위' } });
  await sequelize.query('INSERT INTO file_folders (business_id,project_id,parent_id,name,sort_order,created_by,created_at,updated_at) VALUES (:b,:p,:pa,:n,0,:u,NOW(),NOW())',
    { replacements: { b: biz, p: pid, pa: f1[0].id, n: TAG + '-하위', u: me[0].user_id } });
  

  const { browser, page } = await b.launch();
  const judge = (n, ok, d) => results.push({ name: n, fail: ok ? 0 : 1, details: [d] });
  try {
    await page.setViewport({ width: 1440, height: 900 });
    await b.login(page);
    await b.goto(page, '/inbox');
    await b.sleep(1000);
    await b.goto(page, '/files');
    await b.sleep(5000);
    const before = await page.evaluate((p, nm) => {
      const rows = [...document.querySelectorAll('[data-testid^="docs-project-row-"]')];
      const mine = rows.filter(r => r.getAttribute('data-testid') === `docs-project-row-${p}`);
      const nameEl = mine[0] ? mine[0].querySelector('[title]') : null;
      const projName = nameEl ? nameEl.getAttribute('title') : null;
      const leaves = [...document.querySelectorAll('div')].map(d => d.children.length === 0 ? (d.textContent || '').trim() : '').filter(Boolean);
      return { rowsForThis: mine.length, projName,
        sameNameCount: projName ? leaves.filter(t => t === projName).length : null,
        hasCaret: !!(mine[0] && mine[0].querySelector('[role="button"]')),
        subShown: document.body.innerText.includes(nm),
        files: document.querySelectorAll('[data-file-id]').length };
    }, pid, TAG + '-상위');

    judge('프로젝트는 한 줄', before.rowsForThis === 1, `${before.rowsForThis}줄`);
    judge('같은 이름이 트리에 한 번만 (중복 제거)', before.sameNameCount === 1, `"${before.projName}" ×${before.sameNameCount}`);
    judge('폴더가 있으면 펼침 손잡이(폴더 아이콘)가 붙는다', before.hasCaret, String(before.hasCaret));
    judge('누르기 전에는 하위 폴더가 안 보인다 (음성 대조군)', !before.subShown, String(before.subShown));
    // ★ 열 정렬 — 이름의 **왼쪽 끝**과 숫자의 **오른쪽 끝**이 전 행에서 같은 x 에 서는가.
    //   Irene 2026-09-20: *"프로젝트 이름이 좌측정렬이어야지 왜 우측정렬이야?"* ·
    //   *"전체, 내 파일, 채팅 업무 회의 등의 폴더이름이랑 오른쪽도 맞춰야지"*
    //   ★ 행마다 칸 수가 다르면 그리드가 갈라진다 — 그게 이름이 «우측정렬» 로 보인 원인이었다
    //     (동그라미가 1fr 칸을 차지해 이름을 밀었다). 그래서 **결과 좌표**로 잰다.
    //   ★ 하위 폴더는 들여쓰기가 목적이므로 **제외**한다(같은 x 면 계층이 안 보인다).
    const cols = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('[data-testid^="docs-project-row-"]')]
        .concat([...document.querySelectorAll('div')].filter(d => d.dataset && d.dataset.testid === undefined && false));
      // 트리의 **최상위 행들** — 프로젝트 행과 같은 부모를 공유하고 들여쓰기(padding-left 8px)가 기본인 것
      const proj = document.querySelector('[data-testid^="docs-project-row-"]');
      if (!proj) return null;
      const tree = proj.parentElement.parentElement;
      const basePad = Math.round(parseFloat(getComputedStyle(proj).paddingLeft));
      const out = [];
      [...tree.querySelectorAll('div')].forEach((r) => {
        if (getComputedStyle(r).display !== 'grid') return;
        // ★ 기준 padding 을 **숫자로 박지 않는다.** 행 여백을 8→10px 로 바꾼 순간 0행이 잡혀
        //   «미측정» 인데 ✅ 로 읽혔다(빈 픽스처 거짓 판정). 프로젝트 행의 실제 값을 기준으로 쓴다.
        if (Math.round(parseFloat(getComputedStyle(r).paddingLeft)) !== basePad) return;
        const kids = [...r.children];
        // ★ 숫자는 **0 이면 안 그린다**(`{count > 0 && <FolderCount/>}`). 그래서 자식이 2개인 행이 있다 —
        //   채팅·업무·회의·문서가 그렇다. 3개 미만을 버리면 **정작 재야 할 행이 통째로 빠지고**
        //   «3행 전부 같다» 로 초록이 난다(실제로 그랬다). 이름 칸만 있으면 잰다.
        if (kids.length < 2) return;
        // 칸: [아이콘][이름][숫자][액션] — 이름은 두 번째다(캐럿 칸을 없앤 뒤 바뀌었다).
        // ★ 숫자는 **위치로 찾지 않는다.** 0 이면 안 그려지고, 그 자리에 겹쳐 띄운 액션
        //   (absolute, 평소엔 opacity 0 이지만 폭은 있다)이 kids[2] 로 잡혀 **엉뚱한 x** 를 잰다.
        //   2026-09-20 에 프로젝트 행 숫자를 조건부로 바꾸면서 실제로 그렇게 될 뻔했다.
        const name = kids[1].getBoundingClientRect();
        const cntEl = r.querySelector('[data-folder-count]');
        const cnt = cntEl ? cntEl.getBoundingClientRect() : null;
        const label = (kids[1].textContent || '').trim().slice(0, 14);
        if (!label) return;
        out.push({ label, nameLeft: Math.round(name.left), countRight: cnt && cnt.width ? Math.round(cnt.right) : null });
      });
      return out;
    });
    if (!cols || cols.length < 3) {
      // ★ 미측정을 초록으로 내보내지 않는다 — 이름에 ⬜ 를 박아 둔다(한 번 그렇게 읽혔다).
      results.push({ name: '⬜ 열 정렬 — 미측정', fail: 0, details: [`최상위 행 ${cols ? cols.length : 0}개 — 선택자를 확인할 것`] });
    } else {
      const lefts = [...new Set(cols.map(c => c.nameLeft))];
      const rights = [...new Set(cols.filter(c => c.countRight !== null).map(c => c.countRight))];
      // ★ **몇 행을 쟀는지** 를 판정에 넣는다. 3행만 재고 초록이면 «채팅·업무·회의·문서가 빠졌다» 를
      //   못 본다 — 정작 Irene 이 «최상단 기준에 맞춰라» 고 한 행들이 그것이다.
      //   전체·내 파일 + 프로젝트(≥1) + 시스템 4 = 최소 7행.
      judge('열 정렬을 잴 행이 충분하다 (최소 7행)', cols.length >= 7, `${cols.length}행: ${cols.map(c => c.label).join(', ')}`);
      judge('이름의 왼쪽 끝이 전 행에서 같다', lefts.length === 1,
        `${cols.length}행 · x=${lefts.join('/')} (${cols.slice(0, 4).map(c => c.label).join(', ')}…)`);
      judge('숫자의 오른쪽 끝이 전 행에서 같다', rights.length <= 1,
        `x=${rights.join('/') || '(숫자 없음)'}`);
    }

    // ★ 겹침 — [+] 와 숫자 알약이 **같은 자리**를 쓴다. 액션이 뜬 상태에서 숫자가 남아 있으면
    //   세 자리 숫자에서 회색 알약이 버튼 왼쪽으로 삐져나온다(Irene 2026-09-20 실제 신고).
    //   그래서 «올렸을 때 숫자가 물러나는가» 와 «안 올렸을 때는 숫자가 보이는가» 를 같이 잰다.
    const overlap = await page.evaluate((p) => {
      const row = document.querySelector(`[data-testid="docs-project-row-${p}"]`);
      if (!row) return null;
      const cnt = row.querySelector('[data-folder-count]');
      const act = row.querySelector('[data-folder-actions]');
      const vis = (el) => !!el && parseFloat(getComputedStyle(el).opacity) > 0.05;
      const rects = () => {
        if (!vis(cnt) || !vis(act)) return 0;
        const a = cnt.getBoundingClientRect(), b = act.getBoundingClientRect();
        return Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
      };
      return { idleCount: vis(cnt), idleAction: vis(act), idleOverlap: rects(), has: !!cnt && !!act };
    }, pid);
    if (overlap && overlap.has) {
      judge('평소엔 숫자가 보이고 액션은 숨는다', overlap.idleCount && !overlap.idleAction,
        `숫자 ${overlap.idleCount} · 액션 ${overlap.idleAction}`);
      judge('평소 겹침 0px', overlap.idleOverlap === 0, `${overlap.idleOverlap}px`);
      const hov = await page.evaluate((p) => {
        const row = document.querySelector(`[data-testid="docs-project-row-${p}"]`);
        const r = row.getBoundingClientRect();
        return { x: r.left + 20, y: r.top + r.height / 2 };
      }, pid);
      await page.mouse.move(hov.x, hov.y);
      await b.sleep(400);
      const on = await page.evaluate((p) => {
        const row = document.querySelector(`[data-testid="docs-project-row-${p}"]`);
        const cnt = row.querySelector('[data-folder-count]');
        const act = row.querySelector('[data-folder-actions]');
        const vis = (el) => !!el && parseFloat(getComputedStyle(el).opacity) > 0.05;
        let ov = 0;
        if (vis(cnt) && vis(act)) {
          const a = cnt.getBoundingClientRect(), c = act.getBoundingClientRect();
          ov = Math.max(0, Math.min(a.right, c.right) - Math.max(a.left, c.left));
        }
        return { cnt: vis(cnt), act: vis(act), ov };
      }, pid);
      judge('마우스를 올리면 [+] 가 나온다', on.act, `액션 ${on.act}`);
      judge('올린 상태에서 숫자와 [+] 가 겹치지 않는다', on.ov === 0, `겹침 ${on.ov}px · 숫자 ${on.cnt}`);
      await page.mouse.move(5, 5);
      await b.sleep(300);
    } else {
      results.push({ name: '⬜ [+]·숫자 겹침 — 미측정', fail: 0, details: ['프로젝트 행에 숫자 또는 액션이 없다'] });
    }

    if (before.hasCaret) {
      const pos = await page.evaluate((p) => {
        const c = document.querySelector(`[data-testid="docs-project-row-${p}"] [role="button"]`);
        const r = c.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      }, pid);
      await page.mouse.click(pos.x, pos.y);
      await b.sleep(1200);
      const after = await page.evaluate((nm1, nm2) => ({
        top: document.body.innerText.includes(nm1), sub: document.body.innerText.includes(nm2),
        files: document.querySelectorAll('[data-file-id]').length,
      }), TAG + '-상위', TAG + '-하위');
      judge('아이콘을 누르면 하위 폴더가 열린다', after.top, `상위 ${after.top} · 그 아래 ${after.sub}`);
      judge('아이콘 클릭이 목록(프로젝트 필터)을 바꾸지 않는다', after.files === before.files, `파일 ${before.files} → ${after.files}`);
    }
    // ── 프로젝트 > 파일 트리도 **같은 것**을 띄우는가 (Irene 2026-09-20: "Q file도 프로젝트>파일도")
    //   두 트리는 서로 다른 컴포넌트(ProjectGroups / FolderTree)라 손으로는 반드시 갈라진다.
    //   ★ 행 높이(30px)보다 큰 버튼이 들어가면 "... 이 이상하게 뜬다" 가 된다 — 높이를 잰다.
    // ★ 헤드리스는 `(hover: none)` 으로 뜬다 — 그대로 재면 **터치 분기(40px)** 를 재게 되고
    //   Irene 이 보는 데스크탑 분기(32px)는 한 번도 안 재진다. 미디어 특성을 고정한다.
    //   ★ 헤드리스는 `(hover: hover)` 로 못 만든다 — puppeteer 도 CDP setEmulatedMedia 도
    //     안 먹는다(2026-09-20 실측). 그래서 **화면 규격의 분기 조건을 hover 로 잡지 않는다**:
    //     폭으로 가르면 하니스가 데스크탑 분기를 그대로 잰다.
    await b.goto(page, `/projects/p/${pid}?tab=files`);
    await b.sleep(7000);
    const pf = await page.evaluate(() => {
      // ★ **행**을 잡아야 한다. 후손으로 찾으면 트리 전체(299px)가 먼저 걸리고,
      //   탭은 keep-alive 라 **숨어 있는 Q file 트리**(높이 0)가 같이 잡힌다 —
      //   2026-09-20 에 그 둘 때문에 «행 0px» 로 두 번 헛돌았다.
      //   → 이 탭의 본문 안에서, **보이는** 행만 본다.
      const pane = document.querySelector('[data-testid="project-tab-body-files"]');
      if (!pane) return null;
      const rows = [...pane.querySelectorAll('div')].filter(d =>
        getComputedStyle(d).display === 'grid'
        // ★ **폴더 행**만 — 프로젝트(기본 폴더) 행에는 [+] 하나뿐이라 그것을 집으면
        //   «[+] 와 ⋯ 가 같은 규격» 을 잴 상대가 없다(실측: 버튼 1개).
        && d.querySelector(':scope > [data-folder-actions] [data-testid^="docs-folder-menu-"]')
        && d.getBoundingClientRect().height > 10);
      if (!rows.length) return null;
      const r = rows[0];
      const act = r.querySelector('[data-folder-actions]');
      const before = parseFloat(getComputedStyle(act).opacity);
      const btns = [...act.querySelectorAll('button')];
      return {
        wide: window.innerWidth > 640,
        rowH: Math.round(r.getBoundingClientRect().height),
        idleVisible: before > 0.05,
        plus: btns.filter(x => (x.getAttribute('data-testid') || '').includes('newchild')).length,
        sizes: btns.map(x => Math.round(x.getBoundingClientRect().height)),
      };
    });
    // ── Q file 과 **같은 정돈**인가: 최상단 칸은 모두 같은 왼쪽 기준, 들여쓰는 것은 사람이 만든 폴더뿐.
    //   Irene 2026-09-20: *"좌측 카테고리들은 다 좌측이 맞아야지 하위폴더는 새로 만든 폴더 뿐이잖아."*
    const align = await page.evaluate(() => {
      // ★ 트리만 본다. 탭 본문 전체를 훑으면 **파일 카드**가 grid 라 같이 잡혀
      //   기준 padding 이 0 이 되고 트리 전체가 «들여쓴 것» 으로 읽힌다(2026-09-20 실측).
      const tree = document.querySelector('[data-testid="file-tree"]');
      if (!tree) return null;
      const rows = [...tree.children].filter((d) =>
        getComputedStyle(d).display === 'grid' && d.getBoundingClientRect().height > 10
        && d.children.length >= 2);
      const info = rows.map((r) => ({
        pad: Math.round(parseFloat(getComputedStyle(r).paddingLeft)),
        label: (r.children[1].textContent || '').trim().slice(0, 12),
      })).filter((x) => x.label);
      const pads = [...new Set(info.map((x) => x.pad))].sort((a, c) => a - c);
      const base = pads[0];
      return {
        rows: info.length,
        pads,
        top: info.filter((x) => x.pad === base).map((x) => x.label),
        indented: info.filter((x) => x.pad !== base).map((x) => x.label),
        hasMail: info.some((x) => /메일|Mail/.test(x.label)),
      };
    });
    if (!align) results.push({ name: '⬜ 프로젝트>파일 정돈 — 미측정', fail: 0, details: ['탭 본문을 못 찾았다'] });
    else {
      const MUST_TOP = ['전체', '채팅', '업무', '회의', '문서', '메일'];
      const missing = MUST_TOP.filter((l) => !align.top.some((t) => t.startsWith(l)));
      judge('전체·출처 칸이 모두 같은 왼쪽 기준이다', missing.length === 0,
        `최상단(pad ${align.pads[0]}): ${align.top.join(', ')}${missing.length ? ' · 빠짐: ' + missing.join(',') : ''}`);
      judge('들여쓰는 것은 사람이 만든 폴더뿐',
        align.indented.every((l) => !MUST_TOP.some((m) => l.startsWith(m))),
        `들여쓴 것: ${align.indented.join(', ') || '(없음)'}`);
      judge('메일 칸이 있다', align.hasMail, `${align.top.join(', ')}`);
    }

    if (!pf) {
      results.push({ name: '⬜ 프로젝트>파일 트리 — 미측정', fail: 0, details: ['액션 달린 폴더 행이 없다(폴더 0개)'] });
    } else {
      judge('프로젝트>파일 — 폴더 행에 [+] 가 있다', pf.plus >= 1, `[+] ${pf.plus}개`);
      // ★ 잰 것이 없으면 초록으로 내보내지 않는다 — 빈 배열은 `new Set([]).size === 0` 이라
      //   "한 규격" 이 거짓으로 통과할 뻔했다(행을 잘못 집었을 때 실제로 빈 값이 나왔다).
      judge('프로젝트>파일 — 액션 버튼을 실제로 쟀다', pf.sizes.length >= 2 && pf.rowH > 10,
        `행 ${pf.rowH}px · 버튼 ${pf.sizes.length}개`);
      judge('프로젝트>파일 — [+] 와 ⋯ 가 같은 규격', pf.sizes.length >= 2 && new Set(pf.sizes).size === 1,
        `높이 ${pf.sizes.join('/')}`);
      // 데스크탑 분기에서만 «행 밖으로 부푸는가» 를 잰다. 터치 분기(40/44px)는 규격이 그렇게 정해져
      // 있으므로 행보다 큰 게 정상 — 그걸 실패로 세면 검사기가 거짓말을 한다.
      if (pf.wide) {
        judge('프로젝트>파일 — 버튼이 행 밖으로 부풀지 않는다', pf.sizes.every(h => h <= pf.rowH + 4),
          `행 ${pf.rowH}px · 버튼 ${pf.sizes.join('/')}px`);
      } else {
        results.push({ name: '⬜ 프로젝트>파일 — 데스크탑 분기 미측정', fail: 0,
          details: [`폰 폭에서 쟀다 — 터치 규격 ${pf.sizes.join('/')}px`] });
      }
    }
  } finally {
    await sequelize.query('DELETE FROM file_folders WHERE name LIKE :t', { replacements: { t: TAG + '%' } });
    const [l] = await sequelize.query('SELECT COUNT(*) n FROM file_folders WHERE name LIKE :t', { replacements: { t: TAG + '%' } });
    judge('픽스처 원복', Number(l[0].n) === 0, `잔여 ${l[0].n}`);
    await browser.close();
  }
  return results;
}

module.exports = { run };
