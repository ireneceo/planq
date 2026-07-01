import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { type MockProject, type MockConversation } from './types';
import { useAuth } from '../../contexts/AuthContext';
import HelpDot from '../../components/Common/HelpDot';
import LetterAvatar from '../../components/Common/LetterAvatar';
import SearchBoxCommon from '../../components/Common/SearchBox';
import { useListKeyboardNav } from '../../hooks/useListKeyboardNav';
import { mediaTablet } from '../../theme/breakpoints';

interface Props {
  projects: MockProject[];
  conversations: MockConversation[];
  activeProjectId: number | null;
  activeConversationId: number | null;
  /** 초기 fetch 진행 중 + 캐시 없음 — true 일 때 skeleton 노출 (사이클 N+15-A) */
  loading?: boolean;
  onSelectConversation: (projectId: number, conversationId: number) => void;
  onOpenNewChat: () => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** 핀(즐겨찾기) 토글 — 부모가 API 호출 + 옵티미스틱 업데이트 */
  onTogglePin?: (conversationId: number, pinned: boolean) => void;
  /** 채팅방 관리 권한 — 부모가 user role 기반으로 계산. true 면 ⋮ 메뉴 노출. */
  canManage?: (c: MockConversation) => boolean;
  /** 채팅방 보관 (soft delete) — ConfirmDialog 후 실행 */
  onArchive?: (c: MockConversation) => void;
  /** 프로젝트에서 분리 (project_id=null) — ConfirmDialog 후 실행 */
  onUnlink?: (c: MockConversation) => void;
  /** 보관함 보기 (워크스페이스 admin only) — 풋터 링크 클릭 시 호출. 없으면 풋터 숨김. */
  onOpenArchive?: () => void;
  /** 모바일(<=tablet)에서 대화가 선택된 경우 LeftPanel 을 숨김 */
  mobileHidden?: boolean;
}


// 대화 + 프로젝트 join — flat list 구조
interface ChatEntry {
  conversation: MockConversation;
  project: MockProject;
}

