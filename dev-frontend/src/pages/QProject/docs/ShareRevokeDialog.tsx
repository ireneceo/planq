// 다운로드 공유 링크(B) 해제 확인창 — 2026-10-08 0-J
//   옛: 링크를 만들 수만 있고 끊는 문이 없었다(services/files.revokeShareLink 호출 0).
//   이미 보낸 링크가 바로 끊기는 동작이라 묻고 한다(ConfirmDialog — window.confirm 금지).
//   DocsTab(god-file)에 얹지 않으려고 따로 뺐다.
import React from 'react';
import { useTranslation } from 'react-i18next';
import ConfirmDialog from '../../../components/Common/ConfirmDialog';
import { revokeShareLink } from '../../../services/files';

interface Props {
  businessId: number;
  /** 해제할 파일 id(direct-…). null 이면 닫힘 */
  fileId: string | null;
  onClose: () => void;
  onDone: (fileId: string) => void;
  onError: (message: string) => void;
}

const ShareRevokeDialog: React.FC<Props> = ({ businessId, fileId, onClose, onDone, onError }) => {
  const { t } = useTranslation('qproject');
  return (
    <ConfirmDialog
      isOpen={!!fileId}
      title={t('docs.bulk.shareRevokeTitle', '공유 링크를 해제할까요?') as string}
      message={t('docs.bulk.shareRevokeBody', '이미 보낸 다운로드 링크가 바로 끊깁니다. 다시 공유하려면 새 링크를 만들어야 합니다.') as string}
      confirmText={t('docs.bulk.shareRevoke', '링크 해제') as string}
      cancelText={t('docs.bulk.cancel', '취소') as string}
      variant="danger"
      onClose={onClose}
      onConfirm={() => {
        const id = fileId; onClose();
        if (!id) return;
        void revokeShareLink(businessId, id).catch(() => false).then((ok) => {
          if (ok) onDone(id);
          else onError(t('docs.bulk.shareRevokeFailed', '공유 링크를 해제하지 못했습니다') as string);
        });
      }}
    />
  );
};

export default ShareRevokeDialog;
