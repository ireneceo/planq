// Privacy / Terms 공용 레이아웃 — 로그인 불필요, 공개 접근
import React from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

interface SectionDef {
  key: string;                    // 번역 키 prefix (예: 'privacy.s1')
  content?: string;               // 단일 문단 ('content' 키)
  intro?: boolean;                // 'intro' 하위 키 노출
  items?: boolean;                // 'items' 배열 노출
  contact?: boolean;              // 'contact.name' + 'contact.email'
}

interface Props {
  doc: 'privacy' | 'terms';
  effectiveDate: string;           // '2026-04-22'
}

const LegalPage: React.FC<Props> = ({ doc, effectiveDate }) => {
  const { t, i18n } = useTranslation('legal');
  const isKo = i18n.language?.startsWith('ko') !== false;

  // 문서별 섹션 목록
  const sections: SectionDef[] = doc === 'privacy'
    ? [
        { key: 'privacy.s1', items: true },
        { key: 'privacy.s2', items: true },
        { key: 'privacy.s3', intro: true, items: true },
        { key: 'privacy.s4', items: true },
        { key: 'privacy.s5', intro: true, items: true },
        { key: 'privacy.s6', content: 'content' },
        { key: 'privacy.s7', items: true },
        { key: 'privacy.s8', content: 'content' },
        { key: 'privacy.s9', content: 'content' },
        { key: 'privacy.s10', content: 'content' },
        { key: 'privacy.s11', content: 'content', contact: true },
      ]
    : [
        { key: 'terms.s1', items: true },
        { key: 'terms.s2', items: true },
        { key: 'terms.s3', items: true },
        { key: 'terms.s4', items: true },
        { key: 'terms.s5', items: true },
        { key: 'terms.s6', items: true },
        { key: 'terms.s7', items: true },
        { key: 'terms.s8', items: true },
        { key: 'terms.s9', items: true },
        { key: 'terms.s10', items: true },
        { key: 'terms.s11', items: true },
        { key: 'terms.s12', items: true },
        { key: 'terms.s13', items: true },
      ];

  const rootKey = doc;  // 'privacy' | 'terms'

  return (
    <Wrap>
      <Container>
        <TopBar>
          <Brand to="/">PlanQ</Brand>
          <Lang>
            <LangBtn $active={isKo} type="button" onClick={() => i18n.changeLanguage('ko')}>KO</LangBtn>
            <LangDiv>·</LangDiv>
            <LangBtn $active={!isKo} type="button" onClick={() => i18n.changeLanguage('en')}>EN</LangBtn>
          </Lang>
        </TopBar>

        <Title>{t(`${rootKey}.title`)}</Title>
        <Meta>
          {t('common.effective')}: {effectiveDate} · {t('common.lastUpdated')}: {effectiveDate}
        </Meta>

        <Intro>{t(`${rootKey}.intro`)}</Intro>

        {sections.map(s => (
          <Section key={s.key}>
            <SectionTitle>{t(`${s.key}.title`)}</SectionTitle>
            {s.intro && <SectionIntro>{t(`${s.key}.intro`)}</SectionIntro>}
            {s.content && <SectionP>{t(`${s.key}.${s.content}`)}</SectionP>}
            {s.items && (
              <List>
                {(t(`${s.key}.items`, { returnObjects: true }) as string[]).map((item, i) => (
                  <ListItem key={i}>{item}</ListItem>
                ))}
              </List>
            )}
            {s.contact && (
              <ContactBox>
                <ContactRow><ContactKey>{t(`${rootKey}.s11.contact.officer`)}</ContactKey><ContactVal>{t(`${rootKey}.s11.contact.name`)}</ContactVal></ContactRow>
                <ContactRow><ContactKey>Email</ContactKey><ContactVal><a href={`mailto:${t(`${rootKey}.s11.contact.email`)}`}>{t(`${rootKey}.s11.contact.email`)}</a></ContactVal></ContactRow>
              </ContactBox>
            )}
          </Section>
        ))}

        {/* Terms 의 문의 섹션 */}
        {doc === 'terms' && (
          <Section>
            <SectionTitle>{t('terms.contact.title')}</SectionTitle>
            <SectionP>{t('terms.contact.content')}</SectionP>
            <ContactBox>
              <ContactRow><ContactKey>{t('terms.contact.company')}</ContactKey><ContactVal>{t('terms.contact.name')}</ContactVal></ContactRow>
              <ContactRow><ContactKey>Email</ContactKey><ContactVal><a href={`mailto:${t('terms.contact.email')}`}>{t('terms.contact.email')}</a></ContactVal></ContactRow>
            </ContactBox>
          </Section>
        )}

        <Footer>
          <Link to="/">{t('common.backToHome')}</Link>
          <FooterLinks>
            <Link to="/privacy">{t('privacy.title')}</Link>
            <span>·</span>
            <Link to="/terms">{t('terms.title')}</Link>
          </FooterLinks>
        </Footer>
      </Container>
    </Wrap>
  );
};

