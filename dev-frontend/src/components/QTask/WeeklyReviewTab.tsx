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
  type WeeklyReviewListItem,
} from '../../services/weeklyReview';
import WeeklyReviewView from './WeeklyReviewView';

interface Props {
  businessId: number;
  userId: number;
}

const WeeklyReviewTab: React.FC<Props> = ({ businessId, userId }) => {
  const { t } = useTranslation('qtask');
  const [reviews, setReviews] = useState<WeeklyReviewListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [autoEnabled, setAutoEnabled] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);

  const load = useCallback(async (append = false) => {
    try {
      const before = append && reviews.length > 0 ? reviews[reviews.length - 1].week_start : undefined;
      const list = await listWeeklyReviews({
        business_id: businessId,
        user_id: userId,
        limit: 12,
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
  }, [businessId, userId, reviews]);

  useEffect(() => {
    load();
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
  }, [businessId, userId]);

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
        onBack={() => setSelectedId(null)}
      />
    );
  }

  return (
    <Container>
      <Header>
        <HeaderLeft>
          <Title>{t('tab.weeklyReview', '주간 보고')}</Title>
          <Count>{reviews.length}</Count>
        </HeaderLeft>
        <AutoToggle>
          <AutoLabel>{t('weeklyReview.auto.title', '자동 박제')}</AutoLabel>
          <ToggleSwitch onClick={toggleAuto} $on={autoEnabled}>
            <ToggleKnob $on={autoEnabled} />
          </ToggleSwitch>
          <AutoStatus $on={autoEnabled}>
            {autoEnabled ? t('weeklyReview.auto.enabled', '켜짐') : t('weeklyReview.auto.disabled', '꺼짐')}
          </AutoStatus>
        </AutoToggle>
      </Header>

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
            {reviews.map(r => (
              <Card key={r.id} onClick={() => setSelectedId(r.id)}>
                <CardHeader>
                  <WeekLabel>{weekLabel(r.week_start)}</WeekLabel>
                  <Badge $auto={r.finalized_by === 'auto'}>
                    {r.finalized_by === 'auto'
                      ? t('weeklyReview.tab.autoBadge', '자동')
                      : t('weeklyReview.tab.manualBadge', '수동')}
                  </Badge>
                </CardHeader>
                <CardPeriod>{r.week_start} ~ {r.week_end}</CardPeriod>
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
`;

const Title = styled.h2`
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  color: #1e293b;
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
