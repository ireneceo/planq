// 랜딩페이지 공용 레이아웃 — Hero 가 다크일 때는 transparent GNB,
// scroll 후엔 white sticky GNB 로 자연스럽게 전환.
import { useState, useEffect } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import styled, { css } from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';

interface Props { children: React.ReactNode; transparentTop?: boolean; }

interface CompanyInfo {
  legal_entity: string | null;
  representative_name: string | null;
  biz_registration_no: string | null;
  mail_order_no: string | null;
  company_address: string | null;
  company_phone: string | null;
  support_email: string | null;
}

const NAV_ITEMS: { to: string; key: string }[] = [
  { to: '/features', key: 'nav.features' },
  { to: '/pricing', key: 'nav.pricing' },
  { to: '/blog', key: 'nav.blog' },
  { to: '/about', key: 'nav.about' },
  { to: '/contact', key: 'nav.contact' },
  { to: '/wiki', key: 'nav.help' },   // F7 — Q위키(도움말) 공개 진입
];

const LandingLayout: React.FC<Props> = ({ children, transparentTop = true }) => {
  const { t } = useTranslation('landing');
  const { user } = useAuth();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [company, setCompany] = useState<CompanyInfo | null>(null);

  useEffect(() => { setMobileOpen(false); }, [location.pathname]);

  // 사업자 정보 (전자상거래법 표시의무) — 공개 API 에서 로드
  useEffect(() => {
    let alive = true;
    fetch('/api/platform/info')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (alive && j?.success) setCompany(j.data); })
      .catch(() => { /* 푸터 정보 실패는 조용히 무시 */ });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 60);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // transparentTop=true 면 hero(다크) 위에서 transparent + 흰 텍스트, scroll 후 white background.
  // transparentTop=false 면 항상 white (서브 페이지 — 처음부터 라이트).
  const isTransparent = transparentTop && !scrolled && !mobileOpen;

  return (
    <Page>
      <Gnb $transparent={isTransparent} $solid={!isTransparent}>
        <GnbInner>
          <Brand to="/" aria-label="PlanQ">
            <BrandLogo src={isTransparent ? '/planQ_white_new.svg' : '/planQ_color.svg'} alt="PlanQ" />
          </Brand>

          <DesktopNav>
            {NAV_ITEMS.map(item => (
              <NavItem key={item.to} to={item.to} $light={isTransparent}>{t(item.key)}</NavItem>
            ))}
          </DesktopNav>

          <DesktopCta>
            {user ? (
              <PrimaryBtn to="/inbox">{t('nav.toApp', '내 워크스페이스')}</PrimaryBtn>
            ) : (
              <>
                <SecondaryBtn to="/login" $light={isTransparent}>{t('nav.login')}</SecondaryBtn>
                <PrimaryBtn to="/register">{t('nav.signup')}</PrimaryBtn>
              </>
            )}
          </DesktopCta>

          <Hamburger
            type="button"
            onClick={() => setMobileOpen(v => !v)}
            aria-label={t('nav.menu', '메뉴') as string}
            aria-expanded={mobileOpen}
            $light={isTransparent}
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
                <SecondaryBtn to="/login" $light={false}>{t('nav.login')}</SecondaryBtn>
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
              <FooterLogo src="/planQ_white_new.svg" alt="PlanQ" />
              <FooterTagline>{t('footer.tagline', '일이 일이되지 않게, 플랜큐')}</FooterTagline>
            </FooterCol>
            <FooterCol>
              <FooterTitle>{t('footer.product', 'PRODUCT')}</FooterTitle>
              <FooterLink to="/features">{t('nav.features')}</FooterLink>
              <FooterLink to="/pricing">{t('nav.pricing')}</FooterLink>
              <FooterLink to="/blog">{t('nav.blog')}</FooterLink>
              <FooterLink to="/wiki">{t('nav.help')}</FooterLink>{/* F7 — Q위키 도움말 */}
            </FooterCol>
            <FooterCol>
              <FooterTitle>{t('footer.company', 'COMPANY')}</FooterTitle>
              <FooterLink to="/about">{t('nav.about')}</FooterLink>
              <FooterLink to="/contact">{t('nav.contact')}</FooterLink>
            </FooterCol>
            <FooterCol>
              <FooterTitle>{t('footer.legal', 'LEGAL')}</FooterTitle>
              <FooterLink to="/privacy">{t('footer.privacy', '개인정보처리방침')}</FooterLink>
              <FooterLink to="/terms">{t('footer.terms', '이용약관')}</FooterLink>
            </FooterCol>
          </FooterCols>
          <FooterBottom>
            {company && (company.legal_entity || company.biz_registration_no) && (
              <FooterBiz>
                <FooterBizRow>
                  {company.legal_entity && <span>{t('footer.biz.company', '상호')}: {company.legal_entity}</span>}
                  {company.representative_name && <span>{t('footer.biz.ceo', '대표')}: {company.representative_name}</span>}
                  {company.biz_registration_no && <span>{t('footer.biz.regNo', '사업자등록번호')}: {company.biz_registration_no}</span>}
                  {company.mail_order_no && <span>{t('footer.biz.mailOrderNo', '통신판매업신고번호')}: {company.mail_order_no}</span>}
                </FooterBizRow>
                <FooterBizRow>
                  {company.company_address && <span>{t('footer.biz.address', '주소')}: {company.company_address}</span>}
                  {company.company_phone && <span>{t('footer.biz.tel', '유선')}: {company.company_phone}</span>}
                  {company.support_email && <span>{t('footer.biz.email', '이메일')}: {company.support_email}</span>}
                </FooterBizRow>
              </FooterBiz>
            )}
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
  background: #FAFBFC;
  color: #0F172A;
  font-family: 'Noto Sans KR', 'Inter', sans-serif;
`;
const Gnb = styled.header<{ $transparent: boolean; $solid: boolean }>`
  position: sticky; top: 0; z-index: 100;
  transition: background 0.25s ease, border-color 0.25s ease, backdrop-filter 0.25s ease;
  ${p => p.$transparent && css`
    background: transparent;
    border-bottom: 1px solid transparent;
    backdrop-filter: none;
  `}
  ${p => p.$solid && css`
    background: rgba(255, 255, 255, 0.92);
    backdrop-filter: saturate(180%) blur(10px);
    border-bottom: 1px solid #E2E8F0;
  `}
`;
const GnbInner = styled.div`
  max-width: 1200px; margin: 0 auto;
  height: 64px; padding: 0 24px;
  display: flex; align-items: center; justify-content: space-between;
  gap: 24px;
  @media (max-width: 640px) { padding: 0 16px; height: 56px; }
`;
const Brand = styled(Link)`
  display: inline-flex; align-items: center;
  text-decoration: none; color: inherit;
`;
const BrandLogo = styled.img`
  height: 26px; width: auto; display: block;
  transition: opacity 0.2s;
`;
const DesktopNav = styled.nav`
  display: flex; gap: 4px;
  @media (max-width: 900px) { display: none; }
`;
const NavItem = styled(NavLink)<{ $light: boolean }>`
  height: 36px; padding: 0 14px;
  display: inline-flex; align-items: center;
  text-decoration: none;
  color: ${p => p.$light ? 'rgba(255,255,255,0.85)' : '#475569'};
  font-size: 14px; font-weight: 500;
  border-radius: 8px;
  transition: background 0.15s, color 0.15s;
  &:hover {
    background: ${p => p.$light ? 'rgba(255,255,255,0.08)' : '#F1F5F9'};
    color: ${p => p.$light ? '#FFFFFF' : '#0F172A'};
  }
  &.active {
    color: ${p => p.$light ? '#5EEAD4' : '#0D9488'};
  }
`;
const DesktopCta = styled.div`
  display: flex; gap: 8px; align-items: center;
  @media (max-width: 900px) { display: none; }
`;
const PrimaryBtn = styled(Link)`
  height: 36px; padding: 0 18px;
  display: inline-flex; align-items: center;
  background: #14B8A6; color: #FFFFFF;
  border: none; border-radius: 999px;
  font-size: 13px; font-weight: 500;
  text-decoration: none;
  transition: background 0.15s, transform 0.15s, box-shadow 0.15s;
  box-shadow: 0 0 0 rgba(20,184,166,0);
  &:hover { background: #0D9488; transform: translateY(-1px); box-shadow: 0 8px 24px rgba(20,184,166,0.3); }
`;
const SecondaryBtn = styled(Link)<{ $light: boolean }>`
  height: 36px; padding: 0 16px;
  display: inline-flex; align-items: center;
  background: transparent;
  color: ${p => p.$light ? 'rgba(255,255,255,0.85)' : '#0F172A'};
  border: 1px solid ${p => p.$light ? 'rgba(255,255,255,0.18)' : '#E2E8F0'};
  border-radius: 999px;
  font-size: 13px; font-weight: 500;
  text-decoration: none;
  transition: background 0.15s, border-color 0.15s;
  &:hover {
    background: ${p => p.$light ? 'rgba(255,255,255,0.08)' : '#F8FAFC'};
    border-color: ${p => p.$light ? 'rgba(255,255,255,0.32)' : '#CBD5E1'};
  }
`;
const Hamburger = styled.button<{ $light: boolean }>`
  display: none; width: 36px; height: 36px;
  align-items: center; justify-content: center;
  background: transparent; border: none; cursor: pointer;
  color: ${p => p.$light ? '#FFFFFF' : '#0F172A'};
  border-radius: 8px;
  &:hover { background: ${p => p.$light ? 'rgba(255,255,255,0.08)' : '#F1F5F9'}; }
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
  background: #0F172A;
  color: #94A3B8;
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
  align-items: flex-start;  /* #89 — 로고·태그라인 좌측 정렬 보장 */
`;
const FooterLogo = styled.img`
  height: 28px; width: auto; display: block;
  margin-bottom: 4px; align-self: flex-start;
`;
const FooterTagline = styled.div`
  font-size: 13px; color: #94A3B8; line-height: 1.6; max-width: 280px;
  letter-spacing: 0.2px; text-align: left;  /* #89 — 문장형 태그라인: 과도한 자간 제거 */
`;
const FooterTitle = styled.div`
  font-family: 'Outfit', sans-serif;
  font-size: 12px; font-weight: 500; color: #5EEAD4;
  letter-spacing: 2px;
  margin-bottom: 6px;
`;
const FooterLink = styled(Link)`
  font-size: 13px; color: #94A3B8;
  text-decoration: none;
  transition: color 0.15s;
  &:hover { color: #FFFFFF; }
`;
const FooterBottom = styled.div`
  margin-top: 40px; padding-top: 24px;
  border-top: 1px solid rgba(255,255,255,0.06);
  display: flex; justify-content: space-between; align-items: center;
  @media (max-width: 640px) { flex-direction: column; gap: 8px; align-items: flex-start; }
`;
const FooterBiz = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 12px;
`;
const FooterBizRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  font-size: 12px;
  color: #94A3B8;
  font-weight: 300;
  line-height: 1.6;
`;
const FooterCopy = styled.div`font-size: 12px; color: #64748B; font-weight: 300;`;
