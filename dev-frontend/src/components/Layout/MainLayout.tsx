import React, { useState, useEffect } from 'react';
import styled from 'styled-components';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import LanguageSelector from '../Common/LanguageSelector';
import WorkspaceSwitcher from './WorkspaceSwitcher';
import SidebarClock from './SidebarClock';
import { useTimezones } from '../../hooks/useTimezones';
import i18n from '../../i18n';

const LayoutContainer = styled.div`
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background-color: #F8FAFC;
  overflow-x: hidden;
  -webkit-font-smoothing: antialiased;
  min-height: 100vh;
`;

const Sidebar = styled.div<{ $isOpen?: boolean; $isCollapsed?: boolean }>`
  position: fixed; top: 0; left: 0;
  width: ${props => props.$isCollapsed ? '0px' : '220px'};
  height: 100vh;
  background: linear-gradient(180deg, #115E59 0%, #134E4A 100%);
  z-index: 1000; display: flex; flex-direction: column;
  transition: width 0.3s ease; overflow-x: hidden;
  @media (max-width: 768px) {
    transform: translateX(${props => props.$isOpen ? '0' : '-100%'});
    width: 220px; transition: transform 0.3s, width 0.3s ease;
  }
`;

const SidebarHeader = styled.div`
  padding: 16px; border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  flex-shrink: 0; height: 56px;
  display: flex; align-items: center; justify-content: space-between;
`;

const Logo = styled.div`
  font-size: 20px; font-weight: 700; color: #FFFFFF; letter-spacing: -0.5px;
  span { color: #5EEAD4; }
`;

const SidebarNav = styled.nav`
  padding: 8px 0 24px 0; flex: 1; overflow-y: auto; overflow-x: hidden;
  &::-webkit-scrollbar { width: 6px; }
  &::-webkit-scrollbar-track { background: transparent; }
  &::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.2); border-radius: 3px; }
`;

const NavSection = styled.div`margin-bottom: 0;`;

const NavTitle = styled.div`
  color: rgba(204, 251, 241, 0.5); font-size: 11px; font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.5px;
  padding: 0 16px; margin-bottom: 6px; margin-top: 20px;
`;

const NavItem = styled(Link)<{ $active?: boolean }>`
  display: flex; align-items: center; padding: 4px 16px;
  color: #CCFBF1; text-decoration: none; transition: all 0.15s;
  font-size: 13px; font-weight: 500; min-height: 28px; white-space: nowrap;
  &:hover { background: rgba(255, 255, 255, 0.08); color: #FFFFFF; }
  ${props => props.$active && `
    color: #FFFFFF;
    background: #0F766E;
    font-weight: 600;
  `}
`;

const NavIcon = styled.span`
  width: 20px; margin-right: 10px; display: flex;
  align-items: center; justify-content: center; font-size: 15px;
  color: #5EEAD4;
`;


const SidebarFooter = styled.div`
  border-top: 1px solid rgba(255, 255, 255, 0.1); padding: 12px 16px; flex-shrink: 0;
`;

const UserInfo = styled.div`
  display: flex; align-items: center; gap: 10px; margin-bottom: 8px;
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

const MainContent = styled.div<{ $isCollapsed?: boolean }>`
  margin-left: ${props => props.$isCollapsed ? '0px' : '220px'};
  min-height: 100vh; transition: margin-left 0.3s ease;
  @media (max-width: 768px) { margin-left: 0; }
`;

const MobileHeader = styled.div`
  display: none; position: fixed; top: 0; left: 0; right: 0;
  height: 56px; background: #115E59; border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  z-index: 999; padding: 0 16px; align-items: center; justify-content: space-between;
  @media (max-width: 768px) { display: flex; }
`;

const HamburgerButton = styled.button`
  background: none; border: none; padding: 8px; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  color: #CCFBF1; border-radius: 6px;
  &:hover { background: rgba(255, 255, 255, 0.08); }
`;

const Overlay = styled.div<{ $show?: boolean }>`
  display: ${props => props.$show ? 'block' : 'none'};
  position: fixed; top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0,0,0,0.4); z-index: 999;
`;

const MobileContentPadding = styled.div`
  @media (max-width: 768px) { padding-top: 56px; }
