// 보관된 채팅 관리 모달 — 사이클 N+10.
//   workspace owner / platform_admin 만 접근. archived 리스트 + 복원/영구삭제.
//   진입: LeftPanel 풋터 "보관함 보기" 링크.
import React, { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { Modal } from '../../components/UI/Modal';
import ConfirmDialog from '../../components/Common/ConfirmDialog';
import {
  listArchivedConversations,
  unarchiveConversation,
  deleteConversationHard,
  type ApiConversation,
} from '../../services/qtalk';
import { useTimeFormat } from '../../hooks/useTimeFormat';

interface Props {
  open: boolean;
  businessId: number;
  onClose: () => void;
  onAfter?: () => void; // 복원 시 부모가 conversations refetch 트리거
}

const ArchivedChatsModal: React.FC<Props> = ({ open, businessId, onClose, onAfter }) => {
  const { t } = useTranslation('qtalk');
  const { formatDateTime } = useTimeFormat();
  const [rows, setRows] = useState<ApiConversation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ApiConversation | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listArchivedConversations(businessId);
      setRows(data);
    } catch (e) {
      setError((e as Error).message || t('archived.fetchFailed', '보관된 채팅을 불러올 수 없어요'));
    } finally {
      setLoading(false);
    }
  }, [businessId, t]);

  useEffect(() => {
    if (!open) return;
    fetchRows();
  }, [open, fetchRows]);

  const handleRestore = async (c: ApiConversation) => {
    setBusyId(c.id);
    setError(null);
    try {
      await unarchiveConversation(businessId, c.id);
      setRows(prev => prev.filter(r => r.id !== c.id));
      if (onAfter) onAfter();
    } catch (e) {
      setError((e as Error).message || t('archived.restoreFailed', '복원에 실패했어요'));
    } finally {
      setBusyId(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return;
    const c = pendingDelete;
    setBusyId(c.id);
    setPendingDelete(null);
    setError(null);
    try {
      await deleteConversationHard(businessId, c.id);
      setRows(prev => prev.filter(r => r.id !== c.id));
      if (onAfter) onAfter();
    } catch (e) {
      setError((e as Error).message || t('archived.deleteFailed', '영구 삭제에 실패했어요'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <Modal
        isOpen={open}
        onClose={onClose}
        title={t('archived.title', '보관된 채팅') as string}
        size="large"
      >
        <Description>
          {t('archived.description', '보관된 채팅은 채팅 목록에서 숨겨져요. 복원하면 다시 활성 목록으로 돌아오고, 영구 삭제하면 메시지·첨부까지 모두 사라집니다.')}
        </Description>

        {error && <ErrorBox>{error}</ErrorBox>}

        {loading ? (
          <Empty>{t('archived.loading', '불러오는 중…')}</Empty>
        ) : rows.length === 0 ? (
          <Empty>{t('archived.empty', '보관된 채팅이 없어요')}</Empty>
        ) : (
          <List>
            {rows.map((c) => {
              const isBusy = busyId === c.id;
              const label = c.title || c.name || c.display_name || `#${c.id}`;
              const projName = c.Project?.name || t('archived.noProject', '일반 대화');
              return (
                <Row key={c.id}>
                  <Body>
                    <RowTitle>{label}</RowTitle>
                    <Meta>
                      <MetaCell>{projName}</MetaCell>
                      <MetaSep>·</MetaSep>
                      <MetaCell>
                        {t('archived.archivedAt', '보관일: {{ts}}', {
                          ts: c.archived_at ? formatDateTime(c.archived_at) : '-',
                          defaultValue: `보관일: ${c.archived_at ? formatDateTime(c.archived_at) : '-'}`,
                        })}
                      </MetaCell>
                      {c.archivedBy?.name && (
                        <>
                          <MetaSep>·</MetaSep>
                          <MetaCell>
                            {t('archived.archivedBy', '{{name}} 보관', {
                              name: c.archivedBy.name,
                              defaultValue: `${c.archivedBy.name} 보관`,
                            })}
                          </MetaCell>
                        </>
                      )}
                    </Meta>
                  </Body>
                  <Actions>
                    <ActionBtn type="button" onClick={() => handleRestore(c)} disabled={isBusy}>
                      {t('archived.restore', '복원')}
                    </ActionBtn>
                    <ActionBtn type="button" $danger onClick={() => setPendingDelete(c)} disabled={isBusy}>
                      {t('archived.deleteForever', '영구 삭제')}
                    </ActionBtn>
                  </Actions>
                </Row>
              );
            })}
          </List>
        )}
      </Modal>

      <ConfirmDialog
        isOpen={!!pendingDelete}
        onClose={() => setPendingDelete(null)}
        onConfirm={handleConfirmDelete}
        title={t('archived.confirmDelete.title', '영구 삭제할까요?') as string}
        message={
          t('archived.confirmDelete.body', '"{{name}}" 채팅방과 모든 메시지·첨부가 영구히 사라집니다. 복구할 수 없어요.', {
            name: pendingDelete?.title || pendingDelete?.name || pendingDelete?.display_name || '',
            defaultValue: `"${pendingDelete?.title || pendingDelete?.name || pendingDelete?.display_name || ''}" 채팅방과 모든 메시지·첨부가 영구히 사라집니다. 복구할 수 없어요.`,
          }) as string
        }
        confirmText={t('archived.confirmDelete.ok', '영구 삭제') as string}
        cancelText={t('archived.confirmDelete.cancel', '취소') as string}
        variant="danger"
      />
    </>
  );
};

export default ArchivedChatsModal;

const Description = styled.p`
  font-size: 13px;
  color: #475569;
  line-height: 1.6;
  margin: 0 0 16px 0;
`;

const ErrorBox = styled.div`
  padding: 10px 12px;
  background: #FEF2F2;
  border: 1px solid #FECACA;
  border-radius: 8px;
  font-size: 13px;
  color: #B91C1C;
  margin-bottom: 12px;
`;

const Empty = styled.div`
  text-align: center;
  padding: 40px 20px;
  font-size: 14px;
  color: #94A3B8;
`;

const List = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 480px;
  overflow-y: auto;
`;

const Row = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid #E2E8F0;
  border-radius: 10px;
  background: #FFFFFF;
`;

const Body = styled.div`
  flex: 1;
  min-width: 0;
`;

const RowTitle = styled.div`
  font-size: 14px;
  font-weight: 600;
  color: #0F172A;
  margin-bottom: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const Meta = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 4px 6px;
  font-size: 12px;
  color: #64748B;
`;
const MetaCell = styled.span``;
const MetaSep = styled.span`
  color: #CBD5E1;
`;

const Actions = styled.div`
  display: flex;
  gap: 8px;
  flex-shrink: 0;
`;

const ActionBtn = styled.button<{ $danger?: boolean }>`
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 600;
  border-radius: 8px;
  border: 1px solid ${(p) => (p.$danger ? '#FECACA' : '#CBD5E1')};
  background: #FFFFFF;
  color: ${(p) => (p.$danger ? '#B91C1C' : '#334155')};
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
  &:hover {
    background: ${(p) => (p.$danger ? '#FEF2F2' : '#F8FAFC')};
  }
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;
