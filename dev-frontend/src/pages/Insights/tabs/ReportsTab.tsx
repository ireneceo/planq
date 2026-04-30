import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import { fetchTab, type RangePreset } from '../../../services/insights';
import { ErrorBanner, SkeletonGrid, SkeletonCard } from '../components';

interface Report {
  id: number; kind: string; period_from: string; period_to: string;
  created_at: string; pdf_url: string | null; status: string;
}
interface Data {
  reports: Report[];
  next_auto_at: string;
  auto_kinds: string[];
}

const ReportsTab: React.FC<{ businessId: number; range: RangePreset }> = ({ businessId }) => {
  const { t } = useTranslation('insights');
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetchTab<Data>(businessId, 'reports')
      .then((d) => { setData(d); setErr(null); })
      .catch((e) => setErr(e?.message || 'failed'))
      .finally(() => setLoading(false));
  }, [businessId]);

  if (err) return <ErrorBanner>{t('error.summary')} — {err}</ErrorBanner>;
  if (loading || !data) return <SkeletonGrid>{[0, 1, 2].map((i) => <SkeletonCard key={i} />)}</SkeletonGrid>;

  return (
    <>
      <NextAutoBox>
        <NextAutoLabel>{t('reports.nextAuto', '다음 자동 생성 보고서')}</NextAutoLabel>
        <NextAutoDate>{data.next_auto_at}</NextAutoDate>
        <NextAutoHint>{t('reports.nextAutoHint', '매월 1일 새벽에 월간 보고서가 자동 생성됩니다.')}</NextAutoHint>
      </NextAutoBox>

      <Heading>{t('reports.recent', '최근 생성된 보고서')}</Heading>
      {data.reports.length === 0 ? (
        <EmptyBox>
          <EmptyTitle>{t('reports.empty.title', '아직 생성된 보고서가 없습니다')}</EmptyTitle>
          <EmptyHint>{t('reports.empty.hint', '한 달 이상 운영된 후 자동 생성되거나, 아래 버튼으로 즉시 생성할 수 있습니다.')}</EmptyHint>
          <GenBtn type="button" disabled title={t('reports.gen.disabled', '준비 중') as string}>
            {t('reports.gen.btn', '지금 보고서 생성')}
          </GenBtn>
        </EmptyBox>
      ) : (
        <Grid>
          {data.reports.map((r) => (
            <Card key={r.id}>
              <CardKind>{t(`reports.kind.${r.kind}`, r.kind)}</CardKind>
              <CardPeriod>{r.period_from} ~ {r.period_to}</CardPeriod>
              <CardCreated>{r.created_at?.slice(0, 10)}</CardCreated>
              {r.pdf_url ? (
                <CardLink href={r.pdf_url} target="_blank" rel="noopener noreferrer">
                  {t('reports.download', 'PDF 다운로드 →')}
                </CardLink>
              ) : (
                <CardStatus>{t(`reports.status.${r.status}`, r.status)}</CardStatus>
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
  padding: 20px; margin-bottom: 24px;
  display: flex; flex-direction: column; gap: 4px;
`;
const NextAutoLabel = styled.div`font-size: 11px; font-weight: 700; color: #0F766E; text-transform: uppercase; letter-spacing: 0.4px;`;
const NextAutoDate = styled.div`font-size: 22px; font-weight: 700; color: #0F172A; line-height: 1.2;`;
const NextAutoHint = styled.div`font-size: 12px; color: #64748B;`;
const Heading = styled.h2`font-size: 13px; font-weight: 700; color: #0F172A; margin: 0 0 12px;`;
const EmptyBox = styled.div`
  background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 12px;
  padding: 40px 20px; text-align: center; display: flex; flex-direction: column; gap: 8px; align-items: center;
`;
const EmptyTitle = styled.div`font-size: 14px; font-weight: 700; color: #0F172A;`;
const EmptyHint = styled.div`font-size: 12px; color: #64748B; max-width: 360px; line-height: 1.5;`;
const GenBtn = styled.button`
  margin-top: 8px; padding: 10px 18px; background: #14B8A6; color: #FFFFFF;
  border: none; border-radius: 8px; font-size: 13px; font-weight: 700; cursor: pointer;
  &:disabled { background: #CBD5E1; cursor: not-allowed; }
`;
const Grid = styled.div`display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px;`;
const Card = styled.div`
  background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 12px;
  padding: 16px; display: flex; flex-direction: column; gap: 4px;
`;
const CardKind = styled.div`font-size: 11px; font-weight: 700; color: #0F766E; text-transform: uppercase; letter-spacing: 0.4px;`;
const CardPeriod = styled.div`font-size: 14px; font-weight: 700; color: #0F172A;`;
const CardCreated = styled.div`font-size: 11px; color: #94A3B8;`;
const CardLink = styled.a`
  margin-top: 8px; font-size: 12px; font-weight: 600; color: #0F766E; text-decoration: none;
  &:hover { text-decoration: underline; }
`;
const CardStatus = styled.div`margin-top: 8px; font-size: 11px; color: #94A3B8;`;
