// 타임라인 항목 → 갈 곳. **단일 원천.**
//   Irene 2026-09-12: "숫자들이나 내용들 누르면 연결되어야지."
//   상세 페이지 안에 인라인으로 있던 판정을 꺼냈다 — 우측 패널도 같은 곳으로 가야 한다
//   (자리마다 다른 곳으로 가면 사용자는 어디로 갈지 모른다).
import type { TimelineItem } from '../services/sale';

export function saleTimelineHref(it: TimelineItem): string | null {
  if (it.type === 'chat' && it.conversation_id) return `/talk?conv=${it.conversation_id}`;
  if (it.type === 'guest' && it.conversation_id) return `/talk?conv=${it.conversation_id}`;
  if (it.type === 'email' && it.thread_id) return `/mail?thread=${it.thread_id}`;
  if (it.type === 'task') return `/tasks?task=${it.id}`;
  if (it.type === 'invoice') return `/bills?invoice=${it.id}`;
  return null;                          // 상담 기록·단계 이력은 그 자리(타임라인)가 원본이다
}

export function openSaleTimelineItem(it: TimelineItem, navigate: (to: string) => void): void {
  const href = saleTimelineHref(it);
  if (href) navigate(href);
}
