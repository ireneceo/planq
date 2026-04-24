import React, { useState, useEffect } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import {
  type MockProject, type MockTask, type MockNote, type MockIssue, type MockTaskCandidate,
  TASK_STATUS_LABEL, TASK_STATUS_COLOR,
} from './mock';
import { useAuth } from '../../contexts/AuthContext';
import { useTimeFormat } from '../../hooks/useTimeFormat';
import LetterAvatar from '../../components/Common/LetterAvatar';
import FloatingPanelToggle, { PANEL_WIDTH_CSS } from '../../components/Common/FloatingPanelToggle';
import { useIsNarrow } from '../../hooks/useMediaQuery';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';

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
  const { formatTimeAgo } = useTimeFormat();
  const isClient = user?.business_role === 'client';
  const myUserId = user ? Number(user.id) : -1;

  // 섹션 초기 펼침 상태는 내용 유무 기반으로 아래 useEffect 에서 결정 (모두 접힌 상태로 시작 → count 있는 것만 auto expand)
  const [expanded, setExpanded] = useState<Record<Section, boolean>>({
    issues: false,
    myTasks: false,
    projectTasks: false,
    notes: false,
    info: false,
  });
  const [showAddIssue, setShowAddIssue] = useState(false);
  const [newIssueText, setNewIssueText] = useState('');
  const [showAllIssues, setShowAllIssues] = useState(false);
  const [editingIssueId, setEditingIssueId] = useState<number | null>(null);
  const [editIssueText, setEditIssueText] = useState('');
  const [newNoteText, setNewNoteText] = useState('');
  // 메모 공유 범위 UI 간소화: "나만" vs "같이" (Irene 지적: 개인/내부는 이상함).
  // DB ENUM 은 personal/internal 유지 (Phase 9 visibility 재설계에 위임).
  const [newNoteShared, setNewNoteShared] = useState(false);

  const toggle = (s: Section) => setExpanded((prev) => ({ ...prev, [s]: !prev[s] }));

  // 프로젝트 전환 시 섹션 자동 펼침 — count > 0 인 섹션만 펴고, 빈 섹션은 접힘 상태로 시작.
  // Irene 지적: "(0) 이면 그냥 접어줘".
  useEffect(() => {
    const pid = project?.id;
    if (!pid) return;
    const pIssues = issues.filter((i) => i.project_id === pid).length;
    const pTasks = tasks.filter((t) => t.project_id === pid).length;
    const myT = tasks.filter((x) => x.assignee_id === myUserId || x.assignee_id === 15).length;
    const pNotes = (isClient
      ? notes.filter((n) => n.project_id === pid && n.visibility === 'personal' && n.author_id === myUserId)
      : notes.filter((n) => n.project_id === pid)
    ).length;
    setExpanded({
      info: true,                   // 프로젝트 정보는 기본 펼침
      issues: pIssues > 0,
      myTasks: myT > 0,
      projectTasks: pTasks > 0,
      notes: pNotes > 0,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id]);

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
    // 간소화 UI 매핑: "나만" → personal · "같이" → internal (DB ENUM 유지)
    onAddNote(newNoteText, newNoteShared ? 'internal' : 'personal');
    setNewNoteText('');
  };

  const isNarrow = useIsNarrow(1200);
  const [narrowOpen, setNarrowOpen] = useState(false);
  useBodyScrollLock(isNarrow && narrowOpen);

  // 키보드 토글 — ⌘/ (mac) · Ctrl+\ (win)
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key === '/' || e.key === '\\') {
        e.preventDefault();
        if (isNarrow) setNarrowOpen((x) => !x);
        else onToggleCollapsed();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isNarrow, onToggleCollapsed]);

  // 프로젝트 미선택 시 우측 패널 자체 렌더하지 않음 (Irene 요청: 필요 없음)
  if (!project) return null;

  if (!isNarrow && collapsed) {
    return (
      <CollapsedStrip>
        <RightEdgeHandle
          type="button"
          onClick={onToggleCollapsed}
          aria-label={t('right.expand', '작업대 열기') as string}
          title={t('right.expand', '작업대 열기') as string}
        >
          <EdgeChevron><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg></EdgeChevron>
        </RightEdgeHandle>
      </CollapsedStrip>
    );
  }

  const projectTasks: MockTask[] = tasks.filter((t) => t.project_id === project.id);
  const myTasks = projectTasks.filter((x) => x.assignee_id === myUserId || x.assignee_id === 15 /* mock: owner 시점 */);
  const projectNotes: MockNote[] = notes.filter((n) => n.project_id === project.id);
  const visibleNotes = isClient
    ? projectNotes.filter((n) => n.visibility === 'personal' && n.author_id === myUserId)
    : projectNotes;
  const projectIssues: MockIssue[] = issues.filter((i) => i.project_id === project.id);

  const headerCloseHandler = isNarrow ? () => setNarrowOpen(false) : onToggleCollapsed;
  const headerCloseIcon = isNarrow ? (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  ) : (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );

  const panelBody = (
    <>
      <HeaderBar>
        <HeaderTitle>{t('right.title', '프로젝트 작업대')}</HeaderTitle>
        {/* narrow(overlay) 모드에서만 헤더 X 유지. 데스크탑은 좌측 엣지 바로 접기 (통일) */}
        {isNarrow && (
          <IconBtn onClick={headerCloseHandler} title={t('right.collapse', '접기')}>
            {headerCloseIcon}
          </IconBtn>
        )}
      </HeaderBar>
      {!isNarrow && (
        <RightEdgeHandle
          type="button"
          onClick={onToggleCollapsed}
          aria-label={t('right.collapse', '접기') as string}
          title={t('right.collapse', '접기') as string}
        >
          <EdgeChevron><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg></EdgeChevron>
        </RightEdgeHandle>
      )}

      <Scroll>
        {/* 업무 후보 (있을 때만, 최상단) */}
        {!isClient && candidates.length > 0 && (
          <CandidatesSection data-section="candidates">
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
                      <MetaLabel>{t('right.candidates.metaAssignee', '담당')}</MetaLabel>
                      <MetaValue>{c.guessed_assignee.name}</MetaValue>
                      {c.guessed_role && <RoleTag>{c.guessed_role}</RoleTag>}
                    </MetaItem>
                  )}
                  {c.guessed_due_date && (
                    <MetaItem>
                      <MetaLabel>{t('right.candidates.metaDue', '마감')}</MetaLabel>
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
                  placeholder={t('right.issues.newPlaceholder', '새 이슈 내용 (Enter 저장)') as string}
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
                      <IssueDeleteBtn onClick={() => onDeleteIssue(i.id)}>{t('right.issues.delete', '삭제')}</IssueDeleteBtn>
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
                      {task.recurrence && <RecurIcon title={t('right.myTasks.recurTitle', '반복 업무') as string}>↻</RecurIcon>}
                    </TaskMeta>
                  </TaskBody>
                </TaskItem>
              ))}
              {myTasks.length === 0 && <EmptyRow>{t('right.myTasks.empty', '담당 업무가 없습니다')}</EmptyRow>}
              <QTaskLink onClick={() => {
                // 리스트 뷰 강제 — 카드 뷰가 저장돼 있어도 리스트로 열림
                try { localStorage.setItem('qtask_view_mode', 'list'); } catch { /* ignore */ }
                window.location.href = '/tasks';
              }}>
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
                <ProjectTaskRow
                  key={task.id}
                  onClick={() => {
                    try { localStorage.setItem('qtask_view_mode', 'list'); } catch { /* ignore */ }
                    window.location.href = `/tasks?task=${task.id}`;
                  }}
                  style={{ cursor: 'pointer' }}
                >
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
              {projectTasks.length === 0 && <EmptyRow>{t('right.projectTasks.empty', '업무가 없습니다')}</EmptyRow>}
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
                    {n.visibility === 'personal' ? t('right.notes.onlyMe', '나만') : t('right.notes.withTeam', '같이')}
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
                    <NoteVisOption $active={!newNoteShared} onClick={() => setNewNoteShared(false)}>{t('right.notes.onlyMe', '나만')}</NoteVisOption>
                    <NoteVisOption $active={newNoteShared} onClick={() => setNewNoteShared(true)}>{t('right.notes.withTeam', '같이')}</NoteVisOption>
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
              <InfoRow><InfoLabel>{t('right.info.name', '이름')}</InfoLabel><InfoValue>{project.name}</InfoValue></InfoRow>
              {project.description && (
                <InfoRow><InfoLabel>{t('right.info.desc', '설명')}</InfoLabel><InfoValue>{project.description}</InfoValue></InfoRow>
              )}
              {project.client_company && (
                <InfoRow><InfoLabel>{t('right.info.client', '고객')}</InfoLabel><InfoValue>{project.client_company}</InfoValue></InfoRow>
              )}
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
                  {/* PM 배지 — Phase 1.2 project_members.is_pm 대응. mock 에는 is_pm 없지만 default_assignee 를 임시 PM 표기 */}
                  {(m as unknown as { is_pm?: boolean }).is_pm && <PmTag>PM</PmTag>}
                  {m.is_default_assignee && !(m as unknown as { is_pm?: boolean }).is_pm && <PmTag>PM</PmTag>}
                </MemberRow>
              ))}
              <DetailLink>→ {t('right.info.detail', '프로젝트 상세 보기')}</DetailLink>
            </SectionBody>
          )}
        </Section>
      </Scroll>
    </>
  );

  if (isNarrow) {
    return (
      <>
        <FloatingPanelToggle
          open={narrowOpen}
          onToggle={() => setNarrowOpen((x) => !x)}
          ariaLabel={t('right.title', '작업대') as string}
        />
        {narrowOpen && (
          <>
            <OverlayBackdrop onClick={() => setNarrowOpen(false)} />
            <Container $overlay>{panelBody}</Container>
          </>
        )}
      </>
    );
  }

  return <Container>{panelBody}</Container>;
};

