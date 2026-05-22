// WeeklyReviewTab — 주간 보고 탭 (4번째 탭 본문)
//
// 누적 결산 카드 리스트 + 자동 박제 토글

import React, { useState, useEffect, useCallback } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import {
  listWeeklyReviews,
  getWeeklyReviewSettings,
  updateWeeklyReviewSettings,
  listWorkspaceWeeklyReports,
  createWorkspaceWeeklyReport,
  type WeeklyReviewListItem,
  type WorkspaceWeeklyReportListItem,
} from '../../services/weeklyReview';
import WeeklyReviewView from './WeeklyReviewView';
import WeeklyReviewWorkspaceView from './WeeklyReviewWorkspaceView';
import WorkspaceFinalizeBanner from './WorkspaceFinalizeBanner';
import PlanQSelect, { type PlanQSelectOption } from '../Common/PlanQSelect';
import SearchBox from '../Common/SearchBox';

interface Props {
  businessId: number;
  userId: number;
  // 'workspace' 면 워크스페이스 전체 (owner 만), 카드에 user_name 표시
  reviewScope?: 'mine' | 'workspace';
}

const WeeklyReviewTab: React.FC<Props> = ({ businessId, userId, reviewScope = 'mine' }) => {
  const { t } = useTranslation('qtask');
  const [reviews, setReviews] = useState<WeeklyReviewListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [autoEnabled, setAutoEnabled] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  // workspace 모드 — 멤버 필터 + 검색
  const [memberFilter, setMemberFilter] = useState<number | 'all'>('all');
  const [search, setSearch] = useState('');
  // workspace 모드 전용 — 통합본 리스트 + 선택된 통합본 (사이클 N+18)
  const [workspaceReports, setWorkspaceReports] = useState<WorkspaceWeeklyReportListItem[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<number | null>(null);
  // N+38 — finalizing/finalizeError state + finalizeWorkspace 함수 + FinalizeBtn styled
  // workspace 탭의 수동 박제 버튼 제거로 unused. WorkspaceFinalizeBanner + 설정 페이지로 대체.

  const load = useCallback(async (append = false) => {
    try {
      const before = append && reviews.length > 0 ? reviews[reviews.length - 1].week_start : undefined;
      const list = await listWeeklyReviews({
        business_id: businessId,
        user_id: reviewScope === 'workspace' ? 'all' : userId,
        limit: reviewScope === 'workspace' ? 50 : 12,
        before,
      });
      if (append) {
        setReviews(prev => [...prev, ...list]);
      } else {
        setReviews(list);
      }
      setHasMore(list.length >= 12);
    } catch (e) {
      console.error('[WeeklyReviewTab] load error:', e);
    } finally {
      setLoading(false);
    }
  }, [businessId, userId, reviewScope, reviews]);

  // 통합본 (workspace 모드 전용)
  const loadWorkspaceReports = useCallback(async () => {
    if (reviewScope !== 'workspace') return;
    try {
      const list = await listWorkspaceWeeklyReports({ business_id: businessId, limit: 24 });
      setWorkspaceReports(list);
    } catch (e) {
      console.error('[WeeklyReviewTab] loadWorkspaceReports error:', e);
    }
  }, [businessId, reviewScope]);

  useEffect(() => {
    load();
    loadWorkspaceReports();
    // 설정 조회
    (async () => {
      try {
        const settings = await getWeeklyReviewSettings(businessId);
        setAutoEnabled(settings.auto_enabled);
      } catch (e) {
        // default ON
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId, userId, reviewScope]);

  const toggleAuto = async () => {
    const newVal = !autoEnabled;
    setAutoEnabled(newVal);
    try {
      await updateWeeklyReviewSettings({ business_id: businessId, auto_enabled: newVal });
    } catch (e) {
      setAutoEnabled(!newVal); // 롤백
    }
  };

  // 주차 라벨 (5월 1주차 형식)
  const weekLabel = (weekStart: string) => {
    const d = new Date(weekStart);
    const month = d.getMonth() + 1;
    const weekOfMonth = Math.ceil(d.getDate() / 7);
    return t('weeklyReview.tab.weekLabel', { n: month, w: weekOfMonth, defaultValue: `${month}월 ${weekOfMonth}주차` });
  };

  // 뷰 모드
  if (selectedId !== null) {
    return (
      <WeeklyReviewView
        reviewId={selectedId}
        onBack={() => { setSelectedId(null); load(false); }}
      />
    );
  }
  if (selectedWorkspaceId !== null) {
    return (
      <WeeklyReviewWorkspaceView
        reportId={selectedWorkspaceId}
        onBack={() => { setSelectedWorkspaceId(null); loadWorkspaceReports(); }}
      />
    );
  }

  return (
    <Container>
      {reviewScope === 'workspace' && <WorkspaceFinalizeBanner businessId={businessId} />}
      <Header>
        <HeaderLeft>
          {reviewScope === 'workspace' && (() => {
            const memberOpts: PlanQSelectOption[] = [
              { value: 'all', label: t('weeklyReview.filter.allMembers', { defaultValue: '전체 멤버' }) as string },
              ...[...new Map(reviews.filter(r => r.user_id && r.user_name).map(r => [r.user_id, r.user_name])).entries()].map(([uid, name]) => ({
                value: String(uid), label: String(name || ''),
              })),
            ];
            return (
              <div style={{ minWidth: 160 }}>
                <PlanQSelect
                  size="sm"
                  isClearable={false}
                  isSearchable={false}
                  value={memberOpts.find(o => o.value === String(memberFilter)) || memberOpts[0]}
                  options={memberOpts}
                  onChange={(opt) => {
                    const v = (opt as PlanQSelectOption)?.value;
                    setMemberFilter(v === 'all' ? 'all' : Number(v));
                  }}
                />
              </div>
            );
          })()}
          <SearchBox
            placeholder={t('weeklyReview.filter.search', { defaultValue: '주차·메모 검색' }) as string}
            value={search}
            onChange={setSearch}
            width={200}
            size="md"
          />
          <Count>{reviews.length}</Count>
        </HeaderLeft>
        {/* N+38 — workspace 탭의 수동 "이번 주 마무리" 버튼 + AutoToggle 제거.
            WorkspaceFinalizeBanner 가 자동 박제 안내 + [설정 변경 →] 링크 제공 — 중복 UI 차단.
            사용자 호소: "이런 버튼 필요해? 자동 박제 default ON 이면 의미 없어".
            mine 탭의 AutoToggle 은 본인 자동 박제 토글이라 유지. */}
        {reviewScope !== 'workspace' && (
        <AutoToggle>
          <AutoLabel>{t('weeklyReview.auto.title', '자동 확정')}</AutoLabel>
          <ToggleSwitch onClick={toggleAuto} $on={autoEnabled}>
            <ToggleKnob $on={autoEnabled} />
          </ToggleSwitch>
          <AutoStatus $on={autoEnabled}>
            {autoEnabled ? t('weeklyReview.auto.enabled', '켜짐') : t('weeklyReview.auto.disabled', '꺼짐')}
          </AutoStatus>
        </AutoToggle>
        )}
      </Header>


      {/* workspace 모드 — 통합본 카드 (워크스페이스 × 주차 = 1) */}
      {reviewScope === 'workspace' && workspaceReports.length > 0 && (
        <>
          <SectionLabel>{t('weeklyReview.workspace.tabTitle')}</SectionLabel>
          <WorkspaceCardList>
            {workspaceReports.map(r => (
              <WorkspaceCard key={r.id} onClick={() => setSelectedWorkspaceId(r.id)}>
                <CardHeader>
                  <WeekLabel>
                    {weekLabel(r.week_start)}
                    <WsChip>{t('weeklyReview.workspace.tabTitle')}</WsChip>
                  </WeekLabel>
                  <Badge $auto={r.finalized_by === 'auto'}>
                    {r.finalized_by === 'auto' ? t('weeklyReview.tab.autoBadge', '자동') : t('weeklyReview.tab.manualBadge', '수동')}
                  </Badge>
                </CardHeader>
                <CardPeriod>{String(r.week_start).slice(0, 10)} ~ {String(r.week_end).slice(0, 10)}</CardPeriod>
                {r.executive_summary && <WsExec>{r.executive_summary}</WsExec>}
                {r.kpi && (
                  <WsKpiRow>
                    <span>완료 {r.kpi.completed_tasks.value}</span>
                    <span>·</span>
                    <span>프로젝트 {r.kpi.active_projects.value}</span>
                    <span>·</span>
                    <span>가동률 {r.kpi.avg_utilization_pct.value}%</span>
                    {r.kpi.overdue_tasks.value > 0 && <WsDanger>지연 {r.kpi.overdue_tasks.value}</WsDanger>}
                  </WsKpiRow>
                )}
                {r.retro_note && <CardNote>{r.retro_note}</CardNote>}
              </WorkspaceCard>
            ))}
          </WorkspaceCardList>
          <SectionLabel>{t('tab.weeklyReview', '주간 보고')} · 멤버 개인본</SectionLabel>
        </>
      )}

      {loading ? (
        <Loading>{t('page.loading', '로드 중...')}</Loading>
      ) : reviews.length === 0 ? (
        <Empty>
          <EmptyTitle>{t('weeklyReview.tab.empty', '아직 저장된 결산이 없습니다')}</EmptyTitle>
          <EmptyHint>{t('weeklyReview.tab.emptyHint', '"이번 주 마무리" 버튼으로 결산을 저장해보세요.')}</EmptyHint>
        </Empty>
      ) : (
        <>
          <CardList>
            {reviews
              .filter(r => reviewScope !== 'workspace' || memberFilter === 'all' || r.user_id === memberFilter)
              .filter(r => {
                if (!search.trim()) return true;
                const q = search.toLowerCase();
                return String(r.week_start).includes(q)
                  || String(r.week_end).includes(q)
                  || (r.retro_note || '').toLowerCase().includes(q)
                  || (r.user_name || '').toLowerCase().includes(q);
              })
              .map(r => (
              <Card key={r.id} onClick={() => setSelectedId(r.id)}>
                <CardHeader>
                  <WeekLabel>
                    {weekLabel(r.week_start)}
                    {reviewScope === 'workspace' && r.user_name && <UserChip>{r.user_name}</UserChip>}
                  </WeekLabel>
                  <Badge $auto={r.finalized_by === 'auto'}>
                    {r.finalized_by === 'auto'
                      ? t('weeklyReview.tab.autoBadge', '자동')
                      : t('weeklyReview.tab.manualBadge', '수동')}
                  </Badge>
                </CardHeader>
                <CardPeriod>{String(r.week_start).slice(0, 10)} ~ {String(r.week_end).slice(0, 10)}</CardPeriod>
                {r.summary && (
                  <CardSummary>
                    <SummaryItem>
                      <span>{t('weeklyReview.modal.summary', { c: r.summary.completed, i: r.summary.incomplete, defaultValue: `완료 ${r.summary.completed}건 / 미완료 ${r.summary.incomplete}건` })}</span>
                    </SummaryItem>
                    <SummaryItem>
                      <span>{t('weeklyReview.modal.hours', { a: r.summary.actual_total, e: r.summary.estimated_total, p: r.summary.utilization_pct, defaultValue: `사용 ${r.summary.actual_total}h / 예측 ${r.summary.estimated_total}h` })}</span>
                    </SummaryItem>
                  </CardSummary>
                )}
                {r.retro_note && <CardNote>{r.retro_note}</CardNote>}
              </Card>
            ))}
          </CardList>
          {hasMore && (
            <LoadMore onClick={() => load(true)}>
              {t('common.loadMore', '더 보기')}
            </LoadMore>
          )}
        </>
      )}
    </Container>
  );
};

export default WeeklyReviewTab;

// ─── Styles ───
const Container = styled.div`
  padding: 20px;
  height: 100%;
  overflow-y: auto;
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
`;

const HeaderLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
`;


const Count = styled.span`
  background: #f1f5f9;
  color: #64748b;
  font-size: 12px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 10px;
`;

const AutoToggle = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const AutoLabel = styled.span`
  font-size: 13px;
  color: #64748b;
`;

const ToggleSwitch = styled.div<{ $on: boolean }>`
  width: 36px;
  height: 20px;
  background: ${p => p.$on ? '#14b8a6' : '#cbd5e1'};
  border-radius: 10px;
  position: relative;
  cursor: pointer;
  transition: background 0.2s;
`;

const ToggleKnob = styled.div<{ $on: boolean }>`
  width: 16px;
  height: 16px;
  background: #fff;
  border-radius: 50%;
  position: absolute;
  top: 2px;
  left: ${p => p.$on ? '18px' : '2px'};
  transition: left 0.2s;
  box-shadow: 0 1px 3px rgba(0,0,0,0.2);
`;

const AutoStatus = styled.span<{ $on: boolean }>`
  font-size: 12px;
  color: ${p => p.$on ? '#14b8a6' : '#94a3b8'};
  font-weight: 500;
`;

const Loading = styled.div`
  text-align: center;
  color: #94a3b8;
  padding: 40px;
`;

const Empty = styled.div`
  text-align: center;
  padding: 60px 20px;
`;

const EmptyTitle = styled.div`
  font-size: 15px;
  color: #64748b;
  margin-bottom: 8px;
`;

const EmptyHint = styled.div`
  font-size: 13px;
  color: #94a3b8;
`;

const CardList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const Card = styled.div`
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 16px;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
  &:hover {
    border-color: #14b8a6;
    box-shadow: 0 2px 8px rgba(20,184,166,0.1);
  }
`;

const CardHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
`;

const WeekLabel = styled.span`
  font-size: 15px;
  font-weight: 600;
  color: #1e293b;
  display: inline-flex; align-items: center; gap: 8px;
`;
const UserChip = styled.span`
  font-size: 11px; font-weight: 600; color: #0F766E;
  background: #F0FDFA; padding: 2px 8px; border-radius: 999px;
`;

const Badge = styled.span<{ $auto: boolean }>`
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 4px;
  background: ${p => p.$auto ? '#dbeafe' : '#f0fdf4'};
  color: ${p => p.$auto ? '#3b82f6' : '#22c55e'};
`;

const CardPeriod = styled.div`
  font-size: 12px;
  color: #94a3b8;
  margin-bottom: 10px;
`;

const CardSummary = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 8px;
`;

const SummaryItem = styled.div`
  font-size: 13px;
  color: #475569;
`;

const CardNote = styled.div`
  font-size: 13px;
  color: #64748b;
  background: #f8fafc;
  padding: 8px 10px;
  border-radius: 6px;
  margin-top: 8px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const LoadMore = styled.button`
  display: block;
  width: 100%;
  margin-top: 16px;
  padding: 10px;
  border: 1px solid #e2e8f0;
  background: #fff;
  border-radius: 8px;
  font-size: 13px;
  color: #64748b;
  cursor: pointer;
  &:hover { background: #f8fafc; }
`;

// ─── workspace 통합본 (사이클 N+18) ───
const SectionLabel = styled.div`
  font-size: 11px; font-weight: 700; color: #64748B;
  text-transform: uppercase; letter-spacing: 0.6px;
  margin: 12px 0 4px;
`;
// N+38 — FinalizeBtn 제거. workspace 수동 박제 버튼 unused.
const ErrorMsg = styled.div`
  background: #FEE2E2; color: #991B1B; padding: 8px 12px;
  border-radius: 6px; font-size: 12px;
`;
const WorkspaceCardList = styled.div`
  display: flex; flex-direction: column; gap: 12px;
`;
const WorkspaceCard = styled.div`
  background: linear-gradient(135deg, #F0FDFA 0%, #FFFFFF 100%);
  border: 1px solid #14B8A6; border-left: 4px solid #14B8A6;
  border-radius: 10px; padding: 16px;
  cursor: pointer;
  transition: box-shadow 0.15s, transform 0.05s;
  &:hover { box-shadow: 0 4px 16px rgba(20,184,166,0.18); }
  &:active { transform: translateY(1px); }
`;
const WsChip = styled.span`
  font-size: 11px; font-weight: 700; color: #FFFFFF;
  background: #0F766E; padding: 2px 8px; border-radius: 999px;
`;
const WsExec = styled.div`
  font-size: 13px; color: #0F172A; font-weight: 600;
  margin: 8px 0; line-height: 1.5;
`;
const WsKpiRow = styled.div`
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  font-size: 12px; color: #475569;
`;
const WsDanger = styled.span`
  font-size: 11px; font-weight: 600; color: #991B1B;
  background: #FEE2E2; padding: 1px 6px; border-radius: 3px;
`;
