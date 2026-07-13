import React, { useState, useEffect, useMemo, useRef } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  type MockProject, type MockConversation, type MockTask, type MockNote, type MockIssue, type MockTaskCandidate,
} from './types';
import { useAuth } from '../../contexts/AuthContext';
import { useTimeFormat } from '../../hooks/useTimeFormat';
import LetterAvatar from '../../components/Common/LetterAvatar';
import FloatingPanelToggle, { PANEL_WIDTH_CSS } from '../../components/Common/FloatingPanelToggle';
import { useIsNarrow } from '../../hooks/useMediaQuery';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import TaskCandidateCard from '../../components/Common/TaskCandidateCard';
import type { RegisterCandidateOverrides } from '../../services/qtalk';
import NoteThread from '../../components/Common/NoteThread';
import WorkbenchSection, { WorkbenchEmptyRow, WorkbenchSectionLink } from '../../components/Workbench/WorkbenchSection';
import ContextTaskList from '../../components/Workbench/ContextTaskList';
import CueTaskBar from '../../components/QTask/CueTaskBar';
import AiAssistButton from '../../components/Common/AiAssistButton';

interface Props {
  project: MockProject | null;
  activeConversationId?: number | null; // 독립 대화일 때 scope 로 사용
  conversations?: MockConversation[]; // 메모/이슈 source 채팅 이름 매핑용
  tasks: MockTask[];
  notes: MockNote[];
  issues: MockIssue[];
  candidates: MockTaskCandidate[];
  // N+36 옵션 D — "이전 후보 보기" 토글 (30일 이전 hidden 후보 포함)
  showHiddenCandidates?: boolean;
  onToggleHiddenCandidates?: () => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  width?: number; // 데스크탑 폭 (리사이즈 — Q Task/Q Mail 통일)
  onResizeStart?: (e: React.MouseEvent) => void;
  onRegisterCandidate: (id: number, overrides?: RegisterCandidateOverrides) => void;
  onMergeCandidate: (id: number) => void;
  onRejectCandidate: (id: number) => void;
  onAddIssue: (body: string) => void;
  onUpdateIssue: (id: number, body: string) => void;
  onDeleteIssue: (id: number) => void;
  onAddNote: (body: string, visibility: 'personal' | 'internal') => void;
  onToggleTask: (id: number) => void;
  // 작업대(N+? 통합) — 한 줄 등록 · 업무 추출 · 3분류 리스트
  businessId?: number | null;
  members?: Array<{ user_id: number; name: string; role?: string; is_ai?: boolean }>;
  activeConv?: MockConversation | null;
  extracting?: boolean;
  onOpenExtract?: () => void;
  onToggleAutoExtract?: (conversationId: number, enabled: boolean) => void;
  onOpenTask?: (taskId: number) => void;
}

type Section = 'issues' | 'myTasks' | 'projectTasks' | 'notes' | 'info';

