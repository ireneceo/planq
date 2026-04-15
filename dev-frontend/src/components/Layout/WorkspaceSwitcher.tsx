import React, { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
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
  if (workspaces.length === 0) return null;

  const current = workspaces.find((w) => w.is_active) || workspaces[0];
  const multiple = workspaces.length > 1;
  const roleLabel = (w: WorkspaceMembership) => t(ROLE_LABEL_KEY[w.role], ROLE_LABEL_FALLBACK[w.role]);

  const handleSwitch = async (target: WorkspaceMembership) => {
    if (target.business_id === current.business_id) {
      setOpen(false);
      return;
    }
    setBusyId(target.business_id);
    const ok = await switchWorkspace(target.business_id);
    setBusyId(null);
    setOpen(false);
    if (ok) window.location.href = '/talk';
  };

  return (
    <Container ref={containerRef}>
      <Trigger
        type="button"
        $multiple={multiple}
        $collapsed={!!collapsed}
        onClick={() => multiple && setOpen((v) => !v)}
        title={multiple ? t('switcher.tooltip', '워크스페이스 전환') : current.brand_name}
      >
        <Dot $color={ROLE_DOT[current.role]} />
        {!collapsed && (
          <>
            <Info>
              <Name>{current.brand_name}</Name>
              <SubRole>{roleLabel(current)}</SubRole>
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
          <MenuLabel>{t('switcher.menuTitle', '내 워크스페이스')}</MenuLabel>
          {workspaces.map((w) => {
            const isCurrent = w.business_id === current.business_id;
            const isBusy = busyId === w.business_id;
            return (
              <MenuItem
                key={w.business_id}
                type="button"
                $current={isCurrent}
                disabled={isBusy}
                onClick={() => handleSwitch(w)}
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

const Trigger = styled.button<{ $multiple: boolean; $collapsed: boolean }>`
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 14px 16px;
  background: transparent;
  border: none;
  cursor: ${(p) => (p.$multiple ? 'pointer' : 'default')};
  transition: background 0.15s;
  text-align: left;
  color: #CCFBF1;
  ${(p) => p.$collapsed && 'justify-content: center; padding: 12px 8px;'}
  &:hover {
    ${(p) => p.$multiple && 'background: rgba(255, 255, 255, 0.08); color: #FFFFFF;'}
  }
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

const Name = styled.div`
  font-size: 14px;
  font-weight: 600;
  color: #FFFFFF;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  letter-spacing: -0.1px;
`;

const SubRole = styled.div`
  font-size: 11px;
  font-weight: 500;
  color: #5EEAD4;
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

const MenuItem = styled.button<{ $current: boolean }>`
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 10px 12px;
  background: ${(p) => (p.$current ? 'rgba(94, 234, 212, 0.16)' : 'transparent')};
  border: none;
  border-radius: 8px;
  cursor: pointer;
  text-align: left;
  color: ${(p) => (p.$current ? '#FFFFFF' : '#CCFBF1')};
  transition: background 0.1s, color 0.1s;
  &:hover {
    background: ${(p) => (p.$current ? 'rgba(94, 234, 212, 0.22)' : 'rgba(255, 255, 255, 0.10)')};
    color: #FFFFFF;
  }
  &:disabled { opacity: 0.6; cursor: wait; }
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
