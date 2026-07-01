// 프로젝트 자료 탭 공용 레이아웃 (파일 탭 · 문서 탭 통일).
//   파일 탭(DocsTab)에서 검증된 레이아웃 styled 를 단일 원천으로 공유 — 두 탭의 디자인이
//   literally 동일해지고(같은 컴포넌트), 앞으로도 어긋나지 않게 한 곳에서 관리.
//   상단 툴바(Toolbar) + Split(좌 폴더/카테고리 패널 | 우 카드 영역) + 카드 그리드.
import styled from 'styled-components';

// ── 상단 툴바 ──
export const Toolbar = styled.div`
  display:flex;align-items:center;gap:8px;flex-wrap:wrap;
  padding:0;
`;
export const SortWrap = styled.div`width:130px;`;

// ── Split (좌 220 패널 | 우 영역) ──
export const Split = styled.div`
  display:grid;grid-template-columns:220px 1fr;gap:12px;align-items:start;
  @media (max-width: 900px){ grid-template-columns:1fr; }
`;
export const FolderTreePanel = styled.div`
  background:#fff;border:1px solid #E2E8F0;border-radius:10px;padding:6px;
  position:sticky;top:8px;
  max-height:calc(100vh - 180px);overflow-y:auto;
  @media (max-width: 900px){ position:static;max-height:none; }
`;
export const FilesArea = styled.div`display:flex;flex-direction:column;gap:10px;min-width:0;`;

// ── 좌측 폴더/카테고리 행 ──
export const TreeRoot = styled.div`display:flex;flex-direction:column;gap:1px;`;
export const FolderRow = styled.div<{ $selected?: boolean }>`
  display:grid;
  grid-template-columns:auto minmax(0,1fr) auto auto;
  align-items:center;gap:8px;padding:6px 8px;border-radius:6px;cursor:pointer;min-height:30px;
  background:${p => p.$selected ? '#F0FDFA' : 'transparent'};
  color:${p => p.$selected ? '#0F766E' : '#0F172A'};
  &:hover{background:${p => p.$selected ? '#F0FDFA' : '#F8FAFC'};}
  &:focus-visible{outline:2px solid #14B8A6;outline-offset:-2px;}
`;
export const FolderName = styled.div`
  min-width:0;font-size:12px;font-weight:500;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
`;
export const FolderCount = styled.span`
  font-size:10px;color:#94A3B8;font-weight:600;
  min-width:22px;padding:1px 6px;background:#F1F5F9;border-radius:999px;
  text-align:center;justify-self:end;
`;

// ── 우측 카드 그리드 ──
export const Grid = styled.div`display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;`;
export const Card = styled.div<{ $selected?: boolean }>`
  position:relative;background:#fff;
  border:2px solid ${p => p.$selected ? '#14B8A6' : '#E2E8F0'};
  border-radius:10px;overflow:hidden;cursor:pointer;
  display:flex;flex-direction:column;transition:border-color .15s, box-shadow .15s;
  &:hover{border-color:#14B8A6;box-shadow:0 2px 8px rgba(20,184,166,.08);}
`;
// 문서 탭 카드는 우상단 핀 버튼(28px)을 얹으므로 오른쪽 여백만 확보 (파일 탭은 이 모듈을 쓰지 않아 영향 없음).
export const CardName = styled.div`padding:8px 34px 2px 10px;font-size:13px;font-weight:600;color:#0F172A;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`;
export const CardMeta = styled.div`padding:0 10px;font-size:11px;color:#64748B;display:flex;gap:4px;
  &:last-child{padding-bottom:10px;margin-top:2px;}
`;
