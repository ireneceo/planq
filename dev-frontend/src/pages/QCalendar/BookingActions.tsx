// 상담 예약(고객 창구 P2) — 일정 상세 안의 **처리 줄**. docs/CLIENT_ENTRY_DESIGN.md §4.5·§4.6
//
// ★ 확인필요 «상담 신청» 항목이 이 일정을 연다 — [승인] [다른 시간 제안] [거절] 이 **여기서 끝난다.**
// ★ 모든 동작은 고객에게 메일이 나간다 → 누르는 즉시 보내지 않고 ConfirmDialog 로 묻고,
//   **받는 주소를 문구에 적는다**(CLAUDE.md «외부 발송은 확인을 받는다»). 주소는 서버가 실제로 보낼
//   곳과 같은 함수(booking.recipientLinkOf)로 알려 준다 — 확인창 주소와 실제 주소가 다르면 확인이 거짓이다.
//   주소가 없으면(고객이 확인 링크를 지웠다) 동작은 되지만 문구가 «메일은 가지 않는다» 고 말한다.
// ★ 상태 전이 판정은 서버 한 곳(services/booking.js)이다. 여기서는 상태가 허락하는 버튼만 보인다.
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import { apiFetch } from '../../contexts/AuthContext';
import ConfirmDialog from '../../components/Common/ConfirmDialog';
import PlanQSelect from '../../components/Common/PlanQSelect';
import { Switch, SwitchKnob } from '../../components/Common/switchShell';
import type { CalendarEvent } from './types';

export type BookingStatus = 'requested' | 'proposed' | 'confirmed' | 'declined' | 'canceled';
type Action = 'approve' | 'propose' | 'decline' | 'cancel';

type Props = {
  event: CalendarEvent & { booking_status?: BookingStatus | null };
  businessId: number;
  /** 서버가 돌려준 새 값으로 화면을 맞춘다(상태·시간·회의 주소). */
  onChanged: (patch: Partial<CalendarEvent> & { booking_status?: BookingStatus }) => void;
};

const TIME_OPTIONS = (() => {
  const arr: Array<{ value: string; label: string }> = [];
  for (let h = 6; h < 23; h += 1) for (const m of [0, 30]) {
    const v = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    arr.push({ value: v, label: v });
  }
  return arr;
})();

