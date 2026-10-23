// MenuLevelPicker — 멤버 메뉴 권한 한 칸 (2026-10-23, docs/MEMBER_PERMISSION_GAPS_DESIGN.md D2·D3)
//
// 설정 > 권한 표와 멤버 상세 «권한» 절이 **같은 칸**을 쓴다 — 두 화면이 각자 셀렉트를 그리면 옵션·문구·«기본값» 표시가 갈라진다.
// 칸이 «따로 정함» 이 아니면 워크스페이스 «멤버 기본 권한» 을 따른다는 표시(기본값)를 붙이고,
// 따로 정한 칸에는 «기본값으로 되돌리기» 옵션을 준다(서버는 행을 지운다).
import React from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import PlanQSelect, { type PlanQSelectOption } from '../Common/PlanQSelect';
import type { MenuKey, PermissionLevel } from '../../services/permissions';

// 사이드바 순서 그대로 + weekly_team(통합 주간보고 보기). 'clients' 는 2026-10-16 폐지(qsale)
export const MENU_LIST: MenuKey[] = ['qtalk', 'qmail', 'qsale', 'qtask', 'qcalendar', 'qnote', 'qdocs', 'qinfo', 'qfile', 'qbill', 'insights', 'weekly_team'];
// insights / weekly_team 은 조회 전용 — write 옵션 없음(서버 READ_ONLY_MENUS 와 같은 목록)
export const READ_ONLY_MENUS = new Set<MenuKey>(['insights', 'weekly_team']);
const LEVEL_LIST: PermissionLevel[] = ['write', 'read', 'none'];
export const levelOptionsFor = (m: MenuKey): PermissionLevel[] => (READ_ONLY_MENUS.has(m) ? ['read', 'none'] : LEVEL_LIST);

interface Props {
  menu: MenuKey;
  value: PermissionLevel;
  /** 멤버 칸이면 그 칸이 따로 정해졌는가. 기본값 줄 자체면 undefined */
  explicit?: boolean;
  /** 따로 정하지 않았을 때 따르는 값 — «기본값으로 (쓰기)» 문구에 쓴다 */
  defaultLevel?: PermissionLevel;
  disabled?: boolean;
  saved?: boolean;
  onChange: (level: PermissionLevel | 'default') => void;
  testId?: string;
}

const MenuLevelPicker: React.FC<Props> = ({ menu, value, explicit, defaultLevel, disabled, saved, onChange, testId }) => {
  const { t } = useTranslation('settings');
  const label = (l: PermissionLevel) => t(`level.${l}`, l) as string;
  const options: PlanQSelectOption[] = levelOptionsFor(menu).map((l) => ({ value: l, label: label(l) }));
  if (explicit && defaultLevel) {
    options.push({ value: 'default', label: t('matrix.resetToDefault', { level: label(defaultLevel), defaultValue: '기본값으로 ({{level}})' }) as string });
  }
  const isMemberCell = explicit !== undefined;
  return (
    <Cell $saved={!!saved} data-testid={testId}>
      <PlanQSelect
        size="sm"
        isDisabled={disabled}
        value={{ value, label: label(value) }}
        options={options}
        onChange={(opt) => {
          const v = (opt as PlanQSelectOption | null)?.value as PermissionLevel | 'default' | undefined;
          if (!v) return;
          if (v === 'default' || v !== value || (isMemberCell && !explicit)) onChange(v);
        }}
      />
      {isMemberCell && !explicit && <DefaultTag title={t('matrix.defaultTagHint', '따로 정하지 않아 워크스페이스 기본값을 따릅니다') as string}>{t('matrix.defaultTag', '기본값')}</DefaultTag>}
    </Cell>
  );
};

export default MenuLevelPicker;

// 저장 표시는 표의 옛 칸과 같은 ✓ 페이드(성공 토스트 금지 — 칸이 말한다)
const Cell = styled.div<{ $saved: boolean }>`
  position: relative; display: flex; flex-direction: column; align-items: stretch; gap: 2px; min-width: 96px;
  ${(p) => p.$saved && `
    &::after {
      content: '✓'; position: absolute; right: -16px; top: 9px;
      color: #14B8A6; font-weight: 700;
      animation: pqFadeSaved 1.5s ease forwards;
    }
    @keyframes pqFadeSaved { 0% { opacity: 1; } 75% { opacity: 1; } 100% { opacity: 0; } }
  `}
`;
const DefaultTag = styled.span`
  align-self: flex-start; font-size: 0.6875rem; color: #94A3B8; line-height: 1.3; padding-left: 2px;
`;
