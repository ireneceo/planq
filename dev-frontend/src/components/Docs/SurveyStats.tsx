// 설문 «통계» 탭 — 칸(문항)별 집계. 설계 docs/SURVEY_V2_DESIGN.md §4.1·§8.2
//   숫자는 서버(services/surveyStats.js) 한 곳이 셈한다 — 화면은 다시 셈하지 않고 그대로 그린다(분포 막대의 % 만 화면이 나눈다).
//   범위: 전체 / 회차 하나 / 기간. 분모는 항상 «거른 집합 안에서 그 문항에 답한 수».
import { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { fetchSurveyStats, fetchSurveyIssues, type SurveyColumnStat, type SurveyStatsData, type SurveyIssueView } from '../../services/qtable';
import { onSocket } from '../../services/socket';
import PlanQSelect, { type PlanQSelectOption } from '../Common/PlanQSelect';
import SingleDateField from '../Common/SingleDateField';
import { formatDay } from '../../utils/dateFormat';

const SurveyStats: React.FC<{ recordId: number }> = ({ recordId }) => {
  const { t } = useTranslation('qtable');
  const [data, setData] = useState<SurveyStatsData | null>(null);
  const [err, setErr] = useState(false);
  const [issues, setIssues] = useState<SurveyIssueView[] | null>(null);
  const [issueId, setIssueId] = useState<number | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const load = useCallback(async () => {
    try { setData(await fetchSurveyStats(recordId, { issueId, from, to })); setErr(false); } catch { setErr(true); }
  }, [recordId, issueId, from, to]);
  useEffect(() => { load(); }, [load]);
  // 회차 고르기는 관리할 수 있는 사람에게만(목록이 403 이면 칩을 숨긴다)
  useEffect(() => {
    let alive = true;
    fetchSurveyIssues(recordId).then((r) => { if (alive) setIssues(r.issues.filter((i) => i.status === 'sent')); }).catch(() => { if (alive) setIssues(null); });
    return () => { alive = false; };
  }, [recordId]);
  // 새 응답이 들어오면 다시 센다(신호만 온다 — 화면이 다시 읽는다)
  useEffect(() => onSocket<{ id: number }>('record:row', (p) => { if (p?.id === recordId) load(); }), [recordId, load]);

  const roundOpts: PlanQSelectOption[] = [
    { value: '', label: t('stats.scope.all', '전체') as string },
    ...(issues || []).map((i) => ({ value: String(i.id), label: `#${i.id} · ${formatDay(new Date(i.sent_at || i.created_at))} · ${i.counts.total}${t('stats.people', '명')}` })),
  ];

  const scopeBar = (
    <ScopeBar data-testid="survey-stats-scope">
      {issues && issues.length > 0 && (
        <ScopeItem>
          <ScopeLabel>{t('stats.scope.round', '회차')}</ScopeLabel>
          <ScopeSelect>
            <PlanQSelect size="sm" isSearchable={false} options={roundOpts}
              value={roundOpts.find((o) => o.value === (issueId ? String(issueId) : '')) || roundOpts[0]}
              onChange={(o) => { const v = (o as PlanQSelectOption | null)?.value; setIssueId(v ? Number(v) : null); }} />
          </ScopeSelect>
        </ScopeItem>
      )}
      <ScopeItem>
        <ScopeLabel>{t('stats.scope.period', '기간')}</ScopeLabel>
        <DateBox><SingleDateField value={from} onChange={(d) => setFrom(d || '')} /></DateBox>
        <span aria-hidden="true">~</span>
        <DateBox><SingleDateField value={to} onChange={(d) => setTo(d || '')} /></DateBox>
      </ScopeItem>
    </ScopeBar>
  );

  if (err) return <Empty>{t('stats.failed', '통계를 불러오지 못했어요.')}</Empty>;
  if (!data) return <Empty>{t('detail.loading', '불러오는 중...')}</Empty>;

  const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);
  const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0');
  const card = (c: SurveyColumnStat) => {
    if (c.type === 'rating') {
      const max = Math.max(1, ...Object.values(c.dist || {}));
      return (
        <>
          <Big data-testid={`stats-avg-${c.id}`}>{c.avg == null ? '–' : c.avg.toFixed(1)}<BigUnit>/ 5</BigUnit></Big>
          <Bars>
            {[5, 4, 3, 2, 1].map((k) => { const n = c.dist?.[k] || 0; return (
              <BarRow key={k}><BarLabel>{'★'.repeat(k)}</BarLabel><BarTrack><BarFill $w={(n / max) * 100} $tone="amber" /></BarTrack><BarNum>{n} · {pct(n, c.answered)}%</BarNum></BarRow>
            ); })}
          </Bars>
        </>
      );
    }
    if (c.type === 'scale') {
      const p = c.promoters || 0; const ps = c.passives || 0; const d = c.detractors || 0; const tot = p + ps + d;
      const max = Math.max(1, ...Object.values(c.dist || {}));
      return (
        <>
          <NpsRow>
            <div>
              <SmallLabel>{t('stats.nps', '추천지수 (NPS)')}</SmallLabel>
              <Big data-testid={`stats-nps-${c.id}`} $tone={c.nps == null ? undefined : c.nps > 0 ? 'good' : c.nps < 0 ? 'bad' : undefined}>{c.nps == null ? '–' : signed(c.nps)}</Big>
            </div>
            <div>
              <SmallLabel>{t('stats.avg', '평균')}</SmallLabel>
              <Mid>{c.avg == null ? '–' : c.avg.toFixed(1)}</Mid>
            </div>
          </NpsRow>
          {tot > 0 && (
            <>
              <Band aria-hidden="true">
                <BandSeg style={{ width: `${(d / tot) * 100}%` }} $c="#F43F5E" />
                <BandSeg style={{ width: `${(ps / tot) * 100}%` }} $c="#CBD5E1" />
                <BandSeg style={{ width: `${(p / tot) * 100}%` }} $c="#14B8A6" />
              </Band>
              <Legend>
                <span><Dot $c="#F43F5E" />{t('stats.detractors', '비추천 (0~6)')} {d} · {pct(d, tot)}%</span>
                <span><Dot $c="#CBD5E1" />{t('stats.passives', '중립 (7~8)')} {ps} · {pct(ps, tot)}%</span>
                <span><Dot $c="#14B8A6" />{t('stats.promoters', '추천 (9~10)')} {p} · {pct(p, tot)}%</span>
              </Legend>
            </>
          )}
          <Columns>
            {Array.from({ length: 11 }, (_, k) => { const n = c.dist?.[k] || 0; return (
              <ColBar key={k} title={`${k}: ${n}`}><ColFill style={{ height: `${(n / max) * 100}%` }} $c={k >= 9 ? '#14B8A6' : k <= 6 ? '#F43F5E' : '#CBD5E1'} /><ColLabel>{k}</ColLabel></ColBar>
            ); })}
          </Columns>
        </>
      );
    }
    if (c.type === 'yesno') {
      const y = c.counts?.true || 0; const n = c.counts?.false || 0;
      return (
        <>
          <Big>{c.yes_pct == null ? '–' : `${c.yes_pct}%`}<BigUnit>{t('stats.yesShare', '예')}</BigUnit></Big>
          <Bars>
            <BarRow><BarLabel>{t('stats.yes', '예')}</BarLabel><BarTrack><BarFill $w={pct(y, c.answered)} /></BarTrack><BarNum>{y} · {pct(y, c.answered)}%</BarNum></BarRow>
            <BarRow><BarLabel>{t('stats.no', '아니오')}</BarLabel><BarTrack><BarFill $w={pct(n, c.answered)} $tone="slate" /></BarTrack><BarNum>{n} · {pct(n, c.answered)}%</BarNum></BarRow>
          </Bars>
        </>
      );
    }
    return (
      <>
        {c.counts && (
          <Bars>
            {Object.entries(c.counts).map(([k, n]) => (
              <BarRow key={k}>
                <BarLabel title={k}>{c.type === 'checkbox' ? (k === 'true' ? t('stats.yes', '예') : t('stats.no', '아니오')) : k}</BarLabel>
                <BarTrack><BarFill $w={pct(n, c.answered)} /></BarTrack>
                <BarNum>{n} · {pct(n, c.answered)}%</BarNum>
              </BarRow>
            ))}
            {c.type === 'multi_select' && <Sub>{t('stats.multiHint', '여러 개를 고를 수 있어 합이 100% 를 넘을 수 있어요')}</Sub>}
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
          <List>{Object.entries(c.by_day).sort(([a], [b]) => (a < b ? 1 : -1)).slice(0, 14).map(([dd, n]) => <li key={dd}>{dd} · {n}</li>)}</List>
        )}
        {c.recent && (
          c.recent.length ? <List>{c.recent.map((x, i) => <li key={i}>{x}</li>)}</List> : <Sub>{t('stats.noText', '아직 적힌 답이 없어요.')}</Sub>
        )}
      </>
    );
  };

  return (
    <Outer>
      {scopeBar}
      {data.total === 0 ? (
        <Empty data-testid="survey-stats-empty">{t('stats.empty', '아직 응답이 없어요. 응답이 들어오면 문항별로 모아 보여 드려요.')}</Empty>
      ) : (
        <Wrap data-testid="survey-stats">
          <Summary>{t('stats.summaryV2', { defaultValue: '응답 {{total}}건', total: data.total }) as string}</Summary>
          {data.columns.map((c) => (
            <Card key={c.id} data-testid={`stats-card-${c.type}`}>
              <CardHead><span>{c.name}</span><Sub>{t('stats.answered', { defaultValue: '응답 {{n}}', n: c.answered }) as string}</Sub></CardHead>
              {card(c)}
            </Card>
          ))}
        </Wrap>
      )}
    </Outer>
  );
};

