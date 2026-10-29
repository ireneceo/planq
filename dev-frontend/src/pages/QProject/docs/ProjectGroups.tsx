// Q file(워크스페이스 모드) 좌측 — 프로젝트 묶음 + 폴더 섹션.
// ★ 2026-10-23 DocsTab.tsx 에서 빼냈다(god-file 래칫 — 동작·값 그대로).
import React, { useMemo, useState } from 'react';
import { FolderSvg, FolderOpenSvg, AllSvg, MyFilesSvg, PlusSvg, SystemFolderIcon } from './treeIcons';
import { TreeRoot, TreeDivider, FolderIconWrap, RowPlusBtn, FolderName } from './treeStyles';
import TreeRow from './TreeRow';
import { StarGlyph } from '../../../components/Common/StarToggle';
import { starFirst } from '../../../utils/projectOrder';
import { sourceShortLabel } from './fileSource';
import type { FolderDropFn } from './folderDrop';
import OverflowMenu from '../../../components/Common/OverflowMenu';
import { useFolderEditing } from './useFolderEditing';
import type { FileFolder, FileSource, FolderDeleteOutcome } from '../../../services/files';
import type { FolderSel } from './folderSel';

// ─── 워크스페이스 모드: 프로젝트 그룹 ───

// ─── 폴더 드롭 존 ───
// 폴더 행이 여러 곳(프로젝트 루트 · 사용자 폴더 · 워크스페이스 트리)에 흩어져 있어
// 각자 손으로 쓰면 반드시 갈라진다. 한 훅으로 묶어 그대로 스프레드한다.
//   ★ 판정은 **전용 MIME** 으로만 한다 — text/plain 으로 받으면 브라우저 밖에서 끌어온
//     아무 텍스트나 "파일 이동" 으로 읽힌다.
interface ProjectGroupsProps {
  projectGroups: Array<{ id: number; name: string; color?: string | null; count: number }>;
  /** 내 즐겨찾기 프로젝트 — 별 먼저(그 안은 파일 수) · 이름 옆 작은 별 */
  pinnedIds?: Set<number>;
  /** 이 워크스페이스에 보이는 **프로젝트 폴더**(하위 포함). 프로젝트 행 아래로 펼쳐진다.
   *  ★ 2026-09-20 (Irene: *"좌측 카테고리에 왜 K-DINE이 두번 나오냐고"*) —
   *    처음엔 「폴더」 섹션에 프로젝트 묶음을 **따로** 그렸다. 그러면 프로젝트 목록에 한 번,
   *    폴더 섹션에 또 한 번, **같은 이름이 두 번** 나온다. 프로젝트는 한 줄이어야 하고
   *    폴더는 그 아래에 달려야 한다. */
  folders?: FileFolder[];
  folderCounts?: Record<number, number>;
  onSelectFolder?: (id: number) => void;
  /** 그 프로젝트 안에 폴더를 새로 만든다. 없으면 [+] 를 그리지 않는다. */
  onCreateFolder?: (projectId: number, parentId?: number | null) => void;
  /** 하위 폴더 행의 드롭 — FolderTree 와 **같은 훅**이 만든다(베끼면 한쪽만 고쳐진다). */
  folderDrop?: FolderDropFn;
  /** 하위 폴더 ⋯ 메뉴 — FolderTree 와 **같은 처리기**를 받는다(#417: 여태 [+] 뿐이라 이름을 못 바꾸고 못 지웠다). */
  onRenameFolder?: (id: number, name: string) => Promise<void>;
  onDeleteFolder?: (id: number, contents: 'move' | 'delete') => Promise<FolderDeleteOutcome | void>;
  /** 휴지통 보관 일수(요금제) — 폴더 삭제 확인창 문구 (0-D) */
  trashDays?: number | null;
  /** 하위 폴더까지 합한 파일 수 — 확인창이 묻는 숫자. 서버가 재귀로 지우므로 세는 것도 재귀다. */
  countDeep?: (id: number) => number;
  onDownloadFolder?: (id: number) => void | Promise<void>;
  /** 폴더 공유 링크(#469) — FolderTree 와 같은 처리기. 멤버에게만 넘긴다. */
  onShareFolder?: (f: FileFolder) => void;
  counts: { total: number; bySrc: Record<FileSource, number>; byFolder: Record<number, number>; directRoot: number; myFiles: number };
  total: number;
  selected: FolderSel;
  onSelect: (sel: FolderSel) => void;
  tr: (k: string, fb?: string) => string;
}

