// 결제 설정 — platform_admin 만
// 라우트: /admin/billing-settings
//
// 구성 원칙(Irene 지시 "넣어야 하는 것만 딱 알게"): 결과 → 입력 순서.
//   ① 결제 수단 현황(켜짐/꺼짐과 부족한 것) → ② 카드 결제 2단계 → ③ 계좌이체 → ④ 정책
// 카드 결제 활성 판정은 서버가 내려주는 stripe_enabled 하나만 쓴다. 화면에서 _set 두 개를
//   재조합하면 암호화 키 회전·blob 손상 시 실제로는 꺼져 있는데 "켜짐" 으로 보인다.
// PortOne 은 걷어냈다(2026-07-25) — 입력 경로만 제거하고 DB 컬럼·결제 이력 ENUM 은 보존.

import { useEffect, useState, useCallback } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import PageShell from '../../components/Layout/PageShell';
import AutoSaveField from '../../components/Common/AutoSaveField';
import { apiFetch } from '../../contexts/AuthContext';
import ProviderCreditCard from './ProviderCreditCard';   // 외부 API 선불 크레딧 현황·충전 경보

interface BillingSettings {
  bank_name: string | null;
  bank_account_number: string | null;
  bank_account_holder: string | null;
  bank_name_en: string | null;
  bank_account_holder_en: string | null;
  swift_code: string | null;
  // Stripe. publishable 은 평문, secret/webhook 은 write-only → GET 은 설정여부 boolean 만.
  stripe_publishable_key: string | null;
  stripe_secret_set: boolean;
  stripe_webhook_secret_set: boolean;
  stripe_enabled: boolean;      // 서버 판정 (복호화까지 성공해야 true)
  default_vat_rate: number;
  default_due_days: number;
}

const EMPTY: BillingSettings = {
  bank_name: '', bank_account_number: '', bank_account_holder: '',
  bank_name_en: '', bank_account_holder_en: '', swift_code: '',
  stripe_publishable_key: '', stripe_secret_set: false, stripe_webhook_secret_set: false,
  stripe_enabled: false,
  default_vat_rate: 0.1, default_due_days: 7,
};

// Stripe 가 정한 고정 접두 — 백엔드(services/stripeService.js)와 같은 규칙.
//   rk_(restricted key)는 서버측 정식 사용처라 secret 에서 허용한다.
const KEY_PREFIXES: Record<string, string[]> = {
  stripe_publishable_key: ['pk_'],
  stripe_secret: ['sk_', 'rk_'],
  stripe_webhook_secret: ['whsec_'],
};
const prefixOk = (field: string, value: string) => {
  const v = String(value || '').trim();
  if (!v) return true;                      // 빈 값 = 삭제/미입력
  return (KEY_PREFIXES[field] || []).some((p) => v.startsWith(p));
};
const isTestKey = (v: string | null) => /^(pk|sk|rk)_test_/.test(String(v || '').trim());

const WEBHOOK_EVENTS = 'checkout.session.completed, payment_intent.succeeded';

