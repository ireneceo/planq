import React, { Suspense, useState, useEffect, useRef } from 'react';
import styled, { css } from 'styled-components';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { displayName } from '../../utils/displayName';
import { useAuth } from '../../contexts/AuthContext';
import LanguageSelector from '../Common/LanguageSelector';
import WorkspaceSwitcher from './WorkspaceSwitcher';
import GlobalSearchModal from '../Common/GlobalSearchModal';
import WorkspaceBillingBanner from './WorkspaceBillingBanner';
import SidebarClock from './SidebarClock';
import FocusWidget from '../Focus/FocusWidget';
import PanelHeader, { PanelTitle } from './PanelHeader';
import { useTimezones } from '../../hooks/useTimezones';
import { useInboxCount } from '../../hooks/useInboxCount';
import { useAdminInboxCounts } from '../../hooks/useAdminInboxCounts';
import { useNotificationCount } from '../../hooks/useNotifications';
import NotificationDropdown from '../Common/NotificationDropdown';
import { useUnreadTotal } from '../../hooks/useUnreadTotal';
import { useGlobalBadge } from '../../hooks/useGlobalBadge';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { useAppShellLock } from '../../hooks/useAppShellLock';
import { mediaTablet } from '../../theme/breakpoints';
import InstallPromptBanner from '../Common/InstallPromptBanner';
import PushPromptBanner from '../Common/PushPromptBanner';
import { isNativeApp } from '../../services/native';
import i18n from '../../i18n';

// ─────────────────────────────────────────────────────────────
// localStorage
// ─────────────────────────────────────────────────────────────
const LS_COLLAPSED = 'planq.sidebar.collapsed';
const readLS = (key: string, defaultValue: boolean): boolean => {
  try {
    const v = localStorage.getItem(key);
    return v === null ? defaultValue : v === 'true';
  } catch { return defaultValue; }
};
const writeLS = (key: string, value: boolean) => {
  try { localStorage.setItem(key, String(value)); } catch { /* noop */ }
};

// ─────────────────────────────────────────────────────────────
// Width constants
// ─────────────────────────────────────────────────────────────
const SIDEBAR_W_OPEN = 220;
const SIDEBAR_W_COLLAPSED = 64;
const SECONDARY_W = 220;
const SECONDARY_COLLAPSED_W = 56;   // 아이콘 strip 모드 폭
const SECONDARY_COLLAPSED_KEY = 'planq.secondaryCollapsed';

// ─────────────────────────────────────────────────────────────
// Styled — Sidebar (1뎁스)
// ─────────────────────────────────────────────────────────────

const LayoutContainer = styled.div`
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background-color: #F8FAFC;
  -webkit-font-smoothing: antialiased;
  /* N+31 — viewport 단위 vvh 일관화.
     N+29 가 height:100% 로 toolbar 흔들림은 잡았으나 모바일 PWA 에서
     body(정적 layout viewport) ≠ Layout(동적 vvh) 으로 빈 공간 회귀.
     LayoutContainer 도 vvh 단위로 맞춰 자식 Layout 과 동기화. */
  height: var(--vvh, 100dvh);
  display: flex;
  flex-direction: column;
  overflow: hidden;
`;

const Sidebar = styled.div<{ $isOpen?: boolean; $isCollapsed?: boolean }>`
  position: fixed; top: 0; left: 0;
  width: ${props => props.$isCollapsed ? `${SIDEBAR_W_COLLAPSED}px` : `${SIDEBAR_W_OPEN}px`};
  height: 100vh;
  background: linear-gradient(180deg, #115E59 0%, #134E4A 100%);
  z-index: 100; display: flex; flex-direction: column;
  transition: width 0.25s ease; overflow-x: hidden;
  ${mediaTablet} {
    transform: translateX(${props => props.$isOpen ? '0' : '-100%'});
    width: 240px; transition: transform 0.3s, width 0.3s ease;
    /* 모바일 브라우저에서 주소창 포함 문제 해결 */
    height: 100dvh;
    height: -webkit-fill-available;
  }
`;

const SidebarHeader = styled.div<{ $isCollapsed?: boolean }>`
  padding: 14px 16px; border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  flex-shrink: 0; height: 60px;   /* 2뎁스·콘텐츠 헤더와 픽셀 동일 — 회색 라인 정렬 */
  display: flex; align-items: center;
  justify-content: ${props => props.$isCollapsed ? 'center' : 'space-between'};
  gap: 8px;
  ${mediaTablet} { justify-content: space-between; }
`;

const Logo = styled.img`
  width: 80px; height: auto; max-height: 32px; object-fit: contain;
  display: block; user-select: none; flex-shrink: 0;
`;

/* N+63 — 사이드바 헤더 우측 버튼 그룹 (종 + 토글). 묶음 정렬 + 작은 gap. */
const HeaderActions = styled.div`
  display: flex; align-items: center; gap: 2px;
  margin-left: auto;
`;

/* N+63 — 시인성·세련도 강화. circle bg + 굵은 chevron + hover scale/translate.
   옛: 18×18 stroke 2.2 + subtle hover → 사용자 호소 "너무 얇아서 알기 어려움".
   새: 32×32 클릭 영역 + 28×28 circle bg (always visible) + 20×20 chevron stroke 2.6 + hover 시 scale 1.08 + 화살표 방향 살짝 translate. */
/* N+63 — 사이드바 헤더 종 모양 (알림 feed dropdown trigger). 좌측 메뉴 숫자 (확인필요) 와 분리.
   심플 디자인 — circle bg 제거, transparent 평소 + subtle hover. 옆 SidebarToggleButton 과 페어. */
const BellButton = styled.button`
  position: relative;
  width: 32px; height: 32px;
  background: transparent;
  border: none;
  cursor: pointer; padding: 0;
  display: flex; align-items: center; justify-content: center;
  color: #99F6E4;
  border-radius: 8px;
  transition: background 0.15s, color 0.15s;
  &:hover { background: rgba(255, 255, 255, 0.10); color: #FFFFFF; }
  &:active { background: rgba(255, 255, 255, 0.18); }
  &:focus-visible { outline: 2px solid #5EEAD4; outline-offset: 2px; }
`;
const BellBadge = styled.span`
  position: absolute; top: 0; right: 0;
  min-width: 14px; height: 14px; padding: 0 3px;
  background: #F43F5E; color: #FFFFFF;
  border-radius: 999px;
  font-size: 9px; font-weight: 700; line-height: 14px;
  display: inline-flex; align-items: center; justify-content: center;
  border: 1.5px solid #115E59;
`;

/* N+63 — 사이드바 헤더 토글. BellButton 과 페어 — 동일 톤 (transparent + subtle hover bg).
   옛 circle bg 두 개 무거움 → 심플 transparent. chevron nudge 시인성 유지. */
const SidebarToggleButton = styled.button`
  width: 32px; height: 32px;
  background: transparent;
  border: none;
  cursor: pointer; padding: 0;
  display: flex; align-items: center; justify-content: center;
  color: #99F6E4;
  border-radius: 8px;
  transition: background 0.15s, color 0.15s;
  &:hover {
    background: rgba(255, 255, 255, 0.10);
    color: #FFFFFF;
  }
  &:hover svg { animation: chevronNudge 0.6s ease infinite; }
  &:active { background: rgba(255, 255, 255, 0.18); }
  &:focus-visible { outline: 2px solid #5EEAD4; outline-offset: 2px; }
  svg { width: 16px; height: 16px; transition: transform 0.15s ease; }
  @keyframes chevronNudge {
    0%, 100% { transform: translateX(0); }
    50% { transform: translateX(2px); }
  }
  @media (prefers-reduced-motion: reduce) {
    &:hover svg { animation: none; }
  }
  ${mediaTablet} { display: none; }
`;

const MobileCloseButton = styled.button`
  display: none;
  background: none; border: none; cursor: pointer; padding: 6px;
  align-items: center; justify-content: center;
  color: #CCFBF1; border-radius: 6px; transition: all 0.2s;
  min-width: 44px; min-height: 44px;
  &:hover { background: rgba(255, 255, 255, 0.08); color: #FFFFFF; }
  svg { width: 20px; height: 20px; }
  ${mediaTablet} { display: flex; }
`;

const SidebarNav = styled.nav`
  padding: 8px 0 24px 0; flex: 1; overflow-y: auto; overflow-x: hidden;
  &::-webkit-scrollbar { width: 6px; }
  &::-webkit-scrollbar-track { background: transparent; }
  &::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.2); border-radius: 3px; }
`;

// 통합 검색 — NavItem 과 동일한 메뉴 항목 스타일 (input 형태 X, 클릭만 하는 메뉴)
const GlobalSearchTrigger = styled.button`
  display: flex; align-items: center;
  width: 100%;
  /* 워크스페이스 카드와 시각적 분리 — 위쪽 여백 8px */
  margin-top: 8px;
  padding: 4px 16px;
  min-height: 28px;
  background: transparent;
  border: none;
  color: #CCFBF1; cursor: pointer;
  font-size: 13px; font-weight: 500;
  transition: all 0.15s;
  text-align: left;
  white-space: nowrap;
  &:hover { background: rgba(255,255,255,0.08); color: #FFFFFF; }
  &:focus-visible { outline: 2px solid rgba(94,234,212,0.4); outline-offset: -2px; }
  ${mediaTablet} { padding: 8px 16px; min-height: 44px; font-size: 14px; }
`;
const SearchIconSvg = styled.svg`
  width: 20px; flex-shrink: 0;
  margin-right: 10px;
  color: #5EEAD4;
`;
const SearchPlaceholder = styled.span`
  flex: 1;
`;
const SearchKbd = styled.kbd`
  font-size: 10px; font-family: inherit; font-weight: 600;
  padding: 1px 5px;
  background: rgba(94,234,212,0.10);
  border: 1px solid rgba(94,234,212,0.18);
  border-radius: 4px;
  color: rgba(94,234,212,0.8);
  flex-shrink: 0;
  margin-left: 8px;
  /* 키보드 단축키 힌트 — 터치/모바일에선 무의미하므로 숨김 */
  @media (hover: none), (max-width: 640px) { display: none; }
`;

const NavSection = styled.div`margin-bottom: 0;`;

const NavTitle = styled.div<{ $isCollapsed?: boolean }>`
  color: rgba(204, 251, 241, 0.5); font-size: 11px; font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.5px;
  padding: 0 16px; margin-bottom: 6px; margin-top: 20px;
  ${props => props.$isCollapsed && css`
    @media (min-width: 769px) {
      padding: 0;
      margin-top: 12px;
      margin-bottom: 4px;
      height: 1px;
      background: rgba(255, 255, 255, 0.08);
      color: transparent;
      overflow: hidden;
    }
  `}
`;

