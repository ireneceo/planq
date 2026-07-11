// Q bill 설정 — 발행자 정보 (read-only) / 입금 계좌 (인라인 편집) / 청구서 기본값 (인라인 편집)
import { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import {
  getBusinessInfo, updateBusinessBilling,
  type ApiBusinessInfo, type BillingPatch,
} from '../../services/invoices';
import AutoSaveField from '../../components/Common/AutoSaveField';
import PlanQSelect, { type PlanQSelectOption } from '../../components/Common/PlanQSelect';

// 통화: 한국 계좌 1개로 외화 송금받으면 은행에서 자동 KRW 환전. 견적/청구서는 해당 통화로 표기.
// 해외 고객 송금에는 SWIFT 코드 + 영문 계좌 정보 필요 (그 입력 필드는 입금 계좌 섹션에서 추가 예정).
const CURRENCY_OPTIONS: PlanQSelectOption[] = [
  { value: 'KRW', label: 'KRW (₩)' },
  { value: 'USD', label: 'USD ($)' },
  { value: 'EUR', label: 'EUR (€)' },
  { value: 'JPY', label: 'JPY (¥)' },
  { value: 'CNY', label: 'CNY (¥)' },
];

const VAT_OPTIONS: PlanQSelectOption[] = [
  { value: '0', label: '0%' },
  { value: '0.1', label: '10%' },
];

interface SettingsTabProps {
  /** /business/settings/billing 안에서 렌더될 때 true — "워크스페이스로 이동" 버튼 숨김 */
  inWorkspaceSettings?: boolean;
}

export default function SettingsTab({ inWorkspaceSettings = false }: SettingsTabProps = {}) {
  const { t } = useTranslation('qbill');
  const navigate = useNavigate();
  const { user } = useAuth();
  const businessId = user?.business_id ? Number(user.business_id) : null;
  // 입금 계좌·Stripe 키 = 돈이 들어오는 경로. owner/admin 만 편집 가능 (백엔드 게이트와 동일).
  const canManageMoney = user?.business_role === 'owner' || user?.business_role === 'admin'
    || user?.platform_role === 'platform_admin';

  const [info, setInfo] = useState<ApiBusinessInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 로컬 편집 state
  const [bankName, setBankName] = useState('');
  const [acctNumber, setAcctNumber] = useState('');
  const [acctHolder, setAcctHolder] = useState('');
  // 해외 송금용
  const [swiftCode, setSwiftCode] = useState('');
  const [bankNameEn, setBankNameEn] = useState('');
  const [acctHolderEn, setAcctHolderEn] = useState('');
  const [dueDays, setDueDays] = useState<number>(14);
  const [vatRate, setVatRate] = useState<number>(0.1);
  const [currency, setCurrency] = useState('KRW');
  // 정기청구 + 연체
  const [autoMode, setAutoMode] = useState<'auto' | 'draft_review'>('draft_review');
  const [billingDay, setBillingDay] = useState<number>(1);
  const [graceDays, setGraceDays] = useState<number>(7);
  // Stripe (카드결제) — publishable 평문 + secret/webhook write-only(로컬 입력, 설정여부는 info.*_set 배지)
  const [stripePub, setStripePub] = useState('');
  const [stripeSecretInput, setStripeSecretInput] = useState('');
  const [stripeWebhookInput, setStripeWebhookInput] = useState('');
  const [reveal, setReveal] = useState<Record<string, boolean>>({});

  const hydrated = useRef(false);

  useEffect(() => {
    if (!businessId) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    getBusinessInfo(businessId)
      .then(d => {
        if (cancelled) return;
        setInfo(d); setError(null);
        setBankName(d.bank_name || '');
        setAcctNumber(d.bank_account_number || '');
        setAcctHolder(d.bank_account_name || '');
        setSwiftCode(d.swift_code || '');
        setBankNameEn(d.bank_name_en || '');
        setAcctHolderEn(d.bank_account_name_en || '');
        setDueDays(d.default_due_days ?? 14);
        setVatRate(Number(d.default_vat_rate ?? 0.1));
        setCurrency(d.default_currency || 'KRW');
        setAutoMode((d.auto_invoice_default_mode as 'auto' | 'draft_review') || 'draft_review');
        setBillingDay(d.auto_invoice_default_billing_day ?? 1);
        setGraceDays(d.overdue_grace_days ?? 7);
        setStripePub(d.stripe_publishable_key || '');
        hydrated.current = true;
      })
      .catch(err => { if (!cancelled) setError(err.message || 'load failed'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [businessId]);

  const goWorkspace = () => navigate('/business/settings');

  const save = async (patch: BillingPatch) => {
    if (!businessId) return;
    const updated = await updateBusinessBilling(businessId, patch);
    setInfo(updated);
  };

  if (loading) return <Loading>{t('common.loading')}</Loading>;
  if (error) return <ErrorBanner>{error}</ErrorBanner>;
  if (!info) return <ErrorBanner>워크스페이스 정보를 불러올 수 없습니다.</ErrorBanner>;

  // 법인 정보 누락 항목
  const issuerMissing: string[] = [];
  if (!info.legal_name && !info.name) issuerMissing.push(t('settings.issuer.legalName') as string);
  if (!info.tax_id) issuerMissing.push(t('settings.issuer.taxId') as string);
  if (!info.representative) issuerMissing.push(t('settings.issuer.representative') as string);
  if (!info.address) issuerMissing.push(t('settings.issuer.address') as string);

  return (
    <Wrap>
      {/* 워크스페이스 통합 설정 안에서는: 법인 정보가 다 있으면 표시 X, 누락 있으면 경고 + 링크만 */}
      {/* 외부 (Q Bill 페이지) 진입 시에만 read-only 카드로 보여주기 */}
      {!inWorkspaceSettings && (
        <Section>
          <SectionHead>
            <div>
              <SectionTitle>{t('settings.issuer.title')}</SectionTitle>
              <SectionDesc>{t('settings.issuer.desc')}</SectionDesc>
            </div>
            <SecondaryBtn type="button" onClick={goWorkspace}>{t('settings.issuer.viewWorkspace')}</SecondaryBtn>
          </SectionHead>
          <FieldGrid>
            <Field>
              <FieldLabel>{t('settings.issuer.legalName')}</FieldLabel>
              <FieldVal>{info.legal_name || info.name || <Hole>{t('settings.issuer.empty', '없음')}</Hole>}</FieldVal>
            </Field>
            <Field>
              <FieldLabel>{t('settings.issuer.taxId')}</FieldLabel>
              <FieldVal>{info.tax_id || <Hole>{t('settings.issuer.empty', '없음')}</Hole>}</FieldVal>
            </Field>
            <Field>
              <FieldLabel>{t('settings.issuer.representative')}</FieldLabel>
              <FieldVal>{info.representative || <Hole>{t('settings.issuer.empty', '없음')}</Hole>}</FieldVal>
            </Field>
            <Field $span={2}>
              <FieldLabel>{t('settings.issuer.address')}</FieldLabel>
              <FieldVal>{info.address || <Hole>{t('settings.issuer.empty', '없음')}</Hole>}</FieldVal>
            </Field>
          </FieldGrid>
        </Section>
      )}

      {/* 통합 설정 안에서 — 누락 항목만 작은 경고 배너 */}
      {inWorkspaceSettings && issuerMissing.length > 0 && (
        <IssuerWarn>
          <IssuerWarnIcon>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          </IssuerWarnIcon>
          <IssuerWarnBody>
            <IssuerWarnTitle>{t('settings.issuer.missingTitle', '청구서·세금계산서 발행에 필요한 법인 정보가 비어 있습니다')}</IssuerWarnTitle>
            <IssuerWarnDesc>{t('settings.issuer.missingDesc', '누락: {{list}}', { list: issuerMissing.join(', ') })}</IssuerWarnDesc>
          </IssuerWarnBody>
          <IssuerWarnLink type="button" onClick={() => navigate('/business/settings/legal')}>
            {t('settings.issuer.fixLink', '법인 정보 입력하기')}
          </IssuerWarnLink>
        </IssuerWarn>
      )}

      {/* 입금 계좌 (인라인 편집) */}
      <Section>
        <SectionHead>
          <div>
            <SectionTitle>{t('settings.bank.title')}</SectionTitle>
            <SectionDesc>{t('settings.bank.desc')}</SectionDesc>
            {!canManageMoney && (
              <SectionDesc>{t('settings.bank.ownerOnly', '입금 계좌는 소유자·관리자만 변경할 수 있습니다. 고객 송금이 들어오는 계좌라 읽기 전용으로 표시됩니다.')}</SectionDesc>
            )}
          </div>
        </SectionHead>
        <EditGrid>
          <EditField>
            <EditLabel>{t('settings.bank.bank')}</EditLabel>
            <AutoSaveField type="input" onSave={async () => save({ bank_name: bankName.trim() || null })}>
              <EditInput type="text" value={bankName} onChange={e => setBankName(e.target.value)} disabled={!canManageMoney} placeholder={t('settings.misc.bankPlaceholder', { defaultValue: '우리은행' }) as string} />
            </AutoSaveField>
          </EditField>
          <EditField>
            <EditLabel>{t('settings.bank.account')}</EditLabel>
            <AutoSaveField type="input" onSave={async () => save({ bank_account_number: acctNumber.trim() || null })}>
              <EditInput type="text" value={acctNumber} onChange={e => setAcctNumber(e.target.value)} disabled={!canManageMoney} placeholder="000-000-000000"
                style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }} />
            </AutoSaveField>
          </EditField>
          <EditField>
            <EditLabel>{t('settings.bank.holder')}</EditLabel>
            <AutoSaveField type="input" onSave={async () => save({ bank_account_name: acctHolder.trim() || null })}>
              <EditInput type="text" value={acctHolder} onChange={e => setAcctHolder(e.target.value)} disabled={!canManageMoney} placeholder={info.legal_name || info.name || ''} />
            </AutoSaveField>
          </EditField>
          <EditField>
            <EditLabel>{t('settings.bank.swift', 'SWIFT/BIC 코드')}</EditLabel>
            <AutoSaveField type="input" onSave={async () => save({ swift_code: swiftCode.trim() || null })}>
              <EditInput
                type="text"
                value={swiftCode}
                onChange={e => setSwiftCode(e.target.value.toUpperCase())}
                placeholder="WORIKRSE"
                maxLength={20}
                style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
              />
            </AutoSaveField>
            <FieldHint>{t('settings.bank.swiftHint', '예: 우리은행 WORIKRSE — 해외 송금에 필요')}</FieldHint>
          </EditField>
          <EditField>
            <EditLabel>{t('settings.bank.bankNameEn', '영문 은행명')}</EditLabel>
            <AutoSaveField type="input" onSave={async () => save({ bank_name_en: bankNameEn.trim() || null })}>
              <EditInput type="text" value={bankNameEn} onChange={e => setBankNameEn(e.target.value)} disabled={!canManageMoney} placeholder="Woori Bank" />
            </AutoSaveField>
          </EditField>
          <EditField $span={2}>
            <EditLabel>{t('settings.bank.holderEn', '영문 예금주')}</EditLabel>
            <AutoSaveField type="input" onSave={async () => save({ bank_account_name_en: acctHolderEn.trim() || null })}>
              <EditInput type="text" value={acctHolderEn} onChange={e => setAcctHolderEn(e.target.value)} disabled={!canManageMoney} placeholder="WORPRORAB CO., LTD." />
            </AutoSaveField>
            <FieldHint>{t('settings.bank.holderEnHint', '사업자등록증의 영문 상호 — 외화 청구서에 표시됩니다')}</FieldHint>
          </EditField>
        </EditGrid>
      </Section>

      {/* 카드결제 (Stripe) — 워크스페이스 자체 Stripe 계정 */}
      <Section>
        <SectionHead>
          <div>
            <SectionTitle>{t('settings.stripe.title', '카드 결제 (Stripe)')}</SectionTitle>
            <SectionDesc>{t('settings.stripe.desc', 'Secret Key 와 Webhook Secret 을 모두 입력해야 청구서 공개 결제 페이지에 "카드로 결제" 버튼이 켜집니다. Webhook 이 없으면 고객이 결제해도 청구서가 자동으로 결제 완료 처리되지 않기 때문입니다. Secret Key·Webhook Secret 은 암호화되어 저장되며 화면에 다시 표시되지 않습니다. 카드 결제 시 회차가 즉시 확정됩니다.')}</SectionDesc>
            <SectionDesc>{t('settings.stripe.whose', '여기 넣는 Stripe 계정은 이 워크스페이스의 것입니다. 고객이 카드로 결제하면 그 돈은 PlanQ 를 거치지 않고 이 계정으로 바로 들어옵니다. Stripe 계정은 도메인과 무관하므로 이미 쓰는 계정이 있으면 그대로 쓰면 되고, Webhook 만 이 화면에 표시된 주소로 하나 더 등록해 그 Signing secret 을 넣으세요.')}</SectionDesc>
          </div>
        </SectionHead>
        <EditGrid>
          <EditField $span={2}>
            <EditLabel>{t('settings.stripe.publishable', 'Publishable Key')}</EditLabel>
            <AutoSaveField type="input" onSave={async () => save({ stripe_publishable_key: stripePub.trim() || null })}>
              <EditInput type="text" value={stripePub} onChange={e => setStripePub(e.target.value)} disabled={!canManageMoney} placeholder="pk_live_..." />
            </AutoSaveField>
          </EditField>
          <EditField $span={2}>
            <EditLabel>
              {t('settings.stripe.secret', 'Secret Key')}
              {info.stripe_secret_set
                ? <SetBadge>{t('settings.stripe.set', '설정됨')}</SetBadge>
                : <UnsetBadge>{t('settings.stripe.unset', '미설정')}</UnsetBadge>}
            </EditLabel>
            <SecretRow>
              <AutoSaveField type="input" onSave={async () => { const v = stripeSecretInput.trim(); if (v) { await save({ stripe_secret: v }); setStripeSecretInput(''); } }}>
                <EditInput type={reveal.ss ? 'text' : 'password'} value={stripeSecretInput} autoComplete="off"
                  onChange={e => setStripeSecretInput(e.target.value)} disabled={!canManageMoney}
                  placeholder={info.stripe_secret_set ? (t('settings.stripe.keepPh', '변경하려면 새 값 입력 (비우면 유지)') as string) : 'sk_live_...'} />
              </AutoSaveField>
              <RevealBtn type="button" onClick={() => setReveal(r => ({ ...r, ss: !r.ss }))}>
                {reveal.ss ? t('settings.stripe.hide', '숨기기') : t('settings.stripe.show', '보기')}
              </RevealBtn>
            </SecretRow>
            {info.stripe_secret_set && (
              <ClearBtn type="button" onClick={() => save({ stripe_secret: '' })}>{t('settings.stripe.clear', '삭제 (카드 결제 비활성화)')}</ClearBtn>
            )}
          </EditField>
          <EditField $span={2}>
            <EditLabel>
              {t('settings.stripe.webhook', 'Webhook Secret')}
              {info.stripe_webhook_secret_set
                ? <SetBadge>{t('settings.stripe.set', '설정됨')}</SetBadge>
                : <UnsetBadge>{t('settings.stripe.unset', '미설정')}</UnsetBadge>}
            </EditLabel>
            <SecretRow>
              <AutoSaveField type="input" onSave={async () => { const v = stripeWebhookInput.trim(); if (v) { await save({ stripe_webhook_secret: v }); setStripeWebhookInput(''); } }}>
                <EditInput type={reveal.sw ? 'text' : 'password'} value={stripeWebhookInput} autoComplete="off"
                  onChange={e => setStripeWebhookInput(e.target.value)} disabled={!canManageMoney}
                  placeholder={info.stripe_webhook_secret_set ? (t('settings.stripe.keepPh', '변경하려면 새 값 입력 (비우면 유지)') as string) : 'whsec_...'} />
              </AutoSaveField>
              <RevealBtn type="button" onClick={() => setReveal(r => ({ ...r, sw: !r.sw }))}>
                {reveal.sw ? t('settings.stripe.hide', '숨기기') : t('settings.stripe.show', '보기')}
              </RevealBtn>
            </SecretRow>
            <FieldHint>{t('settings.stripe.webhookHint', 'Stripe 대시보드 → Developers → Webhooks 에서 아래 엔드포인트를 추가한 뒤(checkout.session.completed, payment_intent.succeeded) Signing secret 을 입력하세요.')}</FieldHint>
            {businessId && (
              <WebhookUrl>{`${window.location.origin}/api/stripe/webhook/ws/${businessId}`}</WebhookUrl>
            )}
          </EditField>
        </EditGrid>
      </Section>

      {/* 청구서 기본값 (인라인 편집) */}
      <Section>
        <SectionHead>
          <div>
            <SectionTitle>{t('settings.defaults.title')}</SectionTitle>
            <SectionDesc>{t('settings.defaults.desc')}</SectionDesc>
          </div>
        </SectionHead>
        <EditGrid>
          <EditField>
            <EditLabel>{t('settings.defaults.dueDays')}</EditLabel>
            <AutoSaveField type="input" onSave={async () => save({ default_due_days: dueDays })}>
              <EditInput type="number" min={0} max={365} value={dueDays}
                onChange={e => setDueDays(Number(e.target.value) || 0)} />
            </AutoSaveField>
          </EditField>
          <EditField>
            <EditLabel>{t('settings.defaults.vatRate')}</EditLabel>
            <AutoSaveField type="select" debounceMs={300} onSave={async () => save({ default_vat_rate: vatRate })}>
              <PlanQSelect
                size="sm"
                options={VAT_OPTIONS}
                value={VAT_OPTIONS.find(o => o.value === String(vatRate)) || null}
                onChange={(opt) => opt && setVatRate(parseFloat((opt as PlanQSelectOption).value as string))}
              />
            </AutoSaveField>
          </EditField>
          <EditField>
            <EditLabel>{t('settings.defaults.currency')}</EditLabel>
            <AutoSaveField type="select" debounceMs={300} onSave={async () => save({ default_currency: currency })}>
              <PlanQSelect
                size="sm"
                options={CURRENCY_OPTIONS}
                value={CURRENCY_OPTIONS.find(o => o.value === currency) || null}
                onChange={(opt) => opt && setCurrency((opt as PlanQSelectOption).value as string)}
              />
            </AutoSaveField>
            <FieldHint>{t('settings.defaults.currencyHint', '새 청구서의 기본값입니다. 청구서별로 다른 통화를 선택할 수 있습니다.')}</FieldHint>
          </EditField>
          <EditField>
            <EditLabel>{t('settings.defaults.numberFormat')}</EditLabel>
            <FieldVal style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', padding: '7px 0' }}>INV-{`{YYYY}-{####}`}</FieldVal>
            <FieldHint>시스템 고정 (변경 불가)</FieldHint>
          </EditField>
        </EditGrid>
      </Section>

      {/* 정기 청구 자동화 */}
      <Section>
        <SectionHead>
          <div>
            <SectionTitle>{t('settings.recurring.title', '정기 청구 자동화')}</SectionTitle>
            <SectionDesc>{t('settings.recurring.desc', '월정액 프로젝트의 자동 청구 기본 동작입니다. 프로젝트별로 다르게 설정할 수도 있습니다.')}</SectionDesc>
          </div>
        </SectionHead>
        <EditGrid>
          <EditField>
            <EditLabel>{t('settings.recurring.mode', '청구 발행 방식')}</EditLabel>
            <AutoSaveField type="select" debounceMs={300} onSave={async () => save({ auto_invoice_default_mode: autoMode })}>
              <PlanQSelect
                size="sm"
                options={[
                  { value: 'draft_review', label: t('settings.recurring.modeDraft', '검토 후 발송 (초안 자동 생성)') as string },
                  { value: 'auto', label: t('settings.recurring.modeAuto', '자동 발행 + 이메일 발송') as string },
                ]}
                value={{
                  value: autoMode,
                  label: (autoMode === 'auto' ? t('settings.recurring.modeAuto', '자동 발행 + 이메일 발송') : t('settings.recurring.modeDraft', '검토 후 발송 (초안 자동 생성)')) as string,
                }}
                onChange={(opt) => opt && setAutoMode((opt as PlanQSelectOption).value as 'auto' | 'draft_review')}
              />
            </AutoSaveField>
            <FieldHint>{t('settings.recurring.modeHint', '"자동 발행" 은 사람 검토 없이 매월 청구서가 발송됩니다. 처음 운영 시에는 "검토 후 발송" 권장.')}</FieldHint>
          </EditField>
          <EditField>
            <EditLabel>{t('settings.recurring.billingDay', '매월 청구일')}</EditLabel>
            <AutoSaveField type="input" onSave={async () => save({ auto_invoice_default_billing_day: billingDay })}>
              <EditInput type="number" min={1} max={31} value={billingDay}
                onChange={e => setBillingDay(Math.max(1, Math.min(31, Number(e.target.value) || 1)))} />
            </AutoSaveField>
            <FieldHint>{t('settings.recurring.billingDayHint', '29~31 설정한 달이 그 일자까지 없는 경우 (예: 2월) 그 달 마지막 날에 발행됩니다.')}</FieldHint>
          </EditField>
        </EditGrid>
      </Section>

      {/* 연체 정책 */}
      <Section>
        <SectionHead>
          <div>
            <SectionTitle>{t('settings.overdue.title', '연체 알림')}</SectionTitle>
            <SectionDesc>
              {t('settings.overdue.desc', '결제 기한이 지나면 청구 담당자에게 "독촉 메일을 보낼까요?" 하고 물어봅니다. 고객에게는 담당자가 직접 보낼 때만 나갑니다. 모든 청구서에 적용됩니다(프로젝트 청구·단독 청구 구분 없음).')}
            </SectionDesc>
          </div>
        </SectionHead>
        <EditGrid>
          <EditField>
            <EditLabel>{t('settings.overdue.graceDays', '장기 연체로 보는 기준 일수')}</EditLabel>
            <AutoSaveField type="input" onSave={async () => save({ overdue_grace_days: graceDays })}>
              <EditInput type="number" min={1} max={60} value={graceDays}
                onChange={e => setGraceDays(Math.max(1, Math.min(60, Number(e.target.value) || 1)))} />
            </AutoSaveField>
            <FieldHint>
              {t('settings.overdue.graceDaysHint', '기한이 지난 다음 날 한 번 묻고, 그 뒤로는 7일 간격으로 다시 묻습니다. 이 일수를 넘기면 "장기 연체"로 강조해서 알립니다. 독촉을 보내면 7일간 다시 묻지 않고, 청구서별로 알림을 끌 수도 있습니다.')}
            </FieldHint>
          </EditField>
        </EditGrid>
      </Section>
    </Wrap>
  );
}

const Wrap = styled.div`display: flex; flex-direction: column; gap: 14px;`;
const Loading = styled.div`text-align: center; padding: 40px 20px; color: #94A3B8; font-size: 13px;`;
const ErrorBanner = styled.div`padding: 10px 14px; background: #FEF2F2; border: 1px solid #FECACA; color: #991B1B; border-radius: 8px; font-size: 12px;`;
const Section = styled.section`
  background: #fff; border: 1px solid #E2E8F0; border-radius: 12px; padding: 18px 20px;
  display: flex; flex-direction: column; gap: 14px;
`;
const SectionHead = styled.div`
  display: flex; justify-content: space-between; align-items: flex-start; gap: 12px;
  padding-bottom: 12px; border-bottom: 1px solid #F1F5F9;
`;
const SectionTitle = styled.h3`font-size: 15px; font-weight: 700; color: #0F172A; margin: 0;`;
const SectionDesc = styled.div`font-size: 12px; color: #64748B; margin-top: 2px;`;
const FieldGrid = styled.div`
  display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px 18px;
  @media (max-width: 720px) { grid-template-columns: 1fr; }
`;
const Field = styled.div<{ $span?: number }>`
  grid-column: span ${p => p.$span || 1};
  display: flex; flex-direction: column; gap: 4px;
  @media (max-width: 720px) { grid-column: span 1; }
`;
const FieldLabel = styled.div`font-size: 11px; font-weight: 600; color: #94A3B8; text-transform: uppercase; letter-spacing: 0.4px;`;
const FieldVal = styled.div`font-size: 13px; color: #0F172A; font-weight: 500;`;
const FieldHint = styled.div`font-size: 11px; color: #94A3B8;`;
const Hole = styled.span`color: #DC2626; font-size: 12px; font-weight: 500;`;
// 법인 정보 누락 경고 (통합 설정 안에서만)
const IssuerWarn = styled.div`
  display: flex; gap: 12px; align-items: center;
  background: #FFFBEB; border: 1px solid #FDE68A; border-radius: 10px;
  padding: 12px 16px;
  @media (max-width: 640px) { flex-direction: column; align-items: flex-start; }
`;
const IssuerWarnIcon = styled.div`
  flex-shrink: 0; color: #B45309;
  display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; background: #fff; border: 1px solid #FCD34D; border-radius: 8px;
`;
const IssuerWarnBody = styled.div`flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0;`;
const IssuerWarnTitle = styled.div`font-size: 13px; font-weight: 700; color: #92400E;`;
const IssuerWarnDesc = styled.div`font-size: 12px; color: #B45309;`;
const IssuerWarnLink = styled.button`
  flex-shrink: 0; padding: 7px 14px; font-size: 12px; font-weight: 700;
  background: #fff; border: 1px solid #FCD34D; border-radius: 8px; color: #B45309; cursor: pointer;
  transition: background 0.12s;
  &:hover { background: #FEF3C7; }
  &:focus-visible { outline: 2px solid #F59E0B; outline-offset: 2px; }
`;
const EditGrid = styled.div`
  display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px 20px;
  @media (max-width: 720px) { grid-template-columns: 1fr; }
`;
const EditField = styled.div<{ $span?: number }>`
  grid-column: span ${p => p.$span || 1};
  display: flex; flex-direction: column; gap: 6px;
  @media (max-width: 720px) { grid-column: span 1; }
`;
const EditLabel = styled.label`font-size: 11px; font-weight: 600; color: #475569; text-transform: uppercase; letter-spacing: 0.4px;`;
const EditInput = styled.input`
  width: 100%; padding: 8px 10px; font-size: 13px; color: #0F172A;
  background: #fff; border: 1px solid #E2E8F0; border-radius: 8px;
  font-variant-numeric: tabular-nums;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.15); }
`;
const SecondaryBtn = styled.button`
  display: inline-flex; align-items: center; gap: 6px;
  padding: 9px 14px; font-size: 13px; font-weight: 600; color: #334155;
  background: #fff; border: 1px solid #E2E8F0; border-radius: 8px; cursor: pointer;
  line-height: 1; white-space: nowrap;
  & > svg { display: block; flex-shrink: 0; }
  &:hover { background: #F8FAFC; border-color: #CBD5E1; }
`;
// Stripe 시크릿 UI (write-only)
const SecretRow = styled.div`
  display: flex; gap: 8px; align-items: stretch;
  > div:first-child { flex: 1; }
`;
const RevealBtn = styled.button`
  padding: 0 12px; font-size: 12px; font-weight: 600; color: #64748B;
  background: #fff; border: 1px solid #E2E8F0; border-radius: 8px; cursor: pointer;
  flex-shrink: 0; white-space: nowrap;
  &:hover { color: #0F172A; background: #F8FAFC; }
`;
const SetBadge = styled.span`
  display: inline-block; margin-left: 6px; font-size: 10px; font-weight: 700; color: #0F766E;
  background: #F0FDFA; border: 1px solid #99F6E4; border-radius: 5px; padding: 1px 6px; letter-spacing: 0;
`;
const UnsetBadge = styled.span`
  display: inline-block; margin-left: 6px; font-size: 10px; font-weight: 700; color: #94A3B8;
  background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 5px; padding: 1px 6px; letter-spacing: 0;
`;
const ClearBtn = styled.button`
  align-self: flex-start; font-size: 12px; font-weight: 600; color: #B91C1C;
  background: transparent; border: none; padding: 2px 0; cursor: pointer;
  &:hover { text-decoration: underline; }
`;
const WebhookUrl = styled.code`
  display: block; font-size: 12px; color: #0F172A; word-break: break-all;
  background: #F1F5F9; border: 1px solid #E2E8F0; border-radius: 6px; padding: 6px 8px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
`;