const AdminBillingSettingsPage = () => {
  const { t } = useTranslation('admin');
  const [data, setData] = useState<BillingSettings>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [reveal, setReveal] = useState<Record<string, boolean>>({});
  // Stripe write-only 시크릿 — data 에 안 담고 로컬 입력만. 저장 후 비움(값은 서버에만).
  const [stripeSecretInput, setStripeSecretInput] = useState('');
  const [stripeWebhookInput, setStripeWebhookInput] = useState('');
  const [keyError, setKeyError] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState(false);

  // 웹훅 엔드포인트는 지금 보고 있는 서버 기준으로 안내한다 — dev 화면이 운영 URL 을 알려주면
  //   그대로 등록해 버린다(개발 중 결제가 운영으로 흘러가는 사고).
  const webhookUrl = `${window.location.origin}/api/stripe/webhook`;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await (await apiFetch('/api/admin/platform-settings')).json();
      if (r.success && r.data) {
        setData({
          bank_name: r.data.bank_name || '',
          bank_account_number: r.data.bank_account_number || '',
          bank_account_holder: r.data.bank_account_holder || '',
          bank_name_en: r.data.bank_name_en || '',
          bank_account_holder_en: r.data.bank_account_holder_en || '',
          swift_code: r.data.swift_code || '',
          stripe_publishable_key: r.data.stripe_publishable_key || '',
          stripe_secret_set: !!r.data.stripe_secret_set,
          stripe_webhook_secret_set: !!r.data.stripe_webhook_secret_set,
          stripe_enabled: !!r.data.stripe_enabled,
          default_vat_rate: Number(r.data.default_vat_rate ?? 0.1),
          default_due_days: Number(r.data.default_due_days ?? 7),
        });
      }
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async (patch: Partial<BillingSettings>) => {
    const r = await (await apiFetch('/api/admin/platform-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })).json();
    if (!r.success) throw new Error(r.message || 'failed');
    setData((prev) => ({
      ...prev,
      ...Object.fromEntries(
        Object.entries(r.data || {}).filter(([k]) =>
          ['bank_name', 'bank_account_number', 'bank_account_holder',
           'bank_name_en', 'bank_account_holder_en', 'swift_code',
           'stripe_publishable_key', 'stripe_secret_set', 'stripe_webhook_secret_set', 'stripe_enabled',
           'default_vat_rate', 'default_due_days'].includes(k)
        )
      ),
    }));
  };

  const set = <K extends keyof BillingSettings>(key: K, value: BillingSettings[K]) =>
    setData((prev) => ({ ...prev, [key]: value }));

  // 형식이 틀리면 저장하지 않고 필드 아래 인라인 안내 (팝업·토스트 금지 — CLAUDE.md)
  const guardFormat = (field: string, value: string) => {
    if (prefixOk(field, value)) {
      setKeyError((e) => { const n = { ...e }; delete n[field]; return n; });
      return true;
    }
    // 구분자도 번역 대상이다 — 여기에 한국어를 박으면 영어 UI 가 "sk_ 또는 rk_" 로 섞여 나온다.
    const join = t('billing.keyPrefixJoin', ' 또는 ') as string;
    setKeyError((e) => ({
      ...e,
      [field]: t('billing.keyPrefixError', '{{prefix}} 로 시작하는 값을 넣어주세요.',
        { prefix: (KEY_PREFIXES[field] || []).join(join) }) as string,
    }));
    return false;
  };

  const savePublishable = async () => {
    const v = String(data.stripe_publishable_key || '').trim();
    if (!guardFormat('stripe_publishable_key', v)) throw new Error('invalid_format');
    await save({ stripe_publishable_key: v });
  };

  // write-only 시크릿 저장 — 비어있으면 유지(실수 삭제 방지), 값 있으면 암호화 저장 후 입력 비움.
  const saveStripeSecret = async (field: 'stripe_secret' | 'stripe_webhook_secret', value: string, clear: () => void) => {
    const v = value.trim();
    if (!v) return;
    if (!guardFormat(field, v)) throw new Error('invalid_format');
    await save({ [field]: v } as unknown as Partial<BillingSettings>);
    clear();
  };
  // 시크릿 삭제(비활성화) — 빈 문자열 전송 → 서버 null 처리 → _set=false 병합.
  const clearStripeSecret = async (field: 'stripe_secret' | 'stripe_webhook_secret') => {
    await save({ [field]: '' } as unknown as Partial<BillingSettings>);
  };

  const copyWebhook = async () => {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch { /* 클립보드 차단 환경 — 주소는 화면에 그대로 보인다 */ }
  };

  if (loading) {
    return <PageShell title={t('billing.title', '결제 설정')}><Card><Skel /></Card></PageShell>;
  }

  const bankReady = !!(data.bank_name && data.bank_account_number && data.bank_account_holder);
  const pubStored = String(data.stripe_publishable_key || '').trim();
  const pubMalformed = !!pubStored && !prefixOk('stripe_publishable_key', pubStored);
  // 카드 결제가 왜 꺼졌는지 — 부족한 것만 말한다
  const missing: string[] = [];
  if (!data.stripe_secret_set) missing.push(t('billing.stripeSecret', 'Secret Key') as string);
  if (!data.stripe_webhook_secret_set) missing.push(t('billing.stripeWebhook', 'Webhook Secret') as string);

  return (
    <PageShell title={t('billing.title', '결제 설정')}>
      <Wrap>
        {/* ① 현황 — 무엇이 켜져 있고 무엇이 부족한지 */}
        {/* 우리 원가는 고객 결제 설정보다 먼저 눈에 띄어야 한다 — 마르면 기능이 선다. */}
        <ProviderCreditCard />

        <Card>
          <SectionTitle>{t('billing.statusSection', '결제 수단 현황')}</SectionTitle>

          <StatusRow>
            <StatusDot $on={bankReady} />
            <StatusName>{t('billing.methodBank', '계좌이체')}</StatusName>
            <StatusText>
              {bankReady
                ? t('billing.bankOn', '사용 중 — 입금 확인 후 관리자가 구독을 활성화합니다')
                : t('billing.bankOff', '꺼짐 — 은행명·계좌번호·예금주를 채우면 켜집니다')}
            </StatusText>
          </StatusRow>

          <StatusRow>
            <StatusDot $on={data.stripe_enabled} />
            <StatusName>{t('billing.methodCard', '카드 결제')}</StatusName>
            <StatusText>
              {data.stripe_enabled
                ? t('billing.cardOn', '사용 중 — 결제 완료 시 구독이 즉시 활성화됩니다')
                : t('billing.cardOff', '꺼짐 — {{missing}} 을(를) 넣으면 켜집니다',
                    { missing: missing.join(', ') })}
            </StatusText>
          </StatusRow>

          {data.stripe_secret_set && data.stripe_webhook_secret_set && !data.stripe_enabled && (
            <WarnBox>
              {t('billing.encMismatch', '키는 저장돼 있지만 서버가 복호화하지 못했습니다. EMAIL_ENCRYPTION_KEY 가 바뀌었을 수 있습니다 — Secret Key 와 Webhook Secret 을 다시 입력해 주세요.')}
            </WarnBox>
          )}
        </Card>

        {/* ② 카드 결제 — 넣어야 하는 2개 */}
        <Card>
          <SectionTitle>{t('billing.stripeSection', '카드 결제 (Stripe)')}</SectionTitle>
          <Hint>
            {t('billing.stripeHint2', '아래 2개를 넣으면 구독 결제 화면에 "카드로 결제" 버튼이 켜집니다. 둘 다 암호화되어 저장되며 화면에 다시 표시되지 않습니다.')}
          </Hint>

          {/* 1단계 — Secret Key */}
          <Step>
            <StepHead>
              <StepNum $done={data.stripe_secret_set}>1</StepNum>
              <Label>{t('billing.stripeSecret', 'Secret Key')}</Label>
              {data.stripe_secret_set
                ? <SetBadge>{t('billing.secretSet', '설정됨')}</SetBadge>
                : <UnsetBadge>{t('billing.secretUnset', '미설정')}</UnsetBadge>}
              {isTestKey(stripeSecretInput) && <TestBadge>{t('billing.testKey', '테스트 키')}</TestBadge>}
            </StepHead>
            <StepWhere>
              {t('billing.whereSecret', 'Stripe 대시보드 → 개발자 → API 키 에서 "공개(Reveal)" 를 눌러 복사')}
              <LinkOut href="https://dashboard.stripe.com/apikeys" target="_blank" rel="noreferrer">dashboard.stripe.com/apikeys</LinkOut>
            </StepWhere>
            <SecretRow>
              <AutoSaveField type="input" onSave={async () => saveStripeSecret('stripe_secret', stripeSecretInput, () => setStripeSecretInput(''))}>
                <Input type={reveal.ss ? 'text' : 'password'}
                  value={stripeSecretInput} onChange={e => setStripeSecretInput(e.target.value)}
                  placeholder={data.stripe_secret_set ? (t('billing.secretKeepPh', '변경하려면 새 값 입력 (비우면 유지)') as string) : 'sk_live_...'}
                  maxLength={255} autoComplete="off" />
              </AutoSaveField>
              <RevealBtn type="button" onClick={() => setReveal((r) => ({ ...r, ss: !r.ss }))}>
                {reveal.ss ? t('billing.hide', '숨기기') : t('billing.show', '보기')}
              </RevealBtn>
            </SecretRow>
            {keyError.stripe_secret && <FieldError>{keyError.stripe_secret}</FieldError>}
            {data.stripe_secret_set && (
              <ClearBtn type="button" onClick={() => clearStripeSecret('stripe_secret')}>
                {t('billing.secretClear', '삭제 (카드 결제 비활성화)')}
              </ClearBtn>
            )}
          </Step>

          {/* 2단계 — Webhook */}
          <Step>
            <StepHead>
              <StepNum $done={data.stripe_webhook_secret_set}>2</StepNum>
              <Label>{t('billing.stripeWebhook', 'Webhook Secret')}</Label>
              {data.stripe_webhook_secret_set
                ? <SetBadge>{t('billing.secretSet', '설정됨')}</SetBadge>
                : <UnsetBadge>{t('billing.secretUnset', '미설정')}</UnsetBadge>}
            </StepHead>
            <StepWhere>
              {t('billing.whereWebhook', 'Stripe 대시보드 → 개발자 → Webhooks 에서 아래 주소를 엔드포인트로 추가한 뒤, 생성된 Signing secret 을 복사')}
              <LinkOut href="https://dashboard.stripe.com/webhooks" target="_blank" rel="noreferrer">dashboard.stripe.com/webhooks</LinkOut>
            </StepWhere>

            <CodeRow>
              <CodeLabel>{t('billing.endpointUrl', '엔드포인트 URL')}</CodeLabel>
              <Code>{webhookUrl}</Code>
              <CopyBtn type="button" onClick={copyWebhook}>
                {copied ? t('billing.copied', '복사됨') : t('billing.copy', '복사')}
              </CopyBtn>
            </CodeRow>
            <CodeRow>
              <CodeLabel>{t('billing.endpointEvents', '수신 이벤트')}</CodeLabel>
              <Code>{WEBHOOK_EVENTS}</Code>
            </CodeRow>

            <SecretRow>
              <AutoSaveField type="input" onSave={async () => saveStripeSecret('stripe_webhook_secret', stripeWebhookInput, () => setStripeWebhookInput(''))}>
                <Input type={reveal.sw ? 'text' : 'password'}
                  value={stripeWebhookInput} onChange={e => setStripeWebhookInput(e.target.value)}
                  placeholder={data.stripe_webhook_secret_set ? (t('billing.secretKeepPh', '변경하려면 새 값 입력 (비우면 유지)') as string) : 'whsec_...'}
                  maxLength={255} autoComplete="off" />
              </AutoSaveField>
              <RevealBtn type="button" onClick={() => setReveal((r) => ({ ...r, sw: !r.sw }))}>
                {reveal.sw ? t('billing.hide', '숨기기') : t('billing.show', '보기')}
              </RevealBtn>
            </SecretRow>
            {keyError.stripe_webhook_secret && <FieldError>{keyError.stripe_webhook_secret}</FieldError>}
            {data.stripe_webhook_secret_set && (
              <ClearBtn type="button" onClick={() => clearStripeSecret('stripe_webhook_secret')}>
                {t('billing.secretClear', '삭제 (카드 결제 비활성화)')}
              </ClearBtn>
            )}
          </Step>

          {/* Publishable Key — 현재 결제 흐름에서 안 쓰는 값이라 단계에서 내렸다 */}
          <OptionalBlock>
            <Field>
              <LabelRow>
                <Label>{t('billing.stripePublishable', 'Publishable Key')}</Label>
                <OptionalBadge>{t('billing.optional', '선택')}</OptionalBadge>
              </LabelRow>
              <MutedNote>
                {t('billing.publishableUnused', '현재 결제는 Stripe 호스티드 결제 페이지로 처리되어 이 값을 사용하지 않습니다. 넣지 않아도 카드 결제는 정상 작동합니다.')}
              </MutedNote>
              <AutoSaveField type="input" onSave={savePublishable}>
                <Input value={data.stripe_publishable_key || ''} onChange={e => set('stripe_publishable_key', e.target.value)}
                  placeholder="pk_live_..." maxLength={255} />
              </AutoSaveField>
              {keyError.stripe_publishable_key && <FieldError>{keyError.stripe_publishable_key}</FieldError>}
              {pubMalformed && !keyError.stripe_publishable_key && (
                <FieldError>
                  {t('billing.storedMalformed', '저장된 값 "{{value}}" 은(는) Stripe 키 형식이 아닙니다. pk_ 로 시작하는 값으로 바꾸거나 비워주세요.', { value: pubStored })}
                </FieldError>
              )}
            </Field>
          </OptionalBlock>
        </Card>

        {/* ③ 계좌이체 */}
        <Card>
          <SectionTitle>{t('billing.bankSection', '자체 결제 (계좌이체)')}</SectionTitle>
          <Hint>{t('billing.bankHint', '구독 청구서·결제 안내 메일에 자동 노출됩니다. 계좌이체 받은 후 관리자가 입금 확인하면 구독 활성화됩니다.')}</Hint>

          <Field>
            <Label>{t('billing.bankName', '은행명')}</Label>
            <AutoSaveField type="input" onSave={async () => save({ bank_name: data.bank_name })}>
              <Input value={data.bank_name || ''} onChange={e => set('bank_name', e.target.value)}
                placeholder={t('billing.bankNamePh', '예: 국민은행') as string} maxLength={100} />
            </AutoSaveField>
          </Field>

          <Grid>
            <Field>
              <Label>{t('billing.bankAccount', '계좌번호')}</Label>
              <AutoSaveField type="input" onSave={async () => save({ bank_account_number: data.bank_account_number })}>
                <Input value={data.bank_account_number || ''} onChange={e => set('bank_account_number', e.target.value)}
                  placeholder="000-00-000000" maxLength={50} />
              </AutoSaveField>
            </Field>

            <Field>
              <Label>{t('billing.bankHolder', '예금주')}</Label>
              <AutoSaveField type="input" onSave={async () => save({ bank_account_holder: data.bank_account_holder })}>
                <Input value={data.bank_account_holder || ''} onChange={e => set('bank_account_holder', e.target.value)}
                  placeholder={t('billing.bankHolderPh', '워프로랩') as string} maxLength={100} />
              </AutoSaveField>
            </Field>
          </Grid>

          <Hint>{t('billing.bankEnHint', '영어권 고객·해외 송금용 (선택). 값이 있으면 영어 화면·메일에 자동 노출, 없으면 국문으로 표시됩니다.')}</Hint>

          <Grid>
            <Field>
              <Label>{t('billing.bankNameEn', '영문 은행명')}</Label>
              <AutoSaveField type="input" onSave={async () => save({ bank_name_en: data.bank_name_en })}>
                <Input value={data.bank_name_en || ''} onChange={e => set('bank_name_en', e.target.value)}
                  placeholder="Kookmin Bank" maxLength={200} />
              </AutoSaveField>
            </Field>

            <Field>
              <Label>{t('billing.bankHolderEn', '영문 예금주 (법인 영문명)')}</Label>
              <AutoSaveField type="input" onSave={async () => save({ bank_account_holder_en: data.bank_account_holder_en })}>
                <Input value={data.bank_account_holder_en || ''} onChange={e => set('bank_account_holder_en', e.target.value)}
                  placeholder="Worpro Lab" maxLength={200} />
              </AutoSaveField>
            </Field>
          </Grid>

          <Field>
            <Label>{t('billing.swift', 'SWIFT / BIC (해외 송금)')}</Label>
            <AutoSaveField type="input" onSave={async () => save({ swift_code: data.swift_code })}>
              <Input value={data.swift_code || ''} onChange={e => set('swift_code', e.target.value)}
                placeholder="CZNBKRSEXXX" maxLength={20} />
            </AutoSaveField>
          </Field>
        </Card>

        {/* ④ 결제 정책 */}
        <Card>
          <SectionTitle>{t('billing.policySection', '결제 정책')}</SectionTitle>
          <Hint>{t('billing.policyHint', '청구서 발행 시 기본값. 워크스페이스별 별도 설정도 가능.')}</Hint>

          <Grid>
            <Field>
              <Label>{t('billing.vatRate', 'VAT 비율')} (0.1 = 10%)</Label>
              <AutoSaveField type="input" onSave={async () => save({ default_vat_rate: data.default_vat_rate })}>
                <Input type="number" step="0.001" min="0" max="1"
                  value={data.default_vat_rate} onChange={e => set('default_vat_rate', Number(e.target.value) || 0)} />
              </AutoSaveField>
            </Field>

            <Field>
              <Label>{t('billing.dueDays', '기본 결제 기한 (일)')}</Label>
              <AutoSaveField type="input" onSave={async () => save({ default_due_days: data.default_due_days })}>
                <Input type="number" step="1" min="0" max="365"
                  value={data.default_due_days} onChange={e => set('default_due_days', Number(e.target.value) || 0)} />
              </AutoSaveField>
            </Field>
          </Grid>
        </Card>
      </Wrap>
    </PageShell>
  );
};

export default AdminBillingSettingsPage;

const Wrap = styled.div`
  display: flex; flex-direction: column; gap: 20px;
  max-width: 720px;
  padding: 0 20px 20px;
`;
const Card = styled.section`
  background: #FFFFFF;
  border-radius: 14px;
  padding: 24px;
  border: 1px solid #E2E8F0;
  display: flex; flex-direction: column; gap: 16px;
`;
const SectionTitle = styled.h3`
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: #0F172A;
`;
const Hint = styled.p`
  margin: -8px 0 4px;
  font-size: 12px;
  color: #64748B;
  line-height: 1.5;
`;
const Field = styled.div`display: flex; flex-direction: column; gap: 6px; min-width: 0;`;
const Grid = styled.div`
  display: grid; grid-template-columns: 1fr 1fr; gap: 16px;
  @media (max-width: 720px) { grid-template-columns: 1fr; }
`;
const Label = styled.label`font-size: 13px; font-weight: 600; color: #334155;`;
const LabelRow = styled.div`display: flex; align-items: center; gap: 8px;`;

/* ① 현황 */
const StatusRow = styled.div`
  display: flex; align-items: center; gap: 10px;
  @media (max-width: 640px) { align-items: flex-start; flex-wrap: wrap; }
`;
const StatusDot = styled.span<{ $on: boolean }>`
  width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0;
  background: ${p => (p.$on ? '#0F766E' : '#CBD5E1')};
  margin-top: 1px;
`;
const StatusName = styled.span`font-size: 13px; font-weight: 700; color: #0F172A; flex-shrink: 0; min-width: 68px;`;
const StatusText = styled.span`font-size: 13px; color: #475569; line-height: 1.5;`;
const WarnBox = styled.div`
  font-size: 12px; color: #92400E; line-height: 1.5;
  background: #FFFBEB; border: 1px solid #FCD34D; border-radius: 8px; padding: 10px 12px;
`;

/* ② 단계 */
const Step = styled.div`
  display: flex; flex-direction: column; gap: 8px;
  padding-top: 16px; border-top: 1px solid #F1F5F9;
  &:first-of-type { padding-top: 0; border-top: none; }
`;
const StepHead = styled.div`display: flex; align-items: center; gap: 8px; flex-wrap: wrap;`;
const StepNum = styled.span<{ $done: boolean }>`
  display: inline-flex; align-items: center; justify-content: center;
  width: 20px; height: 20px; border-radius: 50%; flex-shrink: 0;
  font-size: 11px; font-weight: 700;
  color: ${p => (p.$done ? '#FFFFFF' : '#64748B')};
  background: ${p => (p.$done ? '#0F766E' : '#F1F5F9')};
  border: 1px solid ${p => (p.$done ? '#0F766E' : '#E2E8F0')};
`;
const StepWhere = styled.p`
  margin: 0; font-size: 12px; color: #64748B; line-height: 1.6;
  display: flex; flex-wrap: wrap; gap: 6px; align-items: baseline;
`;
const LinkOut = styled.a`
  font-size: 12px; font-weight: 600; color: #0F766E; text-decoration: none;
  &:hover { text-decoration: underline; }
`;
const CodeRow = styled.div`
  display: flex; align-items: center; gap: 8px; min-width: 0;
  @media (max-width: 640px) { flex-direction: column; align-items: stretch; }
`;
const CodeLabel = styled.span`font-size: 12px; font-weight: 600; color: #64748B; flex-shrink: 0; min-width: 84px;`;
const Code = styled.code`
  flex: 1; min-width: 0; overflow-x: auto; white-space: nowrap;
  font-size: 12px; color: #0F172A; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 8px 10px;
`;
const CopyBtn = styled.button`
  padding: 0 12px; height: 34px; font-size: 12px; font-weight: 600;
  background: #FFFFFF; color: #64748B;
  border: 1px solid #E2E8F0; border-radius: 8px; cursor: pointer; flex-shrink: 0;
  &:hover { color: #0F172A; background: #F8FAFC; }
`;
const OptionalBlock = styled.div`
  padding-top: 16px; border-top: 1px solid #F1F5F9;
`;
const MutedNote = styled.p`margin: 0; font-size: 12px; color: #94A3B8; line-height: 1.5;`;
const FieldError = styled.p`margin: 0; font-size: 12px; color: #B91C1C; line-height: 1.5;`;

const SetBadge = styled.span`
  font-size: 11px; font-weight: 700; color: #0F766E;
  background: #F0FDFA; border: 1px solid #99F6E4; border-radius: 6px; padding: 2px 8px;
`;
const UnsetBadge = styled.span`
  font-size: 11px; font-weight: 700; color: #94A3B8;
  background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 6px; padding: 2px 8px;
`;
const TestBadge = styled.span`
  font-size: 11px; font-weight: 700; color: #92400E;
  background: #FFFBEB; border: 1px solid #FCD34D; border-radius: 6px; padding: 2px 8px;
`;
const OptionalBadge = styled.span`
  font-size: 11px; font-weight: 600; color: #94A3B8;
  background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 6px; padding: 2px 8px;
`;
const ClearBtn = styled.button`
  align-self: flex-start; margin-top: 2px;
  font-size: 12px; font-weight: 600; color: #B91C1C;
  background: transparent; border: none; padding: 2px 0; cursor: pointer;
  &:hover { text-decoration: underline; }
`;
const Input = styled.input`
  /* width 없으면 브라우저 기본 폭(size=20, ~177px)으로 렌더돼 720px 카드 안에서 제각각으로 보인다.
     AutoSaveField Wrapper 는 이미 width:100% 라 여기만 채우면 모든 입력란이 같은 폭으로 정렬된다. */
  width: 100%;
  box-sizing: border-box;
  height: 38px; padding: 0 12px;
  font-size: 14px; color: #0F172A;
  border: 1px solid #E2E8F0; border-radius: 8px; background: #FFFFFF;
  font-family: inherit;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20, 184, 166, 0.15); }
`;
const SecretRow = styled.div`
  display: flex; gap: 8px; align-items: stretch;
  > div:first-child { flex: 1; min-width: 0; }
`;
const RevealBtn = styled.button`
  padding: 0 14px; font-size: 12px; font-weight: 600;
  background: #FFFFFF; color: #64748B;
  border: 1px solid #E2E8F0; border-radius: 8px; cursor: pointer;
  flex-shrink: 0;
  &:hover { color: #0F172A; background: #F8FAFC; }
`;
const Skel = styled.div`
  height: 200px;
  background: linear-gradient(90deg, #F1F5F9 0%, #E2E8F0 50%, #F1F5F9 100%);
  background-size: 200% 100%;
  border-radius: 8px;
  animation: shimmer 1.5s infinite;
  @keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
`;
