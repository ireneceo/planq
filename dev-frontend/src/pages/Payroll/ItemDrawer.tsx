// 급여 항목 상세 — 칸마다 자동저장(AutoSaveField). 우측 상세는 DetailDrawer 한 벌.
//   ★ 요율은 사람이 넣는다(코드·프리셋·AI 가 주지 않는다). 법정 항목은 «외부(대장 값)» 가 기본이고, 요율을 넣으면 대조용 예상치만 생긴다.
//   ★ 확정된 회차가 쓰는 항목은 지급/공제·부호·합계·과세를 바꿀 수 없다(서버 409 item_locked → ! 뱃지 + 안내).
import { useCallback, useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import DetailDrawer from '../../components/Common/DetailDrawer';
import AutoSaveField from '../../components/Common/AutoSaveField';
import PlanQSelect from '../../components/Common/PlanQSelect';
import ActionButton from '../../components/Common/ActionButton';
import ConfirmDialog from '../../components/Common/ConfirmDialog';
import { Switch, SwitchKnob } from '../../components/Common/switchShell';
import { payrollApi, PayrollError, type PayItem } from './payrollApi';

type Opt = { value: string; label: string };

interface Props {
  businessId: number;
  item: PayItem;
  allItems: PayItem[];
  onClose: () => void;
  onChanged: (next?: PayItem) => void;
  onDeleted: () => void;
}

export default function ItemDrawer({ businessId, item, allItems, onClose, onChanged, onDeleted }: Props) {
  const { t } = useTranslation('payroll');
  const [it, setIt] = useState<PayItem>(item);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => { setIt(item); }, [item]);

  const save = useCallback(async (patch: Record<string, unknown>) => {
    try {
      const next = await payrollApi.updateItem(businessId, it.id, patch);
      setIt((prev) => ({ ...prev, ...next }));
      setError(null);
      onChanged(next);
    } catch (e) {
      setError(e instanceof PayrollError ? e.code : 'generic');
      throw e;
    }
  }, [businessId, it.id, onChanged]);

  const opts = (prefix: string, keys: string[]): Opt[] => keys.map((k) => ({ value: k, label: t(`${prefix}.${k}`) as string }));
  const sideOpts = opts('items.side', ['earning', 'deduction']);
  const appliesOpts = opts('items.appliesTo', ['all', 'employment', 'business', 'other']);
  const calcOpts = opts('items.calc', ['fixed', 'rate', 'manual', 'external', 'unpaid_leave']);
  const rateBaseOpts = opts('items.rateBase', ['taxable_total', 'gross_total', 'item']);
  const signOpts = opts('items.sign', ['plus', 'minus']);
  const roundOpts = opts('items.rounding', ['round', 'floor', 'ceil']);
  const unitOpts: Opt[] = [1, 10, 100, 1000].map((n) => ({ value: String(n), label: String(n) }));
  const baseItemOpts: Opt[] = allItems.filter((x) => x.id !== it.id).map((x) => ({ value: String(x.id), label: x.name }));

  const doDelete = async () => {
    setConfirmDelete(false);
    try { await payrollApi.deleteItem(businessId, it.id); onDeleted(); }
    catch (e) { setError(e instanceof PayrollError ? e.code : 'generic'); }
  };

  return (
    <DetailDrawer open onClose={onClose} ariaLabel={it.name}>
      <DetailDrawer.Header onClose={onClose}>
        <Title data-testid="payroll-item-title">{it.name}</Title>
        {!it.is_active && <Muted>{t('items.inactive')}</Muted>}
      </DetailDrawer.Header>
      <DetailDrawer.Body>
        {error && <Err role="alert" data-testid="payroll-item-error">{t(`error.${error}`, { defaultValue: t('error.generic') as string })}</Err>}
        {it.is_statutory && <Hint>{t('items.statutoryHint')}</Hint>}
        <Grid>
          <TextRow key={`name-${it.id}`} label={t('items.field.name')} value={it.name} onSave={(v) => (v ? save({ name: v }) : Promise.reject(new Error('required')))} testId="payroll-item-name" />
          <TextRow key={`name_en-${it.id}`} label={t('items.field.nameEn')} value={it.name_en} onSave={(v) => save({ name_en: v })} />
          <SelectRow key={`side-${it.id}`} label={t('items.field.side')} value={it.side} options={sideOpts} onSave={(v) => save({ side: v })} />
          <SelectRow key={`applies-${it.id}`} label={t('items.field.appliesTo')} value={it.applies_to} options={appliesOpts} onSave={(v) => save({ applies_to: v })} />
          <SelectRow key={`calc-${it.id}-${it.calc}`} label={t('items.field.calc')} value={it.calc} options={calcOpts}
            onSave={(v) => save(v === 'rate' ? { calc: v, rate: it.rate ?? 0, rate_base: it.rate_base || 'gross_total' } : { calc: v })} />
          {it.calc === 'rate' && (
            <>
              <TextRow key={`rate-${it.id}`} label={t('items.field.rate')} value={it.rate === null ? '' : String(Math.round(it.rate * 1e7) / 1e5)} inputMode="decimal"
                onSave={(v) => save({ rate: Number(String(v || '0').replace(/,/g, '')) / 100 })} />
              <SelectRow key={`rate_base-${it.id}-${it.rate_base}`} label={t('items.field.rateBase')} value={it.rate_base || 'gross_total'} options={rateBaseOpts}
                onSave={(v) => save(v === 'item' ? { rate_base: v, base_item_id: it.base_item_id || Number(baseItemOpts[0]?.value) } : { rate_base: v })} />
              {it.rate_base === 'item' && (
                <SelectRow key={`base_item-${it.id}`} label={t('items.field.baseItem')} value={it.base_item_id ? String(it.base_item_id) : ''} options={baseItemOpts}
                  onSave={(v) => save({ base_item_id: Number(v) })} />
              )}
              <SelectRow key={`rounding-${it.id}`} label={t('items.field.rounding')} value={it.rounding} options={roundOpts} onSave={(v) => save({ rounding: v })} />
              <SelectRow key={`unit-${it.id}`} label={t('items.field.roundingUnit')} value={String(it.rounding_unit)} options={unitOpts} onSave={(v) => save({ rounding_unit: Number(v) })} />
            </>
          )}
          <SelectRow key={`sign-${it.id}`} label={t('items.field.sign')} value={it.sign} options={signOpts} onSave={(v) => save({ sign: v })} />
          <TextRow key={`aliases-${it.id}`} label={t('items.field.aliases')} value={(it.aliases || []).join(', ')} onSave={(v) => save({ aliases: v || '' })} wide />
          <TextRow key={`sort-${it.id}`} label={t('items.field.sortOrder')} value={String(it.sort_order)} inputMode="numeric" onSave={(v) => save({ sort_order: Number(v || 0) })} />
        </Grid>
        <Toggles>
          {it.side === 'earning' && <ToggleRow key={`taxable-${it.id}`} label={t('items.field.taxable')} value={it.taxable} onSave={(v) => save({ taxable: v })} testId="payroll-item-taxable" />}
          <ToggleRow key={`in_total-${it.id}`} label={t('items.field.inTotal')} value={it.in_total} onSave={(v) => save({ in_total: v })} />
          <ToggleRow key={`statutory-${it.id}`} label={t('items.field.statutory')} value={it.is_statutory} onSave={(v) => save({ is_statutory: v })} />
          {it.calc === 'external' && <ToggleRow key={`settle-${it.id}`} label={t('items.field.settlement')} value={it.is_settlement} onSave={(v) => save({ is_settlement: v })} />}
          <ToggleRow key={`active-${it.id}`} label={t('items.field.active')} value={it.is_active} onSave={(v) => save({ is_active: v })} testId="payroll-item-active" />
        </Toggles>
      </DetailDrawer.Body>
      {/* 삭제는 하단 고정 줄(2026-10-21 우측 패널 통일) */}
      {it.code !== 'base' && (
        <DetailDrawer.Footer>
          {!!it.used_count && <Muted>{t('items.used', { n: it.used_count })} · {t('error.item_in_use')}</Muted>}
          <ActionButton tone="danger" size="sm" disabled={!!it.used_count} onClick={() => setConfirmDelete(true)} data-testid="payroll-item-delete">{t('items.delete')}</ActionButton>
        </DetailDrawer.Footer>
      )}
      <ConfirmDialog isOpen={confirmDelete} onClose={() => setConfirmDelete(false)} onConfirm={doDelete} variant="danger"
        title={t('items.deleteTitle')} message={t('items.deleteMsg', { name: it.name })} confirmText={t('items.delete') as string} cancelText={t('common:cancel', 'Cancel') as string} />
    </DetailDrawer>
  );
}

