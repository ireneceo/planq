// salesIntake — Q sales 상담 **유입 모드**의 단일 원천 (#449, docs/SALES_INTAKE_DESIGN.md §2.1·§3.2)
//
// Irene 결정(2026-10-02): 기본값 **수동**. 자동 유입의 영업 적중률이 ≈30% 였다(운영 18건 중 5건) —
//   애플 지원 티켓·학교 통지·수도요금처럼 «우리가 고객인» 스레드도 우리가 답했으니 관계로 들어왔다.
//   그 구분은 본문의 뜻이라 기계 기준을 좁혀도 못 거른다. 그래서 모드를 준다.
//
//   manual — 사람이 [상담으로 보내기] 한 메일만 상담에 들어온다. 자동 기준에 드는 메일은 Q mail 에 「문의 후보」.
//   auto   — 종전 기준(올렸다 · 우리가 답했다 · 개인 주소).
//   채팅·게스트 링크는 모드와 무관하다 — 우리 창구로 들어온 사람은 구조상 잠재 고객이다.
//
// ★ 저장 자리는 `businesses.permissions.sales_intake` (새 컬럼 0, customer_entry 와 같은 JSON).
//   모양은 이 파일의 normalizeIntake 한 함수가 정한다 — 읽기·쓰기가 같이 지난다. 모르는 값은 기본값(fail-closed).
const MODES = ['manual', 'auto'];
const DEFAULT_MODE = 'manual';

function normalizeIntake(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return { mail: MODES.includes(src.mail) ? src.mail : DEFAULT_MODE };
}

function intakeOf(biz) {
  const p = biz && biz.permissions && typeof biz.permissions === 'object' ? biz.permissions : {};
  return normalizeIntake(p.sales_intake);
}

async function mailIntakeMode(businessId) {
  const { Business } = require('../models');
  const biz = await Business.findByPk(businessId, { attributes: ['id', 'permissions'] });
  return intakeOf(biz).mail;
}

module.exports = { MODES, DEFAULT_MODE, normalizeIntake, intakeOf, mailIntakeMode };
