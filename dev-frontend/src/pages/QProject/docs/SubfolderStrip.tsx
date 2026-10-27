// 고른 폴더 안의 하위 폴더 — 오른쪽 파일 목록 위에 줄로 보여 준다 (운영 #468, 2026-10-27).
//   «상위 폴더 안에 하위 폴더를 만들어도 목록에 표시되지 않음» — 하위 폴더는 좌측 트리에만 있었고,
//   상위 폴더를 열면 오른쪽은 «아직 파일이 없어요» 였다. 누르면 그 폴더를 연다(트리를 누른 것과 같은 선택).
//   Q file·프로젝트>파일이 같은 DocsTab 이라 둘 다 같이 보인다.
import styled from 'styled-components';
import type { FileFolder } from '../../../services/files';
import { FolderSvg } from './treeIcons';

interface Props {
  folders: FileFolder[];
  parentId: number;
  counts: Record<number, number>;
  onOpen: (id: number) => void;
  tr: (k: string, fb?: string) => string;
}

export function childFoldersOf(folders: FileFolder[], parentId: number): FileFolder[] {
  return folders.filter(f => f.parent_id === parentId).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
}

export default function SubfolderStrip({ folders, parentId, counts, onOpen, tr }: Props) {
  const children = childFoldersOf(folders, parentId);
  if (children.length === 0) return null;
  return (
    <Strip data-testid="docs-subfolder-strip" aria-label={tr('docs.folder.subfolders', '하위 폴더')}>
      {children.map(f => (
        <Chip key={f.id} type="button" data-testid={`docs-subfolder-open-${f.id}`} onClick={() => onOpen(f.id)} title={f.name}>
          <Icon><FolderSvg /></Icon>
          <Name>{f.name}</Name>
          {(counts[f.id] || 0) > 0 && <Count>{counts[f.id]}</Count>}
        </Chip>
      ))}
    </Strip>
  );
}

const Strip = styled.div`
  display: flex; flex-wrap: wrap; gap: 8px;
  margin-bottom: 12px;
`;
const Chip = styled.button`
  display: inline-flex; align-items: center; gap: 8px;
  max-width: 260px; min-height: 36px; padding: 6px 12px;
  background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 8px;
  font: inherit; font-size: 0.8125rem; font-weight: 600; color: #0F172A;
  cursor: pointer;
  &:hover { border-color: #14B8A6; background: #F0FDFA; }
  &:focus-visible { outline: 2px solid rgba(20,184,166,0.3); outline-offset: 2px; }
  @media (max-width: 640px) { min-height: 44px; }
`;
const Icon = styled.span`display: inline-flex; color: #64748B; flex-shrink: 0;`;
const Name = styled.span`overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0;`;
const Count = styled.span`color: #94A3B8; font-weight: 500; flex-shrink: 0;`;
