// 부서 보고서뷰 (#64) — D1 조직 /overview 재사용 (순수 프론트, 백엔드 0).
//   전체 회사 = 부서별 비교 / 특정 부서 = 멤버별 현황. 워크스페이스 보고 렌즈(owner/admin 컨텍스트).
import { useEffect, useState, useCallback } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { fetchOrgOverview, listDepartments, type OrgOverview, type OrgDepartment } from '../../services/org';
import PlanQSelect, { type PlanQSelectOption } from '../Common/PlanQSelect';
import { AlertTriangleIcon } from '../Common/Icons';

const DEPT_PALETTE = ['#14B8A6', '#6366F1', '#F59E0B', '#EC4899', '#0EA5E9', '#84CC16', '#F43F5E', '#8B5CF6'];

export default function DepartmentReportView({ businessId }: { businessId: number }) {
  const { t } = useTranslation('qtask');
  const [departments, setDepartments] = useState<OrgDepartment[]>([]);
  const [selected, setSelected] = useState<'company' | number>('company');
  const [overview, setOverview] = useState<OrgOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    listDepartments(businessId).then(setDepartments).catch(() => { /* 빈 목록 */ });
  }, [businessId]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const ov = selected === 'company'
        ? await fetchOrgOverview(businessId, 'company')
        : await fetchOrgOverview(businessId, 'department', selected);
      setOverview(ov); setError(false);
    } catch { setError(true); }
    finally { setLoading(false); }
  }, [businessId, selected]);
  useEffect(() => { load(); }, [load]);

  const deptColor = (i: number, color: string | null) => color || DEPT_PALETTE[i % DEPT_PALETTE.length];
  const options: PlanQSelectOption[] = [
    { value: 'company', label: t('weeklyReview.dept.company', { defaultValue: '전체 회사' }) as string },
    ...departments.map((d) => ({ value: String(d.id), label: d.name })),
  ];

  return (
    <Wrap>
      <PickerRow>
        <div style={{ minWidth: 220 }}>
          <PlanQSelect size="sm" isSearchable
            value={options.find((o) => o.value === String(selected)) || options[0]}
            options={options}
            onChange={(opt) => { const v = (opt as PlanQSelectOption)?.value; setSelected(v === 'company' ? 'company' : Number(v)); }}
          />
        </div>
      </PickerRow>

      {loading ? (
        <Skel><SkelBlock /><SkelBlock /></Skel>
      ) : error || !overview ? (
        <ErrBox><AlertTriangleIcon size={20} /><div>{t('weeklyReview.dept.loadError', { defaultValue: '부서 현황을 불러오지 못했습니다' })}</div><Retry type="button" onClick={load}>{t('weeklyReview.project.retry', { defaultValue: '다시 시도' })}</Retry></ErrBox>
      ) : (
        <>
          {/* KPI */}
          <KpiGrid>
            <Kpi><KNum>{overview.members}</KNum><KLbl>{t('weeklyReview.dept.members', { defaultValue: '인원' })}</KLbl></Kpi>
            <Kpi><KNum>{overview.activeTasks}</KNum><KLbl>{t('weeklyReview.dept.active', { defaultValue: '진행 업무' })}</KLbl></Kpi>
            <Kpi><KNum>{overview.doneThisWeek}</KNum><KLbl>{t('weeklyReview.dept.doneWeek', { defaultValue: '금주 완료' })}</KLbl></Kpi>
            <Kpi><KNum $danger={overview.overdue > 0}>{overview.overdue}</KNum><KLbl>{t('weeklyReview.dept.overdue', { defaultValue: '지연' })}</KLbl></Kpi>
          </KpiGrid>

          {selected === 'company' ? (
            /* 부서별 비교 */
            <Section>
              <SecTitle>{t('weeklyReview.dept.byDepartment', { defaultValue: '부서별 현황' })}</SecTitle>
              {overview.byDepartment.length === 0 ? <Empty>{t('weeklyReview.dept.noDepartments', { defaultValue: '등록된 부서가 없습니다' })}</Empty> : (
                <DeptGrid>
                  {overview.byDepartment.map((d, i) => (
                    <DeptCard key={d.id ?? 'none'} onClick={() => d.id != null && setSelected(d.id)} $clickable={d.id != null}>
                      <DeptBar style={{ background: deptColor(i, d.color) }} />
                      <DeptBody>
                        <DeptName>{d.name || t('weeklyReview.dept.unassigned', { defaultValue: '미배정' })}</DeptName>
                        <DeptMeta>{d.member_count}{t('weeklyReview.dept.peopleSuffix', { defaultValue: '명' })} · {t('weeklyReview.dept.activeN', { defaultValue: '진행 {{n}}', n: d.active })}</DeptMeta>
                      </DeptBody>
                    </DeptCard>
                  ))}
                </DeptGrid>
              )}
            </Section>
          ) : (
            /* 멤버별 현황 */
            <Section>
              <SecTitle>{t('weeklyReview.dept.byMember', { defaultValue: '멤버별 현황' })}</SecTitle>
              {overview.byMember.length === 0 ? <Empty>{t('weeklyReview.dept.noMembers', { defaultValue: '부서 멤버가 없습니다' })}</Empty> : (
                <MemberTable>
                  <MemberHead>
                    <span>{t('weeklyReview.dept.name', { defaultValue: '이름' })}</span>
                    <span>{t('weeklyReview.dept.role', { defaultValue: '직무' })}</span>
                    <Num>{t('weeklyReview.dept.active', { defaultValue: '진행' })}</Num>
                    <Num>{t('weeklyReview.dept.overdue', { defaultValue: '지연' })}</Num>
                  </MemberHead>
                  {overview.byMember.map((m) => (
                    <MemberRow key={m.user_id}>
                      <MName>{m.name}</MName>
                      <MRole>{m.job_title || '—'}</MRole>
                      <Num>{m.active}</Num>
                      <Num $danger={m.overdue > 0}>{m.overdue}</Num>
                    </MemberRow>
                  ))}
                </MemberTable>
              )}
            </Section>
          )}
        </>
      )}
    </Wrap>
  );
}

