// 근태 — 휴가 신청 드로어 (#208). AttendancePage 에서 분리.
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import ActionButton from '../../components/Common/ActionButton';
import PlanQSelect from '../../components/Common/PlanQSelect';
import SingleDateField from '../../components/Common/SingleDateField';
import DetailDrawer from '../../components/Common/DetailDrawer';
import { apiFetch } from '../../contexts/AuthContext';
import { Field, FieldLabel, NumInput, TextArea, ErrorBar } from './shared';

// ─── 신청 드로어 ────────────────────────────────────────────────
export const LeaveRequestDrawer: React.FC<{ open: boolean; onClose: () => void; bizId: number; onDone: () => Promise<void> }> =
({ open, onClose, bizId, onDone }) => {
  const { t } = useTranslation('attendance');
  const today = new Date().toISOString().slice(0, 10);
  const [leaveType, setLeaveType] = useState<'paid' | 'unpaid'>('paid');
  const [unit, setUnit] = useState<'full_day' | 'half_day' | 'hours'>('full_day');
  const [halfKind, setHalfKind] = useState<'am' | 'pm'>('am');
  const [hours, setHours] = useState('2');
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (saving) return;
    setSaving(true); setErr(null);
    try {
      const r = await apiFetch('/api/leave/requests', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: bizId, leave_type: leaveType, unit,
          start_date: start, end_date: unit === 'full_day' ? end : start,
          half_kind: unit === 'half_day' ? halfKind : undefined,
          hours: unit === 'hours' ? Number(hours) : undefined,
          reason,
        }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.success) { setErr(j?.message || 'generic'); return; }
      await onDone();
      setReason('');
      onClose();
    } finally { setSaving(false); }
  };

  const typeOpts = [
    { value: 'paid', label: t('leave.paid') as string },
    { value: 'unpaid', label: t('leave.unpaid') as string },
  ];
  const unitOpts = [
    { value: 'full_day', label: t('leave.fullDay') as string },
    { value: 'half_day', label: t('leave.halfDay') as string },
    { value: 'hours', label: t('leave.hours') as string },
  ];
  const halfOpts = [
    { value: 'am', label: t('leave.am') as string },
    { value: 'pm', label: t('leave.pm') as string },
  ];

  return (
    <DetailDrawer open={open} onClose={onClose} width={440} ariaLabel={t('leave.new') as string}>
      <DetailDrawer.Header onClose={onClose}>{t('leave.new')}</DetailDrawer.Header>
      <DetailDrawer.Body>
        <Field>
          <FieldLabel>{t('leave.type')}</FieldLabel>
          <PlanQSelect size="md" options={typeOpts}
            value={typeOpts.find((o) => o.value === leaveType) || null}
            onChange={(o) => setLeaveType(((o as { value: string })?.value as 'paid' | 'unpaid') || 'paid')} />
        </Field>
        <Field>
          <FieldLabel>{t('leave.unit')}</FieldLabel>
          <PlanQSelect size="md" options={unitOpts}
            value={unitOpts.find((o) => o.value === unit) || null}
            onChange={(o) => setUnit(((o as { value: string })?.value as typeof unit) || 'full_day')} />
        </Field>
        <Field>
          <FieldLabel>{t('leave.startDate')}</FieldLabel>
          <SingleDateField value={start} onChange={(v) => { setStart(v); if (v > end) setEnd(v); }} size="md" />
        </Field>
        {unit === 'full_day' && (
          <Field>
            <FieldLabel>{t('leave.endDate')}</FieldLabel>
            <SingleDateField value={end} onChange={setEnd} minDate={start} size="md" />
          </Field>
        )}
        {unit === 'half_day' && (
          <Field>
            <FieldLabel>{t('leave.halfDay')}</FieldLabel>
            <PlanQSelect size="md" options={halfOpts}
              value={halfOpts.find((o) => o.value === halfKind) || null}
              onChange={(o) => setHalfKind(((o as { value: string })?.value as 'am' | 'pm') || 'am')} />
          </Field>
        )}
        {unit === 'hours' && (
          <Field>
            <FieldLabel>{t('leave.hoursCount')}</FieldLabel>
            <NumInput type="number" step="0.5" min="0.5" value={hours} onChange={(e) => setHours(e.target.value)} />
          </Field>
        )}
        <Field>
          <FieldLabel>{t('leave.reason')}</FieldLabel>
          <TextArea value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder={t('leave.reasonPlaceholder') as string} rows={3} />
        </Field>
        {err && <ErrorBar role="alert">{t(`error.${err}`, { defaultValue: t('error.generic') as string }) as string}</ErrorBar>}
      </DetailDrawer.Body>
      <DetailDrawer.Footer>
        <ActionButton tone="secondary" size="md" onClick={onClose}>{t('leave.cancel')}</ActionButton>
        <ActionButton tone="primary" size="md" loading={saving} onClick={submit} data-testid="leave-submit">
          {t('leave.submit')}
        </ActionButton>
      </DetailDrawer.Footer>
    </DetailDrawer>
  );
};

