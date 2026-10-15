// 대상자 추가 — 멤버에서 고르기 / 직접 입력(계정 없는 프리랜서 등). 우측 생성 폼은 CreateDrawer 한 벌.
import { useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import CreateDrawer from '../../components/Common/CreateDrawer';
import PlanQSelect from '../../components/Common/PlanQSelect';
import { SegmentedToggle, SegmentedBtn } from '../../components/Common/segmentedToggle';
import { payrollApi, PayrollError, type Candidate, type IncomeKind, type PersonSummary } from './payrollApi';

interface Props {
  open: boolean;
  businessId: number;
  onClose: () => void;
  onCreated: (p: PersonSummary) => void;
}

export default function PersonCreateDrawer({ open, businessId, onClose, onCreated }: Props) {
  const { t } = useTranslation('payroll');
  const [mode, setMode] = useState<'member' | 'direct'>('member');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [userId, setUserId] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [empNo, setEmpNo] = useState('');
  const [incomeKind, setIncomeKind] = useState<IncomeKind>('business');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setUserId(null); setName(''); setEmpNo(''); setError(null); setIncomeKind('business');
    payrollApi.candidates(businessId).then((c) => { setCandidates(c); if (!c.length) setMode('direct'); else setMode('member'); }).catch(() => setCandidates([]));
  }, [open, businessId]);

  const invalid = mode === 'member' ? !userId : !name.trim();
  const submit = async () => {
    if (submitting || invalid) return;
    setSubmitting(true); setError(null);
    try {
      const body: Record<string, unknown> = mode === 'member'
        ? { user_id: userId, income_kind: 'employment', employee_no: empNo.trim() || null }
        : { display_name: name.trim(), income_kind: incomeKind, employee_no: empNo.trim() || null };
      onCreated(await payrollApi.createPerson(businessId, body));
    } catch (e) {
      const code = e instanceof PayrollError ? e.code : 'generic';
      setError(t(`error.${code}`, { defaultValue: t('create.failed') as string }) as string);
    } finally { setSubmitting(false); }
  };

  const incomeOptions = (['employment', 'business', 'other'] as IncomeKind[]).map((k) => ({ value: k, label: t(`incomeKind.${k}`) as string }));
  const memberOptions = candidates.map((c) => ({ value: String(c.user_id), label: c.job_title ? `${c.name} · ${c.job_title}` : c.name }));

  return (
    <CreateDrawer open={open} onClose={onClose} title={t('create.title')} onSubmit={submit}
      submitting={submitting} submitDisabled={invalid} submitLabel={t('create.submit')}>
      <Form>
        <Field>
          <Label>{t('create.source')}</Label>
          <SegmentedToggle>
            <SegmentedBtn type="button" $active={mode === 'member'} onClick={() => setMode('member')} disabled={!candidates.length}>{t('create.fromMember')}</SegmentedBtn>
            <SegmentedBtn type="button" $active={mode === 'direct'} onClick={() => setMode('direct')}>{t('create.direct')}</SegmentedBtn>
          </SegmentedToggle>
        </Field>
        {mode === 'member' ? (
          <Field>
            <Label>{t('create.member')} *</Label>
            {candidates.length ? (
              <PlanQSelect size="sm" placeholder={t('create.memberPlaceholder') as string}
                value={userId ? memberOptions.find((o) => o.value === String(userId)) || null : null}
                onChange={(v) => setUserId((v as { value?: string })?.value ? Number((v as { value: string }).value) : null)}
                options={memberOptions} />
            ) : <Hint>{t('create.noCandidates')}</Hint>}
          </Field>
        ) : (
          <>
            <Field>
              <Label>{t('field.displayName')} *</Label>
              <Input data-testid="payroll-person-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
            </Field>
            <Field>
              <Label>{t('field.incomeKind')}</Label>
              <PlanQSelect size="sm" value={incomeOptions.find((o) => o.value === incomeKind) || null}
                onChange={(v) => setIncomeKind(((v as { value?: string })?.value || 'business') as IncomeKind)} options={incomeOptions} />
            </Field>
          </>
        )}
        <Field>
          <Label>{t('field.employeeNo')}</Label>
          <Input value={empNo} onChange={(e) => setEmpNo(e.target.value)} maxLength={30} />
        </Field>
        {error && <Err role="alert">{error}</Err>}
      </Form>
    </CreateDrawer>
  );
}

const Form = styled.div`display: flex; flex-direction: column; gap: 14px;`;
const Field = styled.div`display: flex; flex-direction: column; gap: 6px;`;
const Label = styled.label`font-size: 0.75rem; font-weight: 600; color: #475569;`;
const Input = styled.input`
  height: 36px; padding: 0 12px; border: 1px solid #E2E8F0; border-radius: 6px; font-size: 0.875rem; font-family: inherit; color: #0F172A;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 2px rgba(20, 184, 166, 0.15); }
`;
const Hint = styled.div`font-size: 0.8125rem; color: #64748B;`;
const Err = styled.div`font-size: 0.8125rem; color: #BE123C;`;
