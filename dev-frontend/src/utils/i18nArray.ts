// t(key, { returnObjects: true }) 는 **번역 리소스가 도착하기 전에는 키 문자열**을 돌려준다(i18n.ts useSuspense:false).
//   그 값에 .map 을 걸면 TypeError 로 화면 전체가 ErrorBoundary 에 덮인다 — 캐시 없는 첫 방문에서만 나서 늦게 보인다
//   (2026-04 /privacy·/terms, 2026-10-02 /about 간헐 크래시). 배열일 때만 통과시킨다.
export function i18nArray<T = string>(v: unknown, fallback: T[] = []): T[] {
  return Array.isArray(v) ? (v as T[]) : fallback;
}
