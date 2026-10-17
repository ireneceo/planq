// 명함 한 장 — 공개 페이지(/c/:token) · 내 명함 목록·편집 미리보기 · 받은 명함이 **같은 컴포넌트**를 쓴다.
//   (설계 docs/BUSINESS_CARD_DESIGN.md §4 — 미리보기가 실제와 갈라지지 않게)
//   ★ 사진은 있을 때만 그린다. 없으면 자리 자체가 없다(이니셜 아바타도 안 그림 — Irene «안넣으면 안나오고»).
//   ★ 소개는 글자 그대로(white-space: pre-line) — HTML 로 그리지 않는다.
//   ★ 외부 링크는 rel="nofollow noopener noreferrer ugc" + 호스트명 표기(어디로 가는지 보이게).
import React, { useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import type { CardView } from '../../services/nameCards';

export const ACCENT_COLORS = ['#0F766E', '#2563EB', '#7C3AED', '#E11D48', '#EA580C', '#334155'] as const;
export const DEFAULT_ACCENT = ACCENT_COLORS[0];

const EXT_REL = 'nofollow noopener noreferrer ugc';

export function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}
const telHref = (v: string) => `tel:${v.replace(/[^0-9+]/g, '')}`;
const smsHref = (v: string) => `sms:${v.replace(/[^0-9+]/g, '')}`;
const mapHref = (addr: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}`;

interface Props {
  view: CardView;
  photoSrc?: string | null;
  variant?: 'full' | 'compact';
  className?: string;
  testId?: string;
}

const CardFace: React.FC<Props> = ({ view, photoSrc, variant = 'full', className, testId }) => {
  const { t } = useTranslation('cards');
  const [broken, setBroken] = useState<string | null>(null);
  const accent = view.accent_color || DEFAULT_ACCENT;
  const showPhoto = !!photoSrc && view.has_photo && broken !== photoSrc;
  const role = [view.job_title, view.department].filter(Boolean).join(' · ');
  const compact = variant === 'compact';

  return (
    <Card className={className} $accent={accent} $compact={compact} data-testid={testId}>
      <Head $compact={compact}>
        {showPhoto && (
          <Photo $compact={compact} src={photoSrc as string} alt="" onError={() => setBroken(photoSrc as string)} data-testid="card-photo" />
        )}
        <Names>
          <Name as={compact ? 'div' : 'h1'} $compact={compact} data-testid="card-name">{view.name || '—'}</Name>
          {view.name_en && <NameEn>{view.name_en}</NameEn>}
          {role && <Role $compact={compact}>{role}</Role>}
          {view.company && <Company $accent={accent} $compact={compact}>{view.company}</Company>}
        </Names>
      </Head>

      {compact ? (
        (view.mobile || view.email) && (
          <CompactLine>{[view.mobile, view.email].filter(Boolean).join(' · ')}</CompactLine>
        )
      ) : (
        <>
          {view.intro && <Intro data-testid="card-intro">{view.intro}</Intro>}

          {(view.mobile || view.phone || view.email || view.website) && (
            <QuickRow>
              {(view.mobile || view.phone) && (
                <Quick href={telHref((view.mobile || view.phone) as string)} $accent={accent}>
                  <PhoneIcon />{t('public.call')}
                </Quick>
              )}
              {view.mobile && (
                <Quick href={smsHref(view.mobile)} $accent={accent}><MsgIcon />{t('public.message')}</Quick>
              )}
              {view.email && (
                <Quick href={`mailto:${view.email}`} $accent={accent}><MailIcon />{t('public.mail')}</Quick>
              )}
              {view.website && (
                <Quick href={view.website} target="_blank" rel={EXT_REL} $accent={accent}><GlobeIcon />{t('public.web')}</Quick>
              )}
            </QuickRow>
          )}

          <Rows>
            {view.mobile && <Row><RowLabel>{t('public.mobile')}</RowLabel><RowLink href={telHref(view.mobile)}>{view.mobile}</RowLink></Row>}
            {view.phone && <Row><RowLabel>{t('public.phone')}</RowLabel><RowLink href={telHref(view.phone)}>{view.phone}</RowLink></Row>}
            {view.fax && <Row><RowLabel>{t('public.fax')}</RowLabel><RowText>{view.fax}</RowText></Row>}
            {view.email && <Row><RowLabel>{t('editor.email')}</RowLabel><RowLink href={`mailto:${view.email}`}>{view.email}</RowLink></Row>}
            {view.website && (
              <Row><RowLabel>{t('editor.website')}</RowLabel>
                <RowLink href={view.website} target="_blank" rel={EXT_REL}>{hostOf(view.website)}</RowLink></Row>
            )}
            {view.address && (
              <Row><RowLabel>{t('editor.address')}</RowLabel>
                <RowLink href={mapHref(view.address)} target="_blank" rel={EXT_REL} title={t('public.map') as string}>{view.address}</RowLink></Row>
            )}
          </Rows>

          {view.links.length > 0 && (
            <Links>
              {view.links.map((l, i) => (
                <LinkChip key={`${l.url}-${i}`} href={l.url} target="_blank" rel={EXT_REL} $accent={accent}>
                  <strong>{l.label || hostOf(l.url)}</strong>
                  {l.label && <span>{hostOf(l.url)}</span>}
                </LinkChip>
              ))}
            </Links>
          )}
        </>
      )}
    </Card>
  );
};

export default CardFace;

// ─── 아이콘 ───
const I = (p: { children: React.ReactNode }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{p.children}</svg>
);
const PhoneIcon = () => <I><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" /></I>;
const MsgIcon = () => <I><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></I>;
const MailIcon = () => <I><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 6-10 7L2 6" /></I>;
const GlobeIcon = () => <I><circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></I>;

// ─── 스타일 ───
const Card = styled.article<{ $accent: string; $compact: boolean }>`
  position: relative;
  background: #FFFFFF;
  border: 1px solid #E2E8F0;
  border-radius: ${(p) => (p.$compact ? '12px' : '16px')};
  border-top: ${(p) => (p.$compact ? '4px' : '6px')} solid ${(p) => p.$accent};
  padding: ${(p) => (p.$compact ? '16px' : '24px')};
  min-width: 0;
  display: flex; flex-direction: column; gap: ${(p) => (p.$compact ? '10px' : '18px')};
  box-sizing: border-box;
  @media (max-width: 640px) { padding: ${(p) => (p.$compact ? '14px' : '20px')}; }
