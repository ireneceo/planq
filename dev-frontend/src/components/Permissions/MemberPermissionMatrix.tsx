// MemberPermissionMatrix — 멤버 메뉴 권한 매트릭스 (사이클 N+21)
//
// 9 메뉴 × 3 레벨 (none/read/write) — admin/member 매트릭스
// 인라인 dropdown 즉시 저장. role 변경 (member ↔ admin) 별도 버튼.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import ConfirmDialog from '../Common/ConfirmDialog';
import {
  listMembersPermissions, updateMemberPermission, updateMemberRole, updateMemberDefault,
  emitPermissionsChanged, PERMISSIONS_CHANGED_EVENT,
  type MemberPermissionRow, type MenuKey, type PermissionLevel,
} from '../../services/permissions';
// 칸·메뉴 목록은 멤버 상세 «권한» 절과 한 벌(2026-10-23)
import MenuLevelPicker, { MENU_LIST } from './MenuLevelPicker';

interface Props { businessId: number; isOwner: boolean; onChanged?: () => void; }

const MemberPermissionMatrix: React.FC<Props> = ({ businessId, isOwner, onChanged }) => {
  const { t } = useTranslation('settings');
  const [rows, setRows] = useState<MemberPermissionRow[]>([]);
  const [defaults, setDefaults] = useState<Record<MenuKey, PermissionLevel> | null>(null);
  const [loading, setLoading] = useState(true);
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [promoteTarget, setPromoteTarget] = useState<MemberPermissionRow | null>(null);

  const [demoteTarget, setDemoteTarget] = useState<MemberPermissionRow | null>(null);

  const flash = useCallback((k: string) => {
    setSavedKey(k);
    setTimeout(() => setSavedKey((cur) => cur === k ? null : cur), 1500);
  }, []);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const r = await listMembersPermissions(businessId);
      setRows(r.members);
      setDefaults(r.member_defaults || null);
    } catch (e) { setError((e as Error).message); }
    finally { if (!silent) setLoading(false); }
  }, [businessId]);

  useEffect(() => { load(); }, [load]);
  // 멤버 상세에서 바꾸면 표도 따라온다(같은 창). 내가 쏜 신호에도 다시 읽는다 — 서버 값이 정본
  useEffect(() => {
    const on = (ev: Event) => {
      if (Number((ev as CustomEvent<{ business_id?: number }>).detail?.business_id) === businessId) void load(true);
    };
    window.addEventListener(PERMISSIONS_CHANGED_EVENT, on);
    return () => window.removeEventListener(PERMISSIONS_CHANGED_EVENT, on);
  }, [businessId, load]);

  const writeCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const m of MENU_LIST) {
      c[m] = rows.filter(r => r.role === 'owner' || r.role === 'admin' || r.menus[m] === 'write').length;
    }
    return c;
  }, [rows]);

  const onLevel = async (uid: number, menu: MenuKey, level: PermissionLevel | 'default') => {
    try {
      const r = await updateMemberPermission(businessId, uid, menu, level) as { level: PermissionLevel; explicit: boolean };
      setRows(prev => prev.map(x => x.user_id === uid
        ? { ...x, menus: { ...x.menus, [menu]: r.level }, explicit: { ...(x.explicit || {}), [menu]: r.explicit } } : x));
      flash(`${uid}:${menu}`);
      emitPermissionsChanged(businessId);
      onChanged?.();
    } catch (e) { setError((e as Error).message); }
  };

  // 워크스페이스 «멤버 기본 권한» — 따로 정하지 않은 멤버 칸이 같이 바뀐다(서버가 정본이라 다시 읽는다)
  const onDefault = async (menu: MenuKey, level: PermissionLevel | 'default') => {
    try {
      const r = await updateMemberDefault(businessId, menu, level);
      setDefaults(r.member_defaults);
      flash(`default:${menu}`);
      await load(true);
      emitPermissionsChanged(businessId);
      onChanged?.();
    } catch (e) { setError((e as Error).message); }
  };

  const onRole = async (uid: number, newRole: 'admin' | 'member') => {
    const target = rows.find(r => r.user_id === uid);
    if (!target) return;
    if (newRole === 'admin') {
      // 관리자 임명은 ConfirmDialog (window.confirm 금지)
      setPromoteTarget(target);
      return;
    }
    // 강등도 묻는다(0-J) — 누르는 즉시 그 사람의 관리 권한이 사라졌다.
    setDemoteTarget(target);
  };

  const confirmDemote = async () => {
    const target = demoteTarget;
    setDemoteTarget(null);
    if (!target) return;
    try {
      await updateMemberRole(businessId, target.user_id, 'member');
      await load();
      emitPermissionsChanged(businessId);
      onChanged?.();
    } catch (e) { setError((e as Error).message); }
  };

  const confirmPromote = async () => {
    if (!promoteTarget) return;
    try {
      await updateMemberRole(businessId, promoteTarget.user_id, 'admin');
      setPromoteTarget(null);
      await load();
      emitPermissionsChanged(businessId);
      onChanged?.();
    } catch (e) {
      setError((e as Error).message);
      setPromoteTarget(null);
    }
  };

  if (loading) return <Empty>{t('matrix.loading', 'Loading...')}</Empty>;

  return (
    <Card>
      <Header>
        <Title>{t('matrix.title')}</Title>
        <Desc>{t('matrix.desc')}</Desc>
      </Header>
      {!isOwner && <OwnerHint>{t('matrix.ownerOnlyHint', '워크스페이스 owner 만 변경할 수 있습니다.')}</OwnerHint>}
      {error && <ErrorMsg>{error}</ErrorMsg>}
      <TableWrap>
        <Table>
          <thead>
            <tr>
              <Th $sticky>{t('matrix.col.member', '멤버')}</Th>
              <Th>{t('matrix.col.role', '역할')}</Th>
              {MENU_LIST.map(m => (
                <Th key={m}>
                  <ThStack>
                    <span>{t(`menu.${m}`, m)}</span>
                    <CountChip title={t('matrix.writableCount', '쓰기 가능 인원') as string}>{writeCounts[m]}</CountChip>
                  </ThStack>
                </Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {defaults && (
              <DefaultsTr data-testid="perm-defaults-row">
                <Td $sticky $tint>
                  <MemberName>{t('matrix.defaultsRow', '멤버 기본값')}</MemberName>
                  <MemberEmail>{t('matrix.defaultsRowHint', '따로 정하지 않은 멤버에게 바로 적용')}</MemberEmail>
                </Td>
                <Td $tint><RoleBadge $kind="member">{t('role.member', '멤버')}</RoleBadge></Td>
                {MENU_LIST.map(m => (
                  <Td key={m} $tint>
                    <MenuLevelPicker menu={m} value={defaults[m]} disabled={!isOwner}
                      saved={savedKey === `default:${m}`} onChange={(v) => onDefault(m, v)} testId={`perm-default-${m}`} />
                  </Td>
                ))}
              </DefaultsTr>
            )}
            {rows.map(r => (
              <tr key={r.user_id}>
                <Td $sticky>
                  <MemberName>{r.name}</MemberName>
                  <MemberEmail>{r.email}</MemberEmail>
                </Td>
                <Td>
                  {r.role === 'owner' ? (
                    <RoleBadge $kind="owner">{t('role.owner', '오너')}</RoleBadge>
                  ) : r.role === 'admin' ? (
                    <RoleRow>
                      <RoleBadge $kind="admin">{t('role.admin', '관리자')}</RoleBadge>
                      {isOwner && <SmallBtn $kind="demote" type="button" onClick={() => onRole(r.user_id, 'member')}>{t('role.demote', '멤버로')}</SmallBtn>}
                    </RoleRow>
                  ) : (
                    <RoleRow>
                      <RoleBadge $kind="member">{t('role.member', '멤버')}</RoleBadge>
                      {isOwner && <SmallBtn $kind="promote" type="button" onClick={() => onRole(r.user_id, 'admin')}>{t('role.promote', '관리자로')}</SmallBtn>}
                    </RoleRow>
                  )}
                </Td>
                {MENU_LIST.map(m => {
                  const lockedFull = r.role === 'owner' || r.role === 'admin';
                  const cellKey = `${r.user_id}:${m}`;
                  return (
                    <Td key={m}>
                      {lockedFull ? (
                        <LevelLocked title={t('matrix.lockedHint', '오너·관리자는 항상 전권입니다') as string}>{t('level.write', '쓰기')}</LevelLocked>
                      ) : (
                        <MenuLevelPicker menu={m} value={r.menus[m]} explicit={!!r.explicit?.[m]}
                          defaultLevel={defaults?.[m]} disabled={!isOwner} saved={savedKey === cellKey}
                          onChange={(v) => onLevel(r.user_id, m, v)} />
                      )}
                    </Td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </Table>
      </TableWrap>
      {writeCounts.qbill === 0 && (
        <Warn>{t('matrix.warnNoQbillWrite', '⚠ Q Bill 쓰기 권한자가 없습니다. 청구서 발행이 불가합니다 — 최소 1명 권장.')}</Warn>
      )}
      <ConfirmDialog
        isOpen={!!promoteTarget}
        onClose={() => setPromoteTarget(null)}
        onConfirm={confirmPromote}
        title={t('confirm.promoteAdminTitle', '관리자 임명') as string}
        message={t('confirm.promoteAdmin', { name: promoteTarget?.name || '', defaultValue: `${promoteTarget?.name || ''} 을(를) 관리자로 임명할까요? 관리자는 인사·결제·세금계산서 외 거의 모든 권한을 가집니다.` }) as string}
        confirmText={t('role.promote', '관리자로') as string}
        cancelText={t('common:cancel', '취소') as string}
        variant="warning"
      />
      <ConfirmDialog
        isOpen={!!demoteTarget}
        onClose={() => setDemoteTarget(null)}
        onConfirm={confirmDemote}
        title={t('confirm.demoteAdminTitle', '멤버로 변경') as string}
        message={t('confirm.demoteAdmin', { name: demoteTarget?.name || '', defaultValue: '{{name}} 의 관리자 권한을 거둘까요? 메뉴 권한은 이 표의 설정을 따르게 됩니다.' }) as string}
        confirmText={t('role.demote', '멤버로') as string}
        cancelText={t('common:cancel', '취소') as string}
        variant="warning"
      />
    </Card>
  );
};

export default MemberPermissionMatrix;

// ─── styled ───
const Card = styled.div`
  background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 12px;
  padding: 20px 24px; margin-top: 16px;
`;
const Header = styled.div` margin-bottom: 12px; `;
const Title = styled.h3` margin: 0 0 4px; font-size: 1rem; font-weight: 700; color: #0F172A; `;
const Desc = styled.p` margin: 0; font-size: 0.8125rem; color: #64748B; line-height: 1.5; `;
const OwnerHint = styled.div`
  background: #FFFBEB; border: 1px solid #FDE68A; color: #92400E;
  padding: 8px 12px; border-radius: 8px; font-size: 0.75rem;
  margin-bottom: 10px;
`;
const ErrorMsg = styled.div`
  background: #FEE2E2; color: #B91C1C; padding: 8px 12px;
  border-radius: 8px; font-size: 0.75rem; margin-bottom: 10px;
`;
const Empty = styled.div` padding: 40px; text-align: center; color: #94A3B8; font-size: 0.8125rem; `;
const TableWrap = styled.div`
  overflow-x: auto;
  border: 1px solid #E2E8F0; border-radius: 10px;
  background: #FFFFFF;
`;
const Table = styled.table` width: 100%; border-collapse: collapse; font-size: 0.75rem; `;
const Th = styled.th<{ $sticky?: boolean }>`
  text-align: left; padding: 12px 14px;
  font-size: 0.75rem; font-weight: 700; color: #475569;
  background: #F8FAFC;
  border-bottom: 1px solid #E2E8F0;
  white-space: nowrap;
  letter-spacing: -0.1px;
  ${p => p.$sticky && 'position: sticky; left: 0; z-index: 2; background: #F8FAFC; min-width: 160px;'}
`;
const ThStack = styled.div`
  display: inline-flex; align-items: center; gap: 6px;
  white-space: nowrap;
`;
const Td = styled.td<{ $sticky?: boolean; $tint?: boolean }>`
  padding: 12px 14px; border-bottom: 1px solid #F1F5F9; vertical-align: middle;
  white-space: nowrap;
  ${p => p.$tint && 'background: #F8FAFC; border-bottom-color: #E2E8F0;'}
  ${p => p.$sticky && `position: sticky; left: 0; background: ${p.$tint ? '#F8FAFC' : '#FFFFFF'}; z-index: 1; min-width: 160px;`}
`;
const MemberName = styled.div`
  font-size: 0.8125rem; font-weight: 600; color: #0F172A;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  max-width: 180px;
`;
const MemberEmail = styled.div`
  font-size: 0.6875rem; color: #94A3B8; margin-top: 2px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  max-width: 180px;
`;
const RoleBadge = styled.span<{ $kind: 'owner' | 'admin' | 'member' }>`
  display: inline-block; padding: 4px 10px;
  font-size: 0.6875rem; font-weight: 700; border-radius: 999px;
  white-space: nowrap;
  background: ${p => p.$kind === 'owner' ? '#F0FDFA' : p.$kind === 'admin' ? '#DBEAFE' : '#F1F5F9'};
  color: ${p => p.$kind === 'owner' ? '#0F766E' : p.$kind === 'admin' ? '#1E40AF' : '#64748B'};
`;
const RoleRow = styled.div`
  display: inline-flex; align-items: center; gap: 8px;
  white-space: nowrap;
`;
const SmallBtn = styled.button<{ $kind: 'promote' | 'demote' }>`
  background: transparent;
  border: 1px solid ${p => p.$kind === 'promote' ? '#14B8A6' : '#FCA5A5'};
  color: ${p => p.$kind === 'promote' ? '#0F766E' : '#B91C1C'};
  font-size: 0.6875rem; font-weight: 600; padding: 4px 10px; border-radius: 6px;
  cursor: pointer; white-space: nowrap;
  line-height: 1.4;
  &:hover { background: ${p => p.$kind === 'promote' ? '#F0FDFA' : '#FEF2F2'}; }
`;
const CountChip = styled.span`
  display: inline-block; background: #E0E7FF; color: #3730A3;
  font-size: 0.625rem; font-weight: 700; padding: 1px 6px; border-radius: 999px;
`;
const LevelLocked = styled.span` font-size: 0.75rem; color: #94A3B8; `;
// 기본값 줄 — 멤버 줄과 같은 칸 모양에 옅은 바탕만(표 맨 위 고정이 아니라 첫 줄)
const DefaultsTr = styled.tr``;
const Warn = styled.div`
  margin-top: 12px;
  background: #FEF2F2; border: 1px solid #FECACA; color: #991B1B;
  padding: 10px 12px; border-radius: 8px;
  font-size: 0.75rem; font-weight: 600;
`;
