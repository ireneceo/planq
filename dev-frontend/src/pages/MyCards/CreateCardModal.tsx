// 명함 추가 — 이름 + «채울 정보»(내가 멤버인 워크스페이스 · 계정 정보만) → 만들고 바로 편집 드로어.
import React, { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import StandardModal from '../../components/Common/StandardModal';
import ActionButton from '../../components/Common/ActionButton';
import PlanQSelect from '../../components/Common/PlanQSelect';
import { createCard, CardApiError, type MyCard, type PrefillSource } from '../../services/nameCards';

interface Props {
  open: boolean;
  sources: PrefillSource[];
  defaultSource: number | null;
  onClose: () => void;
  onCreated: (c: MyCard) => void;
}

const CreateCardModal: React.FC<Props> = ({ open, sources, defaultSource, onClose, onCreated }) => {
  const { t } = useTranslation('cards');
  const [label, setLabel] = useState('');
  const [src, setSrc] = useState<number | ''>('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setLabel(''); setErr(null); setBusy(false);
    const initial = defaultSource && sources.some((s) => s.business_id === defaultSource) ? defaultSource : (sources[0]?.business_id ?? '');
    setSrc(initial);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [open, sources, defaultSource]);

  const submit = async () => {
    if (busy) return;
    if (!label.trim()) { setErr(t('editor.errors.label_required')); return; }
    setBusy(true); setErr(null);
    try {
      onCreated(await createCard(label.trim(), src === '' ? null : Number(src)));
    } catch (e) {
      setErr(e instanceof CardApiError && e.code === 'too_many_cards' ? `${t('create.fail')} (20)` : t('create.fail'));
      setBusy(false);
    }
  };

  return (
    <StandardModal open={open} onClose={onClose} title={t('create.title')} size="sm"
      footer={(
        <>
          <ActionButton tone="secondary" size="md" onClick={onClose}>{t('create.cancel')}</ActionButton>
          <ActionButton tone="primary" size="md" onClick={() => void submit()} loading={busy} disabled={busy} data-testid="card-create-submit">{t('create.submit')}</ActionButton>
        </>
      )}>
      <Field>
        <Label htmlFor="card-create-label">{t('create.label')}</Label>
        <Input id="card-create-label" ref={inputRef} value={label} maxLength={60} data-testid="card-create-label"
          placeholder={t('create.labelPlaceholder') as string}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit(); }} />
        <Hint>{t('create.labelHint')}</Hint>
      </Field>
      <Field>
        <Label htmlFor="card-create-source">{t('create.source')}</Label>
        <div data-testid="card-create-source">
          <PlanQSelect inputId="card-create-source" size="sm" isSearchable={false}
            options={[...sources.map((x) => ({ value: x.business_id, label: x.name })), { value: '', label: t('create.sourceBlank') as string }]}
            value={src === '' ? { value: '', label: t('create.sourceBlank') as string } : (sources.filter((x) => x.business_id === src).map((x) => ({ value: x.business_id, label: x.name }))[0] || null)}
            onChange={(o) => { const v = (o as { value: string | number } | null)?.value; setSrc(v === '' || v == null ? '' : Number(v)); }} />
        </div>
        <Hint>{t('create.sourceHint')}</Hint>
      </Field>
      {err && <Err role="alert">{err}</Err>}
    </StandardModal>
  );
};
export default CreateCardModal;

const Field = styled.div`display: flex; flex-direction: column; gap: 6px;`;
const Label = styled.label`font-size: 0.8125rem; font-weight: 600; color: #475569;`;
const inputCss = `
  width: 100%; box-sizing: border-box; padding: 9px 12px; min-height: 40px;
  border: 1px solid #E2E8F0; border-radius: 8px; font-size: 0.875rem; color: #0F172A; background: #FFFFFF;
  outline: none; font-family: inherit;
  &:focus { border-color: #14B8A6; }
  &::placeholder { color: #CBD5E1; }
`;
const Input = styled.input`${inputCss}`;
const Hint = styled.div`font-size: 0.75rem; color: #94A3B8; line-height: 1.5;`;
const Err = styled.div`font-size: 0.8125rem; color: #B91C1C;`;
