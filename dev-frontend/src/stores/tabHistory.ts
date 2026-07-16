// stores/tabHistory.ts — ⑥ 멀티탭 브라우저 히스토리 결정 로직 (순수 함수)
//
// 트리 스왑에서 가장 버그가 많은 축(pushState/replaceState/popstate)을 브라우저 없이 node 로 전수 검증하기
// 위해 순수 함수로 분리. UrlMirror/PopstateBridge(커밋8)가 이 결정을 소비만 한다.
// 설계: docs/MULTITAB_DESIGN.md §3.
import { identityOfPath, type Tab } from './tabStore';

// (1) pane 내부 location 변경 → 브라우저 히스토리 조작 결정.
//   활성 탭의 내부 네비만 pushState(브라우저 back 엔트리 생성). 비활성 탭 내부 네비는 히스토리 무손상.
//   초기 마운트(prevPath=null)·동일 path 는 push 안 함(StrictMode 이중마운트 멱등).
export function decidePaneNav(opts: {
  path: string; tabId: string; isActive: boolean; prevPath: string | null;
}): { op: 'push' | 'none'; path: string; tabId: string } {
  const { path, tabId, isActive, prevPath } = opts;
  if (!isActive) return { op: 'none', path, tabId };
  if (prevPath === null || prevPath === path) return { op: 'none', path, tabId };
  return { op: 'push', path, tabId };
}

// (2) 탭 전환 → replaceState (전환은 브라우저 히스토리에 안 쌓음).
export function decideTabSwitch(path: string, tabId: string): { op: 'replace'; path: string; tabId: string } {
  return { op: 'replace', path, tabId };
}

// (3) popstate 해석 — window path + e.state.pqTab → 활성화할 탭 / 새 탭 생성.
//   pqTab 살아있으면 그 탭 활성. 닫혔거나 state 없으면 path identity 로 소유 탭 탐색. 없으면 새 탭.
//   → "브라우저 back 이 탭 경계를 넘으면 그 path 소유 탭으로 자동 전환" 정책 구현.
export type PopResult =
  | { kind: 'activate'; tabId: string; path: string }
  | { kind: 'open'; path: string };

export function resolvePopstate(tabs: Tab[], path: string, stateTabId: string | null): PopResult {
  if (stateTabId) {
    const t = tabs.find((x) => x.id === stateTabId);
    if (t) return { kind: 'activate', tabId: t.id, path };
  }
  const owner = tabs.find((x) => identityOfPath(x.path) === identityOfPath(path));
  if (owner) return { kind: 'activate', tabId: owner.id, path };
  return { kind: 'open', path };
}
