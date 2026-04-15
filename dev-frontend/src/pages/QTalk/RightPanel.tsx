import React, { useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import {
  type MockProject, type MockTask, type MockNote, type MockIssue, type MockTaskCandidate,
  TASK_STATUS_LABEL, TASK_STATUS_COLOR, formatTimeAgo,
} from './mock';
import { useAuth } from '../../contexts/AuthContext';
import LetterAvatar from '../../components/Common/LetterAvatar';

interface Props {
  project: MockProject | null;
  tasks: MockTask[];
  notes: MockNote[];
  issues: MockIssue[];
  candidates: MockTaskCandidate[];
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onRegisterCandidate: (id: number) => void;
  onMergeCandidate: (id: number) => void;
  onRejectCandidate: (id: number) => void;
  onAddIssue: (body: string) => void;
  onUpdateIssue: (id: number, body: string) => void;
  onDeleteIssue: (id: number) => void;
  onAddNote: (body: string, visibility: 'personal' | 'internal') => void;
  onToggleTask: (id: number) => void;
}

type Section = 'issues' | 'myTasks' | 'projectTasks' | 'notes' | 'info';

const RightPanel: React.FC<Props> = ({
  project, tasks, notes, issues, candidates, collapsed, onToggleCollapsed,
  onRegisterCandidate, onMergeCandidate, onRejectCandidate,
  onAddIssue, onUpdateIssue, onDeleteIssue, onAddNote, onToggleTask,
}) => {
  const { t } = useTranslation('qtalk');
  const { user } = useAuth();
  const isClient = user?.business_role === 'client';
  const myUserId = user ? Number(user.id) : -1;

  const [expanded, setExpanded] = useState<Record<Section, boolean>>({
    issues: true,
    myTasks: true,
    projectTasks: false,
    notes: true,
    info: false,
  });
  const [showAddIssue, setShowAddIssue] = useState(false);
  const [newIssueText, setNewIssueText] = useState('');
  const [showAllIssues, setShowAllIssues] = useState(false);
  const [editingIssueId, setEditingIssueId] = useState<number | null>(null);
  const [editIssueText, setEditIssueText] = useState('');
  const [newNoteText, setNewNoteText] = useState('');
  const [newNoteVis, setNewNoteVis] = useState<'personal' | 'internal'>('personal');

  const toggle = (s: Section) => setExpanded((prev) => ({ ...prev, [s]: !prev[s] }));

  const submitAddIssue = () => {
    if (!newIssueText.trim()) return;
    onAddIssue(newIssueText);
    setNewIssueText('');
    setShowAddIssue(false);
  };

  const submitEditIssue = () => {
    if (editingIssueId == null) return;
    const trimmed = editIssueText.trim();
    if (trimmed) onUpdateIssue(editingIssueId, trimmed);
    setEditingIssueId(null);
    setEditIssueText('');
  };

  const submitNote = () => {
    if (!newNoteText.trim()) return;
    onAddNote(newNoteText, newNoteVis);
    setNewNoteText('');
  };

  if (collapsed) {
    return (
      <CollapsedStrip>
        <CollapsedBtn onClick={onToggleCollapsed}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </CollapsedBtn>
      </CollapsedStrip>
    );
  }

  if (!project) return <Container />;

  const projectTasks: MockTask[] = tasks.filter((t) => t.project_id === project.id);
  const myTasks = projectTasks.filter((x) => x.assignee_id === myUserId || x.assignee_id === 15 /* mock: owner 시점 */);
  const projectNotes: MockNote[] = notes.filter((n) => n.project_id === project.id);
  const visibleNotes = isClient
    ? projectNotes.filter((n) => n.visibility === 'personal' && n.author_id === myUserId)
    : projectNotes;
  const projectIssues: MockIssue[] = issues.filter((i) => i.project_id === project.id);

  return (
    <Container>
      <HeaderBar>
        <HeaderTitle>{t('right.title', '프로젝트 작업대')}</HeaderTitle>
        <IconBtn onClick={onToggleCollapsed} title={t('right.collapse', '접기')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </IconBtn>
      </HeaderBar>

      <Scroll>
        {/* 업무 후보 (있을 때만, 최상단) */}
        {!isClient && candidates.length > 0 && (
          <CandidatesSection>
            <CandidatesHeader>
              <CandidatesTitle>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="9 11 12 14 22 4" />
                  <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                </svg>
                {t('right.candidates.title', '업무 후보')}
                <Count>{candidates.length}</Count>
              </CandidatesTitle>
            </CandidatesHeader>
            {candidates.map((c) => (
              <CandidateCard key={c.id}>
                <CandidateTitle>{c.title}</CandidateTitle>
                <CandidateDesc>{c.description}</CandidateDesc>
                <CandidateMeta>
                  {c.guessed_assignee && (
                    <MetaItem>
                      <MetaLabel>담당</MetaLabel>
                      <MetaValue>{c.guessed_assignee.name}</MetaValue>
                      {c.guessed_role && <RoleTag>{c.guessed_role}</RoleTag>}
                    </MetaItem>
                  )}
                  {c.guessed_due_date && (
                    <MetaItem>
                      <MetaLabel>마감</MetaLabel>
                      <MetaValue>{c.guessed_due_date}</MetaValue>
                    </MetaItem>
                  )}
                </CandidateMeta>
                {c.similar_task_id && (
                  <SimilarWarning>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                      <line x1="12" y1="9" x2="12" y2="13" />
                      <line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                    {t('right.candidates.similar', '유사 업무 발견')}
                  </SimilarWarning>
                )}
                <CandidateActions>
                  <CandActBtn $primary onClick={() => onRegisterCandidate(c.id)}>
                    {t('right.candidates.register', '등록')}
                  </CandActBtn>
                  {c.similar_task_id && (
                    <CandActBtn onClick={() => onMergeCandidate(c.id)}>
                      {t('right.candidates.merge', '내용 추가')}
                    </CandActBtn>
                  )}
                  <CandActBtn $ghost onClick={() => onRejectCandidate(c.id)}>
                    {t('right.candidates.reject', '거절')}
                  </CandActBtn>
                </CandidateActions>
              </CandidateCard>
            ))}
          </CandidatesSection>
        )}

        {/* 섹션 1: 주요 이슈 */}
        <Section>
          <SectionHeader onClick={() => toggle('issues')}>
            <SectionTitle>
              <Chevron $open={expanded.issues} />
              {t('right.issues.title', '주요 이슈')}
              <Count>{projectIssues.length}</Count>
            </SectionTitle>
            {expanded.issues && !isClient && (
              <AddBtn onClick={(e) => { e.stopPropagation(); setShowAddIssue(true); }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                {t('right.issues.add', '추가')}
              </AddBtn>
            )}
          </SectionHeader>
          {expanded.issues && (
            <SectionBody>
              {showAddIssue && !isClient && (
                <NewIssueInput
                  autoFocus
                  value={newIssueText}
                  onChange={(e) => setNewIssueText(e.target.value)}
                  onBlur={submitAddIssue}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); submitAddIssue(); }
                    if (e.key === 'Escape') { setShowAddIssue(false); setNewIssueText(''); }
                  }}
                  placeholder="새 이슈 내용 (Enter 저장)"
                />
              )}
              {(showAllIssues ? projectIssues : projectIssues.slice(0, 3)).map((i) => (
                <IssueItem key={i.id}>
                  {editingIssueId === i.id ? (
                    <IssueEditInput
                      autoFocus
                      value={editIssueText}
                      onChange={(e) => setEditIssueText(e.target.value)}
                      onBlur={submitEditIssue}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); submitEditIssue(); }
                        if (e.key === 'Escape') { setEditingIssueId(null); setEditIssueText(''); }
                      }}
                    />
                  ) : (
                    <IssueBody
                      onClick={() => { if (!isClient) { setEditingIssueId(i.id); setEditIssueText(i.body); } }}
                      $editable={!isClient}
                    >
                      {i.body}
                    </IssueBody>
                  )}
                  <IssueMeta>
                    <span>{i.author_name}</span>
                    <span>·</span>
                    <span>{formatTimeAgo(i.updated_at)}</span>
                    {!isClient && editingIssueId !== i.id && (
                      <IssueDeleteBtn onClick={() => onDeleteIssue(i.id)}>삭제</IssueDeleteBtn>
                    )}
                  </IssueMeta>
                </IssueItem>
              ))}
              {!showAllIssues && projectIssues.length > 3 && (
                <ShowMore onClick={() => setShowAllIssues(true)}>
                  {t('right.issues.showMore', '과거 이슈 {{n}}개 더 보기', { n: projectIssues.length - 3 })}
                </ShowMore>
              )}
              {showAllIssues && projectIssues.length > 3 && (
                <ShowMore onClick={() => setShowAllIssues(false)}>{t('right.issues.collapse', '접기')}</ShowMore>
              )}
              {projectIssues.length === 0 && !showAddIssue && (
                <EmptyRow>{t('right.issues.empty', '아직 이슈가 없습니다')}</EmptyRow>
              )}
            </SectionBody>
          )}
        </Section>

        {/* 섹션 2: 내 할 일 */}
        <Section>
          <SectionHeader onClick={() => toggle('myTasks')}>
            <SectionTitle>
              <Chevron $open={expanded.myTasks} />
              {t('right.myTasks.title', '내 할 일')}
              <Count>{myTasks.length}</Count>
            </SectionTitle>
          </SectionHeader>
          {expanded.myTasks && (
            <SectionBody>
              {myTasks.map((task) => (
                <TaskItem key={task.id} $completed={task.status === 'completed'}>
                  <TaskCheck
                    type="checkbox"
                    checked={task.status === 'completed'}
                    onChange={() => onToggleTask(task.id)}
                  />
                  <TaskBody>
                    <TaskTitle $completed={task.status === 'completed'}>{task.title}</TaskTitle>
                    <TaskMeta>
                      <StatusPill
                        $bg={TASK_STATUS_COLOR[task.status].bg}
                        $fg={TASK_STATUS_COLOR[task.status].fg}
                      >
                        {TASK_STATUS_LABEL[task.status]}
                      </StatusPill>
                      {task.due_date && <TaskDue>{task.due_date}</TaskDue>}
                      {task.recurrence && <RecurIcon title="반복 업무">↻</RecurIcon>}
                    </TaskMeta>
                  </TaskBody>
                </TaskItem>
              ))}
              {myTasks.length === 0 && <EmptyRow>{t('right.myTasks.empty', '담당 업무가 없습니다')}</EmptyRow>}
              <QTaskLink onClick={() => window.location.href = '/tasks'}>
                → {t('right.myTasks.viewAll', 'Q Task 에서 전체 보기')}
              </QTaskLink>
            </SectionBody>
          )}
        </Section>

        {/* 섹션 3: 프로젝트 업무 */}
        <Section>
          <SectionHeader onClick={() => toggle('projectTasks')}>
            <SectionTitle>
              <Chevron $open={expanded.projectTasks} />
              {t('right.projectTasks.title', '프로젝트 업무')}
              <Count>{tasks.length}</Count>
            </SectionTitle>
          </SectionHeader>
          {expanded.projectTasks && (
            <SectionBody>
              {projectTasks.map((task) => (
                <ProjectTaskRow key={task.id}>
                  <ProjectTaskTitle>{task.title}</ProjectTaskTitle>
                  <ProjectTaskRight>
                    {task.due_date && <ProjectTaskDue>{task.due_date}</ProjectTaskDue>}
                    {task.recurrence && <RecurIcon>↻</RecurIcon>}
                    <StatusPill
                      $bg={TASK_STATUS_COLOR[task.status].bg}
                      $fg={TASK_STATUS_COLOR[task.status].fg}
                    >
                      {TASK_STATUS_LABEL[task.status]}
                    </StatusPill>
                  </ProjectTaskRight>
                </ProjectTaskRow>
              ))}
              {projectTasks.length === 0 && <EmptyRow>업무가 없습니다</EmptyRow>}
            </SectionBody>
          )}
        </Section>

        {/* 섹션 4: 프로젝트 메모 */}
        <Section>
          <SectionHeader onClick={() => toggle('notes')}>
            <SectionTitle>
              <Chevron $open={expanded.notes} />
              {t('right.notes.title', '프로젝트 메모')}
              <Count>{visibleNotes.length}</Count>
            </SectionTitle>
          </SectionHeader>
          {expanded.notes && (
            <SectionBody>
              {visibleNotes.slice(0, 6).map((n) => (
                <NoteItem key={n.id}>
                  <NoteVis $internal={n.visibility === 'internal'}>
                    {n.visibility === 'internal' ? t('right.notes.internal', '내부') : t('right.notes.personal', '개인')}
                  </NoteVis>
                  <NoteContent>
                    <NoteBody>{n.body}</NoteBody>
                    <NoteMeta>{n.author_name} · {formatTimeAgo(n.created_at)}</NoteMeta>
                  </NoteContent>
                </NoteItem>
              ))}
              {visibleNotes.length === 0 && <EmptyRow>{t('right.notes.empty', '아직 메모가 없습니다')}</EmptyRow>}
              <NoteInput>
                <NoteTextInput
                  value={newNoteText}
                  onChange={(e) => setNewNoteText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); submitNote(); }
                  }}
                  placeholder={t('right.notes.placeholder', '메모 작성... (Enter 저장)')}
                />
                {!isClient && (
                  <NoteVisToggle>
                    <NoteVisOption $active={newNoteVis === 'personal'} onClick={() => setNewNoteVis('personal')}>개인</NoteVisOption>
                    <NoteVisOption $active={newNoteVis === 'internal'} onClick={() => setNewNoteVis('internal')}>내부</NoteVisOption>
                  </NoteVisToggle>
                )}
                <NoteSendBtn onClick={submitNote} disabled={!newNoteText.trim()}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <line x1="22" y1="2" x2="11" y2="13" />
                    <polygon points="22 2 15 22 11 13 2 9 22 2" />
                  </svg>
                </NoteSendBtn>
              </NoteInput>
            </SectionBody>
          )}
        </Section>

        {/* 섹션 5: 프로젝트 정보 */}
        <Section>
          <SectionHeader onClick={() => toggle('info')}>
            <SectionTitle>
              <Chevron $open={expanded.info} />
              {t('right.info.title', '프로젝트 정보')}
            </SectionTitle>
          </SectionHeader>
          {expanded.info && (
            <SectionBody>
              <InfoRow><InfoLabel>{t('right.info.client', '고객사')}</InfoLabel><InfoValue>{project.client_company}</InfoValue></InfoRow>
              {project.start_date && (
                <InfoRow><InfoLabel>{t('right.info.period', '기간')}</InfoLabel><InfoValue>{project.start_date} ~ {project.end_date || '—'}</InfoValue></InfoRow>
              )}
              <InfoRow><InfoLabel>{t('right.info.status', '상태')}</InfoLabel><InfoValue>{project.status}</InfoValue></InfoRow>
              <InfoRow><InfoLabel>{t('right.info.members', '멤버')}</InfoLabel></InfoRow>
              {project.members.map((m) => (
                <MemberRow key={m.user_id}>
                  <LetterAvatar name={m.name} size={22} />
                  <MemberName>{m.name}</MemberName>
                  <RoleTag>{m.role}</RoleTag>
                  {m.is_default_assignee && <DefaultTag>{t('right.info.default', '기본')}</DefaultTag>}
                </MemberRow>
              ))}
              <DetailLink>→ {t('right.info.detail', '프로젝트 상세 보기')}</DetailLink>
            </SectionBody>
          )}
        </Section>
      </Scroll>
    </Container>
  );
};