const NavItem = styled(Link)<{ $active?: boolean; $isCollapsed?: boolean }>`
  position: relative;
  display: flex; align-items: center;
  padding: ${props => props.$isCollapsed ? '6px 0' : '4px 16px'};
  justify-content: ${props => props.$isCollapsed ? 'center' : 'flex-start'};
  color: #CCFBF1; text-decoration: none; transition: all 0.15s;
  font-size: 13px; font-weight: 500;
  min-height: ${props => props.$isCollapsed ? '36px' : '28px'};
  white-space: nowrap;
  &:hover { background: rgba(255, 255, 255, 0.08); color: #FFFFFF; }
  ${props => props.$active && `
    color: #FFFFFF;
    background: #0F766E;
    font-weight: 600;
  `}
  ${mediaTablet} {
    padding: 8px 16px;
    justify-content: flex-start;
    min-height: 44px;
    font-size: 14px;
  }
`;

const NavIcon = styled.span<{ $isCollapsed?: boolean }>`
  width: 20px;
  margin-right: ${props => props.$isCollapsed ? '0' : '10px'};
  display: flex;
  align-items: center; justify-content: center; font-size: 15px;
  color: #5EEAD4;
  ${mediaTablet} { margin-right: 10px; }
`;

const NavLabel = styled.span<{ $isCollapsed?: boolean }>`
  ${props => props.$isCollapsed && css`
    @media (min-width: 1025px) { display: none; }
  `}
`;

// 인박스 미처리 카운트 — pill 배지 (확장 상태) / 작은 dot (collapsed 상태)
// 통일 정책: 모든 알림 카운트는 숫자만 표시. 점 표시 X (Irene 명시).
// 사이드바 expanded — 메뉴 라벨 우측 inline. collapsed — 아이콘 우상단 absolute (NavItem 안).
const InboxBadge = styled.span<{ $collapsed?: boolean }>`
  margin-left: auto;
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 20px; height: 18px; padding: 0 6px;
  background: #F43F5E; color: #FFFFFF;
  font-size: 10px; font-weight: 700; line-height: 1;
  border-radius: 999px;
  ${p => p.$collapsed && `
    position: absolute;
    top: 2px;
    right: 2px;
    margin-left: 0;
    min-width: 16px;
    height: 14px;
    padding: 0 4px;
    font-size: 9px;
    pointer-events: none;
  `}
`;

// ─────────────────────────────────────────────────────────────
// SecondaryPanel — 2뎁스 (통계·분석 / 워크스페이스 전용)
// ─────────────────────────────────────────────────────────────

const SecondaryPanel = styled.aside<{ $sidebarW: number; $collapsed: boolean }>`
  position: fixed; top: 0;
  left: ${props => props.$sidebarW}px;
  width: ${props => props.$collapsed ? SECONDARY_COLLAPSED_W : SECONDARY_W}px;
  height: 100vh;
  background: #FFFFFF;
  border-right: 1px solid #E2E8F0;
  z-index: 90;
  display: flex; flex-direction: column;
  transition: left 0.25s ease, width 0.25s ease;
  ${mediaTablet} { display: none; }
`;

const SecondaryBody = styled.div`
  flex: 1; overflow-y: auto; padding: 10px 0;
  &::-webkit-scrollbar { width: 6px; }
  &::-webkit-scrollbar-track { background: transparent; }
  &::-webkit-scrollbar-thumb { background: rgba(15, 23, 42, 0.12); border-radius: 3px; }
`;

// SecondaryPanel(데스크탑 설정) 그룹 구분 라벨 — 워크스페이스 설정 / 개인 설정
const SecondaryGroupLabel = styled.div`
  display: flex; align-items: center; gap: 7px;
  padding: 12px 16px 6px 20px;
  font-size: 11px; font-weight: 800; letter-spacing: 0.5px; text-transform: uppercase;
  color: #64748B;
  &::before { content: ''; width: 5px; height: 5px; border-radius: 50%; background: #14B8A6; flex-shrink: 0; }
  &:not(:first-child) { margin-top: 8px; border-top: 1px solid #F1F5F9; padding-top: 14px; }
`;


const SecondaryNavItem = styled(Link)<{ $active?: boolean; $collapsed?: boolean }>`
  display: flex; align-items: center; gap: 10px;
  padding: 9px 20px;
  color: #334155; text-decoration: none;
  font-size: 13px; font-weight: 500;
  transition: all 0.15s;
  border-left: 3px solid transparent;
  svg { width: 16px; height: 16px; color: #64748B; flex-shrink: 0; }
  &:hover { background: #F1F5F9; color: #0F172A; }
  ${props => props.$active && css`
    background: #F0FDFA;
    color: #0F766E;
    font-weight: 600;
    border-left-color: #0F766E;
    svg { color: #0F766E; }
  `}
  /* collapsed 모드: 아이콘만 가운데, 텍스트는 font-size:0 으로 숨김 */
  ${props => props.$collapsed && css`
    justify-content: center;
    padding: 10px 0;
    gap: 0;
    font-size: 0;
    svg { font-size: initial; width: 18px; height: 18px; }
    border-left-width: 0;
    border-right: 3px solid transparent;
    ${props.$active && css`border-right-color: #0F766E;`}
  `}
`;

/* N+63 — light bg 위 circle + hover scale/nudge. SidebarToggleButton 의 light variant. */
const SecondaryCloseButton = styled.button`
  width: 32px; height: 32px;
  flex-shrink: 0;
  background: #F8FAFC;
  border: 1px solid #E2E8F0;
  cursor: pointer; padding: 0;
  display: flex; align-items: center; justify-content: center;
  color: #475569; border-radius: 50%;
  transition: background 0.18s ease, border-color 0.18s ease, color 0.18s ease, transform 0.18s ease;
  &:hover {
    background: #F0FDFA;
    border-color: #5EEAD4;
    color: #0F766E;
    transform: scale(1.08);
  }
  &:hover svg { animation: chevronNudge 0.6s ease infinite; }
  &:active { transform: scale(0.96); }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 2px; }
  svg { width: 16px; height: 16px; transition: transform 0.18s ease; }
  @keyframes chevronNudge {
    0%, 100% { transform: translateX(0); }
    50% { transform: translateX(2px); }
  }
  @media (prefers-reduced-motion: reduce) {
    transition: none;
    &:hover { transform: none; }
    &:hover svg { animation: none; }
    &:active { transform: none; }
  }
`;

// ─────────────────────────────────────────────────────────────
// Footer / Mobile
// ─────────────────────────────────────────────────────────────

const SidebarFooter = styled.div<{ $isCollapsed?: boolean }>`
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  padding: ${props => props.$isCollapsed ? '10px 6px' : '12px 16px'};
  flex-shrink: 0;
  ${props => props.$isCollapsed && css`
    @media (min-width: 1025px) {
      display: flex; flex-direction: column; align-items: center; gap: 8px;
    }
  `}
  ${mediaTablet} {
    padding: 12px 16px;
    padding-bottom: calc(12px + env(safe-area-inset-bottom, 0px));
    display: block;
  }
`;

const UserAvatar = styled.div`
  width: 32px; height: 32px; border-radius: 50%;
  background: #0F766E; color: #FFFFFF;
  display: flex; align-items: center; justify-content: center;
  font-size: 13px; font-weight: 600; flex-shrink: 0;
`;
// N+63 — 옛 UserInfo/UserName/UserRoleText/LogoutButton 제거 (UserMenuButton 통합으로 대체)

const CollapsedAvatarButton = styled.button`
  background: none; border: none; padding: 0; cursor: pointer;
  width: 36px; height: 36px; border-radius: 50%;
  background: #0F766E; color: #FFFFFF;
  display: flex; align-items: center; justify-content: center;
  font-size: 14px; font-weight: 600;
  transition: all 0.15s;
  &:hover { background: #0D5E56; }
`;

const CollapsedLogoutIcon = styled.button`
  background: none; border: 1px solid rgba(255, 255, 255, 0.15);
  padding: 8px; cursor: pointer; border-radius: 6px;
  color: #CCFBF1; display: flex; align-items: center; justify-content: center;
  transition: all 0.15s;
  &:hover { background: rgba(220, 38, 38, 0.15); color: #FCA5A5; border-color: rgba(220, 38, 38, 0.3); }
  svg { width: 14px; height: 14px; }
`;

// N+63 — UserMenu 통합 컴포넌트
const UserMenuWrap = styled.div`
  position: relative;
`;
const UserMenuButton = styled.button`
  width: 100%; padding: 6px 8px;
  display: flex; align-items: center; gap: 8px;
  background: transparent; border: 1px solid transparent;
  border-radius: 8px; cursor: pointer; color: #FFFFFF;
  transition: background 0.15s, border-color 0.15s;
  &:hover { background: rgba(255, 255, 255, 0.06); }
  &:focus-visible { outline: none; border-color: rgba(255, 255, 255, 0.2); }
`;
const UserMenuName = styled.span`
  flex: 1; min-width: 0;
  font-size: 13px; font-weight: 500; color: #FFFFFF;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  text-align: left;
`;
const UserMenuChevron = styled.span<{ $open: boolean }>`
  width: 14px; height: 14px;
  display: flex; align-items: center; justify-content: center;
  color: #99F6E4; flex-shrink: 0;
  transition: transform 0.15s;
  transform: ${({ $open }) => $open ? 'rotate(180deg)' : 'rotate(0deg)'};
  svg { width: 14px; height: 14px; }
`;
const UserMenuPopover = styled.div`
  position: absolute; bottom: calc(100% + 6px); left: 0; right: 0;
  background: #115E59;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  padding: 8px;
  z-index: 50;
  display: flex; flex-direction: column; gap: 2px;
`;
const UserMenuMeta = styled.div`
  padding: 6px 10px 8px;
`;
const UserMenuMetaName = styled.div`
  font-size: 13px; font-weight: 600; color: #FFFFFF;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
`;
const UserMenuMetaRole = styled.div`
  font-size: 11px; color: #5EEAD4; margin-top: 2px;
`;
const UserMenuDivider = styled.div`
  height: 1px; background: rgba(255, 255, 255, 0.1); margin: 4px 0;
`;
const UserMenuLangRow = styled.div`
  padding: 4px 6px;
`;
const UserMenuItemBase = css<{ $danger?: boolean }>`
  display: flex; align-items: center;
  padding: 8px 10px; border-radius: 6px;
  font-size: 13px; font-weight: 500;
  text-decoration: none;
  background: transparent; border: none; cursor: pointer; width: 100%;
  text-align: left;
  color: ${({ $danger }) => $danger ? '#FCA5A5' : '#CCFBF1'};
  transition: background 0.15s, color 0.15s;
  &:hover {
    background: ${({ $danger }) => $danger ? 'rgba(220, 38, 38, 0.18)' : 'rgba(255, 255, 255, 0.08)'};
    color: ${({ $danger }) => $danger ? '#FECACA' : '#FFFFFF'};
  }
  &:focus-visible { outline: 2px solid rgba(94, 234, 212, 0.5); outline-offset: -2px; }
`;
const UserMenuItemLink = styled(Link)<{ $danger?: boolean }>`${UserMenuItemBase}`;
const UserMenuItemBtn = styled.button<{ $danger?: boolean }>`${UserMenuItemBase}`;

const MainContent = styled.div<{ $marginLeft: number }>`
  margin-left: ${props => props.$marginLeft}px;
  /* 콘텐츠 좌측 인셋(앱 네비 폭)을 CSS 변수로 노출 — 좌측 플로팅 패널 핸들이 뷰포트가 아닌
     콘텐츠 왼쪽 변 기준으로 붙도록(FloatingPanelToggle side='left'). 태블릿에선 네비가 오버레이라 0. */
  --pq-content-left: ${props => props.$marginLeft}px;
  /* 운영 #34 — flex column 앱 셸: 배너(flex-shrink:0) + PageScroll(flex:1).
     배너가 페이지 높이 컨텍스트 밖에 있어, 배너가 떠도 PageScroll(=뷰포트−배너)만큼만 페이지가 차지.
     PanelLayout 페이지(height:100%)가 정확히 가용 높이를 채워 채팅입력란 넘침·레이아웃 점프 차단.
     모바일 fixed MobileHeader (56px) 는 padding-top 으로 보정. */
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: margin-left 0.25s ease;
  ${mediaTablet} { margin-left: 0; --pq-content-left: 0px; padding-top: 56px; }
`;

/* 페이지 스크롤 영역 — 배너 아래 남은 공간(flex:1). 흐름형 페이지는 여기서 스크롤,
   PanelLayout 형(height:100%) 페이지는 이 영역을 꽉 채움. */
const PageScroll = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  -webkit-overflow-scrolling: touch;
`;

const MobileHeader = styled.div`
  display: none; position: fixed; top: 0; left: 0; right: 0;
  height: 56px; background: #115E59; border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  z-index: 99; padding: 0 16px; align-items: center; justify-content: space-between;
  ${mediaTablet} { display: flex; }
`;

const HamburgerButton = styled.button`
  background: none; border: none; padding: 8px; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  color: #CCFBF1; border-radius: 6px;
  min-width: 44px; min-height: 44px;
  &:hover { background: rgba(255, 255, 255, 0.08); }
`;

const Overlay = styled.div<{ $show?: boolean }>`
  display: ${props => props.$show ? 'block' : 'none'};
  position: fixed; top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0,0,0,0.4); z-index: 95;
