// Phase 1.1 mock 데이터 — 견적서 UI 검증용. 백엔드 연동 전.

export type QuoteStatus =
  | 'draft' | 'sent' | 'viewed' | 'accepted' | 'rejected' | 'expired' | 'converted';

export interface MockQuoteItem {
  id: number;
  description: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
}

export interface MockQuote {
  id: number;
  quote_number: string;
  client_id: number;
  client_name: string;
  title: string;
  status: QuoteStatus;
  currency: 'KRW' | 'USD';
  issued_at: string;       // YYYY-MM-DD
  valid_until: string;     // YYYY-MM-DD
  subtotal: number;
  vat_rate: number;        // 0.10 = 10%
  vat_amount: number;
  total_amount: number;
  payment_terms: string;
  notes: string;
  items: MockQuoteItem[];
}

export const mockClients = [
  { id: 1, name: '김고객', company: '오렌지스튜디오', country: 'KR', is_business: true },
  { id: 2, name: '박대표', company: '블루웨이브', country: 'KR', is_business: true },
  { id: 3, name: 'John Smith', company: 'Acme Inc.', country: 'US', is_business: true },
];

export const mockQuotes: MockQuote[] = [
  {
    id: 1,
    quote_number: 'Q-2026-0042',
    client_id: 1,
    client_name: '오렌지스튜디오 (김고객)',
    title: '메인 사이트 리디자인 견적',
    status: 'sent',
    currency: 'KRW',
    issued_at: '2026-04-22',
    valid_until: '2026-05-22',
    subtotal: 6000000,
    vat_rate: 0.10,
    vat_amount: 600000,
    total_amount: 6600000,
    payment_terms: '발행 후 14일 이내 계좌이체',
    notes: '디자인 시안 2회 수정 포함, 추가 수정 시 별도 견적.',
    items: [
      { id: 1, description: '메인 페이지 리디자인 (반응형)', quantity: 1, unit_price: 4000000, subtotal: 4000000 },
      { id: 2, description: '서브 페이지 리디자인 (5종)', quantity: 5, unit_price: 400000, subtotal: 2000000 },
    ],
  },
  {
    id: 2,
    quote_number: 'Q-2026-0041',
    client_id: 2,
    client_name: '블루웨이브 (박대표)',
    title: '브랜드 가이드라인 제작',
    status: 'accepted',
    currency: 'KRW',
    issued_at: '2026-04-15',
    valid_until: '2026-05-15',
    subtotal: 3000000,
    vat_rate: 0.10,
    vat_amount: 300000,
    total_amount: 3300000,
    payment_terms: '계약 시 50% / 완료 시 50%',
    notes: '',
    items: [
      { id: 1, description: '브랜드 가이드라인 (로고·컬러·타이포)', quantity: 1, unit_price: 3000000, subtotal: 3000000 },
    ],
  },
  {
    id: 3,
    quote_number: 'Q-2026-0040',
    client_id: 3,
    client_name: 'Acme Inc. (John Smith)',
    title: 'Q1 Marketing Site',
    status: 'draft',
    currency: 'USD',
    issued_at: '2026-04-10',
    valid_until: '2026-05-10',
    subtotal: 12000,
    vat_rate: 0,
    vat_amount: 0,
    total_amount: 12000,
    payment_terms: 'Net 14',
    notes: 'Includes 2 rounds of revisions.',
    items: [
      { id: 1, description: 'Marketing site (5 pages, responsive)', quantity: 1, unit_price: 12000, subtotal: 12000 },
    ],
  },
  {
    id: 4,
    quote_number: 'Q-2026-0039',
    client_id: 1,
    client_name: '오렌지스튜디오 (김고객)',
    title: '4월 외주 디자인',
    status: 'converted',
    currency: 'KRW',
    issued_at: '2026-04-01',
    valid_until: '2026-04-30',
    subtotal: 1800000,
    vat_rate: 0.10,
    vat_amount: 180000,
    total_amount: 1980000,
    payment_terms: '발행 후 7일 이내',
    notes: '',
    items: [
      { id: 1, description: '배너 디자인 (3종)', quantity: 3, unit_price: 600000, subtotal: 1800000 },
    ],
  },
];

// 색상은 COLOR_GUIDE.md 토큰만 사용 — info-100/600, primary-50/100/700, paid, error 등
export function quoteStatusColor(status: QuoteStatus): { bg: string; fg: string } {
  switch (status) {
    case 'draft':     return { bg: '#F8FAFC', fg: '#475569' };  // 작성중 (가이드)
    case 'sent':      return { bg: '#E0F2FE', fg: '#0284C7' };  // info-100/600
    case 'viewed':    return { bg: '#FEF3C7', fg: '#92400E' };  // reviewing/앰버 (가이드)
    case 'accepted':  return { bg: '#F0FDF4', fg: '#166534' };  // paid/그린 (가이드)
    case 'rejected':  return { bg: '#FEF2F2', fg: '#DC2626' };  // error 50/600 (가이드)
    case 'expired':   return { bg: '#E2E8F0', fg: '#475569' };  // completed/canceled (가이드)
    case 'converted': return { bg: '#CCFBF1', fg: '#0F766E' };  // primary-100/700 (가이드)
    default:          return { bg: '#F1F5F9', fg: '#64748B' };
  }
}

export function formatMoney(amount: number, currency: 'KRW' | 'USD'): string {
  if (currency === 'KRW') {
    return `₩${amount.toLocaleString('ko-KR')}`;
  }
  return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
