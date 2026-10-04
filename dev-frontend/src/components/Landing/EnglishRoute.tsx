// 영어 공개 페이지 /en/… (2026-10-04 GEO §7-⑤) — 같은 랜딩 화면을 영어로 연다.
//   검색엔진·AI 는 /en/… 의 미리 만든 영어 HTML(services/seoArtifacts — hreflang 짝)을 읽고,
//   사람이 들어오면 SPA 가 이 래퍼로 언어를 en 으로 바꿔 같은 화면을 그린다. 화면을 새로 만들지 않는다.
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

const EnglishRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { i18n } = useTranslation();
  useEffect(() => {
    if (!String(i18n.language || '').startsWith('en')) void i18n.changeLanguage('en');
  }, [i18n]);
  return <>{children}</>;
};

export default EnglishRoute;