export default RightPanel;

// ─────────────────────────────────────────────
const Container = styled.aside`
  width: 320px;
  flex-shrink: 0;
  background: #FFFFFF;
  border-left: 1px solid #E2E8F0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  @media (max-width: 1200px) { display: none; }
`;

const CollapsedStrip = styled.aside`
  width: 36px;
  flex-shrink: 0;
  background: #FFFFFF;
  border-left: 1px solid #E2E8F0;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 12px 0;
  @media (max-width: 1200px) { display: none; }
`;

const CollapsedBtn = styled.button`
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: 6px;
  color: #64748B;
  cursor: pointer;
  &:hover { background: #F1F5F9; color: #0F172A; }
`;

const HeaderBar = styled.div`
  height: 52px;
  padding: 0 14px 0 16px;
  border-bottom: 1px solid #E2E8F0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
`;

const HeaderTitle = styled.h2`
  font-size: 13px;
  font-weight: 700;
  color: #0F172A;
  margin: 0;
  letter-spacing: -0.1px;
`;

const IconBtn = styled.button`
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: 6px;
  color: #64748B;
  cursor: pointer;
  &:hover { background: #F1F5F9; color: #0F172A; }
`;

const Scroll = styled.div`
  flex: 1;
  overflow-y: auto;
  &::-webkit-scrollbar { width: 6px; }
  &::-webkit-scrollbar-thumb { background: #E2E8F0; border-radius: 3px; }
`;

