// DesktopHandoffBand — 브라우저에서 연 PlanQ 앱 화면 링크를 데스크탑 앱으로 넘기는 띠 (2026-11-25 · Fable 설계 판정 반영).
//   판정·주소 만들기는 utils/desktopHandoff 한 곳. 화면을 가리지 않는다(SPA 는 그대로 그리고 띠만 얹는다).
//   ① 브라우저: 서버가 «받을 수 있는 데스크탑 앱 세션이 있다»(user.desktop_open_links)고 할 때만.
//      미정 → [앱에서 열기]/[여기서 볼게요] (+ 기억하기) · app → 첫 로드에 한 번 자동 + «여는 중» · browser → 없음
//   ② 데스크탑 앱 안: 넘겨받은 링크가 다른 계정 것이면(DesktopBridge 가 이동하지 않음) 그 까닭을 보인다.
import React, { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { useChromeLocation } from '../../hooks/useChromeNav';
import { isDesktopApp } from '../../services/native';
import {
  handoffTarget, buildOpenUrl, fireOpen, autoFiredOnce, getHandoffPref, setHandoffPref,
} from '../../utils/desktopHandoff';

export const OTHER_ACCOUNT_EVENT = 'planq:desktop-open-other-account';

type Mode = 'offer' | 'opening' | null;

const DesktopHandoffBand: React.FC = () => {
  const { t } = useTranslation('common');
  const { user } = useAuth();
  const location = useChromeLocation();
  const [mode, setMode] = useState<Mode>(null);
  const [remember, setRemember] = useState(false);
  const [closed, setClosed] = useState(false);
  const [otherAccount, setOtherAccount] = useState(false);
  const autoRef = useRef(false);

  const eligible = !!user && user.desktop_open_links === true && !closed;
  const target = eligible ? handoffTarget() : null;
  // location 이 바뀌면 다시 본다(다른 화면으로 옮기면 handoffTarget 이 null)
  void location;

  const openUrl = target && user ? buildOpenUrl(target, user.id, user.business_id ?? null) : null;

  useEffect(() => {
    if (!openUrl || !target) { setMode(null); return; }
    const pref = getHandoffPref();
    if (pref === 'browser') { setMode(null); return; }
    if (pref === 'app') {
      setMode('opening');
      if (!autoRef.current) {
        autoRef.current = true;
        if (!autoFiredOnce(target)) fireOpen(openUrl);
      }
      return;
    }
    setMode((m) => (m === 'opening' ? m : 'offer'));
  }, [openUrl, target]);

  useEffect(() => {
    if (!isDesktopApp()) return;
    const on = () => setOtherAccount(true);
    window.addEventListener(OTHER_ACCOUNT_EVENT, on);
    return () => window.removeEventListener(OTHER_ACCOUNT_EVENT, on);
  }, []);

  if (otherAccount) {
    return (
      <Wrap role="status" data-testid="desktop-handoff-other">
        <Body>
          <Title>{t('desktopHandoff.otherTitle', '다른 계정의 링크예요')}</Title>
          <Sub>{t('desktopHandoff.otherSub', '브라우저와 다른 계정으로 로그인돼 있어 열지 않았어요. 계정을 바꾼 뒤 다시 열어 주세요.')}</Sub>
        </Body>
        <Ghost type="button" onClick={() => setOtherAccount(false)}>{t('desktopHandoff.close', '닫기')}</Ghost>
      </Wrap>
    );
  }

  if (!mode || !openUrl) return null;

  const stay = () => {
    if (remember) setHandoffPref('browser');
    setClosed(true);
  };
  const open = () => {
    if (remember) setHandoffPref('app');
    fireOpen(openUrl);
    setMode('opening');
  };

  if (mode === 'opening') {
    return (
      <Wrap role="status" data-testid="desktop-handoff-opening">
        <Body>
          <Title>{t('desktopHandoff.openingTitle', '데스크탑 앱에서 여는 중')}</Title>
          <Sub>{t('desktopHandoff.openingSub', '안 열리면 여기서 계속 보시면 돼요.')}</Sub>
        </Body>
        <Primary type="button" onClick={() => fireOpen(openUrl)}>{t('desktopHandoff.retry', '다시 열기')}</Primary>
        <Ghost type="button" onClick={() => setClosed(true)}>{t('desktopHandoff.stayHere', '여기서 계속')}</Ghost>
      </Wrap>
    );
  }

  return (
    <Wrap role="region" aria-label={t('desktopHandoff.aria', '데스크탑 앱에서 열기') as string} data-testid="desktop-handoff-offer">
      <Body>
        <Title>{t('desktopHandoff.offerTitle', '데스크탑 앱에서 열까요?')}</Title>
        <Sub>{t('desktopHandoff.offerSub', '이 컴퓨터에 PlanQ 데스크탑 앱이 있으면 앱에서 바로 열려요.')}</Sub>
        <Remember>
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          {t('desktopHandoff.remember', '이 브라우저에서 이 선택 기억하기')}
        </Remember>
      </Body>
      <Btns>
        <Primary type="button" onClick={open}>{t('desktopHandoff.open', '앱에서 열기')}</Primary>
        <Ghost type="button" onClick={stay}>{t('desktopHandoff.stay', '여기서 볼게요')}</Ghost>
      </Btns>
    </Wrap>
  );
};

export default DesktopHandoffBand;

const Wrap = styled.div`
  position: fixed; z-index: 8000;
  top: calc(var(--pq-chrome-bottom, 0px) + 16px); right: 16px;
  width: 380px; max-width: calc(100vw - 32px); box-sizing: border-box;
  display: flex; align-items: center; gap: 10px;
  padding: 12px 14px;
  background: linear-gradient(180deg, #115E59 0%, #134E4A 100%);
  color: #FFFFFF;
  border-radius: 12px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.18);
`;
const Body = styled.div`flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px;`;
const Title = styled.div`font-size: 0.8125rem; font-weight: 700;`;
const Sub = styled.div`font-size: 0.6875rem; color: #CCFBF1; line-height: 1.4;`;
const Remember = styled.label`
  display: inline-flex; align-items: center; gap: 6px; margin-top: 4px;
  font-size: 0.6875rem; color: #CCFBF1; cursor: pointer;
  input { margin: 0; accent-color: #5EEAD4; }
`;
const Btns = styled.div`display: flex; flex-direction: column; gap: 6px; flex-shrink: 0;`;
const Primary = styled.button`
  height: 32px; padding: 0 12px; white-space: nowrap;
  background: #FFFFFF; color: #115E59;
  border: none; border-radius: 8px;
  font-size: 0.75rem; font-weight: 700; cursor: pointer;
  &:hover { background: #F0FDFA; }
  &:focus-visible { outline: 2px solid #5EEAD4; outline-offset: 2px; }
`;
const Ghost = styled.button`
  height: 32px; padding: 0 10px; white-space: nowrap;
  background: transparent; color: #CCFBF1;
  border: 1px solid rgba(204,251,241,0.4); border-radius: 8px;
  font-size: 0.75rem; font-weight: 600; cursor: pointer;
  &:hover { background: rgba(255,255,255,0.10); color: #FFFFFF; }
  &:focus-visible { outline: 2px solid #5EEAD4; outline-offset: 2px; }
`;
