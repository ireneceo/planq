// 운영 #306 — "모두보기 하면 어딘가에 페이지가 있어야지. 알림처럼."
//   여태 새 소식의 "전체 보기" 는 마케팅 블로그(/changelog)를 **새 탭으로** 열었다 — 앱 밖으로
//   나가버려서 알림(/notifications)과 동작이 달랐다. 같은 자리에 같은 모양의 인앱 페이지를 둔다.
//   레이아웃은 NotificationsPage 를 그대로 따른다 (PageShell + 목록 + 빈 상태).
import React, { useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import PageShell from '../../components/Layout/PageShell';
import { useWhatsNew, type WhatsNewBlock } from '../../hooks/useWhatsNew';

const PAGE = 20;   // 한 번에 보여줄 건수

const WhatsNewPage: React.FC = () => {
  const { t, i18n } = useTranslation('common');
  const lang = (i18n.language || 'ko').slice(0, 2) === 'en' ? 'en' : 'ko';
  const { items, loading, markSeen } = useWhatsNew();
  // ★ 알림 전체보기와 **같은 도구**를 준다 (Irene 2026-08-31 "새소식에는 전체/미읽음 이런 거
  //   없어도 돼? 모두 읽음 표시 하거나"). 한쪽에만 있으면 다른 물건처럼 보인다.
  const [newOnly, setNewOnly] = useState(false);
  // 한 번에 다 쏟지 않는다 — 20건씩 "더 보기"
  const [shown, setShown] = useState(PAGE);
  const [sp, setSp] = useSearchParams();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // 페이지를 여는 것 자체가 "봤다" 다 — 메가폰 배지를 여기서도 내린다(드롭다운과 같은 규칙).
  useEffect(() => { markSeen(); }, [markSeen]);

  // 드롭다운에서 특정 글을 눌러 들어온 경우 그 글을 펼친 상태로 시작한다.
  //   ★ 펼침 상태만 세팅하고 ?post= 는 지우지 않는다 — 새로고침·공유 시 같은 글이 열려야 한다.
  const focusSlug = sp.get('post');
  useEffect(() => {
    if (focusSlug) setExpanded((p) => ({ ...p, [focusSlug]: true }));
  }, [focusSlug]);

  const blockText = (b: WhatsNewBlock) => (lang === 'en' ? b.text_en : b.text_ko) || b.text_ko || b.text_en || '';
  const blockCap = (b: WhatsNewBlock) => (lang === 'en' ? b.caption_en : b.caption_ko) || b.caption_ko || b.caption_en || '';
  const fmtDate = (d: string) =>
    new Date(d).toLocaleDateString(lang === 'en' ? 'en-US' : 'ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });

  const renderBody = (body: WhatsNewBlock[] | null) => (body || []).map((b, i) => {
    if (b.type === 'heading') return <BH key={i}>{blockText(b)}</BH>;
    if (b.type === 'callout') return <BCallout key={i}>{blockText(b)}</BCallout>;
    if (b.type === 'step') return <BStep key={i}><em>{i + 1}</em><span>{blockText(b)}</span></BStep>;
    if (b.type === 'image') {
      return b.file_id ? (
        <BFigure key={i}>
          <img src={`/api/wiki/image/${b.file_id}`} alt={blockCap(b)} loading="lazy" />
          {blockCap(b) && <figcaption>{blockCap(b)}</figcaption>}
        </BFigure>
      ) : null;
    }
    return <BP key={i}>{blockText(b)}</BP>;
  });

  const toggle = (slug: string) => {
    setExpanded((p) => ({ ...p, [slug]: !p[slug] }));
    // 접었으면 ?post= 도 같이 내린다 — URL 이 화면과 어긋나면 새로고침에 되살아난다.
    if (focusSlug === slug && expanded[slug]) {
      const n = new URLSearchParams(sp); n.delete('post'); setSp(n, { replace: true });
    }
  };

  const newCount = items.filter(i => i.is_new).length;
  const filtered = newOnly ? items.filter(i => i.is_new) : items;
  const visible = filtered.slice(0, shown);
  const rest = filtered.length - visible.length;

  const actions = (
    <Actions>
      <FilterBtn $active={!newOnly} type="button" onClick={() => { setNewOnly(false); setShown(PAGE); }}>
        {t('whatsNew.filterAll', '전체')} ({items.length})
      </FilterBtn>
      <FilterBtn $active={newOnly} type="button" onClick={() => { setNewOnly(true); setShown(PAGE); }}>
        {t('whatsNew.filterNew', '새 소식')} ({newCount})
      </FilterBtn>
      {newCount > 0 && (
        <ReadAllBtn type="button" data-testid="whatsnew-read-all" onClick={() => { void markSeen(); }}>
          {t('whatsNew.markAllRead', '모두 읽음')}
        </ReadAllBtn>
      )}
    </Actions>
  );

  return (
    <PageShell title={t('whatsNew.title', '새 소식') as string} count={items.length} actions={actions}>
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
        <List>
          {visible.map((it) => {
            const isOpen = !!expanded[it.slug];
            return (
              <Card key={it.slug}>
                <CardHead type="button" onClick={() => toggle(it.slug)} aria-expanded={isOpen}>
                  <CardTop>
                    <DateRow>
                      {it.is_new && <NewDot aria-label={t('whatsNew.new', '새 소식') as string} />}
                      <span>{fmtDate(it.published_at)}</span>
                    </DateRow>
                    <Chevron $open={isOpen} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <polyline points="6 9 12 15 18 9" />
                    </Chevron>
                  </CardTop>
                  <CardTitle>{it.title}</CardTitle>
                  {it.summary && <CardSummary>{it.summary}</CardSummary>}
                </CardHead>
                {isOpen && it.body && it.body.length > 0 && <CardBody>{renderBody(it.body)}</CardBody>}
              </Card>
            );
          })}
        </List>
      )}
      {rest > 0 && (
        <MoreWrap>
          <MoreBtn type="button" data-testid="whatsnew-more" onClick={() => setShown(n => n + PAGE)}>
            {t('whatsNew.more', { count: rest, defaultValue: '더 보기 ({{count}}건 남음)' }) as string}
          </MoreBtn>
        </MoreWrap>
      )}
    </PageShell>
  );
};

