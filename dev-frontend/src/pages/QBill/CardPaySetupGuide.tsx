// 설정 › 청구 — 카드 결제 설정 방법 안내 (2026-10-16).
//   Irene: *"워크스페이스에 제대로 안내를 해. 나중에 거기 보고 진행할게. 워크스페이스 유저라고 생각하고 대응해줘."*
//   그래서 운영자에게 따로 보내던 순서(Stripe 웹훅·키·대금 받는 곳·시험 결제 / 국내 결제 링크)를 화면 안에 둔다.
//   단계 모양은 공용 setupSteps(프로필 › AI 앱 연결과 같은 것). 아직 설정 전이면 펼쳐 두고, 끝났으면 접어 둔다.
import { useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { HowTo, Steps, OpenRow, OpenLink, StepHint } from '../../components/Common/setupSteps';

const STRIPE = {
  webhooks: 'https://dashboard.stripe.com/webhooks',
  apiKeys: 'https://dashboard.stripe.com/apikeys',
  publicDetails: 'https://dashboard.stripe.com/settings/public',
};
const LINK_PROVIDERS = {
  toss: 'https://www.tosspayments.com',
  payapp: 'https://www.payapp.kr',
};

function CopyRow({ value, testId }: { value: string; testId: string }) {
  const { t } = useTranslation('qbill');
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* 복사 불가 환경 — 주소는 화면에 보인다 */ }
  };
  return (
    <UrlRow>
      <Url>{value}</Url>
      <CopyBtn type="button" onClick={copy} data-testid={testId}>
        {copied ? t('settings.guide.copied', '복사됨') : t('settings.guide.copy', '복사')}
      </CopyBtn>
    </UrlRow>
  );
}

export function StripeSetupGuide({ businessId, configured }: { businessId: number | null; configured: boolean }) {
  const { t } = useTranslation('qbill');
  const webhookUrl = businessId ? `${window.location.origin}/api/stripe/webhook/ws/${businessId}` : '';
  return (
    <Guide open={!configured} data-testid="bill-stripe-guide">
      <Summary>{t('settings.guide.stripe.summary', 'Stripe 카드 결제 설정 방법')}</Summary>
      <HowTo>
        <Notice>{t('settings.guide.stripe.entity', '먼저 확인하세요 — 카드 대금은 Stripe 계정에 등록된 사업자로 들어갑니다. 청구서를 보내는 사업자와 Stripe 계정의 사업자가 다르면(예: 해외 법인 계정) 세금계산서·매출 처리를 세무 담당자와 먼저 확인하세요. 국내 사업자로 바로 받으려면 아래 «카드 결제 링크» 를 쓰면 됩니다.')}</Notice>
        <Steps>
          <li>
            <span>{t('settings.guide.stripe.step1', 'Webhook 주소를 복사합니다.')}</span>
            {webhookUrl && <CopyRow value={webhookUrl} testId="bill-stripe-guide-copy-webhook" />}
          </li>
          <li>
            <span>{t('settings.guide.stripe.step2', 'Stripe 대시보드 › 개발자 › Webhooks › «엔드포인트 추가» 에 그 주소를 붙여 넣고, 이벤트 checkout.session.completed 와 payment_intent.succeeded 두 개를 고른 뒤 저장합니다. 만든 엔드포인트의 Signing secret(whsec_…) 을 복사합니다.')}</span>
            <StepHint>{t('settings.guide.stripe.step2Hint', '이미 다른 용도의 Webhook 이 있어도 지우지 말고 하나 더 만드세요.')}</StepHint>
            <OpenRow><OpenLink href={STRIPE.webhooks} target="_blank" rel="noopener noreferrer">{t('settings.guide.stripe.openWebhooks', 'Stripe Webhooks 열기')} ↗</OpenLink></OpenRow>
          </li>
          <li>
            <span>{t('settings.guide.stripe.step3', 'Stripe 대시보드 › 개발자 › API 키에서 Publishable key(pk_live_…) 와 Secret key(sk_live_…) 를 복사합니다.')}</span>
            <OpenRow><OpenLink href={STRIPE.apiKeys} target="_blank" rel="noopener noreferrer">{t('settings.guide.stripe.openKeys', 'Stripe API 키 열기')} ↗</OpenLink></OpenRow>
          </li>
          <li>
            <span>{t('settings.guide.stripe.step4', '아래 Publishable Key · Secret Key · Webhook Secret 세 칸에 붙여 넣습니다. 자동으로 저장되고, 두 칸이 «설정됨» 으로 바뀌면 고객 청구서에 «카드로 결제» 버튼이 켜집니다.')}</span>
          </li>
          <li>
            <span>{t('settings.guide.stripe.step5', '«대금 받는 곳» 에 Stripe 계정에 등록된 사업자 이름과 등록번호를 넣습니다. 고객 청구서의 카드 버튼 아래에 보입니다. Stripe 결제창 위쪽과 카드 명세서에 찍히는 이름은 Stripe › 설정 › 공개 상세정보에서 정해지므로 같은 이름으로 맞춰 두세요.')}</span>
            <OpenRow><OpenLink href={STRIPE.publicDetails} target="_blank" rel="noopener noreferrer">{t('settings.guide.stripe.openPublic', 'Stripe 공개 상세정보 열기')} ↗</OpenLink></OpenRow>
          </li>
          <li>
            <span>{t('settings.guide.stripe.step6', '시험해 봅니다 — 1,000원짜리 청구서를 발행하고 고객용 링크에서 «카드로 결제» 로 실제 결제합니다. 몇 초 뒤 청구서가 «결제 완료» 로 바뀌면 끝입니다. 시험 결제는 Stripe 대시보드에서 환불하세요.')}</span>
            <StepHint>{t('settings.guide.stripe.step6Hint', '«결제 완료» 로 바뀌지 않으면 Webhook 주소·이벤트 두 개·Webhook Secret 이 맞는지 다시 확인하세요.')}</StepHint>
          </li>
        </Steps>
      </HowTo>
    </Guide>
  );
}

