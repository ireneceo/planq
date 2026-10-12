// Q calendar 보기 분류 — 개인 · 팀 · 업무 · Google, 누르는 대로 여러 개 켠다 (2026-10-12).
//
// Irene: *"캘린더에서 나, 업무, 일정 << 이게 뭐야? … 개인, 팀, 업무 이러면 이해가 가는데?
//   그리고 이거 셀렉트로 하지말고 버튼처럼 하고 선택하면 해당일정들 나오게 해줘. 누르는대로 다 나오게."*
//
// 옛 셀렉트(전체/나/업무/일정)는 **서로 다른 두 축**을 한 칸에 섞었다 — «나» 는 누구 것, «업무/일정» 은 종류.
// 이제 한 축(무엇의 일정인가)만 둔다. 한 일정 = 한 분류(layerOf 하나가 정한다 — 목록·칩이 같은 함수).
//   개인 = 나만 보기(L1) 일정 · 팀 = 팀과 나눈 일정(L2~L4) · 업무 = Q task 마감 · Google = 내 구글 캘린더(연결했을 때만).
// 옛 주소 ?scope= 도 읽는다(mine → 전부, tasks → 업무, events → 업무 뺀 전부).
import React, { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { FilterChip } from '../../components/Common/filterChip';
import HelpDot from '../../components/Common/HelpDot';
import { isTaskEvent, isPersonalEvent } from './taskToEvent';
import type { CalendarItem, CalendarEvent } from './types';

export type CalLayer = 'personal' | 'team' | 'task' | 'google';
export const ALL_LAYERS: CalLayer[] = ['personal', 'team', 'task', 'google'];

export function layerOf(e: CalendarItem): CalLayer {
  if (isTaskEvent(e)) return 'task';
  if (isPersonalEvent(e)) return 'google';
  const ev = e as CalendarEvent;
  // vlevel 이 정본(옛 visibility 는 훅이 같이 맞춘다). 값이 없는 옛 행은 visibility 로.
  if (ev.vlevel) return ev.vlevel === 'L1' ? 'personal' : 'team';
  return ev.visibility === 'personal' ? 'personal' : 'team';
}

const LS_KEY = 'planq:calendar-layers';

function parseList(v: string): Set<CalLayer> {
  if (v === 'none') return new Set();
  return new Set(v.split(',').filter((x): x is CalLayer => (ALL_LAYERS as string[]).includes(x)));
}

/** 주소에서 읽는다 — 없으면 null(기억해 둔 값 → 전부). */
export function readLayers(search: string): Set<CalLayer> | null {
  const p = new URLSearchParams(search);
  const v = p.get('layers');
  if (v) return parseList(v);
  const legacy = p.get('scope');
  if (legacy === 'tasks') return new Set(['task']);
  if (legacy === 'events') return new Set(['personal', 'team', 'google']);
  return null;
}

/** 주소에 쓸 값 — 전부 켜져 있으면 쓰지 않는다. */
export function layersParam(layers: Set<CalLayer>): string | null {
  if (ALL_LAYERS.every((l) => layers.has(l))) return null;
  if (layers.size === 0) return 'none';
  return ALL_LAYERS.filter((l) => layers.has(l)).join(',');
}

export function useCalendarLayers(search: string, embedded: boolean) {
  const [layers, setLayers] = useState<Set<CalLayer>>(() => {
    const fromUrl = embedded ? null : readLayers(search);
    if (fromUrl) return fromUrl;
    try {   // 마지막 선택은 이 기기 편의값일 뿐이다 — 못 읽으면 전부 켠다
      const saved = window.localStorage.getItem(LS_KEY);
      if (saved) return parseList(saved);
    } catch { /* 사생활 모드 등 */ }
    return new Set(ALL_LAYERS);
  });
  useEffect(() => {
    try { window.localStorage.setItem(LS_KEY, layersParam(layers) || ALL_LAYERS.join(',')); } catch { /* 위와 같음 */ }
  }, [layers]);
  const toggle = useCallback((l: CalLayer) => {
    setLayers((prev) => { const next = new Set(prev); if (next.has(l)) next.delete(l); else next.add(l); return next; });
  }, []);
  return { layers, toggle };
}

/** 이 연결이 화면에 보여 주는 구글 캘린더 — GET /api/me/calendar/events 의 connections. */
export interface PersonalCalSource {
  id: number;
  account_email: string | null;
  ok: boolean;
  calendar_primary?: boolean;
  calendar_summary?: string | null;
}

interface ChipsProps {
  layers: Set<CalLayer>;
  onToggle: (l: CalLayer) => void;
  /** 개인 구글 캘린더가 연결돼 있을 때만 Google 칩을 보인다 */
  googleConnected: boolean;
  googleSources: PersonalCalSource[];
}

export const CalendarLayerChips: React.FC<ChipsProps> = ({ layers, onToggle, googleConnected, googleSources }) => {
  const { t } = useTranslation('qcalendar');
  const calName = (s?: PersonalCalSource) =>
    (s && !s.calendar_primary && s.calendar_summary) ? s.calendar_summary : t('layer.googleDefault', '기본 캘린더');
  const first = googleSources[0];
  const googleLabel = t('layer.googleNamed', 'Google · {{name}}', { name: calName(first) });
  // 어떤 계정의 어느 캘린더인지 — 연결이 여럿이면 줄마다
  const googleWhich = googleSources.length
    ? googleSources.map((s) => `${s.account_email || ''} — ${calName(s)}`).join('\n')
    : '';
  const items: Array<{ key: CalLayer; label: string; hint: string }> = [
    { key: 'personal', label: t('layer.personal', '개인'), hint: t('layer.personalHint', '나만 보기로 만든 일정') },
    { key: 'team', label: t('layer.team', '팀'), hint: t('layer.teamHint', '팀·프로젝트와 함께 보는 일정') },
    { key: 'task', label: t('layer.task', '업무'), hint: t('layer.taskHint', 'Q task 업무의 마감일') },
  ];
  if (googleConnected) items.push({ key: 'google', label: googleLabel, hint: `${t('layer.googleHint', '내 구글 캘린더 일정 — 지금은 이 캘린더 하나만 보입니다')}${googleWhich ? `\n${googleWhich}` : ''}` });
  return (
    <Row data-testid="calendar-layers" role="group" aria-label={t('layer.group', '보기 분류') as string}>
      {items.map((it) => (
        <Chip key={it.key} type="button" $on={layers.has(it.key)} aria-pressed={layers.has(it.key)}
          onClick={() => onToggle(it.key)} title={it.hint} data-testid={`calendar-layer-${it.key}`}>
          {it.key === 'google' && <GDot />}
          {it.label}
        </Chip>
      ))}
      <HelpDot topic="calendar-layers" placement="auto">
        {t('layer.help', '누른 분류의 일정만 보입니다. 여러 개를 함께 켤 수 있어요.\n· 개인 — 나만 보기로 만든 일정\n· 팀 — 팀·프로젝트와 함께 보는 일정\n· 업무 — Q task 업무의 마감일\n· Google — 연결한 내 구글 캘린더(지금은 고른 캘린더 하나만 보입니다. 바꾸기: 내 외부 연동 › 구글 캘린더)')}
        {googleWhich ? `\n\n${googleWhich}` : ''}
      </HelpDot>
    </Row>
  );
};

// 도구줄 오른쪽 묶음 — 폰에선 한 줄로 옆으로 민다(filterChip.ChipRow 와 같은 규칙).
const Row = styled.div`
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-left: auto;
  @media (max-width: 640px) {
    flex-wrap: nowrap; overflow-x: auto; overscroll-behavior-x: contain; max-width: 100%;
    margin-left: 0; scrollbar-width: none; &::-webkit-scrollbar { display: none; }
  }
`;
// 도구줄(오늘·화살표 30px) 높이에 가깝게 규격 32 — 모양·색은 공용 알약 그대로.
const Chip = styled(FilterChip)`
  height: 32px; gap: 6px;
`;
const GDot = styled.span`
  width: 8px; height: 8px; border-radius: 50%; background: #14B8A6; flex-shrink: 0;
`;
