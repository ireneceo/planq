// 이미 끝난 일정이 캘린더 칸에서 **어떻게 보이는가** — 한 벌 (2026-10-10)
//   Irene: "이미 지난 일정은 약간 비활성화 된 것처럼 색상이 좀 죽어있거나 해야 하지 않아?"
//   구글·애플·아웃룩 캘린더처럼 끝난 일정은 색을 죽인다(누를 수는 그대로 — 기록을 보러 들어간다).
//   이어서(10-11): "업무일정은 적용이 안되고 있어. 그리고 오늘 이전은 연회색으로 날짜가 지난 걸 시각적으로 알게 해줘."
//   → 업무 마감도 같은 규칙(마감일이 다 지나면 흐림) · 오늘 이전 **날짜 칸** 자체를 연회색(pastDay*).
// ★ 월간 칸·월간 팝오버·종일·시간표·목록 **다섯 곳**이 같은 조각을 쓴다(bookingLook 과 같은 이유).
// ★ 비교 기준은 화면과 같은 **워크스페이스 벽시계**(calTz.toWall) — 넘겨받는 일정도 벽시계다.
import { useEffect, useState } from 'react';
import { css } from 'styled-components';
import type { CalendarItem } from './types';
import { toDateKey } from './dateUtils';
import { toWall } from './calTz';

/** data-past 값 — 끝난 일정이면 '1', 아니면 undefined(속성 없음). */
export function pastAttr(e: CalendarItem, now: Date): '1' | undefined {
  if (!e.end_at) return undefined;
  const end = new Date(e.end_at).getTime();
  return Number.isFinite(end) && end <= now.getTime() ? '1' : undefined;
}

export const pastCss = css`
  &[data-past='1'] { opacity: 0.55; }
  &[data-past='1']:hover { opacity: 0.85; }
`;

/** data-pastday 값 — 오늘(벽시계)보다 앞선 날짜 칸이면 '1'. 날짜 키(YYYY-MM-DD)는 글자 순서 = 날짜 순서. */
export function pastDayAttr(day: Date, today: Date): '1' | undefined {
  return toDateKey(day) < toDateKey(today) ? '1' : undefined;
}

/** 지난 날짜 칸의 연회색 바탕 · 지난 날짜 글자 색 — 월 칸·주/일 열·목록 머리줄이 같은 값을 쓴다. */
export const PAST_DAY_BG = '#F1F5F9';
export const PAST_DAY_BG_HOVER = '#E9EEF4';
export const PAST_DAY_TEXT = '#94A3B8';

/** 워크스페이스 벽시계 «지금» — 1분마다 갱신(열어 둔 화면에서도 끝난 일정이 흐려지게). */
export function useWallNow(tz: string): Date {
  const [now, setNow] = useState(() => toWall(new Date(), tz));
  useEffect(() => {
    setNow(toWall(new Date(), tz));
    const id = window.setInterval(() => setNow(toWall(new Date(), tz)), 60_000);
    return () => window.clearInterval(id);
  }, [tz]);
  return now;
}
