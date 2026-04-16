import React, { useState, useEffect, useCallback } from 'react';
import styled from 'styled-components';
import LeftPanel from './LeftPanel';
import ChatPanel from './ChatPanel';
import RightPanel from './RightPanel';
import NewProjectModal, { type ProjectFormData } from './NewProjectModal';
import {
  type MockTaskCandidate, type MockMessage, type MockProject,
  type MockConversation, type MockTask, type MockNote, type MockIssue,
  type TaskStatus,
} from './mock';
import { useAuth } from '../../contexts/AuthContext';
import * as qtalkApi from '../../services/qtalk';

/**
 * QTalkPage — 실데이터 기반 (시드 데이터 로드)
 *
 * 프로젝트 선택 시 해당 프로젝트의 채널/메시지/업무/메모/이슈/후보 를 전부 fetch.
 * Write 엔드포인트는 청크 2~5 에서 추가 (현재는 읽기만).
 */

const STORAGE_LEFT = 'qtalk_left_collapsed';
const STORAGE_RIGHT = 'qtalk_right_collapsed';

// ─────────────────────────────────────────────
// API → Mock 타입 변환 (기존 panel 컴포넌트 호환)
// ─────────────────────────────────────────────
function apiProjectToMock(p: qtalkApi.ApiProject): MockProject {
  return {
    id: p.id,
    name: p.name,
    description: p.description || undefined,
    client_company: p.client_company || '(미지정)',
    status: p.status,
    start_date: p.start_date || undefined,
    end_date: p.end_date || undefined,
    default_assignee_id: p.default_assignee_user_id || p.owner_user_id,
    members: (p.projectMembers || []).map((m) => ({
      user_id: m.user_id,
      name: m.User?.name || `user ${m.user_id}`,
      role: m.role,
      avatar_color: '#64748B',
      is_default_assignee: m.user_id === p.default_assignee_user_id,
    })),
    clients: (p.projectClients || []).map((c) => ({
      user_id: c.contact_user_id || 0,
      name: c.contact_name || '(이름 없음)',
      company: p.client_company || '(고객사)',
      avatar_color: '#64748B',
    })),
    unread_count: 0,
    has_cue_activity: false,
  };
}

function apiConversationToMock(c: qtalkApi.ApiConversation): MockConversation {
  return {
    id: c.id,
    project_id: c.project_id || 0,
    channel_type: c.channel_type,
    name: c.display_name || c.title || '(이름 없음)',
    auto_extract_enabled: c.auto_extract_enabled,
    unread_count: 0,
    last_extracted_message_id: c.last_extracted_message_id,
  };
}

function apiMessageToMock(m: qtalkApi.ApiMessage): MockMessage {
  return {
    id: m.id,
    conversation_id: m.conversation_id,
    sender_id: m.sender_id,
    sender_name: m.sender?.name || `user ${m.sender_id}`,
    sender_role: m.is_ai ? 'cue' : 'member',
    sender_color: '#64748B',
    body: m.content,
    created_at: m.createdAt,  // Sequelize camelCase
    reply_to_message_id: m.reply_to_message_id,
    is_question: m.content.trim().endsWith('?'),
  };
}

function apiTaskToMock(t: qtalkApi.ApiTask): MockTask {
  return {
    id: t.id,
    project_id: t.project_id || 0,
    title: t.title,
    assignee_id: t.assigned_to || 0,
    assignee_name: '',
    due_date: t.due_date || undefined,
    status: (t.status as TaskStatus),
    recurrence: t.recurrence || undefined,
  };
}

function apiNoteToMock(n: qtalkApi.ApiNote): MockNote {
  return {
    id: n.id,
    project_id: n.project_id,
    author_id: n.author_user_id,
    author_name: n.author?.name || `user ${n.author_user_id}`,
    visibility: n.visibility,
    body: n.body,
    created_at: n.createdAt,
  };
}

function apiIssueToMock(i: qtalkApi.ApiIssue): MockIssue {
  return {
    id: i.id,
    project_id: i.project_id,
    body: i.body,
    author_name: i.author?.name || `user ${i.author_user_id}`,
    created_at: i.createdAt,
    updated_at: i.updatedAt,
  };
}

function apiCandidateToMock(c: qtalkApi.ApiTaskCandidate): MockTaskCandidate {
  return {
    id: c.id,
    project_id: c.project_id,
    conversation_id: c.conversation_id || undefined,
    title: c.title,
    description: c.description || '',
    source_message_ids: [],
    guessed_assignee: c.guessedAssignee ? { user_id: c.guessedAssignee.id, name: c.guessedAssignee.name } : undefined,
    guessed_role: c.guessed_role || undefined,
    guessed_due_date: c.guessed_due_date || undefined,
    similar_task_id: c.similar_task_id || undefined,
    status: c.status,
  };
}

