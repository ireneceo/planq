// 보안·데이터 정책 — 공개 페이지 /security/ (2026-10-23, Fable 설계 docs/TRUST_SERVICES_DESIGN.md D2).
//
// ★ 코드·설정으로 확인되는 장치만 싣는다(설계 §1-4). «아직 없는 것» 절은 지우지 않는다 — 신뢰 페이지의 신뢰는 거기서 나온다.
// ★ 서버 위치는 처리방침 1.5(2026-11-03 시행, 제3조 IONOS 독일)와 같은 날 실었다 — 처리방침과 어긋나게 쓰지 않는다.
// ★ 금지 문구: 침입 탐지 · 정기 점검·직원 교육 · 외부 인증 «준비 중» · «100%».
// ★ «백업에 들어가는 것» 목록은 서버 manifest.coverage 와 같은 원천(services/exportSerializers INCLUDED_KEYS·EXCLUDED
//   ↔ i18n common.trust.backupAreas·backupExcluded). 영역을 더하면 서버 목록과 i18n 을 같이 고친다.
// ★ 껍데기는 기능 페이지와 공용(components/Landing/landingSections) — 새 디자인을 만들지 않는다.
import { Link } from 'react-router-dom';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import LandingLayout from '../../components/Landing/LandingLayout';
import { Container, SubHero, Eyebrow, Title, Sub, Group, GroupTitle, GroupDesc, SmallCard, SmallName, SmallLead, CtaBand, CtaTitle, CtaSub, CtaBtn } from '../../components/Landing/landingSections';

const PROMISES = ['export', 'keep', 'delete'] as const;
const MEASURES = ['transport', 'login', 'isolation', 'encryption', 'visibility', 'links', 'audit'] as const;
const MORE = ['hosting', 'ai', 'backup', 'payment'] as const;
// 서버 services/exportSerializers.js 의 INCLUDED_KEYS · EXCLUDED area 와 같은 순서
const BACKUP_AREAS = ['files', 'documents', 'tasks', 'projects', 'clients', 'conversations', 'calendar', 'invoices', 'knowledge', 'tables'] as const;
const BACKUP_EXCLUDED = ['private', 'drive_files', 'secret_fields', 'mail', 'qnote', 'attendance_payroll', 'audit_logs'] as const;

