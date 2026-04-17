import React, { useMemo, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import {
  type MockMessage, type MockProject, type MockConversation,
  formatTime,
} from './mock';
import { useAuth } from '../../contexts/AuthContext';
import LetterAvatar from '../../components/Common/LetterAvatar';

interface Props {
  project: MockProject | null;
  conversations: MockConversation[];
  messages: Record<number, MockMessage[]>;
  activeConversationId: number | null;
  onSelectConversation: (conversationId: number) => void;
  onOpenExtract: () => void;
  onSendMessage: (body: string) => void;
  onCueDraftSend: (messageId: number, editedBody?: string) => void;
  onCueDraftReject: (messageId: number) => void;
  onToggleAutoExtract: (conversationId: number, enabled: boolean) => void;
  onRenameConversation: (conversationId: number, name: string) => void;
  candidatesCount: number;
  extracting?: boolean;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  onToggleLeft: () => void;
  onToggleRight: () => void;
}

const ChatPanel: React.FC<Props> = ({
  project, conversations, messages, activeConversationId, onSelectConversation,
  onOpenExtract, onSendMessage, onCueDraftSend, onCueDraftReject,
  onToggleAutoExtract, onRenameConversation,
  candidatesCount, extracting, leftCollapsed, rightCollapsed, onToggleLeft, onToggleRight,
}) => {
  const { t } = useTranslation('qtalk');
  const { user } = useAuth();
  const isClient = user?.business_role === 'client';

  const channels = useMemo(() => {
    if (!project) return [];
    return conversations
      .filter((c) => c.project_id === project.id)
      .filter((c) => !isClient || c.channel_type !== 'internal'); // 고객은 internal 숨김
  }, [project, conversations, isClient]);

  const activeConv = channels.find((c) => c.id === activeConversationId) || channels[0] || null;
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

  const handleSend = () => {
    if (!input.trim()) return;
    onSendMessage(input);
    setInput('');
    // 내가 보낸 메시지는 스크롤 위치와 무관하게 항상 바닥으로
    scrollToBottom();
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
      const key = scrollKey(activeConv?.id);
      let restored = false;
      if (key) {
        const saved = localStorage.getItem(key);
        if (saved !== null) {
          const target = Number(saved);
          if (Number.isFinite(target) && target >= 0) {
            // DOM commit 후 적용
            window.requestAnimationFrame(() => {
              window.requestAnimationFrame(() => {
                const el = messageListRef.current;
                if (!el) return;
                // target 이 현재 scrollHeight 범위 안이면 그대로, 밖이면 바닥
                const max = el.scrollHeight - el.clientHeight;
                el.scrollTop = Math.min(target, max);
              });
            });
            restored = true;
          }
        }
      }
      if (!restored) scrollToBottom(false);
      return;
    }

    if (next > prev) {
      // 새 메시지 도착 — sticky-to-bottom
      const list = messageListRef.current;
      if (!list) { scrollToBottom(); return; }
      const distance = list.scrollHeight - list.scrollTop - list.clientHeight;
      if (distance < 120) scrollToBottom();
    }
  }, [convMessages, scrollToBottom, activeConv?.id]);

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

  if (!project) {
    return (
      <Container>
        <EmptyState>
          <EmptyIcon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </EmptyIcon>
          <EmptyTitle>{t('chat.noProject', '프로젝트를 선택하세요')}</EmptyTitle>
          <EmptyDesc>{t('chat.noProjectDesc', '좌측 리스트에서 프로젝트를 선택하거나 새 프로젝트를 생성하세요.')}</EmptyDesc>
        </EmptyState>
      </Container>
    );
  }

  if (!activeConv) {
    return (
      <Container>
        <HeaderBar>
          <HeaderLeft>
            {leftCollapsed && (
              <IconBtn onClick={onToggleLeft} title="열기">
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
        <EmptyState>
          <EmptyTitle>{t('chat.noChannel', '대화 채널이 없습니다')}</EmptyTitle>
        </EmptyState>
      </Container>
    );
  }

  return (
    <Container>
      {/* 헤더: 채팅방 이름이 주인공, 프로젝트는 서브라벨 */}
      <HeaderBar>
        <HeaderLeft>
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
                {activeConv.channel_type === 'internal' && <InternalTag>내부</InternalTag>}
                {activeConv.channel_type === 'customer' && <CustomerTag>고객</CustomerTag>}
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
          {rightCollapsed && (
            <IconBtn onClick={onToggleRight} title={t('chat.expandRight', '우측 열기')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </IconBtn>
          )}
        </HeaderRight>
      </HeaderBar>

      {/* 업무 후보 안내 배너 (있을 때만) */}
      {!isClient && candidatesCount > 0 && (
        <CandidatesBanner>
          <BannerText>
            {t('chat.banner.newMessages', '새 메시지 {{n}}개 — 업무로 정리할 준비가 되었어요', { n: 5 })}
          </BannerText>
          <BannerActions>
            <BannerBtn onClick={onOpenExtract}>{t('chat.banner.extract', '업무 추출')}</BannerBtn>
            <BannerBtn $ghost>{t('chat.banner.later', '나중에')}</BannerBtn>
          </BannerActions>
        </CandidatesBanner>
      )}

      {/* 메시지 흐름 */}
      <MessageList ref={messageListRef} onScroll={handleScrollSave}>
        {convMessages.length === 0 && (
          <EmptyState>
            <EmptyTitle>{t('chat.noMessages', '첫 메시지를 보내세요')}</EmptyTitle>
          </EmptyState>
        )}
        {convMessages.map((m) => (
          <MessageItem key={m.id}>
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
              <MessageText $question={!!m.is_question}>{m.body}</MessageText>

              {/* 출처 인용 (Cue 메시지일 때) */}
              {m.ai_sources && m.ai_sources.length > 0 && (
                <SourceBox>
                  <SourceLabel>출처</SourceLabel>
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
              <CueBadgeInline>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="18 15 12 9 6 15" />
                </svg>
                {t('chat.input.cueWaiting', 'Cue 답변 대기 {{n}}개', { n: cueDraftCount })}
              </CueBadgeInline>
            )}
          </InputToolbar>
        )}
        <InputWrap>
          <TextInput
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onCompositionStart={handleCompositionStart}
            onCompositionEnd={handleCompositionEnd}
            placeholder={t('chat.input.placeholder', '메시지를 입력하세요 (Enter 전송 · Shift+Enter 줄바꿈)')}
            rows={1}
          />
          <SendBtn disabled={!input.trim()} onClick={handleSend}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </SendBtn>
        </InputWrap>
      </InputBar>
    </Container>
  );
};

export default ChatPanel;

// ─────────────────────────────────────────────
const Container = styled.main`
  flex: 1;
  min-width: 0;
  background: #FFFFFF;
  display: flex;
  flex-direction: column;
  overflow: hidden;
`;

const HeaderBar = styled.div`
  min-height: 60px;
  padding: 10px 16px;
  border-bottom: 1px solid #E2E8F0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-shrink: 0;
`;

const HeaderTitleBlock = styled.div`
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
  gap: 2px;
`;

const ChatNameRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
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
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: #94A3B8;
  font-weight: 500;
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

const BannerActions = styled.div`
  display: flex;
  gap: 6px;
`;

const BannerBtn = styled.button<{ $ghost?: boolean }>`
  padding: 5px 12px;
  font-size: 12px;
  font-weight: 600;
  background: ${(p) => (p.$ghost ? 'transparent' : '#F59E0B')};
  color: ${(p) => (p.$ghost ? '#92400E' : '#FFFFFF')};
  border: ${(p) => (p.$ghost ? '1px solid #FDE68A' : 'none')};
  border-radius: 6px;
  cursor: pointer;
  &:hover { ${(p) => !p.$ghost && 'background: #D97706;'} }
`;

const MessageList = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  &::-webkit-scrollbar { width: 6px; }
  &::-webkit-scrollbar-thumb { background: #E2E8F0; border-radius: 3px; }
`;

const EmptyState = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  text-align: center;
`;

const EmptyIcon = styled.svg`
  width: 56px;
  height: 56px;
  color: #CBD5E1;
  margin-bottom: 16px;
`;

const EmptyTitle = styled.div`
  font-size: 15px;
  font-weight: 600;
  color: #475569;
  margin-bottom: 6px;
`;

const EmptyDesc = styled.div`
  font-size: 13px;
  color: #94A3B8;
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
  ${(p) => p.$question && `
    padding: 10px 12px;
    background: #FFF1F2;
    border-left: 3px solid #F43F5E;
    border-radius: 6px;
  `}
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

const CueBadgeInline = styled.div`
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  background: #FFF1F2;
  color: #9F1239;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 600;
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