function TextRow({ label, value, onSave, testId, inputMode, wide }: { label: string; value: string | null; onSave: (v: string | null) => Promise<void>; testId?: string; inputMode?: 'decimal' | 'numeric'; wide?: boolean }) {
  const [v, setV] = useState(value ?? '');
  useEffect(() => { setV(value ?? ''); }, [value]);
  const ref = useRef(v); ref.current = v;
  return (
    <Field $wide={wide}>
      <Label>{label}</Label>
      <AutoSaveField onSave={() => onSave(ref.current.trim() || null)}>
        <Input data-testid={testId} value={v} inputMode={inputMode} onChange={(e) => setV(e.target.value)} />
      </AutoSaveField>
    </Field>
  );
}

function SelectRow({ label, value, options, onSave }: { label: string; value: string; options: Opt[]; onSave: (v: string) => Promise<void> }) {
  const [v, setV] = useState(value);
  useEffect(() => { setV(value); }, [value]);
  const ref = useRef(v);
  return (
    <Field>
      <Label>{label}</Label>
      <AutoSaveField type="select" onSave={() => onSave(ref.current)}>
        <PlanQSelect size="sm" value={options.find((o) => o.value === v) || null} options={options}
          onChange={(o) => { const nv = (o as Opt | null)?.value ?? value; ref.current = nv; setV(nv); }} />
      </AutoSaveField>
    </Field>
  );
}

