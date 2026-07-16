// components/Tab/TabStrip.tsx — ⑥ 멀티탭 탭 스트립 (사이드바 오른쪽부터)
//
// 브라우저 탭 모델: 탭 안에서 더 들어가면 그 탭의 경로만 바뀜(새 탭 X). '+' 는 마지막 탭 옆, 새 탭 생성
// (같은 페이지도 중복 허용). 아이콘 없이 이름(경로) 텍스트만. 디자인 = 사이드바 색 토큰 수평 연장.
// 설계: docs/MULTITAB_DESIGN.md §1.
import { useLayoutEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useTabs, useActiveTab } from '../../hooks/useTabStore';
import { tabStore, type Tab, type TabKind } from '../../stores/tabStore';
import { XIcon, PlusIcon } from '../Common/Icons';

// kind → layout ns nav 라벨 키 (사이드바와 동일 문구, 언어전환 재렌더 보장)
const NAV_KEY: Record<TabKind, string> = {
  dashboard: 'nav.dashboard', inbox: 'nav.inbox', talk: 'nav.talk', mail: 'nav.qmail',
  task: 'nav.task', project: 'nav.project', projectDetail: 'nav.project', calendar: 'nav.calendar',
  note: 'nav.note', docs: 'nav.docs', info: 'nav.qinfo', files: 'nav.file',
  clients: 'nav.clients', bill: 'nav.qbill', other: 'nav.settings',
};

// 새 탭 드롭다운 — 사이드바 기능 순서 (path→newTab, 중복 허용)
const NEW_TAB_ITEMS: Array<{ kind: TabKind; path: string }> = [
  { kind: 'dashboard', path: '/dashboard' }, { kind: 'inbox', path: '/inbox' },
  { kind: 'talk', path: '/talk' }, { kind: 'mail', path: '/mail' },
  { kind: 'task', path: '/tasks' }, { kind: 'project', path: '/projects' },
  { kind: 'calendar', path: '/calendar' }, { kind: 'note', path: '/notes' },
  { kind: 'docs', path: '/docs' }, { kind: 'info', path: '/info' },
  { kind: 'files', path: '/files' }, { kind: 'bill', path: '/bills' },
  { kind: 'clients', path: '/business/clients' },
];