`;

const SidebarToggleButton = styled.button`
  background: none; border: none; cursor: pointer; padding: 8px;
  display: flex; align-items: center; justify-content: center;
  color: #CCFBF1; border-radius: 6px; transition: all 0.2s;
  &:hover { background: rgba(255, 255, 255, 0.08); color: #FFFFFF; }
  svg { width: 20px; height: 20px; }
`;

const SidebarOpenButton = styled.button<{ $isCollapsed?: boolean }>`
  position: fixed; top: 16px; left: 16px; z-index: 1001;
  background: #115E59; border: 1px solid rgba(255, 255, 255, 0.15); border-radius: 8px;
  padding: 12px; cursor: pointer;
  display: ${props => props.$isCollapsed ? 'flex' : 'none'};
  align-items: center; justify-content: center;
  color: #CCFBF1; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  transition: all 0.2s;
  &:hover { background: #0F766E; color: #FFFFFF; }
  svg { width: 20px; height: 20px; }
  @media (max-width: 768px) { display: none; }
`;

interface MainLayoutProps { children: React.ReactNode; }

const MainLayout: React.FC<MainLayoutProps> = ({ children }) => {
  const { t } = useTranslation('layout');
  const { user, logout, hasRole } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const { workspaceTz, workspaceRefs, userTz, userRefs } = useTimezones();

  useEffect(() => { setSidebarOpen(false); }, [location.pathname]);

  const isActive = (path: string) => location.pathname === path || location.pathname.startsWith(path + '/');

  // 플랫폼 관리자 모드: /admin/* 경로일 때만 활성. 워크스페이스 컨텍스트와 완전 분리.
  const isAdminMode = location.pathname.startsWith('/admin');

  // 워크스페이스 역할 기반 메뉴 노출 — hasRole 은 platform_admin 을 우선시키므로
  // 사이드바는 현재 워크스페이스에서의 role 직접 참조 (멀티 롤 유저가 양쪽 다 보이도록)
  const hasBiz = (...roles: Array<'owner' | 'member' | 'client'>) =>
    !!user?.business_role && roles.includes(user.business_role as 'owner' | 'member' | 'client');

  const getRoleLabel = (u: typeof user) => {
    if (!u) return '';
    if (u.platform_role === 'platform_admin') return t('role.platform_admin');
    if (u.business_role === 'owner') return t('role.business_owner');
    if (u.business_role === 'member') return t('role.business_member');
    return t('role.user');
  };

  return (
    <LayoutContainer>
      <MobileHeader>
        <HamburgerButton onClick={() => setSidebarOpen(true)}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
        </HamburgerButton>
        <Logo>Plan<span>Q</span></Logo>
        <div style={{ width: 40 }} />
      </MobileHeader>

      <Overlay $show={sidebarOpen} onClick={() => setSidebarOpen(false)} />

      <SidebarOpenButton $isCollapsed={isCollapsed} onClick={() => setIsCollapsed(false)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
      </SidebarOpenButton>

      <Sidebar $isOpen={sidebarOpen} $isCollapsed={isCollapsed}>
        <SidebarHeader>
          <Logo>Plan<span>Q</span></Logo>
          <SidebarToggleButton onClick={() => setIsCollapsed(true)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </SidebarToggleButton>
        </SidebarHeader>

        <WorkspaceSwitcher />

        <SidebarNav>
          {isAdminMode ? (
            <>
              <NavSection>
                <NavItem to="/admin/dashboard" $active={isActive('/admin/dashboard') || location.pathname === '/admin'}>
                  <NavIcon><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg></NavIcon>
                  {t('nav.dashboard')}
                </NavItem>
              </NavSection>
              <NavSection>
                <NavTitle>{t('nav.sectionAdmin')}</NavTitle>
                <NavItem to="/admin/users" $active={isActive('/admin/users')}>
                  <NavIcon><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg></NavIcon>
                  {t('nav.users')}
                </NavItem>
                <NavItem to="/admin/businesses" $active={isActive('/admin/businesses')}>
                  <NavIcon><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/></svg></NavIcon>
                  {t('nav.businesses')}
                </NavItem>
              </NavSection>
            </>
          ) : (
          <>
          <NavSection>
            <NavItem to="/dashboard" $active={isActive('/dashboard')}>
              <NavIcon><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg></NavIcon>
              {t('nav.dashboard')}
            </NavItem>
          </NavSection>

          {hasBiz('owner', 'member', 'client') && (
            <NavSection>
              <NavTitle>{t('nav.sectionFeatures')}</NavTitle>
              <NavItem to="/talk" $active={isActive('/talk')}>
                <NavIcon><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></NavIcon>
                {t('nav.talk')}
              </NavItem>
              <NavItem to="/tasks" $active={isActive('/tasks')}>
                <NavIcon><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg></NavIcon>
                {t('nav.task')}
              </NavItem>
              {hasBiz('owner', 'member') && (
                <NavItem to="/projects" $active={isActive('/projects')}>
                  <NavIcon><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg></NavIcon>
                  {t('nav.project')}
                </NavItem>
              )}
              <NavItem to="/calendar" $active={isActive('/calendar')}>
                <NavIcon><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></NavIcon>
                {t('nav.calendar')}
              </NavItem>
              <NavItem to="/notes" $active={isActive('/notes')}>
                <NavIcon><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg></NavIcon>
                {t('nav.note')}
              </NavItem>
              <NavItem to="/files" $active={isActive('/files')}>
                <NavIcon><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></NavIcon>
                {t('nav.file')}
              </NavItem>
              <NavItem to="/docs" $active={isActive('/docs')}>
                <NavIcon><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg></NavIcon>
                {t('nav.docs')}
              </NavItem>
              {hasBiz('owner', 'member') && (
                <NavItem to="/bills" $active={isActive('/bills') || isActive('/billing')}>
                  <NavIcon><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg></NavIcon>
                  {t('nav.qbill', 'Q Bill')}
                </NavItem>
              )}
            </NavSection>
          )}

          {/* 📊 통계·분석 섹션 */}
          {hasBiz('owner', 'member') && (
            <NavSection>
              <NavTitle>{t('nav.sectionReports', '통계·분석')}</NavTitle>
              <NavItem to="/stats/overview" $active={isActive('/stats/overview')}>
                <NavIcon><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3v18h18"/><path d="M7 14l4-4 4 4 5-5"/></svg></NavIcon>
                {t('nav.statsOverview', '개요')}
              </NavItem>
              <NavItem to="/stats/tasks" $active={isActive('/stats/tasks')}>
                <NavIcon><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></NavIcon>
                {t('nav.statsTaskTime', '업무·시간')}
              </NavItem>
              <NavItem to="/stats/profit" $active={isActive('/stats/profit')}>
                <NavIcon><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg></NavIcon>
                {t('nav.statsProfit', '프로젝트 수익성')}
              </NavItem>
              <NavItem to="/stats/team" $active={isActive('/stats/team')}>
                <NavIcon><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></NavIcon>
                {t('nav.statsTeam', '팀 생산성')}
              </NavItem>
              <NavItem to="/stats/finance" $active={isActive('/stats/finance')}>
                <NavIcon><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/></svg></NavIcon>
                {t('nav.statsFinance', '비용·재무')}
              </NavItem>
              <NavItem to="/stats/reports" $active={isActive('/stats/reports')}>
                <NavIcon><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg></NavIcon>
                {t('nav.statsReports', '보고서')}
              </NavItem>
            </NavSection>
          )}

          {hasBiz('owner', 'member') && (
            <NavSection>
              <NavTitle>{t('nav.sectionBusiness')}</NavTitle>
              <NavItem to="/business/settings" $active={isActive('/business/settings')}>
                <NavIcon><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></NavIcon>
                {t('nav.settings')}
              </NavItem>
              <NavItem to="/business/members" $active={isActive('/business/members')}>
                <NavIcon><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></NavIcon>
                {t('nav.members')}
              </NavItem>
              <NavItem to="/business/clients" $active={isActive('/business/clients')}>
                <NavIcon><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></NavIcon>
                {t('nav.clients')}
              </NavItem>
            </NavSection>
          )}

          </>
          )}
        </SidebarNav>

        <SidebarFooter>
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
          <UserInfo
            as="button"
            type="button"
            onClick={() => navigate('/profile')}
            style={{
              background: 'transparent',
              border: 'none',
              textAlign: 'left',
              cursor: 'pointer',
              padding: 0,
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
            title={t('user.profile')}
          >
            <UserAvatar>{user?.name?.charAt(0)?.toUpperCase() || 'U'}</UserAvatar>
            <div style={{ overflow: 'hidden' }}>
              <UserName>{user?.name}</UserName>
              <UserRoleText>{getRoleLabel(user)}</UserRoleText>
            </div>
          </UserInfo>
          <LogoutButton onClick={logout}>{t('user.logout')}</LogoutButton>
        </SidebarFooter>
      </Sidebar>

      <MainContent $isCollapsed={isCollapsed}>
        <MobileContentPadding>{children}</MobileContentPadding>
      </MainContent>
    </LayoutContainer>
  );
};

export default MainLayout;
