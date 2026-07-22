// 기능 페이지 — PlanQ 모든 모듈을 4 그룹으로 정리.
// 컨텐츠는 실제 구현된 기능 기준 (CLAUDE.md / 메모리 / 코드).
// 그룹 1: Q 시리즈 (핵심 5) / 그룹 2: 워크스페이스 (4) / 그룹 3: AI·분석 (3) / 그룹 4: 기반 (4)
import { Link } from 'react-router-dom';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import LandingLayout from '../../components/Landing/LandingLayout';
import { useReveal } from '../../hooks/useReveal';

const Reveal: React.FC<{ children: React.ReactNode; as?: React.ElementType }> = ({ children, as = 'div' }) => {
  const ref = useReveal<HTMLElement>();
  const Tag = as as 'div';
  return <Tag ref={ref as React.RefObject<HTMLDivElement>} className="reveal">{children}</Tag>;
};

const QSERIES = ['talk', 'task', 'note', 'file', 'bill'] as const;
const WORKSPACE = ['project', 'calendar', 'docs', 'mail'] as const;
const AI_GROUP = ['cue', 'insights', 'notifications'] as const;
const FOUNDATION = ['security', 'i18n', 'gdrive', 'billing'] as const;
// #146 — 빠진 기능 추가: 통합 인박스·고객관리·전자서명·Q위키·개인 보관함·업무보고·포커스·회의록
const MORE = ['inbox', 'clients', 'signature', 'wiki', 'vault', 'reports', 'focus', 'meeting'] as const;

