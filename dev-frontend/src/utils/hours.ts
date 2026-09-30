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

/**
 * 시간 칸 blur 가 **값을 바꿨는가** (2026-09-30).
 *   칸은 눌렀다 떼기만 해도 blur 가 난다. 그대로 저장하면 ①반복 업무에서 «어디까지 반영» 창이 까닭 없이 뜨고
 *   ②실제 시간은 서버가 actual_source 를 'user' 로 바꿔 **자동 누적이 조용히 멈춘다**(실측: 목록 행 blur 만으로
 *   PATCH {actual_hours:0}). 비교 기준은 **칸에 처음 보여준 값(input.defaultValue)** 이다 — 모델 값과 비교하면 0 을 빈칸으로
 *   보여주는 칸에서 «빈칸 ≠ 0» 이 되어 또 저장했다. 표시와 판정이 같은 값을 봐야 한다.
 */
export function sameHours(next: number | string | null | undefined, prev: number | string | null | undefined): boolean {
  const norm = (v: number | string | null | undefined) => (v === null || v === undefined || v === '' ? null : Number(v));
  const a = norm(next), b = norm(prev);
  if (a === null || b === null) return a === b;
  return Math.abs(a - b) < 1e-9;
}
