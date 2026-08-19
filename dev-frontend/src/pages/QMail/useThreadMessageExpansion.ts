// #262 M2 — 스레드 상세의 "최신 메시지만 펼침" 상태. MailPage.tsx 에서 절출 (god-file 래칫).
//
// 스레드를 열면 최신 메시지가 펼쳐진 채 그 위치에서 시작한다. 여태 전 메시지를 오래된 순으로
// 다 펼쳐 놓아서, 방금 보낸 최신 메일이 스크롤 맨 아래에 묻혔다
// (Irene: "내가 보낸 메일이 최신인데 가장 아래에 붙어버려서").
//
// ★ 2R-1 — 화면 표시가 **최신이 위**로 바뀌면서 스크롤 앵커가 사라졌다. 여태는 마지막 카드를
//   scrollIntoView 했는데, 본문 iframe 높이가 나중에 도착하는 탓에 스크롤이 계산된 뒤 콘텐츠가
//   자라 최신 메일이 화면 밖으로 밀렸다 (Irene: "최신 메일 내용은 어디인지 보이지도 않아").
//   최신이 맨 위면 **scrollTop = 0 이 항상 정답**이라 앵커 계산 자체가 필요 없다.
//   입력 `messages` 는 서버 그대로의 **오름차순 정본**이다 — 표시 반전은 화면에서만 한다.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

interface MessageLike {
  id: number;
  direction?: 'inbound' | 'outbound';
  is_read?: boolean;
}

/** 펼칠 기준 메시지 — "지금 읽어야 할 것" 하나.
 *
 *  보낸메일함에서 클릭했다는 것은 "내가 보낸 것을 보러 왔다"는 의도이고, 그 외 모든 폴더는
 *  받은 메일이 기준이다 (Irene: "이건 [보낸메일]에만 이렇게 나오는 거고, 나머지 모든 메일들은
 *  받은 메일내용 기준이니까 그대로 받은 메일 내용이 펼쳐져야지").
 *  해당 방향이 하나도 없으면(내가 먼저 보낸 새 스레드) 최신 메시지로 폴백한다 — 접을 대상이 없다.
 */
function pickAnchor(list: MessageLike[], folder?: string): number | null {
  if (!list.length) return null;
  const want = folder === 'sent' ? 'outbound' : 'inbound';
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (list[i].direction === want) return list[i].id;
  }
  return list[list.length - 1].id;
}

export function useThreadMessageExpansion(
  threadId: number | null,
  messages: MessageLike[] | null,
  folder?: string,
) {
  const [expandedMsgIds, setExpandedMsgIds] = useState<ReadonlySet<number>>(() => new Set());
  /** 메시지 스크롤 컨테이너 — 스레드/메시지 구성이 바뀌면 맨 위(=최신)로 되돌린다 */
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // ★ 키는 "스레드 id + 메시지 id 목록" 이다. **detail 객체를 의존성에 넣으면 안 된다** —
  //   loadDetail 은 갱신마다 새 객체를 주므로, silentReload(socket mail:new / mail:refresh /
  //   visibility 복귀)가 돌 때마다 사용자가 펼쳐 둔 메시지가 접히고 스크롤이 최신으로 점프한다.
  //   남의 메일이 도착하기만 해도 읽던 화면이 무너진다. 실시간 갱신은 **데이터만** 덮어쓰고
  //   UI 상태는 보존한다 (memory feedback_visibility_refresh_server_fresh).
  //   메시지 구성이 실제로 바뀌면 이 키가 바뀌므로 그때는 정상 재계산된다.
  const msgKey = threadId && messages ? `${threadId}:${messages.map(m => m.id).join(',')}` : '';
  const msgsRef = useRef(messages);
  msgsRef.current = messages;
  const folderRef = useRef(folder);
  folderRef.current = folder;

  // 직전에 자동으로 펼친 앵커. 같은 앵커를 두 번 밀어넣지 않기 위한 기억 —
  //   사용자가 직접 접은 메시지가 재계산 때마다 되살아나면 그것도 화면을 무너뜨린다.
  const prevAnchorRef = useRef<number | null>(null);

  // ★ 재계산은 **증분**이다 (전체 리셋 금지).
  //     next = (직전 펼침 ∩ 현재 메시지) ∪ {앵커가 바뀐 경우에만 새 앵커} ∪ {안 읽은 받은메일}
  //   전체 리셋이면 답장을 보낸 순간(낙관 카드 삽입 → msgKey 변경) 읽고 있던 받은 메일이 접히고
  //   내가 방금 쓴 메일이 펼쳐졌다 — Irene 이 지적한 바로 그 현상이다.
  //   임시 발송 카드는 앵커가 아니므로 **접힌 채** 맨 위에 들어오고, 헤더의 "발송 중…" 칩이
  //   발송 사실을 알린다(사용자는 자기가 방금 쓴 내용을 이미 안다).
  useEffect(() => {
    const list = msgsRef.current;
    if (!list || !list.length) { setExpandedMsgIds(new Set()); prevAnchorRef.current = null; return; }
    const anchor = pickAnchor(list, folderRef.current);
    // ★ 비교는 **여기서** 끝낸다. 함수형 updater 는 effect 본문이 끝난 뒤(다음 렌더에서) 실행되는데,
    //   그 안에서 prevAnchorRef 를 읽으면 아래 대입이 이미 끝난 뒤라 조건이 **영원히 false** 가 된다.
    //   그러면 앵커가 한 번도 추가되지 않아 "읽은 스레드를 열면 아무것도 안 펼쳐지는" 상태가 된다
    //   (Fable 게이트가 실브라우저에서 잡아낸 회귀 — tsc·가드·빌드는 전부 통과했다).
    const shouldAddAnchor = anchor != null && anchor !== prevAnchorRef.current;
    setExpandedMsgIds((prev) => {
      const alive = new Set(list.map((m) => m.id));
      const next = new Set<number>();
      prev.forEach((id) => { if (alive.has(id)) next.add(id); });
      if (shouldAddAnchor && anchor != null) next.add(anchor);
      // 안 읽은 받은메일은 언제나 펼친다 — 미읽음 2건이 쌓였는데 최신만 펼치면 하나가 숨는다.
      list.forEach((m) => { if (m.direction === 'inbound' && m.is_read === false) next.add(m.id); });
      return next;
    });
    prevAnchorRef.current = anchor;
  }, [msgKey, folder]);

  // 레이아웃 phase 에서 즉시 이동 — RAF 지연은 "옛 위치로 한 번 그려진 뒤 점프" 회귀를 만든다
  //   (CLAUDE.md 운영 안정성 12). 최신이 맨 위이므로 목적지는 언제나 0 이다 —
  //   본문 높이가 나중에 도착해도 스크롤 위치가 틀어지지 않는다(앵커 계산이 없으므로).
  useLayoutEffect(() => {
    if (!msgKey || !scrollRef.current) return;
    scrollRef.current.scrollTop = 0;
  }, [msgKey]);

  const toggleMsg = useCallback((id: number) => {
    setExpandedMsgIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  return { expandedMsgIds, toggleMsg, scrollRef };
}