export function CardLinkSetupGuide() {
  const { t } = useTranslation('qbill');
  return (
    <Guide data-testid="bill-cardlink-guide">
      <Summary>{t('settings.guide.link.summary', '카드 결제 링크 사용 방법')}</Summary>
      <HowTo>
        <Steps>
          <li>
            <span>{t('settings.guide.link.step1', '결제 대행사에 가입합니다. 토스페이먼츠 «링크페이», 페이앱처럼 결제 링크를 만들 수 있는 곳이면 됩니다(가입 심사가 있을 수 있습니다).')}</span>
            <OpenRow>
              <OpenLink href={LINK_PROVIDERS.toss} target="_blank" rel="noopener noreferrer">{t('settings.guide.link.openToss', '토스페이먼츠')} ↗</OpenLink>
              <OpenLink href={LINK_PROVIDERS.payapp} target="_blank" rel="noopener noreferrer">{t('settings.guide.link.openPayapp', '페이앱')} ↗</OpenLink>
            </OpenRow>
          </li>
          <li>
            <span>{t('settings.guide.link.step2', '결제 대행사에 청구서 공급자와 다른 사업자로 가입했다면 아래 «대금 받는 곳» 에 그 이름과 등록번호를 넣습니다. 같다면 비워 두세요 — 공급자 정보가 보입니다.')}</span>
          </li>
          <li>
            <span>{t('settings.guide.link.step3', '청구서를 발행한 뒤, 결제 대행사에서 그 금액으로 결제 링크를 만듭니다. 분할 청구서는 회차마다 만듭니다.')}</span>
          </li>
          <li>
            <span>{t('settings.guide.link.step4', 'Q Bill › 청구서 상세의 «카드 결제 링크» 칸에 붙여 넣습니다. 고객용 청구서에 «카드로 결제» 버튼이 생깁니다.')}</span>
          </li>
          <li>
            <span>{t('settings.guide.link.step5', '결제 결과는 PlanQ 로 전달되지 않습니다. 결제 대행사 화면에서 입금을 확인한 뒤 청구서에서 «결제 완료» 를 표시하세요.')}</span>
          </li>
        </Steps>
      </HowTo>
    </Guide>
  );
}

// 접고 펴는 안내 — 네이티브 details(키보드·스크린리더 그대로).
const Guide = styled.details`
  border: 1px solid #E2E8F0; border-radius: 10px; background: #F8FAFC; padding: 0 14px;
  &[open] { padding-bottom: 4px; }
`;
const Summary = styled.summary`
  min-height: 40px; display: flex; align-items: center; cursor: pointer;
  font-size: 0.8125rem; font-weight: 700; color: #0F766E; list-style-position: inside;
  &:focus-visible { outline: 2px solid #5EEAD4; outline-offset: 2px; border-radius: 6px; }
`;
const Notice = styled.div`
  padding: 8px 10px; border-radius: 8px; background: #FFFBEB; border: 1px solid #FDE68A; color: #92400E;
`;
const UrlRow = styled.div`display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-top: 6px; min-width: 0;`;
const Url = styled.code`
  font-size: 0.75rem; background: #fff; border: 1px solid #E2E8F0; border-radius: 6px; padding: 6px 8px;
  color: #0F172A; word-break: break-all; min-width: 0; flex: 1 1 220px;
`;
const CopyBtn = styled.button`
  height: 32px; padding: 0 12px; border-radius: 6px; border: 1px solid #CBD5E1; background: #fff;
  font-size: 0.75rem; font-weight: 600; color: #334155; cursor: pointer;
  &:hover { background: #F1F5F9; }
  &:focus-visible { outline: 2px solid #5EEAD4; outline-offset: 2px; }
  @media (max-width: 640px) { height: 40px; }
`;
