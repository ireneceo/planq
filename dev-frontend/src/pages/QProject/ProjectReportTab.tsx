// ProjectReportTab — 프로젝트 상세 > 보고서 탭. PM(프로젝트 담당자)·owner/admin 가 편집·확정.
//   주간/월간 토글 + ReportUnitView(scope=project). 편집/확정 권한은 백엔드 responsible 게이트.
import React, { useMemo, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import ReportUnitView from '../../components/QTask/ReportUnitView';
import type { ReportPeriodType } from '../../services/reportUnit';

interface Props { businessId: number; projectId: number; }

const ProjectReportTab: React.FC<Props> = ({ businessId, projectId }) => {
  const { t } = useTranslation('qtask');
  const [periodType, setPeriodType] = useState<ReportPeriodType>('weekly');

  const PeriodTabs = useMemo(() => (
    <PTabs role="tablist">
      <PTab type="button" role="tab" aria-selected={periodType === 'weekly'} $on={periodType === 'weekly'} onClick={() => setPeriodType('weekly')}>{t('weeklyReview.tab.weekly', { defaultValue: '주간 보고서' })}</PTab>
      <PTab type="button" role="tab" aria-selected={periodType === 'monthly'} $on={periodType === 'monthly'} onClick={() => setPeriodType('monthly')}>{t('weeklyReview.tab.monthly', { defaultValue: '월간 보고서' })}</PTab>
    </PTabs>
  ), [periodType, t]);

  return (
    <Container>
      {PeriodTabs}
      <ReportUnitView key={`proj-${projectId}-${periodType}`} businessId={businessId} scope="project" refId={projectId} periodType={periodType} />
    </Container>
  );
};

export default ProjectReportTab;

// ★ padding 을 주지 않는다 (2026-09-14) — 바깥 PageShell Body 가 이미 20px 을 준다.
//   여기서 또 주면 **이 탭만** 좌우 20px 안쪽으로 밀려 다른 11개 탭과 열이 어긋난다
//   (실측 1440: 보고서 260 / 나머지 240. 1024·폰에서도 같은 20px).
const Container = styled.div`display:flex;flex-direction:column;gap:16px;`;
const PTabs = styled.div`display:inline-flex;background:#F1F5F9;padding:3px;border-radius:8px;gap:2px;align-self:flex-start;`;
const PTab = styled.button<{ $on: boolean }>`padding:7px 18px;border:none;background:${(p) => (p.$on ? '#fff' : 'transparent')};color:${(p) => (p.$on ? '#0F766E' : '#64748B')};border-radius:6px;font-size:0.8125rem;font-weight:700;cursor:pointer;box-shadow:${(p) => (p.$on ? '0 1px 2px rgba(0,0,0,.06)' : 'none')};`;