const RightPanel: React.FC<Props> = ({
  project, activeConversationId, conversations, tasks, notes, issues, candidates, collapsed, onToggleCollapsed,
  width, onResizeStart,
  showHiddenCandidates = false, onToggleHiddenCandidates,
  onRegisterCandidate, onMergeCandidate, onRejectCandidate,
  onAddIssue, onUpdateIssue, onDeleteIssue, onAddNote,
  businessId = null, members = [], activeConv = null, extracting = false,
  onOpenExtract, onToggleAutoExtract, onOpenTask,
}) => {
  const { t } = useTranslation('qtalk');
  // N+72-6 — status 라벨은 qtask namespace 에 정의됨. raw "not_started" 표시 회귀 fix
  const { user } = useAuth();
  const { formatTimeAgo } = useTimeFormat();
  const navigate = useNavigate();
  // 담당자 후보 — Cue(AI) 제외 (배정해도 이 경로엔 실행 트리거가 없어 좀비 업무가 된다)
  const taskMembers = useMemo(
    () => members.filter((m) => !m.is_ai && m.role !== 'ai').map((m) => ({ user_id: m.user_id, name: m.name })),
    [members],
  );
  // 업무 리스트 갱신 신호 — 한 줄 등록·후보 승격 후 즉시 반영
  const [tasksKey, setTasksKey] = useState(0);
  const isClient = user?.business_role === 'client';
  const myUserId = user ? Number(user.id) : -1;
  // 업무 status 라벨 (observer 관점) — overdue 판정에 오늘 날짜 (워크스페이스 tz 정확도는 부모에서 주입 가능, 우선 로컬 ISO)

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
  const noteListRef = useRef<HTMLDivElement | null>(null);
  // 메모 공유 범위 UI: "공개"(internal) 디폴트 · "나만"(personal) 선택.
  // DB ENUM 은 personal/internal 유지 (Phase 9 visibility 재설계에 위임).

  const toggle = (s: Section) => setExpanded((prev) => ({ ...prev, [s]: !prev[s] }));

  // 메모 리스트 자동 하단 스크롤 — 채팅 패턴. 펼침/스코프/메모 개수 변경 시 최신 메모로.
  const notesCount = notes.length;
  const notesExpanded = expanded.notes;
  useEffect(() => {
    if (!notesExpanded) return;
    const el = noteListRef.current;
    if (!el) return;
    requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
  }, [notesExpanded, notesCount, project?.id, activeConversationId]);

  // 프로젝트 전환 시 섹션 자동 펼침 — count > 0 인 섹션만 펴고, 빈 섹션은 접힘 상태로 시작.
  // Irene 지적: "(0) 이면 그냥 접어줘".
  // 섹션 자동 펼침 — 프로젝트 혹은 독립 대화 scope 에 해당하는 데이터가 있으면 펼친다.
  // 데이터가 async 로 들어올 수 있으므로 arrays 가 바뀔 때마다 재평가.
  useEffect(() => {
    const inScope = <T extends { project_id: number | null; conversation_id?: number | null }>(item: T) => {
      if (project) return item.project_id === project.id;
      if (activeConversationId) return item.conversation_id === activeConversationId;
      return false;
    };
    const pIssues = issues.filter(inScope).length;
    const pTasksAll = tasks.filter(inScope);
    const pTasks = pTasksAll.length;
    const myT = pTasksAll.filter((x) => x.assignee_id === myUserId).length;
    const pNotesArr = notes.filter(inScope);
    const pNotes = (isClient
      ? pNotesArr.filter((n) => n.visibility === 'personal' && n.author_id === myUserId)
      : pNotesArr
    ).length;
    setExpanded({
      info: !!project,               // 프로젝트 정보 섹션은 project 있을 때 기본 펼침
      issues: pIssues > 0,
      myTasks: myT > 0,
      projectTasks: pTasks > 0,
      notes: true,                   // 입력란이 있으므로 비어 있어도 항상 펼침
    });
    void pNotes;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, activeConversationId, issues.length, tasks.length, notes.length]);

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

  // project 도 activeConversationId 도 없으면 패널 렌더 스킵
  if (!project && !activeConversationId) return null;

  // 접힘 상태의 핸들은 페이지(QTalkPage)가 공통 PanelEdgeHandle 로 그린다 —
  //   패널 안에 그리면 옆 패널에 가리거나(overflow) 좁은 화면에서 사라졌다.
  if (!isNarrow && collapsed) return null;

  // scope 결정: 프로젝트가 있으면 project_id 기준, 없으면 conversation_id 기준 (독립 대화)
  const matchScope = <T extends { project_id: number | null; conversation_id?: number | null }>(item: T): boolean => {
    if (project) return item.project_id === project.id;
    if (activeConversationId) return item.conversation_id === activeConversationId;
    return false;
  };
  // source 채팅 이름 lookup — 메모·이슈가 어느 대화에서 왔는지 표기
  const convName = (id?: number | null) => {
    if (!id || !conversations) return null;
    const c = conversations.find((x) => x.id === id);
    return c ? c.name : null;
  };
  const projectNotes: MockNote[] = notes.filter(matchScope);
  // 채팅 패턴: ASC (오래된 위 → 최신 아래, 입력란 바로 위가 최신)
  const visibleNotes = (isClient
    ? projectNotes.filter((n) => n.visibility === 'personal' && n.author_id === myUserId)
    : projectNotes
  ).slice().sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  const projectIssues: MockIssue[] = issues.filter(matchScope);

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
        <HeaderTitle>{project ? t('right.title', '프로젝트 작업대') : t('right.titleStandalone', '작업대')}</HeaderTitle>
        {/* N+93 — 데스크탑 접기는 좌측 divider EdgeHandle 로 통일(Q Task/Q docs). 헤더 버튼은 narrow 오버레이 닫기(X)만. */}
        {isNarrow && (
          <IconBtn
            type="button"
            onClick={headerCloseHandler}
            aria-label={t('right.collapse', '접기') as string}
            title={t('right.collapse', '접기') as string}
          >
            {headerCloseIcon}
          </IconBtn>
        )}
      </HeaderBar>

      <Scroll>
        {/* 한 줄 업무 등록 — 채팅 흐름에서 바로. AI 추출이 못 찾아도 사람이 적는다.
            이름을 지목하면 그 사람에게 가는 요청 업무가 된다 (담당자는 코드가 확정). */}
        {!isClient && businessId && (
          <WorkbenchSection title={t('right.quickAdd', '한 줄 업무 등록') as string} static>
            <CueTaskBar
              businessId={businessId}
              members={taskMembers}
              projectId={project?.id || null}
              context={activeConversationId ? { conversation_id: activeConversationId } : null}
              compact
              onCreated={() => setTasksKey((k) => k + 1)}
            />
          </WorkbenchSection>
        )}

        {/* 업무 후보 — 추출 버튼이 여기로 왔다 (채팅 입력란 하단에 있던 것). Q Mail 과 같은 자리. */}
        {!isClient && (
          <WorkbenchSection
            title={t('right.candidates.title', '업무 후보') as string}
            count={candidates.length}
            defaultOpen={candidates.length > 0}
            action={onOpenExtract ? (
              <AiAssistButton
                onClick={onOpenExtract}
                loading={!!extracting}
                label={extracting
                  ? (t('chat.input.extracting', '추출 중...') as string)
                  : (t('chat.input.extractNow', '업무 추출') as string)}
                title={t('chat.input.extractHint', 'AI 가 이 대화에서 할 일 후보를 뽑아냅니다') as string}
              />
            ) : null}
          >
            {activeConv && onToggleAutoExtract && (
              <AutoRow>
                <AutoLabel>
                  <AutoCheckbox
                    type="checkbox"
                    checked={!!activeConv.auto_extract_enabled}
                    onChange={(e) => onToggleAutoExtract(activeConv.id, e.target.checked)}
                  />
                  {t('chat.input.autoExtract', '자동 업무 추출')}
                </AutoLabel>
                {onToggleHiddenCandidates && (
                  <HiddenToggle type="button" onClick={onToggleHiddenCandidates} aria-pressed={showHiddenCandidates}>
                    {showHiddenCandidates
                      ? t('right.candidates.hideOld', '최근만 보기')
                      : t('right.candidates.showOld', '이전 후보 보기')}
                  </HiddenToggle>
                )}
              </AutoRow>
            )}
            {candidates.length === 0 ? (
              <WorkbenchEmptyRow>{t('right.candidates.empty', 'AI 가 대화에서 할 일을 찾으면 여기에 나타납니다.') as string}</WorkbenchEmptyRow>
            ) : candidates.map((c) => (
              <TaskCandidateCard
                key={c.id}
                candidate={c}
                members={taskMembers}
                myUserId={myUserId}
                onRegister={(id, o) => { onRegisterCandidate(id, o); setTasksKey((k) => k + 1); }}
                onMerge={onMergeCandidate}
                onReject={onRejectCandidate}
              />
            ))}
          </WorkbenchSection>
        )}

        {/* 업무 — 프로젝트 업무 / 내 할 일 / 요청한 업무 (Q Mail 과 같은 컴포넌트) */}
        {!isClient && businessId && (project?.id || activeConversationId) && (
          <ContextTaskList
            businessId={businessId}
            projectId={project?.id || null}
            conversationId={project?.id ? null : activeConversationId}
            reloadKey={tasksKey}
            onOpenTask={onOpenTask}
          />
        )}

        {/* 섹션 1: 주요 이슈 */}
        <WorkbenchSection
          title={t('right.issues.title', '주요 이슈') as string}
          count={projectIssues.length}
          open={expanded.issues}
          onToggle={() => toggle('issues')}
          action={expanded.issues && !isClient ? (
            <AddBtn onClick={(e) => { e.stopPropagation(); setShowAddIssue(true); }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              {t('right.issues.add', '추가')}
            </AddBtn>
          ) : null}
        >
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
                    {project && i.conversation_id && convName(i.conversation_id) && (
                      <>
                        <span>·</span>
                        <SourceTag title={t('right.sourceChat', '출처 대화') as string}>#{convName(i.conversation_id)}</SourceTag>
                      </>
                    )}
                    {!isClient && editingIssueId !== i.id && (
                      <IssueDeleteBtn onClick={() => onDeleteIssue(i.id)}>{t('right.issues.delete', '삭제')}</IssueDeleteBtn>
                    )}
                  </IssueMeta>
                </IssueItem>
              ))}
              {!showAllIssues && projectIssues.length > 3 && (
                <WorkbenchSectionLink type="button" onClick={() => setShowAllIssues(true)}>
                  {t('right.issues.showMore', '과거 이슈 {{n}}개 더 보기', { n: projectIssues.length - 3 })}
                </WorkbenchSectionLink>
              )}
              {showAllIssues && projectIssues.length > 3 && (
                <WorkbenchSectionLink type="button" onClick={() => setShowAllIssues(false)}>{t('right.issues.collapse', '접기')}</WorkbenchSectionLink>
              )}
              {projectIssues.length === 0 && !showAddIssue && (
                <WorkbenchEmptyRow>{t('right.issues.empty', '아직 이슈가 없습니다')}</WorkbenchEmptyRow>
              )}
        </WorkbenchSection>

        {/* 섹션 2: 내 할 일 */}

        {/* 섹션 3: 프로젝트 업무 */}
        {/* 레거시 '프로젝트 업무' · '내 할 일' 섹션 제거 — 위 ContextTaskList 가 같은 내용을
            프로젝트 업무 / 내 할 일 / 요청한 업무 3분류로 보여준다 (같은 정보를 두 번 그릴 이유가 없다). */}

        {/* 섹션 4: 프로젝트 메모 */}
        <WorkbenchSection
          title={(project ? t('right.notes.title', '프로젝트 메모') : t('right.notes.titleStandalone', '메모')) as string}
          count={visibleNotes.length}
          open={expanded.notes}
          onToggle={() => toggle('notes')}
        >
              {/* 메모는 공통 NoteThread — Q Mail 맥락 패널과 같은 컴포넌트(디자인 단일 원천) */}
              <NoteThread
                notes={visibleNotes.map((n) => ({
                  id: n.id,
                  body: n.body,
                  visibility: n.visibility,
                  author_user_id: n.author_id,
                  author_name: n.author_name,
                  created_at: n.created_at,
                }))}
                myUserId={myUserId}
                canChooseVisibility={!isClient}
                formatTime={formatTimeAgo}
                onAdd={(body, visibility) => onAddNote(body, visibility)}
                emptyText={t('right.notes.empty', '아직 메모가 없습니다') as string}
                placeholder={t('right.notes.placeholder', '메모 작성... (⌘/Ctrl+Enter 저장)') as string}
                renderMeta={(n) => {
                  const conv = project ? notes.find((x) => x.id === n.id)?.conversation_id : null;
                  return conv && convName(conv)
                    ? <> · <SourceTag title={t('right.sourceChat', '출처 대화') as string}>#{convName(conv)}</SourceTag></>
                    : null;
                }}
              />
        </WorkbenchSection>

        {/* 섹션 5: 프로젝트 정보 — 독립 대화는 간단히 '일반 대화' 라벨만 */}
        {project && (
        <WorkbenchSection
          title={t('right.info.title', '프로젝트 정보') as string}
          open={expanded.info}
          onToggle={() => toggle('info')}
        >
          {(() => {
            // 내부 프로젝트 감지 — client_company 없거나 "내부" 로 끝나는 placeholder 값
            const cc = project.client_company?.trim() || '';
            const isInternal = !cc || /내부$|internal$/i.test(cc) || cc === '—';
            return (
            <>
              <InfoRow>
                <InfoLabel>{t('right.info.name', '이름')}</InfoLabel>
                <InfoValue>
                  {project.name}
                  {isInternal && <InternalBadge>{t('right.info.internal', '내부 프로젝트')}</InternalBadge>}
                </InfoValue>
              </InfoRow>
              {project.description && (
                <InfoRow><InfoLabel>{t('right.info.desc', '설명')}</InfoLabel><InfoValue>{project.description}</InfoValue></InfoRow>
              )}
              {!isInternal && cc && (
                <InfoRow><InfoLabel>{t('right.info.client', '고객')}</InfoLabel><InfoValue>{cc}</InfoValue></InfoRow>
              )}
              {project.start_date && (
                <InfoRow>
                  <InfoLabel>{t('right.info.period', '기간')}</InfoLabel>
                  <InfoValue>
                    {String(project.start_date).slice(0, 10)} ~ {project.end_date ? String(project.end_date).slice(0, 10) : '—'}
                  </InfoValue>
                </InfoRow>
              )}
              <InfoRow>
                <InfoLabel>{t('right.info.status', '상태')}</InfoLabel>
                <InfoValue>{t(`right.info.statusLabel.${project.status}`, project.status)}</InfoValue>
              </InfoRow>
              <InfoRow><InfoLabel>{t('right.info.members', '멤버')}</InfoLabel></InfoRow>
              {project.members.map((m) => (
                <MemberRow key={m.user_id}>
                  <LetterAvatar name={m.name} size={22} />
                  <MemberName>{m.name}</MemberName>
                  <RoleTag>{m.role}</RoleTag>
                  {/* PM 배지 — 정식 project_members.is_pm (백엔드 직렬화 + QTalkPage 매핑) */}
                  {(m as unknown as { is_pm?: boolean }).is_pm && <PmTag>{t('right.info.members.pm', 'PM')}</PmTag>}
                </MemberRow>
              ))}
              <DetailLink type="button" onClick={() => navigate(`/projects/p/${project.id}`)}>
                → {t('right.info.detail', '프로젝트 상세 보기')}
              </DetailLink>
            </>
            );
          })()}
        </WorkbenchSection>
        )}
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

  // 접기 핸들은 페이지(QTalkPage)가 공통 PanelEdgeHandle 로 레이아웃 레벨에 그린다.
  // 패널 안에도 하나 더 그리면 같은 자리에 핸들이 겹쳐 두 개가 된다 (열림/접힘 상태별로 다른 핸들).
  return (
    <Container $w={width}>
      {onResizeStart && <TalkResizeHandle onMouseDown={onResizeStart} />}
      {panelBody}
    </Container>
  );
};