const CandidatesSection = styled.div`
  margin: 10px 12px;
  padding: 10px;
  background: linear-gradient(135deg, #FFF1F2 0%, #FEF3C7 100%);
  border: 1px solid #FECDD3;
  border-radius: 10px;
`;

const CandidatesHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
`;

const CandidatesTitle = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 700;
  color: #9F1239;
  text-transform: uppercase;
  letter-spacing: 0.5px;
`;

const Count = styled.span`
  min-width: 16px;
  height: 16px;
  padding: 0 5px;
  background: rgba(15, 23, 42, 0.08);
  color: #475569;
  border-radius: 8px;
  font-size: 10px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
`;

const CandidateCard = styled.div`
  padding: 10px;
  background: #FFFFFF;
  border: 1px solid #FECDD3;
  border-radius: 8px;
  & + & { margin-top: 8px; }
`;

const CandidateTitle = styled.div`
  font-size: 13px;
  font-weight: 600;
  color: #0F172A;
  margin-bottom: 4px;
`;

const CandidateDesc = styled.div`
  font-size: 11px;
  color: #64748B;
  line-height: 1.4;
  margin-bottom: 8px;
`;

const CandidateMeta = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 8px;
`;

const MetaItem = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
`;

const MetaLabel = styled.span`
  font-size: 10px;
  color: #94A3B8;
  font-weight: 600;
  min-width: 28px;
`;

