// 복사한 업무는 원본 바로 아래에 보인다 (2026-10-29, Irene «복사가 안돼. 바로 아래 추가되어야지 복사된거»).
//
// 서버는 복사본에 원본의 담당자·날짜·추진과제를 그대로 준다(routes/tasks.js /copy) — 그래서 정렬 열이 같아
// 대개 옆에 오지만, 같은 값 사이의 순서(제목·id)나 주간 순위(#) 때문에 몇 줄 떨어질 수 있다.
// 이 화면에서 방금 복사한 것만 기억해(복사본 id → 원본 id) 정렬 뒤 원본 바로 아래로 옮긴다.
// 새로고침하면 기억은 사라지고 평소 정렬로 돌아간다 — 순서를 저장하는 기능이 아니라 «방금 만든 것이 어디 있는지» 다.

export type CopyAnchors = ReadonlyMap<number, number>;

/** rows 안에서 각 복사본을 원본 바로 아래로 옮긴다. 원본이 rows 에 없거나 canAnchor 가 거절하면 그대로 둔다. */
export function placeCopiesBelow<T extends { id: number }>(
  rows: T[], anchors: CopyAnchors, canAnchor?: (src: T, copy: T) => boolean,
): T[] {
  if (!anchors.size) return rows;
  let out = rows;
  anchors.forEach((srcId, copyId) => {
    const ci = out.findIndex((r) => r.id === copyId);
    const si = out.findIndex((r) => r.id === srcId);
    if (ci < 0 || si < 0) return;
    if (canAnchor && !canAnchor(out[si], out[ci])) return;
    if (ci === si + 1) return;
    const next = out.slice();
    const [copy] = next.splice(ci, 1);
    next.splice(next.findIndex((r) => r.id === srcId) + 1, 0, copy);
    out = next;
  });
  return out;
}

/** 복사 API 응답에서 새 업무를 꺼낸다(소켓 task:new 보다 먼저 목록에 넣을 수 있게). */
export async function copiedTask<T extends { id: number }>(r: Response): Promise<T | null> {
  const j = await r.json().catch(() => null);
  return j?.data && typeof j.data.id === 'number' ? (j.data as T) : null;
}
