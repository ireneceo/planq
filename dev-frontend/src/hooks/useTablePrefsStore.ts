// 표 열 설정 저장 — 계정별(사람 × 지금 워크스페이스, 서버 PUT /api/businesses/:id/me/table-prefs · services/tablePrefs).
//   Irene 2026-10-27 «권고대로» — PC·아이패드·앱 어디서나 같은 열 배치. 사이드바 메뉴 편집(useNavPrefsSave)과 같은 축.
//
// ★ 서버가 정본이다. 이 브라우저 사본(localStorage)은 계정별로 바뀌기 전에 저장해 둔 값을 **한 번 올리는** 데만 쓰고 지운다 —
//   사본을 계속 읽으면 다른 기기에서 «기본으로 되돌리기» 한 것이 이 기기에서 되살아난다.
// ★ 고객(서버 저장 없음)·워크스페이스 없음은 종전처럼 이 브라우저에만 둔다.
// ★ 끄는 동안 폭이 계속 바뀌므로 표마다 400ms 모아 보낸다. 실패하면 화면은 그대로 두고(보기 설정이라 다음 저장 때 다시 간다) 경고만 남긴다.
import { useEffect, useMemo, useRef } from 'react';
import { apiFetch, useAuth } from '../contexts/AuthContext';
import { localTablePrefsStore, type TablePrefs, type TablePrefsStore } from '../components/Common/DataTable/columns';

const SAVE_DEBOUNCE_MS = 400;

export function useTablePrefsStore(): TablePrefsStore {
  const { user, updateUser } = useAuth();
  const bizId = user?.business_id ?? null;
  const server = !!bizId && user?.business_role !== 'client';
  const userRef = useRef(user);
  userRef.current = user;
  const updateRef = useRef(updateUser);
  updateRef.current = updateUser;
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => () => { for (const t of Object.values(timers.current)) clearTimeout(t); }, [bizId]);

  return useMemo<TablePrefsStore>(() => {
    if (!server) return localTablePrefsStore;
    const send = (tableId: string, prefs: TablePrefs<string> | null) => {
      clearTimeout(timers.current[tableId]);
      timers.current[tableId] = setTimeout(async () => {
        delete timers.current[tableId];
        const body = prefs ? { order: prefs.order, widths: prefs.widths, hidden: prefs.hidden } : null;
        try {
          const res = await apiFetch(`/api/businesses/${bizId}/me/table-prefs`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ table_id: tableId, prefs: body }),
          });
          const j = await res.json().catch(() => null);
          if (!res.ok || !j?.success) { console.warn('[table-prefs] 저장 실패', tableId, res.status); return; }
          // 서버가 정규화한 전체 값으로 맞춘다(다른 표 값도 서버 기준)
          updateRef.current({ table_prefs: j.data?.table_prefs ?? null });
        } catch (e) { console.warn('[table-prefs] 저장 실패', tableId, e); }
      }, SAVE_DEBOUNCE_MS);
    };
    return {
      load(tableId) {
        const mine = userRef.current?.table_prefs?.tables?.[tableId];
        if (mine) return mine;
        // 계정별로 바뀌기 전 이 브라우저에 둔 값 — 한 번 올리고 지운다
        const old = localTablePrefsStore.load(tableId) as TablePrefs<string> | null;
        if (old) { send(tableId, old); localTablePrefsStore.save(tableId, null); }
        return old;
      },
      save(tableId, prefs) {
        // 화면 사본(user.table_prefs)은 바로 고친다 — 다른 화면이 같은 표를 다시 그릴 때 옛 값을 읽지 않게
        const cur = userRef.current?.table_prefs?.tables || {};
        const tables = { ...cur };
        if (prefs) tables[tableId] = { order: prefs.order, widths: prefs.widths, hidden: prefs.hidden }; else delete tables[tableId];
        updateRef.current({ table_prefs: Object.keys(tables).length ? { v: 1, tables } : null });
        send(tableId, prefs);
      },
    };
  }, [server, bizId]);
}
