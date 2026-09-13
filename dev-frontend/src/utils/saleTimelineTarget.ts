// 타임라인 항목 → 갈 곳. **단일 원천.**
//   Irene 2026-09-12: "숫자들이나 내용들 누르면 연결되어야지."
//   상세 페이지 안에 인라인으로 있던 판정을 꺼냈다 — 우측 패널도 같은 곳으로 가야 한다
//   (자리마다 다른 곳으로 가면 사용자는 어디로 갈지 모른다).
import type { TimelineItem } from '../services/sale';
// 새 탭으로 여는 문은 **하나**다 — openDockTool 처럼 이름만 비슷한 것을 부르면 아무 일도 안 난다
import { tabStore } from '../stores/tabStore';

export function saleTimelineHref(it: TimelineItem): string | null {
  if (it.type === 'chat' && it.conversation_id) return `/talk?conv=${it.conversation_id}`;
  if (it.type === 'guest' && it.conversation_id) return `/talk?conv=${it.conversation_id}`;
  if (it.type === 'email' && it.thread_id) return `/mail?thread=${it.thread_id}`;
  if (it.type === 'task') return `/tasks?task=${it.id}`;
  if (it.type === 'invoice') return `/bills?invoice=${it.id}`;
  return null;                          // 상담 기록·단계 이력은 그 자리(타임라인)가 원본이다
}

/** 타임라인 항목을 연다.
 *
 *  ★ 2026-09-13 (Irene: *"고객 히스토리에 있는 내용들 누르면 새탭으로 넘어가게 해.
 *    아예 나가버리면 안될 것 같아."*) — 기본을 **새 탭**으로 바꿨다. 히스토리를 훑다가
 *    한 건을 열면 보던 목록·패널이 사라지던 것이 문제였다(하던 일 위에 얹히는 진입점은 새 탭 —
 *    CLAUDE.md "UI 규칙 — 하던 일 위에 얹히는 진입점은 새 탭").
 *  ★ 미러 모드(모바일·단일 탭)에는 탭 개념이 없어 `openInNewTab` 이 그대로 이동으로 떨어진다 —
 *    그래서 화면이 분기를 따로 두지 않는다. */
export function openSaleTimelineItem(
  it: TimelineItem,
  navigate: (to: string) => void,
  opts: { newTab?: boolean } = {},
): void {
  const href = saleTimelineHref(it);
  if (!href) return;
  // 기본이 새 탭이다. 부르는 쪽이 같은 탭을 원하면 `newTab: false` 를 명시한다.
  if (opts.newTab !== false) { tabStore.openInNewTab(href); return; }
  navigate(href);
}
