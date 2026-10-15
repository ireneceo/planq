// Q calendar 보기 분류 — 개인 · 팀 · 업무 · Google, 누르는 대로 여러 개 켠다 (2026-10-12).
//
// Irene: *"캘린더에서 나, 업무, 일정 << 이게 뭐야? … 개인, 팀, 업무 이러면 이해가 가는데?
//   그리고 이거 셀렉트로 하지말고 버튼처럼 하고 선택하면 해당일정들 나오게 해줘. 누르는대로 다 나오게."*
//
// 옛 셀렉트(전체/나/업무/일정)는 **서로 다른 두 축**을 한 칸에 섞었다 — «나» 는 누구 것, «업무/일정» 은 종류.
// 이제 한 축(무엇의 일정인가)만 둔다. 한 일정 = 한 분류(layerOf 하나가 정한다 — 목록·칩이 같은 함수).
//   개인 = 나만 보기(L1) 일정 · 팀 = 팀과 나눈 일정(L2~L4) · 업무 = Q task 마감 · Google = 내 구글 캘린더(연결했을 때만).
// 2단계(2026-10-12, Fable 판정): Google 을 켜면 **구글 캘린더마다** 칩이 하나씩 붙는다(구글 색 점 + 이름) — 눌러서 보기/가리기.
//   Irene: *"다른 캘린더 앱은 구글캘린더 종류 다 가져와서 보기/가리기 다되는데"*
//   저장은 서버 한 곳(PUT /api/me/calendar/visible-calendars) — 기기가 바뀌어도 같다. «Google» 칩은 모(母) 토글(끄면 전부 가림, 자식 선택은 그대로).
//   목록 권한이 없는 옛 연결은 «다른 캘린더» 칩에서 권한을 한 번 더 묻는다(내 외부 연동과 같은 버튼).
// 옛 주소 ?scope= 도 읽는다(mine → 전부, tasks → 업무, events → 업무 뺀 전부).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { FilterChip } from '../../components/Common/filterChip';
import { SegmentedToggle, SegmentedBtn } from '../../components/Common/segmentedToggle';
import HelpDot from '../../components/Common/HelpDot';
import ChipPopover from '../../components/Common/ChipPopover';
import AutoSaveField from '../../components/Common/AutoSaveField';
import GoogleCalendarListConsent from '../../components/Calendar/GoogleCalendarListConsent';
import { apiFetch } from '../../contexts/AuthContext';
import { isTaskEvent, isPersonalEvent, GOOGLE_FALLBACK_COLOR } from './taskToEvent';
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
  // 프로젝트 탭(얹힌 모드)은 따로 기억한다 — 같은 키를 쓰면 프로젝트에서 끈 [개인] 이 Q calendar 에서도 꺼져 있었다
  const key = embedded ? `${LS_KEY}:project` : LS_KEY;
  const [layers, setLayers] = useState<Set<CalLayer>>(() => {
    const fromUrl = embedded ? null : readLayers(search);
    if (fromUrl) return fromUrl;
    try {   // 마지막 선택은 이 기기 편의값일 뿐이다 — 못 읽으면 전부 켠다
      const saved = window.localStorage.getItem(key);
      if (saved) return parseList(saved);
    } catch { /* 사생활 모드 등 */ }
    return new Set(ALL_LAYERS);
  });
  useEffect(() => {
    try { window.localStorage.setItem(key, layersParam(layers) || ALL_LAYERS.join(',')); } catch { /* 위와 같음 */ }
  }, [layers, key]);
  const toggle = useCallback((l: CalLayer) => {
    setLayers((prev) => { const next = new Set(prev); if (next.has(l)) next.delete(l); else next.add(l); return next; });
  }, []);
  return { layers, toggle };
}

/** 구글 캘린더 하나 — 서버 visibleCalendarsOf 와 같은 모양. */
export interface GoogleCal {
  id: string;
  summary: string | null;
  color: string | null;
  primary: boolean;
  access_role: string | null;
  visible: boolean;
  is_write: boolean;
  ok?: boolean;
  error?: string;
}

