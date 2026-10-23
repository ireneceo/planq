// 프로젝트 순서 — 사람별 별(즐겨찾기)·직접 정렬의 **정렬 술어 한 벌** (2026-10-23, docs/PROJECT_PREFS_DESIGN.md · Fable DESIGN-OK).
//
//   서버 GET /api/projects 가 행마다 `my_pinned_at`·`my_sort_order` 를 싣는다(대화방 my_pinned_at 과 같은 이름).
//   - 별 먼저는 **모든 정렬·모든 화면 공통**(Q talk 대화방과 같은 규칙).
//   - 직접 정렬(manual) = my_sort_order 오름차순. 번호 없는 것(그 뒤 새로 만든 프로젝트)은 번호 있는 것보다 **위**에,
//     그들끼리 최신순 — 새로 만든 것이 묻히지 않는다. 다음 끌기 때 번호를 받는다. (Fable: 이 방향을 뒤집지 않는다)
//   - 내 순서 행이 하나라도 있으면 기본 정렬 = manual(파생 — 정렬 선택을 따로 저장하지 않는다).
//   프로젝트 목록·상세·고르는 셀렉트·Q file 트리가 이 파일만 쓴다(화면마다 다시 쓰면 갈라진다).

export interface ProjectPrefFields {
  id: number;
  my_pinned_at?: string | null;
  my_sort_order?: number | null;
  updatedAt?: string | null;
  updated_at?: string | null;
  createdAt?: string | null;
  created_at?: string | null;
}

export const isStarred = (p: ProjectPrefFields) => !!p.my_pinned_at;

/** 이 목록에 내 직접 정렬 번호가 하나라도 있나 — 있으면 기본 정렬이 «직접 정렬» 이다. */
export const hasManualOrder = (list: ProjectPrefFields[]) => list.some((p) => p.my_sort_order != null);

const recentKey = (p: ProjectPrefFields) => p.updatedAt || p.updated_at || p.createdAt || p.created_at || '';
const createdKey = (p: ProjectPrefFields) => p.createdAt || p.created_at || '';

/** 직접 정렬 비교 — 번호 없는 것이 위(그들끼리 최신 생성순), 번호 있는 것은 번호순. */
export function compareManual(a: ProjectPrefFields, b: ProjectPrefFields): number {
  const an = a.my_sort_order, bn = b.my_sort_order;
  if (an == null && bn == null) return createdKey(b).localeCompare(createdKey(a)) || b.id - a.id;
  if (an == null) return -1;
  if (bn == null) return 1;
  return an - bn;
}

/** 최근순 비교(최근 수정, 없으면 생성 — 내림차순). 프로젝트 목록 «최근순» 과 같은 것. */
export function compareRecent(a: ProjectPrefFields, b: ProjectPrefFields): number {
  return recentKey(b).localeCompare(recentKey(a));
}

/** 별 먼저 → 그 안은 cmp. 안정 정렬(같으면 들어온 순서). */
export function starFirst<T extends ProjectPrefFields>(list: T[], cmp?: (a: T, b: T) => number): T[] {
  return list
    .map((p, i) => ({ p, i }))
    .sort((x, y) => {
      const s = Number(isStarred(y.p)) - Number(isStarred(x.p));
      if (s) return s;
      const c = cmp ? cmp(x.p, y.p) : 0;
      return c || x.i - y.i;
    })
    .map((x) => x.p);
}

/**
 * 프로젝트 밖 목록(고르는 셀렉트·트리)의 기본 순서 — 별 먼저 → 내 직접 정렬이 있으면 그 순서 → 아니면 들어온 순서.
 * 화면이 자기 정렬(파일 수 등)을 쓰는 곳은 starFirst(list, 자기 비교) 를 쓴다.
 */
export function orderProjectsForMe<T extends ProjectPrefFields>(list: T[]): T[] {
  return starFirst(list, hasManualOrder(list) ? compareManual : undefined);
}

/**
 * 끌어 놓기 결과 — 지금 화면 순서(ids)에서 dragId 를 targetId 앞/뒤로 옮긴 새 순서.
 * 같은 별 묶음 안에서만 옮긴다(가로지르면 null — 별 먼저가 이겨 «아무 일 없음» 이 된다).
 */
export function moveWithin(order: ProjectPrefFields[], dragId: number, targetId: number, after: boolean): number[] | null {
  if (dragId === targetId) return null;
  const drag = order.find((p) => p.id === dragId);
  const target = order.find((p) => p.id === targetId);
  if (!drag || !target || isStarred(drag) !== isStarred(target)) return null;
  const ids = order.map((p) => p.id).filter((id) => id !== dragId);
  const at = ids.indexOf(targetId) + (after ? 1 : 0);
  ids.splice(at, 0, dragId);
  return ids;
}

/** ⋯ 메뉴 «맨 위로/위로/아래로» — 같은 별 묶음 안에서만. 못 움직이면 null. */
export function moveBy(order: ProjectPrefFields[], id: number, how: 'top' | 'up' | 'down'): number[] | null {
  const me = order.find((p) => p.id === id);
  if (!me) return null;
  const group = order.filter((p) => isStarred(p) === isStarred(me));
  const gi = group.findIndex((p) => p.id === id);
  let target: ProjectPrefFields | undefined;
  if (how === 'top') target = gi > 0 ? group[0] : undefined;
  else if (how === 'up') target = group[gi - 1];
  else target = group[gi + 1];
  if (!target) return null;
  return moveWithin(order, id, target.id, how === 'down');
}

/** 그 묶음 안에서 움직일 수 있는 방향(메뉴 비활성 판단). */
export function canMove(order: ProjectPrefFields[], id: number): { up: boolean; down: boolean } {
  const me = order.find((p) => p.id === id);
  if (!me) return { up: false, down: false };
  const group = order.filter((p) => isStarred(p) === isStarred(me));
  const gi = group.findIndex((p) => p.id === id);
  return { up: gi > 0, down: gi >= 0 && gi < group.length - 1 };
}