export default SurveyStats;

const Outer = styled.div`display: flex; flex-direction: column; gap: 12px;`;
const ScopeBar = styled.div`display: flex; flex-wrap: wrap; gap: 12px 20px; align-items: center;`;
const ScopeItem = styled.div`display: flex; align-items: center; gap: 8px; flex-wrap: wrap;`;
const ScopeLabel = styled.span`font-size: 0.75rem; font-weight: 700; color: #64748B;`;
const ScopeSelect = styled.div`width: 240px; max-width: 70vw;`;
const DateBox = styled.div`width: 150px;`;
const Wrap = styled.div`display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(min(100%, 320px), 1fr));`;
const Summary = styled.div`grid-column: 1 / -1; font-size: 0.8125rem; color: #475569;`;
const Card = styled.div`border: 1px solid #E2E8F0; border-radius: 12px; padding: 14px; background: #FFF; display: flex; flex-direction: column; gap: 10px; min-width: 0;`;
const CardHead = styled.div`display: flex; justify-content: space-between; gap: 8px; font-size: 0.875rem; font-weight: 700; color: #0F172A;`;
const Sub = styled.span`font-size: 0.75rem; font-weight: 500; color: #94A3B8;`;
const Big = styled.div<{ $tone?: 'good' | 'bad' }>`
  font-size: 2rem; font-weight: 800; letter-spacing: -0.5px; line-height: 1.1;
  color: ${(p) => (p.$tone === 'good' ? '#0F766E' : p.$tone === 'bad' ? '#BE123C' : '#0F172A')};
  display: flex; align-items: baseline; gap: 6px;
`;
const BigUnit = styled.span`font-size: 0.8125rem; font-weight: 600; color: #94A3B8;`;
const Mid = styled.div`font-size: 1.25rem; font-weight: 700; color: #0F172A;`;
const SmallLabel = styled.div`font-size: 0.6875rem; font-weight: 700; color: #64748B; margin-bottom: 2px;`;
const NpsRow = styled.div`display: flex; gap: 24px; align-items: flex-end;`;
const Band = styled.div`display: flex; height: 8px; border-radius: 999px; overflow: hidden; background: #F1F5F9;`;
const BandSeg = styled.div<{ $c: string }>`height: 100%; background: ${(p) => p.$c};`;
const Legend = styled.div`display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 0.75rem; color: #475569;`;
const Dot = styled.i<{ $c: string }>`display: inline-block; width: 8px; height: 8px; border-radius: 2px; background: ${(p) => p.$c}; margin-right: 4px;`;
const Columns = styled.div`display: grid; grid-template-columns: repeat(11, 1fr); gap: 3px; height: 72px; align-items: end;`;
const ColBar = styled.div`display: flex; flex-direction: column; justify-content: flex-end; height: 100%; gap: 2px;`;
const ColFill = styled.div<{ $c: string }>`background: ${(p) => p.$c}; border-radius: 3px 3px 0 0; min-height: 1px;`;
const ColLabel = styled.span`font-size: 0.625rem; color: #94A3B8; text-align: center;`;
const Bars = styled.div`display: flex; flex-direction: column; gap: 6px;`;
const BarRow = styled.div`display: grid; grid-template-columns: minmax(0, 96px) 1fr auto; align-items: center; gap: 8px;`;
const BarLabel = styled.span`font-size: 0.8125rem; color: #334155; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`;
const BarTrack = styled.div`height: 8px; background: #F1F5F9; border-radius: 999px; overflow: hidden;`;
const BarFill = styled.div<{ $w: number; $tone?: 'amber' | 'slate' }>`
  height: 100%; width: ${(p) => p.$w}%; border-radius: 999px;
  background: ${(p) => (p.$tone === 'amber' ? '#F59E0B' : p.$tone === 'slate' ? '#94A3B8' : '#14B8A6')};
`;
const BarNum = styled.span`font-size: 0.75rem; color: #64748B; white-space: nowrap;`;
const Nums = styled.div`display: flex; gap: 16px; font-size: 0.8125rem; color: #475569; b { color: #0F172A; }`;
const List = styled.ul`margin: 0; padding-left: 18px; font-size: 0.8125rem; color: #334155; display: flex; flex-direction: column; gap: 4px; max-height: 240px; overflow: auto; li { word-break: break-word; }`;
const Empty = styled.div`padding: 32px 16px; text-align: center; font-size: 0.875rem; color: #94A3B8;`;
