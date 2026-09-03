// 좌측 카테고리 트리 — Q info(KnowledgePage)와 프로젝트>정보(ProjectKnowledgeTab)가 **같은 한 벌**을 쓴다.
//
// 왜 뽑았나 (2026-09-03): Irene 이 프로젝트>정보에도 "카테고리를 좌측에" 요청했다.
//   KnowledgePage 안의 styled 를 복사해 넣으면 당장은 같아 보이지만 반드시 갈라진다 —
//   알림과 새 소식이 서로를 베껴 만들어져 아이콘·여백·폭이 전부 달라진 전례가 있다
//   (memory feedback_copied_component_drifts_extract_shell). 껍데기는 여기 한 곳에만 둔다.
//
// 화면 규격은 KnowledgePage 의 것을 그대로 옮긴 것이다(폭 220px · sticky top:0 · 900px 에서 1열).
//   ※ sticky top 은 0 이어야 한다. 옛 top:8px 는 패널 padding 과 겹쳐 안 붙는 회귀가 있었다
//     ("문서 길면 메뉴 따라가야 하는데 안 됨").
import React from 'react';
import styled from 'styled-components';

export interface CategoryTreeItem {
  key: string;
  label: string;
  count: number;
}

interface Props {
  // 전체 행은 아래 allLabel/allCount 로 따로 받는다 (items 에 넣지 않는다)
  items: CategoryTreeItem[];
  allLabel: string;
  allCount: number;
  active: string;                     // 'all' 또는 items[].key
  onSelect: (key: string) => void;
  /** 카테고리 행 오른쪽에 덧붙일 것 (예: Q info 의 카테고리 일괄 공유 버튼) */
  renderRowExtra?: (key: string) => React.ReactNode;
}

export const Split = styled.div`
  display: grid; grid-template-columns: 220px 1fr; gap: 12px; align-items: start;
  @media (max-width: 900px) { grid-template-columns: 1fr; }
`;
export const MainArea = styled.div`display: flex; flex-direction: column; gap: 10px; min-width: 0;`;

const TreePanel = styled.div`
  background: #fff; border: 1px solid #E2E8F0; border-radius: 10px; padding: 6px;
  position: sticky; top: 0;
  max-height: calc(100vh - 100px); overflow-y: auto;
  @media (max-width: 900px) { position: static; max-height: none; }
`;
const TreeRoot = styled.div`display: flex; flex-direction: column; gap: 1px;`;
const TreeDivider = styled.div`height: 1px; background: #F1F5F9; margin: 6px 0;`;
const TreeRow = styled.button<{ $selected?: boolean }>`
  display: grid; grid-template-columns: minmax(0, 1fr) auto;
  align-items: center; gap: 8px; padding: 6px 8px;
  background: ${p => p.$selected ? '#F0FDFA' : 'transparent'};
  color: ${p => p.$selected ? '#0F766E' : '#0F172A'};
  border: none; border-radius: 6px; cursor: pointer;
  min-height: 30px; text-align: left; width: 100%;
  &:hover { background: ${p => p.$selected ? '#F0FDFA' : '#F8FAFC'}; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: -2px; }
`;
const TreeName = styled.div`
  min-width: 0; font-size: 0.75rem; font-weight: 500;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
`;
const TreeCount = styled.span`
  font-size: 0.625rem; color: #94A3B8; font-weight: 600;
  min-width: 22px; padding: 1px 6px;
  background: #F1F5F9; border-radius: 999px;
  text-align: center; justify-self: end;
`;

const CategoryTree: React.FC<Props> = ({ items, allLabel, allCount, active, onSelect, renderRowExtra }) => (
  <TreePanel data-testid="category-tree">
    <TreeRoot>
      <TreeRow data-testid="category-tree-row" $selected={active === 'all'} onClick={() => onSelect('all')}>
        <TreeName>{allLabel}</TreeName>
        <TreeCount>{allCount}</TreeCount>
      </TreeRow>
      {items.length > 0 && <TreeDivider />}
      {items.map(it => (
        <TreeRow key={it.key} data-testid="category-tree-row" $selected={active === it.key} onClick={() => onSelect(it.key)}>
          <TreeName>{it.label}</TreeName>
          <TreeCount>{it.count}</TreeCount>
          {renderRowExtra?.(it.key)}
        </TreeRow>
      ))}
    </TreeRoot>
  </TreePanel>
);

export default CategoryTree;
