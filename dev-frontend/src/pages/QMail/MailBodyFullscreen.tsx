// pages/QMail/MailBodyFullscreen.tsx — 메일 본문 전체 화면 읽기 (운영 #260)
//
// 왜 필요한가: 본문 iframe 은 이미 내용만큼 늘어나므로 "잘리는" 문제가 아니다.
//   좁은 3분할 패널 안에서 읽는 게 답답한 것이다("보이는 높이값이 낮아서 답답한 감이 있네" — Irene).
//   → 같은 srcDoc 을 화면 전체에 띄워 읽기만 하는 모드를 만든다. 본문을 다시 만들지 않고 그대로 재사용한다.
//
// 보안: 원본과 **같은 sandbox 조합**을 쓴다(allow-scripts, same-origin 없음).
//   여기서 sandbox 를 느슨하게 하면 정화·격리 계약이 이 경로에서만 깨진다.
//
// 확대 (2026-10-17, Irene: "메일이 너무 작은 글자로 오면 … 모바일에서 손가락으로 확대 어렵지? 확대기능")
//   페이지 확대는 막혀 있다(iOS maximum-scale=1 · 앱 WebView) — **본문만** 키운다.
//   HTML 본문: iframe 안 /mail-frame.js 에 {planqMailZoom} 로 배율을 보내고, 두 손가락으로 바꾸면
//   {planqMailZoomed} 로 돌려받아 % 를 맞춘다. 평문: 글자 크기에 같은 배율. 열 때마다 100% 에서 시작한다.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { renderTextWithLinks as linkify } from '../../utils/linkify';
import { createPortal } from 'react-dom';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { useEscapeStack } from '../../hooks/useEscapeStack';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useBackToClose } from '../../hooks/useBackToClose';
import { PanelBackButton } from '../../components/Layout/PanelHeader';

interface Props {
  open: boolean;
  onClose: () => void;
  /** 헤더에 보일 제목 — 보통 메일 제목 */
  title: string;
  /** 보낸사람 등 부가 한 줄 */
  subtitle?: string;
  /** 본문 srcDoc (ThreadMessages 가 쓰는 buildMailSrcDoc 결과 그대로) */
  srcDoc?: string;
  /** HTML 이 없는 메일의 평문 본문 */
  text?: string | null;
  /** 사칭 격리본 — 평문에 링크를 걸지 않는다 */
  linksDisabled?: boolean;
}

const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3];

