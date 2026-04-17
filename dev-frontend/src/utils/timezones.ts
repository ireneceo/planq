// 타임존 유틸 + preset 목록
// DB 는 UTC 로 저장, 화면 표시는 사용자/워크스페이스 타임존으로 변환

export type TzOption = {
  value: string;          // IANA ID (예: "Asia/Seoul")
  city: string;           // 표시용 도시 (현지어 우선, 영어 fallback)
  region: string;         // 그룹 (예: "Asia", "America")
};

// 자주 쓰는 타임존 preset (검색하면 전체 Intl 목록이 나옴)
export const TIMEZONE_PRESETS: TzOption[] = [
  { value: 'Asia/Seoul', city: 'Seoul', region: 'Asia' },
  { value: 'Asia/Tokyo', city: 'Tokyo', region: 'Asia' },
  { value: 'Asia/Shanghai', city: 'Shanghai', region: 'Asia' },
  { value: 'Asia/Hong_Kong', city: 'Hong Kong', region: 'Asia' },
  { value: 'Asia/Singapore', city: 'Singapore', region: 'Asia' },
  { value: 'Asia/Kuala_Lumpur', city: 'Kuala Lumpur', region: 'Asia' },
  { value: 'Asia/Bangkok', city: 'Bangkok', region: 'Asia' },
  { value: 'Asia/Jakarta', city: 'Jakarta', region: 'Asia' },
  { value: 'Asia/Manila', city: 'Manila', region: 'Asia' },
  { value: 'Asia/Kolkata', city: 'Mumbai', region: 'Asia' },
  { value: 'Asia/Dubai', city: 'Dubai', region: 'Asia' },
  { value: 'Australia/Sydney', city: 'Sydney', region: 'Australia' },
  { value: 'Australia/Melbourne', city: 'Melbourne', region: 'Australia' },
  { value: 'Pacific/Auckland', city: 'Auckland', region: 'Pacific' },
  { value: 'Europe/London', city: 'London', region: 'Europe' },
  { value: 'Europe/Paris', city: 'Paris', region: 'Europe' },
  { value: 'Europe/Berlin', city: 'Berlin', region: 'Europe' },
  { value: 'Europe/Amsterdam', city: 'Amsterdam', region: 'Europe' },
  { value: 'Europe/Madrid', city: 'Madrid', region: 'Europe' },
  { value: 'Europe/Moscow', city: 'Moscow', region: 'Europe' },
  { value: 'America/New_York', city: 'New York', region: 'America' },
  { value: 'America/Chicago', city: 'Chicago', region: 'America' },
  { value: 'America/Denver', city: 'Denver', region: 'America' },
  { value: 'America/Los_Angeles', city: 'Los Angeles', region: 'America' },
  { value: 'America/Toronto', city: 'Toronto', region: 'America' },
  { value: 'America/Vancouver', city: 'Vancouver', region: 'America' },
  { value: 'America/Mexico_City', city: 'Mexico City', region: 'America' },
  { value: 'America/Sao_Paulo', city: 'São Paulo', region: 'America' },
  { value: 'Africa/Johannesburg', city: 'Johannesburg', region: 'Africa' },
  { value: 'UTC', city: 'UTC', region: 'UTC' },
];

// 전체 IANA 타임존 목록 (Intl 지원 시)
export function listAllTimezones(): string[] {
  try {
    const intlAny = Intl as typeof Intl & { supportedValuesOf?: (k: string) => string[] };
    if (typeof intlAny.supportedValuesOf === 'function') {
      return intlAny.supportedValuesOf('timeZone');
    }
  } catch { /* noop */ }
  return TIMEZONE_PRESETS.map((p) => p.value);
}

// IANA ID 에서 도시 이름 파싱 (preset 매칭 못 했을 때 fallback)
export function cityFromTz(tz: string): string {
  if (!tz) return '';
  const preset = TIMEZONE_PRESETS.find((p) => p.value === tz);
  if (preset) return preset.city;
  const parts = tz.split('/');
  const last = parts[parts.length - 1] || tz;
  return last.replace(/_/g, ' ');
}

// 현재 시간을 해당 타임존의 "HH:mm" 으로 포맷
export function formatTimeInTz(date: Date, tz: string, locale = 'en-US'): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date);
  } catch {
    return '--:--';
  }
}

// 현재 시간을 해당 타임존의 전체 문자열로 (예: "2026-04-17 14:30")
export function formatDateTimeInTz(date: Date, tz: string, locale = 'en-CA'): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date).replace(',', '');
  } catch {
    return '';
  }
}

// 해당 타임존의 UTC 오프셋 (예: "+09:00", "-05:00")
export function offsetFromTz(date: Date, tz: string): string {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'shortOffset',
    });
    const parts = fmt.formatToParts(date);
    const tzPart = parts.find((p) => p.type === 'timeZoneName');
    if (tzPart) {
      // "GMT+9" → "+09:00", "GMT" → "+00:00"
      const m = /GMT([+-]?\d{1,2})(?::?(\d{2}))?/.exec(tzPart.value);
      if (m) {
        const h = parseInt(m[1] || '0', 10);
        const mins = parseInt(m[2] || '0', 10);
        const sign = h >= 0 ? '+' : '-';
        return `${sign}${String(Math.abs(h)).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
      }
      if (tzPart.value === 'GMT') return '+00:00';
    }
  } catch { /* noop */ }
  return '';
}

// 해당 타임존의 약어 (예: "KST", "EST") — fallback 은 offset
export function abbrFromTz(date: Date, tz: string): string {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'short',
    });
    const parts = fmt.formatToParts(date);
    const tzPart = parts.find((p) => p.type === 'timeZoneName');
    if (tzPart && !tzPart.value.startsWith('GMT')) return tzPart.value;
  } catch { /* noop */ }
  return offsetFromTz(date, tz);
}

// 브라우저 기본 타임존
export function detectBrowserTz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
