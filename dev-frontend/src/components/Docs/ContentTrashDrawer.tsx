// ContentTrashDrawer — 문서(Q docs)·정보(Q info) 휴지통.
//
// 왜 생겼나 (Irene 2026-08-31)
//   "모든 이메일 노트 문서 인포 파일 삭제들이 휴지통에 존재할 수 있게 가능해? …
//    잘못해서 삭제하고 문제되면 책임여부 문제고"
//   여태 휴지통은 **파일만** 있었다. 문서·정보는 하드 DELETE 라 되돌릴 방법이 없었다.
//
// 계약은 파일 휴지통(QProject/TrashDrawer)과 같게 둔다 — 사용자가 규칙을 두 개 외우지 않게:
//   · 복원 가능 여부는 **서버가 판정**해서 준다(restorable). 눌러도 안 되는 버튼을 주지 않는다.
//   · 보관기간은 **요금제에서 온다**(services/retentionPolicy.js). 지난 것은 목록에 남되
//     복원 버튼이 잠긴다(조용히 사라지지 않게). 30 을 화면에 박지 않는다 — 플랜마다 다르다.
//   · 공용 DetailDrawer 사용(반응형 3구간·Esc·포커스 트랩·스크롤 잠금 내장).
import React, { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import DetailDrawer from '../Common/DetailDrawer';
import ConfirmDialog from '../Common/ConfirmDialog';
import ActionButton from '../Common/ActionButton';
import EmptyState from '../Common/EmptyState';
import { fetchContentTrash, restoreContent, purgeContent, type TrashedContent } from '../../services/posts';
import { mapApiError } from '../../utils/apiError';

interface Props {
  open: boolean;
  businessId: number;
  onClose: () => void;
  /** 복원/영구삭제 후 바깥 목록을 다시 그리게 한다 */
  onChanged: () => void;
}

const ContentTrashDrawer: React.FC<Props> = ({ open, businessId, onClose, onChanged }) => {
  const { t } = useTranslation('qdocs');
  const { t: tErr } = useTranslation('errors');
  const [rows, setRows] = useState<TrashedContent[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [purgeTarget, setPurgeTarget] = useState<TrashedContent | null>(null);
  // null = 서버가 판단 못 함 → 보관 문구를 그리지 않는다(요금제마다 기간이 다르다).
  const [retentionDays, setRetentionDays] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!open || !businessId) return;
    setLoading(true); setError(null);
    try {
      const page = await fetchContentTrash(businessId);
      setRows(page.items);
      setRetentionDays(page.retentionDays);
    }
    finally { setLoading(false); }
  }, [open, businessId]);
  useEffect(() => { void load(); }, [load]);

  const keyOf = (r: TrashedContent) => `${r.kind}:${r.id}`;

  const onRestore = async (r: TrashedContent) => {
    if (busyId) return;                       // 중복 제출 가드
    setBusyId(keyOf(r)); setError(null);
    try {
      await restoreContent(businessId, r.kind, r.id);
      await load(); onChanged();
    } catch (e) { setError(mapApiError(e, tErr)); }
    finally { setBusyId(null); }
  };

  const onPurge = async (r: TrashedContent) => {
    setBusyId(keyOf(r)); setError(null);
    try {
      await purgeContent(businessId, r.kind, r.id);
      await load(); onChanged();
    } catch (e) { setError(mapApiError(e, tErr)); }
    finally { setBusyId(null); }
  };

  return (
    <>
      <DetailDrawer open={open} onClose={onClose} width={460}
        ariaLabel={t('trash.title', { defaultValue: '휴지통' }) as string}>
        <DetailDrawer.Header onClose={onClose}>
          <HeadTitle>{t('trash.title', { defaultValue: '휴지통' })}</HeadTitle>
          {retentionDays != null && (
            <HeadHint>{t('trash.retentionDays', { count: retentionDays, defaultValue: '삭제 후 {{count}}일 안에는 되돌릴 수 있어요' }) as string}</HeadHint>
          )}
        </DetailDrawer.Header>
        <DetailDrawer.Body>
          {error && <ErrLine>{error}</ErrLine>}
          {loading && <Dim>{t('trash.loading', { defaultValue: '불러오는 중…' })}</Dim>}
          {!loading && rows.length === 0 && (
            <EmptyState title={t('trash.empty', { defaultValue: '휴지통이 비어 있어요' }) as string} />
          )}
          {!loading && rows.map((r) => (
            <Row key={keyOf(r)} data-testid="content-trash-row">
              <RowMain>
                <KindTag $kb={r.kind === 'kb'}>
                  {r.kind === 'kb'
                    ? t('trash.kindKb', { defaultValue: '정보' })
                    : t('trash.kindPost', { defaultValue: '문서' })}
                </KindTag>
                <RowTitle title={r.title}>{r.title}</RowTitle>
              </RowMain>
              <RowMeta>
                {new Date(r.deleted_at).toLocaleString()}
                {r.author?.name ? ` · ${r.author.name}` : ''}
                {!r.restorable && ` · ${t('trash.expired', { defaultValue: '보관 기간 지남' })}`}
              </RowMeta>
              <RowActions>
                <ActionButton tone="secondary" size="sm"
                  data-testid="content-trash-restore"
                  disabled={!r.restorable || busyId === keyOf(r)}
                  onClick={() => onRestore(r)}>
                  {t('trash.restore', { defaultValue: '복원' })}
                </ActionButton>
                <ActionButton tone="danger" size="sm"
                  disabled={busyId === keyOf(r)}
                  onClick={() => setPurgeTarget(r)}>
                  {t('trash.purge', { defaultValue: '영구 삭제' })}
                </ActionButton>
              </RowActions>
            </Row>
          ))}
        </DetailDrawer.Body>
      </DetailDrawer>

      <ConfirmDialog
        isOpen={!!purgeTarget}
        onClose={() => setPurgeTarget(null)}
        onConfirm={() => { const tgt = purgeTarget; setPurgeTarget(null); if (tgt) void onPurge(tgt); }}
        title={t('trash.purgeTitle', { defaultValue: '영구 삭제' }) as string}
        message={t('trash.purgeMessage', {
          title: purgeTarget?.title || '',
          defaultValue: '"{{title}}" 을(를) 완전히 지웁니다. 이 작업은 되돌릴 수 없습니다.',
        }) as string}
        confirmText={t('trash.purge', { defaultValue: '영구 삭제' }) as string}
        cancelText={t('trash.cancel', { defaultValue: '취소' }) as string}
        variant="danger"
      />
    </>
  );
};

