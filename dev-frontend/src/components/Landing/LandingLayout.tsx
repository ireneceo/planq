// 랜딩페이지 공용 레이아웃 — Hero 가 다크일 때는 transparent GNB,
// scroll 후엔 white sticky GNB 로 자연스럽게 전환.
import { useState, useEffect, useRef } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { useSeoHead } from '../../hooks/useSeoHead';
import { useLandingBeacon } from '../../hooks/useLandingBeacon';
import BILLING_ENTITY from '../../config/legalEntities';
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
  company_email: string | null;
  support_email: string | null;
}

// ★ 2026-10-12 GNB 정리 (Irene: "GNB가 너무 많은데 … 전체 다 판단 좀 해줘. fable이" → Fable 판정).
//   평면 메뉴 9개 → **5개**: 기능 · 요금제 · 컨설팅 · 리소스▾ · 브랜드스토리. 1024~1279px 에서도 숨기는 항목이 없다.
//   - /about 라벨은 «브랜드스토리» — Fable 판정 때 «소개» 로 바꿨다가 Irene «브랜드스토리랑 앱다운로드가 얼마나 중요한데»
//     (2026-10-12) 로 되돌렸다. 이름이 바뀌면 «상단에서 빠졌다» 로 읽힌다.
//   - «시작 가이드·도움말·인사이트» 는 «갈 곳» 이 아니라 «읽을 것» 이라 **리소스** 한 묶음.
//     시작 가이드는 홈 히어로 아래 한 줄로도 연다.
//   - ★ «앱 다운로드» 는 묶음에 넣지 않는다 — 데스크탑은 우측 묶음 맨 앞 글자 버튼, 폰·태블릿 시트는 가입 버튼 바로 아래.
//     처음엔 리소스 안에 넣었다가 Irene «앱 다운로드 메뉴는 어디로 보낸 거야? 중요한건데 아예 없애면 어떻게 해? 상단에서»
//     (2026-10-12). 드롭다운 안 = 안 보이는 것이다(2026-09-05 안드로이드 태블릿 «앱다운로드를 어디서 해?» 와 같은 모양).
//   - «문의» 는 메뉴가 아니라 우측 흰(outline) 버튼 — B2B 사이트의 Contact 자리.
//   - /service 는 PlanQ 제품이 아니라 업무체계 컨설팅(워프로랩 스튜디오)이라 라벨을 «컨설팅» 으로.
//     요금제와 합치지 않는다(2026-06-23 «끼워팔기 금지·합치지 말고 잇기») — 요금제 하단 밴드로 잇는다.
//   도움말(/guide)은 같은 창(2026-10-12) — 랜딩과 같은 GNB·푸터를 단 페이지다. 앱 안의 문은 새 탭 그대로.
const NAV_ITEMS: { to: string; key: string }[] = [
  { to: '/features', key: 'nav.features' },
  { to: '/pricing', key: 'nav.pricing' },
  { to: '/service', key: 'nav.service' },   // 업무체계 설계·구축 컨설팅 (2026-08-24)
];
const RESOURCE_ITEMS: { to: string; key: string }[] = [
  { to: '/start', key: 'nav.start' },      // 처음 시작하는 팀의 5단계
  { to: '/guide', key: 'nav.help' },       // 도움말
  { to: '/insights', key: 'nav.blog' },
];
const APP_ITEM = { to: '/app', key: 'nav.app' };   // 리소스 밖 — 위 주석
const ABOUT_ITEM = { to: '/about', key: 'nav.about' };

const isUnder = (pathname: string, to: string) => pathname === to || pathname.startsWith(to + '/');