`;
const Head = styled.div<{ $compact: boolean }>`
  display: flex; align-items: center; gap: ${(p) => (p.$compact ? '12px' : '16px')}; min-width: 0;
`;
const Photo = styled.img<{ $compact: boolean }>`
  width: ${(p) => (p.$compact ? '48px' : '88px')}; height: ${(p) => (p.$compact ? '48px' : '88px')};
  border-radius: 50%; object-fit: cover; flex-shrink: 0; background: #F1F5F9;
`;
const Names = styled.div`display: flex; flex-direction: column; gap: 2px; min-width: 0;`;
const Name = styled.h1<{ $compact: boolean }>`
  margin: 0; font-size: ${(p) => (p.$compact ? '1rem' : '1.5rem')}; font-weight: 700; color: #0F172A;
  letter-spacing: -0.3px; line-height: 1.25; overflow-wrap: anywhere;
`;
const NameEn = styled.div`font-size: 0.8125rem; color: #64748B;`;
const Role = styled.div<{ $compact: boolean }>`
  font-size: ${(p) => (p.$compact ? '0.8125rem' : '0.9375rem')}; color: #334155; overflow-wrap: anywhere;
`;
const Company = styled.div<{ $accent: string; $compact: boolean }>`
  font-size: ${(p) => (p.$compact ? '0.8125rem' : '0.9375rem')}; font-weight: 600; color: ${(p) => p.$accent}; overflow-wrap: anywhere;
`;
const CompactLine = styled.div`
  font-size: 0.75rem; color: #64748B; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
`;
const Intro = styled.p`
  margin: 0; font-size: 0.9375rem; line-height: 1.6; color: #334155; white-space: pre-line; overflow-wrap: anywhere;
`;
const QuickRow = styled.div`display: grid; grid-template-columns: repeat(auto-fit, minmax(64px, 1fr)); gap: 8px;`;
const Quick = styled.a<{ $accent: string }>`
  display: inline-flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;
  min-height: 56px; padding: 8px 4px; border-radius: 12px;
  background: #F8FAFC; border: 1px solid #E2E8F0; color: ${(p) => p.$accent};
  font-size: 0.75rem; font-weight: 600; text-decoration: none;
  &:hover { background: #F1F5F9; }
  &:focus-visible { outline: 2px solid ${(p) => p.$accent}; outline-offset: 2px; }
`;
const Rows = styled.div`
  margin: 0; display: flex; flex-direction: column; gap: 10px;
  &:empty { display: none; }
`;
const Row = styled.div`display: grid; grid-template-columns: 72px minmax(0, 1fr); gap: 12px; align-items: baseline;`;
const RowLabel = styled.span`font-size: 0.75rem; color: #94A3B8; font-weight: 600;`;
const RowText = styled.span`margin: 0; font-size: 0.875rem; color: #0F172A; overflow-wrap: anywhere;`;
const RowLink = styled.a`
  margin: 0; font-size: 0.875rem; color: #0F172A; text-decoration: none; overflow-wrap: anywhere;
  &:hover { text-decoration: underline; }
`;
const Links = styled.div`display: flex; flex-wrap: wrap; gap: 8px;`;
const LinkChip = styled.a<{ $accent: string }>`
  display: inline-flex; align-items: baseline; gap: 6px; max-width: 100%;
  min-height: 36px; box-sizing: border-box; padding: 8px 12px; border-radius: 999px;
  border: 1px solid #E2E8F0; background: #FFFFFF; text-decoration: none;
  strong { font-size: 0.8125rem; color: ${(p) => p.$accent}; font-weight: 600; }
  span { font-size: 0.75rem; color: #94A3B8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  &:hover { background: #F8FAFC; }
`;
