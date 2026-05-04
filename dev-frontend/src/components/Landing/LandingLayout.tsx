// 랜딩페이지 공용 레이아웃 — GNB (Global Navigation Bar) + Footer.
// 비로그인·외부 트래픽이 보는 영역 (PWA 사용자는 start_url=/inbox 라 안 봄).
// 로그인된 사용자가 / 진입 시 /inbox 로 리다이렉트는 App.tsx 의 RootRoute 가 처리.
import { useState, useEffect } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';

interface Props { children: React.ReactNode; }

const NAV_ITEMS: { to: string; key: string }[] = [
  { to: '/features', key: 'nav.features' },
  { to: '/pricing', key: 'nav.pricing' },
  { to: '/about', key: 'nav.about' },
  { to: '/contact', key: 'nav.contact' },
];

const LandingLayout: React.FC<Props> = ({ children }) => {
  const { t } = useTranslation('landing');
  const { user } = useAuth();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => { setMobileOpen(false); }, [location.pathname]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <Page>
      <Gnb $scrolled={scrolled}>
        <GnbInner>
          <Brand to="/" aria-label="PlanQ">
            <BrandLogo>Q</BrandLogo>
            <BrandName>PlanQ</BrandName>
          </Brand>

          <DesktopNav>
            {NAV_ITEMS.map(item => (
              <NavItem key={item.to} to={item.to}>{t(item.key)}</NavItem>
            ))}
          </DesktopNav>

          <DesktopCta>
            {user ? (
              <PrimaryBtn to="/inbox">{t('nav.toApp', '내 워크스페이스')}</PrimaryBtn>
            ) : (
              <>
                <SecondaryBtn to="/login">{t('nav.login')}</SecondaryBtn>
                <PrimaryBtn to="/register">{t('nav.signup')}</PrimaryBtn>
              </>
            )}
          </DesktopCta>

          <Hamburger
            type="button"
            onClick={() => setMobileOpen(v => !v)}
            aria-label={t('nav.menu', '메뉴') as string}
            aria-expanded={mobileOpen}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              {mobileOpen
                ? <><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>
                : <><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></>}
            </svg>
          </Hamburger>
        </GnbInner>

        {mobileOpen && (
          <MobileSheet>
            {NAV_ITEMS.map(item => (
              <MobileNavItem key={item.to} to={item.to}>{t(item.key)}</MobileNavItem>
            ))}
            <MobileDivider />
            {user ? (
              <PrimaryBtn to="/inbox">{t('nav.toApp', '내 워크스페이스')}</PrimaryBtn>
            ) : (
              <>
                <SecondaryBtn to="/login">{t('nav.login')}</SecondaryBtn>
                <PrimaryBtn to="/register">{t('nav.signup')}</PrimaryBtn>
              </>
            )}
          </MobileSheet>
        )}
      </Gnb>

      <Main>{children}</Main>

      <Footer>
        <FooterInner>
          <FooterCols>
            <FooterCol>
              <FooterBrand>
                <BrandLogo $small>Q</BrandLogo>
                <span>PlanQ</span>
              </FooterBrand>
              <FooterTagline>{t('footer.tagline', '요청은 Queue 로, 실행은 Cue 로.')}</FooterTagline>
            </FooterCol>
            <FooterCol>
              <FooterTitle>{t('footer.product', '제품')}</FooterTitle>
              <FooterLink to="/features">{t('nav.features')}</FooterLink>
              <FooterLink to="/pricing">{t('nav.pricing')}</FooterLink>
            </FooterCol>
            <FooterCol>
              <FooterTitle>{t('footer.company', '회사')}</FooterTitle>
              <FooterLink to="/about">{t('nav.about')}</FooterLink>
              <FooterLink to="/contact">{t('nav.contact')}</FooterLink>
            </FooterCol>
            <FooterCol>
              <FooterTitle>{t('footer.legal', '약관·정책')}</FooterTitle>
              <FooterLink to="/privacy">{t('footer.privacy', '개인정보처리방침')}</FooterLink>
              <FooterLink to="/terms">{t('footer.terms', '이용약관')}</FooterLink>
            </FooterCol>
          </FooterCols>
          <FooterBottom>
            <FooterCopy>© {new Date().getFullYear()} PlanQ. {t('footer.allRights', 'All rights reserved.')}</FooterCopy>
          </FooterBottom>
        </FooterInner>
      </Footer>
    </Page>
  );
};

export default LandingLayout;

