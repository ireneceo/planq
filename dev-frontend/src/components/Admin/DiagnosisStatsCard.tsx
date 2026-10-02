// 자가진단 통계 (#426) — 플랫폼 관리자 > 문의 인박스에서 «자가진단» 을 고르면 위에 뜬다.
//   «케이스를 확인하고 고객데이터 쌓게» 의 자리. 수치는 서버(GET /api/diagnosis/admin/stats)가 센다.
import React, { useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../contexts/AuthContext';

const LAYERS = ['structure', 'workflow', 'information', 'decision', 'automation', 'platform'] as const;

interface Stats {
  days: number; count: number; with_email: number; capped: boolean;
  avg: Record<string, number>; weakest: Record<string, number>;
  industry: Record<string, number>; team_size: Record<string, number>;
}

const DiagnosisStatsCard: React.FC = () => {
  const { t } = useTranslation('common');
  const { t: tl } = useTranslation('landing');
  const [s, setS] = useState<Stats | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let dead = false;
    apiFetch('/api/diagnosis/admin/stats?days=90').then((r) => r.json()).then((j) => {
      if (dead) return;
      if (j.success) setS(j.data as Stats); else setFailed(true);
    }).catch(() => { if (!dead) setFailed(true); });
    return () => { dead = true; };
  }, []);
  if (failed) return <Card><Muted>{t('adminInq.diagStats.failed')}</Muted></Card>;
  if (!s) return null;
  const layer = (k: string) => tl(`diagnosisPage.layers.${k}`) as string;
  return (
    <Card data-testid="diagnosis-stats">
      <Head>
        <Title>{t('adminInq.diagStats.title', { days: s.days })}</Title>
        <Muted>{t('adminInq.diagStats.counts', { count: s.count, email: s.with_email })}</Muted>
      </Head>
      <Grid>
        {LAYERS.map((l) => (
          <Row key={l}>
            <Lbl>{layer(l)}</Lbl>
            <Track><Fill style={{ width: `${((s.avg[l] || 0) / 4) * 100}%` }} /></Track>
            <Num>{(s.avg[l] || 0).toFixed(1)}</Num>
            <Num>{t('adminInq.diagStats.weakestN', { n: s.weakest[l] || 0 })}</Num>
          </Row>
        ))}
      </Grid>
    </Card>
  );
};

export default DiagnosisStatsCard;

const Card = styled.div`background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 12px; padding: 16px; margin-bottom: 12px;`;
const Head = styled.div`display: flex; justify-content: space-between; align-items: baseline; gap: 8px; flex-wrap: wrap; margin-bottom: 10px;`;
const Title = styled.div`font-size: 0.875rem; font-weight: 700; color: #0F172A;`;
const Muted = styled.div`font-size: 0.75rem; color: #64748B;`;
const Grid = styled.div`display: flex; flex-direction: column; gap: 8px;`;
const Row = styled.div`display: grid; grid-template-columns: minmax(80px, 120px) 1fr 36px 80px; gap: 10px; align-items: center;`;
const Lbl = styled.div`font-size: 0.75rem; color: #334155;`;
const Track = styled.div`height: 8px; border-radius: 4px; background: #E2E8F0; overflow: hidden;`;
const Fill = styled.div`height: 100%; background: #14B8A6;`;
const Num = styled.div`font-size: 0.75rem; color: #64748B; text-align: right; font-variant-numeric: tabular-nums;`;