const FeaturesPage: React.FC = () => {
  const { t } = useTranslation('landing');

  return (
    <LandingLayout transparentTop={false}>
      <SubHero>
        <Container>
          <Eyebrow>{t('featuresPage.eyebrow', 'FEATURES')}</Eyebrow>
          <Title>{t('featuresPage.title', '필요한 건 전부 여기 있습니다.')}</Title>
          <Sub>{t('featuresPage.sub', 'PlanQ는 하나의 흐름으로 연결됩니다. 도구를 옮겨 다닐 일이 없습니다.')}</Sub>
          <Anchors>
            <Anchor href="#q-series">{t('featuresPage.anchors.qseries', 'Q 시리즈')}</Anchor>
            <Anchor href="#workspace">{t('featuresPage.anchors.workspace', '워크스페이스')}</Anchor>
            <Anchor href="#ai">{t('featuresPage.anchors.ai', 'AI · 분석')}</Anchor>
            <Anchor href="#foundation">{t('featuresPage.anchors.foundation', '기반')}</Anchor>
            <Anchor href="#more">{t('featuresPage.anchors.more', '더 많은 기능')}</Anchor>
          </Anchors>
        </Container>
      </SubHero>

      {/* Group 1 — Q Series (큰 카드) */}
      <Group id="q-series">
        <Container>
          <Reveal as="div"><GroupTag>{t('featuresPage.qseries.tag', 'Q SERIES')}</GroupTag></Reveal>
          <Reveal as="h2"><GroupTitle>{t('featuresPage.qseries.title', '핵심 다섯 모듈')}</GroupTitle></Reveal>
          <Reveal as="p"><GroupDesc>{t('featuresPage.qseries.desc', '각각의 Q는 독립된 기능이면서, 하나의 흐름으로 연결됩니다.')}</GroupDesc></Reveal>
          {QSERIES.map((k, idx) => (
            <FeatureBlock key={k} id={`q-${k}`} $alt={idx % 2 === 1}>
              <FeatureRow $reverse={idx % 2 === 1}>
                <Reveal>
                  <FeatureCopy>
                    <FeatureLabel>Q {k}</FeatureLabel>
                    <FeatureName>{t(`featuresPage.q.${k}.name`)}</FeatureName>
                    <FeatureLead>{t(`featuresPage.q.${k}.lead`)}</FeatureLead>
                    <FeatureList>
                      {[0, 1, 2, 3, 4].map(i => (
                        <FeatureItem key={i}>
                          <Bullet />
                          <span>{t(`featuresPage.q.${k}.bullets.${i}`)}</span>
                        </FeatureItem>
                      ))}
                    </FeatureList>
                  </FeatureCopy>
                </Reveal>
                <Reveal>
                  <FeatureMock>
                    <MockBar>
                      <Dot $c="#EF4444" /><Dot $c="#F59E0B" /><Dot $c="#22C55E" />
                      <MockUrl>app.planq.kr/{k === 'talk' ? 'qtalk' : k === 'task' ? 'tasks' : k === 'note' ? 'qnote' : k === 'file' ? 'files' : 'bills'}</MockUrl>
                    </MockBar>
                    <MockBody>
                      <MockHint>Q {k}</MockHint>
                    </MockBody>
                  </FeatureMock>
                </Reveal>
              </FeatureRow>
            </FeatureBlock>
          ))}
        </Container>
      </Group>

      {/* Group 2 — Workspace */}
      <Group id="workspace" $bg="bg">
        <Container>
          <Reveal as="div"><GroupTag>{t('featuresPage.workspace.tag', 'WORKSPACE')}</GroupTag></Reveal>
          <Reveal as="h2"><GroupTitle>{t('featuresPage.workspace.title', '워크스페이스 통합')}</GroupTitle></Reveal>
          <Reveal as="p"><GroupDesc>{t('featuresPage.workspace.desc', '프로젝트·일정·문서·메일을 한 워크스페이스에서. Q시리즈와 자연스럽게 연결됩니다.')}</GroupDesc></Reveal>
          <CardGrid $cols={2}>
            {WORKSPACE.map((k, i) => (
              <Reveal key={k}>
                <ModuleCard style={{ transitionDelay: `${i * 60}ms` }}>
                  <ModuleHeader>
                    <ModuleLabel>Q {k === 'mail' ? 'mail' : k === 'docs' ? 'docs' : k === 'project' ? 'project' : 'calendar'}</ModuleLabel>
                  </ModuleHeader>
                  <ModuleName>{t(`featuresPage.ws.${k}.name`)}</ModuleName>
                  <ModuleLead>{t(`featuresPage.ws.${k}.lead`)}</ModuleLead>
                  <ModuleList>
                    {[0, 1, 2, 3].map(idx => (
                      <ModuleItem key={idx}>
                        <Bullet />
                        <span>{t(`featuresPage.ws.${k}.bullets.${idx}`)}</span>
                      </ModuleItem>
                    ))}
                  </ModuleList>
                </ModuleCard>
              </Reveal>
            ))}
          </CardGrid>
        </Container>
      </Group>

      {/* Group 3 — AI · 분석 */}
      <Group id="ai" $bg="dark">
        <Container>
          <Reveal as="div"><GroupTag $light>{t('featuresPage.ai.tag', 'AI · ANALYTICS')}</GroupTag></Reveal>
          <Reveal as="h2"><GroupTitle $light>{t('featuresPage.ai.title', 'AI가 일하고, 데이터가 말합니다')}</GroupTitle></Reveal>
          <Reveal as="p"><GroupDesc $light>{t('featuresPage.ai.desc', 'Cue (AI 팀원) · Insights (수익성 분석) · Notification Matrix 가 PlanQ 의 일을 똑똑하게 만듭니다.')}</GroupDesc></Reveal>
          <CardGrid $cols={3}>
            {AI_GROUP.map((k, i) => (
              <Reveal key={k}>
                <DarkCard style={{ transitionDelay: `${i * 60}ms` }}>
                  <DarkLabel>{t(`featuresPage.ai.${k}.label`)}</DarkLabel>
                  <DarkName>{t(`featuresPage.ai.${k}.name`)}</DarkName>
                  <DarkLead>{t(`featuresPage.ai.${k}.lead`)}</DarkLead>
                  <DarkList>
                    {[0, 1, 2, 3].map(idx => (
                      <DarkItem key={idx}>
                        <BulletLight />
                        <span>{t(`featuresPage.ai.${k}.bullets.${idx}`)}</span>
                      </DarkItem>
                    ))}
                  </DarkList>
                </DarkCard>
              </Reveal>
            ))}
          </CardGrid>
        </Container>
      </Group>

      {/* Group 4 — Foundation */}
      <Group id="foundation">
        <Container>
          <Reveal as="div"><GroupTag>{t('featuresPage.foundation.tag', 'FOUNDATION')}</GroupTag></Reveal>
          <Reveal as="h2"><GroupTitle>{t('featuresPage.foundation.title', '신뢰할 수 있는 기반')}</GroupTitle></Reveal>
          <Reveal as="p"><GroupDesc>{t('featuresPage.foundation.desc', '한국 데이터센터, 멀티테넌트 격리, 다국어, 외부 연동까지. 처음부터 운영 환경 기준으로 만들었습니다.')}</GroupDesc></Reveal>
          <CardGrid $cols={4}>
            {FOUNDATION.map((k, i) => (
              <Reveal key={k}>
                <SmallCard style={{ transitionDelay: `${i * 50}ms` }}>
                  <SmallName>{t(`featuresPage.foundation.${k}.name`)}</SmallName>
                  <SmallLead>{t(`featuresPage.foundation.${k}.lead`)}</SmallLead>
                </SmallCard>
              </Reveal>
            ))}
          </CardGrid>
        </Container>
      </Group>

      {/* Group 5 — 더 많은 기능 (#146 빠진 기능 추가) */}
      <Group id="more" $bg="bg">
        <Container>
          <Reveal as="div"><GroupTag>{t('featuresPage.more.tag', 'MORE')}</GroupTag></Reveal>
          <Reveal as="h2"><GroupTitle>{t('featuresPage.more.title', '이것도 전부 들어 있습니다')}</GroupTitle></Reveal>
          <Reveal as="p"><GroupDesc>{t('featuresPage.more.desc', '통합 인박스부터 전자서명·업무보고까지 — 업무에 필요한 도구가 이미 안에 있습니다.')}</GroupDesc></Reveal>
          <CardGrid $cols={2}>
            {MORE.map((k, i) => (
              <Reveal key={k}>
                <ModuleCard style={{ transitionDelay: `${i * 50}ms` }}>
                  <ModuleName>{t(`featuresPage.more.${k}.name`)}</ModuleName>
                  <ModuleLead>{t(`featuresPage.more.${k}.lead`)}</ModuleLead>
                  <ModuleList>
                    {[0, 1, 2].map(idx => (
                      <ModuleItem key={idx}>
                        <Bullet />
                        <span>{t(`featuresPage.more.${k}.bullets.${idx}`)}</span>
                      </ModuleItem>
                    ))}
                  </ModuleList>
                </ModuleCard>
              </Reveal>
            ))}
          </CardGrid>
        </Container>
      </Group>

      <CtaBand>
        <Container>
          <CtaTitle>{t('featuresPage.cta.title', '도구를 관리하지 말고 일을 하세요.')}</CtaTitle>
          <CtaSub>{t('featuresPage.cta.sub', '14일 무료 체험. 신용카드 필요 없습니다.')}</CtaSub>
          <CtaBtn to="/register">{t('featuresPage.cta.btn', '무료로 시작하기')}</CtaBtn>
        </Container>
      </CtaBand>
    </LandingLayout>
  );
};

