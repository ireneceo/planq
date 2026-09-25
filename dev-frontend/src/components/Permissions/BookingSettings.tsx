// 설정 › 고객 창구 — **상담 예약** 설정 (docs/CLIENT_ENTRY_DESIGN.md §4.5)
//
//   예약 켜기 · 담당 멤버 · 한 번 길이(30/60) · 리드타임 · 하루 최대 · 예약 받는 시간(근무시간)
//
// ★ 전부 AutoSaveField — 저장 버튼 없음. 저장은 **던진다**(삼키면 «!» 배지가 안 뜬다).
// ★ 예약 설정은 `permissions.customer_entry.booking`, 받는 시간은 `businesses.work_hours` 다.
//   근무시간은 슬롯 계산의 입력이고(services/booking.js), 이 카드가 그 값을 고치는 **첫 화면**이다
//   (그전엔 모양이 정해진 적도, 고치는 화면도 없었다). 저장 모양은 서버 serializeWorkHours 한 곳이 정한다.
// ★ 보내는 것은 **바꾼 칸만**이다 — 서버가 병합한다(routes/customer_entry.js). 통째로 보내면
//   다른 화면에서 막 바꾼 소개 문구를 옛 값으로 덮는다.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../contexts/AuthContext';
import AutoSaveField from '../Common/AutoSaveField';
import PlanQSelect from '../Common/PlanQSelect';
import { Switch, SwitchKnob } from '../Common/switchShell';

type Booking = { enabled: boolean; member_id: number | null; duration: number; lead_hours: number; daily_max: number };
type Hours = Record<string, [number, number] | null>;
interface Props { businessId: number; isOwner: boolean }

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const DEFAULT_HOURS: Hours = { mon: [9, 18], tue: [9, 18], wed: [9, 18], thu: [9, 18], fri: [9, 18], sat: null, sun: null };
const HOUR_OPTS = Array.from({ length: 49 }, (_, i) => i / 2).map((h) => ({
  value: String(h), label: `${String(Math.floor(h)).padStart(2, '0')}:${h % 1 ? '30' : '00'}`,
}));

/** 서버가 정한 모양이 아니면 기본값 — 서버 normalizeWorkHours 와 같은 규칙. */
function readHours(raw: unknown): Hours {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return DEFAULT_HOURS;
  const src = raw as Record<string, unknown>;
  const out: Hours = {};
  let any = false;
  for (const d of DAYS) {
    const v = src[d];
    if (Array.isArray(v) && v.length === 2 && Number(v[0]) < Number(v[1])) { out[d] = [Number(v[0]), Number(v[1])]; any = true; } else out[d] = null;
  }
  return any ? out : DEFAULT_HOURS;
}

