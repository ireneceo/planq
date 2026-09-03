// 앱 베타 받기 — 고객이 우리 사이트에서 바로 내려받는다.
//
// ★ 이메일 초대 목록을 우리가 관리하지 않는다 (Irene 2026-08-31).
//   iOS  = TestFlight 공개 링크 (Beta App Review 통과 후 발급, 최대 10,000명)
//   And. = Google Play 공개 테스트 참여 링크
//   링크는 관리자 설정의 **이미 있던** "앱 다운로드 — iOS/Android" 값을 그대로 읽는다
//   (platform_settings.app_ios_url / app_android_url). 여태 그 값을 읽는 곳이 0곳이었다 —
//   베타용 컬럼을 새로 만들면 같은 값이 두 벌이 되어 반드시 갈라진다.
//   아직 없는 플랫폼은 죽은 버튼 대신 "준비 중" 을 보여준다.
import { useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import LandingLayout from '../../components/Landing/LandingLayout';

interface BetaLinks {
  ios_url: string | null;
  android_url: string | null;
}

/** 지금 기기가 어느 쪽인지 — 맞는 카드를 위로 올려준다(강제하지 않는다). */
function currentOs(): 'ios' | 'android' | null {
  const ua = navigator.userAgent || '';
  if (/iPhone|iPod/i.test(ua)) return 'ios';
  // ★ iPad 는 UA 에 'iPad' 가 안 들어온다 (2026-09-03).
  //   iPadOS 13 부터 사파리가 기본으로 **데스크탑급 브라우징**이라 자기를 'Macintosh' 로 알린다.
  //   그래서 UA 만 보면 아이패드가 '이 기기' 로 안 잡히고, 정작 받을 수 있는 기기에서
  //   안내가 어긋난다(앱은 유니버설이라 iPad 에서 정상 동작한다 — TARGETED_DEVICE_FAMILY "1,2").
  //   구분법: Mac 은 터치가 없고 iPad 는 있다.
  if (/iPad/i.test(ua)) return 'ios';
  if (/Macintosh/i.test(ua) && typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 1) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return null;
}

const BetaPage: React.FC = () => {
  const { t } = useTranslation('landing');
  const [links, setLinks] = useState<BetaLinks | null>(null);
  const [failed, setFailed] = useState(false);
  const os = currentOs();

  useEffect(() => {
    let alive = true;
    fetch('/api/platform/beta')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(j => { if (alive) setLinks(j?.data ?? null); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, []);

  const cards = [
    {
      key: 'ios' as const,
      name: t('betaPage.ios.name', 'iPhone · iPad'),
      url: links?.ios_url ?? null,
      how: t('betaPage.ios.how', 'TestFlight 앱이 함께 설치됩니다. 링크를 열면 참여할 수 있어요.'),
    },
    {
      key: 'android' as const,
      name: t('betaPage.android.name', 'Android'),
      url: links?.android_url ?? null,
      how: t('betaPage.android.how', 'Google Play 테스트 참여 페이지로 이동합니다.'),
    },
  ].sort((a, b) => (a.key === os ? -1 : b.key === os ? 1 : 0));

  return (
    <LandingLayout transparentTop={false}>
      <Hero>
        <Container>
          <Eyebrow>BETA</Eyebrow>
          <Title>{t('betaPage.title', 'PlanQ 앱을 먼저 써보세요')}</Title>
          <Sub>{t('betaPage.sub', '정식 출시 전 베타 버전입니다. 쓰시면서 불편한 점을 알려주시면 바로 고칩니다.')}</Sub>
        </Container>
      </Hero>

      <Section>
        <Container>
          {failed ? (
            <StateBox role="alert">{t('betaPage.error', '지금은 참여 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')}</StateBox>
          ) : !links ? (
            <StateBox>{t('betaPage.loading', '불러오는 중…')}</StateBox>
          ) : (
            <Grid>
              {cards.map(c => (
                <Card key={c.key} $mine={c.key === os}>
                  <CardName>{c.name}{c.key === os && <Mine>{t('betaPage.thisDevice', '지금 이 기기')}</Mine>}</CardName>
                  {c.url ? (
                    <>
                      <CardHow>{c.how}</CardHow>
                      <Btn href={c.url} target="_blank" rel="noopener noreferrer">
                        {t('betaPage.join', '베타 받기')}
                      </Btn>
                    </>
                  ) : (
                    <>
                      <CardHow>{t('betaPage.soonHow', '심사가 끝나면 여기에 참여 링크가 열립니다.')}</CardHow>
                      <Soon aria-disabled="true">{t('betaPage.soon', '준비 중')}</Soon>
                    </>
                  )}
                </Card>
              ))}
            </Grid>
          )}

          <Faq>
            <FaqQ>{t('betaPage.faq.q1', '베타는 무료인가요?')}</FaqQ>
            <FaqA>{t('betaPage.faq.a1', '네. 베타 기간 동안 앱 이용에 따로 비용이 들지 않습니다.')}</FaqA>
            <FaqQ>{t('betaPage.faq.q2', '웹에서 쓰던 자료가 그대로 보이나요?')}</FaqQ>
            <FaqA>{t('betaPage.faq.a2', '같은 계정으로 로그인하면 웹과 똑같은 자료를 씁니다. 따로 옮길 것이 없습니다.')}</FaqA>
            <FaqQ>{t('betaPage.faq.q3', '문제가 생기면 어떻게 알리나요?')}</FaqQ>
            <FaqA>{t('betaPage.faq.a3', '앱 안 설정 > 내 문의·피드백에서 바로 보내주세요. 화면과 함께 전달됩니다.')}</FaqA>
          </Faq>
        </Container>
      </Section>
    </LandingLayout>
  );
};

export default BetaPage;

const Container = styled.div`max-width: 900px; margin: 0 auto; padding: 0 20px;`;
const Hero = styled.section`padding: 88px 0 40px; background: linear-gradient(180deg, #F0FDFA 0%, #FFF 100%); text-align: center;`;
const Eyebrow = styled.div`font-size: 0.75rem; font-weight: 800; letter-spacing: 2px; color: #0F766E;`;
const Title = styled.h1`margin: 12px 0 10px; font-size: clamp(1.6rem, 4vw, 2.4rem); font-weight: 800; color: #0F172A; line-height: 1.3;`;
const Sub = styled.p`margin: 0 auto; max-width: 620px; font-size: 0.95rem; line-height: 1.7; color: #475569;`;
const Section = styled.section`padding: 32px 0 80px;`;
const Grid = styled.div`display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));`;
const Card = styled.div<{ $mine: boolean }>`
  display: flex; flex-direction: column; gap: 10px;
  padding: 24px; border-radius: 16px; background: #fff;
  border: 1px solid ${p => (p.$mine ? '#14B8A6' : '#E2E8F0')};
  box-shadow: ${p => (p.$mine ? '0 8px 28px rgba(20,184,166,.14)' : '0 1px 3px rgba(15,23,42,.05)')};
`;
const CardName = styled.div`display: flex; align-items: center; gap: 8px; font-size: 1.05rem; font-weight: 800; color: #0F172A;`;
const Mine = styled.span`padding: 3px 8px; border-radius: 999px; background: #CCFBF1; color: #0F766E; font-size: 0.6875rem; font-weight: 700;`;
const CardHow = styled.p`margin: 0; flex: 1; font-size: 0.8125rem; line-height: 1.6; color: #64748B;`;
const Btn = styled.a`
  display: inline-flex; align-items: center; justify-content: center; min-height: 44px;
  border-radius: 10px; background: #14B8A6; color: #fff; font-weight: 700; font-size: 0.9rem;
  text-decoration: none; transition: background .15s;
  &:hover { background: #0D9488; }
  &:focus-visible { outline: 2px solid #0D9488; outline-offset: 2px; }
`;
const Soon = styled.div`
  display: inline-flex; align-items: center; justify-content: center; min-height: 44px;
  border-radius: 10px; background: #F1F5F9; color: #94A3B8; font-weight: 700; font-size: 0.9rem;
`;
const StateBox = styled.div`padding: 40px; text-align: center; color: #64748B; font-size: 0.875rem; background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 14px;`;
const Faq = styled.div`margin-top: 48px; padding-top: 28px; border-top: 1px solid #E2E8F0;`;
const FaqQ = styled.h3`margin: 20px 0 6px; font-size: 0.9rem; font-weight: 700; color: #0F172A;`;
const FaqA = styled.p`margin: 0; font-size: 0.8125rem; line-height: 1.7; color: #64748B;`;
