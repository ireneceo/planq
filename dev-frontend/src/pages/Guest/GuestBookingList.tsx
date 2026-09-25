// 고객 창구 «내 문의» 의 **상담·미팅** 묶음 (docs/CLIENT_ENTRY_DESIGN.md §4.4)
//
// ★ 위 = 상태가 있는 것(일정) · 아래 = 흐름(대화). 이 컴포넌트는 위 묶음만 그린다.
//   상태 라벨은 **고객 관점**이다 — 확인 대기 · 시간 변경 제안 · 확정 · 취소됨 · 성사 안 됨 · 끝남.
// ★ 동작은 상태가 허락하는 것만 보인다. 서버도 같은 규칙으로 막지만(services/booking.js),
//   눌리게 두고 409 로 거절하면 사용자에게는 «아무 일도 안 일어남» 이다.
// ★ 취소는 되돌릴 수 없으므로 ConfirmDialog 로 한 번 묻는다(window.confirm 금지).
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import { apiFetch } from '../../contexts/AuthContext';
import ConfirmDialog from '../../components/Common/ConfirmDialog';

export type GuestBooking = {
  id: number;
  title: string;
  start_at: string;
  end_at: string;
  status: 'requested' | 'proposed' | 'confirmed' | 'declined' | 'canceled' | 'done';
  meeting_url: string | null;
};

type Props = {
  token: string;
  /** 로그인 고객 홈(P3) — 계정 API 로 부른다. 없으면 게스트 링크 API. */
  apiBase?: string;
  /** 제안받은 건에서 [다른 시간] — 예약 탭을 재신청 모드로 연다. */
  onReschedule: (id: number) => void;
  /** 바깥에서 다시 읽게 할 때 바꾼다(재신청을 마치고 돌아온 경우). */
  reloadKey?: number;
};

const browserTz = (() => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
})();