// 리소스 묶음 — 이 GNB 의 유일한 드롭다운. 마우스를 올리면 열리고, 눌러도(터치·키보드) 열린다.
//   투명 히어로 위에서도 패널은 흰색. 바깥 클릭·Esc·주소 이동으로 닫힌다.
const ResourceMenu: React.FC<{ light: boolean }> = ({ light }) => {
  const { t } = useTranslation('landing');
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | null>(null);
  // 마우스를 올려 열린 직후의 클릭은 «닫기» 가 아니다 — 올리고 누르는 사람에게 메뉴가 깜빡 닫혀 버렸다(실측)
  const openedByHover = useRef(false);
  useEffect(() => { setOpen(false); }, [location.pathname]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  useEffect(() => () => { if (closeTimer.current) window.clearTimeout(closeTimer.current); }, []);
  const active = RESOURCE_ITEMS.some(i => isUnder(location.pathname, i.to));
  const enter = () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    if (!open) openedByHover.current = true;
    setOpen(true);
  };
  const leave = () => { closeTimer.current = window.setTimeout(() => { openedByHover.current = false; setOpen(false); }, 150); };
  const toggle = () => {
    if (openedByHover.current) { openedByHover.current = false; setOpen(true); return; }
    setOpen(v => !v);
  };
  return (
    <ResWrap ref={ref} onMouseEnter={enter} onMouseLeave={leave}>
      <ResTrigger type="button" $light={light} $active={active} aria-haspopup="true" aria-expanded={open}
        data-testid="landing-gnb-resources" onClick={toggle}>
        {t('nav.resources', '리소스')}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9" /></svg>
      </ResTrigger>
      {open && (
        <ResPanel data-testid="landing-gnb-resources-panel">
          {RESOURCE_ITEMS.map(item => (
            <ResItem key={item.to} to={item.to}>{t(item.key)}</ResItem>
          ))}
        </ResPanel>
      )}
    </ResWrap>
  );
};

