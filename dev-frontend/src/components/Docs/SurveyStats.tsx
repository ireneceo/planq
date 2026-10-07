// 표 «통계» 보기 (#460) — 칸별 집계. 설문 응답이든 손으로 넣은 줄이든 표의 모든 줄을 센다.
//   서버 GET /api/records/:id/survey-stats (표를 볼 수 있는 사람 = 문서 읽기 술어). 비밀 칸은 서버가 뺀다.
import { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { fetchSurveyStats, type SurveyColumnStat } from '../../services/qtable';
import { onSocket } from '../../services/socket';

const SurveyStats: React.FC<{ recordId: number }> = ({ recordId }) => {
  const { t } = useTranslation('qtable');
  const [data, setData] = useState<{ total: number; survey_count: number; columns: SurveyColumnStat[] } | null>(null);
  const [err, setErr] = useState(false);

  const load = useCallback(async () => {
    try { setData(await fetchSurveyStats(recordId)); setErr(false); } catch { setErr(true); }
  }, [recordId]);
  useEffect(() => { load(); }, [load]);
  // 새 응답이 들어오면 다시 센다(신호만 온다 — 화면이 다시 읽는다)
  useEffect(() => onSocket<{ id: number }>('record:row', (p) => { if (p?.id === recordId) load(); }), [recordId, load]);

  if (err) return <Empty>{t('stats.failed', '통계를 불러오지 못했어요.')}</Empty>;
  if (!data) return <Empty>{t('detail.loading', '불러오는 중...')}</Empty>;
  if (data.total === 0) return <Empty data-testid="survey-stats-empty">{t('stats.empty', '아직 응답이 없어요. 응답이 들어오면 칸별로 모아 보여 드려요.')}</Empty>;

  const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);
  return (
    <Wrap data-testid="survey-stats">
      <Summary>
        {t('stats.summary', { defaultValue: '전체 {{total}}줄 · 설문 응답 {{survey}}건', total: data.total, survey: data.survey_count }) as string}
      </Summary>
      {data.columns.map((c) => (
        <Card key={c.id}>
          <CardHead><span>{c.name}</span><Sub>{t('stats.answered', { defaultValue: '응답 {{n}}', n: c.answered }) as string}</Sub></CardHead>
          {c.counts && (
            <Bars>
              {Object.entries(c.counts).map(([k, n]) => (
                <BarRow key={k}>
                  <BarLabel title={k}>{c.type === 'checkbox' ? (k === 'true' ? t('stats.yes', '예') : t('stats.no', '아니오')) : k}</BarLabel>
                  <BarTrack><BarFill style={{ width: `${pct(n, c.answered)}%` }} /></BarTrack>
                  <BarNum>{n} · {pct(n, c.answered)}%</BarNum>
                </BarRow>
              ))}
            </Bars>
          )}
          {c.type === 'number' && (
            <Nums>
              <span>{t('stats.avg', '평균')} <b>{c.avg ?? '–'}</b></span>
              <span>{t('stats.min', '최소')} <b>{c.min ?? '–'}</b></span>
              <span>{t('stats.max', '최대')} <b>{c.max ?? '–'}</b></span>
            </Nums>
          )}
          {c.by_day && (
            <List>{Object.entries(c.by_day).sort(([a], [b]) => (a < b ? 1 : -1)).slice(0, 14).map(([d, n]) => <li key={d}>{d} · {n}</li>)}</List>
          )}
          {c.recent && (
            c.recent.length ? <List>{c.recent.map((x, i) => <li key={i}>{x}</li>)}</List> : <Sub>{t('stats.noText', '아직 적힌 답이 없어요.')}</Sub>
          )}
        </Card>
      ))}
    </Wrap>
  );
};

export default SurveyStats;

const Wrap = styled.div`display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(min(100%, 320px), 1fr));`;
const Summary = styled.div`grid-column: 1 / -1; font-size: 0.8125rem; color: #475569;`;
const Card = styled.div`border: 1px solid #E2E8F0; border-radius: 12px; padding: 14px; background: #FFF; display: flex; flex-direction: column; gap: 10px; min-width: 0;`;
const CardHead = styled.div`display: flex; justify-content: space-between; gap: 8px; font-size: 0.875rem; font-weight: 700; color: #0F172A;`;
const Sub = styled.span`font-size: 0.75rem; font-weight: 500; color: #94A3B8;`;
const Bars = styled.div`display: flex; flex-direction: column; gap: 6px;`;
const BarRow = styled.div`display: grid; grid-template-columns: minmax(0, 96px) 1fr auto; align-items: center; gap: 8px;`;
const BarLabel = styled.span`font-size: 0.8125rem; color: #334155; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`;
const BarTrack = styled.div`height: 8px; background: #F1F5F9; border-radius: 999px; overflow: hidden;`;
const BarFill = styled.div`height: 100%; background: #14B8A6; border-radius: 999px;`;
const BarNum = styled.span`font-size: 0.75rem; color: #64748B; white-space: nowrap;`;
const Nums = styled.div`display: flex; gap: 16px; font-size: 0.8125rem; color: #475569; b { color: #0F172A; }`;
const List = styled.ul`margin: 0; padding-left: 18px; font-size: 0.8125rem; color: #334155; display: flex; flex-direction: column; gap: 4px; max-height: 240px; overflow: auto; li { word-break: break-word; }`;
const Empty = styled.div`padding: 32px 16px; text-align: center; font-size: 0.875rem; color: #94A3B8;`;