`;

const MobileContentPadding = styled.div`
  /* 높이 체인 통과용 — 박스를 만들지 않아 PanelLayout(height:100%)이 PageScroll 기준으로 해석됨.
     흐름형 페이지는 그대로 PageScroll 안에서 스크롤. */
  display: contents;
`;

// N+72-6 — PushPromptBanner 의 외부 wrap. 좌우 padding 정렬 + 페이지 콘텐츠 위 적정 간격
const PushPromptWrap = styled.div`
  flex-shrink: 0;
  padding: 12px 20px 0;
  ${mediaTablet} { padding: 8px 12px 0; }
  /* 내부 PushPromptBanner 가 null 일 때(이미 구독 등) 빈 div 가 12px 공백을 만들어
     콘텐츠 헤더가 밀려 헤더 밑줄(회색 라인)이 사이드 패널과 안 맞던 회귀 → 비면 숨김. */
  &:empty { display: none; padding: 0; }
  /* 모바일 키보드 업 시 억제 — 키보드가 vvh 를 337px 로 줄인 상태에서 이 배너(~138px)가 세로공간을 잠식하면
     /tasks 같은 고정크롬(overflow:hidden) 패널의 하단 입력줄(CueTaskBar)이 뷰포트 밖으로 밀려 가려진다.
     ensureFocusedVisible 이 스크롤로 구제할 수 없는 구조적 가림. 키보드가 올라온 순간 이 배너는 UX상으로도
     죽은 공간이므로 숨긴다. main.tsx 가 세팅하는 body[data-keyboard-up='1'] 계약 재사용.
     ★ (max-width:768px) 게이트 필수 — main.tsx:51 의 flag 는 width 게이트 없이 세로축소만으로도 켜지므로,
        데스크탑 창 세로축소 시 배너가 사라지는 회귀를 이 미디어쿼리로 차단(main.tsx ensureFocusedVisible 가드와 동일 범위). */
  @media (max-width: 768px) {
    body[data-keyboard-up='1'] & { display: none; padding: 0; }
  }
`;

// 모바일 인라인 아코디언 — Stats / Settings 서브 메뉴
// 데스크탑(>=1025px) 에서는 SecondaryPanel 이 표시되므로 숨김
const AccordionWrap = styled.div`
  display: none;
  background: rgba(0, 0, 0, 0.18);
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  padding: 8px 0;
  ${mediaTablet} { display: block; }
