// canary-social-admin — 플랫폼 관리자 «SNS 발송» 단계 1 (2026-10-22, docs/SNS_PUBLISH_DESIGN.md §10)
//
//   재는 것 — 폰 390 · 태블릿 820 · 데스크탑 1440:
//     ① 글 목록 행 수 = 인사이트 공개 글 수(BLOG_WHERE, how-to 제외) · 첫 행이 가려지지 않고 보인다 · 가로 넘침 0
//     ② 글을 누르면 우측 패널: 링크 미리보기 이미지와 카드 4장이 실제로 그려진다(naturalWidth) · 채널 소재에 Threads 가 있다
//     ③ 채널 탭: 6채널 카드(Threads 포함) · «연결하려면» 을 누르면 안내 글이 보인다
//   폰 390 에서 한 번 — 상태 전이를 화면으로:
//     ④ Threads 본문을 고치면 자동저장 PATCH 가 DB 에 닿는다 → [승인] → DB approved → 다시 고치면 DB draft(승인 풀림)
//     ⑤ 카카오(반자동) [승인] → [게시함 표시] → 확인창 → DB sent · 본문은 읽기 전용이 된다
//   픽스처: 대상 글 1편에 버전 990 게시물 2건(이미 만든 카드 파일을 가리킨다 — LLM 을 부르지 않는다).
//   ★ 임시 platform_admin 을 만들고 finally 에서 지운다. 심은 게시물(버전 990)도 지운다.
require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env' });
const { sequelize } = require('/opt/planq/dev-backend/config/database');
const bcrypt = require('/opt/planq/dev-backend/node_modules/bcryptjs');
const b = require('./lib/browser');

