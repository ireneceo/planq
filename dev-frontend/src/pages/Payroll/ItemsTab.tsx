// 급여 › 항목 탭 (docs/PAYROLL_DESIGN.md §3.3 · §7.1 · §9) — 지급/공제 항목 정의. 나라별 차이는 «기본 틀» 로만 들어온다.
//   [+ 항목] CreateDrawer · 행 → ItemDrawer(칸마다 자동저장) · [기본 틀 불러오기] · [AI 로 틀 제안](사람이 고른 것만 추가 — 요율 없음).
//   ★ 쓰인 항목은 지우지 못하고 «사용» 을 끈다. 확정 회차가 쓰는 항목은 돈의 뜻을 바꾸지 못한다(서버가 막는다).
import { useCallback, useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import CreateDrawer from '../../components/Common/CreateDrawer';
import StandardModal from '../../components/Common/StandardModal';
import PlanQSelect from '../../components/Common/PlanQSelect';
import ActionButton from '../../components/Common/ActionButton';
import { useAuth } from '../../contexts/AuthContext';
import { listRowTitleCss } from '../../theme/tokens';
import { onSocket } from '../../services/socket';
import { useVisibilityRefresh } from '../../hooks/useVisibilityRefresh';
import { payrollApi, PayrollError, type PayItem, type PresetItem, type PresetSummary, type SuggestedItem } from './payrollApi';
import { Chip } from './payrollUi';
import ItemDrawer from './ItemDrawer';

type Opt = { value: string; label: string };

export default function ItemsTab({ createOpen, setCreateOpen }: { createOpen: boolean; setCreateOpen: (v: boolean) => void }) {
  const { t, i18n } = useTranslation('payroll');
  const { user } = useAuth();
  const bizId = user?.business_id ? Number(user.business_id) : null;
  const [items, setItems] = useState<PayItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('item') ? Number(params.get('item')) : null;
  const seqRef = useRef(0);

  const load = useCallback(async (silent = false) => {
    if (!bizId) return;
    const seq = ++seqRef.current;
    if (!silent) setLoading(true);
    try { const rows = await payrollApi.items(bizId); if (seq === seqRef.current) { setItems(rows); setError(null); } }
    catch (e) { if (seq === seqRef.current && !silent) setError(e instanceof PayrollError ? e.code : 'generic'); }
    finally { if (seq === seqRef.current && !silent) setLoading(false); }
  }, [bizId]);
  useEffect(() => { load(); }, [load]);
  const silentLoad = useCallback(() => load(true), [load]);
  useVisibilityRefresh(silentLoad);
  useEffect(() => {
    let pending: number | null = null;
    const off = onSocket<{ business_id?: number; kind?: string }>('payroll:updated', (d) => {
      if (d?.business_id && Number(d.business_id) !== bizId) return;
      if (pending) return;
      pending = window.setTimeout(() => { pending = null; silentLoad(); }, 250);
    });
    return () => { off(); if (pending) window.clearTimeout(pending); };
  }, [bizId, silentLoad]);

  const openItem = (id: number) => {
    const sp = new URLSearchParams(params);
    if (selectedId === id) sp.delete('item'); else sp.set('item', String(id));   // 재클릭 토글
    setParams(sp, { replace: true });
  };
  const closeItem = () => { const sp = new URLSearchParams(params); sp.delete('item'); setParams(sp, { replace: true }); };
  const selected = items.find((x) => x.id === selectedId) || null;

  const earnings = items.filter((x) => x.side === 'earning');
  const deductions = items.filter((x) => x.side === 'deduction');

  // ── 만들기 ─────────────────────────────
  const blank = { name: '', side: 'earning', calc: 'fixed', applies_to: 'all', rate: '' };
  const [form, setForm] = useState(blank);
  const [submitting, setSubmitting] = useState(false);
  const [createErr, setCreateErr] = useState<string | null>(null);
  useEffect(() => { if (createOpen) { setForm(blank); setCreateErr(null); } }, [createOpen]);   // eslint-disable-line react-hooks/exhaustive-deps
  const submit = async () => {
    if (!bizId || submitting || !form.name.trim()) return;
    setSubmitting(true); setCreateErr(null);
    try {
      const body: Record<string, unknown> = { name: form.name.trim(), side: form.side, calc: form.calc, applies_to: form.applies_to, taxable: form.side === 'earning' };
      if (form.calc === 'rate') { body.rate = Number(form.rate || 0) / 100; body.rate_base = 'gross_total'; }
      const it = await payrollApi.createItem(bizId, body);
      setCreateOpen(false); await silentLoad(); openItem(it.id);
    } catch (e) { setCreateErr(e instanceof PayrollError ? e.code : 'generic'); }
    finally { setSubmitting(false); }
  };
  const o = (prefix: string, keys: string[]): Opt[] => keys.map((k) => ({ value: k, label: t(`${prefix}.${k}`) as string }));

  // ── 기본 틀 ────────────────────────────
  const [presetOpen, setPresetOpen] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);

  const row = (x: PayItem) => (
    <Row key={x.id} type="button" $active={selectedId === x.id} $dim={!x.is_active} data-testid="payroll-item-row" onClick={() => openItem(x.id)}>
      <RowMain>
        <RowTitle>{x.name}{x.name_en ? <Sub> · {x.name_en}</Sub> : null}</RowTitle>
        <RowMeta>{[t(`items.calc.${x.calc}`), x.calc === 'rate' && x.rate !== null ? `${Math.round(x.rate * 1e7) / 1e5}%` : null, t(`items.appliesTo.${x.applies_to}`)].filter(Boolean).join(' · ')}</RowMeta>
      </RowMain>
      <Tags>
        {x.is_statutory && <Chip $bg="#EEF2FF" $fg="#4338CA">{t('items.statutory')}</Chip>}
        {x.is_settlement && <Chip $bg="#F1F5F9" $fg="#475569">{t('items.settlement')}</Chip>}
        {x.side === 'earning' && !x.taxable && <Chip $bg="#F0FDF4" $fg="#15803D">{t('items.nontax')}</Chip>}
        {x.sign === 'minus' && <Chip $bg="#FFF7ED" $fg="#C2410C">{t('items.minus')}</Chip>}
        {!x.is_active && <Chip $bg="#F8FAFC" $fg="#94A3B8">{t('items.inactive')}</Chip>}
      </Tags>
    </Row>
  );

  return (
    <>
      <Bar>
        <ActionButton tone="secondary" size="sm" data-testid="payroll-item-preset" onClick={() => setPresetOpen(true)}>{t('items.preset')}</ActionButton>
        <ActionButton tone="secondary" size="sm" data-testid="payroll-item-suggest" onClick={() => setSuggestOpen(true)}>{t('items.suggest')}</ActionButton>
      </Bar>
      <Hint>{t('items.statutoryHint')}</Hint>
      {loading ? null : error ? (
        <Empty>{t(`error.${error}`, { defaultValue: t('error.generic') as string })}</Empty>
      ) : items.length === 0 ? (
        <Empty>{t('items.empty')}</Empty>
      ) : (
        <Cols>
          <Col><ColHead>{t('items.side.earning')}</ColHead><List data-testid="payroll-items-earning">{earnings.map(row)}</List></Col>
          <Col><ColHead>{t('items.side.deduction')}</ColHead><List data-testid="payroll-items-deduction">{deductions.map(row)}</List></Col>
        </Cols>
      )}

      {bizId && selected && (
        <ItemDrawer key={selected.id} businessId={bizId} item={selected} allItems={items} onClose={closeItem}
          onChanged={(next) => { if (next) setItems((prev) => prev.map((x) => (x.id === next.id ? { ...x, ...next } : x))); }}
          onDeleted={() => { closeItem(); silentLoad(); }} />
      )}

      <CreateDrawer open={createOpen} onClose={() => setCreateOpen(false)} title={t('items.create.title')} onSubmit={submit}
        submitting={submitting} submitDisabled={!form.name.trim() || (form.calc === 'rate' && !form.rate)} submitLabel={t('items.create.submit')} submitTestId="payroll-item-create-submit">
        {createErr && <Err role="alert">{t(`error.${createErr}`, { defaultValue: t('error.generic') as string })}</Err>}
        <Field><Label>{t('items.field.name')}</Label><Input data-testid="payroll-item-create-name" value={form.name} maxLength={100} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field><Label>{t('items.field.side')}</Label>
          <PlanQSelect size="sm" options={o('items.side', ['earning', 'deduction'])} value={o('items.side', ['earning', 'deduction']).find((x) => x.value === form.side) || null}
            onChange={(v) => setForm({ ...form, side: (v as Opt)?.value || 'earning' })} /></Field>
        <Field><Label>{t('items.field.calc')}</Label>
          <PlanQSelect size="sm" options={o('items.calc', ['fixed', 'rate', 'manual', 'external', 'unpaid_leave'])}
            value={o('items.calc', ['fixed', 'rate', 'manual', 'external', 'unpaid_leave']).find((x) => x.value === form.calc) || null}
            onChange={(v) => setForm({ ...form, calc: (v as Opt)?.value || 'fixed' })} /></Field>
        {form.calc === 'rate' && <Field><Label>{t('items.field.rate')}</Label><Input inputMode="decimal" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value.replace(/[^\d.]/g, '') })} /></Field>}
        <Field><Label>{t('items.field.appliesTo')}</Label>
          <PlanQSelect size="sm" options={o('items.appliesTo', ['all', 'employment', 'business', 'other'])}
            value={o('items.appliesTo', ['all', 'employment', 'business', 'other']).find((x) => x.value === form.applies_to) || null}
            onChange={(v) => setForm({ ...form, applies_to: (v as Opt)?.value || 'all' })} /></Field>
      </CreateDrawer>

      {bizId && presetOpen && <PresetModal businessId={bizId} lang={i18n.language} onClose={() => setPresetOpen(false)} onAdded={() => { setPresetOpen(false); silentLoad(); }} />}
      {bizId && suggestOpen && <SuggestModal businessId={bizId} onClose={() => setSuggestOpen(false)} onAdded={() => { setSuggestOpen(false); silentLoad(); }} />}
    </>
  );
}

