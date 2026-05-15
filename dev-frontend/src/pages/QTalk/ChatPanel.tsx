import React, { useMemo, useState, useEffect, useRef } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import {
  type MockMessage, type MockProject, type MockConversation, type PostCardMeta,
} from './types';
import { useAuth, apiFetch } from '../../contexts/AuthContext';
import * as qtalkApi from '../../services/qtalk';
import { useTimeFormat } from '../../hooks/useTimeFormat';
import LetterAvatar from '../../components/Common/LetterAvatar';
import EmptyState from '../../components/Common/EmptyState';
import PostCardPreviewModal from './PostCardPreviewModal';
import FilePicker, { type FilePickerResult } from '../../components/Common/FilePicker';
import UserInfoPopover from '../../components/Common/UserInfoPopover';
import { fetchWorkspaceFiles, uploadMyFile } from '../../services/files';
import { mediaTablet } from '../../theme/breakpoints';

interface Props {
  project: MockProject | null;
  conversations: MockConversation[];
  messages: Record<number, MockMessage[]>;
  activeConversationId: number | null;
  onSelectConversation: (conversationId: number) => void;
  onOpenExtract: () => void;
  onSendMessage: (body: string, files?: File[], existingFileIds?: number[], existingPostIds?: number[]) => void;
  onCueDraftSend: (messageId: number, editedBody?: string) => void;
  onCueDraftReject: (messageId: number) => void;
  onToggleAutoExtract: (conversationId: number, enabled: boolean) => void;
  onRenameConversation: (conversationId: number, name: string) => void;
  onOpenSettings?: () => void;
  candidatesCount: number;
  extracting?: boolean;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  onToggleLeft: () => void;
  onToggleRight: () => void;
  onFocusCandidates?: () => void; // (legacy — 배너에서 더 이상 사용 안 함, 호출자 호환 유지)
  onOpenNewChat?: () => void;
  /** 모바일(<=tablet) 에서 리스트로 돌아가기 */
  onMobileBack?: () => void;
  /** 모바일에서 대화가 선택되지 않은 경우 ChatPanel 을 숨김 */
  mobileHidden?: boolean;
}

