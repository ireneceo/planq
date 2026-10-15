// RoleManageModal — 워크스페이스 역할 사전 관리 (2026-10-15, docs/MEMBER_ROLES_DESIGN.md)
//   창은 공용 DictManageModal(태그 관리와 같은 것). 추가는 멤버 이상, 이름 변경·삭제는 owner/admin —
//   이름을 바꾸면 그 역할을 단 프로젝트 멤버·기본 역할이 함께 바뀌고, 지우면 그 칸이 비워진다.
import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import DictManageModal, { type DictAdapter } from '../Common/DictManageModal';
import { createMemberRole, deleteMemberRole, renameMemberRole, ROLE_MAX_LEN, type MemberRoleEntry } from './memberRoleApi';

interface Props {
  open: boolean;
  onClose: () => void;
  bizId: number | null | undefined;
  dict: MemberRoleEntry[];
  /** owner/admin — 이름 변경·삭제 */
  canManage: boolean;
  onChanged: () => void;
}

const RoleManageModal: React.FC<Props> = ({ open, onClose, bizId, dict, canManage, onChanged }) => {
  const { t } = useTranslation('common');
  const adapter = useMemo<DictAdapter<MemberRoleEntry>>(() => ({
    create: (name) => (bizId ? createMemberRole(Number(bizId), name) : Promise.resolve({ ok: false })),
    rename: (r, name) => renameMemberRole(r.id, name),
    remove: (r) => deleteMemberRole(r.id),
  }), [bizId]);

  return (
    <DictManageModal<MemberRoleEntry>
      open={open} onClose={onClose} dict={dict} adapter={adapter} onChanged={onChanged}
      canManage={canManage} maxLength={ROLE_MAX_LEN} testId="role-manage"
      texts={{
        title: t('memberRoles.manageTitle', '역할 관리') as string,
        newPh: t('memberRoles.newPh', '새 역할 이름') as string,
        empty: t('memberRoles.empty', '아직 역할이 없습니다.') as string,
        usage: (r) => t('memberRoles.usage', '프로젝트 {{project}} · 기본 {{def}}', {
          project: r.usage_project ?? 0, def: r.usage_default ?? 0,
        }) as string,
        deleteConfirm: (r) => t('memberRoles.deleteConfirm', '“{{name}}” 역할을 삭제할까요? 프로젝트 멤버 {{project}}명·기본 역할 {{def}}명의 역할이 비워집니다.', {
          name: r.name, project: r.usage_project ?? 0, def: r.usage_default ?? 0,
        }) as string,
        createFailed: t('memberRoles.createFailed', '역할을 만들지 못했습니다') as string,
        renameFailed: t('memberRoles.renameFailed', '이름을 바꾸지 못했습니다') as string,
        deleteFailed: t('memberRoles.deleteFailed', '삭제하지 못했습니다') as string,
      }} />
  );
};

export default RoleManageModal;