export default FeaturesPage;

// ─── styled ───
const Container = styled.div`max-width: 1080px; margin: 0 auto; padding: 0 24px; @media (max-width: 640px) { padding: 0 16px; }`;
const SubHero = styled.section`
  padding: 96px 0 56px;
  background: linear-gradient(180deg, #F0FDFA 0%, #FFFFFF 100%);
  text-align: center;
`;
const Eyebrow = styled.div`
  font-family: 'Outfit', sans-serif;
  font-size: 13px; font-weight: 500; color: #0D9488;
  letter-spacing: 3px; margin-bottom: 16px;
`;
const Title = styled.h1`
  font-size: 44px; font-weight: 700; color: #0F172A;
  line-height: 1.3; word-break: keep-all; margin-bottom: 20px;
  @media (max-width: 768px) { font-size: 32px; }
`;
const Sub = styled.p`
  font-size: 17px; font-weight: 300; color: #64748B;
  line-height: 1.7; max-width: 720px; margin: 0 auto;
  word-break: keep-all;
`;
const Anchors = styled.div`
  margin-top: 32px;
  display: flex; gap: 8px; justify-content: center; flex-wrap: wrap;
`;
const Anchor = styled.a`
  height: 36px; padding: 0 16px;
  display: inline-flex; align-items: center;
  background: #FFFFFF; color: #0D9488;
  border: 1px solid #99F6E4; border-radius: 999px;
  font-size: 13px; font-weight: 500; text-decoration: none;
  transition: background 0.15s, transform 0.15s;
  &:hover { background: #F0FDFA; transform: translateY(-1px); }
`;

const Group = styled.section<{ $bg?: 'bg' | 'dark' }>`
  padding: 96px 0;
  background: ${p => p.$bg === 'dark' ? '#0F172A' : p.$bg === 'bg' ? '#FAFBFC' : '#FFFFFF'};
  ${p => p.$bg === 'dark' && `color: #FFFFFF;`}
  scroll-margin-top: 80px;
  .reveal { opacity: 0; transform: translateY(24px); transition: opacity 0.7s ease-out, transform 0.7s ease-out; }
  .reveal.in { opacity: 1; transform: none; }
  @media (max-width: 768px) { padding: 64px 0; }
`;
const GroupTag = styled.div<{ $light?: boolean }>`
  font-family: 'Outfit', sans-serif;
  font-size: 13px; font-weight: 500;
  color: ${p => p.$light ? '#5EEAD4' : '#0D9488'};
  letter-spacing: 3px; margin-bottom: 12px;