const ProjectGroups: React.FC<ProjectGroupsProps> = ({ projectGroups, pinnedIds, counts, total, selected, onSelect, tr, folders = [], folderCounts = {}, onSelectFolder, onCreateFolder, folderDrop, onRenameFolder, onDeleteFolder, onDownloadFolder, onShareFolder, countDeep }) => {
  const [open, setOpen] = useState<Set<number>>(new Set());
  const { renamingId, startRename, renderName, setDeleteTarget, deleteModal } = useFolderEditing({ onRename: onRenameFolder, onDelete: onDeleteFolder, counts, countDeep, tr });
  const toggle = (id: number) => setOpen(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const foldersOf = (projectId: number, parentId: number | null) =>
    folders.filter(f => f.project_id === projectId && f.parent_id === parentId);
  /* 프로젝트 줄은 **파일 집계**에서 나온다. 그래서 «폴더는 만들었는데 아직 파일이 0개» 인
     프로젝트는 줄 자체가 없었고 — 그 안의 폴더로 들어갈 길도, 폴더를 더 만들 [+] 도 없었다.
     파일을 다 지우면 폴더가 통째로 숨는다는 뜻이기도 하다. 폴더가 있으면 줄을 세운다. */
  const groups = useMemo(() => {
    const seen = new Set(projectGroups.map(p => p.id));
    const extra: typeof projectGroups = [];
    for (const f of folders) {
      if (!f.project_id || seen.has(f.project_id) || !f.project_name) continue;
      seen.add(f.project_id);
      extra.push({ id: f.project_id, name: f.project_name, color: null, count: 0 });
    }
    const all = extra.length ? [...projectGroups, ...extra] : projectGroups;
    // 별 먼저 — 술어는 utils/projectOrder 한 벌(그 안은 지금 순서 = 파일 수)
    return starFirst(all.map(p => ({ ...p, my_pinned_at: pinnedIds?.has(p.id) ? 'y' : null })));
  }, [projectGroups, folders, pinnedIds]);
  const renderSub = (f: FileFolder, depth: number): React.ReactNode => (
    <React.Fragment key={f.id}>
      <TreeRow
        selected={selected === f.id}
        testId={`docs-subfolder-row-${f.id}`}
        dropOver={folderDrop ? folderDrop(f.id).over : undefined}
        flash={folderDrop ? folderDrop(f.id).flash : undefined}
        dropProps={folderDrop ? folderDrop(f.id).dropProps : undefined}
        depth={depth}
        icon={<FolderIconWrap $selected={selected === f.id}><FolderSvg /></FolderIconWrap>}
        name={renderName(f)}
        count={renamingId === f.id ? 0 : (folderCounts[f.id] || 0)}
        onClick={() => onSelectFolder && onSelectFolder(f.id)}
        actionsVisible={selected === f.id}
        actions={renamingId === f.id || !f.project_id ? undefined : (
          <>
            {onCreateFolder && (
              <RowPlusBtn type="button" data-testid={`docs-subfolder-new-${f.id}`}
                title={tr('docs.folder.newChildAction')} aria-label={tr('docs.folder.newChildAction')}
                onClick={() => onCreateFolder(f.project_id as number, f.id)}>
                <PlusSvg size={13} />
              </RowPlusBtn>
            )}
            {/* FolderTree 의 ⋯ 와 같은 항목·같은 순서(순서 바꾸기는 프로젝트 폴더 정렬 라우트가 달라 뺀다) */}
            {(onRenameFolder || onDeleteFolder || onDownloadFolder || onShareFolder) && (
              <OverflowMenu
                label={tr('docs.folder.more')}
                data-testid={`docs-subfolder-menu-${f.id}`}
                items={[
                  ...(onCreateFolder ? [{ key: 'child', label: tr('docs.folder.newChild'), onClick: () => onCreateFolder(f.project_id as number, f.id) }] : []),
                  ...(onRenameFolder ? [{ key: 'rename', label: tr('docs.folder.rename'), onClick: () => startRename(f), testId: 'docs-subfolder-rename' }] : []),
                  ...(onDownloadFolder && (folderCounts[f.id] || 0) > 0
                    ? [{ key: 'dl', label: tr('docs.folder.downloadAll'), onClick: () => { void onDownloadFolder(f.id); }, testId: 'docs-subfolder-download' }]
                    : []),
                  ...(onShareFolder ? [{ key: 'share', label: tr('docs.folder.share'), onClick: () => onShareFolder(f), testId: 'docs-subfolder-share' }] : []),
                  ...(onDeleteFolder ? [{ key: 'del', label: tr('docs.folder.delete'), onClick: () => setDeleteTarget(f), danger: true, dividerBefore: true, testId: 'docs-subfolder-delete' }] : []),
                ]}
              />
            )}
          </>
        )}
      />
      {folders.filter(c => c.parent_id === f.id).map(c => renderSub(c, depth + 1))}
    </React.Fragment>
  );
  return (
    <TreeRoot>
      <TreeRow selected={selected === 'all'} onClick={() => onSelect('all')}
        icon={<FolderIconWrap $selected={selected === 'all'}><AllSvg /></FolderIconWrap>}
        name={tr('docs.folder.all', '전체')} count={total} />
      {/* testId — 업로드 카나리가 «목적지를 고른 상태» 를 만드는 손잡이(§17).
          목적지가 없으면 업로드가 아니라 프로젝트 선택 모달이 뜬다(handleFiles). */}
      <TreeRow selected={selected === 'my'} onClick={() => onSelect('my')} testId="docs-folder-my"
        icon={<FolderIconWrap $selected={selected === 'my'}><MyFilesSvg /></FolderIconWrap>}
        name={tr('docs.folder.my', '내 파일')} count={counts.myFiles} />
      <TreeDivider />
      {groups.map(p => {
        const key: FolderSel = `proj:${p.id}`;
        const sel = selected === key;
        const roots = foldersOf(p.id, null);
        const expanded = open.has(p.id);
        return (
          <React.Fragment key={p.id}>
            <TreeRow
              selected={sel}
              testId={`docs-project-row-${p.id}`}
              ariaExpanded={roots.length ? expanded : undefined}
              /* ★ 2026-09-20 (Irene: *"프로젝트 폴더 이름을 눌러서 선택할 때 하위도 열려야 할 것
                 같아. 자동으로. 폴더 아이콘 눌러야 하위 나오는 건 모를 것 같아"*) —
                 이름을 누르면 **고르고 동시에 펼친다.** 아이콘은 **접을 때** 쓴다. */
              onClick={() => { onSelect(key); if (roots.length && !expanded) toggle(p.id); }}
              /* 아이콘 = 여닫는 손잡이. 프로젝트 색은 **아이콘 선**에 칠한다(동그라미를 따로 두지 않는다). */
              icon={(
                <FolderIconWrap $selected={sel} $tint={p.color || '#14B8A6'}
                  role={roots.length ? 'button' : undefined}
                  aria-label={roots.length ? (expanded ? tr('docs.folder.collapse') : tr('docs.folder.expand')) : undefined}
                  onClick={roots.length ? (e => { e.stopPropagation(); toggle(p.id); }) : undefined}>
                  {roots.length > 0 && expanded ? <FolderOpenSvg /> : <FolderSvg />}
                </FolderIconWrap>
              )}
              name={p.my_pinned_at
                ? <FolderName title={p.name}><span style={{ display: 'inline-flex', verticalAlign: '-1px', marginRight: 4 }}><StarGlyph size={11} title={tr('docs.folder.starred', '즐겨찾기')} /></span>{p.name}</FolderName>
                : p.name}
              count={p.count}
              /* 프로젝트 **안**에 폴더를 만드는 문. 아래 「워크스페이스 폴더」 [+] 는 프로젝트에
                 속하지 않은 것만 만든다 — Q file 에는 이 문이 없었다(프로젝트 상세 탭에만 있었다). */
              actions={onCreateFolder ? (
                <RowPlusBtn type="button" data-testid={`docs-project-folder-new-${p.id}`}
                  title={tr('docs.folder.newInProject')} aria-label={tr('docs.folder.newInProject')}
                  onClick={() => onCreateFolder(p.id)}>
                  <PlusSvg size={13} />
                </RowPlusBtn>
              ) : undefined}
            />
            {expanded && roots.map(f => renderSub(f, 1))}
          </React.Fragment>
        );
      })}
      <TreeDivider />
      {(['chat', 'task', 'meeting', 'post', 'mail'] as FileSource[]).map(src => (
        <TreeRow key={src} selected={selected === `src:${src}`} onClick={() => onSelect(`src:${src}`)}
          icon={<FolderIconWrap $sys={src} $selected={selected === `src:${src}`}><SystemFolderIcon src={src} /></FolderIconWrap>}
          name={sourceShortLabel(src, tr)} count={counts.bySrc[src]} />
      ))}
      {deleteModal}
    </TreeRoot>
  );
};

export default ProjectGroups;
