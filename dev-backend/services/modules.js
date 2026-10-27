// 워크스페이스 기능 켜기/끄기 — 판정 한 곳 (2026-10-15, Irene «사용할지 말지 정해서 사용하게 할 수 있어?»)
//   설계 docs/PAYROLL_DESIGN.md §2. 저장은 businesses.modules JSON — ★ 그 칸을 직접 읽지 말고 이 파일의 함수를 쓴다
//   (서버 가드·/api/auth/me·메뉴가 같은 값을 봐야 «메뉴는 없는데 주소로 열린다» 가 안 생긴다).
//   끄면 그 기능의 API 는 404(있는지도 말하지 않는다 — platform_admin 도). 데이터는 지우지 않는다.
const { Business } = require('../models');

// 키가 없을 때의 기본값. 급여는 «안 쓰는 회사가 더 많다» → 끔.
//   근태(attendance)는 이미 쓰는 워크스페이스가 있어 켬 — 스위치·서버 가드는 다음 단계(설계 §2.2, 작업기록 참조).
//   문서 «청구 조건» 칸(doc_billing_terms, 2026-10-27 Irene «서명을 할 때만 넣거나 따로 원해서 설정에서 넣고 싶은 사람에게만 안내»)은
//   API 를 막지 않는다 — 켜면 모든 문서에 빈 칸 안내가 보이고, 끄면(기본) 서명 요청 창에서만 적는다. 적어 둔 조건은 켜기와 무관하게 보인다.
const MODULE_DEFAULTS = Object.freeze({ payroll: false, doc_billing_terms: false });
const MODULE_KEYS = Object.keys(MODULE_DEFAULTS);

/** biz(행 또는 { modules }) 의 모듈 상태 전부 — 기본값을 채운 새 객체 */
function modulesOf(biz) {
  const raw = (biz && biz.modules && typeof biz.modules === 'object') ? biz.modules : {};
  const out = {};
  for (const k of MODULE_KEYS) out[k] = typeof raw[k] === 'boolean' ? raw[k] : MODULE_DEFAULTS[k];
  return out;
}

function moduleOn(biz, key) {
  if (!MODULE_KEYS.includes(key)) return false;
  return modulesOf(biz)[key];
}

async function moduleOnFor(businessId, key) {
  const id = Number(businessId);
  if (!id) return false;
  const biz = await Business.findByPk(id, { attributes: ['id', 'modules'] });
  return !!biz && moduleOn(biz, key);
}

/** 미들웨어 — req.params.businessId 의 모듈이 꺼져 있으면 404 module_off. checkBusinessAccess 다음에 둔다. */
function requireModule(key) {
  return async (req, res, next) => {
    try {
      if (!(await moduleOnFor(req.params.businessId, key))) {
        return res.status(404).json({ success: false, message: 'module_off' });
      }
      return next();
    } catch (e) { return next(e); }
  };
}

module.exports = { MODULE_DEFAULTS, MODULE_KEYS, modulesOf, moduleOn, moduleOnFor, requireModule };
