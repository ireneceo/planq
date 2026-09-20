// 파일 미리보기 — 구글 바로가기(.gdoc) · 제목/액션 줄 · 영역 클릭.
//
// ★ 2026-09-20 신고 3건을 한 검사로 묶는다:
//   ① *"이 구글문서가 … 오픈을 하면 No preview available"* · *"왜 구글 드라이브에서 열려? 문서로 열려야지?"*
//      → .gdoc 은 문서가 아니라 **172 바이트 링크**다. 그 안의 id 로 docs.google.com 을 열어야 한다.
//   ② *"제목은 첫줄에 다 나오고 버튼들은 … 같은 줄로 … 우측 정렬해서? 제목이 다 잘리고 두 줄이 되는데."*
//   ③ *"미리보기 영역. 같은 곳 아무 곳이나 클릭해도 바로 열려야지."*
const b = require('/opt/planq/scripts/e2e/lib/browser');
require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env' });
const { sequelize } = require('/opt/planq/dev-backend/config/database');
const fs = require('fs');
const path = require('path');

const DOC_ID = '1SIF6l4UtOTtymKQPrxE_aMJvuWAS9lKC';
const TAG = 'ZPV' + Date.now();

async function run() {
  const results = [];
  const push = (name, ok, msg) => results.push({ name, fail: ok ? 0 : 1, details: [msg] });
  const skip = (name, msg) => results.push({ name, fail: 0, details: ['⬜ 미측정 — ' + msg] });

  const [biz] = await sequelize.query(
    'SELECT business_id b, user_id u FROM business_members WHERE business_id IN (5,73) LIMIT 1');
  if (!biz.length) { skip('미리보기', '워크스페이스 멤버를 못 찾았다'); return results; }
  const { b: bizId, u: userId } = biz[0];

  // ── 픽스처: 진짜 .gdoc 바로가기(맥/윈도우 드라이브 폴더에서 끌어온 것과 같은 모양)
  const body = JSON.stringify({ url: `https://docs.google.com/open?id=${DOC_ID}`, doc_id: DOC_ID, email: 'x@y.z' });
  const dir = path.join('/opt/planq/dev-backend/uploads', String(bizId), 'e2e');
  fs.mkdirSync(dir, { recursive: true });
  const abs = path.join(dir, `${TAG}.gdoc`);
  fs.writeFileSync(abs, body);
  const name = `${TAG}_바로가기.gdoc`;
  await sequelize.query(
    `INSERT INTO files (business_id, file_name, file_path, file_size, mime_type, storage_provider,
       uploader_id, visibility, vlevel, security_level, created_at, updated_at)
     VALUES (:b, :n, :p, :s, 'application/octet-stream', 'planq', :u, 'L3', 3, 'general', NOW(), NOW())`,
    { replacements: { b: bizId, n: name, p: abs, s: body.length, u: userId } });
  const [row] = await sequelize.query('SELECT id FROM files WHERE file_name = :n', { replacements: { n: name } });
  const fileId = row[0].id;

  const { browser, page } = await b.launch();
  try {
    await page.setViewport({ width: 1440, height: 900 });
    await b.login(page);
    // ★ 딥링크(?file=)만 믿지 않는다 — 6초 안에 안 열려 «손잡이 없음» 으로 네 건이 빨간불이었다.
    //   목록에서 **그 카드를 직접 누른다**(사용자가 하는 그대로).
    await b.goto(page, '/files');
    await b.sleep(6000);
    const clicked = await page.evaluate((tag) => {
      const c = [...document.querySelectorAll('[data-file-id]')]
        .find((x) => (x.textContent || '').includes(tag));
      if (!c) return false;
      c.click();
      return true;
    }, TAG);
    if (!clicked) {
      skip('미리보기', '픽스처 카드가 목록에 안 보인다');
      return results;
    }
    await b.sleep(3000);

    // ① 구글 바로가기 — 문서로 가는 문
    const sc = await page.evaluate(() => {
      const a = document.querySelector('[data-testid="file-preview-shortcut"]');
      const area = document.querySelector('[data-testid="file-preview-area"]');
      return {
        hasLink: !!a,
        href: a ? a.getAttribute('href') : null,
        target: a ? a.getAttribute('target') : null,
        rel: a ? a.getAttribute('rel') : null,
        areaIsLink: area ? area.tagName.toLowerCase() : null,
        areaCursor: area ? getComputedStyle(area).cursor : null,
        text: area ? (area.textContent || '').slice(0, 40) : null,
      };
    });
    push('바로가기는 «구글 문서 열기» 를 보여준다', sc.hasLink, `링크 ${sc.hasLink} · "${sc.text}"`);
    push('그 링크는 Drive 가 아니라 **문서**를 가리킨다',
      !!sc.href && sc.href === `https://docs.google.com/document/d/${DOC_ID}/edit`, `${sc.href}`);
    push('새 탭 + noopener', sc.target === '_blank' && /noopener/.test(sc.rel || ''), `${sc.target} / ${sc.rel}`);
    push('미리보기 영역 자체가 문이다 (아무 데나 눌러도 열린다)',
      sc.areaIsLink === 'a' && sc.areaCursor === 'pointer', `<${sc.areaIsLink}> cursor=${sc.areaCursor}`);

    // ② 제목 줄 / 액션 줄
    const lay = await page.evaluate(() => {
      const t = document.querySelector('[data-testid="file-preview-title"]');
      const m = document.querySelector('[data-testid="file-preview-meta"]');
      const a = document.querySelector('[data-testid="file-preview-actions"]');
      if (!t || !m || !a) return null;
      const tr = t.getBoundingClientRect(), mr = m.getBoundingClientRect(), ar = a.getBoundingClientRect();
      return {
        titleLines: Math.round(tr.height / parseFloat(getComputedStyle(t).lineHeight || '20')),
        titleBottom: Math.round(tr.bottom), actionsTop: Math.round(ar.top),
        actionsRight: Math.round(ar.right), metaRight: Math.round(mr.right),
        actionsInMeta: m.contains(a),
        titleW: Math.round(tr.width), metaW: Math.round(mr.width),
      };
    });
    if (!lay) skip('제목·액션 줄', '손잡이를 못 찾았다');
    else {
      push('버튼이 메타 줄 안에 있다', lay.actionsInMeta, `${lay.actionsInMeta}`);
      push('버튼은 제목 **아래** 줄이다 (제목 칸을 안 먹는다)',
        lay.actionsTop >= lay.titleBottom - 2, `제목 bottom ${lay.titleBottom} · 액션 top ${lay.actionsTop}`);
      push('버튼이 우측 끝에 붙는다', Math.abs(lay.actionsRight - lay.metaRight) <= 2,
        `액션 right ${lay.actionsRight} · 줄 right ${lay.metaRight}`);
      push('제목이 줄 전체를 쓴다', Math.abs(lay.titleW - lay.metaW) <= 2, `제목 ${lay.titleW} / 줄 ${lay.metaW}`);
    }

    // ③ 음성 대조군 — 바로가기가 아닌 파일도 영역이 눌린다
    const other = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('[data-file-id]')];
      const c = cards.find((x) => !/\.gdoc$/i.test((x.textContent || '')));
      if (!c) return null;
      c.click();
      return true;
    });
    if (!other) skip('일반 파일도 영역이 눌린다', '다른 파일이 없다');
    else {
      await b.sleep(2500);
      const gen = await page.evaluate(() => {
        const area = document.querySelector('[data-testid="file-preview-area"]');
        const img = document.querySelector('[data-testid="file-preview-open"]');
        return { tag: area ? area.tagName.toLowerCase() : null,
          cursor: area ? getComputedStyle(area).cursor : null, hasOpenBtn: !!img };
      });
      if (!gen.tag) skip('일반 파일도 영역이 눌린다', '그 파일은 폴백 화면이 아니다(이미지·PDF 등)');
      else push('일반 파일도 영역이 눌린다', gen.cursor === 'pointer', `<${gen.tag}> cursor=${gen.cursor}`);
    }
  } finally {
    try {
      await sequelize.query('DELETE FROM files WHERE id = :id', { replacements: { id: fileId } });
      fs.unlinkSync(abs);
    } catch { /* noop */ }
    const [left] = await sequelize.query('SELECT COUNT(*) n FROM files WHERE file_name LIKE :t', { replacements: { t: TAG + '%' } });
    push('픽스처 원복', Number(left[0].n) === 0, `잔여 ${left[0].n}`);
    try { await browser.close(); } catch { /* noop */ }
  }
  return results;
}

module.exports = { run };
