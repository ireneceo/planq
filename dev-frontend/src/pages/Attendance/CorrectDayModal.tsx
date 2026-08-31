// 근태 정정 (운영 #392) — 본인이 자기 기록의 출퇴근 시각을 고친다.
//
// 왜 승인 단계가 없는가
//   Irene: "승인이 필요할까? … 정정 단계없는 건 이상해."
//   승인을 걸면 실무에서 매번 막히고, 승인자가 사실을 확인할 방법도 없다(그 시간에 무엇을
//   했는지는 본인만 안다). 대신 **사유를 반드시 받고, 원장을 남기고, 관리자에게 알린다** —
//   이력 없이 고치는 쪽이야말로 나중에 다툼이 된다. 서버가 같은 규칙을 강제한다.
import React, { useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import StandardModal from '../../components/Common/StandardModal';
import ActionButton from '../../components/Common/ActionButton';
import { apiFetch } from '../../contexts/AuthContext';
import { mapApiError } from '../../utils/apiError';
import type { AttendanceDay } from '../../hooks/useAttendance';

/** ISO → <input type="time"> 이 쓰는 로컬 HH:MM */
function toLocalTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
/** work_date(YYYY-MM-DD) + 로컬 HH:MM → ISO. 사용자가 보는 시각 그대로 보낸다. */
function toIso(workDate: string, hhmm: string): string | null {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  const d = new Date(`${workDate}T00:00:00`);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}

interface Props {
  day: AttendanceDay;
  onClose: () => void;
  onSaved: () => void;
}

const CorrectDayModal: React.FC<Props> = ({ day, onClose, onSaved }) => {
  const { t } = useTranslation('attendance');
  const { t: tErr } = useTranslation('errors');
  const [inAt, setInAt] = useState(toLocalTime(day.clock_in_at));
  const [outAt, setOutAt] = useState(toLocalTime(day.clock_out_at));
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (saving || !reason.trim() || !inAt) return;   // 중복 제출 가드 (UI_DESIGN_GUIDE §1.8)
    setSaving(true); setError(null);
    try {
      const events = [{ kind: 'clock_in', at: toIso(day.work_date, inAt) }];
      if (outAt) events.push({ kind: 'clock_out', at: toIso(day.work_date, outAt) });
      const r = await apiFetch(`/api/attendance/days/${day.id}/correct`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fix_reason: reason.trim(), events }),
      });
      // apiFetch 는 throw 하지 않는다 — res.ok 를 반드시 본다
      if (!r.ok) {
        const j = await r.json().catch(() => null);
        throw new Error(j?.message || `HTTP ${r.status}`);
      }
      onSaved();
      onClose();
    } catch (e) {
      setError(mapApiError(e, tErr));
    } finally { setSaving(false); }
  };

  return (
    <StandardModal
      open
      onClose={onClose}
      title={t('correct.title', { defaultValue: '근태 정정' }) as string}
      size="sm"
      footer={(
        <>
          <ActionButton tone="secondary" onClick={onClose} disabled={saving}>
            {t('correct.cancel', { defaultValue: '취소' })}
          </ActionButton>
          <ActionButton tone="primary" onClick={submit} loading={saving} disabled={!reason.trim() || !inAt}>
            {t('correct.save', { defaultValue: '정정하기' })}
          </ActionButton>
        </>
      )}
    >
      <Note>{t('correct.notice', { defaultValue: '바로 반영됩니다. 원래 기록은 지워지지 않고 이력으로 남고, 관리자에게 알림이 갑니다.' })}</Note>
      <Field>
        <Label>{t('my.date')}</Label>
        <Fixed>{day.work_date}</Fixed>
      </Field>
      <Two>
        <Field>
          <Label>{t('my.in')}</Label>
          <input type="time" value={inAt} onChange={(e) => setInAt(e.target.value)} />
        </Field>
        <Field>
          <Label>{t('my.out')}</Label>
          <input type="time" value={outAt} onChange={(e) => setOutAt(e.target.value)} />
        </Field>
      </Two>
      <Field>
        <Label>{t('correct.reason', { defaultValue: '사유 (필수)' })}</Label>
        <textarea rows={3} value={reason} maxLength={300}
          placeholder={t('correct.reasonPh', { defaultValue: '예: 회의 후 바로 퇴근했는데 자동 기록이 늦게 닫혔어요' }) as string}
          onChange={(e) => setReason(e.target.value)} />
      </Field>
      {error && <ErrorText>{error}</ErrorText>}
    </StandardModal>
  );
};

export default CorrectDayModal;

const Note = styled.p`
  margin: 0 0 14px; font-size: 0.75rem; line-height: 1.5; color: #64748B;
  background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 10px 12px;
`;
const Field = styled.div`
  display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px;
  input, textarea {
    width: 100%; box-sizing: border-box;
    border: 1px solid #E2E8F0; border-radius: 8px; padding: 9px 10px;
    font-size: 0.875rem; font-family: inherit; color: #0F172A; background: #FFFFFF;
    &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.1); }
  }
  textarea { resize: vertical; }
`;
const Two = styled.div`
  display: grid; grid-template-columns: 1fr 1fr; gap: 10px;
  @media (max-width: 480px) { grid-template-columns: 1fr; }
`;
const Label = styled.label`font-size: 0.75rem; font-weight: 600; color: #475569;`;
const Fixed = styled.div`font-size: 0.875rem; font-weight: 600; color: #0F172A;`;
const ErrorText = styled.div`font-size: 0.75rem; color: #DC2626; margin-top: 4px;`;
