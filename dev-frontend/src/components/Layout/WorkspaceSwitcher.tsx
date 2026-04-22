import React, { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth, type WorkspaceMembership } from '../../contexts/AuthContext';

/**
 * WorkspaceSwitcher (사이드바 전용)
 *
 * 설계 원칙:
 *   - 사이드바 dark teal 팔레트 (#115E59 → #134E4A) 에 녹아드는 투명 버튼
 *   - NavItem 과 동일한 hit area 패턴 (full-width, 16px 좌우 패딩, rgba(255,255,255,0.08) hover)
 *   - 흰 카드 배경 금지 — 사이드바 컨텍스트에 카드가 뜨면 이질적
 *   - 드롭다운도 dark teal 팔레트 유지 (#0B3B36 + 민트 border)
 *   - 역할은 색상 dot + 라벨로만 표시, 컬러풀한 배경 뱃지 없음
 *   - 1개면 read-only 헤드라인, 2개 이상이면 드롭다운
 *   - 전환 시 백엔드 active_business_id 영구 저장 + 페이지 reload (워크스페이스 의존 데이터 리셋)
 */

const ROLE_LABEL_KEY: Record<WorkspaceMembership['role'], string> = {
  owner: 'switcher.role.owner',
  member: 'switcher.role.member',
  client: 'switcher.role.client',
  ai: 'switcher.role.ai',
};
const ROLE_LABEL_FALLBACK: Record<WorkspaceMembership['role'], string> = {
  owner: '관리자',
  member: '멤버',
  client: '고객',
  ai: 'AI',
};
// 역할별 accent dot — 사이드바 민트 팔레트에 어울리는 톤
const ROLE_DOT: Record<WorkspaceMembership['role'], string> = {
  owner: '#FB7185',  // 코랄 (관리자 = 주인 강조)
  member: '#5EEAD4', // 민트 (사이드바 accent 일치)
  client: '#FCD34D', // 황금 (고객 = 외부)
  ai: '#C084FC',     // 라벤더
};

interface Props {
  collapsed?: boolean;
}

