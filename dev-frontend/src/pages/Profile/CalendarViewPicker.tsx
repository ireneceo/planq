// 내 외부 연동 › 구글 캘린더 — «Q calendar 에 보일 캘린더» 여러 개 고르기 (2026-10-12).
//
//   Irene: *"캘린더 고르기 … 하나만 선택하게 되어 있어? 왜?? 멀티선택이 되어야지."*
//   위의 «올릴 캘린더» 는 본질적으로 하나다(일정 하나 = 캘린더 하나). 여러 개는 «보기» 쪽이다 —
//   Q calendar 의 Google 칩(보기/가리기)과 **같은 저장·같은 훅**(calendarLayers.useGoogleCalendarVisibility,
//   PUT /api/me/calendar/visible-calendars)을 쓴다. 따로 짜면 두 화면이 다른 값을 보여 준다.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import { apiFetch } from '../../contexts/AuthContext';
import AutoSaveField from '../../components/Common/AutoSaveField';
import { FilterChip } from '../../components/Common/filterChip';
import { useGoogleCalendarVisibility, calColor, type GoogleCal, type PersonalCalSource } from '../QCalendar/calendarLayers';

export default function CalendarViewPicker({ connectionId }: { connectionId: number | string }) {
  const { t } = useTranslation('profile');
  const [src, setSrc] = useState<PersonalCalSource | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await apiFetch(`/api/me/calendar/calendars?connection_id=${connectionId}&role=reader`);
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.success || !j.data?.can_list) { setFailed(true); return; }
      setFailed(false);
      setSrc({ id: Number(connectionId), account_email: null, ok: true, can_list: true,
        visible_max: j.data.visible_max, calendars: (j.data.calendars || []) as GoogleCal[] });
    } catch { setFailed(true); }
  }, [connectionId]);
  useEffect(() => { void load(); }, [load]);

  const sources = useMemo(() => (src ? [src] : []), [src]);
  const vis = useGoogleCalendarVisibility(sources, load);

  if (failed) return <Hint data-testid="calendar-view-failed">{t('integrations.calendarPickFailed') as string}</Hint>;
  if (!src || !src.calendars?.length) return null;
  const nameOf = (c: GoogleCal) => (c.primary
    ? `${c.summary || ''} (${t('integrations.calendarPrimary') as string})`
    : (c.summary || c.id));
  return (
    <Wrap data-testid="calendar-view-picker">
      <Label>{t('integrations.calendarViewLabel', 'Q calendar 에 보일 캘린더 (여러 개)') as string}</Label>
      <AutoSaveField type="toggle" onSave={vis.persist}>
        <Chips role="group" aria-label={t('integrations.calendarViewLabel', 'Q calendar 에 보일 캘린더 (여러 개)') as string}>
          {src.calendars.map((c) => {
            const on = c.is_write || (vis.vis[src.id] || []).includes(c.id);
            return (
              <Chip key={c.id} type="button" $on={on} aria-pressed={on} aria-disabled={c.is_write || undefined}
                onClick={() => vis.toggle(src, c)} data-testid="calendar-view-cal" data-cal-id={c.id}
                title={c.is_write ? t('integrations.calendarViewWriteHint', 'PlanQ 일정을 올리는 캘린더 — 늘 보입니다') as string : undefined}>
                <Check $on={on} aria-hidden="true">
                  {on && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>}
                </Check>
                <Dot style={{ background: calColor(c.color) }} aria-hidden="true" />
                <Name>{nameOf(c)}</Name>
              </Chip>
            );
          })}
        </Chips>
      </AutoSaveField>
      <Hint>{t('integrations.calendarViewHint', '체크한 캘린더의 일정이 Q calendar 에 함께 보입니다(나만 봅니다). 올리는 캘린더는 늘 보입니다. 최대 {{max}}개.', { max: src.visible_max || 15 }) as string}</Hint>
    </Wrap>
  );
}

const Wrap = styled.div`display:flex;flex-direction:column;gap:6px;margin-top:12px;max-width:520px;`;
const Label = styled.span`font-size:0.75rem;font-weight:600;color:#475569;`;
const Hint = styled.span`font-size:0.75rem;color:#64748B;line-height:1.5;`;
const Chips = styled.div`display:flex;flex-wrap:wrap;gap:6px;`;
const Chip = styled(FilterChip)`
  height: 32px; gap: 6px; max-width: 100%;
  &[aria-disabled='true'] { cursor: default; }
  @media (max-width: 640px) { height: 40px; }
`;
const Check = styled.span<{ $on: boolean }>`
  width: 14px; height: 14px; border-radius: 4px; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center;
  border: 1.5px solid ${(p) => (p.$on ? '#0F766E' : '#CBD5E1')}; background: ${(p) => (p.$on ? '#0F766E' : '#fff')}; color: #fff;
`;
const Dot = styled.span`width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;`;
const Name = styled.span`max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`;
