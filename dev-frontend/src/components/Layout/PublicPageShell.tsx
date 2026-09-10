// 공개(무로그인) 화면의 **공용 껍데기**.
//
// ★ 왜 별도인가 — `PageShell` 을 재활용할 수 없다(코드로 확정된 이유 셋):
//   ① `PageShell.tsx:105-108` 이 `<UserChip />` 을 **조건 없이** 그린다. 그 컴포넌트는
//      `useAuth()` + 플랜 조회 API 를 끌고 온다. 화면에는 안 보이더라도(경로 게이트) 공개 번들이
//      로그인 서비스를 물고 들어가고, 헤더 우측이 **끌 수 없는 고정 슬롯**이 된다.
//   ② `PageShell` 의 `Page` 는 `height:100%` 이고 주석이 "부모(MainContent)가 높이를 준다" 고
//      전제한다. 공개 라우트에는 `MainLayout` 이 없어 **높이가 0 으로 붕괴**한다.
//      공개 화면들이 저마다 `100vh`/`100dvh` 를 선언하고 있던 이유가 이것이다.
//   ③ `PageShell` 은 `padding-bottom:88px`(FAB 회피)를 준다. 공개 표면에는 FAB 이 마운트되지
//      않으므로 근거 없는 여백이다. 그리고 `PageShell` 은 폭 상한을 **의도적으로 걷어냈는데**
//      공개 화면은 전부 폭 상한이 필요하다 — 요구가 정반대다.
//
// ★ 무엇을 흡수하나 (2026-09-10 실측): 공개 표면 13화면이 공용 컴포넌트를 거의 안 쓰고
//   같은 것을 여러 벌 베껴 두었다. 값이 **한 글자도 다르지 않은** 복사본들:
//     Toolbar 6벌 · Brand 6벌 · PromoBar/Text/Link 4벌 · WorkspaceLabel 6벌 ·
//     Center(로딩) 6벌 · DocFrame 4벌
//   갈라진 곳도 같이 드러났다 — 제목 크기 6가지, 카드 폭 8가지, 로딩 화면 4벌,
//   `@media print` 가 KbBundle 에만 없음. 한 곳으로 모으면 그 표류가 함께 사라진다.
//
// ★ 이 껍데기는 **auth-free 다.** `useAuth`·`useTimeFormat`(내부에서 useAuth 를 부른다)·
//   `tabStore`·소켓을 쓰지 않는다. 날짜가 필요하면 `utils/dateFormat.ts` 의 `formatPublicDate`.
import React from 'react';
import styled, { css } from 'styled-components';
import { useTranslation } from 'react-i18next';

/** 본문 폭 — 화면마다 제각각이던 8가지 값을 4토큰으로 모은다. */
export const PUBLIC_WIDTHS = { sm: '420px', md: '640px', lg: '820px', xl: '920px' } as const;
export type PublicWidth = keyof typeof PUBLIC_WIDTHS;

interface Props {
  /** card = 가운데 카드 / document = 툴바 + 문서 프레임 / app = 전체높이 앱형(게스트) */
  layout?: 'card' | 'document' | 'app';
  width?: PublicWidth;
  /** 전체 높이를 차지하고 내부가 스크롤 (게스트 채팅처럼 입력줄이 바닥에 고정돼야 할 때) */
  fill?: boolean;
  /** 브랜드 로고 (document 기본 true) */
  brand?: boolean;
  /** app 레이아웃의 제목·부제 */
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  /** 헤더 우측 — 버튼 2개 이내 (그 이상은 자리를 먹으면서 뜻은 안 알려준다) */
  actions?: React.ReactNode;
  /** 헤더 우측 텍스트 메타 (서명 화면의 수신자 등) */
  headerMeta?: React.ReactNode;
  /** 헤더 아래 홍보 띠 */
  promo?: boolean;
  /** 인쇄 시 크롬을 감춘다 (document 기본 true) */
  print?: boolean;
  /** 인쇄되는 영역인가 — `index.css` 의 `[data-print-area]` 계약. document 레이아웃 기본 true.
   *  이 표시가 없으면 인쇄 시 **본문이 통째로 안 보인다**(그 CSS 가 나머지를 visibility:hidden 한다). */
  printArea?: boolean;
  children: React.ReactNode;
}

