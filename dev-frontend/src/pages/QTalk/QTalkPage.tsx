import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { joinRoom, leaveRoom, onSocket, getSocket } from '../../services/socket';
import LeftPanel from './LeftPanel';
import ArchivedChatsModal from './ArchivedChatsModal';
import ChatPanel from './ChatPanel';
import RightPanel from './RightPanel';
import NewProjectModal, { type ProjectFormData } from './NewProjectModal';
import NewChatModal, { type NewChatFormData } from './NewChatModal';
import ConfirmDialog from '../../components/Common/ConfirmDialog';
import { PanelLayout } from '../../components/Layout/PanelLayout';
import ChatSettingsModal from './ChatSettingsModal';
import i18n from '../../i18n';
import {
  type MockTaskCandidate, type MockMessage, type MockProject,
  type MockConversation, type MockTask, type MockNote, type MockIssue,
  type TaskStatus,
} from './types';
import { useAuth, apiFetch } from '../../contexts/AuthContext';
import * as qtalkApi from '../../services/qtalk';
import { useVisibilityRefresh } from '../../hooks/useVisibilityRefresh';
import { mapApiError } from '../../utils/apiError';
import PanelEdgeHandle from '../../components/Layout/PanelEdgeHandle';

/**
 * QTalkPage — 실데이터 기반 (시드 데이터 로드)
 *
 * 프로젝트 선택 시 해당 프로젝트의 채널/메시지/업무/메모/이슈/후보 를 전부 fetch.
 * Write 엔드포인트는 청크 2~5 에서 추가 (현재는 읽기만).
 */

const STORAGE_LEFT = 'qtalk_left_collapsed';
const STORAGE_RIGHT = 'qtalk_right_collapsed';

// 사이클 N+15-A — 진입 즉시성 캐시 (stale-while-revalidate).
// projects + conversations 만 캐시 (메시지·후보는 fresh 가 더 중요해서 제외).
// 재진입 시 즉시 좌측 리스트 렌더 → 사용자는 spinner 한 번도 안 봄.
// 1h TTL 후 무시 (스키마 변경/보관 처리 등으로 stale 가능성).
const CACHE_KEY = (bid: number) => `qtalk_cache_v1_${bid}`;
const CACHE_TTL_MS = 60 * 60 * 1000;

function loadQtalkCache(bid: number): { projects: MockProject[]; conversations: MockConversation[] } | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY(bid));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.ts !== 'number') return null;
    if (Date.now() - parsed.ts > CACHE_TTL_MS) return null;
    return {
      projects: Array.isArray(parsed.projects) ? parsed.projects : [],
      conversations: Array.isArray(parsed.conversations) ? parsed.conversations : [],
    };
  } catch { return null; }
}

function saveQtalkCache(bid: number, projects: MockProject[], conversations: MockConversation[]) {
  try {
    localStorage.setItem(CACHE_KEY(bid), JSON.stringify({
      ts: Date.now(),
      projects,
      conversations,
    }));
  } catch { /* quota — 무시 */ }
}

// ─────────────────────────────────────────────
// API → Mock 타입 변환 (기존 panel 컴포넌트 호환)
// ─────────────────────────────────────────────
function apiProjectToMock(p: qtalkApi.ApiProject): MockProject {
  return {
    id: p.id,
    name: p.name,
    description: p.description || undefined,
    client_company: p.client_company || i18n.t('qtalk:fallback.unspecified', { defaultValue: '(미지정)' }),
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
      is_pm: !!(m as { is_pm?: boolean }).is_pm,
    })),
    clients: (p.projectClients || []).map((c) => ({
      user_id: c.contact_user_id || 0,
      name: c.contact_name || i18n.t('qtalk:fallback.noName', { defaultValue: '(이름 없음)' }),
      company: p.client_company || i18n.t('qtalk:fallback.clientCompany', { defaultValue: '(고객사)' }),
      avatar_color: '#64748B',
    })),
    unread_count: 0,
    has_cue_activity: false,
  };
}

function apiConversationToMock(c: qtalkApi.ApiConversation): MockConversation {
  let preview: MockConversation['last_message_preview'] = null;
  if (c.last_message_preview) {
    const lp = c.last_message_preview;
    const localizedName = lp.sender_name_localized?.[i18n.language] || lp.sender_name || null;
    preview = {
      content: lp.content,
      sender_id: lp.sender_id,
      sender_name: localizedName,
      is_ai: lp.is_ai,
    };
  }
  return {
    id: c.id,
    project_id: c.project_id || 0,
    channel_type: c.channel_type,
    name: c.display_name || c.title || i18n.t('qtalk:fallback.noName', { defaultValue: '(이름 없음)' }),
    auto_extract_enabled: c.auto_extract_enabled,
    unread_count: c.unread_count || 0,
    last_extracted_message_id: c.last_extracted_message_id,
    last_message_at: c.last_message_at || c.created_at || null,
    last_message_preview: preview,
    my_pinned_at: c.my_pinned_at || null,
    my_last_read_at: c.my_last_read_at || null,
  };
}

function apiMessageToMock(m: qtalkApi.ApiMessage): MockMessage {
  // Cue AI 메시지 + draft 미승인 → cue_draft 카드 표시
  const isDraft = m.is_ai && m.ai_draft_approved === null;
  const isRejectedDraft = m.is_ai && m.ai_draft_approved === false;

  // 다국어 이름 — viewer 의 i18n 언어 기준 (사이클 F)
  const senderObj = m.sender as ({ name?: string; name_localized?: Record<string,string> | null } | undefined);
  const senderDisplay = senderObj
    ? (senderObj.name_localized?.[i18n.language] || senderObj.name || `user ${m.sender_id}`)
    : `user ${m.sender_id}`;

  return {
    id: m.id,
    conversation_id: m.conversation_id,
    sender_id: m.sender_id,
    sender_name: senderDisplay,
    sender_role: m.is_ai ? 'cue' : 'member',
    sender_color: m.is_ai ? '#F43F5E' : '#64748B',
    body: isRejectedDraft ? '' : m.content,  // 거절된 draft는 빈 body
    created_at: m.created_at,
    reply_to_message_id: m.reply_to_message_id,
    is_question: !m.is_ai && m.content.trim().endsWith('?'),
    cue_draft: isDraft ? {
      body: m.content,
      confidence: m.ai_confidence || 0,
      source: m.ai_source ? { title: m.ai_source, section: '' } : undefined,
      processing_by: null,
    } : undefined,
    attachments: (m.attachments || []).map(a => ({
    reactions: m.reactions || [],   // #138
      id: a.id,
      file_name: a.file_name,
      file_size: a.file_size,
      mime_type: a.mime_type,
    })),
    card: (() => {
      if (m.kind !== 'card' || !m.meta) return null;
      const ct = (m.meta as { card_type?: string }).card_type;
      if (ct === 'post') return m.meta as unknown as import('./types').PostCardMeta;
      if (ct === 'signature_request') return m.meta as unknown as import('./types').SignatureCardMeta;
      if (ct === 'invoice') return m.meta as unknown as import('./types').InvoiceCardMeta;
      if (ct === 'task') return m.meta as unknown as import('./types').TaskCardMeta;
      if (ct === 'file') return m.meta as unknown as import('./types').FileCardMeta;
      if (ct === 'kb_document') return m.meta as unknown as import('./types').KbDocCardMeta;
      if (ct === 'calendar_event') return m.meta as unknown as import('./types').CalendarEventCardMeta;
      return null;
    })(),
    translations: m.translations ?? null,
    detected_language: m.detected_language ?? null,
    read_by_count: typeof m.read_by_count === 'number' ? m.read_by_count : undefined,
    other_count: typeof m.other_count === 'number' ? m.other_count : undefined,
    is_edited: !!m.is_edited,
    is_deleted: !!m.is_deleted,
    edited_at: m.edited_at || null,
    pinned_at: m.pinned_at || null,
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
    created_at: n.created_at,
  };
}