const LandingLayout: React.FC<Props> = ({ children, transparentTop = true }) => {
  const { t, i18n } = useTranslation('landing');
  const { user } = useAuth();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [company, setCompany] = useState<CompanyInfo | null>(null);

  useEffect(() => { setMobileOpen(false); }, [location.pathname]);
  // 공개 페이지 제목·설명·대표 주소 — public/seo-pages.json (워크스페이스 화면은 대상 아님)
  useSeoHead(location.pathname, i18n.language || 'ko');
  // 랜딩 방문 집계(쿠키 없음) — 로그인 사용자는 세지 않는다
  useLandingBeacon(location.pathname, !!user);

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
  // ★ 2026-09-07 — "앱"(/beta) 메뉴를 없앴다. "앱 다운로드"(/app) 와 **같은 페이지**였다
  //   (같은 platform_settings 값 하나를 읽어 같은 스토어로 보낸다). 메뉴가 둘이면
  //   사용자는 뭐가 다른지 찾다가 둘 다 눌러 본다. /beta 주소는 /app 으로 보낸다(App.tsx).

  // #196 — 게스트가 언어를 바꿀 수단이 랜딩에 없었다. i18n detection 은 localStorage → navigator 라
  //   브라우저가 한국어면 영어 사용자가 영어 랜딩에 닿을 방법이 아예 없다. LegalPage 의 KO·EN
  //   토글과 같은 형태를 GNB 에 둔다(changeLanguage 가 localStorage 도 갱신 — 앱 진입 후에도 유지).
  const isKo = !(i18n.language || '').startsWith('en');
  const langSwitch = (light: boolean) => (
    <Lang>
      <LangBtn $active={isKo} $light={light} type="button" onClick={() => i18n.changeLanguage('ko')}>KO</LangBtn>
      <LangDiv $light={light}>·</LangDiv>
      <LangBtn $active={!isKo} $light={light} type="button" onClick={() => i18n.changeLanguage('en')}>EN</LangBtn>
    </Lang>
  );

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
            <ResourceMenu light={isTransparent} />
            <NavItem to={ABOUT_ITEM.to} $light={isTransparent}>{t(ABOUT_ITEM.key)}</NavItem>
          </DesktopNav>

          <DesktopCta>
            <TextBtn to={APP_ITEM.to} $light={isTransparent} data-testid="landing-gnb-app">
              <AppIcon width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="6" y="2" width="12" height="20" rx="2.5" /><line x1="11" y1="18" x2="13" y2="18" />
              </AppIcon>
              {t(APP_ITEM.key)}
            </TextBtn>
            {langSwitch(isTransparent)}
            <SecondaryBtn to="/contact" $light={isTransparent} data-testid="landing-gnb-contact">{t('nav.contact')}</SecondaryBtn>
            {user ? (
              <PrimaryBtn to="/inbox">{t('nav.toApp', '내 워크스페이스')}</PrimaryBtn>
            ) : (
              <>
                <TextBtn to="/login" $light={isTransparent}>{t('nav.login')}</TextBtn>
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
          <MobileSheet data-testid="landing-mobile-sheet">
            <MobileCtaRow>
              {user ? (
                <PrimaryBtn to="/inbox">{t('nav.toApp', '내 워크스페이스')}</PrimaryBtn>
              ) : (
                <>
                  <PrimaryBtn to="/register">{t('nav.signup')}</PrimaryBtn>
                  <SecondaryBtn to="/login" $light={false}>{t('nav.login')}</SecondaryBtn>
                </>
              )}
            </MobileCtaRow>
            <MobileNavItem to={APP_ITEM.to} data-testid="landing-mobile-app">{t(APP_ITEM.key)}</MobileNavItem>
            {[...NAV_ITEMS, ABOUT_ITEM].map(item => (
              <MobileNavItem key={item.to} to={item.to}>{t(item.key)}</MobileNavItem>
            ))}
            <MobileGroupLabel>{t('nav.resources', '리소스')}</MobileGroupLabel>
            {RESOURCE_ITEMS.map(item => (
              <MobileNavItem key={item.to} to={item.to}>{t(item.key)}</MobileNavItem>
            ))}
            <MobileDivider />
            <MobileCtaRow>
              <SecondaryBtn to="/contact" $light={false}>{t('nav.contact')}</SecondaryBtn>
              {langSwitch(false)}
            </MobileCtaRow>
          </MobileSheet>
        )}
      </Gnb>

      <Main>{children}</Main>

      <Footer>
        <FooterInner>
          <FooterCols>
            <FooterCol>
              <FooterLogo src="/planQ_white_new.svg" alt="PlanQ" />
              <FooterTagline>{t('footer.tagline', '일이 일이 되지 않게, 플랜큐')}</FooterTagline>
            </FooterCol>
            <FooterCol>
              <FooterTitle>{t('footer.product', 'PRODUCT')}</FooterTitle>
              <FooterLink to="/features">{t('nav.features')}</FooterLink>
              <FooterLink to="/start">{t('nav.start')}</FooterLink>
              <FooterLink to="/pricing">{t('nav.pricing')}</FooterLink>
              <FooterLink to="/service">{t('nav.service')}</FooterLink>
              <FooterLink to="/insights">{t('nav.blog')}</FooterLink>
              <FooterLink to="/guide">{t('nav.help')}</FooterLink>{/* F7 — 도움말 (같은 창 — 위 NAV_ITEMS 주석) */}
              {/* 앱 다운로드 — `/app` 라우트는 있었지만 **앱 어디에서도 링크가 없어**
                  주소를 아는 사람만 닿을 수 있었다(2026-09-04 Irene 신고: "아이폰 다운로드가 안 나와").
                  만들어 놓고 진입점을 안 붙이면 없는 기능과 같다. */}
              <FooterLink to="/app">{t('nav.app')}</FooterLink>
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
            {/* ★ 두 법인은 **독립적으로** 그린다 (2026-09-14).
                전에는 카드 수취 법인 행이 이 조건 안에 있어서, 한국 사업자 정보가 비어 있는
                서버(dev 실측: platform_settings 전 칸 NULL)에서는 **블록째로 사라졌다** —
                말레이시아 법인 표기는 코드 상수라 언제나 있는데 남의 데이터 유무에 매달려 있었다.
                고지는 다른 값이 비었다고 같이 사라져서는 안 된다. */}
            <FooterBiz>
              {company && (company.legal_entity || company.biz_registration_no) && (
                <>
                <FooterBizRow>
                  <FooterBizEntity>{t('footer.biz.krEntity', '한국 법인')}</FooterBizEntity>
                  {company.legal_entity && <span>{t('footer.biz.company', '상호')}: {company.legal_entity}</span>}
                  {company.representative_name && <span>{t('footer.biz.ceo', '대표')}: {company.representative_name}</span>}
                  {company.biz_registration_no && <span>{t('footer.biz.regNo', '사업자등록번호')}: {company.biz_registration_no}</span>}
                  {company.mail_order_no && (
                    <span>
                      {t('footer.biz.mailOrderNo', '통신판매업신고번호')}: {company.mail_order_no}
                      {company.biz_registration_no && (
                        <>
                          {' '}
                          <FooterBizLink
                            href={`https://www.ftc.go.kr/bizCommPop.do?wrkr_no=${company.biz_registration_no.replace(/[^0-9]/g, '')}`}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {t('footer.biz.verify', '사업자정보확인')}
                          </FooterBizLink>
                        </>
                      )}
                    </span>
                  )}
                </FooterBizRow>
                <FooterBizRow>
                  {company.company_address && <span>{t('footer.biz.address', '주소')}: {company.company_address}</span>}
                  {company.company_phone && <span>{t('footer.biz.tel', '대표전화')}: {company.company_phone}</span>}
                  {company.company_email && <span>{t('footer.biz.email', '이메일')}: {company.company_email}</span>}
                </FooterBizRow>
                </>
              )}
                {/* ★ 청구 주체가 둘이다 (2026-09-14). 위는 **서비스 제공자**(한국, platform_settings),
                    아래는 카드 결제를 받는 **말레이시아 법인** — 값은 `config/legalEntities.ts` 한 곳에서 온다.
                    2026-10-12 Irene: *"굳이 카드결제수취라고 나가야 해? 말레이시아 법인 한국법인 이렇게"* —
                    푸터는 두 법인을 **나란히 표기**만 한다. «어느 결제를 누가 받나» 는 푸터가 아니라
                    약관 제3조·결제 직전 문구(plan.json hint)가 말한다. 그 둘을 빼면 이 표기도 다시 봐야 한다. */}
              <FooterBizRow data-testid="footer-card-biller">
                <FooterBizEntity>{t('footer.biz.myEntity', '말레이시아 법인')}</FooterBizEntity>
                <span>{t('footer.biz.company', '상호')}: {BILLING_ENTITY.name}</span>
                <span>{t('footer.biz.regNoIntl', '법인등록번호')}: {BILLING_ENTITY.regNo}</span>
                <span>{t('footer.biz.address', '주소')}: {BILLING_ENTITY.address}</span>
                <span>{t('footer.biz.email', '이메일')}: {BILLING_ENTITY.email}</span>
              </FooterBizRow>
            </FooterBiz>
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
  /* ★ 2026-09-15 — 이 셸은 **문서 전체가 스크롤**한다(앱 셸의 탭 슬롯과 다르다). 그래서 여기에
     놓인 PageShell 은 자기 머리줄을 sticky 로 붙여야 하고, 그 기준선은 **이 셸의 상단 크롬**
     (= sticky GNB) 높이다. 숫자는 GnbInner 와 **여기 한 쌍**에서만 쓴다 — 쓰는 쪽(PageShell)이
     스스로 정하면 셸이 바뀔 때마다 거짓이 된다(CLAUDE.md "상단 기준선").
     ⚠️ GnbInner 의 height 를 바꾸면 이 값도 같이 바꾼다. */
  --pq-page-header-top: 64px;
  @media (max-width: 640px) { --pq-page-header-top: 56px; }
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
  /* ⚠️ 이 높이를 바꾸면 위 Page 의 --pq-page-header-top 도 같이 바꾼다 (한 쌍이다) */
  height: 64px; padding: 0 24px;
  display: flex; align-items: center; justify-content: space-between;
  gap: 24px;
  /* 1024~1279 — «브랜드스토리» 라벨(«소개» 보다 길다)까지 한 줄에 들도록 간격만 줄인다. 항목은 숨기지 않는다 */
  @media (max-width: 1279px) { gap: 12px; padding: 0 20px; }
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
// ★ 메뉴가 9개라(2026-10-11 «시작 가이드» 추가) 좁은 데스크탑에서 가로로 넘쳤다 — 실측 901px 187px · 1024px 64px.
//   1023px 이하는 메뉴 버튼(시트)로 접고, 1024~1279px 는 간격만 줄인다. 세 곳(메뉴·CTA·메뉴 버튼)이 같은 경계를 쓴다.
const DesktopNav = styled.nav`
  display: flex; gap: 4px;
  @media (max-width: 1023px) { display: none; }
`;
const NavItem = styled(NavLink)<{ $light: boolean }>`
  height: 36px; padding: 0 14px;
  display: inline-flex; align-items: center;
  text-decoration: none;
  color: ${p => p.$light ? 'rgba(255,255,255,0.85)' : '#475569'};
  font-size: 0.875rem; font-weight: 500; white-space: nowrap;
  border-radius: 8px;
  transition: background 0.15s, color 0.15s;
  @media (max-width: 1279px) { padding: 0 8px; }
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
  @media (max-width: 1023px) { display: none; }
`;
// #196 — KO·EN 토글 (LegalPage 와 같은 형태). GNB 가 hero 위에서 transparent(다크 배경) 일 때는
//   글자를 밝게 뒤집어야 읽힌다 — $light 가 그 분기.
const Lang = styled.div`
  display: flex; align-items: center; margin-right: 4px;
  /* 모바일 시트에서 KO 글자 시작점이 MobileNavItem(padding-left 14px)과 맞도록 6px 보정 */
  padding-left: 6px;
`;
const LangBtn = styled.button<{ $active: boolean; $light: boolean }>`
  background: none; border: none; padding: 4px 8px;
  font-size: 0.75rem; font-weight: ${p => (p.$active ? 700 : 500)};
  color: ${p => (p.$light
    ? (p.$active ? '#5EEAD4' : 'rgba(255,255,255,0.65)')
    : (p.$active ? '#0F766E' : '#94A3B8'))};
  cursor: pointer;
  &:hover { color: ${p => (p.$light ? '#FFFFFF' : '#0F172A')}; }
`;
const LangDiv = styled.span<{ $light: boolean }>`
  color: ${p => (p.$light ? 'rgba(255,255,255,0.4)' : '#CBD5E1')};
`;
const PrimaryBtn = styled(Link)`
  height: 36px; padding: 0 18px;
  display: inline-flex; align-items: center;
  @media (max-width: 1279px) { padding: 0 14px; }
  background: #14B8A6; color: #FFFFFF;
  border: none; border-radius: 999px;
  font-size: 0.8125rem; font-weight: 500;
  text-decoration: none;
  transition: background 0.15s, transform 0.15s, box-shadow 0.15s;
  box-shadow: 0 0 0 rgba(20,184,166,0);
  &:hover { background: #0D9488; transform: translateY(-1px); box-shadow: 0 8px 24px rgba(20,184,166,0.3); }
`;
const SecondaryBtn = styled(Link)<{ $light: boolean }>`
  height: 36px; padding: 0 16px;
  display: inline-flex; align-items: center;
  @media (max-width: 1279px) { padding: 0 12px; }
  background: transparent;
  color: ${p => p.$light ? 'rgba(255,255,255,0.85)' : '#0F172A'};
  border: 1px solid ${p => p.$light ? 'rgba(255,255,255,0.18)' : '#E2E8F0'};
  border-radius: 999px;
  font-size: 0.8125rem; font-weight: 500;
  text-decoration: none;
  transition: background 0.15s, border-color 0.15s;
  &:hover {
    background: ${p => p.$light ? 'rgba(255,255,255,0.08)' : '#F8FAFC'};
    border-color: ${p => p.$light ? 'rgba(255,255,255,0.32)' : '#CBD5E1'};
  }
`;
// 로그인 — 우측 묶음에서 [문의](outline)·[무료로 시작](teal) 사이의 글자 버튼 (버튼 셋이 같은 무게면 시선이 갈린다)
const TextBtn = styled(Link)<{ $light: boolean }>`
  height: 36px; padding: 0 10px;
  display: inline-flex; align-items: center;
  color: ${p => p.$light ? 'rgba(255,255,255,0.85)' : '#475569'};
  font-size: 0.8125rem; font-weight: 500; text-decoration: none; white-space: nowrap;
  border-radius: 8px;
  &:hover { color: ${p => p.$light ? '#FFFFFF' : '#0F172A'}; }
`;
const AppIcon = styled.svg`margin-right: 6px; flex-shrink: 0;`;
const ResWrap = styled.div`position: relative; display: inline-flex;`;
const ResTrigger = styled.button<{ $light: boolean; $active: boolean }>`
  height: 36px; padding: 0 14px;
  display: inline-flex; align-items: center; gap: 4px;
  background: transparent; border: none; cursor: pointer; font-family: inherit;
  color: ${p => p.$active ? (p.$light ? '#5EEAD4' : '#0D9488') : (p.$light ? 'rgba(255,255,255,0.85)' : '#475569')};
  font-size: 0.875rem; font-weight: 500; white-space: nowrap;
  border-radius: 8px;
  transition: background 0.15s, color 0.15s;
  @media (max-width: 1279px) { padding: 0 8px; }
  &:hover {
    background: ${p => p.$light ? 'rgba(255,255,255,0.08)' : '#F1F5F9'};
    color: ${p => p.$light ? '#FFFFFF' : '#0F172A'};
  }
`;
const ResPanel = styled.div`
  position: absolute; top: 100%; left: 0;
  /* 트리거와 패널 사이 틈에서 마우스가 빠져 닫히지 않게 — 패딩으로 다리를 놓는다 */
  padding-top: 6px;
  min-width: 180px;
  display: flex; flex-direction: column;
  & > * { background: #FFFFFF; }
  & > *:first-child { border-radius: 10px 10px 0 0; padding-top: 12px; }
  & > *:last-child { border-radius: 0 0 10px 10px; padding-bottom: 12px; }
  filter: drop-shadow(0 8px 20px rgba(15,23,42,0.12)) drop-shadow(0 0 1px rgba(15,23,42,0.25));
  z-index: 110;
`;
const ResItem = styled(NavLink)`
  display: block; padding: 8px 16px;
  color: #334155; font-size: 0.875rem; font-weight: 500; text-decoration: none; white-space: nowrap;
  &:hover { color: #0F172A; background: #F8FAFC; }
  &.active { color: #0D9488; }
`;
const Hamburger = styled.button<{ $light: boolean }>`
  display: none; width: 36px; height: 36px;
  align-items: center; justify-content: center;
  background: transparent; border: none; cursor: pointer;
  color: ${p => p.$light ? '#FFFFFF' : '#0F172A'};
  border-radius: 8px;
  &:hover { background: ${p => p.$light ? 'rgba(255,255,255,0.08)' : '#F1F5F9'}; }
  @media (max-width: 1023px) { display: inline-flex; }
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
  color: #0F172A; font-size: 0.9375rem; font-weight: 500;
  border-radius: 8px;
  &:hover { background: #F1F5F9; }
  &.active { color: #0D9488; background: #F0FDFA; }
`;
const MobileCtaRow = styled.div`
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 4px 0;
`;
const MobileGroupLabel = styled.div`
  padding: 12px 14px 4px;
  font-size: 0.75rem; font-weight: 600; color: #94A3B8; letter-spacing: 0.5px;
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
  font-size: 0.8125rem; color: #94A3B8; line-height: 1.6; max-width: 280px;
  letter-spacing: 0.2px; text-align: left;  /* #89 — 문장형 태그라인: 과도한 자간 제거 */
`;
const FooterTitle = styled.div`
  font-family: 'Outfit', sans-serif;
  font-size: 0.75rem; font-weight: 500; color: #5EEAD4;
  letter-spacing: 2px;
  margin-bottom: 6px;
`;
const FooterLink = styled(Link)`
  font-size: 0.8125rem; color: #94A3B8;
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
  font-size: 0.75rem;
  color: #94A3B8;
  font-weight: 300;
  line-height: 1.6;
`;
/* 법인 구분 머리말 — 같은 줄 맨 앞, 값보다 한 단계만 진하게 */
const FooterBizEntity = styled.span`
  color: #CBD5E1;
  font-weight: 500;
`;
const FooterBizLink = styled.a`
  color: #94A3B8;
  text-decoration: underline;
  text-underline-offset: 2px;
  &:hover { color: #CBD5E1; }
`;
const FooterCopy = styled.div`font-size: 0.75rem; color: #64748B; font-weight: 300;`;
