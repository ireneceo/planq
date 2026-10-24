// 세금 설정·표기 — 칸 추가 + 세율 칸 넓히기 + 월정액 세율 백필. 멱등. 2026-10-24.
//   설계 docs/TAX_SETTINGS_DESIGN.md §5 (Fable 판정 고칠 점 4·11, 결정 4).
//
//   ① 칸 추가(MySQL 8 INSTANT): businesses.tax_enabled · tax_label · default_tax_mode / invoices.tax_mode /
//      client_subscriptions.tax_mode / post_billing_terms.tax_mode / projects.monthly_vat_rate · monthly_tax_mode.
//      기존 행 = exclusive(세금 별도) — 지금 공식 그대로라 금액이 안 바뀐다.
//   ② 세율 칸 넓히기 DECIMAL(4,3) → DECIMAL(5,4)(테이블 복사 — ①과 따로 돈다): businesses.default_vat_rate ·
//      invoices.vat_rate · post_billing_terms.vat_rate. 기본값·NULL 허용은 그대로 다시 적는다(sync alter 안 씀).
//      quotes.vat_rate · platform_settings.default_vat_rate 는 범위 밖(그대로).
//   ③ 월정액 백필: projects.monthly_vat_rate IS NULL 인 행 = «지금 실제로 청구되는 세율» = 워크스페이스 default_vat_rate(없으면 0.1).
//      (옛 엔진 `Number(business.default_vat_rate || 0.1)` — DB 는 DECIMAL 을 문자열 "0.000" 으로 주므로 0% 는 0 으로 청구돼 왔다.
//       그래서 SQL COALESCE 와 같은 값이다.) 이후 월정액은 워크스페이스 설정을 바꿔도 안 바뀐다(구독과 같은 스냅샷).
//   검증: 청구서(id·공급가·세액·합계·세율) + 분할 회차 금액 해시가 전후 같아야 한다 · 월정액 «다음 청구 예상액» 이 전후 같아야 한다.
//   롤백: 코드만 되돌린다. 칸은 남긴다(넓힌 세율 칸은 옛 코드가 그대로 읽는다).
require('dotenv').config();
const crypto = require('crypto');
const { sequelize } = require('../config/database');
const { splitTax } = require('../services/taxCalc');

const TAG = '[migrate-tax-mode]';
const q = (s, r) => sequelize.query(s, { replacements: r }).then(([x]) => x);

async function colType(table, col) {
  const r = await q(`SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`, [table, col]);
  return r.length ? String(r[0].COLUMN_TYPE).toLowerCase() : null;
}

async function moneyHash() {
  const inv = await q('SELECT id, subtotal, tax_amount, grand_total, vat_rate FROM invoices ORDER BY id');
  const ins = await q('SELECT id, amount FROM invoice_installments ORDER BY id');
  const h = crypto.createHash('sha256');
  for (const r of inv) h.update(`${r.id}|${Number(r.subtotal)}|${Number(r.tax_amount)}|${Number(r.grand_total)}|${r.vat_rate == null ? 'null' : Number(r.vat_rate)}\n`);
  for (const r of ins) h.update(`i${r.id}|${Number(r.amount)}\n`);
  return { hash: h.digest('hex').slice(0, 16), invoices: inv.length, installments: ins.length };
}

// 월정액 다음 청구 예상액 — 옛 식(워크스페이스 기본) vs 새 식(프로젝트 스냅샷 ?? 워크스페이스 기본)
async function monthlyExpect(useSnapshot) {
  const hasSnap = !!(await colType('projects', 'monthly_vat_rate'));
  const rows = await q(`SELECT p.id, p.monthly_fee, b.default_vat_rate, b.default_currency${hasSnap ? ', p.monthly_vat_rate' : ''}
                          FROM projects p JOIN businesses b ON b.id = p.business_id
                         WHERE p.monthly_fee IS NOT NULL AND p.monthly_fee > 0 ORDER BY p.id`);
  return rows.map((r) => {
    const ws = Number(r.default_vat_rate || 0.1);          // 옛 엔진 식 그대로(문자열 "0.000" 은 참이라 0 이 된다)
    const rate = useSnapshot && r.monthly_vat_rate != null ? Number(r.monthly_vat_rate) : ws;
    return `${r.id}|${splitTax({ amount: Number(r.monthly_fee), rate, mode: 'exclusive', currency: r.default_currency || 'KRW' }).total}`;
  }).join('\n');
}

