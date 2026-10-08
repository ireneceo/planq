// services/invoiceNumber.js — 청구서 번호는 **여기서만** 뽑는다 (docs/FIX_0AB_MONEY_DESIGN.md B-②).
//   축 = (business_id, year). 형식 INV-YYYY-NNNN (4자리 패딩, 넘치면 자릿수가 는다).
//   동시성 = 카운터 행을 트랜잭션 안에서 UPDATE — 행 락이 같은 워크스페이스의 동시 생성을 직렬화하고,
//   롤백이면 번호도 되돌아가 빈 번호가 안 생긴다. MAX()+1 은 쓰지 않는다(갭 락 의존).
//   가드: health-check money-8 이 이 파일 밖의 'INV-' LIKE 스캔을 센다.
//   ★ transaction 은 필수에 가깝다 — 없이 부르면 카운터가 즉시 커밋돼 INSERT 실패 시 빈 번호가 남는다.
const { sequelize } = require('../config/database');

const INVOICE_NUMBER_RE = /^INV-(\d{4})-(\d{4,})$/;

async function nextInvoiceNumber(businessId, { transaction, year = new Date().getFullYear() } = {}) {
  const biz = Number(businessId);
  if (!Number.isInteger(biz) || biz <= 0) throw new Error('invalid_business_id');
  const prefix = `INV-${year}-`;
  // ★ INSERT IGNORE 를 쓰지 않는다 — 중복 키에서 공유(S) 락을 잡고, 뒤의 UPDATE 가 배타(X)로 올리려다 동시 요청끼리
  //   교착(deadlock)한다(dev 실측: 동시 6건 중 4건 교착). ON DUPLICATE KEY UPDATE 는 처음부터 X 락이라 줄을 서서 기다린다.
  await sequelize.query('INSERT INTO invoice_number_counters (business_id, year, last_no) VALUES (?, ?, 0) ON DUPLICATE KEY UPDATE last_no = last_no', { replacements: [biz, year], transaction });
  // 시드: 카운터가 0 이고 그 워크스페이스에 이미 번호가 있으면 MAX 로 끌어올린다(마이그레이션이 시드하지만 새 연도·누락 대비)
  await sequelize.query(
    "UPDATE invoice_number_counters c SET c.last_no = GREATEST(c.last_no, COALESCE((SELECT MAX(CAST(SUBSTRING_INDEX(i.invoice_number,'-',-1) AS UNSIGNED)) FROM invoices i WHERE i.business_id = c.business_id AND i.invoice_number LIKE ?), 0)) WHERE c.business_id = ? AND c.year = ? AND c.last_no = 0",
    { replacements: [`${prefix}%`, biz, year], transaction },
  );
  await sequelize.query('UPDATE invoice_number_counters SET last_no = last_no + 1 WHERE business_id = ? AND year = ?', { replacements: [biz, year], transaction }); // 행 락 → 커밋까지 직렬화
  const [[row]] = await sequelize.query('SELECT last_no FROM invoice_number_counters WHERE business_id = ? AND year = ? FOR UPDATE', { replacements: [biz, year], transaction });
  return `${prefix}${String(row.last_no).padStart(4, '0')}`;
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

module.exports = { nextInvoiceNumber, withInvoiceNumber, isInvoiceNumberConflict, INVOICE_NUMBER_RE };