export default RightPanel;

// ─────────────────────────────────────────────
const Container = styled.aside<{ $overlay?: boolean; $w?: number }>`
  background: #FFFFFF;
  border-left: 1px solid #E2E8F0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
  ${(p) => p.$overlay
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
      width: ${p.$w || 320}px; flex-shrink: 0;
      @media (max-width: 1200px) { display: none; }
    `}
`;
// 좌측 리사이즈 핸들 (Q Task/Q Mail 통일)
const TalkResizeHandle = styled.div`
  position: absolute; top: 0; left: -3px; width: 6px; height: 100%;
  cursor: col-resize; z-index: 12;
  &:hover { background: rgba(20,184,166,0.2); }
  &:active { background: rgba(20,184,166,0.4); }
  @media (max-width: 1200px) { display: none; }
`;

/* N+63 — 시인성·세련도 강화. 평소 12×72 진한 색, hover 18×84 teal + nudge animation. */

const OverlayBackdrop = styled.div`
  position: fixed; inset: 0;
  background: rgba(15, 23, 42, 0.08);
  
  z-index: 45;
  animation: pqFadeIn 0.22s ease-out;
  @keyframes pqFadeIn { from { opacity: 0; } to { opacity: 1; } }
  @media (prefers-reduced-motion: reduce) { animation: none; }
