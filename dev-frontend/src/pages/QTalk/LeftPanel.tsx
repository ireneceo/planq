import React, { useMemo, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { type MockProject, type MockConversation } from './mock';
import { useAuth } from '../../contexts/AuthContext';
import LetterAvatar from '../../components/Common/LetterAvatar';
import SearchBoxCommon from '../../components/Common/SearchBox';

interface Props {
  projects: MockProject[];
  conversations: MockConversation[];
  activeProjectId: number | null;
  activeConversationId: number | null;
  onSelectConversation: (projectId: number, conversationId: number) => void;
  onOpenNewProject: () => void;
  onOpenNewChat?: () => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}


// 대화 + 프로젝트 join — flat list 구조
interface ChatEntry {
  conversation: MockConversation;
  project: MockProject;
}

const LeftPanel: React.FC<Props> = ({
  projects, conversations, activeConversationId,
  onSelectConversation, onOpenNewProject, onOpenNewChat, collapsed, onToggleCollapsed,
}) => {
  const { t } = useTranslation('qtalk');
  const { user } = useAuth();
  const isClient = user?.business_role === 'client';
  const [query, setQuery] = useState('');

  // 프로젝트 대화 + 프로젝트 없는 일반 대화를 순서대로 1차원 리스트화.
  // 일반 대화는 project 자리에 null 을 둬서 렌더 시 "일반 대화" 라벨로 처리.
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
    for (const c of standalone) {
      result.push({
        conversation: c,
        project: {
          id: -1, business_id: 0, name: t('left.generalConversation', '일반 대화'), client_company: '',
          has_cue_activity: false, unread_count: 0,
          // MockProject 의 나머지 필수 필드들은 방어 기본값
        } as unknown as ChatEntry['project'],
      });
    }
    return result;
  }, [projects, conversations, isClient]);

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
    <Container>
      <Header>
        <HeaderTop>
          <HeaderTitle>{t('left.title', 'Q talk')}</HeaderTitle>
          <HeaderActions>
            {!isClient && onOpenNewChat && (
              <IconBtn onClick={onOpenNewChat} title={t('left.newChat', '새 대화')} aria-label="New chat">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </IconBtn>
            )}
            {!isClient && (
              <IconBtn onClick={onOpenNewProject} title={t('left.newProject', '새 프로젝트')} aria-label="New project">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </IconBtn>
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
        {filteredChats.length === 0 && (
          <Empty>
            {query ? t('left.noResults', '검색 결과 없음') : t('left.noChats', '아직 대화가 없습니다')}
          </Empty>
        )}
        {filteredChats.map(({ conversation: c, project: p }) => {
          const isActive = c.id === activeConversationId;
          return (
            <ChatRow
              key={c.id}
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
                  {c.channel_type === 'internal' && <InternalTag>{t('channelBadge.internal', '내부')}</InternalTag>}
                </ChatTop>
                <ProjectName>{p.name}</ProjectName>
              </ChatBody>
              {c.unread_count > 0 && <Unread>{c.unread_count}</Unread>}
            </ChatRow>
          );
        })}
      </ChatList>
    </Container>
  );
};

export default LeftPanel;

// ─────────────────────────────────────────────
const Container = styled.aside`
  width: 280px;
  flex-shrink: 0;
  background: #FFFFFF;
  border-right: 1px solid #E2E8F0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
  @media (max-width: 900px) { display: none; }
`;

const CollapsedStrip = styled.aside`
  width: 16px;
  flex-shrink: 0;
  background: #FFFFFF;
  border-right: 1px solid #E2E8F0;
  position: relative;
  @media (max-width: 900px) { display: none; }
`;

/* 사이드 패널 접기/펼치기 엣지 핸들 — Secondary/Q Talk 공통 패턴 (2026-04-24 통일) */
const EdgeHandle = styled.button`
  position: absolute;
  top: 50%;
  right: 0;
  transform: translate(50%, -50%);
  width: 8px; height: 60px;
  padding: 0; border: none;
  background: #CBD5E1;
  border-radius: 4px;
  cursor: pointer;
  z-index: 10;
  box-shadow: 0 1px 3px rgba(15,23,42,0.08);
  transition: width 0.15s ease, background 0.15s ease, height 0.15s ease;
  display: flex; align-items: center; justify-content: center;
  &::before {
    content: ''; position: absolute;
    top: -10px; bottom: -10px; left: -8px; right: -8px;   /* 터치 타겟 확장 */
  }
  &:hover { width: 14px; height: 72px; background: #14B8A6; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 2px; }
`;
const EdgeChevron = styled.span`
  display: flex; align-items: center; justify-content: center;
  color: #64748B;
  svg { width: 10px; height: 10px; }
  ${EdgeHandle}:hover & { color: #FFFFFF; }
`;

const Header = styled.div`
  padding: 14px 20px;
  min-height: 60px;
  border-bottom: 1px solid #F1F5F9;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
`;

const HeaderTop = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
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
  transition: all 0.1s;
  &:hover { background: #F1F5F9; color: #0F172A; }
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

const ChatRow = styled.div<{ $active: boolean }>`
  display: flex;
  align-items: flex-start;
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

const InternalTag = styled.span`
  padding: 1px 5px;
  background: #F1F5F9;
  color: #64748B;
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

const Unread = styled.div`
  min-width: 18px;
  height: 18px;
  padding: 0 6px;
  background: #F43F5E;
  color: #FFFFFF;
  border-radius: 9px;
  font-size: 10px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-top: 2px;
`;
