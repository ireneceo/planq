// 폴더 공유 링크(#469) — 두 트리(Q file·프로젝트>파일)의 ⋯ «공유 링크» 와 그 창.
//   DocsTab 은 god-file 래칫에 동결돼 있어 여기로 뺀다. 창은 기존 통합 공유 창(ShareModal)을 그대로 쓴다 —
//   만료·비밀번호·끄기가 다른 자료와 같은 모양이다. 메뉴는 멤버만(고객이 눌러 403 을 받는 메뉴는 «안 됨» 으로 읽힌다).
//   폴더의 🔗 표시는 서버가 보내는 `folder:updated` 신호로 다시 읽는다(DocsTab 소켓).
import { useState } from 'react';
import ShareModal from '../../../components/Common/ShareModal';
import type { FileFolder } from '../../../services/files';

export function useFolderShare(enabled: boolean) {
  const [target, setTarget] = useState<FileFolder | null>(null);
  const shareFolderModal = target ? (
    <ShareModal open entityType="file_folder" entityId={target.id} entityTitle={target.name} onClose={() => setTarget(null)} />
  ) : null;
  return { onShareFolder: enabled ? setTarget : undefined, shareFolderModal };
}
