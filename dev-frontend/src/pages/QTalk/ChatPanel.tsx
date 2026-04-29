import React, { useMemo, useState, useEffect } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import {
  type MockMessage, type MockProject, type MockConversation, type PostCardMeta,
} from './mock';
import { useAuth } from '../../contexts/AuthContext';
import { useTimeFormat } from '../../hooks/useTimeFormat';
import LetterAvatar from '../../components/Common/LetterAvatar';
import EmptyState from '../../components/Common/EmptyState';
import PostCardPreviewModal from './PostCardPreviewModal';
import FilePicker, { type FilePickerResult } from '../../components/Common/FilePicker';
import { fetchWorkspaceFiles } from '../../services/files';
import { mediaTablet } from '../../theme/breakpoints';

interface Props {
  project: MockProject | null;
  conversations: MockConversation[];
  messages: Record<number, MockMessage[]>;
  activeConversationId: number | null;
  onSelectConversation: (conversationId: number) => void;
  onOpenExtract: () => void;
  onSendMessage: (body: string, files?: File[], existingFileIds?: number[]) => void;
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
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [previewCard, setPreviewCard] = useState<PostCardMeta | null>(null);

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
  const [input, setInput] = useState('');
  const [editingDraftId, setEditingDraftId] = useState<number | null>(null);
  const [draftBody, setDraftBody] = useState('');

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

  const [stagedFiles, setStagedFiles] = useState<File[]>([]);
  const [stagedExistingIds, setStagedExistingIds] = useState<number[]>([]);
  const [stagedExistingMeta, setStagedExistingMeta] = useState<Record<number, { name: string; size: number }>>({});
  const [filePickerOpen, setFilePickerOpen] = useState(false);
  // FilePicker 의 businessId — useAuth() 의 user.business_id 사용 (MockProject 에는 business_id 없음)
  const businessId = user?.business_id ? Number(user.business_id) : null;

