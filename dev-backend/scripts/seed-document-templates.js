// 시스템 기본 문서 템플릿 seed — 견적서·청구서·NDA·제안서·회의록 5종.
// 멱등성 — kind+is_system+name 기준 upsert.
// 실행: node scripts/seed-document-templates.js

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { sequelize, DocumentTemplate } = require('../models');

const TEMPLATES = [
  {
    kind: 'quote',
    name: '표준 견적서 (KO)',
    description: 'PlanQ 기본 견적서 — 자동 합계·부가세·만료일',
    mode: 'form',
    locale: 'ko',
    visibility: 'client_shareable',
    schema_json: {
      header: {
        issuer_logo: { source: 'business.logo_url' },
        issuer_info: { source: 'business', fields: ['name', 'biz_number', 'ceo', 'address', 'phone'] },
      },
      fields: [
        { key: 'client_id', type: 'client_picker', required: true, label: '고객' },
        { key: 'title', type: 'text', label: '제목', ai_hint: '프로젝트/작업 한 줄 요약' },
        { key: 'issued_at', type: 'date', default: 'today', label: '발행일' },
        { key: 'valid_until', type: 'date', default: '+30d', label: '만료일' },
        { key: 'currency', type: 'select', options: ['KRW', 'USD', 'EUR'], default: 'KRW' },
        { key: 'items', type: 'line_items', label: '품목', required: true,
          schema: {
            description: { type: 'text', ai_hint: '구체적 산출물 (결과물 기반)' },
            quantity: { type: 'number', default: 1, step: 0.5 },
            unit_price: { type: 'number', step: 1000 },
            subtotal: { type: 'computed', formula: 'quantity * unit_price' },
          } },
        { key: 'vat_rate', type: 'percent', default: 0.10, label: '부가세율' },
        { key: 'payment_terms', type: 'textarea', default: '발행 후 14일 이내 계좌이체' },
        { key: 'notes', type: 'textarea', label: '메모 (고객용)' },
      ],
      totals: [
        { key: 'subtotal', label: '공급가액', formula: 'sum(items.subtotal)' },
        { key: 'vat', label: '부가세', formula: 'subtotal * vat_rate' },
        { key: 'total', label: '합계', formula: 'subtotal + vat', highlight: true },
      ],
      footer: { signature_zone: true, qr_code: { type: 'share_link' } },
    },
    ai_prompt_template: '고객 [{{client.name}}] 의 [{{title}}] 견적서를 작성해줘. 과거 견적 평균 단가 [{{client.avg_unit_price}}], 일반 항목 [{{client.common_items}}]. 사용자 요구: [{{user_input}}]. 항목 3-5개, description 은 결과물 기반(완료 시점 명확)으로.',
  },
  {
    kind: 'invoice',
    name: '표준 청구서 (KO)',
    description: 'PlanQ 기본 청구서 — 결제 채널 분기 (포트원), 세금계산서 자동',
    mode: 'form',
    locale: 'ko',
    visibility: 'client_shareable',
    schema_json: {
      fields: [
        { key: 'client_id', type: 'client_picker', required: true },
        { key: 'invoice_number', type: 'text', label: '청구번호', auto: 'INV-{YYYY}-{seq}' },
        { key: 'issued_at', type: 'date', default: 'today' },
        { key: 'due_date', type: 'date', default: '+14d', label: '결제 기한' },
        { key: 'currency', type: 'select', options: ['KRW', 'USD', 'EUR'], default: 'KRW' },
        { key: 'items', type: 'line_items', required: true,
          schema: {
            description: { type: 'text' },
            quantity: { type: 'number', default: 1 },
            unit_price: { type: 'number' },
            subtotal: { type: 'computed', formula: 'quantity * unit_price' },
          } },
        { key: 'vat_rate', type: 'percent', default: 0.10 },
        { key: 'payment_terms', type: 'textarea' },
      ],
      totals: [
        { key: 'subtotal', formula: 'sum(items.subtotal)' },
        { key: 'vat_amount', formula: 'subtotal * vat_rate' },
        { key: 'grand_total', formula: 'subtotal + vat_amount', highlight: true },
      ],
    },
  },
  {
    kind: 'nda',
    name: '비밀유지계약서 (NDA)',
    description: '워크스페이스 ↔ 고객 표준 NDA',
    mode: 'hybrid',
    locale: 'ko',
    visibility: 'client_shareable',
    schema_json: {
      fields: [
        { key: 'party_a', type: 'business_picker', label: '갑(워크스페이스)' },
        { key: 'party_b', type: 'client_picker', required: true, label: '을(고객)' },
        { key: 'effective_date', type: 'date', default: 'today' },
        { key: 'duration_months', type: 'number', default: 24, label: '유효 기간(개월)' },
      ],
    },
    body_template: '# 비밀유지계약서\n\n{{party_a.name}}(이하 "갑") 과 {{party_b.name}}(이하 "을") 은 다음과 같이 비밀유지계약을 체결한다.\n\n## 제1조 (목적)\n본 계약은 양 당사자가 상호 협력 과정에서 알게 된 비밀 정보의 유지를 목적으로 한다.\n\n## 제2조 (비밀정보의 정의)\n... (사용자가 자유 작성)\n\n## 제3조 (유효 기간)\n본 계약은 {{effective_date}} 부터 {{duration_months}}개월간 유효하다.\n',
  },
  {
    kind: 'proposal',
    name: '제안서 (자유 양식)',
    description: '에디터 기반 자유 작성 제안서',
    mode: 'editor',
    locale: 'ko',
    visibility: 'client_shareable',
    body_template: '# {{title}}\n\n## 제안 배경\n\n## 솔루션\n\n## 일정 / 마일스톤\n\n## 견적\n\n## 다음 단계\n',
    ai_prompt_template: '[{{client.name}}] 에게 보낼 [{{title}}] 제안서를 작성해줘. 사용자 요구: [{{user_input}}]. 한국어, 5개 섹션(배경/솔루션/일정/견적/다음단계).',
  },
  {
    kind: 'meeting_note',
    name: '회의록 (Q note 자동 변환)',
    description: 'Q note 회의 종료 시 자동 생성. 화자별 발언, 결정사항, 액션 아이템 자동 추출',
    mode: 'editor',
    locale: 'ko',
    visibility: 'workspace_only',
    body_template: '# {{session.title}}\n\n**일시**: {{session.created_at}}\n**참석자**: {{session.participants}}\n\n## 안건\n{{session.brief}}\n\n## 핵심 발언\n_(Q note 가 자동 채움)_\n\n## 결정 사항\n_(Q note 가 자동 채움)_\n\n## 액션 아이템\n_(Q note 가 자동 채움)_\n',
    ai_prompt_template: '회의 트랜스크립트를 기반으로 회의록을 작성해줘. 결정사항·액션아이템·핵심논점 3섹션으로 정리.',
  },
];

(async () => {
  let inserted = 0, updated = 0;
  for (const tpl of TEMPLATES) {
    const where = { kind: tpl.kind, is_system: true, name: tpl.name };
    const existing = await DocumentTemplate.findOne({ where });
    if (existing) {
      await existing.update({ ...tpl, is_system: true, business_id: null });
      updated++;
    } else {
      await DocumentTemplate.create({ ...tpl, is_system: true, business_id: null });
      inserted++;
    }
  }
  console.log(`✓ Document templates seeded: ${inserted} inserted, ${updated} updated, total ${TEMPLATES.length}`);
  await sequelize.close();
})().catch(e => {
  console.error('Seed failed:', e);
  process.exit(1);
});
