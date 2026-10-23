// 고쳐서 다시 보내기 — 서명 받기 창을 지난 회차의 받는 분으로 채운다 (2026-10-23)
//   Irene «수정 후 재발송이면 정보 넣었던 거 그대로 있어야 하는데 받는 사람 이메일이랑 이름 다 날라갔었어».
//   닫힌 회차가 있고 지금 회차가 비었을 때만. 값은 서버 목록(닫힌 회차 행은 slot·party·이메일·이름·멤버를 그대로 남긴다)에서
//   온다 — 화면이 따로 저장하지 않는다. 어느 회차인지는 진행 칸과 같은 함수(utils/signatureRounds).
import { useEffect, useState } from 'react';
import { listSignatures, type SignatureRequest } from '../../services/posts';
import { resendSourceRound } from '../../utils/signatureRounds';

type SlotValue = { email: string; name: string; userId: number | null };

interface Args {
  open: boolean;
  postId: number;
  defaultNote: string;
  setKind: (k: 'sign' | 'confirm') => void;
  setNote: (fn: (cur: string) => string) => void;
  setSlotMap: (fn: (prev: Record<number, SlotValue>) => Record<number, SlotValue>) => void;
  setSigners: (rows: { email: string; name: string }[]) => void;
}

export function useResendPrefill({ open, postId, defaultNote, setKind, setNote, setSlotMap, setSigners }: Args) {
  const [rows, setRows] = useState<SignatureRequest[] | null>(null);
  useEffect(() => {
    if (!open) { setRows(null); return; }
    let cancelled = false;
    listSignatures(postId).then((list) => {
      if (cancelled) return;
      const src = resendSourceRound(list);
      if (!src || src.length === 0) return;
      setRows(src);
      setKind((src.find((r) => r.kind)?.kind || 'sign') as 'sign' | 'confirm');
      setNote((cur) => cur || defaultNote);
      // 서명란 모드 — 같은 번호 칸에 같은 사람. 문서에서 사라진 칸은 창의 fields 매핑에서 저절로 빠진다.
      //   창의 기본값 이펙트(보내는 쪽 = 나)보다 늦게 와도 덮어쓴다 — 지난번에 고른 사람이 정답이다.
      setSlotMap((prev) => {
        const next = { ...prev };
        src.forEach((r) => {
          if (r.slot == null) return;
          next[r.slot] = (r.party || 'them') === 'us'
            ? { email: '', name: r.signer_name || '', userId: r.signer_user_id ?? null }
            : { email: r.signer_email || '', name: r.signer_name || '', userId: null };
        });
        return next;
      });
      // 서명란 없이 받은 요청(확인 요청·옛 요청) — 받는 분 행으로
      const them = src.filter((r) => (r.party || 'them') === 'them' && r.signer_email);
      if (them.length > 0) setSigners(them.map((r) => ({ email: r.signer_email, name: r.signer_name || '' })));
    }).catch(() => { /* 못 읽으면 빈 창 — 종전과 같다 */ });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, postId]);
  return [rows, setRows] as const;
}