const ChatPanel: React.FC<Props> = ({
  project, conversations, messages, activeConversationId, onSelectConversation,
  onOpenExtract, onSendMessage, onCueDraftSend, onCueDraftReject,
  onToggleAutoExtract, onRenameConversation, onOpenSettings,
  candidatesCount, extracting, leftCollapsed, rightCollapsed, onToggleLeft, onToggleRight,
  onOpenNewChat, onMobileBack, mobileHidden = false,
}) => {
  const { t } = useTranslation('qtalk');
  const { user } = useAuth();
  const { formatTime } = useTimeFormat();
  const isClient = user?.business_role === 'client';

  // Hangouts/Slack 패턴 — 그룹 헤더에서 풍부한 시각 표시
  //   오늘 → 14:18 / 어제 → 어제 14:18 / 7일내 → 월 14:18 / 그 외 → 5/3 14:18
  const formatGroupTime = (iso: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const now = new Date();
    const time = formatTime(iso);
    const sameDay = (a: Date, b: Date) =>
      a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    if (sameDay(d, now)) return time;
    const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
    if (sameDay(d, yesterday)) return `${t('chat.yesterday', '어제')} ${time}`;
    const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
    if (diffDays >= 0 && diffDays < 7) {
      const wkKey = ['sun','mon','tue','wed','thu','fri','sat'][d.getDay()];
      const wkLabel = t(`chat.weekday.${wkKey}`, ['일','월','화','수','목','금','토'][d.getDay()]);
      return `${wkLabel} ${time}`;
    }
    return `${d.getMonth() + 1}/${d.getDate()} ${time}`;
  };

  // 두 메시지를 한 그룹으로 묶을지 — 같은 발신자 + 5분 이내
  const GROUP_GAP_MS = 5 * 60 * 1000;
  const isContinuation = (cur: { sender_id: number; created_at: string }, prev: { sender_id: number; created_at: string } | undefined) => {
    if (!prev) return false;
    if (prev.sender_id !== cur.sender_id) return false;
    const cur_t = new Date(cur.created_at).getTime();
    const prev_t = new Date(prev.created_at).getTime();
    if (Number.isNaN(cur_t) || Number.isNaN(prev_t)) return false;
    return (cur_t - prev_t) <= GROUP_GAP_MS;
  };
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [previewCard, setPreviewCard] = useState<PostCardMeta | null>(null);

  // 메시지 본문 안 URL 자동 링크 — 보안: target=_blank rel="noopener noreferrer"
  // 정규식: http(s):// + 공백 아닌 문자 (자주 보이는 끝 문자 . , ) ] 등은 trailing 으로 제외하고 링크에 포함 안 함)
  const LINK_RE = /(https?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]'"])/g;
  const renderTextWithLinks = (text: string): React.ReactNode[] => {
    if (!text) return [text];
    const parts: React.ReactNode[] = [];
    let lastIdx = 0;
    let m: RegExpExecArray | null;
    LINK_RE.lastIndex = 0;
    while ((m = LINK_RE.exec(text)) !== null) {
      if (m.index > lastIdx) parts.push(text.slice(lastIdx, m.index));
      parts.push(
        <MsgLink key={`l-${m.index}`} href={m[0]} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
          {m[0]}
        </MsgLink>
      );
      lastIdx = m.index + m[0].length;
    }
    if (lastIdx < text.length) parts.push(text.slice(lastIdx));
    return parts.length > 0 ? parts : [text];
  };

  // candidatesCount 가 변할 때마다 dismiss 리셋 (새 후보가 들어왔으니)
  useEffect(() => {
    setBannerDismissed(false);
  }, [candidatesCount]);

  const channels = useMemo(() => {
    // project 가 있으면 = 같은 프로젝트의 모든 채널이 형제 (빠른 전환 후보).
    // project 가 없으면 = 독립 채팅. 다른 독립 대화와 묶이지 않음 — 자기 자신만.
    const base = project
      ? conversations.filter((c) => c.project_id === project.id)
      : (activeConversationId ? conversations.filter((c) => c.id === activeConversationId) : []);
    return base.filter((c) => !isClient || c.channel_type !== 'internal'); // 고객은 internal 숨김
  }, [project, conversations, isClient, activeConversationId]);

  // 독립 대화가 방금 생성됐을 수 있으므로 conversations 전체에서도 한번 더 찾는다 — project 상태 동기화 전에도 렌더 가능.
  const activeConv = channels.find((c) => c.id === activeConversationId)
    || (activeConversationId ? conversations.find((c) => c.id === activeConversationId) : null)
    || channels[0]
    || null;
  const convMessages: MockMessage[] = activeConv ? messages[activeConv.id] || [] : [];
  // 사이클 N+15-A — 활성 대화 메시지 lazy-load 진행 중 (undefined). 빈 conv (배열은 있되 길이 0) 와 구분.
  const messagesLoading = activeConv ? messages[activeConv.id] === undefined : false;
  // 사이클 N+15-E — 스크롤-바닥 floating 버튼 노출 여부 + 새 메시지 카운트.
  // distance > 240px 일 때 표시 (sticky threshold 와 일치). 새 메시지 +N 뱃지.
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [pendingNewCount, setPendingNewCount] = useState(0);
  const [input, setInput] = useState('');
  // textarea ref — 채팅방 진입 시 자동 포커스 + 입력 시 auto-resize (2줄 가려짐 방지)
  const textInputRef = React.useRef<HTMLTextAreaElement | null>(null);
  // input 변경 시 textarea 높이를 scrollHeight 로 동기화 (max-height 120px 도달 시 내부 스크롤)
  // useLayoutEffect + raf — mount 직후 layout 미완 시 placeholder 가 1줄로 측정되어 textarea 가
  // 1줄 높이로 고정되던 회귀. 다음 frame 에서 재측정해 안내문 wrap 후 정확한 높이 확보.
  React.useLayoutEffect(() => {
    const el = textInputRef.current;
    if (!el) return;
    const measure = () => {
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
    };
    measure();
    const raf = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(raf);
  }, [input]);
  // 폭 변경(회전·사이드바 토글·키보드 등) 시 재측정
  React.useEffect(() => {
    const measure = () => {
      const el = textInputRef.current;
      if (!el) return;
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
    };
    window.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('resize', measure);
    };
  }, []);
  // 활성 대화방 변경 시 자동 포커스 (모바일에서는 키보드 자동 펼치지 않도록 skip)
  React.useEffect(() => {
    if (!activeConversationId) return;
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches) return;
    const tm = window.setTimeout(() => textInputRef.current?.focus(), 80);
    return () => window.clearTimeout(tm);
  }, [activeConversationId]);

  // 모바일 키보드 가림 fix — textarea focus 시 키보드 올라오면서 입력란이 viewport 밖으로 밀리는 케이스.
  // visualViewport API 로 키보드 resize 감지해서 강제 scrollIntoView. iOS Safari / Android Chrome 양쪽 검증.
  const handleInputFocus = React.useCallback(() => {
    const el = textInputRef.current;
    if (!el) return;
    const ensureVisible = () => {
      el.scrollIntoView({ block: 'end', inline: 'nearest', behavior: 'smooth' });
    };
    // visualViewport 가 있으면 키보드 올라온 직후 정확히 한 번 fire
    if (window.visualViewport) {
      const onResize = () => { ensureVisible(); };
      window.visualViewport.addEventListener('resize', onResize, { once: true });
      // 안전장치: 1s 후 listener 정리 (이미 once 라 자동 해제되지만 명시적)
      window.setTimeout(() => window.visualViewport?.removeEventListener('resize', onResize), 1000);
    }
    // fallback — 모든 환경에서 350ms 후 한 번 더 (키보드 애니메이션 기간 보정)
    window.setTimeout(ensureVisible, 350);
  }, []);

  // 사이클 N+15-B — 모바일 키보드 up 감지 → body[data-keyboard-up=1] 토글.
  // 일부 iOS 버전이 `env(safe-area-inset-bottom)` 을 키보드 up 상태에서도 34px 유지하는 버그 회피용.
  // InputBar 의 padding-bottom 이 body[data-keyboard-up=1] 셀렉터에서 0 으로 강제 → 입력란-키보드 사이 빈 공간 0.
  // Hangouts/iMessage 와 동일한 "키보드 위 입력란 딱 붙음" 인상.
  React.useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      // 키보드 up 판정: visualViewport 가 window.innerHeight 의 70% 미만 = 키보드가 30%+ 차지
      const isUp = vv.height < window.innerHeight * 0.70;
      if (isUp) {
        document.body.setAttribute('data-keyboard-up', '1');
      } else {
        document.body.removeAttribute('data-keyboard-up');
      }
    };
    update();
    vv.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    return () => {
      vv.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
      document.body.removeAttribute('data-keyboard-up');
    };
  }, []);
  const [editingDraftId, setEditingDraftId] = useState<number | null>(null);
  const [draftBody, setDraftBody] = useState('');
  // 사이클 N+15-E — 발신자 정보 popover. open 상태 + anchor + userId 저장.
  const [userPopover, setUserPopover] = useState<{ userId: number; anchorEl: HTMLElement } | null>(null);

  // 사이클 N+16-E — 메시지 액션 (수정 / 삭제 / 핀 / 묶음 선택).
  const [editingMsgId, setEditingMsgId] = useState<number | null>(null);
  const [editingMsgDraft, setEditingMsgDraft] = useState('');
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedMsgIds, setSelectedMsgIds] = useState<Set<number>>(new Set());
  const [moreMenuMsgId, setMoreMenuMsgId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [pinnedBarOpen, setPinnedBarOpen] = useState(true);
  const [pinnedBarFlashId, setPinnedBarFlashId] = useState<number | null>(null);

  const isOwnerOrAdmin = user?.business_role === 'owner' || user?.platform_role === 'platform_admin';
  const canPinMessage = isOwnerOrAdmin; // 프로젝트 owner 도 가능하지만 UI 단순화 (backend 가 검사)

  const handleCopyText = async (text: string) => {
    try { await navigator.clipboard.writeText(text); }
    catch {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch { /* skip */ }
      document.body.removeChild(ta);
    }
  };

  const handleEditStart = (m: MockMessage) => {
    setEditingMsgId(m.id);
    setEditingMsgDraft(m.body);
    setMoreMenuMsgId(null);
  };
  const handleEditSave = async () => {
    if (!editingMsgId || !businessId || !activeConv) return;
    const next = editingMsgDraft.trim();
    if (!next) return;
    try {
      await qtalkApi.editMessage(Number(businessId), activeConv.id, editingMsgId, next);
      // socket 이 자동 갱신. 옵티미스틱 미적용 (서버 반영 후 시각 즉시)
    } catch { /* 실패시 그대로 유지 */ }
    setEditingMsgId(null);
    setEditingMsgDraft('');
  };
  const handleEditCancel = () => { setEditingMsgId(null); setEditingMsgDraft(''); };

  const handleDelete = async (msgId: number) => {
    if (!businessId || !activeConv) return;
    try {
      await qtalkApi.deleteMessage(Number(businessId), activeConv.id, msgId);
      // socket 이 갱신
    } catch { /* skip */ }
    setConfirmDeleteId(null);
  };

  const handleTogglePinMsg = async (msg: MockMessage) => {
    if (!businessId || !activeConv) return;
    try {
      if (msg.pinned_at) {
        await qtalkApi.unpinMessage(Number(businessId), activeConv.id, msg.id);
      } else {
        await qtalkApi.pinMessage(Number(businessId), activeConv.id, msg.id);
      }
    } catch { /* skip */ }
    setMoreMenuMsgId(null);
  };

  const toggleSelected = (id: number) => {
    setSelectedMsgIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const exitSelection = () => { setSelectionMode(false); setSelectedMsgIds(new Set()); };
  const handleBulkCopy = async () => {
    const selected = convMessages
      .filter((m) => selectedMsgIds.has(m.id) && !m.is_deleted)
      .map((m) => `[${m.sender_name} ${formatGroupTime(m.created_at)}] ${m.body || (m.attachments?.length ? `[첨부 ${m.attachments.length}개]` : '')}`)
      .join('\n');
    await handleCopyText(selected);
    exitSelection();
  };
  const handleBulkDelete = async () => {
    if (!businessId || !activeConv) return;
    const ids = [...selectedMsgIds];
    for (const id of ids) {
      try { await qtalkApi.deleteMessage(Number(businessId), activeConv.id, id); }
      catch { /* skip */ }
    }
    exitSelection();
    setConfirmDeleteId(null);
  };

  // 핀 메시지 클릭 → 본문으로 스크롤 + 잠시 하이라이트
  const scrollToMessage = (msgId: number) => {
    const el = document.querySelector(`[data-msg-id="${msgId}"]`);
    if (el && el instanceof HTMLElement) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setPinnedBarFlashId(msgId);
      window.setTimeout(() => setPinnedBarFlashId(null), 1800);
    }
  };

  const pinnedMessages = useMemo(() =>
    convMessages.filter((m) => m.pinned_at && !m.is_deleted).sort((a, b) =>
      (new Date(b.pinned_at || 0).getTime()) - (new Date(a.pinned_at || 0).getTime())
    ),
  [convMessages]);

  // more 메뉴 외부 클릭 닫기
  React.useEffect(() => {
    if (moreMenuMsgId == null) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!document.querySelector(`[data-more-menu="${moreMenuMsgId}"]`)?.contains(target)) setMoreMenuMsgId(null);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [moreMenuMsgId]);

  // PWA Share Target 등에서 ?prefill= 으로 본문 전달받음. 마운트 시 한 번만 적용 + URL 정리.
  const [searchParams, setSearchParams] = useSearchParams();
  const prefillAppliedRef = useRef(false);
  useEffect(() => {
    if (prefillAppliedRef.current) return;
    const prefill = searchParams.get('prefill');
    if (prefill) {
      setInput((prev) => prev || decodeURIComponent(prefill));
      const next = new URLSearchParams(searchParams);
      next.delete('prefill');
      setSearchParams(next, { replace: true });
      prefillAppliedRef.current = true;
    }
  }, [searchParams, setSearchParams]);

  // 채팅방 이름 인라인 편집
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(activeConv?.name || '');
  React.useEffect(() => {
    setNameDraft(activeConv?.name || '');
    setEditingName(false);
    setEditingDraftId(null);
  }, [activeConv?.id]);
  const commitNameEdit = () => {
    const next = nameDraft.trim();
    setEditingName(false);
    if (activeConv && next && next !== activeConv.name) {
      onRenameConversation(activeConv.id, next);
    } else {
      setNameDraft(activeConv?.name || '');
    }
  };

  // 업로드 진행 중 상태 — 픽 즉시 업로드 → 완료 시 stagedExistingIds 로 이동
  const [uploadingFiles, setUploadingFiles] = useState<Array<{ tempId: string; name: string; size: number; error?: string }>>([]);
  const [stagedExistingIds, setStagedExistingIds] = useState<number[]>([]);
  const [stagedExistingMeta, setStagedExistingMeta] = useState<Record<number, { name: string; size: number }>>({});
  const [stagedPostIds, setStagedPostIds] = useState<number[]>([]);
  const [stagedPostMeta, setStagedPostMeta] = useState<Record<number, { title: string }>>({});
  const [filePickerOpen, setFilePickerOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  // FilePicker 의 businessId — useAuth() 의 user.business_id 사용 (MockProject 에는 business_id 없음)
  const businessId = user?.business_id ? Number(user.business_id) : null;

  // 한 개 파일을 즉시 워크스페이스에 업로드 → fileId 받아서 stagedExistingIds 에 추가.
  // 진행 중엔 uploadingFiles 에 임시 chip 으로 노출 (이름 + 크기 + 스피너).
  // **Drive 라우팅:** 활성 대화/프로젝트 컨텍스트를 함께 보내 워크스페이스가 Drive 연동되어 있으면
  // 자동으로 Drive 의 Conversations/프로젝트 폴더로 업로드 (자체 스토리지 쿼터·사이즈 한도 우회).
  const uploadOne = async (file: File) => {
    if (!businessId) return;
    const tempId = `up-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setUploadingFiles(prev => [...prev, { tempId, name: file.name, size: file.size }]);
    try {
      const r = await uploadMyFile(businessId, file, {
        conversationId: activeConv?.id ?? null,
        projectId: project?.id ?? null,
      });
      if (!r.success || !r.file) {
        setUploadingFiles(prev => prev.map(x => x.tempId === tempId ? { ...x, error: r.message || t('chat.upload.failed', '업로드 실패') as string } : x));
        return;
      }
      const fid = Number(String(r.file.id).replace(/^direct-/, ''));
      if (fid) {
        setStagedExistingIds(prev => prev.includes(fid) ? prev : [...prev, fid]);
        setStagedExistingMeta(prev => ({ ...prev, [fid]: { name: file.name, size: file.size } }));
      }
      setUploadingFiles(prev => prev.filter(x => x.tempId !== tempId));
    } catch (e) {
      setUploadingFiles(prev => prev.map(x => x.tempId === tempId ? { ...x, error: e instanceof Error ? e.message : '업로드 실패' } : x));
    }
  };

  // 여러 파일 동시 업로드 (Promise.allSettled — 일부 실패해도 나머지 진행)
  const uploadMany = async (files: File[]) => {
    await Promise.allSettled(files.map(uploadOne));
  };

  const handleSend = () => {
    const hasFiles = stagedExistingIds.length > 0;
    const hasPosts = stagedPostIds.length > 0;
    const hasUploading = uploadingFiles.some(x => !x.error);
    if (hasUploading) return; // 업로드 진행 중엔 전송 X (UI 도 disabled)
    if (!input.trim() && !hasFiles && !hasPosts) return;
    onSendMessage(
      input,
      undefined, // raw File 배열은 더 이상 사용하지 않음 (업로드 즉시 → existingIds 경로 통일)
      stagedExistingIds.length > 0 ? stagedExistingIds : undefined,
      stagedPostIds.length > 0 ? stagedPostIds : undefined,
    );
    setInput('');
    setStagedExistingIds([]);
    setStagedExistingMeta({});
    setStagedPostIds([]);
    setStagedPostMeta({});
    setUploadingFiles([]);
    scrollToBottom();
    // 사이클 N+15-B — 전송 후 키보드 유지 (Hangouts/iMessage 패턴).
    // iOS Safari 는 value reset + reflow 만으로 dismiss 하는 케이스가 있어 명시적 focus 재호출.
    // 데스크탑은 useEffect 의 activeConversationId 변경 분기에서 이미 focus, 모바일도 여기서 보존.
    requestAnimationFrame(() => {
      const el = textInputRef.current;
      if (el && document.activeElement !== el) el.focus({ preventScroll: true });
    });
  };
  const handleFilePicked = async (result: FilePickerResult) => {
    if (result.uploaded && result.uploaded.length > 0) {
      uploadMany(result.uploaded);
    }
    if (result.existingFileIds && result.existingFileIds.length > 0 && businessId) {
      setStagedExistingIds(prev => [...new Set([...prev, ...result.existingFileIds!])]);
      // 메타 fetch (이름·크기 표시)
      try {
        const all = await fetchWorkspaceFiles(Number(businessId));
        setStagedExistingMeta(prev => {
          const next = { ...prev };
          for (const id of result.existingFileIds!) {
            const f = all.find(x => x.id === `direct-${id}`);
            if (f) next[id] = { name: f.file_name, size: f.file_size };
          }
          return next;
        });
      } catch { /* skip */ }
    }
    if (result.existingPostIds && result.existingPostIds.length > 0 && businessId) {
      setStagedPostIds(prev => [...new Set([...prev, ...result.existingPostIds!])]);
      // 메타 fetch (post title)
      try {
        const { fetchPosts } = await import('../../services/posts');
        const ps = await fetchPosts(Number(businessId), {});
        setStagedPostMeta(prev => {
          const next = { ...prev };
          for (const id of result.existingPostIds!) {
            const p = ps.find(x => x.id === id);
            if (p) next[id] = { title: p.title };
          }
          return next;
        });
      } catch { /* skip */ }
    }
  };
  const removeUploading = (tempId: string) => setUploadingFiles(prev => prev.filter(x => x.tempId !== tempId));
  const removeExisting = (id: number) => {
    setStagedExistingIds(prev => prev.filter(x => x !== id));
    setStagedExistingMeta(prev => { const next = { ...prev }; delete next[id]; return next; });
  };
  const removePost = (id: number) => {
    setStagedPostIds(prev => prev.filter(x => x !== id));
    setStagedPostMeta(prev => { const next = { ...prev }; delete next[id]; return next; });
  };

  // 비이미지 첨부 다운로드 — Authorization 헤더 동반 fetch + blob 트리거
  // (img 와 달리 클릭 다운로드는 직접 JS 로 받아야 401 안 남)
  const downloadAttachment = async (attId: number, filename: string) => {
    try {
      const res = await apiFetch(`/api/message-attachments/${attId}/download`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('[downloadAttachment]', e);
    }
  };

  // 메시지 리스트 스크롤 컨테이너 + 위치 영속
  const messageListRef = React.useRef<HTMLDivElement | null>(null);
  // 메시지 리스트 끝의 sentinel — scrollHeight 계산 없이 "마지막 메시지 다음 위치"로 정확히 스크롤.
  // 이미지 / 번역 / 카드 같은 비동기 콘텐츠가 나중에 추가되어 scrollHeight 가 변동해도 sentinel
  // 자체가 끝에 있어 항상 바닥을 가리킴.
  const messagesEndRef = React.useRef<HTMLDivElement | null>(null);
  const scrollKey = (convId: number | null | undefined) => convId ? `qtalk_scroll_${convId}` : null;

  const scrollToBottom = React.useCallback((smooth = true) => {
    const doIt = () => {
      const sentinel = messagesEndRef.current;
      const el = messageListRef.current;
      if (sentinel) {
        // scrollIntoView block:'end' 가 가장 신뢰성 높음 — 이미지 미로드 상태에서도 sentinel 위치는 정확.
        try {
          sentinel.scrollIntoView({ block: 'end', inline: 'nearest', behavior: smooth ? 'smooth' : 'auto' });
          return;
        } catch { /* 구형 브라우저 fallback */ }
      }
      if (!el) return;
      const target = el.scrollHeight - el.clientHeight;
      if (smooth && typeof el.scrollTo === 'function') {
        el.scrollTo({ top: target, behavior: 'smooth' });
      } else {
        el.scrollTop = target;
      }
    };
    // useLayoutEffect 안에서 호출 시 DOM commit 직후 layout phase 라 즉시 호출 가능 —
    // 옛 코드는 RAF x 2 지연으로 "첫 paint top 0 → 2 frame 후 bottom 점프" 회귀 발생.
    // 박제: 사이클 N+12 — 채팅방 진입 시 위에 갔다 옴 회귀. 비동기 콘텐츠 보정은 ResizeObserver 가 별도 처리.
    doIt();
    // 후속 보정 1회 — 이미지/번역 박스가 nextTick 에 추가될 때 sentinel 따라가기.
    window.requestAnimationFrame(doIt);
  }, []);

  // 콘텐츠 크기 변화 감지 — 이미지 / 번역 박스 / 카드 같은 비동기 로드로 리스트 높이가 늘어날 때
  // 사용자가 바닥 근처에 있다면 자동으로 다시 바닥. (멀리 위에 있다면 그대로 둠)
  React.useEffect(() => {
    const list = messageListRef.current;
    if (!list || typeof ResizeObserver === 'undefined') return;
    let lastSize = 0;
    const ro = new ResizeObserver(() => {
      const cur = list.scrollHeight;
      if (cur === lastSize) return;
      const grew = cur > lastSize;
      lastSize = cur;
      if (!grew) return;
      const distance = list.scrollHeight - list.scrollTop - list.clientHeight;
      // 240px 이내(이미지 한 장 정도) 면 바닥으로 따라가기. 초기 진입 직후엔 distance 가 0~큰값 모두
      // 가능하므로 initialScrolledRef 와 무관하게 적용.
      if (distance < 240) scrollToBottom(false);
    });
    ro.observe(list);
    // 자식 변화도 감지 (메시지 카드 추가/제거)
    const mo = new MutationObserver(() => {
      const cur = list.scrollHeight;
      if (cur !== lastSize) {
        const grew = cur > lastSize;
        lastSize = cur;
        if (grew) {
          const distance = list.scrollHeight - list.scrollTop - list.clientHeight;
          if (distance < 240) scrollToBottom(false);
        }
      }
    });
    mo.observe(list, { childList: true, subtree: true });
    return () => { ro.disconnect(); mo.disconnect(); };
  }, [scrollToBottom]);

  // 스크롤 위치 localStorage 저장 (throttled via rAF) + floating "↓" 버튼 노출 결정.
  const saveScrollRaf = React.useRef(0);
  const handleScrollSave = React.useCallback(() => {
    if (saveScrollRaf.current) return;
    saveScrollRaf.current = window.requestAnimationFrame(() => {
      saveScrollRaf.current = 0;
      const el = messageListRef.current;
      if (!el || !activeConv) return;
      const key = scrollKey(activeConv.id);
      if (!key) return;
      try { localStorage.setItem(key, String(el.scrollTop)); } catch { /* quota */ }
      // 사이클 N+15-E — 바닥 거리 측정 → floating 버튼 토글.
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      setShowScrollToBottom((cur) => {
        const next = distance > 240;
        // 바닥 근처로 돌아가면 pending count 도 리셋
        if (cur && !next) setPendingNewCount(0);
        return next;
      });
    });
  }, [activeConv?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // 대화 전환 시 "초기 스크롤 미완료" 플래그 리셋
  const initialScrolledRef = React.useRef(false);
  const prevMessageCount = React.useRef(0);
  React.useEffect(() => {
    initialScrolledRef.current = false;
    prevMessageCount.current = 0;
    setShowScrollToBottom(false);
    setPendingNewCount(0);
  }, [activeConv?.id]);

  // 메시지 렌더 시 스크롤 처리
  // - 초기 로드: localStorage 에 저장된 위치 복원 (없으면 바닥)
  // - 이후 새 메시지: sticky-to-bottom (바닥 근처면 자동 스크롤, 위 읽는 중이면 유지)
  React.useLayoutEffect(() => {
    const next = convMessages.length;
    const prev = prevMessageCount.current;
    prevMessageCount.current = next;

    if (next === 0) return;

    if (!initialScrolledRef.current) {
      initialScrolledRef.current = true;
      // 채팅방 진입 시 — 항상 마지막 메시지로 (옛 스크롤 위치 복원 X).
      // 사용자가 채팅방을 새로 클릭하면 마지막 대화부터 보는 게 자연스러움.
      scrollToBottom(false);
      return;
    }

    if (next > prev) {
      // 새 메시지 도착 — 본인이 보낸 메시지면 무조건 바닥, 타인 메시지면 sticky-to-bottom (가까울 때만)
      const last = convMessages[convMessages.length - 1];
      const isMine = user && last && Number(last.sender_id) === Number(user.id);
      const list = messageListRef.current;
      if (isMine || !list) { scrollToBottom(); return; }
      const distance = list.scrollHeight - list.scrollTop - list.clientHeight;
      if (distance < 120) {
        scrollToBottom();
      } else {
        // 사이클 N+15-E — 사용자가 위로 스크롤 중일 때 새 타인 메시지 도착: pending count +1.
        // floating ↓ 버튼에 뱃지로 노출됨. 바닥 도달 시 자동 리셋.
        setPendingNewCount((c) => c + (next - prev));
      }
    }
  }, [convMessages, scrollToBottom, activeConv?.id, user]);

  // 번역 도착 시 sticky-to-bottom — 마지막 메시지의 translations 가 추가/변경되면
  // 메시지 카드 높이가 늘어 마지막 메시지가 가려질 수 있음. 가까이 있으면 다시 바닥.
  const lastMsgTranslationKey = convMessages.length > 0
    ? `${convMessages[convMessages.length - 1].id}:${convMessages[convMessages.length - 1].translations ? Object.keys(convMessages[convMessages.length - 1].translations || {}).join(',') : ''}`
    : '';
  React.useEffect(() => {
    if (!lastMsgTranslationKey) return;
    const list = messageListRef.current;
    if (!list) return;
    const distance = list.scrollHeight - list.scrollTop - list.clientHeight;
    // 200px 이내면 바닥으로 (메시지 + 번역 박스 높이 고려)
    if (distance < 200) scrollToBottom();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastMsgTranslationKey]);

  // 한글 IME 조합 상태 추적 — composition 중 Enter 는 확정 trigger 라서 전송하면 안 됨
  const composingRef = React.useRef(false);
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // e.nativeEvent.isComposing 또는 keyCode 229 는 IME 조합 중임을 의미
    // composingRef 까지 병행 체크 (브라우저/OS 조합에 따라 isComposing 이 false 로 들어올 수 있음)
    if (e.nativeEvent.isComposing || (e.nativeEvent as KeyboardEvent).keyCode === 229 || composingRef.current) {
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };
  const handleCompositionStart = () => { composingRef.current = true; };
  const handleCompositionEnd = () => { composingRef.current = false; };

  const handleDraftSendAsIs = (messageId: number) => {
    onCueDraftSend(messageId);
  };

  const handleDraftEdit = (messageId: number) => {
    const msg = convMessages.find((m) => m.id === messageId);
    if (msg?.cue_draft) {
      setEditingDraftId(messageId);
      setDraftBody(msg.cue_draft.body);
    }
  };

  const handleDraftEditSave = (messageId: number) => {
    onCueDraftSend(messageId, draftBody);
    setEditingDraftId(null);
    setDraftBody('');
  };

  // Cue 답변 대기 카운트 — 담당자에게만 노출
  const cueDraftCount = convMessages.filter((m) => m.cue_draft).length;

  // Cue draft 뱃지 클릭 시 첫 draft 메시지로 스크롤
  const scrollToFirstDraft = () => {
    const firstDraft = convMessages.find((m) => m.cue_draft);
    if (!firstDraft) return;
    const el = document.querySelector(`[data-msg-id="${firstDraft.id}"]`);
    if (el && el instanceof HTMLElement) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.style.transition = 'background 0.3s';
      el.style.background = 'rgba(244, 63, 94, 0.08)';
      setTimeout(() => { el.style.background = ''; }, 1500);
    }
  };

  // 활성 대화가 없을 때만 EmptyState. 독립 대화(project null)도 activeConv 가 있으면 그대로 렌더.
  if (!activeConv && !project) {
    return (
      <Container $mobileHidden={mobileHidden}>
        <EmptyState
          icon={
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          }
          title={t('chat.noProject', '대화를 시작해 보세요')}
          description={<>
            {t('chat.noProjectLine1', '실시간 채팅, 업무 관리, 프로젝트 연동을 위한')}
            <br />
            {t('chat.noProjectLine2', '대화채널을 만들어드립니다.')}
          </>}
          ctaLabel={onOpenNewChat ? t('chat.noProjectCta', '새 대화 시작') : undefined}
          ctaIcon={
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          }
          onCta={onOpenNewChat}
        />
      </Container>
    );
  }

  if (!activeConv && project) {
    return (
      <Container $mobileHidden={mobileHidden}>
        <HeaderBar>
          <HeaderLeft>
            {onMobileBack && (
              <MobileBackBtn type="button" onClick={onMobileBack} aria-label={t('chat.back', '리스트로 돌아가기') as string} title={t('chat.back', '리스트로 돌아가기') as string}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="15 18 9 12 15 6"/></svg>
              </MobileBackBtn>
            )}
            {leftCollapsed && (
              <IconBtn onClick={onToggleLeft} title={t('chat.expandLeft', '좌측 열기') as string}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </IconBtn>
            )}
            <HeaderTitleBlock>
              <ChatNameRow>
                <ChatName $editable={false}>{project.name}</ChatName>
              </ChatNameRow>
            </HeaderTitleBlock>
          </HeaderLeft>
        </HeaderBar>
        <EmptyState
          icon={
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          }
          title={t('chat.noChannel', '대화 채널이 없습니다')}
          description={t('chat.noChannelDesc', '좌측에서 채널을 선택하거나 새 채널을 만드세요.')}
        />
      </Container>
    );
  }

  return (
    <Container
      $mobileHidden={mobileHidden}
      onDragEnter={(e) => {
        if (!activeConversationId) return;
        // 파일 드래그만 반응 (텍스트/링크는 무시)
        const types = e.dataTransfer?.types;
        if (types && Array.from(types).includes('Files')) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragOver={(e) => {
        if (!activeConversationId) return;
        const types = e.dataTransfer?.types;
        if (types && Array.from(types).includes('Files')) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }
      }}
      onDragLeave={(e) => {
        // 자식으로 진입 시에도 leave 가 fire 되므로 currentTarget 검사
        if (e.currentTarget === e.target) setDragOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (!activeConversationId) return;
        const files = Array.from(e.dataTransfer?.files || []);
        if (files.length > 0) uploadMany(files);
      }}
    >
      {dragOver && <DropOverlay>{t('chat.dropHere', '여기에 놓아 업로드') as string}</DropOverlay>}
      {/* 헤더: 채팅방 이름이 주인공, 프로젝트는 서브라벨 */}
      <HeaderBar>
        <HeaderLeft>
          {onMobileBack && (
            <MobileBackBtn type="button" onClick={onMobileBack} aria-label={t('chat.back', '리스트로 돌아가기') as string} title={t('chat.back', '리스트로 돌아가기') as string}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="15 18 9 12 15 6"/></svg>
            </MobileBackBtn>
          )}
          {leftCollapsed && (
            <IconBtn onClick={onToggleLeft} title={t('chat.expandLeft', '좌측 열기')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </IconBtn>
          )}
          <HeaderTitleBlock>
            {editingName ? (
              <ChatNameInput
                autoFocus
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={commitNameEdit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); commitNameEdit(); }
                  if (e.key === 'Escape') { setNameDraft(activeConv.name); setEditingName(false); }
                }}
              />
            ) : (
              <ChatNameRow>
                <ChatName
                  onClick={() => !isClient && setEditingName(true)}
                  title={!isClient ? t('chat.rename', '클릭해서 이름 수정') : undefined}
                  $editable={!isClient}
                >
                  {activeConv.name}
                </ChatName>
                {/* '내부' 는 default 라 라벨 X — '고객' 만 강조 (B2B 시각 패턴) */}
                {activeConv.channel_type === 'customer' && <CustomerTag>{t('channelBadge.customer', '고객')}</CustomerTag>}
              </ChatNameRow>
            )}
            {project && (
              <ProjectSublabel>
                <SublabelIcon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                </SublabelIcon>
                <span>{t('chat.inProject', '소속')}:</span>
                <ProjectLink>{project.name}</ProjectLink>
              </ProjectSublabel>
            )}
          </HeaderTitleBlock>
        </HeaderLeft>
        <HeaderRight>
          {/* 같은 프로젝트의 다른 채널 빠른 전환 — breadcrumb 대체 */}
          {channels.length > 1 && (
            <ChannelQuickSwitch>
              {channels.filter((c) => c.id !== activeConv.id).map((c) => (
                <QuickSwitchBtn key={c.id} onClick={() => onSelectConversation(c.id)} title={c.name}>
                  <QuickHash $type={c.channel_type}>
                    {c.channel_type === 'customer' ? '#' : '·'}
                  </QuickHash>
                  {c.name}
                  {c.unread_count > 0 && <QuickBadge>{c.unread_count}</QuickBadge>}
                </QuickSwitchBtn>
              ))}
            </ChannelQuickSwitch>
          )}
          {/* 도움말 — 우하단 FAB 가 채팅 입력란을 가려서 자동 숨김. 헤더에 인라인으로 노출. */}
          <IconBtn
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent('cue:ask', { detail: {} }))}
            title={t('chat.help', '도움말 / 피드백') as string}
            aria-label={t('chat.help', '도움말 / 피드백') as string}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
              <line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
          </IconBtn>
          {!isClient && onOpenSettings && (
            <IconBtn type="button" onClick={onOpenSettings} title={t('chat.openSettings', '채팅 설정') as string} aria-label={t('chat.openSettings', '채팅 설정') as string}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
            </IconBtn>
          )}
          {rightCollapsed && (
            <IconBtn onClick={onToggleRight} title={t('chat.expandRight', '우측 열기')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </IconBtn>
          )}
        </HeaderRight>
      </HeaderBar>

      {/* 사이클 N+16-E — 핀 공지 영역 (Slack 패턴). 1개 이상 핀 시 헤더 아래 노란 액센트 바.
          접힘: "📌 공지 N개" 한 줄. 펴짐: 핀 메시지 리스트, 클릭 시 본문으로 스크롤 + 잠시 강조. */}
      {pinnedMessages.length > 0 && (
        <PinnedBar>
          <PinnedHeader type="button" onClick={() => setPinnedBarOpen((v) => !v)} aria-expanded={pinnedBarOpen}>
            <PinIcon viewBox="0 0 24 24" fill="currentColor"><path d="M14 4l-1 1 1 1-4 4-4-1-1 1 4 4-5 5 1 1 5-5 4 4 1-1-1-4 4-4 1 1 1-1z"/></PinIcon>
            <PinnedTitle>{t('chat.pinned.count', { count: pinnedMessages.length, defaultValue: `공지 ${pinnedMessages.length}개` })}</PinnedTitle>
            <PinChevron $open={pinnedBarOpen} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </PinChevron>
          </PinnedHeader>
          {pinnedBarOpen && (
            <PinnedList>
              {pinnedMessages.map((m) => (
                <PinnedItem key={m.id} type="button" onClick={() => scrollToMessage(m.id)}>
                  <PinnedSender>{m.sender_name}</PinnedSender>
                  <PinnedBody>{m.body || (m.attachments?.length ? `[첨부 ${m.attachments.length}개]` : '')}</PinnedBody>
                  <PinnedTime>{formatGroupTime(m.pinned_at || m.created_at)}</PinnedTime>
                  {canPinMessage && (
                    <PinnedUnpinBtn
                      type="button"
                      onClick={(e) => { e.stopPropagation(); handleTogglePinMsg(m); }}
                      title={t('chat.pinned.unpin', '공지 해제') as string}
                      aria-label={t('chat.pinned.unpin', '공지 해제') as string}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
                    </PinnedUnpinBtn>
                  )}
                </PinnedItem>
              ))}
            </PinnedList>
          )}
        </PinnedBar>
      )}

      {/* 사이클 N+16-E — 묶음 선택 모드 액션 바 */}
      {selectionMode && (
        <SelectionBar>
          <SelectionCount>{t('chat.selection.count', { count: selectedMsgIds.size, defaultValue: `${selectedMsgIds.size}개 선택됨` })}</SelectionCount>
          <SelectionActions>
            <SelectionBtn type="button" disabled={selectedMsgIds.size === 0} onClick={handleBulkCopy}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
              {t('chat.selection.copy', '복사')}
            </SelectionBtn>
            <SelectionBtn type="button" $danger disabled={selectedMsgIds.size === 0} onClick={() => setConfirmDeleteId(-1)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>
              </svg>
              {t('chat.selection.delete', '삭제')}
            </SelectionBtn>
            <SelectionCancel type="button" onClick={exitSelection}>{t('chat.selection.cancel', '취소')}</SelectionCancel>
          </SelectionActions>
        </SelectionBar>
      )}

      {/* 업무 후보 알림 배너 — pending 후보가 있을 때만 (안내 전용 — 우측 패널이 이미 열려 있으니 X 로 닫기만) */}
      {!isClient && candidatesCount > 0 && !bannerDismissed && (
        <CandidatesBannerWrap>
          <CandidatesBanner>
            <BannerText>
              {t('chat.banner.candidatesPending', { count: candidatesCount })}
            </BannerText>
            <BannerCloseBtn type="button" onClick={() => setBannerDismissed(true)} aria-label={t('chat.banner.dismiss', '닫기') as string}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </BannerCloseBtn>
          </CandidatesBanner>
        </CandidatesBannerWrap>
      )}

      {/* 메시지 흐름 */}
      <MessageList ref={messageListRef} onScroll={handleScrollSave}>
        {/* 사이클 N+15-A — 메시지 lazy-load 중일 때 skeleton 3행. 빈 conv 와 분리. */}
        {messagesLoading && convMessages.length === 0 && (
          <SkeletonMessages aria-busy="true" aria-label="loading messages">
            <SkelMsgRow $align="left">
              <SkelMsgAvatar />
              <SkelMsgBubble $width="60%" />
            </SkelMsgRow>
            <SkelMsgRow $align="right">
              <SkelMsgBubble $width="45%" $mine />
            </SkelMsgRow>
            <SkelMsgRow $align="left">
              <SkelMsgAvatar />
              <SkelMsgBubble $width="70%" />
            </SkelMsgRow>
          </SkeletonMessages>
        )}
        {!messagesLoading && convMessages.length === 0 && (
          <NoMsgBox>{t('chat.noMessages', '첫 메시지를 보내세요')}</NoMsgBox>
        )}
        {convMessages.map((m, idx) => {
          const prev = idx > 0 ? convMessages[idx - 1] : undefined;
          const continuation = isContinuation(m, prev);
          // 사이클 N+16-E — 메시지 액션 권한 + 상태
          const isSender = user && Number(m.sender_id) === Number(user.id);
          const isDeleted = !!m.is_deleted;
          const isEditing = editingMsgId === m.id;
          const isPinned = !!m.pinned_at;
          const isSelected = selectedMsgIds.has(m.id);
          const isFlash = pinnedBarFlashId === m.id;
          const canEditThis = isSender && !isDeleted && m.sender_role !== 'cue' && !m.card;
          const canDeleteThis = (isSender || isOwnerOrAdmin) && !isDeleted && m.sender_role !== 'cue';
          const canPinThis = canPinMessage && !isDeleted;
          return (
          <MessageItem
            key={m.id}
            data-msg-id={m.id}
            $continuation={continuation}
            $selected={selectionMode && isSelected}
            $flashing={isFlash}
            $pinned={isPinned}
            onClick={selectionMode && !isDeleted ? () => toggleSelected(m.id) : undefined}
            $clickable={selectionMode && !isDeleted}
          >
            {selectionMode && (
              <MsgCheckbox $checked={isSelected} $disabled={isDeleted} aria-hidden="true">
                {isSelected && (
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </MsgCheckbox>
            )}
            {continuation ? (
              <AvatarSpacer aria-hidden="true" />
            ) : m.sender_role === 'cue' ? (
              // Cue 는 AI — 프로필 popover 없음
              <LetterAvatar name={m.sender_name} size={36} variant="cue" />
            ) : (
              // 사이클 N+16-D — 아바타 클릭 시 발신자 정보 popover (SenderName 과 동일 동작)
              <AvatarBtn
                type="button"
                onClick={(e) => { e.stopPropagation(); if (selectionMode) return; setUserPopover({ userId: m.sender_id, anchorEl: e.currentTarget }); }}
                title={t('chat.openUserInfo', '프로필 보기') as string}
                aria-label={t('chat.openUserInfo', '프로필 보기') as string}
              >
                <LetterAvatar name={m.sender_name} size={36} variant="neutral" />
              </AvatarBtn>
            )}
            <MessageBody>
              {!continuation && (
                <MessageHeader>
                  {m.sender_role === 'cue' ? (
                    // Cue 는 AI — 정보 popover 없음
                    <SenderName as="span" style={{ cursor: 'default' }}>{m.sender_name}</SenderName>
                  ) : (
                    <SenderName
                      type="button"
                      onClick={(e) => { e.stopPropagation(); if (selectionMode) return; setUserPopover({ userId: m.sender_id, anchorEl: e.currentTarget }); }}
                      title={t('chat.openUserInfo', '프로필 보기') as string}
                    >
                      {m.sender_name}
                    </SenderName>
                  )}
                  <TimeStamp>{formatGroupTime(m.created_at)}</TimeStamp>
                  {m.is_edited && !m.is_deleted && <EditedMark>({t('chat.edited', '수정됨')})</EditedMark>}
                  {m.sender_role === 'cue' && <CueBadge>Cue</CueBadge>}
                </MessageHeader>
              )}
              {isDeleted ? (
                <DeletedPlaceholder>{t('chat.deleted', '삭제된 메시지입니다')}</DeletedPlaceholder>
              ) : isEditing ? (
                <EditFormWrap>
                  <EditTextArea
                    value={editingMsgDraft}
                    autoFocus
                    rows={Math.min(8, Math.max(2, editingMsgDraft.split('\n').length))}
                    onChange={(e) => setEditingMsgDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') { e.preventDefault(); handleEditCancel(); }
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleEditSave(); }
                    }}
                  />
                  <EditActions>
                    <EditBtn type="button" onClick={handleEditCancel}>{t('chat.editCancel', '취소')}</EditBtn>
                    <EditBtn type="button" $primary disabled={!editingMsgDraft.trim()} onClick={handleEditSave}>
                      {t('chat.editSave', '저장')}
                    </EditBtn>
                    <EditHint>{t('chat.editHint', 'Esc 취소 · ⌘+Enter 저장')}</EditHint>
                  </EditActions>
                </EditFormWrap>
              ) : m.card?.card_type === 'signature_request' ? (
                <SignCard onClick={() => window.open(m.card!.card_type === 'signature_request' ? (m.card as { sign_url: string }).sign_url : '', '_blank', 'noopener,noreferrer')}>
                  <SignCardIcon>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>
                  </SignCardIcon>
                  <DocCardBody>
                    <DocCardTitle>{(m.card as { title: string }).title}</DocCardTitle>
                    <DocCardLabel>{t('chat.card.signLabel', '서명 요청')} · {(m.card as { signers: { status: string }[] }).signers.length}{t('chat.card.signerSuffix', '명')}</DocCardLabel>
                  </DocCardBody>
                  <DocCardArrow>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                  </DocCardArrow>
                </SignCard>
              ) : m.card?.card_type === 'invoice' ? (
                (() => {
                  const ic = m.card as import('./types').InvoiceCardMeta;
                  const paid = ic.status === 'paid';
                  const partial = ic.status === 'partially_paid';
                  const canceled = ic.status === 'canceled';
                  const notified = !!ic.last_notify_at && !paid;
                  const fmt = (n: number) =>
                    ic.currency === 'KRW' ? '₩' + Number(n).toLocaleString('ko-KR') :
                    `${ic.currency} ${Number(n).toLocaleString()}`;
                  return (
                    <InvoiceCard
                      type="button"
                      $paid={paid}
                      $notified={notified}
                      $canceled={canceled}
                      onClick={() => window.open(ic.share_url, '_blank', 'noopener,noreferrer')}
                    >
                      <InvCardIcon $paid={paid} $notified={notified}>
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="2" y="5" width="20" height="14" rx="2"/>
                          <line x1="2" y1="10" x2="22" y2="10"/>
                          <line x1="6" y1="15" x2="10" y2="15"/>
                        </svg>
                      </InvCardIcon>
                      <DocCardBody>
                        <DocCardTitle>{ic.title}</DocCardTitle>
                        <InvCardSub>
                          {ic.invoice_number} · {fmt(ic.total)}
                          {ic.installment_mode === 'split' && <> · {t('chat.card.invoiceSplit', '분할')}</>}
                        </InvCardSub>
                        <InvCardStatus $paid={paid} $notified={notified} $canceled={canceled}>
                          {paid && t('chat.card.invoicePaid', '결제 완료')}
                          {!paid && partial && t('chat.card.invoicePartial', '부분 결제')}
                          {!paid && !partial && canceled && t('chat.card.invoiceCanceled', '취소됨')}
                          {!paid && !partial && !canceled && notified && t('chat.card.invoiceNotified', '송금 완료 알림 받음')}
                          {!paid && !partial && !canceled && !notified && t('chat.card.invoiceLabel', '결제 요청')}
                        </InvCardStatus>
                      </DocCardBody>
                      <DocCardArrow>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                      </DocCardArrow>
                    </InvoiceCard>
                  );
                })()
              ) : m.card?.card_type === 'task' ? (
                (() => {
                  const tc = m.card as import('./types').TaskCardMeta;
                  return (
                    <SharedCard type="button" onClick={() => window.open(tc.share_url, '_blank', 'noopener,noreferrer')}>
                      <SharedCardIcon $tone="task">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
                      </SharedCardIcon>
                      <DocCardBody>
                        <DocCardTitle>{tc.title}</DocCardTitle>
                        <DocCardLabel>
                          {t('chat.card.taskLabel', { defaultValue: '업무' }) as string}
                          {tc.due_date && <> · {String(tc.due_date).slice(0, 10)}</>}
                          {tc.has_password && <> · {t('chat.card.locked', { defaultValue: '🔒 비번 보호' }) as string}</>}
                        </DocCardLabel>
                      </DocCardBody>
                      <DocCardArrow>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                      </DocCardArrow>
                    </SharedCard>
                  );
                })()
              ) : m.card?.card_type === 'file' ? (
                (() => {
                  const fc = m.card as import('./types').FileCardMeta;
                  const fmt = (b: number) => {
                    if (b < 1024) return `${b} B`;
                    if (b < 1024 * 1024) return `${(b/1024).toFixed(1)} KB`;
                    return `${(b/1024/1024).toFixed(1)} MB`;
                  };
                  return (
                    <SharedCard type="button" onClick={() => window.open(fc.share_url, '_blank', 'noopener,noreferrer')}>
                      <SharedCardIcon $tone="file">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>
                      </SharedCardIcon>
                      <DocCardBody>
                        <DocCardTitle>{fc.title}</DocCardTitle>
                        <DocCardLabel>
                          {t('chat.card.fileLabel', { defaultValue: '파일' }) as string}
                          {typeof fc.file_size === 'number' && fc.file_size > 0 && <> · {fmt(fc.file_size)}</>}
                          {fc.has_password && <> · {t('chat.card.locked', { defaultValue: '🔒 비번 보호' }) as string}</>}
                        </DocCardLabel>
                      </DocCardBody>
                      <DocCardArrow>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                      </DocCardArrow>
                    </SharedCard>
                  );
                })()
              ) : m.card?.card_type === 'kb_document' ? (
                (() => {
                  const kc = m.card as import('./types').KbDocCardMeta;
                  return (
                    <SharedCard type="button" onClick={() => window.open(kc.share_url, '_blank', 'noopener,noreferrer')}>
                      <SharedCardIcon $tone="kb">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
                      </SharedCardIcon>
                      <DocCardBody>
                        <DocCardTitle>{kc.title}</DocCardTitle>
                        <DocCardLabel>
                          {t('chat.card.kbLabel', { defaultValue: '대화 자료' }) as string}
                          {kc.source_type && <> · {kc.source_type}</>}
                          {kc.has_password && <> · {t('chat.card.locked', { defaultValue: '🔒 비번 보호' }) as string}</>}
                        </DocCardLabel>
                      </DocCardBody>
                      <DocCardArrow>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                      </DocCardArrow>
                    </SharedCard>
                  );
                })()
              ) : m.card?.card_type === 'calendar_event' ? (
                (() => {
                  const ec = m.card as import('./types').CalendarEventCardMeta;
                  const fmt = (iso?: string) => {
                    if (!iso) return '';
                    try {
                      const d = new Date(iso);
                      return d.toLocaleString(undefined, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' });
                    } catch { return ''; }
                  };
                  return (
                    <SharedCard type="button" onClick={() => window.open(ec.share_url, '_blank', 'noopener,noreferrer')}>
                      <SharedCardIcon $tone="calendar">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                      </SharedCardIcon>
                      <DocCardBody>
                        <DocCardTitle>{ec.title}</DocCardTitle>
                        <DocCardLabel>
                          {t('chat.card.calendarLabel', { defaultValue: '일정' }) as string}
                          {ec.start_at && <> · {fmt(ec.start_at)}</>}
                          {ec.has_password && <> · {t('chat.card.locked', { defaultValue: '🔒 비번 보호' }) as string}</>}
                        </DocCardLabel>
                      </DocCardBody>
                      <DocCardArrow>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                      </DocCardArrow>
                    </SharedCard>
                  );
                })()
              ) : m.card ? (
                <DocCard type="button" onClick={() => setPreviewCard(m.card as import('./types').PostCardMeta)}>
                  <DocCardIcon>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                  </DocCardIcon>
                  <DocCardBody>
                    <DocCardTitle>{m.card.title}</DocCardTitle>
                    <DocCardLabel>{t('chat.card.docLabel', 'PlanQ 문서')}</DocCardLabel>
                  </DocCardBody>
                  <DocCardArrow>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                  </DocCardArrow>
                </DocCard>
              ) : (
                m.body && m.body.trim() && (() => {
                  // 번역 표시 — robust fallback:
                  // 1) detected_language 가 있으면 그것 외 키
                  // 2) 없으면 m.body 와 다른 첫 번째 번역
                  // 3) 그래도 없으면 미표시
                  const tr = m.translations;
                  let translated: string | undefined;
                  if (tr) {
                    const validKeys = Object.keys(tr).filter(k => tr[k as keyof typeof tr]);
                    const detected = m.detected_language;
                    const otherKey = (detected && validKeys.find(k => k !== detected))
                      || validKeys.find(k => tr[k as keyof typeof tr] !== m.body);
                    if (otherKey) translated = tr[otherKey as keyof typeof tr];
                  }
                  return (
                    <>
                      <MessageText $question={!!m.is_question}>{renderTextWithLinks(m.body)}</MessageText>
                      {translated && <TranslatedText>{renderTextWithLinks(translated)}</TranslatedText>}
                    </>
                  );
                })()
              )}
              {!isDeleted && m.card?.note && <CardNote>{m.card.note}</CardNote>}

              {!isDeleted && m.attachments && m.attachments.length > 0 && (
                <AttachRow>
                  {m.attachments.map((a) => {
                    const isImg = (a.mime_type || '').startsWith('image/');
                    const imgSrc = `/api/message-attachments/${a.id}/raw`;
                    return isImg ? (
                      // <img> / <a target=_blank> 모두 인증헤더 못 실음 → /raw (image only, public)
                      <AttachImageLink key={a.id} href={imgSrc} target="_blank" rel="noreferrer">
                        <AttachImage
                          src={imgSrc}
                          alt={a.file_name}
                          onLoad={() => {
                            // 이미지 로드되면 컨텐츠 높이가 늘어남 → 마지막 메시지가 viewport 밖으로 밀림
                            // 사용자가 거의 끝에 있을 때만 다시 스크롤 (위로 올려둔 상태면 방해 안 함)
                            const list = messageListRef.current;
                            if (!list) return;
                            const distance = list.scrollHeight - list.scrollTop - list.clientHeight;
                            if (distance < 240) scrollToBottom(false);
                          }}
                        />
                      </AttachImageLink>
                    ) : (
                      // 비이미지: 클릭 시 JS fetch (auth header + refresh) → blob → 다운로드 트리거
                      <AttachFileLink key={a.id} as="button" type="button" title={a.file_name}
                        onClick={() => downloadAttachment(a.id, a.file_name)}>
                        <AttachIcon>{a.file_name.split('.').pop()?.slice(0, 3).toUpperCase() || 'FILE'}</AttachIcon>
                        <AttachName>{a.file_name}</AttachName>
                        <AttachSize>{(a.file_size / 1024).toFixed(0)}KB</AttachSize>
                      </AttachFileLink>
                    );
                  })}
                </AttachRow>
              )}

              {/* 출처 인용 (Cue 메시지일 때) */}
              {!isDeleted && m.ai_sources && m.ai_sources.length > 0 && (
                <SourceBox>
                  <SourceLabel>{t('chat.draft.sourceLabel', '출처')}</SourceLabel>
                  {m.ai_sources.map((s, i) => (
                    <SourceItem key={i}>{s.title} · {s.section}</SourceItem>
                  ))}
                </SourceBox>
              )}

              {/* 질문 아래 Cue 답변 대기 카드 (담당자만) */}
              {!isDeleted && m.is_question && m.cue_draft && !isClient && (
                <CueDraftCard $locked={!!m.cue_draft.processing_by}>
                  <DraftHeader>
                    <DraftLabel>
                      <DraftDot />
                      {t('chat.draft.title', 'Cue 답변 대기')}
                      <Confidence>{Math.round(m.cue_draft.confidence * 100)}%</Confidence>
                    </DraftLabel>
                    {m.cue_draft.processing_by && (
                      <LockInfo>
                        <LockDot />
                        {m.cue_draft.processing_by.name} {t('chat.draft.processing', '처리 중')}
                      </LockInfo>
                    )}
                  </DraftHeader>
                  {editingDraftId === m.id ? (
                    <DraftEditArea
                      value={draftBody}
                      onChange={(e) => setDraftBody(e.target.value)}
                      autoFocus
                      rows={4}
                    />
                  ) : (
                    <DraftBody>{m.cue_draft.body}</DraftBody>
                  )}
                  {m.cue_draft.source && (
                    <DraftSource>
                      {m.cue_draft.source.title} · {m.cue_draft.source.section}
                    </DraftSource>
                  )}
                  <DraftActions>
                    {editingDraftId === m.id ? (
                      <>
                        <DraftBtn $primary onClick={() => handleDraftEditSave(m.id)}>
                          {t('chat.draft.sendEdited', '수정본 전송')}
                        </DraftBtn>
                        <DraftBtn $ghost onClick={() => setEditingDraftId(null)}>
                          {t('chat.draft.cancel', '취소')}
                        </DraftBtn>
                      </>
                    ) : (
                      <>
                        <DraftBtn
                          $primary
                          disabled={!!m.cue_draft.processing_by}
                          onClick={() => handleDraftSendAsIs(m.id)}
                        >
                          {t('chat.draft.send', '그대로 전송')}
                        </DraftBtn>
                        <DraftBtn
                          disabled={!!m.cue_draft.processing_by}
                          onClick={() => handleDraftEdit(m.id)}
                        >
                          {t('chat.draft.edit', '수정')}
                        </DraftBtn>
                        <DraftBtn $ghost onClick={() => onCueDraftReject(m.id)}>
                          {t('chat.draft.reject', '거절')}
                        </DraftBtn>
                      </>
                    )}
                  </DraftActions>
                </CueDraftCard>
              )}
              {/* 사이클 N+15-C — 읽음 표시. 내가 보낸 메시지만, 시스템 메시지/Cue 제외.
                  1:1 (other_count <= 1): "읽음" / "전송됨" / (둘 다 아닐 때 nothing).
                  그룹 (other_count >= 2): "읽음 N/M" (N==M 일 때 그냥 "전체 읽음"). */}
              {!isDeleted && user && Number(m.sender_id) === Number(user.id) && m.sender_role !== 'cue' && typeof m.other_count === 'number' && m.other_count > 0 && (() => {
                const read = m.read_by_count ?? 0;
                const total = m.other_count;
                if (total <= 1) {
                  return <ReadMark $read={read >= 1}>{read >= 1 ? t('chat.read.read', '읽음') : t('chat.read.sent', '전송됨')}</ReadMark>;
                }
                if (read >= total) return <ReadMark $read>{t('chat.read.allRead', '전체 읽음')}</ReadMark>;
                if (read > 0) return <ReadMark $read>{t('chat.read.someRead', { read, total, defaultValue: '읽음 {{read}}/{{total}}' }) as string}</ReadMark>;
                return <ReadMark $read={false}>{t('chat.read.sent', '전송됨')}</ReadMark>;
              })()}
            </MessageBody>
            {/* 사이클 N+16-E — hover toolbar (Slack 패턴). 데스크탑 hover / 모바일 long-press 패턴은 추후 추가.
                선택 모드 / 편집 모드 / 삭제된 메시지 / Cue 메시지는 toolbar 숨김. */}
            {!selectionMode && !isEditing && !isDeleted && m.sender_role !== 'cue' && (
              <MessageToolbar>
                <ToolBarBtn type="button" onClick={(e) => { e.stopPropagation(); handleCopyText(m.body || ''); }} title={t('chat.action.copy', '메시지 복사') as string} aria-label={t('chat.action.copy', '메시지 복사') as string}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                  </svg>
                </ToolBarBtn>
                {canEditThis && (
                  <ToolBarBtn type="button" onClick={(e) => { e.stopPropagation(); handleEditStart(m); }} title={t('chat.action.edit', '수정') as string} aria-label={t('chat.action.edit', '수정') as string}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                  </ToolBarBtn>
                )}
                {canPinThis && (
                  <ToolBarBtn
                    type="button"
                    onClick={(e) => { e.stopPropagation(); handleTogglePinMsg(m); }}
                    title={isPinned ? t('chat.action.unpin', '공지 해제') as string : t('chat.action.pin', '공지로 고정') as string}
                    aria-label={isPinned ? t('chat.action.unpin', '공지 해제') as string : t('chat.action.pin', '공지로 고정') as string}
                    $active={isPinned}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill={isPinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 4l-1 1 1 1-4 4-4-1-1 1 4 4-5 5 1 1 5-5 4 4 1-1-1-4 4-4 1 1 1-1z"/>
                    </svg>
                  </ToolBarBtn>
                )}
                <ToolBarMoreRoot data-more-menu={m.id}>
                  <ToolBarBtn type="button" onClick={(e) => { e.stopPropagation(); setMoreMenuMsgId((cur) => cur === m.id ? null : m.id); }} title={t('chat.action.more', '더보기') as string} aria-label={t('chat.action.more', '더보기') as string} $active={moreMenuMsgId === m.id}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg>
                  </ToolBarBtn>
                  {moreMenuMsgId === m.id && (
                    <ToolBarMore role="menu">
                      <ToolBarMoreItem type="button" onClick={(e) => { e.stopPropagation(); setMoreMenuMsgId(null); setSelectionMode(true); setSelectedMsgIds(new Set([m.id])); }}>
                        {t('chat.action.selectMulti', '여러 메시지 선택')}
                      </ToolBarMoreItem>
                      {canDeleteThis && (
                        <ToolBarMoreItem type="button" $danger onClick={(e) => { e.stopPropagation(); setMoreMenuMsgId(null); setConfirmDeleteId(m.id); }}>
                          {t('chat.action.delete', '삭제')}
                        </ToolBarMoreItem>
                      )}
                    </ToolBarMore>
                  )}
                </ToolBarMoreRoot>
              </MessageToolbar>
            )}
          </MessageItem>
          );
        })}
        {/* 스크롤 sentinel — scrollHeight 계산 없이 안정적으로 마지막 위치로 점프 가능 */}
        <div ref={messagesEndRef} aria-hidden="true" style={{ height: 1 }} />
      </MessageList>
      {/* 사이클 N+15-E — 스크롤-바닥 floating 버튼. 위로 240px+ 떨어졌을 때만 노출.
          새 타인 메시지 도착 시 pending count 뱃지. 클릭 → smooth scroll 바닥. */}
      {showScrollToBottom && (
        <ScrollToBottomBtn
          type="button"
          onClick={() => { scrollToBottom(); setPendingNewCount(0); }}
          aria-label={t('chat.scrollToBottom', '맨 아래로') as string}
          title={t('chat.scrollToBottom', '맨 아래로') as string}
        >
          {pendingNewCount > 0 && (
            <ScrollPendingBadge>{pendingNewCount > 99 ? '99+' : pendingNewCount}</ScrollPendingBadge>
          )}
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </ScrollToBottomBtn>
      )}

      {/* 입력창 */}
      <InputBar>
        {!isClient && (
          <InputToolbar>
            <ToggleLabel>
              <ToggleInput
                type="checkbox"
                checked={activeConv.auto_extract_enabled}
                onChange={(e) => onToggleAutoExtract(activeConv.id, e.target.checked)}
              />
              <ToggleSlider $on={activeConv.auto_extract_enabled} />
              <ToggleText>{t('chat.input.autoExtract', '자동 업무 추출')}</ToggleText>
            </ToggleLabel>
            <ExtractBtn onClick={onOpenExtract} disabled={extracting}>
              {extracting ? (
                <ExtractSpinner />
              ) : (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M9 11l3 3L22 4" />
                  <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                </svg>
              )}
              {extracting ? t('chat.input.extracting', '추출 중...') : t('chat.input.extractNow', '업무 추출')}
            </ExtractBtn>
            {cueDraftCount > 0 && (
              <CueBadgeInline
                type="button"
                onClick={scrollToFirstDraft}
                title={t('chat.input.cueWaitingHint', 'Cue 답변 대기 — 클릭하면 해당 메시지로 이동')}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="18 15 12 9 6 15" />
                </svg>
                {t('chat.input.cueWaiting', { count: cueDraftCount })}
              </CueBadgeInline>
            )}
          </InputToolbar>
        )}
        {(uploadingFiles.length > 0 || stagedExistingIds.length > 0 || stagedPostIds.length > 0) && (
          <StagedRow>
            {uploadingFiles.map((u) => (
              u.error ? (
                <UploadErrorChip key={u.tempId} role="alert">
                  <ErrorDot />
                  <UploadErrorBody>
                    <UploadErrorName title={u.name}>{u.name}</UploadErrorName>
                    <UploadErrorMsg title={u.error}>{u.error}</UploadErrorMsg>
                  </UploadErrorBody>
                  <StagedX type="button" onClick={() => removeUploading(u.tempId)} aria-label="dismiss">×</StagedX>
                </UploadErrorChip>
              ) : (
                <StagedChip key={u.tempId} title={t('chat.input.uploading', '업로드 중...') as string}>
                  <UploadSpinner />
                  <StagedName title={u.name}>{u.name}</StagedName>
                  <StagedSize>{(u.size / 1024).toFixed(0)}KB</StagedSize>
                  <StagedX type="button" onClick={() => removeUploading(u.tempId)} aria-label="remove">×</StagedX>
                </StagedChip>
              )
            ))}
            {stagedExistingIds.map(id => {
              const meta = stagedExistingMeta[id];
              return (
                <StagedChip key={`ex-${id}`} title={t('chat.input.attachExisting', '기존 파일 (재업로드 X)') as string}>
                  <ExistingDot />
                  <StagedName title={meta?.name}>{meta?.name || `#${id}`}</StagedName>
                  {meta?.size != null && <StagedSize>{(meta.size / 1024).toFixed(0)}KB</StagedSize>}
                  <StagedX type="button" onClick={() => removeExisting(id)} aria-label="remove">×</StagedX>
                </StagedChip>
              );
            })}
            {stagedPostIds.map(id => {
              const meta = stagedPostMeta[id];
              return (
                <StagedChip key={`post-${id}`} title={t('chat.input.attachPost', '문서 카드') as string}>
                  <PostDot />
                  <StagedName title={meta?.title}>{meta?.title || `#${id}`}</StagedName>
                  <StagedX type="button" onClick={() => removePost(id)} aria-label="remove">×</StagedX>
                </StagedChip>
              );
            })}
          </StagedRow>
        )}
        <InputWrap
          as="form"
          onSubmit={(e: React.FormEvent) => { e.preventDefault(); handleSend(); }}
          autoComplete="off"
        >
          <AttachBtn type="button" onClick={() => setFilePickerOpen(true)} title={t('chat.input.attach', '파일 첨부') as string}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
            </svg>
          </AttachBtn>
          <TextInput
            ref={textInputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={handleInputFocus}
            onCompositionStart={handleCompositionStart}
            onCompositionEnd={handleCompositionEnd}
            /* 사이클 N+15-B — 모바일 키보드 액세서리 바 (위/아래 화살표) 최소화 + 자동수정/사전 변환 비활성 */
            autoCorrect="off"
            autoCapitalize="sentences"
            autoComplete="off"
            spellCheck={false}
            inputMode="text"
            enterKeyHint="send"
            onPaste={(e) => {
              // 클립보드의 이미지(스크린샷 등) 즉시 업로드
              const items = e.clipboardData?.items;
              if (!items) return;
              const files: File[] = [];
              for (const it of items) {
                if (it.kind === 'file') {
                  const f = it.getAsFile();
                  if (f) files.push(f);
                }
              }
              if (files.length > 0) {
                e.preventDefault();
                uploadMany(files);
              }
            }}
            placeholder={t('chat.input.placeholder', '메시지를 입력하세요 (Enter 전송 · Shift+Enter 줄바꿈)')}
            rows={1}
          />
          <SendBtn
            type="button"
            disabled={
              uploadingFiles.some(x => !x.error) ||
              (!input.trim() && stagedExistingIds.length === 0 && stagedPostIds.length === 0)
            }
            onClick={handleSend}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </SendBtn>
        </InputWrap>
      </InputBar>
      {previewCard && (
        <PostCardPreviewModal card={previewCard} onClose={() => setPreviewCard(null)} />
      )}
      {businessId && (
        <FilePicker
          open={filePickerOpen}
          onClose={() => setFilePickerOpen(false)}
          businessId={Number(businessId)}
          onPick={handleFilePicked}
          title={t('chat.input.attach', '파일·문서 첨부') as string}
          mode="both"
          variant="modal"
          multiple
          includePosts
        />
      )}
      {businessId && userPopover && (
        <UserInfoPopover
          open
          userId={userPopover.userId}
          businessId={Number(businessId)}
          anchorEl={userPopover.anchorEl}
          onClose={() => setUserPopover(null)}
        />
      )}
      {/* 사이클 N+16-E — 메시지 삭제 확인. confirmDeleteId === -1 이면 묶음 삭제 의미. */}
      {confirmDeleteId !== null && (
        <ConfirmBackdrop onClick={() => setConfirmDeleteId(null)}>
          <ConfirmDialog onClick={(e) => e.stopPropagation()}>
            <ConfirmTitle>{t('chat.confirmDelete.title', '메시지를 삭제할까요?')}</ConfirmTitle>
            <ConfirmBody>
              {confirmDeleteId === -1
                ? t('chat.confirmDelete.bulkBody', { count: selectedMsgIds.size, defaultValue: `선택한 ${selectedMsgIds.size}개 메시지가 모두에게 안 보이게 됩니다. 첨부 파일은 그대로 보관됩니다.` })
                : t('chat.confirmDelete.singleBody', '이 메시지는 모두에게 안 보이게 됩니다. 원본은 보관되지만 채팅창엔 "삭제된 메시지" 로만 표시됩니다.')}
            </ConfirmBody>
            <ConfirmActions>
              <ConfirmCancel type="button" onClick={() => setConfirmDeleteId(null)}>
                {t('common.cancel', '취소')}
              </ConfirmCancel>
              <ConfirmDanger type="button" onClick={() => confirmDeleteId === -1 ? handleBulkDelete() : handleDelete(confirmDeleteId)}>
                {t('common.delete', '삭제')}
              </ConfirmDanger>
            </ConfirmActions>
          </ConfirmDialog>
        </ConfirmBackdrop>
      )}
    </Container>
  );
};

