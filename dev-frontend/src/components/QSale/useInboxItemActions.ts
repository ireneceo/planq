// useInboxItemActions — 상담 목록 **행 액션** 한 벌 (2026-09-16 분리)
//
// 세 동작이 같은 모양이었다 — «누르는 동안 잠그고 · 부르고 · 조용히 다시 읽고 · 실패는 문구로».
// 세 번 베껴 두면 한쪽만 고쳐진다(그리고 실제로 목록 새로고침 방식이 갈릴 뻔했다).
// 렌더에서 떼어 두면 SaleInboxList 는 «무엇을 그리는가» 만 남는다(컴포넌트 800줄 계약).
import { useCallback } from 'react';
import type { SaleInboxItem, SaleStage } from '../../services/sale';
import {
  dismissInboxItem, restoreInboxItem, purgeInboxItem, promoteInboxItem, setSaleStage,
} from '../../services/sale';
// 등록은 별도 모듈이 정본이다(TodoPage 도 같은 함수를 쓴다 — 베끼지 않는다)
import { registerInquiryAsClient } from '../../services/saleRegister';

type Deps = {
  businessId: number;
  busyId: string | null;
  setBusyId: (v: string | null) => void;
  setActionError: (v: string | null) => void;
  reload: () => Promise<unknown> | unknown;
  errorText: string;
  /** 저장 실패 문구 — 읽기 실패와 뜻이 다르다(사용자가 한 행동이 안 남은 것이다) */
  saveErrorText: string;
};

export function useInboxItemActions({ businessId, busyId, setBusyId, setActionError, reload, errorText, saveErrorText }: Deps) {
  /** 공통 껍데기 — 잠금·에러·다시 읽기. 동작마다 다른 것은 `fn` 하나뿐이다. */
  const run = useCallback(async (it: SaleInboxItem, fn: () => Promise<unknown>) => {
    if (busyId) return;
    setBusyId(it.id);
    setActionError(null);
    try {
      await fn();
      await reload();
    } catch {
      // 실패를 삼키지 않는다 — 삼키면 "눌렀는데 아무 일도 안 일어남" 이 된다.
      setActionError(errorText);
    } finally {
      setBusyId(null);
    }
  }, [busyId, setBusyId, setActionError, reload, errorText]);

  /** 후보 → 상담. 기계가 놓친 것을 사람이 올린다(자동 기준을 좁힌 대가를 갚는 문). */
  const promoteItem = useCallback((it: SaleInboxItem) => run(it, () => promoteInboxItem(
    businessId, it.ref.kind === 'conversation' ? 'conversation' : 'email_thread', it.ref.id,
  )), [run, businessId]);

  /** 보관함에서 되돌리기 — 되돌리면 보관함에서 빠지고 상담으로 돌아간다. */
  const restoreItem = useCallback((it: SaleInboxItem) => (
    it.ref.kind !== 'email_thread' ? undefined
      : run(it, () => restoreInboxItem(businessId, 'email_thread', it.ref.id))
  ), [run, businessId]);

  /** [문의 아님] — 상담에서 내려 보관함으로. Q mail 의 분류도 같이 고쳐진다. */
  const dismissItem = useCallback((it: SaleInboxItem) => (
    it.ref.kind !== 'email_thread' ? undefined
      : run(it, () => dismissInboxItem(businessId, 'email_thread', it.ref.id))
  ), [run, businessId]);

  /** 보관함에서 영구히 빼기 — **메일 자체는 지우지 않는다**(Q mail 에 그대로 있다). */
  const purgeItem = useCallback((it: SaleInboxItem) => (
    it.ref.kind !== 'email_thread' ? undefined
      : run(it, () => purgeInboxItem(businessId, 'email_thread', it.ref.id))
  ), [run, businessId]);

  /** 아직 고객이 아닌 행에 **고객 기준 동작**(단계·메모·일정)을 걸려면 먼저 등록해야 한다.
   *  ★ 우측 패널의 `withClient` 와 같은 뜻 — 여는 것만으로는 아무것도 만들지 않고, 저장이 필요한
   *    첫 액션에서 한 번 묻는다. 초대 메일은 보내지 않는다(`invite: false`). */
  const ensureClient = useCallback(async (it: SaleInboxItem): Promise<number | null> => {
    if (it.client_id) return it.client_id;
    if (it.ref.kind === 'client') return it.ref.id;
    const out = await registerInquiryAsClient(businessId, it, { invite: false });
    if (!out.ok || !out.clientId) { setActionError(out.message || saveErrorText); return null; }
    await reload();
    return out.clientId;
  }, [businessId, reload, setActionError, saveErrorText]);

  /** 단계 바꾸기 — **고객 기준**이라 같은 고객의 다른 상담 행도 함께 바뀐다(서버가 고객을 바꾼다).
   *  어느 문의에서 바꿨는지를 `source_ref` 로 같이 보낸다(Irene: "히스토리에 어느 문의 내용에서
   *  단계를 바꿨는지 표시해주고"). */
  const applyStage = useCallback(async (it: SaleInboxItem, to: SaleStage) => {
    if (busyId) return;
    setBusyId(it.id); setActionError(null);
    try {
      const cid = await ensureClient(it);
      if (!cid) return;
      await setSaleStage(businessId, cid, {
        to, source_ref: { kind: it.ref.kind, id: it.ref.id, title: it.title || it.preview || null },
      });
      await reload();
    } catch { setActionError(saveErrorText); } finally { setBusyId(null); }
  }, [busyId, businessId, ensureClient, reload, setBusyId, setActionError, saveErrorText]);

  return { promoteItem, restoreItem, dismissItem, purgeItem, ensureClient, applyStage };
}