// ─── styled ───
const Page = styled.div`
  min-height: 100vh;
  display: flex; flex-direction: column;
  background: #FFFFFF;
  color: #0F172A;
`;
const Gnb = styled.header<{ $scrolled: boolean }>`
  position: sticky; top: 0; z-index: 100;
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: saturate(180%) blur(10px);
  border-bottom: 1px solid ${p => p.$scrolled ? '#E2E8F0' : 'transparent'};
  transition: border-color 0.2s;
`;
const GnbInner = styled.div`
  max-width: 1200px; margin: 0 auto;
  height: 64px; padding: 0 24px;
  display: flex; align-items: center; justify-content: space-between;
  gap: 24px;
  @media (max-width: 640px) { padding: 0 16px; height: 56px; }
`;
const Brand = styled(Link)`
  display: inline-flex; align-items: center; gap: 8px;
  text-decoration: none; color: inherit;
`;
const BrandLogo = styled.div<{ $small?: boolean }>`
  width: ${p => p.$small ? '24px' : '32px'};
  height: ${p => p.$small ? '24px' : '32px'};
  display: inline-flex; align-items: center; justify-content: center;
  background: #14B8A6; color: #FFFFFF;
  border-radius: ${p => p.$small ? '6px' : '8px'};
  font-weight: 800; font-size: ${p => p.$small ? '13px' : '17px'};
  letter-spacing: -0.5px;
`;
const BrandName = styled.span`
  font-size: 18px; font-weight: 800; letter-spacing: -0.4px;
`;
const DesktopNav = styled.nav`
  display: flex; gap: 4px;
  @media (max-width: 900px) { display: none; }
`;
const NavItem = styled(NavLink)`
  height: 36px; padding: 0 14px;
  display: inline-flex; align-items: center;
  text-decoration: none;
  color: #475569; font-size: 14px; font-weight: 500;
  border-radius: 8px;
  transition: background 0.15s, color 0.15s;
  &:hover { background: #F1F5F9; color: #0F172A; }
  &.active { color: #0D9488; }
`;
const DesktopCta = styled.div`
  display: flex; gap: 8px; align-items: center;
  @media (max-width: 900px) { display: none; }
`;
const PrimaryBtn = styled(Link)`
  height: 36px; padding: 0 18px;
  display: inline-flex; align-items: center;
  background: #14B8A6; color: #FFFFFF;
  border: none; border-radius: 8px;
  font-size: 13px; font-weight: 600;
  text-decoration: none;
  transition: background 0.15s;
  &:hover { background: #0D9488; }
`;
const SecondaryBtn = styled(Link)`
  height: 36px; padding: 0 16px;
  display: inline-flex; align-items: center;
  background: transparent; color: #0F172A;
  border: 1px solid #E2E8F0; border-radius: 8px;
  font-size: 13px; font-weight: 600;
  text-decoration: none;
  transition: background 0.15s;
  &:hover { background: #F8FAFC; }
`;
const Hamburger = styled.button`
  display: none; width: 36px; height: 36px;
  align-items: center; justify-content: center;
  background: transparent; border: none; cursor: pointer;
  color: #0F172A; border-radius: 8px;
  &:hover { background: #F1F5F9; }
  @media (max-width: 900px) { display: inline-flex; }
`;
const MobileSheet = styled.div`
  display: flex; flex-direction: column; gap: 4px;
  padding: 16px;
  border-top: 1px solid #E2E8F0;
  background: #FFFFFF;
`;
const MobileNavItem = styled(NavLink)`
  display: block;
  padding: 12px 14px;
  text-decoration: none;
  color: #0F172A; font-size: 15px; font-weight: 500;
  border-radius: 8px;
  &:hover { background: #F1F5F9; }
  &.active { color: #0D9488; background: #F0FDFA; }
`;
const MobileDivider = styled.div`
  height: 1px; background: #E2E8F0; margin: 8px 0;
`;
const Main = styled.main`flex: 1;`;
const Footer = styled.footer`
  background: #F8FAFC;
  border-top: 1px solid #E2E8F0;
  padding: 56px 0 32px;
`;
const FooterInner = styled.div`
  max-width: 1200px; margin: 0 auto; padding: 0 24px;
  @media (max-width: 640px) { padding: 0 16px; }
`;
const FooterCols = styled.div`
  display: grid;
  grid-template-columns: 1.4fr 1fr 1fr 1fr;
  gap: 40px;
  @media (max-width: 768px) {
    grid-template-columns: 1fr 1fr;
    gap: 32px;
  }
  @media (max-width: 480px) {
    grid-template-columns: 1fr;
  }
`;
const FooterCol = styled.div`
  display: flex; flex-direction: column; gap: 10px;
`;
const FooterBrand = styled.div`
  display: flex; align-items: center; gap: 8px;
  font-size: 16px; font-weight: 800; letter-spacing: -0.4px;
  margin-bottom: 4px;
`;
const FooterTagline = styled.div`
  font-size: 13px; color: #64748B; line-height: 1.6; max-width: 280px;
`;
const FooterTitle = styled.div`
  font-size: 12px; font-weight: 700; color: #0F172A;
  text-transform: uppercase; letter-spacing: 0.6px;
  margin-bottom: 6px;
`;
const FooterLink = styled(Link)`
  font-size: 13px; color: #475569;
  text-decoration: none;
  transition: color 0.15s;
  &:hover { color: #0D9488; }
`;
const FooterBottom = styled.div`
  margin-top: 40px; padding-top: 24px;
  border-top: 1px solid #E2E8F0;
  display: flex; justify-content: space-between; align-items: center;
  @media (max-width: 640px) { flex-direction: column; gap: 8px; align-items: flex-start; }
`;
const FooterCopy = styled.div`font-size: 12px; color: #94A3B8;`;