const PublicPageShell: React.FC<Props> = ({
  layout = 'document', width = 'lg', fill = false,
  brand, title, subtitle, actions, headerMeta, promo = false, print = true, printArea, children,
}) => {
  const { t } = useTranslation();
  const showBrand = brand ?? (layout !== 'app');
  const showHeader = showBrand || !!title || !!actions || !!headerMeta;

  return (
    <Page $layout={layout} $fill={fill} $print={print}>
      {showHeader && (
        <Toolbar $print={print} $app={layout === 'app'}>
          {showBrand && <Brand src="/planQ-slogan_color.svg" alt="PlanQ" />}
          {(title || subtitle) && (
            <TitleBox>
              <ShellTitle>{title}</ShellTitle>
              {subtitle && <ShellSub>{subtitle}</ShellSub>}
            </TitleBox>
          )}
          <Spacer />
          {headerMeta && <HeaderMeta>{headerMeta}</HeaderMeta>}
          {actions}
        </Toolbar>
      )}
      {promo && (
        <PromoBar className="no-print">
          <PromoText>
            {t('public.promoCopy', { defaultValue: '업무, 프로젝트, 사람, 시간, 고객, 청구를 하나로 연결해 시간을 돈으로 바꾸는 수익성 엔진' }) as string}
          </PromoText>
          <PromoLink href="https://planq.kr" target="_blank" rel="noreferrer">
            {t('public.promoCta', { defaultValue: '플랜큐 바로가기' }) as string} <span aria-hidden="true">→</span>
          </PromoLink>
        </PromoBar>
      )}
      {layout === 'app' ? children : (
        <Frame
          $layout={layout} $w={PUBLIC_WIDTHS[width]} $print={print}
          {...((printArea ?? (layout === 'document' && print)) ? { 'data-print-area': true } : {})}
        >{children}</Frame>
      )}
    </Page>
  );
};

export default PublicPageShell;

