// components/Tab/TabStrip.tsx — ⑥ 멀티탭 탭 스트립 (A안: 최상단 풀폭)
//
// 디자인 통일: 사이드바 색 토큰의 "수평 연장"(COLOR_GUIDE §7 값 그대로, 신규 색 0) + Q 시리즈 아이콘
//   (Icons.tsx 단일 원천, 사이드바와 동일 컴포넌트). router-less zone 이므로 react-router 훅 미사용 —
//   TabStore 액션으로만 동작. 설계: docs/MULTITAB_DESIGN.md §1(Fable 완성 스펙).
import { useLayoutEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useTabs, useActiveTab } from '../../hooks/useTabStore';
import { tabStore, type Tab, type TabKind } from '../../stores/tabStore';
import { iconForTab } from './tabIcon';
import { XIcon, PlusIcon, ChevronDownIcon } from '../Common/Icons';

// kind → layout ns nav 라벨 키 (사이드바와 동일 문구, 언어전환 재렌더 보장 — store 에 번역문 저장 안 함)
const NAV_KEY: Record<TabKind, string> = {
  dashboard: 'nav.dashboard', inbox: 'nav.inbox', talk: 'nav.talk', mail: 'nav.qmail',
  task: 'nav.task', project: 'nav.project', projectDetail: 'nav.project', calendar: 'nav.calendar',
  note: 'nav.note', docs: 'nav.docs', info: 'nav.qinfo', files: 'nav.file',
  clients: 'nav.clients', bill: 'nav.qbill', other: 'nav.settings',
};

// 새 탭 드롭다운 — 사이드바 기능 순서와 동일 (path→openOrFocus)
const NEW_TAB_ITEMS: Array<{ kind: TabKind; path: string }> = [
  { kind: 'dashboard', path: '/dashboard' }, { kind: 'inbox', path: '/inbox' },
  { kind: 'talk', path: '/talk' }, { kind: 'mail', path: '/mail' },
  { kind: 'task', path: '/tasks' }, { kind: 'project', path: '/projects' },
  { kind: 'calendar', path: '/calendar' }, { kind: 'note', path: '/notes' },
  { kind: 'docs', path: '/docs' }, { kind: 'info', path: '/info' },
  { kind: 'files', path: '/files' }, { kind: 'bill', path: '/bills' },
  { kind: 'clients', path: '/business/clients' },
];

export default function TabStrip() {
  const tabs = useTabs();
  const active = useActiveTab();
  const { t } = useTranslation('layout');
  const [menu, setMenu] = useState<null | 'new' | 'overflow'>(null);
  const activeRef = useRef<HTMLButtonElement>(null);

  // 활성 탭 화면 안으로 (운영 안정성 #12 — useLayoutEffect 즉시, RAF 금지)
  useLayoutEffect(() => {
    activeRef.current?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }, [active?.id]);

  if (tabs.length === 0) return null;
  const label = (tab: Tab) => tab.title || (t(NAV_KEY[tab.kind], { defaultValue: tab.kind }) as string);

  return (
    <Strip role="tablist" aria-label={t('tabs.strip', { defaultValue: '열린 탭' }) as string} data-testid="tabstrip">
      <Scroll>
        {tabs.map((tab) => {
          const Icon = iconForTab(tab.kind, tab.path);
          const isActive = active?.id === tab.id;
          return (
            <Chip
              key={tab.id}
              ref={isActive ? activeRef : undefined}
              role="tab"
              aria-selected={isActive}
              $active={isActive}
              data-testid={`tabstrip-tab-${tab.id}`}
              title={label(tab)}
              onClick={() => { if (!isActive) tabStore.setActive(tab.id); }}
              onMouseDown={(e) => { if (e.button === 1 && tabs.length > 1) { e.preventDefault(); tabStore.closeTab(tab.id); } }}
            >
              <IconWrap aria-hidden><Icon size={15} /></IconWrap>
              <Title>{label(tab)}</Title>
              {tab.indicator === 'recording' && <RecDot aria-label={t('tabs.recording', { defaultValue: '녹음 중' }) as string} />}
              {tabs.length > 1 && (
                <Close
                  type="button"
                  aria-label={t('tabs.close', { defaultValue: '탭 닫기' }) as string}
                  data-testid={`tabstrip-close-${tab.id}`}
                  onClick={(e) => { e.stopPropagation(); tabStore.closeTab(tab.id); }}
                ><XIcon size={12} /></Close>
              )}
            </Chip>
          );
        })}
      </Scroll>

      <Right>
        <IconBtn type="button" aria-label={t('tabs.new', { defaultValue: '새 탭' }) as string} data-testid="tabstrip-new"
          $on={menu === 'new'} onClick={() => setMenu((m) => (m === 'new' ? null : 'new'))}><PlusIcon size={16} /></IconBtn>
        <IconBtn type="button" aria-label={t('tabs.overflow', { defaultValue: '모든 탭' }) as string} data-testid="tabstrip-overflow"
          $on={menu === 'overflow'} onClick={() => setMenu((m) => (m === 'overflow' ? null : 'overflow'))}><ChevronDownIcon size={16} /></IconBtn>
      </Right>

      {menu && (
        <>
          <Backdrop onClick={() => setMenu(null)} />
          <Menu role="menu" style={{ right: menu === 'new' ? 40 : 8 }}>
            {(menu === 'new' ? NEW_TAB_ITEMS : tabs).map((it) => {
              const kind = it.kind as TabKind;
              const path = 'path' in it ? it.path : (it as Tab).path;
              const Icon = iconForTab(kind, path);
              const alreadyOpen = tabs.some((x) => x.kind === kind);
              const isTab = menu === 'overflow';
              return (
                <MenuItem key={isTab ? (it as Tab).id : path} role="menuitem"
                  $active={isTab && active?.id === (it as Tab).id}
                  onClick={() => { setMenu(null); isTab ? tabStore.setActive((it as Tab).id) : tabStore.openOrFocus(path); }}>
                  <IconWrap aria-hidden><Icon size={15} /></IconWrap>
                  <MenuLabel>{isTab ? label(it as Tab) : (t(NAV_KEY[kind], { defaultValue: kind }) as string)}</MenuLabel>
                  {menu === 'new' && alreadyOpen && <OpenDot aria-hidden />}
                </MenuItem>
              );
            })}
          </Menu>
        </>
      )}
    </Strip>
  );
}