function apiIssueToMock(i: qtalkApi.ApiIssue): MockIssue {
  return {
    id: i.id,
    project_id: i.project_id,
    conversation_id: i.conversation_id ?? null,
    body: i.body,
    author_name: i.author?.name || `user ${i.author_user_id}`,
    created_at: i.created_at,
    updated_at: i.updated_at,
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

// N+93 (#9) — embedded 모드: RightDock 드로어 / 팝아웃 창에서 재사용.
//   URL 싱크 효과를 끄고(호스트 페이지 URL 보존 + /talk 로 navigate 안 함), 초기 대화는 prop 으로 받는다.
//   기본 우측 패널 접힘(좁은 폭에서 대화목록+채팅 우선). 일반 /talk 페이지는 prop 없이 동작 무변경.
interface QTalkPageProps {
  embedded?: boolean;
  initialConvId?: number | null;
  initialProjectId?: number | null;
}

const QTalkPage: React.FC<QTalkPageProps> = ({ embedded = false, initialConvId = null, initialProjectId = null }) => {
  const { t } = useTranslation('qtalk');
  const { t: tErr } = useTranslation('errors');
  const { user } = useAuth();
  const businessId = user?.business_id || null;

  // 캐시 즉시 hydrate — 재진입 시 spinner 없이 좌측 리스트 즉시 표시.
  // businessId 바뀌면 useEffect 에서 다시 hydrate (워크스페이스 전환).
  const initialCache = businessId ? loadQtalkCache(Number(businessId)) : null;
  const [projects, setProjects] = useState<MockProject[]>(initialCache?.projects || []);
  const [conversations, setConversations] = useState<MockConversation[]>(initialCache?.conversations || []);
  const [messages, setMessages] = useState<Record<number, MockMessage[]>>({});
  // 히스토리 로드 완료 여부 — '메시지 배열 존재'와 분리 추적. socket message:new 가 미로드 대화에
  // 1건짜리 배열을 만들어도(=배열은 존재하나 히스토리는 미로드) 전체 히스토리 로드를 막지 않도록 하는 안전핀.
  const [historyLoaded, setHistoryLoaded] = useState<Record<number, boolean>>({});
  const [tasks, setTasks] = useState<MockTask[]>([]);
  const [notes, setNotes] = useState<MockNote[]>([]);
  const [issues, setIssues] = useState<MockIssue[]>([]);
  const [candidates, setCandidates] = useState<MockTaskCandidate[]>([]);
  // N+36 옵션 D — "이전 후보 보기" 토글. default false (30일 이전 hidden 후보 숨김).
  const [showHiddenCandidates, setShowHiddenCandidates] = useState(false);
  // 채팅방 관리 ⋮ — ConfirmDialog 트리거. archive(보관) / unlink(프로젝트 분리).
  const [archiveConv, setArchiveConv] = useState<MockConversation | null>(null);
  const [unlinkConv, setUnlinkConv] = useState<MockConversation | null>(null);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [unlinkBusy, setUnlinkBusy] = useState(false);
  const [archivedModalOpen, setArchivedModalOpen] = useState(false);
  // 권한 — workspace owner / admin / platform admin 만 ⋮ 메뉴 노출 (사이클 N+22: admin role 포함).
  // 멤버(member)는 채팅방 보관/분리 권한 없음 — 의도된 차단. PERMISSION_MATRIX §5.3.
  // (project owner 인 member 는 backend 가 허용하지만 UI 진입점은 단순화 — 다음 fix 에서 정교화)
  const canManageConversation = useCallback((_c: MockConversation) => {
    return user?.business_role === 'owner' || user?.business_role === 'admin' || user?.platform_role === 'platform_admin';
  }, [user?.business_role, user?.platform_role]);
  // 보관함 진입점 — owner/admin/platform_admin. canManageConversation 과 같은 정책.
  const canViewArchive = user?.business_role === 'owner' || user?.business_role === 'admin' || user?.platform_role === 'platform_admin';

  const location = useLocation();
  const navigate = useNavigate();
  const { conversationId: pathConvId } = useParams<{ conversationId?: string }>();
  // URL: /talk/:conversationId 패스 파라미터 또는 ?project=:pid&conv=:cid 쿼리.
  // 패스 파라미터가 우선 — 다른 화면에서 navigate('/talk/123') 으로 진입하는 케이스.
  const initialParams = new URLSearchParams(location.search);
  // embedded 모드는 호스트 URL 을 읽지 않고 prop 으로 초기 컨텍스트 결정.
  const initialProject = embedded ? initialProjectId : (Number(initialParams.get('project')) || null);
  const initialConv = embedded ? initialConvId : (Number(pathConvId) || Number(initialParams.get('conv')) || null);
  // 인박스 candidate 클릭 진입 시 ?candidate=Y — 우측 candidate 섹션 강조용
  const initialCandidateId = Number(initialParams.get('candidate')) || null;
  const [activeProjectId, setActiveProjectId] = useState<number | null>(initialProject);
  const [activeConversationId, setActiveConversationId] = useState<number | null>(initialConv);
  const [highlightCandidateId, setHighlightCandidateId] = useState<number | null>(initialCandidateId);
  // 진입 시 candidate 강조는 5초 후 자동 해제
  useEffect(() => {
    if (highlightCandidateId == null) return;
    const tm = window.setTimeout(() => setHighlightCandidateId(null), 5000);
    return () => window.clearTimeout(tm);
  }, [highlightCandidateId]);

  // 선택 상태 → URL 싱크. 항상 /talk 베이스로 정규화 (path-param 진입은 1회만 의미 있음).
  // embedded(드로어·팝아웃)에서는 navigate 금지 — 호스트 페이지 URL 보존 + /talk-popout 이 /talk 로 튕기는 회귀 차단.
  useEffect(() => {
    if (embedded) return;
    const sp = new URLSearchParams();
    if (activeProjectId) sp.set('project', String(activeProjectId));
    if (activeConversationId) sp.set('conv', String(activeConversationId));
    const qs = sp.toString();
    const next = qs ? `/talk?${qs}` : '/talk';
    if (next !== `${location.pathname}${location.search}`) {
      navigate(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProjectId, activeConversationId]);

  // URL 의 conv/project 가 외부 변경 시 (글로벌 검색·인박스 등에서 navigate) 동기화
  useEffect(() => {
    if (embedded) return;
    const sp = new URLSearchParams(location.search);
    const c = Number(sp.get('conv')) || null;
    const p = Number(sp.get('project')) || null;
    if (c !== activeConversationId) setActiveConversationId(c);
    if (p !== activeProjectId) setActiveProjectId(p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  // 캐시 있으면 loading=false (즉시 표시). 캐시 없으면 loading=true → LeftPanel 이 skeleton 렌더.
  // 풀스크린 spinner 게이트는 제거 (사이클 N+15-A): 위치 점프 0 + skeleton 으로 인지 즉시성 확보.
  const [loading, setLoading] = useState(!initialCache);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [leftCollapsed, setLeftCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(STORAGE_LEFT) === '1'; } catch { return false; }
  });
  const [rightCollapsed, setRightCollapsed] = useState<boolean>(() => {
    if (embedded) return true; // 좁은 드로어/팝아웃 — 우측 패널 기본 접힘(대화목록+채팅 우선, 토글로 펼침)
    try { return localStorage.getItem(STORAGE_RIGHT) === '1'; } catch { return false; }
  });
  // 우측 패널 리사이즈 (Q Task/Q Mail 통일) — localStorage 저장 · clamp 280~560
  const [rightWidth, setRightWidth] = useState<number>(() => {
    try { const v = localStorage.getItem('qtalk_right_width'); return v ? Math.max(280, Math.min(560, Number(v))) : 320; } catch { return 320; }
  });
  const rightResizingRef = useRef(false);
  const startRightResize = (e: React.MouseEvent) => {
    e.preventDefault(); rightResizingRef.current = true;
    document.body.style.userSelect = 'none'; document.body.style.cursor = 'col-resize';
  };
  useEffect(() => {
    const onMove = (e: MouseEvent) => { if (rightResizingRef.current) setRightWidth(Math.max(280, Math.min(560, window.innerWidth - e.clientX))); };
    const onUp = () => { if (rightResizingRef.current) { rightResizingRef.current = false; try { localStorage.setItem('qtalk_right_width', String(rightWidth)); } catch { /* quota */ } document.body.style.userSelect = ''; document.body.style.cursor = ''; } };
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [rightWidth]);
  // 키보드 단축키: ⌘/ (mac) · Ctrl+\ (win) → 우측 패널 토글 (Q Task/Q Mail 통일)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey; if (!mod) return;
      if (e.key === '/' || e.key === '\\') { e.preventDefault(); setRightCollapsed((v) => { const next = !v; try { localStorage.setItem(STORAGE_RIGHT, next ? '1' : '0'); } catch { /* quota */ } return next; }); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const [modalOpen, setModalOpen] = useState(false);
  const [chatModalOpen, setChatModalOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // raw API 응답 캐시 — translation_* 같은 필드는 mock 에 안 들어가서 모달 등에서 필요
  const [convsRaw, setConvsRaw] = useState<Record<number, qtalkApi.ApiConversation>>({});
  const [notice, setNotice] = useState<string | null>(null);

  const showNotice = useCallback((msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice(null), 3500);
  }, []);

  // ── Socket.IO 실시간 ──
  // socket handler closure 안에서 stale 안 되도록 ref mirror
  const activeConversationIdRef = useRef<number | null>(null);
  useEffect(() => { activeConversationIdRef.current = activeConversationId; }, [activeConversationId]);
  const activeProjectIdRef = useRef<number | null>(null);
  useEffect(() => { activeProjectIdRef.current = activeProjectId; }, [activeProjectId]);

  useEffect(() => {
    if (!user) return; // 로그인 후에만 연결

    // 공유 소켓 (services/socket). business room join → 활성 conv 아닌 다른 conv 메시지도
    // 리스트 unread 실시간 갱신 (backend 가 conv:${id} + business:${bizId} 둘 다 emit).
    // connect/재연결 시 활성 room 재join 은 공유 소켓이 roomRefs 로 자동 처리.
    if (businessId) joinRoom(`business:${businessId}`);
    const offs: Array<() => void> = [];
    const on = <T,>(evt: string, cb: (data: T) => void) => { offs.push(onSocket(evt, cb)); };

    // #138 — 리액션 실시간 (다른 사람이 누른 것도 즉시 보임). 서버가 conv/business room 양쪽으로 emit.
    on('message:reaction', (p: { message_id: number; conversation_id: number; reactions: { emoji: string; count: number; users: { id: number }[] }[] }) => {
      setMessages((prev) => {
        const arr = prev[p.conversation_id];
        if (!arr) return prev;
        // 서버는 이모지별 집계로 보낸다 → 화면이 쓰는 원시 형태(user_id + emoji)로 되돌린다
        const flat = p.reactions.flatMap((g) => g.users.map((u, i) => ({ id: -(i + 1), user_id: u.id, emoji: g.emoji })));
        return {
          ...prev,
          [p.conversation_id]: arr.map((m) => (m.id === p.message_id ? { ...m, reactions: flat } : m)),
        };
      });
    });

    // 메시지 수신
    on('message:new', (msg: qtalkApi.ApiMessage) => {
      const mapped = apiMessageToMock(msg);
      setMessages((prev) => {
        const arr = prev[mapped.conversation_id] || [];
        // 중복 방지 (자기가 보낸 메시지는 이미 추가됨)
        if (arr.some((m) => m.id === mapped.id)) return prev;
        return { ...prev, [mapped.conversation_id]: [...arr, mapped] };
      });
      // 대화 리스트 갱신 — last_message_at 끌어올리고 unread_count 증가 (조건부)
      // - 자기가 보낸 메시지는 unread 증가 X
      // - 현재 보고 있는 활성 대화방이면 unread 증가 X (이미 보고 있는 것)
      const isMine = String(mapped.sender_id) === String(user?.id);
      const isActive = activeConversationIdRef.current === mapped.conversation_id;
      // ★ '읽음'은 실제로 창을 보고 있을 때만 — 활성 대화여도 앱이 백그라운드(또는 화면 꺼짐)면
      //   읽지 않은 것으로 취급 (사용자 호소: 앱만 열어두고 채팅창 안 봤는데 읽음 처리됨).
      const viewing = isActive && (typeof document === 'undefined' || document.visibilityState === 'visible');
      setConversations((prev) => prev.map((c) => {
        if (c.id !== mapped.conversation_id) return c;
        const incrementUnread = !isMine && !viewing;
        // 사이클 N+15-D — 실시간 last_message_preview 갱신. 채팅 리스트의 한 줄도 즉시 따라옴.
        const previewContent = (mapped.body || '').trim()
          || (mapped.card ? t('preview.card', '[카드]') : (mapped.attachments && mapped.attachments.length > 0 ? t('preview.attachments', { defaultValue: '[첨부 {{count}}개]', count: mapped.attachments.length }) : ''));
        return {
          ...c,
          last_message_at: mapped.created_at,
          unread_count: incrementUnread ? (c.unread_count || 0) + 1 : c.unread_count,
          last_message_preview: previewContent ? {
            content: previewContent.length > 200 ? previewContent.slice(0, 200) : previewContent,
            sender_id: mapped.sender_id,
            sender_name: mapped.sender_name || null,
            is_ai: mapped.sender_role === 'cue',
          } : c.last_message_preview,
        };
      }));
      // 사이드바 토탈 unread 갱신 트리거 — 보고 있지 않으면(비활성 or 백그라운드) 미읽음 반영
      if (!isMine && !viewing) {
        window.dispatchEvent(new Event('planq:unread-changed'));
      }
      // 활성 conv 도착분 → 백엔드 last_read_at 즉시 갱신 (단, '실제로 보고 있을 때만')
      if (!isMine && viewing && businessId) {
        qtalkApi.markConversationRead(businessId, mapped.conversation_id).catch(() => null);
      }
    });

    // 후보 생성 — POST 응답과 socket broadcast 가 둘 다 들어오므로 id 기준 dedup 필수
    on('candidates:created', (data: { project_id: number; candidates: qtalkApi.ApiTaskCandidate[] }) => {
      const mapped = data.candidates.map(apiCandidateToMock);
      setCandidates((prev) => {
        const existing = new Set(prev.map((c) => c.id));
        const fresh = mapped.filter((c) => !existing.has(c.id));
        return fresh.length === 0 ? prev : [...fresh, ...prev];
      });
    });

    // 이슈 생성
    on('issue:new', (issue: qtalkApi.ApiIssue) => {
      const mapped = apiIssueToMock(issue);
      setIssues((prev) => {
        if (prev.some((i) => i.id === mapped.id)) return prev;
        return [mapped, ...prev];
      });
    });

    // 메시지 업데이트 (Draft 승인/거절 + 사이클 N+16-E 수정)
    on('message:updated', (msg: qtalkApi.ApiMessage) => {
      const mapped = apiMessageToMock(msg);
      setMessages((prev) => {
        const arr = prev[mapped.conversation_id] || [];
        return { ...prev, [mapped.conversation_id]: arr.map((m) => (m.id === mapped.id ? mapped : m)) };
      });
    });

    // 사이클 N+16-E — 메시지 삭제 (soft) / 핀 / 언핀 실시간.
    on('message:deleted', (data: { id: number; conversation_id: number }) => {
      setMessages((prev) => {
        const arr = prev[data.conversation_id];
        if (!arr) return prev;
        return { ...prev, [data.conversation_id]: arr.map((m) => m.id === data.id ? { ...m, is_deleted: true } : m) };
      });
    });
    on('message:pinned', (data: { id: number; conversation_id: number; pinned_at: string }) => {
      setMessages((prev) => {
        const arr = prev[data.conversation_id];
        if (!arr) return prev;
        return { ...prev, [data.conversation_id]: arr.map((m) => m.id === data.id ? { ...m, pinned_at: data.pinned_at } : m) };
      });
    });
    on('message:unpinned', (data: { id: number; conversation_id: number }) => {
      setMessages((prev) => {
        const arr = prev[data.conversation_id];
        if (!arr) return prev;
        return { ...prev, [data.conversation_id]: arr.map((m) => m.id === data.id ? { ...m, pinned_at: null } : m) };
      });
    });

    // 메시지 첨부 추가 (메시지 생성 직후 link-existing / 업로드 직후 emit)
    //   message:new 가 첨부 비어있는 상태로 먼저 도착하므로, 이 이벤트로 attachments 배열에 append.
    on('message:attachment', (data: { message_id: number; attachment: { id: number; file_name: string; file_size: number; mime_type?: string | null; file_id?: number } }) => {
      setMessages((prev) => {
        const next: typeof prev = {};
        let touched = false;
        for (const [convId, list] of Object.entries(prev)) {
          const idx = list.findIndex((m) => m.id === data.message_id);
          if (idx < 0) { next[Number(convId)] = list; continue; }
          touched = true;
          const target = list[idx];
          const existing = target.attachments || [];
          // 중복 방지 (같은 attachment id)
          if (existing.some((a) => a.id === data.attachment.id)) {
            next[Number(convId)] = list;
            continue;
          }
          const newAtt = {
            id: data.attachment.id,
            file_name: data.attachment.file_name,
            file_size: data.attachment.file_size,
            mime_type: data.attachment.mime_type ?? null,
          };
          const updatedMsg = { ...target, attachments: [...existing, newAtt] };
          next[Number(convId)] = list.map((m, i) => (i === idx ? updatedMsg : m));
        }
        return touched ? next : prev;
      });
    });

    // 사이클 N+15-C — 다른 참여자가 대화방을 읽음 → 내 메시지의 read_by_count 실시간 갱신.
    // 같은 conv room 의 모든 socket 으로 broadcast 됨 (자기 자신 포함될 수 있어 sender_id 분기).
    on('conversation:read', (data: { conversation_id: number; user_id: number; last_read_at: string }) => {
      const readerMs = new Date(data.last_read_at).getTime();
      setMessages((prev) => {
        const arr = prev[data.conversation_id];
        if (!arr) return prev;
        let touched = false;
        const next = arr.map((m) => {
          // reader 가 sender 본인이면 skip (자기 메시지 자기가 읽은 건 카운트 X)
          if (m.sender_id === data.user_id) return m;
          // 이 메시지 created_at 이 reader 의 last_read_at 이하면 읽힘 인정.
          // read_by_count 가 other_count 이상이면 더 늘리지 않음.
          if (new Date(m.created_at).getTime() > readerMs) return m;
          const cur = m.read_by_count ?? 0;
          const cap = m.other_count ?? Infinity;
          if (cur >= cap) return m;
          touched = true;
          return { ...m, read_by_count: cur + 1 };
        });
        return touched ? { ...prev, [data.conversation_id]: next } : prev;
      });
    });

    // 메시지 번역 완료 (비동기 LLM 결과 — 메시지 자체는 이미 발송됨)
    on('message:translated', (data: { id: number; conversation_id: number; translations: Record<string, string>; detected_language: string }) => {
      setMessages((prev) => {
        const arr = prev[data.conversation_id] || [];
        return { ...prev, [data.conversation_id]: arr.map((m) =>
          m.id === data.id
            ? { ...m, translations: data.translations as MockMessage['translations'], detected_language: data.detected_language as MockMessage['detected_language'] }
            : m
        ) };
      });
    });

    // 다중 디바이스 동기화 — 같은 user 의 다른 디바이스에서 핀 토글 시 즉시 반영
    on('conversation:pin', (data: { conversation_id: number; pinned_at: string | null }) => {
      setConversations(prev => prev.map(c =>
        c.id === data.conversation_id ? { ...c, my_pinned_at: data.pinned_at } : c
      ));
    });

    // 메모 생성
    on('note:new', (note: qtalkApi.ApiNote) => {
      const mapped = apiNoteToMock(note);
      setNotes((prev) => {
        if (prev.some((n) => n.id === mapped.id)) return prev;
        return [mapped, ...prev];
      });
    });

    return () => {
      if (businessId) leaveRoom(`business:${businessId}`);
      offs.forEach((f) => f());
    };
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // 대화방 변경 시 room join/leave + 읽음 처리
  useEffect(() => {
    if (!activeConversationId) return;
    joinRoom(`conversation:${activeConversationId}`);
    return () => { leaveRoom(`conversation:${activeConversationId}`); };
  }, [activeConversationId]);

  // 사이클 N+24 — 채팅 실시간 회복 가드:
  //   visibilitychange / focus / online 시 socket.connected 검사 → 끊어졌으면 강제 connect +
  //   active conv 재join. PWA standalone 모드에서 background → foreground 복귀 시 socket 끊김 회귀
  //   ("알림은 오는데 채팅창 새 메시지 안 올라옴") 차단.
  useEffect(() => {
    const tryRecover = () => {
      // 공유 소켓 재연결 — connect 시 활성 room(business/conversation/project) 자동 재join(roomRefs).
      const s = getSocket();
      if (s && !s.connected) {
        try { s.connect(); } catch { /* noop */ }
      }
    };
    const onVisible = () => { if (document.visibilityState === 'visible') tryRecover(); };
    window.addEventListener('focus', tryRecover);
    window.addEventListener('online', tryRecover);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', tryRecover);
      window.removeEventListener('online', tryRecover);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // 대화방 진입 시 읽음 처리 — 백엔드 last_read_at = NOW() + 로컬 unread_count 0
  // active 인 동안 새 메시지가 와도 socket handler 가 unread 증가를 막아주므로 진입 시 1 회면 충분.
  // 사이클 N+15-D: await markRead → dispatch 순서 강제. 그래야 useUnreadTotal 의 refresh API 가
  // 이미 last_read_at 갱신된 DB 를 읽음. 옛 fire-and-forget 패턴은 race 로 사이드바 숫자 stale.
  useEffect(() => {
    if (!activeConversationId || !user?.id || !businessId) return;
    let cancelled = false;

    const doMarkRead = () => {
      // 사이클 N+15-D — 채팅 리스트 + 사이드바 동시 차감 (같은 frame).
      let prevUnread = 0;
      setConversations(prev => prev.map(c => {
        if (c.id === activeConversationId) { prevUnread = c.unread_count || 0; return { ...c, unread_count: 0 }; }
        return c;
      }));
      if (prevUnread > 0) {
        window.dispatchEvent(new CustomEvent('planq:unread-changed', { detail: { optimisticDelta: -prevUnread } }));
      }
      (async () => {
        try { await qtalkApi.markConversationRead(businessId, activeConversationId); } catch { /* silent */ }
        if (cancelled) return;
        window.dispatchEvent(new Event('planq:unread-changed'));
      })();
    };

    // ★ '실제로 보고 있을 때만' 읽음 처리. 앱을 열어둔 채(백그라운드) 또는 URL 로 대화가 자동 복원만 된
    //   경우엔 읽음 처리하지 않고 미읽음 유지 → foreground 로 돌아와 실제로 볼 때(visible) 처리.
    //   (사용자 호소: 채팅창을 열지도 않았는데 읽음 처리되어 뱃지가 0)
    if (typeof document === 'undefined' || document.visibilityState === 'visible') {
      doMarkRead();
      return () => { cancelled = true; };
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible' && !cancelled) {
        document.removeEventListener('visibilitychange', onVisible);
        doMarkRead();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => { cancelled = true; document.removeEventListener('visibilitychange', onVisible); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConversationId, businessId]);

  // 모바일 PWA background → foreground 복귀 시 회복:
  //   1) socket 강제 재연결 — disconnect 사이 새 conv/message emit 미수신 가능
  //   2) 활성 대화 messages 직접 재로드 — invalidate 만 하면 useEffect deps 가 [activeConversationId]
  //      뿐이라 재실행 안 되어 빈 상태로 멈춤 (회귀 fix)
  //   3) 대화 목록 merge refresh — 새로 생성된 conv 누락 보정
  useVisibilityRefresh(useCallback(() => {
    const s = getSocket();
    if (s && !s.connected) s.connect();
    if (activeConversationId) {
      qtalkApi.listConversationMessages(activeConversationId).then(msgs => {
        setMessages(prev => ({ ...prev, [activeConversationId]: msgs.map(apiMessageToMock) }));
        setHistoryLoaded(prev => ({ ...prev, [activeConversationId]: true }));
      }).catch(() => null);
    }
    if (businessId) {
      qtalkApi.listBusinessConversations(businessId).then(apiConvs => {
        const all = apiConvs.map(apiConversationToMock);
        // server fresh data 가 client state 를 덮어쓰는 게 default — background 동안 다른 conv 에
        // 도착한 메시지의 unread_count / last_message_at 이 client 에 반영 안 되던 회귀 fix.
        // 신규만 merge 하면 stale. 단 client-only state (선택 상태 등) 는 별도 ref 로 유지.
        // 박제: feedback_visibility_refresh_server_fresh.md
        setConversations(all);
      }).catch(() => null);
      // 사이드바 토탈 unread 도 같이 갱신
      window.dispatchEvent(new Event('planq:unread-changed'));
    }
  }, [activeConversationId, businessId]));

  // 대화 선택 시 메시지 lazy-load — 프로젝트 단위 초기 로드에 포함되지 않은 독립 대화도
  // 활성화되는 순간 메시지를 불러온다. 이미 캐시된 대화는 skip.
  // 일시적 네트워크 에러로 "히스토리가 다 날아가 보이는" 케이스 방지를 위해 1회 자동 재시도 (1.5s 후).
  // 그래도 실패면 messages[id] 를 undefined 로 두어 사용자가 conv 재클릭 시 재시도되게 함.
  useEffect(() => {
    if (!activeConversationId) return;
    // ★ '메시지 배열 존재'가 아니라 '히스토리 로드 완료' 로 판정 — socket 으로 1건만 들어와 배열이
    //   생긴 경우에도 전체 히스토리를 반드시 로드 (운영 회귀: 초기 로드 실패 + 라이브 메시지 1건 →
    //   히스토리 영영 미로드로 "과거 채팅 사라짐").
    if (historyLoaded[activeConversationId]) return;
    let cancelled = false;
    let retryTimer: number | null = null;
    const load = async (attempt: number) => {
      try {
        const msgs = await qtalkApi.listConversationMessages(activeConversationId);
        if (cancelled) return;
        const loaded = msgs.map(apiMessageToMock);
        const loadedIds = new Set(loaded.map((m) => m.id));
        setMessages((prev) => {
          // server fresh(최신 페이지) + 쿼리~응답 사이 socket 으로 먼저 들어온 더 최신 메시지 머지(유실 방지)
          const existing = prev[activeConversationId] || [];
          const extra = existing.filter((m) => !loadedIds.has(m.id));
          const merged = extra.length ? [...loaded, ...extra].sort((a, b) => a.id - b.id) : loaded;
          return { ...prev, [activeConversationId]: merged };
        });
        setHistoryLoaded((prev) => ({ ...prev, [activeConversationId]: true }));
      } catch (err) {
        if (cancelled) return;
        if (attempt === 0) {
          retryTimer = window.setTimeout(() => { if (!cancelled) load(1); }, 1500);
        } else {
          // 두 번째도 실패 — 에러 로깅만, messages[id] 는 undefined 유지 → 사용자가 재클릭 시 재시도.
          console.error('[qtalk] 메시지 로드 2회 실패:', err);
        }
      }
    };
    load(0);
    return () => {
      cancelled = true;
      if (retryTimer) window.clearTimeout(retryTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConversationId]);

  // 과거 메시지 무한 로드 — 위로 스크롤 시 ChatPanel 이 onLoadOlder 호출.
  //   대화별 hasMore/loading 추적. oldest 메시지 id 기준 이전 50개 prepend.
  const [olderState, setOlderState] = useState<Record<number, { hasMore: boolean; loading: boolean }>>({});
  const loadOlderMessages = useCallback(async () => {
    const convId = activeConversationIdRef.current;
    if (!convId) return;
    const cur = messages[convId] || [];
    if (cur.length === 0) return;
    setOlderState((p) => {
      const st = p[convId];
      if (st && (st.loading || !st.hasMore)) return p; // 이미 로딩 중/더 없음
      return { ...p, [convId]: { hasMore: st?.hasMore ?? true, loading: true } };
    });
    const oldestId = cur[0].id;
    try {
      const { messages: older, hasMore } = await qtalkApi.loadOlderMessages(convId, oldestId);
      setMessages((prev) => {
        const existing = prev[convId] || [];
        const existIds = new Set(existing.map((m) => m.id));
        const fresh = older.map(apiMessageToMock).filter((m) => !existIds.has(m.id));
        if (fresh.length === 0) return prev;
        return { ...prev, [convId]: [...fresh, ...existing] };
      });
      setOlderState((p) => ({ ...p, [convId]: { hasMore, loading: false } }));
    } catch {
      setOlderState((p) => ({ ...p, [convId]: { hasMore: p[convId]?.hasMore ?? true, loading: false } }));
    }
  }, [messages]);

  // 활성 대화 older 상태 — 초기값: 첫 로드가 50개 꽉 차면 더 있을 가능성(첫 onLoadOlder 가 정확히 확정).
  const activeMsgCount = activeConversationId ? (messages[activeConversationId]?.length || 0) : 0;
  const activeOlder = activeConversationId ? olderState[activeConversationId] : undefined;
  const hasMoreOlder = activeOlder ? activeOlder.hasMore : activeMsgCount >= 50;
  const loadingOlder = !!activeOlder?.loading;

  // 프로젝트 변경 시 room join/leave — 독립 대화(-1/null)는 스킵
  useEffect(() => {
    if (!activeProjectId || activeProjectId <= 0) return;
    joinRoom(`project:${activeProjectId}`);
    return () => { leaveRoom(`project:${activeProjectId}`); };
  }, [activeProjectId]);

  // ── path-param 진입 시 conv 의 project_id 자동 매핑 ──
  // /talk/:convId 로 진입하면 activeConversationId 만 세팅된 상태.
  // listBusinessConversations 가 끝나 conversations 가 채워지면 그 conv 의 project_id 를 찾아 activeProjectId 도 세팅.
  useEffect(() => {
    if (!activeConversationId) return;
    if (activeProjectId) return;
    const conv = conversations.find(c => c.id === activeConversationId);
    if (conv && conv.project_id) {
      setActiveProjectId(conv.project_id);
    }
  }, [activeConversationId, activeProjectId, conversations]);

  // ── 초기 로드: 프로젝트 + 대화 병렬 fetch + 캐시 저장 ──
  // 사이클 N+15-A: listProjects + listBusinessConversations 직렬 → 병렬. 게이트 spinner 없이
  // 캐시(있으면) 즉시 표시 → 백그라운드 fresh fetch → 도착하면 덮어쓰기 + 캐시 갱신.
  useEffect(() => {
    if (!businessId) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      try {
        setLoadError(null);
        const bid = Number(businessId);
        const [projList, convList] = await Promise.all([
          qtalkApi.listProjects(businessId),
          qtalkApi.listBusinessConversations(businessId).catch(() => [] as qtalkApi.ApiConversation[]),
        ]);
        if (cancelled) return;

        const mappedProjects = projList.map(apiProjectToMock);
        const mappedConvs = convList.map(apiConversationToMock);
        setProjects(mappedProjects);
        setConversations(mappedConvs);
        setConvsRaw(prev => {
          const next = { ...prev };
          for (const c of convList) next[c.id] = c;
          return next;
        });
        saveQtalkCache(bid, mappedProjects, mappedConvs);

        if (mappedProjects.length > 0) {
          const params = new URLSearchParams(window.location.search);
          const qpid = Number(params.get('project'));
          if (qpid && mappedProjects.some((p) => p.id === qpid)) {
            setActiveProjectId((prev) => prev ?? qpid);
          }
        }
      } catch (err: unknown) {
        if (cancelled) return;
        setLoadError(mapApiError(err, tErr));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [businessId]);

  // 워크스페이스 전환 시 캐시 재 hydrate — 옛 워크스페이스 state 가 잠시 보이는 회귀 차단
  useEffect(() => {
    if (!businessId) return;
    const cached = loadQtalkCache(Number(businessId));
    if (cached) {
      setProjects(cached.projects);
      setConversations(cached.conversations);
      setLoading(false);
    } else {
      setProjects([]);
      setConversations([]);
      setLoading(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          qtalkApi.listProjectCandidates(activeProjectId, showHiddenCandidates).catch(() => [] as qtalkApi.ApiTaskCandidate[]),
        ]);
        if (cancelled) return;

        const mappedConvs = convList.map(apiConversationToMock);
        setConversations((prev) => {
          // 다른 프로젝트 대화는 유지
          const others = prev.filter((c) => c.project_id !== activeProjectId);
          return [...others, ...mappedConvs];
        });
        // raw 응답도 캐시 (ChatSettingsModal 의 translation_* prefill 용)
        setConvsRaw((prev) => {
          const next = { ...prev };
          for (const c of convList) next[c.id] = c;
          return next;
        });

        // 활성 대화 자동 선택 (customer 채널 우선)
        if (!cancelled && mappedConvs.length > 0) {
          const current = mappedConvs.find((c) => c.id === activeConversationId);
          if (!current) {
            const customer = mappedConvs.find((c) => c.channel_type === 'customer');
            setActiveConversationId(customer?.id ?? mappedConvs[0].id);
          }
        }

        // 사이클 N+15-A — 메시지는 활성 채널 우선, 나머지는 백그라운드 채움.
        // 옛 Promise.all 동기 게이트는 사용자가 활성 대화 메시지를 보기까지 모든 채널 응답을 기다리게
        // 만들어 초기 로드를 N x roundtrip 까지 늘렸음. 활성 conv lazy-load effect (line 495+) 가
        // 이미 즉시 fetch 하므로 여기선 백그라운드 prefetch 만 — 채널 전환 시 즉시성 유지.
        const targetActiveId = (() => {
          const current = mappedConvs.find((c) => c.id === activeConversationId);
          if (current) return current.id;
          const customer = mappedConvs.find((c) => c.channel_type === 'customer');
          return customer?.id ?? mappedConvs[0]?.id;
        })();
        for (const c of mappedConvs) {
          if (c.id === targetActiveId) continue; // active 는 별도 effect 가 처리
          // 히스토리 로드 완료된 대화는 skip — 다시 fetch 하지 않음 (1건 socket 배열만 있는 건 로드 필요)
          if (historyLoaded[c.id]) continue;
          (async () => {
            try {
              const msgs = await qtalkApi.listConversationMessages(c.id);
              if (cancelled) return;
              const loaded = msgs.map(apiMessageToMock);
              const loadedIds = new Set(loaded.map((m) => m.id));
              setMessages((prev) => {
                const existing = prev[c.id] || [];
                const extra = existing.filter((m) => !loadedIds.has(m.id));
                const merged = extra.length ? [...loaded, ...extra].sort((a, b) => a.id - b.id) : loaded;
                return { ...prev, [c.id]: merged };
              });
              setHistoryLoaded((prev) => ({ ...prev, [c.id]: true }));
            } catch { /* silent — 채널 전환 시 lazy-load 가 재시도 */ }
          })();
        }

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
          qtalkApi.listConvCandidates(activeConversationId, showHiddenCandidates).catch(() => [] as qtalkApi.ApiTaskCandidate[]),
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
  // 모바일 master-detail 드릴다운 — 대화 패널에서 리스트로 돌아가기
  const handleMobileBack = () => {
    setActiveConversationId(null);
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
        kind: data.kind,
        members: data.members.map((m) => ({ user_id: m.user_id, role: m.role, is_default: m.is_default })),
        clients: data.clients.map((c) => ({ name: c.name, email: c.email })),
        // #95 — 채널 토글 전달 (옛 버그: 누락돼 Q Talk 경로에서 토글 무시 + 항상 채널 0개). Q Project 경로와 일관.
        channels: data.channels,
      });
      const mapped = apiProjectToMock(created);
      setProjects((prev) => [mapped, ...prev]);
      setActiveProjectId(mapped.id);
      setActiveConversationId(null);
      setModalOpen(false);
      showNotice(t('page.projectCreated', { name: mapped.name }));
    } catch (err: unknown) {
      showNotice(t('page.createFailed', { msg: mapApiError(err, tErr) }));
    }
  };

  // ── 새 대화 생성 ──
  const handleCreateChat = async (data: NewChatFormData) => {
    if (!businessId) return;
    try {
      // "+ 새 프로젝트 만들기" 모드면 프로젝트 먼저 생성 후 그 id 로 채팅 생성.
      // 실패 시 채팅 생성 안 함 (파편 데이터 방지). 프로젝트는 best-effort 로 그대로 둠.
      let finalProjectId = data.project_id;
      if (data.new_project_name && data.new_project_name.trim()) {
        const r = await apiFetch('/api/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            business_id: businessId,
            name: data.new_project_name.trim(),
            project_type: 'ongoing',
            members: [],
            clients: [],
          }),
        });
        const j = await r.json();
        if (!j.success || !j.data?.id) {
          throw new Error(j.message || (t('page.projectCreateFailed', '프로젝트 생성 실패') as string));
        }
        finalProjectId = j.data.id;
        // 새로 만든 프로젝트를 좌측 리스트에 즉시 반영 (필드 부족분은 기본값 채움)
        setProjects((prev) => prev.some((p) => p.id === j.data.id) ? prev : [
          {
            id: j.data.id, name: j.data.name, business_id: businessId,
            client_company: '', status: 'active',
            default_assignee_id: null, members: [], clients: [],
            has_cue_activity: false, unread_count: 0,
          } as unknown as MockProject,
          ...prev,
        ]);
      }
      const conv = await qtalkApi.createConversation({
        business_id: businessId,
        title: data.title,
        project_id: finalProjectId,
        client_id: data.client_id,
        participant_user_ids: data.participant_user_ids,
        auto_extract_enabled: data.auto_extract_enabled,
        translation_enabled: data.translation_enabled,
        translation_languages: data.translation_languages,
      });
      const mapped = apiConversationToMock(conv);
      setConversations((prev) => [mapped, ...prev.filter((c) => c.id !== mapped.id)]);
      // raw 응답도 캐시 (설정 모달 prefill 용)
      setConvsRaw((prev) => ({ ...prev, [conv.id]: conv }));
      // 독립 대화(project_id null)는 activeProjectId 도 null 로 초기화해야 ChatPanel 이 standalone 브랜치로 렌더한다.
      setActiveProjectId(conv.project_id || null);
      setActiveConversationId(conv.id);
      setChatModalOpen(false);
      showNotice(t('page.chatCreated', { title: conv.title }));
    } catch (err: unknown) {
      showNotice(t('page.createFailed', { msg: mapApiError(err, tErr) }));
    }
  };

  const [extracting, setExtracting] = useState(false);

  // 청크 2: 메시지 전송 (사이클 O4 — existingFileIds 추가).
  // 사이클 N+15-E — Optimistic local insertion. 사용자 클릭 즉시 메시지 표시 (네트워크 RT 0ms 인상).
  // tempId(음수) → API 성공 시 real id 로 replace. 실패 시 표시는 유지 + 추후 재시도 UI 가능.
  const handleSendMessage = async (body: string, files?: File[], existingFileIds?: number[], existingPostIds?: number[]) => {
    if (!activeConversationId) return;
    const convId = activeConversationId; // 클로저 안정화
    const hasAttachments = (files && files.length > 0) || (existingFileIds && existingFileIds.length > 0);
    const hasPosts = existingPostIds && existingPostIds.length > 0;
    const content = body.trim();
    if (!content && !hasAttachments && !hasPosts) return;
    // 옵티미스틱: 사용자 본인 메시지를 즉시 화면에 (음수 tempId).
    const tempId = -Date.now();
    const optimisticMsg: MockMessage | null = (content || hasAttachments) ? {
      id: tempId,
      conversation_id: convId,
      sender_id: Number(user?.id || 0),
      sender_name: user?.name || '',
      sender_role: 'member' as const,
      sender_color: '#0D9488',
      body: content,
      created_at: new Date().toISOString(),
      is_question: content.endsWith('?'),
      attachments: [],
      translations: null,
      detected_language: null,
    } : null;
    if (optimisticMsg) {
      setMessages((prev) => ({ ...prev, [convId]: [...(prev[convId] || []), optimisticMsg] }));
      setConversations((prev) => prev.map((c) =>
        c.id === convId ? { ...c, last_message_at: optimisticMsg.created_at } : c
      ));
    }
    try {
      const created = (content || hasAttachments)
        ? await qtalkApi.sendMessage(convId, content)
        : { id: 0 } as Awaited<ReturnType<typeof qtalkApi.sendMessage>>;
      const attachmentResults: qtalkApi.ApiMessageAttachment[] = [];
      if (files && files.length > 0) {
        const uploads = await Promise.allSettled(
          files.map((f) => qtalkApi.uploadMessageAttachment(convId, created.id, f))
        );
        uploads.forEach((r) => { if (r.status === 'fulfilled') attachmentResults.push(r.value); });
      }
      if (existingFileIds && existingFileIds.length > 0) {
        const links = await Promise.allSettled(
          existingFileIds.map((id) => qtalkApi.linkExistingFileToMessage(convId, created.id, id))
        );
        links.forEach((r) => { if (r.status === 'fulfilled') attachmentResults.push(r.value); });
      }
      // post(문서) 첨부 — share-to-chat 으로 카드 메시지 별도 생성
      if (hasPosts) {
        const { sharePostToChat } = await import('../../services/posts');
        await Promise.allSettled(
          existingPostIds!.map((pid) => sharePostToChat(pid, { conversation_id: convId }))
        );
      }
      // 옵티미스틱 메시지를 real id 메시지로 교체. socket message:new 가 이미 추가했을 수도 있어 dedup.
      if (created.id) {
        const mapped = apiMessageToMock({ ...created, attachments: attachmentResults });
        setMessages((prev) => {
          const arr = prev[convId] || [];
          // optimistic tempId 제거 + real id 가 이미 있으면 그대로, 없으면 append
          const withoutTemp = arr.filter((m) => m.id !== tempId);
          if (withoutTemp.some((m) => m.id === mapped.id)) {
            return { ...prev, [convId]: withoutTemp };
          }
          return { ...prev, [convId]: [...withoutTemp, mapped] };
        });
        // 내가 보낸 메시지도 대화 리스트 상단으로 끌어올림
        setConversations((prev) => prev.map((c) =>
          c.id === convId ? { ...c, last_message_at: mapped.created_at } : c
        ));
      }
      // post 만 첨부했거나, post 도 같이 첨부했으면 fresh 로 카드 메시지 끌어옴
      if (hasPosts) {
        try {
          const fresh = await qtalkApi.listConversationMessages(convId);
          setMessages((prev) => ({ ...prev, [convId]: fresh.map(apiMessageToMock) }));
        } catch { /* skip */ }
      }
      // 번역 폴링 fallback — Socket.IO `message:translated` 이벤트가 안 도착해도
      // 4초 후 GET 으로 직접 갱신해 translations 보장. 옛 번들에서도 동작.
      const conv = conversations.find(c => c.id === convId);
      if (conv && (conv as MockConversation & { translation_enabled?: boolean }).id) {
        setTimeout(async () => {
          try {
            const fresh = await qtalkApi.listConversationMessages(convId);
            const target = fresh.find(m => m.id === created.id);
            if (target?.translations) {
              setMessages((prev) => {
                const arr = prev[convId] || [];
                return { ...prev, [convId]: arr.map(m =>
                  m.id === created.id
                    ? { ...m, translations: target.translations as MockMessage['translations'], detected_language: target.detected_language as MockMessage['detected_language'] }
                    : m
                ) };
              });
            }
          } catch { /* silent */ }
        }, 4000);
      }
    } catch (err: unknown) {
      // 사이클 N+15-E — 옵티미스틱 메시지 실패 시 화면에서 제거 (phantom 방지).
      setMessages((prev) => {
        const arr = prev[convId];
        if (!arr) return prev;
        return { ...prev, [convId]: arr.filter((m) => m.id !== tempId) };
      });
      showNotice(t('page.sendFailed', { msg: mapApiError(err, tErr) }));
    }
  };

  // 청크 2: 채널 이름 변경
  const handleRenameConversation = async (conversationId: number, name: string) => {
    try {
      const updated = await qtalkApi.updateConversation(conversationId, { display_name: name });
      setConversations((prev) => prev.map((c) => (c.id === conversationId ? { ...c, name: updated.display_name || updated.title || c.name } : c)));
    } catch (err: unknown) {
      showNotice(t('page.renameFailed', { msg: mapApiError(err, tErr) }));
    }
  };

  // 청크 2: 자동 추출 토글
  const handleToggleAutoExtract = async (conversationId: number, enabled: boolean) => {
    try {
      const updated = await qtalkApi.updateConversation(conversationId, { auto_extract_enabled: enabled });
      setConversations((prev) => prev.map((c) => (c.id === conversationId ? { ...c, auto_extract_enabled: updated.auto_extract_enabled } : c)));
    } catch (err: unknown) {
      showNotice(t('page.autoExtractFailed', { msg: mapApiError(err, tErr) }));
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
      showNotice(t('page.issueAddFailed', { msg: mapApiError(err, tErr) }));
    }
  };

  const handleUpdateIssue = async (id: number, body: string) => {
    try {
      const updated = await qtalkApi.updateIssue(id, body);
      setIssues((prev) => prev.map((i) => (i.id === id ? apiIssueToMock(updated) : i)));
    } catch (err: unknown) {
      showNotice(t('page.issueEditFailed', { msg: mapApiError(err, tErr) }));
    }
  };

  const handleDeleteIssue = async (id: number) => {
    try {
      await qtalkApi.deleteIssue(id);
      setIssues((prev) => prev.filter((i) => i.id !== id));
    } catch (err: unknown) {
      showNotice(t('page.issueDeleteFailed', { msg: mapApiError(err, tErr) }));
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
      showNotice(t('page.noteAddFailed', { msg: mapApiError(err, tErr) }));
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
      showNotice(t('page.taskStatusFailed', { msg: mapApiError(err, tErr) }));
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
        // socket 의 candidates:created 가 같은 항목을 또 보내므로 id dedup
        setCandidates((prev) => {
          const existing = new Set(prev.map((c) => c.id));
          const fresh = mapped.filter((c) => !existing.has(c.id));
          return fresh.length === 0 ? prev : [...fresh, ...prev];
        });
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
      const raw = err instanceof Error ? err.message : '';
      if (raw === 'extraction_already_in_progress') {
        showNotice(t('extract.inProgress'));
      } else {
        showNotice(t('extract.failed', { msg: mapApiError(err, tErr) }));
      }
    } finally {
      setExtracting(false);
    }
  };

  // 청크 3: 후보 등록 — 우측 패널 인라인 편집한 값 (title/assignee_id/due_date) 전달.
  const handleRegisterCandidate = async (id: number, overrides?: qtalkApi.RegisterCandidateOverrides) => {
    try {
      const result = await qtalkApi.registerCandidate(id, overrides);
      // 후보 목록에서 제거 (또는 상태 변경)
      setCandidates((prev) => prev.filter((c) => c.id !== id));
      // 새 업무를 tasks에 추가
      if (result.task) {
        setTasks((prev) => [apiTaskToMock(result.task), ...prev]);
      }
    } catch (err: unknown) {
      showNotice(mapApiError(err, tErr));
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
      showNotice(mapApiError(err, tErr));
    }
  };

  // 청크 3: 후보 거절
  const handleRejectCandidate = async (id: number) => {
    try {
      await qtalkApi.rejectCandidate(id);
      setCandidates((prev) => prev.filter((c) => c.id !== id));
    } catch (err: unknown) {
      showNotice(mapApiError(err, tErr));
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
      showNotice(mapApiError(err, tErr));
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
      showNotice(mapApiError(err, tErr));
    }
  };

  const activeProject = projects.find((p) => p.id === activeProjectId) || null;
  // 후보 scope: 프로젝트 선택 시 project_id, 독립 대화면 conversation_id 로 필터
  const projectCandidates = activeProject
    ? candidates.filter((c) => c.project_id === activeProject.id && c.status === 'pending')
    : activeConversationId
      ? candidates.filter((c) => c.conversation_id === activeConversationId && c.status === 'pending')
      : [];

  if (!businessId) return <PanelLayout><CenteredHint>{t('page.noBusiness', '워크스페이스가 선택되지 않았습니다.')}</CenteredHint></PanelLayout>;
  if (loadError) return <PanelLayout><CenteredHint>{t('page.loadFailed', { msg: loadError })}</CenteredHint></PanelLayout>;
  // 사이클 N+15-A: 풀스크린 spinner 게이트 제거. LeftPanel/ChatPanel 이 내부 skeleton 으로 처리.
  // 캐시(있으면) 즉시 표시 → 백그라운드 fresh → 사용자는 위치 점프/spinner 한 번도 안 봄.

  return (
    <PanelLayout $embedded={embedded}>
      {/* 좌측 리스트 접기/펼치기 — 우측과 동일하게 공통 핸들을 레이아웃 레벨에.
          패널 안에 그리면 옆 패널(대화창)에 가려 클릭이 안 먹었다. */}
      <PanelEdgeHandle
        side="left"
        collapsed={leftCollapsed}
        onToggle={toggleLeft}
        offset={leftCollapsed ? 0 : 300}   /* LeftPanel Container width: 300px */
        labelCollapse={t('left.collapse', { defaultValue: '리스트 접기' }) as string}
        labelExpand={t('left.expand', { defaultValue: '리스트 열기' }) as string}
      />
      <LeftPanel
        projects={projects}
        conversations={conversations}
        activeProjectId={activeProjectId}
        activeConversationId={activeConversationId}
        loading={loading}
        onSelectConversation={handleSelectConversation}
        onOpenNewChat={() => setChatModalOpen(true)}
        collapsed={leftCollapsed}
        onToggleCollapsed={toggleLeft}
        canManage={canManageConversation}
        onArchive={(c) => setArchiveConv(c)}
        onUnlink={(c) => setUnlinkConv(c)}
        onOpenArchive={!embedded && canViewArchive ? () => setArchivedModalOpen(true) : undefined}
        onTogglePin={async (convId, pinned) => {
          // 옵티미스틱 — UI 즉시 반영
          const nowIso = pinned ? new Date().toISOString() : null;
          setConversations((prev) => prev.map((c) =>
            c.id === convId ? { ...c, my_pinned_at: nowIso } : c
          ));
          try {
            const biz = user?.business_id ? Number(user.business_id) : null;
            if (!biz) return;
            const ok = pinned
              ? await qtalkApi.pinConversation(biz, convId)
              : await qtalkApi.unpinConversation(biz, convId);
            if (!ok) {
              // 롤백
              setConversations((prev) => prev.map((c) =>
                c.id === convId ? { ...c, my_pinned_at: pinned ? null : nowIso } : c
              ));
            }
          } catch (e) {
            console.warn('[togglePin]', e);
          }
        }}
        mobileHidden={activeConversationId !== null}
      />
      <ChatPanel
        embedded={embedded}
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
        onOpenSettings={activeConversationId ? () => setSettingsOpen(true) : undefined}
        candidatesCount={projectCandidates.length}
        leftCollapsed={leftCollapsed}
        rightCollapsed={rightCollapsed}
        onToggleLeft={toggleLeft}
        onToggleRight={toggleRight}
        onOpenNewChat={() => setChatModalOpen(true)}
        onMobileBack={handleMobileBack}
        mobileHidden={activeConversationId === null}
        onLoadOlder={loadOlderMessages}
        hasMoreOlder={hasMoreOlder}
        loadingOlder={loadingOlder}
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
      {/* 우측 작업대 접기/펼치기 — 공통 PanelEdgeHandle 을 레이아웃 레벨에 그린다.
          여태 RightPanel 안의 CollapsedStrip(width:0, ≤1200px 에서 display:none)에 그려서
          옆 패널에 가리거나 아예 사라졌다. Q Mail 만 정상이던 이유. */}
      <PanelEdgeHandle
        side="right"
        collapsed={rightCollapsed}
        onToggle={toggleRight}
        offset={rightCollapsed ? 0 : rightWidth}
        labelCollapse={`${t('right.collapse', { defaultValue: '작업대 접기' }) as string} (⌘/)`}
        labelExpand={`${t('right.expand', { defaultValue: '작업대 열기' }) as string} (⌘/)`}
      />
      <RightPanel
        project={activeProject}
        activeConversationId={activeConversationId}
        conversations={conversations}
        tasks={tasks}
        notes={notes}
        issues={issues}
        candidates={projectCandidates}
        showHiddenCandidates={showHiddenCandidates}
        onToggleHiddenCandidates={() => setShowHiddenCandidates(v => !v)}
        collapsed={rightCollapsed}
        onToggleCollapsed={toggleRight}
        width={rightWidth}
        onResizeStart={startRightResize}
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
        onClose={() => setChatModalOpen(false)}
        onCreate={handleCreateChat}
      />

      {settingsOpen && activeConversationId && convsRaw[activeConversationId] && businessId && (
        <ChatSettingsModal
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          businessId={businessId}
          conversation={convsRaw[activeConversationId]}
          projectName={activeProject?.name || null}
          onUpdated={(next) => {
            setConvsRaw(prev => ({ ...prev, [next.id]: next }));
            // mock 측 display_name + auto_extract 동기화
            setConversations(prev => prev.map(c => c.id === next.id
              ? { ...c, name: next.display_name || next.title || c.name, auto_extract_enabled: next.auto_extract_enabled }
              : c));
          }}
        />
      )}

      {notice && (
        <Toast>
          <ToastDot />
          {notice}
        </Toast>
      )}

      {/* 채팅방 보관 — soft delete. archived_at NOT NULL → 목록 제외, 메시지·파일·할일은 보존. */}
      <ConfirmDialog
        isOpen={!!archiveConv && !archiveBusy}
        variant="danger"
        title={t('left.confirm.archive.title', '이 채팅방을 보관할까요?') as string}
        message={
          t('left.confirm.archive.body', { name: archiveConv?.name || '', defaultValue: '“{{name}}” 를 채팅 목록에서 보관해요. 메시지·파일·업무·할일은 그대로 남고, 워크스페이스 관리자가 다시 활성화할 수 있어요.' }) as string
        }
        confirmText={t('left.confirm.archive.ok', '보관') as string}
        cancelText={t('left.confirm.cancel', '취소') as string}
        onClose={() => setArchiveConv(null)}
        onConfirm={async () => {
          if (!archiveConv || !businessId || archiveBusy) return;
          setArchiveBusy(true);
          try {
            const r = await apiFetch(`/api/conversations/${businessId}/${archiveConv.id}/archive`, { method: 'POST' });
            const j = await r.json();
            if (!r.ok || !j.success) {
              setNotice(j.message === 'workspace_owner_or_project_owner_required'
                ? (t('left.menu.permDenied', '워크스페이스 관리자 또는 프로젝트 owner 만 보관할 수 있어요.') as string)
                : (j.message || (t('left.menu.archiveFailed', '보관에 실패했어요') as string)));
              return;
            }
            // 옵티미스틱 제거 + 활성 채팅이었으면 선택 해제
            setConversations(prev => prev.filter(c => c.id !== archiveConv.id));
            if (activeConversationId === archiveConv.id) setActiveConversationId(null);
          } finally {
            setArchiveBusy(false);
            setArchiveConv(null);
          }
        }}
      />

      {/* 프로젝트에서 분리 — project_id=null. 채팅방·메시지·참여자 모두 그대로 유지. */}
      <ConfirmDialog
        isOpen={!!unlinkConv && !unlinkBusy}
        title={t('left.confirm.unlink.title', '프로젝트에서 분리할까요?') as string}
        message={
          t('left.confirm.unlink.body', { name: unlinkConv?.name || '', defaultValue: '“{{name}}” 의 프로젝트 연결을 해제해요. 채팅방·메시지·참여자는 그대로 유지되고, “일반 대화” 그룹으로 옮겨져요.' }) as string
        }
        confirmText={t('left.confirm.unlink.ok', '분리') as string}
        cancelText={t('left.confirm.cancel', '취소') as string}
        onClose={() => setUnlinkConv(null)}
        onConfirm={async () => {
          if (!unlinkConv || unlinkBusy) return;
          setUnlinkBusy(true);
          try {
            const r = await apiFetch(`/api/projects/conversations/${unlinkConv.id}/unlink`, { method: 'POST' });
            const j = await r.json();
            if (!r.ok || !j.success) {
              setNotice(j.message || (t('left.menu.unlinkFailed', '분리에 실패했어요') as string));
              return;
            }
            // 옵티미스틱 — project_id null 로 변경. 분리된 채팅은 "일반 대화" 그룹으로 자동 이동.
            setConversations(prev => prev.map(c =>
              c.id === unlinkConv.id ? { ...c, project_id: null } : c
            ));
          } finally {
            setUnlinkBusy(false);
            setUnlinkConv(null);
          }
        }}
      />

      {/* 보관함 — workspace admin 만. 복원 시 부모 conversations 다시 fetch (소켓이 자동 갱신 안 함). */}
      {canViewArchive && businessId && (
        <ArchivedChatsModal
          open={archivedModalOpen}
          businessId={businessId}
          onClose={() => setArchivedModalOpen(false)}
          onAfter={async () => {
            try {
              const fresh = await qtalkApi.listBusinessConversations(businessId);
              setConversations(fresh.map(apiConversationToMock));
            } catch { /* silent — modal 안 에러는 ArchivedChatsModal 이 표시 */ }
          }}
        />
      )}
    </PanelLayout>
  );
};

export default QTalkPage;

// 사이클 N+14 후속 — loading/no-business/error 상태에서 Layout wrapper 안 중앙 정렬.
// Empty 대신 사용해 viewport 단위/56px 분기 차이로 spinner 점프 회귀 차단.
const CenteredHint = styled.div`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #64748B;
  font-size: 14px;
  min-height: 0;
`;

// (사이클 N+15-A) Spinner 컴포넌트 제거 — 풀스크린 게이트 자체가 사라짐.

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