  const handleSend = () => {
    if (!input.trim() && stagedFiles.length === 0 && stagedExistingIds.length === 0) return;
    onSendMessage(
      input,
      stagedFiles.length > 0 ? stagedFiles : undefined,
      stagedExistingIds.length > 0 ? stagedExistingIds : undefined,
    );
    setInput('');
    setStagedFiles([]);
    setStagedExistingIds([]);
    setStagedExistingMeta({});
    scrollToBottom();
  };
  const handleFilePicked = async (result: FilePickerResult) => {
    if (result.uploaded && result.uploaded.length > 0) {
      setStagedFiles(prev => [...prev, ...result.uploaded!]);
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
  };
  const removeStaged = (idx: number) => setStagedFiles(prev => prev.filter((_, i) => i !== idx));
  const removeExisting = (id: number) => {
    setStagedExistingIds(prev => prev.filter(x => x !== id));
    setStagedExistingMeta(prev => { const next = { ...prev }; delete next[id]; return next; });
  };

  // 메시지 리스트 스크롤 컨테이너 + 위치 영속
  const messageListRef = React.useRef<HTMLDivElement | null>(null);
  const scrollKey = (convId: number | null | undefined) => convId ? `qtalk_scroll_${convId}` : null;

  const scrollToBottom = React.useCallback((smooth = true) => {
    const doIt = () => {
      const el = messageListRef.current;
      if (!el) return;
      const target = el.scrollHeight - el.clientHeight;
      if (smooth && typeof el.scrollTo === 'function') {
        el.scrollTo({ top: target, behavior: 'smooth' });
      } else {
        el.scrollTop = target;
      }
    };
    window.requestAnimationFrame(() => { window.requestAnimationFrame(doIt); });
  }, []);

  // 스크롤 위치 localStorage 저장 (throttled via rAF)
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
    });
  }, [activeConv?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // 대화 전환 시 "초기 스크롤 미완료" 플래그 리셋
  const initialScrolledRef = React.useRef(false);
  const prevMessageCount = React.useRef(0);
  React.useEffect(() => {
    initialScrolledRef.current = false;
    prevMessageCount.current = 0;
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
      if (distance < 120) scrollToBottom();
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
    <Container $mobileHidden={mobileHidden}>
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
                {activeConv.channel_type === 'internal' && <InternalTag>{t('channelBadge.internal', '내부')}</InternalTag>}
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

      {/* 업무 후보 알림 배너 — pending 후보가 있을 때만 (안내 전용 — 우측 패널이 이미 열려 있으니 X 로 닫기만) */}
      {!isClient && candidatesCount > 0 && !bannerDismissed && (
        <CandidatesBanner>
          <BannerText>
            {t('chat.banner.candidatesPending', { count: candidatesCount })}
          </BannerText>
          <BannerCloseBtn type="button" onClick={() => setBannerDismissed(true)} aria-label={t('chat.banner.dismiss', '닫기') as string}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </BannerCloseBtn>
        </CandidatesBanner>
      )}

      {/* 메시지 흐름 */}
      <MessageList ref={messageListRef} onScroll={handleScrollSave}>
        {convMessages.length === 0 && (
          <NoMsgBox>{t('chat.noMessages', '첫 메시지를 보내세요')}</NoMsgBox>
        )}
        {convMessages.map((m) => (
          <MessageItem key={m.id} data-msg-id={m.id}>
            <LetterAvatar
              name={m.sender_name}
              size={36}
              variant={m.sender_role === 'cue' ? 'cue' : 'neutral'}
            />
            <MessageBody>
              <MessageHeader>
                <SenderName>{m.sender_name}</SenderName>
                <TimeStamp>{formatTime(m.created_at)}</TimeStamp>
                {m.sender_role === 'cue' && <CueBadge>Cue</CueBadge>}
              </MessageHeader>
              {m.card?.card_type === 'signature_request' ? (
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
                  const ic = m.card as import('./mock').InvoiceCardMeta;
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
              ) : m.card ? (
                <DocCard type="button" onClick={() => setPreviewCard(m.card as import('./mock').PostCardMeta)}>
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
                      <MessageText $question={!!m.is_question}>{m.body}</MessageText>
                      {translated && <TranslatedText>{translated}</TranslatedText>}
                    </>
                  );
                })()
              )}
              {m.card?.note && <CardNote>{m.card.note}</CardNote>}

              {m.attachments && m.attachments.length > 0 && (
                <AttachRow>
                  {m.attachments.map((a) => {
                    const isImg = (a.mime_type || '').startsWith('image/');
                    const dl = `/api/message-attachments/${a.id}/download`;
                    return isImg ? (
                      <AttachImageLink key={a.id} href={dl} target="_blank" rel="noreferrer">
                        <AttachImage src={dl} alt={a.file_name} />
                      </AttachImageLink>
                    ) : (
                      <AttachFileLink key={a.id} href={dl} target="_blank" rel="noreferrer" title={a.file_name}>
                        <AttachIcon>{a.file_name.split('.').pop()?.slice(0, 3).toUpperCase() || 'FILE'}</AttachIcon>
                        <AttachName>{a.file_name}</AttachName>
                        <AttachSize>{(a.file_size / 1024).toFixed(0)}KB</AttachSize>
                      </AttachFileLink>
                    );
                  })}
                </AttachRow>
              )}

              {/* 출처 인용 (Cue 메시지일 때) */}
              {m.ai_sources && m.ai_sources.length > 0 && (
                <SourceBox>
                  <SourceLabel>{t('chat.draft.sourceLabel', '출처')}</SourceLabel>
                  {m.ai_sources.map((s, i) => (
                    <SourceItem key={i}>{s.title} · {s.section}</SourceItem>
                  ))}
                </SourceBox>
              )}

              {/* 질문 아래 Cue 답변 대기 카드 (담당자만) */}
              {m.is_question && m.cue_draft && !isClient && (
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
            </MessageBody>
          </MessageItem>
        ))}
      </MessageList>

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
        {(stagedFiles.length > 0 || stagedExistingIds.length > 0) && (
          <StagedRow>
            {stagedFiles.map((f, i) => (
              <StagedChip key={`new-${i}`}>
                <StagedName title={f.name}>{f.name}</StagedName>
                <StagedSize>{(f.size / 1024).toFixed(0)}KB</StagedSize>
                <StagedX type="button" onClick={() => removeStaged(i)} aria-label="remove">×</StagedX>
              </StagedChip>
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
          </StagedRow>
        )}
        <InputWrap>
          <AttachBtn type="button" onClick={() => setFilePickerOpen(true)} title={t('chat.input.attach', '파일 첨부') as string}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
            </svg>
          </AttachBtn>
          <TextInput
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onCompositionStart={handleCompositionStart}
            onCompositionEnd={handleCompositionEnd}
            placeholder={t('chat.input.placeholder', '메시지를 입력하세요 (Enter 전송 · Shift+Enter 줄바꿈)')}
            rows={1}
          />
          <SendBtn disabled={!input.trim() && stagedFiles.length === 0} onClick={handleSend}>
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
          title={t('chat.input.attach', '파일 첨부') as string}
          mode="both"
          variant="modal"
          multiple
        />
      )}
    </Container>
  );
};

export default ChatPanel;

// ─────────────────────────────────────────────
const Container = styled.main<{ $mobileHidden?: boolean }>`
  flex: 1;
  min-width: 0;
  background: #FFFFFF;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  ${mediaTablet} {
    display: ${(p) => (p.$mobileHidden ? 'none' : 'flex')};
    width: 100%;
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
`;

const HeaderTitleBlock = styled.div`
  display: flex;
  align-items: center;
  min-width: 0;
  flex: 1;
  gap: 10px;
  flex-wrap: nowrap;
`;

const ChatNameRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex-shrink: 1;
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

const InternalTag = styled.span`
  padding: 1px 7px;
  background: #F1F5F9;
  color: #64748B;
  font-size: 10px;
  font-weight: 700;
  border-radius: 10px;
  letter-spacing: 0.2px;
  flex-shrink: 0;
`;

const CustomerTag = styled.span`
  padding: 1px 7px;
  background: #FEF3C7;
  color: #92400E;
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


const CandidatesBanner = styled.div`
  margin: 10px 16px 0;
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

const MessageItem = styled.div`
  display: flex;
  gap: 12px;
  align-items: flex-start;
`;

const MessageBody = styled.div`
  flex: 1;
  min-width: 0;
`;

const MessageHeader = styled.div`
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 4px;
`;

const SenderName = styled.span`
  font-size: 13px;
  font-weight: 600;
  color: #0F172A;
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
  display: flex; flex-wrap: wrap; gap: 6px; padding: 6px 12px 0;
`;
const StagedChip = styled.div`
  display: inline-flex; align-items: center; gap: 6px; padding: 4px 8px;
  background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 6px;
  font-size: 11px; color: #475569; max-width: 220px;
`;
const StagedName = styled.span`white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 140px;`;
const StagedSize = styled.span`color: #94A3B8; font-size: 10px;`;
const ExistingDot = styled.span`
  width: 6px; height: 6px; border-radius: 50%;
  background: #14B8A6; flex-shrink: 0;
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
