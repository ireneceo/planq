import React, { useState } from 'react';
import type { FileFolder } from '../../../services/files';
import { isEnterAction } from '../../../utils/imeKey';
import { FolderName, RenameInput } from './treeStyles';
import { Modal, Dialog, DTitle, DBody, DFooter, SecondaryBtn, DangerBtn } from './dialogStyles';

/**
 * 폴더 이름 변경(인라인) + 삭제 확인 — 두 트리(FolderTree · Q file 의 ProjectGroups)가 **같은 것**을 쓴다.
 * ★ 2026-09-21 (#417) — Q file 에서 프로젝트 안 하위 폴더에는 [+] 만 있고 이름 변경·삭제·다운로드가 없었다.
 *   FolderTree 안에 묶여 있던 것을 여기로 빼서 둘이 나눠 쓴다(베끼면 한쪽만 고쳐진다).
 */
export function useFolderEditing({ onRename, onDelete, counts, tr }: {
  onRename?: (id: number, name: string) => Promise<void>;
  onDelete?: (id: number) => Promise<void>;
  counts: { byFolder: Record<number, number> };
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
  const fileCountInFolder = (folderId: number): number => counts.byFolder[folderId] || 0;
  // 삭제 확인 모달 — 두 트리가 같은 것을 쓴다.
  const deleteModal = deleteTarget && onDelete && (
    <Modal onMouseDown={e => { if (e.target === e.currentTarget) setDeleteTarget(null); }}>
      <Dialog>
        <DTitle>{tr('docs.folder.deleteTitle', '폴더를 삭제할까요?')}</DTitle>
        <DBody>
          <p><strong>{deleteTarget.name}</strong></p>
          {fileCountInFolder(deleteTarget.id) > 0 ? (
            <p>{deleteWithFilesMessage(fileCountInFolder(deleteTarget.id), tr)}</p>
          ) : (
            <p>{tr('docs.folder.deleteEmpty', '이 폴더는 비어있습니다')}</p>
          )}
        </DBody>
        <DFooter>
          <SecondaryBtn type="button" onClick={() => setDeleteTarget(null)}>{tr('members.cancel', '취소')}</SecondaryBtn>
          <DangerBtn type="button" onClick={async () => { await onDelete(deleteTarget.id); setDeleteTarget(null); }}>
            {tr('docs.delete', '삭제')}
          </DangerBtn>
        </DFooter>
      </Dialog>
    </Modal>
  );
  return { renamingId, startRename, renderName, setDeleteTarget, deleteModal };
}

function deleteWithFilesMessage(n: number, tr: (k: string, fb?: string) => string): string {
  // i18n 에 {{n}} 이 들어간 문구를 tr(2 arg) 로 단순 치환
  const tpl = tr('docs.folder.deleteWithFiles', '이 폴더 안 {{n}}개 파일은 “직접 업로드 루트”로 옮겨집니다');
  return tpl.replace('{{n}}', String(n));
}