export default ChatPanel;

// ─────────────────────────────────────────────
const Container = styled.main<{ $mobileHidden?: boolean }>`
  position: relative;
  flex: 1;
  min-width: 0;
  min-height: 0;            /* flex column 자식 (메시지 리스트) 가 줄어들 수 있게 */
  background: #FFFFFF;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  ${mediaTablet} {
    display: ${(p) => (p.$mobileHidden ? 'none' : 'flex')};
    width: 100%;
  }
  /* 모바일 키보드 대응 — 100vh 는 iOS Safari 에서 주소창 포함 잘못 계산.
     100dvh (dynamic viewport) 가 키보드 올라올 때 줄어드는 정확한 viewport.
     부모 Layout 도 100dvh 로 통일 (QTalkPage 의 Layout). */
  @media (max-width: 640px) {
    height: 100dvh;
    height: -webkit-fill-available;
  }
`;

const MobileBackBtn = styled.button`
  display: none;
  background: none; border: none; padding: 8px;
  align-items: center; justify-content: center;
  color: #334155; border-radius: 6px; cursor: pointer;
  min-width: 44px; min-height: 44px;
  margin-right: 4px;
  &:hover { background: #F1F5F9; }
  svg { width: 20px; height: 20px; }
  ${mediaTablet} { display: inline-flex; }
`;

