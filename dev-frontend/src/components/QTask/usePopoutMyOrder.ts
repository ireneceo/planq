// 팝아웃 «내 순서» — 서버 순서 반영·끌어 옮기기 저장·실시간 (docs/TASK_USER_ORDER_DESIGN.md · Fable 2026-10-12)
//   TaskPopoutView 가 god-file 임계(800줄) 근처라 절출. 쓰는 문은 서버 PUT /api/tasks/my-order 하나다.
//   ★ 순서는 사람별이다 — 실시간은 내 user 방의 `task:my-order` 만 받는다(동료의 순서와 무관).
import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { apiFetch } from '../../contexts/AuthContext';
import { onSocket } from '../../services/socket';

interface Positioned { id: number; my_pos?: number | null }
type Pos = Array<{ task_id: number; pos: number }>;

export function usePopoutMyOrder<T extends Positioned>({
  bizId, setTasks, silentLoad,
}: {
  bizId: number | null;
  setTasks: Dispatch<SetStateAction<T[]>>;
  silentLoad: () => unknown;
}) {
  const [orderErr, setOrderErr] = useState(false);

  const apply = useCallback((positions: Pos) => {
    const m = new Map(positions.map((p) => [Number(p.task_id), Number(p.pos)]));
    setTasks((prev) => prev.map((tk) => (m.has(tk.id) ? { ...tk, my_pos: m.get(tk.id) } : tk)));
  }, [setTasks]);

  // 같은 사람의 다른 창(메인·다른 팝아웃)에서 옮긴 것
  useEffect(() => onSocket('task:my-order', (p: { business_id?: number; positions?: Pos }) => {
    if (Number(p?.business_id) === bizId && Array.isArray(p.positions)) apply(p.positions);
  }), [bizId, apply]);

  const send = useCallback(async (movedId: number, idsAfter: number[]) => {
    const i = idsAfter.indexOf(movedId);
    const res = await apiFetch('/api/tasks/my-order', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        business_id: bizId, task_id: movedId, visible_ids: idsAfter,
        before_id: i > 0 ? idsAfter[i - 1] : null,
        after_id: i < idsAfter.length - 1 ? idsAfter[i + 1] : null,
      }),
    });
    if (!res.ok) throw new Error(String(res.status));   // apiFetch 는 throw 하지 않는다
    const j = await res.json();
    apply((j?.data?.positions || []) as Pos);
  }, [bizId, apply]);

  /** 끌어 옮긴 뒤 — 그 그룹의 새 표시 순서. 화면은 바로 바꾸고(낙관), 실패하면 서버 순서로 되돌린다. */
  const move = useCallback((movedId: number, groupIdsAfter: number[]) => {
    const local = new Map(groupIdsAfter.map((id, k) => [id, -1e12 + k]));   // 같은 그룹 안 비교만 쓰인다
    setTasks((prev) => prev.map((tk) => (local.has(tk.id) ? { ...tk, my_pos: local.get(tk.id) } : tk)));
    setOrderErr(false);
    send(movedId, groupIdsAfter).catch(() => { setOrderErr(true); void silentLoad(); });
  }, [send, setTasks, silentLoad]);

  /** 팝아웃에서 방금 만든 업무를 맨 위로 — 생성 라우트와 묶지 않고 PUT 1건(설계 §8). */
  const placeOnTop = useCallback(async (newId: number, openIdsInOrder: number[]) => {
    const ids = [newId, ...openIdsInOrder.filter((x) => x !== newId)].slice(0, 500);
    try { await send(newId, ids); } catch { /* 순서만 못 붙었다 — 업무는 이미 만들어졌다 */ }
  }, [send]);

  return { move, placeOnTop, orderErr };
}