// ── styled (사이드바 토큰 수평 연장) ──
const Strip = styled.div`
  position: relative; display: flex; align-items: center;
  height: 40px; width: 100%; flex-shrink: 0; padding: 0 8px 0 10px;
  background: #115E59; border-bottom: 1px solid rgba(255, 255, 255, 0.1);
`;
const Scroll = styled.div`
  display: flex; align-items: center; gap: 4px; flex: 1; min-width: 0;
  overflow-x: auto; scrollbar-width: none;
  &::-webkit-scrollbar { display: none; }
`;
const Chip = styled.button<{ $active: boolean }>`
  display: inline-flex; align-items: center; gap: 7px; flex: 0 1 auto;
  max-width: 180px; min-width: 0; height: 30px; padding: 0 8px 0 10px;
  border: none; border-radius: 6px; cursor: pointer;
  background: ${(p) => (p.$active ? '#0F766E' : 'transparent')};
  color: ${(p) => (p.$active ? '#FFFFFF' : '#CCFBF1')};
  font-size: 13px; font-weight: ${(p) => (p.$active ? 600 : 500)};
  transition: background 0.12s, color 0.12s;
  &:hover { background: ${(p) => (p.$active ? '#0F766E' : 'rgba(255,255,255,0.08)')}; color: #FFFFFF; }
  &:focus-visible { outline: 2px solid #5EEAD4; outline-offset: 2px; }
  & > span[aria-hidden] { color: ${(p) => (p.$active ? '#FFFFFF' : '#5EEAD4')}; }
`;
const IconWrap = styled.span`display: inline-flex; flex-shrink: 0; line-height: 1;`;
const Title = styled.span`overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0;`;
const RecDot = styled.span`
  flex-shrink: 0; width: 6px; height: 6px; border-radius: 50%;
  background: #F43F5E; border: 1.5px solid #115E59;
`;
const Close = styled.button`
  display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0;
  width: 20px; height: 20px; margin-right: -4px; border: none; background: transparent;
  color: inherit; border-radius: 4px; cursor: pointer; opacity: 0.75;
  &:hover { background: rgba(255, 255, 255, 0.18); opacity: 1; }
`;
const Right = styled.div`display: flex; align-items: center; gap: 2px; flex-shrink: 0; padding-left: 6px;`;
const IconBtn = styled.button<{ $on: boolean }>`
  display: inline-flex; align-items: center; justify-content: center;
  width: 32px; height: 32px; border: none; border-radius: 8px; cursor: pointer;
  color: #99F6E4; background: ${(p) => (p.$on ? 'rgba(255,255,255,0.10)' : 'transparent')};
  &:hover { background: rgba(255, 255, 255, 0.10); color: #FFFFFF; }
  &:focus-visible { outline: 2px solid #5EEAD4; outline-offset: 2px; }
`;
const Backdrop = styled.div`position: fixed; inset: 0; z-index: 111;`;
const Menu = styled.div`
  position: absolute; top: 40px; z-index: 112; min-width: 200px; max-height: 60vh; overflow-y: auto;
  padding: 6px; background: #115E59; border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 10px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  scrollbar-width: none; &::-webkit-scrollbar { display: none; }
`;
const MenuItem = styled.button<{ $active: boolean }>`
  display: flex; align-items: center; gap: 9px; width: 100%; height: 34px; padding: 0 10px;
  border: none; border-radius: 7px; cursor: pointer; text-align: left;
  background: ${(p) => (p.$active ? 'rgba(255,255,255,0.10)' : 'transparent')};
  color: #CCFBF1; font-size: 13px; font-weight: 500;
  &:hover { background: rgba(255, 255, 255, 0.08); color: #FFFFFF; }
  & > span[aria-hidden] { color: #5EEAD4; display: inline-flex; flex-shrink: 0; }
`;
const MenuLabel = styled.span`flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`;
const OpenDot = styled.span`width: 4px; height: 4px; border-radius: 50%; background: #5EEAD4; flex-shrink: 0;`;
