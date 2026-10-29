// 좌측 폴더 트리 — 프로젝트>파일 · Q file 폴더 섹션(foldersOnly).
// ★ 2026-10-23 DocsTab.tsx 에서 빼냈다(god-file 래칫 — 동작·값 그대로).
import React, { useState } from 'react';
import { FolderSvg, FolderOpenSvg, AllSvg, PlusSvg, SystemFolderIcon } from './treeIcons';
import {
  TreeRoot, TreeDivider, FolderRow, FolderIconWrap, SectionRow, FolderSectionLabel, EmptyHint, RowPlusBtn, FolderNewBtn, RenameInput
} from './treeStyles';
import TreeRow from './TreeRow';
import { sourceShortLabel } from './fileSource';
import { useFolderDrop, type FolderDropFn } from './folderDrop';
import OverflowMenu from '../../../components/Common/OverflowMenu';
import { isEnterAction } from '../../../utils/imeKey';
import { useFolderEditing } from './useFolderEditing';
import type { FileFolder, FileSource, FolderDeleteOutcome } from '../../../services/files';
import type { FolderSel } from './folderSel';

// ─── 폴더 트리 컴포넌트 ───

interface FolderTreeProps {
  /** 워크스페이스 모드 — 폴더 섹션만 그린다.
   *  ★ 이걸 안 두면 ProjectGroups 가 이미 그린 전체·내 파일·시스템 폴더를 **한 번 더** 그린다
   *    (Irene 2026-08-31 "내 파일이 왜 두 개야?"). 트리를 통째로 얹은 것이 원인이었다. */
  foldersOnly?: boolean;
  /** 프로젝트 모드에서 «기본 폴더» 행에 쓰는 이름·색. 없으면 종전 문구로 떨어진다. */
  projectName?: string;
  projectColor?: string | null;
  folders: FileFolder[];
  counts: { total: number; bySrc: Record<FileSource, number>; byFolder: Record<number, number>; directRoot: number };
  total: number;
  selected: FolderSel;
  onSelect: (sel: FolderSel) => void;
  onCreate: (parentId: number | null, name: string) => Promise<void>;
  onRename: (id: number, name: string) => Promise<void>;
  onDelete: (id: number, contents: 'move' | 'delete') => Promise<FolderDeleteOutcome | void>;
  /** 휴지통 보관 일수(요금제) — 폴더 삭제 확인창 문구 (0-D) */
  trashDays?: number | null;
  countDeep?: (id: number) => number;
  onReorder: (id: number, direction: 'up' | 'down') => Promise<void>;
  /** 폴더 통째 다운로드 (zip). 파일을 하나씩 고르지 않고 폴더째 받는다 — Irene #417. */
  onDownloadFolder?: (id: number) => void | Promise<void>;
  /** 폴더 공유 링크(#469) — 멤버에게만 넘긴다(고객은 메뉴가 없다). */
  onShareFolder?: (f: FileFolder) => void;
  /** 파일을 이 폴더로 끌어다 놓았을 때. 없으면 드롭 존 자체를 만들지 않는다. */
  onDropFiles?: (folderId: number | null, fileId: string) => void | Promise<void>;
  /** 바깥(OS)에서 끌어온 파일을 이 폴더로 올린다. */
  onDropExternal?: (folderId: number | null, files: FileList) => void | Promise<void>;
  /** 드롭 인스턴스를 밖에서 받는다 — ProjectGroups 와 **같은 것**을 써야 표시가 갈라지지 않는다. */
  folderDrop?: FolderDropFn;
  tr: (k: string, fb?: string) => string;
}