const LeftPanel: React.FC<Props> = ({
  projects, conversations, activeConversationId,
  loading = false,
  onSelectConversation, onOpenNewChat, collapsed, onToggleCollapsed,
  onTogglePin, canManage, onArchive, onUnlink, onOpenArchive, mobileHidden = false,
}) => {
  const { t } = useTranslation('qtalk');
  const { user } = useAuth();
  const isClient = user?.business_role === 'client';
  const [query, setQuery] = useState('');

  // ChatRow ⋮ 메뉴 — 한 시점에 한 행만 open. row 외부 클릭 / Esc 닫힘.
  const [menuOpenFor, setMenuOpenFor] = useState<number | null>(null);
  const menuRootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (menuOpenFor == null) return;
    const onDown = (e: MouseEvent) => {
      if (menuRootRef.current && !menuRootRef.current.contains(e.target as Node)) setMenuOpenFor(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpenFor(null); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpenFor]);

  // 프로젝트 대화 + 프로젝트 없는 일반 대화를 1차원 리스트화한 뒤
  // last_message_at DESC 로 정렬 (Slack/카카오톡 패턴 — 새 메시지 오면 위로).
  const chats = useMemo<ChatEntry[]>(() => {
    const result: ChatEntry[] = [];
    for (const p of projects) {
      const convs = conversations
        .filter((c) => c.project_id === p.id)
        .filter((c) => !isClient || c.channel_type !== 'internal');
      for (const c of convs) result.push({ conversation: c, project: p });
    }
    // 일반 대화 (project_id 없음)
    const standalone = conversations
      .filter((c) => !c.project_id)
      .filter((c) => !isClient || c.channel_type !== 'internal');
    const generalProject = {
      id: -1, business_id: 0, name: t('left.generalConversation', '일반 대화'), client_company: '',
      has_cue_activity: false, unread_count: 0,
    } as unknown as ChatEntry['project'];
    for (const c of standalone) {
      result.push({ conversation: c, project: generalProject });
    }
    // 정렬: 핀(my_pinned_at NOT NULL) 우선 → 그 안에서 최근 활동순 (last_message_at DESC).
    // last_message_at 없으면 0 (맨 아래).
    result.sort((a, b) => {
      const ap = a.conversation.my_pinned_at ? 1 : 0;
      const bp = b.conversation.my_pinned_at ? 1 : 0;
      if (ap !== bp) return bp - ap;
      const ta = a.conversation.last_message_at ? new Date(a.conversation.last_message_at).getTime() : 0;
      const tb = b.conversation.last_message_at ? new Date(b.conversation.last_message_at).getTime() : 0;
      return tb - ta;
    });
    return result;
  }, [projects, conversations, isClient, t]);

  const filteredChats = useMemo(() => {
    let list = chats;
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter((x) =>
        x.conversation.name.toLowerCase().includes(q) ||
        x.project.name.toLowerCase().includes(q) ||
        x.project.client_company.toLowerCase().includes(q) ||
        (x.conversation.last_message || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [chats, query]);

  const itemIds = useMemo(() => filteredChats.map((x) => x.conversation.id), [filteredChats]);
  const handleKeyboardChange = useCallback((id: number) => {
    const entry = filteredChats.find((x) => x.conversation.id === id);
    if (entry) onSelectConversation(entry.project.id, entry.conversation.id);
  }, [filteredChats, onSelectConversation]);
  useListKeyboardNav<number>({
    itemIds,
    activeId: activeConversationId,
    onChange: handleKeyboardChange,
    enabled: !collapsed,
    itemSelector: (id) => `[data-qtalk-chat="${id}"]`,
  });

  if (collapsed) {
    // 접힘 상태: 프로젝트 일부만 보여주면 혼동(Irene 지적: "6개 중 3개만" 보임). 완전 접고 엣지 바만.
    return (
      <CollapsedStrip>
        <EdgeHandle
          type="button"
          onClick={onToggleCollapsed}
          aria-label={t('left.expand', '리스트 열기') as string}
          title={t('left.expand', '리스트 열기') as string}
        >
          <EdgeChevron><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg></EdgeChevron>
        </EdgeHandle>
      </CollapsedStrip>
    );
  }

  return (
    <Container $mobileHidden={mobileHidden}>
      <Header>
        <HeaderTop>
          <TitleGroup>
            <HeaderTitle>{t('left.title', 'Q talk')}</HeaderTitle>
            <HelpDot askCue={t('left.help.cuePrefill','Q talk 의 채팅 종류, 자동 추출, 번역 표시가 어떻게 작동하는지 알려줘') as string} topic="qtalk">
              {t('left.help.body','프로젝트 연결·고객 연결 채팅을 만들 수 있습니다. 자동 업무 추출 ON 이면 메시지에서 후보가 우측 패널에 모입니다. 번역 표시 ON 이면 메시지마다 두 언어가 함께 보입니다.')}
            </HelpDot>
          </TitleGroup>
          <HeaderActions>
            {!isClient && (
              <NewChatBtn onClick={onOpenNewChat} title={t('left.newChat', '새 대화')} aria-label="New chat">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </NewChatBtn>
            )}
          </HeaderActions>
        </HeaderTop>
      </Header>
      {/* 패널 우측 엣지 접기 핸들 — 헤더 '<' IconBtn 은 제거하고 이 바로 통일 */}
      <EdgeHandle
        type="button"
        onClick={onToggleCollapsed}
        aria-label={t('left.collapse', '접기') as string}
        title={t('left.collapse', '접기') as string}
      >
        <EdgeChevron><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg></EdgeChevron>
      </EdgeHandle>

      <SearchSection>
        <SearchBoxCommon
          value={query}
          onChange={setQuery}
          placeholder={t('left.searchPlaceholder', '대화·프로젝트 검색') as string}
          shortcutHint="Ctrl+K"
          width="100%"
        />
      </SearchSection>

      <ChatList>
        {/* skeleton: 캐시 없음 + 초기 fetch 진행 중일 때만 노출. 캐시 있으면 항상 실 데이터 우선 표시. */}
        {filteredChats.length === 0 && loading && !query && (
          <SkeletonList aria-busy="true" aria-label="loading conversations">
            {[0, 1, 2, 3].map((i) => (
              <SkeletonRow key={i} style={{ animationDelay: `${i * 0.08}s` }}>
                <SkeletonAvatar />
                <SkeletonText>
                  <SkeletonLine $width="70%" />
                  <SkeletonLine $width="40%" $sub />
                </SkeletonText>
              </SkeletonRow>
            ))}
          </SkeletonList>
        )}
        {filteredChats.length === 0 && !loading && (
          <Empty>
            {query ? t('left.noResults', '검색 결과 없음') : t('left.noChats', '아직 대화가 없습니다')}
          </Empty>
        )}
        {filteredChats.map(({ conversation: c, project: p }) => {
          const isActive = c.id === activeConversationId;
          const isPinned = !!c.my_pinned_at;
          return (
            <ChatRow
              key={c.id}
              data-qtalk-chat={c.id}
              $active={isActive}
              onClick={() => onSelectConversation(p.id, c.id)}
            >
              <LetterAvatar
                name={p.name}
                size={36}
                variant={isActive ? 'active' : 'neutral'}
              />
              <ChatBody>
                <ChatTop>
                  <ChatName $active={isActive}>{c.name}</ChatName>
                  {c.channel_type === 'customer' && <CustomerTag>{t('channelBadge.customer', '고객')}</CustomerTag>}
                </ChatTop>
                {/* 사이클 N+15-D — WhatsApp 패턴 마지막 대화 한 줄. preview 있으면 우선, 없으면 프로젝트명 fallback. */}
                {c.last_message_preview ? (
                  <LastMessagePreview $unread={c.unread_count > 0 && !isActive}>
                    {c.last_message_preview.sender_id === Number(user?.id || 0) ? (
                      <PreviewSenderTag>{t('left.preview.you', '나')}: </PreviewSenderTag>
                    ) : c.last_message_preview.is_ai ? (
                      <PreviewSenderTag>Cue: </PreviewSenderTag>
                    ) : c.channel_type === 'customer' || (p && p.id < 0) ? null : (
                      <PreviewSenderTag>{c.last_message_preview.sender_name || ''}: </PreviewSenderTag>
                    )}
                    <PreviewText>{c.last_message_preview.content}</PreviewText>
                  </LastMessagePreview>
                ) : (
                  <ProjectName>{p.name}</ProjectName>
                )}
              </ChatBody>
              {!isActive && c.unread_count > 0 && <Unread>{c.unread_count}</Unread>}
              {onTogglePin && (
                <PinBtn
                  type="button"
                  $pinned={isPinned}
                  onClick={(e) => { e.stopPropagation(); onTogglePin(c.id, !isPinned); }}
                  aria-label={isPinned ? (t('left.unpin', '핀 해제') as string) : (t('left.pin', '핀 고정') as string)}
                  title={isPinned ? (t('left.unpin', '핀 해제') as string) : (t('left.pin', '핀 고정') as string)}
                >
                  {/* 별 아이콘 — pinned 면 채워짐, 아니면 윤곽 */}
                  <svg width="16" height="16" viewBox="0 0 24 24" fill={isPinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                  </svg>
                </PinBtn>
              )}
              {/* ⋮ 채팅방 관리 메뉴 — workspace owner / project owner / platform admin 만 노출.
                  옵션: 프로젝트에서 분리 (project_id 있을 때) / 채팅방 보관 (Danger). ConfirmDialog 후 실행. */}
              {canManage && canManage(c) && (onArchive || onUnlink) && (
                <MenuRoot ref={menuOpenFor === c.id ? menuRootRef : undefined}>
                  <MenuBtn
                    type="button"
                    $open={menuOpenFor === c.id}
                    onClick={(e) => { e.stopPropagation(); setMenuOpenFor((prev) => prev === c.id ? null : c.id); }}
                    aria-label={t('left.menu.aria', '채팅방 메뉴') as string}
                    aria-haspopup="menu"
                    aria-expanded={menuOpenFor === c.id}
                    title={t('left.menu.aria', '채팅방 메뉴') as string}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" />
                    </svg>
                  </MenuBtn>
                  {menuOpenFor === c.id && (
                    <Popover role="menu" onClick={(e) => e.stopPropagation()}>
                      {c.project_id && onUnlink && (
                        <MenuItem
                          type="button" role="menuitem"
                          onClick={() => { setMenuOpenFor(null); onUnlink(c); }}
                        >
                          <MenuIcon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                            <line x1="2" y1="2" x2="22" y2="22" />
                          </MenuIcon>
                          {t('left.menu.unlink', '프로젝트에서 분리')}
                        </MenuItem>
                      )}
                      {c.project_id && onUnlink && onArchive && <MenuDivider />}
                      {onArchive && (
                        <MenuItem
                          type="button" role="menuitem" $danger
                          onClick={() => { setMenuOpenFor(null); onArchive(c); }}
                        >
                          <MenuIcon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M21 8v13H3V8" /><rect x="1" y="3" width="22" height="5" /><line x1="10" y1="12" x2="14" y2="12" />
                          </MenuIcon>
                          {t('left.menu.archive', '채팅방 보관')}
                        </MenuItem>
                      )}
                    </Popover>
                  )}
                </MenuRoot>
              )}
            </ChatRow>
          );
        })}
      </ChatList>
      {/* 보관함 진입점 — 워크스페이스 admin 만 노출. 풋터는 항상 좌측 하단 고정. */}
      {onOpenArchive && (
        <Footer>
          <ArchiveLink type="button" onClick={onOpenArchive} title={t('left.viewArchived', '보관된 채팅 보기') as string}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 8v13H3V8" /><rect x="1" y="3" width="22" height="5" /><line x1="10" y1="12" x2="14" y2="12" />
            </svg>
            <span>{t('left.viewArchived', '보관된 채팅')}</span>
          </ArchiveLink>
        </Footer>
      )}
    </Container>
  );
};

export default LeftPanel;

// ─────────────────────────────────────────────
const Container = styled.aside<{ $mobileHidden?: boolean }>`
  /* 좌측 리스트 폭 — Q note/Q docs 와 동일 (300px). 좌측 리스트 패턴 통일 */
  width: 300px;
  flex-shrink: 0;
  background: #FFFFFF;
  border-right: 1px solid #E2E8F0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
  ${mediaTablet} {
    display: ${(p) => (p.$mobileHidden ? 'none' : 'flex')};
    width: 100%;
    border-right: none;
  }
`;

/* 접힘 상태: 0 폭 컨테이너 + 내부 EdgeHandle 만 경계에 노출. Q Note 와 동일한 "완전 접힘" UX */
const CollapsedStrip = styled.aside`
  width: 0;
  flex-shrink: 0;
  position: relative;
  ${mediaTablet} { display: none; }
`;

/* N+63 — 시인성·세련도 강화. 평소 12×72 진한 색 + chevron 14×14, hover 18×84 teal + nudge animation. */
const EdgeHandle = styled.button`
  position: absolute;
  top: 50%;
  right: 0;
  transform: translate(50%, -50%);
  width: 12px; height: 72px;
  padding: 0; border: none;
  background: linear-gradient(180deg, #94A3B8 0%, #64748B 100%);
  border-radius: 6px;
  cursor: pointer;
  z-index: 10;
  box-shadow: 0 2px 6px rgba(15,23,42,0.15), 0 0 0 1px rgba(255,255,255,0.4) inset;
  transition: width 0.2s ease, height 0.2s ease, background 0.2s ease, box-shadow 0.2s ease;
  display: flex; align-items: center; justify-content: center;
  &::before {
    content: ''; position: absolute;
    top: -10px; bottom: -10px; left: -12px; right: -12px;
  }
  &:hover {
    width: 18px; height: 84px;
    background: linear-gradient(180deg, #14B8A6 0%, #0F766E 100%);
    box-shadow: 0 4px 12px rgba(20,184,166,0.35), 0 0 0 1px rgba(255,255,255,0.6) inset;
  }
  &:hover svg { animation: chevronNudgePanelL 0.7s ease infinite; }
  &:active { transform: translate(50%, -50%) scale(0.95); }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 3px; }
  @keyframes chevronNudgePanelL {
    0%, 100% { transform: translateX(0); }
    50% { transform: translateX(-2px); }
  }
  @media (prefers-reduced-motion: reduce) {
    transition: none;
    &:hover { width: 12px; height: 72px; }
    &:hover svg { animation: none; }
    &:active { transform: translate(50%, -50%); }
  }
`;
const EdgeChevron = styled.span`
  display: flex; align-items: center; justify-content: center;
  color: #FFFFFF;
  svg { width: 14px; height: 14px; transition: transform 0.18s ease; }
`;

const Header = styled.div`
  padding: 14px 20px;
  min-height: 60px;
  border-bottom: 1px solid #E2E8F0;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
`;

const HeaderTop = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
`;

// 제목 + helpDot 묶음 — 제목 끝나면 helpDot 바로 (Q Note 와 동일 패턴, PageShell 표준)
const TitleGroup = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
`;

// 새 대화 + 버튼 — Primary teal 활성화 (Q Note NewSessionBtn 패턴 일관)
const NewChatBtn = styled.button`
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: #14B8A6;
  border: none;
  border-radius: 8px;
  color: #FFFFFF;
  cursor: pointer;
  transition: background 0.15s;
  flex-shrink: 0;
  &:hover { background: #0D9488; }
  &:focus-visible { outline: 2px solid rgba(20, 184, 166, 0.3); outline-offset: 2px; }
`;

const SearchSection = styled.div`
  padding: 12px 20px 8px;
  flex-shrink: 0;
  border-bottom: 1px solid #F1F5F9;
`;

const HeaderTitle = styled.h1`
  font-size: 18px;
  font-weight: 700;
  color: #0F172A;
  margin: 0;
  letter-spacing: -0.2px;
`;

const HeaderActions = styled.div`
  display: flex;
  gap: 4px;
`;

const ChatList = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 6px 6px 12px;
  &::-webkit-scrollbar { width: 6px; }
  &::-webkit-scrollbar-thumb { background: #E2E8F0; border-radius: 3px; }
`;

const Empty = styled.div`
  padding: 32px 20px;
  text-align: center;
  color: #94A3B8;
  font-size: 12px;
`;

// 사이클 N+15-A — 초기 로딩 skeleton (Slack/카카오톡 패턴).
// 캐시 없음 + 초기 fetch 진행 시 4 행 placeholder. 펄스 애니메이션은 stagger 로 자연스럽게.
const SkeletonList = styled.div`
  padding: 6px 4px;
`;
const SkeletonRow = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 10px;
  margin: 2px 0;
  border-radius: 10px;
  animation: pq-skel-pulse 1.6s ease-in-out infinite;
  @keyframes pq-skel-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.55; }
  }
`;
const SkeletonAvatar = styled.div`
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: linear-gradient(90deg, #F1F5F9 0%, #E2E8F0 50%, #F1F5F9 100%);
  background-size: 200% 100%;
  animation: pq-skel-shimmer 1.4s linear infinite;
  flex-shrink: 0;
  @keyframes pq-skel-shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }
`;
const SkeletonText = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
`;
const SkeletonLine = styled.div<{ $width: string; $sub?: boolean }>`
  width: ${(p) => p.$width};
  height: ${(p) => (p.$sub ? '8px' : '10px')};
  border-radius: 4px;
  background: linear-gradient(90deg, #F1F5F9 0%, #E2E8F0 50%, #F1F5F9 100%);
  background-size: 200% 100%;
  animation: pq-skel-shimmer 1.4s linear infinite;
`;

const Footer = styled.div`
  flex-shrink: 0;
  padding: 8px 10px;
  border-top: 1px solid #E2E8F0;
  background: #FFFFFF;
`;
const ArchiveLink = styled.button`
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  background: transparent;
  border: none;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 500;
  color: #64748B;
  cursor: pointer;
  text-align: left;
  transition: background 0.15s, color 0.15s;
  &:hover { background: #F1F5F9; color: #0F172A; }
  svg { flex-shrink: 0; }
`;

const ChatRow = styled.div<{ $active: boolean }>`
  display: flex;
  /* 사이클 N+22: 별·⋮ 가 row 중앙에 정렬되도록 center. flex-start 였을 땐 2줄 body 옆에서 위로 떠있어 시각 노이즈 + 거리감.
     body 는 flex column 이라 자체 정렬 영향 없음. */
  align-items: center;
  gap: 10px;
  padding: 10px 10px;
  margin: 2px 0;
  border-radius: 10px;
  cursor: pointer;
  transition: background 0.1s;
  background: ${(p) => (p.$active ? '#F0FDFA' : 'transparent')};
  ${(p) => p.$active && 'box-shadow: inset 3px 0 0 #0D9488;'}
  &:hover {
    ${(p) => !p.$active && 'background: #F8FAFC;'}
  }
`;

const ChatBody = styled.div`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
`;

const ChatTop = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
`;

const ChatName = styled.div<{ $active: boolean }>`
  font-size: 13px;
  font-weight: ${(p) => (p.$active ? 700 : 600)};
  color: #0F172A;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
`;

// [고객] 라벨 — channel_type='customer' 인 대화방에만 노출.
// '내부' 는 default 상태라 라벨 X (시각 노이즈 최소화 — Slack 의 #channel 패턴).
const CustomerTag = styled.span`
  padding: 1px 5px;
  background: rgba(244, 63, 94, 0.10);
  color: #BE123C;
  font-size: 9px;
  font-weight: 700;
  border-radius: 8px;
  flex-shrink: 0;
  letter-spacing: 0.2px;
`;

const ProjectName = styled.div`
  font-size: 11px;
  color: #94A3B8;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

// 사이클 N+15-D — WhatsApp 패턴 last_message preview.
// unread 시 글자색 진하게 (대비) + 굵게 / 읽음·active 시 옅게.
// 1줄 ellipsis, 발신자 prefix 가 있으면 회색 + ': '.
const LastMessagePreview = styled.div<{ $unread: boolean }>`
  font-size: 12px;
  font-weight: ${(p) => (p.$unread ? 600 : 400)};
  color: ${(p) => (p.$unread ? '#334155' : '#94A3B8')};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 2px;
  line-height: 1.35;
`;
const PreviewSenderTag = styled.span`
  color: #94A3B8;
  font-weight: 500;
`;
const PreviewText = styled.span``;

// 읽지 않은 메시지 수 — ChatBody 옆, PinBtn 좌측. ChatRow 의 직접 자식이라
// ChatName flex:1 에 squeeze 되지 않고 항상 우측에 명확히 표시. 데스크탑·모바일 일관.
// 모바일에선 살짝 더 크게 (가시성 강화).
const Unread = styled.div`
  min-width: 18px;
  height: 18px;
  padding: 0 6px;
  background: #F43F5E;
  color: #FFFFFF;
  border-radius: 8px;
  font-size: 10px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  align-self: center;
  @media (max-width: 1024px) {
    min-width: 20px; height: 20px; font-size: 11px;
  }
`;

// 핀(즐겨찾기) 토글 — 사이클 N+15-E: 상시 노출 (hover-only 폐지).
// 옛 hover 노출은 "다른 row 호버할 때 별이 깜빡거리는" 인상을 유발 → 사용자가 의도와 무관해 보임.
// 항상 28x28 자리 차지, 색상으로만 상태 구분.
//   pinned=true: amber 채움 / pinned=false: 연회색 outline
// 사이클 N+22: 별·⋮ 사이 거리 = 별이 끝나면 바로 ⋮. 옛 4px+2px 빈 공간 제거. row 우측 핸들 묶음 효과.
const PinBtn = styled.button<{ $pinned: boolean }>`
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  margin: 0;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  color: ${(p) => (p.$pinned ? '#F59E0B' : '#CBD5E1')};
  transition: background 0.15s, color 0.15s;
  &:hover { background: ${(p) => (p.$pinned ? '#FEF3C7' : '#F1F5F9')}; color: ${(p) => (p.$pinned ? '#D97706' : '#94A3B8')}; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 1px; }
`;

// ⋮ 채팅방 관리 메뉴 — workspace owner / project owner / platform admin 만 노출.
// 데스크탑: hover-only 노이즈 최소. 모바일: 상시 노출 (PinBtn 패턴 일치).
// 사이클 N+22: 별 옆에 바짝 붙임 — 옛 ChatRow gap:10px 만큼 떨어져있던 거리를 -6px negative margin 으로 보정.
const MenuRoot = styled.div`
  position: relative;
  flex-shrink: 0;
  align-self: center;
  margin-left: -6px;
`;

// 사이클 N+15-E — 상시 노출. 옛 hover-only 는 사용자가 발견하지 못함 + 호버 깜빡임 노이즈.
// 평소 연회색, 호버/오픈 시 진한 색 + 배경 tint.
const MenuBtn = styled.button<{ $open: boolean }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  margin: 0;
  padding: 0;
  background: ${(p) => (p.$open ? '#F1F5F9' : 'transparent')};
  border: none;
  border-radius: 6px;
  cursor: pointer;
  color: ${(p) => (p.$open ? '#14B8A6' : '#CBD5E1')};
  transition: background 0.15s, color 0.15s;
  &:hover { background: #F1F5F9; color: #0F172A; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 1px; }
`;

// Popover — Linear/Slack 패턴. 우측 정렬해서 ⋮ 바로 아래 펼침.
const Popover = styled.div`
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  min-width: 200px;
  background: #FFFFFF;
  border: 1px solid #E2E8F0;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.08);
  padding: 4px;
  z-index: 100;
  animation: pq-popover-in 0.12s ease-out;
  @keyframes pq-popover-in {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
  }
`;

const MenuItem = styled.button<{ $danger?: boolean }>`
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: transparent;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  color: ${(p) => (p.$danger ? '#B91C1C' : '#334155')};
  text-align: left;
  white-space: nowrap;
  transition: background 0.1s;
  &:hover { background: ${(p) => (p.$danger ? '#FEF2F2' : '#F8FAFC')}; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: -2px; }
`;

const MenuIcon = styled.svg`
  width: 14px;
  height: 14px;
  flex-shrink: 0;
`;

const MenuDivider = styled.div`
  height: 1px;
  background: #F1F5F9;
  margin: 4px 0;
`;
