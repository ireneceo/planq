// 이미 끝난 일정이 캘린더 칸에서 **어떻게 보이는가** — 한 벌 (2026-10-10)
//   Irene: "이미 지난 일정은 약간 비활성화 된 것처럼 색상이 좀 죽어있거나 해야 하지 않아?"
//   구글·애플·아웃룩 캘린더처럼 끝난 일정은 색을 죽인다(누를 수는 그대로 — 기록을 보러 들어간다).
// ★ 월간 칸·월간 팝오버·종일·시간표·목록 **다섯 곳**이 같은 조각을 쓴다(bookingLook 과 같은 이유).
// ★ 업무(마감)는 흐리게 하지 않는다 — 마감이 지난 미완료 업무는 «끝난 것» 이 아니라 «늦은 것» 이다.
// ★ 비교 기준은 화면과 같은 **워크스페이스 벽시계**(calTz.toWall) — 넘겨받는 일정도 벽시계다.
import { useEffect, useState } from 'react';
import { css } from 'styled-components';
import type { CalendarItem } from './types';
import { isTaskEvent } from './taskToEvent';
import { toWall } from './calTz';

/** data-past 값 — 끝난 일정이면 '1', 아니면 undefined(속성 없음). */
export function pastAttr(e: CalendarItem, now: Date): '1' | undefined {
  if (isTaskEvent(e) || !e.end_at) return undefined;
  const end = new Date(e.end_at).getTime();
  return Number.isFinite(end) && end <= now.getTime() ? '1' : undefined;
}

export const pastCss = css`
  &[data-past='1'] { opacity: 0.55; }
  &[data-past='1']:hover { opacity: 0.85; }
`;

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
