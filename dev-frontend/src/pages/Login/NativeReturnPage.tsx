// /oauth/native-return — 앱 복귀 **착지 지점**.
//
// ★ 왜 이 라우트가 필요한가 (2026-09-06 운영):
//   OAuth 복귀는 여태 `planq://oauth/native-return` **커스텀 스킴 하나**로만 시도했다.
//   앱이 안 열리면(스킴 핸들러 없음·구버전 APK) 브라우저가 `planq` 를 호스트로 읽어
//   ERR_NAME_NOT_RESOLVED — 사용자에게는 "This site can't be reached" 다.
//   Irene(안드로이드): "앱으로 가든 이걸 누르든 안돼."
//
//   그래서 https 형(App Link)으로도 시도하는데, **그 주소가 SPA 에 없으면** catch-all 이
//   잡아 랜딩으로 떨어지고 일회용 code 가 그대로 사라진다. 이 페이지가 그 착지를 받는다.
//
// 동작:
//   · 앱이 App Link 를 가로챘다면 → 이 페이지는 브라우저에 남지 않는다(앱이 뜬다).
//     NativeBridge 의 appUrlOpen 이 code 를 받아 교환한다.
//   · 앱이 없거나 App Link 검증이 안 됐다면 → 이 페이지가 브라우저에 뜬다.
//     **잠깐 기다렸다가** 화면이 여전히 보이면(=앱이 안 떴다) 서버 교환으로 넘겨 로그인을 끝낸다.
//     기다리는 이유: 앱이 뜨는 중이면 code 를 앱에게서 뺏으면 안 된다(일회용).
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import { isNativeApp } from '../../services/native';

const NativeReturnPage: React.FC = () => {
  const { t } = useTranslation('auth');
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('code');
    // 앱 안(WebView)이면 NativeBridge 가 이미 처리한다 — 여기서 code 를 건드리지 않는다.
    if (!code || isNativeApp()) return;
    const timer = window.setTimeout(() => {
      // 앱이 떴으면 이 문서는 숨겨져 있다. 그때는 넘기지 않는다.
      if (document.visibilityState !== 'visible') return;
      window.location.replace(`/api/auth/google/web-return?code=${encodeURIComponent(code)}`);
    }, 1500);
    const late = window.setTimeout(() => setStuck(true), 4000);
    return () => { window.clearTimeout(timer); window.clearTimeout(late); };
  }, []);

  const code = new URLSearchParams(window.location.search).get('code');
  return (
    <Wrap>
      <Title>{t('nativeReturn.title', { defaultValue: 'PlanQ 로 돌아갑니다' }) as string}</Title>
      <Desc>{t('nativeReturn.desc', { defaultValue: '잠시만 기다려 주세요…' }) as string}</Desc>
      {/* 자동 이동이 막히는 환경(스크립트 차단 등)을 위한 수동 통로. 4초 뒤에만 보인다. */}
      {stuck && code && (
        <Btn href={`/api/auth/google/web-return?code=${encodeURIComponent(code)}`}>
          {t('nativeReturn.continue', { defaultValue: '이 브라우저에서 계속하기' }) as string}
        </Btn>
      )}
    </Wrap>
  );
};

export default NativeReturnPage;

const Wrap = styled.div`
  min-height: 100vh; min-height: 100dvh;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 8px; padding: 24px; text-align: center; background: #F8FAFC; color: #0F172A;
`;
const Title = styled.h1`margin: 0; font-size: 1.0625rem; font-weight: 700;`;
const Desc = styled.p`margin: 0 0 12px; font-size: 0.875rem; color: #475569; line-height: 1.7;`;
const Btn = styled.a`
  display: inline-block; padding: 14px 22px; border-radius: 10px;
  background: #115E59; color: #fff; text-decoration: none;
  font-size: 0.9375rem; font-weight: 600;
`;
