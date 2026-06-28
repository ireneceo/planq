// Tasks & Time 탭 — Irene 강조 포인트 (예측 vs AI vs 실제)
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  ScatterChart, Scatter, XAxis, YAxis, ZAxis, Tooltip, ReferenceLine, ResponsiveContainer,
  LineChart, Line, CartesianGrid, Legend,
} from 'recharts';
import styled from 'styled-components';
import { fetchTasksTab, type TasksTabData, type TaskTableRow, type RangePreset } from '../../../services/insights';
import PlanQSelect from '../../../components/Common/PlanQSelect';
import {
  InsightRow, InsightCard, InsightStripe, InsightBody, InsightTitle, InsightValue, InsightHint, InsightAction,
  KpiGrid, KpiCard, KpiLabel, KpiValueBig, KpiHint,
  SectionLabel, SectionRow, DownloadBtn, DownloadIcon, ChartCard, ChartEmpty,
  TableWrap, Table, Tr, Th, Td,
  SkeletonGrid, SkeletonCard, ErrorBanner,
  fmtNum, fmtPct,
} from '../components';
import { downloadRowsAsCsv } from '../csvUtils';

const TasksTab: React.FC<{ businessId: number; range: RangePreset }> = ({ businessId, range }) => {
  const { t } = useTranslation('insights');
  const navigate = useNavigate();
  const [data, setData] = useState<TasksTabData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  // 고급 필터 (백엔드 assignee_id/category/source 지원). 옵션은 필터 무관 안정 유지 위해 unfiltered 시점에 박제.
  const [fAssignee, setFAssignee] = useState<number | null>(null);
  const [fCategory, setFCategory] = useState<string | null>(null);
  const [fSource, setFSource] = useState<string | null>(null);
  const [optAssignees, setOptAssignees] = useState<{ id: number; name: string }[]>([]);
  const [optCategories, setOptCategories] = useState<string[]>([]);

  useEffect(() => {
    setLoading(true);
    fetchTasksTab(businessId, range, true, { assignee_id: fAssignee, category: fCategory, source: fSource })
      .then((d) => {
        setData(d); setErr(null);
        // 필터 없을 때만 옵션 박제 (필터로 데이터가 좁아져도 드롭다운 옵션 유지)
        if (!fAssignee && !fCategory && !fSource) {
          const am = new Map<number, string>();
          (d.scatter || []).forEach((p) => { if (p.assignee_id) am.set(p.assignee_id, p.assignee_name || `#${p.assignee_id}`); });
          setOptAssignees([...am.entries()].map(([id, name]) => ({ id, name })));
          setOptCategories((d.categories_pareto || []).map((c) => c.category));
        }
      })
      .catch((e) => setErr(e?.message || 'failed'))
      .finally(() => setLoading(false));
  }, [businessId, range, fAssignee, fCategory, fSource]);

  if (err && !data) return <ErrorBanner>{t('error.summary')} — {err}</ErrorBanner>;
  if (!data) return <SkeletonGrid>{[0,1,2,3,4,5].map((i) => <SkeletonCard key={i} />)}</SkeletonGrid>;

  const srcKeys = ['manual', 'internal_request', 'qtalk_extract'];
  return (
    <>
      <FilterBar>
        <PlanQSelect size="sm" isClearable placeholder={t('filter.assignee', { defaultValue: '담당자 전체' }) as string}
          value={fAssignee == null ? null : { value: String(fAssignee), label: optAssignees.find(a => a.id === fAssignee)?.name || String(fAssignee) }}
          onChange={(v) => setFAssignee((v as { value?: string })?.value ? Number((v as { value: string }).value) : null)}
          options={optAssignees.map(a => ({ value: String(a.id), label: a.name }))} />
        <PlanQSelect size="sm" isClearable placeholder={t('filter.category', { defaultValue: '카테고리 전체' }) as string}
          value={fCategory == null ? null : { value: fCategory, label: fCategory }}
          onChange={(v) => setFCategory((v as { value?: string })?.value || null)}
          options={optCategories.map(c => ({ value: c, label: c }))} />
        <PlanQSelect size="sm" isClearable placeholder={t('filter.source', { defaultValue: '출처 전체' }) as string}
          value={fSource == null ? null : { value: fSource, label: t(`filter.src.${fSource}`, { defaultValue: fSource }) as string }}
          onChange={(v) => setFSource((v as { value?: string })?.value || null)}
          options={srcKeys.map(s => ({ value: s, label: t(`filter.src.${s}`, { defaultValue: s }) as string }))} />
        {loading && <FilterLoading>{t('filter.loading', { defaultValue: '불러오는 중…' }) as string}</FilterLoading>}
      </FilterBar>
      <InsightRow>
        {data.insights.map((ins, i) => (
          <InsightCard key={i} $severity={ins.severity} $clickable={!!ins.action_link}
            onClick={() => ins.action_link && navigate(ins.action_link)}>
            <InsightStripe $severity={ins.severity} />
            <InsightBody>
              <InsightTitle>{ins.title}</InsightTitle>
              <InsightValue>{ins.value}</InsightValue>
              {ins.hint && <InsightHint>{ins.hint}</InsightHint>}
              {ins.action_label && <InsightAction>{ins.action_label} →</InsightAction>}
            </InsightBody>
          </InsightCard>
        ))}
      </InsightRow>

      <KpiGrid>
        <KpiCard>
          <KpiLabel>{t('kpi.completed', '완료 업무')}</KpiLabel>
          <KpiValueBig>{fmtNum(data.kpis.completed.value)}</KpiValueBig>
          {data.kpis.completed.delta_pct != null && (
            <KpiDelta $positive={data.kpis.completed.delta_pct >= 0}>{fmtPct(data.kpis.completed.delta_pct, { signed: true })}</KpiDelta>
          )}
        </KpiCard>
        <KpiCard>
          <KpiLabel>{t('kpi.created', '생성 업무')}</KpiLabel>
          <KpiValueBig>{fmtNum(data.kpis.created.value)}</KpiValueBig>
          {data.kpis.created.delta_pct != null && (
            <KpiDelta $positive={data.kpis.created.delta_pct >= 0}>{fmtPct(data.kpis.created.delta_pct, { signed: true })}</KpiDelta>
          )}
        </KpiCard>
        <KpiCard>
          <KpiLabel>{t('kpi.leadtime50', '평균 리드타임 (p50)')}</KpiLabel>
          <KpiValueBig>{fmtNum(data.kpis.leadtime_p50_days.value, t('unit.days', '일') as string)}</KpiValueBig>
        </KpiCard>
        <KpiCard>
          <KpiLabel>{t('kpi.leadtime90', '리드타임 p90')}</KpiLabel>
          <KpiValueBig>{fmtNum(data.kpis.leadtime_p90_days.value, t('unit.days', '일') as string)}</KpiValueBig>
        </KpiCard>
        <KpiCard>
          <KpiLabel>{t('kpi.bias', '편차 (Bias)')}</KpiLabel>
          <KpiValueBig>{fmtPct(data.kpis.bias_pct.value, { signed: true })}</KpiValueBig>
          <KpiHint>
            {data.kpis.bias_pct.value == null ? '—'
              : data.kpis.bias_pct.value > 10 ? t('kpi.biasUnder', '과소추정 경향')
              : data.kpis.bias_pct.value < -10 ? t('kpi.biasOver', '과대추정 경향')
              : t('kpi.biasStable', '안정')}
          </KpiHint>
        </KpiCard>
        <KpiCard>
          <KpiLabel>{t('kpi.aiAccuracy', 'AI 정확도')}</KpiLabel>
          <KpiValueBig>{fmtPct(data.kpis.ai_accuracy_pct.value)}</KpiValueBig>
          <KpiHint>{t('kpi.aiAccuracyHint', 'AI 추정 vs 실제')}</KpiHint>
        </KpiCard>
      </KpiGrid>

      {(data.in_progress_watch?.length ?? 0) > 0 && (
        <>
          <SectionLabel>{t('watch.title', '진행중 예산초과 경고')}</SectionLabel>
          <TableWrap>
            <Table>
              <thead>
                <Tr>
                  <Th>{t('watch.col.task', '업무')}</Th>
                  <Th>{t('watch.col.assignee', '담당')}</Th>
                  <Th $num>{t('watch.col.estimated', '예측(h)')}</Th>
                  <Th $num>{t('watch.col.actual', '실제(h)')}</Th>
                  <Th $num>{t('watch.col.over', '초과')}</Th>
                </Tr>
              </thead>
              <tbody>
                {data.in_progress_watch!.map((w) => (
                  <Tr key={w.task_id}>
                    <Td>{w.title}</Td>
                    <Td>{w.assignee_name || '—'}</Td>
                    <Td $num>{fmtNum(w.estimated)}</Td>
                    <Td $num>{fmtNum(w.actual)}</Td>
                    <Td $num><OverPct>+{w.over_pct}%</OverPct></Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        </>
      )}

      <SectionLabel style={{ marginTop: 24 }}>{t('chart.scatter.title', '예측 vs 실제 (담당자별)')}</SectionLabel>
      <ChartCard>
        {data.scatter.length === 0 ? (
          <ChartEmpty>{t('chart.scatter.empty', '완료된 업무 + 예측·실제 시간 데이터가 누적되면 표시됩니다')}</ChartEmpty>
        ) : (
          <ResponsiveContainer width="100%" height={360}>
            <ScatterChart margin={{ top: 16, right: 24, bottom: 32, left: 24 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
              <XAxis type="number" dataKey="user_estimate" tick={{ fontSize: 11, fill: '#64748B' }}
                label={{ value: t('chart.axis.estimate', '예측 (시간)') as string, position: 'insideBottom', offset: -8, fill: '#64748B', fontSize: 11 }} />
              <YAxis type="number" dataKey="actual" tick={{ fontSize: 11, fill: '#64748B' }}
                label={{ value: t('chart.axis.actual', '실제 (시간)') as string, angle: -90, position: 'insideLeft', fill: '#64748B', fontSize: 11 }} />
              <ZAxis range={[60, 60]} />
              <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 100, y: 100 }]} stroke="#14B8A6" strokeDasharray="4 4" />
              <Tooltip cursor={{ strokeDasharray: '3 3' }} content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0].payload;
                return (
                  <TooltipBox>
                    <div><strong>{p.title}</strong></div>
                    <div>{p.assignee_name || '—'}</div>
                    <div>{t('chart.tooltip.estimate', '예측')}: {p.user_estimate}h</div>
                    <div>{t('chart.tooltip.actual', '실제')}: {p.actual}h</div>
                    {p.accuracy_pct != null && <div>{t('chart.tooltip.accuracy', '정확도')}: {p.accuracy_pct.toFixed(0)}%</div>}
                  </TooltipBox>
                );
              }} />
              <Scatter data={data.scatter} fill="#14B8A6" />
            </ScatterChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      <SectionLabel style={{ marginTop: 24 }}>{t('chart.aiTrend.title', 'AI 정확도 추이 (월별 MAPE)')}</SectionLabel>
      <ChartCard>
        {data.ai_trend.length === 0 ? (
          <ChartEmpty>{t('chart.aiTrend.empty', '월별 데이터가 누적되면 표시됩니다')}</ChartEmpty>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={data.ai_trend.map((d) => ({
              month: d.month,
              ai_mape_pct: d.ai_mape == null ? null : d.ai_mape * 100,
              user_mape_pct: d.user_mape == null ? null : d.user_mape * 100,
            }))} margin={{ top: 16, right: 24, bottom: 8, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#64748B' }} />
              <YAxis unit="%" tick={{ fontSize: 11, fill: '#64748B' }} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="ai_mape_pct" name={t('chart.aiTrend.aiLabel', 'AI MAPE') as string} stroke="#F43F5E" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="user_mape_pct" name={t('chart.aiTrend.userLabel', '사용자 MAPE') as string} stroke="#14B8A6" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      <SectionRow style={{ marginTop: 24 }}>
        <SectionLabel>{t('table.title', '업무 상세')}</SectionLabel>
        <DownloadBtn type="button" disabled={data.table.length === 0}
          onClick={() => downloadRowsAsCsv(`tasks_${data.period.from}_${data.period.to}.csv`, data.table, [
            { key: 'task_id', header: t('table.col.id', 'ID') as string },
            { key: 'title', header: t('table.col.title', '업무') as string },
            { key: 'assignee', header: t('table.col.assignee', '담당') as string },
            { key: 'category', header: t('table.col.category', '카테고리') as string },
            { key: 'user_est', header: t('table.col.userEst', '예측(h)') as string },
            { key: 'ai_est', header: t('table.col.aiEst', 'AI(h)') as string },
            { key: 'actual', header: t('table.col.actual', '실제(h)') as string },
            { key: 'accuracy_pct', header: t('table.col.accuracy', '정확도') as string },
            { key: 'leadtime_days', header: t('table.col.leadtime', '리드타임') as string },
            { key: 'status', header: t('table.col.status', '상태') as string },
          ])}>
          <DownloadIcon /> {t('download.csv', 'CSV (Excel)')}
        </DownloadBtn>
      </SectionRow>
      {data.table.length === 0 ? (
        <ChartCard><ChartEmpty>{t('table.empty', '완료된 업무가 없습니다')}</ChartEmpty></ChartCard>
      ) : (
        <TableWrap>
          <Table>
            <thead>
              <Tr>
                <Th>{t('table.col.title', '업무')}</Th>
                <Th>{t('table.col.assignee', '담당')}</Th>
                <Th $num>{t('table.col.userEst', '예측(h)')}</Th>
                <Th $num>{t('table.col.aiEst', 'AI(h)')}</Th>
                <Th $num>{t('table.col.actual', '실제(h)')}</Th>
                <Th $num>{t('table.col.accuracy', '정확도')}</Th>
                <Th $num>{t('table.col.leadtime', '리드타임')}</Th>
              </Tr>
            </thead>
            <tbody>
              {data.table.slice(0, 50).map((r: TaskTableRow) => (
                <Tr key={r.task_id} $clickable onClick={() => navigate(`/tasks?task=${r.task_id}`)}>
                  <Td>{r.title}</Td>
                  <Td>{r.assignee || '—'}</Td>
                  <Td $num>{r.user_est ?? '—'}</Td>
                  <Td $num>{r.ai_est ?? '—'}</Td>
                  <Td $num>{r.actual ?? '—'}</Td>
                  <Td $num>{r.accuracy_pct != null ? r.accuracy_pct.toFixed(0) + '%' : '—'}</Td>
                  <Td $num>{r.leadtime_days != null ? r.leadtime_days + 'd' : '—'}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      )}
    </>
  );
};

export default TasksTab;

const KpiDelta = styled.div<{ $positive: boolean }>`
  font-size: 12px; font-weight: 700;
  color: ${(p) => (p.$positive ? '#16A34A' : '#DC2626')};
`;
const TooltipBox = styled.div`
  background: #0F172A; color: #FFFFFF; padding: 10px 12px; border-radius: 8px;
  font-size: 11px; line-height: 1.6; & strong { color: #5EEAD4; }
`;

const FilterBar = styled.div`
  display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 16px;
  & > * { min-width: 160px; }
`;
const FilterLoading = styled.span`font-size: 12px; color: #94A3B8; min-width: auto;`;

const OverPct = styled.span`color: #EF4444; font-weight: 700;`;
