// OutputKindPicker — 업무 «산출물» 고르기 (docs/TASK_DELIVERABLES_DESIGN.md §6.1)
//
//   TagPicker 와 같은 감각 — 치면 기본 목록·워크스페이스 목록이 좁혀지고, 없으면 «'x' 산출물 추가» 가 그 자리에 뜬다.
//   옵션 값: `id:<n>`(사전 행) · `preset:<key>`(아직 행이 없는 기본 항목 — 고르는 순간 서버가 행을 만든다).
//   기본 항목은 ko·en 라벨 둘 다로 찾아진다(«prop» → Proposal / «제안» → 제안서).
//   실패(상한·중복)는 칸 아래 빨간 글씨 — 조용한 실패 금지.
import React, { useMemo, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import PlanQSelect from '../Common/PlanQSelect';
import { apiFetch } from '../../contexts/AuthContext';
import { labelOf, outputErrorKey, type OutputKindLite, type OutputPresetLite } from './outputKindLabel';

interface Props {
  bizId: number | null;
  rows: OutputKindLite[];
  pendingPresets: OutputPresetLite[];
  value: OutputKindLite[];
  disabled?: boolean;
  onChange: (next: OutputKindLite[]) => void;
  onDictAdd: (row: OutputKindLite) => void;
  variant?: 'box' | 'inline';
  testId?: string;
}

const MAX = 10;

const OutputKindPicker: React.FC<Props> = ({ bizId, rows, pendingPresets, value, disabled, onChange, onDictAdd, variant, testId }) => {
  const { t, i18n } = useTranslation('qtask');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const failText = (code: string | null | undefined) => {
    const k = outputErrorKey(code);
    return (k ? t(k) : t('outputs.createFailed', '산출물을 추가하지 못했습니다')) as string;
  };

  // 서버에 행을 받는다 — {preset_key} 또는 {name}. 이미 있으면 그 행(멱등).
  const ensure = async (body: { preset_key?: string; name?: string }): Promise<OutputKindLite | null> => {
    if (!bizId) return null;
    const r = await apiFetch('/api/tasks/output-kinds', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ business_id: bizId, ...body }),
    });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.success) { setErr(failText(j?.message)); return null; }
    const row = j.data as OutputKindLite;
    onDictAdd(row);
    return row;
  };

  const options = useMemo(() => [
    ...rows.map((k) => ({ value: `id:${k.id}`, label: labelOf(k, i18n.language) })),
    ...pendingPresets.map((p) => ({ value: `preset:${p.key}`, label: labelOf(p, i18n.language) })),
  ], [rows, pendingPresets, i18n.language]);
  // 검색은 ko·en 라벨 둘 다로 — 보이는 라벨 하나만 보면 영어 화면에서 «제안» 이 안 찾아진다
  const searchText = useMemo(() => {
    const m = new Map<string, string>();
    for (const k of rows) m.set(`id:${k.id}`, k.labels ? `${k.labels.ko} ${k.labels.en} ${k.name}` : k.name);
    for (const p of pendingPresets) m.set(`preset:${p.key}`, `${p.labels.ko} ${p.labels.en}`);
    return m;
  }, [rows, pendingPresets]);

  const handle = async (picked: Array<{ value: string }>) => {
    setErr(null);
    if (picked.length > MAX) { setErr(t('outputs.limitTask', '업무당 산출물은 최대 10개입니다') as string); return; }
    const byId = new Map([...rows, ...value].map((k) => [k.id, k]));
    const next: OutputKindLite[] = [];
    setBusy(true);
    try {
      for (const o of picked) {
        if (o.value.startsWith('id:')) {
          const k = byId.get(Number(o.value.slice(3)));
          if (k) next.push(k);
        } else if (o.value.startsWith('preset:')) {
          const row = await ensure({ preset_key: o.value.slice(7) });
          if (!row) return;
          next.push(row);
        }
      }
    } finally { setBusy(false); }
    onChange(next.filter((k, i, a) => a.findIndex((x) => x.id === k.id) === i));
  };

  const create = async (input: string) => {
    const name = input.trim().slice(0, 40);
    if (!name || busy) return;
    if (value.length >= MAX) { setErr(t('outputs.limitTask', '업무당 산출물은 최대 10개입니다') as string); return; }
    setBusy(true); setErr(null);
    try {
      const row = await ensure({ name });
      if (row && !value.some((v) => v.id === row.id)) onChange([...value, row]);
    } finally { setBusy(false); }
  };

  return (
    <>
      <Box data-testid={testId}>
      <PlanQSelect size="sm" variant={variant} isMulti isClearable isSearchable creatable
        isDisabled={disabled || busy || !bizId}
        isLoading={busy}
        placeholder={t('outputs.placeholder', '산출물 검색 또는 입력') as string}
        value={value.map((k) => ({ value: `id:${k.id}`, label: labelOf(k, i18n.language) }))}
        onChange={(v) => { void handle((Array.isArray(v) ? v : []) as Array<{ value: string }>); }}
        onCreateOption={(input: string) => { void create(input); }}
        formatCreateLabel={(input: string) => t('outputs.createNamed', { name: input }) as string}
        filterOption={(opt, input) => {
          const q = input.trim().toLowerCase();
          if (!q) return true;
          return String(opt.label).toLowerCase().includes(q) || String(searchText.get(String(opt.value)) || '').toLowerCase().includes(q);
        }}
        options={options} />
      </Box>
      {err && <ErrText role="alert">{err}</ErrText>}
    </>
  );
};

export default OutputKindPicker;

const Box = styled.div`min-width:0;`;
const ErrText = styled.div`margin-top:4px;font-size:0.75rem;color:#DC2626;`;
