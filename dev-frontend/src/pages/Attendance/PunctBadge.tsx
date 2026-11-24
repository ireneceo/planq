// 고정 근무 지각·조퇴·미출근 뱃지 + 사유 쓰기/인정 창 (docs/ATTENDANCE_FIXED_SCHEDULE_DESIGN.md §5)
//   본인 화면(AttendancePage)·관리자 화면(TeamTab)·정정 목록이 같이 쓴다 — 문구·색이 화면마다 갈라지지 않게 한 벌.
//   정상이면 아무것도 그리지 않는다(칭찬 뱃지 없음). 모르는 상태값은 값 그대로 보인다(status-values 규약).
import React, { useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import StandardModal from '../../components/Common/StandardModal';
import ActionButton from '../../components/Common/ActionButton';
import { apiFetch } from '../../contexts/AuthContext';
import type { Punct } from '../../hooks/useAttendance';

const KNOWN_IN = ['on_time', 'late', 'not_yet', 'missing', 'no_show'];
const KNOWN_OUT = ['ok', 'early', 'open', 'unverified'];

/** 판정 한 줄 글 — «지각 12분 · 조퇴 30분» / 정상이면 «정상». 정정 목록 «전 → 후» 가 쓴다. */
export function punctText(p: Pick<Punct, 'in_status' | 'out_status' | 'late_min' | 'early_min'> | null | undefined, t: (k: string, o?: Record<string, unknown>) => string): string {
  if (!p) return '';
  const parts: string[] = [];
  if (p.in_status === 'late') parts.push(t('punct.late', { min: p.late_min }));
  else if (p.in_status === 'no_show') parts.push(t('punct.noShow'));
  else if (p.in_status === 'missing') parts.push(t('punct.missing'));
  else if (p.in_status && !KNOWN_IN.includes(p.in_status)) parts.push(p.in_status);
  if (p.out_status === 'early') parts.push(t('punct.early', { min: p.early_min }));
  else if (p.out_status === 'unverified') parts.push(t('punct.unverified'));
  else if (p.out_status && !KNOWN_OUT.includes(p.out_status)) parts.push(p.out_status);
  return parts.length ? parts.join(' · ') : t('punct.onTime');
}

export const PunctBadges: React.FC<{ punct?: Punct | null }> = ({ punct }) => {
  const { t } = useTranslation('attendance');
  if (!punct || !punct.applicable) return null;
  const p = punct;
  const out: React.ReactNode[] = [];
  const tone = p.excused ? 'muted' : 'bad';
  if (p.in_status === 'late') out.push(<Pill key="l" $tone={tone} data-testid="punct-late">{t('punct.late', { min: p.late_min })}</Pill>);
  else if (p.in_status === 'no_show') out.push(<Pill key="n" $tone={tone} data-testid="punct-noshow">{t('punct.noShow')}</Pill>);
  else if (p.in_status === 'missing') out.push(<Pill key="m" $tone="warn" data-testid="punct-missing">{t('punct.missing')}</Pill>);
  else if (p.in_status && !KNOWN_IN.includes(p.in_status)) out.push(<Pill key="u" $tone="warn">{p.in_status}</Pill>);
  if (p.out_status === 'early') out.push(<Pill key="e" $tone={tone} data-testid="punct-early">{t('punct.early', { min: p.early_min })}</Pill>);
  // unverified(자동 마감 미확인)는 뱃지를 따로 그리지 않는다 — 같은 행에 «자동 마감됨» 이 이미 있다(같은 말 두 번)
  else if (p.out_status && !KNOWN_OUT.includes(p.out_status)) out.push(<Pill key="uo" $tone="warn">{p.out_status}</Pill>);
  if (!out.length) return null;
  if (p.excused) out.push(<Pill key="x" $tone="ok" data-testid="punct-excused">{t('punct.excused')}</Pill>);
  if (p.flags?.midnight_tail) out.push(<Pill key="mt" $tone="warn">{t('punct.midnightTail')}</Pill>);
  return (
    <>
      {out}
      {p.reason && <ReasonText title={p.reason}>«{p.reason}»</ReasonText>}
    </>
  );
};

/** 사유·인정 버튼을 보일 날 — 지각·조퇴·미출근만(퇴근 미확인은 본인이 «맞아요»/고치기로 푼다). */
export function punctExcusable(p?: Punct | null): boolean {
  if (!p || !p.applicable) return false;
  return p.in_status === 'late' || p.in_status === 'missing' || p.in_status === 'no_show' || p.out_status === 'early';
}

/**
 * 사유 쓰기(본인) · 인정(관리자) 창 하나. mode 로 가른다.
 *   reason: POST /exceptions/reason {work_date, reason} · excuse: POST /exceptions/excuse {user_id, work_date, excused, note}
 */
export const PunctExceptionModal: React.FC<{
  open: boolean; onClose: () => void; onDone: () => void;
  mode: 'reason' | 'excuse'; businessId: number; workDate: string; userId?: number;
  currentExcused?: boolean; who?: string; initial?: string | null; punct?: Punct | null;
}> = ({ open, onClose, onDone, mode, businessId, workDate, userId, currentExcused, who, initial, punct }) => {
  const { t } = useTranslation('attendance');
  const [text, setText] = useState(initial || '');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  React.useEffect(() => { if (open) { setText(initial || ''); setErr(null); } }, [open, initial]);
  const excusing = mode === 'excuse' && !currentExcused;
  const submit = async () => {
    if (submitting) return;
    if (mode === 'reason' && !text.trim()) return;
    setSubmitting(true); setErr(null);
    try {
      const body = mode === 'reason'
        ? { business_id: businessId, work_date: workDate, reason: text.trim() }
        : { business_id: businessId, user_id: userId, work_date: workDate, excused: excusing, note: text.trim() || null };
      const r = await apiFetch(`/api/attendance/exceptions/${mode}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.success) { setErr(j?.message || 'generic'); return; }
      onDone(); onClose();
    } finally { setSubmitting(false); }
  };
  const title = mode === 'reason' ? t('punct.reason.title') : (excusing ? t('punct.excuseTitle') : t('punct.unexcuseTitle'));
  return (
    <StandardModal open={open} onClose={onClose} title={title} size="sm"
      footer={(
        <>
          <ActionButton tone="secondary" onClick={onClose}>{t('common:cancel', { defaultValue: '취소' })}</ActionButton>
          <ActionButton tone="primary" loading={submitting} disabled={mode === 'reason' && !text.trim()} onClick={submit}
            data-testid={`punct-${mode}-submit`}>
            {mode === 'reason' ? t('punct.reason.save') : (excusing ? t('punct.excuse') : t('punct.unexcuse'))}
          </ActionButton>
        </>
      )}>
      <Body>
        <Meta>{who ? `${who} · ` : ''}{workDate}{punct ? ` · ${punctText(punct, t)}` : ''}</Meta>
        {/* draft-exempt: 지각 사유·인정 메모 한 줄(300자) — 창 안에서 쓰고 바로 남긴다. 닫으면 사유를 안 남긴 것 */}
        <Area value={text} maxLength={300} rows={3} data-testid={`punct-${mode}-input`}
          placeholder={mode === 'reason' ? t('punct.reason.placeholder') : t('punct.excuseNotePlaceholder')}
          onChange={(e) => setText(e.target.value)} />
        {err && <Err role="alert">{t(`punct.error.${err}`, { defaultValue: t('error.generic') })}</Err>}
      </Body>
    </StandardModal>
  );
};

const Pill = styled.span<{ $tone: 'bad' | 'warn' | 'ok' | 'muted' }>`
  display: inline-block; padding: 2px 7px; border-radius: 999px; margin-right: 4px;
  font-size: 0.6875rem; font-weight: 600; white-space: nowrap;
  background: ${(p) => ({ bad: '#FFE4E6', warn: '#FEF3C7', ok: '#DCFCE7', muted: '#F1F5F9' }[p.$tone])};
  color: ${(p) => ({ bad: '#9F1239', warn: '#92400E', ok: '#166534', muted: '#64748B' }[p.$tone])};
  ${(p) => (p.$tone === 'muted' ? 'text-decoration: line-through;' : '')}
`;
const ReasonText = styled.span`
  display: inline-block; max-width: 160px; overflow: hidden; text-overflow: ellipsis; vertical-align: bottom;
  font-size: 0.6875rem; color: #64748B; margin-right: 4px; white-space: nowrap;
`;
const Body = styled.div`display: flex; flex-direction: column; gap: 10px;`;
const Meta = styled.div`font-size: 0.8125rem; color: #475569;`;
const Area = styled.textarea`
  width: 100%; padding: 10px 12px; border: 1px solid #CBD5E1; border-radius: 8px; resize: vertical;
  font-size: 0.875rem; color: #0F172A; font-family: inherit;
  &:focus { outline: none; border-color: #F43F5E; box-shadow: 0 0 0 3px rgba(244,63,94,0.12); }
`;
const Err = styled.div`font-size: 0.75rem; color: #BE123C;`;
