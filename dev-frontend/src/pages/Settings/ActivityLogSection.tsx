// ActivityLogSection — 팀원 활동 기록 (워크스페이스 owner/admin 전용).
//
// 왜 생겼나 (Irene 2026-08-31)
//   "팀원 활동기록(히스토리)로그 어디에 남지? 이거 제대로 남아야 해.
//    혹시라도 잘못해서 삭제하고 문제되면 책임여부 문제고"
//   기록은 **이미 남고 있었다**(운영 감사로그 896건 · 삭제 액션 포함). 그런데
//   `GET /api/activity/:businessId` 를 **부르는 화면이 한 곳도 없었다** —
//   책임을 따질 데이터는 있는데 볼 수가 없었다(만들어 놓고 읽는 곳이 없는 계열).
//
// 스트림은 services/event_stream 이 감사로그·업무·청구·메시지를 시간순으로 병합해 준다.
// 여기서는 그것을 그대로 보여주고 **누가·언제·무엇을** 만 분명히 한다.
import React, { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../contexts/AuthContext';
import ActionButton from '../../components/Common/ActionButton';
import EmptyState from '../../components/Common/EmptyState';

interface ActivityEvent {
  id: string;
  source: string;
  kind: string;
  at: string;
  actor_user_id: number | null;
  actor_name: string | null;
  actor_is_ai?: boolean;
  entity_type: string | null;
  entity_id: number | null;
  summary: string | null;
}

/** 삭제·영구삭제는 책임 소재가 걸린 행이라 눈에 띄게 둔다 */
const isDestructive = (kind: string) => /delete|purge|remove|삭제/i.test(kind || '');

const PAGE = 100;

const ActivityLogSection: React.FC<{ businessId: number | null }> = ({ businessId }) => {
  const { t } = useTranslation('org');
  const [rows, setRows] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [onlyDestructive, setOnlyDestructive] = useState(false);
  const [limit, setLimit] = useState(PAGE);

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true); setError(null);
    try {
      const r = await apiFetch(`/api/activity/${businessId}?limit=${limit}`);
      if (!r.ok) {
        const j = await r.json().catch(() => null);
        // owner/admin 전용 — 권한이 없으면 그 사실을 그대로 말한다(빈 화면으로 두지 않는다)
        setError(j?.message === 'owner_only'
          ? (t('activity.ownerOnly', { defaultValue: '워크스페이스 관리자만 볼 수 있어요' }) as string)
          : (t('activity.loadFailed', { defaultValue: '활동 기록을 불러오지 못했어요' }) as string));
        setRows([]);
        return;
      }
      const j = await r.json();
      setRows(j.success ? (j.data as ActivityEvent[]) : []);
    } finally { setLoading(false); }
  }, [businessId, limit, t]);

  useEffect(() => { void load(); }, [load]);

  const visible = onlyDestructive ? rows.filter((r) => isDestructive(r.kind)) : rows;

  return (
    <Wrap>
      <Head>
        <div>
          <Title>{t('activity.title', { defaultValue: '팀원 활동 기록' })}</Title>
          <Hint>{t('activity.hint', { defaultValue: '누가 언제 무엇을 했는지 남습니다. 삭제도 기록됩니다.' })}</Hint>
        </div>
        <HeadRight>
          <Check>
            <input type="checkbox" checked={onlyDestructive}
              onChange={(e) => setOnlyDestructive(e.target.checked)} />
            {t('activity.onlyDelete', { defaultValue: '삭제만 보기' })}
          </Check>
          <ActionButton tone="secondary" size="sm" onClick={() => void load()} loading={loading}>
            {t('activity.refresh', { defaultValue: '새로고침' })}
          </ActionButton>
        </HeadRight>
      </Head>

      {error && <ErrLine>{error}</ErrLine>}
      {!error && !loading && visible.length === 0 && (
        <EmptyState title={t('activity.empty', { defaultValue: '아직 기록이 없어요' }) as string} />
      )}

      {visible.length > 0 && (
        <List data-testid="activity-list">
          {visible.map((e) => (
            <Row key={e.id} $danger={isDestructive(e.kind)}>
              <When>{new Date(e.at).toLocaleString()}</When>
              <Who>{e.actor_name || t('activity.unknownActor', { defaultValue: '알 수 없음' })}</Who>
              <What $danger={isDestructive(e.kind)}>{e.summary || e.kind}</What>
              <Where>{e.entity_type ? `${e.entity_type}${e.entity_id ? ` #${e.entity_id}` : ''}` : ''}</Where>
            </Row>
          ))}
        </List>
      )}

      {visible.length > 0 && rows.length >= limit && (
        <MoreWrap>
          <ActionButton tone="secondary" size="sm" onClick={() => setLimit((v) => v + PAGE)} loading={loading}>
            {t('activity.more', { defaultValue: '더 보기' })}
          </ActionButton>
        </MoreWrap>
      )}
    </Wrap>
  );
};

export default ActivityLogSection;

const Wrap = styled.div`display: flex; flex-direction: column; gap: 12px;`;
const Head = styled.div`
  display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap;
`;
const HeadRight = styled.div`display: flex; align-items: center; gap: 10px;`;
const Title = styled.div`font-size: 0.9375rem; font-weight: 700; color: #0F172A;`;
const Hint = styled.div`font-size: 0.75rem; color: #64748B; margin-top: 2px;`;
const Check = styled.label`
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 0.75rem; color: #475569; cursor: pointer;
`;
const List = styled.div`display: flex; flex-direction: column;`;
const Row = styled.div<{ $danger?: boolean }>`
  display: grid;
  grid-template-columns: 150px 120px 1fr 120px;
  gap: 10px; align-items: center;
  padding: 8px 10px; border-bottom: 1px solid #F1F5F9;
  font-size: 0.8125rem;
  background: ${p => (p.$danger ? '#FEF2F2' : 'transparent')};
  /* 폰 — 격자를 풀어 두 줄로. 고정 px 격자는 좁은 화면에서 반드시 넘친다. */
  @media (max-width: 640px) {
    grid-template-columns: 1fr; gap: 2px; padding: 10px 8px;
  }
`;
const When = styled.div`color: #94A3B8; white-space: nowrap;`;
const Who = styled.div`color: #0F172A; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`;
const What = styled.div<{ $danger?: boolean }>`
  color: ${p => (p.$danger ? '#B91C1C' : '#334155')};
  font-weight: ${p => (p.$danger ? 600 : 400)};
  overflow-wrap: anywhere;
`;
const Where = styled.div`color: #94A3B8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`;
const MoreWrap = styled.div`display: flex; justify-content: center; padding: 8px 0;`;
const ErrLine = styled.div`font-size: 0.8125rem; color: #DC2626; padding: 10px 0;`;
