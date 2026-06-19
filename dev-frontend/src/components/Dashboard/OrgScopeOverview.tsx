// Q조직 D1 — 대시보드 3단(회사/부서) 조직 현황 패널.
//   scope=company → 부서별 breakdown / scope=department → 멤버별 breakdown.
//   개인(personal)은 기존 DashboardPage 콘텐츠가 담당 (이 컴포넌트는 company/department 만).
import { useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { fetchOrgOverview, type OrgOverview } from '../../services/org';

interface Props { bizId: number; scope: 'company' | 'department'; departmentId?: number | null; }

const OrgScopeOverview: React.FC<Props> = ({ bizId, scope, departmentId }) => {
  const { t } = useTranslation('org');
  const navigate = useNavigate();
  const [data, setData] = useState<OrgOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setErr(false);
    fetchOrgOverview(bizId, scope, scope === 'department' ? (departmentId || undefined) : undefined)
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setErr(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [bizId, scope, departmentId]);

  if (loading) return <Skeleton><Bar /><Bar /><Bar /></Skeleton>;
  if (err || !data) return <Dim>{t('dashboard.loadFail', { defaultValue: '조직 현황을 불러오지 못했어요.' }) as string}</Dim>;

  const maxActive = Math.max(1, ...(data.byDepartment || []).map((d) => d.active), ...(data.byMember || []).map((m) => m.active));

  return (
    <Wrap>
      <Stats>
        <StatCard><StatNum>{data.members}</StatNum><StatLabel>{t('dashboard.members') as string}</StatLabel></StatCard>
        <StatCard><StatNum>{data.activeTasks}</StatNum><StatLabel>{t('dashboard.activeTasks') as string}</StatLabel></StatCard>
        <StatCard><StatNum>{data.doneThisWeek}</StatNum><StatLabel>{t('dashboard.doneThisWeek') as string}</StatLabel></StatCard>
        <StatCard $alert={data.overdue > 0}><StatNum $alert={data.overdue > 0}>{data.overdue}</StatNum><StatLabel>{t('dashboard.overdue') as string}</StatLabel></StatCard>
      </Stats>

      {scope === 'company' && data.byDepartment.length > 0 && (
        <Section>
          <SecTitle>{t('dashboard.byDepartment') as string}</SecTitle>
          {data.byDepartment.map((d) => (
            <BreakRow key={d.id ?? 'none'}>
              <BreakName>
                <Dot $c={d.color || '#cbd5e1'} />
                {d.name || (t('dashboard.unassignedDept') as string)}
                <MutedCount>· {t('dashboard.members') as string} {d.member_count}</MutedCount>
              </BreakName>
              <BreakBarWrap><BreakBar style={{ width: `${(d.active / maxActive) * 100}%` }} /></BreakBarWrap>
              <BreakVal>{d.active}</BreakVal>
            </BreakRow>
          ))}
        </Section>
      )}

      {scope === 'department' && data.byMember.length > 0 && (
        <Section>
          <SecTitle>{t('dashboard.byMember') as string}</SecTitle>
          {data.byMember.map((m) => (
            <BreakRow key={m.user_id} $click onClick={() => navigate(`/tasks?assignee=${m.user_id}`)}>
              <BreakName>{m.name}{m.job_title && <MutedCount>· {m.job_title}</MutedCount>}</BreakName>
              <BreakBarWrap><BreakBar style={{ width: `${(m.active / maxActive) * 100}%` }} /></BreakBarWrap>
              <BreakVal>{m.active}{m.overdue > 0 && <OverdueTag>!{m.overdue}</OverdueTag>}</BreakVal>
            </BreakRow>
          ))}
        </Section>
      )}
    </Wrap>
  );
};

export default OrgScopeOverview;

const Wrap = styled.div`display: flex; flex-direction: column; gap: 16px; margin-bottom: 20px;`;
const Stats = styled.div`
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px;
  @media (max-width: 640px) { grid-template-columns: repeat(2, 1fr); }
`;
const StatCard = styled.div<{ $alert?: boolean }>`
  background: #fff; border: 1px solid ${(p) => (p.$alert ? '#FECACA' : '#e2e8f0')}; border-radius: 12px;
  padding: 16px; display: flex; flex-direction: column; gap: 4px;
`;
const StatNum = styled.div<{ $alert?: boolean }>`font-size: 24px; font-weight: 700; color: ${(p) => (p.$alert ? '#EF4444' : '#0f172a')};`;
const StatLabel = styled.div`font-size: 12px; color: #64748b; font-weight: 600;`;
const Section = styled.div`background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 16px 18px;`;
const SecTitle = styled.div`font-size: 13px; font-weight: 700; color: #0f172a; margin-bottom: 12px;`;
const BreakRow = styled.div<{ $click?: boolean }>`
  display: grid; grid-template-columns: 1.4fr 2fr auto; gap: 12px; align-items: center; padding: 7px 0;
  ${(p) => p.$click && 'cursor: pointer; border-radius: 8px; margin: 0 -8px; padding: 7px 8px; &:hover { background: #f8fafc; }'}
`;
const BreakName = styled.div`font-size: 13px; font-weight: 600; color: #334155; display: flex; align-items: center; gap: 6px; min-width: 0;`;
const Dot = styled.span<{ $c: string }>`width: 9px; height: 9px; border-radius: 50%; background: ${(p) => p.$c}; flex-shrink: 0;`;
const MutedCount = styled.span`font-size: 12px; color: #94a3b8; font-weight: 500;`;
const BreakBarWrap = styled.div`height: 8px; background: #f1f5f9; border-radius: 999px; overflow: hidden;`;
const BreakBar = styled.div`height: 100%; background: #14b8a6; border-radius: 999px; transition: width 0.3s;`;
const BreakVal = styled.div`font-size: 13px; font-weight: 700; color: #0f172a; text-align: right; display: flex; align-items: center; gap: 6px; justify-content: flex-end;`;
const OverdueTag = styled.span`font-size: 11px; font-weight: 700; color: #EF4444; background: #FEF2F2; border-radius: 999px; padding: 1px 6px;`;
const Dim = styled.div`padding: 24px; text-align: center; font-size: 13px; color: #94a3b8;`;
const Skeleton = styled.div`display: flex; flex-direction: column; gap: 10px; margin-bottom: 20px;`;
const Bar = styled.div`height: 48px; background: #f1f5f9; border-radius: 12px; animation: pulse 1.2s ease-in-out infinite; @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.5; } }`;