const MailBodyFullscreen: React.FC<Props> = ({ open, onClose, title, subtitle, srcDoc, text, linksDisabled }) => {
  const { t } = useTranslation('qmail');
  const ref = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);
  zoomRef.current = zoom;
  // 열 때마다 100% — 메일마다 글자 크기가 달라 앞 메일의 배율을 물려받으면 예측이 안 된다.
  useEffect(() => { if (open) setZoom(1); }, [open, srcDoc]);
  const pushZoom = useCallback((z: number) => {
    try { frameRef.current?.contentWindow?.postMessage({ planqMailZoom: z }, '*'); } catch { /* 부가 기능 */ }
  }, []);
  const changeZoom = useCallback((z: number) => { setZoom(z); pushZoom(z); }, [pushZoom]);
  const stepZoom = (dir: 1 | -1) => {
    const cur = zoomRef.current;
    const next = dir > 0
      ? ZOOM_STEPS.find((s) => s > cur + 0.01)
      : [...ZOOM_STEPS].reverse().find((s) => s < cur - 0.01);
    if (next != null) changeZoom(next);
  };
  // 두 손가락으로 바꾼 배율을 iframe 이 알려 준다 — 이 창의 iframe 이 보낸 것만 받는다.
  useEffect(() => {
    if (!open) return;
    const onMsg = (e: MessageEvent) => {
      if (!frameRef.current || e.source !== frameRef.current.contentWindow) return;
      const d = e.data as { planqMailZoomed?: number } | null;
      if (d && typeof d.planqMailZoomed === 'number') setZoom(d.planqMailZoomed);
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [open]);
  useBodyScrollLock(open);
  useEscapeStack(open, onClose);
  useFocusTrap(ref, open);
  // 폰은 전체 화면 = 새 화면이다 — 뒤로 가기(스와이프·안드로이드 버튼)가 이 창을 닫아야 한다.
  useBackToClose(open, onClose);
  if (!open) return null;

  return createPortal(
    <Backdrop onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <Panel ref={ref} role="dialog" aria-modal="true" aria-label={title || (t('detail.fullView', { defaultValue: '전체 화면으로 보기' }) as string)}>
        <Head>
          {/* 폰·태블릿(≤1024)은 다른 상세와 같은 ‹ 뒤로 하나 — ✕ 는 숨긴다(업무 상세와 같은 규칙). */}
          <PanelBackButton onClick={onClose} label={t('common.close', { defaultValue: '닫기' }) as string} />
          <HeadText>
            <HeadTitle>{title}</HeadTitle>
            {subtitle && <HeadSub>{subtitle}</HeadSub>}
          </HeadText>
          <ZoomGroup role="group" aria-label={t('detail.zoom', { defaultValue: '글자 크기' }) as string}>
            <ZoomBtn type="button" data-testid="mail-zoom-out" onClick={() => stepZoom(-1)} disabled={zoom <= ZOOM_STEPS[0] + 0.01}
              aria-label={t('detail.zoomOut', { defaultValue: '작게 보기' }) as string}
              title={t('detail.zoomOut', { defaultValue: '작게 보기' }) as string}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="5" y1="12" x2="19" y2="12" /></svg>
            </ZoomBtn>
            <ZoomPct type="button" data-testid="mail-zoom-reset" onClick={() => changeZoom(1)}
              aria-label={t('detail.zoomReset', { defaultValue: '원래 크기로' }) as string}
              title={t('detail.zoomReset', { defaultValue: '원래 크기로' }) as string}>
              {Math.round(zoom * 100)}%
            </ZoomPct>
            <ZoomBtn type="button" data-testid="mail-zoom-in" onClick={() => stepZoom(1)} disabled={zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1] - 0.01}
              aria-label={t('detail.zoomIn', { defaultValue: '크게 보기' }) as string}
              title={t('detail.zoomIn', { defaultValue: '크게 보기' }) as string}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            </ZoomBtn>
          </ZoomGroup>
          <CloseBtn type="button" onClick={onClose}
            aria-label={t('common.close', { defaultValue: '닫기' }) as string}
            title={t('common.close', { defaultValue: '닫기' }) as string}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </CloseBtn>
        </Head>
        <Body>
          {srcDoc
            ? <Frame ref={frameRef} data-testid="mail-fullview-frame" sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox" srcDoc={srcDoc} title={title || 'mail'}
                /* 문서가 다시 읽히면 안쪽 배율이 1 로 돌아간다 — 지금 배율을 다시 보낸다. */
                onLoad={() => { if (zoomRef.current !== 1) pushZoom(zoomRef.current); }} />
            /* 평문도 링크는 눌려야 한다 — 상세와 **같은 함수**를 쓴다(진입점마다 갈라지면
               "여기선 되는데 저기선 안 된다" 가 된다). */
            : <PlainText $zoom={zoom}>{text ? (linksDisabled ? text : linkify(text)) : (t('detail.noContent', { defaultValue: '(내용 없음)' }) as string)}</PlainText>}
        </Body>
      </Panel>
    </Backdrop>,
    document.body,
  );
};

export default MailBodyFullscreen;