const MetaValue = styled.span`
  font-size: 11px;
  color: #0F172A;
  font-weight: 500;
`;

const RoleTag = styled.span`
  padding: 1px 6px;
  background: #F1F5F9;
  color: #475569;
  font-size: 9px;
  font-weight: 600;
  border-radius: 8px;
`;

const SimilarWarning = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  background: #FEF3C7;
  color: #92400E;
  border-radius: 6px;
  font-size: 10px;
  font-weight: 600;
  margin-bottom: 8px;
`;

const CandidateActions = styled.div`
  display: flex;
  gap: 4px;
`;

const CandActBtn = styled.button<{ $primary?: boolean; $ghost?: boolean }>`
  flex: ${(p) => (p.$ghost ? 'none' : 1)};
  padding: 5px 8px;
  font-size: 11px;
  font-weight: 600;
  border-radius: 6px;
  cursor: pointer;
  ${(p) => p.$primary ? `
    background: #F43F5E;
    color: #FFFFFF;
    border: none;
    &:hover { background: #E11D48; }
  ` : p.$ghost ? `
    background: transparent;
    color: #94A3B8;
    border: none;
    &:hover { color: #475569; }
  ` : `
    background: #FFFFFF;
    color: #9F1239;
    border: 1px solid #FECDD3;
    &:hover { background: #FFE4E6; }
  `}
