// 고객 사업자·증빙 정보 — 세금계산서/현금영수증 발행 정보의 원천(청구서 발행 시 자동으로 채워진다).
//   2026-10-16 설정 > 고객 드로어에서 **빼서** Q sale 패널·상세 페이지가 같이 쓴다(docs/CLIENT_SCREENS_MERGE_DESIGN.md).
//   칸마다 자동저장(AutoSaveField) — 저장은 PUT /api/clients/:biz/:id 하나(putClientFields).
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import AutoSaveField from '../Common/AutoSaveField';
import { putClientFields, type ClientBilling } from '../../services/sale';
import {
  Section, SectionTitle, Helper, BizToggleRow, BizRow, BizLabel, BizReadVal, BizTwoCol, BizInput,
  SwitchWrap, SwitchInput, SwitchTrack, SwitchLabel,
} from './clientDetailStyles';

// 개별 칸 — 라벨 + 자동저장 입력 (module-level 로 정의해 재렌더 시 focus 유지)
function BizField({ label, value, disabled, placeholder, inputMode, onSave }: {
  label: string;
  value?: string | null;
  disabled?: boolean;
  placeholder?: string;
  inputMode?: 'text' | 'numeric' | 'email' | 'tel';
  onSave: (val: string | null) => Promise<void>;
}) {
  const [v, setV] = useState(value ?? '');
  useEffect(() => { setV(value ?? ''); }, [value]);
  const vRef = useRef(v);
  vRef.current = v;
  return (
    <BizRow>
      <BizLabel>{label}</BizLabel>
      {disabled ? (
        <BizReadVal>{value || '—'}</BizReadVal>
      ) : (
        <AutoSaveField onSave={() => onSave(vRef.current.trim() || null)}>
          <BizInput value={v} placeholder={placeholder} inputMode={inputMode}
            onChange={(e) => setV(e.target.value)} />
        </AutoSaveField>
      )}
    </BizRow>
  );
}

interface Props {
  businessId: number;
  clientId: number;
  billing: ClientBilling;
  canEdit: boolean;
  /** 저장이 끝난 뒤 — 부르는 쪽이 상세를 다시 읽는다 */
  onSaved?: () => void;
}

export default function ClientBillingInfoForm({ businessId, clientId, billing, canEdit, onSaved }: Props) {
  const { t } = useTranslation('clients');
  const [isBiz, setIsBiz] = useState(!!billing.is_business);
  useEffect(() => { setIsBiz(!!billing.is_business); }, [billing.is_business, clientId]);
  // 클릭으로 이미 뒤집힌 값을 저장해야 한다 — 클로저는 뒤집기 전 값을 본다(자동저장 규약)
  const isBizRef = useRef(isBiz);
  isBizRef.current = isBiz;
  const save = async (patch: Partial<ClientBilling>) => {
    await putClientFields(businessId, clientId, patch);
    onSaved?.();
  };
  const disabled = !canEdit;
  return (
    <Section data-testid="client-billing-section">
      <SectionTitle>{t('section.billing', { defaultValue: '사업자·증빙 정보' }) as string}</SectionTitle>
      <BizToggleRow>
        <AutoSaveField type="toggle" onSave={async () => { await save({ is_business: isBizRef.current }); }}>
          <SwitchWrap title={t('billing.typeTip', { defaultValue: '사업자면 세금계산서, 개인이면 현금영수증 정보로 발행됩니다.' }) as string}>
            <SwitchInput type="checkbox" checked={isBiz} disabled={disabled}
              onChange={(e) => setIsBiz(e.target.checked)} />
            <SwitchTrack />
            <SwitchLabel>{isBiz ? t('billing.business', { defaultValue: '사업자 · 세금계산서' }) as string : t('billing.individual', { defaultValue: '개인 · 현금영수증' }) as string}</SwitchLabel>
          </SwitchWrap>
        </AutoSaveField>
      </BizToggleRow>
      {isBiz ? (
        <>
          <BizField label={t('billing.bizName', { defaultValue: '상호' }) as string} value={billing.biz_name} disabled={disabled} placeholder={t('billing.bizNamePh', { defaultValue: '상호 (사업자등록증상)' }) as string} onSave={(val) => save({ biz_name: val })} />
          <BizField label={t('billing.bizTaxId', { defaultValue: '사업자등록번호' }) as string} value={billing.biz_tax_id} disabled={disabled} inputMode="numeric" placeholder="123-45-67890" onSave={(val) => save({ biz_tax_id: val })} />
          <BizField label={t('billing.bizCeo', { defaultValue: '대표자' }) as string} value={billing.biz_ceo} disabled={disabled} onSave={(val) => save({ biz_ceo: val })} />
          <BizTwoCol>
            <BizField label={t('billing.bizType', { defaultValue: '업태' }) as string} value={billing.biz_type} disabled={disabled} onSave={(val) => save({ biz_type: val })} />
            <BizField label={t('billing.bizItem', { defaultValue: '종목' }) as string} value={billing.biz_item} disabled={disabled} onSave={(val) => save({ biz_item: val })} />
          </BizTwoCol>
          <BizField label={t('billing.bizAddress', { defaultValue: '사업장 주소' }) as string} value={billing.biz_address} disabled={disabled} onSave={(val) => save({ biz_address: val })} />
          <BizField label={t('billing.taxEmail', { defaultValue: '세금계산서 이메일' }) as string} value={billing.tax_invoice_email} disabled={disabled} inputMode="email" placeholder="tax@company.com" onSave={(val) => save({ tax_invoice_email: val })} />
        </>
      ) : (
        <>
          <BizField label={t('billing.crPhone', { defaultValue: '휴대폰번호 (현금영수증)' }) as string} value={billing.billing_contact_phone} disabled={disabled} inputMode="tel" placeholder="010-1234-5678" onSave={(val) => save({ billing_contact_phone: val })} />
          <BizField label={t('billing.contactEmail', { defaultValue: '이메일' }) as string} value={billing.billing_contact_email} disabled={disabled} inputMode="email" onSave={(val) => save({ billing_contact_email: val })} />
        </>
      )}
      <Helper>{t('billing.helper', { defaultValue: '청구서 발행 시 세금계산서·현금영수증 정보가 자동으로 채워집니다. 고객이 청구서에서 직접 입력해도 여기에 저장됩니다.' }) as string}</Helper>
    </Section>
  );
}
