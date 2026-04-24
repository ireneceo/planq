import React, { createContext, useContext, useMemo, useState, useCallback } from 'react';
import {
  MOCK_PROJECTS, MOCK_CONVERSATIONS, MOCK_CANDIDATES, MOCK_MESSAGES,
  MOCK_TASKS, MOCK_NOTES, MOCK_ISSUES,
  type MockTaskCandidate, type MockMessage, type MockProject,
  type MockConversation, type MockTask, type MockNote, type MockIssue,
  type TaskStatus,
} from './mock';
import { useAuth } from '../../contexts/AuthContext';

/**
 * QDataContext — Q Talk + Q Task 양쪽이 공유하는 Mock 스토어
 *
 * 전체 상태를 한 곳에서 관리 → Q Talk 에서 업무 후보 등록 → Q Task 페이지에 즉시 반영.
 * 백엔드 연결은 Task #14 에서 각 handler 를 API 호출로 교체.
 *
 * 페이지 reload 시 초기화 (Mock 단계이므로 영속 저장 없음).
 */

interface QDataValue {
  // state
  projects: MockProject[];
  conversations: MockConversation[];
  messages: Record<number, MockMessage[]>;
  tasks: MockTask[];
  notes: MockNote[];
  issues: MockIssue[];
  candidates: MockTaskCandidate[];

  // project
  createProject: (data: CreateProjectInput) => MockProject;

  // conversation
  renameConversation: (conversationId: number, name: string) => void;
  toggleAutoExtract: (conversationId: number, enabled: boolean) => void;

  // message
  sendMessage: (conversationId: number, body: string) => void;

  // cue draft
  sendCueDraft: (messageId: number, editedBody?: string) => void;
  rejectCueDraft: (messageId: number) => void;

  // task extraction — returns extracted candidate IDs, or empty if no new messages
  extractTasks: (conversationId: number) => number[];

  // candidate handling
  registerCandidate: (candidateId: number) => void;
  mergeCandidate: (candidateId: number) => void;
  rejectCandidate: (candidateId: number) => void;

  // issues
  addIssue: (projectId: number, body: string) => void;
  updateIssue: (id: number, body: string) => void;
  deleteIssue: (id: number) => void;

  // notes
  addNote: (projectId: number, body: string, visibility: 'personal' | 'internal') => void;

  // tasks
  toggleTaskComplete: (taskId: number) => void;
  updateTaskStatus: (taskId: number, status: TaskStatus) => void;
}

interface CreateProjectInput {
  name: string;
  client_company: string;
  description: string;
  start_date: string;
  end_date: string;
  members: Array<{ user_id: number; name: string; role: string; is_default: boolean }>;
  clients: Array<{ name: string; email: string }>;
}

const QDataContext = createContext<QDataValue | null>(null);

export const useQData = (): QDataValue => {
  const ctx = useContext(QDataContext);
  if (!ctx) throw new Error('useQData must be used within QDataProvider');
  return ctx;
};

// ─────────────────────────────────────────────
// Seed 초기화 유틸
// ─────────────────────────────────────────────
const cloneMessages = (m: Record<number, MockMessage[]>): Record<number, MockMessage[]> => {
  const next: Record<number, MockMessage[]> = {};
  Object.keys(m).forEach((k) => { next[Number(k)] = [...m[Number(k)]]; });
  return next;
};

// 시드 conversation 에 last_extracted_message_id 초기화
// 시드 메시지 중 가장 최근 id 의 "2개 이전" 을 커서로 잡아 → 새 메시지 2개가 "추출 가능" 상태가 되도록
const seedConversationsWithCursor = (convs: MockConversation[]): MockConversation[] => {
  return convs.map((c) => {
    const msgs = MOCK_MESSAGES[c.id] || [];
    if (msgs.length === 0) return { ...c, last_extracted_message_id: null };
    // 마지막 메시지로부터 뒤로 2개 더 extraction 가능하도록 커서를 좀 뒤로
    const cursorIdx = Math.max(0, msgs.length - 3);
    return { ...c, last_extracted_message_id: msgs[cursorIdx]?.id ?? null };
  });
};