export default LegalPage;

const Wrap = styled.div`
  min-height:100vh;background:#F8FAFC;
  padding:40px 20px;
  @media (max-width: 640px){ padding:20px 16px; }
`;
const Container = styled.article`
  max-width:820px;margin:0 auto;background:#fff;
  border:1px solid #E2E8F0;border-radius:16px;
  padding:40px 48px;
  @media (max-width: 640px){ padding:24px 20px; }
`;
const TopBar = styled.div`
  display:flex;justify-content:space-between;align-items:center;
  padding-bottom:20px;border-bottom:1px solid #F1F5F9;margin-bottom:24px;
`;
const Brand = styled(Link)`
  font-size:20px;font-weight:800;color:#0F766E;text-decoration:none;letter-spacing:-0.3px;
  &:hover{color:#0D9488;}
`;
const Lang = styled.div`display:inline-flex;align-items:center;gap:4px;`;
const LangBtn = styled.button<{ $active: boolean }>`
  background:none;border:none;padding:4px 8px;
  font-size:12px;font-weight:${p => p.$active ? 700 : 500};
  color:${p => p.$active ? '#0F766E' : '#94A3B8'};
  cursor:pointer;
  &:hover{color:#0F172A;}
`;
const LangDiv = styled.span`color:#CBD5E1;`;
const Title = styled.h1`
  margin:0 0 8px;font-size:28px;font-weight:800;color:#0F172A;letter-spacing:-0.4px;
  @media (max-width: 640px){ font-size:22px; }
`;
const Meta = styled.div`font-size:12px;color:#64748B;margin-bottom:20px;`;
const Intro = styled.p`
  font-size:14px;line-height:1.7;color:#475569;
  background:#F8FAFC;padding:16px 20px;border-radius:10px;border-left:3px solid #14B8A6;
  margin:0 0 32px;
`;
const Section = styled.section`margin-bottom:28px;`;
const SectionTitle = styled.h2`
  margin:0 0 10px;font-size:16px;font-weight:700;color:#0F172A;
`;
const SectionIntro = styled.p`
  font-size:14px;line-height:1.7;color:#475569;margin:0 0 10px;
`;
const SectionP = styled.p`
  font-size:14px;line-height:1.7;color:#334155;margin:0 0 8px;
`;
const List = styled.ul`
  margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px;
`;
const ListItem = styled.li`
  font-size:14px;line-height:1.7;color:#334155;padding-left:16px;position:relative;
  &::before{content:'·';position:absolute;left:4px;color:#94A3B8;font-weight:700;}
`;
const ContactBox = styled.div`
  margin-top:12px;padding:14px 16px;background:#F0FDFA;border:1px solid #99F6E4;border-radius:10px;
  display:flex;flex-direction:column;gap:6px;
`;
const ContactRow = styled.div`display:flex;gap:12px;font-size:13px;`;
const ContactKey = styled.div`flex:0 0 120px;color:#64748B;font-weight:600;`;
const ContactVal = styled.div`color:#0F172A;
  a{color:#0F766E;text-decoration:none;&:hover{text-decoration:underline;}}
`;
const Footer = styled.footer`
  margin-top:40px;padding-top:20px;border-top:1px solid #F1F5F9;
  display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;
  font-size:12px;
  a{color:#64748B;text-decoration:none;&:hover{color:#0F172A;}}
`;
const FooterLinks = styled.div`display:inline-flex;gap:8px;align-items:center;
  span{color:#CBD5E1;}
`;