/** 로딩·빈 상태 — 화면마다 4벌로 갈라져 있던 것. */
export const PublicCenter = styled.div`
  min-height: 60vh; display: flex; align-items: center; justify-content: center;
  color: #64748B; font-size: 0.875rem; text-align: center; padding: 24px;
`;
/** 문서 위의 워크스페이스 이름 — 6벌이 완전히 같은 값이었다. */
export const PublicWorkspaceLabel = styled.div`
  font-size: 0.6875rem; font-weight: 700; color: #94A3B8;
  text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px;
`;
/** 문서 제목 — 화면마다 1.125 / 1.25 / 1.375 / 1.5rem 로 갈려 있었다. */
export const PublicTitle = styled.h1`
  font-size: 1.5rem; font-weight: 700; color: #0F172A; margin: 0 0 6px 0; line-height: 1.3;
`;
export const PublicMeta = styled.div`
  display: flex; flex-wrap: wrap; gap: 6px; align-items: center;
  font-size: 0.75rem; color: #64748B; margin-bottom: 20px;
`;
/** 툴바 버튼 — 화면마다 PrintBtn/PlainBtn/CTA 로 이름만 달랐고 값은 같았다. */
export const PublicBtn = styled.button<{ $primary?: boolean }>`
  display: inline-flex; align-items: center; gap: 6px; min-height: 44px;
  padding: 8px 16px; font-size: 0.8125rem; border-radius: 8px; cursor: pointer;
  ${({ $primary }) => ($primary ? css`
    font-weight: 700; color: #FFF; background: #14B8A6; border: none;
    &:hover { background: #0D9488; }
  ` : css`
    font-weight: 600; color: #334155; background: #FFF; border: 1px solid #E2E8F0;
    &:hover { border-color: #14B8A6; color: #0F766E; }
  `)}
  &:disabled { opacity: 0.5; cursor: default; }
`;

const Page = styled.div<{ $layout: string; $fill: boolean; $print: boolean }>`
  background: #F8FAFC;
  ${({ $layout, $fill }) => ($fill || $layout === 'app'
    /* 앱형은 내부가 스크롤한다 — 100dvh 여야 iOS 툴바가 바닥 입력줄을 안 먹는다.
       (100vh 는 주소창 높이를 포함해 실제보다 크다) */
    ? css`display: flex; flex-direction: column; height: 100dvh;`
    : css`min-height: 100vh; padding: 0 0 40px 0;`)}
  ${({ $print }) => $print && css`@media print { background: #FFF; padding: 0; }`}
`;
const Toolbar = styled.div<{ $print: boolean; $app: boolean }>`
  display: flex; align-items: center; gap: 8px;
  background: #FFF; border-bottom: 1px solid #E2E8F0;
  flex-shrink: 0;
  /* 앱형은 제목이 들어가므로 PageShell 과 같은 규격(60px · 14px 20px)을 따른다.
     문서형은 로고+버튼이라 12px 24px — 두 값이 갈라진 게 아니라 성격이 다르다. */
  ${({ $app }) => ($app
    ? css`min-height: 60px; padding: 14px 20px;`
    : css`padding: 12px 24px; position: sticky; top: 0; z-index: 10;`)}
  ${({ $print }) => $print && css`@media print { display: none !important; }`}
  @media (max-width: 640px) { padding-left: 16px; padding-right: 16px; }
`;
const Brand = styled.img`display:block;width:120px;height:auto;user-select:none;flex-shrink:0;`;
const TitleBox = styled.div`min-width: 0;`;
const ShellTitle = styled.div`
  font-size: 1.125rem; font-weight: 700; letter-spacing: -0.2px; color: #0f172a;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
`;
const ShellSub = styled.div`font-size: 0.8125rem; color: #64748b; margin-top: 2px;`;
const Spacer = styled.div`flex: 1;`;
const HeaderMeta = styled.div`font-size: 0.75rem; color: #64748B; flex-shrink: 0;`;
const PromoBar = styled.div`
  display: flex; align-items: center; gap: 14px; flex-shrink: 0;
  padding: 9px 24px; background: #F0FDFA; border-bottom: 1px solid #99F6E4;
  font-size: 0.75rem; color: #475569; line-height: 1.5;
  @media (max-width: 640px) { padding: 9px 16px; gap: 10px; flex-wrap: wrap; }
  @media print { display: none !important; }
`;
const PromoText = styled.span`
  flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  @media (max-width: 640px) { white-space: normal; }
`;
const PromoLink = styled.a`
  flex-shrink: 0; color: #0F766E; font-weight: 700; text-decoration: none; white-space: nowrap;
  &:hover { color: #115E59; text-decoration: underline; }
  span { margin-left: 4px; }
`;
const Frame = styled.div<{ $layout: string; $w: string; $print: boolean }>`
  max-width: ${({ $w }) => $w};
  margin: ${({ $layout }) => ($layout === 'card' ? '40px auto' : '32px auto')};
  ${({ $layout }) => ($layout === 'document' ? css`
    background: #FFF; border: 1px solid #E2E8F0; border-radius: 12px;
    padding: 48px 56px; box-shadow: 0 4px 12px rgba(0,0,0,0.04);
    font-size: 0.875rem; line-height: 1.7; color: #0F172A;
  ` : css`
    background: #FFF; border: 1px solid #E2E8F0; border-radius: 14px;
    padding: 28px 32px; box-shadow: 0 4px 12px rgba(0,0,0,0.06);
  `)}
  ${({ $print }) => $print && css`
    @media print { border: none; box-shadow: none; padding: 0; margin: 0; max-width: 100%; }
  `}
  @media (max-width: 640px) { padding: 24px 20px; margin: 16px; }
`;
