import { useCallback, useMemo } from 'react';
import { formatDay, formatClock } from '../../utils/dateFormat';
import { addDays, addMonths, startOfDay, startOfMonth, startOfWeek } from './dateUtils';
// Q calendar 의 시간 기준 = **워크스페이스 시간대 설정** (2026-10-07).
//   Irene: "캘린더 화면 표시도 설정대로 당연히. 서울기준이 아니라. 워크스페이스 설정기준."
//   여태 격자·등록 창·상세의 편집칸은 **기기 시계**로 읽고 썼고, 상세의 표시 줄만 워크스페이스 시간대였다.
//   쿠알라룸푸르에서 서울 워크스페이스를 쓰면 등록 창의 «워크스페이스 시간대 기준» 안내와 달리 10:00 이
//   KL 10:00(=서울 11:00)으로 저장됐다. 바꾸는 곳을 **경계 한 곳**으로 모은다:
//     읽을 때  toWall(iso)        — 실제 시각 → 워크스페이스 벽시계(로컬 필드가 그 시각인 Date)
//     쓸 때    fromWall(y,m,d,…)  — 워크스페이스 벽시계 → 실제 시각(ISO)
//   화면 컴포넌트(TimeGridView·MonthView·AgendaView)는 그대로 로컬 필드를 읽는다 — 넘겨받는 값이 이미 벽시계다.

const pad = (n: number) => String(n).padStart(2, '0');

