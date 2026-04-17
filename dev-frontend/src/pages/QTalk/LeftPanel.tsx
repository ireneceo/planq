import React, { useMemo, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { type MockProject, type MockConversation } from './mock';
import { useAuth } from '../../contexts/AuthContext';
import LetterAvatar from '../../components/Common/LetterAvatar';

interface Props {
  projects: MockProject[];
  conversations: MockConversation[];
  activeProjectId: number | null;
  activeConversationId: number | null;
  onSelectConversation: (projectId: number, conversationId: number) => void;
  onOpenNewProject: () => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

type Filter = 'all' | 'unread' | 'mine';

// 대화 + 프로젝트 join — flat list 구조
interface ChatEntry {
  conversation: MockConversation;
  project: MockProject;
}

const LeftPanel: React.FC<Props> = ({
  projects, conversations, activeConversationId,
  onSelectConversation, onOpenNewProject, collapsed, onToggleCollapsed,
}) => {
  const { t } = useTranslation('qtalk');
  const { user } = useAuth();
  const isClient = user?.business_role === 'client';
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');

  // 프로젝트를 돌며 그 프로젝트에 속한 대화를 모두 펼쳐서 1차원 리스트로
  const chats = useMemo<ChatEntry[]>(() => {
    const result: ChatEntry[] = [];
    for (const p of projects) {
      const convs = conversations
        .filter((c) => c.project_id === p.id)
        .filter((c) => !isClient || c.channel_type !== 'internal'); // 고객은 internal 숨김
      for (const c of convs) result.push({ conversation: c, project: p });
    }
    return result;
  }, [projects, conversations, isClient]);

  const filteredChats = useMemo(() => {
    let list = chats;
    if (filter === 'unread') list = list.filter((x) => x.conversation.unread_count > 0);
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
  }, [chats, filter, query]);

  if (collapsed) {
    // 접힘 상태: 고유 프로젝트만 dedupe 해서 아이콘으로 표시
    const uniqueProjects = Array.from(new Map(projects.map((p) => [p.id, p])).values());
    return (
      <CollapsedStrip>
        <CollapsedBtn onClick={onToggleCollapsed} title={t('left.expand', '리스트 열기')}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </CollapsedBtn>
        {uniqueProjects.slice(0, 8).map((p) => {
          const activeChatInProject = chats.find(
            (x) => x.project.id === p.id && x.conversation.id === activeConversationId
          );
          return (
            <CollapsedDotWrap
              key={p.id}
              $hasActivity={p.has_cue_activity || p.unread_count > 0}
              onClick={() => {
                const first = chats.find((x) => x.project.id === p.id);
                if (first) onSelectConversation(p.id, first.conversation.id);
              }}
            >
              <LetterAvatar
                name={p.name}
                size={32}
                variant={activeChatInProject ? 'active' : 'neutral'}
                title={p.name}
              />
            </CollapsedDotWrap>
          );
        })}
      </CollapsedStrip>
    );
  }

  return (
    <Container>
      <Header>
        <HeaderTop>
          <HeaderTitle>{t('left.title', 'Q talk')}</HeaderTitle>
          <HeaderActions>
            {!isClient && (
              <IconBtn onClick={onOpenNewProject} title={t('left.newProject', '새 프로젝트')} aria-label="New project">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </IconBtn>
            )}
            <IconBtn onClick={onToggleCollapsed} title={t('left.collapse', '접기')} aria-label="Collapse">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </IconBtn>
          </HeaderActions>
        </HeaderTop>
      </Header>

      <SearchSection>
        <SearchBox>
          <SearchIcon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </SearchIcon>
          <SearchInput
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('left.searchPlaceholder', '대화·프로젝트 검색  Ctrl+K')}
          />
          {query && (
            <ClearBtn onClick={() => setQuery('')} aria-label="Clear">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </ClearBtn>
          )}
        </SearchBox>

        <FilterRow>
          <FilterBtn $active={filter === 'all'} onClick={() => setFilter('all')}>
            {t('left.filter.all', '전체')}
          </FilterBtn>
          <FilterBtn $active={filter === 'unread'} onClick={() => setFilter('unread')}>
            {t('left.filter.unread', '읽지 않음')}
          </FilterBtn>
          <FilterBtn $active={filter === 'mine'} onClick={() => setFilter('mine')}>
            {t('left.filter.mine', '내 할일')}
          </FilterBtn>
        </FilterRow>
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
                  {c.channel_type === 'internal' && <InternalTag>내부</InternalTag>}
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
  @media (max-width: 900px) { display: none; }
`;

const CollapsedStrip = styled.aside`
  width: 48px;
  flex-shrink: 0;
  background: #FFFFFF;
  border-right: 1px solid #E2E8F0;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 12px 0;
  gap: 8px;
  @media (max-width: 900px) { display: none; }
`;

const CollapsedBtn = styled.button`
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: 8px;
  color: #64748B;
  cursor: pointer;
  &:hover { background: #F1F5F9; color: #0F172A; }
`;

const CollapsedDotWrap = styled.div<{ $hasActivity: boolean }>`
  position: relative;
  cursor: pointer;
  ${(p) => p.$hasActivity && `
    &::after {
      content: '';
      position: absolute;
      top: 2px;
      right: 2px;
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #F43F5E;
      border: 1.5px solid #FFFFFF;
    }
  `}
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

const SearchBox = styled.div`
  position: relative;
  display: flex;
  align-items: center;
  margin-bottom: 10px;
`;

const SearchIcon = styled.svg`
  position: absolute;
  left: 10px;
  width: 14px;
  height: 14px;
  color: #94A3B8;
  pointer-events: none;
`;

const SearchInput = styled.input`
  width: 100%;
  padding: 8px 32px 8px 32px;
  background: #F8FAFC;
  border: 1px solid #E2E8F0;
  border-radius: 8px;
  font-size: 13px;
  color: #0F172A;
  &::placeholder { color: #94A3B8; font-size: 12px; }
  &:focus {
    outline: none;
    border-color: #14B8A6;
    background: #FFFFFF;
    box-shadow: 0 0 0 3px rgba(20, 184, 166, 0.1);
  }
`;

const ClearBtn = styled.button`
  position: absolute;
  right: 8px;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: 4px;
  color: #94A3B8;
  cursor: pointer;
  &:hover { background: #E2E8F0; color: #475569; }
`;

const FilterRow = styled.div`
  display: flex;
  gap: 4px;
`;

const FilterBtn = styled.button<{ $active: boolean }>`
  flex: 1;
  padding: 5px 8px;
  font-size: 11px;
  font-weight: 600;
  background: ${(p) => (p.$active ? '#0F172A' : 'transparent')};
  color: ${(p) => (p.$active ? '#FFFFFF' : '#64748B')};
  border: 1px solid ${(p) => (p.$active ? '#0F172A' : '#E2E8F0')};
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.1s;
  &:hover {
    ${(p) => !p.$active && 'border-color: #CBD5E1; color: #0F172A;'}
  }
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
