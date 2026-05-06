// WeeklyReviewView — 주간 보고 풀 view (snapshot_data 포함)
//
// 카드 클릭 시 상세 보기. 업무 리스트 + 요약 + 번다운 + 한 주 메모.

import React, { useState, useEffect } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import {
  getWeeklyReview,
  updateWeeklyReviewNote,
  type WeeklyReview,
} from '../../services/weeklyReview';
import { STATUS_COLOR } from '../../utils/taskLabel';

interface Props {
  reviewId: number;
  onBack: () => void;
}

const WeeklyReviewView: React.FC<Props> = ({ reviewId, onBack }) => {
  const { t } = useTranslation('qtask');
  const [review, setReview] = useState<WeeklyReview | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingNote, setEditingNote] = useState(false);
  const [noteValue, setNoteValue] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const data = await getWeeklyReview(reviewId);
        setReview(data);
        setNoteValue(data.retro_note || '');
      } catch (e) {
        console.error('[WeeklyReviewView] load error:', e);
      } finally {
        setLoading(false);
      }
    })();
  }, [reviewId]);

  const saveNote = async () => {
    if (!review || savingNote) return;
    setSavingNote(true);
    try {
      const updated = await updateWeeklyReviewNote(review.id, noteValue.trim() || null);
      setReview(updated);
      setEditingNote(false);
    } catch (e) {
      console.error('[WeeklyReviewView] save note error:', e);
    } finally {
      setSavingNote(false);
    }
  };

  if (loading) {
    return <Loading>{t('page.loading', '로드 중...')}</Loading>;
  }

  if (!review) {
    return <Error>Not found</Error>;
  }

  const { snapshot_data: snap } = review;
  const tasks = snap?.tasks || [];
  const summary = snap?.summary;
  const burndown = snap?.burndown || [];

  // 주차 라벨
  const weekLabel = () => {
    const d = new Date(review.week_start);
    const month = d.getMonth() + 1;
    const weekOfMonth = Math.ceil(d.getDate() / 7);
    return `${month}월 ${weekOfMonth}주차`;
  };

  return (
    <Container>
      <Header>
        <BackBtn onClick={onBack}>&larr; {t('weeklyReview.view.back', '결산 목록')}</BackBtn>
        <HeaderTitle>
          {weekLabel()}
          <Badge $auto={review.finalized_by === 'auto'}>
            {review.finalized_by === 'auto' ? t('weeklyReview.tab.autoBadge', '자동') : t('weeklyReview.tab.manualBadge', '수동')}
          </Badge>
        </HeaderTitle>
        <Period>{review.week_start} ~ {review.week_end}</Period>
      </Header>

      {/* 요약 섹션 */}
      {summary && (
        <Section>
          <SectionTitle>{t('weeklyReview.view.summaryTitle', '요약')}</SectionTitle>
          <SummaryGrid>
            <SummaryCard>
              <SummaryLabel>{t('common.total', '총 업무')}</SummaryLabel>
              <SummaryValue>{summary.total}</SummaryValue>
            </SummaryCard>
            <SummaryCard>
              <SummaryLabel>{t('common.completed', '완료')}</SummaryLabel>
              <SummaryValue $color="#22c55e">{summary.completed}</SummaryValue>
            </SummaryCard>
            <SummaryCard>
              <SummaryLabel>{t('common.incomplete', '미완료')}</SummaryLabel>
              <SummaryValue $color={summary.incomplete > 0 ? '#f59e0b' : undefined}>{summary.incomplete}</SummaryValue>
            </SummaryCard>
            <SummaryCard>
              <SummaryLabel>{t('summary.est', '예측')}</SummaryLabel>
              <SummaryValue>{summary.estimated_total}h</SummaryValue>
            </SummaryCard>
            <SummaryCard>
              <SummaryLabel>{t('summary.act', '실제')}</SummaryLabel>
              <SummaryValue>{summary.actual_total}h</SummaryValue>
            </SummaryCard>
            <SummaryCard>
              <SummaryLabel>{t('common.utilization', '활용률')}</SummaryLabel>
              <SummaryValue $color={summary.utilization_pct > 100 ? '#ef4444' : '#14b8a6'}>
                {summary.utilization_pct}%
              </SummaryValue>
            </SummaryCard>
          </SummaryGrid>
        </Section>
      )}

      {/* 한 주 메모 */}
      <Section>
        <SectionTitle>
          {t('weeklyReview.view.noteTitle', '한 주 메모')}
          {!editingNote && (
            <EditBtn onClick={() => setEditingNote(true)}>
              {review.retro_note ? t('common.edit', '수정') : t('weeklyReview.view.addNote', '메모 추가')}
            </EditBtn>
          )}
        </SectionTitle>
        {editingNote ? (
          <NoteEditArea>
            <NoteTextarea
              value={noteValue}
              onChange={e => setNoteValue(e.target.value)}
              placeholder={t('weeklyReview.modal.notePlaceholder', '이번 주 어땠나요?')}
              rows={3}
            />
            <NoteActions>
              <CancelBtn onClick={() => { setEditingNote(false); setNoteValue(review.retro_note || ''); }}>
                {t('common.cancel', '취소')}
              </CancelBtn>
              <SaveBtn onClick={saveNote} disabled={savingNote}>
                {savingNote ? '...' : t('common.save', '저장')}
              </SaveBtn>
            </NoteActions>
          </NoteEditArea>
        ) : (
          <NoteDisplay>{review.retro_note || <Muted>-</Muted>}</NoteDisplay>
        )}
      </Section>

      {/* 업무 리스트 */}
      <Section>
        <SectionTitle>{t('weeklyReview.view.tasksTitle', '그 주 업무')} ({tasks.length})</SectionTitle>
        {tasks.length === 0 ? (
          <Empty>{t('list.empty', '해당하는 업무가 없습니다')}</Empty>
        ) : (
          <TaskTable>
            <thead>
              <tr>
                <Th style={{ width: 40 }}>#</Th>
                <Th>{t('col.task', '업무')}</Th>
                <Th style={{ width: 80 }}>{t('col.status', '상태')}</Th>
                <Th style={{ width: 60 }}>{t('col.est', '예측')}</Th>
                <Th style={{ width: 60 }}>{t('col.act', '실제')}</Th>
                <Th style={{ width: 70 }}>{t('col.progress', '진행')}</Th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((task, idx) => (
                <TaskRow key={task.id} $completed={task.status === 'completed'}>
                  <Td>{task.priority_order ?? idx + 1}</Td>
                  <Td>
                    <TaskTitle>{task.title}</TaskTitle>
                    {task.project_name && <TaskProject>{task.project_name}</TaskProject>}
                  </Td>
                  <Td>
                    <StatusBadge $color={STATUS_COLOR[task.status as keyof typeof STATUS_COLOR]?.fg || '#94a3b8'}>
                      {task.status}
                    </StatusBadge>
                  </Td>
                  <Td style={{ textAlign: 'right' }}>{task.estimated_hours || '-'}</Td>
                  <Td style={{ textAlign: 'right' }}>{task.actual_hours || '-'}</Td>
                  <Td style={{ textAlign: 'right' }}>{task.progress_percent}%</Td>
                </TaskRow>
              ))}
            </tbody>
          </TaskTable>
        )}
      </Section>

      {/* 번다운 (간단 표시) */}
      {burndown.length > 0 && (
        <Section>
          <SectionTitle>{t('weeklyReview.view.burndownTitle', '주간 진척')}</SectionTitle>
          <BurndownRow>
            {burndown.map((p, i) => (
              <BurndownDay key={i}>
                <BurndownDate>{p.date.slice(5).replace('-', '/')}</BurndownDate>
                <BurndownBar>
                  <BurndownInner $pct={Math.min(100, (p.actual_cumulative / (p.estimated_cumulative || 1)) * 100)} />
                </BurndownBar>
                <BurndownVal>{p.actual_cumulative}h</BurndownVal>
              </BurndownDay>
            ))}
          </BurndownRow>
        </Section>
      )}
    </Container>
  );
};

