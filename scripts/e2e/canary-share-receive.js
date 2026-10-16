// canary-share-receive — 다른 앱에서 «공유» 로 들어온 글·파일이 고른 곳에 **실제로 닿는가** (2026-09-29, #434 ①)
//
//   Irene #434: "이미지나 파일을 쉐어하면 … 파일로 넣을지 채팅방에 넣을지 프로젝트로 파일로 넣을지
//               다양한 경로를 선택하게 해주고 파일에서는 폴더도 만들 수 있어야 하지 않아?"
//   공유는 서비스워커가 받은 것을 캐시(planq-share-v1)에 넣고 /share-receive?shared=1 로 보낸다.
//   여기서는 **그 캐시를 직접 채워** 같은 입구로 들어간다(네이티브 공유 시트는 헤드리스로 못 띄운다).
//
// 재는 것 (폰 390 · 태블릿 820 · 데스크탑 1440)
//   ① 파일 → 프로젝트 → 새 폴더 만들기 → [여기에 저장] → DB 에 그 프로젝트·그 폴더로 들어갔다(L2)
//   ② 채팅 → 대화방 고르기 → /talk/:id 로 가고 입력칸에 글이 담겨 있다(보내지는 않는다)
//   ③ 문서 → 새 문서 편집이 열리고 제목에 첫 줄이 담겨 있다
//   ④ 카톡 «대화 내보내기» 파일 → «대화 기록으로 보관» 카드 → 회사 파일에 «카카오톡 대화 - 상대 - 날짜.txt» 로 저장(2026-10-11)
//      음성 대조군: ① 의 보통 txt 에는 카드가 안 뜬다
//   정리: 만든 파일·자동 KB 문서·폴더를 지운다(남기면 다음 실행의 목록을 더럽힌다)
require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env' });
const { sequelize } = require('/opt/planq/dev-backend/config/database');
const b = require('./lib/browser');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const BIZ = 5;
const VPS = [
  { key: '폰 360', vp: { width: 360, height: 740, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, mobile: true },
  { key: '폰 390', vp: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, mobile: true },
  { key: '태블릿 820', vp: { width: 820, height: 1180, isMobile: true, hasTouch: true } },
  { key: '데스크탑 1440', vp: { width: 1440, height: 900 } },
];

async function seedShare(page, { text, withFile, fileName = 'zz-share-canary.txt', fileBody = null }) {
  await page.evaluate(async (t, wf, fn, fb) => {
    const cache = await caches.open('planq-share-v1');
    await cache.put('/_share_payload', new Response(JSON.stringify({ title: '', text: t, url: '', fileCount: wf ? 1 : 0, ts: Date.now() }), { headers: { 'Content-Type': 'application/json' } }));
    if (wf) {
      const blob = new Blob([fb || `share canary ${Date.now()} ${Math.random()}`], { type: 'text/plain' });
      await cache.put('/_share_file_0', new Response(blob, { headers: { 'Content-Type': 'text/plain', 'X-Filename': encodeURIComponent(fn) } }));
    }
  }, text, withFile, fileName, fileBody);
}
const KAKAO_ROOM = 'zz카나리 상대';

async function run() {
  const results = [];
  const push = (name, ok, msg) => results.push({ name, fail: ok ? 0 : 1, details: [msg] });
  const since = new Date(Date.now() - 5000);
  const madeFolders = [];
  const { browser } = await b.launch();
  try {
    const [proj] = await sequelize.query(`SELECT id, name FROM projects WHERE business_id=? AND status='active' ORDER BY id LIMIT 1`, { replacements: [BIZ], type: 'SELECT' });
    for (const v of VPS) {
      const ctx = await browser.createBrowserContext();
      const page = await ctx.newPage();
      await page.setViewport(v.vp);
      await b.login(page);
      await b.goto(page, '/dashboard');
      await b.dismissBlockers(page);

      // ① 파일 → 프로젝트 폴더
      if (!proj) push(`${v.key} · ① 픽스처`, false, '활성 프로젝트 없음 — 미측정');
      else {
        await seedShare(page, { text: 'zz 공유 파일', withFile: true });
        await b.goto(page, '/share-receive?shared=1');
        await b.dismissBlockers(page);
        const noCard = await page.$('[data-testid="share-chat-export"]');
        push(`${v.key} · ④ 음성 대조 — 보통 txt 에는 대화 기록 카드가 없다`, !noCard, noCard ? '카드가 떴다' : '없음');
        const reco = await page.$('[data-testid="share-reco-file"]');
        push(`${v.key} · ⑤ 문서 파일이면 추천은 «프로젝트 파일로 저장»`, !!reco, reco ? '추천 카드 file' : '추천 카드가 file 이 아니다');
        await page.click('[data-testid="share-reco-go"]').catch(() => null);
        await sleep(1200);
        const chip = await page.evaluateHandle((name) => Array.from(document.querySelectorAll('[data-testid="share-project-row"]')).find((x) => (x.querySelector('span') || x).innerText.trim() === name) || null, proj.name);
        const hasChip = await chip.evaluate((x) => !!x);
        if (!hasChip) push(`${v.key} · ① 프로젝트 고르기`, false, `«${proj.name}» 칩이 없다`);
        else {
          await chip.click(); await sleep(900);
          const fname = `zz-share-${v.vp.width}-${Date.now() % 100000}`;
          await page.type('[data-testid="share-new-folder"]', fname);
          await page.evaluate(() => { const x = Array.from(document.querySelectorAll('[data-testid="share-place-picker"] button')).find((e) => /\+ (폴더|Folder)/.test(e.innerText)); x && x.click(); });
          await sleep(1200);
          const [fold] = await sequelize.query(`SELECT id, project_id FROM file_folders WHERE business_id=? AND name=?`, { replacements: [BIZ, fname], type: 'SELECT' });
          if (fold) madeFolders.push(fold.id);
          push(`${v.key} · ① 새 폴더가 그 프로젝트에 생긴다`, !!fold && Number(fold.project_id) === Number(proj.id), JSON.stringify(fold || null));
          await page.click('[data-testid="share-place-save"]').catch(() => null);
          await sleep(3000);
          const doneTxt = await page.evaluate(() => (document.querySelector('[data-testid="share-done-where"]') || {}).innerText || null);
          push(`${v.key} · ⑥ 저장 뒤 «프로젝트 › 폴더» 를 화면이 말한다(DB 이름과 같다)`, !!doneTxt && doneTxt.includes(proj.name) && doneTxt.includes(fname), String(doneTxt));
          await page.click('[data-testid="share-done-open"]').catch(() => null);
          await sleep(2500);
          const at = await page.evaluate(() => location.pathname + location.search);
          const [row] = await sequelize.query(
            `SELECT id, project_id, folder_id, vlevel FROM files WHERE business_id=? AND file_name='zz-share-canary.txt' AND created_at >= ? ORDER BY id DESC LIMIT 1`,
            { replacements: [BIZ, since], type: 'SELECT' });
          push(`${v.key} · ① [여기에 저장] → 그 프로젝트·그 폴더(L2) · 프로젝트 파일 탭으로 이동`,
            !!row && !!fold && Number(row.project_id) === Number(proj.id) && Number(row.folder_id) === Number(fold.id) && row.vlevel === 'L2' && at.includes(`/projects/p/${proj.id}`),
            `${JSON.stringify(row || null)} · 이동 ${at}`);
        }
      }

      // ⑨ 사진 1장 — 썸네일이 실제로 그려지고, 폰에선 스크롤 없이 추천 카드가 보인다(알림 배너 숨김)
      await page.evaluate(async () => {
        const c = await caches.open('planq-share-v1');
        const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (ch) => ch.charCodeAt(0));
        await c.put('/_share_payload', new Response(JSON.stringify({ title: '', text: '', url: '', fileCount: 1, ts: Date.now() }), { headers: { 'Content-Type': 'application/json' } }));
        await c.put('/_share_file_0', new Response(new Blob([png], { type: 'image/png' }), { headers: { 'Content-Type': 'image/png', 'X-Filename': encodeURIComponent('zz-share-photo.png') } }));
      });
      await b.goto(page, '/share-receive?shared=1');
      await b.dismissBlockers(page);
      await sleep(1500);
      const ph = await page.evaluate(() => {
        const img = document.querySelector('[data-testid="share-thumb"]');
        const card = document.querySelector('[data-testid="share-reco-chat"]');
        const ir = img && img.getBoundingClientRect();
        const hit = ir && document.elementFromPoint(ir.left + ir.width / 2, ir.top + ir.height / 2);
        const cr = card && card.getBoundingClientRect();
        return { img: ir ? { w: Math.round(ir.width), h: Math.round(ir.height), loaded: img.complete && img.naturalWidth > 0, hit: !!(hit && img.contains(hit)) } : null,
          cardBottom: cr ? Math.round(cr.bottom) : null, vh: window.innerHeight };
      });
      push(`${v.key} · ⑨ 사진은 썸네일이 그려진다`, !!ph.img && ph.img.w >= 60 && ph.img.loaded && ph.img.hit, JSON.stringify(ph.img));
      push(`${v.key} · ⑨ 사진이면 추천 «채팅» 카드가 스크롤 없이 보인다`, ph.cardBottom !== null && ph.cardBottom <= ph.vh, `카드 아래 ${ph.cardBottom} / 화면 ${ph.vh}`);

      // ④ 카톡 대화 내보내기 → 대화 기록으로 보관(회사 파일 맨 위)
      await seedShare(page, { text: '', withFile: true, fileName: 'KakaoTalkChats.txt',
        fileBody: `\uFEFF${KAKAO_ROOM} 님과 카카오톡 대화\n저장한 날짜 : 2026-10-11 14:22:10\n\n2026년 10월 1일 오후 2:01, ${KAKAO_ROOM} : 견적 부탁드려요 ${Date.now()}` });
      await b.goto(page, '/share-receive?shared=1');
      await b.dismissBlockers(page);
      await sleep(600);
      const card = await page.evaluate(() => {
        const c = document.querySelector('[data-testid="share-chat-export"]');
        if (!c) return null;
        const r = c.getBoundingClientRect();
        const btn = c.querySelector('[data-testid="share-chat-export-save"]');
        const br = btn && btn.getBoundingClientRect();
        const hit = br && document.elementFromPoint(br.left + br.width / 2, br.top + br.height / 2);
        return { text: c.innerText, h: r.height, btnHit: !!(hit && btn.contains(hit)), chip: Array.from(document.querySelectorAll('[title]')).map((x) => x.getAttribute('title')).find((x) => /카카오톡 대화/.test(x || '')) || null };
      });
      push(`${v.key} · ④ 카톡 파일이면 카드가 뜨고 상대 이름·바뀐 파일 이름이 보인다`,
        !!card && card.text.includes(KAKAO_ROOM) && card.btnHit && !!card.chip && card.chip.startsWith(`카카오톡 대화 - ${KAKAO_ROOM} - `),
        JSON.stringify(card));
      if (card) {
        await page.click('[data-testid="share-chat-export-save"]').catch(() => null);
        await sleep(1200);
        await page.click('[data-testid="share-project-company"]').catch(() => null);
        await sleep(600);
        await page.click('[data-testid="share-place-save"]').catch(() => null);
        await sleep(3000);
        await page.click('[data-testid="share-done-open"]').catch(() => null);
        await sleep(2000);
        const [kf] = await sequelize.query(`SELECT id, file_name, project_id, folder_id FROM files WHERE business_id=? AND file_name LIKE ? AND created_at >= ? ORDER BY id DESC LIMIT 1`,
          { replacements: [BIZ, `카카오톡 대화 - ${KAKAO_ROOM} - %`, since], type: 'SELECT' });
        const at = await page.evaluate(() => location.pathname);
        push(`${v.key} · ④ [대화 기록으로 보관] → [여기에 저장] → 회사 파일에 바뀐 이름으로 저장`, !!kf && !kf.project_id && /\.txt$/.test(kf.file_name) && at.startsWith('/files'), `${JSON.stringify(kf || null)} · 이동 ${at}`);
      }

      // ② 채팅 → 대화방
      await seedShare(page, { text: 'zz 공유 채팅 글', withFile: false });
      await b.goto(page, '/share-receive?shared=1');
      await b.dismissBlockers(page);
      const recoChat = await page.$('[data-testid="share-reco-chat"]');
      push(`${v.key} · ⑤ 글이면 추천은 «채팅으로 보내기»`, !!recoChat, recoChat ? 'chat' : '추천 카드가 chat 이 아니다');
      await page.click('[data-testid="share-reco-go"]').catch(() => null);
      await sleep(1500);
      const nConv = await page.$$eval('[data-testid="share-conv-row"]', (xs) => xs.length);
      if (!nConv) push(`${v.key} · ② 대화방 목록`, false, '대화방 0 — 미측정');
      else {
        // 고른 대화방 id — 첫 행. Q talk 는 /talk/:id 를 /talk?conv=id 로 정리하므로 둘 다 받는다.
        const want = await page.evaluate(() => {
          const r = document.querySelector('[data-testid="share-conv-row"]');
          return r ? r.getAttribute('data-conv-id') : null;
        });
        await page.click('[data-testid="share-conv-row"]');
        await sleep(3500);
        const st = await page.evaluate(() => {
          const ta = Array.from(document.querySelectorAll('textarea')).find((x) => x.value && x.value.includes('zz 공유 채팅 글'));
          const m = location.pathname.match(/^\/talk\/(\d+)/);
          const conv = m ? m[1] : new URLSearchParams(location.search).get('conv');
          return { url: location.pathname + location.search, conv, filled: !!ta };
        });
        push(`${v.key} · ② 고른 대화방이 열리고 입력칸에 글이 담김(보내지 않음)`, !!want && st.conv === want && st.filled, JSON.stringify({ want, ...st }));
        const band = await page.evaluate(() => { const e = document.querySelector('[data-testid="chat-shared-band"]'); if (!e) return null; const r = e.getBoundingClientRect(); const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { h: Math.round(r.height), hit: !!(h && e.contains(h)) }; });
        push(`${v.key} · ⑦ 대화방 입력칸 위에 «담겨 있어요» 줄이 보인다`, !!band && band.h > 0 && band.hit, JSON.stringify(band));
        // 입력칸 비우기 — 초안으로 남으면 다음 실행·사람 화면에 섞인다
        await page.evaluate(() => { const ta = Array.from(document.querySelectorAll('textarea')).find((x) => x.value && x.value.includes('zz 공유 채팅 글')); if (ta) { const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(ta, ''); ta.dispatchEvent(new Event('input', { bubbles: true })); } });
        await sleep(500);
        const bandGone = await page.$('[data-testid="chat-shared-band"]');
        push(`${v.key} · ⑦ 입력칸을 비우면 그 줄이 사라진다`, !bandGone, bandGone ? '남아 있다' : '사라짐');
      }

      // ⑧ 최근 칩 — 방금 보낸 대화방이 다음 공유의 추천 카드에 칩으로 뜬다 · 검색이 그 방을 찾는다
      if (nConv) {
        await seedShare(page, { text: 'zz 공유 최근', withFile: false });
        await b.goto(page, '/share-receive?shared=1');
        await b.dismissBlockers(page);
        await sleep(1800);
        const chips = await page.$$eval('[data-testid="share-recent-chip"]', (xs) => xs.map((x) => x.innerText.trim()));
        push(`${v.key} · ⑧ 방금 보낸 대화방이 최근 칩으로 뜬다`, chips.length > 0, JSON.stringify(chips));
        await page.click('[data-testid="share-reco-go"]').catch(() => null);
        await sleep(1200);
        const target = chips[0] || '';
        const q = target.replace(/\s+/g, ' ').slice(0, 4);
        if (q.trim()) {
          await page.type('[data-testid="share-search"]', q);
          await sleep(500);
          const first = await page.evaluate(() => { const r = document.querySelector('[data-testid="share-conv-row"] span'); return r ? r.innerText.trim() : null; });
          push(`${v.key} · ⑧ 검색 «${q}» → 맞는 방이 첫 행`, !!first && first.includes(q.trim()), String(first));
        }
      }

      // ③ 문서
      await seedShare(page, { text: 'zz 공유 문서 제목\n둘째 줄 본문', withFile: false });
      await b.goto(page, '/share-receive?shared=1');
      await b.dismissBlockers(page);
      await page.click('[data-testid="share-dest-doc"]').catch(() => null);
      await sleep(3500);
      const d = await page.evaluate(() => {
        const inp = Array.from(document.querySelectorAll('input, textarea')).find((x) => x.value === 'zz 공유 문서 제목');
        return { path: location.pathname, title: !!inp, body: document.body.innerText.includes('둘째 줄 본문') };
      });
      push(`${v.key} · ③ 새 문서가 열리고 제목·본문이 담김`, d.path.startsWith('/docs') && d.title && d.body, JSON.stringify(d));
      // 새 문서 편집을 떠난다(저장 안 된 새 문서) — 이탈 확인창에 막히지 않게 페이지를 닫는다
      await ctx.close();
    }
  } finally {
    await browser.close().catch(() => null);
    // 정리 — 파일 → 자동 KB → 폴더 순
    const rows = await sequelize.query(`SELECT id FROM files WHERE business_id=? AND (file_name='zz-share-canary.txt' OR file_name LIKE ?) AND created_at >= ?`, { replacements: [BIZ, `카카오톡 대화 - ${KAKAO_ROOM} - %`, since], type: 'SELECT' });
    const ids = rows.map((r) => r.id);
    if (ids.length) {
      const kb = await sequelize.query('SELECT id FROM kb_documents WHERE source_file_id IN (?)', { replacements: [ids], type: 'SELECT' });
      const kid = kb.map((k) => k.id);
      if (kid.length) {
        await sequelize.query('DELETE FROM kb_chunks WHERE kb_document_id IN (?)', { replacements: [kid] }).catch(() => null);
        await sequelize.query('DELETE FROM kb_documents WHERE id IN (?)', { replacements: [kid] });
      }
      await sequelize.query('DELETE FROM files WHERE id IN (?)', { replacements: [ids] });
    }
    if (madeFolders.length) await sequelize.query('DELETE FROM file_folders WHERE id IN (?)', { replacements: [madeFolders] });
    await sequelize.query(`DELETE FROM posts WHERE business_id=? AND title='zz 공유 문서 제목'`, { replacements: [BIZ] }).catch(() => null);
    results.push({ name: '정리', fail: 0, details: [`파일 ${ids.length} · 폴더 ${madeFolders.length}`] });
  }
  return results;
}

module.exports = { name: '공유 받기 — 파일→프로젝트 폴더 · 채팅→대화방 · 문서 (#434 ①) · 카톡 대화 기록', run };