const Backdrop = styled.div`
  position: fixed; inset: 0; z-index: 1200;
  background: rgba(15, 23, 42, 0.55);
  display: flex; align-items: center; justify-content: center;
  padding: 24px;
  @media (max-width: 768px) { padding: 0; }
`;
const Panel = styled.div`
  display: flex; flex-direction: column;
  width: min(1100px, 100%); height: min(92vh, 100%);
  background: #fff; border-radius: 14px; overflow: hidden;
  box-shadow: 0 24px 64px rgba(15, 23, 42, 0.28);
  @media (max-width: 768px) {
    width: 100%; height: 100%; border-radius: 0;
    /* ★ 2026-09-07 (Irene: "전체보기 하면 모바일에서 상단 안나와서 닫을 수가없어")
       백드롭이 inset:0 이라 이 패널은 **상태바 밑에서 시작**했다. 헤더가 60px 인데
       상태바가 24~47px 을 먹으면 닫기 버튼(세로 중앙 y≈30)이 그 아래로 들어간다.
       아래쪽만 safe 를 주고 위쪽을 뺀 탓 — 안전영역은 원시 env() 가 아니라
       토큰으로, 그리고 **양쪽 다** 준다(memory feedback_safe_area_token_not_raw_env).
       브라우저는 --pq-safe-top 이 0 이라 이 계열이 웹에서는 재현되지 않는다. */
    padding-top: var(--pq-safe-top, 0px);
    padding-bottom: var(--pq-safe-bottom, 0px);
  }
`;
const Head = styled.div`
  display: flex; align-items: center; gap: 12px;
  min-height: 60px; padding: 14px 20px;
  background: #fff; border-bottom: 1px solid #e2e8f0;
`;
const HeadText = styled.div` flex: 1; min-width: 0; `;
const HeadTitle = styled.div`
  font-size: 1rem; font-weight: 700; letter-spacing: -0.2px; color: #0F172A;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
`;
const HeadSub = styled.div`
  margin-top: 2px; font-size: 0.75rem; color: #64748B;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
`;
const ZoomGroup = styled.div`
  flex-shrink: 0; display: inline-flex; align-items: center; gap: 2px;
  background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 10px; padding: 2px;
`;
const ZoomBtn = styled.button`
  width: 32px; height: 32px;
  @media (max-width: 640px) { width: 40px; height: 40px; }
  display: inline-flex; align-items: center; justify-content: center;
  background: transparent; border: none; border-radius: 8px;
  color: #334155; cursor: pointer;
  &:hover:not(:disabled) { background: #E2E8F0; color: #0F172A; }
  &:disabled { color: #CBD5E1; cursor: default; }
  &:focus-visible { outline: 2px solid rgba(15,118,110,0.5); outline-offset: 1px; }
`;
const ZoomPct = styled.button`
  min-width: 48px; height: 32px; padding: 0 4px;
  @media (max-width: 640px) { height: 40px; }
  background: transparent; border: none; border-radius: 8px;
  font: inherit; font-size: 0.8125rem; font-weight: 600; color: #0F172A;
  font-variant-numeric: tabular-nums; cursor: pointer;
  &:hover { background: #E2E8F0; }
  &:focus-visible { outline: 2px solid rgba(15,118,110,0.5); outline-offset: 1px; }
`;
const CloseBtn = styled.button`
  /* touch-target-44: 폰 터치 타깃 (theme/tokens CONTROL.touchMin). 데스크탑 크기는 그대로. */
  @media (max-width: 640px) { min-width: 44px; min-height: 44px; }

  flex-shrink: 0; width: 36px; height: 36px;
  display: inline-flex; align-items: center; justify-content: center;
  background: transparent; border: none; border-radius: 8px;
  color: #64748B; cursor: pointer;
  &:hover { background: #F1F5F9; color: #0F172A; }
  &:focus-visible { outline: 2px solid rgba(15,118,110,0.5); outline-offset: 2px; }
  @media (max-width: 1024px) { display: none; }
`;
// 본문이 패널 가장자리에 붙지 않게 **바깥 컨테이너**가 여백을 준다.
//   iframe 안(srcDoc 의 guard)은 건드리지 않는다 — 거기 margin:0 은 뉴스레터 템플릿 디자인을
//   보존하려고 일부러 넣은 것이라, 안쪽을 고치면 발신자 레이아웃이 깨진다.
const Body = styled.div`
  flex: 1; min-height: 0; overflow: auto; background: #fff;
  padding: 20px 24px;
  @media (max-width: 768px) { padding: 12px; }
`;
// 전체 화면에서는 iframe 이 영역을 꽉 채우고 **자기 안에서** 스크롤한다.
//   바깥 Body 스크롤과 겹치면 두 겹 스크롤이 되어 읽기가 더 나빠진다.
const Frame = styled.iframe` width: 100%; height: 100%; border: none; display: block; background: #fff; `;
const PlainText = styled.pre<{ $zoom: number }>`
  margin: 0; padding: 0;   /* 여백은 Body 가 담당 — 여기에도 주면 이중이 된다 */
  font: inherit; font-size: ${(p) => 0.875 * p.$zoom}rem; line-height: 1.7; color: #0F172A;
  white-space: pre-wrap; word-break: break-word;
`;