const WIDTHS = [
  { name: '폰 390', width: 390, height: 844, isMobile: true, hasTouch: true },
  { name: '태블릿 820', width: 820, height: 1180, isMobile: true, hasTouch: true },
  { name: '데스크탑 1440', width: 1440, height: 900 },
];
const ANGLE = 990;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run() {
  const results = [];
  const push = (n, ok, m) => results.push({ name: n, fail: ok === null ? 0 : (ok ? 0 : 1), details: [(ok === null ? '⬜ 미측정 — ' : '') + m] });
  let uid = null;
  let articleId = null;
  const cred = { email: `adminsns-${Date.now()}@test.planq.kr`, password: 'AdminSocial2026!' };
  try {
    // 대상 글 — 카드가 이미 있는 글(만든 소재가 있는 공개 글). 없으면 ②④⑤ 는 미측정.
    const [[src]] = await sequelize.query(
      `SELECT sp.article_id, sp.media FROM social_posts sp JOIN help_articles a ON a.id = sp.article_id
        WHERE a.blog_published_at IS NOT NULL AND a.is_published = 1 AND a.visibility = 'public'
          AND (a.blog_category IS NULL OR a.blog_category <> 'how-to') AND JSON_LENGTH(sp.media) >= 4 AND sp.angle < ${ANGLE}
        ORDER BY sp.id LIMIT 1`);
    const [[{ n: expectRows }]] = await sequelize.query(
      `SELECT COUNT(*) n FROM help_articles WHERE blog_published_at IS NOT NULL AND is_published = 1 AND visibility = 'public'
          AND (blog_category IS NULL OR blog_category <> 'how-to')`);

    const [[ps]] = await sequelize.query('SELECT terms_version, privacy_version FROM platform_settings LIMIT 1');
    const [id] = await sequelize.query(
      `INSERT INTO users (email, password_hash, name, username, platform_role,
                          terms_version, terms_accepted_at, privacy_version, privacy_accepted_at, created_at, updated_at)
       VALUES (?, ?, 'AdminSocial Canary', ?, 'platform_admin', ?, NOW(), ?, NOW(), NOW(), NOW())`,
      { replacements: [cred.email, await bcrypt.hash(cred.password, 12), `adsns${Date.now()}`,
                       (ps && ps.terms_version) || '1.0', (ps && ps.privacy_version) || '1.0'] });
    uid = id;

    let threadsId = null; let kakaoId = null;
    if (src) {
      articleId = src.article_id;
      const media = typeof src.media === 'string' ? JSON.parse(src.media) : src.media;
      const ins = async (provider, m, body) => {
        const [pid] = await sequelize.query(
          `INSERT INTO social_posts (article_id, provider, angle, kind, body, media, status, created_by, created_at, updated_at)
           VALUES (?, ?, ${ANGLE}, ?, ?, ?, 'draft', ?, NOW(), NOW())`,
          { replacements: [articleId, provider, m.length > 1 ? 'carousel' : 'image', body, JSON.stringify(m), uid] });
        return pid;
      };
      threadsId = await ins('threads', media, '[확인용] 카나리 스레드 본문');
      kakaoId = await ins('kakao', media.slice(0, 1), '[확인용] 카나리 카카오 본문');
    }
    const dbPost = async (pid) => (await sequelize.query('SELECT status, body FROM social_posts WHERE id = ?', { replacements: [pid] }))[0][0];

    const { browser, page } = await b.launch();
    try {
      await page.setViewport({ width: 1440, height: 900 });
      await b.login(page, cred);
      for (const vp of WIDTHS) {
        await page.setViewport(vp);
        await b.goto(page, '/admin/social');
        await page.waitForSelector('[data-testid^="social-article-"]', { timeout: 15000 }).catch(() => null);
        const list = await page.evaluate(() => {
          const rows = [...document.querySelectorAll('[data-testid^="social-article-"]')];
          const r0 = rows[0] && rows[0].getBoundingClientRect();
          const hit = r0 ? document.elementFromPoint(r0.left + r0.width / 2, r0.top + Math.min(r0.height / 2, 20)) : null;
          return { rows: rows.length, firstVisible: !!(r0 && hit && rows[0].contains(hit)), overflowX: document.documentElement.scrollWidth - window.innerWidth };
        });
        push(`① ${vp.name} 목록 행 = 공개 인사이트 글 수(${expectRows}) · 첫 행 보임 · 가로 넘침 0`,
          list.rows === Number(expectRows) && list.firstVisible && list.overflowX <= 0, JSON.stringify(list));

        if (articleId) {
          await b.goto(page, `/admin/social?article=${articleId}`);
          await page.waitForSelector('[data-testid="social-post-threads"]', { timeout: 15000 }).catch(() => null);
          await sleep(1500);
          const d = await page.evaluate(() => {
            const dlg = document.querySelector('[aria-modal="true"], [role="dialog"]');
            const imgs = dlg ? [...dlg.querySelectorAll('img')] : [];
            const og = imgs.filter((i) => /og\.jpg/.test(i.src));
            const cards = imgs.filter((i) => i.src.startsWith('blob:'));
            const th = document.querySelector('[data-testid="social-post-threads"]');
            const r = th && th.getBoundingClientRect();
            return {
              og: og.length, ogDrawn: og.every((i) => i.naturalWidth > 0),
              cards: cards.length, cardsDrawn: cards.filter((i) => i.naturalWidth > 0).length,
              threads: !!(r && r.width > 0 && r.height > 0),
              providers: [...document.querySelectorAll('[data-testid^="social-post-"]')].map((e) => e.getAttribute('data-testid').slice(12)),
            };
          });
          push(`② ${vp.name} 패널 — 카드 4장 그려짐 · Threads 소재 있음${d.og ? ' · 미리보기 이미지 그려짐' : ''}`,
            d.cardsDrawn >= 4 && d.threads && d.ogDrawn, JSON.stringify(d));
        } else push(`② ${vp.name} 패널`, null, '카드가 있는 소재가 없어 패널 검사를 못 함');

        await b.goto(page, '/admin/social?tab=channels');
        await page.waitForSelector('[data-testid="social-channel-threads"]', { timeout: 10000 }).catch(() => null);
        const chBefore = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="social-channel-"]')].map((e) => e.getAttribute('data-testid').slice(15)));
        await page.evaluate(() => { const btn = document.querySelector('[data-testid="social-channel-threads"] button'); if (btn) btn.click(); });
        await sleep(300);
        const guide = await page.evaluate(() => {
          const card = document.querySelector('[data-testid="social-channel-threads"]');
          const p = card && card.querySelectorAll('p');
          const last = p && p[p.length - 1];
          const r = last && last.getBoundingClientRect();
          return { text: last ? last.textContent.slice(0, 30) : '', h: r ? r.height : 0 };
        });
        push(`③ ${vp.name} 채널 탭 — 6채널(Threads 포함) · 안내 펼침`,
          chBefore.length === 6 && chBefore.includes('threads') && guide.h > 0 && /threads/i.test(guide.text), JSON.stringify({ chBefore, guide }));
      }

      // ④⑤ 폰 390 — 상태 전이를 화면으로
      if (threadsId) {
        await page.setViewport(WIDTHS[0]);
        let patches = 0;
        const onReq = (req) => { if (req.method() === 'PATCH' && /\/api\/admin\/social\/posts\//.test(req.url())) patches += 1; };
        page.on('request', onReq);
        await b.goto(page, `/admin/social?article=${articleId}`);
        await page.waitForSelector(`#sp-body-${threadsId}`, { timeout: 15000 });
        await page.click(`#sp-body-${threadsId}`);
        await page.keyboard.press('End');
        await page.type(`#sp-body-${threadsId}`, ' 수정1');
        await sleep(3500);
        const a1 = await dbPost(threadsId);
        await page.click('[data-testid="social-approve-threads"]');
        await sleep(1500);
        const a2 = await dbPost(threadsId);
        await page.click(`#sp-body-${threadsId}`);
        await page.keyboard.press('End');
        await page.type(`#sp-body-${threadsId}`, ' 수정2');
        await sleep(3500);
        const a3 = await dbPost(threadsId);
        const chip = await page.evaluate(() => {
          const c = document.querySelector('[data-testid="social-post-threads"]');
          return c ? c.textContent : '';
        });
        page.off('request', onReq);
        push('④ 폰 — Threads 본문 자동저장 → 승인 → 다시 고치면 초안',
          a1.body.endsWith('수정1') && a1.status === 'draft' && a2.status === 'approved' && a3.status === 'draft' && a3.body.endsWith('수정2') && patches === 2,
          JSON.stringify({ a1: a1.status, a2: a2.status, a3: a3.status, patches, chipHasDraft: /초안/.test(chip) }));

        await page.click('[data-testid="social-approve-kakao"]');
        await sleep(1500);
        const k1 = await dbPost(kakaoId);
        const clicked = await page.evaluate(() => {
          const card = document.querySelector('[data-testid="social-post-kakao"]');
          const btn = card && [...card.querySelectorAll('button')].find((x) => /게시함 표시/.test(x.textContent));
          if (btn) btn.click();
          return !!btn;
        });
        await sleep(600);
        const confirmed = await page.evaluate(() => {
          const dlg = [...document.querySelectorAll('[aria-modal="true"]')].pop();
          const btn = dlg && [...dlg.querySelectorAll('button')].find((x) => /게시함 표시/.test(x.textContent));
          if (btn) btn.click();
          return !!btn;
        });
        await sleep(1500);
        const k2 = await dbPost(kakaoId);
        const readOnly = await page.evaluate((pid) => !document.querySelector(`#sp-body-${pid}`), kakaoId);
        push('⑤ 폰 — 카카오 승인 → 게시함 표시(확인창) → DB sent · 본문 읽기 전용',
          k1.status === 'approved' && clicked && confirmed && k2.status === 'sent' && readOnly,
          JSON.stringify({ k1: k1.status, clicked, confirmed, k2: k2.status, readOnly }));
      } else {
        push('④ 상태 전이', null, '픽스처 없음');
        push('⑤ 게시함 표시', null, '픽스처 없음');
      }
    } finally { await browser.close().catch(() => null); }
  } catch (e) {
    push('카나리 실행', false, String((e && e.message) || e));
  } finally {
    if (articleId) await sequelize.query(`DELETE FROM social_posts WHERE article_id = ? AND angle = ${ANGLE}`, { replacements: [articleId] }).catch(() => {});
    if (uid) {
      await sequelize.query('DELETE FROM refresh_tokens WHERE user_id = ?', { replacements: [uid] }).catch(() => {});
      await sequelize.query('DELETE FROM users WHERE id = ?', { replacements: [uid] }).catch(() => {});
    }
  }
  return results;
}

module.exports = { run };
