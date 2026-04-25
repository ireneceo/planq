// 시스템 기본 문서 템플릿 seed — 견적서·청구서·NDA·제안서·회의록 5종.
// 멱등성 — kind+is_system+name 기준 upsert.
// 실행: node scripts/seed-document-templates.js

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { sequelize } = require('../config/database');
const { DocumentTemplate } = require('../models');

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
    body_template: `<h1>비밀유지계약서 (Non-Disclosure Agreement)</h1>
<p><strong>{{party_a.name}}</strong>(이하 "갑")과 <strong>{{party_b.name}}</strong>(이하 "을")은 상호 협력 과정에서 알게 된 비밀 정보의 보호를 위하여 다음과 같이 비밀유지계약(이하 "본 계약")을 체결한다.</p>
<h2>제1조 (목적)</h2>
<p>본 계약은 양 당사자가 협력 과정에서 알게 된 비밀 정보의 유지·보호 및 사용 범위를 정함을 목적으로 한다.</p>
<h2>제2조 (비밀정보의 정의)</h2>
<p>본 계약에서 "비밀정보"란 한 당사자가 다른 당사자에게 서면·구두·전자적 형태로 제공하거나 알게 된 모든 정보로서, 다음 각 호를 포함한다.</p>
<ul><li>기술정보 (소스코드·설계·아키텍처·알고리즘 등)</li><li>영업정보 (고객 명단·가격 정책·마케팅 전략·재무 데이터 등)</li><li>인사정보 (조직 구조·인력 정책·급여 등)</li><li>기타 합리적으로 비밀로 분류될 수 있는 정보</li></ul>
<h2>제3조 (유효 기간)</h2>
<p>본 계약은 <strong>{{effective_date}}</strong>부터 <strong>{{duration_months}}개월</strong>간 유효하며, 계약 만료 후에도 비밀유지의무는 종료일로부터 추가 3년간 존속한다.</p>
<h2>제4조 (의무)</h2>
<p>각 당사자는 비밀정보를 본 계약의 목적 외 사용하지 않으며, 사전 서면 동의 없이 제3자에게 공개·제공하지 않는다.</p>
<h2>제5조 (예외)</h2>
<p>다음 정보는 본 계약의 비밀정보에서 제외된다: (1) 공지의 사실 (2) 정당한 경로로 이미 알고 있던 정보 (3) 법령·법원의 명령에 의한 공개 (4) 상대방의 서면 동의에 의한 공개.</p>
<h2>제6조 (위반 시 책임)</h2>
<p>본 계약을 위반한 당사자는 상대방에게 발생한 손해를 배상하며, 영업비밀의 침해가 인정될 경우 부정경쟁방지 및 영업비밀보호에 관한 법률에 따른 책임을 진다.</p>
<h2>제7조 (관할)</h2>
<p>본 계약과 관련된 분쟁은 갑의 주된 사무소 소재지를 관할하는 법원을 제1심 관할법원으로 한다.</p>
<h2>제8조 (효력)</h2>
<p>본 계약은 위 효력일부터 효력이 발생하며, 양 당사자의 서명·날인으로 그 성립을 증명한다.</p>
<p style="margin-top:32px;text-align:center;color:#94A3B8;">— 서명란 —</p>`,
  },
  {
    kind: 'proposal',
    name: '제안서 (자유 양식)',
    description: '에디터 기반 자유 작성 제안서',
    mode: 'editor',
    locale: 'ko',
    visibility: 'client_shareable',
    body_template: `<h1>{{title}}</h1>
<p style="color:#64748B;">제안 대상: <strong>{{client.name}}</strong> · 작성: <strong>{{business.name}}</strong> · 작성일: {{issued_at}}</p>
<h2>1. 제안 배경</h2>
<p><em>고객의 현재 상황과 해결하고자 하는 문제를 간결하게 서술하세요. 고객이 본인의 상황을 이 문서에서 보고 "이해받고 있다"고 느껴야 합니다.</em></p>
<h2>2. 솔루션 제안</h2>
<p><em>핵심 가치 제안 1줄 + 3~5개 주요 기능/접근. 각 기능은 "고객이 얻는 이익" 중심으로 표현.</em></p>
<ul><li>핵심 기능 1 — 고객 이익</li><li>핵심 기능 2 — 고객 이익</li><li>핵심 기능 3 — 고객 이익</li></ul>
<h2>3. 일정 / 마일스톤</h2>
<p><em>주요 마일스톤 3~5개. 시작일 / 중간 검수 / 완료 시점 명확히.</em></p>
<table><tbody><tr><td><strong>마일스톤</strong></td><td><strong>예정일</strong></td><td><strong>산출물</strong></td></tr><tr><td>킥오프</td><td>—</td><td>요구사항 정의서</td></tr><tr><td>중간 검수</td><td>—</td><td>프로토타입</td></tr><tr><td>최종 납품</td><td>—</td><td>완성된 결과물</td></tr></tbody></table>
<h2>4. 견적</h2>
<p><em>표준 단가 표 또는 Q Bill 견적서와 연결. 부가세 별도 명시.</em></p>
<h2>5. 다음 단계</h2>
<p><em>이 제안서를 받은 후 고객이 취할 액션을 명확히. 회신 기한·미팅 일정·계약 체결 절차 등.</em></p>
<p style="background:#F0FDFA;padding:14px;border-radius:8px;color:#0F766E;">검토 후 의견 주시면 반영하여 최종안을 드리겠습니다. 회신 기한: <strong>{{valid_until}}</strong></p>`,
    ai_prompt_template: '[{{client.name}}] 에게 보낼 [{{title}}] 제안서를 작성해줘. 사용자 요구: [{{user_input}}]. 한국어, 5개 섹션(배경/솔루션/일정/견적/다음단계).',
  },
  {
    kind: 'meeting_note',
    name: '회의록 (Q note 자동 변환)',
    description: 'Q note 회의 종료 시 자동 생성. 화자별 발언, 결정사항, 액션 아이템 자동 추출',
    mode: 'editor',
    locale: 'ko',
    visibility: 'workspace_only',
    body_template: `<h1>{{session.title}}</h1>
<p><strong>일시</strong>: {{session.created_at}}<br><strong>참석자</strong>: {{session.participants}}<br><strong>장소</strong>: {{session.location}}</p>
<h2>안건</h2>
<p>{{session.brief}}</p>
<h2>핵심 발언</h2>
<p><em>(Q note 가 회의 종료 시 화자별 핵심 발언을 자동으로 채웁니다)</em></p>
<h2>결정 사항</h2>
<ul><li><em>(Q note 자동 추출)</em></li></ul>
<h2>액션 아이템</h2>
<table><tbody><tr><td><strong>담당</strong></td><td><strong>내용</strong></td><td><strong>마감</strong></td></tr><tr><td>—</td><td><em>(Q note 자동 추출 — Q Task 로 변환 가능)</em></td><td>—</td></tr></tbody></table>
<h2>다음 회의</h2>
<p><em>(필요 시 다음 회의 일정·안건 메모)</em></p>`,
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
