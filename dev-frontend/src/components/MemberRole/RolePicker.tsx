// RolePicker — 멤버 역할 고르기 + 그 자리에서 새 역할 추가 (2026-10-15, docs/MEMBER_ROLES_DESIGN.md)
//
//   역할은 워크스페이스 사전에서 고른다(자유 입력 아님). 사전에 없으면 여기서 바로 만든다 — 만든 역할은
//   사전에 생기므로 설정·다른 프로젝트·새 프로젝트 창에도 곧바로 보인다(Irene «각각 UI 에서 동기화»).
//   껍데기는 PlanQSelect creatable(태그 TagPicker 와 같은 것) — 단일 선택이라는 점만 다르다.
//   사전에 없는 옛 글자가 값이면 그대로 보여 준다(지워진 것처럼 보이면 안 된다).
import React, { useMemo, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import PlanQSelect from '../Common/PlanQSelect';
import { createMemberRole, type MemberRoleEntry } from './memberRoleApi';

const MANAGE = '__manage_roles__';

interface Props {
  bizId: number | null | undefined;
  dict: MemberRoleEntry[];
  value: string | null | undefined;
  /** 고른 역할(비우면 null) */
  onChange: (name: string | null) => void;
  /** 새로 만든 역할을 호출측 사전에 즉시 반영 */
  onDictAdd?: (entry: MemberRoleEntry) => void;
  /** 주면 목록 끝에 «역할 관리…» 가 생겨 관리창을 연다(owner/admin) */
  onManage?: () => void;
  disabled?: boolean;
  size?: 'sm' | 'md';
  variant?: 'box' | 'inline';
  placeholder?: string;
  testId?: string;
}

const RolePicker: React.FC<Props> = ({
  bizId, dict, value, onChange, onDictAdd, onManage, disabled, size = 'sm', variant, placeholder, testId,
}) => {
  const { t } = useTranslation('common');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const options = useMemo(() => {
    const list = dict.map((r) => ({ value: r.name, label: r.name }));
    if (value && !dict.some((r) => r.name.toLowerCase() === value.toLowerCase())) list.unshift({ value, label: value });
    if (onManage) list.push({ value: MANAGE, label: t('memberRoles.manageOpen', '역할 관리…') as string });
    return list;
  }, [dict, value, onManage, t]);

  const create = async (input: string) => {
    if (!bizId || busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await createMemberRole(Number(bizId), input);
      if (!r.ok || !r.data) { setErr(r.message || (t('memberRoles.createFailed', '역할을 만들지 못했습니다') as string)); return; }
      onDictAdd?.(r.data);
      onChange(r.data.name);
    } finally { setBusy(false); }
  };

  return (
    <Wrap data-testid={testId}>
      <PlanQSelect size={size} variant={variant} isClearable creatable
        isDisabled={disabled || busy} isLoading={busy}
        placeholder={placeholder || (t('memberRoles.pickPh', '역할 선택') as string)}
        value={value ? { value, label: value } : null}
        onChange={(v) => {
          const o = v as { value: string } | null;
          if (o?.value === MANAGE) { onManage?.(); return; }
          setErr(null);
          onChange(o?.value || null);
        }}
        onCreateOption={(input: string) => { void create(input); }}
        formatCreateLabel={(input: string) => t('memberRoles.createNamed', { defaultValue: '\'{{name}}\' 역할 추가', name: input }) as string}
        options={options} />
      {err && <ErrText role="alert">{err}</ErrText>}
    </Wrap>
  );
};

export default RolePicker;

const Wrap = styled.div`min-width: 0;`;
const ErrText = styled.div`margin-top: 4px; font-size: 0.6875rem; color: #DC2626;`;
