// N+63 — 알림 dropdown (사이드바 종 모양 클릭 시 popover).
//   최근 10건 표시. 클릭 시 link 이동 + 자동 읽음. "모두 읽음" + "전체 보기" 버튼.
import React, { useEffect, useRef } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useChromeNav } from '../../hooks/useChromeNav';
import ChromeLink from '../Tab/ChromeLink';
import { useNotifications, type NotificationItem } from '../../hooks/useNotifications';
import { useTimeFormat } from '../../hooks/useTimeFormat';
import { resolveNotificationLink } from '../../utils/notificationLink';

interface Props {
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
}

const NotificationDropdown: React.FC<Props> = ({ open, onClose, anchorRef }) => {
  const { t } = useTranslation('layout');
  const navigate = useChromeNav();
  const { items, loading, markRead, markAllRead } = useNotifications({ limit: 10, autoRefresh: open });
  const popoverRef = useRef<HTMLDivElement>(null);
  const { formatTimeAgo } = useTimeFormat();

  // 외부 클릭 + Esc 닫기
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (popoverRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose, anchorRef]);

  if (!open) return null;

  const handleClick = (item: NotificationItem) => {
    if (!item.read_at) markRead(item.id);
    // N+73 — Toaster 와 같은 라우팅 helper 사용. link 누락 시 entity_type/event_kind fallback.
    const target = resolveNotificationLink(item);
    navigate(target);
    onClose();
  };

  const unreadCount = items.filter(i => !i.read_at).length;

  return (
    <Popover ref={popoverRef} role="menu" aria-label={t('notifications.title', '알림') as string}>
      <Header>
        <HeaderTitle>{t('notifications.title', '알림')}</HeaderTitle>
        {unreadCount > 0 && (
          <ReadAllBtn type="button" onClick={markAllRead}>
            {t('notifications.markAllRead', '모두 읽음')}
          </ReadAllBtn>
        )}
      </Header>
      <List>
        {loading && items.length === 0 ? (
          <Loading>{t('notifications.loading', '불러오는 중…')}</Loading>
        ) : items.length === 0 ? (
          <Empty>
            <EmptyIcon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            </EmptyIcon>
            <EmptyTitle>{t('notifications.emptyTitle', '새 알림이 없어요')}</EmptyTitle>
            <EmptyHint>{t('notifications.emptyHint', '댓글·일정·결제 등 알림이 여기로 모입니다.')}</EmptyHint>
          </Empty>
        ) : (
          items.map(it => (
            <Item key={it.id} type="button" onClick={() => handleClick(it)} $unread={!it.read_at}>
              <ItemBody>
                <ItemTitle $unread={!it.read_at}>{it.title}</ItemTitle>
                {it.body && <ItemDesc>{it.body.slice(0, 100)}</ItemDesc>}
                <ItemMeta>{formatTimeAgo(it.created_at)}</ItemMeta>
              </ItemBody>
              {!it.read_at && <UnreadDot />}
            </Item>
          ))
        )}
      </List>
      <Footer>
        <FooterLink to="/notifications" onClick={onClose}>
          {t('notifications.viewAll', '전체 알림 보기')} →
        </FooterLink>
      </Footer>
    </Popover>
  );
};

export default NotificationDropdown;

const Popover = styled.div`
  position: fixed; top: 60px; left: 16px;
  width: 360px; max-width: calc(100vw - 32px); max-height: 70vh;
  background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 12px;
  box-shadow: 0 12px 32px rgba(15, 23, 42, 0.16);
  z-index: 2000;
  display: flex; flex-direction: column; overflow: hidden;
`;
const Header = styled.div`
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px; border-bottom: 1px solid #F1F5F9; flex-shrink: 0;
`;
const HeaderTitle = styled.h3` margin: 0; font-size: 14px; font-weight: 700; color: #0F172A; `;
const ReadAllBtn = styled.button`
  background: transparent; border: none; cursor: pointer;
  font-size: 12px; font-weight: 500; color: #14B8A6; padding: 4px 8px; border-radius: 6px;
  &:hover { background: #F0FDFA; }
`;
const List = styled.div` flex: 1; overflow-y: auto; padding: 4px; `;
const Loading = styled.div` padding: 40px 16px; text-align: center; color: #94A3B8; font-size: 13px; `;
const Empty = styled.div`
  padding: 40px 16px; text-align: center;
  display: flex; flex-direction: column; align-items: center; gap: 8px;
`;
const EmptyIcon = styled.svg` width: 36px; height: 36px; color: #CBD5E1; `;
const EmptyTitle = styled.div` font-size: 13px; font-weight: 600; color: #334155; `;
const EmptyHint = styled.div` font-size: 12px; color: #94A3B8; line-height: 1.5; `;
const Item = styled.button<{ $unread: boolean }>`
  display: flex; gap: 8px; align-items: flex-start;
  width: 100%; padding: 10px 12px; border-radius: 8px;
  background: ${p => p.$unread ? '#F0FDFA' : 'transparent'};
  border: none; cursor: pointer; text-align: left;
  transition: background 0.12s;
  &:hover { background: ${p => p.$unread ? '#CCFBF1' : '#F8FAFC'}; }
`;
const ItemBody = styled.div` flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; `;
const ItemTitle = styled.div<{ $unread: boolean }>`
  font-size: 13px; font-weight: ${p => p.$unread ? 600 : 500}; color: #0F172A;
  overflow: hidden; text-overflow: ellipsis; display: -webkit-box;
  -webkit-line-clamp: 2; -webkit-box-orient: vertical;
`;
const ItemDesc = styled.div`
  font-size: 12px; color: #64748B; line-height: 1.4;
  overflow: hidden; text-overflow: ellipsis; display: -webkit-box;
  -webkit-line-clamp: 2; -webkit-box-orient: vertical;
`;
const ItemMeta = styled.div` font-size: 11px; color: #94A3B8; margin-top: 2px; `;
const UnreadDot = styled.span`
  width: 8px; height: 8px; border-radius: 50%; background: #14B8A6;
  flex-shrink: 0; margin-top: 6px;
`;
const Footer = styled.div`
  padding: 10px 16px; border-top: 1px solid #F1F5F9; flex-shrink: 0;
  text-align: center;
`;
const FooterLink = styled(ChromeLink)`
  font-size: 12px; font-weight: 600; color: #0F766E; text-decoration: none;
  &:hover { text-decoration: underline; }
`;
