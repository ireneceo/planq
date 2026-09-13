// RecordModal — 상담 기록(전화·미팅·방문·메모)을 남기는 창. **단일 원천.**
//   Irene 2026-09-12: "계약도 하고 메모도 하고 상담관리 하는 거지."
//   상세 페이지 안에 인라인으로 있던 것을 꺼냈다 — 우측 패널도 **같은 창**을 쓴다(자리마다 다르면 고장이다).
import { useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import StandardModal from '../Common/StandardModal';
import ActionButton from '../Common/ActionButton';
import InteractionFields from './InteractionFields';
import { useDraftKey, useDraftText } from '../../hooks/useDraftText';
import { createInteraction, type InteractionKind } from '../../services/sale';

export default function RecordModal({ open, businessId, clientId, onClose, onSaved }: {
  open: boolean; businessId: number | null; clientId: number; onClose: () => void; onSaved: () => void;
}) {
  const { t } = useTranslation('qsale');
  const [kind, setKind] = useState<InteractionKind>('call');
  const [direction, setDirection] = useState<'inbound' | 'outbound' | ''>('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState(() => new Date().toTimeString().slice(0, 5));
  const [title, setTitle] = useState('');
  const [minutes, setMinutes] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // 통화·미팅 메모는 길다 — 모달을 닫아도 남는다(제출 성공에만 비운다). docs/DRAFT_PERSISTENCE_DESIGN.md
  const draftKey = useDraftKey('sale-interaction-body', clientId, businessId);
  const bodyDraft = useDraftText(draftKey);
  const body = bodyDraft.text;

  useEffect(() => {
    if (!open) return;
    setKind('call'); setDirection(''); setTitle(''); setMinutes(''); setErr(null);
    setDate(new Date().toISOString().slice(0, 10));
    setTime(new Date().toTimeString().slice(0, 5));
  }, [open]);


  const submit = async () => {
    if (!businessId || saving) return;                 // 중복 제출 가드
    if (!title.trim() && !body.trim()) { setErr(t('record.contentRequired') as string); return; }
    setSaving(true);
    try {
      await createInteraction(businessId, clientId, {
        kind,
        direction: direction || null,
        occurred_at: new Date(`${date}T${time || '00:00'}`).toISOString(),
        duration_seconds: minutes ? Math.round(Number(minutes) * 60) : null,
        title: title.trim() || null,
        body: body.trim() || null,
      });
      bodyDraft.clear();          // 제출 성공에만 비운다 — 실패를 삼키고 비우면 그게 곧 글 삭제다
      onSaved();
    } catch (e) {
      const m = (e as Error).message;
      setErr(m === 'occurred_in_future' ? (t('record.futureNotAllowed') as string)
        : m === 'content_required' ? (t('record.contentRequired') as string)
          : (t('error.saveFailed') as string));
    } finally { setSaving(false); }
  };

  return (
    <StandardModal open={open} onClose={onClose} title={t('action.addRecord') as string} size="md"
      footer={(
        <>
          <ActionButton tone="secondary" size="md" onClick={onClose}>{t('inquiry.cancel') as string}</ActionButton>
          <ActionButton tone="primary" size="md" loading={saving} onClick={submit} data-testid="sale-record-submit">
            {t('record.save') as string}
          </ActionButton>
        </>
      )}>
      {/* 입력칸은 **공용 한 벌**이다 — 문의 추가 모달도 같은 것을 쓴다(2026-09-13) */}
      <InteractionFields
        idPrefix="sale-rec"
        value={{ kind, direction, date, time, title, minutes }}
        onChange={(patch) => {
          if (patch.kind !== undefined) setKind(patch.kind);
          if (patch.direction !== undefined) setDirection(patch.direction);
          if (patch.date !== undefined) setDate(patch.date);
          if (patch.time !== undefined) setTime(patch.time);
          if (patch.title !== undefined) setTitle(patch.title);
          if (patch.minutes !== undefined) setMinutes(patch.minutes);
        }}
        bodySlot={(
          <>
            <TextArea id="sale-rec-body" rows={5} {...bodyDraft.bind} />
            {bodyDraft.restored && <HintText>{t('record.draftRestored') as string}</HintText>}
          </>
        )}
      />
      {err && <ErrText role="alert">{err}</ErrText>}
    </StandardModal>
  );
}

// ─── 종결 (사유 필수) ─────────────────────────────────────────────

const HintText = styled.div`font-size: 0.75rem; color: #0F766E;`;
const TextArea = styled.textarea`
  width: 100%; padding: 8px 10px; border: 1px solid #E2E8F0; border-radius: 8px;
  font-size: 0.8125rem; color: #0F172A; font-family: inherit; line-height: 1.5; resize: vertical;
  &:focus { outline: none; border-color: #5EEAD4; }
`;
const ErrText = styled.div`font-size: 0.8125rem; color: #B91C1C;`;
