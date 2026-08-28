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

// enabled=false 면 **아무것도 하지 않는다**. 빈 문자열조차 쓰지 않는 것이 핵심 —
//   같은 탭에 이미 제목의 주인이 있는데 ''(비움)을 쓰면 그 주인의 제목을 지워버린다.
//   (Fable 재검증 2026-08-28: 프로젝트 상세 안에 PostsPage 가 임베드되어 문서 탭을 누르는
//    순간 프로젝트명이 지워지고 메뉴명으로 추락했다. 훅 주석의 "한 탭에 한 곳만" 을
//    배선이 위반한 것 → 임베드 쪽은 enabled=false 로 꺼서 주인을 하나로 만든다.)
export function useTabTitle(title?: string | null, enabled = true): void {
  const tabId = useTabId();
  // 공백 정규화 — 제목에 개행이 섞이면 칩이 무너진다.
  const clean = (title || '').replace(/\s+/g, ' ').trim().slice(0, MAX);
  // ★ 언마운트 cleanup 을 두지 말 것 (Irene 2026-08-28: "다른 탭 클릭하면 이름이 다시 메뉴이름으로 바뀌어").
  //   탭이 5개를 넘으면 가장 오래 안 본 탭이 alive:false 로 **언마운트**된다(tabStore MAX_ALIVE=4,
  //   TabAppShell 이 alive 탭만 렌더). 그건 "화면을 떠났다" 가 아니라 "잠시 접어뒀다" 인데,
  //   cleanup 이 거기서 발화해 멀쩡한 탭의 이름을 지웠다.
  //   같은 탭에서 **다른 메뉴로 이동**했을 때 옛 제목이 남는 문제는 마운트 여부가 아니라
  //   **경로 변화**로 판단해야 한다 → tabStore.setTabPath 가 kind 가 바뀔 때 제목을 비운다.
  //   (같은 화면 안의 이동(/docs → /docs?post=5)은 kind 가 그대로라 안 지운다 — 깜빡임 방지.)
  useEffect(() => {
    if (!tabId || !enabled) return;
    tabStore.setTabTitle(tabId, clean);
  }, [tabId, clean, enabled]);
}

export default useTabTitle;