const HeaderBar = styled.div`
  min-height: 60px;
  padding: 14px 20px;
  border-bottom: 1px solid #E2E8F0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-shrink: 0;
  @media (max-width: 640px) {
    padding: 8px 12px;
    gap: 8px;
    min-height: 56px;
  }
`;

const HeaderTitleBlock = styled.div`
  display: flex;
  align-items: center;
  min-width: 0;
  flex: 1;
  gap: 10px;
  flex-wrap: nowrap;
  /* 모바일에서는 정보 많을 때 줄바꿈 — 채팅 이름 / 고객·소속·메타 분리. */
  @media (max-width: 640px) {
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
  }
`;

const ChatNameRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex-shrink: 1;
  flex-wrap: wrap;
  @media (max-width: 640px) {
    gap: 4px;
  }
`;

const ChatName = styled.h2<{ $editable: boolean }>`
  font-size: 16px;
  font-weight: 700;
  color: #0F172A;
  margin: 0;
  letter-spacing: -0.2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  ${(p) => p.$editable && `
    cursor: text;
    padding: 2px 6px;
    margin: -2px -6px;
    border-radius: 5px;
    transition: background 0.1s;
    &:hover { background: #F1F5F9; }
  `}
`;

const ChatNameInput = styled.input`
  font-size: 16px;
  font-weight: 700;
  color: #0F172A;
  letter-spacing: -0.2px;
  padding: 2px 6px;
  margin: -2px -6px;
  background: #FFFFFF;
  border: 1px solid #14B8A6;
  border-radius: 5px;
  outline: none;
  width: 100%;
  max-width: 320px;
  box-shadow: 0 0 0 3px rgba(20, 184, 166, 0.12);
  font-family: inherit;
