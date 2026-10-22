// routes/email_account_notify.js — 내 메일 알림, 메일함(주소)별 덮어쓰기 (2026-10-22)
//   설계 docs/MAIL_NOTIFY_PER_ADDRESS_DESIGN.md D5. email_accounts.js 가 500줄을 넘지 않게 따로 둔다 —
//   계정 «볼 수 있는가» 술어(accessibleWhere)는 저 파일과 **같은 조건**이어야 한다(회사 공용 ∪ 내 개인).
//   ★ 같은 접두어(/api/businesses)에 email_accounts.js 보다 **앞에** 마운트한다(고정 꼬리 경로).
const express = require('express');
const { Op } = require('sequelize');
const router = express.Router();
const { EmailAccount, EmailAccountNotifyPref } = require('../models');
const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');

// email_accounts.js accessibleWhere · services/mailIdentity.accessibleAccountIds 와 같은 술어
function accessibleWhere(req) {
  return { [Op.or]: [{ owner_user_id: null }, { owner_user_id: req.user.id }] };
}

//   본인 것만 읽고 쓴다(관리 권한 불필요). 계정은 accessibleWhere + business_id + is_active — mailNotify 의 수신자 집합과
//   같은 축이다. 남의 개인 계정 id 는 404(존재를 말하지 않는다).
const MY_NOTIFY_SCOPES = ['off', 'reply_only', 'recommended', 'all'];

function myNotifyRow(acc, pref) {
  const accountScope = acc.notify_scope || 'recommended';
  const my = pref ? pref.notify_scope : null;
  return {
    account_id: acc.id,
    email: acc.email,
    display_name: acc.display_name || null,
    is_shared: acc.owner_user_id == null,
    account_scope: accountScope,
    my_scope: my,
    effective_scope: my || accountScope,
  };
}

router.get('/:businessId/email-accounts/my-notify', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const businessId = parseInt(req.params.businessId, 10);
    const rows = await EmailAccount.findAll({
      where: { business_id: businessId, is_active: true, ...accessibleWhere(req) },
      attributes: ['id', 'email', 'display_name', 'owner_user_id', 'notify_scope', 'created_at'],
      order: [['owner_user_id', 'ASC'], ['created_at', 'ASC']],   // 회사 메일함 먼저
      limit: 200,   // 메일함은 워크스페이스당 몇 개뿐 — 무한 목록이 되지 않게 상한만
    });
    const prefs = rows.length ? await EmailAccountNotifyPref.findAll({
      where: { business_id: businessId, user_id: req.user.id, email_account_id: rows.map((r) => r.id) },
    }) : [];
    const byAcc = new Map(prefs.map((p) => [p.email_account_id, p]));
    successResponse(res, rows.map((r) => myNotifyRow(r, byAcc.get(r.id))));
  } catch (err) { next(err); }
});

// audit-exempt: 본인 알림 수신 설정 — PUT /notifications/prefs 와 같은 수준(타인·워크스페이스 데이터 변경 아님)
router.put('/:businessId/email-accounts/:id/my-notify', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const businessId = parseInt(req.params.businessId, 10);
    const acc = await EmailAccount.findOne({
      where: { id: req.params.id, business_id: businessId, is_active: true, ...accessibleWhere(req) },
    });
    if (!acc) return errorResponse(res, 'not_found', 404);
    const v = req.body?.notify_scope;
    if (v !== 'default' && !MY_NOTIFY_SCOPES.includes(v)) return errorResponse(res, 'invalid_notify_scope', 400);
    const where = { email_account_id: acc.id, user_id: req.user.id };
    let pref = null;
    if (v === 'default') {
      await EmailAccountNotifyPref.destroy({ where });   // «기본값 따름» = 행의 부재
    } else {
      [pref] = await EmailAccountNotifyPref.findOrCreate({
        where, defaults: { ...where, business_id: businessId, notify_scope: v },
      });
      if (pref.notify_scope !== v) await pref.update({ notify_scope: v });
    }
    const out = myNotifyRow(acc, pref);
    successResponse(res, { account_id: out.account_id, my_scope: out.my_scope, effective_scope: out.effective_scope });
  } catch (err) { next(err); }
});

module.exports = router;
