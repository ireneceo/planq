// 대상자 상세 — 기본 정보(자동저장) · 지급 계좌 · 계약 이력. 우측 상세는 DetailDrawer 한 벌.
//   ★ 계좌번호는 [보기] 를 눌렀을 때만 따로 받아 온다(서버 열람 감사). 목록·상세 응답에는 번호가 없다.
import { useCallback, useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import DetailDrawer from '../../components/Common/DetailDrawer';
import AutoSaveField from '../../components/Common/AutoSaveField';
import PlanQSelect from '../../components/Common/PlanQSelect';
import SingleDateField from '../../components/Common/SingleDateField';
import ActionButton from '../../components/Common/ActionButton';
import ConfirmDialog from '../../components/Common/ConfirmDialog';
import { onSocket } from '../../services/socket';
import { payrollApi, PayrollError, type IncomeKind, type PersonDetail } from './payrollApi';
import ContractSection from './ContractSection';

interface Props {
  businessId: number;
  personId: number;
  onClose: () => void;
  onChanged: () => void;
  onDeleted: () => void;
}

/** 한 칸 — 라벨 + 자동저장 글자 입력. 최신값은 ref 로 읽는다(클로저는 이전 값을 본다). */
function TextField({ label, value, onSave, testId, maxLength }: { label: string; value: string | null; onSave: (v: string | null) => Promise<void>; testId?: string; maxLength?: number }) {
  const [v, setV] = useState(value ?? '');
  useEffect(() => { setV(value ?? ''); }, [value]);
  const ref = useRef(v); ref.current = v;
  return (
    <Field>
      <Label>{label}</Label>
      <AutoSaveField onSave={() => onSave(ref.current.trim() || null)}>
        <Input data-testid={testId} value={v} maxLength={maxLength} onChange={(e) => setV(e.target.value)} />
      </AutoSaveField>
    </Field>
  );
}

function DateField({ label, value, onSave }: { label: string; value: string | null; onSave: (v: string | null) => Promise<void> }) {
  const [v, setV] = useState(value ?? '');
  useEffect(() => { setV(value ?? ''); }, [value]);
  const ref = useRef(v); ref.current = v;
  return (
    <Field>
      <Label>{label}</Label>
      <AutoSaveField type="select" onSave={() => onSave(ref.current || null)}>
        <SingleDateField value={v} onChange={(d) => { ref.current = d; setV(d); }} />
      </AutoSaveField>
    </Field>
  );
}

export default function PersonDrawer({ businessId, personId, onClose, onChanged, onDeleted }: Props) {
  const { t } = useTranslation('payroll');
  const [p, setP] = useState<PersonDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bank, setBank] = useState<{ number: string | null; holder: string | null } | null>(null);
  const [bankEdit, setBankEdit] = useState(false);
  const [bankForm, setBankForm] = useState({ bank_name: '', number: '', holder: '' });
  const [bankBusy, setBankBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmBankRemove, setConfirmBankRemove] = useState(false);

  const load = useCallback(async () => {
    try { setP(await payrollApi.person(businessId, personId)); setError(null); }
    catch (e) { setError(e instanceof PayrollError ? e.code : 'generic'); }
  }, [businessId, personId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => onSocket<{ person_id?: number; id?: number; kind?: string }>('payroll:updated', (d) => {
    if (d?.person_id === personId || (d?.kind === 'person' && d?.id === personId)) load();
  }), [personId, load]);

  const errText = (code: string) => t(`error.${code}`, { defaultValue: t('error.generic') as string }) as string;

  /** 자동저장 한 칸 — 실패는 던진다(! 뱃지). 성공하면 목록도 다시 읽는다. */
  const save = useCallback(async (patch: Record<string, unknown>) => {
    try {
      await payrollApi.updatePerson(businessId, personId, patch);
      setError(null);
      setP((prev) => (prev ? { ...prev, ...patch } as PersonDetail : prev));
      onChanged();
    } catch (e) {
      setError(e instanceof PayrollError ? e.code : 'generic');
      throw e;
    }
  }, [businessId, personId, onChanged]);

  const showBank = async () => {
    if (bank) { setBank(null); return; }
    try { const r = await payrollApi.bankAccount(businessId, personId); setBank({ number: r.number, holder: r.holder }); }
    catch (e) { setError(e instanceof PayrollError ? e.code : 'generic'); }
  };
  // autosave-exempt: 계좌는 번호·예금주를 함께 확인하고 한 번에 저장한다(칸마다 저장되면 반쪽 계좌가 남는다)
  const saveBank = async () => {
    if (bankBusy || !bankForm.number.trim()) return;
    setBankBusy(true);
    try {
      await payrollApi.updatePerson(businessId, personId, { bank_name: bankForm.bank_name.trim() || null, bank_account: { number: bankForm.number, holder: bankForm.holder } });
      setBankEdit(false); setBank(null); await load(); onChanged();
    } catch (e) { setError(e instanceof PayrollError ? e.code : 'generic'); }
    finally { setBankBusy(false); }
  };
  const removeBank = async () => {
    setConfirmBankRemove(false);
    try { await payrollApi.updatePerson(businessId, personId, { bank_account: null }); setBank(null); await load(); onChanged(); }
    catch (e) { setError(e instanceof PayrollError ? e.code : 'generic'); }
  };
  const doDelete = async () => {
    setConfirmDelete(false);
    try { await payrollApi.deletePerson(businessId, personId); onDeleted(); }
    catch (e) { setError(e instanceof PayrollError ? e.code : 'generic'); }
  };

  const incomeOptions = (['employment', 'business', 'other'] as IncomeKind[]).map((k) => ({ value: k, label: t(`incomeKind.${k}`) as string }));
  const statusOptions = [{ value: 'active', label: t('people.statusActive') as string }, { value: 'left', label: t('people.statusLeft') as string }];
  const kindRef = useRef<IncomeKind>('employment');
  const statusRef = useRef<'active' | 'left'>('active');
  if (p) { kindRef.current = p.income_kind; statusRef.current = p.status; }

  return (
    <DetailDrawer open onClose={onClose} ariaLabel={p?.display_name || t('title') as string}>
      <DetailDrawer.Header onClose={onClose}>
        <Title data-testid="payroll-person-title">{p?.display_name || ''}</Title>
        {p?.status === 'left' && <StatusChip>{t('people.statusLeft')}</StatusChip>}
      </DetailDrawer.Header>
      <DetailDrawer.Body>
        {error && <Err role="alert" data-testid="payroll-person-error">{errText(error)}</Err>}
        {p && (
          <>
            <Section>
              <SectionTitle>{t('detail.info')}</SectionTitle>
              <Grid>
                <TextField label={t('field.displayName')} value={p.display_name} maxLength={100} testId="payroll-field-name"
                  onSave={async (v) => { if (!v) throw new Error('required'); await save({ display_name: v }); }} />
                <TextField label={t('field.employeeNo')} value={p.employee_no} maxLength={30} onSave={(v) => save({ employee_no: v })} />
                <TextField label={t('field.jobTitle')} value={p.job_title} maxLength={100} onSave={(v) => save({ job_title: v })} />
                <TextField label={t('field.email')} value={p.email} maxLength={255} onSave={(v) => save({ email: v })} />
                <Field>
                  <Label>{t('field.incomeKind')}</Label>
                  <AutoSaveField type="select" onSave={() => save({ income_kind: kindRef.current })}>
                    <PlanQSelect size="sm" value={incomeOptions.find((o) => o.value === p.income_kind) || null}
                      onChange={(v) => { kindRef.current = ((v as { value?: string })?.value || 'employment') as IncomeKind; setP({ ...p, income_kind: kindRef.current }); }}
                      options={incomeOptions} />
                  </AutoSaveField>
                </Field>
                <Field>
                  <Label>{t('field.status')}</Label>
                  <AutoSaveField type="select" onSave={() => save({ status: statusRef.current })}>
                    <PlanQSelect size="sm" value={statusOptions.find((o) => o.value === p.status) || null}
                      onChange={(v) => { statusRef.current = ((v as { value?: string })?.value || 'active') as 'active' | 'left'; setP({ ...p, status: statusRef.current }); }}
                      options={statusOptions} />
                  </AutoSaveField>
                </Field>
                <DateField label={t('field.hiredOn')} value={p.hired_on} onSave={(v) => save({ hired_on: v })} />
                <DateField label={t('field.leftOn')} value={p.left_on} onSave={(v) => save({ left_on: v })} />
              </Grid>
              <TextField label={t('field.note')} value={p.note} maxLength={500} onSave={(v) => save({ note: v })} />
            </Section>

            <Section data-testid="payroll-bank">
              <SectionTitle>{t('detail.bank')}</SectionTitle>
              {!bankEdit && (
                <>
                  <Muted>{p.has_bank_account ? t('detail.bankSet') : t('detail.bankNone')}</Muted>
                  {p.has_bank_account && (
                    <BankRow>
                      <BankText data-testid="payroll-bank-number">
                        {p.bank_name || ''} {bank ? `${bank.number || ''}${bank.holder ? ` · ${bank.holder}` : ''}` : '••••••••'}
                      </BankText>
                      <ActionButton tone="secondary" size="xs" data-testid="payroll-bank-show" onClick={showBank}>{bank ? t('detail.bankHide') : t('detail.bankShow')}</ActionButton>
                    </BankRow>
                  )}
                  <Actions>
                    <ActionButton tone="secondary" size="sm" onClick={() => { setBankForm({ bank_name: p.bank_name || '', number: '', holder: '' }); setBankEdit(true); }}>{t('detail.bankEdit')}</ActionButton>
                    {p.has_bank_account && <ActionButton tone="danger" size="sm" onClick={() => setConfirmBankRemove(true)}>{t('detail.bankRemove')}</ActionButton>}
                  </Actions>
                </>
              )}
              {bankEdit && (
                <BankForm>
                  <Field><Label>{t('field.bankName')}</Label><Input value={bankForm.bank_name} maxLength={60} onChange={(e) => setBankForm({ ...bankForm, bank_name: e.target.value })} /></Field>
                  <Field><Label>{t('field.bankNumber')} *</Label><Input inputMode="numeric" autoComplete="off" value={bankForm.number} maxLength={40} onChange={(e) => setBankForm({ ...bankForm, number: e.target.value })} /></Field>
                  <Field><Label>{t('field.bankHolder')}</Label><Input value={bankForm.holder} maxLength={60} onChange={(e) => setBankForm({ ...bankForm, holder: e.target.value })} /></Field>
                  <Actions>
                    <ActionButton tone="secondary" size="sm" onClick={() => setBankEdit(false)}>{t('detail.bankCancel')}</ActionButton>
                    <ActionButton size="sm" loading={bankBusy} disabled={!bankForm.number.trim()} onClick={saveBank}>{t('detail.bankSave')}</ActionButton>
                  </Actions>
                </BankForm>
              )}
            </Section>

            <ContractSection businessId={businessId} person={p} onChanged={() => { load(); onChanged(); }} onError={setError} />
          </>
        )}
      </DetailDrawer.Body>
      {/* 삭제는 하단 고정 줄 — 본문 끝에 두면 계약·계좌 칸을 다 내려야 보였다(2026-10-21 우측 패널 통일) */}
      {p && p.contracts.length === 0 && (
        <DetailDrawer.Footer>
          <Muted>{t('detail.deleteHint')}</Muted>
          <ActionButton tone="danger" size="sm" data-testid="payroll-person-delete" onClick={() => setConfirmDelete(true)}>{t('detail.delete')}</ActionButton>
        </DetailDrawer.Footer>
      )}
      <ConfirmDialog isOpen={confirmDelete} onClose={() => setConfirmDelete(false)} onConfirm={doDelete} variant="danger"
        title={t('detail.deleteConfirmTitle')} message={t('detail.deleteConfirmMsg', { name: p?.display_name || '' })} confirmText={t('detail.delete') as string} />
      <ConfirmDialog isOpen={confirmBankRemove} onClose={() => setConfirmBankRemove(false)} onConfirm={removeBank} variant="danger"
        title={t('detail.bankRemove')} message={t('detail.bankRemoveMsg')} confirmText={t('detail.bankRemove') as string} />
    </DetailDrawer>
  );
}

const Title = styled.div`font-size: 1.125rem; font-weight: 700; letter-spacing: -0.2px; color: #0F172A; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`;
const StatusChip = styled.span`margin-left: 8px; padding: 2px 8px; border-radius: 999px; background: #F1F5F9; color: #64748B; font-size: 0.75rem; font-weight: 600; flex-shrink: 0;`;
const Section = styled.section`display: flex; flex-direction: column; gap: 10px; padding: 4px 0 16px; border-bottom: 1px solid #F1F5F9; margin-bottom: 16px; &:last-child { border-bottom: none; }`;
const SectionTitle = styled.h3`margin: 0; font-size: 0.875rem; font-weight: 700; color: #0F172A;`;
const Grid = styled.div`display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 12px; @media (max-width: 640px) { grid-template-columns: 1fr; }`;
const Field = styled.div`display: flex; flex-direction: column; gap: 4px; min-width: 0;`;
const Label = styled.label`font-size: 0.75rem; font-weight: 600; color: #64748B;`;
const Input = styled.input`
  width: 100%; height: 36px; padding: 0 12px; border: 1px solid #E2E8F0; border-radius: 6px; font-size: 0.875rem; font-family: inherit; color: #0F172A; background: #FFF;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 2px rgba(20, 184, 166, 0.15); }
`;
const Muted = styled.div`font-size: 0.8125rem; color: #64748B; line-height: 1.5;`;
const BankRow = styled.div`display: flex; align-items: center; gap: 8px;`;
const BankText = styled.span`flex: 1 1 auto; min-width: 0; font-size: 0.875rem; color: #0F172A; font-variant-numeric: tabular-nums; overflow-wrap: anywhere;`;
const BankForm = styled.div`display: flex; flex-direction: column; gap: 10px; padding: 12px; background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px;`;
const Actions = styled.div`display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end;`;
const Err = styled.div`margin-bottom: 12px; padding: 8px 12px; border-radius: 6px; background: #FFF1F2; color: #BE123C; font-size: 0.8125rem;`;
