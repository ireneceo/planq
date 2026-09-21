// 플랫폼 관리자 > 랜딩 방문 (2026-09-21) — 쿠키 없는 우리 집계. 서버: dev-backend/routes/landing_visits.js
//   Irene: "방문자가 왜 이렇게 적어" → 잴 도구가 없었다. 랜딩(공개 소개·인사이트·Q위키)만 센다.
//   «들어온 방문» 은 사이트 안 이동을 뺀 것, 페이지별은 사이트 안 이동까지 센다(어느 페이지가 읽히는지).
import { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import PageShell from '../../components/Layout/PageShell';
import EmptyState from '../../components/Common/EmptyState';
import PlanQSelect, { type PlanQSelectOption } from '../../components/Common/PlanQSelect';
import { apiFetch } from '../../contexts/AuthContext';
import { useVisibilityRefresh } from '../../hooks/useVisibilityRefresh';

interface Row { key: string; views: number }
interface Data {
  days: number; since: string;
  totals: { entries: number; visitor_days: number };
  daily: Array<{ date: string; views: number; visitors: number }>;
  pages: Row[]; sources: Row[]; devices: Row[];
}

export default function AdminLandingVisitsPage() {
  const { t } = useTranslation('admin');
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await apiFetch(`/api/landing-visits/admin?days=${days}`);
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.success) { setErr(j?.message || `HTTP ${r.status}`); return; }
      setData(j.data); setErr(null);
    } finally { setLoading(false); }
  }, [days]);
  useEffect(() => { setLoading(true); void load(); }, [load]);
  useVisibilityRefresh(() => { void load(); });

  const dayOptions: PlanQSelectOption[] = [7, 30, 90, 180].map((d) => ({ value: String(d), label: t('landingVisits.lastDays', { count: d }) as string }));
  const max = Math.max(1, ...(data?.daily || []).map((d) => d.views));
  const srcLabel = (k: string) => (['direct', 'naver', 'google', 'daum/kakao', 'bing'].includes(k) ? t(`landingVisits.src.${k.replace('/', '_')}`) as string : k);

  return (
    <PageShell
      title={t('landingVisits.title') as string}
      actions={(
        <SelWrap>
          <PlanQSelect size="sm" isSearchable={false} isClearable={false}
            value={dayOptions.find((o) => o.value === String(days))} options={dayOptions}
            onChange={(o) => setDays(Number((o as PlanQSelectOption)?.value) || 30)} />
        </SelWrap>
      )}
    >
      <Note>{t('landingVisits.note')}</Note>
      {err && <ErrLine>{err}</ErrLine>}
      {loading && !data ? (
        <Dim>{t('landingVisits.loading')}</Dim>
      ) : !data || data.daily.length === 0 ? (
        <EmptyState title={t('landingVisits.emptyTitle') as string} description={t('landingVisits.emptyDesc') as string} />
      ) : (
        <>
          <Stats>
            <Stat data-testid="lv-entries"><StatNum>{data.totals.entries.toLocaleString()}</StatNum><StatLabel>{t('landingVisits.entries')}</StatLabel></Stat>
            <Stat data-testid="lv-visitors"><StatNum>{data.totals.visitor_days.toLocaleString()}</StatNum><StatLabel>{t('landingVisits.visitors')}</StatLabel></Stat>
          </Stats>

          <Card>
            <CardTitle>{t('landingVisits.daily')}</CardTitle>
            <Bars>
              {data.daily.map((d) => (
                <BarRow key={d.date}>
                  <BarDate>{d.date.slice(5)}</BarDate>
                  <BarTrack><BarFill style={{ width: `${Math.round((d.views / max) * 100)}%` }} /></BarTrack>
                  <BarNum>{d.views}</BarNum>
                  <BarSub>{t('landingVisits.visitorsShort', { count: d.visitors })}</BarSub>
                </BarRow>
              ))}
            </Bars>
          </Card>

          <Grid>
            <Card>
              <CardTitle>{t('landingVisits.topPages')}</CardTitle>
              <Table>{data.pages.map((r) => <TRow key={r.key}><TKey title={r.key}>{r.key}</TKey><TNum>{r.views}</TNum></TRow>)}</Table>
            </Card>
            <Card>
              <CardTitle>{t('landingVisits.sources')}</CardTitle>
              <Table>{data.sources.map((r) => <TRow key={r.key}><TKey title={r.key}>{srcLabel(r.key)}</TKey><TNum>{r.views}</TNum></TRow>)}</Table>
              <CardTitle $gap>{t('landingVisits.devices')}</CardTitle>
              <Table>{data.devices.map((r) => <TRow key={r.key}><TKey>{t(`landingVisits.dev.${r.key}`)}</TKey><TNum>{r.views}</TNum></TRow>)}</Table>
            </Card>
          </Grid>
        </>
      )}
    </PageShell>
  );
}

const SelWrap = styled.div`min-width: 130px;`;
const Note = styled.p`margin: 0 0 14px; font-size: 0.75rem; color: #64748b; line-height: 1.5;`;
const ErrLine = styled.div`margin-bottom: 12px; font-size: 0.8125rem; color: #b91c1c;`;
const Dim = styled.div`padding: 40px 0; text-align: center; color: #94a3b8; font-size: 0.8125rem;`;
const Stats = styled.div`display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 14px;`;
const Stat = styled.div`background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 14px 16px;`;
const StatNum = styled.div`font-size: 1.5rem; font-weight: 700; color: #0f172a; font-variant-numeric: tabular-nums;`;
const StatLabel = styled.div`font-size: 0.75rem; color: #64748b; margin-top: 2px;`;
const Card = styled.div`background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 14px 16px; margin-bottom: 14px; min-width: 0;`;
const CardTitle = styled.div<{ $gap?: boolean }>`font-size: 0.8125rem; font-weight: 700; color: #0f172a; margin: ${(p) => (p.$gap ? '14px 0 8px' : '0 0 8px')};`;
const Bars = styled.div`display: flex; flex-direction: column; gap: 4px;`;
const BarRow = styled.div`display: grid; grid-template-columns: 44px minmax(0, 1fr) 40px 64px; align-items: center; gap: 8px; font-size: 0.75rem;`;
const BarDate = styled.span`color: #64748b; font-variant-numeric: tabular-nums;`;
const BarTrack = styled.div`height: 8px; background: #f1f5f9; border-radius: 4px; overflow: hidden;`;
const BarFill = styled.div`height: 100%; background: #14b8a6; border-radius: 4px;`;
const BarNum = styled.span`text-align: right; font-weight: 600; color: #0f172a; font-variant-numeric: tabular-nums;`;
const BarSub = styled.span`color: #94a3b8; font-variant-numeric: tabular-nums;`;
const Grid = styled.div`display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 14px;`;
const Table = styled.div`display: flex; flex-direction: column;`;
const TRow = styled.div`display: flex; justify-content: space-between; gap: 12px; padding: 6px 0; border-bottom: 1px solid #f1f5f9; font-size: 0.8125rem; &:last-child { border-bottom: none; }`;
const TKey = styled.span`color: #334155; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`;
const TNum = styled.span`color: #0f172a; font-weight: 600; font-variant-numeric: tabular-nums; flex-shrink: 0;`;