`;

/* 접힘 상태: 0 폭 컨테이너 + 내부 RightEdgeHandle 만 경계에 노출 */

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

const HiddenToggle = styled.button`
  background: transparent;
  border: 1px solid #CBD5E1;
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 11px; font-weight: 500;
  color: #475569;
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s;
  &:hover { background: #F8FAFC; border-color: #94A3B8; }
  &[aria-pressed="true"] { background: #F1F5F9; border-color: #94A3B8; color: #0F172A; }
`;





// 후보 카드 styled — CandidateEditCard 컴포넌트로 이전. 미사용 styled 제거.
// RoleTag 만 남김 — 멤버 리스트(섹션 5 정보) 에서 별도로 사용 중.
const RoleTag = styled.span`
  padding: 1px 6px;
  background: #F1F5F9;
  color: #475569;
  font-size: 9px;
  font-weight: 600;
  border-radius: 8px;
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





















const SourceTag = styled.span`
  font-size: 10px;
  color: #0F766E;
  background: #F0FDFA;
  padding: 1px 6px;
  border-radius: 10px;
  font-weight: 600;
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: inline-block;
  vertical-align: middle;
`;

/* 메모 리스트만 자체 스크롤 — 입력란이 우측 패널 스크롤 아래로 밀려 가려지지 않도록.
   사용자: "메모가 길 때 입력란이 가려지면 안 됨, 입력은 할 수 있는 걸 알아야" */






const InfoRow = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 5px 0;
  font-size: 12px;
  line-height: 1.5;
`;

const InfoLabel = styled.div`
  color: #64748B;
  font-weight: 600;
  font-size: 11px;
  flex-shrink: 0;
  width: 46px;
`;

const InfoValue = styled.div`
  color: #0F172A;
  font-weight: 500;
  flex: 1;
  min-width: 0;
  text-align: right;
  word-break: break-word;
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

/* 내부 프로젝트 배지 — 고객 없는 자체 프로젝트 표시 */
const InternalBadge = styled.span`
  display: inline-block;
  margin-left: 6px;
  padding: 1px 6px;
  background: #F1F5F9;
  color: #475569;
  font-size: 10px;
  font-weight: 700;
  border-radius: 8px;
  letter-spacing: 0.2px;
  vertical-align: middle;
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


const AutoRow = styled.div`display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap;`;
const AutoLabel = styled.label`display: inline-flex; align-items: center; gap: 6px; font-size: 11px; color: #64748B; cursor: pointer;`;
const AutoCheckbox = styled.input`width: 14px; height: 14px; accent-color: #14B8A6; cursor: pointer;`;
