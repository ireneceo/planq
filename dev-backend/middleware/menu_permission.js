// menu_permission.js — 멤버 메뉴 권한 가드 (사이클 N+21)
//
// 9 메뉴 × 3 레벨 (none/read/write) — PERMISSION_MATRIX §5 의 4-Layer 중 Layer 3.
//
// 평가 순서:
//   1. user.platform_role === 'platform_admin' → 통과
//   2. BusinessMember.role === 'owner' → 통과
//   3. BusinessMember.role === 'admin' → owner_only 메뉴 외 통과
//   4. BusinessMember.role === 'member':
//      row = BusinessMemberPermission(biz, user, menu_key)
//      row 없음 → 'write' 기본 (열린 문화)
//      row.level === 'none' → 403 forbidden_menu_hidden
//      row.level === 'read' AND requested 'write' → 403 read_only
//      그 외 → 통과
//   5. BusinessMember.role === 'ai' → 차단 (시스템 멤버, API 진입 X)
//   6. BusinessMember 없음 → 403
//
// 사용:
//   router.post('/api/invoices/:businessId', authenticateToken, checkBusinessAccess,
//     requireMenu('qbill', 'write'), handler);
//
// businessId 추출: req.params.businessId / req.body.business_id / req.query.business_id
// 또는 옵션 { bizFrom: (req) => req.body.business_id }
//
// 응답 형식 (LimitReachedDialog 호환):
//   { success: false, code: 'permission_denied', menu: '...', requiredLevel: '...' }

const { BusinessMember, BusinessMemberPermission } = require('../models');

// 사이드바 메뉴 순서와 정합 — talk → mail → task → calendar → note → docs → info → file → bill → clients → insights
// weekly_team: 워크스페이스 통합 주간보고 보기 (사이클 N+26, default 'none' — 멤버끼리 자동 공유 X)
const VALID_MENUS = new Set([
  'qtalk', 'qmail', 'qtask', 'qcalendar', 'qnote', 'qdocs', 'qinfo', 'qfile', 'qbill', 'clients', 'insights',
  'weekly_team',
]);
const VALID_LEVELS = new Set(['none', 'read', 'write']);
// insights / weekly_team 은 조회만 의미 있음 — write 입력 시 read 로 강제
const READ_ONLY_MENUS = new Set(['insights', 'weekly_team']);

function extractBusinessId(req, opts) {
  if (opts && typeof opts.bizFrom === 'function') return opts.bizFrom(req);
  return req.params.businessId
    || req.params.business_id
    || req.body?.business_id
    || req.query?.business_id
    || null;
}

// requireMenu(menuKey, requiredLevel='read', opts)
function requireMenu(menuKey, requiredLevel = 'read', opts = {}) {
  if (!VALID_MENUS.has(menuKey)) {
    throw new Error('[menu_permission] invalid menu_key: ' + menuKey);
  }
  if (!VALID_LEVELS.has(requiredLevel)) {
    throw new Error('[menu_permission] invalid level: ' + requiredLevel);
  }
  if (requiredLevel === 'none') {
    throw new Error('[menu_permission] required level "none" makes no sense — use "read" or "write"');
  }

  return async (req, res, next) => {
    try {
      // platform_admin = 통과
      if (req.user?.platform_role === 'platform_admin') return next();

      const bizId = Number(extractBusinessId(req, opts));
      if (!bizId) {
        return res.status(400).json({ success: false, code: 'business_id_required' });
      }

      const member = await BusinessMember.findOne({
        where: { business_id: bizId, user_id: req.user.id },
        attributes: ['role'],
      });
      if (!member) {
        return res.status(403).json({ success: false, code: 'not_a_member' });
      }

      // owner = 전권
      if (member.role === 'owner') return next();
      // ai = 시스템 멤버, API 직접 진입 차단
      if (member.role === 'ai') {
        return res.status(403).json({ success: false, code: 'ai_member_blocked' });
      }
      // admin = owner_only 메뉴 외 전권 (현재 owner_only 메뉴 없음 — 결제 설정 같은 건 별도 라우트 권한)
      if (member.role === 'admin') return next();

      // member — BusinessMemberPermission 평가
      const perm = await BusinessMemberPermission.findOne({
        where: { business_id: bizId, user_id: req.user.id, menu_key: menuKey },
        attributes: ['level'],
      });
      const level = perm?.level || 'write';  // row 없음 = 열린 문화 기본 write

      if (level === 'none') {
        return res.status(403).json({
          success: false, code: 'forbidden_menu_hidden',
          menu: menuKey, your_level: 'none',
        });
      }
      if (requiredLevel === 'write' && level === 'read') {
        return res.status(403).json({
          success: false, code: 'forbidden_read_only',
          menu: menuKey, your_level: 'read', required_level: 'write',
        });
      }
      // read 요청이면 write/read 모두 통과
      return next();
    } catch (e) {
      console.error('[requireMenu]', e.message);
      return res.status(500).json({ success: false, message: 'permission_check_failed' });
    }
  };
}

// 멤버 권한 평가 헬퍼 (라우트 외부에서 사용 — 예: UI 응답에 권한 정보 첨부)
async function getMemberMenuLevels(businessId, userId) {
  const member = await BusinessMember.findOne({
    where: { business_id: businessId, user_id: userId },
    attributes: ['role'],
  });
  if (!member) return null;
  if (member.role === 'owner' || member.role === 'admin') {
    const all = {};
    for (const m of VALID_MENUS) all[m] = 'write';
    return { role: member.role, menus: all };
  }
  if (member.role === 'ai') return { role: 'ai', menus: {} };

  const perms = await BusinessMemberPermission.findAll({
    where: { business_id: businessId, user_id: userId },
    attributes: ['menu_key', 'level'],
  });
  const map = {};
  for (const m of VALID_MENUS) map[m] = 'write';  // default
  for (const p of perms) map[p.menu_key] = p.level;
  return { role: 'member', menus: map };
}

module.exports = {
  requireMenu,
  getMemberMenuLevels,
  VALID_MENUS: Array.from(VALID_MENUS),
  VALID_LEVELS: Array.from(VALID_LEVELS),
  READ_ONLY_MENUS: Array.from(READ_ONLY_MENUS),
};
