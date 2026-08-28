// hooks/useTabTitle.ts — 탭 이름을 "그 탭이 실제로 담고 있는 것"으로.
//
// 운영 신고 (Irene, 2026-08-28): "탭이름이 메뉴명들이 보여서 뭐가 뭔지 모르는데.
//   예를 들면 문서 다른 거 열어도 Q docs 가 탭이름이네."
//
//   원인: `tabStore.setTabTitle` 은 처음부터 있었는데 **호출하는 곳이 0곳**이었다.
//   그래서 `tab.title` 이 늘 빈 문자열이고, TabStrip 이 메뉴명(NAV_KEY[kind])으로
//   떨어뜨린다 — 탭을 몇 개를 열든 전부 "Q docs".
//
// 사용: 그 화면의 **주어**를 넘긴다. 없으면(목록 상태) null → 메뉴명으로 자동 복귀.
//   useTabTitle(detail?.title);
//
// ★ 한 탭 안에서 **한 곳만** 호출할 것 — 둘이 부르면 서로 덮어쓴다.
// ★ 단일탭(TabIdProvider 부재)에선 no-op. 탭 스트립이 없으므로 회귀 0.
import { useEffect } from 'react';
import { useTabId } from '../contexts/TabActiveContext';
import { tabStore } from '../stores/tabStore';

const MAX = 40;   // 칩이 좁다 — 너무 길면 어차피 CSS 로 잘린다. 저장 단계에서도 한 번 자른다.

export function useTabTitle(title?: string | null): void {
  const tabId = useTabId();
  // 공백 정규화 — 제목에 개행이 섞이면 칩이 무너진다.
  const clean = (title || '').replace(/\s+/g, ' ').trim().slice(0, MAX);
  useEffect(() => {
    if (!tabId) return;
    tabStore.setTabTitle(tabId, clean);
    // 화면을 떠나면 메뉴명으로 되돌린다 — 안 그러면 같은 탭에서 다른 메뉴로 이동했을 때
    // 이전 화면의 제목이 남아 "엉뚱한 이름의 탭"이 된다.
    return () => { tabStore.setTabTitle(tabId, ''); };
  }, [tabId, clean]);
}

export default useTabTitle;
