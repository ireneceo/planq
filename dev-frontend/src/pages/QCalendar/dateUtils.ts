// 로컬 타임존 기준 날짜 유틸 — 캘린더 뷰 계산 전용

export const startOfDay = (d: Date): Date => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

export const endOfDay = (d: Date): Date => {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
};

export const addDays = (d: Date, n: number): Date => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

export const addMonths = (d: Date, n: number): Date => {
  const x = new Date(d);
  x.setMonth(x.getMonth() + n);
  return x;
};

// 주의 시작 = 일요일 (0). 필요 시 월요일(1)로 바꿀 수 있도록 weekStart 인자 지원.
export const startOfWeek = (d: Date, weekStart: 0 | 1 = 0): Date => {
  const x = startOfDay(d);
  const diff = (x.getDay() - weekStart + 7) % 7;
  x.setDate(x.getDate() - diff);
  return x;
};

export const startOfMonth = (d: Date): Date => {
  const x = startOfDay(d);
  x.setDate(1);
  return x;
};

export const endOfMonth = (d: Date): Date => {
  const x = startOfMonth(addMonths(d, 1));
  return new Date(x.getTime() - 1);
};

export const isSameDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

export const isSameMonth = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();

// 월 그리드 (6주 * 7일 = 42 칸) 의 모든 날짜 배열
export const getMonthGridDays = (anchor: Date, weekStart: 0 | 1 = 0): Date[] => {
  const firstOfMonth = startOfMonth(anchor);
  const gridStart = startOfWeek(firstOfMonth, weekStart);
  const days: Date[] = [];
  for (let i = 0; i < 42; i += 1) days.push(addDays(gridStart, i));
  return days;
};

// 주 뷰의 7일
export const getWeekDays = (anchor: Date, weekStart: 0 | 1 = 0): Date[] => {
  const start = startOfWeek(anchor, weekStart);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
};

// ISO 날짜 (YYYY-MM-DD) — 로컬 기준
export const toDateKey = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

// Date → "HH:mm"
export const formatTime = (d: Date): string => {
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
};

// "YYYY-MM-DDTHH:mm" 입력값 (datetime-local) → ISO
export const localInputToISO = (value: string): string | null => {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
};

// ISO → "YYYY-MM-DDTHH:mm" (datetime-local 표시용)
export const isoToLocalInput = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day}T${hh}:${mm}`;
};

// 이벤트가 특정 날짜에 걸쳐있는지
export const eventOverlapsDay = (startAt: string, endAt: string, day: Date): boolean => {
  const s = new Date(startAt).getTime();
  const e = new Date(endAt).getTime();
  return s < endOfDay(day).getTime() && e > startOfDay(day).getTime();
};

// 특정 날짜에서 해당 이벤트가 보여질 시작/끝 (밀리초)
export const clipEventToDay = (startAt: string, endAt: string, day: Date) => {
  const dayStart = startOfDay(day).getTime();
  const dayEnd = endOfDay(day).getTime();
  const s = Math.max(new Date(startAt).getTime(), dayStart);
  const e = Math.min(new Date(endAt).getTime(), dayEnd);
  return { start: new Date(s), end: new Date(e) };
};
