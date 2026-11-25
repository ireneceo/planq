// 설정 > 알림 — «PlanQ 링크 열기 (이 브라우저)» (2026-11-25 · utils/desktopHandoff 의 브라우저별 선택).
//   받을 수 있는 데스크탑 앱 세션이 있을 때(user.desktop_open_links)만 · 브라우저에서만(앱 안에서는 의미 없음).
//   값은 이 브라우저 localStorage 하나 — 띠의 «기억하기» 와 같은 칸.
import React, { useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { isNativeApp, isDesktopApp } from '../../services/native';
import { getHandoffPref, setHandoffPref, type HandoffPref } from '../../utils/desktopHandoff';

const DesktopLinkPrefSection: React.FC = () => {
  const { t } = useTranslation('settings');
  const { user } = useAuth();
  const [pref, setPref] = useState<HandoffPref>(() => getHandoffPref());
  if (isNativeApp() || isDesktopApp() || !user?.desktop_open_links) return null;
  const opts: Array<{ v: HandoffPref; label: string }> = [
    { v: null, label: t('desktopHandoff.ask', '매번 묻기') },
    { v: 'app', label: t('desktopHandoff.app', '데스크탑 앱에서 열기') },
    { v: 'browser', label: t('desktopHandoff.browser', '브라우저에서 열기') },
  ];
  return (
    <Section data-testid="desktop-link-pref">
      <Title>{t('desktopHandoff.title', 'PlanQ 링크 열기 (이 브라우저)')}</Title>
      <Desc>{t('desktopHandoff.desc', '이 브라우저에서 PlanQ 화면 링크를 열 때 데스크탑 앱으로 넘길지 정합니다.')}</Desc>
      <Row role="radiogroup">
        {opts.map((o) => (
          <Opt key={String(o.v)} type="button" role="radio" aria-checked={pref === o.v} $on={pref === o.v}
            onClick={() => { setHandoffPref(o.v); setPref(o.v); }}>
            {o.label}
          </Opt>
        ))}
      </Row>
    </Section>
  );
};

export default DesktopLinkPrefSection;

// NotificationSettings 의 Section·SectionTitle·SectionDesc 와 같은 모양
const Section = styled.section`
  background: #fff; border: 1px solid #E2E8F0; border-radius: 12px; padding: 18px 20px;
  display: flex; flex-direction: column; gap: 12px;
`;
const Title = styled.h3`font-size: 0.9375rem; font-weight: 700; color: #0F172A; margin: 0;`;
const Desc = styled.div`font-size: 0.75rem; color: #64748B;`;
const Row = styled.div`display: flex; flex-wrap: wrap; gap: 8px;`;
const Opt = styled.button<{ $on: boolean }>`
  height: 36px; padding: 0 14px; border-radius: 8px; cursor: pointer;
  font-size: 0.8125rem; font-weight: 600;
  border: 1px solid ${(p) => (p.$on ? '#14B8A6' : '#CBD5E1')};
  background: ${(p) => (p.$on ? '#F0FDFA' : '#FFFFFF')};
  color: ${(p) => (p.$on ? '#0F766E' : '#334155')};
  &:hover { border-color: #14B8A6; }
  &:focus-visible { outline: 2px solid #5EEAD4; outline-offset: 2px; }
`;