// ─────────────────────────────────────────────
// Provider
// ─────────────────────────────────────────────
export const QDataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();

  const [projects, setProjects] = useState<MockProject[]>(MOCK_PROJECTS);
  const [conversations, setConversations] = useState<MockConversation[]>(
    () => seedConversationsWithCursor(MOCK_CONVERSATIONS)
  );
  const [messages, setMessages] = useState<Record<number, MockMessage[]>>(() => cloneMessages(MOCK_MESSAGES));
  const [tasks, setTasks] = useState<MockTask[]>(MOCK_TASKS);
  const [notes, setNotes] = useState<MockNote[]>(MOCK_NOTES);
  const [issues, setIssues] = useState<MockIssue[]>(MOCK_ISSUES);
  const [candidates, setCandidates] = useState<MockTaskCandidate[]>(MOCK_CANDIDATES);

  // ── Project
  const createProject = useCallback((data: CreateProjectInput): MockProject => {
    const newId = Math.max(0, ...projects.map((p) => p.id)) + 1;
    const ownerId = user ? Number(user.id) : 15;
    const defaultAssignee = data.members.find((m) => m.is_default)?.user_id ?? data.members[0]?.user_id ?? ownerId;
    const newProject: MockProject = {
      id: newId,
      name: data.name,
      description: data.description || undefined,
      client_company: data.client_company || '(없음)',
      status: 'active',
      start_date: data.start_date || undefined,
      end_date: data.end_date || undefined,
      default_assignee_id: defaultAssignee,
      members: data.members.map((m) => ({
        user_id: m.user_id, name: m.name, role: m.role, avatar_color: '#64748B',
        is_default_assignee: m.is_default,
      })),
      clients: data.clients.map((c, i) => ({
        user_id: 1000 + i, name: c.name, company: data.client_company || '(고객사)', avatar_color: '#64748B',
      })),
      unread_count: 0,
      has_cue_activity: false,
    };
    setProjects((prev) => [...prev, newProject]);

    // 2개 채널 자동 생성
    const baseConvId = Math.max(0, ...conversations.map((c) => c.id)) + 1;
    const internalConv: MockConversation = {
      id: baseConvId,
      project_id: newId,
      channel_type: 'internal',
      name: '내부 논의',
      auto_extract_enabled: false,
      unread_count: 0,
      last_extracted_message_id: null,
    };
    const customerConv: MockConversation = {
      id: baseConvId + 1,
      project_id: newId,
      channel_type: 'customer',
      name: `${data.client_company || '고객'}와의 소통`,
      auto_extract_enabled: true,
      unread_count: 0,
      last_extracted_message_id: null,
    };
    setConversations((prev) => [...prev, internalConv, customerConv]);
    setMessages((prev) => ({ ...prev, [baseConvId]: [], [baseConvId + 1]: [] }));
    return newProject;
  }, [projects, conversations, user]);

  // ── Conversation
  const renameConversation = useCallback((conversationId: number, name: string) => {
    setConversations((prev) => prev.map((c) => (c.id === conversationId ? { ...c, name } : c)));
  }, []);

  const toggleAutoExtract = useCallback((conversationId: number, enabled: boolean) => {
    setConversations((prev) => prev.map((c) => (c.id === conversationId ? { ...c, auto_extract_enabled: enabled } : c)));
  }, []);

  // ── Message
  const sendMessage = useCallback((conversationId: number, body: string) => {
    if (!body.trim()) return;
    setMessages((prev) => {
      const all = Object.values(prev).flat();
      const nextId = Math.max(0, ...all.map((m) => m.id)) + 1;
      const newMsg: MockMessage = {
        id: nextId,
        conversation_id: conversationId,
        sender_id: user ? Number(user.id) : 15,
        sender_name: user?.name || '나',
        sender_role: (user?.business_role === 'client' ? 'client' : user?.business_role === 'owner' ? 'owner' : 'member') as MockMessage['sender_role'],
        sender_color: '#64748B',
        body: body.trim(),
        created_at: new Date().toISOString(),
      };
      return { ...prev, [conversationId]: [...(prev[conversationId] || []), newMsg] };
    });
  }, [user]);

  // ── Cue Draft
  const sendCueDraft = useCallback((messageId: number, editedBody?: string) => {
    setMessages((prev) => {
      // 모든 conversation 에서 해당 메시지 탐색
      const next = { ...prev };
      for (const [convIdStr, msgs] of Object.entries(prev)) {
        const target = msgs.find((m) => m.id === messageId);
        if (target && target.cue_draft) {
          const convId = Number(convIdStr);
          const body = editedBody || target.cue_draft.body;
          const all = Object.values(prev).flat();
          const nextId = Math.max(0, ...all.map((m) => m.id)) + 1;
          const cueReply: MockMessage = {
            id: nextId,
            conversation_id: convId,
            sender_id: 999,
            sender_name: 'Cue',
            sender_role: 'cue',
            sender_color: '#F43F5E',
            body,
            created_at: new Date().toISOString(),
            reply_to_message_id: messageId,
            ai_sources: target.cue_draft.source
              ? [{ doc_id: 1, title: target.cue_draft.source.title, section: target.cue_draft.source.section, snippet: '' }]
              : undefined,
          };
          next[convId] = [
            ...msgs.map((m) => (m.id === messageId ? { ...m, cue_draft: undefined } : m)),
            cueReply,
          ];
          break;
        }
      }
      return next;
    });
  }, []);

  const rejectCueDraft = useCallback((messageId: number) => {
    setMessages((prev) => {
      const next = { ...prev };
      for (const [convIdStr, msgs] of Object.entries(prev)) {
        if (msgs.some((m) => m.id === messageId)) {
          next[Number(convIdStr)] = msgs.map((m) => (m.id === messageId ? { ...m, cue_draft: undefined } : m));
          break;
        }
      }
      return next;
    });
  }, []);

  // ── 업무 추출 — 스마트 버전
  // 커서 이후 메시지를 읽어 질문/요청 형태를 감지, 실제 발견되면 후보 생성.
  // 아무 것도 없으면 빈 배열 반환 (호출자가 "새 메시지 없음" 토스트 띄움)
  const extractTasks = useCallback((conversationId: number): number[] => {
    const conv = conversations.find((c) => c.id === conversationId);
    if (!conv) return [];
    const convMsgs = messages[conversationId] || [];
    const cursor = conv.last_extracted_message_id;
    const newMsgs = cursor
      ? convMsgs.filter((m) => m.id > cursor)
      : convMsgs;
    if (newMsgs.length === 0) return [];

    // 질문 메시지 또는 '할까요'/'까지'/'언제'/'주시' 키워드 메시지를 찾는다
    const actionKeywords = /(할까요|까지|언제|부탁|요청|주시|확인|처리)/;
    const candidates_: MockMessage[] = newMsgs.filter((m) => {
      if (m.sender_role === 'cue') return false;
      return m.is_question || actionKeywords.test(m.body);
    });

    if (candidates_.length === 0) {
      // 새 메시지는 있지만 업무화할 만한 게 없음 → 커서만 업데이트하고 반환 0
      setConversations((prev) => prev.map((c) =>
        c.id === conversationId ? { ...c, last_extracted_message_id: convMsgs[convMsgs.length - 1].id, last_extracted_at: new Date().toISOString() } : c
      ));
      return [];
    }

    // 후보 생성 — 각 action 메시지 당 1개 (최대 3개)
    const projectId = conv.project_id;
    const project = projects.find((p) => p.id === projectId);
    const designer = project?.members.find((m) => m.role === '디자인');
    const defaultAssignee = project?.members.find((m) => m.user_id === project.default_assignee_id);
    const fallbackAssignee = defaultAssignee
      ? { user_id: defaultAssignee.user_id, name: defaultAssignee.name }
      : undefined;

    const newCandidates: MockTaskCandidate[] = candidates_.slice(0, 3).map((msg, idx) => ({
      id: Math.max(0, ...candidates.map((c) => c.id)) + 1 + idx,
      project_id: projectId,
      conversation_id: conversationId,
      title: synthesizeTitle(msg.body),
      description: `대화에서 감지: "${msg.body.slice(0, 80)}${msg.body.length > 80 ? '…' : ''}"`,
      source_message_ids: [msg.id],
      guessed_assignee: designer
        ? { user_id: designer.user_id, name: designer.name }
        : fallbackAssignee,
      guessed_role: designer?.role || '기타',
      guessed_due_date: extractDueDate(msg.body),
      status: 'pending' as const,
    }));

    setCandidates((prev) => [...prev, ...newCandidates]);
    setConversations((prev) => prev.map((c) =>
      c.id === conversationId
        ? { ...c, last_extracted_message_id: convMsgs[convMsgs.length - 1].id, last_extracted_at: new Date().toISOString() }
        : c
    ));
    return newCandidates.map((c) => c.id);
  }, [conversations, messages, projects, candidates]);

  // ── Candidate 처리
  const registerCandidate = useCallback((candidateId: number) => {
    const cand = candidates.find((c) => c.id === candidateId);
    if (!cand) return;
    const nextTaskId = Math.max(0, ...tasks.map((t) => t.id)) + 1;
    setTasks((prev) => [...prev, {
      id: nextTaskId,
      project_id: cand.project_id,
      title: cand.title,
      assignee_id: cand.guessed_assignee?.user_id || 15,
      assignee_name: cand.guessed_assignee?.name || '미지정',
      due_date: cand.guessed_due_date,
      status: 'not_started',
    }]);
    setCandidates((prev) => prev.filter((c) => c.id !== candidateId));
  }, [candidates, tasks]);

  const mergeCandidate = useCallback((candidateId: number) => {
    setCandidates((prev) => prev.filter((c) => c.id !== candidateId));
  }, []);

  const rejectCandidate = useCallback((candidateId: number) => {
    setCandidates((prev) => prev.filter((c) => c.id !== candidateId));
  }, []);

  // ── Issues
  const addIssue = useCallback((projectId: number, body: string) => {
    if (!body.trim()) return;
    setIssues((prev) => {
      const nextId = Math.max(0, ...prev.map((i) => i.id)) + 1;
      const now = new Date().toISOString();
      return [
        { id: nextId, project_id: projectId, body: body.trim(), author_name: user?.name || '나', created_at: now, updated_at: now },
        ...prev,
      ];
    });
  }, [user]);

  const updateIssue = useCallback((id: number, body: string) => {
    setIssues((prev) => prev.map((i) => (i.id === id ? { ...i, body, updated_at: new Date().toISOString() } : i)));
  }, []);

  const deleteIssue = useCallback((id: number) => {
    setIssues((prev) => prev.filter((i) => i.id !== id));
  }, []);

  // ── Notes
  const addNote = useCallback((projectId: number, body: string, visibility: 'personal' | 'internal') => {
    if (!body.trim()) return;
    setNotes((prev) => {
      const nextId = Math.max(0, ...prev.map((n) => n.id)) + 1;
      return [
        {
          id: nextId, project_id: projectId,
          author_id: user ? Number(user.id) : 15,
          author_name: user?.name || '나',
          visibility, body: body.trim(),
          created_at: new Date().toISOString(),
        },
        ...prev,
      ];
    });
  }, [user]);

  // ── Tasks
  const toggleTaskComplete = useCallback((taskId: number) => {
    setTasks((prev) => prev.map((t) => (
      t.id === taskId ? { ...t, status: t.status === 'completed' ? 'in_progress' : 'completed' } : t
    )));
  }, []);

  const updateTaskStatus = useCallback((taskId: number, status: TaskStatus) => {
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status } : t)));
  }, []);

  const value = useMemo<QDataValue>(() => ({
    projects, conversations, messages, tasks, notes, issues, candidates,
    createProject, renameConversation, toggleAutoExtract,
    sendMessage, sendCueDraft, rejectCueDraft,
    extractTasks, registerCandidate, mergeCandidate, rejectCandidate,
    addIssue, updateIssue, deleteIssue, addNote,
    toggleTaskComplete, updateTaskStatus,
  }), [
    projects, conversations, messages, tasks, notes, issues, candidates,
    createProject, renameConversation, toggleAutoExtract,
    sendMessage, sendCueDraft, rejectCueDraft,
    extractTasks, registerCandidate, mergeCandidate, rejectCandidate,
    addIssue, updateIssue, deleteIssue, addNote,
    toggleTaskComplete, updateTaskStatus,
  ]);

  return <QDataContext.Provider value={value}>{children}</QDataContext.Provider>;
};

