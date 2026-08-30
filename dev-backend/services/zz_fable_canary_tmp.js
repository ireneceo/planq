// Fable 게이트 반증용 임시 카나리 — 검증 후 삭제된다.
const { EmailMessage, EmailThread } = require('../models');
async function canaryPositive() {
  // 없는 컬럼 → 가드가 잡아야 한다
  return EmailMessage.findAll({ where: { thread_id: 1 }, attributes: ['id', 'zz_fable_bogus_col'] });
}
async function canaryNegative() {
  // 전부 합법 — 가드가 잡으면 오탐: include 안 다른 모델 attributes + fn 별칭 + 유효 컬럼
  const { fn, col } = require('sequelize');
  return EmailThread.findAll({
    where: { business_id: 5 },
    attributes: ['id', 'subject', [fn('COUNT', col('id')), 'cnt']],
    include: [{ model: EmailMessage, attributes: ['body_text', 'from_email'] }],
  });
}
module.exports = { canaryPositive, canaryNegative };
