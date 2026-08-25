// QTalkStandalonePage — Q Talk 분리 창 (#9, N+93)
//   RightDock / ChatPanel 의 ⧉ 클릭 시 window.open('/talk-popout?conv=...') 로 열림.
//   MainLayout 우회(사이드바/헤더 없음) + QTalkPage embedded 모드 → 데스크탑앱 밖에서 채팅 이어가기.
//   embedded 가 URL 싱크를 끄므로 팝아웃이 /talk 로 튕기지 않고 chrome-less 유지 (재로그인 회귀 차단).
//   인증은 refresh 쿠키로 자체 부트스트랩 (AuthProvider checkSession).
import React, { useEffect, useRef } from 'react';
import styled from 'styled-components';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import QTalkPage from './QTalkPage';
import PopoutPinButton from '../../components/Common/PopoutPinButton';
import PinHolderView from '../../components/Common/PinHolderView';
import { usePinHost } from '../../utils/pinHost';
import { markPopoutWindow } from '../../utils/popout';
import { useAppShellLock } from '../../hooks/useAppShellLock';

const QTalkStandalonePage: React.FC = () => {
  useAppShellLock();
  const { t } = useTranslation('qtalk');
  const [params] = useSearchParams();
  const convId = Number(params.get('conv')) || null;
  const projectId = Number(params.get('project')) || null;
  // ★ 고정 → 해제로 돌아오면 QTalkPage 가 **다시 마운트**된다. 그때 초기값을 라우터 파라미터에서 읽으면
  //   보던 대화가 아니라 **처음 열었던 대화**로 돌아간다 — 이 창은 URL 을 history.replaceState 로만
  //   갱신해서(navigate 금지) 라우터가 그 변경을 모르기 때문이다(Fable 검증 중 발견).
  //   지금 보고 있는 대화를 ref 로 들고 있다가 재마운트 초기값으로 쓴다.
  const ctxRef = useRef<{ p: number | null; c: number | null }>({ p: projectId, c: convId });
  // 팝아웃 위의 핀 = 이 창이 고정창을 연다. 고정 중에는 이 창이 작은 막대(홀더)로 줄어 주인으로 남는다.
  const pin = usePinHost({ tool: 'qtalk', title: 'Q Talk' });

  useEffect(() => {
    document.title = t('popout.title', { defaultValue: 'PlanQ 채팅' }) as string;
    document.body.dataset.popout = '1';
    markPopoutWindow(); // #84
    return () => { delete document.body.dataset.popout; };
  }, [t]);

  if (pin.mode === 'holder') return <Shell><PinHolderView host={pin} label="Q Talk" /></Shell>;

  return (
    <Shell>
      <QTalkPage
        embedded
        initialConvId={ctxRef.current.c}
        initialProjectId={ctxRef.current.p}
        pinSlot={<PopoutPinButton host={pin} />}
        onEmbeddedContextChange={(p, c) => {
          ctxRef.current = { p: p ?? null, c: c ?? null };
          // 이 창의 URL 만 조용히 갱신 (navigate 금지 — 팝아웃이 /talk 로 튕긴다).
          // 새로고침·공유 시 보던 대화가 유지된다. 고정으로 전환할 때 고정창이 **지금 보고 있는 대화**로
          // 열리는 근거이기도 하다(pinHost 가 iframe.src 로 이 창의 현재 URL 을 쓴다).
          const sp = new URLSearchParams();
          if (p) sp.set('project', String(p));
          if (c) sp.set('conv', String(c));
          // ★ _holder 는 고정창이 자기 홀더 창을 이름으로 앞세울 때 쓰는 값이다(utils/pinHost).
          //   여기서 URL 을 새로 쓰면서 흘리면, 대화방을 바꾼 뒤 고정을 풀 때 일반 창이 안 올라온다.
          const holder = new URLSearchParams(window.location.search).get('_holder');
          if (holder) sp.set('_holder', holder);
          const qs = sp.toString();
          const next = qs ? `/talk-popout?${qs}` : '/talk-popout';
          if (next !== `${window.location.pathname}${window.location.search}`) {
            window.history.replaceState({}, '', next);
          }
        }}
      />
    </Shell>
  );
};

export default QTalkStandalonePage;

const Shell = styled.div`
  /* 높이는 --vvh 하나로 — 100dvh 는 네이티브 WebView 에서 가시영역보다 커져 body 가
     스크롤 가능해지고 iOS 고무줄이 발동한다("팝아웃이 위아래로 흔들림", 2026-08-25 실측).
     --vvh 는 main.tsx 가 visualViewport.height 로 계속 sync 하는 값이라 항상 정확하다. */
  height: 100vh;
  height: 100dvh;
  height: var(--vvh, 100dvh);
  width: 100vw;
  overflow: hidden;
  background: #FFFFFF;
  display: flex;
  flex-direction: column;
  /* #84 — 팝아웃 헤더 모바일 노치/상태바 대응 (전 팝아웃 통일). box-sizing 으로 내용 영역이 노치 아래에서 시작. */
  box-sizing: border-box;
  padding-top: var(--pq-safe-top, 0px);
`;
