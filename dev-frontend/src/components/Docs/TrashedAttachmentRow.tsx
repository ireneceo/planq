// 문서 첨부 중 원본 파일이 휴지통에 있는 줄 · 볼 수 없는 첨부 수 (2026-11-25 · docs/FILE_USAGE_DESIGN.md §11·12)
//   예전엔 이름이 그대로 남고 [받기]를 누르면 «없음» 이었다. 지금은 «휴지통에 있음» + 복구할 수 있는 사람에게만 [복구].
//   PostsPage 가 3천 줄이라 따로 둔다(god-file 래칫).
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import { AttachRow, RemoveBtn } from './PostsPage.styles';
import { AttachText, LinkedPdfBtn } from './LinkedDocPdfBtn';
import { restoreFile } from '../../services/files';

export interface TrashedAtt { id: number; file_id: number; state?: 'trashed'; can_restore?: boolean; file: { file_name: string } | null }

export const TrashedAttachmentRow: React.FC<{
  att: TrashedAtt; businessId: number; onChanged: () => void; onRemove?: () => void;
}> = ({ att, businessId, onChanged, onRemove }) => {
  const { t } = useTranslation('qdocs');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <AttachRow data-testid={`attach-trashed-${att.id}`}>
      <AttachText title={att.file?.file_name || ''}><Struck>{att.file?.file_name || '—'}</Struck></AttachText>
      <Tag>{t('attach.trashed', '휴지통에 있음')}</Tag>
      {att.can_restore ? (
        <LinkedPdfBtn type="button" data-testid="attach-restore" disabled={busy}
          onClick={async () => {
            setBusy(true); setFailed(false);
            const r = await restoreFile(businessId, att.file_id).catch(() => ({ ok: false }));
            setBusy(false);
            if (r.ok) onChanged(); else setFailed(true);
          }}>
          {failed ? t('attach.restoreFailed', '복구 실패') : t('attach.restore', '복구')}
        </LinkedPdfBtn>
      ) : (
        <Hint>{t('attach.trashedHint', '지운 사람·대표가 복구할 수 있습니다')}</Hint>
      )}
      {onRemove && <RemoveBtn type="button" onClick={onRemove} title={t('actions.remove', '제거') as string} aria-label={t('actions.remove', '제거') as string}>×</RemoveBtn>}
    </AttachRow>
  );
};

/** 보는 사람이 열 수 없는 첨부 수(멤버 이상에게만 서버가 준다) */
export const HiddenAttachNote: React.FC<{ n?: number }> = ({ n }) => {
  const { t } = useTranslation('qdocs');
  if (!n) return null;
  return <Hint data-testid="attach-hidden-count">{t('attach.hiddenCount', { n, defaultValue: '볼 권한이 없는 첨부 {{n}}개' })}</Hint>;
};

const Struck = styled.span`text-decoration: line-through; color: #94A3B8;`;
const Tag = styled.span`flex-shrink: 0; padding: 1px 6px; border-radius: 4px; font-size: 0.6875rem; font-weight: 600; background: #F1F5F9; color: #64748B;`;
const Hint = styled.span`font-size: 0.75rem; color: #94A3B8;`;