export default function TabStrip({ leftOffset = 0 }: { leftOffset?: number }) {
  const tabs = useTabs();
  const active = useActiveTab();
  const { t } = useTranslation('layout');
  const [open, setOpen] = useState(false);   // + 새탭 패널
  const [q, setQ] = useState('');
  const [anchorX, setAnchorX] = useState(0);
  const activeRef = useRef<HTMLButtonElement>(null);
  const newBtnRef = useRef<HTMLButtonElement>(null);

  const openNewPanel = () => {
    const r = newBtnRef.current?.getBoundingClientRect();
    if (r) setAnchorX(Math.max(6, Math.min(r.left, window.innerWidth - 260)));
    setQ(''); setOpen((v) => !v);
  };

  useLayoutEffect(() => {
    activeRef.current?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }, [active?.id]);

  if (tabs.length === 0) return null;
  const label = (tab: Tab) => tab.title || (t(NAV_KEY[tab.kind], { defaultValue: tab.kind }) as string);

  return (
    <Strip role="tablist" aria-label={t('tabs.strip', { defaultValue: '열린 탭' }) as string} data-testid="tabstrip" style={{ left: leftOffset }}>
      <Scroll>
        {tabs.map((tab) => {
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
              <TabLabel>{label(tab)}</TabLabel>
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
        {/* + 는 마지막 탭 옆 — 그냥 + 아이콘(배경 없음). 클릭 시 검색+리스트 패널 */}
        <NewBtn ref={newBtnRef} type="button" aria-label={t('tabs.new', { defaultValue: '새 탭' }) as string}
          data-testid="tabstrip-new" onClick={openNewPanel}><PlusIcon size={16} /></NewBtn>
      </Scroll>

      {open && (() => {
        const items = NEW_TAB_ITEMS
          .map((it) => ({ ...it, label: t(NAV_KEY[it.kind], { defaultValue: it.kind }) as string }))
          .filter((it) => !q.trim() || it.label.toLowerCase().includes(q.trim().toLowerCase()));
        return (
          <>
            <Backdrop onClick={() => setOpen(false)} />
            <Panel role="dialog" aria-label={t('tabs.new', { defaultValue: '새 탭' }) as string}
              style={{ left: anchorX }} data-testid="tabstrip-new-panel">
              <Search autoFocus value={q} onChange={(e) => setQ(e.target.value)}
                placeholder={t('tabs.searchPlaceholder', { defaultValue: '페이지 검색' }) as string}
                onKeyDown={(e) => { if (e.key === 'Enter' && items[0]) { tabStore.newTab(items[0].path); setOpen(false); } if (e.key === 'Escape') setOpen(false); }} />
              <List>
                {items.map((it) => (
                  <PanelItem key={it.path} type="button" onClick={() => { tabStore.newTab(it.path); setOpen(false); }}>
                    {it.label}
                  </PanelItem>
                ))}
                {items.length === 0 && <Empty>{t('tabs.noResults', { defaultValue: '결과 없음' }) as string}</Empty>}
              </List>
            </Panel>
          </>
        );
      })()}
    </Strip>
  );
}

// ── styled (사이드바 토큰 수평 연장) ──
const Strip = styled.div`
  position: fixed; top: 0; right: 0; z-index: 95;   /* left 는 inline(사이드바 폭) — 사이드바 오른쪽부터 */
  display: flex; align-items: stretch;              /* 탭이 위아래로 꽉 차게 */
  height: 40px; padding: 0;                          /* 좌측 바짝(첫 탭 = 사이드바 끝) */
  background: #115E59; border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  transition: left 0.25s ease;
`;
const Scroll = styled.div`
  display: flex; align-items: stretch; gap: 0; flex: 1; min-width: 0;
  overflow-x: auto; scrollbar-width: none;
  &::-webkit-scrollbar { display: none; }
`;
const Chip = styled.button<{ $active: boolean }>`
  display: inline-flex; align-items: center; gap: 6px; flex: 0 1 auto;
  max-width: 220px; min-width: 0; height: 40px; padding: 0 10px 0 14px;   /* 위아래 꽉 채움 */
  border: none; border-right: 1px solid rgba(255, 255, 255, 0.06); border-radius: 0;
  border-top: 2px solid ${(p) => (p.$active ? '#5EEAD4' : 'transparent')};  /* 활성 탭 상단 액센트 */
  cursor: pointer;
  background: ${(p) => (p.$active ? '#0F766E' : 'transparent')};
  color: ${(p) => (p.$active ? '#FFFFFF' : '#CCFBF1')};
  /* 굵기 고정(500) — 활성 시 굵기 변화로 글자·X 가 밀리는 것 방지. 활성 구분은 색·배경·상단 액센트로만 */
  font-size: 13px; font-weight: 500;
  transition: background 0.12s, color 0.12s;
  &:hover { background: ${(p) => (p.$active ? '#0F766E' : 'rgba(255,255,255,0.08)')}; color: #FFFFFF; }
  &:focus-visible { outline: 2px solid #5EEAD4; outline-offset: -2px; }
`;
const TabLabel = styled.span`overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0;`;
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
// + 는 그냥 아이콘 (라운드 배경 없음). hover 시 색만 밝게.
const NewBtn = styled.button`
  display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; align-self: center;
  width: 30px; height: 30px; margin: 0 4px; border: none; border-radius: 0; background: transparent; cursor: pointer;
  color: #99F6E4;
  &:hover { color: #FFFFFF; }
  &:focus-visible { outline: 2px solid #5EEAD4; outline-offset: -2px; }
`;
const Backdrop = styled.div`position: fixed; inset: 0; z-index: 111;`;
// + 아래 열리는 검색+리스트 패널
const Panel = styled.div`
  position: fixed; top: 40px; z-index: 112; width: 252px; max-height: 66vh;
  display: flex; flex-direction: column;
  background: #115E59; border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 10px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35); overflow: hidden;
`;
const Search = styled.input`
  flex-shrink: 0; margin: 8px; height: 34px; padding: 0 12px;
  border: 1px solid rgba(255, 255, 255, 0.18); border-radius: 8px;
  background: rgba(255, 255, 255, 0.06); color: #FFFFFF; font-size: 13px; outline: none;
  &::placeholder { color: #99F6E4; }
  &:focus { border-color: #5EEAD4; }
`;
const List = styled.div`
  flex: 1; min-height: 0; overflow-y: auto; padding: 0 6px 6px;
  scrollbar-width: none; &::-webkit-scrollbar { display: none; }
`;
const PanelItem = styled.button`
  display: flex; align-items: center; width: 100%; height: 34px; padding: 0 12px;
  border: none; border-radius: 7px; cursor: pointer; text-align: left;
  background: transparent; color: #CCFBF1; font-size: 13px; font-weight: 500;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  &:hover { background: rgba(255, 255, 255, 0.08); color: #FFFFFF; }
`;
const Empty = styled.div`padding: 14px 12px; text-align: center; font-size: 12px; color: #99F6E4;`;
