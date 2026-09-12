// LostReasonModal — 계약 불발 사유를 받는 창. **단일 원천.**
//
// 서버는 `lost_reason`·`lost_note` 를 받는데, 우측 패널의 [계약 불발] 은 단계만 넘겼다
// → 왜 깨졌는지가 원장에 안 남았다(같은 화면의 상세에서는 남았다 — 한 기능이 자리마다 달랐다).
// 상세 페이지 안에 인라인으로 있던 이 창을 꺼내 **두 곳이 같은 것을 쓴다**(2026-09-12 박제:
// "새로 만들지 않는다 — 기존 것을 찾아서 쓴다").
import React, { useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import StandardModal from '../Common/StandardModal';
import ActionButton from '../Common/ActionButton';
import { useDraftKey, useDraftText } from '../../hooks/useDraftText';
import { LOST_REASONS, type LostReason } from '../../services/sale';

interface Props {
  open: boolean;
  businessId: number | null;
  clientId: number;
  onClose: () => void;
  onConfirm: (reason: LostReason, note: string) => Promise<void>;
}

const LostReasonModal: React.FC<Props> = ({ open, businessId, clientId, onClose, onConfirm }) => {
  const { t } = useTranslation('qsale');
  const [reason, setReason] = useState<LostReason | ''>('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // 종결 사유 메모는 쓰다 닫으면 사라지던 값이다 — 제출 성공에만 비운다
  const noteDraft = useDraftText(useDraftKey('sale-lost-note', clientId, businessId));
  const note = noteDraft.text;
  useEffect(() => { if (open) { setReason(''); setErr(null); } }, [open]);

  return (
    <StandardModal open={open} onClose={onClose} title={t('lost.modal.title') as string} size="sm"
      footer={(
        <>
          <ActionButton tone="secondary" size="md" onClick={onClose}>{t('inquiry.cancel') as string}</ActionButton>
          <ActionButton tone="danger" size="md" loading={saving} data-testid="sale-lost-confirm"
            onClick={async () => {
              if (saving) return;
              if (!reason) { setErr(t('lost.modal.reasonRequired') as string); return; }
              setSaving(true);
              try { await onConfirm(reason, note); noteDraft.clear(); }
              catch { setErr(t('error.saveFailed') as string); }
              finally { setSaving(false); }
            }}>
            {t('lost.modal.confirm') as string}
          </ActionButton>
        </>
      )}>
      <Field>
        <FieldLabel>{t('lost.modal.reasonLabel') as string}</FieldLabel>
        <ReasonList>
          {LOST_REASONS.map((r) => (
            <ReasonBtn key={r} type="button" $on={reason === r} data-testid={`sale-lost-reason-${r}`}
              onClick={() => setReason(r)}>{t(`lost.reason.${r}`) as string}</ReasonBtn>
          ))}
        </ReasonList>
      </Field>
      <Field>
        <FieldLabel htmlFor="sale-lost-note">{t('lost.modal.noteLabel') as string}</FieldLabel>
        <TextArea id="sale-lost-note" rows={3} {...noteDraft.bind} />
      </Field>
      {err && <ErrText role="alert">{err}</ErrText>}
    </StandardModal>
  );
};

export default LostReasonModal;

const Field = styled.div`display: flex; flex-direction: column; gap: 6px;`;
const FieldLabel = styled.label`font-size: 0.75rem; font-weight: 600; color: #475569;`;
const ReasonList = styled.div`display: flex; flex-wrap: wrap; gap: 6px;`;
const ReasonBtn = styled.button<{ $on: boolean }>`
  padding: 6px 12px; border-radius: 999px; font-size: 0.8125rem; cursor: pointer;
  border: 1px solid ${(p) => (p.$on ? '#F43F5E' : '#E2E8F0')};
  background: ${(p) => (p.$on ? '#FFF1F2' : '#FFFFFF')};
  color: ${(p) => (p.$on ? '#BE123C' : '#475569')};
  font-weight: ${(p) => (p.$on ? 700 : 500)};
  &:hover { border-color: ${(p) => (p.$on ? '#F43F5E' : '#CBD5E1')}; }
`;
const TextArea = styled.textarea`
  width: 100%; padding: 8px 10px; border: 1px solid #E2E8F0; border-radius: 8px;
  font-size: 0.8125rem; color: #0F172A; font-family: inherit; line-height: 1.5; resize: vertical;
  &:focus { outline: none; border-color: #5EEAD4; }
`;
const ErrText = styled.div`font-size: 0.8125rem; color: #B91C1C;`;
