// 통합보고서 공개 read-only — /public/report/:token
//   인증 불필요. /api/reports/public/integrated/:token 의 롤업을 읽기전용 렌더.
//   IntegratedReportView 의 표현 컴포넌트(KpiGrid·ReportContent) 재사용 — bespoke 금지.
import { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import {
  KpiGrid, KpiCard, KpiLabel, KpiValueBig, KpiHint, SectionLabel, ChartCard,
} from '../Insights/components';
import ReportContent from '../../components/QTask/report/ReportContent';
import type { ReportSnapshot } from '../../services/reportUnit';

interface UnitView {
  scope: 'project' | 'member';
  ref_id: number;
  name: string;
  department?: string | null;
  confirmed?: boolean;
  narrative?: string | null;
  snap?: ReportSnapshot | null;
}
interface RollupData {
  stats?: Record<string, number>;
  projects?: UnitView[];
  members?: UnitView[];
  workspace_name?: string | null;
  period_type?: 'weekly' | 'monthly';
  period_start?: string;
  dim?: 'project' | 'member';
  executive_summary?: string;
}

const PublicReportPage = () => {
  const { t } = useTranslation('org');
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<RollupData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [dim, setDim] = useState<'project' | 'member'>('project');

  const fetchReport = useCallback(async () => {
    setLoading(true); setError(false);
    try {
      const r = await fetch(`/api/reports/public/integrated/${token}`);
      const j = await r.json();
      if (!r.ok || !j.success) throw new Error();
      setData(j.data);
      setDim(j.data?.dim === 'member' ? 'member' : 'project');
    } catch { setError(true); }
    finally { setLoading(false); }
  }, [token]);
  useEffect(() => { fetchReport(); }, [fetchReport]);

  if (loading) return <Wrap><Card><Hint>{t('publicReport.loading', { defaultValue: '불러오는 중…' }) as string}</Hint></Card></Wrap>;
  if (error || !data) return <Wrap><Card><Hint>{t('publicReport.notFound', { defaultValue: '보고서를 찾을 수 없거나 공유가 해제되었습니다.' }) as string}</Hint></Card></Wrap>;

  const s = data.stats || {};
  const units = dim === 'project' ? (data.projects || []) : (data.members || []);
  const periodLabel = `${data.period_start || ''}${data.period_type === 'monthly' ? ` · ${t('publicReport.monthly', { defaultValue: '월간' })}` : ` · ${t('publicReport.weekly', { defaultValue: '주간' })}`}`;

  return (
    <Wrap>
      <Card>
        {data.workspace_name && <WorkspaceLabel>{data.workspace_name}</WorkspaceLabel>}
        <Title>{t('publicReport.title', { defaultValue: '통합 보고서' }) as string}</Title>
        <Period>{periodLabel}</Period>

        <KpiGrid>
          <KpiCard><KpiLabel>{t('dashboard.activeTasks', { defaultValue: '진행' }) as string}</KpiLabel><KpiValueBig>{s.in_progress ?? 0}</KpiValueBig></KpiCard>
          <KpiCard><KpiLabel>{t('publicReport.done', { defaultValue: '완료' }) as string}</KpiLabel><KpiValueBig>{s.completed_in_period ?? 0}</KpiValueBig></KpiCard>
          <KpiCard><KpiLabel>{t('publicReport.issues', { defaultValue: '이슈' }) as string}</KpiLabel><KpiValueBig>{s.open_issues ?? 0}</KpiValueBig></KpiCard>
          <KpiCard><KpiLabel>{t('dashboard.overdue', { defaultValue: '지연' }) as string}</KpiLabel><KpiValueBig style={{ color: (s.overdue ?? 0) > 0 ? '#B91C1C' : undefined }}>{s.overdue ?? 0}</KpiValueBig></KpiCard>
          <KpiCard><KpiLabel>{t('publicReport.deliverables', { defaultValue: '산출물' }) as string}</KpiLabel><KpiValueBig>{s.deliverables ?? 0}</KpiValueBig></KpiCard>
          <KpiCard><KpiLabel>{t('publicReport.projects', { defaultValue: '프로젝트' }) as string}</KpiLabel><KpiValueBig>{s.projects_total ?? 0}</KpiValueBig><KpiHint>{t('publicReport.membersN', { n: s.members_total ?? 0, defaultValue: `멤버 ${s.members_total ?? 0}` }) as string}</KpiHint></KpiCard>
        </KpiGrid>

        {data.executive_summary && (
          <>
            <SectionLabel>{t('publicReport.execSummary', { defaultValue: '전사 요약' }) as string}</SectionLabel>
            <ChartCard><ExecRead>{data.executive_summary}</ExecRead></ChartCard>
          </>
        )}

        <ViewToggle role="tablist">
          <ViewTab type="button" role="tab" aria-selected={dim === 'project'} $on={dim === 'project'} onClick={() => setDim('project')}>
            {t('publicReport.byProject', { defaultValue: '프로젝트뷰' }) as string} <ViewN>{(data.projects || []).length}</ViewN>
          </ViewTab>
          <ViewTab type="button" role="tab" aria-selected={dim === 'member'} $on={dim === 'member'} onClick={() => setDim('member')}>
            {t('publicReport.byMember', { defaultValue: '멤버뷰' }) as string} <ViewN>{(data.members || []).length}</ViewN>
          </ViewTab>
        </ViewToggle>

        {units.length === 0 ? (
          <Hint>{t('publicReport.noUnits', { defaultValue: '이 기간에 보고할 대상이 없습니다.' }) as string}</Hint>
        ) : units.map((u) => (
          <UnitCard key={`${u.scope}-${u.ref_id}`}>
            <UnitHead>
              <UnitName>{u.name}</UnitName>
              {u.department && <DeptTag>{u.department}</DeptTag>}
            </UnitHead>
            {u.narrative && <Commentary><ComBody>{u.narrative}</ComBody></Commentary>}
            {u.snap && <ReportContent snap={u.snap} />}
          </UnitCard>
        ))}

        <Footer>{t('publicReport.footer', { defaultValue: 'PlanQ 로 작성된 보고서' }) as string}</Footer>
      </Card>
    </Wrap>
  );
};

export default PublicReportPage;

const Wrap = styled.div`
  min-height: 100vh; background: #F8FAFC;
  display: flex; align-items: flex-start; justify-content: center; padding: 40px 20px;
  @media (max-width: 640px) { padding: 16px; }
`;
const Card = styled.div`
  width: 100%; max-width: 920px;
  background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 14px;
  padding: 28px 32px; box-shadow: 0 4px 12px rgba(0,0,0,0.06);
  @media (max-width: 640px) { padding: 20px 16px; }
`;
const WorkspaceLabel = styled.div`font-size: 11px; font-weight: 700; color: #94A3B8; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px;`;
const Title = styled.h1`font-size: 22px; font-weight: 800; color: #0F172A; margin: 0 0 4px; line-height: 1.3;`;
const Period = styled.div`font-size: 13px; color: #64748B; margin-bottom: 20px;`;
const Hint = styled.div`font-size: 14px; color: #94A3B8; padding: 32px 8px; text-align: center;`;
const ExecRead = styled.p`font-size: 14px; line-height: 1.75; color: #334155; white-space: pre-wrap; margin: 0;`;
const ViewToggle = styled.div`display: inline-flex; background: #F1F5F9; padding: 3px; border-radius: 8px; gap: 2px; margin: 20px 0 16px;`;
const ViewTab = styled.button<{ $on: boolean }>`display: inline-flex; align-items: center; gap: 6px; padding: 8px 18px; border: none; background: ${(p) => (p.$on ? '#fff' : 'transparent')}; color: ${(p) => (p.$on ? '#0F766E' : '#64748B')}; border-radius: 8px; font-size: 13px; font-weight: 700; cursor: pointer; box-shadow: ${(p) => (p.$on ? '0 1px 2px rgba(0,0,0,.06)' : 'none')};`;
const ViewN = styled.span`font-size: 10px; font-weight: 700; color: #94A3B8;`;
const UnitCard = styled.div`border: 1px solid #E2E8F0; border-radius: 14px; padding: 20px 22px; margin-bottom: 16px; @media (max-width: 768px) { padding: 16px; }`;
const UnitHead = styled.div`display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 14px;`;
const UnitName = styled.h3`font-size: 17px; font-weight: 800; color: #0F172A; margin: 0; min-width: 0; word-break: break-word;`;
const DeptTag = styled.span`font-size: 11px; font-weight: 700; color: #475569; background: #E2E8F0; border-radius: 999px; padding: 2px 9px;`;
const Commentary = styled.div`margin-bottom: 14px; padding: 12px 14px; background: #F8FAFC; border-left: 3px solid #14B8A6; border-radius: 0 8px 8px 0;`;
const ComBody = styled.p`font-size: 14px; line-height: 1.7; color: #334155; white-space: pre-wrap; margin: 0;`;
const Footer = styled.div`margin-top: 24px; padding-top: 16px; border-top: 1px solid #F1F5F9; font-size: 11px; color: #94A3B8; text-align: center;`;