`;
const GroupTitle = styled.h2<{ $light?: boolean }>`
  font-size: 36px; font-weight: 700;
  color: ${p => p.$light ? '#FFFFFF' : '#0F172A'};
  letter-spacing: -0.6px; margin: 0 0 16px;
  word-break: keep-all;
  @media (max-width: 768px) { font-size: 28px; }
`;
const GroupDesc = styled.p<{ $light?: boolean }>`
  font-size: 16px; font-weight: 300;
  color: ${p => p.$light ? '#94A3B8' : '#64748B'};
  line-height: 1.7; max-width: 720px;
  word-break: keep-all;
  margin-bottom: 48px;
`;

// Q Series block (큰)
const FeatureBlock = styled.div<{ $alt?: boolean }>`
  margin-top: 48px;
  padding: 56px 48px;
  background: ${p => p.$alt ? '#FAFBFC' : '#FFFFFF'};
  border: 1px solid #E2E8F0; border-radius: 20px;
  scroll-margin-top: 80px;
  @media (max-width: 768px) { padding: 32px 24px; }
`;
const FeatureRow = styled.div<{ $reverse?: boolean }>`
  display: grid; grid-template-columns: 1fr 1fr; gap: 56px;
  align-items: center;
  ${p => p.$reverse && `direction: rtl;`}
  & > * { direction: ltr; }
  @media (max-width: 900px) { grid-template-columns: 1fr; gap: 32px; direction: ltr; }
`;
const FeatureCopy = styled.div`display: flex; flex-direction: column; gap: 16px;`;
const FeatureLabel = styled.div`
  font-family: 'Outfit', sans-serif;
  font-size: 14px; font-weight: 500; color: #0D9488;
  text-transform: lowercase; letter-spacing: 1px;
`;
const FeatureName = styled.h3`
  font-size: 28px; font-weight: 700; color: #0F172A;
  letter-spacing: -0.4px; margin: 0;
  word-break: keep-all;
  @media (max-width: 768px) { font-size: 22px; }
`;
const FeatureLead = styled.p`
  font-size: 15px; color: #475569; line-height: 1.7;
  font-weight: 400; margin: 0;
  word-break: keep-all;
`;
const FeatureList = styled.ul`
  list-style: none; padding: 0; margin: 4px 0 0;
  display: flex; flex-direction: column; gap: 10px;
`;
const FeatureItem = styled.li`
  display: flex; align-items: flex-start; gap: 10px;
  font-size: 14px; color: #334155; line-height: 1.7;
  word-break: keep-all;
`;
const Bullet = styled.span`
  flex-shrink: 0; width: 6px; height: 6px;
  margin-top: 9px;
  border-radius: 50%; background: #14B8A6;
`;
const BulletLight = styled.span`
  flex-shrink: 0; width: 6px; height: 6px;
  margin-top: 9px;
  border-radius: 50%; background: #5EEAD4;
`;
const FeatureMock = styled.div`
  background: #FFFFFF;
  border: 1px solid #E2E8F0; border-radius: 14px;
  box-shadow: 0 24px 60px rgba(15,23,42,0.08);
  overflow: hidden;
  aspect-ratio: 16 / 11;
  display: flex; flex-direction: column;
`;
const MockBar = styled.div`
  height: 36px; flex-shrink: 0;
  display: flex; align-items: center; gap: 6px;
  padding: 0 14px;
  background: #F8FAFC;
  border-bottom: 1px solid #E2E8F0;
`;
const Dot = styled.span<{ $c: string }>`
  width: 10px; height: 10px; border-radius: 50%; background: ${p => p.$c};
`;
const MockUrl = styled.div`margin-left: 14px; font-size: 11px; color: #94A3B8;`;
const MockBody = styled.div`
  flex: 1;
  display: flex; align-items: center; justify-content: center;
  background:
    repeating-linear-gradient(45deg, #F1F5F9 0 8px, transparent 8px 16px),
    #FAFBFC;
`;
const MockHint = styled.div`
  padding: 12px 24px; background: #FFFFFF;
  border: 1px solid #E2E8F0; border-radius: 999px;
  font-family: 'Outfit', sans-serif;
  font-size: 14px; font-weight: 500; color: #0D9488;
  text-transform: capitalize;
`;

// Workspace / Foundation grid
const CardGrid = styled.div<{ $cols: 2 | 3 | 4 }>`
  display: grid;
  grid-template-columns: repeat(${p => p.$cols}, 1fr);
  gap: 16px;
  @media (max-width: 1024px) { grid-template-columns: repeat(${p => Math.min(p.$cols, 2)}, 1fr); }
  @media (max-width: 640px) { grid-template-columns: 1fr; }
`;

