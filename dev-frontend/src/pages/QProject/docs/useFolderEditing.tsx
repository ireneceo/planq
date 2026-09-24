import React, { useState } from 'react';
import type { FileFolder } from '../../../services/files';
import { isEnterAction } from '../../../utils/imeKey';
import { FolderName, RenameInput } from './treeStyles';
import { Modal, Dialog, DTitle, DBody, DFooter, SecondaryBtn, DangerBtn } from './dialogStyles';

/**
 * 폴더 이름 변경(인라인) + 삭제 확인 — 두 트리(FolderTree · Q file 의 ProjectGroups)가 **같은 것**을 쓴다.
 * ★ 2026-09-21 (#417) — Q file 에서 프로젝트 안 하위 폴더에는 [+] 만 있고 이름 변경·삭제·다운로드가 없었다.
 *   FolderTree 안에 묶여 있던 것을 여기로 빼서 둘이 나눠 쓴다(베끼면 한쪽만 고쳐진다).
 *
 * ★ 2026-09-24 (Irene: *"파일이 다른 폴더로 옮겨진다고 나오더니 옮겨졌어. 같이 삭제할건지 물어봐야지.
 *   그래서 선택하게 해줘야지."*) — **안의 파일을 어떻게 할지 이 창에서 고른다.**
 *   확인창을 새로 만들지 않는다 — 두 트리가 이미 이것을 공유하므로 여기 한 곳을 고치면 둘 다 고쳐진다.
 *   그리고 옛 문구 「“직접 업로드 루트”로 옮겨집니다」는 **거짓이었다** — 서버는 `folder.parent_id`,
 *   즉 **바로 위 폴더**로 옮긴다(루트는 위 폴더가 없을 때뿐이다).
 *   ★ 세는 것도 **하위 폴더까지**여야 한다 — 서버가 재귀로 지우므로 묻는 숫자도 재귀다.
 */
export function useFolderEditing({ onRename, onDelete, counts, countDeep, tr }: {
  onRename?: (id: number, name: string) => Promise<void>;
  /** `contents` — 안의 파일을 위 폴더로 옮길지(`move`) 함께 휴지통으로 보낼지(`delete`). */
  onDelete?: (id: number, contents: 'move' | 'delete') => Promise<void>;
  counts: { byFolder: Record<number, number> };
  /** 하위 폴더까지 합한 파일 수. 없으면 이 폴더만 센다(옛 동작). */
  countDeep?: (id: number) => number;
  tr: (k: string, d?: string) => string;
}) {
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<FileFolder | null>(null);
  const startRename = (f: FileFolder) => { setRenamingId(f.id); setRenameDraft(f.name); };
  const commitRename = async () => {
    if (renamingId == null) return;
    const name = renameDraft.trim();
    if (name && onRename) await onRename(renamingId, name);
    setRenamingId(null);
  };
  const renderName = (f: FileFolder): React.ReactNode => (renamingId === f.id ? (
    <RenameInput autoFocus value={renameDraft}
      onClick={e => e.stopPropagation()}
      onChange={e => setRenameDraft(e.target.value)}
      onBlur={commitRename}
      onKeyDown={e => {
        if (isEnterAction(e)) { e.preventDefault(); commitRename(); }
        if (e.key === 'Escape') setRenamingId(null);
      }} />
  ) : (
    <FolderName onDoubleClick={e => { if (!onRename) return; e.stopPropagation(); startRename(f); }} title={f.name}>{f.name}</FolderName>
  ));
  const fileCountInFolder = (folderId: number): number => (countDeep ? countDeep(folderId) : (counts.byFolder[folderId] || 0));
  // 삭제 확인 모달 — 두 트리가 같은 것을 쓴다.
  const deleteCount = deleteTarget ? fileCountInFolder(deleteTarget.id) : 0;
  const deleteModal = deleteTarget && onDelete && (
    <Modal onMouseDown={e => { if (e.target === e.currentTarget) setDeleteTarget(null); }}>
      <Dialog>
        <DTitle>{tr('docs.folder.deleteTitle', '폴더를 삭제할까요?')}</DTitle>
        <DBody>
          <p><strong>{deleteTarget.name}</strong></p>
          {deleteCount > 0 ? (
            <>
              <p>{fmt(tr('docs.folder.deleteCount', '이 폴더와 하위 폴더에 파일 {{n}}개가 있습니다.'), deleteCount)}</p>
              <p>{tr('docs.folder.deleteChoiceMove', '「폴더만 삭제」를 고르면 파일은 바로 위 폴더로 옮겨지고 그대로 남습니다.')}</p>
              <p>{tr('docs.folder.deleteChoiceTrash', '「파일도 함께 삭제」를 고르면 파일도 휴지통으로 갑니다. 30일 안에 되돌릴 수 있습니다.')}</p>
            </>
          ) : (
            <p>{tr('docs.folder.deleteEmpty', '이 폴더는 비어있습니다')}</p>
          )}
        </DBody>
        <DFooter>
          <SecondaryBtn type="button" onClick={() => setDeleteTarget(null)}>{tr('members.cancel', '취소')}</SecondaryBtn>
          {deleteCount > 0 ? (
            <>
              <SecondaryBtn type="button" data-testid="folder-delete-only"
                onClick={async () => { const t = deleteTarget; setDeleteTarget(null); await onDelete(t.id, 'move'); }}>
                {tr('docs.folder.deleteOnlyFolder', '폴더만 삭제')}
              </SecondaryBtn>
              <DangerBtn type="button" data-testid="folder-delete-with-files"
                onClick={async () => { const t = deleteTarget; setDeleteTarget(null); await onDelete(t.id, 'delete'); }}>
                {tr('docs.folder.deleteWithFilesAction', '파일도 함께 삭제')}
              </DangerBtn>
            </>
          ) : (
            /* 빈 폴더는 고를 것이 없다 — 선택지를 세우면 뜻 없는 축이 하나 늘어난다. */
            <DangerBtn type="button" data-testid="folder-delete-empty"
              onClick={async () => { const t = deleteTarget; setDeleteTarget(null); await onDelete(t.id, 'move'); }}>
              {tr('docs.delete', '삭제')}
            </DangerBtn>
          )}
        </DFooter>
      </Dialog>
    </Modal>
  );
  return { renamingId, startRename, renderName, setDeleteTarget, deleteModal };
}

/** `tr` 이 2인자라 보간을 못 한다 — {{n}} 을 손으로 치환한다. */
function fmt(tpl: string, n: number): string {
  return String(tpl).replace('{{n}}', String(n));
}
