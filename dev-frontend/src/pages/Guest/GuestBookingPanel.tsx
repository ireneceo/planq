// 고객 창구 «상담 예약» 탭 — 용건 → 시간 → 확인 3단 (docs/CLIENT_ENTRY_DESIGN.md §4.3)
//
// ★ 슬롯은 **서버가 계산한다**(`/booking/slots`). 화면은 받은 시작 시각을 **방문자 브라우저 시간대**로
//   보여 주기만 한다. 워크스페이스 시간대가 다르면 확인 단계에서 둘 다 적는다 — 해외 고객에게
//   «몇 시인지» 가 틀리면 예약이 아니라 사고다(§4.3).
// ★ [신청 보내기] 는 **이메일을 확인한 뒤에만** 누를 수 있다. 확인 전에는 이유를 말하고 버튼을 두지 않는다
//   (눌리게 두고 서버가 403 을 주면 사용자에게는 «아무 일도 안 일어남» 이다).
// ★ 같은 컴포넌트가 «다른 시간 고르기»(제안받은 건의 재신청)도 한다 — `reschedule` 이 있으면 2단부터.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import { GuestTabPane, Empty, RetryInline } from './guestShell';

const PURPOSES = ['new_project', 'quote', 'ongoing', 'other'] as const;
type Purpose = typeof PURPOSES[number];

type Props = {
  token: string;
  /** 이메일을 확인했는가 — 확인 전에는 슬롯도 못 본다(서버도 403). */
  verified: boolean;
  /** 다른 시간을 고르는 중이면 그 예약 id. */
  reschedule?: { id: number } | null;
  /** 신청·재신청을 마치면 «내 문의» 로. */
  onDone: () => void;
  onCancelReschedule?: () => void;
};

const browserTz = (() => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
})();

