import { useEffect, useState } from 'react';
import { fetchStatus } from '../services/plan';

/**
 * 휴지통 보관 일수 — 요금제 값(GET /api/plan/:biz/status → plan.limits.trash_retention_days). (0-D)
 *   삭제 확인창 문구가 «30일» 을 박아 두면 요금제와 갈라진다(free 7일인데 30일이라 말하던 것).
 *   숫자는 서버가 정하고 화면은 보간만 한다. 못 읽으면 null — 호출부는 숫자 없는 일반 문장을 쓴다.
 *   같은 워크스페이스는 60초 캐시(확인창이 열릴 때마다 /status 를 부르지 않게).
 */
const cache = new Map<number, { at: number; days: number | null; p?: Promise<number | null> }>();
const TTL = 60_000;

function load(businessId: number): Promise<number | null> {
  const hit = cache.get(businessId);
  if (hit && Date.now() - hit.at < TTL) return hit.p || Promise.resolve(hit.days);
  const p = fetchStatus(businessId)
    .then((st) => {
      const v = st?.plan?.limits?.trash_retention_days;
      const days = Number.isInteger(v) && (v as number) > 0 ? (v as number) : null;
      cache.set(businessId, { at: Date.now(), days });
      return days;
    })
    .catch(() => { cache.delete(businessId); return null; });
  cache.set(businessId, { at: Date.now(), days: hit?.days ?? null, p });
  return p;
}

export function useTrashRetentionDays(businessId: number | null | undefined): number | null {
  const [days, setDays] = useState<number | null>(() => (businessId ? cache.get(businessId)?.days ?? null : null));
  useEffect(() => {
    if (!businessId) { setDays(null); return undefined; }
    let alive = true;
    void load(businessId).then((d) => { if (alive) setDays(d); });
    return () => { alive = false; };
  }, [businessId]);
  return days;
}