`;

// '내부' 는 default 라 라벨 제거. '고객' 만 PlanQ 포인트 컬러 (coral) 로 강조.
const CustomerTag = styled.span`
  padding: 1px 7px;
  background: rgba(244, 63, 94, 0.10);
  color: #BE123C;
  font-size: 10px;
  font-weight: 700;
  border-radius: 10px;
  letter-spacing: 0.2px;
  flex-shrink: 0;
`;

const ProjectSublabel = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: #94A3B8;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  flex-shrink: 1;
  padding-left: 10px;
  border-left: 1px solid #E2E8F0;
  span { color: #94A3B8; }
`;

const SublabelIcon = styled.svg`
  width: 12px;
  height: 12px;
  color: #CBD5E1;
`;

const ProjectLink = styled.button`
  background: transparent;
  border: none;
  color: #0D9488;
  font-size: 11px;
  font-weight: 600;
  padding: 0;
  cursor: pointer;
  &:hover { text-decoration: underline; color: #0F766E; }
`;

const ChannelQuickSwitch = styled.div`
  display: flex;
  gap: 4px;
  align-items: center;
`;

const QuickSwitchBtn = styled.button`
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  background: #F8FAFC;
  border: 1px solid #E2E8F0;
  border-radius: 14px;
  font-size: 11px;
  font-weight: 500;
  color: #64748B;
  cursor: pointer;
  transition: all 0.1s;
  max-width: 140px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  &:hover {
    background: #F0FDFA;
    border-color: #99F6E4;
    color: #0F766E;
  }
`;

