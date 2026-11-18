// 같은 사건이 소켓으로 두 번 올 때 «처음 한 번» 만 세게 하는 거름망.
//
// 왜: 새 메시지(message:new)는 서버가 두 방으로 쏜다 — 그 대화방을 연 소켓(`conv:<id>`)과
//   워크스페이스 청중의 개인 방(`user:<id>`, services/convBroadcast.emitConvWide). 대화방을 열어 둔 소켓은
//   둘 다 들어 있어 **같은 메시지를 두 번** 받는다. 본문 목록은 id 로 거르지만 안 읽음 숫자는 사건마다 +1 이라
//   답장 하나에 «2» 가 떴다(2026-11-18 Irene «답변이 하나 왔는데 데스크탑앱에서 채팅방에 알림이 2»).
//   토스터(NotificationToaster)는 이미 같은 이유로 id 거름망을 갖고 있었다.
//
// 쓰는 곳마다 하나씩 만든다 — 같은 사건을 서로 다른 화면이 각자 한 번씩은 처리해야 하므로 공용 집합이 아니다.
export function createOnceById(windowMs = 10000, maxSize = 300): (id: unknown) => boolean {
  const seen = new Map<string, number>();
  return (id: unknown): boolean => {
    if (id === null || id === undefined || id === '') return true;   // id 없는 사건은 거르지 않는다
    const key = String(id);
    const now = Date.now();
    const at = seen.get(key);
    if (at !== undefined && now - at < windowMs) return false;
    seen.set(key, now);
    if (seen.size > maxSize) {
      for (const [k, ts] of seen) if (now - ts > windowMs) seen.delete(k);
    }
    return true;
  };
}
