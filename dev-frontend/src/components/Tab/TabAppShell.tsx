// components/Tab/TabAppShell.tsx — ⑥ 멀티탭 앱 셸 (router-less zone)
//
// BrowserRouter 조상 없이 렌더 → 각 TabPane 의 MemoryRouter 가 형제(§3, invariant 통과).
// chrome(MainLayout: 사이드바·TabStrip·오버레이) 1회 마운트 + alive 탭 pane 들 동시 렌더(keep-alive).
import { useEffect } from 'react';
import MainLayout from '../Layout/MainLayout';
import TabPane from './TabPane';
import PopstateBridge from './PopstateBridge';
import { useTabs, useActiveTab } from '../../hooks/useTabStore';

export default function TabAppShell() {
  const tabs = useTabs();
  const active = useActiveTab();

  // 활성 탭 변경 → 브라우저 주소창 replaceState(전환은 히스토리에 안 쌓음) + document.title.
  useEffect(() => {
    if (!active) return;
    try { window.history.replaceState({ pqTab: active.id }, '', active.path); } catch { /* noop */ }
    if (active.title) document.title = `${active.title} · PlanQ`;
  }, [active?.id, active?.path, active?.title]);

  return (
    <MainLayout tabMode>
      {tabs.filter((t) => t.alive).map((t) => (
        <TabPane key={t.id} tab={t} active={active?.id === t.id} />
      ))}
      <PopstateBridge />
    </MainLayout>
  );
}
