// N+63 — 알림 feed full list 페이지. Activity Feed (확인 필요 = Action Queue 와 분리).
//   filter: 전체 / 미읽음. read-all 버튼. 클릭 시 link 이동 + 자동 읽음.
import React, { useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageShell from '../../components/Layout/PageShell';
import { useNotifications, type NotificationItem } from '../../hooks/useNotifications';
import { useTimeFormat } from '../../hooks/useTimeFormat';

const NotificationsPage: React.FC = () => {
  const { t } = useTranslation('layout');
  const navigate = useNavigate();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const { items, loading, markRead, markAllRead } = useNotifications({ limit: 100, unreadOnly, autoRefresh: true });
  const { formatTimeAgo, formatDateTime } = useTimeFormat();

  const handleClick = (item: NotificationItem) => {
    if (!item.read_at) markRead(item.id);
    if (item.link) navigate(item.link);
  };
  const unreadCount = items.filter(i => !i.read_at).length;

  const actions = (
    <Actions>
      <FilterBtn $active={!unreadOnly} type="button" onClick={() => setUnreadOnly(false)}>
        {t('notifications.filterAll', '전체')} ({items.length})
      </FilterBtn>
      <FilterBtn $active={unreadOnly} type="button" onClick={() => setUnreadOnly(true)}>
        {t('notifications.filterUnread', '미읽음')} ({unreadCount})
      </FilterBtn>
      {unreadCount > 0 && (
        <ReadAllBtn type="button" onClick={markAllRead}>
          {t('notifications.markAllRead', '모두 읽음')}
        </ReadAllBtn>
      )}
    </Actions>
  );

  return (
    <PageShell title={t('notifications.title', '알림') as string} actions={actions}>
      {loading && items.length === 0 ? (
        <Loading>{t('notifications.loading', '불러오는 중…')}</Loading>
      ) : items.length === 0 ? (
        <Empty>
          <EmptyIcon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </EmptyIcon>
          <EmptyTitle>{t(unreadOnly ? 'notifications.emptyUnreadTitle' : 'notifications.emptyTitle', unreadOnly ? '모두 읽었어요' : '새 알림이 없어요')}</EmptyTitle>
          <EmptyHint>{t('notifications.emptyHint', '댓글·일정·결제 등 알림이 여기로 모입니다.')}</EmptyHint>
        </Empty>
      ) : (
        <List>
          {items.map(it => (
            <Item key={it.id} type="button" onClick={() => handleClick(it)} $unread={!it.read_at}>
              <ItemBody>
                <ItemTitle $unread={!it.read_at}>{it.title}</ItemTitle>
                {it.body && <ItemDesc>{it.body}</ItemDesc>}
                <ItemMetaRow>
                  <ItemMeta>{formatTimeAgo(it.created_at)}</ItemMeta>
                  <ItemMetaDate>{formatDateTime(it.created_at)}</ItemMetaDate>
                </ItemMetaRow>
              </ItemBody>
              {!it.read_at && <UnreadDot />}
            </Item>
          ))}
        </List>
      )}
    </PageShell>
  );
};

export default NotificationsPage;

const Actions = styled.div` display: flex; align-items: center; gap: 8px; `;
const FilterBtn = styled.button<{ $active: boolean }>`
  padding: 6px 12px; border-radius: 999px;
  background: ${p => p.$active ? '#0F172A' : '#F1F5F9'};
  color: ${p => p.$active ? '#fff' : '#475569'};
  border: none; cursor: pointer;
  font-size: 12px; font-weight: 500;
  &:hover { background: ${p => p.$active ? '#0F172A' : '#E2E8F0'}; }
`;
const ReadAllBtn = styled.button`
  padding: 6px 12px; border-radius: 6px;
  background: transparent; border: 1px solid #CBD5E1;
  color: #475569; font-size: 12px; font-weight: 500; cursor: pointer;
  &:hover { background: #F0FDFA; color: #0F766E; border-color: #5EEAD4; }
`;
const Loading = styled.div` padding: 60px 16px; text-align: center; color: #94A3B8; font-size: 14px; `;
const Empty = styled.div`
  padding: 60px 16px; text-align: center;
  display: flex; flex-direction: column; align-items: center; gap: 10px;
`;
const EmptyIcon = styled.svg` width: 48px; height: 48px; color: #CBD5E1; `;
const EmptyTitle = styled.div` font-size: 15px; font-weight: 700; color: #334155; `;
const EmptyHint = styled.div` font-size: 13px; color: #94A3B8; `;
const List = styled.div`
  display: flex; flex-direction: column; gap: 4px;
  max-width: 800px; margin: 0 auto;
`;
const Item = styled.button<{ $unread: boolean }>`
  display: flex; gap: 12px; align-items: flex-start;
  width: 100%; padding: 14px 16px; border-radius: 10px;
  background: ${p => p.$unread ? '#F0FDFA' : '#FFFFFF'};
  border: 1px solid ${p => p.$unread ? '#5EEAD4' : '#E2E8F0'};
  cursor: pointer; text-align: left;
  transition: background 0.12s, border-color 0.12s;
  &:hover { background: ${p => p.$unread ? '#CCFBF1' : '#F8FAFC'}; }
`;
const ItemBody = styled.div` flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; `;
const ItemTitle = styled.div<{ $unread: boolean }>`
  font-size: 14px; font-weight: ${p => p.$unread ? 600 : 500}; color: #0F172A;
`;
const ItemDesc = styled.div` font-size: 13px; color: #475569; line-height: 1.5; `;
const ItemMetaRow = styled.div` display: flex; gap: 8px; align-items: baseline; margin-top: 4px; `;
const ItemMeta = styled.div` font-size: 11px; color: #94A3B8; `;
const ItemMetaDate = styled.div` font-size: 11px; color: #CBD5E1; `;
const UnreadDot = styled.span`
  width: 10px; height: 10px; border-radius: 50%; background: #14B8A6;
  flex-shrink: 0; margin-top: 7px;
`;