export default WeeklyReviewView;

// ─── Styles ───
const Container = styled.div`
  padding: 20px;
  height: 100%;
  overflow-y: auto;
`;

const Loading = styled.div`
  padding: 40px;
  text-align: center;
  color: #94a3b8;
`;

const Error = styled.div`
  padding: 40px;
  text-align: center;
  color: #ef4444;
`;

const Header = styled.div`
  margin-bottom: 24px;
`;

const BackBtn = styled.button`
  background: none;
  border: none;
  color: #64748b;
  font-size: 13px;
  cursor: pointer;
  padding: 0;
  margin-bottom: 8px;
  &:hover { color: #14b8a6; }
`;

const HeaderTitle = styled.h1`
  margin: 0 0 4px;
  font-size: 20px;
  font-weight: 700;
  color: #1e293b;
  display: flex;
  align-items: center;
  gap: 10px;
`;

const Badge = styled.span<{ $auto: boolean }>`
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 4px;
  background: ${p => p.$auto ? '#dbeafe' : '#f0fdf4'};
  color: ${p => p.$auto ? '#3b82f6' : '#22c55e'};
`;

const Period = styled.div`
  font-size: 13px;
  color: #94a3b8;
`;

const Section = styled.section`
  margin-bottom: 28px;
`;

const SectionTitle = styled.h3`
  margin: 0 0 12px;
  font-size: 14px;
  font-weight: 600;
  color: #475569;
  display: flex;
  align-items: center;
  gap: 10px;
`;

