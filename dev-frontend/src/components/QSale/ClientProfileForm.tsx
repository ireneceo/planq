// ClientProfileForm — 고객 프로필 **입력 한 벌** (전체 프로필 · 우측 패널 공용)
//
// Irene 2026-09-13: *"전체 프로필에 나오는 거 다 우측패널에 나와야해. 그리고 수정 입력 추가 등
//   기능 우측패널에서 모두 되는 거야."*
//
// ★ 여태 이 폼은 `pages/QSale/SaleDetailPage.tsx` 안에 **인라인**이라 우측 패널이 쓸 수 없었다.
//   그래서 패널은 읽기 전용이 됐고, 고치려면 전체 페이지로 나가야 했다.
//   빼서 둘이 같이 쓴다 — 베끼면 한쪽에만 칸이 늘고 한쪽만 저장된다
//   (CLAUDE.md "새로 만들지 않는다" · memory feedback_copied_component_drifts_extract_shell).
//
// ★ 저장 버튼이 없다(AutoSaveField). 대상이 바뀌면 **부르는 쪽이 `key` 로 인스턴스를 가른다** —
//   같은 인스턴스를 다른 고객에 재사용하면 떠난 고객의 마지막 입력이 새 고객으로 저장된다
//   (가드 `--category=autosavekey`).
import { useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import AutoSaveField from '../Common/AutoSaveField';
import PlanQSelect from '../Common/PlanQSelect';
import { usePartnerKindLabel } from '../Common/PartnerKindBadge';
import { SALE_SOURCES, type SaleClientDetail, type SaleSource } from '../../services/sale';

interface Props {
  client: SaleClientDetail;
  onSave: (patch: Record<string, unknown>) => Promise<void>;
  /** 패널처럼 폭이 좁은 자리 — 라벨을 줄여 쌓는다(칸 수는 같다) */
  compact?: boolean;
  /** 유형(고객·협력사·프리랜서·기타) 저장 — 있으면 칸이 나온다. 저장 문은 PUT /api/clients(감사·방송).
   *  2026-10-16 설정 > 고객 을 합치며 옮겼다. 없으면(권한 없음) 칸을 그리지 않는다 */
  onSaveKind?: (kind: string) => Promise<void>;
}

export default function ClientProfileForm({ client, onSave, compact = false, onSaveKind }: Props) {
  const { t } = useTranslation('qsale');
  const kindLabel = usePartnerKindLabel();
  const kindOptions = useMemo(() => ['customer', 'vendor', 'freelancer', 'other'].map((k) => ({ value: k, label: kindLabel(k) })), [kindLabel]);
  const [kind, setKind] = useState(client.kind || 'customer');
  const kindRef = useRef(kind);
  kindRef.current = kind;
  const [name, setName] = useState(client.display_name || '');
  const [company, setCompany] = useState(client.company_name || '');
  const [phone, setPhone] = useState(client.phone || '');
  const [jobTitle, setJobTitle] = useState(client.job_title || '');
  const [department, setDepartment] = useState(client.department || '');
  const [email, setEmail] = useState(client.email || '');
  const [amount, setAmount] = useState(client.expected_amount != null ? String(client.expected_amount) : '');
  const [source, setSource] = useState<SaleSource | ''>(client.sales_source || '');
  // 이메일은 계정이 붙은 뒤에는 못 바꾼다 — 로그인 신원이 그 주소이기 때문이다
  //   잠금 판정은 서버가 정한다(services/clientAccess.emailEditable — 계정·초대 토큰이 없을 때만 고친다)
  const emailLocked = !client.email_editable;
  const idp = compact ? 'panel' : 'sale';
  const sourceOptions = useMemo(() => ([
    { value: '', label: '—' },
    ...SALE_SOURCES.map((s) => ({ value: s as string, label: t(`source.${s}`) as string })),
  ]), [t]);

  return (
    <Fields>
      <Field>
        <FieldLabel htmlFor={`${idp}-name`}>{t('detail.name') as string}</FieldLabel>
        <AutoSaveField onSave={async () => { await onSave({ display_name: name }); }}>
          <TextInput id={`${idp}-name`} value={name} onChange={(e) => setName(e.target.value)} />
        </AutoSaveField>
      </Field>
      <Field>
        <FieldLabel htmlFor={`${idp}-company`}>{t('detail.company') as string}</FieldLabel>
        <AutoSaveField onSave={async () => { await onSave({ company_name: company }); }}>
          <TextInput id={`${idp}-company`} value={company} onChange={(e) => setCompany(e.target.value)} />
        </AutoSaveField>
      </Field>
      {/* 명함 칸 — 대표 담당자의 직함·부서(추가 담당자는 아래 «담당자» 절) */}
      <Field>
        <FieldLabel htmlFor={`${idp}-job-title`}>{t('detail.jobTitle') as string}</FieldLabel>
        <AutoSaveField onSave={async () => { await onSave({ job_title: jobTitle }); }}>
          <TextInput id={`${idp}-job-title`} value={jobTitle} maxLength={100} onChange={(e) => setJobTitle(e.target.value)} />
        </AutoSaveField>
      </Field>
      <Field>
        <FieldLabel htmlFor={`${idp}-department`}>{t('detail.department') as string}</FieldLabel>
        <AutoSaveField onSave={async () => { await onSave({ department }); }}>
          <TextInput id={`${idp}-department`} value={department} maxLength={100} onChange={(e) => setDepartment(e.target.value)} />
        </AutoSaveField>
      </Field>
      <Field>
        <FieldLabel htmlFor={`${idp}-phone`}>{t('detail.phone') as string}</FieldLabel>
        <AutoSaveField onSave={async () => { await onSave({ phone }); }}>
          <TextInput id={`${idp}-phone`} value={phone} inputMode="tel" onChange={(e) => setPhone(e.target.value)} />
        </AutoSaveField>
      </Field>
      <Field>
        <FieldLabel htmlFor={`${idp}-email`}>{t('detail.email') as string}</FieldLabel>
        {emailLocked ? (
          <>
            <ReadOnlyValue id={`${idp}-email`}>{email || '—'}</ReadOnlyValue>
            <HintText>{t('detail.emailLocked') as string}</HintText>
          </>
        ) : (
          <AutoSaveField onSave={async () => { await onSave({ email }); }}>
            <TextInput id={`${idp}-email`} value={email} inputMode="email" onChange={(e) => setEmail(e.target.value)} />
          </AutoSaveField>
        )}
      </Field>
      <Field>
        <FieldLabel htmlFor={`${idp}-amount`}>{t('detail.expectedAmount') as string}</FieldLabel>
        <AutoSaveField onSave={async () => { await onSave({ expected_amount: amount === '' ? null : Number(amount), expected_currency: amount === '' ? null : (client.expected_currency || 'KRW') }); }}>
          <TextInput id={`${idp}-amount`} value={amount} inputMode="numeric"
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} />
        </AutoSaveField>
      </Field>
      {onSaveKind && (
        <Field data-testid={`${idp}-kind`}>
          <FieldLabel>{t('clients:kind.label', { defaultValue: '유형' }) as string}</FieldLabel>
          <AutoSaveField type="select" onSave={async () => { await onSaveKind(kindRef.current); }}>
            <PlanQSelect size="sm" isSearchable={false} isClearable={false} options={kindOptions}
              aria-label={t('clients:kind.label', { defaultValue: '유형' }) as string}
              value={kindOptions.find((o) => o.value === kind) || kindOptions[0]}
              onChange={(opt: unknown) => setKind(((opt as { value?: string } | null)?.value) || 'customer')} />
          </AutoSaveField>
        </Field>
      )}
      <Field>
        <FieldLabel>{t('source.label') as string}</FieldLabel>
        <AutoSaveField type="select" onSave={async () => { await onSave({ sales_source: source || null }); }}>
          <PlanQSelect size="sm" isSearchable={false} options={sourceOptions}
            aria-label={t('source.label') as string}
            value={sourceOptions.find((o) => o.value === source) || sourceOptions[0]}
            onChange={(opt: unknown) => setSource(((opt as { value?: string } | null)?.value || '') as SaleSource | '')} />
        </AutoSaveField>
      </Field>
    </Fields>
  );
}

const Fields = styled.div`display: flex; flex-direction: column; gap: 10px;`;
const Field = styled.div`display: flex; flex-direction: column; gap: 6px; min-width: 0;`;
const FieldLabel = styled.label`font-size: 0.75rem; font-weight: 600; color: #64748B;`;
const TextInput = styled.input`
  height: 36px; padding: 0 30px 0 10px; border: 1px solid #E2E8F0; border-radius: 8px;
  font-size: 0.8125rem; color: #0F172A; width: 100%;
  &:focus { outline: none; border-color: #5EEAD4; }
`;
const ReadOnlyValue = styled.div`font-size: 0.8125rem; color: #334155; padding: 8px 0;`;
const HintText = styled.div`font-size: 0.6875rem; color: #94A3B8;`;