function ToggleRow({ label, value, onSave, testId }: { label: string; value: boolean; onSave: (v: boolean) => Promise<void>; testId?: string }) {
  const [on, setOn] = useState(value);
  useEffect(() => { setOn(value); }, [value]);
  const ref = useRef(on);
  return (
    <ToggleLine>
      <span>{label}</span>
      <AutoSaveField type="toggle" onSave={() => onSave(ref.current)}>
        <Switch type="button" role="switch" aria-checked={on} aria-label={label} $on={on} data-testid={testId}
          onClick={() => { ref.current = !on; setOn(!on); }}>
          <SwitchKnob $on={on} />
        </Switch>
      </AutoSaveField>
    </ToggleLine>
  );
}

const Title = styled.h2`margin: 0; font-size: 1rem; font-weight: 700; color: #0F172A; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`;
const Muted = styled.span`font-size: 0.75rem; color: #94A3B8;`;
const Err = styled.div`margin-bottom: 12px; padding: 8px 12px; border-radius: 8px; background: #FEF2F2; color: #B91C1C; font-size: 0.8125rem; line-height: 1.5;`;
const Hint = styled.p`margin: 0 0 14px; padding: 10px 12px; border-radius: 8px; background: #F8FAFC; border: 1px solid #E2E8F0; color: #475569; font-size: 0.8125rem; line-height: 1.5;`;
const Grid = styled.div`display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; @media (max-width: 640px) { grid-template-columns: 1fr; }`;
const Field = styled.div<{ $wide?: boolean }>`display: flex; flex-direction: column; gap: 6px; min-width: 0; ${(p) => (p.$wide ? 'grid-column: 1 / -1;' : '')}`;
const Label = styled.label`font-size: 0.75rem; font-weight: 600; color: #475569;`;
const Input = styled.input`
  width: 100%; height: 36px; padding: 0 10px; border: 1px solid #E2E8F0; border-radius: 6px; font-size: 0.875rem; font-family: inherit; color: #0F172A; background: #FFF; box-sizing: border-box;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 2px rgba(20, 184, 166, 0.15); }
`;
const Toggles = styled.div`margin-top: 18px; display: flex; flex-direction: column; gap: 4px;`;
const ToggleLine = styled.div`display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 40px; font-size: 0.875rem; color: #0F172A;`;
