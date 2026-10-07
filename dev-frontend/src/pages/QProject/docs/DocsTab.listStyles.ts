// DocsTab 목록 행 스타일 — DocsTab.tsx(동결 god-file)에서 동작 불변으로 옮겼다(2026-10-07).
//   값은 한 글자도 바꾸지 않았다. 목록 열 폭(LIST_COLS)은 머리줄과 행이 같은 값을 쓴다.
import styled from 'styled-components';

export const LIST_COLS = 'minmax(200px,3fr) minmax(140px,1.3fr) 80px 90px 100px 36px';
export const ListRow = styled.div<{ $selected?: boolean; $selectMode?: boolean }>`
  display:grid;
  grid-template-columns:${p => p.$selectMode ? `36px ${LIST_COLS}` : LIST_COLS};
  gap:8px;padding:10px 14px;align-items:center;cursor:pointer;
  border-bottom:1px solid #F1F5F9;background:${p => p.$selected ? '#F0FDFA' : 'transparent'};
  transition:opacity .15s;
  &[draggable="true"]{ cursor:grab; }
  &[draggable="true"]:active{ cursor:grabbing; }
  &[data-dragging="1"]{ opacity:.45; }
  &:last-child{border-bottom:none;}
  &:hover{background:${p => p.$selected ? '#F0FDFA' : '#F8FAFC'};}
`;
export const RowChk = styled.div`display:flex;justify-content:center;`;
export const RowName = styled.div`display:flex;align-items:center;gap:10px;min-width:0;`;
export const RowNameText = styled.div`font-size:0.8125rem;font-weight:600;color:#0F172A;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;`;
export const RowNameStack = styled.div`display:flex;flex-direction:column;min-width:0;flex:0 1 auto;`;
export const CardReason = styled.div`padding:0 10px;min-width:0;`;
export const UnmirrorTag = styled.span`
  flex-shrink:0; padding:1px 6px; border-radius:4px;
  background:#F1F5F9; color:#64748B; font-size:0.75rem; font-weight:600; white-space:nowrap;
`;
export const RowSrc = styled.div`display:flex;align-items:center;gap:6px;min-width:0;overflow:hidden;`;
export const RowCtx = styled.span`font-size:0.6875rem;color:#64748B;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;`;
export const RowSize = styled.div`font-size:0.75rem;color:#475569;`;
export const RowUp = styled.div`font-size:0.75rem;color:#475569;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`;
export const RowDate = styled.div`font-size:0.75rem;color:#64748B;`;
export const RowAct = styled.div`display:flex;justify-content:flex-end;align-items:center;gap:2px;`;
export const DlPct = styled.span`font-size:0.625rem;font-weight:700;color:#0D9488;min-width:26px;text-align:center;`;