function PresetModal({ businessId, lang, onClose, onAdded }: { businessId: number; lang: string; onClose: () => void; onAdded: () => void }) {
  const { t } = useTranslation('payroll');
  const [list, setList] = useState<PresetSummary[]>([]);
  const [key, setKey] = useState<string>('KR-employee');
  const [items, setItems] = useState<PresetItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { payrollApi.presets(businessId).then(setList).catch(() => setErr('generic')); }, [businessId]);
  useEffect(() => { payrollApi.preset(businessId, key).then((p) => setItems(p.items)).catch(() => setErr('generic')); }, [businessId, key]);
  const toAdd = items.filter((x) => !x.exists);
  const opts = list.map((p) => ({ value: p.key, label: lang === 'en' ? p.label.en : p.label.ko }));
  const add = async () => {
    if (busy || !toAdd.length) return;
    setBusy(true);
    try { await payrollApi.applyPreset(businessId, key); onAdded(); }
    catch (e) { setErr(e instanceof PayrollError ? e.code : 'generic'); }
    finally { setBusy(false); }
  };
  return (
    <StandardModal open onClose={onClose} title={t('items.presetModal.title')} size="md"
      footer={<ActionButton loading={busy} disabled={!toAdd.length} onClick={add} data-testid="payroll-preset-apply">{t('items.presetModal.add', { n: toAdd.length })}</ActionButton>}>
      <Hint>{t('items.presetModal.hint')}</Hint>
      {err && <Err role="alert">{t(`error.${err}`, { defaultValue: t('error.generic') as string })}</Err>}
      <Field><Label>{t('items.presetModal.pick')}</Label>
        <PlanQSelect size="sm" options={opts} value={opts.find((x) => x.value === key) || null} onChange={(v) => setKey((v as Opt)?.value || 'KR-employee')} /></Field>
      <PreviewList data-testid="payroll-preset-preview">
        {items.map((x) => (
          <PreviewRow key={x.code} $dim={!!x.exists}>
            <span>{x.name}</span>
            <PreviewMeta>{[t(`items.side.${x.side}`), t(`items.calc.${x.calc}`), x.exists ? t('items.presetModal.exists') : null].filter(Boolean).join(' · ')}</PreviewMeta>
          </PreviewRow>
        ))}
        {!toAdd.length && items.length > 0 && <PreviewMeta>{t('items.presetModal.none')}</PreviewMeta>}
      </PreviewList>
    </StandardModal>
  );
}

