// 좌측 폴더 트리의 **드롭 판정** — 파일을 끌어 폴더로 옮기기 / 바깥(OS) 파일을 그 폴더로 올리기.
//
// ★ 2026-09-20 에 DocsTab.tsx 에서 빼냈다(treeIcons·treeStyles·TreeRow 와 같은 이유 —
//   god-file 래칫이 막아 세웠고, 주석을 지워 숫자를 맞추지 않는다).
//   두 트리(ProjectGroups / FolderTree)가 **이 훅의 한 인스턴스**를 나눠 쓴다. 각자 부르면
//   «끌어온 표시»·«반짝임» 상태가 두 벌이 되어 한쪽에 놓았는데 다른 쪽이 반응한다.
import React, { useState } from 'react';
import { PLANQ_FILE_MIME } from '../../../hooks/useFileDragOut';

export type FolderDropFn = (folderId: number | null) => {
  over: boolean; flash?: boolean; dropProps: Record<string, unknown>;
};

/** 바깥(OS)에서 끌어온 진짜 파일인가. 우리 목록에서 끄는 중이면 전용 MIME 이 같이 실린다. */
export function isExternalFileDrag(e: React.DragEvent) {
  const types = Array.from(e.dataTransfer?.types || []);
  return types.includes('Files') && !types.includes(PLANQ_FILE_MIME);
}

export function useFolderDrop(
  onDropFiles?: (folderId: number | null, fileId: string) => void | Promise<void>,
  /** 바깥(OS)에서 끌어온 파일을 **그 폴더로** 올린다. 없으면 종전대로 상위 드롭존으로 흘린다. */
  onDropExternal?: (folderId: number | null, files: FileList) => void | Promise<void>,
) {
  const [overKey, setOverKey] = useState<string | null>(null);
  /* 놓은 직후 그 폴더가 잠깐 반짝인다 — «어디로 갔는지» 를 목적지가 말한다.
     성공 토스트는 금지되어 있고, 옮긴 파일은 보고 있던 목록에서 사라지기만 해서
     «없어졌다» 로 읽혔다. */
  const [flashKey, setFlashKey] = useState<string | null>(null);
  const flash = (key: string) => {
    setFlashKey(key);
    window.setTimeout(() => setFlashKey(k => (k === key ? null : k)), 700);
  };
  return (folderId: number | null) => {
    if (!onDropFiles && !onDropExternal) return { dropProps: {}, over: false, flash: false };
    const key = String(folderId);
    return {
      over: overKey === key,
      flash: flashKey === key,
      dropProps: {
        onDragOver: (e: React.DragEvent) => {
          // dragover 에서는 getData 가 빈 문자열이다 — types 로만 판정할 수 있다.
          const types = Array.from(e.dataTransfer.types);
          const mine = !!onDropFiles && types.includes(PLANQ_FILE_MIME);
          const outside = !mine && !!onDropExternal && types.includes('Files');
          if (!mine && !outside) return;
          e.preventDefault();
          // 우리 파일은 «옮기기», 바깥 파일은 «복사(=올리기)» — 커서가 무엇이 일어날지 말해 준다.
          e.dataTransfer.dropEffect = mine ? 'move' : 'copy';
          if (overKey !== key) setOverKey(key);
        },
        onDragLeave: () => setOverKey(k => (k === key ? null : k)),
        onDrop: (e: React.DragEvent) => {
          const id = e.dataTransfer.getData(PLANQ_FILE_MIME);
          const dropped = e.dataTransfer.files;
          setOverKey(null);
          if (id && onDropFiles) {
            e.preventDefault();
            e.stopPropagation();
            flash(key);
            void onDropFiles(folderId, id);
            return;
          }
          // 바깥에서 끌어온 파일 — **그 폴더로** 올린다. 상위 드롭존으로 흘리면
          // 보고 있던 폴더로 들어가 «어디 갔지» 가 된다.
          if (onDropExternal && dropped && dropped.length) {
            e.preventDefault();
            e.stopPropagation();
            flash(key);
            void onDropExternal(folderId, dropped);
            return;
          }
          // 그 외에는 상위(업로드 드롭존)로 흘려보낸다.
        },
      },
    };
  };
}