`;

const Section = styled.div`
  border-bottom: 1px solid #F1F5F9;
`;

const SectionHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  cursor: pointer;
  user-select: none;
  &:hover { background: #F8FAFC; }
`;

const SectionTitle = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 700;
  color: #0F172A;
  letter-spacing: -0.1px;
`;

const Chevron = styled.span<{ $open: boolean }>`
  width: 0;
  height: 0;
  border-left: 4px solid transparent;
  border-right: 4px solid transparent;
  border-top: 5px solid #94A3B8;
  transform: rotate(${(p) => (p.$open ? '0' : '-90')}deg);
  transition: transform 0.15s;
`;

const AddBtn = styled.button`
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 3px 8px;
  font-size: 10px;
  font-weight: 600;
  background: transparent;
  color: #0D9488;
  border: 1px solid #99F6E4;
  border-radius: 5px;
  cursor: pointer;
  &:hover { background: #F0FDFA; }
`;

const SectionBody = styled.div`
  padding: 0 14px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 320px;
  overflow-y: auto;
`;

const IssueItem = styled.div`
  padding: 8px 10px;
  background: #F8FAFC;
  border-radius: 6px;
  border-left: 2px solid #F43F5E;
`;

const IssueBody = styled.div<{ $editable?: boolean }>`
  font-size: 12px;
  color: #1E293B;
  line-height: 1.4;
  margin-bottom: 3px;
  ${(p) => p.$editable && `
    cursor: text;
    &:hover { color: #0F766E; }
  `}
`;

const IssueEditInput = styled.textarea`
  width: 100%;
  font-size: 12px;
  color: #1E293B;
  line-height: 1.4;
  margin-bottom: 3px;
  padding: 4px 6px;
  background: #FFFFFF;
  border: 1px solid #14B8A6;
  border-radius: 4px;
  box-shadow: 0 0 0 2px rgba(20, 184, 166, 0.12);
  font-family: inherit;
  resize: vertical;
  min-height: 32px;
  &:focus { outline: none; }
`;

const NewIssueInput = styled.input`
  width: 100%;
  padding: 8px 10px;
  background: #FFFFFF;
  border: 1px solid #14B8A6;
  border-radius: 6px;
  box-shadow: 0 0 0 3px rgba(20, 184, 166, 0.12);
  font-size: 12px;
  color: #0F172A;
  font-family: inherit;
  &:focus { outline: none; }
  &::placeholder { color: #94A3B8; }
`;

const IssueMeta = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  color: #94A3B8;
`;

const IssueDeleteBtn = styled.button`
  margin-left: auto;
  background: transparent;
  border: none;
  color: #CBD5E1;
  font-size: 10px;
  cursor: pointer;
  padding: 0;
  &:hover { color: #DC2626; }
`;

const ShowMore = styled.button`
  padding: 6px;
  background: transparent;
  color: #64748B;
  border: none;
  font-size: 11px;
  cursor: pointer;
  text-align: center;
  width: 100%;
  &:hover { color: #0D9488; }
`;

const EmptyRow = styled.div`
  padding: 12px;
  text-align: center;
  color: #94A3B8;
  font-size: 11px;
`;

const TaskItem = styled.div<{ $completed?: boolean }>`
  display: flex;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 6px;
  opacity: ${(p) => (p.$completed ? 0.55 : 1)};
  &:hover { background: #F8FAFC; }
`;

const TaskCheck = styled.input`
  margin-top: 2px;
  accent-color: #0D9488;
  cursor: pointer;
`;

const TaskBody = styled.div`
  flex: 1;
  min-width: 0;
`;

const TaskTitle = styled.div<{ $completed?: boolean }>`
  font-size: 12px;
  color: #0F172A;
  margin-bottom: 3px;
  line-height: 1.3;
  ${(p) => p.$completed && 'text-decoration: line-through; color: #94A3B8;'}
`;

const TaskMeta = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
`;

const StatusPill = styled.span<{ $bg: string; $fg: string }>`
  padding: 1px 6px;
  background: ${(p) => p.$bg};
  color: ${(p) => p.$fg};
  font-size: 9px;
  font-weight: 700;
  border-radius: 8px;
`;

const TaskDue = styled.span`
  font-size: 10px;
  color: #64748B;
`;

const RecurIcon = styled.span`
  font-size: 11px;
  color: #7C3AED;
`;

const QTaskLink = styled.button`
  margin-top: 4px;
  padding: 6px;
  background: transparent;
  color: #0D9488;
  border: none;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  text-align: left;
  &:hover { color: #0F766E; }
`;

const ProjectTaskRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 6px;
  &:hover { background: #F8FAFC; }
`;

const ProjectTaskTitle = styled.div`
  font-size: 12px;
  color: #0F172A;
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const ProjectTaskRight = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
`;

const ProjectTaskDue = styled.span`
  font-size: 10px;
  color: #64748B;
`;

const NoteItem = styled.div`
  display: flex;
  gap: 8px;
  padding: 8px 10px;
  background: #F8FAFC;
  border-radius: 6px;
`;

const NoteVis = styled.span<{ $internal: boolean }>`
  padding: 1px 6px;
  background: ${(p) => (p.$internal ? '#E0F2FE' : '#F1F5F9')};
  color: ${(p) => (p.$internal ? '#0369A1' : '#475569')};
  font-size: 9px;
  font-weight: 700;
  border-radius: 8px;
  height: fit-content;
  flex-shrink: 0;
`;

const NoteContent = styled.div`
  flex: 1;
  min-width: 0;
`;

const NoteBody = styled.div`
  font-size: 12px;
  color: #1E293B;
  line-height: 1.4;
  margin-bottom: 3px;
`;

const NoteMeta = styled.div`
  font-size: 10px;
  color: #94A3B8;
`;

const NoteInput = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
  padding: 6px 8px;
  background: #F8FAFC;
  border: 1px solid #E2E8F0;
  border-radius: 8px;
  &:focus-within { border-color: #14B8A6; background: #FFFFFF; }
`;

const NoteTextInput = styled.input`
  flex: 1;
  border: none;
  background: transparent;
  font-size: 12px;
  color: #0F172A;
  &:focus { outline: none; }
  &::placeholder { color: #94A3B8; }
`;

const NoteVisToggle = styled.div`
  display: flex;
  gap: 2px;
  background: #FFFFFF;
  border-radius: 6px;
  padding: 2px;
`;

const NoteVisOption = styled.button<{ $active?: boolean }>`
  padding: 3px 8px;
  font-size: 10px;
  font-weight: 600;
  background: ${(p) => (p.$active ? '#F0FDFA' : 'transparent')};
  color: ${(p) => (p.$active ? '#0F766E' : '#64748B')};
  border: none;
  border-radius: 4px;
  cursor: pointer;
  &:hover { color: #0F766E; background: #F0FDFA; }
`;

const NoteSendBtn = styled.button`
  width: 24px;
  height: 24px;
  border-radius: 5px;
  background: #0D9488;
  color: #FFFFFF;
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  &:hover:not(:disabled) { background: #0F766E; }
  &:disabled { background: #CBD5E1; cursor: not-allowed; }
`;

const InfoRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 0;
  font-size: 12px;
`;

const InfoLabel = styled.div`
  color: #94A3B8;
  font-weight: 600;
  font-size: 11px;
`;

const InfoValue = styled.div`
  color: #0F172A;
  font-weight: 500;
`;

const MemberRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
`;

const MemberName = styled.div`
  flex: 1;
  font-size: 12px;
  color: #0F172A;
  font-weight: 500;
`;

const DefaultTag = styled.span`
  padding: 1px 6px;
  background: #FFF1F2;
  color: #9F1239;
  font-size: 9px;
  font-weight: 700;
  border-radius: 8px;
`;

const DetailLink = styled.button`
  margin-top: 8px;
  padding: 6px;
  background: transparent;
  color: #0D9488;
  border: none;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  text-align: left;
  &:hover { color: #0F766E; }
`;
