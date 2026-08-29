// lib/pageCache.ts — 화면 재진입 즉시 표시용 메모리 캐시 (stale-while-revalidate)
//
// 왜 필요한가 (Irene 2026-08-29):
//   "왜 열때 오래걸리고 메뉴마다 매번 로딩돼? 이미 본 건 그냥 열려야 하는 거 아니야?"
//
//   모바일은 탭 keep-alive 가 없는 단일 페이지 모드다. 메뉴를 옮기면 이전 페이지가 언마운트되고
//   다시 들어오면 `setLoading(true)` 로 시작해 네트워크를 기다린다. 서버가 독일이라 왕복만
//   수백 ms — 이미 본 화면인데 매번 빈 화면과 스피너를 다시 본다.
//
// 계약:
//   - **표시를 앞당길 뿐, 진실의 원천이 아니다.** 캐시로 첫 페인트를 채우고 곧바로 재조회한다.
//     서버 응답이 오면 그걸로 덮어쓴다(server fresh — feedback_visibility_refresh_server_fresh).
//   - 메모리 전용. 앱을 완전히 닫으면 사라진다. localStorage 에 워크스페이스 데이터를 눕히지
//     않는다(멀티테넌트·로그아웃 잔류 위험).
//   - 키에 **user + business 를 반드시 포함**한다(cacheKey 헬퍼가 강제). 로그아웃·워크스페이스
//     전환 시에는 그것과 별개로 clearPageCache() 로 통째로 비운다 — 겹쳐서 막는다.
//
// 쓰는 법 (페이지):
//   const key = cacheKey('todo', userId, bizId);
//   const [items, setItems] = useState<T[]>(() => readCache<T[]>(key) ?? []);
//   const [loading, setLoading] = useState(() => !hasCache(key));   // 캐시가 있으면 스피너 없이 시작
//   ... fetch 성공 시 setItems(fresh); writeCache(key, fresh);

interface Entry { at: number; data: unknown }

// 신선도 — 이 시간을 넘긴 캐시는 첫 페인트에 쓰지 않는다(오래된 화면을 새것처럼 보여주지 않기 위해).
//   재조회는 어차피 항상 돌기 때문에 길게 잡을 이유가 없다.
const TTL_MS = 5 * 60 * 1000;

// 상한 — 페이지 수 만큼만 쌓이지만 상세(id별) 키가 늘 수 있어 LRU 로 자른다.
const MAX_ENTRIES = 60;

const store = new Map<string, Entry>();

export function cacheKey(scope: string, userId: string | number | null | undefined, bizId: string | number | null | undefined, ...rest: (string | number | null | undefined)[]): string {
  // user/biz 가 아직 없으면 빈 키 — 호출부가 캐시를 건너뛰도록 ''(falsy) 를 돌려준다.
  if (!userId || !bizId) return '';
  return [scope, userId, bizId, ...rest.filter((v) => v !== null && v !== undefined)].join(':');
}

export function readCache<T>(key: string): T | undefined {
  if (!key) return undefined;
  const e = store.get(key);
  if (!e) return undefined;
  if (Date.now() - e.at > TTL_MS) { store.delete(key); return undefined; }
  // LRU — 읽은 항목을 뒤로 보낸다(Map 은 삽입 순서를 유지한다).
  store.delete(key); store.set(key, e);
  return e.data as T;
}

export function hasCache(key: string): boolean {
  return readCache(key) !== undefined;
}

export function writeCache(key: string, data: unknown): void {
  if (!key) return;
  store.delete(key);
  store.set(key, { at: Date.now(), data });
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
}

// 로그아웃 · 워크스페이스 전환 — 남의 데이터가 한 프레임이라도 비치지 않게 통째로 비운다.
export function clearPageCache(): void {
  store.clear();
}
