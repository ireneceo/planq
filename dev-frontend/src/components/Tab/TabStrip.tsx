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
import { useAuth } from '../../contexts/AuthContext';
import GlobalSearchModal from '../Common/GlobalSearchModal';

// kind → layout ns nav 라벨 키 (사이드바와 동일 문구, 언어전환 재렌더 보장)
const NAV_KEY: Record<TabKind, string> = {
  dashboard: 'nav.dashboard', inbox: 'nav.inbox', talk: 'nav.talk', mail: 'nav.qmail',
  task: 'nav.task', project: 'nav.project', projectDetail: 'nav.project', calendar: 'nav.calendar',
  note: 'nav.note', docs: 'nav.docs', info: 'nav.qinfo', files: 'nav.file',
  clients: 'nav.clients', bill: 'nav.qbill', other: 'nav.settings',
};

export default function TabStrip({ leftOffset = 0 }: { leftOffset?: number }) {
  const tabs = useTabs();
  const active = useActiveTab();
  const { t } = useTranslation('layout');
  const { user } = useAuth();
  const bizId = user?.business_id ? Number(user.business_id) : 0;
  const [searchOpen, setSearchOpen] = useState(false); // + → 통합검색(새 탭으로 열기)
  const activeRef = useRef<HTMLButtonElement>(null);

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
        {/* + 는 마지막 탭 옆 — 그냥 + 아이콘(배경 없음). 클릭 시 통합검색(결과 클릭 = 새 탭) */}
        <NewBtn type="button" aria-label={t('tabs.new', { defaultValue: '새 탭' }) as string}
          data-testid="tabstrip-new" onClick={() => setSearchOpen(true)}><PlusIcon size={16} /></NewBtn>
      </Scroll>

      {/* + = 통합검색. 결과 클릭 = 새 탭으로 열기(navigate 대신 newTab 주입) */}
      <GlobalSearchModal open={searchOpen} onClose={() => setSearchOpen(false)} businessId={bizId}
        onNavigate={(to) => tabStore.newTab(to)} />
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
