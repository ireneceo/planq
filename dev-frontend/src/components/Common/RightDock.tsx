// RightDock — 전역 우하단 통합 런처 (#9, N+93)
//   사용자 호소: "Q Talk 접근성이 쉬워야 한다 — 일하면서 채팅."
//   FAB 하나 → 펼치면 [Q Talk · Q Note · Q helper] → 클릭하면 각 도구를 자기 창으로 팝아웃.
//   - 데스크탑: window.open 으로 별도 창(작업화면을 안 덮고 옆에 두고 사용) — Irene 결정 "모두 팝아웃".
//   - 모바일: 별도 창 개념이 없으므로 in-app 으로 폴백 (Q Talk=페이지 이동, Q Note/Q helper=드로어/모달).
//   흩어진 FAB 2개(메모·헬프) 통합. 비즈니스 멤버에게만 노출 — 게스트/Client 는 기존 Q helper FAB 유지(별도).
//   분리 창(/*-popout, /memo/*) 안에서는 자기 안에 자기 뜨는 혼란 방지 위해 숨김.
import React, { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { isPopoutWindow } from '../../utils/popout';

export type DockTool = 'qtalk' | 'qnote' | 'qhelper';

/** 모바일 in-app 폴백 — MemoFab / CueHelpDrawer 가 듣는 전역 오픈 이벤트 */
export const openDockTool = (tool: DockTool) => {
  window.dispatchEvent(new CustomEvent('planq:open-tool', { detail: { tool } }));
};

const POPOUT_PATH: Record<DockTool, string> = {
  qtalk: '/talk-popout',
  qnote: '/note-popout',
  qhelper: '/help-popout',
};
// 도구별 분리 창 크기
const POPOUT_FEATURES: Record<DockTool, string> = {
  qtalk: 'width=520,height=780,menubar=no,toolbar=no,location=no,status=no',
  qnote: 'width=480,height=640,menubar=no,toolbar=no,location=no,status=no',
  qhelper: 'width=440,height=720,menubar=no,toolbar=no,location=no,status=no',
};

const FAB_HIDDEN_PREFIXES = ['/memo', '/talk-popout', '/note-popout', '/help-popout'];

const RightDock: React.FC = () => {
  const { t } = useTranslation('common');
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);
  const fabRef = useRef<HTMLDivElement>(null);

  const isBusinessMember = !!user?.business_id && ['owner', 'admin', 'member'].includes(user.business_role || '');
  const pathHidden = FAB_HIDDEN_PREFIXES.some((p) => location.pathname === p || location.pathname.startsWith(`${p}/`))
    || (typeof document !== 'undefined' && document.body.dataset.popout === '1')
    || isPopoutWindow(); // #84 — 팝아웃 창 내부 이동에도 FAB 숨김 유지

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

  if (!isBusinessMember || pathHidden) return null;

  // #80 — 빠른 만들기: 해당 페이지로 이동하며 생성 모달 자동 오픈(URL param). "진짜 퀵".
  const handleCreate = (kind: 'task' | 'mail' | 'event') => {
    setExpanded(false);
    if (kind === 'task') navigate('/tasks?create=1');
    else if (kind === 'mail') navigate('/mail?compose=1');
    else navigate('/calendar?create=1');
  };

  const handlePick = (tool: DockTool) => {
    setExpanded(false);
    const isMobile = typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches;
    if (isMobile) {
      // 모바일 — 별도 창 대신 in-app
      if (tool === 'qtalk') navigate('/talk');
      else openDockTool(tool);
      return;
    }
    // 데스크탑 — 도구를 각각 독립 창으로 팝아웃 (운영 #43/#45, 2026-06-16 결정).
    //   Document PiP("항상 위", #26)는 브라우저당 1개 제한(셋 중 하나만 열림) + 화면공유 시 자동 닫힘 →
    //   window.open 일반 창으로 전환. 도구별 고유 창 이름(pq-${tool})이라 셋 다 동시에 떠 있고,
    //   화상회의 화면공유 중에도 사라지지 않으며, 입력란 커서 포커스도 정상 동작(#44).
    window.open(POPOUT_PATH[tool], `pq-${tool}`, POPOUT_FEATURES[tool]);
  };

  return (
    <FabWrap ref={fabRef}>
      {expanded && (
        <Menu role="menu" aria-label={t('dock.menuLabel', '바로 열기') as string}>
          {/* #80 — 빠른 만들기 그룹 (열기 도구와 구분) */}
          <GroupLabel>{t('dock.createLabel', '빠른 만들기') as string}</GroupLabel>
          <MenuItem $create role="menuitem" type="button" onClick={() => handleCreate('task')}>
            <PlusIcon /><span>{t('dock.newTask', '업무')}</span>
          </MenuItem>
          <MenuItem $create role="menuitem" type="button" onClick={() => handleCreate('mail')}>
            <PlusIcon /><span>{t('dock.newMail', '메일')}</span>
          </MenuItem>
          <MenuItem $create role="menuitem" type="button" onClick={() => handleCreate('event')}>
            <PlusIcon /><span>{t('dock.newEvent', '일정')}</span>
          </MenuItem>
          <MenuDivider />
          <GroupLabel>{t('dock.openLabel', '열기') as string}</GroupLabel>
          <MenuItem role="menuitem" type="button" onClick={() => handlePick('qtalk')}>
            <ItemIcon $bg="#0F766E"><IconTalk /></ItemIcon>
            <span>{t('dock.qtalk', 'Q Talk')}</span>
          </MenuItem>
          <MenuItem role="menuitem" type="button" onClick={() => handlePick('qnote')}>
            <ItemIcon $bg="#14B8A6"><IconNote /></ItemIcon>
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
  /* N+93 — 버튼 가로폭 동일 + 아이콘 좌측 정렬: 고정폭 컬럼에 stretch */
  display: flex; flex-direction: column; align-items: stretch; gap: 8px;
  width: 188px;
  animation: dockIn 0.14s ease-out;
  @keyframes dockIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
`;

const MenuItem = styled.button<{ $create?: boolean }>`
  width: 100%;
  display: inline-flex; align-items: center; justify-content: flex-start; gap: 10px;
  padding: ${({ $create }) => ($create ? '8px 14px' : '8px 14px 8px 8px')};
  background: #FFFFFF;
  border: 1px solid #E2E8F0; border-radius: 12px;
  box-shadow: 0 4px 14px rgba(15,23,42,0.12);
  cursor: pointer;
  font-size: 14px; font-weight: 600; color: #0F172A;
  text-align: left;
  transition: transform 0.12s, box-shadow 0.12s;
  &:hover { transform: translateY(-1px); box-shadow: 0 6px 18px rgba(15,23,42,0.16); ${({ $create }) => $create && 'border-color: #14B8A6; color: #0F766E;'} }
  &:focus-visible { outline: 2px solid rgba(15,118,110,0.5); outline-offset: 2px; }
  span { white-space: nowrap; }
`;

const ItemIcon = styled.span<{ $bg: string }>`
  width: 32px; height: 32px; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  background: ${({ $bg }) => $bg}; color: #FFFFFF; flex-shrink: 0;
`;
// #80 — 빠른 만들기 그룹 라벨 · 구분선 · + 아이콘
const GroupLabel = styled.div`
  font-size: 10px; font-weight: 700; color: #94A3B8; text-transform: uppercase; letter-spacing: 0.5px;
  padding: 2px 6px 0; align-self: flex-end; text-align: right; width: 100%;
`;
const MenuDivider = styled.div`height: 1px; background: #E2E8F0; margin: 2px 4px;`;
const PlusIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#14B8A6" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
);
