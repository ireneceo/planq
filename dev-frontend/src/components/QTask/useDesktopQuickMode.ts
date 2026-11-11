// 데스크탑 앱 «빠른 업무 추가» 창(2단계 C · docs/DESKTOP_APP_PHASE2.md §4-3) — 전역 단축키가 /task-popout?quick=1 을 띄운다.
//   새 화면을 그리지 않는다: 같은 팝아웃의 할 일 입력을 **가려 두었어도 보이게** 하고, 뜰 때마다 입력칸에 포커스만 준다.
//   저장 키는 그 입력의 규칙 그대로(PopoutQuickAdd). 웹·PWA·보통 팝아웃에서는 quick=false.
import { useEffect, useState } from 'react';
import { desktopBridge } from '../../services/native';

export function useDesktopQuickMode(): { quick: boolean; focusSignal: number } {
  const [quick] = useState(() => {
    try { return !!desktopBridge() && new URLSearchParams(window.location.search).get('quick') === '1'; } catch { return false; }
  });
  const [focusSignal, setFocusSignal] = useState(0);
  useEffect(() => {
    const d = desktopBridge();
    if (!quick || !d?.onQuickAdd) return undefined;
    return d.onQuickAdd(() => setFocusSignal((n) => n + 1));
  }, [quick]);
  return { quick, focusSignal };
}