export default function GuestBookingPanel({ token, verified, reschedule, onDone, onCancelReschedule }: Props) {
  const { t, i18n } = useTranslation('guest');
  const locale = i18n.language?.startsWith('en') ? 'en-US' : 'ko-KR';
  const [step, setStep] = useState<1 | 2 | 3>(reschedule ? 2 : 1);
  const [purpose, setPurpose] = useState<Purpose | null>(null);
  const [memo, setMemo] = useState('');
  const [slots, setSlots] = useState<string[] | null>(null);
  const [meta, setMeta] = useState<{ duration: number; tz: string; enabled: boolean } | null>(null);
  const [loadErr, setLoadErr] = useState(false);
  const [day, setDay] = useState<string | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  useEffect(() => { setStep(reschedule ? 2 : 1); setPick(null); setSent(false); setErr(null); }, [reschedule]);

  const load = useCallback(async () => {
    if (!verified) return;
    setLoadErr(false);
    try {
      const r = await fetch(`/api/guest/${token}/booking/slots`);
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.success) { setLoadErr(true); return; }
      setSlots(j.data.slots || []);
      setMeta({ duration: j.data.duration_minutes, tz: j.data.timezone, enabled: !!j.data.enabled });
    } catch { setLoadErr(true); }
  }, [token, verified]);
  useEffect(() => { void load(); }, [load]);

  // 방문자 시간대의 날짜별로 묶는다
  const dayKey = useCallback((iso: string) => new Intl.DateTimeFormat('en-CA', {
    timeZone: browserTz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(iso)), []);
  const byDay = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const s of slots || []) {
      const k = dayKey(s);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(s);
    }
    return m;
  }, [slots, dayKey]);
  const days = useMemo(() => Array.from(byDay.keys()), [byDay]);
  useEffect(() => { if (days.length && (!day || !byDay.has(day))) setDay(days[0]); }, [days, day, byDay]);

  const fmtDay = (k: string) => new Intl.DateTimeFormat(locale, { month: 'numeric', day: 'numeric', weekday: 'short', timeZone: 'UTC' })
    .format(new Date(`${k}T12:00:00Z`));
  const fmtTime = (iso: string, tz = browserTz) => new Intl.DateTimeFormat(locale, { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
  const fmtFull = (iso: string, tz: string) => new Intl.DateTimeFormat(locale, {
    timeZone: tz, month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso));

  const submit = async () => {
    if (!pick || sending) return;
    setSending(true); setErr(null);
    try {
      const url = reschedule
        ? `/api/guest/${token}/booking/${reschedule.id}/reschedule`
        : `/api/guest/${token}/booking`;
      const body = reschedule ? { start: pick } : { start: pick, purpose, memo };
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.success) {
        const code = j?.message || 'error';
        setErr(code);
        // 그 사이 찼으면 시간을 다시 고르게 한다 — 목록도 새로 받는다
        if (code === 'slot_unavailable') { setPick(null); setStep(2); void load(); }
        return;
      }
      setSent(true);
    } catch { setErr('error'); } finally { setSending(false); }
  };

  if (!verified) {
    return (
      <GuestTabPane data-testid="guest-tab-body-book">
        <Notice data-testid="entry-book-locked">
          {t('booking.locked', { defaultValue: '이메일을 확인하면 상담 시간을 예약할 수 있어요. 위의 [확인하기] 를 눌러 주세요.' })}
        </Notice>
      </GuestTabPane>
    );
  }

  if (sent) {
    return (
      <GuestTabPane data-testid="guest-tab-body-book">
        <Done data-testid="entry-book-sent">
          {reschedule
            ? t('booking.resentBody', { defaultValue: '다른 시간으로 다시 신청했어요. 담당자가 확인하면 이 주소와 이메일로 알려 드려요.' })
            : t('booking.sentBody', { defaultValue: '신청을 보냈어요. 담당자가 확인하면 이 주소와 이메일로 알려 드려요.' })}
        </Done>
        <Primary type="button" data-testid="entry-book-go-mine" onClick={onDone}>
          {t('booking.goMine', { defaultValue: '내 문의 보기' })}
        </Primary>
      </GuestTabPane>
    );
  }

  const tzDiffers = !!meta && meta.tz !== browserTz;

  return (
    <GuestTabPane data-testid="guest-tab-body-book">
      <Steps aria-label={t('booking.stepsAria', { defaultValue: '예약 단계' }) as string}>
        {!reschedule && <StepDot $on={step === 1}>1 · {t('booking.step1', { defaultValue: '용건' })}</StepDot>}
        <StepDot $on={step === 2}>{reschedule ? 1 : 2} · {t('booking.step2', { defaultValue: '시간' })}</StepDot>
        <StepDot $on={step === 3}>{reschedule ? 2 : 3} · {t('booking.step3', { defaultValue: '확인' })}</StepDot>
      </Steps>

      {meta && !meta.enabled && (
        <Notice data-testid="entry-book-off">{t('booking.off', { defaultValue: '지금은 상담 예약을 받지 않아요. 문의하기에서 메시지를 남겨 주세요.' })}</Notice>
      )}

      {step === 1 && !reschedule && (
        <>
          <Label>{t('booking.purposeQ', { defaultValue: '어떤 상담인가요?' })}</Label>
          <Options role="radiogroup">
            {PURPOSES.map((p) => (
              <Opt key={p} type="button" role="radio" aria-checked={purpose === p} $on={purpose === p}
                data-testid={`entry-book-purpose-${p}`} onClick={() => setPurpose(p)}>
                {t(`booking.purpose.${p}`)}
              </Opt>
            ))}
          </Options>
          <Label as="label" htmlFor="entry-book-memo">{t('booking.memo', { defaultValue: '한 줄 메모 (선택)' })}</Label>
          {/* draft-exempt: 무인증 화면이라 초안 키를 만들 사용자가 없다 — 한 줄 메모이고, 예약 탭은 대화 탭처럼
              언마운트되지 않게 두지 않아도 되는 짧은 입력이다(LoginRequiredSheet 와 같은 판단) */}
          <Memo id="entry-book-memo" maxLength={500} rows={2} value={memo} onChange={(e) => setMemo(e.target.value)}
            placeholder={t('booking.memoPh', { defaultValue: '미리 알려 주실 내용이 있으면 적어 주세요.' }) as string} />
          <Primary type="button" data-testid="entry-book-next1" disabled={!purpose || (meta ? !meta.enabled : false)} onClick={() => setStep(2)}>
            {t('booking.next', { defaultValue: '다음' })}
          </Primary>
        </>
      )}

      {step === 2 && (
        <>
          {loadErr ? (
            <Empty>{t('booking.loadFail', { defaultValue: '시간을 불러오지 못했어요.' })} <RetryInline type="button" onClick={load}>{t('booking.retry', { defaultValue: '다시 시도' })}</RetryInline></Empty>
          ) : slots === null ? (
            <Empty>{t('booking.loading', { defaultValue: '불러오는 중…' })}</Empty>
          ) : days.length === 0 ? (
            <Notice data-testid="entry-book-noslot">{t('booking.noSlot', { defaultValue: '지금 예약할 수 있는 시간이 없어요. 문의하기에서 메시지를 남겨 주세요.' })}</Notice>
          ) : (
            <>
              <DayRow data-testid="entry-book-days">
                {days.map((k) => (
                  <DayBtn key={k} type="button" $on={day === k} aria-pressed={day === k} onClick={() => { setDay(k); setPick(null); }}>
                    {fmtDay(k)}
                  </DayBtn>
                ))}
              </DayRow>
              <Slots data-testid="entry-book-slots">
                {(byDay.get(day || '') || []).map((s) => (
                  <SlotBtn key={s} type="button" $on={pick === s} aria-pressed={pick === s} onClick={() => setPick(s)}>
                    {fmtTime(s)}
                  </SlotBtn>
                ))}
              </Slots>
              <Hint>{t('booking.tzShown', { tz: browserTz, defaultValue: '표시 시간대: {{tz}}' })}</Hint>
            </>
          )}
          <Row>
            {reschedule ? (
              <Ghost type="button" onClick={onCancelReschedule}>{t('booking.cancelPick', { defaultValue: '그만두기' })}</Ghost>
            ) : (
              <Ghost type="button" onClick={() => setStep(1)}>{t('booking.back', { defaultValue: '이전' })}</Ghost>
            )}
            <Primary type="button" data-testid="entry-book-next2" disabled={!pick} onClick={() => setStep(3)}>
              {t('booking.next', { defaultValue: '다음' })}
            </Primary>
          </Row>
        </>
      )}

      {step === 3 && pick && meta && (
        <>
          <Summary data-testid="entry-book-summary">
            {!reschedule && purpose && <SumRow><b>{t(`booking.purpose.${purpose}`)}</b> · {t('booking.minutes', { count: meta.duration, defaultValue: '{{count}}분' })}</SumRow>}
            <SumRow>{fmtFull(pick, browserTz)}–{fmtTime(new Date(new Date(pick).getTime() + meta.duration * 60000).toISOString())} ({browserTz})</SumRow>
            {tzDiffers && <SumSub>{t('booking.wsTime', { defaultValue: '담당자 시간' })}: {fmtFull(pick, meta.tz)} ({meta.tz})</SumSub>}
          </Summary>
          <Hint>{t('booking.afterSend', { defaultValue: '담당자가 확인한 뒤 확정돼요. 확정되면 이메일로 일정 파일을 보내 드려요.' })}</Hint>
          {err && <Warn data-testid="entry-book-error">{t(`booking.err.${err}`, { defaultValue: t('booking.err.error', { defaultValue: '신청을 보내지 못했어요. 잠시 뒤 다시 시도해 주세요.' }) as string })}</Warn>}
          <Row>
            <Ghost type="button" onClick={() => setStep(2)}>{t('booking.back', { defaultValue: '이전' })}</Ghost>
            <Primary type="button" data-testid="entry-book-submit" disabled={sending} onClick={submit}>
              {sending ? t('booking.sending', { defaultValue: '보내는 중…' }) : t('booking.submit', { defaultValue: '신청 보내기' })}
            </Primary>
          </Row>
        </>
      )}
    </GuestTabPane>
  );
}

