// salesIntake — Q sales 상담 **유입 설정**의 단일 원천 (#449, docs/SALES_INTAKE_DESIGN.md §2.1·§3.2 · docs/MAIL_CRITERIA_DESIGN.md §7)
//
// Irene 결정(2026-10-02): 기본값 **수동**. 자동 유입의 영업 적중률이 ≈30% 였다(운영 18건 중 5건) —
//   애플 지원 티켓·학교 통지·수도요금처럼 «우리가 고객인» 스레드도 우리가 답했으니 관계로 들어왔다.
//   그 구분은 본문의 뜻이라 기계 기준을 좁혀도 못 거른다. 그래서 모드를 준다.
//
//   manual — 사람이 [상담으로 보내기] 한 메일만 상담에 들어온다. 자동 기준에 드는 메일은 Q mail 에 「문의 후보」.
//   auto   — 종전 기준(올렸다 · 우리가 답했다 · 개인 주소).
//   채팅·게스트 링크는 모드와 무관하다 — 우리 창구로 들어온 사람은 구조상 잠재 고객이다.
//
// 2026-10-15 — 기준 공개·끄기·추가(Irene: *"이건 이메일도 그렇고 Q sales 리스트도 그렇게 하자"*).
//   off      — 끈 자동 기준(replied·personal 만 끌 수 있다)
//   domains  — always(늘 상담 — 모드와 무관, 사람의 선언 = 올리기와 같은 뜻) · never(상담 아님)
//   ★ 키워드 규칙·자동 학습은 넣지 않는다(09-16·17 결정 — 키워드로 가르다 두 번 샜고, 올리기 학습은 웹폼 릴레이 주소에 걸린다).
//
// ★ 저장 자리는 `businesses.permissions.sales_intake` (새 컬럼 0, customer_entry 와 같은 JSON).
//   모양은 이 파일의 normalizeIntake 한 함수가 정한다 — 읽기·쓰기가 같이 지난다. 모르는 값은 기본값(fail-closed).
const MODES = ['manual', 'auto'];
const DEFAULT_MODE = 'manual';
const TOGGLEABLE = ['replied', 'personal'];
const LIST_MAX = 50;

/** 상담 유입 기준 목록 — 화면이 이 순서로 그린다(설명은 i18n settings:salesIntake.criteria.<id>). 판정은 saleMailCriteria. */
const SALE_CATALOG = [
  { id: 'promoted', lockable: true },
  { id: 'domain_always', list: 'always' },
  { id: 'replied', lockable: false },
  { id: 'personal', lockable: false },
  { id: 'handled_no_reply', lockable: true },
  { id: 'automated_sender', lockable: true },
  { id: 'no_relationship', lockable: true },
  { id: 'domain_never', list: 'never' },
];

/** 주소·도메인 한 칸 정규화 — 형식이 아니면 null. 무료메일 **도메인 통째**는 always 에 못 넣는다(gmail.com 전체가 상담이 된다). */
function normEntry(v, { forAlways = false } = {}) {
  const s = String(v || '').trim().toLowerCase().replace(/^@/, '');
  if (!s || s.length > 200) return null;
  const isAddr = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);
  const isDomain = !isAddr && /^[a-z0-9.-]+\.[a-z]{2,}$/.test(s);
  if (!isAddr && !isDomain) return null;
  if (forAlways && isDomain && require('./emailTriage').FREE_MAIL_DOMAIN.test(s)) return null;
  return s;
}

function normalizeIntake(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const off = (Array.isArray(src.off) ? src.off : []).map(String).filter((id) => TOGGLEABLE.includes(id));
  const d = src.domains && typeof src.domains === 'object' ? src.domains : {};
  const list = (arr, forAlways) => [...new Set((Array.isArray(arr) ? arr : []).map((x) => normEntry(x, { forAlways })).filter(Boolean))].slice(0, LIST_MAX);
  return {
    mail: MODES.includes(src.mail) ? src.mail : DEFAULT_MODE,
    off: [...new Set(off)].sort(),
    domains: { always: list(d.always, true), never: list(d.never, false) },
  };
}

function intakeOf(biz) {
  const p = biz && biz.permissions && typeof biz.permissions === 'object' ? biz.permissions : {};
  return normalizeIntake(p.sales_intake);
}

async function intakeSettings(businessId) {
  const { Business } = require('../models');
  const biz = await Business.findByPk(businessId, { attributes: ['id', 'permissions'] });
  return intakeOf(biz);
}

async function mailIntakeMode(businessId) {
  return (await intakeSettings(businessId)).mail;
}

module.exports = { MODES, DEFAULT_MODE, TOGGLEABLE, SALE_CATALOG, LIST_MAX, normEntry, normalizeIntake, intakeOf, intakeSettings, mailIntakeMode };
