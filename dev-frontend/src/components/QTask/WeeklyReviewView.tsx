// WeeklyReviewView — 주간 보고 풀 view (snapshot_data 포함)
//
// 카드 클릭 시 상세 보기. 업무 리스트 + 요약 + 번다운 + 한 주 메모.

import React, { useState, useEffect } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import {
  getWeeklyReview,
  updateWeeklyReviewNote,
  deleteWeeklyReview,
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
  const [noteSaved, setNoteSaved] = useState(false); // ✓ 뱃지 (2초 페이드)
  const [noteError, setNoteError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

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

  const handleDelete = async () => {
    if (!review || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteWeeklyReview(review.id);
      onBack(); // 목록으로 돌아가기 (삭제 후 재박제 가능 — week 탭의 "이번 주 마무리" 버튼)
    } catch (e) {
      const msg = (e as Error)?.message || '';
      setDeleteError(msg || (t('weeklyReview.view.deleteError', { defaultValue: '삭제 실패. 잠시 후 다시 시도하세요.' }) as string));
      setDeleting(false);
    }
  };

  const saveNote = async () => {
    if (!review || savingNote) return;
    setSavingNote(true);
    setNoteError(null);
    try {
      const updated = await updateWeeklyReviewNote(review.id, noteValue.trim() || null);
      setReview(updated);
      setEditingNote(false);
      setNoteSaved(true);
      setTimeout(() => setNoteSaved(false), 2000);
    } catch (e) {
      const msg = (e as Error)?.message || '';
      setNoteError(msg || (t('weeklyReview.view.noteSaveError', { defaultValue: '저장 실패. 잠시 후 다시 시도하세요.' }) as string));
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
    return t('weeklyReview.weekLabel', { defaultValue: '{{month}}월 {{week}}주차', month, week: weekOfMonth });
  };

  return (
    <Container>
      <Header>
        <HeaderTopRow>
          <BackBtn onClick={onBack}>&larr; {t('weeklyReview.view.back', '결산 목록')}</BackBtn>
          {confirmDelete ? (
            <DeleteConfirmRow>
              <DeleteConfirmText>
                {deleteError
                  ? deleteError
                  : t('weeklyReview.view.deleteConfirm', { defaultValue: '삭제 후 다시 확정 가능합니다' }) as string}
              </DeleteConfirmText>
              <CancelBtn type="button" onClick={() => { setConfirmDelete(false); setDeleteError(null); }} disabled={deleting}>
                {t('common.cancel', '취소') as string}
              </CancelBtn>
              <DangerBtn type="button" onClick={handleDelete} disabled={deleting}>
                {deleting
                  ? (t('common.deleting', { defaultValue: '삭제 중...' }) as string)
                  : t('common.delete', { defaultValue: '삭제' }) as string}
              </DangerBtn>
            </DeleteConfirmRow>
          ) : (
            <DeleteBtn type="button" onClick={() => setConfirmDelete(true)} title={t('weeklyReview.view.deleteHint', { defaultValue: '결산 삭제 (다시 확정 가능)' }) as string}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6M14 11v6" />
              </svg>
              {t('weeklyReview.view.delete', { defaultValue: '삭제' }) as string}
            </DeleteBtn>
          )}
        </HeaderTopRow>
        <HeaderTitle>
          {weekLabel()}
          <Badge $auto={review.finalized_by === 'auto'}>
            {review.finalized_by === 'auto' ? t('weeklyReview.tab.autoBadge', '자동') : t('weeklyReview.tab.manualBadge', '수동')}
          </Badge>
        </HeaderTitle>
        <Period>{String(review.week_start).slice(0, 10)} ~ {String(review.week_end).slice(0, 10)}</Period>
      </Header>

      {/* 그래프 — 가장 위 (큰 LineChart 1개). 데이터 없으면 빈 상태 안내 (운영 #27·#30) */}
      <Section>
        <SectionTitle>{t('weeklyReview.view.chartTitle', { defaultValue: '주간 진척 (실제 누적 시간)' }) as string}</SectionTitle>
        {(() => {
          const hasAnyActual = burndown.some(p => Number(p.actual_cumulative) > 0);
          if (burndown.length === 0) {
            return (
              <ChartEmptyBox>
                <ChartEmptyTitle>{t('weeklyReview.view.chartEmptyTitle', { defaultValue: '이번 주 진척 데이터가 아직 없어요' }) as string}</ChartEmptyTitle>
                <ChartEmptyHint>{t('weeklyReview.view.chartEmptyHint', { defaultValue: '업무를 진행(포커스)하거나 업무 상세에서 실제 시간을 입력하면 그래프가 채워집니다.' }) as string}</ChartEmptyHint>
              </ChartEmptyBox>
            );
          }
          return (
            <BigChartCard>
              {!hasAnyActual && (
                <ChartInlineHint>{t('weeklyReview.view.chartNoActualHint', { defaultValue: '실제 누적 시간 기록이 없어 예측선만 표시됩니다. 포커스 사용 또는 실제 시간 입력 시 실선이 그려집니다.' }) as string}</ChartInlineHint>
              )}
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={burndown.map(p => ({
                  date: p.date.slice(5).replace('-', '/'),
                  actual: p.actual_cumulative,
                  estimated: p.estimated_cumulative,
                }))} margin={{ top: 16, right: 24, bottom: 8, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                  <XAxis dataKey="date" stroke="#64748B" fontSize={12} />
                  <YAxis stroke="#64748B" fontSize={12} unit="h" />
                  <Tooltip contentStyle={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="actual" stroke="#14B8A6" strokeWidth={2.5} dot={{ r: 4 }} name={t('weeklyReview.view.chartActual', { defaultValue: '실제 누적' }) as string} />
                  <Line type="monotone" dataKey="estimated" stroke="#94A3B8" strokeWidth={1.5} strokeDasharray="4 4" dot={{ r: 3 }} name={t('weeklyReview.view.chartEstimated', { defaultValue: '예측 누적' }) as string} />
                </LineChart>
              </ResponsiveContainer>
            </BigChartCard>
          );
        })()}
      </Section>

      {/* 요약 — 항목/값 list 형식 (3 col x 2 row) */}
      {summary && (
        <Section>
          <SectionTitle>{t('weeklyReview.view.summaryTitle', '요약')}</SectionTitle>
          <SummaryList>
            <SummaryItem>
              <SummaryItemLabel>{t('common.total', '총 업무')}</SummaryItemLabel>
              <SummaryItemValue>{summary.total}</SummaryItemValue>
            </SummaryItem>
            <SummaryItem>
              <SummaryItemLabel>{t('common.completed', '완료')}</SummaryItemLabel>
              <SummaryItemValue $color="#22c55e">{summary.completed}</SummaryItemValue>
            </SummaryItem>
            <SummaryItem>
              <SummaryItemLabel>{t('common.incomplete', '미완료')}</SummaryItemLabel>
              <SummaryItemValue $color={summary.incomplete > 0 ? '#f59e0b' : undefined}>{summary.incomplete}</SummaryItemValue>
            </SummaryItem>
            <SummaryItem>
              <SummaryItemLabel>{t('summary.est', '예측 시간')}</SummaryItemLabel>
              <SummaryItemValue>{summary.estimated_total}h</SummaryItemValue>
            </SummaryItem>
            <SummaryItem>
              <SummaryItemLabel>{t('summary.act', '실제 시간')}</SummaryItemLabel>
              <SummaryItemValue>{summary.actual_total}h</SummaryItemValue>
            </SummaryItem>
            <SummaryItem title={t('weeklyReview.view.utilHint', { defaultValue: '활용률 = 실제 시간 / 캐파(주간 가용시간) × 100. 100% 이면 가용시간 만큼 사용. 100% 초과면 초과근무 의심.' }) as string}>
              <SummaryItemLabel>
                {t('common.utilization', '활용률')}
                <InfoMark>i</InfoMark>
              </SummaryItemLabel>
              <SummaryItemValue $color={summary.utilization_pct > 100 ? '#ef4444' : '#14b8a6'}>
                {summary.utilization_pct}%
                <UtilSub>{summary.actual_total}h / {summary.capacity_hours}h</UtilSub>
              </SummaryItemValue>
            </SummaryItem>
          </SummaryList>
        </Section>
      )}

      {/* 사이클 N+18 — 핵심 성과 (key completions) */}
      {snap?.key_completions && snap.key_completions.length > 0 && (
        <Section>
          <SectionTitle>{t('weeklyReview.workspace.highlights.title', '핵심 성과')}</SectionTitle>
          <SimpleList>
            {snap.key_completions.map(k => (
              <SimpleRow key={k.task_id}>
                <SimpleTitle>{k.title}</SimpleTitle>
                <SimpleMeta>{k.project_name || '—'} · {k.estimated_hours}h</SimpleMeta>
              </SimpleRow>
            ))}
          </SimpleList>
        </Section>
      )}

      {/* 위험 + 블로커 + 이슈 (있을 때만) */}
      {((snap?.risks && snap.risks.length > 0) || (snap?.blockers && snap.blockers.length > 0) || (snap?.issues && snap.issues.length > 0)) && (
        <Section>
          <SectionTitle>{t('weeklyReview.workspace.risks.title', '위험 신호')}</SectionTitle>
          <RiskGrid>
            {snap?.risks && snap.risks.length > 0 && (
              <RiskCol>
                <RiskColTitle>{t('weeklyReview.workspace.risks.title', '위험')}</RiskColTitle>
                {snap.risks.map(r => (
                  <SimpleRow key={`r-${r.task_id}-${r.kind}`}>
                    <SimpleTitle>{r.title}</SimpleTitle>
                    <SimpleMeta>{r.project_name || '—'} · {r.detail}</SimpleMeta>
                  </SimpleRow>
                ))}
              </RiskCol>
            )}
            {snap?.blockers && snap.blockers.length > 0 && (
              <RiskCol>
                <RiskColTitle>{t('weeklyReview.workspace.blockers.title', '블로커')}</RiskColTitle>
                {snap.blockers.map(b => (
                  <SimpleRow key={`b-${b.task_id}`}>
                    <SimpleTitle>{b.title}</SimpleTitle>
                    <SimpleMeta>{b.blocked_status} · {b.days_blocked}일째</SimpleMeta>
                  </SimpleRow>
                ))}
              </RiskCol>
            )}
            {snap?.issues && snap.issues.length > 0 && (
              <RiskCol>
                <RiskColTitle>{t('weeklyReview.workspace.issues.title', '이슈')}</RiskColTitle>
                {snap.issues.map(i => (
                  <SimpleRow key={`i-${i.id}`}>
                    <SimpleTitle>{i.title}</SimpleTitle>
                    <SimpleMeta>{i.project_name || '—'} · {i.days_open}일 경과</SimpleMeta>
                  </SimpleRow>
                ))}
              </RiskCol>
            )}
          </RiskGrid>
        </Section>
      )}

      {/* 다음 주 전망 */}
      {snap?.next_week_focus && snap.next_week_focus.length > 0 && (
        <Section>
          <SectionTitle>{t('weeklyReview.workspace.nextWeek.title', '다음 주 전망')}</SectionTitle>
          <SimpleList>
            {snap.next_week_focus.map(n => (
              <SimpleRow key={n.task_id}>
                <SimpleTitle>{n.title}</SimpleTitle>
                <SimpleMeta>D-{n.days_until} · {n.project_name || '—'}</SimpleMeta>
              </SimpleRow>
            ))}
          </SimpleList>
        </Section>
      )}

      {/* 본인 관여 프로젝트 */}
      {snap?.projects && snap.projects.length > 0 && (
        <Section>
          <SectionTitle>{t('weeklyReview.workspace.portfolio.title', '프로젝트 현황')}</SectionTitle>
          <SimpleList>
            {snap.projects.map(p => (
              <SimpleRow key={p.project_id}>
                <SimpleTitle>{p.name}</SimpleTitle>
                <SimpleMeta>
                  {p.progress_percent}% · {p.completed_tasks}/{p.total_tasks}
                  {p.overdue_count > 0 ? ` · ⚠ ${p.overdue_count}` : ''}
                  {p.d_day !== null ? (p.d_day < 0 ? ` · D+${-p.d_day}` : ` · D-${p.d_day}`) : ''}
                </SimpleMeta>
              </SimpleRow>
            ))}
          </SimpleList>
        </Section>
      )}

      {/* 한 주 메모 */}
      <Section>
        <SectionTitle>
          {t('weeklyReview.view.noteTitle', '한 주 메모')}
          {noteSaved && <SavedBadge>✓ {t('common.saved', { defaultValue: '저장됨' }) as string}</SavedBadge>}
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
            {noteError && <ErrLine>{noteError}</ErrLine>}
            <NoteActions>
              <CancelBtn onClick={() => { setEditingNote(false); setNoteValue(review.retro_note || ''); setNoteError(null); }}>
                {t('common.cancel', '취소')}
              </CancelBtn>
              <SaveBtn onClick={saveNote} disabled={savingNote}>
                {savingNote ? (t('common.saving', { defaultValue: '저장 중...' }) as string) : t('common.save', '저장')}
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
                      {t(`status.${task.status}.observer`, { defaultValue: t(`status.${task.status}`, { defaultValue: task.status }) }) as string}
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

const HeaderTopRow = styled.div`
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 8px;
`;

const BackBtn = styled.button`
  background: none;
  border: none;
  color: #64748b;
  font-size: 13px;
  cursor: pointer;
  padding: 0;
  &:hover { color: #14b8a6; }
`;

const DeleteBtn = styled.button`
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 12px; font-size: 12px; font-weight: 600;
  background: #FFFFFF; color: #B91C1C;
  border: 1px solid #FECACA; border-radius: 6px; cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
  &:hover { background: #FEF2F2; border-color: #DC2626; }
`;

const DeleteConfirmRow = styled.div`
  display: inline-flex; align-items: center; gap: 8px;
  padding: 6px 10px;
  background: #FEF2F2; border: 1px solid #FECACA; border-radius: 6px;
`;

const DeleteConfirmText = styled.span`
  font-size: 12px; color: #991B1B;
`;

const DangerBtn = styled.button`
  padding: 5px 12px; font-size: 12px; font-weight: 700; color: #fff;
  background: #DC2626; border: none; border-radius: 5px; cursor: pointer;
  &:hover:not(:disabled) { background: #B91C1C; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
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

const SavedBadge = styled.span`
  display: inline-flex; align-items: center;
  padding: 2px 8px; font-size: 11px; font-weight: 700;
  color: #166534; background: #DCFCE7; border-radius: 999px;
  animation: pqSavedFade 2s ease-out forwards;
  @keyframes pqSavedFade {
    0% { opacity: 0; transform: translateY(-2px); }
    20% { opacity: 1; transform: translateY(0); }
    80% { opacity: 1; }
    100% { opacity: 0; }
  }
`;

const ErrLine = styled.div`
  font-size: 12px; color: #DC2626; padding: 6px 0;
  background: #FEF2F2; border: 1px solid #FECACA; border-radius: 6px;
  padding: 8px 10px; margin-top: 8px;
`;

const BigChartCard = styled.div`
  background: #FFFFFF;
  border: 1px solid #E2E8F0;
  border-radius: 12px;
  padding: 16px 20px;
`;
// 그래프 빈 상태/힌트 (운영 #27·#30)
const ChartEmptyBox = styled.div`
  background: #F8FAFC; border: 1px dashed #CBD5E1; border-radius: 12px;
  padding: 32px 20px; text-align: center; display: flex; flex-direction: column; gap: 6px;
`;
const ChartEmptyTitle = styled.div`font-size: 14px; font-weight: 600; color: #475569;`;
const ChartEmptyHint = styled.div`font-size: 12px; color: #94A3B8; line-height: 1.5;`;
const ChartInlineHint = styled.div`
  font-size: 11px; color: #92400E; background: #FEF9C3; border-radius: 8px;
  padding: 8px 12px; margin-bottom: 12px; line-height: 1.5;
`;

const SummaryList = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  @media (max-width: 768px) { grid-template-columns: repeat(2, 1fr); }
  @media (max-width: 480px) { grid-template-columns: 1fr; }
`;

const SummaryItem = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  background: #F8FAFC;
  border-radius: 8px;
  border: 1px solid #E2E8F0;
`;

const SummaryItemLabel = styled.div`
  font-size: 13px;
  font-weight: 500;
  color: #64748B;
  display: inline-flex;
  align-items: center;
  gap: 6px;
`;

const SummaryItemValue = styled.div<{ $color?: string }>`
  font-size: 16px;
  font-weight: 700;
  color: ${p => p.$color || '#0F172A'};
  text-align: right;
  display: flex; flex-direction: column; align-items: flex-end;
`;

const UtilSub = styled.span`
  font-size: 10px;
  font-weight: 500;
  color: #94A3B8;
  margin-top: 2px;
`;

const InfoMark = styled.span`
  display: inline-flex; align-items: center; justify-content: center;
  width: 14px; height: 14px;
  font-size: 9px; font-weight: 700;
  color: #94A3B8; background: #F1F5F9;
  border-radius: 50%; cursor: help;
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


// 사이클 N+18 — 개인본 확장 섹션용 styled
const SimpleList = styled.div`
  display: flex; flex-direction: column; gap: 8px;
`;
const SimpleRow = styled.div`
  padding: 8px 12px;
  background: #F8FAFC;
  border-radius: 6px;
  border: 1px solid #E2E8F0;
`;
const SimpleTitle = styled.div`
  font-size: 13px; color: #0F172A; font-weight: 500;
`;
const SimpleMeta = styled.div`
  font-size: 11px; color: #64748B; margin-top: 2px;
`;
const RiskGrid = styled.div`
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px;
  @media (max-width: 768px) { grid-template-columns: 1fr; }
`;
const RiskCol = styled.div`
  display: flex; flex-direction: column; gap: 6px;
`;
const RiskColTitle = styled.div`
  font-size: 11px; font-weight: 700; color: #64748B;
  text-transform: uppercase; letter-spacing: 0.4px;
  padding-bottom: 4px; border-bottom: 1px solid #E2E8F0;
`;