const FolderTree: React.FC<FolderTreeProps> = ({ folders, counts, total, selected, onSelect, onCreate, onRename, onDelete, onReorder, onDropFiles, onDropExternal, onDownloadFolder, onShareFolder, folderDrop: folderDropProp, tr, foldersOnly, projectName, projectColor, countDeep, trashDays }) => {
  const ownDrop = useFolderDrop(onDropFiles, onDropExternal);
  const folderDrop = folderDropProp || ownDrop;
  const [creatingParent, setCreatingParent] = useState<number | null | undefined>(undefined);
  const [newName, setNewName] = useState('');
  const { renamingId, startRename, renderName, setDeleteTarget, deleteModal } = useFolderEditing({ onRename, onDelete, counts, countDeep, tr, trashDays });

  const rootFolders = folders.filter(f => f.parent_id === null);
  // ★ 프로젝트 폴더는 여기서 그리지 않는다 — **프로젝트 행 아래**로 갔다(ProjectGroups).
  //   한때 여기에 프로젝트 묶음을 따로 그렸는데, 그러면 좌측에 같은 프로젝트 이름이
  //   **두 번** 나온다(프로젝트 목록에 한 번, 폴더 섹션에 한 번). 프로젝트는 한 줄이다.
  const wsRootFolders = rootFolders.filter(f => !f.project_id);
  const childrenOf = (id: number) => folders.filter(f => f.parent_id === id);

  const startCreate = (parentId: number | null) => {
    setCreatingParent(parentId); setNewName('');
  };
  const commitCreate = async () => {
    if (!newName.trim()) { setCreatingParent(undefined); return; }
    await onCreate(creatingParent ?? null, newName.trim());
    setCreatingParent(undefined); setNewName('');
  };
  const renderFolder = (f: FileFolder, depth: number): React.ReactNode => {
    const sel = selected === f.id;
    const children = childrenOf(f.id);
    const count = counts.byFolder[f.id] || 0;
    // 경계 확인 — 같은 parent 안에서의 위치
    const siblings = folders.filter(x => x.parent_id === f.parent_id).sort((a, b) => a.sort_order - b.sort_order);
    const sibIdx = siblings.findIndex(s => s.id === f.id);
    const isFirst = sibIdx === 0;
    const isLast = sibIdx === siblings.length - 1;
    return (
      <React.Fragment key={f.id}>
        <TreeRow
          selected={sel}
          dropOver={folderDrop(f.id).over}
          flash={folderDrop(f.id).flash}
          dropProps={folderDrop(f.id).dropProps as Record<string, unknown>}
          depth={depth}
          onClick={() => onSelect(f.id)}
          icon={<FolderIconWrap $selected={sel}>{sel ? <FolderOpenSvg /> : <FolderSvg />}</FolderIconWrap>}
          name={renderName(f)}
          count={renamingId === f.id ? 0 : count}
          actionsVisible={sel}
          /* ★ 2026-09-20 (Irene: *"프로젝트>파일에도 마우스 오버하니 ... 이 이상하게 뜨네.
             마우스 오버하면 +가 뜨게 통일하면 되겠는데? Q file도 프로젝트>파일도"*) —
             두 트리가 서로 다른 것을 띄우고 있었다. 자주 쓰는 «폴더 만들기» 를 두 곳 모두 [+] 로
             앞세우고, 이름 변경·삭제·순서 같은 나머지는 ⋯ 에 남긴다(없애면 이름을 못 바꾼다).
             ★ 2026-09-17 (#417) 교훈은 그대로 — 아이콘 전용 버튼을 한 줄에 5개 세우면
             이름 칸(minmax(0,1fr))이 0 까지 줄어 폴더 이름이 한 글자가 된다. 그래서 겹쳐 띄운다. */
          actions={renamingId === f.id ? undefined : (
            <>
              <RowPlusBtn type="button" data-testid={`docs-folder-newchild-${f.id}`}
                title={tr('docs.folder.newChildAction')} aria-label={tr('docs.folder.newChildAction')}
                onClick={() => startCreate(f.id)}>
                <PlusSvg size={13} />
              </RowPlusBtn>
              <OverflowMenu
                label={tr('docs.folder.more')}
                data-testid={`docs-folder-menu-${f.id}`}
                items={[
                  { key: 'child', label: tr('docs.folder.newChild', '하위 폴더'), onClick: () => startCreate(f.id), testId: 'docs-folder-newchild' },
                  { key: 'rename', label: tr('docs.folder.rename', '이름 변경'), onClick: () => startRename(f), testId: 'docs-folder-rename' },
                  ...(onDownloadFolder && count > 0
                    ? [{ key: 'dl', label: tr('docs.folder.downloadAll'), onClick: () => { void onDownloadFolder(f.id); }, testId: 'docs-folder-download' }]
                    : []),
                  ...(onShareFolder ? [{ key: 'share', label: tr('docs.folder.share'), onClick: () => onShareFolder(f), testId: 'docs-folder-share' }] : []),
                  { key: 'up', label: tr('docs.folder.moveUp', '위로'), onClick: () => onReorder(f.id, 'up'), disabled: isFirst, dividerBefore: true },
                  { key: 'down', label: tr('docs.folder.moveDown', '아래로'), onClick: () => onReorder(f.id, 'down'), disabled: isLast },
                  { key: 'del', label: tr('docs.folder.delete', '삭제'), onClick: () => setDeleteTarget(f), danger: true, dividerBefore: true, testId: 'docs-folder-delete' },
                ]}
              />
            </>
          )}
        />
        {children.map(c => renderFolder(c, depth + 1))}
        {creatingParent === f.id && (
          <FolderRow style={{ paddingLeft: 8 + (depth + 1) * 18 }}>
              <FolderIconWrap><FolderSvg /></FolderIconWrap>
            <RenameInput autoFocus placeholder={tr('docs.folder.placeholder', '폴더 이름')} value={newName}
              onChange={e => setNewName(e.target.value)} onBlur={commitCreate}
              onKeyDown={e => {
                if (isEnterAction(e)) { e.preventDefault(); commitCreate(); }
                if (e.key === 'Escape') setCreatingParent(undefined);
              }} />
          </FolderRow>
        )}
      </React.Fragment>
    );
  };

  const createRow = creatingParent === null && (
    <FolderRow style={{ paddingLeft: 22 }}>
      <FolderIconWrap><FolderSvg /></FolderIconWrap>
      <RenameInput autoFocus placeholder={tr('docs.folder.placeholder')} value={newName}
        onChange={e => setNewName(e.target.value)} onBlur={commitCreate}
        onKeyDown={e => {
          if (isEnterAction(e)) { e.preventDefault(); commitCreate(); }
          if (e.key === 'Escape') setCreatingParent(undefined);
        }} />
    </FolderRow>
  );

  // 워크스페이스 — 폴더 섹션만. 전체·내 파일·시스템 폴더는 ProjectGroups 소관이다.
  if (foldersOnly) {
    return (
      <>
        <TreeRoot>
          <TreeDivider />
          <SectionRow>
            <FolderSectionLabel>{tr('docs.folders.section')}</FolderSectionLabel>
            {/* ★ 항상 보이는 버튼 — 선택했을 때만 나타나면 "폴더를 어디서 만드는지" 알 수 없다.
                ★ 2026-09-07 — 12px `+` 아이콘 하나뿐이라 있어도 못 찾았다
                  (Irene: "여전히 폴더만들기가 없는데 폴더 관리가 안되는 거야?").
                  아이콘 전용 버튼은 자리는 먹고 뜻은 안 알려준다 → **글자를 붙인다.** */}
            <FolderNewBtn type="button" data-testid="folder-new"
              title={tr('docs.folder.new')} onClick={() => startCreate(null)}>
              <PlusSvg size={11} />
              <span>{tr('docs.folder.new')}</span>
            </FolderNewBtn>
          </SectionRow>
          {createRow}
          {rootFolders.length === 0 && creatingParent !== null && (
            <EmptyHint>{tr('docs.folders.empty')}</EmptyHint>
          )}
          {wsRootFolders.map(f => renderFolder(f, 0))}
        </TreeRoot>
        {deleteModal}
      </>
    );
  }

  return (
    <>
      <TreeRoot data-testid="file-tree">
        {/* ★ 2026-09-20 (Irene: *"지금 그냥 Q file이 잘 정돈되어 있어. 이렇게 해줘. 프로젝트>파일에서 정돈도"* ·
            *"좌측 카테고리들은 다 좌측이 맞아야지 하위폴더는 새로 만든 폴더 뿐이잖아. 직접 업로드라는
            이름을 바꿔? 그냥 프로젝트이름 나오면 될 것 같은데."*) —
            Q file 트리를 **정본**으로 삼아 같은 모양으로 맞춘다:
              · 최상단 칸(전체 · 프로젝트 · 채팅/업무/회의/문서/메일)은 **모두 같은 왼쪽 기준**
              · 들여쓰기되는 것은 **사람이 만든 폴더**뿐
              · 프로젝트 행이 곧 «기본 폴더» — 이름은 프로젝트 이름, [+] 로 그 안에 폴더를 만든다
            (2026-09-20 오전에 이 행을 «직접 업로드» 로 바꿨던 것을 되돌린다 — 그때는 폴더가
             별도 섹션으로 떨어져 있어 이름만 중복으로 보였다. 계층이 잡히면 프로젝트 이름이 맞다.) */}
        <TreeRow selected={selected === 'all'} onClick={() => onSelect('all')}
          icon={<FolderIconWrap $selected={selected === 'all'}><AllSvg /></FolderIconWrap>}
          name={tr('docs.folder.all', '전체')} count={total} />

        <TreeDivider />

        <TreeRow
          selected={selected === 'direct'}
          dropOver={folderDrop(null).over}
          flash={folderDrop(null).flash}
          dropProps={folderDrop(null).dropProps as Record<string, unknown>}
          onClick={() => onSelect('direct')}
          icon={(
            <FolderIconWrap $selected={selected === 'direct'} $tint={projectColor || '#14B8A6'}>
              {selected === 'direct' ? <FolderOpenSvg /> : <FolderSvg />}
            </FolderIconWrap>
          )}
          name={projectName || tr('docs.folder.directRoot')}
          count={counts.bySrc.direct}
          actions={(
            <RowPlusBtn type="button" data-testid="folder-new"
              title={tr('docs.folder.newInProject')} aria-label={tr('docs.folder.newInProject')}
              onClick={() => startCreate(null)}>
              <PlusSvg size={13} />
            </RowPlusBtn>
          )}
        />
        {creatingParent === null && (
          <FolderRow style={{ paddingLeft: 8 + 18 }}>
            <FolderIconWrap><FolderSvg /></FolderIconWrap>
            <RenameInput autoFocus placeholder={tr('docs.folder.placeholder', '폴더 이름')} value={newName}
              onChange={e => setNewName(e.target.value)} onBlur={commitCreate}
              onKeyDown={e => {
                if (isEnterAction(e)) { e.preventDefault(); commitCreate(); }
                if (e.key === 'Escape') setCreatingParent(undefined);
              }} />
          </FolderRow>
        )}
        {/* 사람이 만든 폴더 — **프로젝트 행 아래로 들여쓰기**. 여기만 들여쓴다. */}
        {rootFolders.map(f => renderFolder(f, 1))}

        <TreeDivider />

        {/* 자동으로 모이는 출처 — 프로젝트 행과 **같은 왼쪽 기준**이다(하위가 아니다). */}
        {/* «연결됨» 은 다른 프로젝트 소속 파일을 이 프로젝트에 건 것 — 있을 때만 칸을 세운다(docs/PROJECT_REFS_DESIGN.md) */}
        {(['chat', 'task', 'meeting', 'post', 'mail', 'linked'] as FileSource[]).filter(src => src !== 'linked' || counts.bySrc.linked > 0).map(src => (
          <TreeRow key={src} selected={selected === `src:${src}`} onClick={() => onSelect(`src:${src}`)}
            icon={<FolderIconWrap $sys={src} $selected={selected === `src:${src}`}><SystemFolderIcon src={src} /></FolderIconWrap>}
            name={sourceShortLabel(src, tr)} count={counts.bySrc[src]} />
        ))}
      </TreeRoot>

      {deleteModal}
    </>
  );
};


export default FolderTree;