const SecurityPage: React.FC = () => {
  const { t } = useTranslation('landing');
  const { t: tc } = useTranslation('common');

  return (
    <LandingLayout transparentTop={false}>
      <SubHero>
        <Container>
          <Eyebrow>{t('securityPage.eyebrow')}</Eyebrow>
          <Title>{t('securityPage.title')}</Title>
          <Sub>{t('securityPage.sub')}</Sub>
        </Container>
      </SubHero>

      <Group>
        <Container>
          <GroupTitle>{t('securityPage.promises.title')}</GroupTitle>
          <Grid3>
            {PROMISES.map((k) => (
              <SmallCard key={k} data-testid={`security-promise-${k}`}>
                <SmallName>{t(`securityPage.promises.${k}.name`)}</SmallName>
                <SmallLead>{t(`securityPage.promises.${k}.lead`)}</SmallLead>
              </SmallCard>
            ))}
          </Grid3>
          <Coverage id="backup" data-testid="security-coverage">
            <CovCol>
              <CovTitle>{t('securityPage.promises.coverageTitle')}</CovTitle>
              <Chips>
                {BACKUP_AREAS.map((k) => <Chip key={k}>{tc(`trust.backupAreas.${k}`)}</Chip>)}
              </Chips>
            </CovCol>
            <CovCol>
              <CovTitle>{t('securityPage.promises.excludedTitle')}</CovTitle>
              <ExList>
                {BACKUP_EXCLUDED.map((k) => <li key={k}>{tc(`trust.backupExcluded.${k}`)}</li>)}
              </ExList>
            </CovCol>
          </Coverage>
        </Container>
      </Group>

      <Group $bg="bg">
        <Container>
          <GroupTitle>{t('securityPage.measures.title')}</GroupTitle>
          <GroupDesc>{t('securityPage.measures.sub')}</GroupDesc>
          <Grid3>
            {MEASURES.map((k) => (
              <SmallCard key={k}>
                <SmallName>{t(`securityPage.measures.${k}.name`)}</SmallName>
                <SmallLead>{t(`securityPage.measures.${k}.lead`)}</SmallLead>
              </SmallCard>
            ))}
          </Grid3>
        </Container>
      </Group>

      <Group>
        <Container>
          <Grid2>
            {MORE.map((k) => (
              <SmallCard key={k}>
                <SmallName>{t(`securityPage.${k}.name`)}</SmallName>
                <SmallLead>{t(`securityPage.${k}.lead`)}</SmallLead>
              </SmallCard>
            ))}
          </Grid2>
          <NotYet data-testid="security-not-yet">
            <SmallName>{t('securityPage.notYet.name')}</SmallName>
            <SmallLead>{t('securityPage.notYet.lead')}</SmallLead>
          </NotYet>
          <Docs>
            <DocsTitle>{t('securityPage.docs.title')}</DocsTitle>
            <DocLink to="/privacy">{t('securityPage.docs.privacy')} →</DocLink>
            <DocLink to="/terms">{t('securityPage.docs.terms')} →</DocLink>
            <DocLink to="/contact">{t('securityPage.docs.contact')} →</DocLink>
          </Docs>
        </Container>
      </Group>

      <CtaBand>
        <Container>
          <CtaTitle>{t('securityPage.cta.title')}</CtaTitle>
          <CtaSub>{t('securityPage.cta.sub')}</CtaSub>
          <CtaBtn to="/contact?type=onboarding">{t('securityPage.cta.btn')}</CtaBtn>
        </Container>
      </CtaBand>
    </LandingLayout>
  );
};

export default SecurityPage;

// ─── styled (이 페이지에만 있는 것 — 포함 목록·아직 없는 것·문서 링크. 나머지는 landingSections) ───
const Grid3 = styled.div`
  display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; margin-top: 24px;
  @media (max-width: 1024px) { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  @media (max-width: 640px) { grid-template-columns: minmax(0, 1fr); }
`;
// 서버 위치·AI·백업·결제 네 장은 2×2(3열이면 한 장이 홀로 남는다)
const Grid2 = styled.div`
  display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; margin-top: 24px;
  @media (max-width: 640px) { grid-template-columns: minmax(0, 1fr); }
`;
const Coverage = styled.div`
  margin-top: 24px; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 24px;
  background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 16px; padding: 24px;
  scroll-margin-top: 80px;
  @media (max-width: 768px) { grid-template-columns: minmax(0, 1fr); padding: 20px 16px; }
`;
const CovCol = styled.div`min-width: 0;`;
const CovTitle = styled.h3`font-size: 0.9375rem; font-weight: 700; color: #0F172A; margin: 0 0 12px;`;
const Chips = styled.div`display: flex; flex-wrap: wrap; gap: 8px;`;
const Chip = styled.span`
  font-size: 0.8125rem; color: #0F766E; background: #F0FDFA; border: 1px solid #CCFBF1;
  border-radius: 999px; padding: 4px 12px;
`;
const ExList = styled.ul`margin: 0; padding-left: 18px; font-size: 0.8125rem; color: #475569; line-height: 1.7;`;
const NotYet = styled.div`
  margin-top: 24px; border: 1px dashed #CBD5E1; border-radius: 16px; padding: 20px 24px;
  display: flex; flex-direction: column; gap: 6px;
  @media (max-width: 640px) { padding: 18px 16px; }
`;
const Docs = styled.div`margin-top: 24px; display: flex; flex-wrap: wrap; align-items: center; gap: 8px 20px;`;
const DocsTitle = styled.span`font-size: 0.8125rem; font-weight: 700; color: #475569;`;
const DocLink = styled(Link)`
  font-size: 0.8125rem; font-weight: 600; color: #0D9488; text-decoration: none;
  &:hover { text-decoration: underline; }
`;