const BookingSettings: React.FC<Props> = ({ businessId, isOwner }) => {
  const { t } = useTranslation('settings');
  const [bk, setBk] = useState<Booking | null>(null);
  const [hours, setHours] = useState<Hours>(DEFAULT_HOURS);
  const [members, setMembers] = useState<Array<{ value: string; label: string }>>([]);
  const bkRef = useRef(bk); bkRef.current = bk;
  const hoursRef = useRef(hours); hoursRef.current = hours;
  // 근무시간 칸은 요일 버튼 + 셀렉트 여러 개라 «바로 아래 자식의 onChange» 로 저장이 걸리지 않는다
  //   (AutoSaveField 는 직계 자식만 감싼다). 값을 바꾼 **그 자리에서** 저장을 건다.
  const hoursSave = useRef<{ triggerSave: () => void }>(null);
  const setHoursAndSave = (fn: (p: Hours) => Hours) => { setHours(fn); hoursSave.current?.triggerSave(); };

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [e, b, m] = await Promise.all([
          apiFetch(`/api/businesses/${businessId}/customer-entry`).then((r) => r.json()),
          apiFetch(`/api/businesses/${businessId}`).then((r) => r.json()),
          apiFetch(`/api/businesses/${businessId}/members`).then((r) => r.json()),
        ]);
        if (!alive) return;
        if (e?.success) setBk(e.data.customer_entry?.booking || null);
        if (b?.success) setHours(readHours(b.data?.work_hours));
        if (m?.success && Array.isArray(m.data)) {
          setMembers(m.data
            .filter((x: { role: string; user_id: number | null }) => x.role !== 'ai' && x.user_id)
            .map((x: { user_id: number; user?: { display_name?: string | null; name?: string } }) => ({
              value: String(x.user_id), label: x.user?.display_name || x.user?.name || `#${x.user_id}`,
            })));
        }
      } catch { /* 카드는 기본값으로 그려진다 — 저장에서 실패가 드러난다 */ }
    })();
    return () => { alive = false; };
  }, [businessId]);

  const saveBooking = useCallback(async () => {
    const r = await apiFetch(`/api/businesses/${businessId}/customer-entry`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ booking: bkRef.current }),
    });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.success) throw new Error(j?.message || `save_failed_${r.status}`);
    if (j.data?.customer_entry?.booking) setBk(j.data.customer_entry.booking);
  }, [businessId]);

  const saveHours = useCallback(async () => {
    const r = await apiFetch(`/api/businesses/${businessId}/settings`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ work_hours: hoursRef.current }),
    });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.success) throw new Error(j?.message || `save_failed_${r.status}`);
  }, [businessId]);

  if (!bk) return null;
  const set = (p: Partial<Booking>) => setBk((prev) => (prev ? { ...prev, ...p } : prev));
  const off = !isOwner;
  const leadOpts = [0, 2, 4, 12, 24, 48, 72].map((h) => ({ value: String(h), label: t('entry.booking.leadN', { count: h, defaultValue: '{{count}}시간 전까지' }) as string }));
  const maxOpts = Array.from({ length: 10 }, (_, i) => ({ value: String(i + 1), label: t('entry.booking.maxN', { count: i + 1, defaultValue: '하루 {{count}}건' }) as string }));
  const durOpts = [30, 60].map((m) => ({ value: String(m), label: t('entry.booking.minN', { count: m, defaultValue: '{{count}}분' }) as string }));
  const memberOpts = [{ value: '', label: t('entry.booking.memberOwner', '오너') as string }, ...members];

  return (
    <Box data-testid="entry-booking-settings">
      <Row>
        <div>
          <Label id="entry-booking-on-label">{t('entry.booking.title', '상담 예약 받기')}</Label>
          <Hint>{t('entry.booking.desc', '켜면 창구에 «상담 예약» 탭이 생깁니다. 이메일을 확인한 고객만 시간을 고를 수 있고, 신청은 담당자의 확인필요에 뜹니다.')}</Hint>
        </div>
        <AutoSaveField key={`entry-bk-on-${businessId}`} type="toggle" onSave={saveBooking}>
          <Switch type="button" role="switch" aria-checked={bk.enabled} aria-labelledby="entry-booking-on-label"
            data-testid="entry-booking-toggle" $on={bk.enabled} disabled={off}
            onClick={() => set({ enabled: !bk.enabled })}>
            <SwitchKnob $on={bk.enabled} />
          </Switch>
        </AutoSaveField>
      </Row>

      {bk.enabled && (
        <>
          <Grid>
            <Field>
              <Label>{t('entry.booking.member', '담당 멤버')}</Label>
              <AutoSaveField key={`entry-bk-mem-${businessId}`} type="select" onSave={saveBooking}>
                <PlanQSelect size="sm" isDisabled={off} options={memberOpts}
                  value={memberOpts.find((o) => o.value === String(bk.member_id || '')) || memberOpts[0]}
                  onChange={(o) => o && set({ member_id: (o as { value: string }).value ? Number((o as { value: string }).value) : null })} />
              </AutoSaveField>
              <Hint>{t('entry.booking.memberHint', '고객에게 담당자가 정해져 있으면 그 사람이 먼저입니다.')}</Hint>
            </Field>
            <Field>
              <Label>{t('entry.booking.duration', '한 번 길이')}</Label>
              <AutoSaveField key={`entry-bk-dur-${businessId}`} type="select" onSave={saveBooking}>
                <PlanQSelect size="sm" isDisabled={off} options={durOpts}
                  value={durOpts.find((o) => o.value === String(bk.duration)) || durOpts[0]}
                  onChange={(o) => o && set({ duration: Number((o as { value: string }).value) })} />
              </AutoSaveField>
            </Field>
            <Field>
              <Label>{t('entry.booking.lead', '최소 예약 시점')}</Label>
              <AutoSaveField key={`entry-bk-lead-${businessId}`} type="select" onSave={saveBooking}>
                <PlanQSelect size="sm" isDisabled={off} options={leadOpts}
                  value={leadOpts.find((o) => o.value === String(bk.lead_hours)) || leadOpts[4]}
                  onChange={(o) => o && set({ lead_hours: Number((o as { value: string }).value) })} />
              </AutoSaveField>
            </Field>
            <Field>
              <Label>{t('entry.booking.max', '하루 최대')}</Label>
              <AutoSaveField key={`entry-bk-max-${businessId}`} type="select" onSave={saveBooking}>
                <PlanQSelect size="sm" isDisabled={off} options={maxOpts}
                  value={maxOpts.find((o) => o.value === String(bk.daily_max)) || maxOpts[3]}
                  onChange={(o) => o && set({ daily_max: Number((o as { value: string }).value) })} />
              </AutoSaveField>
            </Field>
          </Grid>

          <Field>
            <Label>{t('entry.booking.hours', '예약 받는 시간')}</Label>
            <Hint>{t('entry.booking.hoursHint', '워크스페이스 시간대 기준입니다. 이미 잡힌 담당자 일정과 겹치는 시간은 고객에게 보이지 않습니다.')}</Hint>
            <AutoSaveField key={`entry-bk-hours-${businessId}`} ref={hoursSave} type="select" onSave={saveHours}>
              <HoursList>
                {DAYS.map((d) => {
                  const v = hours[d];
                  return (
                    <HourRow key={d} data-testid={`entry-hours-${d}`}>
                      <DayToggle type="button" aria-pressed={!!v} $on={!!v} disabled={off}
                        onClick={() => setHoursAndSave((p) => ({ ...p, [d]: p[d] ? null : [9, 18] }))}>
                        {t(`entry.booking.day.${d}`)}
                      </DayToggle>
                      {v ? (
                        <>
                          <Sel><PlanQSelect size="sm" isDisabled={off} options={HOUR_OPTS} value={HOUR_OPTS.find((o) => Number(o.value) === v[0]) || null}
                            onChange={(o) => { const n = Number((o as { value: string }).value); if (n < v[1]) setHoursAndSave((p) => ({ ...p, [d]: [n, v[1]] })); }} /></Sel>
                          <Dash>–</Dash>
                          <Sel><PlanQSelect size="sm" isDisabled={off} options={HOUR_OPTS} value={HOUR_OPTS.find((o) => Number(o.value) === v[1]) || null}
                            onChange={(o) => { const n = Number((o as { value: string }).value); if (n > v[0]) setHoursAndSave((p) => ({ ...p, [d]: [v[0], n] })); }} /></Sel>
                        </>
                      ) : <Closed>{t('entry.booking.closed', '받지 않음')}</Closed>}
                    </HourRow>
                  );
                })}
              </HoursList>
            </AutoSaveField>
          </Field>
        </>
      )}
    </Box>
  );
};