function SuggestModal({ businessId, onClose, onAdded }: { businessId: number; onClose: () => void; onAdded: () => void }) {
  const { t } = useTranslation('payroll');
  const [country, setCountry] = useState('');
  const [kind, setKind] = useState('employment');
  const [items, setItems] = useState<SuggestedItem[]>([]);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [fallback, setFallback] = useState(false);
  const [running, setRunning] = useState(false);
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const kindOpts: Opt[] = (['employment', 'business'] as const).map((k) => ({ value: k, label: t(`items.appliesTo.${k}`) as string }));
  const run = async () => {
    if (running) return;
    setRunning(true); setErr(null);
    try {
      const r = await payrollApi.suggestItems(businessId, { country: country.trim().toUpperCase(), employment_kind: kind });
      setItems(r.items); setFallback(r.fallback); setPicked(new Set(r.items.map((_, i) => i)));
    } catch (e) { setErr(e instanceof PayrollError ? e.code : 'generic'); }
    finally { setRunning(false); }
  };
  const add = async () => {
    if (adding || !picked.size) return;
    setAdding(true); setErr(null);
    try {
      for (const i of [...picked].sort((a, b) => a - b)) {
        const x = items[i];
        await payrollApi.createItem(businessId, { name: x.name, name_en: x.name_en, side: x.side, calc: x.calc, taxable: x.taxable, sign: x.sign, applies_to: x.applies_to, is_statutory: x.is_statutory, aliases: x.aliases });
      }
      onAdded();
    } catch (e) { setErr(e instanceof PayrollError ? e.code : 'generic'); }
    finally { setAdding(false); }
  };
  const toggle = (i: number) => setPicked((prev) => { const n = new Set(prev); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  return (
    <StandardModal open onClose={onClose} title={t('items.suggestModal.title')} size="md"
      footer={<ActionButton loading={adding} disabled={!picked.size} onClick={add} data-testid="payroll-suggest-add">{t('items.suggestModal.add', { n: picked.size })}</ActionButton>}>
      <Hint>{t('items.suggestModal.hint')}</Hint>
      {err && <Err role="alert">{t(`error.${err}`, { defaultValue: t('error.generic') as string })}</Err>}
      <Inline>
        <Field><Label>{t('items.suggestModal.country')}</Label><Input value={country} maxLength={2} placeholder={t('items.suggestModal.countryPh') as string} onChange={(e) => setCountry(e.target.value.replace(/[^a-zA-Z]/g, ''))} /></Field>
        <Field><Label>{t('items.suggestModal.kind')}</Label>
          <PlanQSelect size="sm" options={kindOpts} value={kindOpts.find((x) => x.value === kind) || null} onChange={(v) => setKind((v as Opt)?.value || 'employment')} /></Field>
        {/* AI 버튼 2단계 규약 — 보조 톤(누르기 전엔 비용이 드는 일이 일어나지 않는다) */}
        <ActionButton tone="secondary" size="md" loading={running} onClick={run} data-testid="payroll-suggest-run">{running ? t('items.suggestModal.running') : t('items.suggestModal.run')}</ActionButton>
      </Inline>
      {fallback && <Muted>{t('items.suggestModal.fallback')}</Muted>}
      <PreviewList>
        {items.length === 0 ? <PreviewMeta>{t('items.suggestModal.empty')}</PreviewMeta> : items.map((x, i) => (
          <PickRow key={`${x.name}-${i}`}>
            <input type="checkbox" checked={picked.has(i)} onChange={() => toggle(i)} aria-label={x.name} />
            <span>{x.name}</span>
            <PreviewMeta>{[t(`items.side.${x.side}`), t(`items.calc.${x.calc}`)].join(' · ')}</PreviewMeta>
          </PickRow>
        ))}
      </PreviewList>
    </StandardModal>
  );
}

const Bar = styled.div`display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 10px;`;
const Hint = styled.p`margin: 0 0 12px; font-size: 0.8125rem; color: #64748B; line-height: 1.5;`;
const Cols = styled.div`display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; @media (max-width: 900px) { grid-template-columns: 1fr; }`;
const Col = styled.div`min-width: 0;`;
const ColHead = styled.h3`margin: 0 0 8px; font-size: 0.8125rem; font-weight: 700; color: #334155;`;
const List = styled.div`background: #FFF; border: 1px solid #E2E8F0; border-radius: 12px; overflow: hidden;`;
const Row = styled.button<{ $active: boolean; $dim: boolean }>`
  width: 100%; display: flex; align-items: center; gap: 10px; padding: 10px 14px; min-height: 52px;
  background: ${(p) => (p.$active ? '#F0FDFA' : '#FFF')}; border: none; border-bottom: 1px solid #F1F5F9; text-align: left; cursor: pointer; font-family: inherit;
  opacity: ${(p) => (p.$dim ? 0.6 : 1)};
  &:last-child { border-bottom: none; }
  &:hover { background: ${(p) => (p.$active ? '#F0FDFA' : '#F8FAFC')}; }
`;
const RowMain = styled.div`flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 2px;`;
const RowTitle = styled.span`${listRowTitleCss} color: #0F172A; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`;
const Sub = styled.span`font-weight: 400; color: #94A3B8;`;
const RowMeta = styled.span`font-size: 0.75rem; color: #64748B;`;
const Tags = styled.div`display: flex; gap: 4px; flex-wrap: wrap; justify-content: flex-end; max-width: 50%;`;
const Empty = styled.div`padding: 40px 16px; text-align: center; color: #64748B; font-size: 0.875rem; background: #FFF; border: 1px dashed #E2E8F0; border-radius: 12px;`;
const Field = styled.div`display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; min-width: 0; flex: 1 1 140px;`;
const Label = styled.label`font-size: 0.75rem; font-weight: 600; color: #475569;`;
const Input = styled.input`
  width: 100%; height: 36px; padding: 0 10px; border: 1px solid #E2E8F0; border-radius: 6px; font-size: 0.875rem; font-family: inherit; color: #0F172A; background: #FFF; box-sizing: border-box;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 2px rgba(20, 184, 166, 0.15); }
`;
const Err = styled.div`margin-bottom: 12px; padding: 8px 12px; border-radius: 8px; background: #FEF2F2; color: #B91C1C; font-size: 0.8125rem;`;
const Muted = styled.p`margin: 0; font-size: 0.75rem; color: #94A3B8;`;
const Inline = styled.div`display: flex; gap: 10px; align-items: flex-end; flex-wrap: wrap; & > button { margin-bottom: 14px; }`;
const PreviewList = styled.div`display: flex; flex-direction: column; border: 1px solid #F1F5F9; border-radius: 8px; max-height: 340px; overflow-y: auto;`;
const PreviewRow = styled.div<{ $dim: boolean }>`
  display: flex; justify-content: space-between; gap: 10px; padding: 8px 12px; border-bottom: 1px solid #F8FAFC; font-size: 0.8125rem; color: #0F172A;
  opacity: ${(p) => (p.$dim ? 0.5 : 1)};
`;
const PreviewMeta = styled.span`font-size: 0.75rem; color: #94A3B8; padding: 8px 12px;`;
const PickRow = styled.label`display: flex; align-items: center; gap: 10px; padding: 6px 12px; border-bottom: 1px solid #F8FAFC; font-size: 0.8125rem; color: #0F172A; cursor: pointer; & > span:nth-child(2) { flex: 1; }`;