function partsIn(instant: Date, tz: string) {
  const f = new Intl.DateTimeFormat('en-US', { // datefmt-exempt: 표시가 아니라 시간대 변환용 숫자 분해
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const o: Record<string, number> = {};
  for (const p of f.formatToParts(instant)) if (p.type !== 'literal') o[p.type] = Number(p.value);
  return { y: o.year, mo: o.month, d: o.day, h: o.hour === 24 ? 0 : o.hour, mi: o.minute, s: o.second };
}

/** 이 화면이 쓰는 시간대가 기기와 같으면 변환이 필요 없다(대부분의 사용자). */
export function deviceTz(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}

/** 실제 시각 → 워크스페이스 벽시계 Date(로컬 getHours 등이 tz 의 시각을 돌려준다) */
export function toWall(v: string | Date, tz: string): Date {
  const instant = v instanceof Date ? v : new Date(v);
  if (!tz || Number.isNaN(instant.getTime()) || tz === deviceTz()) return new Date(instant);
  try {
    const p = partsIn(instant, tz);
    return new Date(p.y, p.mo - 1, p.d, p.h, p.mi, p.s, instant.getMilliseconds());
  } catch { return new Date(instant); }
}

/** 워크스페이스 벽시계(연·월·일·시·분) → 실제 시각 ISO. 서머타임 경계도 두 번 맞춰 수렴시킨다. */
export function fromWall(y: number, mo: number, d: number, h: number, mi: number, tz: string): string {
  if (!tz || tz === deviceTz()) return new Date(y, mo - 1, d, h, mi, 0).toISOString();
  try {
    const target = Date.UTC(y, mo - 1, d, h, mi, 0);
    let guess = target;
    for (let i = 0; i < 3; i++) {
      const p = partsIn(new Date(guess), tz);
      const seen = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
      const diff = target - seen;
      if (diff === 0) break;
      guess += diff;
    }
    return new Date(guess).toISOString();
  } catch { return new Date(y, mo - 1, d, h, mi, 0).toISOString(); }
}

/** 벽시계 Date(로컬 필드) → 실제 시각 ISO — toWall 의 역. */
export function wallDateToIso(wall: Date, tz: string): string {
  return fromWall(wall.getFullYear(), wall.getMonth() + 1, wall.getDate(), wall.getHours(), wall.getMinutes(), tz);
}

/** 'YYYY-MM-DD' + 'HH:mm'(워크스페이스 벽시계) → 실제 시각 ISO */
export function wallStringsToIso(dateStr: string, timeStr: string, tz: string): string {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const [h, mi] = (timeStr || '00:00').split(':').map(Number);
  return fromWall(y, mo, d, h, mi, tz);
}

/** 사람이 읽는 시간대 이름 — «대한민국 시간» · «말레이시아 시간» (약어 GMT+8 대신) */
export function tzFriendlyName(tz: string, lang: string, at: Date = new Date()): string {
  const locale = lang === 'en' ? 'en-US' : 'ko-KR';
  try {
    const p = new Intl.DateTimeFormat(locale, { timeZone: tz, timeZoneName: 'longGeneric' }).formatToParts(at); // datefmt-exempt: 시간대 이름(날짜 형식 설정과 무관)
    const v = p.find((x) => x.type === 'timeZoneName')?.value;
    if (v && !/^GMT/.test(v)) return v;
  } catch { /* noop */ }
  return (tz.split('/').pop() || tz).replace(/_/g, ' ');
}

/** 실제 시각 두 개를 tz 기준 «10월 8일 (목) 오전 9:00 – 10:00» 로 — 날짜가 다르면 끝에도 날짜를 붙인다.
 *  날짜·시각 모양은 사용자 설정(날짜 형식·12/24시간)을 따르는 utils/dateFormat 함수로 만든다. */
export function formatRangeIn(startIso: string, endIso: string, tz: string, lang: string): string {
  const s = new Date(startIso), e = new Date(endIso);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return '';
  const locale = lang === 'en' ? 'en-US' : 'ko-KR';
  const day = (x: Date) => formatDay(x, { tz, locale, weekday: true });
  const time = (x: Date) => formatClock(x, { tz, locale });
  const sameDay = toWall(s, tz).toDateString() === toWall(e, tz).toDateString();
  return sameDay ? `${day(s)} ${time(s)} – ${time(e)}` : `${day(s)} ${time(s)} – ${day(e)} ${time(e)}`;
}

/**
 * 화면(격자·월·목록)에 넘길 일정 — 시간 일정만 워크스페이스 벽시계로. 종일은 날짜라 옮기지 않는다(8일 종일이 7일로 가면 안 된다).
 * 화면이 돌려주는 회차 날짜(start_at.slice)는 **원래 값**으로 되돌린다 — 회차 식별자가 바뀌면 다른 회차를 고친다.
 */
export function useWallEvents<T extends { id: number | string; all_day?: boolean; start_at: string; end_at: string }>(
  items: T[], tz: string, onSelect: (id: number | string, instanceDate?: string) => void,
) {
  const { viewEvents, back } = useMemo(() => {
    const m = new Map<string, string>();
    const out = items.map((e) => {
      if (e.all_day || !e.start_at || !e.end_at) return e;
      const s = toWall(e.start_at, tz).toISOString();
      m.set(`${e.id}|${s.slice(0, 10)}`, e.start_at.slice(0, 10));
      return { ...e, start_at: s, end_at: toWall(e.end_at, tz).toISOString() };
    });
    return { viewEvents: out, back: m };
  }, [items, tz]);
  const selectFromView = useCallback((id: number | string, instanceDate?: string) => {
    onSelect(id, instanceDate ? (back.get(`${id}|${instanceDate}`) ?? instanceDate) : instanceDate);
  }, [onSelect, back]);
  return { viewEvents, selectFromView };
}

/** 보기마다 가져올 날짜 범위(벽시계 경계) — 목록=그 달, 월=6주 격자, 주=7일, 일=하루. */
export function viewRange(view: string, anchor: Date, weekStart: 0 | 1): { start: Date; end: Date } {
  if (view === 'agenda') return { start: startOfMonth(anchor), end: startOfMonth(addMonths(anchor, 1)) };   // #133 그 달
  if (view === 'month') { const st = startOfWeek(startOfMonth(anchor), weekStart); return { start: st, end: addDays(st, 42) }; }
  if (view === 'week') { const st = startOfWeek(anchor, weekStart); return { start: st, end: addDays(st, 7) }; }
  const st = startOfDay(anchor); return { start: st, end: addDays(st, 1) };
}

export const _test = { pad };