/** 이 연결이 화면에 보여 주는 구글 캘린더 — GET /api/me/calendar/events 의 connections. */
export interface PersonalCalSource {
  id: number;
  account_email: string | null;
  ok: boolean;
  calendar_primary?: boolean;
  calendar_summary?: string | null;
  can_list?: boolean;
  list_error?: string | null;
  visible_max?: number;
  calendars?: GoogleCal[];
}

// 색 없는 구글 캘린더 — 일정 칩(taskToEvent.personalToEvent)과 같은 대체색. 두 곳이 다르면 칩 점과 일정 색이 어긋난다.
export const calColor = (c?: string | null) => (c && /^#[0-9a-fA-F]{6}$/.test(c) ? c : GOOGLE_FALLBACK_COLOR);

/**
 * 구글 캘린더별 보기/가리기 — 화면 상태와 저장을 한곳에.
 *   toggle 은 화면만 바꾸고(누르는 순간 일정이 사라지고 나타난다), persist 는 AutoSaveField 가 부른다(저장 PUT 한 번).
 *   최신값은 ref 로 읽는다 — 클로저는 누르기 전 값을 본다.
 */
export function useGoogleCalendarVisibility(sources: PersonalCalSource[], onSaved: () => void) {
  const [vis, setVis] = useState<Record<number, string[]>>({});
  const visRef = useRef(vis);
  visRef.current = vis;
  const savedRef = useRef<Record<number, string[]>>({});
  const dirtyRef = useRef(false);

  useEffect(() => {
    if (dirtyRef.current) return;   // 저장 전 바꾼 것을 다시 읽은 목록으로 덮지 않는다
    const next: Record<number, string[]> = {};
    for (const s of sources) if (s.calendars) next[s.id] = s.calendars.filter((c) => c.visible).map((c) => c.id);
    savedRef.current = next;
    setVis(next);
  }, [sources]);

  const toggle = useCallback((src: PersonalCalSource, cal: GoogleCal) => {
    if (cal.is_write || !src.can_list) return;   // 올리는 캘린더는 늘 보인다
    const cur = visRef.current[src.id] || [];
    const on = cur.includes(cal.id);
    if (!on && cur.length >= (src.visible_max || 15)) return;
    dirtyRef.current = true;
    const nextList = on ? cur.filter((x) => x !== cal.id) : [...cur, cal.id];
    const next = { ...visRef.current, [src.id]: nextList };
    visRef.current = next;
    setVis(next);
  }, []);

  const persist = useCallback(async () => {
    const cur = visRef.current;
    const same = (a: string[] = [], b: string[] = []) => a.length === b.length && a.every((x) => b.includes(x));
    const changed = Object.keys(cur).map(Number).filter((id) => !same(cur[id], savedRef.current[id]));
    if (!changed.length) { dirtyRef.current = false; return; }
    for (const id of changed) {
      const r = await apiFetch('/api/me/calendar/visible-calendars', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connection_id: id, calendar_ids: cur[id] }),
      });
      if (!r.ok) { dirtyRef.current = false; throw new Error('visible_calendars_failed'); }   // 던져야 ! 뱃지가 뜬다
      savedRef.current = { ...savedRef.current, [id]: cur[id] };
    }
    dirtyRef.current = false;
    onSaved();   // 새로 켠 캘린더 일정을 읽어 온다
  }, [onSaved]);

  /** 이 개인 일정이 지금 보이는 캘린더의 것인가 — 누르는 순간 화면에서 가린다(저장·재조회 전에도). */
  const isVisible = useCallback((connectionId: number, calendarId: string) => {
    const list = vis[connectionId];
    return !list || list.includes(calendarId);
  }, [vis]);

  return { vis, toggle, persist, isVisible };
}

