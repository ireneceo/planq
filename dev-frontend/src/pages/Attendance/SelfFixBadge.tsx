// «본인 수정» 표시 — 원래 값 → 고친 값 · 사유 · 확인/승인 상태 (docs/ATTENDANCE_CHECKIN_PROMPT_DESIGN.md §5)
//   내 기록(AttendancePage)과 팀 표(TeamTab)가 같은 한 벌을 쓴다. 눌러야 자세히 보인다(폰에서는 title 이 안 뜬다).
//   모르는 상태값은 숨기지 않고 값 그대로 보인다(.claude/rules/status-values.md).
import React, { useState } from 'react';
import styled, { css } from 'styled-components';
import { useTranslation } from 'react-i18next';
import type { SelfFix } from '../../hooks/useAttendance';

function hhmm(iso: string | null | undefined): string {
  if (!iso) return '–';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '–' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function md(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${d.getMonth() + 1}/${d.getDate()}`;
}

/** 무엇이 바뀌었나 — 출근·퇴근 중 달라진 것만 «원래 → 고친 값» */
export function fixChanges(fix: SelfFix): { kind: 'in' | 'out'; from: string; to: string }[] {
  const out: { kind: 'in' | 'out'; from: string; to: string }[] = [];
  const evs = fix.events || [];
  const firstIn = evs.find((e) => e.kind === 'clock_in')?.at || null;
  const lastOut = [...evs].reverse().find((e) => e.kind === 'clock_out')?.at || null;
  const b = fix.before || { clock_in_at: null, clock_out_at: null, work_total_sec: 0 };
  if (firstIn && hhmm(firstIn) !== hhmm(b.clock_in_at)) out.push({ kind: 'in', from: hhmm(b.clock_in_at), to: hhmm(firstIn) });
  if (lastOut && hhmm(lastOut) !== hhmm(b.clock_out_at)) out.push({ kind: 'out', from: hhmm(b.clock_out_at), to: hhmm(lastOut) });
  return out;
}

const TONE: Record<string, 'info' | 'warn' | 'ok' | 'bad'> = {
  applied: 'info', confirmed: 'ok', approved: 'ok', pending: 'warn', rejected: 'bad',
};

interface Props {
  fix: SelfFix;
  /** 본인 화면이면 승인 대기를 거둘 수 있다 */
  onWithdraw?: (requestId: number) => void;
}

const SelfFixBadge: React.FC<Props> = ({ fix, onWithdraw }) => {
  const { t } = useTranslation('attendance');
  const [open, setOpen] = useState(false);
  const tone = TONE[fix.status] || 'info';
  const label = fix.status === 'pending' ? t('fix.pendingShort')
    : fix.status === 'rejected' ? t('fix.rejectedShort')
    : t('fix.selfFixed');
  const changes = fixChanges(fix);
  return (
    <Wrap>
      <Chip type="button" $tone={tone} onClick={() => setOpen((v) => !v)} aria-expanded={open} data-testid="attn-selffix-badge">
        {label}
      </Chip>
      {open && (
        <Detail role="note" data-testid="attn-selffix-detail">
          {changes.map((c) => (
            <div key={c.kind}>{t(c.kind === 'in' ? 'fix.changeIn' : 'fix.changeOut', { from: c.from, to: c.to })}</div>
          ))}
          {fix.reason && <Muted>{t('fix.reasonLine', { reason: fix.reason })}</Muted>}
          <Muted>
            {t(`fix.status.${fix.status}`, { defaultValue: fix.status })}
            {fix.decided_by_name && ` · ${fix.decided_by_name} ${md(fix.decided_at)}`}
          </Muted>
          {fix.decide_note && <Muted>{t('fix.decideNote', { note: fix.decide_note })}</Muted>}
          {fix.status === 'pending' && onWithdraw && (
            <WithdrawBtn type="button" onClick={() => onWithdraw(fix.request_id)} data-testid="attn-selffix-withdraw">
              {t('fix.withdraw')}
            </WithdrawBtn>
          )}
        </Detail>
      )}
    </Wrap>
  );
};

export default SelfFixBadge;

const Wrap = styled.span`display: inline-flex; flex-direction: column; align-items: flex-start; gap: 4px; vertical-align: top;`;
const toneCss = {
  info: css`background: #EFF6FF; color: #1D4ED8; border-color: #BFDBFE;`,
  ok: css`background: #F0FDFA; color: #0F766E; border-color: #99F6E4;`,
  warn: css`background: #FFFBEB; color: #B45309; border-color: #FDE68A;`,
  bad: css`background: #FEF2F2; color: #B91C1C; border-color: #FECACA;`,
};
const Chip = styled.button<{ $tone: keyof typeof toneCss }>`
  display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 6px;
  font-size: 0.6875rem; font-weight: 600; border: 1px solid; cursor: pointer; white-space: nowrap;
  ${p => toneCss[p.$tone]}
`;
const Detail = styled.div`
  font-size: 0.75rem; color: #0F172A; line-height: 1.5;
  background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 8px 10px; min-width: 160px;
`;
const Muted = styled.div`color: #64748B;`;
const WithdrawBtn = styled.button`
  margin-top: 6px; background: none; border: none; padding: 0; cursor: pointer;
  font-size: 0.75rem; color: #475569; text-decoration: underline;
`;