const pad = (n: number) => String(n).padStart(2, '0');
const localDateKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export default function BookingActions({ event, businessId, onChanged }: Props) {
  const { t, i18n } = useTranslation('qcalendar');
  const status = event.booking_status as BookingStatus;
  const ended = new Date(event.end_at).getTime() <= Date.now();
  const [ask, setAsk] = useState<Action | null>(null);
  const [recipient, setRecipient] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [warn, setWarn] = useState<string | null>(null);
  const [meet, setMeet] = useState(false);
  const [proposing, setProposing] = useState(false);
  const [pDay, setPDay] = useState<string>('');
  const [pTime, setPTime] = useState<string>('10:00');

  useEffect(() => { setProposing(false); setErr(null); setWarn(null); setAsk(null); }, [event.id]);

  // 받는 주소 — 확인창을 열 때 한 번 묻는다
  useEffect(() => {
    if (!ask) return;
    let alive = true;
    setRecipient(undefined);
    (async () => {
      try {
        const r = await apiFetch(`/api/calendar/booking/${businessId}/${event.id}/recipient`);
        const j = await r.json().catch(() => null);
        if (alive) setRecipient(r.ok && j?.success ? (j.data.email || null) : null);
      } catch { if (alive) setRecipient(null); }
    })();
    return () => { alive = false; };
  }, [ask, businessId, event.id]);

  const dayOptions = useMemo(() => {
    const lc = i18n.language === 'en' ? 'en-US' : 'ko-KR';
    const out: Array<{ value: string; label: string }> = [];
    const base = new Date();
    for (let i = 0; i < 30; i += 1) {
      const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i);
      out.push({ value: localDateKey(d), label: new Intl.DateTimeFormat(lc, { month: 'short', day: 'numeric', weekday: 'short' }).format(d) });
    }
    return out;
  }, [i18n.language]);
  useEffect(() => { if (!pDay && dayOptions.length) setPDay(dayOptions[1]?.value || dayOptions[0].value); }, [dayOptions, pDay]);

  const proposedIso = useMemo(() => {
    if (!pDay || !pTime) return null;
    const [y, m, d] = pDay.split('-').map(Number);
    const [hh, mm] = pTime.split(':').map(Number);
    const dt = new Date(y, m - 1, d, hh, mm, 0, 0);   // 보는 사람(멤버) 브라우저 시간대
    return dt.getTime() > Date.now() ? dt.toISOString() : null;
  }, [pDay, pTime]);

  const run = async (action: Action) => {
    if (busy) return;
    setBusy(true); setErr(null); setWarn(null);
    try {
      const body = action === 'approve' ? { create_meeting: meet }
        : action === 'propose' ? { start: proposedIso } : {};
      const r = await apiFetch(`/api/calendar/booking/${businessId}/${event.id}/${action}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.success) { setErr(j?.message || 'error'); return; }
      const d = j.data;
      onChanged({ booking_status: d.booking_status, start_at: d.start_at, end_at: d.end_at, meeting_url: d.meeting_url });
      if (d.meet_warning) setWarn(d.meet_warning);
      setProposing(false);
      // 확인필요 목록·배지가 곧바로 줄게 — 같은 탭 안전망(CLAUDE.md §16-e)
      window.dispatchEvent(new CustomEvent('inbox:refresh'));
    } catch { setErr('error'); } finally { setBusy(false); }
  };

  if (!status) return null;
  const canApprove = status === 'requested' && !ended;
  const canPropose = (status === 'requested' || status === 'proposed') && !ended;
  const canDecline = status === 'requested' || status === 'proposed';
  const canCancel = status === 'confirmed' && !ended;
  const shownStatus = status === 'confirmed' && ended ? 'done' : status;

  const msg = (action: Action) => {
    const to = recipient === undefined
      ? t('booking.recipientLoading', { defaultValue: '받는 주소를 확인하는 중…' })
      : recipient
        ? t('booking.recipientTo', { email: recipient, defaultValue: '{{email}} 로 안내 메일이 갑니다.' })
        : t('booking.recipientNone', { defaultValue: '고객의 확인된 이메일이 없어 메일은 가지 않습니다.' });
    return `${t(`booking.ask.${action}`)}\n${to}`;
  };

  return (
    <Bar data-testid="event-booking-bar" data-status={shownStatus}>
      <Top>
        <Chip $s={shownStatus}>{t(`booking.status.${shownStatus}`)}</Chip>
        <Lead>{t(`booking.lead.${shownStatus}`)}</Lead>
      </Top>
      {canApprove && (
        <MeetRow>
          {/* 표준 스위치 — 네이티브 체크박스는 규격(36/40) 밖이다. 저장하는 값이 아니라 [승인] 에 실을 선택이다. */}
          <Switch type="button" role="switch" aria-checked={meet} aria-labelledby={`bk-meet-${event.id}`}
            data-testid="event-booking-meet" $on={meet} onClick={() => setMeet((v) => !v)}>
            <SwitchKnob $on={meet} />
          </Switch>
          <span id={`bk-meet-${event.id}`}>{t('booking.withMeet', { defaultValue: '승인할 때 Google Meet 링크 만들기 (내 구글 캘린더 연동 필요)' })}</span>
        </MeetRow>
      )}
      {proposing && (
        <ProposeRow>
          <SelWrap><PlanQSelect size="sm" options={dayOptions} value={dayOptions.find((o) => o.value === pDay) || null}
            onChange={(o) => o && setPDay((o as { value: string }).value)} /></SelWrap>
          <SelWrap $narrow><PlanQSelect size="sm" options={TIME_OPTIONS} value={{ value: pTime, label: pTime }}
            onChange={(o) => o && setPTime((o as { value: string }).value)} /></SelWrap>
          <Btn type="button" $primary disabled={!proposedIso || busy} data-testid="event-booking-propose-send" onClick={() => setAsk('propose')}>
            {t('booking.sendPropose', { defaultValue: '제안 보내기' })}
          </Btn>
          <Btn type="button" onClick={() => setProposing(false)}>{t('booking.close', { defaultValue: '닫기' })}</Btn>
        </ProposeRow>
      )}
      {(canApprove || canPropose || canDecline || canCancel) && !proposing && (
        <Acts>
          {canApprove && <Btn type="button" $primary disabled={busy} data-testid="event-booking-approve" onClick={() => setAsk('approve')}>{t('booking.approve', { defaultValue: '승인' })}</Btn>}
          {canPropose && <Btn type="button" disabled={busy} data-testid="event-booking-propose" onClick={() => setProposing(true)}>{t('booking.propose', { defaultValue: '다른 시간 제안' })}</Btn>}
          {canDecline && <Btn type="button" $danger disabled={busy} data-testid="event-booking-decline" onClick={() => setAsk('decline')}>{t('booking.decline', { defaultValue: '거절' })}</Btn>}
          {canCancel && <Btn type="button" $danger disabled={busy} data-testid="event-booking-cancel" onClick={() => setAsk('cancel')}>{t('booking.cancel', { defaultValue: '상담 취소' })}</Btn>}
        </Acts>
      )}
      {warn && <Hint>{t(`booking.meetWarn.${warn}`, { defaultValue: t('booking.meetWarn.default', { defaultValue: '확정했지만 Meet 링크는 만들지 못했어요.' }) as string })}</Hint>}
      {err && <Err data-testid="event-booking-error">{t(`booking.err.${err}`, { defaultValue: t('booking.err.error', { defaultValue: '처리하지 못했어요. 잠시 뒤 다시 시도해 주세요.' }) as string })}</Err>}
      <ConfirmDialog
        isOpen={!!ask}
        onClose={() => setAsk(null)}
        onConfirm={() => { const a = ask; setAsk(null); if (a) void run(a); }}
        title={ask ? t(`booking.askTitle.${ask}`) as string : ''}
        message={ask ? msg(ask) : ''}
        confirmText={ask ? t(`booking.askOk.${ask}`) as string : ''}
        variant={ask === 'decline' || ask === 'cancel' ? 'danger' : 'info'}
      />
    </Bar>
  );
}

const TONE: Record<string, [string, string]> = {
  requested: ['#FEF3C7', '#92400E'], proposed: ['#FFE4E6', '#9F1239'], confirmed: ['#CCFBF1', '#0F766E'],
  declined: ['#F1F5F9', '#64748B'], canceled: ['#F1F5F9', '#64748B'], done: ['#F1F5F9', '#475569'],
};
const Bar = styled.div`
  display:flex;flex-direction:column;gap:8px;padding:12px 14px;margin-bottom:12px;
  background:#F8FAFC;border:1px dashed #CBD5E1;border-radius:10px;
`;
const Top = styled.div`display:flex;align-items:center;gap:8px;flex-wrap:wrap;`;
const Chip = styled.span<{ $s: string }>`
  flex-shrink:0;padding:2px 8px;border-radius:999px;font-size:0.6875rem;font-weight:700;
  background:${p => (TONE[p.$s] || TONE.done)[0]};color:${p => (TONE[p.$s] || TONE.done)[1]};
`;
const Lead = styled.span`font-size:0.8125rem;color:#475569;line-height:1.5;`;
const MeetRow = styled.div`display:flex;align-items:center;gap:8px;font-size:0.75rem;color:#475569;line-height:1.5;`;
const ProposeRow = styled.div`display:flex;flex-wrap:wrap;gap:6px;align-items:center;`;
const SelWrap = styled.div<{ $narrow?: boolean }>`flex:${p => (p.$narrow ? '0 0 110px' : '1 1 160px')};min-width:0;`;
const Acts = styled.div`display:flex;flex-wrap:wrap;gap:6px;`;
const Btn = styled.button<{ $primary?: boolean; $danger?: boolean }>`
  height:36px;padding:0 12px;border-radius:8px;cursor:pointer;white-space:nowrap;font-size:0.8125rem;font-weight:600;
  border:1px solid ${p => (p.$primary ? '#14B8A6' : p.$danger ? '#FECDD3' : '#CBD5E1')};
  background:${p => (p.$primary ? '#14B8A6' : '#fff')};
  color:${p => (p.$primary ? '#fff' : p.$danger ? '#B91C3C' : '#334155')};
  &:hover:not(:disabled){border-color:${p => (p.$danger ? '#F43F5E' : '#0D9488')};}
  &:disabled{opacity:.55;cursor:default;}
  &:focus-visible{outline:2px solid #14B8A6;outline-offset:2px;}
  @media (max-width:640px){ height:40px; }
`;
const Hint = styled.div`font-size:0.75rem;color:#92400E;line-height:1.5;`;
const Err = styled.div`padding:8px 10px;background:#FFF1F2;border:1px solid #FECDD3;border-radius:8px;font-size:0.75rem;color:#B91C3C;`;