// ── 상단 배치 (2026-10-13, Irene: *"헤더에는 전처럼 팀/개인/업무/구글 이렇게 큰 단위고 나머지 프로젝트별 … 필터가 있어야"* ·
//   *"구글캘린더 종류들 선택이 이렇게 구글 하위메뉴인지 알 수가 없어"*)
//   큰 단위(개인·팀·업무·Google) = 머리줄의 연회색 알약(CalendarLayerToggle, 폰에선 필터줄 맨 앞).
//   그 아래 필터줄 한 줄 = [프로젝트] │ [Google · 계정 › 캘린더 칩…] (GoogleCalendarGroup) — Google 이 켜졌을 때만, 자식임을 이름표로 말한다.
//   년/월·이동은 필터줄 아래.

/** 어느 계정인지 **보이는 글자**로 — 폰에서는 title 힌트가 안 뜬다(docs/TEAM_CALENDAR_PICK_DESIGN.md §3-2).
 *  한 계정이면 «irene@…», 둘 이상이면 «2계정». 이제 Google 묶음 이름표에 붙는다. */
function useGoogleWho(googleSources: PersonalCalSource[]) {
  const { t } = useTranslation('qcalendar');
  const calName = (s?: PersonalCalSource) =>
    (s && !s.calendar_primary && s.calendar_summary) ? s.calendar_summary : t('layer.googleDefault', '기본 캘린더');
  const accounts = Array.from(new Set(googleSources.map((s) => s.account_email).filter(Boolean))) as string[];
  const accountTag = accounts.length > 1
    ? t('layer.googleAccounts', { count: accounts.length, defaultValue: '{{count}}계정' }) as string
    : accounts.length === 1 ? `${accounts[0].split('@')[0]}@…` : '';
  const which = googleSources.map((s) => `${s.account_email || ''} — ${calName(s)}`).join('\n');
  return { accountTag, which, calName };
}

interface ToggleProps {
  layers: Set<CalLayer>;
  onToggle: (l: CalLayer) => void;
  /** 개인 구글 캘린더가 연결돼 있을 때만 Google 단위를 보인다 */
  googleConnected: boolean;
  googleSources: PersonalCalSource[];
  /** 폰 — 자리가 좁아 버튼 여백을 줄인다(360 폭에서 [알약][?][+] 가 한 줄) */
  compact?: boolean;
}

/** 큰 단위 — 개인 · 팀 · 업무 · Google. 누르는 대로 여러 개 켠다(켜진 것 = 흰 버튼). */
export const CalendarLayerToggle: React.FC<ToggleProps> = ({ layers, onToggle, googleConnected, googleSources, compact }) => {
  const { t } = useTranslation('qcalendar');
  const { which } = useGoogleWho(googleSources);
  const items: Array<{ key: CalLayer; label: string; hint: string }> = [
    { key: 'personal', label: t('layer.personal', '개인'), hint: t('layer.personalHint', '나만 보기로 만든 일정') },
    { key: 'team', label: t('layer.team', '팀'), hint: t('layer.teamHint', '팀·프로젝트와 함께 보는 일정') },
    { key: 'task', label: t('layer.task', '업무'), hint: t('layer.taskHint', 'Q task 업무의 마감일') },
  ];
  if (googleConnected) items.push({ key: 'google', label: t('layer.google', 'Google'), hint: `${t('layer.googleHint', '내 구글 캘린더 일정 — 끄면 구글 캘린더 전부를 가립니다')}${which ? `\n${which}` : ''}` });
  return (
    <LayerWrap>
      <LayerSeg data-testid="calendar-layers" role="group" aria-label={t('layer.group', '보기 분류') as string}>
        {items.map((it) => {
          const on = layers.has(it.key);
          return (
            <LayerBtn key={it.key} type="button" $active={on} $compact={compact} aria-pressed={on}
              onClick={() => onToggle(it.key)} title={it.hint} data-testid={`calendar-layer-${it.key}`}>
              <Box $on={on} aria-hidden="true">
                {on && <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>}
              </Box>
              {it.key === 'google' && <GDot />}
              {it.label}
            </LayerBtn>
          );
        })}
      </LayerSeg>
      <CalendarLayerHelp googleSources={googleSources} />
    </LayerWrap>
  );
};