export default RightPanel;

// ─────────────────────────────────────────────
const Container = styled.aside<{ $overlay?: boolean }>`
  background: #FFFFFF;
  border-left: 1px solid #E2E8F0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
  ${({ $overlay }) => $overlay
    ? `
      position: fixed; top: 0; right: 0; bottom: 0;
      width: ${PANEL_WIDTH_CSS};
      z-index: 50;
      box-shadow: -16px 0 40px rgba(15, 23, 42, 0.14);
      animation: pqSlideIn 0.28s cubic-bezier(0.22, 1, 0.36, 1);
      @keyframes pqSlideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
      padding-bottom: env(safe-area-inset-bottom, 0px);
      @media (prefers-reduced-motion: reduce) { animation: none; }
    `
    : `
      width: 320px; flex-shrink: 0;
      @media (max-width: 1200px) { display: none; }
    `}
`;

/* 사이드 패널 접기/펼치기 엣지 핸들 — Secondary/Q Talk 공통 패턴 (2026-04-24 통일) */
const RightEdgeHandle = styled.button`
  position: absolute;
  top: 50%;
  left: 0;
  transform: translate(-50%, -50%);
  width: 8px; height: 60px;
  padding: 0; border: none;
  background: #CBD5E1;
  border-radius: 4px;
  cursor: pointer;
  z-index: 10;
  box-shadow: 0 1px 3px rgba(15,23,42,0.08);
  transition: width 0.15s ease, background 0.15s ease, height 0.15s ease;
  display: flex; align-items: center; justify-content: center;
  &::before { content: ''; position: absolute; top: -10px; bottom: -10px; left: -8px; right: -8px; }
  &:hover { width: 14px; height: 72px; background: #14B8A6; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 2px; }
`;
const EdgeChevron = styled.span`
  display: flex; align-items: center; justify-content: center;
  color: #64748B;
  svg { width: 10px; height: 10px; }
  ${RightEdgeHandle}:hover & { color: #FFFFFF; }
`;

const OverlayBackdrop = styled.div`
  position: fixed; inset: 0;
  background: rgba(15, 23, 42, 0.08);
  
  z-index: 45;
  animation: pqFadeIn 0.22s ease-out;
  @keyframes pqFadeIn { from { opacity: 0; } to { opacity: 1; } }
  @media (prefers-reduced-motion: reduce) { animation: none; }
`;

/* 접힘 상태: 0 폭 컨테이너 + 내부 RightEdgeHandle 만 경계에 노출 */
const CollapsedStrip = styled.aside`
  width: 0;
  flex-shrink: 0;
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 12px 0;
  @media (max-width: 1200px) { display: none; }
`;

const HeaderBar = styled.div`
  min-height: 60px;
  padding: 14px 20px;
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

/* PM 배지 — 프로젝트 PM (Phase 1.2 is_pm 대응, Q Task PmTag 와 동일 디자인) */
const PmTag = styled.span`
  padding: 1px 6px;
  background: #EEF2FF;
  color: #4338CA;
  font-size: 9px;
  font-weight: 700;
  border-radius: 8px;
  letter-spacing: 0.2px;
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
