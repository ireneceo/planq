// WeeklyReviewTab — 업무 보고서 탭.
//   reviewScope='mine'      → 나의 보고서 (본인 편집·확정) : 주간/월간 + ReportUnitView(member, self)
//   reviewScope='workspace' → 전체 보고서 (owner/admin 보기) : 통합보고서(프로젝트뷰/개인뷰) · 프로젝트별 · 개별
import React, { useEffect, useMemo, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useAuth, apiFetch } from '../../contexts/AuthContext';
import PlanQSelect, { type PlanQSelectOption } from '../Common/PlanQSelect';
import ReportUnitView from './ReportUnitView';
import IntegratedReportView from './IntegratedReportView';
import { listActiveProjects, type ProjectLite } from '../../services/projectReport';
import type { ReportPeriodType } from '../../services/reportUnit';

interface Props { businessId: number; userId: number; reviewScope?: 'mine' | 'workspace'; }
type WsTab = 'integrated' | 'projects' | 'members';
interface Member { user_id: number; name: string; }

const WeeklyReviewTab: React.FC<Props> = ({ businessId, userId, reviewScope = 'mine' }) => {
  const { t } = useTranslation('qtask');
  const { user } = useAuth();
  const myWsRole = (user?.workspaces || []).find((w) => w.business_id === businessId)?.role
    || (user?.business_id === businessId ? user?.business_role : null);
  const canManage = myWsRole === 'owner' || myWsRole === 'admin' || user?.platform_role === 'platform_admin';

  const [periodType, setPeriodType] = useState<ReportPeriodType>('weekly');
  const [wsTab, setWsTab] = useState<WsTab>('integrated');

  // 전체 보고서 — 프로젝트/멤버 picker
  const [projects, setProjects] = useState<ProjectLite[]>([]);
  const [selProject, setSelProject] = useState<number | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [selMember, setSelMember] = useState<number | null>(null);

  useEffect(() => {
    if (reviewScope !== 'workspace') return;
    if (wsTab === 'projects' && projects.length === 0) {
      listActiveProjects(businessId).then((l) => { setProjects(l); if (l[0]) setSelProject((p) => p ?? l[0].id); }).catch(() => { /* */ });
    }
    if (wsTab === 'members' && members.length === 0) {
      apiFetch(`/api/businesses/${businessId}/members`).then((r) => r.json()).then((j) => {
        const ms: Member[] = (j.data || j.members || []).map((m: { user_id: number; name?: string; User?: { name?: string; display_name?: string } }) => ({ user_id: m.user_id, name: m.name || m.User?.display_name || m.User?.name || `#${m.user_id}` }));
        setMembers(ms); if (ms[0]) setSelMember((p) => p ?? ms[0].user_id);
      }).catch(() => { /* */ });
    }
  }, [reviewScope, wsTab, businessId, projects.length, members.length]);

  const PeriodTabs = useMemo(() => (
    <PTabs role="tablist">
      <PTab type="button" role="tab" aria-selected={periodType === 'weekly'} $on={periodType === 'weekly'} onClick={() => setPeriodType('weekly')}>{t('weeklyReview.tab.weekly', { defaultValue: '주간 보고서' })}</PTab>
      <PTab type="button" role="tab" aria-selected={periodType === 'monthly'} $on={periodType === 'monthly'} onClick={() => setPeriodType('monthly')}>{t('weeklyReview.tab.monthly', { defaultValue: '월간 보고서' })}</PTab>
    </PTabs>
  ), [periodType, t]);

  // ── 나의 보고서 ──
  if (reviewScope === 'mine') {
    return (
      <Container>
        {PeriodTabs}
        <ReportUnitView key={`mine-${periodType}`} businessId={businessId} scope="member" refId={userId} periodType={periodType} />
      </Container>
    );
  }

  // ── 전체 보고서 (owner/admin) ──
  return (
    <Container>
      {PeriodTabs}
      <WsTabs role="tablist">
        <WsBtn type="button" role="tab" aria-selected={wsTab === 'integrated'} $on={wsTab === 'integrated'} onClick={() => setWsTab('integrated')}>{t('weeklyReview.ws.integrated', { defaultValue: '통합보고서' })}</WsBtn>
        <WsBtn type="button" role="tab" aria-selected={wsTab === 'projects'} $on={wsTab === 'projects'} onClick={() => setWsTab('projects')}>{t('weeklyReview.ws.projects', { defaultValue: '프로젝트별 보고서' })}</WsBtn>
        <WsBtn type="button" role="tab" aria-selected={wsTab === 'members'} $on={wsTab === 'members'} onClick={() => setWsTab('members')}>{t('weeklyReview.ws.members', { defaultValue: '개별 보고서' })}</WsBtn>
      </WsTabs>

      {wsTab === 'integrated' && (
        <IntegratedReportView key={`ig-${periodType}`} businessId={businessId} canManage={canManage} periodType={periodType} />
      )}
      {wsTab === 'projects' && (
        projects.length === 0 ? <Empty>{t('weeklyReview.integrated.noProjects', { defaultValue: '활성 프로젝트가 없습니다' })}</Empty> : (<>
          <Picker><div style={{ minWidth: 260 }}>
            <PlanQSelect size="sm" isSearchable value={(() => { const p = projects.find((x) => x.id === selProject); return p ? { value: String(p.id), label: p.name } : null; })()} options={projects.map((p) => ({ value: String(p.id), label: p.name }))} onChange={(o) => setSelProject(Number((o as PlanQSelectOption)?.value))} />
          </div></Picker>
          {selProject && <ReportUnitView key={`proj-${selProject}-${periodType}`} businessId={businessId} scope="project" refId={selProject} periodType={periodType} />}
        </>)
      )}
      {wsTab === 'members' && (
        members.length === 0 ? <Empty>{t('weeklyReview.integrated.noMembers', { defaultValue: '멤버가 없습니다' })}</Empty> : (<>
          <Picker><div style={{ minWidth: 220 }}>
            <PlanQSelect size="sm" isSearchable value={(() => { const m = members.find((x) => x.user_id === selMember); return m ? { value: String(m.user_id), label: m.name } : null; })()} options={members.map((m) => ({ value: String(m.user_id), label: m.name }))} onChange={(o) => setSelMember(Number((o as PlanQSelectOption)?.value))} />
          </div></Picker>
          {selMember && <ReportUnitView key={`mem-${selMember}-${periodType}`} businessId={businessId} scope="member" refId={selMember} periodType={periodType} />}
        </>)
      )}
    </Container>
  );
};

