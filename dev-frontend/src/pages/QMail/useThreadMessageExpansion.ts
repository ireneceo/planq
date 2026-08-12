// #262 M2 — 스레드 상세의 "최신 메시지만 펼침" 상태. MailPage.tsx 에서 절출 (god-file 래칫).
//
// 스레드를 열면 최신 메시지가 펼쳐진 채 그 위치에서 시작한다. 여태 전 메시지를 오래된 순으로
// 다 펼쳐 놓아서, 방금 보낸 최신 메일이 스크롤 맨 아래에 묻혔다
// (Irene: "내가 보낸 메일이 최신인데 가장 아래에 붙어버려서").
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

interface MessageLike { id: number }

export function useThreadMessageExpansion(
  threadId: number | null,
  messages: MessageLike[] | null,
) {
  const [expandedMsgIds, setExpandedMsgIds] = useState<ReadonlySet<number>>(() => new Set());
  const lastMsgRef = useRef<HTMLDivElement | null>(null);

  // ★ 키는 "스레드 id + 메시지 id 목록" 이다. **detail 객체를 의존성에 넣으면 안 된다** —
  //   loadDetail 은 갱신마다 새 객체를 주므로, silentReload(socket mail:new / mail:refresh /
  //   visibility 복귀)가 돌 때마다 사용자가 펼쳐 둔 메시지가 접히고 스크롤이 최신으로 점프한다.
  //   남의 메일이 도착하기만 해도 읽던 화면이 무너진다. 실시간 갱신은 **데이터만** 덮어쓰고
  //   UI 상태는 보존한다 (memory feedback_visibility_refresh_server_fresh).
  //   메시지 구성이 실제로 바뀌면 이 키가 바뀌므로 그때는 정상 재계산된다.
  const msgKey = threadId && messages ? `${threadId}:${messages.map(m => m.id).join(',')}` : '';
  const msgsRef = useRef(messages);
  msgsRef.current = messages;

  useEffect(() => {
    const list = msgsRef.current;
    if (!list || !list.length) { setExpandedMsgIds(new Set()); return; }
    // 최신 1건만 펼침. 단일 메시지 스레드는 접을 것이 없으므로 그대로 펼쳐진다.
    setExpandedMsgIds(new Set([list[list.length - 1].id]));
  }, [msgKey]);

  // 레이아웃 phase 에서 즉시 이동 — RAF 지연은 "옛 위치로 한 번 그려진 뒤 점프" 회귀를 만든다
  //   (CLAUDE.md 운영 안정성 12).
  useLayoutEffect(() => {
    if (!msgKey || !lastMsgRef.current) return;
    lastMsgRef.current.scrollIntoView({ block: 'start' });
  }, [msgKey]);

  const toggleMsg = useCallback((id: number) => {
    setExpandedMsgIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  return { expandedMsgIds, toggleMsg, lastMsgRef };
}
