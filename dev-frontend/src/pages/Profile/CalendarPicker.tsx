// 개인 구글 캘린더 — PlanQ 일정을 **어느 캘린더에** 올릴지 고른다 (2026-10-07, Fable B 판정 8).
//
//   목록은 서버(GET /api/me/calendar/calendars)가 «일정을 쓸 수 있는» 캘린더만 준다. 고르면 바로 저장(자동저장).
//   새로 올리는 일정부터 그 캘린더로 가고, 이미 올린 일정은 원래 캘린더에서 계속 고쳐진다 — 화면이 그 사실을 짧게 말한다.
//   옛 연결은 목록 권한이 없다 → «다시 연결하면 고를 수 있어요» + [다시 연결].
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import { apiFetch } from '../../contexts/AuthContext';
import AutoSaveField from '../../components/Common/AutoSaveField';
import PlanQSelect from '../../components/Common/PlanQSelect';

type Cal = { id: string; summary: string; primary: boolean };

export default function CalendarPicker({ connectionId, onReconnect, busy }: {
  connectionId: number | string; onReconnect: () => void; busy?: boolean;
}) {
  const { t } = useTranslation('profile');
  const [state, setState] = useState<{ canList: boolean; selected: string; calendars: Cal[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const pending = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await apiFetch(`/api/me/calendar/calendars?connection_id=${connectionId}`);
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.success) { setFailed(true); return; }
      setState({ canList: !!j.data.can_list, selected: j.data.selected || 'primary', calendars: j.data.calendars || [] });
    } catch { setFailed(true); }
  }, [connectionId]);
  useEffect(() => { void load(); }, [load]);

  const persist = useCallback(async () => {
    const want = pending.current;
    if (!want) return;
    const r = await apiFetch('/api/me/calendar/calendar-id', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connection_id: connectionId, calendar_id: want }),
    });
    if (!r.ok) throw new Error('calendar_select_failed');   // 던져야 ! 뱃지가 뜬다
  }, [connectionId]);

  if (failed) return <Hint data-testid="calendar-picker-failed">{t('integrations.calendarPickFailed') as string}</Hint>;
  if (!state) return null;
  if (!state.canList) {
    return (
      <Row data-testid="calendar-picker-reconnect">
        <Hint>{t('integrations.calendarPickReconnect') as string}</Hint>
        <LinkBtn type="button" onClick={onReconnect} disabled={busy}>{t('integrations.reconnect', { defaultValue: '다시 연결' }) as string}</LinkBtn>
      </Row>
    );
  }
  const options = state.calendars.map((c) => ({
    value: c.primary ? 'primary' : c.id,
    label: c.primary ? `${c.summary} (${t('integrations.calendarPrimary') as string})` : c.summary,
  }));
  return (
    <Wrap data-testid="calendar-picker">
      <Label>{t('integrations.calendarPickLabel') as string}</Label>
      <AutoSaveField type="select" onSave={persist}>
        <PlanQSelect size="sm"
          value={options.find((o) => o.value === state.selected)}
          onChange={(opt: unknown) => {
            const v = (opt as { value?: string } | null)?.value;
            if (!v) return;
            pending.current = v;
            setState((s) => (s ? { ...s, selected: v } : s));
          }}
          options={options} />
      </AutoSaveField>
      <Hint>{t('integrations.calendarPickHint') as string}</Hint>
    </Wrap>
  );
}

const Wrap = styled.div`display:flex;flex-direction:column;gap:6px;margin-top:10px;max-width:360px;`;
const Row = styled.div`display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:8px;`;
const Label = styled.span`font-size:0.75rem;font-weight:600;color:#475569;`;
const Hint = styled.span`font-size:0.75rem;color:#64748B;line-height:1.5;`;
const LinkBtn = styled.button`
  all:unset;cursor:pointer;font-size:0.75rem;font-weight:600;color:#0F766E;
  &:hover{text-decoration:underline;} &:disabled{opacity:0.5;cursor:default;}
  &:focus-visible{outline:2px solid #14B8A6;outline-offset:2px;border-radius:4px;}
`;
