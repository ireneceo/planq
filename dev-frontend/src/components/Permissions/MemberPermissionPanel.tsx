// MemberPermissionPanel — 멤버 상세 «권한» 절 (2026-10-23, docs/MEMBER_PERMISSION_GAPS_DESIGN.md D3 · Fable OK-WITH-CHANGES)
//
// Irene: *"멤버 권한은 멤버 상세에도 나오게 하거나 멤버 설정에도 나와서 동기화하거나 어떻게 더 보기 쉬운 ui로"*
// 설정 > 권한 표의 **그 사람 한 줄**을 세로로 보여 준다 — 같은 API·같은 칸(MenuLevelPicker)·같은 확인창 문구.
// 한쪽에서 바꾸면 PERMISSIONS_CHANGED_EVENT 로 다른 쪽이 다시 읽는다(다른 사람 창은 소켓 permissions:updated).
//
// 역할: 멤버 ↔ 관리자(admin)는 표와 같은 문(PUT role). 옛 상세의 «관리자» 옵션은 값이 owner 라 확인 없이 소유자 권한을
//   붙였다 — 임명 방향은 없앴고(소유권은 «소유권 이전» 하나), 이미 오너가 둘인 워크스페이스의 공동 오너를 멤버로 내리는 길만
//   오너에게 남긴다(PATCH owner→member · 마지막 오너 보호 409 그대로).
import React, { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import ConfirmDialog from '../Common/ConfirmDialog';
import { SegmentedToggle, SegmentedBtn } from '../Common/segmentedToggle';
import MenuLevelPicker, { MENU_LIST } from './MenuLevelPicker';
import {
  listMembersPermissions, updateMemberPermission, updateMemberRole, emitPermissionsChanged, PERMISSIONS_CHANGED_EVENT,
  type MemberPermissionRow, type MenuKey, type PermissionLevel,
} from '../../services/permissions';
import { updateMemberRole as updateOwnerRole } from '../../services/workspace';

interface Props {
  businessId: number;
  userId: number;
  /** business_members.id — 공동 오너 내리기(PATCH)가 이 키를 쓴다 */
  memberRowId: number;
  name: string;
  /** owner·admin — 서버 assertWorkspaceAdmin 과 같은 술어 */
  canEdit: boolean;
  /** 지금 보는 사람이 오너인가 — 공동 오너 내리기만 오너 몫 */
  actorIsOwner: boolean;
  isSelf: boolean;
  onRoleChanged?: () => void;
}

const MemberPermissionPanel: React.FC<Props> = ({ businessId, userId, memberRowId, name, canEdit, actorIsOwner, isSelf, onRoleChanged }) => {
  const { t } = useTranslation('settings');
  const [row, setRow] = useState<MemberPermissionRow | null>(null);
  const [defaults, setDefaults] = useState<Record<MenuKey, PermissionLevel> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | 'promote' | 'demote' | 'demoteOwner'>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await listMembersPermissions(businessId);
      setRow(r.members.find((m) => Number(m.user_id) === Number(userId)) || null);
      setDefaults(r.member_defaults || null);
      setError(null);
    } catch (e) { setError((e as Error).message); }
  }, [businessId, userId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const on = (ev: Event) => {
      if (Number((ev as CustomEvent<{ business_id?: number }>).detail?.business_id) === businessId) void load();
    };
    window.addEventListener(PERMISSIONS_CHANGED_EVENT, on);
    return () => window.removeEventListener(PERMISSIONS_CHANGED_EVENT, on);
  }, [businessId, load]);

  if (!row) return error ? <Err>{error}</Err> : null;

  const fullAccess = row.role === 'owner' || row.role === 'admin';
  const canChangeRole = canEdit && !isSelf && row.role !== 'owner';

  const onLevel = async (menu: MenuKey, level: PermissionLevel | 'default') => {
    try {
      const r = await updateMemberPermission(businessId, userId, menu, level) as { level: PermissionLevel; explicit: boolean };
      setRow((prev) => (prev ? { ...prev, menus: { ...prev.menus, [menu]: r.level }, explicit: { ...(prev.explicit || {}), [menu]: r.explicit } } : prev));
      setSavedKey(menu);
      window.setTimeout(() => setSavedKey((k) => (k === menu ? null : k)), 1500);
      emitPermissionsChanged(businessId);
    } catch (e) { setError((e as Error).message); }
  };

  const runConfirm = async () => {
    const kind = confirm;
    setConfirm(null);
    if (!kind) return;
    setBusy(true);
    try {
      if (kind === 'demoteOwner') await updateOwnerRole(businessId, memberRowId, 'member');
      else await updateMemberRole(businessId, userId, kind === 'promote' ? 'admin' : 'member');
      await load();
      emitPermissionsChanged(businessId);
      onRoleChanged?.();
    } catch (e) {
      const msg = (e as Error).message || '';
      setError(msg.includes('last_owner_protection') ? t('members.drawer.errLastOwner', '마지막 오너는 내릴 수 없습니다.') as string : msg);
    } finally { setBusy(false); }
  };

  return (
    <Wrap data-testid="member-permission-panel">
      <RoleLine>
        <Label>{t('members.drawer.role', '역할')}</Label>
        {row.role === 'owner' ? (
          <RoleRight>
            <RoleChip $kind="owner">{t('role.owner', '오너')}</RoleChip>
            {actorIsOwner && !isSelf && (
              <LinkBtn type="button" disabled={busy} onClick={() => setConfirm('demoteOwner')}>{t('role.demote', '멤버로')}</LinkBtn>
            )}
          </RoleRight>
        ) : canChangeRole ? (
          <SegmentedToggle role="radiogroup" aria-label={t('members.drawer.role', '역할') as string}>
            <SegmentedBtn type="button" $active={row.role === 'member'} aria-pressed={row.role === 'member'} disabled={busy}
              onClick={() => { if (row.role !== 'member') setConfirm('demote'); }}>{t('role.member', '멤버')}</SegmentedBtn>
            <SegmentedBtn type="button" $active={row.role === 'admin'} aria-pressed={row.role === 'admin'} disabled={busy}
              onClick={() => { if (row.role !== 'admin') setConfirm('promote'); }}>{t('role.admin', '관리자')}</SegmentedBtn>
          </SegmentedToggle>
        ) : (
          <RoleChip $kind={row.role === 'admin' ? 'admin' : 'member'}>{t(`role.${row.role === 'admin' ? 'admin' : 'member'}`)}</RoleChip>
        )}
      </RoleLine>

      {fullAccess ? (
        <Note>{t('memberPerm.fullAccess', '오너·관리자는 모든 메뉴를 쓸 수 있습니다. 메뉴별 권한은 «멤버» 역할에만 적용됩니다.')}</Note>
      ) : (
        <>
          <Note>{canEdit
            ? t('memberPerm.hint', '«기본값» 칸은 설정 > 권한의 멤버 기본값을 따릅니다. 바꾸면 이 멤버만 따로 정해집니다.')
            : t('memberPerm.selfHint', '관리자가 정한 내 메뉴 권한입니다.')}</Note>
          <Grid>
            {MENU_LIST.map((m) => (
              <React.Fragment key={m}>
                <MenuName>{t(`menu.${m}`, m)}</MenuName>
                <MenuLevelPicker menu={m} value={row.menus[m]} explicit={!!row.explicit?.[m]} defaultLevel={defaults?.[m]}
                  disabled={!canEdit} saved={savedKey === m} onChange={(v) => onLevel(m, v)} testId={`member-perm-${m}`} />
              </React.Fragment>
            ))}
          </Grid>
        </>
      )}
      {error && <Err>{error}</Err>}

      <ConfirmDialog
        isOpen={confirm === 'promote'}
        onClose={() => setConfirm(null)}
        onConfirm={runConfirm}
        title={t('confirm.promoteAdminTitle', '관리자 임명') as string}
        message={t('confirm.promoteAdmin', { name, defaultValue: '{{name}} 을(를) 관리자로 임명할까요? 관리자는 인사·결제·세금계산서 외 거의 모든 권한을 가집니다.' }) as string}
        confirmText={t('role.promote', '관리자로') as string}
        cancelText={t('common:cancel', '취소') as string}
        variant="warning"
      />
      <ConfirmDialog
        isOpen={confirm === 'demote'}
        onClose={() => setConfirm(null)}
        onConfirm={runConfirm}
        title={t('confirm.demoteAdminTitle', '멤버로 변경') as string}
        message={t('confirm.demoteAdmin', { name, defaultValue: '{{name}} 의 관리자 권한을 거둘까요? 메뉴 권한은 이 표의 설정을 따르게 됩니다.' }) as string}
        confirmText={t('role.demote', '멤버로') as string}
        cancelText={t('common:cancel', '취소') as string}
        variant="warning"
      />
      <ConfirmDialog
        isOpen={confirm === 'demoteOwner'}
        onClose={() => setConfirm(null)}
        onConfirm={runConfirm}
        title={t('memberPerm.demoteOwnerTitle', '공동 오너를 멤버로') as string}
        message={t('memberPerm.demoteOwner', { name, defaultValue: '{{name}} 의 오너 권한을 거두고 멤버로 바꿀까요? 재무·삭제 같은 오너 전용 작업을 더 할 수 없습니다.' }) as string}
        confirmText={t('role.demote', '멤버로') as string}
        cancelText={t('common:cancel', '취소') as string}
        variant="danger"
      />
    </Wrap>
  );
};

