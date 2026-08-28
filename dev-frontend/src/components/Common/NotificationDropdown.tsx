// N+63 — 알림 dropdown (사이드바 종 모양 클릭 시 popover).
//   최근 10건 표시. 클릭 시 link 이동 + 자동 읽음. "모두 읽음" + "전체 보기" 버튼.
import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Popover, Header, HeaderTitle, HeaderAction, List, Loading, Empty, EmptyIcon, EmptyTitle, EmptyHint,
  ItemButton, ItemIcon, ItemBody, ItemTitle, ItemDesc, ItemMeta, UnreadDot, Footer, FooterLink,
} from './dropdownShell';
import { useNotifications, type NotificationItem } from '../../hooks/useNotifications';
import { useTimeFormat } from '../../hooks/useTimeFormat';
import { resolveNotificationLink } from '../../utils/notificationLink';
import NotificationTypeIcon from './NotificationTypeIcon';
import { tabStore } from '../../stores/tabStore';

interface Props {
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
}

const NotificationDropdown: React.FC<Props> = ({ open, onClose, anchorRef }) => {
  const { t } = useTranslation('layout');
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
    // 보던 탭을 덮지 않는다 — 알림은 하던 일 위에 얹히는 진입점이다
    //   (Irene: "드롭다운에서 갑자기 탭 내용 바뀌면 하던 일 문제될 것 같아").
    tabStore.openInNewTab(resolveNotificationLink(item));
    onClose();
  };

  const unreadCount = items.filter(i => !i.read_at).length;

  return (
    <Popover ref={popoverRef} role="menu" aria-label={t('notifications.title', '알림') as string}>
      <Header>
        <HeaderTitle>{t('notifications.title', '알림')}</HeaderTitle>
        {unreadCount > 0 && (
          <HeaderAction type="button" onClick={markAllRead}>
            {t('notifications.markAllRead', '모두 읽음')}
          </HeaderAction>
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
            <ItemButton key={it.id} type="button" onClick={() => handleClick(it)} $unread={!it.read_at}>
              {/* 운영 #287 — 종류 아이콘. 여태 이 목록엔 아이콘이 아예 없어 메일·채팅·업무가 구분되지 않았다. */}
              <ItemIcon aria-hidden="true"><NotificationTypeIcon kind={it.event_kind} size={14} /></ItemIcon>
              <ItemBody>
                <ItemTitle $unread={!it.read_at}>{it.title}</ItemTitle>
                {it.body && <ItemDesc>{it.body.slice(0, 100)}</ItemDesc>}
                <ItemMeta>{formatTimeAgo(it.created_at)}</ItemMeta>
              </ItemBody>
              {!it.read_at && <UnreadDot />}
            </ItemButton>
          ))
        )}
      </List>
      <Footer>
        <FooterLink to="/notifications" newTab onClick={onClose}>
          {t('notifications.viewAll', '전체 알림 보기')} →
        </FooterLink>
      </Footer>
    </Popover>
  );
};

export default NotificationDropdown;
