// 운영 #306 — "좌측 상단 메뉴 스피커의 새소식이 우측 패널로 열리는데 이상해.
//   알림처럼 아래에 열려야 해. 모두보기 하면 어딘가에 페이지가 있어야지. 알림처럼."
//
//   새 소식은 알림과 같은 성격("헤더 아이콘에서 최근 것을 훑고, 더 볼 게 있으면 페이지로")인데
//   혼자만 우측 상세 드로어로 열렸다. 같은 자리·같은 동작이어야 사용자가 배우지 않는다.
//   → NotificationDropdown 과 **같은 popover 구조**를 그대로 쓴다(디자인 단일 원천).
//   콘텐츠 원천은 종전과 같다 (/api/whats-new · hooks/useWhatsNew).
import React, { useEffect, useRef } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import ChromeLink from '../Tab/ChromeLink';
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
            <Item key={it.slug} to={`/whats-new?post=${encodeURIComponent(it.slug)}`} onClick={onClose} $unread={it.is_new}>
              <ItemBody>
                <ItemMeta>
                  {it.is_new && <NewDot aria-label={t('whatsNew.new', '새 소식') as string} />}
                  {fmtDate(it.published_at)}
                </ItemMeta>
                <ItemTitle $unread={it.is_new}>{it.title}</ItemTitle>
                {it.summary && <ItemDesc>{it.summary.slice(0, 100)}</ItemDesc>}
              </ItemBody>
            </Item>
          ))
        )}
      </List>
      <Footer>
        <FooterLink to="/whats-new" onClick={onClose}>
          {t('whatsNew.viewAll', '새 소식 모두 보기')} →
        </FooterLink>
      </Footer>
    </Popover>
  );
};

export default WhatsNewDropdown;

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
const List = styled.div` flex: 1; overflow-y: auto; padding: 4px; `;
const Loading = styled.div` padding: 40px 16px; text-align: center; color: #94A3B8; font-size: 13px; `;
const Empty = styled.div`
  padding: 40px 16px; text-align: center;
  display: flex; flex-direction: column; align-items: center; gap: 8px;
`;
const EmptyIcon = styled.svg` width: 36px; height: 36px; color: #CBD5E1; `;
const EmptyTitle = styled.div` font-size: 13px; font-weight: 600; color: #334155; `;
const EmptyHint = styled.div` font-size: 12px; color: #94A3B8; line-height: 1.5; `;
const Item = styled(ChromeLink)<{ $unread: boolean }>`
  display: flex; gap: 8px; align-items: flex-start;
  width: 100%; padding: 10px 12px; border-radius: 8px;
  background: ${p => p.$unread ? '#F0FDFA' : 'transparent'};
  border: none; cursor: pointer; text-align: left; text-decoration: none;
  transition: background 0.12s;
  &:hover { background: ${p => p.$unread ? '#CCFBF1' : '#F8FAFC'}; }
`;
const ItemBody = styled.div` flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; `;
const ItemTitle = styled.div<{ $unread: boolean }>`
  font-size: 13px; font-weight: ${p => p.$unread ? 700 : 600}; color: #0F172A;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
`;
const ItemDesc = styled.div`
  font-size: 12px; color: #64748B; line-height: 1.45;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
`;
const ItemMeta = styled.div` display: flex; align-items: center; gap: 5px; font-size: 11px; color: #94A3B8; `;
const NewDot = styled.span` width: 6px; height: 6px; border-radius: 50%; background: #F43F5E; flex-shrink: 0; `;
const Footer = styled.div` padding: 8px; border-top: 1px solid #F1F5F9; flex-shrink: 0; `;
const FooterLink = styled(ChromeLink)`
  display: block; text-align: center; padding: 8px;
  font-size: 12px; font-weight: 600; color: #14B8A6; text-decoration: none; border-radius: 6px;
  &:hover { background: #F0FDFA; }
`;
