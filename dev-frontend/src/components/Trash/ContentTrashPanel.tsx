// ContentTrashPanel — 휴지통의 «문서»·«정보» 칸. 서랍 껍데기는 components/Trash/TrashDrawer 한 곳이다.
//
// 왜 생겼나 (Irene 2026-08-31): "모든 이메일 노트 문서 인포 파일 삭제들이 휴지통에 존재할 수 있게 가능해?"
//   여태 문서·정보는 하드 DELETE 라 되돌릴 방법이 없었다.
// ★ 2026-09-22 — 파일 휴지통과 서랍·버튼이 갈라져 있었고 **Q info 에는 여는 문이 없었다**
//   (정보를 지우면 Q docs 휴지통에서만 되살릴 수 있었다). 목록만 이 칸으로 남기고 서랍을 하나로 합쳤다.
//
// 계약(파일 칸과 같다): 복원 가능 여부는 서버가 판정(restorable) · 보관기간은 요금제에서 온다.
import React, { useCallback, useEffect, useState } from 'react';
import { listRowTitleCss } from '../../theme/tokens';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import ConfirmDialog from '../Common/ConfirmDialog';
import ActionButton from '../Common/ActionButton';
import EmptyState from '../Common/EmptyState';
import { fetchContentTrash, restoreContent, purgeContent, type TrashedContent } from '../../services/posts';
import { mapApiError } from '../../utils/apiError';
import { useTimeFormat } from '../../hooks/useTimeFormat';

interface Props {
  active: boolean;
  businessId: number;
  /** 보여 줄 종류 — 문서 탭은 ['post'], 정보 탭은 ['kb'], 전체는 둘 다 */
  kinds: Array<'post' | 'kb'>;
  onChanged: () => void;
  onRetention?: (days: number | null) => void;
  onCount?: (n: number) => void;
}

const ContentTrashPanel: React.FC<Props> = ({ active, businessId, kinds, onChanged, onRetention, onCount }) => {
  const { t } = useTranslation('qdocs');
  const { t: tErr } = useTranslation('errors');
  // 날짜는 파일 칸과 같은 앱 공통 형식 — 브라우저 기본(toLocaleString)이면 한국어 화면에 영어 날짜가 섞였다
  const { formatDate } = useTimeFormat();
  const [rows, setRows] = useState<TrashedContent[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [purgeTarget, setPurgeTarget] = useState<TrashedContent | null>(null);
  // null = 서버가 판단 못 함 → 보관 문구를 그리지 않는다(요금제마다 기간이 다르다).
  const [retentionDays, setRetentionDays] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!active || !businessId) return;
    setLoading(true); setError(null);
    try {
      const page = await fetchContentTrash(businessId);
      setRows(page.items);
      setRetentionDays(page.retentionDays);
    }
    finally { setLoading(false); }
  }, [active, businessId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { onRetention?.(retentionDays); }, [retentionDays, onRetention]);
  const kindKey = kinds.join(',');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const shown = React.useMemo(() => rows.filter((r) => kinds.includes(r.kind)), [rows, kindKey]);
  useEffect(() => { if (!loading) onCount?.(shown.length); }, [shown.length, loading, onCount]);

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
      <div>
          {error && <ErrLine>{error}</ErrLine>}
          {loading && <Dim>{t('trash.loading', { defaultValue: '불러오는 중…' })}</Dim>}
          {!loading && shown.length === 0 && (
            <EmptyState title={t('trash.empty', { defaultValue: '휴지통이 비어 있어요' }) as string} />
          )}
          {!loading && shown.map((r) => (
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
                {formatDate(r.deleted_at)}
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
      </div>

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

export default ContentTrashPanel;


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
  ${listRowTitleCss}
   font-weight: 600; color: #0F172A;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0;
`;
const RowMeta = styled.div`font-size: 0.75rem; color: #94A3B8;`;
const RowActions = styled.div`display: flex; gap: 6px;`;
const Dim = styled.div`font-size: 0.8125rem; color: #94A3B8; padding: 16px 0;`;
const ErrLine = styled.div`font-size: 0.75rem; color: #DC2626; padding: 8px 0;`;
