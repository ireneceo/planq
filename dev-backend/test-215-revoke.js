// #215 Fable — PDF blob objectURL 조기 revoke 실측 (검증 후 삭제)
//   구현은 언마운트 시 전량 revoke — window.open 직후 revoke 되면 새 탭 PDF 가 죽는지 측정.
const puppeteer = require('/opt/planq/dev-backend/node_modules/puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.setContent('<!doctype html><html><body></body></html>');

  const run = async (revokeDelayMs) => {
    return page.evaluate(async (delay) => {
      // 최소 유효 PDF
      const pdf = `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\nxref\n0 4\ntrailer<</Root 1 0 R/Size 4>>\n%%EOF`;
      const blob = new Blob([pdf], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const w = window.open(url, '_blank', 'noopener');
      if (delay >= 0) setTimeout(() => URL.revokeObjectURL(url), delay);
      await new Promise(r => setTimeout(r, 1500));
      // noopener 라 w=null — 대신 revoke 후 같은 URL fetch 가능 여부로 URL 생존 판정
      let alive = true;
      try { await fetch(url); } catch { alive = false; }
      return { opened: true, urlAliveAfter1500ms: alive };
    }, revokeDelayMs);
  };

  const targets = await (async () => {
    const immediate = await run(0);        // 언마운트가 open 직후 오는 최악 케이스
    const never = await run(-1);
    return { immediate, never };
  })();
  console.log('즉시 revoke:', JSON.stringify(targets.immediate));
  console.log('revoke 안함:', JSON.stringify(targets.never));

  // 실제 새 탭이 PDF 를 그렸는지 — popup target 검사 (revoke 즉시)
  const pagesBefore = (await browser.pages()).length;
  await page.evaluate(() => {
    const pdf = '%PDF-1.4\n%%EOF';
    const url = URL.createObjectURL(new Blob([pdf], { type: 'application/pdf' }));
    window.open(url, '_blank');
    URL.revokeObjectURL(url);   // open 직후 동기 revoke — 최악
  });
  await new Promise(r => setTimeout(r, 2500));
  const pages = await browser.pages();
  console.log('팝업 생성:', pages.length > pagesBefore);
  const popup = pages[pages.length - 1];
  const popupUrl = popup.url();
  let loadedOk = null;
  try {
    loadedOk = await popup.evaluate(() => document.readyState + '|' + (document.contentType || ''));
  } catch (e) { loadedOk = 'evaluate 불가: ' + e.message.slice(0, 60); }
  console.log('팝업 URL:', popupUrl.slice(0, 40), '상태:', loadedOk);

  await browser.close();
})().catch(e => { console.error('오류:', e); process.exit(2); });