const QuickHash = styled.span<{ $type: 'customer' | 'internal' | 'group' }>`
  color: ${(p) =>
    p.$type === 'customer' ? '#F59E0B' :
    p.$type === 'internal' ? '#94A3B8' : '#7C3AED'};
  font-weight: 700;
`;

const QuickBadge = styled.span`
  min-width: 14px;
  height: 14px;
  padding: 0 4px;
  background: #F43F5E;
  color: #FFFFFF;
  border-radius: 7px;
  font-size: 9px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
`;

const HeaderLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
`;

const HeaderRight = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
`;

const IconBtn = styled.button`
  width: 30px;
  height: 30px;
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


// 배너 외부 wrapper — MessageList 와 동일한 연회색 배경으로 채팅 내용과 색상 일관성 유지
const CandidatesBannerWrap = styled.div`
  padding: 10px 16px 0;
  background: #F8FAFC;
`;
const CandidatesBanner = styled.div`
  padding: 10px 14px;
  background: #FFFBEB;
  border: 1px solid #FDE68A;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
`;

const BannerText = styled.div`
  font-size: 12px;
  color: #92400E;
  font-weight: 500;
`;

const BannerCloseBtn = styled.button`
  display: inline-flex; align-items: center; justify-content: center;
  width: 24px; height: 24px; flex-shrink: 0;
  background: transparent; border: none; border-radius: 6px; cursor: pointer;
  color: #92400E;
  transition: background 0.12s;
  &:hover { background: rgba(146, 64, 14, 0.1); }
  &:focus-visible { outline: 2px solid #F59E0B; outline-offset: 2px; }
`;

const MessageList = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  background: #F8FAFC;
  &::-webkit-scrollbar { width: 6px; }
  &::-webkit-scrollbar-thumb { background: #E2E8F0; border-radius: 3px; }
`;

const NoMsgBox = styled.div`
  padding: 40px 20px; text-align: center; color: #94A3B8; font-size: 13px;
`;

// 사이클 N+15-C — 읽음 표시 라벨.
// 본인 메시지 우측 하단 작은 11px 톤. read=true 면 teal, false 면 회색 (Slack/iMessage 패턴).
// 영문 노트: 상대 디바이스가 알림만 받고 conv 진입 전이면 last_read_at 갱신 안 됨 → '전송됨' 유지.
const ReadMark = styled.div<{ $read: boolean }>`
  margin-top: 2px;
  align-self: flex-end;
  font-size: 11px;
  font-weight: 500;
  color: ${(p) => (p.$read ? '#0D9488' : '#94A3B8')};
  letter-spacing: -0.1px;
`;

// 사이클 N+15-E — 스크롤-바닥 floating 버튼.
// Container 의 absolute 자식 — MessageList 위에 떠 있는 형태. 위로 240px+ 스크롤 시 등장.
// 데스크탑: 우측 하단 (InputBar 위), 모바일: 같은 위치 — InputBar 높이 + 12px 마진.
const ScrollToBottomBtn = styled.button`
  position: absolute;
  right: 18px;
  bottom: 90px;
  width: 38px;
  height: 38px;
  border-radius: 50%;
  background: #FFFFFF;
  color: #334155;
  border: 1px solid #E2E8F0;
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.12);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  z-index: 20;
  transition: transform 0.15s, background 0.15s, border-color 0.15s;
  animation: pq-scrolltop-in 0.18s ease-out;
  @keyframes pq-scrolltop-in {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }
  &:hover { background: #F8FAFC; border-color: #14B8A6; color: #0D9488; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 2px; }
  @media (max-width: 640px) {
    right: 14px;
    bottom: 84px;
  }
`;
const ScrollPendingBadge = styled.span`
  position: absolute;
  top: -6px;
  right: -6px;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  border-radius: 10px;
  background: #F43F5E;
  color: #FFFFFF;
  font-size: 11px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 0 0 2px #FFFFFF;
`;

// 사이클 N+15-A — 메시지 lazy-load skeleton.
// shimmer 만 사용 (pulse 안 씀 — 채팅 박스 안 노이즈 최소). 좌/우 정렬 번갈아 → 실 메시지 흐름 인상.
const SkeletonMessages = styled.div`
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 8px 0;
`;
const SkelMsgRow = styled.div<{ $align: 'left' | 'right' }>`
  display: flex;
  flex-direction: ${(p) => (p.$align === 'right' ? 'row-reverse' : 'row')};
  align-items: flex-start;
  gap: 12px;
`;
const SkelMsgAvatar = styled.div`
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: linear-gradient(90deg, #F1F5F9 0%, #E2E8F0 50%, #F1F5F9 100%);
  background-size: 200% 100%;
  animation: pq-msgskel-shimmer 1.4s linear infinite;
  flex-shrink: 0;
  @keyframes pq-msgskel-shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }
`;
const SkelMsgBubble = styled.div<{ $width: string; $mine?: boolean }>`
  width: ${(p) => p.$width};
  height: 36px;
  border-radius: 12px;
  background: linear-gradient(90deg,
    ${(p) => (p.$mine ? '#E0F7F4 0%, #CCFBF1 50%, #E0F7F4 100%' : '#F1F5F9 0%, #E2E8F0 50%, #F1F5F9 100%')});
  background-size: 200% 100%;
  animation: pq-msgskel-shimmer 1.4s linear infinite;
`;

// Hangouts/Slack 패턴 — 그룹 첫 메시지는 윗 마진 (그룹 간격), 연속(같은 발신자 + 5분 이내) 은
// 거의 붙어서 나오게 (Irene 명시: 줄간격 좁게). 그룹 시작 12px / 연속 0px.
const MessageItem = styled.div<{ $continuation?: boolean; $selected?: boolean; $flashing?: boolean; $pinned?: boolean; $clickable?: boolean }>`
  position: relative;
  display: flex;
  gap: 12px;
  align-items: flex-start;
  margin-top: ${(p) => (p.$continuation ? '0' : '12px')};
  padding: 4px 6px;
  margin-left: -6px;
  margin-right: -6px;
  border-radius: 8px;
  cursor: ${(p) => (p.$clickable ? 'pointer' : 'default')};
  transition: background 0.15s;
  &:first-child { margin-top: 0; }
  /* 핀 메시지 좌측 액센트 — 미세한 노란 막대 */
  ${(p) => p.$pinned && `
    box-shadow: inset 3px 0 0 #F59E0B;
  `}
  /* 선택된 상태 */
  ${(p) => p.$selected && `
    background: rgba(20, 184, 166, 0.08);
    box-shadow: inset 3px 0 0 #14B8A6;
  `}
  /* PinnedBar 클릭 시 잠시 강조 */
  ${(p) => p.$flashing && `
    background: rgba(245, 158, 11, 0.18);
    transition: background 0.4s;
  `}
  &:hover button.pq-msg-toolbar-btn { opacity: 1; }
  &:hover > .pq-msg-toolbar { opacity: 1; pointer-events: auto; transform: translateY(0); }
`;

// 그룹 연속 메시지에서 Avatar 자리 차지 (들여쓰기 정렬용 빈 박스)
const AvatarSpacer = styled.div`
  width: 36px;
  height: 1px;
  flex-shrink: 0;
`;

// 사이클 N+16-D — 아바타 클릭 → 발신자 정보 popover. 시각적으로 LetterAvatar 그대로 보이도록 button 은 wrapper.
const AvatarBtn = styled.button`
  flex-shrink: 0;
  background: transparent;
  border: none;
  padding: 0;
  cursor: pointer;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.1s, box-shadow 0.15s;
  &:hover { transform: scale(1.04); box-shadow: 0 0 0 2px rgba(20,184,166,0.18); }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 2px; }
`;

const MessageBody = styled.div`
  flex: 1;
  min-width: 0;
`;

// 사이클 N+16-E — 묶음 선택 체크박스
const MsgCheckbox = styled.div<{ $checked: boolean; $disabled?: boolean }>`
  width: 20px;
  height: 20px;
  border-radius: 6px;
  border: 1.6px solid ${(p) => (p.$checked ? '#14B8A6' : '#CBD5E1')};
  background: ${(p) => (p.$checked ? '#14B8A6' : 'transparent')};
  color: #FFFFFF;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-top: 8px;
  opacity: ${(p) => (p.$disabled ? 0.4 : 1)};
  transition: background 0.15s, border-color 0.15s;
`;

// (수정됨) 라벨
const EditedMark = styled.span`
  font-size: 10px;
  color: #94A3B8;
  font-style: italic;
`;

// 삭제된 메시지 placeholder (CLAUDE.md 운영 정책)
const DeletedPlaceholder = styled.div`
  font-size: 12px;
  color: #94A3B8;
  font-style: italic;
  padding: 6px 12px;
  background: #F8FAFC;
  border: 1px dashed #CBD5E1;
  border-radius: 8px;
  margin-top: 4px;
  width: fit-content;
  max-width: 100%;
`;

// 인라인 편집 폼
const EditFormWrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 4px;
`;
const EditTextArea = styled.textarea`
  width: 100%;
  resize: vertical;
  min-height: 60px;
  padding: 10px 12px;
  border: 1px solid #14B8A6;
  border-radius: 8px;
  background: #FFFFFF;
  font-family: inherit;
  font-size: 13px;
  line-height: 1.5;
  color: #0F172A;
  outline: none;
  box-shadow: 0 0 0 3px rgba(20, 184, 166, 0.1);
`;
const EditActions = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;
const EditBtn = styled.button<{ $primary?: boolean }>`
  height: 28px;
  padding: 0 12px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid ${(p) => (p.$primary ? '#0D9488' : '#CBD5E1')};
  background: ${(p) => (p.$primary ? '#14B8A6' : '#FFFFFF')};
  color: ${(p) => (p.$primary ? '#FFFFFF' : '#334155')};
  transition: background 0.15s;
  &:hover:not(:disabled) {
    background: ${(p) => (p.$primary ? '#0D9488' : '#F8FAFC')};
  }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
const EditHint = styled.span`
  font-size: 11px;
  color: #94A3B8;
  margin-left: auto;
`;

// hover toolbar (Slack 패턴). MessageItem 우측 상단 absolute, hover 시 등장.
const MessageToolbar = styled.div.attrs({ className: 'pq-msg-toolbar' })`
  position: absolute;
  top: 0;
  right: 8px;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  gap: 1px;
  background: #FFFFFF;
  border: 1px solid #E2E8F0;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.08);
  padding: 2px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s, transform 0.15s;
  z-index: 5;
  @media (hover: none), (max-width: 640px) {
    /* 모바일/터치: 항상 노출 (hover 없음) */
    position: static;
    transform: none;
    margin-top: 4px;
    opacity: 1;
    pointer-events: auto;
    box-shadow: none;
    background: transparent;
    border: none;
    padding: 0;
    justify-content: flex-end;
  }
`;
const ToolBarBtn = styled.button<{ $active?: boolean }>`
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: ${(p) => (p.$active ? '#F0FDFA' : 'transparent')};
  color: ${(p) => (p.$active ? '#0F766E' : '#64748B')};
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  &:hover { background: #F1F5F9; color: #0F172A; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 1px; }
`;
const ToolBarMoreRoot = styled.div`
  position: relative;
  display: inline-flex;
`;
const ToolBarMore = styled.div`
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  min-width: 180px;
  background: #FFFFFF;
  border: 1px solid #E2E8F0;
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.12);
  padding: 4px;
  z-index: 20;
`;
const ToolBarMoreItem = styled.button<{ $danger?: boolean }>`
  display: block;
  width: 100%;
  text-align: left;
  padding: 8px 12px;
  background: transparent;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  color: ${(p) => (p.$danger ? '#B91C1C' : '#334155')};
  cursor: pointer;
  transition: background 0.1s;
  &:hover { background: ${(p) => (p.$danger ? '#FEF2F2' : '#F8FAFC')}; }
`;

// PinnedBar — Slack 패턴 헤더 아래 공지 영역
const PinnedBar = styled.div`
  flex-shrink: 0;
  background: linear-gradient(180deg, #FEF3C7 0%, #FEF9E7 100%);
  border-bottom: 1px solid #FCD34D;
`;
const PinnedHeader = styled.button`
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 16px;
  background: transparent;
  border: none;
  cursor: pointer;
  font-size: 12px;
  color: #92400E;
  transition: background 0.15s;
  &:hover { background: rgba(245, 158, 11, 0.08); }
`;
const PinIcon = styled.svg`
  width: 14px;
  height: 14px;
  color: #D97706;
  flex-shrink: 0;
`;
const PinnedTitle = styled.span`
  font-size: 12px;
  font-weight: 700;
  color: #92400E;
`;
const PinChevron = styled.svg<{ $open: boolean }>`
  width: 12px;
  height: 12px;
  color: #92400E;
  margin-left: auto;
  transition: transform 0.15s;
  transform: rotate(${(p) => (p.$open ? '0deg' : '-90deg')});
`;
const PinnedList = styled.div`
  display: flex;
  flex-direction: column;
  padding: 0 8px 8px;
  gap: 4px;
  max-height: 200px;
  overflow-y: auto;
`;
const PinnedItem = styled.button`
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 30px 8px 12px;
  background: #FFFFFF;
  border: 1px solid rgba(217, 119, 6, 0.18);
  border-radius: 8px;
  cursor: pointer;
  text-align: left;
  font-size: 12px;
  transition: background 0.15s, border-color 0.15s;
  &:hover { background: #FFFBEB; border-color: #F59E0B; }
`;
const PinnedSender = styled.span`
  font-weight: 700;
  color: #0F172A;
  flex-shrink: 0;
`;
const PinnedBody = styled.span`
  flex: 1;
  color: #334155;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
`;
const PinnedTime = styled.span`
  font-size: 10px;
  color: #94A3B8;
  flex-shrink: 0;
`;
const PinnedUnpinBtn = styled.button`
  position: absolute;
  right: 4px;
  top: 50%;
  transform: translateY(-50%);
  width: 22px;
  height: 22px;
  border: none;
  background: transparent;
  color: #94A3B8;
  border-radius: 4px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  &:hover { background: #FEF3C7; color: #92400E; }
`;

// SelectionBar — 묶음 선택 모드 상단 액션 바
const SelectionBar = styled.div`
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 16px;
  background: #F0FDFA;
  border-bottom: 1px solid #99F6E4;
`;
const SelectionCount = styled.span`
  font-size: 12px;
  font-weight: 700;
  color: #0F766E;
`;
const SelectionActions = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
`;
const SelectionBtn = styled.button<{ $danger?: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 12px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid ${(p) => (p.$danger ? '#FCA5A5' : '#CBD5E1')};
  background: #FFFFFF;
  color: ${(p) => (p.$danger ? '#B91C1C' : '#334155')};
  transition: background 0.15s, border-color 0.15s;
  &:hover:not(:disabled) {
    background: ${(p) => (p.$danger ? '#FEF2F2' : '#F8FAFC')};
    border-color: ${(p) => (p.$danger ? '#DC2626' : '#94A3B8')};
  }
  &:disabled { opacity: 0.4; cursor: not-allowed; }
`;
const SelectionCancel = styled.button`
  height: 30px;
  padding: 0 12px;
  background: transparent;
  border: none;
  font-size: 12px;
  font-weight: 600;
  color: #64748B;
  cursor: pointer;
  border-radius: 6px;
  &:hover { background: #FFFFFF; color: #0F172A; }
`;

const ConfirmBackdrop = styled.div`
  position: fixed; inset: 0;
  background: rgba(15, 23, 42, 0.35);
  z-index: 2500;
  display: flex; align-items: center; justify-content: center;
  padding: 20px;
`;
const ConfirmDialog = styled.div`
  background: #FFFFFF;
  border-radius: 12px;
  width: 100%;
  max-width: 420px;
  padding: 20px 22px;
  box-shadow: 0 20px 50px rgba(15, 23, 42, 0.2);
  display: flex; flex-direction: column; gap: 12px;
`;
const ConfirmTitle = styled.div`
  font-size: 15px; font-weight: 700; color: #0F172A;
`;
const ConfirmBody = styled.div`
  font-size: 13px; color: #475569; line-height: 1.55;
`;
const ConfirmActions = styled.div`
  display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px;
`;
const ConfirmCancel = styled.button`
  height: 34px; padding: 0 14px;
  background: #FFFFFF; border: 1px solid #CBD5E1; border-radius: 8px;
  font-size: 13px; font-weight: 600; color: #334155; cursor: pointer;
  &:hover { background: #F8FAFC; }
`;
const ConfirmDanger = styled.button`
  height: 34px; padding: 0 14px;
  background: #DC2626; border: none; border-radius: 8px;
  font-size: 13px; font-weight: 700; color: #FFFFFF; cursor: pointer;
  &:hover { background: #B91C1C; }
`;

const MessageHeader = styled.div`
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 4px;
`;

const SenderName = styled.button`
  /* 사이클 N+15-E — 발신자 이름 클릭 시 유저 정보 popover. button 으로 변경 (a11y + hover 영향). */
  background: transparent;
  border: none;
  padding: 0;
  font-size: 13px;
  font-weight: 600;
  color: #0F172A;
  font-family: inherit;
  cursor: pointer;
  text-align: left;
  transition: color 0.15s;
  &:hover { color: #0D9488; text-decoration: underline; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 2px; border-radius: 4px; }
`;

const TimeStamp = styled.span`
  font-size: 11px;
  color: #94A3B8;
`;

const CueBadge = styled.span`
  font-size: 10px;
  font-weight: 700;
  padding: 1px 6px;
  background: linear-gradient(135deg, #F43F5E 0%, #C026D3 100%);
  color: #FFFFFF;
  border-radius: 10px;
  letter-spacing: 0.3px;
`;

// 메시지 본문 안 URL 자동링크 — Primary teal, hover 시 진하게. word-break 강제 (긴 URL 줄바꿈)
const MsgLink = styled.a`
  color: #0D9488;
  text-decoration: underline;
  text-underline-offset: 2px;
  word-break: break-all;
  &:hover { color: #0F766E; text-decoration-thickness: 2px; }
  &:visited { color: #0F766E; }
`;

const MessageText = styled.div<{ $question: boolean }>`
  font-size: 14px;
  color: #1E293B;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  ${(p) => p.$question && `
    padding: 10px 12px;
    background: #FFF1F2;
    border-left: 3px solid #F43F5E;
    border-radius: 6px;
  `}
`;

// 번역 표시 — Conversation.translation_enabled 일 때 발송 시점에 캐시된 번역.
// 원문 아래에 옅은 톤으로 표시 (Q note 패턴).
const TranslatedText = styled.div`
  margin-top: 4px;
  padding: 6px 10px;
  font-size: 13px;
  color: #64748B;
  background: #F8FAFC;
  border-left: 2px solid #CBD5E1;
  border-radius: 6px;
  line-height: 1.5;
  white-space: pre-wrap;
`;

// 통합 공유 카드 (사이클 N+4 6차) — task/file/kb_document/calendar_event
const SharedCard = styled.button`
  all: unset; cursor: pointer; display: flex; align-items: center; gap: 10px;
  padding: 10px 12px; max-width: 380px;
  background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 10px;
  transition: background 0.15s, border-color 0.15s, transform 0.15s;
  &:hover { background: #F0FDFA; border-color: #14B8A6; transform: translateY(-1px); }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 2px; }
`;
const SHARED_TONE: Record<string, { bg: string; fg: string; border: string }> = {
  task:     { bg: '#DBEAFE', fg: '#1E40AF', border: '#93C5FD' },
  file:     { bg: '#FEF3C7', fg: '#92400E', border: '#FCD34D' },
  kb:       { bg: '#F0FDFA', fg: '#0F766E', border: '#99F6E4' },
  calendar: { bg: '#F3E8FF', fg: '#6B21A8', border: '#D8B4FE' },
};
const SharedCardIcon = styled.span<{ $tone: keyof typeof SHARED_TONE }>`
  width: 36px; height: 36px; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  background: ${p => SHARED_TONE[p.$tone].bg};
  color: ${p => SHARED_TONE[p.$tone].fg};
  border: 1px solid ${p => SHARED_TONE[p.$tone].border};
  border-radius: 8px;
`;

// 문서 카드 (kind='card', card_type='post')
const DocCard = styled.button`
  all: unset; cursor: pointer; display: flex; align-items: center; gap: 10px;
  padding: 10px 12px; max-width: 380px;
  background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 10px;
  transition: background 0.15s, border-color 0.15s, transform 0.15s;
  &:hover { background: #F0FDFA; border-color: #14B8A6; transform: translateY(-1px); }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 2px; }
`;
const SignCard = styled.div`
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px; max-width: 380px;
  background: linear-gradient(135deg, #F0FDFA 0%, #FFF7ED 100%);
  border: 1px solid #14B8A6; border-radius: 10px; cursor: pointer;
  transition: border-color 0.15s, transform 0.15s, box-shadow 0.15s;
  &:hover { border-color: #0D9488; transform: translateY(-1px); box-shadow: 0 4px 12px rgba(20,184,166,0.15); }
`;
const InvoiceCard = styled.button<{ $paid: boolean; $notified: boolean; $canceled: boolean }>`
  all: unset; cursor: pointer; display: flex; align-items: center; gap: 10px;
  padding: 10px 12px; max-width: 380px;
  background: ${p => p.$paid ? '#F0FDF4' : p.$notified ? '#FFFBEB' : '#F8FAFC'};
  border: 1px solid ${p => p.$paid ? '#86EFAC' : p.$notified ? '#FCD34D' : '#E2E8F0'};
  border-radius: 10px;
  opacity: ${p => p.$canceled ? 0.6 : 1};
  transition: background 0.15s, border-color 0.15s, transform 0.15s;
  &:hover { transform: translateY(-1px); border-color: ${p => p.$paid ? '#22C55E' : p.$notified ? '#F59E0B' : '#0D9488'}; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 2px; }
`;
const InvCardIcon = styled.span<{ $paid: boolean; $notified: boolean }>`
  width: 36px; height: 36px; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  background: #fff;
  color: ${p => p.$paid ? '#15803D' : p.$notified ? '#B45309' : '#0F766E'};
  border: 1px solid ${p => p.$paid ? '#86EFAC' : p.$notified ? '#FCD34D' : '#E2E8F0'};
  border-radius: 8px;
`;
const InvCardSub = styled.span`
  font-size: 11px; color: #64748B; font-weight: 500;
  font-variant-numeric: tabular-nums;
`;
const InvCardStatus = styled.span<{ $paid: boolean; $notified: boolean; $canceled: boolean }>`
  font-size: 11px; font-weight: 700;
  color: ${p => p.$paid ? '#15803D' : p.$canceled ? '#94A3B8' : p.$notified ? '#B45309' : '#0F766E'};
`;
const SignCardIcon = styled.span`
  width: 36px; height: 36px; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  background: #fff; color: #0F766E; border: 1px solid #14B8A6; border-radius: 8px;
`;
const DocCardIcon = styled.span`
  width: 36px; height: 36px; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  background: #fff; color: #0F766E; border: 1px solid #E2E8F0; border-radius: 8px;
`;
const DocCardBody = styled.div`flex:1;display:flex;flex-direction:column;gap:2px;min-width:0;`;
const DocCardTitle = styled.span`
  font-size: 13px; font-weight: 700; color: #0F172A;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
`;
const DocCardLabel = styled.span`font-size:11px;color:#64748B;font-weight:500;`;
const DocCardArrow = styled.span`color:#94A3B8;flex-shrink:0;`;
const CardNote = styled.div`
  margin-top: 6px; padding: 8px 10px;
  font-size: 13px; color: #334155; line-height: 1.5;
  background: #fff; border-left: 3px solid #14B8A6; border-radius: 0 6px 6px 0;
`;

const SourceBox = styled.div`
  margin-top: 6px;
  padding: 8px 10px;
  background: #F8FAFC;
  border: 1px solid #E2E8F0;
  border-radius: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
`;
const SourceLabel = styled.div`
  font-size: 10px;
  font-weight: 700;
  color: #94A3B8;
  text-transform: uppercase;
  letter-spacing: 0.5px;
`;
const SourceItem = styled.div`
  font-size: 11px;
  color: #475569;
`;

const CueDraftCard = styled.div<{ $locked: boolean }>`
  margin-top: 10px;
  padding: 12px;
  background: ${(p) => (p.$locked ? '#F8FAFC' : '#FFF1F2')};
  border: 1px solid ${(p) => (p.$locked ? '#E2E8F0' : '#FECDD3')};
  border-radius: 10px;
  ${(p) => p.$locked && 'opacity: 0.7;'}
`;

const DraftHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
`;

const DraftLabel = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 700;
  color: #9F1239;
  text-transform: uppercase;
  letter-spacing: 0.5px;
`;

const DraftDot = styled.span`
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #F43F5E;
  animation: pulse 2s infinite;
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }
`;

const Confidence = styled.span`
  padding: 1px 6px;
  background: #FECDD3;
  border-radius: 8px;
  font-size: 10px;
`;

const LockInfo = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  color: #94A3B8;
  font-weight: 500;
`;

const LockDot = styled.span`
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #F59E0B;
`;

const DraftBody = styled.div`
  font-size: 13px;
  color: #1E293B;
  line-height: 1.5;
  margin-bottom: 8px;
`;

const DraftEditArea = styled.textarea`
  width: 100%;
  font-size: 13px;
  color: #1E293B;
  line-height: 1.5;
  margin-bottom: 8px;
  padding: 8px 10px;
  border: 1px solid #FECDD3;
  border-radius: 6px;
  background: #FFFFFF;
  resize: vertical;
  font-family: inherit;
  &:focus {
    outline: none;
    border-color: #F43F5E;
    box-shadow: 0 0 0 3px rgba(244, 63, 94, 0.1);
  }
`;

const DraftSource = styled.div`
  font-size: 11px;
  color: #9F1239;
  margin-bottom: 8px;
  padding: 4px 8px;
  background: #FFE4E6;
  border-radius: 4px;
  display: inline-block;
`;

const DraftActions = styled.div`
  display: flex;
  gap: 6px;
`;

const DraftBtn = styled.button<{ $primary?: boolean; $ghost?: boolean }>`
  padding: 5px 12px;
  font-size: 11px;
  font-weight: 600;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.1s;
  ${(p) => p.$primary ? `
    background: #F43F5E;
    color: #FFFFFF;
    border: none;
    &:hover:not(:disabled) { background: #E11D48; }
  ` : p.$ghost ? `
    background: transparent;
    color: #94A3B8;
    border: none;
    &:hover:not(:disabled) { color: #475569; }
  ` : `
    background: #FFFFFF;
    color: #9F1239;
    border: 1px solid #FECDD3;
    &:hover:not(:disabled) { background: #FFE4E6; }
  `}
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;

const InputBar = styled.div`
  border-top: 1px solid #E2E8F0;
  padding: 10px 16px 14px;
  background: #FFFFFF;
  flex-shrink: 0;
  /* iOS 노치/홈 인디케이터 영역 보호 + 키보드 위에 안전하게 떠 있게 */
  padding-bottom: max(14px, env(safe-area-inset-bottom, 14px));
  @media (max-width: 640px) {
    padding: 8px 12px;
    padding-bottom: max(8px, env(safe-area-inset-bottom, 8px));
  }
  /* 사이클 N+15-B — 모바일 키보드 up 시 safe-area 무시. 일부 iOS 가 키보드 위에서도 34px 잔존하는 버그 회피.
     InputBar 가 키보드에 딱 붙어 Hangouts/iMessage 와 동일한 인상. */
  body[data-keyboard-up="1"] & {
    padding-bottom: 6px;
  }
`;

const InputToolbar = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
`;

const ToggleLabel = styled.label`
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  user-select: none;
`;

const ToggleInput = styled.input`
  position: absolute;
  opacity: 0;
  pointer-events: none;
`;

const ToggleSlider = styled.span<{ $on: boolean }>`
  width: 28px;
  height: 16px;
  border-radius: 8px;
  background: ${(p) => (p.$on ? '#0D9488' : '#CBD5E1')};
  position: relative;
  transition: background 0.15s;
  &::after {
    content: '';
    position: absolute;
    top: 2px;
    left: ${(p) => (p.$on ? '14px' : '2px')};
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: #FFFFFF;
    transition: left 0.15s;
  }
`;

const ToggleText = styled.span`
  font-size: 11px;
  color: #64748B;
  font-weight: 500;
`;

const ExtractBtn = styled.button`
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  background: #F0FDFA;
  color: #0F766E;
  border: 1px solid #99F6E4;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  &:hover:not(:disabled) { background: #CCFBF1; }
  &:disabled { opacity: 0.6; cursor: not-allowed; }
`;

const ExtractSpinner = styled.span`
  width: 12px;
  height: 12px;
  border: 2px solid #99F6E4;
  border-top-color: #0F766E;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
  @keyframes spin { to { transform: rotate(360deg); } }
`;

const CueBadgeInline = styled.button`
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  background: #FFF1F2;
  color: #9F1239;
  border: 1px solid #FECDD3;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s;
  &:hover { background: #FFE4E6; }
`;

const InputWrap = styled.div`
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 8px 10px;
  background: #F8FAFC;
  border: 1px solid #E2E8F0;
  border-radius: 10px;
  &:focus-within {
    border-color: #14B8A6;
    background: #FFFFFF;
    box-shadow: 0 0 0 3px rgba(20, 184, 166, 0.1);
  }
`;

const TextInput = styled.textarea`
  flex: 1;
  border: none;
  background: transparent;
  resize: none;
  font-size: 13px;
  color: #0F172A;
  font-family: inherit;
  padding: 4px 0;
  max-height: 120px;
  &:focus { outline: none; }
  &::placeholder { color: #94A3B8; }
`;

const SendBtn = styled.button`
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: #0D9488;
  color: #FFFFFF;
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  &:hover:not(:disabled) { background: #0F766E; }
  &:disabled { background: #E2E8F0; color: #94A3B8; cursor: not-allowed; }
`;

// ─── 첨부 UI ───
const AttachBtn = styled.button`
  width: 32px; height: 32px; border-radius: 8px;
  background: transparent; color: #64748B; border: none;
  display: flex; align-items: center; justify-content: center; cursor: pointer;
  &:hover { background: #F1F5F9; color: #0F172A; }
`;
const StagedRow = styled.div`
  display: flex; flex-wrap: wrap; gap: 6px;
  justify-content: flex-start;
  /* InputWrap 의 콘텐츠 시작 x 와 정확히 맞춤: InputBar(좌16px) + InputWrap border(1px) + InputWrap padding-left(10px) = 27px.
     StagedRow 자체는 InputBar 자식이므로 좌16px 은 이미 적용됨 → 추가로 11px(border+padding) 만큼만 들여쓰기. */
  padding: 8px 11px 10px;
  border-bottom: 1px solid #F1F5F9;
`;
const StagedChip = styled.div`
  /* chip 자체의 좌측 padding 을 0 으로 — 아이콘이 InputWrap 콘텐츠 좌측과 시각적으로 정렬되도록 */
  display: inline-flex; align-items: center; gap: 6px; padding: 4px 8px 4px 6px;
  background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 6px;
  font-size: 11px; color: #475569; max-width: 220px;
  min-width: 0;
`;
const StagedName = styled.span`white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 140px; text-align: left;`;
const StagedSize = styled.span`color: #94A3B8; font-size: 10px;`;
const ExistingDot = styled.span`
  width: 6px; height: 6px; border-radius: 50%;
  background: #14B8A6; flex-shrink: 0;
`;
const PostDot = styled.span`
  width: 6px; height: 6px; border-radius: 50%;
  background: #F43F5E; flex-shrink: 0;
`;
const ErrorDot = styled.span`
  width: 6px; height: 6px; border-radius: 50%;
  background: #EF4444; flex-shrink: 0;
`;
// 업로드 실패 — 에러 메시지를 chip 안에 명시적으로 노출 (모바일에선 hover 가 없어 title 만으론 부족)
const UploadErrorChip = styled.div`
  display: inline-flex; align-items: flex-start; gap: 8px;
  padding: 6px 8px 6px 10px;
  background: #FEF2F2; border: 1px solid #FECACA; border-radius: 6px;
  color: #B91C1C; font-size: 11px;
  min-width: 0; max-width: 320px;
`;
const UploadErrorBody = styled.div`
  display: flex; flex-direction: column; gap: 2px;
  min-width: 0; flex: 1;
`;
const UploadErrorName = styled.span`
  font-weight: 600; color: #991B1B;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  max-width: 240px;
`;
const UploadErrorMsg = styled.span`
  color: #B91C1C; line-height: 1.4;
  white-space: normal; word-break: keep-all;
`;
const UploadSpinner = styled.span`
  width: 10px; height: 10px; border-radius: 50%;
  border: 2px solid #CBD5E1; border-top-color: #14B8A6;
  animation: spin 0.8s linear infinite; flex-shrink: 0;
  @keyframes spin { to { transform: rotate(360deg); } }
`;
const DropOverlay = styled.div`
  position: absolute; inset: 0; z-index: 20;
  display: flex; align-items: center; justify-content: center;
  background: rgba(20, 184, 166, 0.06);
  border: 2px dashed #14B8A6; border-radius: 8px;
  pointer-events: none;
  font-size: 14px; font-weight: 600; color: #0F766E;
`;
const StagedX = styled.button`
  background: transparent; border: none; color: #94A3B8; cursor: pointer;
  font-size: 14px; line-height: 1; padding: 0 2px;
  &:hover { color: #DC2626; }
`;

const AttachRow = styled.div`
  display: flex; flex-wrap: wrap; gap: 8px; margin-top: 6px;
`;
const AttachImageLink = styled.a`display: block; max-width: 220px; border-radius: 8px; overflow: hidden;`;
const AttachImage = styled.img`
  display: block; max-width: 220px; max-height: 200px; border-radius: 8px;
  border: 1px solid #E2E8F0; background: #F8FAFC;
`;
const AttachFileLink = styled.a`
  display: inline-flex; align-items: center; gap: 8px; padding: 6px 10px;
  background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px;
  text-decoration: none; color: #0F172A; font-size: 12px; max-width: 260px;
  &:hover { background: #F0FDFA; border-color: #14B8A6; }
`;
const AttachIcon = styled.span`
  display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; background: #14B8A6; color: #FFFFFF;
  border-radius: 6px; font-size: 9px; font-weight: 800; letter-spacing: 0.3px;
`;
const AttachName = styled.span`font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 160px;`;
const AttachSize = styled.span`color: #94A3B8; font-size: 10px;`;
