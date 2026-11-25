// 지우기·범위 좁히기 확인창 안의 «연결된 곳» 경고 (2026-11-25 · docs/FILE_USAGE_DESIGN.md §8·9)
//   막지 않고 알린다 — 휴지통이라 되돌릴 수 있다. 연결 0이면 아무것도 그리지 않는다(지금 문구 그대로).
//   mode: delete(단건·여러 개·폴더째) | narrow(공개 범위 좁히기)
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import { fetchUsageSummary, type UsageSummary } from './fileUsageApi';
import { UsagePlaceRow } from './FileUsagePanel';

export function useUsageSummary(businessId: number | null | undefined, target: { fileIds?: number[]; folderId?: number } | null): UsageSummary | null | undefined {
  const [s, setS] = useState<UsageSummary | null | undefined>(undefined);   // undefined = 읽는 중
  const key = target ? `${target.folderId || ''}|${(target.fileIds || []).join(',')}` : '';
  useEffect(() => {
    if (!businessId || !target || (!target.folderId && !(target.fileIds || []).length)) { setS(null); return; }
    let alive = true;
    setS(undefined);
    fetchUsageSummary(businessId, target.folderId ? { folder_id: target.folderId } : { file_ids: target.fileIds })
      .then((r) => { if (alive) setS(r); }).catch(() => { if (alive) setS(null); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId, key]);
  return s;
}

const UsageWarning: React.FC<{ summary: UsageSummary | null | undefined; mode: 'delete' | 'narrow' }> = ({ summary, mode }) => {
  const { t } = useTranslation('qfile');
  if (summary === undefined) return <Muted data-testid="usage-warning-loading">{t('usage.checking', { defaultValue: '연결된 곳을 확인하는 중…' })}</Muted>;
  if (!summary) return null;
  const n = summary.live_places;
  const copy = summary.copy_places;
  if (n === 0 && !(mode === 'delete' && copy > 0)) return null;
  const more = Math.max(0, n - summary.top.length - (summary.hidden_places || 0));
  return (
    <Box data-testid={`usage-warning-${mode}`} role="note">
      {n > 0 && (
        <Lead>{mode === 'delete'
          ? t('usage.warnDelete', { n, defaultValue: '이 파일이 연결된 {{n}}곳에서 빠집니다. 휴지통에서 복구하면 돌아옵니다.' })
          : t('usage.warnNarrow', { n, defaultValue: '이 파일이 붙은 {{n}}곳에서, 새 공개 범위 밖의 사람에게는 보이지 않게 됩니다.' })}</Lead>
      )}
      {summary.top.map((p) => <UsagePlaceRow key={`${p.kind}-${p.id}`} place={p} />)}
      {more > 0 && <Muted>{t('usage.more', { n: more, defaultValue: '외 {{n}}곳' })}</Muted>}
      {(summary.hidden_places || 0) > 0 && <Muted>{t('usage.hidden', { n: summary.hidden_places, defaultValue: '볼 수 없는 곳 {{n}}곳' })}</Muted>}
      {mode === 'delete' && copy > 0 && <Muted data-testid="usage-warning-copy">{t('usage.copyStays', { n: copy, defaultValue: '업무·채팅에 올린 사본 {{n}}곳은 그대로 남습니다.' })}</Muted>}
      {summary.truncated && <Muted>{t('usage.truncated', { defaultValue: '파일이 많아 앞의 200개만 확인했습니다.' })}</Muted>}
    </Box>
  );
};

export default UsageWarning;

const Box = styled.div`
  display: flex; flex-direction: column; gap: 2px; margin: 10px 0 4px; padding: 10px 12px;
  border: 1px solid #FDE68A; background: #FFFBEB; border-radius: 8px; text-align: left;
`;
const Lead = styled.div`font-size: 0.8125rem; font-weight: 600; color: #92400E; margin-bottom: 4px;`;
const Muted = styled.div`font-size: 0.75rem; color: #64748B;`;
