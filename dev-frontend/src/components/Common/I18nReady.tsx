// 번역이 올 때까지 기다렸다 그린다 (2026-11-01).
// 첫 방문자 화면(로그인·가입)에서 번역이 0.7~2.5초 늦게 와 «login.title»·«pricingPage.plans.basic.name» 같은
// 이름이 그대로 보였다 — i18n 이 네임스페이스 33개를 한꺼번에 받기 때문이다(실측).
// 이름이 보이는 것보다 잠깐 빈 바탕이 낫다. 랜딩 셸은 LandingLayout 안에서 같은 판정을 한다.
import React from 'react';
import { useTranslation } from 'react-i18next';

const I18nReady: React.FC<{ ns: string[]; children: React.ReactNode }> = ({ ns, children }) => {
  const { ready } = useTranslation(ns);
  if (!ready) return <div data-testid="i18n-wait" aria-busy="true" />;
  return <>{children}</>;
};

export default I18nReady;
