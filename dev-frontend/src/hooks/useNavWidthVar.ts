// 고정 좌측 메뉴의 폭을 CSS 변수 `--pq-nav-w` 로 문서에 싣는다 (2026-11-04, Fable 원인 판정).
//
// Irene: *"태블릿에서 좌측메뉴 클릭할 때 제대로 안되고 여러 번 눌러도 제대로 반응안하고"* · *"계속 문제가 반복되잖아"*
//   원인(Fable 실측, 100% 재현): 아이패드 가로(≥1025 — 메뉴가 고정)·데스크탑에서 업무 상세·추가 같은 드로어가 열려 있으면
//   드로어의 옅은 막(left:0, z 125)이 메뉴(z 100)를 덮어 **첫 탭은 드로어만 닫고**, 두 번째 탭에야 이동했다.
//   막은 이 변수만큼 왼쪽을 비운다(DetailDrawer·TaskDetailDrawer Backdrop). 메뉴가 서랍(≤1024)이면 0 — 그 메뉴는 막보다 위(10060)다.
//   메뉴 z 를 올리는 방법은 쓰지 않는다 — 메뉴 안 위젯 층이 같이 올라간다.
import { useEffect } from 'react';

export function useNavWidthVar(px: number) {
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--pq-nav-w', `${Math.max(0, Math.round(px))}px`);
    return () => { root.style.removeProperty('--pq-nav-w'); };
  }, [px]);
}
