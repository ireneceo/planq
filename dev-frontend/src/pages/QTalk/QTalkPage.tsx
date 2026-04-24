import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { io, type Socket } from 'socket.io-client';
import LeftPanel from './LeftPanel';
import ChatPanel from './ChatPanel';
import RightPanel from './RightPanel';
import NewProjectModal, { type ProjectFormData } from './NewProjectModal';
import NewChatModal, { type NewChatFormData } from './NewChatModal';
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
    color: p.color || null,
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
  // Cue AI 메시지 + draft 미승인 → cue_draft 카드 표시
  const isDraft = m.is_ai && m.ai_draft_approved === null;
  const isRejectedDraft = m.is_ai && m.ai_draft_approved === false;

  return {
    id: m.id,
    conversation_id: m.conversation_id,
    sender_id: m.sender_id,
    sender_name: m.sender?.name || `user ${m.sender_id}`,
    sender_role: m.is_ai ? 'cue' : 'member',
    sender_color: m.is_ai ? '#F43F5E' : '#64748B',
    body: isRejectedDraft ? '' : m.content,  // 거절된 draft는 빈 body
    created_at: m.createdAt,
    reply_to_message_id: m.reply_to_message_id,
    is_question: !m.is_ai && m.content.trim().endsWith('?'),
    cue_draft: isDraft ? {
      body: m.content,
      confidence: m.ai_confidence || 0,
      source: m.ai_source ? { title: m.ai_source, section: '' } : undefined,
      processing_by: null,
    } : undefined,
    attachments: (m.attachments || []).map(a => ({
      id: a.id,
      file_name: a.file_name,
      file_size: a.file_size,
      mime_type: a.mime_type,
    })),
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
    conversation_id: n.conversation_id ?? null,
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
    conversation_id: i.conversation_id ?? null,
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
  const { t } = useTranslation('qtalk');
  const { user } = useAuth();
  const businessId = user?.business_id || null;

  const [projects, setProjects] = useState<MockProject[]>([]);
  const [conversations, setConversations] = useState<MockConversation[]>([]);
  const [messages, setMessages] = useState<Record<number, MockMessage[]>>({});
  const [tasks, setTasks] = useState<MockTask[]>([]);
  const [notes, setNotes] = useState<MockNote[]>([]);
  const [issues, setIssues] = useState<MockIssue[]>([]);
  const [candidates, setCandidates] = useState<MockTaskCandidate[]>([]);

  const location = useLocation();
  const navigate = useNavigate();
  // URL ?project=:pid&conv=:cid — 채팅방 단위 공유/북마크 가능
  const initialParams = new URLSearchParams(location.search);
  const initialProject = Number(initialParams.get('project')) || null;
  const initialConv = Number(initialParams.get('conv')) || null;
  const [activeProjectId, setActiveProjectId] = useState<number | null>(initialProject);
  const [activeConversationId, setActiveConversationId] = useState<number | null>(initialConv);

  // 선택 상태 → URL 싱크. state 변경을 단일 소스로 유지.
  useEffect(() => {
    const sp = new URLSearchParams(location.search);
    if (activeProjectId) sp.set('project', String(activeProjectId)); else sp.delete('project');
    if (activeConversationId) sp.set('conv', String(activeConversationId)); else sp.delete('conv');
    const qs = sp.toString();
    const next = qs ? `${location.pathname}?${qs}` : location.pathname;
    if (next !== `${location.pathname}${location.search}`) {
      navigate(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProjectId, activeConversationId]);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [leftCollapsed, setLeftCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(STORAGE_LEFT) === '1'; } catch { return false; }
  });
  const [rightCollapsed, setRightCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(STORAGE_RIGHT) === '1'; } catch { return false; }
  });

  const [modalOpen, setModalOpen] = useState(false);
  const [chatModalOpen, setChatModalOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const showNotice = useCallback((msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice(null), 3500);
  }, []);

  // ── Socket.IO 실시간 ──
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return;

    const socket = io(window.location.origin, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 2000,
      reconnectionAttempts: 10,
    });

    socketRef.current = socket;

    // 메시지 수신
    socket.on('message:new', (msg: qtalkApi.ApiMessage) => {
      const mapped = apiMessageToMock(msg);
      setMessages((prev) => {
        const arr = prev[mapped.conversation_id] || [];
        // 중복 방지 (자기가 보낸 메시지는 이미 추가됨)
        if (arr.some((m) => m.id === mapped.id)) return prev;
        return { ...prev, [mapped.conversation_id]: [...arr, mapped] };
      });
    });

    // 후보 생성
    socket.on('candidates:created', (data: { project_id: number; candidates: qtalkApi.ApiTaskCandidate[] }) => {
      const mapped = data.candidates.map(apiCandidateToMock);
      setCandidates((prev) => [...mapped, ...prev]);
    });

    // 이슈 생성
    socket.on('issue:new', (issue: qtalkApi.ApiIssue) => {
      const mapped = apiIssueToMock(issue);
      setIssues((prev) => {
        if (prev.some((i) => i.id === mapped.id)) return prev;
        return [mapped, ...prev];
      });
    });

    // 메시지 업데이트 (Draft 승인/거절 등)
    socket.on('message:updated', (msg: qtalkApi.ApiMessage) => {
      const mapped = apiMessageToMock(msg);
      setMessages((prev) => {
        const arr = prev[mapped.conversation_id] || [];
        return { ...prev, [mapped.conversation_id]: arr.map((m) => (m.id === mapped.id ? mapped : m)) };
      });
    });

    // 메모 생성
    socket.on('note:new', (note: qtalkApi.ApiNote) => {
      const mapped = apiNoteToMock(note);
      setNotes((prev) => {
        if (prev.some((n) => n.id === mapped.id)) return prev;
        return [mapped, ...prev];
      });
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 대화방 변경 시 room join/leave
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;

    if (activeConversationId) {
      socket.emit('join:conversation', activeConversationId);
    }

    return () => {
      if (activeConversationId) {
        socket.emit('leave:conversation', activeConversationId);
      }
    };
  }, [activeConversationId]);

  // 대화 선택 시 메시지 lazy-load — 프로젝트 단위 초기 로드에 포함되지 않은 독립 대화도
  // 활성화되는 순간 메시지를 불러온다. 이미 캐시된 대화는 skip.
  useEffect(() => {
    if (!activeConversationId) return;
    if (messages[activeConversationId] !== undefined) return; // 이미 로드됨
    let cancelled = false;
    (async () => {
      try {
        const msgs = await qtalkApi.listConversationMessages(activeConversationId);
        if (cancelled) return;
        setMessages((prev) => ({ ...prev, [activeConversationId]: msgs.map(apiMessageToMock) }));
      } catch { /* silent — 에러는 ChatPanel 빈 상태로 내려감 */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConversationId]);

  // 프로젝트 변경 시 room join/leave — 독립 대화(-1/null)는 스킵
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !activeProjectId || activeProjectId <= 0) return;

    socket.emit('join:project', activeProjectId);

    return () => {
      socket.emit('leave:project', activeProjectId);
    };
  }, [activeProjectId]);

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
          // URL ?project=ID 가 있을 때만 선택. 기본 자동 선택 X — 빈 상태(대화 시작하기) 를 보여줘야 함
          const params = new URLSearchParams(window.location.search);
          const qpid = Number(params.get('project'));
          if (qpid && mapped.some((p) => p.id === qpid)) {
            setActiveProjectId((prev) => prev ?? qpid);
          }
          // 좌측 리스트 채우기 — 워크스페이스 전체 대화 한번에 로드
          // (프로젝트별 fetch 는 독립 대화/project_id null 을 놓쳤음).
          (async () => {
            try {
              const apiConvs = await qtalkApi.listBusinessConversations(businessId);
              if (cancelled) return;
              const all: MockConversation[] = apiConvs.map(apiConversationToMock);
              setConversations(prev => {
                const existingIds = new Set(prev.map(c => c.id));
                const newOnes = all.filter(c => !existingIds.has(c.id));
                return [...prev, ...newOnes];
              });
            } catch {/* silent */}
          })();
        }
      } catch (err: unknown) {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : (t('page.loadFailedShort', '프로젝트 목록 로드 실패') as string));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [businessId]);

  // ── 프로젝트 선택 시 해당 프로젝트 데이터 전부 fetch ──
  useEffect(() => {
    // 독립 대화(activeProjectId<=0 / null)는 프로젝트 데이터 fetch 스킵 — /api/projects/-1/* 404 방지
    if (!activeProjectId || activeProjectId <= 0) return;
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

  // ── 독립 대화 선택 시 conv 스코프 데이터 fetch (notes/issues/candidates/tasks) ──
  useEffect(() => {
    if (!activeConversationId) return;
    // 활성 대화가 프로젝트 연결이면 프로젝트 useEffect 가 이미 처리함
    const conv = conversations.find(c => c.id === activeConversationId);
    if (!conv || conv.project_id) return;
    let cancelled = false;
    (async () => {
      try {
        const [notesList, issuesList, candList, tasksList] = await Promise.all([
          qtalkApi.listConvNotes(activeConversationId).catch(() => [] as qtalkApi.ApiNote[]),
          qtalkApi.listConvIssues(activeConversationId).catch(() => [] as qtalkApi.ApiIssue[]),
          qtalkApi.listConvCandidates(activeConversationId).catch(() => [] as qtalkApi.ApiTaskCandidate[]),
          qtalkApi.listConvTasks(activeConversationId).catch(() => [] as qtalkApi.ApiTask[]),
        ]);
        if (cancelled) return;
        // 기존 이 conv 스코프 항목은 덮어쓰기, 다른 스코프는 유지
        setNotes(prev => [
          ...prev.filter(n => n.conversation_id !== activeConversationId),
          ...notesList.map(apiNoteToMock).map(n => ({ ...n, conversation_id: activeConversationId })),
        ]);
        setIssues(prev => [
          ...prev.filter(i => i.conversation_id !== activeConversationId),
          ...issuesList.map(apiIssueToMock).map(i => ({ ...i, conversation_id: activeConversationId })),
        ]);
        setCandidates(prev => [
          ...prev.filter(c => c.conversation_id !== activeConversationId),
          ...candList.map(apiCandidateToMock),
        ]);
        setTasks(prev => [
          ...prev.filter(t => t.conversation_id !== activeConversationId),
          ...tasksList.map(apiTaskToMock).map(t => ({ ...t, conversation_id: activeConversationId })),
        ]);
      } catch { /* silent */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConversationId]);

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

  // 같은 대화를 재클릭하면 선택 해제 (토글). 통일된 UX 원칙 — CLAUDE.md 참조.
  const handleSelectConversation = (projectId: number, conversationId: number) => {
    if (activeConversationId === conversationId) {
      setActiveConversationId(null);
      return;
    }
    // LeftPanel 의 standalone 그룹은 fake projectId=-1 을 넘김 → 독립 채팅은 activeProjectId null.
    setActiveProjectId(projectId > 0 ? projectId : null);
    setActiveConversationId(conversationId);
  };
  const handleSelectChannel = (conversationId: number) => {
    setActiveConversationId(prev => prev === conversationId ? null : conversationId);
  };

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
        color: data.color || undefined,
        members: data.members.map((m) => ({ user_id: m.user_id, role: m.role, is_default: m.is_default })),
        clients: data.clients.map((c) => ({ name: c.name, email: c.email })),
      });
      const mapped = apiProjectToMock(created);
      setProjects((prev) => [mapped, ...prev]);
      setActiveProjectId(mapped.id);
      setActiveConversationId(null);
      setModalOpen(false);
      showNotice(t('page.projectCreated', { name: mapped.name }));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : (t('page.projectCreateFailed', '프로젝트 생성 실패') as string);
      showNotice(t('page.createFailed', { msg }));
    }
  };

  // ── 새 대화 생성 ──
  const handleCreateChat = async (data: NewChatFormData) => {
    if (!businessId) return;
    try {
      const conv = await qtalkApi.createConversation({
        business_id: businessId,
        title: data.title,
        project_id: data.project_id,
        participant_user_ids: data.participant_user_ids,
      });
      const mapped = apiConversationToMock(conv);
      setConversations((prev) => [mapped, ...prev.filter((c) => c.id !== mapped.id)]);
      // 독립 대화(project_id null)는 activeProjectId 도 null 로 초기화해야 ChatPanel 이 standalone 브랜치로 렌더한다.
      setActiveProjectId(conv.project_id || null);
      setActiveConversationId(conv.id);
      setChatModalOpen(false);
      showNotice(t('page.chatCreated', { title: conv.title }));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : (t('page.chatCreateFailed', '대화 생성 실패') as string);
      showNotice(t('page.createFailed', { msg }));
    }
  };

  const [extracting, setExtracting] = useState(false);

  // 청크 2: 메시지 전송
  const handleSendMessage = async (body: string, files?: File[]) => {
    if (!activeConversationId) return;
    try {
      // 첨부만 있고 텍스트 없는 경우: 본문은 공백 한 글자 (백엔드 content_required 회피)
      const content = body.trim() || (files && files.length > 0 ? ' ' : '');
      if (!content) return;
      const created = await qtalkApi.sendMessage(activeConversationId, content);
      const attachmentResults: qtalkApi.ApiMessageAttachment[] = [];
      if (files && files.length > 0) {
        const uploads = await Promise.allSettled(
          files.map((f) => qtalkApi.uploadMessageAttachment(activeConversationId, created.id, f))
        );
        uploads.forEach((r) => { if (r.status === 'fulfilled') attachmentResults.push(r.value); });
      }
      const mapped = apiMessageToMock({ ...created, attachments: attachmentResults });
      setMessages((prev) => ({
        ...prev,
        [activeConversationId]: [...(prev[activeConversationId] || []), mapped],
      }));
    } catch (err: unknown) {
      showNotice(t('page.sendFailed', { msg: err instanceof Error ? err.message : '' }));
    }
  };

  // 청크 2: 채널 이름 변경
  const handleRenameConversation = async (conversationId: number, name: string) => {
    try {
      const updated = await qtalkApi.updateConversation(conversationId, { display_name: name });
      setConversations((prev) => prev.map((c) => (c.id === conversationId ? { ...c, name: updated.display_name || updated.title || c.name } : c)));
    } catch (err: unknown) {
      showNotice(t('page.renameFailed', { msg: err instanceof Error ? err.message : '' }));
    }
  };

  // 청크 2: 자동 추출 토글
  const handleToggleAutoExtract = async (conversationId: number, enabled: boolean) => {
    try {
      const updated = await qtalkApi.updateConversation(conversationId, { auto_extract_enabled: enabled });
      setConversations((prev) => prev.map((c) => (c.id === conversationId ? { ...c, auto_extract_enabled: updated.auto_extract_enabled } : c)));
    } catch (err: unknown) {
      showNotice(t('page.autoExtractFailed', { msg: err instanceof Error ? err.message : '' }));
    }
  };

  // 청크 4: 이슈 CRUD
  const handleAddIssue = async (body: string) => {
    try {
      let created: qtalkApi.ApiIssue;
      if (activeProjectId) {
        // 프로젝트 대화에서 쓴 이슈도 conversation_id 기록 — 양쪽(채팅/프로젝트)에서 추적 가능.
        created = await qtalkApi.addIssue(activeProjectId, body, activeConversationId || undefined);
      } else if (activeConversationId) {
        created = await qtalkApi.addConvIssue(activeConversationId, body);
      } else {
        return;
      }
      setIssues((prev) => [apiIssueToMock(created), ...prev]);
    } catch (err: unknown) {
      showNotice(t('page.issueAddFailed', { msg: err instanceof Error ? err.message : '' }));
    }
  };

  const handleUpdateIssue = async (id: number, body: string) => {
    try {
      const updated = await qtalkApi.updateIssue(id, body);
      setIssues((prev) => prev.map((i) => (i.id === id ? apiIssueToMock(updated) : i)));
    } catch (err: unknown) {
      showNotice(t('page.issueEditFailed', { msg: err instanceof Error ? err.message : '' }));
    }
  };

  const handleDeleteIssue = async (id: number) => {
    try {
      await qtalkApi.deleteIssue(id);
      setIssues((prev) => prev.filter((i) => i.id !== id));
    } catch (err: unknown) {
      showNotice(t('page.issueDeleteFailed', { msg: err instanceof Error ? err.message : '' }));
    }
  };

  // 청크 4: 메모 추가
  const handleAddNote = async (body: string, visibility: 'personal' | 'internal') => {
    try {
      let created: qtalkApi.ApiNote;
      if (activeProjectId) {
        // 프로젝트 대화에서 쓴 메모도 conversation_id 기록 — 양쪽에서 추적 + '어느 채팅에서 왔는지' 표시.
        created = await qtalkApi.addNote(activeProjectId, body, visibility, activeConversationId || undefined);
      } else if (activeConversationId) {
        created = await qtalkApi.addConvNote(activeConversationId, body, visibility);
      } else {
        return;
      }
      setNotes((prev) => [apiNoteToMock(created), ...prev]);
    } catch (err: unknown) {
      showNotice(t('page.noteAddFailed', { msg: err instanceof Error ? err.message : '' }));
    }
  };

  // 청크 4: 업무 체크박스 토글
  const handleToggleTask = async (id: number) => {
    const task = tasks.find((t) => t.id === id);
    if (!task) return;
    const nextStatus = task.status === 'completed' ? 'in_progress' : 'completed';
    try {
      const updated = await qtalkApi.updateTaskStatus(id, nextStatus);
      setTasks((prev) => prev.map((tk) => (tk.id === id ? apiTaskToMock(updated) : tk)));
    } catch (err: unknown) {
      showNotice(t('page.taskStatusFailed', { msg: err instanceof Error ? err.message : '' }));
    }
  };

  // 청크 3: 업무 후보 추출
  const handleExtract = async () => {
    if (!activeConversationId || extracting) return;
    setExtracting(true);
    try {
      const result = await qtalkApi.extractTaskCandidates(activeConversationId);
      if (result.candidates.length > 0) {
        const mapped = result.candidates.map(apiCandidateToMock);
        setCandidates((prev) => [...mapped, ...prev]);
        showNotice(t('extract.found', { count: result.candidates.length }));
      } else if (result.skipped && result.reason === 'no_new_messages') {
        showNotice(t('extract.noNewMessages'));
      } else if (result.fallback) {
        // LLM 키 미설정 또는 LLM 호출 실패
        showNotice(t('extract.llmUnavailable'));
      } else {
        // 메시지는 있는데 추출된 업무 후보가 없음
        showNotice(t('extract.noTasksFound'));
      }
      // 대화 커서 업데이트 (UI에서 last_extracted_message_id 반영)
      if (!result.skipped && activeProjectId) {
        const convList = await qtalkApi.listProjectConversations(activeProjectId);
        setConversations((prev) => {
          const others = prev.filter((c) => c.project_id !== activeProjectId);
          return [...others, ...convList.map(apiConversationToMock)];
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      if (msg === 'extraction_already_in_progress') {
        showNotice(t('extract.inProgress'));
      } else {
        showNotice(t('extract.failed', { msg }));
      }
    } finally {
      setExtracting(false);
    }
  };

  // 청크 3: 후보 등록
  const handleRegisterCandidate = async (id: number) => {
    try {
      const result = await qtalkApi.registerCandidate(id);
      // 후보 목록에서 제거 (또는 상태 변경)
      setCandidates((prev) => prev.filter((c) => c.id !== id));
      // 새 업무를 tasks에 추가
      if (result.task) {
        setTasks((prev) => [apiTaskToMock(result.task), ...prev]);
      }
    } catch (err: unknown) {
      showNotice(`register_failed: ${err instanceof Error ? err.message : ''}`);
    }
  };

  // 청크 3: 후보 병합
  const handleMergeCandidate = async (id: number) => {
    const candidate = candidates.find((c) => c.id === id);
    if (!candidate?.similar_task_id) return;
    try {
      await qtalkApi.mergeCandidate(id, candidate.similar_task_id);
      setCandidates((prev) => prev.filter((c) => c.id !== id));
    } catch (err: unknown) {
      showNotice(`merge_failed: ${err instanceof Error ? err.message : ''}`);
    }
  };

  // 청크 3: 후보 거절
  const handleRejectCandidate = async (id: number) => {
    try {
      await qtalkApi.rejectCandidate(id);
      setCandidates((prev) => prev.filter((c) => c.id !== id));
    } catch (err: unknown) {
      showNotice(`reject_failed: ${err instanceof Error ? err.message : ''}`);
    }
  };

  // Cue Draft 승인
  const handleCueDraftSend = async (messageId: number, editedBody?: string) => {
    try {
      const updated = await qtalkApi.approveDraft(messageId, editedBody);
      // 메시지 목록에서 해당 메시지 갱신
      const mapped = apiMessageToMock(updated);
      setMessages((prev) => {
        const convMsgs = prev[updated.conversation_id] || [];
        return {
          ...prev,
          [updated.conversation_id]: convMsgs.map((m) => (m.id === messageId ? mapped : m)),
        };
      });
    } catch (err: unknown) {
      showNotice(`draft_approve_failed: ${err instanceof Error ? err.message : ''}`);
    }
  };

  // Cue Draft 거절
  const handleCueDraftReject = async (messageId: number) => {
    try {
      await qtalkApi.rejectDraft(messageId);
      // Draft 거절 → 메시지를 목록에서 제거 (또는 숨김 처리)
      setMessages((prev) => {
        const result: Record<number, MockMessage[]> = {};
        for (const [convId, msgs] of Object.entries(prev)) {
          result[Number(convId)] = msgs.filter((m) => m.id !== messageId);
        }
        return result;
      });
    } catch (err: unknown) {
      showNotice(`draft_reject_failed: ${err instanceof Error ? err.message : ''}`);
    }
  };

  const activeProject = projects.find((p) => p.id === activeProjectId) || null;
  // 후보 scope: 프로젝트 선택 시 project_id, 독립 대화면 conversation_id 로 필터
  const projectCandidates = activeProject
    ? candidates.filter((c) => c.project_id === activeProject.id && c.status === 'pending')
    : activeConversationId
      ? candidates.filter((c) => c.conversation_id === activeConversationId && c.status === 'pending')
      : [];

  if (!businessId) return <Empty>{t('page.noBusiness', '워크스페이스가 선택되지 않았습니다.')}</Empty>;
  if (loading) return <Empty>{t('page.loading', '프로젝트 로드 중...')}</Empty>;
  if (loadError) return <Empty>{t('page.loadFailed', { msg: loadError })}</Empty>;

  return (
    <Layout>
      <LeftPanel
        projects={projects}
        conversations={conversations}
        activeProjectId={activeProjectId}
        activeConversationId={activeConversationId}
        onSelectConversation={handleSelectConversation}
        onOpenNewChat={() => setChatModalOpen(true)}
        collapsed={leftCollapsed}
        onToggleCollapsed={toggleLeft}
      />
      <ChatPanel
        project={activeProject}
        conversations={conversations}
        messages={messages}
        activeConversationId={activeConversationId}
        onSelectConversation={handleSelectChannel}
        onOpenExtract={handleExtract}
        extracting={extracting}
        onSendMessage={handleSendMessage}
        onCueDraftSend={handleCueDraftSend}
        onCueDraftReject={handleCueDraftReject}
        onToggleAutoExtract={handleToggleAutoExtract}
        onRenameConversation={handleRenameConversation}
        candidatesCount={projectCandidates.length}
        leftCollapsed={leftCollapsed}
        rightCollapsed={rightCollapsed}
        onToggleLeft={toggleLeft}
        onToggleRight={toggleRight}
        onOpenNewChat={() => setChatModalOpen(true)}
        onFocusCandidates={() => {
          if (rightCollapsed) setRightCollapsed(false);
          // 다음 tick 에 우측 패널의 candidates 섹션으로 스크롤
          setTimeout(() => {
            const el = document.querySelector('[data-section="candidates"]');
            if (el && el instanceof HTMLElement) {
              el.scrollIntoView({ behavior: 'smooth', block: 'start' });
              el.style.transition = 'background 0.3s';
              el.style.background = 'rgba(244, 63, 94, 0.08)';
              setTimeout(() => { el.style.background = ''; }, 1500);
            }
          }, 150);
        }}
      />
      <RightPanel
        project={activeProject}
        activeConversationId={activeConversationId}
        conversations={conversations}
        tasks={tasks}
        notes={notes}
        issues={issues}
        candidates={projectCandidates}
        collapsed={rightCollapsed}
        onToggleCollapsed={toggleRight}
        onRegisterCandidate={handleRegisterCandidate}
        onMergeCandidate={handleMergeCandidate}
        onRejectCandidate={handleRejectCandidate}
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

      <NewChatModal
        businessId={businessId || 0}
        open={chatModalOpen && !!businessId}
        preselectedProjectId={activeProjectId}
        onClose={() => setChatModalOpen(false)}
        onCreate={handleCreateChat}
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