const Wrap = styled.div`display:flex;flex-direction:column;gap:16px;max-width:1000px;`;
const PickerRow = styled.div`display:flex;align-items:center;gap:12px;`;
const KpiGrid = styled.div`display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;`;
const Kpi = styled.div`background:#fff;border:1px solid #E2E8F0;border-radius:12px;padding:14px 16px;`;
const KNum = styled.div<{ $danger?: boolean }>`font-size:22px;font-weight:700;color:${(p) => (p.$danger ? '#EF4444' : '#0F172A')};`;
const KLbl = styled.div`font-size:11px;color:#64748B;margin-top:4px;`;
const Section = styled.div`background:#fff;border:1px solid #E2E8F0;border-radius:12px;padding:14px 16px;`;
const SecTitle = styled.div`font-size:13px;font-weight:700;color:#0F172A;margin-bottom:10px;`;
const DeptGrid = styled.div`display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px;`;
const DeptCard = styled.div<{ $clickable: boolean }>`display:flex;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;overflow:hidden;cursor:${(p) => (p.$clickable ? 'pointer' : 'default')};&:hover{${(p) => (p.$clickable ? 'border-color:#99F6E4;background:#F0FDFA;' : '')}}`;
const DeptBar = styled.div`width:4px;flex-shrink:0;`;
const DeptBody = styled.div`flex:1;min-width:0;padding:10px 12px;`;
const DeptName = styled.div`font-size:13px;font-weight:700;color:#0F172A;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`;
const DeptMeta = styled.div`font-size:11px;color:#64748B;margin-top:4px;`;
const MemberTable = styled.div`display:flex;flex-direction:column;`;
const MemberHead = styled.div`display:grid;grid-template-columns:1fr 1fr 64px 64px;gap:8px;font-size:11px;font-weight:600;color:#94A3B8;padding:0 4px 8px;border-bottom:1px solid #E2E8F0;`;
const MemberRow = styled.div`display:grid;grid-template-columns:1fr 1fr 64px 64px;gap:8px;align-items:center;padding:9px 4px;border-bottom:1px solid #F1F5F9;`;
const MName = styled.span`font-size:13px;font-weight:600;color:#0F172A;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`;
const MRole = styled.span`font-size:12px;color:#64748B;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`;
const Num = styled.span<{ $danger?: boolean }>`text-align:center;font-size:13px;font-weight:600;color:${(p) => (p.$danger ? '#EF4444' : '#334155')};`;
const Empty = styled.div`font-size:12px;color:#94A3B8;padding:8px 0;`;
const Skel = styled.div`display:flex;flex-direction:column;gap:14px;`;
const SkelBlock = styled.div`height:80px;background:#F1F5F9;border-radius:12px;`;
const ErrBox = styled.div`display:flex;flex-direction:column;align-items:center;gap:10px;padding:40px;color:#92400E;`;
const Retry = styled.button`height:34px;padding:0 16px;border:1px solid #E2E8F0;background:#fff;border-radius:8px;font-size:13px;font-weight:600;color:#0F766E;cursor:pointer;&:hover{background:#F0FDFA;}`;
