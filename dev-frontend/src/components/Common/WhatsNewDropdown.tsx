// 운영 #306 — "좌측 상단 메뉴 스피커의 새소식이 우측 패널로 열리는데 이상해.
//   알림처럼 아래에 열려야 해. 모두보기 하면 어딘가에 페이지가 있어야지. 알림처럼."
//
//   새 소식은 알림과 같은 성격("헤더 아이콘에서 최근 것을 훑고, 더 볼 게 있으면 페이지로")인데
//   혼자만 우측 상세 드로어로 열렸다. 같은 자리·같은 동작이어야 사용자가 배우지 않는다.
//   → NotificationDropdown 과 **같은 popover 구조**를 그대로 쓴다(디자인 단일 원천).
//   콘텐츠 원천은 종전과 같다 (/api/whats-new · hooks/useWhatsNew).
import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Popover, Header, HeaderTitle, List, Loading, Empty, EmptyIcon, EmptyTitle, EmptyHint,
  ItemLink, ItemIcon, ItemBody, ItemTitle, ItemDesc, ItemMeta, UnreadDot, Footer, FooterLink,
} from './dropdownShell';
import type { WhatsNewItem } from '../../hooks/useWhatsNew';

interface Props {
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  items: WhatsNewItem[];
  loading: boolean;
}

const WhatsNewDropdown: React.FC<Props> = ({ open, onClose, anchorRef, items, loading }) => {
  const { t, i18n } = useTranslation('common');
  const lang = (i18n.language || 'ko').slice(0, 2) === 'en' ? 'en' : 'ko';
  const popoverRef = useRef<HTMLDivElement>(null);

  // 외부 클릭 + Esc 닫기 — 알림 드롭다운과 같은 규칙
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

  const fmtDate = (d: string) =>
    new Date(d).toLocaleDateString(lang === 'en' ? 'en-US' : 'ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });

  return (
    <Popover ref={popoverRef} role="menu" aria-label={t('whatsNew.title', '새 소식') as string}>
      <Header>
        <HeaderTitle>{t('whatsNew.title', '새 소식')}</HeaderTitle>
      </Header>
      <List>
        {loading && items.length === 0 ? (
          <Loading>{t('whatsNew.loading', '불러오는 중…')}</Loading>
        ) : items.length === 0 ? (
          <Empty>
            <EmptyIcon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <path d="M3 11l18-5v12L3 14v-3z" />
              <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
            </EmptyIcon>
            <EmptyTitle>{t('whatsNew.empty.title', '아직 새 소식이 없어요')}</EmptyTitle>
            <EmptyHint>{t('whatsNew.empty.desc', '새로운 기능과 개선 소식을 이곳에서 알려드릴게요.')}</EmptyHint>
          </Empty>
        ) : (
          // 드롭다운은 훑어보는 자리다 — 본문은 펼치지 않고 제목·요약까지만. 전문은 모두보기 페이지에서.
          items.slice(0, 8).map((it) => (
            // 알림과 **같은 구조** — 아이콘 | (제목·요약·날짜) | 안읽음 점. 두 드롭다운이 다르게
            //   생기면 사용자는 매번 다시 배운다. 열기는 새 탭(보던 화면을 덮지 않는다).
            <ItemLink key={it.slug} to={`/whats-new?post=${encodeURIComponent(it.slug)}`} newTab onClick={onClose} $unread={it.is_new}>
              <ItemIcon aria-hidden="true">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 11l18-5v12L3 14v-3z" />
                  <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
                </svg>
              </ItemIcon>
              <ItemBody>
                <ItemTitle $unread={it.is_new}>{it.title}</ItemTitle>
                {it.summary && <ItemDesc>{it.summary.slice(0, 100)}</ItemDesc>}
                <ItemMeta>{fmtDate(it.published_at)}</ItemMeta>
              </ItemBody>
              {it.is_new && <UnreadDot aria-label={t('whatsNew.new', '새 소식') as string} />}
            </ItemLink>
          ))
        )}
      </List>
      <Footer>
        <FooterLink to="/whats-new" newTab onClick={onClose}>
          {t('whatsNew.viewAll', '새 소식 모두 보기')} →
        </FooterLink>
      </Footer>
    </Popover>
  );
};

export default WhatsNewDropdown;
