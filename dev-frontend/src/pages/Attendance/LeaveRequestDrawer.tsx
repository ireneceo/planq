// 근태 — 휴가 신청 드로어 (#208). AttendancePage 에서 분리.
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ActionButton from '../../components/Common/ActionButton';
import PlanQSelect from '../../components/Common/PlanQSelect';
import SingleDateField from '../../components/Common/SingleDateField';
import DetailDrawer from '../../components/Common/DetailDrawer';
import { apiFetch } from '../../contexts/AuthContext';
import styled from 'styled-components';
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
  // ★ 2026-09-09 (Irene: "휴가를 줘야 유급/무급 계산이 되지 신청하면서.")
  //   여태 이 화면은 잔여를 **한 글자도** 보여주지 않았다. 유급/무급은 사람이 고르고,
  //   서버는 그 값을 그대로 받아 저장한 뒤 **승인 단계에서야** 잔여를 검사했다
  //   (insufficient_leave_balance). 즉 잔여가 0이어도 유급으로 신청이 되고,
  //   그 사실을 **승인 버튼을 누른 관리자**가 처음 알게 된다.
  //   → 신청하는 자리에서 잔여를 보여주고, 모자라면 여기서 말한다.
  //   ※ 최종 판정은 그대로 서버가 한다(여기서 막는 것은 안내일 뿐 — 화면만 믿으면 안 된다).
  const [balance, setBalance] = useState<{ granted: number; used: number; pending: number; remaining: number; remaining_after_pending: number; daily_work_hours: number } | null>(null);
  useEffect(() => {
    if (!open || !bizId) return;
    let alive = true;
    const year = Number(start.slice(0, 4)) || new Date().getFullYear();
    apiFetch(`/api/leave/balance?business_id=${bizId}&year=${year}`)
      .then((r) => r.json())
      .then((j) => { if (alive && j?.success) setBalance(j.data); })
      .catch(() => { /* 잔여를 못 불러도 신청 자체는 막지 않는다 */ });
    return () => { alive = false; };
  }, [open, bizId, start]);

  // 이번 신청이 며칠인가 — 서버 `computeDaysCharged` 와 **같은 규칙**이어야 한다.
  //   ★ 시간 단위는 8 로 나누는 것이 아니라 **그 사람의 하루 근무시간**으로 나눈다.
  //     처음에 8 로 적었다가 서버를 읽고 고쳤다 — 하루 6시간 근무자에게 거짓 안내가 나갔을 것이다.
  //     그래서 그 값을 화면이 정하지 않고 `/api/leave/balance` 가 내려준 것을 쓴다
  //     (memory feedback_same_value_multiple_formulas).
  //   ★ 이 숫자는 **안내**다. 최종 판정은 승인 시점에 서버가 한다.
  const requestedDays = useMemo(() => {
    if (unit === 'half_day') return 0.5;
    if (unit === 'hours') {
      const daily = balance?.daily_work_hours || 8;
      return Math.round((Number(hours) / daily) * 10) / 10;
    }
    const a = new Date(start), b = new Date(end);
    if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
    return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86400000) + 1);
  }, [unit, hours, start, end, balance]);

  // 서버는 승인 시 `remaining`(= 부여 − 승인분)으로 검사한다. 화면도 **같은 값**으로 판정한다.
  //   신청 중(pending)까지 뺀 값은 따로 보여주기만 한다 — 판정을 둘로 하면 어긋난다.
  const shortBy = leaveType === 'paid' && balance
    ? Math.round((requestedDays - balance.remaining) * 10) / 10
    : 0;
  const insufficient = shortBy > 0;

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
        {/* ★ 잔여를 **고르기 전에** 보여준다. 여태 이 화면에는 잔여가 한 글자도 없어서
            잔여 0 으로 유급 신청을 하고, 그 사실을 승인 누른 관리자가 처음 알았다. */}
        {balance && (
          <BalanceBox $warn={insufficient}>
            <BalanceRow>
              <span>{t('leave.balance.remaining', { defaultValue: '남은 유급 휴가' }) as string}</span>
              <strong>{t('leave.balance.days', { count: balance.remaining, defaultValue: '{{count}}일' }) as string}</strong>
            </BalanceRow>
            <BalanceSub>
              {t('leave.balance.detail', {
                granted: balance.granted, used: balance.used, pending: balance.pending,
                defaultValue: '부여 {{granted}}일 · 사용 {{used}}일 · 신청 중 {{pending}}일',
              }) as string}
            </BalanceSub>
            {requestedDays > 0 && (
              <BalanceSub>
                {t('leave.balance.thisRequest', {
                  days: requestedDays,
                  defaultValue: '이번 신청은 {{days}}일로 계산됩니다',
                }) as string}
              </BalanceSub>
            )}
            {insufficient && (
              <BalanceWarn>
                {t('leave.balance.short', {
                  days: shortBy,
                  defaultValue: '{{days}}일이 모자랍니다. 무급으로 신청하거나 관리자에게 휴가 부여를 요청하세요.',
                }) as string}
              </BalanceWarn>
            )}
          </BalanceBox>
        )}
        {balance && balance.granted === 0 && (
          <BalanceBox>
            <BalanceSub>
              {t('leave.balance.none', {
                defaultValue: '올해 부여받은 유급 휴가가 없습니다. 관리자가 설정 > 근태에서 부여할 수 있어요.',
              }) as string}
            </BalanceSub>
          </BalanceBox>
        )}
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

// ─── 잔여 안내 ──────────────────────────────────────────────────
//   상태 표시지 액션 버튼이 아니다 — UI_DESIGN_GUIDE §1.7 의 3톤 규칙은 버튼에만 적용된다.
const BalanceBox = styled.div<{ $warn?: boolean }>`
  margin-bottom: 14px;
  padding: 10px 12px;
  border-radius: 8px;
  background: ${(p) => (p.$warn ? '#FFFBEB' : '#F8FAFC')};
  border: 1px solid ${(p) => (p.$warn ? '#FDE68A' : '#E2E8F0')};
`;
const BalanceRow = styled.div`
  display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
  font-size: 0.8125rem; color: #475569;
  strong { font-size: 0.9375rem; font-weight: 700; color: #0F172A; }
`;
const BalanceSub = styled.div`
  margin-top: 4px; font-size: 0.6875rem; color: #94A3B8; line-height: 1.5;
`;
const BalanceWarn = styled.div`
  margin-top: 6px; font-size: 0.75rem; color: #B45309; font-weight: 600; line-height: 1.5;
`;