// Workspace card
const ModuleCard = styled.div`
  padding: 32px 28px;
  background: #FFFFFF;
  border: 1px solid #E2E8F0; border-radius: 14px;
  display: flex; flex-direction: column; gap: 12px;
  transition: opacity 0.7s ease-out, transform 0.7s ease-out, border-color 0.2s, box-shadow 0.2s;
  &:hover { border-color: #99F6E4; box-shadow: 0 12px 32px rgba(20,184,166,0.08); }
`;
const ModuleHeader = styled.div`display: flex; align-items: center;`;
const ModuleLabel = styled.div`
  font-family: 'Outfit', sans-serif;
  font-size: 12px; font-weight: 500; color: #0D9488;
  text-transform: lowercase; letter-spacing: 1px;
`;
const ModuleName = styled.h3`
  font-size: 20px; font-weight: 700; color: #0F172A;
  letter-spacing: -0.3px; margin: 0;
`;
const ModuleLead = styled.p`
  font-size: 14px; color: #475569; line-height: 1.7;
  margin: 0; word-break: keep-all;
`;
const ModuleList = styled.ul`
  list-style: none; padding: 0; margin: 4px 0 0;
  display: flex; flex-direction: column; gap: 8px;
`;
const ModuleItem = styled.li`
  display: flex; align-items: flex-start; gap: 10px;
  font-size: 13px; color: #334155; line-height: 1.6;
  word-break: keep-all;
`;

// Dark (AI) card
const DarkCard = styled.div`
  padding: 32px 28px;
  background: #1E293B;
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 14px;
  display: flex; flex-direction: column; gap: 12px;
  transition: opacity 0.7s ease-out, transform 0.7s ease-out, background 0.2s, border-color 0.2s;
  &:hover { background: #334155; border-color: rgba(20,184,166,0.32); }
`;
const DarkLabel = styled.div`
  font-family: 'Outfit', sans-serif;
  font-size: 12px; font-weight: 500; color: #5EEAD4;
  text-transform: uppercase; letter-spacing: 1.5px;
`;
const DarkName = styled.h3`
  font-size: 20px; font-weight: 700; color: #FFFFFF;
  letter-spacing: -0.3px; margin: 0;
`;
const DarkLead = styled.p`
  font-size: 14px; color: #94A3B8; line-height: 1.7;
  margin: 0; word-break: keep-all;
`;
const DarkList = styled.ul`
  list-style: none; padding: 0; margin: 4px 0 0;
  display: flex; flex-direction: column; gap: 8px;
`;
const DarkItem = styled.li`
  display: flex; align-items: flex-start; gap: 10px;
  font-size: 13px; color: #CBD5E1; line-height: 1.6;
  word-break: keep-all;
`;

// Foundation small card
const SmallCard = styled.div`
  padding: 24px 22px;
  background: #FFFFFF;
  border: 1px solid #E2E8F0; border-radius: 12px;
  display: flex; flex-direction: column; gap: 8px;
  transition: opacity 0.7s ease-out, transform 0.7s ease-out, border-color 0.2s;
  &:hover { border-color: #99F6E4; }
`;
const SmallName = styled.h3`
  font-size: 15px; font-weight: 700; color: #0F172A; margin: 0;
`;
const SmallLead = styled.p`
  font-size: 13px; color: #64748B; line-height: 1.7;
  margin: 0; word-break: keep-all;
`;

const CtaBand = styled.section`
  padding: 96px 0;
  background: linear-gradient(160deg, #0F172A 0%, #134E4A 100%);
  color: #FFFFFF; text-align: center;
  ${Container} { display: flex; flex-direction: column; align-items: center; gap: 16px; }
`;
const CtaTitle = styled.h2`font-size: 32px; font-weight: 700; line-height: 1.4; margin: 0; word-break: keep-all; @media (max-width: 768px) { font-size: 24px; }`;
const CtaSub = styled.p`font-size: 15px; color: #94A3B8; font-weight: 300; margin: 0;`;
const CtaBtn = styled(Link)`
  margin-top: 12px;
  padding: 16px 48px; border-radius: 999px;
  background: #14B8A6; color: #FFFFFF;
  font-size: 16px; font-weight: 500;
  text-decoration: none;
  transition: all 0.3s;
  box-shadow: 0 0 40px rgba(20,184,166,0.3);
  &:hover { background: #0D9488; transform: translateY(-2px); }
`;