/** 큰 단위 도움말 점 — 알약 바로 옆. */
const CalendarLayerHelp: React.FC<{ googleSources: PersonalCalSource[] }> = ({ googleSources }) => {
  const { t } = useTranslation('qcalendar');
  const { which } = useGoogleWho(googleSources);
  return (
    <HelpDot topic="calendar-layers" placement="auto">
        {t('layer.help', '누른 분류의 일정만 보입니다. 여러 개를 함께 켤 수 있어요.\n· 개인 — 나만 보기로 만든 일정\n· 팀 — 팀·프로젝트와 함께 보는 일정\n· 업무 — Q task 업무의 마감일\n· Google — 연결한 내 구글 캘린더. 캘린더마다 따로 켜고 끌 수 있어요(연필 표시는 PlanQ 일정을 올리는 캘린더라 늘 보입니다)')}
        {which ? `\n\n${which}` : ''}
    </HelpDot>
  );
};

/** 필터줄의 Google 묶음 — «Google · 계정 ›» 이름표 뒤에 그 계정의 캘린더 칩. Google 단위가 켜졌을 때만. */
export const GoogleCalendarGroup: React.FC<{
  sources: PersonalCalSource[];
  vis: ReturnType<typeof useGoogleCalendarVisibility>;
  businessId?: number | null;
  onReload?: () => void;
}> = ({ sources, vis, businessId, onReload }) => {
  const { t } = useTranslation('qcalendar');
  const { accountTag, which, calName } = useGoogleWho(sources);
  const anyList = sources.some((s) => s.can_list);
  return (
    <GroupBox data-testid="calendar-google-group" role="group" aria-label={t('layer.googleGroup', 'Google 캘린더') as string}>
      <GroupLabel title={which || undefined}>
        <GDot />
        <span>{t('layer.google', 'Google')}</span>
        {/* 목록 권한이 없으면 칩이 없다 — 지금 보는 캘린더 이름을 이름표에 붙인다(종전 «Google · 이름») */}
        {!anyList && sources[0] && <GroupSub>· {calName(sources[0])}</GroupSub>}
        {accountTag && <GroupSub>· {accountTag}</GroupSub>}
        <Caret aria-hidden="true">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
        </Caret>
      </GroupLabel>
      <GoogleCalendarChips sources={sources} vis={vis} businessId={businessId} onReload={onReload} />
    </GroupBox>
  );
};

