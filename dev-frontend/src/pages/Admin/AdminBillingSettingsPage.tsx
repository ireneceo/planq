// 결제 설정 — platform_admin 만
// .env (PortOne · 은행계좌) → DB+UI 이전. 변경 시 platform_settings 업데이트.
// 라우트: /admin/billing-settings

import { useEffect, useState, useCallback } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import PageShell from '../../components/Layout/PageShell';
import AutoSaveField from '../../components/Common/AutoSaveField';
import { apiFetch } from '../../contexts/AuthContext';

interface BillingSettings {
  bank_name: string | null;
  bank_account_number: string | null;
  bank_account_holder: string | null;
  bank_name_en: string | null;
  bank_account_holder_en: string | null;
  swift_code: string | null;
  portone_store_id: string | null;
  portone_channel_key: string | null;
  portone_channel_key_billing: string | null;
  portone_webhook_secret: string | null;
  default_vat_rate: number;
  default_due_days: number;
}

const EMPTY: BillingSettings = {
  bank_name: '', bank_account_number: '', bank_account_holder: '',
  bank_name_en: '', bank_account_holder_en: '', swift_code: '',
  portone_store_id: '', portone_channel_key: '', portone_channel_key_billing: '', portone_webhook_secret: '',
  default_vat_rate: 0.1, default_due_days: 7,
};

const AdminBillingSettingsPage = () => {
  const { t } = useTranslation('admin');
  const [data, setData] = useState<BillingSettings>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [reveal, setReveal] = useState<Record<string, boolean>>({});

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
          portone_store_id: r.data.portone_store_id || '',
          portone_channel_key: r.data.portone_channel_key || '',
          portone_channel_key_billing: r.data.portone_channel_key_billing || '',
          portone_webhook_secret: r.data.portone_webhook_secret || '',
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
           'portone_store_id', 'portone_channel_key', 'portone_channel_key_billing', 'portone_webhook_secret',
           'default_vat_rate', 'default_due_days'].includes(k)
        )
      ),
    }));
  };

  const set = <K extends keyof BillingSettings>(key: K, value: BillingSettings[K]) =>
    setData((prev) => ({ ...prev, [key]: value }));

  if (loading) {
    return <PageShell title={t('billing.title', '결제 설정')}><Card><Skel /></Card></PageShell>;
  }

  return (
    <PageShell title={t('billing.title', '결제 설정')}>
      <Wrap>
        {/* 자체 결제 (계좌이체) */}
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

          <Hint>{t('billing.bankEnHint', '영어권 고객·해외 송금용 (선택). 값이 있으면 영어 화면·메일에 자동 노출, 없으면 국문으로 표시됩니다.')}</Hint>

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

          <Field>
            <Label>{t('billing.swift', 'SWIFT / BIC (해외 송금)')}</Label>
            <AutoSaveField type="input" onSave={async () => save({ swift_code: data.swift_code })}>
              <Input value={data.swift_code || ''} onChange={e => set('swift_code', e.target.value)}
                placeholder="CZNBKRSEXXX" maxLength={20} />
            </AutoSaveField>
          </Field>
        </Card>

        {/* PortOne (2순위) */}
        <Card>
          <SectionTitle>{t('billing.portoneSection', 'PortOne (카드 결제 게이트웨이)')}</SectionTitle>
          <Hint>{t('billing.portoneHint', '비워두면 PortOne 비활성. 자체 결제(계좌이체)만 사용. 키는 화면에 마스킹되며 "보기" 버튼으로 확인 가능.')}</Hint>

          <Field>
            <Label>{t('billing.storeId', 'Store ID')}</Label>
            <AutoSaveField type="input" onSave={async () => save({ portone_store_id: data.portone_store_id })}>
              <Input value={data.portone_store_id || ''} onChange={e => set('portone_store_id', e.target.value)}
                placeholder="store-..." maxLength={100} />
            </AutoSaveField>
          </Field>

          <Field>
            <Label>{t('billing.channelKey', 'Channel Key (단건 결제)')}</Label>
            <SecretRow>
              <AutoSaveField type="input" onSave={async () => save({ portone_channel_key: data.portone_channel_key })}>
                <Input type={reveal.ck ? 'text' : 'password'}
                  value={data.portone_channel_key || ''} onChange={e => set('portone_channel_key', e.target.value)}
                  placeholder="channel-key-..." maxLength={200} />
              </AutoSaveField>
              <RevealBtn type="button" onClick={() => setReveal((r) => ({ ...r, ck: !r.ck }))}>
                {reveal.ck ? t('billing.hide', '숨기기') : t('billing.show', '보기')}
              </RevealBtn>
            </SecretRow>
          </Field>

          <Field>
            <Label>{t('billing.channelKeyBilling', 'Channel Key (정기 결제)')}</Label>
            <SecretRow>
              <AutoSaveField type="input" onSave={async () => save({ portone_channel_key_billing: data.portone_channel_key_billing })}>
                <Input type={reveal.ckb ? 'text' : 'password'}
                  value={data.portone_channel_key_billing || ''} onChange={e => set('portone_channel_key_billing', e.target.value)}
                  placeholder="channel-key-billing-..." maxLength={200} />
              </AutoSaveField>
              <RevealBtn type="button" onClick={() => setReveal((r) => ({ ...r, ckb: !r.ckb }))}>
                {reveal.ckb ? t('billing.hide', '숨기기') : t('billing.show', '보기')}
              </RevealBtn>
            </SecretRow>
          </Field>

          <Field>
            <Label>{t('billing.webhookSecret', 'Webhook Secret')}</Label>
            <SecretRow>
              <AutoSaveField type="input" onSave={async () => save({ portone_webhook_secret: data.portone_webhook_secret })}>
                <Input type={reveal.ws ? 'text' : 'password'}
                  value={data.portone_webhook_secret || ''} onChange={e => set('portone_webhook_secret', e.target.value)}
                  placeholder="webhook-secret" maxLength={200} />
              </AutoSaveField>
              <RevealBtn type="button" onClick={() => setReveal((r) => ({ ...r, ws: !r.ws }))}>
                {reveal.ws ? t('billing.hide', '숨기기') : t('billing.show', '보기')}
              </RevealBtn>
            </SecretRow>
          </Field>
        </Card>

        {/* 결제 정책 */}
        <Card>
          <SectionTitle>{t('billing.policySection', '결제 정책')}</SectionTitle>
          <Hint>{t('billing.policyHint', '청구서 발행 시 기본값. 워크스페이스별 별도 설정도 가능.')}</Hint>

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
const Field = styled.div`display: flex; flex-direction: column; gap: 6px;`;
const Label = styled.label`font-size: 13px; font-weight: 600; color: #334155;`;
const Input = styled.input`
  height: 38px; padding: 0 12px;
  font-size: 14px; color: #0F172A;
  border: 1px solid #E2E8F0; border-radius: 8px; background: #FFFFFF;
  font-family: inherit;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20, 184, 166, 0.15); }
`;
const SecretRow = styled.div`
  display: flex; gap: 8px; align-items: stretch;
  > div:first-child { flex: 1; }
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
