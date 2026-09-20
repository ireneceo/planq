// 좌측 트리의 **행 한 줄** — Q file(ProjectGroups)과 프로젝트>파일(FolderTree)이 같이 쓴다.
//
// ★ 2026-09-20 (Irene: *"이런 건 고치면 양쪽 다 제대로 통일해. 왜 각각 고쳐?
//   프로젝트 > 파일 이랑 Q file은 같은 컴포넌트 아니야?"*) — 맞다. 파일 목록·드래그·이동은
//   DocsTab 하나라 한 번 고치면 양쪽에 먹는다. **트리만** 두 벌이었고, 그래서 한쪽에는 [+] 가
//   있고 다른 쪽에는 ⋯ 만 있는 상태로 갈라져 있었다(숫자와 액션이 겹치는 결함도 한쪽에서만 났다).
//   → 행의 «구조»(아이콘 칸 · 이름 · 숫자 · 겹쳐 뜨는 액션)를 여기 한 곳에 둔다.
//     양쪽은 아이콘과 액션 «내용» 만 넣는다.
import React from 'react';
import { FolderRow, FolderName, FolderCount, FolderActions } from './treeStyles';

export interface TreeRowProps {
  selected?: boolean;
  dropOver?: boolean;
  /** 들여쓰기 단계(0 = 최상단). 최상단 기준선은 한 곳에서 정한다. */
  depth?: number;
  icon: React.ReactNode;
  /** 이름 칸. 문자열이면 표준 이름 스타일로 감싼다. 편집 중 input 같은 노드도 받는다. */
  name: React.ReactNode;
  title?: string;
  count?: number;
  /** 겹쳐 뜨는 액션. 넘기면 숫자가 물러나는 규칙이 같이 켜진다. */
  actions?: React.ReactNode;
  /** 액션을 늘 보인다(고른 행 등). 기본은 올렸을 때·고른 때. */
  actionsVisible?: boolean;
  testId?: string;
  ariaExpanded?: boolean;
  onClick?: (e: React.MouseEvent) => void;
  onDoubleClick?: (e: React.MouseEvent) => void;
  /** useFolderDrop 이 만든 드롭 핸들러 묶음 */
  dropProps?: Record<string, unknown>;
}

export const INDENT_PX = 18;
export const BASE_PAD_PX = 8;

const TreeRow: React.FC<TreeRowProps> = ({
  selected, dropOver, depth = 0, icon, name, title, count, actions, actionsVisible,
  testId, ariaExpanded, onClick, onDoubleClick, dropProps,
}) => (
  <FolderRow
    $selected={selected}
    $dropOver={dropOver}
    $actions={!!actions}
    data-testid={testId}
    aria-expanded={ariaExpanded}
    style={depth ? { paddingLeft: BASE_PAD_PX + depth * INDENT_PX } : undefined}
    onClick={onClick}
    onDoubleClick={onDoubleClick}
    {...(dropProps || {})}
  >
    {icon}
    {typeof name === 'string' ? <FolderName title={title || name}>{name}</FolderName> : name}
    {/* 0 은 그리지 않는다 — 빈 알약이 열만 차지한다. */}
    {typeof count === 'number' && count > 0 && <FolderCount data-folder-count>{count}</FolderCount>}
    {actions && (
      <FolderActions data-folder-actions $visible={actionsVisible} onClick={e => e.stopPropagation()}>
        {actions}
      </FolderActions>
    )}
  </FolderRow>
);

export default TreeRow;
