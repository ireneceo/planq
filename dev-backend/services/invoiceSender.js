// services/invoiceSender.js — 청구서에 실리는 **보내는 쪽(공급자) 정보의 단일 원천**
//
// 왜 필요한가 (운영 신고 2026-09-03):
//   Irene: "청구내용에 워크스페이스 회사정보가 받는 쪽 처럼 제대로 정보가 있어야 하는데
//           회사이름이랑 국민은행이라고 은행이름만 나와. 회사 정보 다 들어있는데도."
//   운영 businesses#1 에는 법인명·사업자등록번호(tax_id)·대표자·주소·전화·이메일·업태·종목이
//   **전부 채워져 있었다.** 빠진 것은 데이터가 아니라 **내보내는 쪽**이었다:
//     · 공개 청구서 API(routes/invoices.js) 의 sender 에 주소·전화·이메일·업태·종목이 없다
//     · PDF 는 템플릿이 tax_id·대표자·주소·업태·종목을 이미 그리는데(pdfTemplates.js:142-147)
//       invoicePdf.js 의 attributes 목록에 biz_type/biz_item/phone/email 이 빠져 **죽은 코드**였다
//     · 메일 본문에는 보내는 곳 정보가 아예 없다
//   같은 값을 세 곳이 각자 골라 담고 있었으니 갈라진 것이다. 한 함수로 모은다.
//
// ★ 컬럼은 새로 만들지 않는다 — 필요한 것이 이미 다 있다(사업자등록번호 = businesses.tax_id).
//
// 표시 규칙:
//   · 빈 값은 **줄 자체를 없앤다.** 빈 라벨·대시를 남기면 "정보가 없는 회사" 로 보인다.
//   · 외화/해외 고객은 영문 우선(legal_name_en·address_en·representative_en), 업태·종목 생략.
//     PDF 가 이미 그렇게 하고 있어 같은 규칙을 따른다.

/** Business 에서 읽어야 하는 컬럼 — 소비처가 이 목록을 그대로 쓴다(빠뜨리면 조용히 죽는다) */
const SENDER_ATTRIBUTES = [
  'name', 'brand_name',
  'legal_name', 'legal_name_en', 'tax_id',
  'representative', 'representative_en',
  'address', 'address_en',
  'biz_type', 'biz_item',
  'phone', 'email',
  'bank_name', 'bank_account_number', 'bank_account_name',
  'swift_code', 'bank_name_en', 'bank_account_name_en',
];

/**
 * 청구서 응답·PDF·메일이 공통으로 쓰는 공급자 블록.
 * 기존 키(name·biz_name·biz_ceo·bank_*)는 **이름을 바꾸지 않는다** — 프론트가 이미 쓰고 있다.
 */
function senderBlockOf(business) {
  if (!business) return null;
  const b = typeof business.toJSON === 'function' ? business.toJSON() : business;
  return {
    // 기존 키 (호환 유지)
    name: b.brand_name || b.name || null,
    biz_name: b.legal_name || null,
    biz_name_en: b.legal_name_en || null,
    biz_ceo: b.representative || null,
    bank_name: b.bank_name || null,
    bank_account_number: b.bank_account_number || null,
    bank_account_name: b.bank_account_name || null,
    swift_code: b.swift_code || null,
    bank_name_en: b.bank_name_en || null,
    bank_account_name_en: b.bank_account_name_en || null,
    // 신규 — 여태 응답에 없어서 화면·메일이 그릴 수가 없었다
    tax_id: b.tax_id || null,                   // 사업자등록번호 (받는 쪽 recipient_business_number 와 짝)
    biz_ceo_en: b.representative_en || null,
    address: b.address || null,
    address_en: b.address_en || null,
    biz_type: b.biz_type || null,               // 업태
    biz_item: b.biz_item || null,               // 종목
    phone: b.phone || null,
    email: b.email || null,
  };
}

/** 메일 본문 푸터용 한 줄 — 빈 값은 통째로 빠진다 */
function senderFooterLine(sender, { foreign = false } = {}) {
  if (!sender) return '';
  const nm = (foreign && sender.biz_name_en) || sender.biz_name || sender.name;
  const parts = [
    nm,
    sender.tax_id && `${foreign ? 'Business No.' : '사업자등록번호'} ${sender.tax_id}`,
    sender.biz_ceo && `${foreign ? 'Representative' : '대표'} ${(foreign && sender.biz_ceo_en) || sender.biz_ceo}`,
    (foreign && sender.address_en) || sender.address,
    sender.phone,
    sender.email,
  ].filter(Boolean);
  return parts.join(' · ');
}

module.exports = { SENDER_ATTRIBUTES, senderBlockOf, senderFooterLine };
