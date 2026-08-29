// TrashDrawer — 파일 휴지통.
//
// 왜 생겼나: 여태 파일 삭제는 되돌릴 방법이 **없었다.** DB 에 deleted_at 은 찍혔지만
//   복구 라우트도 화면도 0건이었고, 같은 함수가 바이트까지 지웠다. 사용자 입장에서는
//   그냥 영구 삭제였다(2026-08-28 정정 기록 → memory feedback_soft_delete_without_trash_ui).
//
// 계약:
//   - 목록에는 **되돌릴 수 있는 것만** 온다. 서버가 바이트 실존까지 보고 걸러 준다.
//     눌러도 안 되는 버튼을 주지 않는 것이 이 화면의 핵심이다.
//   - 보존기간이 지나면 자동으로 비워진다 — 그 시각을 행마다 보여준다.
//   - 공용 프리미티브 DetailDrawer 를 쓴다(반응형 3구간·Esc·포커스 트랩·스크롤 잠금 내장).
import React, { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import DetailDrawer from '../../components/Common/DetailDrawer';
import ConfirmDialog from '../../components/Common/ConfirmDialog';
import ActionButton from '../../components/Common/ActionButton';
import EmptyState from '../../components/Common/EmptyState';
import { fetchTrash, restoreFile, purgeFile, emptyTrash } from '../../services/files';
import type { TrashedFile } from '../../services/files';
import { useTimeFormat } from '../../hooks/useTimeFormat';

interface Props {
  open: boolean;
  businessId: number;
  projectId?: number;
  onClose: () => void;
  /** 복구/영구삭제 후 바깥 목록을 다시 그리게 한다 */
  onChanged: () => void;
}

function formatSize(bytes: number): string {
  if (!bytes) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0; let n = bytes;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i += 1; }
  return `${n < 10 ? n.toFixed(1) : Math.round(n)} ${u[i]}`;
}

