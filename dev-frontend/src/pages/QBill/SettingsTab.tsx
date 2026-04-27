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
          <EditField>
            <EditLabel>{t('settings.bank.holder')}</EditLabel>
            <AutoSaveField type="input" onSave={async () => save({ bank_account_name: acctHolder.trim() || null })}>
              <EditInput type="text" value={acctHolder} onChange={e => setAcctHolder(e.target.value)} placeholder={info.legal_name || info.name || ''} />
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
              <EditInput type="text" value={bankNameEn} onChange={e => setBankNameEn(e.target.value)} placeholder="Woori Bank" />
            </AutoSaveField>
          </EditField>
          <EditField $span={2}>
            <EditLabel>{t('settings.bank.holderEn', '영문 예금주')}</EditLabel>
            <AutoSaveField type="input" onSave={async () => save({ bank_account_name_en: acctHolderEn.trim() || null })}>
              <EditInput type="text" value={acctHolderEn} onChange={e => setAcctHolderEn(e.target.value)} placeholder="WORPRORAB CO., LTD." />
            </AutoSaveField>
            <FieldHint>{t('settings.bank.holderEnHint', '사업자등록증의 영문 상호 — 외화 청구서에 표시됩니다')}</FieldHint>
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
            <FieldHint>{t('settings.defaults.currencyHint', '외화는 Phase E 에서 추가됩니다')}</FieldHint>
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