// ─────────────────────────────────────────────
// 유틸 — 메시지 본문에서 업무 제목 / 마감일 유추 (결정론적 mock)
// ─────────────────────────────────────────────
function synthesizeTitle(body: string): string {
  const trimmed = body.trim().replace(/\s+/g, ' ');
  // 물음표로 끝나면 물음표 제거 + 처리 요청 형태로
  if (trimmed.endsWith('?')) {
    return trimmed.slice(0, -1) + ' — 답변/처리 필요';
  }
  // 너무 길면 앞 40자만
  return trimmed.length > 40 ? trimmed.slice(0, 40) + '...' : trimmed;
}

function extractDueDate(body: string): string | undefined {
  // 매우 단순한 키워드 기반 mock — 실제로는 LLM 이 처리
  const today = new Date();
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  if (/오늘/.test(body)) return fmt(today);
  if (/내일/.test(body)) { const d = new Date(today); d.setDate(d.getDate() + 1); return fmt(d); }
  if (/이번\s*주|금요일까지|금요일 전|금일 내/.test(body)) {
    const d = new Date(today);
    const daysToFri = (5 - d.getDay() + 7) % 7 || 7;
    d.setDate(d.getDate() + daysToFri);
    return fmt(d);
  }
  if (/다음\s*주/.test(body)) { const d = new Date(today); d.setDate(d.getDate() + 7); return fmt(d); }
  return undefined;
}
