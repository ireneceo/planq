// NextContactModal — **다음 언제 연락할지**를 정해 일정으로 남긴다. (Irene 2026-09-12)
//   "그 다음 언제 연락해야 하는지 미팅 일정도 넣고 연결해야지."
//
// ★ 새 테이블·새 컬럼을 만들지 않는다. 캘린더 일정(`calendar_events`)이 이미 고객을 가리킬 수 있다
//   (`target_client_ids`) — 그것을 쓴다. 그러면 그 약속이 Q calendar 에도 그대로 보인다
//   (상담에만 있는 날짜는 아무도 안 본다).
import React, { useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import StandardModal from '../Common/StandardModal';
import ActionButton from '../Common/ActionButton';
import SingleDateField from '../Common/SingleDateField';
import PlanQSelect from '../Common/PlanQSelect';
import { apiFetch } from '../../contexts/AuthContext';
import { useDraftKey, useDraftText } from '../../hooks/useDraftText';

interface Props {
  open: boolean;
  businessId: number | null;
  clientId: number;
  clientName: string;
  onClose: () => void;
  onSaved: () => void;
}

/** 무엇으로 만나는가 — 제목 기본값에 쓰인다(사람이 고칠 수 있다) */
const KINDS = ['call', 'meeting', 'visit'] as const;

const NextContactModal: React.FC<Props> = ({ open, businessId, clientId, clientName, onClose, onSaved }) => {
  const { t } = useTranslation('qsale');
  const [kind, setKind] = useState<(typeof KINDS)[number]>('call');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('10:00');
  const [minutes, setMinutes] = useState('30');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const note = useDraftText(useDraftKey('sale-next-contact', clientId, businessId));

  useEffect(() => {
    if (!open) return;
    // 기본값은 **내일** — "다음 연락" 이 오늘이면 지금 하면 된다
    const d = new Date(Date.now() + 86400000);
    setDate(d.toISOString().slice(0, 10));
    setTime('10:00'); setMinutes('30'); setKind('call'); setErr(null);
  }, [open]);

  const kindOptions = KINDS.map((k) => ({ value: k as string, label: t(`record.kind.${k}`) as string }));

  const submit = async () => {
    if (!businessId || saving) return;
    if (!date) { setErr(t('next.dateRequired') as string); return; }
    setSaving(true); setErr(null);
    try {
      const start = new Date(`${date}T${time || '10:00'}:00`);
      const end = new Date(start.getTime() + (Number(minutes) || 30) * 60000);
      const r = await apiFetch(`/api/calendar/by-business/${businessId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `${t(`record.kind.${kind}`) as string} — ${clientName}`,
          description: note.text.trim() || null,
          start_at: start.toISOString(),
          end_at: end.toISOString(),
          all_day: false,
          // ★ 이 약속이 **이 고객의 것**이라는 연결. 상담 패널이 이 값으로 다음 일정을 읽는다.
          target_client_ids: [clientId],
        }),
      });
      if (!r.ok) { const j = await r.json().catch(() => null); setErr(j?.message || t('error.saveFailed') as string); return; }
      note.clear();                       // 저장 성공에만 비운다
      onSaved();
    } catch { setErr(t('error.saveFailed') as string); }
    finally { setSaving(false); }
  };

  return (
    <StandardModal open={open} onClose={onClose} title={t('next.title') as string} size="sm"
      footer={(
        <>
          <ActionButton tone="secondary" size="md" onClick={onClose}>{t('inquiry.cancel') as string}</ActionButton>
          <ActionButton tone="primary" size="md" loading={saving} onClick={submit} data-testid="sale-next-submit">
            {t('next.submit') as string}
          </ActionButton>
        </>
      )}>
      <Field>
        <FieldLabel>{t('next.kindLabel') as string}</FieldLabel>
        <PlanQSelect size="md" isSearchable={false} options={kindOptions}
          aria-label={t('next.kindLabel') as string}
          value={kindOptions.find((o) => o.value === kind)}
          onChange={(opt: unknown) => {
            const v = (opt as { value?: string } | null)?.value;
            if (v) setKind(v as (typeof KINDS)[number]);
          }} />
      </Field>
      <Row>
        <Field style={{ flex: '1 1 150px' }}>
          <FieldLabel>{t('next.dateLabel') as string}</FieldLabel>
          <SingleDateField value={date} onChange={(d) => setDate(d)} />
        </Field>
        <Field style={{ flex: '0 0 110px' }}>
          <FieldLabel htmlFor="sale-next-time">{t('next.timeLabel') as string}</FieldLabel>
          <TimeInput id="sale-next-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </Field>
        <Field style={{ flex: '0 0 110px' }}>
          <FieldLabel htmlFor="sale-next-min">{t('next.minutesLabel') as string}</FieldLabel>
          <TimeInput id="sale-next-min" type="number" min="5" step="5" value={minutes}
            onChange={(e) => setMinutes(e.target.value)} />
        </Field>
      </Row>
      <Field>
        <FieldLabel htmlFor="sale-next-note">{t('next.noteLabel') as string}</FieldLabel>
        <TextArea id="sale-next-note" rows={3} data-draft-kind="sale-next-contact" {...note.bind}
          placeholder={t('next.notePlaceholder') as string} />
      </Field>
      {err && <ErrText role="alert">{err}</ErrText>}
    </StandardModal>
  );
};

export default NextContactModal;

const Field = styled.div`display: flex; flex-direction: column; gap: 6px;`;
const FieldLabel = styled.label`font-size: 0.75rem; font-weight: 600; color: #475569;`;
const Row = styled.div`display: flex; gap: 8px; flex-wrap: wrap;`;
const TimeInput = styled.input`
  height: 36px; padding: 0 10px; border: 1px solid #E2E8F0; border-radius: 8px;
  font-size: 0.8125rem; color: #0F172A; font-family: inherit; width: 100%;
  &:focus { outline: none; border-color: #5EEAD4; }
`;
const TextArea = styled.textarea`
  width: 100%; padding: 8px 10px; border: 1px solid #E2E8F0; border-radius: 8px;
  font-size: 0.8125rem; color: #0F172A; font-family: inherit; line-height: 1.5; resize: vertical;
  &:focus { outline: none; border-color: #5EEAD4; }
`;
const ErrText = styled.div`font-size: 0.8125rem; color: #B91C1C;`;
