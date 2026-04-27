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

export default function SettingsTab() {
  const { t } = useTranslation('qbill');
  const navigate = useNavigate();
  const { user } = useAuth();
  const businessId = user?.business_id ? Number(user.business_id) : null;

  const [info, setInfo] = useState<ApiBusinessInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 로컬 편집 state
  const [bankName, setBankName] = useState('');
  const [acctNumber, setAcctNumber] = useState('');
  const [acctHolder, setAcctHolder] = useState('');
  const [dueDays, setDueDays] = useState<number>(14);
  const [vatRate, setVatRate] = useState<number>(0.1);
  const [currency, setCurrency] = useState('KRW');

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
        setDueDays(d.default_due_days ?? 14);
        setVatRate(Number(d.default_vat_rate ?? 0.1));
        setCurrency(d.default_currency || 'KRW');
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

  return (
    <Wrap>
      {/* 발행자 정보 (read-only) */}
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
            <FieldVal>{info.legal_name || info.name || <Hole>없음</Hole>}</FieldVal>
          </Field>
          <Field>
            <FieldLabel>{t('settings.issuer.taxId')}</FieldLabel>
            <FieldVal>{info.tax_id || <Hole>없음</Hole>}</FieldVal>
          </Field>
          <Field>
            <FieldLabel>{t('settings.issuer.representative')}</FieldLabel>
            <FieldVal>{info.representative || <Hole>없음</Hole>}</FieldVal>
          </Field>
          <Field $span={2}>
            <FieldLabel>{t('settings.issuer.address')}</FieldLabel>
            <FieldVal>{info.address || <Hole>없음</Hole>}</FieldVal>
          </Field>
        </FieldGrid>
      </Section>

      {/* 입금 계좌 (인라인 편집) */}
      <Section>
        <SectionHead>
          <div>
            <SectionTitle>{t('settings.bank.title')}</SectionTitle>
            <SectionDesc>{t('settings.bank.desc')}</SectionDesc>
          </div>
        </SectionHead>
        <EditGrid>
          <EditField>
            <EditLabel>{t('settings.bank.bank')}</EditLabel>
            <AutoSaveField type="input" onSave={async () => save({ bank_name: bankName.trim() || null })}>
              <EditInput type="text" value={bankName} onChange={e => setBankName(e.target.value)} placeholder="우리은행" />
            </AutoSaveField>
          </EditField>
          <EditField>
            <EditLabel>{t('settings.bank.account')}</EditLabel>
            <AutoSaveField type="input" onSave={async () => save({ bank_account_number: acctNumber.trim() || null })}>
              <EditInput type="text" value={acctNumber} onChange={e => setAcctNumber(e.target.value)} placeholder="000-000-000000"
                style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }} />
            </AutoSaveField>
          </EditField>
          <EditField $span={2}>
            <EditLabel>{t('settings.bank.holder')}</EditLabel>
            <AutoSaveField type="input" onSave={async () => save({ bank_account_name: acctHolder.trim() || null })}>
              <EditInput type="text" value={acctHolder} onChange={e => setAcctHolder(e.target.value)} placeholder={info.legal_name || info.name || ''} />
            </AutoSaveField>
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
          </EditField>
          <EditField>
            <EditLabel>{t('settings.defaults.numberFormat')}</EditLabel>
            <FieldVal style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', padding: '7px 0' }}>INV-{`{YYYY}-{####}`}</FieldVal>
            <FieldHint>시스템 고정 (변경 불가)</FieldHint>
          </EditField>
        </EditGrid>
      </Section>
    </Wrap>
  );
}

const Wrap = styled.div`display: flex; flex-direction: column; gap: 14px; max-width: 880px;`;
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
