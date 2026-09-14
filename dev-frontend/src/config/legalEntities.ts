// PlanQ 의 **법인은 둘이다.** 그 사실을 적는 단 하나의 자리. (2026-09-14)
//
// > Irene: *"우리가 스트라이프 말레이시아 법인으로 쓸거면 법적 고지나 안내에 다 들어가야 하는 거
// >          아니야? 솔루션 사용에 대한 비용청구자가 2 회사인거잖아."*
//
// ★ **결제 수단에 따라 수취 법인이 다르다.** 이것이 이 파일의 존재 이유다 —
//   "구독료는 말레이시아 법인이 받는다" 는 **절반만 참**이고, 계좌이체에 대해서는 거짓이다.
//     · 계좌이체 → **(주)아이린앤컴퍼니** (국민은행 · `platform_settings.bank_*`)
//     · 카드(Stripe) → **GIT CONSULTING SDN. BHD.** (Stripe 가입 법인이 여기다)
//   2026-09-14 운영 실측으로 확인했다(`platform_settings` 직독).
//
// ★ **한국 법인은 여기 두지 않는다.** 그건 `platform_settings` 에 있고 관리자 UI 로 고친다
//   (푸터가 이미 `GET /api/platform/info` 로 읽는다). 두 곳에 적으면 갈라진다.
//   말레이시아 법인만 코드 상수로 두는 이유:
//     ① 관리자가 바꿀 값이 아니다(법인 등록 정보는 거의 안 변한다)
//     ② **약관 문구와 함께 배포되어야 정합하다** — DB 에 두면 서버마다 따로 입력해야 하고
//        (memory `feedback_platform_settings_are_per_server`) 한쪽만 채워지면
//        약관은 법인을 말하는데 푸터는 비어 있는 상태가 된다
//
// 이 상수를 고치면 약관·개인정보처리방침·결제 화면·푸터가 **같이** 바뀐다.
// 새로 이 법인을 언급하는 화면을 만들면 문구에 박지 말고 여기서 가져간다.

/** 카드(Stripe) 구독료를 청구·수취하는 법인 */
export const BILLING_ENTITY = {
  /** 정식 상호 — 브랜드명("GIT Consulting Group")이 아니라 등록된 법인명 */
  name: 'GIT CONSULTING SDN. BHD.',
  /** 말레이시아 SSM 법인등록번호 (구 번호 병기) */
  regNo: '202201012250 (1457947-A)',
  /** 말레이시아 조세식별번호. **지금 어느 화면에도 그리지 않는다** —
   *  푸터에 외국 세번을 늘어놓으면 소음이고, 카드 영수증은 Stripe 가 자기 설정값으로 발행한다.
   *  여기 적어 두는 이유는 다음에 이 값을 쓸 화면(청구서·영수증 양식)이 생길 때
   *  **다시 타이핑하지 않게** 하기 위해서다. 쓰는 곳이 생기면 여기서 가져간다. */
  tin: 'C29771304030',
  address: 'P-02-06A, 2nd Floor, Tropicana Avenue, Persiaran Tropicana, Tropicana, 47410 Petaling Jaya, Selangor, Malaysia',
  /** ISO 국가코드. ★ **국가 이름을 여기 적지 않는다** — "말레이시아"/"Malaysia" 는
   *  식별자가 아니라 **번역 대상 낱말**이다. 처음엔 `countryKo`/`countryEn` 을 여기 뒀는데
   *  i18n 하드코딩 가드가 바로 잡았다(옳은 지적이다). 이름은 각 언어의 문구 안에 있다. */
  countryCode: 'MY',
  email: 'help@gitconsulting.group',
  homepage: 'https://gitconsulting.group/',
} as const;

/** 로케일 문구에 넘기는 보간 값 — 문구에 법인명·등록번호를 **박지 않는다**.
 *  넘기는 것은 **언어에 무관한 식별자**뿐이다(상호·등록번호·주소·메일). 국가 이름처럼
 *  번역되는 낱말은 각 언어의 문구 안에 그대로 쓴다. */
export const billingEntityVars = () => ({
  billingEntity: BILLING_ENTITY.name,
  billingEntityRegNo: BILLING_ENTITY.regNo,
  billingEntityTin: BILLING_ENTITY.tin,
  billingEntityAddress: BILLING_ENTITY.address,
  billingEntityEmail: BILLING_ENTITY.email,
  billingEntityHomepage: BILLING_ENTITY.homepage,
});

export default BILLING_ENTITY;