// 필터줄 — 한 줄. 넘치면 줄을 바꾸지 않고 옆으로 민다(폰·좁은 태블릿).
export const FilterLine = styled.div`
  display: flex; align-items: center; gap: 8px; flex-wrap: nowrap;
  padding-bottom: 12px; margin-bottom: 4px; border-bottom: 1px solid #F1F5F9;
  overflow-x: auto; overscroll-behavior-x: contain;
  scrollbar-width: none; &::-webkit-scrollbar { display: none; }
`;
const LayerWrap = styled.div`display: inline-flex; align-items: center; gap: 4px; flex-shrink: 0;`;
// 연회색 알약(segmentedToggle) 그대로 — 머리줄 32.
const LayerSeg = styled(SegmentedToggle)``;
const LayerBtn = styled(SegmentedBtn)<{ $compact?: boolean }>`
  gap: ${(p) => (p.$compact ? 4 : 6)}px; padding: 0 ${(p) => (p.$compact ? 7 : 10)}px;
`;
// 여러 개를 함께 켜는 버튼이라는 것을 모양으로 — 작은 체크 상자(라디오처럼 하나만 고르는 탭과 구별)
const Box = styled.span<{ $on: boolean }>`
  width: 0.8125rem; height: 0.8125rem; border-radius: 3px; flex-shrink: 0; box-sizing: border-box;
  display: inline-flex; align-items: center; justify-content: center; color: #fff;
  border: 1px solid ${(p) => (p.$on ? '#0D9488' : '#94A3B8')}; background: ${(p) => (p.$on ? '#0D9488' : 'transparent')};
`;
// 필터줄 안의 한 묶음 — 이름표 + 자식 칩. 앞 묶음과는 칸막이로 가른다.
const GroupBox = styled.div`
  display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0;
  padding-left: 10px; border-left: 1px solid #E2E8F0;
`;
const GroupLabel = styled.span`
  display: inline-flex; align-items: center; gap: 5px; flex-shrink: 0; white-space: nowrap;
  font-size: 0.75rem; font-weight: 700; color: #334155;
`;
const GroupSub = styled.span`font-weight: 500; color: #64748B;`;
const Caret = styled.span`display: inline-flex; color: #94A3B8;`;
// 칩 높이 — 필터줄 규격 36(공용 알약 그대로).
const Chip = styled(FilterChip)`
  gap: 6px;
`;
// 단위 버튼의 G 점 = 일정 칩 앞의 출처 점(sourceLook.SourceDot)과 같은 모양(10px · 흰 테두리).
const GDot = styled.span`
  width: 10px; height: 10px; border-radius: 50%; background: ${GOOGLE_FALLBACK_COLOR}; box-shadow: 0 0 0 1.5px #fff; flex-shrink: 0;
`;

/** 구글 캘린더별 칩 — 앞 5개는 칩, 나머지는 «+N» 팝오버. 목록 권한이 없으면 «다른 캘린더» 에서 권한을 묻는다. */
const MAX_INLINE = 5;

