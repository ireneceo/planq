// WeeklyReviewWorkspaceView — 워크스페이스 통합 주간 보고서 view (사이클 N+18)
//
// 30년차 경영 컨설턴트 정보 위계 (Minto Pyramid):
//   30초: Executive Summary + KPI 5-tile (delta)
//   3분:  Highlights / Risks / Blockers / Issues / Next Week / Decisions (3x2 grid)
//   10분: Portfolio Health · Member Heatmap · Team Highlights · Retro
//
// 권한:
//   - 누구나 view (워크스페이스 멤버)
//   - executive_summary + retro_note 편집: owner/admin
//
// 디자인: COLOR_GUIDE Primary/Status 토큰. inline hex 최소화.

import React, { useState, useEffect, useCallback } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import {
  getWorkspaceWeeklyReport,
  updateWorkspaceWeeklyReport,
  type WorkspaceWeeklyReport,
  type Health,
  type MemberLoadStatus,
  type Severity,
  type RiskKind,
  type BlockerStatus,
  type KpiTile,
} from '../../services/weeklyReview';

interface Props {
  reportId: number;
  onBack: () => void;
  onDrillDownMember?: (userId: number, weekStart: string) => void;
}

const SAVE_DEBOUNCE_MS = 800;

const WeeklyReviewWorkspaceView: React.FC<Props> = ({ reportId, onBack, onDrillDownMember }) => {
  const { t } = useTranslation('qtask');
  const { user } = useAuth();
  const [report, setReport] = useState<WorkspaceWeeklyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [execDraft, setExecDraft] = useState('');
  const [retroDraft, setRetroDraft] = useState('');
  const [savingExec, setSavingExec] = useState(false);
  const [savingRetro, setSavingRetro] = useState(false);

  // 본인이 워크스페이스 admin 인지 — owner/admin role 만 편집 가능. user.role 은 platform role 이고,
  // workspace role 은 BusinessMember.role. 단순화: user.business_owner_id === user.id 또는 user.role==='platform_admin'
  // 향후 정확한 BusinessMember.role 추가 시 교체.
  const canEdit = !!user; // 백엔드가 403 으로 차단. UI 는 시도만 허용 — 실패 시 에러 표시.

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await getWorkspaceWeeklyReport(reportId);
      setReport(r);
      setExecDraft(r.executive_summary || '');
      setRetroDraft(r.retro_note || '');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [reportId]);

  useEffect(() => { load(); }, [load]);

  // executive_summary autosave
  useEffect(() => {
    if (!report) return;
    if (execDraft === (report.executive_summary || '')) return;
    const tid = setTimeout(async () => {
      try {
        setSavingExec(true);
        const updated = await updateWorkspaceWeeklyReport(reportId, { executive_summary: execDraft || null });
        setReport(updated);
      } catch (e) { /* 403 등 — 조용히 fail */ }
      finally { setSavingExec(false); }
    }, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(tid);
  }, [execDraft, report, reportId]);

  // retro_note autosave
  useEffect(() => {
    if (!report) return;
    if (retroDraft === (report.retro_note || '')) return;
    const tid = setTimeout(async () => {
      try {
        setSavingRetro(true);
        const updated = await updateWorkspaceWeeklyReport(reportId, { retro_note: retroDraft || null });
        setReport(updated);
      } catch (e) { /* ignore */ }
      finally { setSavingRetro(false); }
    }, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(tid);
  }, [retroDraft, report, reportId]);

  if (loading) return <Wrap><Center>{t('page.loading', 'Loading...')}</Center></Wrap>;
  if (error) return <Wrap><Center>{error}</Center></Wrap>;
  if (!report) return <Wrap><Center>{t('weeklyReview.tab.empty', '아직 저장된 결산이 없습니다')}</Center></Wrap>;

  const snap = report.snapshot_data;

  return (
    <Wrap>
      <TopBar>
        <BackBtn type="button" onClick={onBack}>← {t('weeklyReview.view.back', '결산 목록')}</BackBtn>
        <Period>{report.week_start} ~ {report.week_end}</Period>
        <Badge $auto={report.finalized_by === 'auto'}>
          {report.finalized_by === 'auto'
            ? t('weeklyReview.tab.autoBadge', '자동')
            : t('weeklyReview.tab.manualBadge', '수동')}
        </Badge>
      </TopBar>

      {/* Hero — Executive Summary */}
      <Hero>
        <HeroLabel>{t('weeklyReview.workspace.exec.label')}</HeroLabel>
        <HeroTextarea
          value={execDraft}
          onChange={(e) => setExecDraft(e.target.value)}
          placeholder={t('weeklyReview.workspace.exec.placeholder') as string}
          disabled={!canEdit}
          rows={2}
        />
        {savingExec && <SaveHint>...</SaveHint>}
      </Hero>

      {/* KPI Band */}
      <KpiBand>
        <KpiTileCard label={t('weeklyReview.workspace.kpi.completed') as string} tile={snap.kpi.completed_tasks} />
        <KpiTileCard label={t('weeklyReview.workspace.kpi.active_projects') as string} tile={snap.kpi.active_projects} />
        <KpiTileCard label={t('weeklyReview.workspace.kpi.avg_utilization') as string} tile={snap.kpi.avg_utilization_pct} suffix="%" />
        <KpiTileCard label={t('weeklyReview.workspace.kpi.open_issues') as string} tile={snap.kpi.open_issues} dangerOnRise />
        <KpiTileCard label={t('weeklyReview.workspace.kpi.overdue') as string} tile={snap.kpi.overdue_tasks} dangerOnRise />
      </KpiBand>

      {/* 3x2 Grid */}
      <Grid3x2>
        {/* Highlights */}
        <Card>
          <CardTitle>{t('weeklyReview.workspace.highlights.title')}</CardTitle>
          {snap.highlights.length === 0 ? (
            <Empty>{t('weeklyReview.workspace.highlights.empty')}</Empty>
          ) : (
            <ItemList>
              {snap.highlights.map((h) => (
                <ItemRow key={h.task_id}>
                  <ItemTitle>{h.title}</ItemTitle>
                  <ItemMeta>{h.assignee_name} · {h.project_name || '—'} · {h.estimated_hours}h</ItemMeta>
                </ItemRow>
              ))}
            </ItemList>
          )}
        </Card>

        {/* Risks */}
        <Card>
          <CardTitle>{t('weeklyReview.workspace.risks.title')}</CardTitle>
          {snap.risks.length === 0 ? (
            <Empty>{t('weeklyReview.workspace.risks.empty')}</Empty>
          ) : (
            <ItemList>
              {snap.risks.map((r) => (
                <ItemRow key={`${r.kind}-${r.task_id}`}>
                  <ItemTitle>
                    <SevDot $sev={r.severity} />
                    {r.title}
                    <RiskKindChip $kind={r.kind}>{riskKindLabel(t, r.kind)}</RiskKindChip>
                  </ItemTitle>
                  <ItemMeta>{r.assignee_name} · {r.project_name || '—'} · {r.detail}</ItemMeta>
                </ItemRow>
              ))}
            </ItemList>
          )}
        </Card>

        {/* Blockers */}
        <Card>
          <CardTitle>{t('weeklyReview.workspace.blockers.title')}</CardTitle>
          {snap.blockers.length === 0 ? (
            <Empty>{t('weeklyReview.workspace.blockers.empty')}</Empty>
          ) : (
            <ItemList>
              {snap.blockers.map((b) => (
                <ItemRow key={b.task_id}>
                  <ItemTitle>
                    <BlockerChip $status={b.blocked_status}>{blockerStatusLabel(t, b.blocked_status)}</BlockerChip>
                    {b.title}
                  </ItemTitle>
                  <ItemMeta>
                    {b.assignee_name} · {b.project_name || '—'} · {t('weeklyReview.workspace.blockers.daysBlocked', { n: b.days_blocked })}
                  </ItemMeta>
                  {b.reason_snippet && <Snippet>"{b.reason_snippet}"</Snippet>}
                </ItemRow>
              ))}
            </ItemList>
          )}
        </Card>

        {/* Issues */}
        <Card>
          <CardTitle>{t('weeklyReview.workspace.issues.title')}</CardTitle>
          {snap.issues.length === 0 ? (
            <Empty>{t('weeklyReview.workspace.issues.empty')}</Empty>
          ) : (
            <ItemList>
              {snap.issues.map((i) => (
                <ItemRow key={i.id}>
                  <ItemTitle>{i.title}</ItemTitle>
                  <ItemMeta>{i.project_name || '—'} · {t('weeklyReview.workspace.issues.daysOpen', { n: i.days_open })}</ItemMeta>
                </ItemRow>
              ))}
            </ItemList>
          )}
        </Card>

        {/* Next Week Focus */}
        <Card>
          <CardTitle>{t('weeklyReview.workspace.nextWeek.title')}</CardTitle>
          {snap.next_week_focus.length === 0 ? (
            <Empty>{t('weeklyReview.workspace.nextWeek.empty')}</Empty>
          ) : (
            <ItemList>
              {snap.next_week_focus.map((n) => (
                <ItemRow key={n.task_id}>
                  <ItemTitle>
                    <DDayChip $danger={n.days_until <= 1}>{t('weeklyReview.workspace.nextWeek.dueIn', { n: n.days_until })}</DDayChip>
                    {n.title}
                  </ItemTitle>
                  <ItemMeta>{n.assignee_name} · {n.project_name || '—'}</ItemMeta>
                </ItemRow>
              ))}
            </ItemList>
          )}
        </Card>

        {/* Decisions Required */}
        <Card>
          <CardTitle>{t('weeklyReview.workspace.decisions.title')}</CardTitle>
          {snap.decisions_required.length === 0 ? (
            <Empty>{t('weeklyReview.workspace.decisions.empty')}</Empty>
          ) : (
            <ItemList>
              {snap.decisions_required.map((d) => (
                <ItemRow key={`${d.kind}-${d.task_id}`}>
                  <ItemTitle>
                    <DecisionChip>{decisionKindLabel(t, d.kind)}</DecisionChip>
                    {d.title}
                  </ItemTitle>
                  <ItemMeta>{d.project_name || '—'} · {d.suggested_action}</ItemMeta>
                </ItemRow>
              ))}
            </ItemList>
          )}
        </Card>
      </Grid3x2>

      {/* Portfolio */}
      <Card>
        <CardTitle>{t('weeklyReview.workspace.portfolio.title')}</CardTitle>
        {snap.portfolio.length === 0 ? (
          <Empty>{t('weeklyReview.workspace.portfolio.empty')}</Empty>
        ) : (
          <PortfolioGrid>
            {snap.portfolio.map((p) => (
              <ProjectCard key={p.project_id}>
                <ProjectHead>
                  <HealthDot $h={p.health} />
                  <ProjectName>{p.name}</ProjectName>
                  <HealthLabel $h={p.health}>{healthLabel(t, p.health)}</HealthLabel>
                </ProjectHead>
                <ProgressBar><ProgressFill $pct={p.progress_percent} /></ProgressBar>
                <ProjectMeta>
                  <span>{p.progress_percent}%</span>
                  {p.progress_delta !== 0 && <DeltaText $up={p.progress_delta > 0}>{p.progress_delta > 0 ? '+' : ''}{p.progress_delta}pp</DeltaText>}
                  <span>{t('weeklyReview.workspace.portfolio.tasks', { c: p.completed_tasks, t: p.total_tasks })}</span>
                  {p.overdue_count > 0 && <Pill $danger>⚠ {p.overdue_count}</Pill>}
                  {p.d_day !== null && <Pill $warn={p.d_day < 7 && p.d_day >= 0}>{p.d_day < 0 ? `D+${-p.d_day}` : `D-${p.d_day}`}</Pill>}
                </ProjectMeta>
              </ProjectCard>
            ))}
          </PortfolioGrid>
        )}
      </Card>

      {/* Member Heatmap */}
      <Card>
        <CardTitle>{t('weeklyReview.workspace.heatmap.title')}</CardTitle>
        {snap.member_utilization.length === 0 ? (
          <Empty>{t('weeklyReview.workspace.heatmap.empty')}</Empty>
        ) : (
          <HeatmapList>
            {snap.member_utilization.map((m) => (
              <HeatRow key={m.user_id}>
                <HeatName>{m.name}</HeatName>
                <HeatBarWrap><HeatBar $pct={Math.min(150, m.utilization_pct)} $status={m.status} /></HeatBarWrap>
                <HeatPct $status={m.status}>{m.utilization_pct}%</HeatPct>
                <HeatMeta>{m.actual_hours}h / {m.capacity_hours}h · {t('weeklyReview.workspace.heatmap.tasksCount', { c: m.completed_tasks })}</HeatMeta>
                <HeatStatus $status={m.status}>{loadStatusLabel(t, m.status)}</HeatStatus>
              </HeatRow>
            ))}
          </HeatmapList>
        )}
      </Card>

      {/* Team Highlights */}
      <Card>
        <CardTitle>{t('weeklyReview.workspace.team.title')}</CardTitle>
        {snap.team_highlights.length === 0 ? (
          <Empty>{t('weeklyReview.workspace.team.empty')}</Empty>
        ) : (
          <TeamList>
            {snap.team_highlights.map((th) => (
              <TeamRow key={th.user_id}>
                <TeamName>{th.name}</TeamName>
                <TeamBody>
                  {th.top_completion ? (
                    <TeamTop>✓ {th.top_completion.title}</TeamTop>
                  ) : (
                    <TeamTopMuted>{t('weeklyReview.workspace.team.noTop')}</TeamTopMuted>
                  )}
                  {th.retro_excerpt && <TeamRetro>"{th.retro_excerpt}"</TeamRetro>}
                </TeamBody>
                {onDrillDownMember && (
                  <DrillBtn type="button" onClick={() => onDrillDownMember(th.user_id, report.week_start)}
                    title={t('weeklyReview.workspace.drillDown') as string}>→</DrillBtn>
                )}
              </TeamRow>
            ))}
          </TeamList>
        )}
      </Card>

      {/* Workspace Retro */}
      <Card>
        <CardTitle>{t('weeklyReview.workspace.retro.label')}</CardTitle>
        <RetroTextarea
          value={retroDraft}
          onChange={(e) => setRetroDraft(e.target.value)}
          placeholder={t('weeklyReview.workspace.retro.placeholder') as string}
          disabled={!canEdit}
          rows={4}
        />
        {savingRetro && <SaveHint>...</SaveHint>}
      </Card>
    </Wrap>
  );
};

export default WeeklyReviewWorkspaceView;

// ─── 라벨 헬퍼 ───
function riskKindLabel(t: (k: string) => string, k: RiskKind): string {
  return t(`weeklyReview.workspace.risks.kind${k === 'overdue' ? 'Overdue' : k === 'stalled' ? 'Stalled' : 'DueSoonLow'}`);
}
function blockerStatusLabel(t: (k: string) => string, s: BlockerStatus): string {
  return t(`weeklyReview.workspace.blockers.status${s === 'waiting' ? 'Waiting' : 'Revision'}`);
}
function healthLabel(t: (k: string) => string, h: Health): string {
  return t(`weeklyReview.workspace.portfolio.health${h === 'green' ? 'Green' : h === 'yellow' ? 'Yellow' : 'Red'}`);
}
function loadStatusLabel(t: (k: string) => string, s: MemberLoadStatus): string {
  return t(`weeklyReview.workspace.heatmap.${s}`);
}
function decisionKindLabel(t: (k: string) => string, k: string): string {
  if (k === 'revision_blocked') return t('weeklyReview.workspace.decisions.kindRevision');
  if (k === 'unassigned_due_soon') return t('weeklyReview.workspace.decisions.kindUnassigned');
  return t('weeklyReview.workspace.decisions.kindOverdueNoReviewer');
}

// ─── KPI Tile 컴포넌트 ───
const KpiTileCard: React.FC<{ label: string; tile: KpiTile; suffix?: string; dangerOnRise?: boolean }> = ({ label, tile, suffix, dangerOnRise }) => (
  <KpiTileEl>
    <KpiLabel>{label}</KpiLabel>
    <KpiValue>{tile.value}{suffix || ''}</KpiValue>
    {tile.delta !== null && tile.delta !== 0 && (
      <KpiDelta $danger={dangerOnRise ? tile.delta > 0 : tile.delta < 0}>
        {tile.delta > 0 ? '+' : ''}{tile.delta}{suffix || ''}
      </KpiDelta>
    )}
    {tile.delta === null && <KpiDeltaMuted>—</KpiDeltaMuted>}
  </KpiTileEl>
);

// ─── styled ───
const Wrap = styled.div`
  padding: 24px;
  height: 100%;
  overflow-y: auto;
  background: #F8FAFC;
  display: flex;
  flex-direction: column;
  gap: 16px;
  @media (max-width: 768px) { padding: 16px; gap: 12px; }
`;
const Center = styled.div`
  display: flex; align-items: center; justify-content: center;
  height: 100%; min-height: 200px; color: #94A3B8; font-size: 13px;
`;
const TopBar = styled.div`
  display: flex; align-items: center; gap: 12px;
  padding: 4px 0;
`;
const BackBtn = styled.button`
  background: transparent; border: none; color: #0F766E;
  font-size: 13px; font-weight: 600; cursor: pointer;
  padding: 6px 10px; border-radius: 6px;
  &:hover { background: #F0FDFA; }
`;
const Period = styled.span`
  font-size: 14px; color: #334155; font-weight: 600;
`;
const Badge = styled.span<{ $auto: boolean }>`
  font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 4px;
  background: ${p => p.$auto ? '#DBEAFE' : '#F0FDF4'};
  color: ${p => p.$auto ? '#3B82F6' : '#22C55E'};
`;
const Hero = styled.div`
  background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 12px;
  padding: 20px; position: relative;
`;
const HeroLabel = styled.div`
  font-size: 11px; font-weight: 700; color: #64748B;
  text-transform: uppercase; letter-spacing: 0.6px; margin-bottom: 8px;
`;
const HeroTextarea = styled.textarea`
  width: 100%; border: none; outline: none; resize: none;
  font-size: 16px; color: #0F172A; font-weight: 600; line-height: 1.5;
  font-family: inherit;
  background: transparent;
  &::placeholder { color: #94A3B8; font-weight: 500; }
  &:disabled { cursor: default; }
`;
const SaveHint = styled.span`
  position: absolute; top: 16px; right: 16px;
  font-size: 11px; color: #14B8A6;
`;
const KpiBand = styled.div`
  display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px;
  @media (max-width: 1024px) { grid-template-columns: repeat(3, 1fr); }
  @media (max-width: 640px) { grid-template-columns: repeat(2, 1fr); }
`;
const KpiTileEl = styled.div`
  background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 10px;
  padding: 14px 16px;
  display: flex; flex-direction: column; gap: 2px;
`;
const KpiLabel = styled.div`
  font-size: 11px; color: #64748B; font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.4px;
`;
const KpiValue = styled.div`
  font-size: 24px; color: #0F172A; font-weight: 700; line-height: 1.2;
`;
const KpiDelta = styled.div<{ $danger?: boolean }>`
  font-size: 12px; font-weight: 600;
  color: ${p => p.$danger ? '#EF4444' : '#22C55E'};
`;
const KpiDeltaMuted = styled.div`
  font-size: 11px; color: #CBD5E1;
`;
const Grid3x2 = styled.div`
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px;
  @media (max-width: 1024px) { grid-template-columns: repeat(2, 1fr); }
  @media (max-width: 640px) { grid-template-columns: 1fr; }
`;
const Card = styled.div`
  background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 12px;
  padding: 16px 18px;
  display: flex; flex-direction: column; gap: 10px;
  position: relative;
`;
const CardTitle = styled.div`
  font-size: 13px; font-weight: 700; color: #0F172A;
`;
const Empty = styled.div`
  font-size: 12px; color: #94A3B8; padding: 8px 0;
`;
const ItemList = styled.div`
  display: flex; flex-direction: column; gap: 10px;
  max-height: 220px; overflow-y: auto;
`;
const ItemRow = styled.div`
  display: flex; flex-direction: column; gap: 2px;
  padding-bottom: 8px;
  &:not(:last-child) { border-bottom: 1px solid #F1F5F9; }
`;
const ItemTitle = styled.div`
  font-size: 13px; color: #0F172A; font-weight: 500;
  display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap;
`;
const ItemMeta = styled.div`
  font-size: 11px; color: #64748B;
`;
const Snippet = styled.div`
  font-size: 11px; color: #475569; font-style: italic;
  background: #F8FAFC; padding: 4px 8px; border-radius: 4px; margin-top: 4px;
`;

const SevDot = styled.span<{ $sev: Severity }>`
  display: inline-block; width: 8px; height: 8px; border-radius: 50%;
  background: ${p => p.$sev === 'high' ? '#EF4444' : p.$sev === 'medium' ? '#F59E0B' : '#94A3B8'};
`;
const RiskKindChip = styled.span<{ $kind: RiskKind }>`
  font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 3px;
  background: ${p => p.$kind === 'overdue' ? '#FEE2E2' : p.$kind === 'stalled' ? '#FEF3C7' : '#FFEDD5'};
  color: ${p => p.$kind === 'overdue' ? '#991B1B' : p.$kind === 'stalled' ? '#92400E' : '#9A3412'};
`;
const BlockerChip = styled.span<{ $status: BlockerStatus }>`
  font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 3px;
  background: ${p => p.$status === 'waiting' ? '#E0E7FF' : '#FEE2E2'};
  color: ${p => p.$status === 'waiting' ? '#3730A3' : '#991B1B'};
`;
const DDayChip = styled.span<{ $danger?: boolean }>`
  font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 3px;
  background: ${p => p.$danger ? '#FEE2E2' : '#F1F5F9'};
  color: ${p => p.$danger ? '#991B1B' : '#475569'};
`;
const DecisionChip = styled.span`
  font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 3px;
  background: #FFE4E6; color: #BE123C;
`;

const PortfolioGrid = styled.div`
  display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px;
  @media (max-width: 768px) { grid-template-columns: 1fr; }
`;
const ProjectCard = styled.div`
  background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px;
  padding: 10px 12px;
  display: flex; flex-direction: column; gap: 6px;
`;
const ProjectHead = styled.div`
  display: flex; align-items: center; gap: 6px;
`;
const HealthDot = styled.span<{ $h: Health }>`
  width: 8px; height: 8px; border-radius: 50%;
  background: ${p => p.$h === 'green' ? '#22C55E' : p.$h === 'yellow' ? '#F59E0B' : '#EF4444'};
`;
const ProjectName = styled.span`
  font-size: 13px; font-weight: 600; color: #0F172A; flex: 1;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
`;
const HealthLabel = styled.span<{ $h: Health }>`
  font-size: 10px; font-weight: 600;
  color: ${p => p.$h === 'green' ? '#15803D' : p.$h === 'yellow' ? '#92400E' : '#991B1B'};
`;
const ProgressBar = styled.div`
  height: 4px; background: #E2E8F0; border-radius: 999px; overflow: hidden;
`;
const ProgressFill = styled.div<{ $pct: number }>`
  height: 100%; background: #14B8A6; width: ${p => Math.max(0, Math.min(100, p.$pct))}%;
  transition: width 0.3s;
`;
const ProjectMeta = styled.div`
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  font-size: 11px; color: #64748B;
`;
const DeltaText = styled.span<{ $up: boolean }>`
  font-weight: 600; color: ${p => p.$up ? '#22C55E' : '#EF4444'};
`;
const Pill = styled.span<{ $danger?: boolean; $warn?: boolean }>`
  font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 3px;
  background: ${p => p.$danger ? '#FEE2E2' : p.$warn ? '#FEF3C7' : '#F1F5F9'};
  color: ${p => p.$danger ? '#991B1B' : p.$warn ? '#92400E' : '#475569'};
`;

const HeatmapList = styled.div`
  display: flex; flex-direction: column; gap: 8px;
`;
const HeatRow = styled.div`
  display: grid; grid-template-columns: 120px 1fr 50px auto 70px;
  align-items: center; gap: 12px;
  padding: 6px 0;
  @media (max-width: 768px) {
    grid-template-columns: 100px 1fr 50px;
    & > :nth-child(4), & > :nth-child(5) { display: none; }
  }
`;
const HeatName = styled.div`
  font-size: 13px; color: #0F172A; font-weight: 500;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
`;
const HeatBarWrap = styled.div`
  height: 8px; background: #F1F5F9; border-radius: 999px; overflow: hidden;
  position: relative;
  &::after {
    content: ''; position: absolute; top: -1px; left: 66.67%; height: 10px; width: 1px;
    background: #CBD5E1;
  }
`;
const HeatBar = styled.div<{ $pct: number; $status: MemberLoadStatus }>`
  height: 100%; width: ${p => Math.min(100, (p.$pct / 1.5))}%;
  background: ${p => p.$status === 'overloaded' ? '#EF4444' : p.$status === 'underloaded' ? '#94A3B8' : '#14B8A6'};
  transition: width 0.3s;
`;
const HeatPct = styled.span<{ $status: MemberLoadStatus }>`
  font-size: 12px; font-weight: 700; text-align: right;
  color: ${p => p.$status === 'overloaded' ? '#EF4444' : p.$status === 'underloaded' ? '#94A3B8' : '#0F766E'};
`;
const HeatMeta = styled.span`
  font-size: 11px; color: #64748B;
`;
const HeatStatus = styled.span<{ $status: MemberLoadStatus }>`
  font-size: 11px; font-weight: 600; text-align: right;
  color: ${p => p.$status === 'overloaded' ? '#EF4444' : p.$status === 'underloaded' ? '#94A3B8' : '#22C55E'};
`;

const TeamList = styled.div`
  display: flex; flex-direction: column; gap: 8px;
`;
const TeamRow = styled.div`
  display: flex; align-items: flex-start; gap: 10px;
  padding: 8px 0;
  &:not(:last-child) { border-bottom: 1px solid #F1F5F9; }
`;
const TeamName = styled.div`
  font-size: 13px; font-weight: 600; color: #0F172A; width: 120px; flex-shrink: 0;
`;
const TeamBody = styled.div`
  flex: 1; display: flex; flex-direction: column; gap: 3px;
`;
const TeamTop = styled.div`
  font-size: 13px; color: #0F172A;
`;
const TeamTopMuted = styled.div`
  font-size: 12px; color: #94A3B8; font-style: italic;
`;
const TeamRetro = styled.div`
  font-size: 11px; color: #64748B; font-style: italic;
  background: #F8FAFC; padding: 4px 8px; border-radius: 4px;
`;
const DrillBtn = styled.button`
  background: transparent; border: 1px solid #E2E8F0; border-radius: 6px;
  padding: 4px 8px; cursor: pointer; color: #64748B; font-size: 12px;
  &:hover { background: #F0FDFA; color: #0F766E; border-color: #14B8A6; }
`;

const RetroTextarea = styled.textarea`
  width: 100%; border: 1px solid #E2E8F0; border-radius: 6px;
  padding: 10px 12px; font-size: 13px; color: #0F172A;
  font-family: inherit; resize: vertical; outline: none; min-height: 80px;
  background: #F8FAFC;
  &:focus { border-color: #0F766E; background: #FFFFFF; }
  &::placeholder { color: #94A3B8; }
  &:disabled { cursor: default; }
`;
