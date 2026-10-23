// services/invoiceNumber.js — 청구서 번호는 **여기서만** 뽑는다 (docs/FIX_0AB_MONEY_DESIGN.md B-②).
//   형식 INV-YYYY-XXXX — 꼬리는 **무작위**(1000~9999). 2026-10-23 Irene: «INV-2026-0009 면 올해 9건인 게 보인다»
//   → 안 A «권고대로» · Fable 설계(DESIGN-CHANGE 6건 반영). 그 전 번호(0001~0999 순번)는 그대로 둔다.
//   - 입금 코드(receiptsDue.payerCodeOf)는 번호의 숫자 꼬리를 그대로 쓴다 → `7351홍길동`. 꼬리는 숫자로 둔다.
//   - 동시성 = 카운터 행(invoice_number_counters)을 트랜잭션 안에서 UPDATE — 행 락이 같은 워크스페이스의 동시 생성을 직렬화한다.
//     last_no 는 이제 «올해 발행 수» 다(자릿수 기준 · 롤백하면 옛 코드가 이어 쓴다).
//   - 중복 검사는 **잠그지 않는 SELECT** — FOR UPDATE 는 없는 행에 갭 락을 잡아 다른 워크스페이스끼리 교착한다.
//     스냅샷 밖에서 같은 꼬리가 커밋된 희귀한 경우는 UNIQUE(business_id, invoice_number) + withInvoiceNumber 재시도가 받는다.
//   - 가드: health-check money-8 이 이 파일 밖의 'INV-${' 조립을 센다.
//   ★ transaction 은 필수에 가깝다 — 없이 부르면 카운터가 즉시 커밋된다.
const crypto = require('crypto');
const { sequelize } = require('../config/database');

const INVOICE_NUMBER_RE = /^INV-(\d{4})-(\d{4,})$/;
const PICK_TRIES = 30;

// 자릿수 — 올해 발행 수(last_no)의 절반 지점에서 한 자리 늘린다(뽑기가 길어지지 않게). VARCHAR(20) 안: 9 + 6 = 15.
function digitsFor(issued) {
  if (issued < 4500) return 4;
  if (issued < 45000) return 5;
  return 6;
}

const defaultPick = (digits) => crypto.randomInt(10 ** (digits - 1), 10 ** digits);

// pick 은 검사(health-money m8)가 결정적으로 재현하려고 여는 문이다 — 운영 호출은 넘기지 않는다.
async function nextInvoiceNumber(businessId, { transaction, year = new Date().getFullYear(), pick = defaultPick, tries = PICK_TRIES } = {}) {
  const biz = Number(businessId);
  if (!Number.isInteger(biz) || biz <= 0) throw new Error('invalid_business_id');
  const prefix = `INV-${year}-`;
  // ★ INSERT IGNORE 를 쓰지 않는다 — 중복 키에서 공유(S) 락을 잡고, 뒤의 UPDATE 가 배타(X)로 올리려다 동시 요청끼리
  //   교착(deadlock)한다(dev 실측: 동시 6건 중 4건 교착). ON DUPLICATE KEY UPDATE 는 처음부터 X 락이라 줄을 서서 기다린다.
  await sequelize.query('INSERT INTO invoice_number_counters (business_id, year, last_no) VALUES (?, ?, 0) ON DUPLICATE KEY UPDATE last_no = last_no', { replacements: [biz, year], transaction });
  // 시드: 카운터가 0 이고 그 해 옛 **순번형** 번호(꼬리 0으로 시작하는 4자리)가 있으면 그 MAX 로 끌어올린다.
  //   무작위 꼬리(≥1000)를 MAX 로 읽으면 last_no 가 7000 대로 뛰어 자릿수가 곧장 넓어진다 — 순번형만 본다.
  await sequelize.query(
    "UPDATE invoice_number_counters c SET c.last_no = GREATEST(c.last_no, COALESCE((SELECT MAX(CAST(SUBSTRING_INDEX(i.invoice_number,'-',-1) AS UNSIGNED)) FROM invoices i WHERE i.business_id = c.business_id AND i.invoice_number REGEXP ?), 0)) WHERE c.business_id = ? AND c.year = ? AND c.last_no = 0",
    { replacements: [`^INV-${year}-0[0-9]{3}$`, biz, year], transaction },
  );
  await sequelize.query('UPDATE invoice_number_counters SET last_no = last_no + 1 WHERE business_id = ? AND year = ?', { replacements: [biz, year], transaction }); // 행 락 → 커밋까지 직렬화
  const [[row]] = await sequelize.query('SELECT last_no FROM invoice_number_counters WHERE business_id = ? AND year = ? FOR UPDATE', { replacements: [biz, year], transaction });
  // 뽑기 — 이미 있으면 다시. tries 번 다 겹치면 실패하지 않고 한 자리 늘려 계속한다(옛 번호로 공간이 차 있어도 진행).
  for (let digits = digitsFor(Number(row.last_no) || 0); ; digits += 1) {
    for (let i = 0; i < tries; i += 1) {
      const number = `${prefix}${pick(digits)}`;
      const [hit] = await sequelize.query('SELECT 1 FROM invoices WHERE business_id = ? AND invoice_number = ? LIMIT 1', { replacements: [biz, number], transaction });
      if (!hit.length) return number;
    }
    if (digits >= 8) throw new Error('invoice_number_space_exhausted');
  }
}

function isInvoiceNumberConflict(err) {
  if (!err || err.name !== 'SequelizeUniqueConstraintError') return false;
  const fields = err.fields ? Object.keys(err.fields) : [];
  const msg = String((err.parent && err.parent.sqlMessage) || err.message || '');
  return fields.includes('invoice_number') || /invoice_number/.test(msg);
}

// UNIQUE 충돌 벨트 — create 콜백을 3번까지 새 번호로 다시 시도(카운터 밖에서 들어온 번호 대비).
//   idempotency_key 충돌은 재시도하지 않는다(그대로 throw — 호출부가 가른다).
//   transaction 이 있으면 각 시도를 SAVEPOINT 로 감싸 충돌 뒤에도 바깥 트랜잭션이 살아 있게 한다.
async function withInvoiceNumber(businessId, transaction, createFn, { attempts = 3 } = {}) {
  let lastErr = null;
  for (let i = 0; i < attempts; i += 1) {
    try {
      if (transaction) {
        return await sequelize.transaction({ transaction }, async (sp) => {
          const number = await nextInvoiceNumber(businessId, { transaction: sp });
          return createFn(number, sp);
        });
      }
      return await sequelize.transaction(async (t) => {
        const number = await nextInvoiceNumber(businessId, { transaction: t });
        return createFn(number, t);
      });
    } catch (err) {
      if (!isInvoiceNumberConflict(err)) throw err;
      lastErr = err;
    }
  }
  throw lastErr;
}

module.exports = { nextInvoiceNumber, withInvoiceNumber, isInvoiceNumberConflict, INVOICE_NUMBER_RE, digitsFor };
