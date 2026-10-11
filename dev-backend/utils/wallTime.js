// 워크스페이스 시간대의 «벽시계» ↔ 순간(instant) 변환 + 일정 옮기기 계산 (2026-10-12).
//   Cue·외부 AI 의 «목요일 일정 월요일로» 가 같은 계산을 쓴다 — 미리보기(카드)와 실행이 갈라지지 않게 한 곳.
const ad = require('./allDayDate');

/** instant → 그 시간대의 벽시계 { date:'YYYY-MM-DD', time:'HH:MM', wd:0..6 } */
function wallOf(at, tz) {
  const d = at instanceof Date ? at : new Date(at);
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short',
  }).formatToParts(d).filter((x) => x.type !== 'literal').map((x) => [x.type, x.value]));
  const hh = String(Number(p.hour) % 24).padStart(2, '0');
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${hh}:${p.minute}`, wd: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) };
}

/** 그 시간대의 벽시계(날짜·시각) → instant. 오프셋을 두 번 맞춰 서머타임 경계도 견딘다. */
function wallToInstant(dateStr, timeStr, tz) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  const target = Date.UTC(y, m - 1, d, hh, mm);
  let guess = target;
  for (let i = 0; i < 2; i += 1) {
    const w = wallOf(new Date(guess), tz);
    const [wy, wm, wd] = w.date.split('-').map(Number);
    const [wh, wmin] = w.time.split(':').map(Number);
    guess += target - Date.UTC(wy, wm - 1, wd, wh, wmin);
  }
  return new Date(guess);
}

/** 일정 한 건 + 옮길 날짜(·시각) → 새 { start_at, end_at } (길이 유지). 종일은 날짜 수 유지. */
function computeMove(event, move, tz) {
  if (event.all_day) {
    const { date, last_date: last } = ad.allDayDates(event);
    const span = Math.round((Date.parse(`${last}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86400000);
    return ad.allDayRange(move.date, ad.addDays(move.date, Math.max(0, span)));
  }
  const st = move.start_time || wallOf(event.start_at, tz).time;
  const start = wallToInstant(move.date, st, tz);
  const dur = Math.max(0, new Date(event.end_at).getTime() - new Date(event.start_at).getTime());
  return { start_at: start, end_at: new Date(start.getTime() + dur) };
}

module.exports = { wallOf, wallToInstant, computeMove };
