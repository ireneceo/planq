import React, { useState, useEffect } from 'react';
import styled, { css } from 'styled-components';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { displayName } from '../../utils/displayName';
import { useAuth } from '../../contexts/AuthContext';
import LanguageSelector from '../Common/LanguageSelector';
import WorkspaceSwitcher from './WorkspaceSwitcher';
import WorkspaceBillingBanner from './WorkspaceBillingBanner';
import SidebarClock from './SidebarClock';
import PanelHeader, { PanelTitle } from './PanelHeader';
import { useTimezones } from '../../hooks/useTimezones';
import { useInboxCount } from '../../hooks/useInboxCount';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { mediaTablet } from '../../theme/breakpoints';
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
  overflow-x: hidden;
  -webkit-font-smoothing: antialiased;
  min-height: 100vh;
`;

const Sidebar = styled.div<{ $isOpen?: boolean; $isCollapsed?: boolean }>`
  position: fixed; top: 0; left: 0;
  width: ${props => props.$isCollapsed ? `${SIDEBAR_W_COLLAPSED}px` : `${SIDEBAR_W_OPEN}px`};
  height: 100vh;
  background: linear-gradient(180deg, #115E59 0%, #134E4A 100%);
  z-index: 1000; display: flex; flex-direction: column;
  transition: width 0.25s ease; overflow-x: hidden;
  ${mediaTablet} {
    transform: translateX(${props => props.$isOpen ? '0' : '-100%'});
    width: 240px; transition: transform 0.3s, width 0.3s ease;
  }
`;

const SidebarHeader = styled.div<{ $isCollapsed?: boolean }>`
  padding: 14px 16px; border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  flex-shrink: 0; min-height: 60px;
  display: flex; align-items: center;
  justify-content: ${props => props.$isCollapsed ? 'center' : 'space-between'};
  gap: 8px;
  ${mediaTablet} { justify-content: space-between; }
`;

const Logo = styled.div`
  font-size: 20px; font-weight: 700; color: #FFFFFF; letter-spacing: -0.5px;
  span { color: #5EEAD4; }
`;

const SidebarToggleButton = styled.button`
  background: none; border: none; cursor: pointer; padding: 6px;
  display: flex; align-items: center; justify-content: center;
  color: #CCFBF1; border-radius: 6px; transition: all 0.2s;
  &:hover { background: rgba(255, 255, 255, 0.08); color: #FFFFFF; }
  svg { width: 18px; height: 18px; }
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

// What's new pulse — 새 메뉴 한 번도 안 본 사용자에게 빨간 점 + 펄스 애니메이션
const NewPulse = styled.span`
  margin-left: auto;
  width: 8px; height: 8px;
  background: #F43F5E;
  border-radius: 50%;
  flex-shrink: 0;
  animation: pulse 1.6s ease-in-out infinite;
  @keyframes pulse {
    0%, 100% { box-shadow: 0 0 0 0 rgba(244, 63, 94, 0.5); }
    50%      { box-shadow: 0 0 0 6px rgba(244, 63, 94, 0); }
  }
`;

// 인박스 미처리 카운트 — pill 배지 (확장 상태) / 작은 dot (collapsed 상태)
const InboxBadge = styled.span`
  margin-left: auto;
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 20px; height: 18px; padding: 0 6px;
  background: #F43F5E; color: #FFFFFF;
  font-size: 10px; font-weight: 700; line-height: 1;
  border-radius: 999px;
`;
const InboxDot = styled.span`
  position: absolute; top: 8px; right: 8px;
  width: 8px; height: 8px;
  background: #F43F5E; border-radius: 50%;
  border: 2px solid #FFFFFF;
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
  z-index: 900;
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

const SecondaryCloseButton = styled.button`
  background: none; border: none; padding: 6px; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  color: #64748B; border-radius: 6px; transition: all 0.15s;
  &:hover { background: #F1F5F9; color: #0F172A; }
  svg { width: 16px; height: 16px; }
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
    display: block;
  }
`;

const UserInfo = styled(Link)`
  display: flex; align-items: center; gap: 10px; margin-bottom: 8px;
  text-decoration: none; cursor: pointer;
  border-radius: 6px; padding: 4px;
  transition: background 0.15s;
  &:hover { background: rgba(255, 255, 255, 0.06); }
`;

const UserAvatar = styled.div`
  width: 32px; height: 32px; border-radius: 50%;
  background: #0F766E; color: #FFFFFF;
  display: flex; align-items: center; justify-content: center;
  font-size: 13px; font-weight: 600; flex-shrink: 0;
`;

const UserName = styled.div`
  font-size: 13px; font-weight: 500; color: #FFFFFF;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
`;

const UserRoleText = styled.div`font-size: 11px; color: #5EEAD4;`;

const LogoutButton = styled.button`
  width: 100%; padding: 8px; background: none;
  border: 1px solid rgba(255, 255, 255, 0.15); border-radius: 6px;
  color: #CCFBF1; font-size: 12px; cursor: pointer; transition: all 0.15s;
  &:hover { background: rgba(220, 38, 38, 0.15); color: #FCA5A5; border-color: rgba(220, 38, 38, 0.3); }
`;

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

const MainContent = styled.div<{ $marginLeft: number }>`
  margin-left: ${props => props.$marginLeft}px;
  min-height: 100vh; transition: margin-left 0.25s ease;
  ${mediaTablet} { margin-left: 0; }
`;

const MobileHeader = styled.div`
  display: none; position: fixed; top: 0; left: 0; right: 0;
  height: 56px; background: #115E59; border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  z-index: 999; padding: 0 16px; align-items: center; justify-content: space-between;
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
  background: rgba(0,0,0,0.4); z-index: 999;
`;

const MobileContentPadding = styled.div`
  ${mediaTablet} { padding-top: 56px; }
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
const IconBusinesses = () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/></svg>);
const IconStatsTime = () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>);
const IconStatsProfit = () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>);
const IconStatsTeam = () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>);
const IconStatsFinance = () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/></svg>);
const IconStatsReports = () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>);
const IconStatsOverview = () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3v18h18"/><path d="M7 14l4-4 4 4 5-5"/></svg>);
const IconChevronLeft = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="15 18 9 12 15 6"/></svg>);
const IconChevronRight = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="9 18 15 12 9 6"/></svg>);
const IconLogout = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>);
const IconHamburger = () => (<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>);
const IconClose = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="6" y1="6" x2="18" y2="18"/><line x1="6" y1="18" x2="18" y2="6"/></svg>);

interface MainLayoutProps { children: React.ReactNode; }

type SecondarySection = 'reports' | 'settings' | null;

const MainLayout: React.FC<MainLayoutProps> = ({ children }) => {
  const { t } = useTranslation('layout');
  const { user, logout, hasRole } = useAuth();
  const userDisplayName = displayName(user, i18n.language);
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(() => readLS(LS_COLLAPSED, false));
  const { workspaceTz, workspaceRefs, userTz, userRefs } = useTimezones();

  useEffect(() => { setSidebarOpen(false); }, [location.pathname]);
  useEffect(() => { writeLS(LS_COLLAPSED, isCollapsed); }, [isCollapsed]);

  // 모바일 사이드바 열림 시 배경 스크롤 잠금
  useBodyScrollLock(sidebarOpen);

  const isActive = (path: string) => location.pathname === path || location.pathname.startsWith(path + '/');
  const isAdminMode = location.pathname.startsWith('/admin');
  const inboxCount = useInboxCount(user?.business_id ? Number(user.business_id) : null);

  const hasBiz = (...roles: Array<'owner' | 'member' | 'client'>) =>
    !!user?.business_role && roles.includes(user.business_role as 'owner' | 'member' | 'client');

  const getRoleLabel = (u: typeof user) => {
    if (!u) return '';
    if (u.platform_role === 'platform_admin') return t('role.platform_admin');
    if (u.business_role === 'owner') return t('role.business_owner');
    if (u.business_role === 'member') return t('role.business_member');
    return t('role.user');
  };

  // 현재 경로가 어느 Secondary 섹션에 속하는가
  // 설정 Secondary 에 속하는 모든 경로: 워크스페이스/멤버/고객/프로필
  const currentSecondary: SecondarySection =
    location.pathname.startsWith('/stats') ? 'reports' :
    (location.pathname.startsWith('/business')
      || location.pathname.startsWith('/settings')
      || location.pathname.startsWith('/profile')) ? 'settings' :
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
      <MobileHeader>
        <HamburgerButton onClick={() => setSidebarOpen(true)} aria-label={t('nav.expandSidebar')}>
          <IconHamburger />
        </HamburgerButton>
        <Logo>Plan<span>Q</span></Logo>
        <div style={{ width: 40 }} />
      </MobileHeader>

      <Overlay $show={sidebarOpen} onClick={() => setSidebarOpen(false)} />

      <Sidebar $isOpen={sidebarOpen} $isCollapsed={isCollapsed}>
        <SidebarHeader $isCollapsed={isCollapsed}>
          {isCollapsed ? (
            <SidebarToggleButton
              onClick={() => setIsCollapsed(false)}
              aria-label={t('nav.expandSidebar')}
              title={t('nav.expandSidebar')}
            >
              <IconChevronRight />
            </SidebarToggleButton>
          ) : (
            <>
              <Logo>Plan<span>Q</span></Logo>
              <SidebarToggleButton
                onClick={() => setIsCollapsed(true)}
                aria-label={t('nav.collapseSidebar')}
                title={t('nav.collapseSidebar')}
              >
                <IconChevronLeft />
              </SidebarToggleButton>
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
                    isCollapsed
                      ? <InboxDot aria-label={t('nav.inboxCount', { count: inboxCount, defaultValue: '미처리 {{count}}건' }) as string} />
                      : <InboxBadge>{inboxCount > 99 ? '99+' : inboxCount}</InboxBadge>
                  )}
                </NavItem>
              </NavSection>

              {hasBiz('owner', 'member', 'client') && (
                <NavSection>
                  <NavTitle $isCollapsed={isCollapsed}>{t('nav.sectionFeatures')}</NavTitle>
                  <NavItem to="/talk" $isCollapsed={isCollapsed} $active={isActive('/talk')}
                    title={isCollapsed ? t('nav.talk') : undefined}>
                    <NavIcon $isCollapsed={isCollapsed}><IconTalk /></NavIcon>
                    <NavLabel $isCollapsed={isCollapsed}>{t('nav.talk')}</NavLabel>
                  </NavItem>
                  {hasBiz('owner', 'member') && (
                    <NavItem to="/mail" $isCollapsed={isCollapsed}
                      $active={isActive('/mail')}
                      title={isCollapsed ? t('nav.qmail', 'Q Mail') : undefined}>
                      <NavIcon $isCollapsed={isCollapsed}><IconMail /></NavIcon>
                      <NavLabel $isCollapsed={isCollapsed}>{t('nav.qmail', 'Q Mail')}</NavLabel>
                    </NavItem>
                  )}
                  <NavItem to="/tasks" $isCollapsed={isCollapsed} $active={isActive('/tasks')}
                    title={isCollapsed ? t('nav.task') : undefined}>
                    <NavIcon $isCollapsed={isCollapsed}><IconTask /></NavIcon>
                    <NavLabel $isCollapsed={isCollapsed}>{t('nav.task')}</NavLabel>
                  </NavItem>
                  {hasBiz('owner', 'member') && (
                    <NavItem to="/projects" $isCollapsed={isCollapsed} $active={isActive('/projects')}
                      title={isCollapsed ? t('nav.project') : undefined}>
                      <NavIcon $isCollapsed={isCollapsed}><IconProject /></NavIcon>
                      <NavLabel $isCollapsed={isCollapsed}>{t('nav.project')}</NavLabel>
                    </NavItem>
                  )}
                  <NavItem to="/calendar" $isCollapsed={isCollapsed} $active={isActive('/calendar')}
                    title={isCollapsed ? t('nav.calendar') : undefined}>
                    <NavIcon $isCollapsed={isCollapsed}><IconCalendar /></NavIcon>
                    <NavLabel $isCollapsed={isCollapsed}>{t('nav.calendar')}</NavLabel>
                  </NavItem>
                  <NavItem to="/notes" $isCollapsed={isCollapsed} $active={isActive('/notes')}
                    title={isCollapsed ? t('nav.note') : undefined}>
                    <NavIcon $isCollapsed={isCollapsed}><IconNote /></NavIcon>
                    <NavLabel $isCollapsed={isCollapsed}>{t('nav.note')}</NavLabel>
                  </NavItem>
                  <NavItem to="/files" $isCollapsed={isCollapsed} $active={isActive('/files')}
                    title={isCollapsed ? t('nav.file') : undefined}>
                    <NavIcon $isCollapsed={isCollapsed}><IconFile /></NavIcon>
                    <NavLabel $isCollapsed={isCollapsed}>{t('nav.file')}</NavLabel>
                  </NavItem>
                  <NavItem to="/docs" $isCollapsed={isCollapsed} $active={isActive('/docs')}
                    title={isCollapsed ? t('nav.docs') : undefined}>
                    <NavIcon $isCollapsed={isCollapsed}><IconDocs /></NavIcon>
                    <NavLabel $isCollapsed={isCollapsed}>{t('nav.docs')}</NavLabel>
                  </NavItem>
                  <NavItem to="/knowledge" $isCollapsed={isCollapsed} $active={isActive('/knowledge')}
                    title={isCollapsed ? t('nav.qknowledge', 'Q 지식') : undefined}
                    onClick={() => { try { localStorage.setItem('planq_whatsnew_qknowledge_v1', '1'); } catch { /* */ } }}>
                    <NavIcon $isCollapsed={isCollapsed}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 6.253v13"/><path d="M12 6.253C10.832 5.477 9.246 5 7.5 5 5.754 5 4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253"/><path d="M12 6.253C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18s-3.332.477-4.5 1.253"/></svg>
                    </NavIcon>
                    <NavLabel $isCollapsed={isCollapsed}>{t('nav.qknowledge', 'Q 지식')}</NavLabel>
                    {(() => { try { return localStorage.getItem('planq_whatsnew_qknowledge_v1') !== '1' ? <NewPulse aria-label="NEW" /> : null; } catch { return null; } })()}
                  </NavItem>
                  <NavItem to="/bills" $isCollapsed={isCollapsed}
                    $active={isActive('/bills') || isActive('/billing')}
                    title={isCollapsed ? t('nav.qbill', 'Q Bill') : undefined}>
                    <NavIcon $isCollapsed={isCollapsed}><IconBill /></NavIcon>
                    <NavLabel $isCollapsed={isCollapsed}>{t('nav.qbill', 'Q Bill')}</NavLabel>
                  </NavItem>
                </NavSection>
              )}

              {/* 통계·분석 + 설정 — 단일 NavItem, 클릭 시 첫 하위로 이동 → SecondaryPanel 자동 표시 */}
              {/* 모바일에서는 SecondaryPanel 이 숨겨지므로 NavItem 아래 인라인 아코디언으로 서브 메뉴 펼침 */}
              {hasBiz('owner', 'member') && (
                <NavSection>
                  <NavTitle $isCollapsed={isCollapsed} />
                  <NavItem
                    to="/stats/overview"
                    $isCollapsed={isCollapsed}
                    $active={isActive('/stats')}
                    title={isCollapsed ? t('nav.sectionReports', '통계·분석') : undefined}
                  >
                    <NavIcon $isCollapsed={isCollapsed}><IconInsights /></NavIcon>
                    <NavLabel $isCollapsed={isCollapsed}>{t('nav.sectionReports', '통계·분석')}</NavLabel>
                  </NavItem>
                  {isActive('/stats') && (
                    <AccordionWrap>
                      <AccordionItem to="/stats/overview" $active={isActive('/stats/overview')}>
                        <IconStatsOverview /> {t('nav.statsOverview', '개요')}
                      </AccordionItem>
                      <AccordionItem to="/stats/tasks" $active={isActive('/stats/tasks')}>
                        <IconStatsTime /> {t('nav.statsTaskTime', '업무·시간')}
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
                    $isCollapsed={isCollapsed}
                    $active={
                      location.pathname.startsWith('/business/settings') ||
                      location.pathname.startsWith('/settings') ||
                      location.pathname.startsWith('/profile')
                    }
                    title={isCollapsed ? t('nav.settings') : undefined}
                  >
                    <NavIcon $isCollapsed={isCollapsed}><IconGear /></NavIcon>
                    <NavLabel $isCollapsed={isCollapsed}>{t('nav.settings')}</NavLabel>
                  </NavItem>
                  {(location.pathname.startsWith('/business/settings')
                    || location.pathname.startsWith('/settings')
                    || location.pathname.startsWith('/profile')
                    || isActive('/business/clients')
                    || isActive('/business/members')) && (
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
                      {hasBiz('owner', 'member') && (
                        <AccordionItem
                          to="/business/settings/language"
                          $active={location.pathname.includes('/language') || location.pathname.includes('/timezone')}
                        >
                          <IconCalendar /> {t('nav.language', '언어·타임존')}
                        </AccordionItem>
                      )}
                      {hasBiz('owner') && (
                        <AccordionItem
                          to="/business/settings/billing"
                          $active={location.pathname.includes('/billing')}
                        >
                          <IconReceipt /> {t('nav.billing', '청구 설정')}
                        </AccordionItem>
                      )}
                      {hasBiz('owner') && (
                        <AccordionItem
                          to="/business/settings/email"
                          $active={location.pathname.includes('/email')}
                        >
                          <IconMail /> {t('nav.email', '이메일')}
                        </AccordionItem>
                      )}
                      {hasBiz('owner', 'member') && (
                        <AccordionItem
                          to="/business/settings/notifications"
                          $active={location.pathname.includes('/notifications')}
                        >
                          <IconBell /> {t('nav.notifications', '알림')}
                        </AccordionItem>
                      )}
                      {hasBiz('owner') && (
                        <AccordionItem
                          to="/business/settings/storage"
                          $active={location.pathname.includes('/storage')}
                        >
                          <IconFile /> {t('nav.storage', '파일 저장소')}
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
                          to="/business/settings/permissions"
                          $active={location.pathname.includes('/permissions')}
                        >
                          <IconShield /> {t('nav.permissions', '권한')}
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
                          to="/business/members"
                          $active={isActive('/business/members')}
                        >
                          <IconMembers /> {t('nav.members')}
                        </AccordionItem>
                      )}
                      <AccordionItem to="/profile" $active={isActive('/profile')}>
                        <IconUsers /> {t('user.profile')}
                      </AccordionItem>
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
                    $active={isActive('/profile')}
                    title={isCollapsed ? t('user.profile') : undefined}
                  >
                    <NavIcon $isCollapsed={isCollapsed}><IconGear /></NavIcon>
                    <NavLabel $isCollapsed={isCollapsed}>{t('user.profile')}</NavLabel>
                  </NavItem>
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
                referenceTzs={[...workspaceRefs, ...userRefs]}
                locale={(i18n.language === 'ko' ? 'ko' : 'en')}
                isWorkspaceAdmin={hasRole('business_owner', 'platform_admin')}
              />
              <div style={{ marginBottom: 8 }}>
                <LanguageSelector variant="sidebar" />
              </div>
              <UserInfo to="/profile" title={t('user.profile')}>
                <UserAvatar>{userDisplayName?.charAt(0)?.toUpperCase() || 'U'}</UserAvatar>
                <div style={{ overflow: 'hidden' }}>
                  <UserName>{userDisplayName}</UserName>
                  <UserRoleText>{getRoleLabel(user)}</UserRoleText>
                </div>
              </UserInfo>
              <LogoutButton onClick={logout}>{t('user.logout')}</LogoutButton>
            </>
          )}
          {isCollapsed && (
            <>
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
            {hasBiz('owner', 'member') && (
              <SecondaryNavItem $collapsed={secondaryCollapsed}
                to="/business/settings/language"
                $active={location.pathname.includes('/language') || location.pathname.includes('/timezone')}
              >
                <IconCalendar /> {t('nav.language', '언어·타임존')}
              </SecondaryNavItem>
            )}
            {hasBiz('owner') && (
              <SecondaryNavItem $collapsed={secondaryCollapsed}
                to="/business/settings/billing"
                $active={location.pathname.includes('/billing')}
              >
                <IconReceipt /> {t('nav.billing', '청구 설정')}
              </SecondaryNavItem>
            )}
            {hasBiz('owner') && (
              <SecondaryNavItem $collapsed={secondaryCollapsed}
                to="/business/settings/email"
                $active={location.pathname.includes('/email')}
              >
                <IconMail /> {t('nav.email', '이메일')}
              </SecondaryNavItem>
            )}
            {hasBiz('owner', 'member') && (
              <SecondaryNavItem $collapsed={secondaryCollapsed}
                to="/business/settings/notifications"
                $active={location.pathname.includes('/notifications')}
              >
                <IconBell /> {t('nav.notifications', '알림')}
              </SecondaryNavItem>
            )}
            {hasBiz('owner') && (
              <SecondaryNavItem $collapsed={secondaryCollapsed}
                to="/business/settings/storage"
                $active={location.pathname.includes('/storage')}
              >
                <IconFile /> {t('nav.storage', '파일 저장소')}
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
                to="/business/settings/cue"
                $active={location.pathname.includes('/cue')}
              >
                <IconInsights /> {t('nav.cue', 'Cue')}
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
                to="/business/members"
                $active={isActive('/business/members')}
              >
                <IconMembers /> {t('nav.members')}
              </SecondaryNavItem>
            )}
            <SecondaryNavItem $collapsed={secondaryCollapsed} to="/profile" $active={isActive('/profile')}>
              <IconUsers /> {t('user.profile')}
            </SecondaryNavItem>
          </SecondaryBody>
        </SecondaryPanel>
      )}

      <MainContent $marginLeft={mainMarginLeft}>
        <WorkspaceBillingBanner />
        <MobileContentPadding>{children}</MobileContentPadding>
      </MainContent>
    </LayoutContainer>
  );
};

export default MainLayout;
