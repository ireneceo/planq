/* Fable 반증 — 발송 실패(400 invalid_state) 시 드로어에 에러가 실제 표시되는지 브라우저 실측. rm 예정. */
require('dotenv').config({ path: __dirname + '/.env' });
const mysql = require('mysql2/promise');
const { launch, login, goto, sleep } = require('/opt/planq/scripts/e2e/lib/browser');

const BIZ = 5;

(async () => {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost', user: process.env.DB_USER || 'planq_admin',
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME || 'planq_dev_db',
  });
  let iid = null, browser = null;
  let fail = 0;
  try {
    const [i] = await db.execute(
      `INSERT INTO invoices (business_id, client_id, invoice_number, title, total_amount, grand_total, status,
        recipient_email, created_by, currency, installment_mode, payment_method, receipt_type, created_at, updated_at)
       VALUES (?, NULL, 'FV-9201', 'FV send-fail UI', 100000, 110000, 'draft', 'fv-ui@example.com', 5, 'KRW', 'single', 'bank_transfer', 'none', NOW(), NOW())`,
      [BIZ]);
    iid = i.insertId;

    const b = await launch();
    browser = b.browser;
    const page = b.page;
    await login(page);
    await goto(page, `/bills?tab=invoices&invoice=${iid}`);
    await sleep(1500);

    // 드로어가 열려 발송 버튼이 보이는가
    const sendBtn = await page.evaluateHandle(() => {
      const drawer = document.querySelector('[role="dialog"][aria-modal="true"]');
      if (!drawer) return null;
      return [...drawer.querySelectorAll('button')].find((btn) => btn.textContent.trim() === '발송') || null;
    });
    const hasSend = await page.evaluate((el) => !!el, sendBtn);
    console.log(hasSend ? 'PASS' : 'FAIL', ' 드로어 열림 + 발송 버튼 렌더');
    if (!hasSend) { fail++; throw new Error('발송 버튼 없음 — 드로어 미개방'); }

    // 경합 재현: 다른 탭이 먼저 발송한 상태 (draft → sent)
    await db.execute("UPDATE invoices SET status='sent', sent_at=NOW() WHERE id=?", [iid]);

    await sendBtn.asElement().click();
    await sleep(600);
    // ConfirmDialog 의 Confirm 클릭
    const confirmed = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')];
      const c = btns.find((b) => b.textContent.trim() === 'Confirm');
      if (c) { c.click(); return true; }
      return false;
    });
    console.log(confirmed ? 'PASS' : 'FAIL', ' ConfirmDialog 표시 + Confirm 클릭');
    if (!confirmed) fail++;

    await sleep(2500);
    // RemindNote(경고 배너) 에 서버 메시지가 표시되는가
    const note = await page.evaluate(() => {
      const drawer = document.querySelector('[role="dialog"][aria-modal="true"]');
      if (!drawer) return null;
      const txt = drawer.innerText || '';
      return txt.includes('invalid_state') ? 'invalid_state 노출' : null;
    });
    console.log(note ? 'PASS' : 'FAIL', ' 발송 실패 메시지 드로어 표시', '→', JSON.stringify(note));
    if (!note) {
      fail++;
      const dump = await page.evaluate(() => {
        const d = document.querySelector('[role="dialog"][aria-modal="true"]');
        return d ? d.innerText.slice(0, 800) : '(no drawer)';
      });
      console.log('--- drawer text dump ---\n' + dump);
    }
    // DB 상태: 여전히 sent (발송 API 는 400 이므로 상태 무변)
    const [[{ status }]] = await db.execute('SELECT status FROM invoices WHERE id=?', [iid]);
    console.log(status === 'sent' ? 'PASS' : 'FAIL', ' 서버 상태 sent 유지(400 거부 확인)', status);
    if (status !== 'sent') fail++;
  } catch (e) {
    console.error('SCRIPT ERROR:', e.message);
    fail++;
  } finally {
    if (browser) await browser.close();
    if (iid) await db.execute('DELETE FROM invoices WHERE id=?', [iid]);
    const [[{ n }]] = await db.execute('SELECT COUNT(*) n FROM invoices WHERE business_id=?', [BIZ]);
    console.log(`원복: biz5 invoices=${n} (기준 16)`);
    await db.end();
    console.log('FAILURES=' + fail);
    process.exit(fail ? 1 : 0);
  }
})();