export default WeeklyReviewTab;

const Container = styled.div`padding:20px;height:100%;overflow-y:auto;display:flex;flex-direction:column;gap:16px;`;
const PTabs = styled.div`display:inline-flex;background:#F1F5F9;padding:3px;border-radius:8px;gap:2px;align-self:flex-start;`;
const PTab = styled.button<{ $on: boolean }>`padding:7px 18px;border:none;background:${(p) => (p.$on ? '#fff' : 'transparent')};color:${(p) => (p.$on ? '#0F766E' : '#64748B')};border-radius:6px;font-size:13px;font-weight:700;cursor:pointer;box-shadow:${(p) => (p.$on ? '0 1px 2px rgba(0,0,0,.06)' : 'none')};`;
const WsTabs = styled.div`display:flex;gap:4px;border-bottom:1px solid #E2E8F0;`;
const WsBtn = styled.button<{ $on: boolean }>`padding:8px 14px;background:transparent;border:none;cursor:pointer;font-size:13px;font-weight:${(p) => (p.$on ? 700 : 500)};color:${(p) => (p.$on ? '#0F766E' : '#64748B')};border-bottom:2px solid ${(p) => (p.$on ? '#14B8A6' : 'transparent')};margin-bottom:-1px;&:hover{color:#0F766E;}`;
const Picker = styled.div`display:flex;align-items:center;gap:12px;`;
const Empty = styled.div`padding:60px 20px;text-align:center;color:#94A3B8;font-size:14px;`;