export default MemberPermissionPanel;

const Wrap = styled.div` display: flex; flex-direction: column; gap: 12px; `;
const RoleLine = styled.div` display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 36px; `;
const RoleRight = styled.div` display: inline-flex; align-items: center; gap: 10px; `;
const Label = styled.div` font-size: 0.75rem; color: #64748B; font-weight: 600; `;
const RoleChip = styled.span<{ $kind: 'owner' | 'admin' | 'member' }>`
  display: inline-flex; align-items: center; height: 24px; padding: 0 10px; border-radius: 999px;
  font-size: 0.75rem; font-weight: 700;
  background: ${(p) => (p.$kind === 'owner' ? '#F0FDFA' : p.$kind === 'admin' ? '#DBEAFE' : '#F1F5F9')};
  color: ${(p) => (p.$kind === 'owner' ? '#0F766E' : p.$kind === 'admin' ? '#1E40AF' : '#64748B')};
`;
const LinkBtn = styled.button`
  min-height: 32px; padding: 0 10px; border-radius: 6px; border: 1px solid #FCA5A5; background: #FFFFFF;
  color: #B91C1C; font-size: 0.75rem; font-weight: 600; cursor: pointer;
  &:hover { background: #FEF2F2; } &:disabled { opacity: 0.5; cursor: default; }
`;
const Note = styled.p` margin: 0; font-size: 0.75rem; color: #64748B; line-height: 1.5; `;
const Grid = styled.div`
  display: grid; grid-template-columns: minmax(96px, 1fr) minmax(120px, 160px); gap: 8px 12px; align-items: start;
`;
const MenuName = styled.div` font-size: 0.8125rem; color: #0F172A; font-weight: 500; line-height: 36px; `;
const Err = styled.div` background: #FEE2E2; color: #B91C1C; padding: 8px 12px; border-radius: 8px; font-size: 0.75rem; `;
