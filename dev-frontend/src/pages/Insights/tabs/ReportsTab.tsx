import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import { fetchTab, generateReport, type RangePreset } from '../../../services/insights';
import { ErrorBanner, SkeletonGrid, SkeletonCard } from '../components';
import { mapApiError } from '../../../utils/apiError';

interface Report {
  id: number; kind: string; title: string | null;
  period_from: string; period_to: string; created_at: string;
  pdf_url: string | null; share_url: string | null; status: string;
}
interface Data {
  reports: Report[];
  next_auto_at: string;
  auto_kinds: string[];
}

type Kind = 'monthly' | 'quarterly' | 'yearly';

const ReportsTab: React.FC<{ businessId: number; range: RangePreset }> = ({ businessId }) => {
  const { t } = useTranslation('insights');
  const { t: tErr } = useTranslation('errors');
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [generating, setGenerating] = useState<Kind | null>(null);
  const [genErr, setGenErr] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const reload = () => {
    setLoading(true);
    return fetchTab<Data>(businessId, 'reports')
      .then((d) => { setData(d); setErr(null); })
      .catch((e) => setErr(e?.message || 'failed'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [businessId]);

  const handleGenerate = async (kind: Kind) => {
    if (generating) return;
    setGenerating(kind);
    setGenErr(null);
    try {
      await generateReport(businessId, kind);
      await reload();
    } catch (e) {
      setGenErr(mapApiError(e, tErr));
    } finally {
      setGenerating(null);
    }
  };

  const handleCopyShare = async (report: Report) => {
    if (!report.share_url) return;
    const absUrl = `${window.location.origin}${report.share_url}`;
    try {
      await navigator.clipboard.writeText(absUrl);
      setCopiedId(report.id);
      setTimeout(() => setCopiedId(null), 1800);
    } catch {
      // fallback — 복사 실패 시 prompt 로 대체
      window.prompt(t('reports.share', '공유 링크 복사') as string, absUrl);
    }
  };

  if (err) return <ErrorBanner>{t('error.summary')} — {err}</ErrorBanner>;
  if (loading || !data) return <SkeletonGrid>{[0, 1, 2].map((i) => <SkeletonCard key={i} />)}</SkeletonGrid>;

  return (
    <>
      <NextAutoBox>
        <NextAutoLabel>{t('reports.nextAuto')}</NextAutoLabel>
        <NextAutoDate>{data.next_auto_at}</NextAutoDate>
        <NextAutoHint>{t('reports.nextAutoHint')}</NextAutoHint>
      </NextAutoBox>

      <GenRow>
        <GenBtn type="button" onClick={() => handleGenerate('monthly')} disabled={!!generating}>
          {generating === 'monthly' ? t('reports.gen.loading') : t('reports.gen.btnMonthly')}
        </GenBtn>
        <GenBtn type="button" onClick={() => handleGenerate('quarterly')} disabled={!!generating}>
          {generating === 'quarterly' ? t('reports.gen.loading') : t('reports.gen.btnQuarterly')}
        </GenBtn>
        <GenBtn type="button" onClick={() => handleGenerate('yearly')} disabled={!!generating}>
          {generating === 'yearly' ? t('reports.gen.loading') : t('reports.gen.btnYearly')}
        </GenBtn>
      </GenRow>
      {genErr && <GenErrBox>{t('reports.gen.error')}: {genErr}</GenErrBox>}

      <Heading>{t('reports.recent')}</Heading>
      {data.reports.length === 0 ? (
        <EmptyBox>
          <EmptyTitle>{t('reports.empty.title')}</EmptyTitle>
          <EmptyHint>{t('reports.empty.hint')}</EmptyHint>
        </EmptyBox>
      ) : (
        <Grid>
          {data.reports.map((r) => (
            <Card key={r.id}>
              <CardKind>{t(`reports.kind.${r.kind}`, r.kind)}</CardKind>
              <CardPeriod>{r.period_from} ~ {r.period_to}</CardPeriod>
              <CardCreated>{r.created_at?.slice(0, 10)}</CardCreated>
              {r.status === 'ready' && r.share_url ? (
                <CardActions>
                  <CardLink href={r.share_url} target="_blank" rel="noopener noreferrer">
                    {t('reports.download')}
                  </CardLink>
                  <ShareBtn type="button" onClick={() => handleCopyShare(r)}>
                    {copiedId === r.id ? t('reports.shareCopied') : t('reports.share')}
                  </ShareBtn>
                </CardActions>
              ) : (
                <CardStatus $failed={r.status === 'failed'}>
                  {t(`reports.status.${r.status}`, r.status)}
                </CardStatus>
              )}
            </Card>
          ))}
        </Grid>
      )}
    </>
  );
};

export default ReportsTab;

const NextAutoBox = styled.div`
  background: linear-gradient(135deg, #F0FDFA 0%, #FFFFFF 100%);
  border: 1px solid #CCFBF1; border-radius: 12px;
  padding: 20px; margin-bottom: 16px;
  display: flex; flex-direction: column; gap: 4px;
`;
const NextAutoLabel = styled.div`font-size: 11px; font-weight: 700; color: #0F766E; text-transform: uppercase; letter-spacing: 0.4px;`;
const NextAutoDate = styled.div`font-size: 22px; font-weight: 700; color: #0F172A; line-height: 1.2;`;
const NextAutoHint = styled.div`font-size: 12px; color: #64748B;`;

const GenRow = styled.div`
  display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px;
`;
const GenBtn = styled.button`
  padding: 9px 14px; background: #14B8A6; color: #FFFFFF;
  border: none; border-radius: 8px; font-size: 12px; font-weight: 700; cursor: pointer;
  transition: background 0.15s;
  &:hover:not(:disabled) { background: #0F766E; }
  &:disabled { background: #CBD5E1; cursor: not-allowed; }
`;
const GenErrBox = styled.div`
  margin-bottom: 12px; padding: 10px 12px;
  background: #FEF2F2; border: 1px solid #FCA5A5; border-radius: 8px;
  font-size: 12px; color: #B91C1C;
`;

const Heading = styled.h2`font-size: 13px; font-weight: 700; color: #0F172A; margin: 18px 0 12px;`;
const EmptyBox = styled.div`
  background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 12px;
  padding: 40px 20px; text-align: center; display: flex; flex-direction: column; gap: 8px; align-items: center;
`;
const EmptyTitle = styled.div`font-size: 14px; font-weight: 700; color: #0F172A;`;
const EmptyHint = styled.div`font-size: 12px; color: #64748B; max-width: 360px; line-height: 1.5;`;

const Grid = styled.div`display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px;`;
const Card = styled.div`
  background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 12px;
  padding: 16px; display: flex; flex-direction: column; gap: 4px;
`;
const CardKind = styled.div`font-size: 11px; font-weight: 700; color: #0F766E; text-transform: uppercase; letter-spacing: 0.4px;`;
const CardPeriod = styled.div`font-size: 14px; font-weight: 700; color: #0F172A;`;
const CardCreated = styled.div`font-size: 11px; color: #94A3B8;`;
const CardActions = styled.div`
  margin-top: 10px; display: flex; align-items: center; gap: 12px;
  padding-top: 8px; border-top: 1px solid #F1F5F9;
`;
const CardLink = styled.a`
  font-size: 12px; font-weight: 600; color: #0F766E; text-decoration: none;
  &:hover { text-decoration: underline; }
`;
const ShareBtn = styled.button`
  background: transparent; border: 1px solid #E2E8F0; color: #475569;
  padding: 4px 8px; border-radius: 6px; font-size: 11px; font-weight: 500;
  cursor: pointer; transition: background 0.15s, border-color 0.15s;
  &:hover { background: #F8FAFC; border-color: #CBD5E1; }
`;
const CardStatus = styled.div<{ $failed?: boolean }>`
  margin-top: 10px; padding-top: 8px; border-top: 1px solid #F1F5F9;
  font-size: 11px; font-weight: 500; color: ${(p) => (p.$failed ? '#B91C1C' : '#94A3B8')};
`;