const WorkspaceSwitcher: React.FC<Props> = ({ collapsed }) => {
  const { t } = useTranslation('layout');
  const { user, switchWorkspace } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', handle);
    return () => window.removeEventListener('mousedown', handle);
  }, [open]);

  if (!user) return null;
  const workspaces = user.workspaces || [];
  if (workspaces.length === 0 && user.platform_role !== 'platform_admin') return null;

  const isAdminMode = location.pathname.startsWith('/admin');
  const isPlatformAdmin = user.platform_role === 'platform_admin';
  const activeWs = workspaces.find((w) => w.is_active) || workspaces[0] || null;

  // 트리거 표시 — 플랫폼 관리자 모드면 가상 컨텍스트, 아니면 활성 워크스페이스
  const currentDot = isAdminMode ? '#FB7185' : (activeWs ? ROLE_DOT[activeWs.role] : '#94A3B8');
  const currentName = isAdminMode
    ? t('switcher.platformAdmin', '플랫폼 관리자')
    : (activeWs?.brand_name || '—');
  const currentSub = isAdminMode
    ? t('switcher.platformAdminSub', '전체 워크스페이스·사용자')
    : (activeWs ? t(ROLE_LABEL_KEY[activeWs.role], ROLE_LABEL_FALLBACK[activeWs.role]) : '');

  // 옵션이 2개 이상이면 드롭다운 (워크스페이스 여러 개 OR platform_admin 추가)
  const multiple = workspaces.length > 1 || (isPlatformAdmin && workspaces.length >= 1);

  const roleLabel = (w: WorkspaceMembership) => t(ROLE_LABEL_KEY[w.role], ROLE_LABEL_FALLBACK[w.role]);

  const handleSwitchWs = async (target: WorkspaceMembership) => {
    // 플랫폼 관리자 모드에서 워크스페이스 선택 시: admin 에서 빠져나옴 + 필요시 워크스페이스 전환
    if (isAdminMode) {
      if (activeWs && target.business_id === activeWs.business_id) {
        setOpen(false);
        navigate('/talk');
        return;
      }
      setBusyId(target.business_id);
      const ok = await switchWorkspace(target.business_id);
      setBusyId(null);
      setOpen(false);
      if (ok) window.location.href = '/talk';
      return;
    }
    // 일반 모드 — 기존 동작
    if (activeWs && target.business_id === activeWs.business_id) {
      setOpen(false);
      return;
    }
    setBusyId(target.business_id);
    const ok = await switchWorkspace(target.business_id);
    setBusyId(null);
    setOpen(false);
    if (ok) window.location.href = '/talk';
  };

  const handleSwitchAdmin = () => {
    setOpen(false);
    if (!isAdminMode) navigate('/admin/businesses');
  };

  return (
    <Container ref={containerRef}>
      <Trigger
        type="button"
        $multiple={multiple}
        $collapsed={!!collapsed}
        $admin={isAdminMode}
        onClick={() => multiple && setOpen((v) => !v)}
        title={multiple ? t('switcher.tooltip', '워크스페이스 전환') : currentName}
      >
        {isAdminMode ? (
          <AdminIcon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M2 4l3 12h14l3-12-6 4-4-8-4 8-6-4z"/>
          </AdminIcon>
        ) : (
          <Dot $color={currentDot} />
        )}
        {!collapsed && (
          <>
            <Info>
              <Name $admin={isAdminMode}>{currentName}</Name>
              <SubRole $admin={isAdminMode}>{currentSub}</SubRole>
            </Info>
            {multiple && (
              <Chevron viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" $open={open}>
                <polyline points="6 9 12 15 18 9" />
              </Chevron>
            )}
          </>
        )}
      </Trigger>

      {open && multiple && !collapsed && (
        <Menu role="listbox">
          {workspaces.length > 0 && (
            <>
              <MenuLabel>{t('switcher.menuTitle', '내 워크스페이스')}</MenuLabel>
              {workspaces.map((w) => {
                const isCurrent = !isAdminMode && activeWs && w.business_id === activeWs.business_id;
                const isBusy = busyId === w.business_id;
                return (
                  <MenuItem
                    key={w.business_id}
                    type="button"
                    $current={!!isCurrent}
                    disabled={isBusy}
                    onClick={() => handleSwitchWs(w)}
                  >
                    <Dot $color={ROLE_DOT[w.role]} />
                    <ItemBody>
                      <ItemName>{w.brand_name}</ItemName>
                      <ItemSub>{roleLabel(w)}</ItemSub>
                    </ItemBody>
                    {isCurrent && (
                      <Check viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <polyline points="20 6 9 17 4 12" />
                      </Check>
                    )}
                    {isBusy && <Spinner />}
                  </MenuItem>
                );
              })}
            </>
          )}

          {isPlatformAdmin && (
            <>
              <MenuDivider />
              <MenuLabel>{t('switcher.adminSection', '시스템')}</MenuLabel>
              <MenuItem
                type="button"
                $current={isAdminMode}
                $admin
                onClick={handleSwitchAdmin}
              >
                <Dot $color="#FB7185" />
                <ItemBody>
                  <ItemName>{t('switcher.platformAdmin', '플랫폼 관리자')}</ItemName>
                  <ItemSub>{t('switcher.platformAdminSub', '전체 워크스페이스·사용자')}</ItemSub>
                </ItemBody>
                {isAdminMode && (
                  <Check viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="20 6 9 17 4 12" />
                  </Check>
                )}
              </MenuItem>
            </>
          )}
        </Menu>
      )}
    </Container>
  );
};

export default WorkspaceSwitcher;

// ─────────────────────────────────────────────
// styles — dark teal sidebar 환경, full-width hit area, 흰 카드 없음
// ─────────────────────────────────────────────
const Container = styled.div`
  position: relative;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
`;

const Trigger = styled.button<{ $multiple: boolean; $collapsed: boolean; $admin: boolean }>`
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 14px 16px;
  background: ${(p) => p.$admin ? 'linear-gradient(135deg, rgba(244,63,94,0.14) 0%, rgba(251,113,133,0.06) 100%)' : 'transparent'};
  border: none;
  cursor: ${(p) => (p.$multiple ? 'pointer' : 'default')};
  transition: background 0.15s;
  text-align: left;
  color: ${(p) => p.$admin ? '#FECACA' : '#CCFBF1'};
  ${(p) => p.$collapsed && 'justify-content: center; padding: 12px 8px;'}
  &:hover {
    ${(p) => p.$multiple && !p.$admin && 'background: rgba(255, 255, 255, 0.08); color: #FFFFFF;'}
    ${(p) => p.$multiple && p.$admin && 'background: linear-gradient(135deg, rgba(244,63,94,0.22) 0%, rgba(251,113,133,0.10) 100%);'}
  }
`;

