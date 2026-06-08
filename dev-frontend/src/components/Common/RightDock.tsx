// RightDock — 전역 우하단 통합 런처 (#9, N+93)
//   사용자 호소: "Q Talk 접근성이 쉬워야 한다 — 일하면서 채팅."
//   FAB 하나 → 펼치면 [Q Talk · Q Note · Q helper] → 선택. 흩어진 FAB 2개(메모·헬프) 통합.
//   - Q Talk: 이 컴포넌트가 보유한 embedded 드로어로 즉시 채팅 + ⧉ 팝아웃(별도 창에서 일하면서 채팅)
//   - Q Note / Q helper: window 이벤트(planq:open-tool)로 기존 MemoFab / CueHelpDrawer 오픈
//   비즈니스 멤버(owner/admin/member)에게만 노출 — 게스트/Client 는 기존 Q helper FAB 유지(별도).
//   분리 창(/talk-popout, /memo/*) 안에서는 자기 안에 자기 뜨는 혼란 방지 위해 숨김.
import React, { useEffect, useRef, useState, lazy, Suspense } from 'react';
import styled from 'styled-components';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { useEscapeStack } from '../../hooks/useEscapeStack';

const QTalkPage = lazy(() => import('../../pages/QTalk/QTalkPage'));

export type DockTool = 'qtalk' | 'qnote' | 'qhelper';

/** 다른 컴포넌트(MemoFab/CueHelpDrawer)가 듣는 전역 오픈 이벤트 */
export const openDockTool = (tool: DockTool) => {
  window.dispatchEvent(new CustomEvent('planq:open-tool', { detail: { tool } }));
};

const FAB_HIDDEN_PREFIXES = ['/memo', '/talk-popout'];

const RightDock: React.FC = () => {
  const { t } = useTranslation('common');
  const { user } = useAuth();
  const location = useLocation();
  const [expanded, setExpanded] = useState(false);
  const [talkOpen, setTalkOpen] = useState(false);
  const fabRef = useRef<HTMLDivElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);

  const isBusinessMember = !!user?.business_id && ['owner', 'admin', 'member'].includes(user.business_role || '');
  const pathHidden = FAB_HIDDEN_PREFIXES.some((p) => location.pathname === p || location.pathname.startsWith(`${p}/`))
    || (typeof document !== 'undefined' && document.body.dataset.popout === '1');

  useBodyScrollLock(talkOpen);
  useEscapeStack(talkOpen, () => setTalkOpen(false));

  // 펼침 메뉴 — 외부 클릭/Esc 닫기
  useEffect(() => {
    if (!expanded) return;
    const onDoc = (e: MouseEvent) => {
      if (fabRef.current?.contains(e.target as Node)) return;
      setExpanded(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setExpanded(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [expanded]);

  if (!isBusinessMember) return null;

  const businessId = Number(user!.business_id);

  const handlePick = (tool: DockTool) => {
    setExpanded(false);
    if (tool === 'qtalk') { setTalkOpen(true); return; }
    openDockTool(tool); // MemoFab / CueHelpDrawer 가 수신
  };

  const popoutTalk = () => {
    window.open('/talk-popout', `pq-talk-${businessId}`, 'width=520,height=780,menubar=no,toolbar=no,location=no,status=no');
    setTalkOpen(false);
  };

  return (
    <>
      {!pathHidden && (
        <FabWrap ref={fabRef}>
          {expanded && (
            <Menu role="menu" aria-label={t('dock.menuLabel', '바로 열기') as string}>
              <MenuItem role="menuitem" type="button" onClick={() => handlePick('qtalk')}>
                <ItemIcon $bg="#0F766E"><IconTalk /></ItemIcon>
                <span>{t('dock.qtalk', 'Q Talk')}</span>
              </MenuItem>
              <MenuItem role="menuitem" type="button" onClick={() => handlePick('qnote')}>
                <ItemIcon $bg="#0EA5A4"><IconNote /></ItemIcon>
                <span>{t('dock.qnote', 'Q Note')}</span>
              </MenuItem>
              <MenuItem role="menuitem" type="button" onClick={() => handlePick('qhelper')}>
                <ItemIcon $bg="#F43F5E"><IconHelp /></ItemIcon>
                <span>{t('dock.qhelper', 'Q helper')}</span>
              </MenuItem>
            </Menu>
          )}
          <Fab
            type="button"
            $expanded={expanded}
            aria-expanded={expanded}
            aria-label={t('dock.toggle', '바로 열기 — Q Talk · Q Note · Q helper') as string}
            title={t('dock.toggle', '바로 열기 — Q Talk · Q Note · Q helper') as string}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? <IconClose /> : <IconDock />}
          </Fab>
        </FabWrap>
      )}

      {talkOpen && (
        <>
          <Backdrop onClick={() => setTalkOpen(false)} />
          <TalkDrawer ref={drawerRef} role="dialog" aria-modal="true" aria-label={t('dock.qtalk', 'Q Talk') as string}>
            <DrawerHead>
              <DrawerTitle><IconTalk /> {t('dock.qtalk', 'Q Talk')}</DrawerTitle>
              <HeadActions>
                <HeadBtn type="button" onClick={popoutTalk} title={t('dock.popout', '새 창으로 분리') as string} aria-label={t('dock.popout', '새 창으로 분리') as string}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M15 3h6v6"/><path d="M10 14L21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                  </svg>
                </HeadBtn>
                <HeadBtn type="button" onClick={() => setTalkOpen(false)} title={t('close', '닫기') as string} aria-label={t('close', '닫기') as string}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </HeadBtn>
              </HeadActions>
            </DrawerHead>
            <DrawerBody>
              <Suspense fallback={<DrawerLoading><Spinner /></DrawerLoading>}>
                <QTalkPage embedded />
              </Suspense>
            </DrawerBody>
          </TalkDrawer>
        </>
      )}
    </>
  );
};

export default RightDock;

// ===== icons =====
const IconDock = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
  </svg>
);
const IconClose = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
);
const IconTalk = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
);
const IconNote = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="13" y2="17"/></svg>
);
const IconHelp = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
);

