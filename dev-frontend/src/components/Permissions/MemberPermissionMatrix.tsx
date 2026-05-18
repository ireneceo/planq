// MemberPermissionMatrix — 멤버 메뉴 권한 매트릭스 (사이클 N+21)
//
// 9 메뉴 × 3 레벨 (none/read/write) — admin/member 매트릭스
// 인라인 dropdown 즉시 저장. role 변경 (member ↔ admin) 별도 버튼.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import PlanQSelect, { type PlanQSelectOption } from '../Common/PlanQSelect';
import ConfirmDialog from '../Common/ConfirmDialog';
import {
  listMembersPermissions, updateMemberPermission, updateMemberRole,
  type MemberPermissionRow, type MenuKey, type PermissionLevel,
} from '../../services/permissions';

// 사이드바 순서 그대로 (talk → mail → task → calendar → note → docs → info → file → bill → clients → insights)
// + weekly_team (사이클 N+26) — 워크스페이스 통합 주간보고 보기 권한 (default 'none')
const MENU_LIST: MenuKey[] = ['qtalk', 'qmail', 'qtask', 'qcalendar', 'qnote', 'qdocs', 'qinfo', 'qfile', 'qbill', 'clients', 'insights', 'weekly_team'];
const LEVEL_LIST: PermissionLevel[] = ['write', 'read', 'none'];
// insights / weekly_team 은 조회 전용 — write 옵션 X
const READ_ONLY_MENUS = new Set<MenuKey>(['insights', 'weekly_team']);
const levelOptionsFor = (m: MenuKey): PermissionLevel[] => READ_ONLY_MENUS.has(m) ? ['read', 'none'] : LEVEL_LIST;

interface Props { businessId: number; isOwner: boolean; onChanged?: () => void; }

const MemberPermissionMatrix: React.FC<Props> = ({ businessId, isOwner, onChanged }) => {
  const { t } = useTranslation('settings');
  const [rows, setRows] = useState<MemberPermissionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [promoteTarget, setPromoteTarget] = useState<MemberPermissionRow | null>(null);

  const flash = useCallback((k: string) => {
    setSavedKey(k);
    setTimeout(() => setSavedKey((cur) => cur === k ? null : cur), 1500);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await listMembersPermissions(businessId);
      setRows(r.members);
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, [businessId]);

  useEffect(() => { load(); }, [load]);

  const writeCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const m of MENU_LIST) {
      c[m] = rows.filter(r => r.role === 'owner' || r.role === 'admin' || r.menus[m] === 'write').length;
    }
    return c;
  }, [rows]);

  const onLevel = async (uid: number, menu: MenuKey, level: PermissionLevel) => {
    try {
      await updateMemberPermission(businessId, uid, menu, level);
      setRows(prev => prev.map(r => r.user_id === uid ? { ...r, menus: { ...r.menus, [menu]: level } } : r));
      flash(`${uid}:${menu}`);
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
    try {
      await updateMemberRole(businessId, uid, newRole);
      await load();
      onChanged?.();
    } catch (e) { setError((e as Error).message); }
  };

  const confirmPromote = async () => {
    if (!promoteTarget) return;
    try {
      await updateMemberRole(businessId, promoteTarget.user_id, 'admin');
      setPromoteTarget(null);
      await load();
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
                        <LevelLocked>write</LevelLocked>
                      ) : (
                        <LevelPickerCell $saved={savedKey === cellKey}>
                          <PlanQSelect
                            size="sm"
                            isDisabled={!isOwner}
                            value={{ value: r.menus[m] || 'write', label: t(`level.${r.menus[m] || 'write'}`, r.menus[m] || 'write') as string }}
                            options={levelOptionsFor(m).map(l => ({ value: l, label: t(`level.${l}`, l) as string }))}
                            onChange={(opt) => {
                              const v = (opt as PlanQSelectOption)?.value as PermissionLevel;
                              if (v && v !== r.menus[m]) onLevel(r.user_id, m, v);
                            }}
                          />
                        </LevelPickerCell>
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
        cancelText={t('common.cancel', '취소') as string}
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
const Title = styled.h3` margin: 0 0 4px; font-size: 16px; font-weight: 700; color: #0F172A; `;
const Desc = styled.p` margin: 0; font-size: 13px; color: #64748B; line-height: 1.5; `;
const OwnerHint = styled.div`
  background: #FFFBEB; border: 1px solid #FDE68A; color: #92400E;
  padding: 8px 12px; border-radius: 8px; font-size: 12px;
  margin-bottom: 10px;
`;
const ErrorMsg = styled.div`
  background: #FEE2E2; color: #B91C1C; padding: 8px 12px;
  border-radius: 8px; font-size: 12px; margin-bottom: 10px;
`;
const Empty = styled.div` padding: 40px; text-align: center; color: #94A3B8; font-size: 13px; `;
const TableWrap = styled.div`
  overflow-x: auto;
  border: 1px solid #E2E8F0; border-radius: 10px;
  background: #FFFFFF;
`;
const Table = styled.table` width: 100%; border-collapse: collapse; font-size: 12px; `;
const Th = styled.th<{ $sticky?: boolean }>`
  text-align: left; padding: 12px 14px;
  font-size: 12px; font-weight: 700; color: #475569;
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
const Td = styled.td<{ $sticky?: boolean }>`
  padding: 12px 14px; border-bottom: 1px solid #F1F5F9; vertical-align: middle;
  white-space: nowrap;
  ${p => p.$sticky && 'position: sticky; left: 0; background: #FFFFFF; z-index: 1; min-width: 160px;'}
`;
const MemberName = styled.div`
  font-size: 13px; font-weight: 600; color: #0F172A;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  max-width: 180px;
`;
const MemberEmail = styled.div`
  font-size: 11px; color: #94A3B8; margin-top: 2px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  max-width: 180px;
`;
const RoleBadge = styled.span<{ $kind: 'owner' | 'admin' | 'member' }>`
  display: inline-block; padding: 4px 10px;
  font-size: 11px; font-weight: 700; border-radius: 999px;
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
  font-size: 11px; font-weight: 600; padding: 4px 10px; border-radius: 6px;
  cursor: pointer; white-space: nowrap;
  line-height: 1.4;
  &:hover { background: ${p => p.$kind === 'promote' ? '#F0FDFA' : '#FEF2F2'}; }
`;
const CountChip = styled.span`
  display: inline-block; background: #E0E7FF; color: #3730A3;
  font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 999px;
`;
const LevelLocked = styled.span` font-size: 11px; color: #94A3B8; font-style: italic; `;
const LevelPickerCell = styled.div<{ $saved: boolean }>`
  position: relative; min-width: 96px;
  ${p => p.$saved && `
    &::after {
      content: '✓'; position: absolute; right: -18px; top: 50%;
      transform: translateY(-50%);
      color: #14B8A6; font-weight: 700;
      animation: pqFadeSaved 1.5s ease forwards;
    }
    @keyframes pqFadeSaved { 0% { opacity: 1; } 75% { opacity: 1; } 100% { opacity: 0; } }
  `}
`;
const Warn = styled.div`
  margin-top: 12px;
  background: #FEF2F2; border: 1px solid #FECACA; color: #991B1B;
  padding: 10px 12px; border-radius: 8px;
  font-size: 12px; font-weight: 600;
`;