const TrashDrawer: React.FC<Props> = ({ open, businessId, projectId, onClose, onChanged }) => {
  const { t } = useTranslation('qproject');
  const { formatDate } = useTimeFormat();

  const [items, setItems] = useState<TrashedFile[]>([]);
  const [total, setTotal] = useState(0);
  const [retentionDays, setRetentionDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [purgeTarget, setPurgeTarget] = useState<TrashedFile | null>(null);
  const [emptyOpen, setEmptyOpen] = useState(false);
  const [emptying, setEmptying] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const page = await fetchTrash(businessId, projectId ? { projectId } : undefined);
    setItems(page.items);
    setTotal(page.total);
    setRetentionDays(page.retentionDays);
    setLoading(false);
  }, [businessId, projectId]);

  useEffect(() => { if (open) { setErr(null); void load(); } }, [open, load]);

  const onRestore = async (f: TrashedFile) => {
    if (busyId) return;              // 중복 제출 가드
    setBusyId(f.id); setErr(null);
    const r = await restoreFile(businessId, f.id);
    setBusyId(null);
    if (!r.ok) {
      // 조용히 실패하지 않는다 — 눌렀는데 아무 일도 안 나면 사용자는 고장으로 읽는다.
      setErr(r.reason === 'storage_quota_exceeded'
        ? (t('docs.trash.quotaFull', '저장 공간이 가득 차 복구할 수 없습니다. 다른 파일을 먼저 정리해주세요.') as string)
        : r.reason === 'file_bytes_gone'
          ? (t('docs.trash.bytesGone', '이 파일의 내용이 이미 사라져 복구할 수 없습니다.') as string)
          : (t('docs.trash.restoreFailed', '복구하지 못했습니다.') as string));
      void load();
      return;
    }
    setItems((prev) => prev.filter((x) => x.id !== f.id));
    setTotal((v) => Math.max(0, v - 1));
    onChanged();
  };

  const onPurge = async (f: TrashedFile) => {
    setBusyId(f.id);
    const ok = await purgeFile(businessId, f.id);
    setBusyId(null); setPurgeTarget(null);
    if (!ok) { setErr((t('docs.trash.purgeFailed', '영구 삭제하지 못했습니다.') as string)); return; }
    setItems((prev) => prev.filter((x) => x.id !== f.id));
    setTotal((v) => Math.max(0, v - 1));
  };

  const onEmpty = async () => {
    if (emptying) return;
    setEmptying(true);
    const r = await emptyTrash(businessId);
    setEmptying(false); setEmptyOpen(false);
    if (r.skipped > 0) {
      setErr((t('docs.trash.emptyPartial', '{{n}}개는 권한이 없어 남겨 두었습니다.') as string).replace('{{n}}', String(r.skipped)));
    }
    void load();
  };

  return (
    <>
      <DetailDrawer open={open} onClose={onClose} width={480} ariaLabel={(t('docs.trash.title', '휴지통') as string)}>
        <DetailDrawer.Header onClose={onClose}>
          <HeadTitle>{(t('docs.trash.title', '휴지통') as string)}</HeadTitle>
          {!loading && <HeadCount>{total}</HeadCount>}
        </DetailDrawer.Header>
        <DetailDrawer.Body>
          <Notice>
            {(t('docs.trash.retention', '{{days}}일이 지나면 자동으로 비워집니다. 그 전까지는 되돌릴 수 있습니다.') as string)
              .replace('{{days}}', String(retentionDays))}
          </Notice>
          {err && <ErrorBar role="alert">{err}</ErrorBar>}
          {loading ? (
            <Dim data-testid="trash-loading">{(t('docs.trash.loading', '불러오는 중…') as string)}</Dim>
          ) : items.length === 0 ? (
            <EmptyState
              title={(t('docs.trash.emptyTitle', '휴지통이 비어 있습니다') as string)}
              description={(t('docs.trash.emptyDesc', '삭제한 파일이 여기에 보관되고, 되돌릴 수 있습니다.') as string)}
            />
          ) : (
            <List data-testid="trash-list">
              {items.map((f) => (
                <Row key={f.id} data-testid="trash-row">
                  <RowMain>
                    <Name title={f.file_name}>{f.file_name}</Name>
                    <Meta>
                      {formatSize(f.file_size)}
                      {' · '}
                      {(t('docs.trash.deletedBy', '{{who}} 삭제') as string)
                        .replace('{{who}}', f.deleter?.name || (t('docs.trash.unknownWho', '알 수 없음') as string))}
                      {' · '}
                      {formatDate(f.deleted_at)}
                    </Meta>
                    {f.purge_after && (
                      <Expiry>
                        {(t('docs.trash.purgeAfter', '{{date}} 자동 삭제') as string)
                          .replace('{{date}}', formatDate(f.purge_after))}
                      </Expiry>
                    )}
                  </RowMain>
                  <RowActions>
                    <ActionButton
                      tone="primary" size="sm" type="button"
                      data-testid="trash-restore"
                      loading={busyId === f.id}
                      disabled={busyId !== null}
                      onClick={() => void onRestore(f)}
                    >
                      {(t('docs.trash.restore', '복구') as string)}
                    </ActionButton>
                    <ActionButton
                      tone="danger" size="sm" type="button"
                      disabled={busyId !== null}
                      onClick={() => setPurgeTarget(f)}
                    >
                      {(t('docs.trash.purge', '영구 삭제') as string)}
                    </ActionButton>
                  </RowActions>
                </Row>
              ))}
            </List>
          )}
        </DetailDrawer.Body>
        {items.length > 0 && (
          <DetailDrawer.Footer>
            <ActionButton tone="danger" size="md" type="button" onClick={() => setEmptyOpen(true)} disabled={emptying}>
              {(t('docs.trash.empty', '휴지통 비우기') as string)}
            </ActionButton>
          </DetailDrawer.Footer>
        )}
      </DetailDrawer>

      <ConfirmDialog
        isOpen={!!purgeTarget}
        onClose={() => setPurgeTarget(null)}
        onConfirm={() => purgeTarget && void onPurge(purgeTarget)}
        variant="danger"
        title={(t('docs.trash.purgeTitle', '영구 삭제') as string)}
        message={(t('docs.trash.purgeMsg', '"{{name}}" 을(를) 영구 삭제합니다. 되돌릴 수 없습니다.') as string)
          .replace('{{name}}', purgeTarget?.file_name || '')}
        confirmText={(t('docs.trash.purge', '영구 삭제') as string)}
        cancelText={(t('common.cancel', '취소') as string)}
      />
      <ConfirmDialog
        isOpen={emptyOpen}
        onClose={() => setEmptyOpen(false)}
        onConfirm={() => void onEmpty()}
        variant="danger"
        title={(t('docs.trash.empty', '휴지통 비우기') as string)}
        message={(t('docs.trash.emptyMsg', '휴지통의 파일을 모두 영구 삭제합니다. 되돌릴 수 없습니다.') as string)}
        confirmText={(t('docs.trash.empty', '휴지통 비우기') as string)}
        cancelText={(t('common.cancel', '취소') as string)}
      />
    </>
  );
};

export default TrashDrawer;

const HeadTitle = styled.div`font-size:16px;font-weight:700;color:#0F172A;`;
const HeadCount = styled.span`
  margin-left:8px;padding:1px 8px;border-radius:999px;
  background:#F1F5F9;color:#475569;font-size:12px;font-weight:700;
`;
const Notice = styled.div`
  padding:10px 12px;margin-bottom:12px;border-radius:8px;
  background:#F8FAFC;border:1px solid #E2E8F0;color:#475569;font-size:12.5px;line-height:1.5;
`;
const ErrorBar = styled.div`
  padding:10px 12px;margin-bottom:12px;border-radius:8px;
  background:#FEF2F2;border:1px solid #FECACA;color:#B91C1C;font-size:13px;
`;
const Dim = styled.div`padding:24px 0;text-align:center;color:#94A3B8;font-size:13px;`;
const List = styled.div`display:flex;flex-direction:column;gap:8px;`;
const Row = styled.div`
  display:flex;align-items:flex-start;gap:10px;
  padding:12px;border:1px solid #E2E8F0;border-radius:10px;background:#fff;
  @media (max-width: 640px) { flex-direction:column;align-items:stretch; }
`;
const RowMain = styled.div`flex:1;min-width:0;`;
const Name = styled.div`
  font-size:13.5px;font-weight:600;color:#0F172A;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
`;
const Meta = styled.div`margin-top:3px;font-size:12px;color:#64748B;`;
const Expiry = styled.div`margin-top:2px;font-size:12px;color:#B45309;`;
const RowActions = styled.div`
  display:flex;gap:6px;flex-shrink:0;
  @media (max-width: 640px) { margin-top:10px; }
`;
