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
// qsale (2026-09-11) — Q sale 은 Q mail 바로 아래 메뉴다(docs/Q_SALE_DESIGN.md §5.1). 새 키는 기존 행이 없어 기본 write.
// ★ 'clients' 키는 2026-10-16 폐지 — 설정 > 고객 화면을 Q sale 로 합쳤다(docs/CLIENT_SCREENS_MERGE_DESIGN.md).
//   고객 라우트(clients·client_invites·client_links)는 'qsale' 로 지킨다. 옛 행은 scripts/migrate-menu-key-clients.js 가 옮긴다.
const VALID_MENUS = new Set([
  'qtalk', 'qmail', 'qsale', 'qtask', 'qcalendar', 'qnote', 'qdocs', 'qinfo', 'qfile', 'qbill', 'insights',
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
        // 고객처럼 멤버가 아닌 사람도 쓰는 라우트(자기 청구서 보기 등)는 opts.allowNonMember 로 통과시킨다 —
        //   메뉴 권한은 **멤버의** 축이고, 비멤버는 그 라우트의 자기 술어(attachWorkspaceScope·invoiceListWhere)가 좁힌다.
        if (opts.allowNonMember) return next();
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

      // member — 개인 행 > 워크스페이스 기본값 > 시스템 기본값 (resolveMemberLevels 한 곳)
      const level = (await resolveMemberLevels(bizId, req.user.id))[menuKey];

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

// ─── 멤버 메뉴 수준 = 개인 행 > 워크스페이스 기본값 > 시스템 기본값 (2026-10-23, docs/MEMBER_PERMISSION_GAPS_DESIGN.md D2) ───
// ★ «행 없음 = write» 가 requireMenu·getMemberMenuLevels·청구 담당 후보·주간보고에 네 벌로 있었고
//   weekly_team(서버 none)·insights(조회 전용) 는 표가 «write» 로 거짓말했다. 기본값 판정은 여기 하나 —
//   `|| 'write'` 같은 폴백을 이 파일 밖에서 쓰지 않는다(가드 --category=menudefault).
const SYSTEM_DEFAULTS = Object.freeze(Object.fromEntries(Array.from(VALID_MENUS).map((m) => [
  m, m === 'weekly_team' ? 'none' : (READ_ONLY_MENUS.has(m) ? 'read' : 'write'),
])));

/** 입력 정규화 — 아는 메뉴·아는 값만, 조회 전용 메뉴의 write 는 read 로(표와 같은 규칙) */
function normalizeLevel(menu, level) {
  if (!VALID_MENUS.has(menu) || !VALID_LEVELS.has(level)) return null;
  return (READ_ONLY_MENUS.has(menu) && level === 'write') ? 'read' : level;
}
function normalizeDefaults(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [m, v] of Object.entries(raw)) { const n = normalizeLevel(m, v); if (n) out[m] = n; }
  return out;
}

/** 워크스페이스 «멤버 기본 권한» — 시스템 기본값 위에 워크스페이스가 정한 값을 얹은 전체 표 */
async function getWorkspaceMemberDefaults(businessId, business = null) {
  const { Business } = require('../models');
  const biz = business || await Business.findByPk(businessId, { attributes: ['id', 'permissions'] });
  const custom = normalizeDefaults(biz?.permissions?.member_defaults);
  return { levels: { ...SYSTEM_DEFAULTS, ...custom }, custom };
}

/** member 한 사람의 메뉴별 수준 + 어느 칸이 «따로 정함» 인지 */
async function resolveMemberLevels(businessId, userId, opts = {}) {
  const defaults = opts.defaults || (await getWorkspaceMemberDefaults(businessId)).levels;
  const perms = await BusinessMemberPermission.findAll({
    where: { business_id: businessId, user_id: userId },
    attributes: ['menu_key', 'level'],
  });
  const map = { ...defaults };
  const explicit = {};
  // 폐지된 키(옛 'clients' 행 등)는 내보내지 않는다 — 화면이 없는 메뉴의 권한을 그리게 된다
  for (const p of perms) {
    const n = normalizeLevel(p.menu_key, p.level);
    if (n) { map[p.menu_key] = n; explicit[p.menu_key] = true; }
  }
  if (opts.withExplicit) return { menus: map, explicit };
  return map;
}

// 멤버 권한 평가 헬퍼 (라우트 외부에서 사용 — 예: UI 응답에 권한 정보 첨부). menus 는 VALID_MENUS 전 키를 갖는다.
async function getMemberMenuLevels(businessId, userId, opts = {}) {
  const member = await BusinessMember.findOne({
    where: { business_id: businessId, user_id: userId, removed_at: null },
    attributes: ['role'],
  });
  if (!member) return null;
  if (member.role === 'owner' || member.role === 'admin') {
    const all = {};
    for (const m of VALID_MENUS) all[m] = 'write';
    return { role: member.role, menus: all, explicit: {} };
  }
  if (member.role === 'ai') return { role: 'ai', menus: {}, explicit: {} };
  const r = await resolveMemberLevels(businessId, userId, { withExplicit: true, defaults: opts.defaults });
  return { role: 'member', menus: r.menus, explicit: r.explicit };
}

module.exports = {
  requireMenu,
  getMemberMenuLevels,
  VALID_MENUS: Array.from(VALID_MENUS),
  VALID_LEVELS: Array.from(VALID_LEVELS),
  READ_ONLY_MENUS: Array.from(READ_ONLY_MENUS),
  SYSTEM_DEFAULTS,
  normalizeLevel,
  normalizeDefaults,
  getWorkspaceMemberDefaults,
  resolveMemberLevels,
};
