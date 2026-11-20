// 근무시간 한 줄 — 서버 `services/booking.js serializeWorkHours` 모양({mon:[9,18],…,sat:null})을 사람이 읽는 글로.
//   같은 시간인 이어진 요일은 묶는다: «월–금 09:00–18:00 · 토 10:00–14:00». 쉬는 날은 적지 않는다.
import type { TFunction } from 'i18next';

export type WorkHours = Partial<Record<'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun', [number, number] | null>>;
const ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

const hhmm = (h: number) => `${String(Math.floor(h)).padStart(2, '0')}:${h % 1 ? '30' : '00'}`;

export function formatWorkHours(wh: WorkHours, t: TFunction): string | null {
  // 요일 이름은 guest 네임스페이스 entry.day.* (ko/en) — 여기 글자로 적지 않는다(i18n 가드).
  const day = (k: string) => t(`entry.day.${k}`, { defaultValue: k }) as string;
  const groups: { from: string; to: string; range: string }[] = [];
  for (const k of ORDER) {
    const v = wh[k];
    if (!v) continue;
    const range = `${hhmm(v[0])}–${hhmm(v[1])}`;
    const last = groups[groups.length - 1];
    const prevKey = ORDER[ORDER.indexOf(k) - 1];
    if (last && last.range === range && last.to === prevKey) last.to = k;
    else groups.push({ from: k, to: k, range });
  }
  if (!groups.length) return null;
  return groups.map((g) => `${g.from === g.to ? day(g.from) : `${day(g.from)}–${day(g.to)}`} ${g.range}`).join(' · ');
}