const EditBtn = styled.button`
  background: none;
  border: none;
  color: #14b8a6;
  font-size: 12px;
  cursor: pointer;
  &:hover { text-decoration: underline; }
`;

const SummaryGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
  gap: 12px;
`;

const SummaryCard = styled.div`
  background: #f8fafc;
  border-radius: 8px;
  padding: 12px;
  text-align: center;
`;

const SummaryLabel = styled.div`
  font-size: 11px;
  color: #94a3b8;
  margin-bottom: 4px;
`;

const SummaryValue = styled.div<{ $color?: string }>`
  font-size: 18px;
  font-weight: 700;
  color: ${p => p.$color || '#1e293b'};
`;

const NoteDisplay = styled.div`
  background: #f8fafc;
  border-radius: 8px;
  padding: 12px 14px;
  font-size: 14px;
  color: #475569;
  white-space: pre-wrap;
  min-height: 40px;
`;

const Muted = styled.span`
  color: #cbd5e1;
`;

const NoteEditArea = styled.div``;

const NoteTextarea = styled.textarea`
  width: 100%;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 14px;
  resize: vertical;
  min-height: 60px;
  &:focus { outline: none; border-color: #14b8a6; }
`;

const NoteActions = styled.div`
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 8px;
`;

const CancelBtn = styled.button`
  padding: 6px 12px;
  border: 1px solid #e2e8f0;
  background: #fff;
  border-radius: 5px;
  font-size: 13px;
  color: #64748b;
  cursor: pointer;
`;

const SaveBtn = styled.button`
  padding: 6px 14px;
  border: none;
  background: #14b8a6;
  border-radius: 5px;
  font-size: 13px;
  font-weight: 600;
  color: #fff;
  cursor: pointer;
  &:disabled { opacity: 0.6; }
`;

const Empty = styled.div`
  text-align: center;
  color: #94a3b8;
  padding: 20px;
`;

const TaskTable = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
`;

const Th = styled.th`
  text-align: left;
  padding: 8px 6px;
  border-bottom: 1px solid #e2e8f0;
  font-weight: 600;
  color: #64748b;
  font-size: 12px;
`;

const TaskRow = styled.tr<{ $completed: boolean }>`
  opacity: ${p => p.$completed ? 0.6 : 1};
  &:hover { background: #f8fafc; }
`;

const Td = styled.td`
  padding: 10px 6px;
  border-bottom: 1px solid #f1f5f9;
  vertical-align: middle;
`;

const TaskTitle = styled.div`
  font-weight: 500;
  color: #1e293b;
`;

const TaskProject = styled.div`
  font-size: 11px;
  color: #94a3b8;
  margin-top: 2px;
`;

const StatusBadge = styled.span<{ $color: string }>`
  display: inline-block;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 500;
  background: ${p => p.$color}20;
  color: ${p => p.$color};
`;

const BurndownRow = styled.div`
  display: flex;
  gap: 8px;
`;

const BurndownDay = styled.div`
  flex: 1;
  text-align: center;
`;

const BurndownDate = styled.div`
  font-size: 11px;
  color: #94a3b8;
  margin-bottom: 4px;
`;

const BurndownBar = styled.div`
  height: 60px;
  background: #f1f5f9;
  border-radius: 4px;
  position: relative;
  overflow: hidden;
`;

const BurndownInner = styled.div<{ $pct: number }>`
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: ${p => p.$pct}%;
  background: #14b8a6;
  border-radius: 4px;
  transition: height 0.3s;
`;

const BurndownVal = styled.div`
  font-size: 11px;
  color: #475569;
  margin-top: 4px;
`;