export default function GuestBookingList({ token, apiBase, onReschedule, reloadKey = 0 }: Props) {
  const base = apiBase || `/api/guest/${token}`;
  const call = (u: string, init?: RequestInit) => (apiBase ? apiFetch(u, init) : fetch(u, init));
  const { t, i18n } = useTranslation('guest');
  const locale = i18n.language?.startsWith('en') ? 'en-US' : 'ko-KR';
  const [rows, setRows] = useState<GuestBooking[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [askCancel, setAskCancel] = useState<GuestBooking | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await call(`${base}/booking/mine`);
      const j = await r.json().catch(() => null);
      setRows(r.ok && j?.success && Array.isArray(j.data) ? j.data : []);
    } catch { setRows([]); }
  }, [base]);
  useEffect(() => { void load(); }, [load, reloadKey]);

  const act = async (b: GuestBooking, action: 'accept' | 'cancel') => {
    if (busy) return;
    setBusy(b.id); setErr(null);
    try {
      const r = await call(`${base}/booking/${b.id}/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.success) setErr(j?.message || 'error');
      await load();
    } catch { setErr('error'); } finally { setBusy(null); }
  };

  if (!rows || rows.length === 0) return null;   // 비어 있으면 묶음 자체를 그리지 않는다(대화 묶음만 보인다)

  const when = (b: GuestBooking) => {
    const d = new Intl.DateTimeFormat(locale, { timeZone: browserTz, month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(b.start_at));
    const mins = Math.round((new Date(b.end_at).getTime() - new Date(b.start_at).getTime()) / 60000);
    return `${d} · ${t('booking.minutes', { count: mins, defaultValue: '{{count}}분' })}`;
  };

  return (
    <Box data-testid="entry-mine-bookings">
      <Label>{t('booking.mineTitle', { defaultValue: '상담·미팅' })}</Label>
      {err && <Warn>{t(`booking.err.${err}`, { defaultValue: t('booking.err.error', { defaultValue: '처리하지 못했어요. 잠시 뒤 다시 시도해 주세요.' }) as string })}</Warn>}
      {rows.map((b) => (
        <Item key={b.id} data-testid={`entry-booking-${b.id}`} data-status={b.status}>
          <Top>
            <Status $s={b.status}>{t(`booking.status.${b.status}`)}</Status>
            <Name>{b.title}</Name>
          </Top>
          <When>{when(b)}</When>
          {b.status === 'proposed' && <Sub>{t('booking.proposedHint', { defaultValue: '담당자가 이 시간을 제안했어요.' })}</Sub>}
          {(b.status === 'requested' || b.status === 'proposed' || b.status === 'confirmed') && (
            <Acts>
              {b.status === 'confirmed' && b.meeting_url && (
                <A href={b.meeting_url} target="_blank" rel="noopener noreferrer">{t('booking.openMeeting', { defaultValue: '화상 회의 열기' })}</A>
              )}
              {b.status === 'proposed' && (
                <>
                  <Primary type="button" disabled={busy === b.id} data-testid={`entry-booking-accept-${b.id}`} onClick={() => act(b, 'accept')}>
                    {t('booking.accept', { defaultValue: '수락' })}
                  </Primary>
                  <Ghost type="button" onClick={() => onReschedule(b.id)}>{t('booking.otherTime', { defaultValue: '다른 시간' })}</Ghost>
                </>
              )}
              <Ghost type="button" $danger disabled={busy === b.id} data-testid={`entry-booking-cancel-${b.id}`} onClick={() => setAskCancel(b)}>
                {t('booking.cancel', { defaultValue: '취소' })}
              </Ghost>
            </Acts>
          )}
        </Item>
      ))}
      <ConfirmDialog
        isOpen={!!askCancel}
        onClose={() => setAskCancel(null)}
        onConfirm={() => { const b = askCancel; setAskCancel(null); if (b) void act(b, 'cancel'); }}
        title={t('booking.cancelTitle', { defaultValue: '상담을 취소할까요?' }) as string}
        message={askCancel ? `${askCancel.title}\n${when(askCancel)}` : ''}
        confirmText={t('booking.cancelOk', { defaultValue: '취소하기' }) as string}
        cancelText={t('booking.keep', { defaultValue: '그대로 두기' }) as string}
        variant="danger"
      />
    </Box>
  );
}

const TONE: Record<GuestBooking['status'], [string, string]> = {
  requested: ['#FEF3C7', '#92400E'],
  proposed: ['#FFE4E6', '#9F1239'],
  confirmed: ['#CCFBF1', '#0F766E'],
  declined: ['#F1F5F9', '#64748B'],
  canceled: ['#F1F5F9', '#64748B'],
  done: ['#F1F5F9', '#475569'],
};
const Box = styled.div`display:flex;flex-direction:column;gap:8px;`;
const Label = styled.div`font-size:0.6875rem;font-weight:600;color:#94a3b8;letter-spacing:-0.1px;`;
const Warn = styled.div`padding:9px 12px;background:#FFF1F2;border:1px solid #FECDD3;border-radius:8px;font-size:0.75rem;color:#B91C3C;`;
const Item = styled.div`padding:12px 14px;background:#fff;border:1px solid #E2E8F0;border-radius:12px;display:flex;flex-direction:column;gap:6px;`;
const Top = styled.div`display:flex;align-items:center;gap:8px;min-width:0;`;
const Status = styled.span<{ $s: GuestBooking['status'] }>`
  flex-shrink:0;padding:2px 8px;border-radius:999px;font-size:0.6875rem;font-weight:700;
  background:${p => TONE[p.$s][0]};color:${p => TONE[p.$s][1]};
`;
const Name = styled.span`min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:0.875rem;font-weight:600;color:#0F172A;`;
const When = styled.div`font-size:0.8125rem;color:#475569;font-variant-numeric:tabular-nums;`;
const Sub = styled.div`font-size:0.75rem;color:#9F1239;`;
const Acts = styled.div`display:flex;flex-wrap:wrap;gap:6px;align-items:center;`;
const A = styled.a`font-size:0.8125rem;font-weight:600;color:#0D9488;text-decoration:none;margin-right:auto;&:hover{text-decoration:underline;}`;
const Primary = styled.button`
  min-height:36px;padding:0 14px;border-radius:8px;cursor:pointer;border:none;
  background:#14B8A6;color:#fff;font-size:0.8125rem;font-weight:700;
  &:hover:not(:disabled){background:#0D9488;}
  &:disabled{opacity:.5;cursor:default;}
  @media (max-width:640px){ min-height:40px; }
`;
const Ghost = styled.button<{ $danger?: boolean }>`
  min-height:36px;padding:0 12px;border-radius:8px;cursor:pointer;background:#fff;
  border:1px solid ${p => (p.$danger ? '#FECDD3' : '#CBD5E1')};color:${p => (p.$danger ? '#B91C3C' : '#334155')};
  font-size:0.8125rem;font-weight:600;
  &:hover:not(:disabled){border-color:${p => (p.$danger ? '#F43F5E' : '#14B8A6')};}
  &:disabled{opacity:.5;cursor:default;}
  @media (max-width:640px){ min-height:40px; }
`;
