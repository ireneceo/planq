// 팀 Google 캘린더 — **팀 일정을 올릴 캘린더 하나**를 고른다 (docs/TEAM_CALENDAR_PICK_DESIGN.md §2).
//
//   여러 개를 고르는 칸이 아니다 — 한 일정 = 한 캘린더. 회사 계정의 다른 캘린더를 팀원에게 읽어 오지 않는다
//   (토큰이 대표 개인 계정이라 사적 일정이 샌다). 팀원이 볼 구글 캘린더는 각자 개인 연동에서 고른다 — 그 한 줄을 화면이 말한다.
//   바꿀 수 있는 사람 = 대표(연결·해제와 같은 선). 나머지는 값만 본다.
//   모양은 개인 쪽 «올릴 캘린더»(pages/Profile/CalendarPicker)와 같다 — 라벨 + 셀렉트 + 자동저장 + 짧은 안내.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import { apiFetch } from '../../contexts/AuthContext';
import AutoSaveField from '../Common/AutoSaveField';
import PlanQSelect from '../Common/PlanQSelect';

type Cal = { id: string; summary: string; primary: boolean; access_role?: string };

export default function TeamCalendarPick({ businessId, isOwner, canList, summary, connecting, onAllow, onSaved }: {
  businessId: number;
  isOwner: boolean;
  /** 서버가 저장된 권한에서 파생한 값(/api/cloud/status gcal.can_list_calendars) */
  canList: boolean;
  /** 지금 올리는 캘린더 이름 — null = 기본 캘린더 */
  summary: string | null;
  connecting: boolean;
  /** 목록 권한을 포함해 다시 연결(점진적 동의) */
  onAllow: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation('settings');
  const [state, setState] = useState<{ selected: string; calendars: Cal[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const pending = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await apiFetch(`/api/cloud/gcal/${businessId}/calendars`);
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.success) { setFailed(true); return; }
      setFailed(false);
      setState({ selected: j.data.selected || 'primary', calendars: j.data.can_list ? (j.data.calendars || []) : [] });
    } catch { setFailed(true); }
  }, [businessId]);
  useEffect(() => { if (isOwner && canList) void load(); }, [isOwner, canList, load, summary]);

  const persist = useCallback(async () => {
    const want = pending.current;
    if (!want) return;
    const r = await apiFetch(`/api/cloud/gcal/${businessId}/calendar-id`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ calendar_id: want }),
    });
    if (!r.ok) throw new Error('calendar_select_failed');   // 던져야 ! 뱃지가 뜬다
    onSaved();
  }, [businessId, onSaved]);

  const currentLabel = summary || (t('storage.gcalPick.primary') as string);

  // 대표가 아니면 값만 — 바꾸는 컨트롤을 그리지 않는다.
  if (!isOwner) {
    return (
      <Wrap data-testid="team-calendar-pick">
        <Label>{t('storage.gcalPick.label') as string}</Label>
        <Value data-testid="team-calendar-pick-value">{currentLabel}</Value>
        <Hint>{t('storage.gcalPick.ownerOnly') as string}</Hint>
      </Wrap>
    );
  }

  if (!canList) {
    return (
      <Wrap data-testid="team-calendar-pick">
        <Label>{t('storage.gcalPick.label') as string}</Label>
        <Row>
          <Value data-testid="team-calendar-pick-value">{currentLabel}</Value>
          <PickBtn type="button" disabled={connecting} onClick={onAllow} data-testid="team-calendar-pick-allow">
            {connecting ? (t('storage.connecting') as string) : (t('storage.gcalPick.choose') as string)}
          </PickBtn>
        </Row>
        <Hint>{t('storage.gcalPick.needList') as string}</Hint>
        <Hint>{t('storage.gcalPick.memberView') as string}</Hint>
      </Wrap>
    );
  }

  if (failed) return <Hint data-testid="team-calendar-pick-failed">{t('storage.gcalPick.failed') as string}</Hint>;
  if (!state) return null;

  const options = state.calendars.map((c) => ({
    value: c.id,
    label: c.primary ? `${c.summary} (${t('storage.gcalPick.primaryTag') as string})` : c.summary,
  }));
  const chosenPrimary = state.selected === 'primary';
  return (
    <Wrap data-testid="team-calendar-pick">
      <Label>{t('storage.gcalPick.label') as string}</Label>
      <SelectBox>
        <AutoSaveField key={businessId} type="select" onSave={persist}>
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
      </SelectBox>
      {!chosenPrimary && <Warn data-testid="team-calendar-pick-shared">{t('storage.gcalPick.sharedWarn') as string}</Warn>}
      <Hint>{t('storage.gcalPick.moveHint') as string}</Hint>
      <Hint>{t('storage.gcalPick.memberView') as string}</Hint>
    </Wrap>
  );
}

const Wrap = styled.div`display:flex;flex-direction:column;gap:6px;margin-top:10px;max-width:420px;`;
const Row = styled.div`display:flex;align-items:center;gap:8px;flex-wrap:wrap;`;
const SelectBox = styled.div`max-width:360px;`;
const Label = styled.span`font-size:0.75rem;font-weight:600;color:#475569;`;
const Value = styled.span`font-size:0.8125rem;font-weight:600;color:#0F172A;word-break:break-all;`;
const Hint = styled.span`font-size:0.75rem;color:#64748B;line-height:1.5;`;
const Warn = styled.span`font-size:0.75rem;color:#B45309;line-height:1.5;`;
const PickBtn = styled.button`
  min-height:32px;padding:0 12px;font-size:0.75rem;font-weight:600;color:#0F766E;background:#fff;
  border:1px solid #99F6E4;border-radius:8px;cursor:pointer;
  &:hover:not(:disabled){background:#F0FDFA;}
  &:disabled{opacity:0.6;cursor:not-allowed;}
  @media (max-width:640px){min-height:40px;}
`;