export default ContentTrashDrawer;

const HeadTitle = styled.div`font-size: 1rem; font-weight: 700; color: #0F172A;`;
const HeadHint = styled.div`font-size: 0.75rem; color: #64748B; margin-top: 2px;`;
const Row = styled.div`
  padding: 12px 0; border-bottom: 1px solid #F1F5F9;
  display: flex; flex-direction: column; gap: 6px;
`;
const RowMain = styled.div`display: flex; align-items: center; gap: 8px; min-width: 0;`;
const KindTag = styled.span<{ $kb?: boolean }>`
  flex-shrink: 0; font-size: 0.6875rem; font-weight: 700; padding: 2px 6px; border-radius: 4px;
  color: ${p => (p.$kb ? '#7C3AED' : '#0F766E')};
  background: ${p => (p.$kb ? '#F3E8FF' : '#F0FDFA')};
`;
const RowTitle = styled.div`
  font-size: 0.875rem; font-weight: 600; color: #0F172A;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0;
`;
const RowMeta = styled.div`font-size: 0.75rem; color: #94A3B8;`;
const RowActions = styled.div`display: flex; gap: 6px;`;
const Dim = styled.div`font-size: 0.8125rem; color: #94A3B8; padding: 16px 0;`;
const ErrLine = styled.div`font-size: 0.75rem; color: #DC2626; padding: 8px 0;`;
