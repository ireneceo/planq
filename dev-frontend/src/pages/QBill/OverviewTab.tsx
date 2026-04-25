import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import { mockQuotes, formatMoney } from './mock';

// Phase 1.1 mock: 견적 데이터로 간이 카드 4개 + 견적 액티비티 placeholder.
// 청구서/결제 데이터는 다음 Phase 에 들어옴.
export default function OverviewTab() {
  const { t } = useTranslation('qbill');

  const sumKR = mockQuotes
    .filter((q) => q.currency === 'KRW')
    .reduce((s, q) => s + q.total_amount, 0);
  const accepted = mockQuotes.filter((q) => q.status === 'accepted' || q.status === 'converted')
    .filter((q) => q.currency === 'KRW')
    .reduce((s, q) => s + q.total_amount, 0);
  const sent = mockQuotes.filter((q) => q.status === 'sent' || q.status === 'viewed')
    .filter((q) => q.currency === 'KRW')
    .reduce((s, q) => s + q.total_amount, 0);

  return (
    <>
      <SectionTitle>{t('overview.title')}</SectionTitle>
      <Cards>
        <Card>
          <CardLabel>{t('overview.billed')}</CardLabel>
          <CardValue>{formatMoney(sumKR, 'KRW')}</CardValue>
        </Card>
        <Card>
          <CardLabel>{t('overview.collected')}</CardLabel>
          <CardValue>{formatMoney(accepted, 'KRW')}</CardValue>
        </Card>
        <Card>
          <CardLabel>{t('overview.outstanding')}</CardLabel>
          <CardValue>{formatMoney(sent, 'KRW')}</CardValue>
        </Card>
        <Card>
          <CardLabel>{t('overview.overdue')}</CardLabel>
          <CardValue>{formatMoney(0, 'KRW')}</CardValue>
        </Card>
      </Cards>

      <PlaceholderRow>
        <PlaceholderCard>
          <PlaceholderTitle>{t('overview.trend')}</PlaceholderTitle>
          <PlaceholderEmpty>{t('overview.empty')}</PlaceholderEmpty>
        </PlaceholderCard>
        <PlaceholderCard>
          <PlaceholderTitle>{t('overview.topUnpaid')}</PlaceholderTitle>
          <PlaceholderEmpty>{t('overview.empty')}</PlaceholderEmpty>
        </PlaceholderCard>
      </PlaceholderRow>
    </>
  );
}

const SectionTitle = styled.div`
  font-size: 13px;
  font-weight: 600;
  color: #475569;
  margin-bottom: 12px;
`;
const Cards = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
  margin-bottom: 24px;
`;
const Card = styled.div`
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 16px;
`;
const CardLabel = styled.div`
  font-size: 11px;
  color: #64748B;
  font-weight: 500;
  margin-bottom: 6px;
`;
const CardValue = styled.div`
  font-size: 20px;
  font-weight: 700;
  color: #0F172A;
  letter-spacing: -0.3px;
`;
const PlaceholderRow = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 12px;
`;
const PlaceholderCard = styled.div`
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 20px;
  min-height: 180px;
`;
const PlaceholderTitle = styled.div`
  font-size: 13px;
  font-weight: 600;
  color: #0F172A;
  margin-bottom: 12px;
`;
const PlaceholderEmpty = styled.div`
  color: #94A3B8;
  font-size: 12px;
  padding: 28px 0;
  text-align: center;
`;
