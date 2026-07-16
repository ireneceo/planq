import React, { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth, apiFetch, type WorkspaceMembership } from '../../contexts/AuthContext';
import { useUnreadByBusiness } from '../../hooks/useUnreadTotal';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';

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
  ai: '#5EEAD4',     // 라벤더
};

interface Props {
  collapsed?: boolean;
}

const WorkspaceSwitcher: React.FC<Props> = ({ collapsed }) => {
  const { t } = useTranslation('layout');
  const { user, switchWorkspace } = useAuth();
  const unreadByBiz = useUnreadByBusiness();
  const location = useChromeLocation();
  const navigate = useChromeNav();
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  // 새 워크스페이스 만들기
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState('');

  useBodyScrollLock(createOpen);

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

  // N+72-6 — 다른 워크스페이스(현재 active 제외) 의 총 unread. Trigger 에 dot/숫자 표시 → 사용자가
  //          "다른 워크스페이스에 알림 있다" 인지. 드롭다운 안에서는 워크스페이스별 숫자 표시.
  const otherWsUnread = workspaces.reduce((sum, w) => {
    if (activeWs && w.business_id === activeWs.business_id) return sum;
    return sum + (unreadByBiz[w.business_id] || 0);
  }, 0);

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
    if (!isAdminMode) navigate('/admin/dashboard');
  };

  const handleCreateWorkspace = async () => {
    const nm = createName.trim();
    if (!nm || creating) return;
    setCreating(true); setCreateErr('');
    try {
      const r = await apiFetch('/api/businesses', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand_name: nm }),
      });
      const j = await r.json();
      if (!r.ok || j?.success === false) throw new Error(j?.message || 'create_failed');
      const newId = j.data?.id;
      if (newId) { await switchWorkspace(newId); window.location.href = '/talk'; }
    } catch (e) {
      setCreateErr((e as Error).message || (t('switcher.createError', '생성 실패') as string));
      setCreating(false);
    }
  };

  return (
    <Container ref={containerRef}>
      <Trigger
        type="button"
        $multiple={!collapsed}
        $collapsed={!!collapsed}
        $admin={isAdminMode}
        onClick={() => !collapsed && setOpen((v) => !v)}
        title={t('switcher.tooltip', '워크스페이스 전환') as string}
      >
        {isAdminMode ? (
          <AdminBadge>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 4l3 12h14l3-12-6 4-4-8-4 8-6-4z"/>
            </svg>
          </AdminBadge>
        ) : activeWs?.brand_logo_url ? (
          <LogoImg src={activeWs.brand_logo_url} alt={currentName} />
        ) : (
          <InitialBadge $color={currentDot}>{(currentName || '·').charAt(0).toUpperCase()}</InitialBadge>
        )}
        {!collapsed && (
          <>
            <Info>
              <Name $admin={isAdminMode}>{currentName}</Name>
              <RolePill $admin={isAdminMode}>{currentSub}</RolePill>
            </Info>
            {multiple && otherWsUnread > 0 && (
              <OtherUnreadBadge title={t('switcher.otherUnread', '다른 워크스페이스 알림 {{n}}개', { n: otherWsUnread }) as string}>
                {otherWsUnread > 99 ? '99+' : otherWsUnread}
              </OtherUnreadBadge>
            )}
            {multiple && (
              <Chevron viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" $open={open}>
                <polyline points="6 9 12 15 18 9" />
              </Chevron>
            )}
          </>
        )}
      </Trigger>

      {open && !collapsed && (
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
                    {w.brand_logo_url ? (
                      <MenuLogoImg src={w.brand_logo_url} alt={w.brand_name} />
                    ) : (
                      <MenuInitial $color={ROLE_DOT[w.role]}>{(w.brand_name || '·').charAt(0).toUpperCase()}</MenuInitial>
                    )}
                    <ItemBody>
                      <ItemName>{w.brand_name}</ItemName>
                      <ItemSub>{roleLabel(w)}</ItemSub>
                    </ItemBody>
                    {(() => {
                      const n = unreadByBiz[w.business_id] || 0;
                      return n > 0 ? <MenuUnreadBadge>{n > 99 ? '99+' : n}</MenuUnreadBadge> : null;
                    })()}
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

          <MenuDivider />
          <MenuItem type="button" $current={false} onClick={() => { setOpen(false); setCreateErr(''); setCreateName(''); setCreateOpen(true); }}>
            <PlusBadge>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </PlusBadge>
            <ItemBody><ItemName>{t('switcher.createWorkspace', '새 워크스페이스 만들기')}</ItemName></ItemBody>
          </MenuItem>

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
                <Dot $color="#5EEAD4" />
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

      {createOpen && (
        <CreateOverlay onMouseDown={(e) => { if (e.target === e.currentTarget && !creating) setCreateOpen(false); }}>
          <CreateModal role="dialog" aria-modal="true" aria-labelledby="ws-create-title" onMouseDown={(e) => e.stopPropagation()}>
            <CreateTitle id="ws-create-title">{t('switcher.createWorkspace', '새 워크스페이스 만들기')}</CreateTitle>
            <CreateDesc>{t('switcher.createDesc', '내 소유의 새 워크스페이스를 만듭니다. 14일 무료 체험이 시작됩니다.')}</CreateDesc>
            <CreateInput
              autoFocus
              value={createName}
              maxLength={60}
              placeholder={t('switcher.createPlaceholder', '워크스페이스 이름 (예: 우리회사)') as string}
              onChange={(e) => { setCreateName(e.target.value); setCreateErr(''); }}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreateWorkspace(); if (e.key === 'Escape' && !creating) setCreateOpen(false); }}
            />
            {createErr && <CreateErr>{createErr}</CreateErr>}
            <CreateActions>
              <CreateCancel type="button" disabled={creating} onClick={() => setCreateOpen(false)}>{t('switcher.cancel', '취소')}</CreateCancel>
              <CreatePrimary type="button" disabled={creating || !createName.trim()} onClick={handleCreateWorkspace}>
                {creating ? t('switcher.creating', '만드는 중…') : t('switcher.create', '만들기')}
              </CreatePrimary>
            </CreateActions>
          </CreateModal>
        </CreateOverlay>
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
`;

// 워크스페이스 카드 — 사이드바에서 살짝 분리된 카드 (border + bg)
// 다크 사이드바(#115E59) 위에 떠있는 형태. 통합검색과 함께 시각적 분리.
// Trigger — 워크스페이스 / 플랫폼 관리자 모드 모두 동일한 teal 톤 (사이드바 일관성)
const Trigger = styled.button<{ $multiple: boolean; $collapsed: boolean; $admin: boolean }>`
  display: flex;
  align-items: center;
  gap: 10px;
  width: calc(100% - 16px);
  margin: 8px;
  padding: 10px 12px;
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(94,234,212,0.18);
  border-radius: 10px;
  cursor: ${(p) => (p.$multiple ? 'pointer' : 'default')};
  transition: background 0.15s, border-color 0.15s;
  text-align: left;
  color: #FFFFFF;
  ${(p) => p.$collapsed && 'justify-content: center; padding: 8px;'}
  &:hover {
    ${(p) => p.$multiple && 'background: rgba(255,255,255,0.10); border-color: rgba(94,234,212,0.32);'}
  }
`;

// 워크스페이스 로고 (있으면 우선) — 28×28 라운드 8px
const LogoImg = styled.img`
  width: 28px; height: 28px;
  flex-shrink: 0;
  object-fit: cover;
  border-radius: 8px;
  background: #FFFFFF;
  box-shadow: 0 1px 2px rgba(0,0,0,0.15);
`;

// 워크스페이스 이니셜 박스 — 점(Dot) 대체. 역할 색을 반영하면서도 informative
const InitialBadge = styled.span<{ $color: string }>`
  width: 28px; height: 28px;
  flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  background: ${(p) => p.$color};
  color: #0B3B36;
  border-radius: 8px;
  font-size: 13px; font-weight: 700;
  letter-spacing: -0.2px;
  box-shadow: 0 1px 2px rgba(0,0,0,0.15);
`;

// AdminBadge — 일반 InitialBadge 와 동일 teal 톤 (사용자 요청: 다른 워크스페이스와 같이)
const AdminBadge = styled.span`
  width: 28px; height: 28px;
  flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, #0D9488 0%, #0F766E 100%);
  color: #FFFFFF;
  border-radius: 8px;
  box-shadow: 0 1px 2px rgba(0,0,0,0.15);
`;

// 드롭다운 메뉴 안에서 사용하는 작은 점 (각 워크스페이스 식별)
// 드롭다운 메뉴 안의 심볼 (각 워크스페이스 식별)
const MenuLogoImg = styled.img`
  width: 24px; height: 24px;
  flex-shrink: 0;
  object-fit: cover;
  border-radius: 6px;
  background: #FFFFFF;
  box-shadow: 0 1px 2px rgba(0,0,0,0.15);
`;
const MenuInitial = styled.span<{ $color: string }>`
  width: 24px; height: 24px;
  flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  background: ${(p) => p.$color};
  color: #0B3B36;
  border-radius: 6px;
  font-size: 12px; font-weight: 700;
  letter-spacing: -0.2px;
  box-shadow: 0 1px 2px rgba(0,0,0,0.15);
`;

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
  color: #FFFFFF;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  letter-spacing: -0.1px;
`;

// 역할 pill — 이름 아래 작은 chip 형태로 분리. admin 도 일반 워크스페이스와 동일 teal.
const RolePill = styled.span<{ $admin?: boolean }>`
  display: inline-flex; align-items: center;
  margin-top: 2px;
  padding: 1px 7px;
  font-size: 10px; font-weight: 600;
  color: #5EEAD4;
  background: rgba(94,234,212,0.14);
  border: 1px solid rgba(94,234,212,0.22);
  border-radius: 999px;
  letter-spacing: 0.2px;
  white-space: nowrap;
  align-self: flex-start;
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

// MenuItem — admin 항목도 일반 워크스페이스와 동일 teal 톤
const MenuItem = styled.button<{ $current: boolean; $admin?: boolean }>`
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 10px 12px;
  background: ${(p) => p.$current ? 'rgba(94, 234, 212, 0.16)' : 'transparent'};
  border: none;
  border-radius: 8px;
  cursor: pointer;
  text-align: left;
  color: ${(p) => (p.$current ? '#FFFFFF' : '#CCFBF1')};
  transition: background 0.1s, color 0.1s;
  &:hover {
    background: ${(p) => p.$current ? 'rgba(94, 234, 212, 0.22)' : 'rgba(255, 255, 255, 0.10)'};
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
// N+72-6 — 다른 워크스페이스 unread 숫자 (Trigger 의 chevron 옆)
const OtherUnreadBadge = styled.span`
  min-width: 18px; height: 18px; padding: 0 6px;
  display: inline-flex; align-items: center; justify-content: center;
  background: #F43F5E; color: #FFFFFF;
  font-size: 10px; font-weight: 700;
  border-radius: 999px;
  flex-shrink: 0;
`;
// 드롭다운 안 워크스페이스별 unread 숫자
const MenuUnreadBadge = styled.span`
  min-width: 20px; height: 20px; padding: 0 7px;
  display: inline-flex; align-items: center; justify-content: center;
  background: #F43F5E; color: #FFFFFF;
  font-size: 11px; font-weight: 700;
  border-radius: 999px;
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

// 새 워크스페이스 만들기 — 메뉴 + 모달
const PlusBadge = styled.span`
  width: 24px; height: 24px; border-radius: 8px; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  background: rgba(94,234,212,0.16); color: #5EEAD4;
`;
const CreateOverlay = styled.div`
  position: fixed; inset: 0; z-index: 2000;
  background: rgba(15,23,42,0.45);
  display: flex; align-items: center; justify-content: center; padding: 16px;
`;
const CreateModal = styled.div`
  width: 100%; max-width: 380px; background: #FFFFFF; border-radius: 14px;
  padding: 22px 22px 18px; box-shadow: 0 24px 48px -16px rgba(15,23,42,0.4);
`;
const CreateTitle = styled.h3`font-size: 16px; font-weight: 800; color: #0F172A; margin: 0 0 6px;`;
const CreateDesc = styled.p`font-size: 12px; color: #64748B; line-height: 1.6; margin: 0 0 16px;`;
const CreateInput = styled.input`
  width: 100%; box-sizing: border-box; padding: 11px 13px; font-size: 14px;
  border: 1px solid #CBD5E1; border-radius: 8px; color: #0F172A; outline: none;
  &:focus { border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.18); }
`;
const CreateErr = styled.div`font-size: 12px; color: #EF4444; margin-top: 8px;`;
const CreateActions = styled.div`display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px;`;
const CreateCancel = styled.button`
  padding: 9px 16px; font-size: 13px; font-weight: 600; color: #475569;
  background: #fff; border: 1px solid #E2E8F0; border-radius: 8px; cursor: pointer;
  &:hover:not(:disabled) { background: #F8FAFC; } &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
const CreatePrimary = styled.button`
  padding: 9px 18px; font-size: 13px; font-weight: 700; color: #fff;
  background: #0D9488; border: none; border-radius: 8px; cursor: pointer;
  &:hover:not(:disabled) { background: #0F766E; } &:disabled { background: #CBD5E1; cursor: not-allowed; }
`;
