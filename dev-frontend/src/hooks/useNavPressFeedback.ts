// 사이드바 메뉴 누름 피드백 (2026-11-02, Irene «태블릿에서 좌측메뉴 클릭할 때 제대로 안되고 여러 번 눌러도 제대로 반응안하고»)
//
// ① 누른 메뉴는 **누른 순간** 강조한다. 강조는 주소(location)를 따르는데, 처음 여는 화면은 조각을 받고 그리는 동안
//    (태블릿 CPU ×4 실측 0.3~0.8초) 주소가 안 넘어와 «안 눌렸다» 로 보였다. 누른 경로를 먼저 강조하고,
//    주소가 바뀌면(또는 4초 뒤) 걷는다. 화면 전환은 ChromeLink `paintFirst` 가 한 프레임 미뤄 강조가 먼저 그려진다.
// ② 실기기 측정(services/perfDiag) — 앱 틀이 처음 그려질 때 한 번 건다. 터치 기기·앱에서만 돈다.
import type React from 'react';
import { useEffect, useState } from 'react';
import { perfShellMounted } from '../services/perfDiag';

export function useNavPressFeedback(pathname: string, businessId: number | null) {
  const [pressedPath, setPressedPath] = useState<string | null>(null);
  useEffect(() => { setPressedPath(null); }, [pathname]);
  useEffect(() => {
    if (!pressedPath) return;
    const id = window.setTimeout(() => setPressedPath(null), 4000);
    return () => window.clearTimeout(id);
  }, [pressedPath]);
  useEffect(() => { perfShellMounted(businessId); }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  /** 사이드바 click(버블) — 수식키 없는 왼쪽 클릭으로 사이드바 안 링크를 눌렀으면 그 경로를 먼저 강조 */
  const notePress = (e: React.MouseEvent<HTMLElement>) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as Element | null)?.closest?.('a[href]');
    const href = a && e.currentTarget.contains(a) ? (a.getAttribute('href') || '').split('?')[0] : '';
    if (href.startsWith('/') && href !== pathname) setPressedPath(href);
  };
  return { pressedPath, notePress };
}
