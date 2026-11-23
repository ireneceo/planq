// 첫 방문 업무설계 컨설팅 — 1시간, 처음 1회만 150,000원(정가 300,000원, 50%) (2026-11-23 Irene 요청).
//
// 신청은 새 폼·새 접수 종류를 만들지 않는다 — /contact?type=visit (문의 폼의 모드, 접수 원장 contact_inquiries 그대로).
// 수행 주체는 워프로랩 스튜디오 — 제품(PlanQ) 요금표(PricingPage)에는 가격을 넣지 않는다(2026-10-12 Fable 판정 그대로).
// 문구는 전부 landing 네임스페이스 `visitConsult.*` 한 곳 — 서비스 페이지·문의 페이지가 같은 약속을 말해야 한다.
import styled from 'styled-components';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export const VISIT_URL = '/contact?type=visit';
const GETS = ['g0', 'g1', 'g2'] as const;

/** 혜택 카드 — 서비스 페이지 첫 화면·방문 신청 폼 위. `withCta` 면 신청 버튼을 단다. */
export const VisitConsultOffer: React.FC<{ withCta?: boolean; testId?: string }> = ({ withCta = true, testId }) => {
  const { t } = useTranslation('landing');
  return (
    <Card data-testid={testId ?? 'visit-consult-offer'}>
      <Badge>{t('visitConsult.badge')}</Badge>
      <CardTitle>{t('visitConsult.title')}</CardTitle>
      <PriceRow>
        <Regular aria-label={t('visitConsult.regularAria') as string}>{t('visitConsult.regular')}</Regular>
        <Price>{t('visitConsult.price')}</Price>
        <PriceNote>{t('visitConsult.priceNote')}</PriceNote>
      </PriceRow>
      <CardLead>{t('visitConsult.lead')}</CardLead>
      <GetsLabel>{t('visitConsult.getsLabel')}</GetsLabel>
      <Gets>
        {GETS.map(k => (
          <GetItem key={k}><Check aria-hidden="true">✓</Check>{t(`visitConsult.${k}`)}</GetItem>
        ))}
      </Gets>
      <Assure>{t('visitConsult.assure')}</Assure>
      {withCta && <CardCta to={VISIT_URL} data-testid="visit-consult-cta">{t('visitConsult.cta')}</CardCta>}
      <Fine>{t('visitConsult.fine')}</Fine>
    </Card>
  );
};

/** 한 줄 안내 — 견적·화상 안내 폼 위에서 «처음이면 방문 컨설팅부터» 로 잇는다. */
export const VisitConsultHint: React.FC<{ testId?: string }> = ({ testId }) => {
  const { t } = useTranslation('landing');
  return (
    <Hint data-testid={testId ?? 'visit-consult-hint'}>
      <HintBadge>{t('visitConsult.hintBadge')}</HintBadge>
      <span>{t('visitConsult.hint')}</span>
      <HintLink to={VISIT_URL}>{t('visitConsult.hintLink')}</HintLink>
    </Hint>
  );
};

// ─── styled ───
const Card = styled.div`
  max-width: 560px; margin: 28px auto 0; padding: 28px 28px 22px;
  background: #FFFFFF; border: 2px solid #14B8A6; border-radius: 18px;
  box-shadow: 0 16px 40px rgba(20,184,166,0.14);
  text-align: left; position: relative;
  @media (max-width: 640px) { padding: 24px 18px 18px; }
`;
const Badge = styled.span`
  display: inline-block; padding: 4px 10px; border-radius: 999px;
  background: #F43F5E; color: #FFFFFF; font-size: 0.75rem; font-weight: 700;
`;
const CardTitle = styled.h2`
  margin: 12px 0 6px; font-size: 1.375rem; font-weight: 700; color: #0F172A;
  line-height: 1.4; word-break: keep-all;
`;
const PriceRow = styled.div`display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 10px;`;
const Regular = styled.s`font-size: 0.9375rem; color: #94A3B8;`;
const Price = styled.strong`font-size: 1.75rem; font-weight: 800; color: #0F766E; letter-spacing: -0.3px;`;
const PriceNote = styled.span`font-size: 0.8125rem; font-weight: 600; color: #F43F5E;`;
const CardLead = styled.p`
  margin: 12px 0 14px; font-size: 0.9375rem; color: #334155; line-height: 1.7; word-break: keep-all;
`;
const GetsLabel = styled.div`font-size: 0.8125rem; font-weight: 700; color: #0F172A; margin-bottom: 8px;`;
const Gets = styled.ul`list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px;`;
const GetItem = styled.li`
  display: flex; gap: 8px; font-size: 0.875rem; color: #334155; line-height: 1.6; word-break: keep-all;
`;
const Check = styled.span`flex-shrink: 0; color: #14B8A6; font-weight: 800;`;
const Assure = styled.p`
  margin: 14px 0 0; padding: 10px 12px; border-radius: 10px; background: #F0FDFA;
  font-size: 0.8125rem; font-weight: 600; color: #0F766E; line-height: 1.6; word-break: keep-all;
`;
const CardCta = styled(Link)`
  display: flex; align-items: center; justify-content: center;
  margin-top: 16px; min-height: 50px; border-radius: 999px;
  background: #0F766E; color: #FFFFFF; font-size: 1rem; font-weight: 700; text-decoration: none;
  transition: background 0.2s, transform 0.2s;
  &:hover { background: #115E59; transform: translateY(-1px); }
`;
const Fine = styled.p`
  margin: 10px 0 0; font-size: 0.75rem; color: #94A3B8; text-align: center; word-break: keep-all;
`;

const Hint = styled.div`
  display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px;
  padding: 12px 14px; border-radius: 12px;
  background: #FFF1F2; border: 1px solid #FECDD3;
  font-size: 0.8125rem; color: #334155; line-height: 1.6; word-break: keep-all;
`;
const HintBadge = styled.span`
  padding: 2px 8px; border-radius: 999px; background: #F43F5E; color: #FFFFFF;
  font-size: 0.6875rem; font-weight: 700; white-space: nowrap;
`;
const HintLink = styled(Link)`
  color: #0F766E; font-weight: 700; text-decoration: none; white-space: nowrap;
  &:hover { text-decoration: underline; }
`;