export default BookingSettings;

const Box = styled.div`display:flex;flex-direction:column;gap:14px;padding-top:14px;border-top:1px solid #F1F5F9;`;
const Row = styled.div`display:flex;align-items:flex-start;justify-content:space-between;gap:12px;`;
const Grid = styled.div`display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;`;
const Field = styled.div`display:flex;flex-direction:column;gap:6px;min-width:0;`;
const Label = styled.div`font-size:0.75rem;font-weight:600;color:#475569;`;
const Hint = styled.div`font-size:0.75rem;color:#94a3b8;line-height:1.5;`;
const HoursList = styled.div`display:flex;flex-direction:column;gap:6px;`;
const HourRow = styled.div`display:flex;align-items:center;gap:8px;flex-wrap:wrap;`;
const DayToggle = styled.button<{ $on: boolean }>`
  flex:0 0 56px;height:36px;border-radius:8px;cursor:pointer;font-size:0.8125rem;font-weight:600;
  background:${p => (p.$on ? '#F0FDFA' : '#fff')};color:${p => (p.$on ? '#0F766E' : '#94A3B8')};
  border:1px solid ${p => (p.$on ? '#14B8A6' : '#E2E8F0')};
  &:disabled{cursor:default;}
  &:focus-visible{outline:2px solid #14B8A6;outline-offset:2px;}
  @media (max-width:640px){ height:40px; }
`;
const Sel = styled.div`flex:0 1 120px;min-width:96px;`;
const Dash = styled.span`color:#94A3B8;font-size:0.8125rem;`;
const Closed = styled.span`font-size:0.75rem;color:#94A3B8;`;
