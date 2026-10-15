// 계약 이력 — 대상자 상세 안의 한 섹션(드로어 위에 또 드로어를 띄우지 않는다 — 팝업 위 팝업 금지).
//   초안 → [유효로 전환](겹친 옛 계약은 서버가 시작 전날로 닫는다) → [종료]. 유효·종료된 계약의 금액·기간은 못 바꾼다(새 계약).
//   계약서 문서는 Q docs «근로계약서» 템플릿으로 만들고 서명받는다 — 연결된 문서가 있으면 여기서 연다.
import { useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import PlanQSelect from '../../components/Common/PlanQSelect';
import SingleDateField from '../../components/Common/SingleDateField';
import ActionButton from '../../components/Common/ActionButton';
import ConfirmDialog from '../../components/Common/ConfirmDialog';
import { tabStore } from '../../stores/tabStore';
import { payrollApi, PayrollError, formatMoney, type Contract, type ContractKind, type PersonDetail } from './payrollApi';

interface Props {
  businessId: number;
  person: PersonDetail;
  onChanged: () => void;
  onError: (code: string | null) => void;
}

const STATUS_TONE: Record<string, { bg: string; fg: string }> = {
  draft: { bg: '#F1F5F9', fg: '#475569' },
  active: { bg: '#CCFBF1', fg: '#0F766E' },
  ended: { bg: '#F1F5F9', fg: '#64748B' },
  superseded: { bg: '#F8FAFC', fg: '#94A3B8' },
};

export default function ContractSection({ businessId, person, onChanged, onError }: Props) {
  const { t, i18n } = useTranslation('payroll');
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<number | 'new' | null>(null);
  const [endFor, setEndFor] = useState<number | null>(null);
  const [endDate, setEndDate] = useState('');
  const [confirmDraftDelete, setConfirmDraftDelete] = useState<Contract | null>(null);
  const defaultKind: ContractKind = person.income_kind === 'business' ? 'freelance' : 'regular';
  const [form, setForm] = useState({ kind: defaultKind as ContractKind, start_date: '', end_date: '', base_pay: '', pay_day: '25', weekly_work_days: '', daily_work_hours: '', note: '' });

  const fail = (e: unknown) => onError(e instanceof PayrollError ? e.code : 'generic');
  const run = async (key: number | 'new', fn: () => Promise<unknown>) => {
    if (busy !== null) return;
    setBusy(key);
    try { await fn(); onError(null); onChanged(); } catch (e) { fail(e); } finally { setBusy(null); }
  };

  const invalid = !form.start_date || !form.base_pay.trim() || (form.kind === 'fixed_term' && !form.end_date);
  const submit = () => run('new', async () => {
    await payrollApi.createContract(businessId, person.id, {
      kind: form.kind, start_date: form.start_date, end_date: form.end_date || null,
      base_pay: form.base_pay, pay_day: form.pay_day || null,
      ...(form.weekly_work_days ? { weekly_work_days: form.weekly_work_days } : {}),
      ...(form.daily_work_hours ? { daily_work_hours: form.daily_work_hours } : {}),
      note: form.note.trim() || null,
    });
    setAdding(false);
  });

  const kindOptions = (['regular', 'fixed_term', 'freelance'] as ContractKind[]).map((k) => ({ value: k, label: t(`kind.${k}`) as string }));
  const lang = i18n.language;

  return (
    <Section data-testid="payroll-contracts">
      <Head>
        <SectionTitle>{t('detail.contracts')}</SectionTitle>
        {!adding && (
          <ActionButton size="xs" data-testid="payroll-contract-new"
            onClick={() => { setForm({ kind: defaultKind, start_date: '', end_date: '', base_pay: '', pay_day: '25', weekly_work_days: '', daily_work_hours: '', note: '' }); setAdding(true); }}>
            + {t('detail.addContract')}
          </ActionButton>
        )}
      </Head>

      {adding && (
        <NewForm data-testid="payroll-contract-form">
          <Grid>
            <Field>
              <Label>{t('contractCreate.kind')}</Label>
              <PlanQSelect size="sm" value={kindOptions.find((o) => o.value === form.kind) || null}
                onChange={(v) => setForm({ ...form, kind: ((v as { value?: string })?.value || 'regular') as ContractKind })} options={kindOptions} />
            </Field>
            <Field>
              <Label>{form.kind === 'freelance' ? t('contractCreate.basePayFreelance') : t('contractCreate.basePay')} *</Label>
              <Input data-testid="payroll-contract-pay" inputMode="numeric" value={form.base_pay} placeholder="3,000,000"
                onChange={(e) => setForm({ ...form, base_pay: e.target.value })} />
            </Field>
            <Field>
              <Label>{t('contractCreate.startDate')} *</Label>
              <SingleDateField value={form.start_date} onChange={(d) => setForm({ ...form, start_date: d })} />
            </Field>
            <Field>
              <Label>{form.kind === 'fixed_term' ? `${t('contractCreate.endDate')} *` : t('contractCreate.endDateOptional')}</Label>
              <SingleDateField value={form.end_date} minDate={form.start_date || undefined} onChange={(d) => setForm({ ...form, end_date: d })} />
            </Field>
            <Field>
              <Label>{t('contractCreate.payDay')}</Label>
              <Input inputMode="numeric" value={form.pay_day} maxLength={2} onChange={(e) => setForm({ ...form, pay_day: e.target.value.replace(/\D/g, '') })} />
            </Field>
            {form.kind !== 'freelance' && (
              <>
                <Field>
                  <Label>{t('contractCreate.weeklyDays')}</Label>
                  <Input inputMode="numeric" value={form.weekly_work_days} placeholder="5" maxLength={1} onChange={(e) => setForm({ ...form, weekly_work_days: e.target.value.replace(/\D/g, '') })} />
                </Field>
                <Field>
                  <Label>{t('contractCreate.dailyHours')}</Label>
                  <Input inputMode="decimal" value={form.daily_work_hours} placeholder="8" maxLength={4} onChange={(e) => setForm({ ...form, daily_work_hours: e.target.value.replace(/[^\d.]/g, '') })} />
                </Field>
              </>
            )}
          </Grid>
          <Field>
            <Label>{t('contractCreate.note')}</Label>
            {/* draft-exempt: 계약 초안 폼의 한 줄 메모(최대 500자) — 폼 전체를 [초안으로 저장] 으로 한 번에 보낸다 */}
            <Input value={form.note} maxLength={500} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </Field>
          <Hint>{t('contractCreate.hint')}</Hint>
          <Actions>
            <ActionButton tone="secondary" size="sm" onClick={() => setAdding(false)}>{t('detail.bankCancel')}</ActionButton>
            <ActionButton size="sm" data-testid="payroll-contract-submit" loading={busy === 'new'} disabled={invalid} onClick={submit}>{t('contractCreate.submit')}</ActionButton>
          </Actions>
        </NewForm>
      )}

      {person.contracts.length === 0 && !adding && <Muted>{t('detail.contractsEmpty')}</Muted>}

      {person.contracts.map((c) => {
        const tone = STATUS_TONE[c.status] || STATUS_TONE.draft;
        return (
          <Card key={c.id} data-testid="payroll-contract-card" data-status={c.status}>
            <CardTop>
              <Chip $bg={tone.bg} $fg={tone.fg}>{t(`contractStatus.${c.status}`)}</Chip>
              <KindText>{t(`kind.${c.kind}`)}</KindText>
              <Amount>{t('contract.monthly', { amount: formatMoney(c.monthly_total, c.currency, lang) })}</Amount>
            </CardTop>
            <CardMeta>
              {t('contract.period', { start: c.start_date, end: c.end_date || t('contract.openEnded') })}
              {c.kind !== 'freelance' && c.weekly_work_days != null && c.daily_work_hours != null
                ? ` · ${t('contract.workCondition', { days: c.weekly_work_days, hours: Number(c.daily_work_hours) })}` : ''}
              {c.pay_day ? ` · ${t('contract.payDay', { day: c.pay_day })}` : ''}
            </CardMeta>
            <CardMeta>
              {c.signed_at ? <Signed>{t('contract.signed')}</Signed> : <Unsigned>{t('contract.unsigned')}</Unsigned>}
              {c.post_id && (
                <LinkBtn type="button" onClick={() => tabStore.openInNewTab(`/docs?post=${c.post_id}`)}>{t('contract.docOpen')}</LinkBtn>
              )}
              {c.note ? <NoteText> · {c.note}</NoteText> : null}
            </CardMeta>
            {c.status === 'draft' && (
              <Actions>
                <ActionButton tone="danger" size="xs" onClick={() => setConfirmDraftDelete(c)}>{t('contract.deleteDraft')}</ActionButton>
                <ActionButton size="xs" data-testid="payroll-contract-activate" title={t('contract.activateHint') as string}
                  loading={busy === c.id} onClick={() => run(c.id, () => payrollApi.activateContract(businessId, c.id))}>{t('contract.activate')}</ActionButton>
              </Actions>
            )}
            {c.status === 'active' && endFor !== c.id && (
              <Actions>
                <ActionButton tone="secondary" size="xs" onClick={() => { setEndFor(c.id); setEndDate(''); }}>{t('contract.end')}</ActionButton>
              </Actions>
            )}
            {c.status === 'active' && endFor === c.id && (
              <EndRow>
                <Label>{t('contract.endTitle')}</Label>
                <SingleDateField value={endDate} minDate={c.start_date} onChange={setEndDate} />
                <ActionButton tone="secondary" size="xs" onClick={() => setEndFor(null)}>{t('detail.bankCancel')}</ActionButton>
                <ActionButton size="xs" disabled={!endDate} loading={busy === c.id}
                  onClick={() => run(c.id, async () => { await payrollApi.endContract(businessId, c.id, endDate); setEndFor(null); })}>{t('contract.endSubmit')}</ActionButton>
              </EndRow>
            )}
          </Card>
        );
      })}
      <ConfirmDialog isOpen={!!confirmDraftDelete} onClose={() => setConfirmDraftDelete(null)} variant="danger"
        onConfirm={() => { const c = confirmDraftDelete; setConfirmDraftDelete(null); if (c) run(c.id, () => payrollApi.deleteContract(businessId, c.id)); }}
        title={t('contract.deleteDraft')} message={t('contract.deleteDraftMsg')} confirmText={t('contract.deleteDraft') as string} />
    </Section>
  );
}

const Section = styled.section`display: flex; flex-direction: column; gap: 10px; padding: 4px 0 16px; border-bottom: 1px solid #F1F5F9; margin-bottom: 16px;`;
const Head = styled.div`display: flex; align-items: center; justify-content: space-between; gap: 8px;`;
const SectionTitle = styled.h3`margin: 0; font-size: 0.875rem; font-weight: 700; color: #0F172A;`;
const NewForm = styled.div`display: flex; flex-direction: column; gap: 10px; padding: 12px; background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px;`;
const Grid = styled.div`display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 12px; @media (max-width: 640px) { grid-template-columns: 1fr; }`;
const Field = styled.div`display: flex; flex-direction: column; gap: 4px; min-width: 0;`;
const Label = styled.label`font-size: 0.75rem; font-weight: 600; color: #64748B;`;
const Input = styled.input`
  width: 100%; height: 36px; padding: 0 12px; border: 1px solid #E2E8F0; border-radius: 6px; font-size: 0.875rem; font-family: inherit; color: #0F172A; background: #FFF;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 2px rgba(20, 184, 166, 0.15); }
`;
const Hint = styled.div`font-size: 0.75rem; color: #64748B; line-height: 1.5;`;
const Muted = styled.div`font-size: 0.8125rem; color: #64748B;`;
const Actions = styled.div`display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end;`;
const Card = styled.div`padding: 12px; border: 1px solid #E2E8F0; border-radius: 8px; display: flex; flex-direction: column; gap: 6px; background: #FFF;`;
const CardTop = styled.div`display: flex; align-items: center; gap: 8px; flex-wrap: wrap;`;
const Chip = styled.span<{ $bg: string; $fg: string }>`padding: 2px 8px; border-radius: 999px; background: ${(p) => p.$bg}; color: ${(p) => p.$fg}; font-size: 0.75rem; font-weight: 700;`;
const KindText = styled.span`font-size: 0.8125rem; font-weight: 600; color: #334155;`;
const Amount = styled.span`margin-left: auto; font-size: 0.875rem; font-weight: 700; color: #0F172A; font-variant-numeric: tabular-nums;`;
const CardMeta = styled.div`font-size: 0.75rem; color: #64748B; display: flex; align-items: center; gap: 6px; flex-wrap: wrap;`;
const Signed = styled.span`color: #0F766E; font-weight: 600;`;
const Unsigned = styled.span`color: #B45309; font-weight: 600;`;
const LinkBtn = styled.button`background: none; border: none; padding: 0; color: #0D9488; font-size: 0.75rem; font-weight: 600; cursor: pointer; font-family: inherit; text-decoration: underline;`;
const NoteText = styled.span`color: #94A3B8;`;
const EndRow = styled.div`display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: flex-end;`;
