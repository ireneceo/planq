// canary-maillabel — Q Mail 목록의 **말과 범위**를 잰다 (2026-09-17)
//
//   ① 팔로우 폴더는 «확인완료» 로 비워지지 않는다
//      Irene: *"내가 팔로우 해놨던 메일리스트가 없어졌어."*
//      실측: 팔로우 3건이 전부 `archived` 였고 폴더 조건이 그것을 걸러 냈다. 데이터는 멀쩡했다.
//      팔로우는 사람이 명시적으로 «계속 보겠다» 고 건 표시이고, 확인완료는 «지금 처리했다» 는 뜻이다.
//      두 축이 다른데 한쪽이 다른 쪽을 덮어쓰고 있었다.
//
//   ② 같은 말이 목록 안에서 두 뜻으로 쓰이지 않는다
//      Irene: *"전체 메일에 답변필요 표시가 두번 나와. 빨간거 회색."*
//      실측(전체 30행): 빨간 뱃지(상태)와 회색 버튼(행위)의 **글자가 똑같았다.**
//      한 행에 둘이 같이 뜨지는 않지만, 목록을 훑는 사람에게는 행이 아니라 목록 전체가 한 장면이다.
//
//   ★ ①은 순수 판정(술어)이라 DB 없이 참/거짓이 갈린다. ②는 **화면을 직접 재야** 한다 —
//     문구는 i18n JSON·인라인 폴백·컴포넌트 세 곳에 흩어져 있어 grep 으로는 거짓 통과한다.
//
//   ★ **양성 대조군을 되돌릴 때는 `.gz` 까지 되돌린다.** 빌드된 locales 는 `gzip_static` 으로
//     미리 압축돼 서빙된다 — 평문 `qmail.json` 만 옛 문구로 바꾸면 `curl` 에는 보이지만
//     **브라우저는 옛 `.gz` 를 받아 아무 변화가 없다.** 그래서 처음엔 대조군이 «통과» 로 나왔고,
//     하마터면 «검사기가 빨간불을 못 켠다» 고 잘못 결론 낼 뻔했다. 실제로는 적용이 안 됐던 것이다.

require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env' });
const { Op } = require('/opt/planq/dev-backend/node_modules/sequelize');
const { folderWhere } = require('/opt/planq/dev-backend/services/mailFolders');
const db = require('/opt/planq/dev-backend/models');
const b = require('./lib/browser');

// 카나리 계정(health-check@planq.kr)의 워크스페이스 — 목록 첫 화면에 보이는 스레드를 픽스처로 쓴다.
const FIX_BIZ = Number(process.env.E2E_MAIL_BIZ || 5);

/** where 절을 **읽을 수 있게** 찍는다.
 *  ★ `JSON.stringify` 는 Symbol 키(`Op.in`·`Op.ne`)를 통째로 버려 `{"status":{}}` 가 된다 —
 *    무정보일 뿐 아니라, 서로 다른 두 조건이 **같은 문자열**이 되어 비교에 쓰면 항상 참이다
 *    (Fable 17차 소견: 「같은 술어다」의 앞 절이 그래서 죽어 있었다).
 */
function showWhere(w) {
  if (!w || typeof w !== 'object') return w;
  // 배열은 배열로 남긴다 — `Reflect.ownKeys` 로 풀면 `{"0":"open","1":"uncertain","length":2}` 가 되어
  //   비교에는 결정적이지만 읽을 수가 없다 (Fable 18차 소견).
  if (Array.isArray(w)) return w.map(showWhere);
  const out = {};
  for (const k of Reflect.ownKeys(w)) {
    const v = w[k];
    out[typeof k === 'symbol' ? k.toString() : k] = (v && typeof v === 'object') ? showWhere(v) : v;
  }
  return out;
}
const whereStr = (w) => JSON.stringify(showWhere(w));

// where 절이 이 status 를 받아들이는가 — Op.in / Op.ne / 없음 세 모양을 모두 읽는다.
function admits(where, status) {
  if (!where || !('status' in where)) return true;      // status 조건 자체가 없으면 전부 통과
  const c = where.status;
  if (c && typeof c === 'object') {
    if (Array.isArray(c[Op.in])) return c[Op.in].includes(status);
    if (Op.ne in c) return c[Op.ne] !== status;
    if (Array.isArray(c[Op.notIn])) return !c[Op.notIn].includes(status);
  }
  return c === status;
}