const QTalkPage: React.FC = () => {
  const { user } = useAuth();
  const businessId = user?.business_id || null;

  const [projects, setProjects] = useState<MockProject[]>([]);
  const [conversations, setConversations] = useState<MockConversation[]>([]);
  const [messages, setMessages] = useState<Record<number, MockMessage[]>>({});
  const [tasks, setTasks] = useState<MockTask[]>([]);
  const [notes, setNotes] = useState<MockNote[]>([]);
  const [issues, setIssues] = useState<MockIssue[]>([]);
  const [candidates, setCandidates] = useState<MockTaskCandidate[]>([]);

  const [activeProjectId, setActiveProjectId] = useState<number | null>(null);
  const [activeConversationId, setActiveConversationId] = useState<number | null>(null);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [leftCollapsed, setLeftCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(STORAGE_LEFT) === '1'; } catch { return false; }
  });
  const [rightCollapsed, setRightCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(STORAGE_RIGHT) === '1'; } catch { return false; }
  });

  const [modalOpen, setModalOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const showNotice = useCallback((msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice(null), 3500);
  }, []);

  // ── 초기 로드: 프로젝트 목록 ──
  useEffect(() => {
    if (!businessId) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setLoadError(null);
        const list = await qtalkApi.listProjects(businessId);
        if (cancelled) return;
        const mapped = list.map(apiProjectToMock);
        setProjects(mapped);
        if (mapped.length > 0) {
          setActiveProjectId((prev) => prev ?? mapped[0].id);
        }
      } catch (err: unknown) {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : '프로젝트 목록 로드 실패');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [businessId]);

  // ── 프로젝트 선택 시 해당 프로젝트 데이터 전부 fetch ──
  useEffect(() => {
    if (!activeProjectId) return;
    let cancelled = false;
    (async () => {
      try {
        const [convList, tasksList, notesList, issuesList, candidatesList] = await Promise.all([
          qtalkApi.listProjectConversations(activeProjectId),
          qtalkApi.listProjectTasks(activeProjectId).catch(() => [] as qtalkApi.ApiTask[]),
          qtalkApi.listProjectNotes(activeProjectId).catch(() => [] as qtalkApi.ApiNote[]),
          qtalkApi.listProjectIssues(activeProjectId).catch(() => [] as qtalkApi.ApiIssue[]),
          qtalkApi.listProjectCandidates(activeProjectId).catch(() => [] as qtalkApi.ApiTaskCandidate[]),
        ]);
        if (cancelled) return;

        const mappedConvs = convList.map(apiConversationToMock);
        setConversations((prev) => {
          // 다른 프로젝트 대화는 유지
          const others = prev.filter((c) => c.project_id !== activeProjectId);
          return [...others, ...mappedConvs];
        });

        // 활성 대화 자동 선택 (customer 채널 우선)
        if (!cancelled && mappedConvs.length > 0) {
          const current = mappedConvs.find((c) => c.id === activeConversationId);
          if (!current) {
            const customer = mappedConvs.find((c) => c.channel_type === 'customer');
            setActiveConversationId(customer?.id ?? mappedConvs[0].id);
          }
        }

        // 각 채널의 메시지 병렬 로드
        const messagesByConv: Record<number, MockMessage[]> = {};
        await Promise.all(
          mappedConvs.map(async (c) => {
            try {
              const msgs = await qtalkApi.listConversationMessages(c.id);
              messagesByConv[c.id] = msgs.map(apiMessageToMock);
            } catch {
              messagesByConv[c.id] = [];
            }
          })
        );
        if (cancelled) return;
        setMessages((prev) => ({ ...prev, ...messagesByConv }));

        // 기타 데이터 누적
        setTasks((prev) => {
          const others = prev.filter((t) => t.project_id !== activeProjectId);
          return [...others, ...tasksList.map(apiTaskToMock)];
        });
        setNotes((prev) => {
          const others = prev.filter((n) => n.project_id !== activeProjectId);
          return [...others, ...notesList.map(apiNoteToMock)];
        });
        setIssues((prev) => {
          const others = prev.filter((i) => i.project_id !== activeProjectId);
          return [...others, ...issuesList.map(apiIssueToMock)];
        });
        setCandidates((prev) => {
          const others = prev.filter((c) => c.project_id !== activeProjectId);
          return [...others, ...candidatesList.map(apiCandidateToMock)];
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[QTalk] project data load failed', err);
      }
    })();
    return () => { cancelled = true; };
  }, [activeProjectId]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleLeft = () => {
    setLeftCollapsed((v) => {
      const next = !v;
      try { localStorage.setItem(STORAGE_LEFT, next ? '1' : '0'); } catch { /* quota */ }
      return next;
    });
  };
  const toggleRight = () => {
    setRightCollapsed((v) => {
      const next = !v;
      try { localStorage.setItem(STORAGE_RIGHT, next ? '1' : '0'); } catch { /* quota */ }
      return next;
    });
  };

  const handleSelectConversation = (projectId: number, conversationId: number) => {
    setActiveProjectId(projectId);
    setActiveConversationId(conversationId);
  };
  const handleSelectChannel = (conversationId: number) => setActiveConversationId(conversationId);

  // ── 프로젝트 생성 ──
  const handleCreateProject = async (data: ProjectFormData) => {
    if (!businessId) return;
    try {
      const created = await qtalkApi.createProject({
        business_id: businessId,
        name: data.name,
        description: data.description || undefined,
        client_company: data.client_company || undefined,
        start_date: data.start_date || undefined,
        end_date: data.end_date || undefined,
        members: data.members.map((m) => ({ user_id: m.user_id, role: m.role, is_default: m.is_default })),
        clients: data.clients.map((c) => ({ name: c.name, email: c.email })),
      });
      const mapped = apiProjectToMock(created);
      setProjects((prev) => [mapped, ...prev]);
      setActiveProjectId(mapped.id);
      setActiveConversationId(null);
      setModalOpen(false);
      showNotice(`프로젝트 "${mapped.name}" 생성됨`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '프로젝트 생성 실패';
      showNotice(`생성 실패: ${msg}`);
    }
  };

  // ── 쓰기 핸들러 ──
  const notYet = (feature: string) => {
    showNotice(`${feature} — 다음 청크에서 쓰기 API 연결 예정`);
  };

  // 청크 2: 메시지 전송
  const handleSendMessage = async (body: string) => {
    if (!activeConversationId) return;
    try {
      const created = await qtalkApi.sendMessage(activeConversationId, body);
      const mapped = apiMessageToMock(created);
      setMessages((prev) => ({
        ...prev,
        [activeConversationId]: [...(prev[activeConversationId] || []), mapped],
      }));
    } catch (err: unknown) {
      showNotice(`전송 실패: ${err instanceof Error ? err.message : ''}`);
    }
  };

  // 청크 2: 채널 이름 변경
  const handleRenameConversation = async (conversationId: number, name: string) => {
    try {
      const updated = await qtalkApi.updateConversation(conversationId, { display_name: name });
      setConversations((prev) => prev.map((c) => (c.id === conversationId ? { ...c, name: updated.display_name || updated.title || c.name } : c)));
    } catch (err: unknown) {
      showNotice(`채널 이름 변경 실패: ${err instanceof Error ? err.message : ''}`);
    }
  };

  // 청크 2: 자동 추출 토글
  const handleToggleAutoExtract = async (conversationId: number, enabled: boolean) => {
    try {
      const updated = await qtalkApi.updateConversation(conversationId, { auto_extract_enabled: enabled });
      setConversations((prev) => prev.map((c) => (c.id === conversationId ? { ...c, auto_extract_enabled: updated.auto_extract_enabled } : c)));
    } catch (err: unknown) {
      showNotice(`자동 추출 토글 실패: ${err instanceof Error ? err.message : ''}`);
    }
  };

  // 청크 4: 이슈 CRUD
  const handleAddIssue = async (body: string) => {
    if (!activeProjectId) return;
    try {
      const created = await qtalkApi.addIssue(activeProjectId, body);
      setIssues((prev) => [apiIssueToMock(created), ...prev]);
    } catch (err: unknown) {
      showNotice(`이슈 추가 실패: ${err instanceof Error ? err.message : ''}`);
    }
  };

  const handleUpdateIssue = async (id: number, body: string) => {
    try {
      const updated = await qtalkApi.updateIssue(id, body);
      setIssues((prev) => prev.map((i) => (i.id === id ? apiIssueToMock(updated) : i)));
    } catch (err: unknown) {
      showNotice(`이슈 수정 실패: ${err instanceof Error ? err.message : ''}`);
    }
  };

  const handleDeleteIssue = async (id: number) => {
    try {
      await qtalkApi.deleteIssue(id);
      setIssues((prev) => prev.filter((i) => i.id !== id));
    } catch (err: unknown) {
      showNotice(`이슈 삭제 실패: ${err instanceof Error ? err.message : ''}`);
    }
  };

  // 청크 4: 메모 추가
  const handleAddNote = async (body: string, visibility: 'personal' | 'internal') => {
    if (!activeProjectId) return;
    try {
      const created = await qtalkApi.addNote(activeProjectId, body, visibility);
      setNotes((prev) => [apiNoteToMock(created), ...prev]);
    } catch (err: unknown) {
      showNotice(`메모 추가 실패: ${err instanceof Error ? err.message : ''}`);
    }
  };

  // 청크 4: 업무 체크박스 토글
  const handleToggleTask = async (id: number) => {
    const task = tasks.find((t) => t.id === id);
    if (!task) return;
    const nextStatus = task.status === 'completed' ? 'in_progress' : 'completed';
    try {
      const updated = await qtalkApi.updateTaskStatus(id, nextStatus);
      setTasks((prev) => prev.map((t) => (t.id === id ? apiTaskToMock(updated) : t)));
    } catch (err: unknown) {
      showNotice(`업무 상태 변경 실패: ${err instanceof Error ? err.message : ''}`);
    }
  };

  const activeProject = projects.find((p) => p.id === activeProjectId) || null;
  const projectCandidates = candidates.filter((c) => c.project_id === activeProjectId && c.status === 'pending');

  if (!businessId) return <Empty>워크스페이스가 선택되지 않았습니다.</Empty>;
  if (loading) return <Empty>프로젝트 로드 중...</Empty>;
  if (loadError) return <Empty>로드 실패: {loadError}</Empty>;

  return (
    <Layout>
      <LeftPanel
        projects={projects}
        conversations={conversations}
        activeProjectId={activeProjectId}
        activeConversationId={activeConversationId}
        onSelectConversation={handleSelectConversation}
        onOpenNewProject={() => setModalOpen(true)}
        collapsed={leftCollapsed}
        onToggleCollapsed={toggleLeft}
      />
      <ChatPanel
        project={activeProject}
        conversations={conversations}
        messages={messages}
        activeConversationId={activeConversationId}
        onSelectConversation={handleSelectChannel}
        onOpenExtract={() => notYet('업무 추출')}
        onSendMessage={handleSendMessage}
        onCueDraftSend={() => notYet('Cue 답변 전송')}
        onCueDraftReject={() => notYet('Cue 답변 거절')}
        onToggleAutoExtract={handleToggleAutoExtract}
        onRenameConversation={handleRenameConversation}
        candidatesCount={projectCandidates.length}
        leftCollapsed={leftCollapsed}
        rightCollapsed={rightCollapsed}
        onToggleLeft={toggleLeft}
        onToggleRight={toggleRight}
      />
      <RightPanel
        project={activeProject}
        tasks={tasks}
        notes={notes}
        issues={issues}
        candidates={projectCandidates}
        collapsed={rightCollapsed}
        onToggleCollapsed={toggleRight}
        onRegisterCandidate={() => notYet('업무 후보 등록')}
        onMergeCandidate={() => notYet('업무 후보 병합')}
        onRejectCandidate={() => notYet('업무 후보 거절')}
        onAddIssue={handleAddIssue}
        onUpdateIssue={handleUpdateIssue}
        onDeleteIssue={handleDeleteIssue}
        onAddNote={handleAddNote}
        onToggleTask={handleToggleTask}
      />

      <NewProjectModal
        businessId={businessId}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreate={handleCreateProject}
      />

      {notice && (
        <Toast>
          <ToastDot />
          {notice}
        </Toast>
      )}
    </Layout>
  );
};

export default QTalkPage;

const Empty = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  height: calc(100vh - 56px);
  color: #64748B;
  font-size: 14px;
`;

const Toast = styled.div`
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 20px;
  background: #0F172A;
  color: #F0FDFA;
  border-radius: 12px;
  font-size: 13px;
  font-weight: 500;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.3);
  z-index: 3000;
  animation: slideUp 0.2s ease-out;
  @keyframes slideUp {
    from { transform: translate(-50%, 12px); opacity: 0; }
    to { transform: translate(-50%, 0); opacity: 1; }
  }
`;

const ToastDot = styled.span`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #5EEAD4;
  box-shadow: 0 0 0 2px rgba(94, 234, 212, 0.3);
`;

const Layout = styled.div`
  display: flex;
  height: calc(100vh - 0px);
  background: #F8FAFC;
  overflow: hidden;

  @media (max-width: 768px) {
    height: calc(100vh - 56px);
  }
`;