// ===== styled =====
const FabWrap = styled.div`
  position: fixed; right: 20px; bottom: 16px;
  z-index: 45;
  display: flex; flex-direction: column; align-items: flex-end; gap: 10px;
  @media (max-width: 640px) { right: 16px; bottom: 16px; }
  body[data-overlay-open="true"] & { opacity: 0; pointer-events: none; visibility: hidden; }
`;

const Fab = styled.button<{ $expanded: boolean }>`
  width: 52px; height: 52px;
  display: inline-flex; align-items: center; justify-content: center;
  background: ${({ $expanded }) => ($expanded ? '#0F172A' : '#0F766E')};
  color: #FFFFFF;
  border: none; border-radius: 50%;
  box-shadow: 0 4px 16px rgba(15,118,110,0.30);
  cursor: pointer;
  transition: transform 0.15s, background 0.15s;
  &:hover { transform: translateY(-1px); }
  &:focus-visible { outline: 2px solid rgba(15,118,110,0.5); outline-offset: 4px; }
  @media (max-width: 640px) { width: 48px; height: 48px; }
`;

const Menu = styled.div`
  display: flex; flex-direction: column; align-items: flex-end; gap: 8px;
  animation: dockIn 0.14s ease-out;
  @keyframes dockIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
`;

const MenuItem = styled.button`
  display: inline-flex; align-items: center; gap: 10px;
  padding: 7px 14px 7px 8px;
  background: #FFFFFF;
  border: 1px solid #E2E8F0; border-radius: 999px;
  box-shadow: 0 4px 14px rgba(15,23,42,0.12);
  cursor: pointer;
  font-size: 14px; font-weight: 600; color: #0F172A;
  transition: transform 0.12s, box-shadow 0.12s;
  &:hover { transform: translateY(-1px); box-shadow: 0 6px 18px rgba(15,23,42,0.16); }
  &:focus-visible { outline: 2px solid rgba(15,118,110,0.5); outline-offset: 2px; }
  span { white-space: nowrap; }
`;

const ItemIcon = styled.span<{ $bg: string }>`
  width: 32px; height: 32px; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  background: ${({ $bg }) => $bg}; color: #FFFFFF; flex-shrink: 0;
`;

const Backdrop = styled.div`
  position: fixed; inset: 0;
  background: rgba(15,23,42,0.32);
  z-index: 60;
  @media (max-width: 640px) { background: rgba(15,23,42,0.5); }
`;

const TalkDrawer = styled.div`
  position: fixed; top: 0; right: 0; bottom: 0;
  width: min(760px, 92vw);
  background: #FFFFFF;
  box-shadow: -8px 0 28px rgba(15,23,42,0.18);
  z-index: 61;
  display: flex; flex-direction: column;
  animation: dockSlide 0.18s ease-out;
  @keyframes dockSlide { from { transform: translateX(24px); opacity: 0.6; } to { transform: translateX(0); opacity: 1; } }
  @media (max-width: 1024px) { width: min(560px, 90vw); }
  @media (max-width: 640px) {
    width: 100vw;
    box-shadow: none;
    padding-bottom: env(safe-area-inset-bottom);
  }
`;

const DrawerHead = styled.div`
  flex-shrink: 0;
  min-height: 56px;
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 12px 10px 18px;
  border-bottom: 1px solid #E2E8F0;
  background: #FFFFFF;
`;
const DrawerTitle = styled.div`
  display: inline-flex; align-items: center; gap: 8px;
  font-size: 16px; font-weight: 700; color: #0F172A;
  svg { color: #0F766E; }
`;
const HeadActions = styled.div` display: inline-flex; align-items: center; gap: 4px; `;
const HeadBtn = styled.button`
  width: 36px; height: 36px;
  display: inline-flex; align-items: center; justify-content: center;
  background: transparent; border: none; border-radius: 8px;
  color: #64748B; cursor: pointer;
  &:hover { background: #F1F5F9; color: #0F172A; }
  &:focus-visible { outline: 2px solid rgba(15,118,110,0.5); outline-offset: 2px; }
`;
const DrawerBody = styled.div`
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  overflow: hidden;
`;
const DrawerLoading = styled.div` flex: 1; display: flex; align-items: center; justify-content: center; `;
const Spinner = styled.div`
  width: 32px; height: 32px;
  border: 3px solid #E2E8F0; border-top-color: #0F766E; border-radius: 50%;
  animation: spin 0.9s linear infinite;
  @keyframes spin { to { transform: rotate(360deg); } }
`;