export default WhatsNewPage;

// 알림 전체보기와 같은 모양 — 두 화면이 갈라지지 않게 수치까지 맞춘다.
const Actions = styled.div` display: flex; align-items: center; gap: 8px; `;
const FilterBtn = styled.button<{ $active: boolean }>`
  padding: 6px 12px; border-radius: 999px;
  background: ${p => p.$active ? '#14B8A6' : '#F1F5F9'};
  color: ${p => p.$active ? '#fff' : '#475569'};
  border: none; cursor: pointer;
  font-size: 0.75rem; font-weight: 500;
  &:hover { background: ${p => p.$active ? '#0D9488' : '#E2E8F0'}; }
`;
const ReadAllBtn = styled.button`
  padding: 6px 12px; border-radius: 6px;
  background: transparent; border: 1px solid #CBD5E1;
  color: #475569; font-size: 0.75rem; font-weight: 500; cursor: pointer;
  &:hover { background: #F8FAFC; }
`;
const MoreWrap = styled.div` display: flex; justify-content: center; padding: 16px 0 4px; `;
const MoreBtn = styled.button`
  padding: 9px 18px; border-radius: 8px; cursor: pointer;
  background: #fff; border: 1px solid #E2E8F0; color: #475569;
  font-size: 0.8125rem; font-weight: 600;
  &:hover { background: #F8FAFC; border-color: #CBD5E1; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 2px; }
`;
const Loading = styled.div` padding: 60px 16px; text-align: center; color: #94A3B8; font-size: 0.875rem; `;
// 빈 상태도 알림 쪽 수치로 통일 (여백 60 · 아이콘 48 · 제목 15/700 · 설명 13)
const Empty = styled.div`
  padding: 60px 16px; text-align: center;
  display: flex; flex-direction: column; align-items: center; gap: 10px;
`;
const EmptyIcon = styled.svg` width: 48px; height: 48px; color: #CBD5E1; `;
const EmptyTitle = styled.div` font-size: 0.9375rem; font-weight: 700; color: #334155; `;
const EmptyHint = styled.div` font-size: 0.8125rem; color: #94A3B8; `;
// ★ 알림 전체보기와 **같은 폭·같은 정렬**. 한쪽은 800 가운데, 한쪽은 760 왼쪽이라 따로 놀았다.
const List = styled.div` display: flex; flex-direction: column; gap: 12px; max-width: 800px; margin: 0 auto; `;
const Card = styled.div` background: #fff; border: 1px solid #E2E8F0; border-radius: 12px; overflow: hidden; `;
const CardHead = styled.button`
  display: block; width: 100%; text-align: left; padding: 14px 16px;
  background: transparent; border: none; cursor: pointer;
  &:hover { background: #F8FAFC; }
`;
const CardTop = styled.div` display: flex; align-items: center; justify-content: space-between; `;
const DateRow = styled.div` display: flex; align-items: center; gap: 6px; font-size: 0.6875rem; color: #94A3B8; `;
const NewDot = styled.span` width: 6px; height: 6px; border-radius: 50%; background: #F43F5E; flex-shrink: 0; `;
const Chevron = styled.svg<{ $open: boolean }>`
  width: 16px; height: 16px; color: #94A3B8; flex-shrink: 0;
  transition: transform 0.15s; transform: rotate(${p => (p.$open ? 180 : 0)}deg);
`;
const CardTitle = styled.div` margin-top: 4px; font-size: 0.875rem; font-weight: 700; color: #0F172A; `;
const CardSummary = styled.div` margin-top: 3px; font-size: 0.75rem; color: #64748B; line-height: 1.5; `;
const CardBody = styled.div` padding: 4px 16px 16px; border-top: 1px solid #F1F5F9; `;
const BP = styled.p` margin: 10px 0 0; font-size: 0.8125rem; line-height: 1.7; color: #334155; `;
const BH = styled.h4` margin: 16px 0 0; font-size: 0.8125rem; font-weight: 700; color: #0F172A; `;
const BCallout = styled.div`
  margin: 12px 0 0; padding: 10px 12px; background: #F0FDFA; border-left: 3px solid #14B8A6;
  border-radius: 0 8px 8px 0; font-size: 0.78125rem; line-height: 1.6; color: #0F766E;
`;
const BStep = styled.div`
  margin: 8px 0 0; display: flex; gap: 8px; align-items: flex-start;
  font-size: 0.8125rem; line-height: 1.6; color: #334155;
  em { flex-shrink: 0; width: 18px; height: 18px; margin-top: 1px; border-radius: 50%;
       background: #14B8A6; color: #fff; font-style: normal; font-size: 0.6875rem; font-weight: 700;
       display: flex; align-items: center; justify-content: center; }
`;
const BFigure = styled.figure`
  margin: 12px 0 0;
  img { display: block; width: 100%; border: 1px solid #E2E8F0; border-radius: 8px; }
  figcaption { margin-top: 5px; font-size: 0.6875rem; color: #94A3B8; text-align: center; }
`;