const GoogleCalendarChips: React.FC<{
  sources: PersonalCalSource[];
  vis: ReturnType<typeof useGoogleCalendarVisibility>;
  businessId?: number | null;
  onReload?: () => void;
}> = ({ sources, vis, businessId, onReload }) => {
  const { t } = useTranslation('qcalendar');
  const multiAccount = sources.length > 1;
  const all = sources.flatMap((src) => (src.calendars || []).map((cal) => ({ src, cal })));
  const nameOf = (cal: GoogleCal) => (cal.primary ? t('layer.googleDefault', '기본 캘린더') : (cal.summary || t('layer.googleDefault', '기본 캘린더')));
  const isOn = (src: PersonalCalSource, cal: GoogleCal) => cal.is_write || (vis.vis[src.id] || []).includes(cal.id);
  const titleOf = (src: PersonalCalSource, cal: GoogleCal) => [
    multiAccount && src.account_email ? src.account_email : null,
    cal.is_write ? t('layer.googleWriteHint', 'PlanQ 일정을 올리는 캘린더 — 늘 보입니다') : null,
    cal.ok === false ? t('layer.googleCalFailed', '이 캘린더를 불러오지 못했습니다') : null,
  ].filter(Boolean).join('\n') || undefined;
  const inline = all.slice(0, MAX_INLINE);
  const rest = all.slice(MAX_INLINE);
  const needConsent = sources.filter((s) => !s.can_list);
  const listFailed = sources.some((s) => s.can_list && s.list_error);
  return (
    <AutoSaveField type="toggle" onSave={vis.persist}>
      <SubRow data-testid="calendar-google-cals">
        {inline.map(({ src, cal }) => {
          const on = isOn(src, cal);
          return (
            <Chip key={`${src.id}|${cal.id}`} type="button" $on={on} aria-pressed={on}
              aria-disabled={cal.is_write || !src.can_list || undefined}
              onClick={() => vis.toggle(src, cal)} title={titleOf(src, cal)}
              data-testid="calendar-google-cal" data-cal-id={cal.id}>
              <Dot style={{ background: calColor(cal.color) }} $off={!on} aria-hidden="true" />
              {cal.is_write && (
                <Pen aria-hidden="true">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                </Pen>
              )}
              <CalName>{nameOf(cal)}</CalName>
              {cal.ok === false && <Warn aria-hidden="true">!</Warn>}
            </Chip>
          );
        })}
        {rest.length > 0 && (
          <MorePopover label={`+${rest.length}`} ariaLabel={t('layer.googleMore', '다른 구글 캘린더') as string}
            data-testid="calendar-google-more" width={260}>
            {() => (
              <PopList>
                {rest.map(({ src, cal }) => {
                  const on = isOn(src, cal);
                  return (
                    <PopItem key={`${src.id}|${cal.id}`} type="button" aria-pressed={on}
                      onClick={() => vis.toggle(src, cal)} title={titleOf(src, cal)} data-testid="calendar-google-cal" data-cal-id={cal.id}>
                      <Check $on={on} aria-hidden="true">
                        {on && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>}
                      </Check>
                      <Dot style={{ background: calColor(cal.color) }} $off={!on} aria-hidden="true" />
                      <CalName>{nameOf(cal)}</CalName>
                    </PopItem>
                  );
                })}
              </PopList>
            )}
          </MorePopover>
        )}
        {(needConsent.length > 0 || listFailed) && (
          <MorePopover label={t('layer.googleOther', '다른 캘린더') as string} data-testid="calendar-google-consent" width={280}>
            {() => (
              <PopNote>
                <span>{listFailed && !needConsent.length
                  ? t('layer.googleListFailed', '구글 캘린더 목록을 불러오지 못했습니다. 잠시 뒤 다시 열어 주세요.')
                  : t('layer.googleNeedList', '지금은 일정을 올리는 캘린더 하나만 보입니다. 다른 캘린더(보조·공유·공휴일)도 보려면 구글에서 «캘린더 목록 보기» 를 한 번 더 허용해 주세요.')}</span>
                {needConsent.length > 0 && (
                  <GoogleCalendarListConsent businessId={businessId} onDone={onReload} data-testid="calendar-google-allow" />
                )}
              </PopNote>
            )}
          </MorePopover>
        )}
      </SubRow>
    </AutoSaveField>
  );
};

// 필터줄은 한 줄이다 — 칩이 많으면 줄이 옆으로 밀린다(줄 바꿈 없음).
const SubRow = styled.div`
  display: flex; align-items: center; gap: 6px; flex-wrap: nowrap;
`;
const Dot = styled.span<{ $off?: boolean }>`
  width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; opacity: ${(p) => (p.$off ? 0.35 : 1)};
`;
const Pen = styled.span`display: inline-flex; color: #64748B;`;
const CalName = styled.span`max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`;
const Warn = styled.span`font-weight: 700; color: #DC2626;`;
// 팝오버 칩도 같은 줄 높이(36)
const MorePopover = styled(ChipPopover)`
  & > button { height: 36px; border-radius: 999px; }
`;
const PopList = styled.div`display: flex; flex-direction: column; max-height: 320px; overflow-y: auto; padding: 4px 0;`;
const PopItem = styled.button`
  all: unset; box-sizing: border-box; display: flex; align-items: center; gap: 8px; width: 100%;
  min-height: 36px; padding: 6px 12px; cursor: pointer; font-size: 0.8125rem; color: #334155;
  &:hover { background: #F8FAFC; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: -2px; }
`;
const Check = styled.span<{ $on: boolean }>`
  width: 16px; height: 16px; border-radius: 4px; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center;
  font-size: 0.6875rem; font-weight: 700; color: #fff;
  border: 1px solid ${(p) => (p.$on ? '#0D9488' : '#CBD5E1')}; background: ${(p) => (p.$on ? '#0D9488' : '#fff')};
`;
const PopNote = styled.div`
  display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; font-size: 0.75rem; color: #475569; line-height: 1.5;
  white-space: normal;
`;