const ADDS = [
  ['businesses', 'tax_enabled', 'TINYINT(1) NOT NULL DEFAULT 1'],
  ['businesses', 'tax_label', 'VARCHAR(20) NULL DEFAULT NULL'],
  ['businesses', 'default_tax_mode', "ENUM('exclusive','inclusive') NOT NULL DEFAULT 'exclusive'"],
  ['invoices', 'tax_mode', "ENUM('exclusive','inclusive') NOT NULL DEFAULT 'exclusive'"],
  ['client_subscriptions', 'tax_mode', "ENUM('exclusive','inclusive') NOT NULL DEFAULT 'exclusive'"],
  ['post_billing_terms', 'tax_mode', "ENUM('exclusive','inclusive') NOT NULL DEFAULT 'exclusive'"],
  ['projects', 'monthly_vat_rate', 'DECIMAL(5,4) NULL DEFAULT NULL'],
  ['projects', 'monthly_tax_mode', "ENUM('exclusive','inclusive') NOT NULL DEFAULT 'exclusive'"],
];
const WIDEN = [
  ['businesses', 'default_vat_rate', 'DECIMAL(5,4) NULL DEFAULT 0.1000'],
  ['invoices', 'vat_rate', 'DECIMAL(5,4) NULL DEFAULT 0.1000'],
  ['post_billing_terms', 'vat_rate', 'DECIMAL(5,4) NOT NULL DEFAULT 0.1000'],
];

(async () => {
  try {
    const before = await moneyHash();
    const expectBefore = await monthlyExpect(false);
    console.log(`${TAG} 전: 청구서 ${before.invoices} · 회차 ${before.installments} · 해시 ${before.hash}`);

    // ① 칸 추가
    for (const [t, c, def] of ADDS) {
      if (await colType(t, c)) { console.log(`${TAG} ${t}.${c} 이미 있음 — skip`); continue; }
      await sequelize.query(`ALTER TABLE \`${t}\` ADD COLUMN \`${c}\` ${def}`);
      console.log(`${TAG} ${t}.${c} 추가`);
    }
    // ② 넓히기 (따로)
    for (const [t, c, def] of WIDEN) {
      const ty = await colType(t, c);
      if (!ty) throw new Error(`${t}.${c} 없음`);
      if (ty === 'decimal(5,4)') { console.log(`${TAG} ${t}.${c} 이미 decimal(5,4) — skip`); continue; }
      await sequelize.query(`ALTER TABLE \`${t}\` MODIFY COLUMN \`${c}\` ${def}`);
      console.log(`${TAG} ${t}.${c} ${ty} → decimal(5,4)`);
    }
    // ③ 월정액 백필 — NULL 만(두 번째 실행은 0행)
    const [, meta] = await sequelize.query(`UPDATE projects p JOIN businesses b ON b.id = p.business_id
                                               SET p.monthly_vat_rate = COALESCE(b.default_vat_rate, 0.1)
                                             WHERE p.monthly_vat_rate IS NULL AND p.monthly_fee IS NOT NULL AND p.monthly_fee > 0`);
    console.log(`${TAG} 월정액 세율 백필 ${meta?.affectedRows ?? meta ?? 0}행`);
    const zero = await q(`SELECT COUNT(DISTINCT b.id) AS ws, COUNT(p.id) AS projects FROM projects p JOIN businesses b ON b.id = p.business_id
                          WHERE p.monthly_fee > 0 AND b.default_vat_rate = 0`);
    console.log(`${TAG} (참고) 기본 세율 0% 워크스페이스의 월정액: 워크스페이스 ${zero[0].ws} · 프로젝트 ${zero[0].projects} — 원래 0% 로 청구돼 왔고 그대로다`);

    // 검증
    for (const [t, c] of ADDS) if (!(await colType(t, c))) throw new Error(`검증 실패 — ${t}.${c} 없음`);
    for (const [t, c] of WIDEN) if ((await colType(t, c)) !== 'decimal(5,4)') throw new Error(`검증 실패 — ${t}.${c} 안 넓혀짐`);
    const after = await moneyHash();
    console.log(`${TAG} 후: 청구서 ${after.invoices} · 회차 ${after.installments} · 해시 ${after.hash}`);
    if (after.hash !== before.hash) throw new Error('청구 금액 해시가 바뀜 — 멈춤');
    const expectAfter = await monthlyExpect(true);
    if (expectAfter !== expectBefore) throw new Error('월정액 다음 청구 예상액이 바뀜 — 멈춤');
    console.log(`${TAG} 금액 0원 변화 확인(청구서·회차 해시 같음 · 월정액 예상액 ${expectAfter ? expectAfter.split('\n').length : 0}건 같음)`);
    console.log(`${TAG} OK`);
    await sequelize.close();
    process.exit(0);
  } catch (e) {
    console.error(`${TAG} 실패:`, e.message);
    process.exit(1);
  }
})();
