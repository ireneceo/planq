// 파일 상세 «연결된 곳» — 이 파일이 어느 문서·업무·채팅·일정·프로젝트·청구에 쓰이는지 (2026-11-25 · docs/FILE_USAGE_DESIGN.md §14)
//   미리보기의 «출처» 한 줄(처음 하나·누를 수 없음)을 대신한다. 줄을 누르면 그곳을 새 탭으로 연다(하던 일 위에 얹는 진입점).
//   세 묶음: 연결된 곳(원본이 빠지면 그곳에서 빠진다) · 사본으로 쓰인 곳(지워도 그대로) · 볼 수 없는 곳(숫자만).
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import { tabStore } from '../../stores/tabStore';
import { onSocket } from '../../services/socket';
import { fetchFileUsage, type FileUsage, type UsagePlace, type UsageKind } from './fileUsageApi';

export function usageKindLabel(kind: UsageKind, t: (k: string, o?: Record<string, unknown>) => string): string {
  return t(`usage.kind.${kind}`, { defaultValue: kind });
}

export const UsagePlaceRow: React.FC<{ place: UsagePlace; testid?: string }> = ({ place, testid }) => {
  const { t } = useTranslation('qfile');
  return (
    <Row type="button" data-testid={testid} onClick={() => tabStore.openInNewTab(place.link)} title={place.title}>
      <Kind $kind={place.kind}>{usageKindLabel(place.kind, t)}</Kind>
      <Name>{place.title || t('usage.untitled', { defaultValue: '(제목 없음)' })}</Name>
    </Row>
  );
};

const FileUsagePanel: React.FC<{ businessId: number; fileId: number }> = ({ businessId, fileId }) => {
  const { t } = useTranslation('qfile');
  const [data, setData] = useState<FileUsage | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    const r = await fetchFileUsage(businessId, fileId).catch(() => null);
    setFailed(!r);
    setData(r);
  }, [businessId, fileId]);

  useEffect(() => { setData(null); void load(); }, [load]);
  // 다른 사람이 붙이거나 떼면 다시 읽는다(신호만 — id 로 다시 묻는다)
  useEffect(() => {
    let tm: ReturnType<typeof setTimeout> | null = null;
    const again = () => { if (tm) clearTimeout(tm); tm = setTimeout(() => { void load(); }, 250); };
    const offs = ['file:updated', 'file:deleted', 'post:updated'].map((ev) => onSocket(ev, again));
    return () => { if (tm) clearTimeout(tm); offs.forEach((off) => off()); };
  }, [load]);

  const hidden = data?.hidden || 0;
  const empty = !!data && data.live.length === 0 && data.copy.length === 0 && hidden === 0;
  return (
    <Wrap data-testid="file-usage-panel">
      <Label>{t('usage.title', { defaultValue: '연결된 곳' })}</Label>
      {!data && !failed && <Muted>{t('usage.loading', { defaultValue: '불러오는 중…' })}</Muted>}
      {failed && <Muted>{t('usage.failed', { defaultValue: '연결된 곳을 불러오지 못했습니다.' })}</Muted>}
      {empty && <Muted data-testid="file-usage-empty">{t('usage.empty', { defaultValue: '아직 연결된 곳이 없습니다.' })}</Muted>}
      {data && data.live.length > 0 && (
        <Group>
          <GroupHead>{t('usage.liveHead', { n: data.live.length, defaultValue: '연결 {{n}}곳 — 이 파일을 지우면 여기서 빠집니다' })}</GroupHead>
          {data.live.map((p) => <UsagePlaceRow key={`${p.kind}-${p.id}`} place={p} testid={`file-usage-live-${p.kind}-${p.id}`} />)}
        </Group>
      )}
      {data && data.copy.length > 0 && (
        <Group>
          <GroupHead>{t('usage.copyHead', { n: data.copy.length, defaultValue: '사본 {{n}}곳 — 업무·채팅에 올린 사본이라 지워도 그대로 남습니다' })}</GroupHead>
          {data.copy.map((p) => <UsagePlaceRow key={`${p.kind}-${p.id}`} place={p} testid={`file-usage-copy-${p.kind}-${p.id}`} />)}
        </Group>
      )}
      {hidden > 0 && <Muted data-testid="file-usage-hidden">{t('usage.hidden', { n: hidden, defaultValue: '볼 수 없는 곳 {{n}}곳' })}</Muted>}
    </Wrap>
  );
};

export default FileUsagePanel;

const Wrap = styled.div`display: flex; flex-direction: column; gap: 6px; margin-top: 14px;`;
const Label = styled.div`font-size: 0.6875rem; font-weight: 700; color: #64748B; text-transform: uppercase; letter-spacing: 0.4px;`;
const Group = styled.div`display: flex; flex-direction: column; gap: 2px;`;
const GroupHead = styled.div`font-size: 0.75rem; color: #64748B; margin: 2px 0;`;
const Muted = styled.div`font-size: 0.8125rem; color: #94A3B8;`;
const Row = styled.button`
  display: flex; align-items: center; gap: 8px; width: 100%; min-width: 0; min-height: 36px;
  padding: 6px 8px; border: 0; border-radius: 6px; background: transparent; cursor: pointer; text-align: left;
  font-size: 0.8125rem; color: #0F172A;
  &:hover { background: #F1F5F9; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 1px; }
  @media (max-width: 640px) { min-height: 40px; }
`;
const Kind = styled.span<{ $kind: string }>`
  flex-shrink: 0; padding: 1px 6px; border-radius: 4px; font-size: 0.6875rem; font-weight: 600;
  background: ${(p) => (p.$kind === 'invoice' ? '#FEF3C7' : '#F1F5F9')}; color: ${(p) => (p.$kind === 'invoice' ? '#92400E' : '#475569')};
`;
const Name = styled.span`min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`;