`;

const AccordionItem = styled(Link)<{ $active?: boolean }>`
  display: flex; align-items: center; gap: 10px;
  padding: 10px 16px 10px 48px;
  color: #CCFBF1; text-decoration: none;
  font-size: 13px; font-weight: 500;
  min-height: 44px;
  transition: all 0.15s;
  &:hover { background: rgba(255, 255, 255, 0.08); color: #FFFFFF; }
  ${props => props.$active && `
    color: #FFFFFF;
    background: rgba(15, 118, 110, 0.5);
    font-weight: 600;
  `}
  svg { width: 16px; height: 16px; flex-shrink: 0; opacity: 0.8; }
`;

// 아코디언 안 그룹 구분 라벨 (워크스페이스 설정 / 개인 설정)
const AccordionGroupLabel = styled.div`
  display: flex; align-items: center; gap: 8px;
  padding: 8px 16px 6px 48px;
  color: rgba(204, 251, 241, 0.92);
  font-size: 11px; font-weight: 800;
  letter-spacing: 0.5px; text-transform: uppercase;
  &::before {
    content: ''; width: 5px; height: 5px; border-radius: 50%;
    background: #2DD4BF; flex-shrink: 0; margin-left: -12px;
  }
  &:not(:first-child) {
    margin-top: 10px;
    border-top: 1px solid rgba(255, 255, 255, 0.10);
    padding-top: 14px;
  }
`;


// ─────────────────────────────────────────────────────────────
// Icon set
// ─────────────────────────────────────────────────────────────
const IconDashboard = () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>);
const IconTodo = () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>);
const IconTalk = () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>);
const IconTask = () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>);
const IconProject = () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg>);
const IconCalendar = () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>);
const IconNote = () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>);
const IconFile = () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>);
const IconDownload = () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>);
const IconDocs = () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>);
const IconBill = () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>);
const IconMail = () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>);
const IconInsights = () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3v18h18"/><path d="M7 14l4-4 4 4 5-5"/></svg>);
const IconGear = () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>);
const IconShield = () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg>);
const IconBell = () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>);
const IconBuilding = () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="9" y1="6" x2="9" y2="6"/><line x1="15" y1="6" x2="15" y2="6"/><line x1="9" y1="10" x2="9" y2="10"/><line x1="15" y1="10" x2="15" y2="10"/><line x1="9" y1="14" x2="9" y2="14"/><line x1="15" y1="14" x2="15" y2="14"/><path d="M10 22v-4h4v4"/></svg>);
// 청구 설정 — 영수증 (구독 플랜 IconBill 과 차별화)
const IconReceipt = () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16l3-2 3 2 3-2 3 2 3-2V8z"/><line x1="9" y1="10" x2="15" y2="10"/><line x1="9" y1="14" x2="13" y2="14"/></svg>);
// 구독 플랜 — 신용카드 (청구 설정 IconReceipt 과 차별화)
const IconCreditCard = () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/><line x1="6" y1="15" x2="10" y2="15"/></svg>);
const IconMembers = () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>);
const IconClients = () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>);
const IconUsers = () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>);
const IconPlug = () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11V5a2 2 0 0 1 2-2h0a2 2 0 0 1 2 2v6"/><path d="M5 11h14v3a7 7 0 0 1-14 0z"/><line x1="12" y1="21" x2="12" y2="18"/></svg>);
const IconSliders = () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>);
const IconInbox = () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>);
const IconBusinesses = () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/></svg>);
const IconStatsTime = () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>);
const IconStatsProfit = () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>);
const IconStatsTeam = () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>);
const IconStatsFinance = () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/></svg>);
const IconStatsReports = () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>);
const IconStatsOverview = () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3v18h18"/><path d="M7 14l4-4 4 4 5-5"/></svg>);
/* N+63 — chevron 굵기 2.2 → 2.6 + 끝점 둥글게 (세련도). 시인성 향상. */
const IconChevronLeft = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>);
const IconChevronRight = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>);
const IconLogout = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>);
const IconHamburger = () => (<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>);
const IconClose = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="6" y1="6" x2="18" y2="18"/><line x1="6" y1="18" x2="18" y2="6"/></svg>);

interface MainLayoutProps { children: React.ReactNode; }

type SecondarySection = 'reports' | 'settings' | 'account' | null;

const MainLayout: React.FC<MainLayoutProps> = ({ children }) => {
  useAppShellLock();  // 모바일 뷰포트 고정 락 — 앱 셸에서만 (공개 페이지는 body 스크롤)
  const { t } = useTranslation('layout');
  const { user, logout, hasRole } = useAuth();
  const userDisplayName = displayName(user, i18n.language);
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(() => readLS(LS_COLLAPSED, false));
  const [searchOpen, setSearchOpen] = useState(false);
  // N+63 — 사이드바 user 메뉴 (avatar 클릭 popover). LanguageSelector + 프로필 link + 로그아웃 통합.
  // 옛 SidebarFooter 가 3블록 (Language + UserInfo + Logout) 으로 공간 차지 → avatar 1줄로 압축.
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!userMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) setUserMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setUserMenuOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [userMenuOpen]);
  // 모바일 (≤1024) 에서 통계·분석/설정 NavItem 첫 클릭 = 펼침만, 두 번째 = 이동.
  // 데스크탑은 SecondaryPanel 이 있어 즉시 이동 (기존 동작).
  const [mobileExpandedSection, setMobileExpandedSection] = useState<SecondarySection>(null);
  const { workspaceTz, workspaceRefs, userTz, userRefs, userTzExplicit } = useTimezones();

  useEffect(() => { setSidebarOpen(false); }, [location.pathname]);
  // 경로 변경 시 펼침 state reset (메뉴 안에서 하위 클릭 후 다른 페이지 가면 자동 접힘)
  useEffect(() => { setMobileExpandedSection(null); }, [location.pathname]);

  const handleSecondaryNavClick = (section: SecondarySection) => (e: React.MouseEvent) => {
    // 데스크탑은 기존 즉시 이동 동작 유지 — SecondaryPanel 이 옆에 펼쳐지므로 충분.
    if (typeof window === 'undefined') return;
    if (!window.matchMedia('(max-width: 1024px)').matches) return;
    // 이미 펼쳐있으면 (두 번째 클릭) → 이동 진행
    if (mobileExpandedSection === section) return;
    // 첫 클릭 → 펼침만, 이동 차단
    e.preventDefault();
    setMobileExpandedSection(section);
  };
  useEffect(() => { writeLS(LS_COLLAPSED, isCollapsed); }, [isCollapsed]);

  // ⌘K / Ctrl+\ 글로벌 검색 단축키
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === '\\')) {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // 모바일 사이드바 열림 시 배경 스크롤 잠금
  useBodyScrollLock(sidebarOpen);

  const isActive = (path: string) => location.pathname === path || location.pathname.startsWith(path + '/');
  const isAdminMode = location.pathname.startsWith('/admin');
  const inboxCounts = useInboxCount(user?.business_id ? Number(user.business_id) : null);
  const inboxCount = inboxCounts.total;
  const billMenuCount = inboxCounts.bill;  // Q Bill 메뉴 뱃지 — 청구 액션 대기 건수
  // Q mail 메뉴 뱃지 — 답변 필요 메일. "확인 필요"(total) 에는 합산하지 않는다:
  //   확인 필요는 '나에게 귀속된, 내가 완료할 수 있는 액션' 만 담는 신뢰 자산이고,
  //   회사 공용 메일함은 담당자 미지정이 기본이라 멤버 전원 뱃지가 같은 메일로 동시에 오른다.
  const mailMenuCount = inboxCounts.mail;
  // N+63 — platform_admin 좌측 inbox badge (feedback + inquiries)
  const adminCounts = useAdminInboxCounts();
  // N+63 — 알림 feed (Activity Feed) 미읽음 카운트. 확인필요 (Action Queue) 와 분리.
  const notifCount = useNotificationCount();
  const [notifOpen, setNotifOpen] = useState(false);
  const bellRef = useRef<HTMLButtonElement>(null);
  const talkUnreadCount = useUnreadTotal(user?.business_id ? Number(user.business_id) : null);
  // OS app badge (데스크탑 dock / 모바일 홈스크린 아이콘) — 인박스 + 채팅 합산 단일 적용.
  // 둘 중 하나라도 > 0 이면 표시. 사용자가 실제로 봐서 둘 다 0 될 때까지 안 사라짐.
  useGlobalBadge(inboxCount, talkUnreadCount);

  // 로그인 직후 자동 push 구독 시도 (Slack 패턴 — granted 면 조용히, default 면 7일 1회 prompt)
  useEffect(() => {
    if (!user?.id) return;
    import('../../services/push').then(m => {
      m.autoSubscribeIfPossible().catch(() => null);
    }).catch(() => null);
  }, [user?.id]);

  const hasBiz = (...roles: Array<'owner' | 'member' | 'client'>) =>
    !!user?.business_role && roles.includes(user.business_role as 'owner' | 'member' | 'client');

  const getRoleLabel = (u: typeof user) => {
    if (!u) return '';
    // /admin/* 페이지에서만 platform_admin 우선 표시. 일반 페이지는 워크스페이스 역할 우선.
    // (메모: profile 에서 워크스페이스 프로필 변경 후 사이드바도 워크스페이스 컨텍스트로 보여야)
    if (isAdminMode && u.platform_role === 'platform_admin') return t('role.platform_admin');
    if (u.business_role === 'owner') return t('role.business_owner');
    if (u.business_role === 'member') return t('role.business_member');
    if (u.business_role === 'client') return t('role.client', '고객');
    if (u.platform_role === 'platform_admin') return t('role.platform_admin');
    return t('role.user');
  };

  // 현재 경로가 어느 Secondary 섹션에 속하는가
  // - reports: /stats/*
  // - account (내 계정): /profile*, /me/work-settings*, 그리고 개인 스코프로 접근한 알림·메일계정·데이터
  // - settings (워크스페이스): 그 외 /business·/settings
  const accountScope = new URLSearchParams(location.search).get('scope') === 'personal';
  const isAccountPath =
    location.pathname.startsWith('/profile')
    || location.pathname.startsWith('/me/work-settings')
    || location.pathname === '/business/settings/notifications'
    || (location.pathname === '/business/settings/data-export' && accountScope)
    || (location.pathname === '/business/settings/mail-accounts' && accountScope);
  const currentSecondary: SecondarySection =
    location.pathname.startsWith('/stats') ? 'reports' :
    isAccountPath ? 'account' :
    (location.pathname.startsWith('/business')
      || location.pathname.startsWith('/settings')) ? 'settings' :
    null;

  const sidebarW = isCollapsed ? SIDEBAR_W_COLLAPSED : SIDEBAR_W_OPEN;

  // Secondary 접힘 — 아이콘 strip 모드 (완전 숨김 아님). localStorage 유지.
  const [secondaryCollapsed, setSecondaryCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(SECONDARY_COLLAPSED_KEY) === '1'; } catch { return false; }
  });
  const toggleSecondary = () => {
    setSecondaryCollapsed(prev => {
      const next = !prev;
      try { localStorage.setItem(SECONDARY_COLLAPSED_KEY, next ? '1' : '0'); } catch { /* quota */ }
      return next;
    });
  };

  const secondaryW = currentSecondary
    ? (secondaryCollapsed ? SECONDARY_COLLAPSED_W : SECONDARY_W)
    : 0;
  const mainMarginLeft = sidebarW + secondaryW;

  return (
    <LayoutContainer>
      {/* N+63 — 알림 dropdown (사이드바 종 모양 trigger) */}
      <NotificationDropdown open={notifOpen} onClose={() => setNotifOpen(false)} anchorRef={bellRef} />
      <MobileHeader>
        <HamburgerButton onClick={() => setSidebarOpen(true)} aria-label={t('nav.expandSidebar')}>
          <IconHamburger />
        </HamburgerButton>
        <Logo src="/planQ_white_new.svg" alt="PlanQ" />
        <div style={{ width: 40 }} />
      </MobileHeader>

      <Overlay $show={sidebarOpen} onClick={() => setSidebarOpen(false)} />

      <Sidebar $isOpen={sidebarOpen} $isCollapsed={isCollapsed}>
        <SidebarHeader $isCollapsed={isCollapsed}>
          {isCollapsed ? (
            <SidebarToggleButton
              type="button"
              onClick={() => setIsCollapsed(false)}
              aria-label={t('nav.expandSidebar')}
              title={t('nav.expandSidebar')}
            >
              <IconChevronRight />
            </SidebarToggleButton>
          ) : (
            <>
              <Logo src="/planQ_white_new.svg" alt="PlanQ" />
              <HeaderActions>
                <BellButton
                  ref={bellRef}
                  type="button"
                  onClick={() => setNotifOpen(v => !v)}
                  aria-label={t('notifications.title', '알림') as string}
                  title={t('notifications.title', '알림') as string}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                    <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                  </svg>
                  {notifCount > 0 && <BellBadge>{notifCount > 99 ? '99+' : notifCount}</BellBadge>}
                </BellButton>
                <SidebarToggleButton
                  type="button"
                  onClick={() => setIsCollapsed(true)}
                  aria-label={t('nav.collapseSidebar')}
                  title={t('nav.collapseSidebar')}
                >
                  <IconChevronLeft />
                </SidebarToggleButton>
              </HeaderActions>
            </>
          )}
          <MobileCloseButton
            type="button"
            onClick={() => setSidebarOpen(false)}
            aria-label={t('nav.closeSidebar', '메뉴 닫기')}
            title={t('nav.closeSidebar', '메뉴 닫기')}
          >
            <IconClose />
          </MobileCloseButton>
        </SidebarHeader>

        {!isCollapsed && <WorkspaceSwitcher />}
        {!isCollapsed && hasBiz('owner', 'member', 'client') && (
          <GlobalSearchTrigger
            type="button"
            onClick={() => setSearchOpen(true)}
            title={t('nav.globalSearch', '통합 검색') as string}
          >
            <SearchIconSvg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/>
              <line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </SearchIconSvg>
            <SearchPlaceholder>{t('nav.globalSearch', '검색')}</SearchPlaceholder>
            <SearchKbd>⌘K</SearchKbd>
          </GlobalSearchTrigger>
        )}

        <SidebarNav>
          {isAdminMode ? (
            <>
              <NavSection>
                <NavItem to="/admin/dashboard" $isCollapsed={isCollapsed}
                  $active={isActive('/admin/dashboard') || location.pathname === '/admin'}
                  title={isCollapsed ? t('nav.dashboard') : undefined}>
                  <NavIcon $isCollapsed={isCollapsed}><IconDashboard /></NavIcon>
                  <NavLabel $isCollapsed={isCollapsed}>{t('nav.dashboard')}</NavLabel>
                </NavItem>
              </NavSection>
              <NavSection>
                <NavTitle $isCollapsed={isCollapsed}>{t('nav.sectionAdmin')}</NavTitle>
                <NavItem to="/admin/users" $isCollapsed={isCollapsed} $active={isActive('/admin/users')}
                  title={isCollapsed ? t('nav.users') : undefined}>
                  <NavIcon $isCollapsed={isCollapsed}><IconUsers /></NavIcon>
                  <NavLabel $isCollapsed={isCollapsed}>{t('nav.users')}</NavLabel>
                </NavItem>
                <NavItem to="/admin/businesses" $isCollapsed={isCollapsed} $active={isActive('/admin/businesses')}
                  title={isCollapsed ? t('nav.businesses') : undefined}>
                  <NavIcon $isCollapsed={isCollapsed}><IconBusinesses /></NavIcon>
                  <NavLabel $isCollapsed={isCollapsed}>{t('nav.businesses')}</NavLabel>
                </NavItem>
                <NavItem to="/admin/inquiries" $isCollapsed={isCollapsed} $active={isActive('/admin/inquiries')}
                  title={isCollapsed ? `${t('nav.inquiries', '문의 인박스')}${adminCounts.inquiriesPending > 0 ? ` (${adminCounts.inquiriesPending})` : ''}` : undefined}>
                  <NavIcon $isCollapsed={isCollapsed}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>
                  </NavIcon>
                  <NavLabel $isCollapsed={isCollapsed}>{t('nav.inquiries', '문의 인박스')}</NavLabel>
                  {adminCounts.inquiriesPending > 0 && (
                    <InboxBadge $collapsed={isCollapsed} aria-label={`${t('nav.inquiries', '문의 인박스')} ${adminCounts.inquiriesPending}`}>
                      {adminCounts.inquiriesPending > 99 ? '99+' : adminCounts.inquiriesPending}
                    </InboxBadge>
                  )}
                </NavItem>
                <NavItem to="/admin/feedback" $isCollapsed={isCollapsed} $active={isActive('/admin/feedback')}
                  title={isCollapsed ? `${t('nav.feedback', '사용자 피드백')}${adminCounts.feedbackPending > 0 ? ` (${adminCounts.feedbackPending})` : ''}` : undefined}>
                  <NavIcon $isCollapsed={isCollapsed}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                  </NavIcon>
                  <NavLabel $isCollapsed={isCollapsed}>{t('nav.feedback', '사용자 피드백')}</NavLabel>
                  {adminCounts.feedbackPending > 0 && (
                    <InboxBadge $collapsed={isCollapsed} aria-label={`${t('nav.feedback', '사용자 피드백')} ${adminCounts.feedbackPending}`}>
                      {adminCounts.feedbackPending > 99 ? '99+' : adminCounts.feedbackPending}
                    </InboxBadge>
                  )}
                </NavItem>
                <NavItem to="/admin/wiki" $isCollapsed={isCollapsed} $active={isActive('/admin/wiki')}
                  title={isCollapsed ? t('nav.wiki', 'Q위키 관리') : undefined}>
                  <NavIcon $isCollapsed={isCollapsed}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
                  </NavIcon>
                  <NavLabel $isCollapsed={isCollapsed}>{t('nav.wiki', 'Q위키 관리')}</NavLabel>
                </NavItem>
                <NavItem to="/admin/email-logs" $isCollapsed={isCollapsed} $active={isActive('/admin/email-logs')}
                  title={isCollapsed ? t('nav.emailLogs', '메일 발송 모니터링') : undefined}>
                  <NavIcon $isCollapsed={isCollapsed}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                  </NavIcon>
                  <NavLabel $isCollapsed={isCollapsed}>{t('nav.emailLogs', '메일 발송 모니터링')}</NavLabel>
                </NavItem>
                <NavItem to="/admin/push-logs" $isCollapsed={isCollapsed} $active={isActive('/admin/push-logs')}
                  title={isCollapsed ? (t('nav.pushLogs', { defaultValue: 'Push 발송 모니터링' }) as string) : undefined}>
                  <NavIcon $isCollapsed={isCollapsed}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
                  </NavIcon>
                  <NavLabel $isCollapsed={isCollapsed}>{t('nav.pushLogs', { defaultValue: 'Push 발송 모니터링' }) as string}</NavLabel>
                </NavItem>
                <NavItem to="/admin/platform-settings" $isCollapsed={isCollapsed} $active={isActive('/admin/platform-settings')}
                  title={isCollapsed ? t('nav.platformSettings', '플랫폼 설정') : undefined}>
                  <NavIcon $isCollapsed={isCollapsed}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                  </NavIcon>
                  <NavLabel $isCollapsed={isCollapsed}>{t('nav.platformSettings', '플랫폼 설정')}</NavLabel>
                </NavItem>
                <NavItem to="/admin/subscriptions" $isCollapsed={isCollapsed} $active={isActive('/admin/subscriptions')}
                  title={isCollapsed ? t('nav.subscriptions', '구독 관리') : undefined}>
                  <NavIcon $isCollapsed={isCollapsed}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
                  </NavIcon>
                  <NavLabel $isCollapsed={isCollapsed}>{t('nav.subscriptions', '구독 관리')}</NavLabel>
                </NavItem>
                <NavItem to="/admin/payments" $isCollapsed={isCollapsed} $active={isActive('/admin/payments')}
                  title={isCollapsed ? t('nav.payments', '결제 이력') : undefined}>
                  <NavIcon $isCollapsed={isCollapsed}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                  </NavIcon>
                  <NavLabel $isCollapsed={isCollapsed}>{t('nav.payments', '결제 이력')}</NavLabel>
                </NavItem>
                <NavItem to="/admin/billing-settings" $isCollapsed={isCollapsed} $active={isActive('/admin/billing-settings')}
                  title={isCollapsed ? t('nav.billingSettings', '결제 설정') : undefined}>
                  <NavIcon $isCollapsed={isCollapsed}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
                  </NavIcon>
                  <NavLabel $isCollapsed={isCollapsed}>{t('nav.billingSettings', '결제 설정')}</NavLabel>
                </NavItem>
                <NavItem to="/admin/notifications" $isCollapsed={isCollapsed} $active={isActive('/admin/notifications')}
                  title={isCollapsed ? t('nav.adminNotifications', '내 알림 설정') : undefined}>
                  <NavIcon $isCollapsed={isCollapsed}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
                  </NavIcon>
                  <NavLabel $isCollapsed={isCollapsed}>{t('nav.adminNotifications', '내 알림 설정')}</NavLabel>
                </NavItem>
                <NavItem to="/admin/audit-logs" $isCollapsed={isCollapsed} $active={isActive('/admin/audit-logs')}
                  title={isCollapsed ? t('nav.adminAuditLogs', '감사 로그') : undefined}>
                  <NavIcon $isCollapsed={isCollapsed}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/></svg>
                  </NavIcon>
                  <NavLabel $isCollapsed={isCollapsed}>{t('nav.adminAuditLogs', '감사 로그')}</NavLabel>
                </NavItem>
              </NavSection>
            </>
          ) : (
            <>
              <NavSection>
                <NavItem to="/dashboard" $isCollapsed={isCollapsed} $active={isActive('/dashboard')}
                  title={isCollapsed ? t('nav.dashboard') : undefined}>
                  <NavIcon $isCollapsed={isCollapsed}><IconDashboard /></NavIcon>
                  <NavLabel $isCollapsed={isCollapsed}>{t('nav.dashboard')}</NavLabel>
                </NavItem>
                <NavItem to="/inbox" $isCollapsed={isCollapsed} $active={isActive('/inbox') || isActive('/todo')}
                  title={isCollapsed ? `${t('nav.inbox', '확인 필요')}${inboxCount > 0 ? ` (${inboxCount})` : ''}` : undefined}>
                  <NavIcon $isCollapsed={isCollapsed}><IconTodo /></NavIcon>
                  <NavLabel $isCollapsed={isCollapsed}>{t('nav.inbox', '확인 필요')}</NavLabel>
                  {inboxCount > 0 && (
                    <InboxBadge $collapsed={isCollapsed} aria-label={t('nav.inboxCount', { count: inboxCount, defaultValue: '미처리 {{count}}건' }) as string}>
                      {inboxCount > 99 ? '99+' : inboxCount}
                    </InboxBadge>
                  )}
                </NavItem>
              </NavSection>

              {hasBiz('owner', 'member', 'client') && (
                <NavSection>
                  <NavTitle $isCollapsed={isCollapsed}>{t('nav.sectionFeatures')}</NavTitle>
                  <NavItem to="/talk" $isCollapsed={isCollapsed} $active={isActive('/talk')}
                    title={isCollapsed ? `${t('nav.talk')}${talkUnreadCount > 0 ? ` (${talkUnreadCount})` : ''}` : undefined}>
                    <NavIcon $isCollapsed={isCollapsed}><IconTalk /></NavIcon>
                    <NavLabel $isCollapsed={isCollapsed}>{t('nav.talk')}</NavLabel>
                    {talkUnreadCount > 0 && (
                      <InboxBadge $collapsed={isCollapsed} aria-label={`${t('nav.talk')} ${talkUnreadCount}`}>
                        {talkUnreadCount > 99 ? '99+' : talkUnreadCount}
                      </InboxBadge>
                    )}
                  </NavItem>
                  {hasBiz('owner', 'member') && (
                    <NavItem to="/mail" $isCollapsed={isCollapsed}
                      $active={isActive('/mail')}
                      title={isCollapsed ? `${t('nav.qmail', 'Q mail')}${mailMenuCount > 0 ? ` (${mailMenuCount})` : ''}` : undefined}>
                      <NavIcon $isCollapsed={isCollapsed}><IconMail /></NavIcon>
                      <NavLabel $isCollapsed={isCollapsed}>{t('nav.qmail', 'Q mail')}</NavLabel>
                      {mailMenuCount > 0 && (
                        <InboxBadge $collapsed={isCollapsed} aria-label={`${t('nav.qmail', 'Q mail')} ${mailMenuCount}`}>
                          {mailMenuCount > 99 ? '99+' : mailMenuCount}
                        </InboxBadge>
                      )}
                    </NavItem>
                  )}
                  <NavItem to="/tasks" $isCollapsed={isCollapsed} $active={isActive('/tasks')}
                    title={isCollapsed ? t('nav.task') : undefined}>
                    <NavIcon $isCollapsed={isCollapsed}><IconTask /></NavIcon>
                    <NavLabel $isCollapsed={isCollapsed}>{t('nav.task')}</NavLabel>
                  </NavItem>
                  <NavItem to="/projects" $isCollapsed={isCollapsed} $active={isActive('/projects')}
                    title={isCollapsed ? t('nav.project') : undefined}>
                    <NavIcon $isCollapsed={isCollapsed}><IconProject /></NavIcon>
                    <NavLabel $isCollapsed={isCollapsed}>{t('nav.project')}</NavLabel>
                  </NavItem>
                  <NavItem to="/calendar" $isCollapsed={isCollapsed} $active={isActive('/calendar')}
                    title={isCollapsed ? t('nav.calendar') : undefined}>
                    <NavIcon $isCollapsed={isCollapsed}><IconCalendar /></NavIcon>
                    <NavLabel $isCollapsed={isCollapsed}>{t('nav.calendar')}</NavLabel>
                  </NavItem>
                  {hasBiz('owner', 'member') && (
                    <NavItem to="/notes" $isCollapsed={isCollapsed} $active={isActive('/notes')}
                      title={isCollapsed ? t('nav.note') : undefined}>
                      <NavIcon $isCollapsed={isCollapsed}><IconNote /></NavIcon>
                      <NavLabel $isCollapsed={isCollapsed}>{t('nav.note')}</NavLabel>
                    </NavItem>
                  )}
                  {hasBiz('owner', 'member') && (
                    <NavItem to="/docs" $isCollapsed={isCollapsed} $active={isActive('/docs')}
                      title={isCollapsed ? t('nav.docs') : undefined}>
                      <NavIcon $isCollapsed={isCollapsed}><IconDocs /></NavIcon>
                      <NavLabel $isCollapsed={isCollapsed}>{t('nav.docs')}</NavLabel>
                    </NavItem>
                  )}
                  {hasBiz('owner', 'member') && (
                    <NavItem to="/info" $isCollapsed={isCollapsed} $active={isActive('/info') || isActive('/knowledge')}
                      title={isCollapsed ? t('nav.qinfo', 'Q info') : undefined}>
                      <NavIcon $isCollapsed={isCollapsed}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 6.253v13"/><path d="M12 6.253C10.832 5.477 9.246 5 7.5 5 5.754 5 4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253"/><path d="M12 6.253C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18s-3.332.477-4.5 1.253"/></svg>
                      </NavIcon>
                      <NavLabel $isCollapsed={isCollapsed}>{t('nav.qinfo', 'Q info')}</NavLabel>
                    </NavItem>
                  )}
                  {hasBiz('owner', 'member') && (
                    <NavItem to="/files" $isCollapsed={isCollapsed} $active={isActive('/files')}
                      title={isCollapsed ? t('nav.file') : undefined}>
                      <NavIcon $isCollapsed={isCollapsed}><IconFile /></NavIcon>
                      <NavLabel $isCollapsed={isCollapsed}>{t('nav.file')}</NavLabel>
                    </NavItem>
                  )}
                  <NavItem to="/bills" $isCollapsed={isCollapsed}
                    $active={isActive('/bills') || isActive('/billing')}
                    title={isCollapsed ? `${t('nav.qbill', 'Q Bill')}${billMenuCount > 0 ? ` (${billMenuCount})` : ''}` : undefined}>
                    <NavIcon $isCollapsed={isCollapsed}><IconBill /></NavIcon>
                    <NavLabel $isCollapsed={isCollapsed}>{t('nav.qbill', 'Q Bill')}</NavLabel>
                    {billMenuCount > 0 && (
                      <InboxBadge $collapsed={isCollapsed} aria-label={`${t('nav.qbill', 'Q Bill')} ${billMenuCount}`}>
                        {billMenuCount > 99 ? '99+' : billMenuCount}
                      </InboxBadge>
                    )}
                  </NavItem>
                </NavSection>
              )}

              {/* ─── 개인 (Personal) — 사이클 N+9 — VISIBILITY_VOCABULARY §5 ─── */}
              {hasBiz('owner', 'member') && (
                <NavSection>
                  <NavTitle $isCollapsed={isCollapsed}>{t('nav.sectionPersonal', '개인')}</NavTitle>
                  <NavItem to="/personal-vault" $isCollapsed={isCollapsed} $active={isActive('/personal-vault')}
                    title={isCollapsed ? t('nav.personalVault', '개인 보관함') : undefined}>
                    <NavIcon $isCollapsed={isCollapsed}>
                      {/* archive icon — 자물쇠 아님 (자물쇠는 Q note·visibility 배지 전용) */}
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><line x1="10" y1="12" x2="14" y2="12"/></svg>
                    </NavIcon>
                    <NavLabel $isCollapsed={isCollapsed}>{t('nav.personalVault', '개인 보관함')}</NavLabel>
                  </NavItem>
                  <NavItem to="/me/feedback" $isCollapsed={isCollapsed} $active={isActive('/me/feedback')}
                    title={isCollapsed ? t('nav.myFeedback', '내 문의·피드백') : undefined}>
                    <NavIcon $isCollapsed={isCollapsed}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                    </NavIcon>
                    <NavLabel $isCollapsed={isCollapsed}>{t('nav.myFeedback', '내 문의·피드백')}</NavLabel>
                  </NavItem>
                  <NavItem to="/signatures/received" $isCollapsed={isCollapsed} $active={isActive('/signatures/received')}
                    title={isCollapsed ? t('nav.receivedSignatures', '받은 서명') : undefined}>
                    <NavIcon $isCollapsed={isCollapsed}>
                      {/* pen/signature icon */}
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>
                    </NavIcon>
                    <NavLabel $isCollapsed={isCollapsed}>{t('nav.receivedSignatures', '받은 서명')}</NavLabel>
                  </NavItem>
                </NavSection>
              )}

              {/* 통계·분석 + 설정 — 단일 NavItem, 클릭 시 첫 하위로 이동 → SecondaryPanel 자동 표시 */}
              {/* 모바일에서는 SecondaryPanel 이 숨겨지므로 NavItem 아래 인라인 아코디언으로 서브 메뉴 펼침 */}
              {hasBiz('owner', 'member') && (
                <NavSection>
                  <NavTitle $isCollapsed={isCollapsed}>{t('nav.sectionManage', '관리')}</NavTitle>
                  <NavItem
                    to="/stats/overview"
                    onClick={handleSecondaryNavClick('reports')}
                    $isCollapsed={isCollapsed}
                    $active={isActive('/stats')}
                    title={isCollapsed ? t('nav.sectionReports', '통계·분석') : undefined}
                  >
                    <NavIcon $isCollapsed={isCollapsed}><IconInsights /></NavIcon>
                    <NavLabel $isCollapsed={isCollapsed}>{t('nav.sectionReports', '통계·분석')}</NavLabel>
                  </NavItem>
                  {(isActive('/stats') || mobileExpandedSection === 'reports') && (
                    <AccordionWrap>
                      <AccordionItem to="/stats/overview" $active={isActive('/stats/overview')}>
                        <IconStatsOverview /> {t('nav.statsOverview', '개요')}
                      </AccordionItem>
                      <AccordionItem to="/stats/tasks" $active={isActive('/stats/tasks')}>
                        <IconStatsTime /> {t('nav.statsTaskTime', '업무·시간')}
                      </AccordionItem>
                      <AccordionItem to="/stats/weekly" $active={isActive('/stats/weekly')}>
                        <IconStatsTime /> {t('nav.statsWeekly', { defaultValue: '주간 추세' }) as string}
                      </AccordionItem>
                      <AccordionItem to="/stats/profit" $active={isActive('/stats/profit')}>
                        <IconStatsProfit /> {t('nav.statsProfit', '프로젝트 수익성')}
                      </AccordionItem>
                      <AccordionItem to="/stats/team" $active={isActive('/stats/team')}>
                        <IconStatsTeam /> {t('nav.statsTeam', '팀 생산성')}
                      </AccordionItem>
                      <AccordionItem to="/stats/finance" $active={isActive('/stats/finance')}>
                        <IconStatsFinance /> {t('nav.statsFinance', '비용·재무')}
                      </AccordionItem>
                      <AccordionItem to="/stats/reports" $active={isActive('/stats/reports')}>
                        <IconStatsReports /> {t('nav.statsReports', '보고서')}
                      </AccordionItem>
                    </AccordionWrap>
                  )}
                  <NavItem
                    to="/business/settings"
                    onClick={handleSecondaryNavClick('settings')}
                    $isCollapsed={isCollapsed}
                    $active={currentSecondary === 'settings'}
                    title={isCollapsed ? t('nav.settings') : undefined}
                  >
                    <NavIcon $isCollapsed={isCollapsed}><IconGear /></NavIcon>
                    <NavLabel $isCollapsed={isCollapsed}>{t('nav.settings')}</NavLabel>
                  </NavItem>
                  {(currentSecondary === 'settings' || mobileExpandedSection === 'settings') && (
                    <AccordionWrap>
                      {hasBiz('owner', 'member') && (
                        <AccordionItem
                          to="/business/settings"
                          $active={
                            location.pathname === '/business/settings'
                            || location.pathname === '/settings'
                            || location.pathname === '/business/settings/brand'
                            || location.pathname === '/business/settings/legal'
                          }
                        >
                          <IconBuilding /> {t('nav.workspaceSettings', '워크스페이스')}
                        </AccordionItem>
                      )}
                      {hasBiz('owner') && (
                        <AccordionItem
                          to="/business/settings/plan"
                          $active={location.pathname.includes('/plan')}
                        >
                          <IconCreditCard /> {t('nav.plan', '구독 플랜')}
                        </AccordionItem>
                      )}
                      {hasBiz('owner', 'member') && (
                        <AccordionItem
                          to="/business/settings/work-env"
                          $active={location.pathname.includes('/work-env') || location.pathname.includes('/language') || location.pathname.includes('/timezone') || location.pathname.includes('/work-flow')}
                        >
                          <IconSliders /> {t('nav.workEnv', '업무 환경')}
                        </AccordionItem>
                      )}

                      {hasBiz('owner', 'member') && (
                        <AccordionItem
                          to="/business/settings/permissions"
                          $active={location.pathname.includes('/permissions')}
                        >
                          <IconShield /> {t('nav.permissions', '권한')}
                        </AccordionItem>
                      )}
                      {hasBiz('owner') && (
                        <AccordionItem
                          to="/business/settings/billing"
                          $active={location.pathname.includes('/billing')}
                        >
                          <IconReceipt /> {t('nav.billing', '청구')}
                        </AccordionItem>
                      )}

                      {/* 〈구성원〉 */}
                      {hasBiz('owner', 'member') && (
                        <AccordionGroupLabel>{t('nav.subMembers', '구성원')}</AccordionGroupLabel>
                      )}
                      {hasBiz('owner') && (
                        <AccordionItem
                          to="/business/org"
                          $active={isActive('/business/org')}
                        >
                          <IconMembers /> {t('nav.org', '조직')}
                        </AccordionItem>
                      )}
                      {hasBiz('owner') && (
                        <AccordionItem
                          to="/business/members"
                          $active={isActive('/business/members')}
                        >
                          <IconMembers /> {t('nav.members')}
                        </AccordionItem>
                      )}
                      {hasBiz('owner', 'member') && (
                        <AccordionItem
                          to="/business/clients"
                          $active={isActive('/business/clients')}
                        >
                          <IconClients /> {t('nav.clients')}
                        </AccordionItem>
                      )}
                      {hasBiz('owner') && (
                        <AccordionItem
                          to="/business/settings/cue"
                          $active={location.pathname.includes('/cue')}
                        >
                          <IconInsights /> {t('nav.cue', 'Cue')}
                        </AccordionItem>
                      )}

                      {/* 〈연동〉 */}
                      {hasBiz('owner', 'member') && (
                        <AccordionGroupLabel>{t('nav.subIntegration', '연동')}</AccordionGroupLabel>
                      )}
                      {hasBiz('owner', 'member') && (
                        <AccordionItem
                          to="/business/settings/mail-accounts"
                          $active={location.pathname.includes('/mail-accounts') && !accountScope}
                        >
                          <IconInbox /> {t('nav.companyMail', '회사 메일')}
                        </AccordionItem>
                      )}
                      {hasBiz('owner') && (
                        <AccordionItem
                          to="/business/settings/email"
                          $active={location.pathname.includes('/email')}
                        >
                          <IconMail /> {t('nav.email', '발신 이메일')}
                        </AccordionItem>
                      )}
                      {hasBiz('owner') && (
                        <AccordionItem
                          to="/business/settings/storage"
                          $active={location.pathname.includes('/storage')}
                        >
                          <IconFile /> {t('nav.storage', '파일·외부 연동')}
                        </AccordionItem>
                      )}

                      {hasBiz('owner') && (
                        <AccordionItem
                          to="/business/settings/data-export"
                          $active={location.pathname.includes('/data-export')}
                        >
                          <IconDownload /> {t('nav.wsBackup', '워크스페이스 백업')}
                        </AccordionItem>
                      )}
                    </AccordionWrap>
                  )}

                  {/* 내 계정 — 개인 2뎁스 */}
                  <NavItem
                    to="/profile"
                    onClick={handleSecondaryNavClick('account')}
                    $isCollapsed={isCollapsed}
                    $active={currentSecondary === 'account'}
                    title={isCollapsed ? t('nav.myAccount', '내 계정') : undefined}
                  >
                    <NavIcon $isCollapsed={isCollapsed}><IconUsers /></NavIcon>
                    <NavLabel $isCollapsed={isCollapsed}>{t('nav.myAccount', '내 계정')}</NavLabel>
                  </NavItem>
                  {(currentSecondary === 'account' || mobileExpandedSection === 'account') && (
                    <AccordionWrap>
                      <AccordionItem to="/profile" $active={location.pathname === '/profile'}>
                        <IconUsers /> {t('user.profile')}
                      </AccordionItem>
                      {hasBiz('owner', 'member') && (
                        <AccordionItem to="/profile/integrations" $active={location.pathname.startsWith('/profile/integrations')}>
                          <IconPlug /> {t('nav.myIntegrations', '내 외부 연동')}
                        </AccordionItem>
                      )}
                      {hasBiz('owner', 'member') && (
                        <AccordionItem
                          to="/business/settings/mail-accounts?scope=personal"
                          $active={location.pathname.includes('/mail-accounts') && accountScope}
                        >
                          <IconMail /> {t('nav.myMailAccounts', '내 메일 계정')}
                        </AccordionItem>
                      )}
                      {hasBiz('owner', 'member') && (
                        <AccordionItem to="/me/work-settings" $active={location.pathname.startsWith('/me/work-settings')}>
                          <IconSliders /> {t('nav.myWorkEnv', '내 업무 환경')}
                        </AccordionItem>
                      )}
                      <AccordionItem
                        to="/business/settings/notifications"
                        $active={location.pathname.includes('/notifications')}
                      >
                        <IconBell /> {t('nav.myNotifications', '내 알림')}
                      </AccordionItem>
                      {hasBiz('owner', 'member') && (
                        <AccordionItem
                          to="/business/settings/data-export?scope=personal"
                          $active={location.pathname.includes('/data-export') && accountScope}
                        >
                          <IconDownload /> {t('nav.myData', '내 데이터')}
                        </AccordionItem>
                      )}
                    </AccordionWrap>
                  )}
                </NavSection>
              )}
              {hasBiz('client') && (
                <NavSection>
                  <NavTitle $isCollapsed={isCollapsed} />
                  <NavItem
                    to="/profile"
                    $isCollapsed={isCollapsed}
                    $active={
                      location.pathname.startsWith('/profile') ||
                      location.pathname.startsWith('/business/settings/notifications')
                    }
                    title={isCollapsed ? t('nav.settings') : undefined}
                  >
                    <NavIcon $isCollapsed={isCollapsed}><IconGear /></NavIcon>
                    <NavLabel $isCollapsed={isCollapsed}>{t('nav.settings')}</NavLabel>
                  </NavItem>
                  {(location.pathname.startsWith('/profile')
                    || location.pathname.startsWith('/business/settings/notifications')) && (
                    <AccordionWrap>
                      <AccordionItem to="/profile" $active={isActive('/profile')}>
                        <IconUsers /> {t('user.profile')}
                      </AccordionItem>
                      <AccordionItem
                        to="/business/settings/notifications"
                        $active={location.pathname.includes('/notifications')}
                      >
                        <IconBell /> {t('nav.notifications', '알림')}
                      </AccordionItem>
                    </AccordionWrap>
                  )}
                </NavSection>
              )}
            </>
          )}
        </SidebarNav>

        <SidebarFooter $isCollapsed={isCollapsed}>
          {!isCollapsed && (
            <>
              <SidebarClock
                workspaceTz={workspaceTz}
                workspaceLabel={user?.business_name || undefined}
                userTz={userTz}
                userTzExplicit={userTzExplicit}
                referenceTzs={[...workspaceRefs, ...userRefs]}
                locale={(i18n.language === 'ko' ? 'ko' : 'en')}
                isWorkspaceAdmin={hasRole('business_owner', 'platform_admin')}
              />
              {/* 업무 흐름 위젯 — focus_enabled=true 인 사용자에게만 렌더 (zero overhead) */}
              <FocusWidget isCollapsed={false} />
              {/* N+63 — UserMenu 통합: avatar+이름 1줄 + 클릭 popover (Language + 프로필 + 로그아웃).
                  옛 3블록 (LanguageSelector + UserInfo + LogoutButton) 합쳐 공간 절약 (모바일 호소 fix). */}
              <UserMenuWrap ref={userMenuRef}>
                {userMenuOpen && (
                  <UserMenuPopover role="menu">
                    <UserMenuMeta>
                      <UserMenuMetaName>{userDisplayName}</UserMenuMetaName>
                      <UserMenuMetaRole>{getRoleLabel(user)}</UserMenuMetaRole>
                    </UserMenuMeta>
                    <UserMenuDivider />
                    <UserMenuLangRow>
                      <LanguageSelector variant="sidebar" />
                    </UserMenuLangRow>
                    <UserMenuDivider />
                    <UserMenuItemLink to="/profile" onClick={() => setUserMenuOpen(false)} role="menuitem">
                      {t('user.profile')}
                    </UserMenuItemLink>
                    <UserMenuItemBtn type="button" $danger onClick={() => { setUserMenuOpen(false); logout(); }} role="menuitem">
                      {t('user.logout')}
                    </UserMenuItemBtn>
                  </UserMenuPopover>
                )}
                <UserMenuButton
                  type="button"
                  aria-expanded={userMenuOpen}
                  aria-haspopup="menu"
                  aria-label={`${userDisplayName} — ${t('user.menu', { defaultValue: '계정 메뉴' }) as string}`}
                  onClick={() => setUserMenuOpen(v => !v)}
                >
                  <UserAvatar>{userDisplayName?.charAt(0)?.toUpperCase() || 'U'}</UserAvatar>
                  <UserMenuName>{userDisplayName}</UserMenuName>
                  <UserMenuChevron $open={userMenuOpen}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="6 9 12 15 18 9"/></svg>
                  </UserMenuChevron>
                </UserMenuButton>
              </UserMenuWrap>
            </>
          )}
          {isCollapsed && (
            <>
              <FocusWidget isCollapsed />
              <CollapsedAvatarButton
                onClick={() => navigate('/profile')}
                title={`${userDisplayName || ''} — ${t('user.profile')}`}
                aria-label={t('user.profile')}
              >
                {userDisplayName?.charAt(0)?.toUpperCase() || 'U'}
              </CollapsedAvatarButton>
              <CollapsedLogoutIcon
                onClick={logout}
                title={t('user.logout')}
                aria-label={t('user.logout')}
              >
                <IconLogout />
              </CollapsedLogoutIcon>
            </>
          )}
        </SidebarFooter>
      </Sidebar>

      {/* Secondary 2뎁스 패널 — /stats/* 또는 /business/settings·/settings·/profile 경로에서만 */}
      {currentSecondary === 'reports' && (
        <SecondaryPanel $sidebarW={sidebarW} $collapsed={secondaryCollapsed} aria-label={t('nav.sectionReports', '통계·분석')}>
          <PanelHeader>
            {!secondaryCollapsed && <PanelTitle>{t('nav.sectionReports', '통계·분석')}</PanelTitle>}
            <SecondaryCloseButton
              type="button"
              onClick={toggleSecondary}
              aria-label={secondaryCollapsed ? t('nav.expandSecondary', '메뉴 펼치기') : t('nav.collapseSecondary', '메뉴 접기')}
              title={secondaryCollapsed ? t('nav.expandSecondary', '메뉴 펼치기') : t('nav.collapseSecondary', '메뉴 접기')}
            >
              {secondaryCollapsed ? <IconChevronRight /> : <IconChevronLeft />}
            </SecondaryCloseButton>
          </PanelHeader>
          <SecondaryBody>
            <SecondaryNavItem $collapsed={secondaryCollapsed} to="/stats/overview" $active={isActive('/stats/overview')}>
              <IconStatsOverview /> {t('nav.statsOverview', '개요')}
            </SecondaryNavItem>
            <SecondaryNavItem $collapsed={secondaryCollapsed} to="/stats/tasks" $active={isActive('/stats/tasks')}>
              <IconStatsTime /> {t('nav.statsTaskTime', '업무·시간')}
            </SecondaryNavItem>
            <SecondaryNavItem $collapsed={secondaryCollapsed} to="/stats/weekly" $active={isActive('/stats/weekly')}>
              <IconStatsTime /> {t('nav.statsWeekly', { defaultValue: '주간 추세' }) as string}
            </SecondaryNavItem>
            <SecondaryNavItem $collapsed={secondaryCollapsed} to="/stats/profit" $active={isActive('/stats/profit')}>
              <IconStatsProfit /> {t('nav.statsProfit', '프로젝트 수익성')}
            </SecondaryNavItem>
            <SecondaryNavItem $collapsed={secondaryCollapsed} to="/stats/team" $active={isActive('/stats/team')}>
              <IconStatsTeam /> {t('nav.statsTeam', '팀 생산성')}
            </SecondaryNavItem>
            <SecondaryNavItem $collapsed={secondaryCollapsed} to="/stats/finance" $active={isActive('/stats/finance')}>
              <IconStatsFinance /> {t('nav.statsFinance', '비용·재무')}
            </SecondaryNavItem>
            <SecondaryNavItem $collapsed={secondaryCollapsed} to="/stats/reports" $active={isActive('/stats/reports')}>
              <IconStatsReports /> {t('nav.statsReports', '보고서')}
            </SecondaryNavItem>
          </SecondaryBody>
        </SecondaryPanel>
      )}

      {currentSecondary === 'settings' && (
        <SecondaryPanel $sidebarW={sidebarW} $collapsed={secondaryCollapsed} aria-label={t('nav.settings')}>
          <PanelHeader>
            {!secondaryCollapsed && <PanelTitle>{t('nav.settings')}</PanelTitle>}
            <SecondaryCloseButton
              type="button"
              onClick={toggleSecondary}
              aria-label={secondaryCollapsed ? t('nav.expandSecondary', '메뉴 펼치기') : t('nav.collapseSecondary', '메뉴 접기')}
              title={secondaryCollapsed ? t('nav.expandSecondary', '메뉴 펼치기') : t('nav.collapseSecondary', '메뉴 접기')}
            >
              {secondaryCollapsed ? <IconChevronRight /> : <IconChevronLeft />}
            </SecondaryCloseButton>
          </PanelHeader>
          <SecondaryBody>
            {hasBiz('owner', 'member') && (
              <SecondaryNavItem $collapsed={secondaryCollapsed}
                to="/business/settings"
                $active={
                  // brand / legal 탭은 워크스페이스 메뉴 안 — 다 active 표시
                  location.pathname === '/business/settings'
                  || location.pathname === '/settings'
                  || location.pathname === '/business/settings/brand'
                  || location.pathname === '/business/settings/legal'
                }
              >
                <IconBuilding /> {t('nav.workspaceSettings', '워크스페이스')}
              </SecondaryNavItem>
            )}
            {hasBiz('owner') && (
              <SecondaryNavItem $collapsed={secondaryCollapsed}
                to="/business/settings/plan"
                $active={location.pathname.includes('/plan')}
              >
                <IconCreditCard /> {t('nav.plan', '구독 플랜')}
              </SecondaryNavItem>
            )}
            {hasBiz('owner', 'member') && (
              <SecondaryNavItem $collapsed={secondaryCollapsed}
                to="/business/settings/work-env"
                $active={location.pathname.includes('/work-env') || location.pathname.includes('/language') || location.pathname.includes('/timezone') || location.pathname.includes('/work-flow')}
              >
                <IconSliders /> {t('nav.workEnv', '업무 환경')}
              </SecondaryNavItem>
            )}

            {/* 권한 — 투명성 원칙상 member 도 조회 가능. 편집은 owner 만 (탭 내부에서 disabled 처리) */}
            {hasBiz('owner', 'member') && (
              <SecondaryNavItem $collapsed={secondaryCollapsed}
                to="/business/settings/permissions"
                $active={location.pathname.includes('/permissions')}
              >
                <IconShield /> {t('nav.permissions', '권한')}
              </SecondaryNavItem>
            )}
            {hasBiz('owner') && (
              <SecondaryNavItem $collapsed={secondaryCollapsed}
                to="/business/settings/billing"
                $active={location.pathname.includes('/billing')}
              >
                <IconReceipt /> {t('nav.billing', '청구')}
              </SecondaryNavItem>
            )}

            {/* 〈구성원〉 */}
            {!secondaryCollapsed && hasBiz('owner', 'member') && (
              <SecondaryGroupLabel>{t('nav.subMembers', '구성원')}</SecondaryGroupLabel>
            )}
            {hasBiz('owner') && (
              <SecondaryNavItem $collapsed={secondaryCollapsed}
                to="/business/org"
                $active={isActive('/business/org')}
              >
                <IconMembers /> {t('nav.org', '조직')}
              </SecondaryNavItem>
            )}
            {hasBiz('owner') && (
              <SecondaryNavItem $collapsed={secondaryCollapsed}
                to="/business/members"
                $active={isActive('/business/members')}
              >
                <IconMembers /> {t('nav.members')}
              </SecondaryNavItem>
            )}
            {hasBiz('owner', 'member') && (
              <SecondaryNavItem $collapsed={secondaryCollapsed}
                to="/business/clients"
                $active={isActive('/business/clients')}
              >
                <IconClients /> {t('nav.clients')}
              </SecondaryNavItem>
            )}
            {hasBiz('owner') && (
              <SecondaryNavItem $collapsed={secondaryCollapsed}
                to="/business/settings/cue"
                $active={location.pathname.includes('/cue')}
              >
                <IconInsights /> {t('nav.cue', 'Cue')}
              </SecondaryNavItem>
            )}

            {/* 〈연동〉 */}
            {!secondaryCollapsed && hasBiz('owner', 'member') && (
              <SecondaryGroupLabel>{t('nav.subIntegration', '연동')}</SecondaryGroupLabel>
            )}
            {hasBiz('owner', 'member') && (
              <SecondaryNavItem $collapsed={secondaryCollapsed}
                to="/business/settings/mail-accounts"
                $active={location.pathname.includes('/mail-accounts') && !accountScope}
              >
                <IconInbox /> {t('nav.companyMail', '회사 메일')}
              </SecondaryNavItem>
            )}
            {hasBiz('owner') && (
              <SecondaryNavItem $collapsed={secondaryCollapsed}
                to="/business/settings/email"
                $active={location.pathname.includes('/email')}
              >
                <IconMail /> {t('nav.email', '발신 이메일')}
              </SecondaryNavItem>
            )}
            {hasBiz('owner') && (
              <SecondaryNavItem $collapsed={secondaryCollapsed}
                to="/business/settings/storage"
                $active={location.pathname.includes('/storage')}
              >
                <IconFile /> {t('nav.storage', '파일·외부 연동')}
              </SecondaryNavItem>
            )}

            {hasBiz('owner') && (
              <SecondaryNavItem $collapsed={secondaryCollapsed}
                to="/business/settings/data-export"
                $active={location.pathname.includes('/data-export')}
              >
                <IconDownload /> {t('nav.wsBackup', '워크스페이스 백업')}
              </SecondaryNavItem>
            )}
          </SecondaryBody>
        </SecondaryPanel>
      )}

      {/* 내 계정 — 개인 2뎁스 SecondaryPanel */}
      {currentSecondary === 'account' && (
        <SecondaryPanel $sidebarW={sidebarW} $collapsed={secondaryCollapsed} aria-label={t('nav.myAccount', '내 계정')}>
          <PanelHeader>
            {!secondaryCollapsed && <PanelTitle>{t('nav.myAccount', '내 계정')}</PanelTitle>}
            <SecondaryCloseButton
              type="button"
              onClick={toggleSecondary}
              aria-label={secondaryCollapsed ? t('nav.expandSecondary', '메뉴 펼치기') : t('nav.collapseSecondary', '메뉴 접기')}
              title={secondaryCollapsed ? t('nav.expandSecondary', '메뉴 펼치기') : t('nav.collapseSecondary', '메뉴 접기')}
            >
              {secondaryCollapsed ? <IconChevronRight /> : <IconChevronLeft />}
            </SecondaryCloseButton>
          </PanelHeader>
          <SecondaryBody>
            <SecondaryNavItem $collapsed={secondaryCollapsed} to="/profile" $active={location.pathname === '/profile'}>
              <IconUsers /> {t('user.profile')}
            </SecondaryNavItem>
            {/* 개인 외부 연동 — 내 Google Drive/Calendar (워크스페이스 파일·외부연동과 별개) */}
            {hasBiz('owner', 'member') && (
              <SecondaryNavItem $collapsed={secondaryCollapsed} to="/profile/integrations" $active={location.pathname.startsWith('/profile/integrations')}>
                <IconPlug /> {t('nav.myIntegrations', '내 외부 연동')}
              </SecondaryNavItem>
            )}
            {hasBiz('owner', 'member') && (
              <SecondaryNavItem $collapsed={secondaryCollapsed}
                to="/business/settings/mail-accounts?scope=personal"
                $active={location.pathname.includes('/mail-accounts') && accountScope}
              >
                <IconMail /> {t('nav.myMailAccounts', '내 메일 계정')}
              </SecondaryNavItem>
            )}
            {/* N+32 — 내 업무 환경 (타임존 + 업무 흐름). ProfilePage 와 분리. */}
            {hasBiz('owner', 'member') && (
              <SecondaryNavItem $collapsed={secondaryCollapsed} to="/me/work-settings" $active={isActive('/me/work-settings')}>
                <IconSliders /> {t('nav.myWorkEnv', '내 업무 환경')}
              </SecondaryNavItem>
            )}
            <SecondaryNavItem $collapsed={secondaryCollapsed}
              to="/business/settings/notifications"
              $active={location.pathname.includes('/notifications')}
            >
              <IconBell /> {t('nav.myNotifications', '내 알림')}
            </SecondaryNavItem>
            {hasBiz('owner', 'member') && (
              <SecondaryNavItem $collapsed={secondaryCollapsed}
                to="/business/settings/data-export?scope=personal"
                $active={location.pathname.includes('/data-export') && accountScope}
              >
                <IconDownload /> {t('nav.myData', '내 데이터')}
              </SecondaryNavItem>
            )}
          </SecondaryBody>
        </SecondaryPanel>
      )}

      <MainContent $marginLeft={mainMarginLeft}>
        <WorkspaceBillingBanner />
        {/* N+72-6 — 알림 안내 모든 페이지 mount (옛: TodoPage 만). granted-off 자동 silent re-subscribe + iOS 비-PWA 안내 */}
        {!isNativeApp() && user && (
          <PushPromptWrap>
            <PushPromptBanner />
          </PushPromptWrap>
        )}
        <PageScroll>
          {/* 페이지 청크 로딩은 **본문 안에서만** 일어난다.
              여태 Suspense 가 라우트 전체를 감싸고 있어서, 페이지가 로드되는 동안 사이드바·헤더까지
              통째로 사라지고 하얀 화면에 스피너만 남았다 (Irene: "느리더라도 고정 레이아웃은 그대로
              보여야 답답함이 덜하다"). 여기 경계를 두면 껍데기는 그대로 있고 본문만 스켈레톤이 된다. */}
          <MobileContentPadding>
            <Suspense fallback={<ContentSkeleton />}>{children}</Suspense>
          </MobileContentPadding>
        </PageScroll>
      </MainContent>
      {!isNativeApp() && <InstallPromptBanner />}
      {user?.business_id && (
        <GlobalSearchModal
          open={searchOpen}
          onClose={() => setSearchOpen(false)}
          businessId={Number(user.business_id)}
        />
      )}
    </LayoutContainer>
  );
};

export default MainLayout;

// 페이지 로딩 중 본문 자리 — 껍데기(사이드바·헤더)는 그대로 두고 여기만 뛴다.
//   하얀 화면보다 낫다. 레이아웃이 남아 있으면 사용자는 "느리다" 고 느끼지 "멈췄다" 고 느끼지 않는다.
const ContentSkeleton: React.FC = () => (
  <SkelWrap aria-busy="true" aria-live="polite">
    <SkelHeader />
    <SkelRow $w="70%" />
    <SkelRow $w="92%" />
    <SkelRow $w="84%" />
    <SkelRow $w="60%" />
  </SkelWrap>
);
const SkelWrap = styled.div`
  display: flex; flex-direction: column; gap: 12px;
  padding: 20px;
`;
const SkelHeader = styled.div`
  height: 36px; width: 220px; border-radius: 10px;
  background: linear-gradient(90deg, #F1F5F9 25%, #F8FAFC 50%, #F1F5F9 75%);
  background-size: 200% 100%;
  animation: planqSkel 1.2s ease-in-out infinite;
  @keyframes planqSkel { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
  @media (prefers-reduced-motion: reduce) { animation: none; }
`;
const SkelRow = styled.div<{ $w: string }>`
  height: 56px; width: ${(p) => p.$w}; border-radius: 12px;
  background: linear-gradient(90deg, #F1F5F9 25%, #F8FAFC 50%, #F1F5F9 75%);
  background-size: 200% 100%;
  animation: planqSkel 1.2s ease-in-out infinite;
  @media (prefers-reduced-motion: reduce) { animation: none; }
`;
