// 공유 미리보기(/public/...)를 **앱 안 창**으로 연다 — 별도 창을 못 여는 곳(폰 ≤768 · 앱)에서만.
//
// ★ 2026-11-04 (Irene: *"채팅에 첨부된 업무를 눌렀더니 모바일에서 위 잘리고 닫기도 안나오고 헤더도 없어서 아무것도 못해"*)
//   업무·파일·Q info·일정·청구서 카드는 `openPreviewWindow` 로 새 창을 열었다. 앱 안에서는 그 window.open 을
//   nativeLinks 가 가로채 **앱 화면 자체를 /public/… 로 옮겼고**, 공개 화면에는 앱 머리줄·뒤로가 없어(publicSurface)
//   돌아갈 길이 없었다. 문서 카드처럼 «앱 안 창» 으로 연다 — 껍데기는 PostPreviewModal 과 같은 것(previewDialogShell).
//   본문은 같은 출처 iframe(서버 X-Frame-Options SAMEORIGIN · frame-ancestors 'self' 가 허용).
//   App 루트 한 곳에 둔다(탭 모드·미러 모드 두 트리 공통) — `openPreviewWindow` 가 이벤트로 부른다.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useEscapeStack } from '../../hooks/useEscapeStack';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { useBackToClose } from '../../hooks/useBackToClose';
import { isNativeApp } from '../../services/native';
import { tabStore } from '../../stores/tabStore';
import { SHARE_PREVIEW_EVENT, type SharePreviewDetail } from '../../utils/openPreviewWindow';
import {
  PreviewBackdrop, PreviewDialog, PreviewHeader, PreviewTitle, PreviewHeaderActions, PreviewOpenBtn, PreviewCloseBtn,
} from './previewDialogShell';


/** 같은 출처면 경로만(앱 안 iframe 은 지금 출처로 연다). 다른 출처는 null. */
function sameOriginPath(raw: string): string | null {
  try {
    const u = new URL(raw, window.location.href);
    if (u.origin !== window.location.origin) return null;
    return u.pathname + u.search + u.hash;
  } catch { return null; }
}

const SharePreviewSheet: React.FC = () => {
  const { t } = useTranslation('common');
  const [item, setItem] = useState<{ path: string; title?: string } | null>(null);
  const [docTitle, setDocTitle] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const open = !!item;
  const close = useCallback(() => { setItem(null); setDocTitle(''); }, []);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const d = (e as CustomEvent<SharePreviewDetail>).detail;
      const path = d?.url ? sameOriginPath(d.url) : null;
      if (!path) return;
      setDocTitle('');
      setItem({ path, title: d.title });
    };
    window.addEventListener(SHARE_PREVIEW_EVENT, onOpen);
    return () => window.removeEventListener(SHARE_PREVIEW_EVENT, onOpen);
  }, []);

  useEscapeStack(open, close);
  useFocusTrap(ref, open);
  useBodyScrollLock(open);
  useBackToClose(open, close);
  // 탭 모드(폭 550↑)에서는 useBackToClose 가 비킨다 — 뒤로 가기로 화면이 바뀌면 이 창이 옛 화면 위에 남지 않게 같이 닫는다.
  useEffect(() => {
    if (!open) return;
    window.addEventListener('popstate', close);
    return () => window.removeEventListener('popstate', close);
  }, [open, close]);

  // iframe 안 링크(«PlanQ 에서 보기» 등)가 iframe 안에서 앱 전체를 다시 띄우지 않게 — 우리 화면이면 창을 닫고 앱에서 연다.
  const onFrameLoad = (e: React.SyntheticEvent<HTMLIFrameElement>) => {
    let doc: Document | null = null;
    try { doc = e.currentTarget.contentDocument; } catch { doc = null; }
    if (!doc) return;
    try { if (doc.title) setDocTitle(doc.title); } catch { /* noop */ }
    doc.addEventListener('click', (ev) => {
      const a = (ev.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || a.hasAttribute('download')) return;
      const href = a.getAttribute('href') || '';
      if (/^(mailto:|tel:|sms:|blob:|data:|javascript:|#)/i.test(href)) return;
      const p = sameOriginPath(a.href);
      if (p && p.startsWith('/public/')) return;            // 공개 화면 안 이동은 창 안에서
      if (p && /^\/(api|uploads)\//.test(p)) return;          // 파일 받기 — 브라우저 기본 동작
      ev.preventDefault();
      if (p) { close(); tabStore.openInNewTab(p); return; }
      window.open(a.href, '_blank', 'noopener,noreferrer'); // 바깥 주소 — 앱에서는 nativeLinks 가 인앱 브라우저로
    }, true);
  };

  if (!item) return null;
  const title = item.title || docTitle || (t('sharePreview.label', '미리보기') as string);
  return (
    <PreviewBackdrop onClick={close} data-testid="share-preview-backdrop">
      <SheetDialog ref={ref} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true"
        aria-label={title} data-testid="share-preview-sheet">
        <PreviewHeader>
          <PreviewTitle>{title}</PreviewTitle>
          <PreviewHeaderActions>
            {/* 앱에서는 «새 탭» 이 없다(window.open 이 앱 화면을 옮긴다) — 웹(폰 브라우저)에서만 */}
            {!isNativeApp() && (
              <PreviewOpenBtn type="button" data-testid="share-preview-open-tab"
                onClick={() => { window.open(item.path, '_blank', 'noopener,noreferrer'); close(); }}>
                {t('sharePreview.openTab', '새 탭으로')}
              </PreviewOpenBtn>
            )}
            <PreviewCloseBtn type="button" data-testid="share-preview-close" onClick={close} aria-label={t('close', '닫기') as string}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </PreviewCloseBtn>
          </PreviewHeaderActions>
        </PreviewHeader>
        <Frame key={item.path} src={item.path} title={title} onLoad={onFrameLoad} />
      </SheetDialog>
    </PreviewBackdrop>
  );
};

export default SharePreviewSheet;

// iframe 은 높이를 내용에서 받지 못한다 — 창이 높이를 정한다(데스크탑 창 86vh · 폰 전면 100%).
const SheetDialog = styled(PreviewDialog)`
  max-width: 900px; height: 86vh;
  @media (max-width: 640px) { height: 100%; padding-bottom: env(safe-area-inset-bottom, 0px); }
`;
const Frame = styled.iframe`
  flex: 1; min-height: 0; width: 100%; border: 0; display: block; background: #F8FAFC;
  border-radius: 0 0 14px 14px;
  @media (max-width: 640px) { border-radius: 0; }
`;
