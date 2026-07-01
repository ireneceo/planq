// WeeklyReviewTab — 업무 보고서 탭.
//   reviewScope='mine'      → 나의 보고서 (본인 편집·확정) : ReportUnitView(member, self)
//   reviewScope='workspace' → 전체 보고서 (owner/admin 보기) : [통합보고서][프로젝트별][개별]
//   기간(주간/월간)은 상위 탭(전체 주간보고/전체 월간보고)에서 periodType prop 으로 전달.
import React, { useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import ReportUnitView from './ReportUnitView';
import IntegratedReportView from './IntegratedReportView';
import ReportsList from './ReportsList';
import type { ReportPeriodType } from '../../services/reportUnit';

interface Props { businessId: number; userId: number; reviewScope?: 'mine' | 'workspace'; periodType?: ReportPeriodType; canManage?: boolean; }
type WsTab = 'integrated' | 'projects' | 'members';

const WeeklyReviewTab: React.FC<Props> = ({ businessId, userId, reviewScope = 'mine', periodType = 'weekly', canManage = false }) => {
  const { t } = useTranslation('qtask');
  const [wsTab, setWsTab] = useState<WsTab>('integrated');
  const [minePeriod, setMinePeriod] = useState<ReportPeriodType>('weekly');

  // ── 나의 보고서 (단일 탭 — 자체 주간/월간 토글) ──
  if (reviewScope === 'mine') {
    return (
      <Container>
        <PeriodToggle role="tablist">
          <PBtn type="button" role="tab" aria-selected={minePeriod === 'weekly'} $on={minePeriod === 'weekly'} onClick={() => setMinePeriod('weekly')}>{t('weeklyReview.tab.weekly', { defaultValue: '주간 보고서' })}</PBtn>
          <PBtn type="button" role="tab" aria-selected={minePeriod === 'monthly'} $on={minePeriod === 'monthly'} onClick={() => setMinePeriod('monthly')}>{t('weeklyReview.tab.monthly', { defaultValue: '월간 보고서' })}</PBtn>
        </PeriodToggle>
        <ReportUnitView key={`mine-${minePeriod}`} businessId={businessId} scope="member" refId={userId} periodType={minePeriod} />
      </Container>
    );
  }

  // ── 전체 보고서 (owner/admin) ──
  return (
    <Container>
      <WsTabs role="tablist">
        <WsBtn type="button" role="tab" aria-selected={wsTab === 'integrated'} $on={wsTab === 'integrated'} onClick={() => setWsTab('integrated')}>{t('weeklyReview.ws.integrated', { defaultValue: '통합보고서' })}</WsBtn>
        <WsBtn type="button" role="tab" aria-selected={wsTab === 'projects'} $on={wsTab === 'projects'} onClick={() => setWsTab('projects')}>{t('weeklyReview.ws.projects', { defaultValue: '프로젝트별 보고서' })}</WsBtn>
        <WsBtn type="button" role="tab" aria-selected={wsTab === 'members'} $on={wsTab === 'members'} onClick={() => setWsTab('members')}>{t('weeklyReview.ws.members', { defaultValue: '개별 보고서' })}</WsBtn>
      </WsTabs>

      {wsTab === 'integrated' && <IntegratedReportView key={`ig-${periodType}`} businessId={businessId} canManage={canManage} periodType={periodType} />}
      {wsTab === 'projects' && <ReportsList key={`pl-${periodType}`} businessId={businessId} periodType={periodType} dim="project" />}
      {wsTab === 'members' && <ReportsList key={`ml-${periodType}`} businessId={businessId} periodType={periodType} dim="member" />}
    </Container>
  );
};

export default WeeklyReviewTab;

const Container = styled.div`padding:20px;height:100%;overflow-y:auto;display:flex;flex-direction:column;gap:16px;`;
const WsTabs = styled.div`display:flex;gap:4px;border-bottom:1px solid #E2E8F0;`;
const WsBtn = styled.button<{ $on: boolean }>`padding:9px 16px;background:transparent;border:none;cursor:pointer;font-size:14px;font-weight:${(p) => (p.$on ? 700 : 500)};color:${(p) => (p.$on ? '#0F766E' : '#64748B')};border-bottom:2px solid ${(p) => (p.$on ? '#14B8A6' : 'transparent')};margin-bottom:-1px;&:hover{color:#0F766E;}`;
const PeriodToggle = styled.div`display:inline-flex;background:#F1F5F9;padding:3px;border-radius:8px;gap:2px;align-self:flex-start;`;
const PBtn = styled.button<{ $on: boolean }>`padding:8px 18px;border:none;background:${(p) => (p.$on ? '#fff' : 'transparent')};color:${(p) => (p.$on ? '#0F766E' : '#64748B')};border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;box-shadow:${(p) => (p.$on ? '0 1px 2px rgba(0,0,0,.06)' : 'none')};`;