const AdminIcon = styled.svg`
  width: 16px; height: 16px; color: #FB7185; flex-shrink: 0;
`;

// 역할을 상징하는 작은 dot — 카드 배경 대신
const Dot = styled.span<{ $color: string }>`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: ${(p) => p.$color};
  flex-shrink: 0;
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.06);
`;

const Info = styled.div`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const Name = styled.div<{ $admin?: boolean }>`
  font-size: 14px;
  font-weight: 600;
  color: ${(p) => p.$admin ? '#FECACA' : '#FFFFFF'};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  letter-spacing: -0.1px;
`;

const SubRole = styled.div<{ $admin?: boolean }>`
  font-size: 11px;
  font-weight: 500;
  color: ${(p) => p.$admin ? 'rgba(252,165,165,0.75)' : '#5EEAD4'};
  letter-spacing: 0.2px;
`;

const Chevron = styled.svg<{ $open: boolean }>`
  width: 16px;
  height: 16px;
  color: #5EEAD4;
  transform: rotate(${(p) => (p.$open ? 180 : 0)}deg);
  transition: transform 0.15s;
  flex-shrink: 0;
  opacity: 0.8;
`;

// 드롭다운: 사이드바 풀폭에서 좌우 8px 만 안쪽으로, dark teal 팔레트 유지
const Menu = styled.div`
  position: absolute;
  top: calc(100% + 6px);
  left: 8px;
  right: 8px;
  background: #0B3B36;
  border: 1px solid rgba(94, 234, 212, 0.2);
  border-radius: 12px;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.4);
  padding: 6px;
  z-index: 1100;
  max-height: 360px;
  overflow-y: auto;
  animation: fadeIn 0.12s ease-out;
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
  }

  &::-webkit-scrollbar { width: 6px; }
  &::-webkit-scrollbar-thumb { background: rgba(94, 234, 212, 0.2); border-radius: 3px; }
`;

const MenuLabel = styled.div`
  padding: 8px 12px 6px;
  font-size: 10px;
  color: rgba(94, 234, 212, 0.6);
  text-transform: uppercase;
  letter-spacing: 0.8px;
  font-weight: 600;
`;

const MenuItem = styled.button<{ $current: boolean; $admin?: boolean }>`
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 10px 12px;
  background: ${(p) => {
    if (p.$admin && p.$current) return 'rgba(251, 113, 133, 0.22)';
    if (p.$current) return 'rgba(94, 234, 212, 0.16)';
    return 'transparent';
  }};
  border: none;
  border-radius: 8px;
  cursor: pointer;
  text-align: left;
  color: ${(p) => (p.$current ? '#FFFFFF' : '#CCFBF1')};
  transition: background 0.1s, color 0.1s;
  &:hover {
    background: ${(p) => {
      if (p.$admin) return p.$current ? 'rgba(251, 113, 133, 0.3)' : 'rgba(251, 113, 133, 0.14)';
      return p.$current ? 'rgba(94, 234, 212, 0.22)' : 'rgba(255, 255, 255, 0.10)';
    }};
    color: #FFFFFF;
  }
  &:disabled { opacity: 0.6; cursor: wait; }
`;

const MenuDivider = styled.div`
  height: 1px; background: rgba(94, 234, 212, 0.12); margin: 6px 4px;
`;

const ItemBody = styled.div`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
`;
const ItemName = styled.div`
  font-size: 13px;
  font-weight: 600;
  color: inherit;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;
const ItemSub = styled.div`
  font-size: 11px;
  color: #5EEAD4;
  opacity: 0.85;
`;
const Check = styled.svg`
  width: 14px;
  height: 14px;
  color: #5EEAD4;
  flex-shrink: 0;
`;
const Spinner = styled.div`
  width: 12px;
  height: 12px;
  border: 2px solid rgba(94, 234, 212, 0.3);
  border-top-color: #5EEAD4;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  @keyframes spin { to { transform: rotate(360deg); } }
`;
