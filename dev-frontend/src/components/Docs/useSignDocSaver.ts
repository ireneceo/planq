// 서명 요청 1단계(서명 자리)의 문서 저장 줄 — PostSignatureModal 에서 뺐다(god-file 래칫, 2026-10-21).
// 화면 문서를 먼저 바꾸고(stageDoc), 저장은 한 줄로 차례로(flushDoc). 실패하면 마지막 저장본으로 되돌린다.
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { updatePost, SignatureLockedError, type PostDetail } from '../../services/posts';

interface Opts {
  open: boolean;
  post: PostDetail;
  onPostUpdated?: (post: PostDetail) => void;
  onLocked: () => void;
  onError: (msg: string | null) => void;
}

export function useSignDocSaver({ open, post, onPostUpdated, onLocked, onError }: Opts) {
  const { t } = useTranslation('qdocs');
  const [contentOverride, setContentOverride] = useState<unknown>(null);
  const [inserting, setInserting] = useState(false);
  const baseUpdatedRef = useRef<string | null>(post.updated_at || null);
  useEffect(() => { baseUpdatedRef.current = post.updated_at || null; }, [post.updated_at]);
  // ★ 2026-10-21 Irene «서명자리 입력하면 왜 한참 멈추다가 들어가?» — 칸을 떠날 때마다 저장하면서 저장이 끝날 때까지
  //   창 안 모든 입력·[다음] 을 잠갔고, 저장 중 다른 칸의 저장은 `if (inserting) return` 으로 **버려졌다**(화면엔 글자가 남아
  //   [다음] 이 안 풀렸다). [다음] 판정도 저장된 문서만 봐서 방금 친 칸 이름을 몰랐다.
  //   → 문서는 화면에서 먼저 바꾸고(docRef·contentOverride) 저장은 **한 줄로 차례로** 보낸다(뒤 저장이 앞 저장을 덮지 않게,
  //     각 PUT 은 그 순간의 최신 문서). 입력은 잠그지 않는다 — 구조를 바꾸는 버튼만 저장 중에 잠근다(SignatureSpotsStep).
  const docRef = useRef<unknown>(null);
  const savedDocRef = useRef<unknown>(null);
  const queueRef = useRef<Promise<boolean>>(Promise.resolve(true));
  const dirtyRef = useRef(false);
  const currentDoc = () => docRef.current ?? contentOverride ?? post.content_json;
  /** 화면에서만 바꾼다(타이핑 중) — 저장은 flushDoc */
  const stageDoc = (transform: (doc: unknown) => unknown) => {
    const next = transform(currentDoc());
    docRef.current = next; dirtyRef.current = true;
    setContentOverride(next);
  };
  /** 지금까지 바뀐 문서를 저장 줄에 올린다. 모든 저장이 끝나면 성공 여부 */
  const flushDoc = (): Promise<boolean> => {
    if (dirtyRef.current) {
      dirtyRef.current = false;
      setInserting(true);
      queueRef.current = queueRef.current.then(async (prevOk) => {
        if (!prevOk) return false;
        const next = docRef.current;
        try {
          onError(null);
          const saved = await updatePost(post.id, { content_json: next as never, base_updated_at: baseUpdatedRef.current });
          baseUpdatedRef.current = saved.updated_at || baseUpdatedRef.current;
          savedDocRef.current = next;
          onPostUpdated?.(saved);
          return true;
        } catch (e) {
          // 저장되지 않은 것을 화면에 남기지 않는다 — 마지막으로 저장된 문서로 되돌린다
          const back = savedDocRef.current ?? post.content_json;
          docRef.current = back; dirtyRef.current = false;
          setContentOverride(savedDocRef.current);
          if (e instanceof SignatureLockedError) {
            onLocked();
            onError(t('sign.spots.lockedSave', { defaultValue: '서명 요청을 보낸 문서라 서명 자리를 바꿀 수 없어요. 바꾸려면 진행 중인 서명 요청을 취소하세요.' }) as string);
          } else {
            onError((e as Error).message || (t('sign.noFields.insertFailed', { defaultValue: '서명 자리를 저장하지 못했어요. 편집에서 [서명 항목] 으로 넣어 주세요.' }) as string));
          }
          return false;
        }
      });
    }
    const mine = queueRef.current;
    void mine.then(() => { if (queueRef.current === mine) setInserting(false); });
    // 실패는 한 번만 막는다 — 다음 저장은 새로 시작
    return mine.then((ok) => { if (!ok && queueRef.current === mine) queueRef.current = Promise.resolve(true); return ok; });
  };
  const saveDoc = (transform: (doc: unknown) => unknown) => { stageDoc(transform); return flushDoc(); };
  // 창을 다시 열면 문서를 새로 읽는다 — 닫힌 사이 편집에서 바뀐 본문을 옛 사본으로 덮지 않게
  useEffect(() => {
    if (!open) return;
    docRef.current = null; savedDocRef.current = null; dirtyRef.current = false;
    setContentOverride(null);
  }, [open]);
  return { contentOverride, inserting, stageDoc, flushDoc, saveDoc };
}