async function run() {
  const results = [];
  const push = (name, ok, msg) => results.push({ name, fail: ok ? 0 : 1, details: [msg] });

  // ── ① 팔로우 폴더의 범위 ────────────────────────────────
  const fw = folderWhere('following', 1, 5);
  push('팔로우 — 확인완료(archived)해도 남는다',
    admits(fw, 'archived'),
    `where=${whereStr(fw)} — archived 를 빼면 [모두 확인완료] 한 번에 팔로우 목록이 통째로 빈다`);
  push('팔로우 — 열린 것은 당연히 남는다 (음성 대조군)',
    admits(fw, 'open') && admits(fw, 'uncertain'),
    `open/uncertain 이 빠지면 폴더가 반대로 망가진 것이다`);
  push('팔로우 — 스팸은 그래도 뺀다 (양성 대조군)',
    !admits(fw, 'spam'),
    `스팸까지 들이면 팔로우가 쓰레기통이 된다`);

  // ★ 담당(assigned)도 같은 술어를 쓴다 — 한쪽만 고치면 같은 값의 공식이 두 벌이 된다.
  const aw = folderWhere('assigned', 1, 5);
  push('담당 — 확인완료(archived)해도 남는다',
    admits(aw, 'archived'),
    `where=${whereStr(aw)} — 팔로우와 같은 성격(사람이 명시적으로 건 표시)이다`);
  push('담당 — 스팸은 뺀다 (양성 대조군)',
    !admits(aw, 'spam'),
    `스팸까지 들이면 담당이 쓰레기통이 된다`);
  push('담당과 팔로우가 **같은 술어**다',
    whereStr(aw) === whereStr(fw)
      && ['open', 'uncertain', 'archived', 'spam', 'closed'].every((st) => admits(aw, st) === admits(fw, st)),
    `assigned=${whereStr(aw)} / following=${whereStr(fw)} — 갈라지면 한쪽만 고쳐진다`);

  // 답변필요 폴더는 종전 그대로여야 한다 — 이 수정이 옆 폴더로 번지지 않았는지.
  const rn = folderWhere('reply_needed', 1, 5);
  push('답변필요 폴더는 건드리지 않았다 (음성 대조군)',
    !admits(rn, 'archived') && admits(rn, 'open'),
    `where=${whereStr(rn)}`);

  // ── ①-b 일괄 처리의 **범위와 이어서 처리** ──────────────
  //   Fable 21차 차단2·3. 둘 다 «응답은 아무 일 없다고 하는데 실제로는 다른» 계열이다.
  const routeSrc = require('fs').readFileSync('/opt/planq/dev-backend/routes/email_threads.js', 'utf8');
  const calls = routeSrc.match(/resolveBulkTargetIds\(\s*[\s\S]{0,160}?\)/g) || [];
  //   함수 **선언부**(`(body, businessId, userId, actionWhere = {})`)가 같이 잡힌다 — 호출부만 센다.
  const callSites = calls.filter((c) => c.includes('req.body'));
  push('일괄 라우트 3곳이 **«아직 안 된 것» 술어**를 넘긴다',
    callSites.length === 3 && callSites.every((c) => /req\.user\.id\s*,\s*\{/.test(c.replace(/\s+/g, ' '))),
    callSites.length === 3
      ? `3곳 모두 4번째 인자를 넘긴다 — 안 넘기면 상한에 닿았을 때 **같은 첫 N개**(이미 처리된 것)를 다시 집어 0건이 되고, "다시 누르면 이어서 처리합니다" 가 거짓말이 된다`
      : `호출부 ${callSites.length}곳 — 3곳이어야 한다`);
  push('`thread_ids` 갈래도 **범위 SELECT 를 통과**한다',
    /const selector = \(body\?\.all/.test(routeSrc) && /EmailThread\.findAll\(\{\s*\n?\s*where: \{ \[Op\.and\]/.test(routeSrc),
    '준 id 를 그대로 쓰면 스레드 UPDATE 는 막혀도 **메시지 UPDATE(`thread_id IN`)** 가 남의 테넌트를 고친다 — 실측으로 잡혔다(응답은 updated:0)');

  // ── ② 문구 충돌 — 먼저 **원천**(i18n)에서 가른다 ────────
  //   ★ Fable 16차 소견: 처음엔 화면만 두 폴더(all·uncertain)에서 쟀는데, `uncertain` 폴더에는
  //     구조적으로 답변필요 행이 실리지 않아(그 폴더 정의가 `reply_needed:false`) **상태 뱃지가
  //     한 번도 안 뜬다** — 즉 그 검사는 영원히 초록인 잉여였다. 실효 검사는 `all` 한 곳뿐이었다.
  //     그래서 잉여 폴더를 빼고, 대신 **i18n 원천 비교**를 넣는다. 이쪽은 화면에 무엇이 실리든
  //     결정적이고, 브라우저가 한 번도 안 열어 보는 **en 까지** 덮는다.
  for (const L of ['ko', 'en']) {
    const j = require(`/opt/planq/dev-frontend/public/locales/${L}/qmail.json`);
    const badge = j.replyNeededBadge;
    const action = j.actions && j.actions.markReplyNeeded;
    push(`${L}/상태 뱃지와 액션 버튼의 말이 다르다 (원천)`,
      !!badge && !!action && badge !== action,
      `뱃지="${badge}" · 액션="${action}" — 같으면 목록에서 «같은 표시가 두 번» 으로 읽힌다`);
  }

  // ── ②-b 화면에서도 확인한다 (원천이 맞아도 화면이 다를 수 있다) ─
  //   ★ **픽스처를 직접 만든다.** 처음엔 그냥 목록을 열어 재기만 했는데, 첫 화면 30행에 답변필요인
  //     스레드가 하나도 없어 «상태» 쪽 집합에 그 말이 아예 안 담겼다 — 그래서 문구를 옛것으로
  //     되돌린 **양성 대조군이 통과했다**(빨간불을 못 켜는 검사기였다).
  //     목록에 무엇이 실리느냐는 날마다 바뀐다. 검사기가 조건을 만들어야 판정이 결정적이다.
  let fixtureId = null, prev = null;
  try {
    const t = await db.EmailThread.findOne({
      where: { business_id: FIX_BIZ, status: 'open', reply_needed: false },
      order: [['last_message_at', 'DESC']],
    });
    if (t) {
      fixtureId = t.id;
      prev = { reply_needed: t.reply_needed, reply_needed_reason: t.reply_needed_reason, reply_needed_at: t.reply_needed_at };
      await t.update({ reply_needed: true, reply_needed_reason: 'inbound', reply_needed_at: new Date() });
    }
  } catch (e) { push('픽스처 준비', false, String((e && e.message) || e)); }

  const { browser, page } = await b.launch();
  try {
    await page.setViewport({ width: 1440, height: 900 });
    await b.login(page);
    for (const folder of ['all']) {
      await b.goto(page, `/mail?folder=${folder}`);
      await b.sleep(5000);
      const m = await page.evaluate(() => {
        const rows = document.querySelectorAll('[data-testid="mail-thread-row"]');
        const states = new Set(), actions = new Set();
        rows.forEach((row) => {
          row.querySelectorAll('*').forEach((el) => {
            if (el.children.length) return;                  // 잎 노드만 — 감싸는 상자를 세면 중복된다
            const txt = (el.textContent || '').replace(/\s+/g, ' ').trim();
            if (!txt || txt.length > 20) return;
            const clickable = el.closest('button:not([data-testid="mail-thread-row"]), a');
            (clickable ? actions : states).add(txt);
          });
        });
        return { rows: rows.length, states: [...states], actions: [...actions] };
      });
      // 행이 0이면 «통과» 가 아니라 «미측정» 이다 (memory feedback_empty_fixture_false_verdict)
      if (!m.rows) { results.push({ name: `${folder}/문구 충돌 없음`, unmeasured: true, details: ['행 0건 — 잴 것이 없다'] }); continue; }
      // 픽스처가 화면에 실제로 실렸는지부터 본다 — 안 실렸으면 그 폴더는 **미측정**이다.
      const badgeText = (require('/opt/planq/dev-frontend/public/locales/ko/qmail.json').replyNeededBadge || '답변 필요');
      if (folder === 'all' && !m.states.includes(badgeText)) {
        results.push({ name: `${folder}/상태 문구와 버튼 문구가 겹치지 않는다`, unmeasured: true,
          details: [`상태 뱃지 "${badgeText}" 가 화면에 안 실렸다 — 픽스처 ${fixtureId} 가 첫 화면 밖이면 비교가 성립하지 않는다`] });
        continue;
      }
      const clash = m.states.filter((s) => m.actions.includes(s));
      push(`${folder}/상태 문구와 버튼 문구가 겹치지 않는다`,
        clash.length === 0,
        clash.length
          ? `겹친 말: ${clash.join(' · ')} — 같은 글자가 «지금 이렇다» 와 «이렇게 만들어라» 두 뜻으로 쓰인다 (행 ${m.rows})`
          : `행 ${m.rows} · 상태 ${m.states.length}종 · 액션 ${m.actions.length}종 — 겹침 0`
            + (m.states.includes(badgeText) ? ` (뱃지 "${badgeText}" 실림)` : ''));
    }
    // ── ③ 폴더 탭 배지는 **자기 축을 말한다** ──────────────
    //   「답변 필요 48」·「확인 권장 3051」 은 그 폴더의 건수이고 「전체 3475」 는 안 읽음 수다.
    //   축이 다른데 화면에 단서가 없으면 "전체 메일 3475개" 로 읽힌다(Irene: *"손봐"*).
    //   숫자는 건드리지 않는다 — 부족한 것은 **뜻**이다.
    await b.goto(page, '/mail?folder=all');
    await b.sleep(4000);
    const badges = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('button').forEach((btn) => {
        const txt = (btn.textContent || '').trim();
        // 폴더 탭만 — 숫자로 끝나고 글자가 짧은 버튼
        if (!/[가-힣A-Za-z·\s]+\d+$/.test(txt) || txt.length > 20) return;
        const num = btn.querySelector('span:last-child');
        if (!num || !/^\d+$/.test((num.textContent || '').trim())) return;
        out.push({
          tab: txt.replace(/\d+$/, '').trim(),
          n: (num.textContent || '').trim(),
          title: btn.getAttribute('title') || '',
          aria: num.getAttribute('aria-label') || '',
        });
      });
      return out;
    });
    if (!badges.length) {
      results.push({ name: '폴더 탭 배지가 자기 축을 말한다', unmeasured: true,
        details: ['숫자 배지가 붙은 탭이 0개 — 잴 것이 없다(계정에 미읽음·대기가 전부 0)'] });
    } else {
      const bad = badges.filter((x) => !x.title || !x.aria || !x.title.includes(x.n));
      push('폴더 탭 배지가 자기 축을 말한다',
        bad.length === 0,
        bad.length
          ? `설명 없는 배지: ${bad.map((x) => `${x.tab}=${x.n}`).join(' · ')}`
          : badges.map((x) => `${x.tab}=${x.n} → "${x.title}"`).join(' | '));
      // 전체 탭은 «안 읽음» 이라고 말해야 한다 — 다른 탭과 축이 다른 유일한 자리다
      const all = badges.find((x) => /전체|All/i.test(x.tab));
      if (!all) {
        results.push({ name: '「전체」 탭 배지는 안 읽음이라고 말한다', unmeasured: true,
          details: ['전체 탭에 배지가 없다(미읽음 0) — 잴 것이 없다'] });
      } else {
        push('「전체」 탭 배지는 안 읽음이라고 말한다',
          /안 ?읽음|unread/i.test(all.title),
          `"${all.title}" — 이 말이 없으면 3475 를 «전체 메일 수» 로 읽는다`);

        // ★ **폰에서도 보이는 단서가 있어야 한다.** `title` 은 터치 기기에서 한 번도 안 뜨고
        //   `aria-label` 은 보조기술 전용이다(Fable 19차 ⑥). 그래서 배지가 세는 수를
        //   **같은 화면의 일괄 버튼**이 글자로 말하는지 **폰 폭에서** 잰다.
        await page.setViewport({ width: 375, height: 667, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
        await b.goto(page, '/mail?folder=all');
        await b.sleep(4000);
        const bulk = await page.evaluate((n) => {
          const hit = [...document.querySelectorAll('button')]
            .map((el) => ({ el, txt: (el.textContent || '').replace(/\s+/g, ' ').trim() }))
            .find((x) => x.txt.includes(n) && /읽음|read/i.test(x.txt));
          if (!hit) return { found: false };
          const r = hit.el.getBoundingClientRect();
          const cx = Math.round(r.left + r.width / 2), cy = Math.round(r.top + r.height / 2);
          const top = document.elementFromPoint(cx, cy);
          return {
            found: true, txt: hit.txt, w: Math.round(r.width), h: Math.round(r.height),
            // 크기만 재면 «그려졌는데 안 보이는» 경우를 놓친다 — 그 좌표가 내 것인지까지 본다
            hit: !!(top && (top === hit.el || hit.el.contains(top))),
            inView: r.top >= 0 && r.bottom <= window.innerHeight && r.width > 0,
          };
        }, all.n);
        push('폰(375)에서 배지 수를 **글자로** 말하는 버튼이 보인다',
          bulk.found && bulk.w > 40 && bulk.h > 20 && bulk.hit && bulk.inView,
          bulk.found
            ? `"${bulk.txt}" ${bulk.w}×${bulk.h} · 클릭지점 적중 ${bulk.hit} · 화면 안 ${bulk.inView}`
            : `배지 수 ${all.n} 을 적은 버튼이 폰 화면에 없다 — title 은 터치에서 안 뜨므로 시각 단서가 0이 된다`);
        // ★ **누르기 전과 누른 뒤가 같은 수를 말해야 한다.** 라벨은 `tabBadge`, 확인 문구는
        //   `folderCounts[folder]` 를 읽고 있어서 「모두 읽음 (3475)」 → 「3522개 처리?」 로 갈렸다
        //   (Fable 20차 ②-2). 같은 값의 공식이 두 벌이면 이미 갈라져 있다.
        //   ※ 첫 클릭은 확인 단계(arm)일 뿐 아무것도 보내지 않는다 — 4초 뒤 자동 원복된다.
        const armed = await page.evaluate(async (n) => {
          const btn = [...document.querySelectorAll('button')]
            .find((el) => /읽음|read/i.test(el.textContent || '') && (el.textContent || '').includes(n));
          if (!btn) return { found: false };
          const before = (btn.textContent || '').trim();
          btn.click();
          await new Promise((r) => setTimeout(r, 400));
          return { found: true, before, after: (btn.textContent || '').trim() };
        }, all.n);
        if (!armed.found) {
          results.push({ name: '누르기 전·후가 같은 수를 말한다', unmeasured: true, details: ['버튼을 못 찾았다'] });
        } else {
          const nums = (t) => (t.match(/\d+/g) || []);
          const b0 = nums(armed.before), a0 = nums(armed.after);
          push('누르기 전·후가 같은 수를 말한다',
            b0.length > 0 && a0.length > 0 && b0[b0.length - 1] === a0[a0.length - 1],
            `"${armed.before}" → "${armed.after}" — 수가 달라지면 어느 쪽이 참인지 알 수 없다`);
        }
        await b.sleep(4500);   // 확인 상태 자동 원복(4초)을 기다린 뒤 다음 검사로
        await page.setViewport({ width: 1440, height: 900 });
      }
    }
  } catch (e) {
    push('화면 단계', false, String((e && e.message) || e));
  } finally {
    await browser.close().catch(() => null);
    // 픽스처는 반드시 되돌린다 — 남기면 다음 검사가 다른 조건에서 돈다
    //   (memory feedback_canary_pollutes_next_suite).
    if (fixtureId && prev) await db.EmailThread.update(prev, { where: { id: fixtureId } }).catch(() => null);
  }

  return results;
}

module.exports = { run };
