// 게스트 링크 — 타입과 **유효 판정 단일 원천**.
//
// ★ 판정을 사본으로 두지 않는다. 2026-09-04 이전에는 `GuestLinkButton` 안에
//   `!l.revoked_at` 하나만 있었고, 그 술어가 **만료(expires_at)를 안 봤다.**
//   만료된 링크가 "살아 있는 링크" 로 표시됐고, 고객은 그 링크로 못 들어온다.
//   같은 판정을 두 번째로 필요로 하는 곳(진입 안내 배너)이 생기면서 여기로 모은다.
//   만료는 슬라이딩이다 — 쓸 때마다 뒤로 밀린다(services/guest_link.js).

export type GuestContact = {
  id: number; name: string | null; email: string | null;
  verified_at: string | null; unsubscribed_at: string | null;
  last_used_at: string | null; last_notified_at: string | null; revoked_at: string | null;
};

export type GuestLink = {
  id: number; guest_name: string; token_hint: string; can_write: boolean;
  expires_at: string; last_used_at: string | null; message_count: number; revoked_at: string | null;
  /** 이 링크로 답글 알림을 신청한 사람들 (#259 A안). 링크가 아니라 링크에 딸린 사람이다. */
  contacts?: GuestContact[];
};

/** 지금 이 링크로 고객이 들어올 수 있는가. 회수됐거나 만료됐으면 아니다. */
export function isLiveGuestLink(l: Pick<GuestLink, 'revoked_at' | 'expires_at'>): boolean {
  if (l.revoked_at) return false;
  if (!l.expires_at) return true;          // 값이 없으면 만료 없음으로 본다
  const t = new Date(l.expires_at).getTime();
  return Number.isNaN(t) ? true : t > Date.now();
}

/** 대화방에 **살아 있는 공유 링크가 하나라도** 있는가. */
export function hasLiveGuestLink(links: readonly Pick<GuestLink, 'revoked_at' | 'expires_at'>[]): boolean {
  return links.some(isLiveGuestLink);
}
