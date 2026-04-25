// 시간 표시 통일 — 항상 소수점 1자리 (예: 4 → "4.0", 2.5 → "2.5", null → "0.0")
// 사용자 요청: "어떻게 입력하든 무조건 .0 소수점 1자리 나오게 해"
export function formatHours(n: number | string | null | undefined): string {
  if (n === null || n === undefined || n === '') return '0.0';
  const v = Number(n);
  if (!Number.isFinite(v)) return '0.0';
  return v.toFixed(1);
}

// 가용시간 사용률 (0~∞). 100 이상 = 초과.
export function utilizationPercent(used: number, capacity: number): number {
  if (capacity <= 0) return 0;
  return Math.round((used / capacity) * 100);
}

// 사용률에 따른 상태 컬러 (4단계)
export function utilizationStatus(percent: number): 'sufficient' | 'optimal' | 'limit' | 'over' {
  if (percent < 70) return 'sufficient';
  if (percent < 95) return 'optimal';
  if (percent <= 100) return 'limit';
  return 'over';
}

export const UTIL_COLOR: Record<ReturnType<typeof utilizationStatus>, { bar: string; text: string; bg: string }> = {
  sufficient: { bar: '#16A34A', text: '#166534', bg: '#F0FDF4' },
  optimal:    { bar: '#0D9488', text: '#0F766E', bg: '#F0FDFA' },
  limit:      { bar: '#F59E0B', text: '#92400E', bg: '#FEF3C7' },
  over:       { bar: '#F43F5E', text: '#9F1239', bg: '#FFE4E6' },
};
