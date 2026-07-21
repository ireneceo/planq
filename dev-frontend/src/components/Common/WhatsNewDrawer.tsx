// #194 제품 공지/체인지로그 — 인앱 "새 소식" 패널.
//   콘텐츠 원천: /api/whats-new (help_articles.blog_category='updates'). 별도 CMS 없음.
//   열람 시 워터마크 갱신(markSeen)으로 사이드바 메가폰 badge 소거.
import React, { useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import DetailDrawer from './DetailDrawer';
import type { WhatsNewItem, WhatsNewBlock } from '../../hooks/useWhatsNew';

interface Props {
  open: boolean;
  onClose: () => void;
  items: WhatsNewItem[];
  loading: boolean;
}

const WhatsNewDrawer: React.FC<Props> = ({ open, onClose, items, loading }) => {
  const { t, i18n } = useTranslation('common');
  const lang = (i18n.language || 'ko').slice(0, 2) === 'en' ? 'en' : 'ko';
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

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

  return (
    <DetailDrawer open={open} onClose={onClose} width={440} ariaLabel={t('whatsNew.title', '새 소식') as string}>
      <DetailDrawer.Header onClose={onClose}>
        <HeadTitle>
          <MegaphoneIcon />
          {t('whatsNew.title', '새 소식')}
        </HeadTitle>
        <HeadSub>{t('whatsNew.subtitle', 'PlanQ 업데이트 소식을 확인하세요')}</HeadSub>
      </DetailDrawer.Header>
      <DetailDrawer.Body>
        {loading && items.length === 0 ? (
          <Muted>{t('whatsNew.loading', '불러오는 중…')}</Muted>
        ) : items.length === 0 ? (
          <Empty>
            <MegaphoneIcon $lg />
            <strong>{t('whatsNew.empty.title', '아직 새 소식이 없어요')}</strong>
            <span>{t('whatsNew.empty.desc', '새로운 기능과 개선 소식을 이곳에서 알려드릴게요.')}</span>
          </Empty>
        ) : (
          items.map((it) => {
            const isOpen = !!expanded[it.slug];
            return (
              <Card key={it.slug}>
                <CardHead
                  type="button"
                  onClick={() => setExpanded((p) => ({ ...p, [it.slug]: !p[it.slug] }))}
                  aria-expanded={isOpen}
                >
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
          })
        )}
      </DetailDrawer.Body>
      {items.length > 0 && (
        <DetailDrawer.Footer>
          <AllLink href="/changelog" target="_blank" rel="noopener noreferrer">
            {t('whatsNew.viewAll', '모든 소식 보기')} →
          </AllLink>
        </DetailDrawer.Footer>
      )}
    </DetailDrawer>
  );
};

export default WhatsNewDrawer;

const MegaphoneIcon: React.FC<{ $lg?: boolean }> = ({ $lg }) => (
  <svg width={$lg ? 40 : 18} height={$lg ? 40 : 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 11l18-5v12L3 14v-3z" />
    <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
  </svg>
);

// ─── styled ───
const HeadTitle = styled.h2`
  display: flex; align-items: center; gap: 8px;
  font-size: 17px; font-weight: 700; color: #0F172A; margin: 0;
  svg { color: #0F766E; }
`;
const HeadSub = styled.p`
  font-size: 12px; color: #64748B; margin: 4px 0 0;
`;
const Muted = styled.div` font-size: 13px; color: #94A3B8; padding: 24px 0; text-align: center; `;
const Empty = styled.div`
  display: flex; flex-direction: column; align-items: center; gap: 10px;
  padding: 56px 24px; text-align: center;
  svg { color: #CBD5E1; margin-bottom: 4px; }
  strong { font-size: 15px; color: #334155; }
  span { font-size: 13px; color: #94A3B8; line-height: 1.6; word-break: keep-all; }
`;
const Card = styled.article`
  border: 1px solid #E2E8F0; border-radius: 12px; overflow: hidden;
  background: #fff;
`;
const CardHead = styled.button`
  width: 100%; text-align: left; cursor: pointer;
  background: none; border: none; padding: 14px 16px;
  display: flex; flex-direction: column; gap: 6px;
  &:hover { background: #F8FAFC; }
  &:focus-visible { outline: 2px solid rgba(15,118,110,0.4); outline-offset: -2px; }
`;
const CardTop = styled.div` display: flex; align-items: center; justify-content: space-between; `;
const DateRow = styled.div`
  display: flex; align-items: center; gap: 6px;
  font-size: 11px; font-weight: 600; color: #94A3B8; letter-spacing: 0.2px;
`;
const NewDot = styled.span`
  width: 7px; height: 7px; border-radius: 50%; background: #F43F5E; flex-shrink: 0;
`;
const Chevron = styled.svg<{ $open: boolean }>`
  width: 16px; height: 16px; color: #94A3B8; flex-shrink: 0;
  transition: transform 0.18s; transform: rotate(${p => p.$open ? '180deg' : '0deg'});
`;
const CardTitle = styled.h3` font-size: 15px; font-weight: 700; color: #0F172A; margin: 0; line-height: 1.4; word-break: keep-all; `;
const CardSummary = styled.p` font-size: 13px; color: #64748B; margin: 0; line-height: 1.6; word-break: keep-all; `;
const CardBody = styled.div`
  padding: 4px 16px 16px; border-top: 1px solid #F1F5F9;
  display: flex; flex-direction: column; gap: 10px;
`;
const BH = styled.h4` font-size: 14px; font-weight: 700; color: #0F172A; margin: 8px 0 0; `;
const BP = styled.p` font-size: 13px; color: #334155; line-height: 1.7; margin: 0; word-break: keep-all; `;
const BCallout = styled.div`
  font-size: 13px; color: #0F766E; line-height: 1.6;
  background: #F0FDFA; border: 1px solid #99F6E4; border-radius: 10px; padding: 10px 12px;
`;
const BStep = styled.div`
  display: flex; gap: 10px; align-items: flex-start;
  em { flex-shrink: 0; width: 20px; height: 20px; border-radius: 50%; background: #0F766E; color: #fff;
    font-size: 11px; font-weight: 700; font-style: normal; display: flex; align-items: center; justify-content: center; margin-top: 1px; }
  span { font-size: 13px; color: #334155; line-height: 1.6; }
`;
const BFigure = styled.figure`
  margin: 0;
  img { display: block; width: 100%; height: auto; border-radius: 8px; border: 1px solid #E2E8F0; }
  figcaption { font-size: 11px; color: #94A3B8; margin-top: 4px; text-align: center; }
`;
const AllLink = styled.a`
  font-size: 13px; font-weight: 600; color: #0F766E; text-decoration: none;
  &:hover { text-decoration: underline; }
`;