const Notice = styled.div`padding:10px 12px;background:#f1f5f9;border-radius:8px;font-size:0.75rem;line-height:1.5;color:#64748b;`;
const Done = styled.div`padding:12px 14px;background:#F0FDFA;border:1px solid #99F6E4;border-radius:10px;font-size:0.8125rem;line-height:1.6;color:#0F766E;`;
const Warn = styled.div`padding:9px 12px;background:#FFF1F2;border:1px solid #FECDD3;border-radius:8px;font-size:0.75rem;line-height:1.5;color:#B91C3C;`;
const Label = styled.div`font-size:0.75rem;font-weight:600;color:#475569;`;
const Hint = styled.div`font-size:0.75rem;color:#94a3b8;line-height:1.5;`;
const Steps = styled.div`display:flex;gap:6px;flex-wrap:wrap;`;
const StepDot = styled.span<{ $on: boolean }>`
  padding:3px 10px;border-radius:999px;font-size:0.6875rem;font-weight:600;
  background:${p => (p.$on ? '#CCFBF1' : '#F1F5F9')};color:${p => (p.$on ? '#0F766E' : '#94A3B8')};
`;
const Options = styled.div`display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px;`;
const Opt = styled.button<{ $on: boolean }>`
  min-height:40px;padding:8px 12px;border-radius:10px;cursor:pointer;text-align:left;
  font-size:0.8125rem;font-weight:600;color:#0F172A;
  background:${p => (p.$on ? '#F0FDFA' : '#fff')};border:1px solid ${p => (p.$on ? '#14B8A6' : '#E2E8F0')};
  &:hover{border-color:#14B8A6;}
  &:focus-visible{outline:2px solid #14B8A6;outline-offset:2px;}
`;
const Memo = styled.textarea`
  width:100%;padding:10px 12px;border:1px solid #e2e8f0;border-radius:8px;resize:vertical;
  font-size:0.8125rem;line-height:1.6;color:#0f172a;font-family:inherit;
  &:focus{outline:none;border-color:#14B8A6;}
`;
const DayRow = styled.div`display:flex;gap:6px;overflow-x:auto;padding-bottom:2px;`;
const DayBtn = styled.button<{ $on: boolean }>`
  flex-shrink:0;min-height:36px;padding:0 12px;border-radius:8px;cursor:pointer;white-space:nowrap;
  font-size:0.8125rem;font-weight:600;
  background:${p => (p.$on ? '#14B8A6' : '#fff')};color:${p => (p.$on ? '#fff' : '#334155')};
  border:1px solid ${p => (p.$on ? '#14B8A6' : '#E2E8F0')};
  &:focus-visible{outline:2px solid #0D9488;outline-offset:2px;}
  @media (max-width:640px){ min-height:40px; }
`;
const Slots = styled.div`display:grid;grid-template-columns:repeat(auto-fill,minmax(84px,1fr));gap:6px;`;
const SlotBtn = styled.button<{ $on: boolean }>`
  min-height:36px;border-radius:8px;cursor:pointer;font-size:0.8125rem;font-weight:600;font-variant-numeric:tabular-nums;
  background:${p => (p.$on ? '#F0FDFA' : '#fff')};color:#0F172A;
  border:1px solid ${p => (p.$on ? '#14B8A6' : '#E2E8F0')};
  &:hover{border-color:#14B8A6;}
  &:focus-visible{outline:2px solid #14B8A6;outline-offset:2px;}
  @media (max-width:640px){ min-height:40px; }
`;
const Summary = styled.div`padding:12px 14px;background:#fff;border:1px solid #E2E8F0;border-radius:10px;display:flex;flex-direction:column;gap:4px;`;
const SumRow = styled.div`font-size:0.875rem;color:#0F172A;line-height:1.5;`;
const SumSub = styled.div`font-size:0.75rem;color:#64748B;`;
const Row = styled.div`display:flex;gap:8px;justify-content:flex-end;`;
const Primary = styled.button`
  min-height:40px;padding:0 16px;border-radius:10px;cursor:pointer;border:none;
  background:#14B8A6;color:#fff;font-size:0.875rem;font-weight:700;
  &:hover:not(:disabled){background:#0D9488;}
  &:disabled{opacity:.5;cursor:default;}
  &:focus-visible{outline:2px solid #0D9488;outline-offset:2px;}
`;
const Ghost = styled.button`
  min-height:40px;padding:0 14px;border-radius:10px;cursor:pointer;
  background:#fff;border:1px solid #CBD5E1;color:#334155;font-size:0.875rem;font-weight:600;
  &:hover{border-color:#14B8A6;}
  &:focus-visible{outline:2px solid #14B8A6;outline-offset:2px;}
`;
