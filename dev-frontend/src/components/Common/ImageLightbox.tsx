// 이미지 라이트박스 — 클릭 시 풀스크린 원본 표시.
//
// 3가지 사용 패턴:
//
// 1) 갤러리 모드 (다중 이미지 + ← → 이동) — useImageLightbox hook 권장:
//   const { open, lightbox } = useImageLightbox();
//   <img onClick={() => open(items, 2)} />  // items=[{src,alt},...]
//   {lightbox}
//
// 2) 단일 모드 (legacy):
//   const [src, setSrc] = useState<string | null>(null);
//   <ImageLightbox src={src} onClose={() => setSrc(null)} />
//
// 3) LightboxWrapper — 자식 안의 모든 <img> 자동 위임 (RichEditor / PostEditor 본문):
//   <LightboxWrapper>{children with <img>}</LightboxWrapper>
//
// 키보드: Esc 닫기. ← / → 갤러리 이동 (다중 이미지일 때).
// 백드롭 클릭 / 닫기 버튼 / 모바일 1-finger swipe-down 으로 닫기.
import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { downloadBlob } from '../../utils/download';
import styled from 'styled-components';
import { createPortal } from 'react-dom';
import { useEscapeStack } from '../../hooks/useEscapeStack';

export interface LightboxItem {
  /** 화면에 **먼저** 띄우는 것 — 리사이즈본(빠름). 없으면 원본이 곧 이것이다. */
  src: string;
  alt?: string;
  /** 원본. 주면 "원본 보기" 버튼이 생기고, 확대하면 자동으로 여기로 올라간다.
   *  ★ 원본을 처음부터 띄우면 사진 한 장에 수 MB 를 받는다 — Irene: "이미지 지금 여는데 한참걸려.
   *    미리보기/원본보기 해서 원본용량으로 문제안생기게 어려워?" */
  fullSrc?: string;
}

interface Props {
  // 갤러리 모드
  items?: LightboxItem[] | null;
  initialIndex?: number;
  // 단일 모드 (legacy)
  src?: string | null;
  alt?: string;
  // 공통
  onClose: () => void;
  /** 내려받기 버튼을 대신 처리한다 — 보이는 그림이 원본이 아닌 곳(고객 링크 미리보기)은 «받기» 규칙이 따로다.
   *  주면 보이는 그림을 받지 않고 이 함수를 부른다(GUEST_PROJECT_VIEW_DECISIONS §I-3). */
  onDownload?: () => void;
}

const ImageLightbox: React.FC<Props> = ({ items, initialIndex = 0, src, alt, onClose, onDownload }) => {
  const { t } = useTranslation('common');
  // items 또는 src 정규화 — 둘 중 하나만 active
  const normalized: LightboxItem[] | null = useMemo(() => {
    if (items && items.length > 0) return items;
    if (src) return [{ src, alt }];
    return null;
  }, [items, src, alt]);

  const [idx, setIdx] = useState(initialIndex);

  // N+30 — zoom + pan 상태 (이미지 변경 / open 마다 reset)
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null);

  // 이미지 변경 시 zoom/pan 초기화
  useEffect(() => { setScale(1); setTranslate({ x: 0, y: 0 }); }, [idx, items, src]);
  // 원본으로 올라갔는지 — 항목을 넘기면 다시 리사이즈본부터 시작한다.
  const [showFull, setShowFull] = useState(false);
  useEffect(() => { setShowFull(false); }, [idx, items, src]);
  const [fullReady, setFullReady] = useState<string | null>(null);
  const wantFull = showFull || scale > 1.01;
  const curFull = normalized?.[Math.max(0, Math.min(idx, (normalized?.length || 1) - 1))]?.fullSrc;
  useEffect(() => {
    if (!wantFull || !curFull || fullReady === curFull) return;
    let alive = true;
    const pre = new Image();
    pre.onload = () => { if (alive) setFullReady(curFull); };
    pre.src = curFull;
    return () => { alive = false; };
  }, [wantFull, curFull, fullReady]);

  const clampScale = (s: number) => Math.max(0.5, Math.min(s, 6));
  const zoomIn = useCallback(() => setScale(s => clampScale(s + 0.25)), []);
  const zoomOut = useCallback(() => {
    setScale(s => {
      const n = clampScale(s - 0.25);
      if (n <= 1.01) setTranslate({ x: 0, y: 0 });
      return n;
    });
  }, []);
  const zoomReset = useCallback(() => { setScale(1); setTranslate({ x: 0, y: 0 }); }, []);

  // initialIndex 변경되면 따라가기 (open 재호출 시)
  useEffect(() => { setIdx(initialIndex); }, [initialIndex]);

  // 인덱스 안전 범위
  const safeIdx = normalized && normalized.length > 0
    ? Math.max(0, Math.min(idx, normalized.length - 1))
    : 0;

  const hasGallery = !!normalized && normalized.length > 1;
  const prev = useCallback(() => {
    if (!normalized || normalized.length <= 1) return;
    setIdx(i => (i - 1 + normalized.length) % normalized.length);
  }, [normalized]);
  const next = useCallback(() => {
    if (!normalized || normalized.length <= 1) return;
    setIdx(i => (i + 1) % normalized.length);
  }, [normalized]);

  // ★ Esc 는 **공용 Esc 스택**으로 받는다 (2026-10-02, Irene: *"이미지 전체로 보다가 닫으면 팝업이든
  //   우측패널이든 없어져. 안돼. 열려있던 거 그대로 있어야지."*).
  //   여태 document keydown 으로 직접 받아, 같은 Esc 를 아래 드로어(useEscapeStack)도 받아서
  //   라이트박스와 그 밑 패널이 **함께** 닫혔다. 스택이면 맨 위(= 라이트박스)만 닫힌다.
  useEscapeStack(!!normalized, onClose);

  // ← / → / + / - / 0 + body scroll lock
  useEffect(() => {
    if (!normalized) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') prev();
      else if (e.key === 'ArrowRight') next();
      else if (e.key === '+' || e.key === '=') zoomIn();
      else if (e.key === '-' || e.key === '_') zoomOut();
      else if (e.key === '0') zoomReset();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [normalized, onClose, prev, next, zoomIn, zoomOut, zoomReset]);

  // ── 손가락 동작 (2026-10-30, Irene: "모바일에서 이미지 확대하면 잘 안되고 좌우위아래 이동도 안돼") ──
  //   ① 두 손가락 = 손가락 사이 지점을 붙잡은 채 확대(가운데 기준이면 보려던 곳이 화면 밖으로 밀린다)
  //   ② 확대된 상태 한 손가락 = 끌어서 이동(여태 마우스만 이동이 있었다)
  //   ③ 두 번 탭 = 그 자리 2.5배 ↔ 원래대로
  //   ④ 확대 안 된 상태 = 종전대로 아래로 쓸어 닫기 · 좌우로 쓸어 앞뒤 이미지
  //   이동은 그림 끝이 화면 안쪽으로 들어오지 않게 묶는다 — 묶지 않으면 그림을 잃는다.
  const imgRef = useRef<HTMLImageElement>(null);
  const [gesturing, setGesturing] = useState(false);
  const viewRef = useRef({ scale: 1, x: 0, y: 0 });
  type Gesture =
    | { mode: 'pinch'; dist: number; scale: number; tx: number; ty: number; mx: number; my: number; cx: number; cy: number }
    | { mode: 'pan'; sx: number; sy: number; tx: number; ty: number; moved: boolean }
    | { mode: 'swipe'; sx: number; sy: number };
  const gestureRef = useRef<Gesture | null>(null);
  // 손가락 동작 밖(버튼·휠·마우스)에서 바뀐 값을 따라간다. 동작 중에는 setView 가 정본이다.
  if (!gestureRef.current) viewRef.current = { scale, x: translate.x, y: translate.y };
  const lastTapRef = useRef<{ t: number; x: number; y: number } | null>(null);

  /** 확대하지 않은 그림의 크기와 가운데(변환 전 자리). 변환과 무관한 레이아웃 값으로 잰다 —
   *  화면에 아직 안 그려진 마지막 손가락 값과 어긋나지 않게(손을 뗄 때 끝 정리가 옛 값으로 계산됐다). */
  const baseBox = () => {
    const el = imgRef.current;
    if (!el) return null;
    const parent = el.offsetParent as HTMLElement | null;
    const pr = parent ? parent.getBoundingClientRect() : { left: 0, top: 0 };
    const w = el.offsetWidth, h = el.offsetHeight;
    return { w, h, cx: pr.left + el.offsetLeft + w / 2, cy: pr.top + el.offsetTop + h / 2 };
  };
  /** 손가락 동작 중에는 그리기 전에 다음 이벤트가 온다 — 값을 ref 에도 바로 적는다. */
  const setView = (s: number, x: number, y: number) => {
    viewRef.current = { scale: s, x, y };
    setScale(s);
    setTranslate({ x, y });
  };
  /** 그림이 화면보다 크면 그 넘친 만큼만 움직일 수 있다. 작으면 가운데에 둔다. */
  const clampPan = useCallback((s: number, x: number, y: number) => {
    const b = baseBox();
    if (!b || s <= 1.01) return { x: 0, y: 0 };
    const vw = window.innerWidth, vh = window.innerHeight;
    const limX = Math.max(0, (b.w * s - vw) / 2);
    const limY = Math.max(0, (b.h * s - vh) / 2);
    // 가운데가 화면 가운데와 다를 수 있다(여백) — 그 차이만큼 범위를 옮긴다.
    const offX = vw / 2 - b.cx, offY = vh / 2 - b.cy;
    const clamp = (v: number, off: number, lim: number) => lim === 0 ? 0 : Math.max(off - lim, Math.min(v, off + lim));
    return { x: clamp(x, offX, limX), y: clamp(y, offY, limY) };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /** (px,py) 화면 지점을 붙잡은 채 배율을 s 로. */
  const zoomAt = useCallback((s: number, px: number, py: number) => {
    const b = baseBox();
    const cur = viewRef.current;
    const next = clampScale(s);
    if (!b || next <= 1.01) { setView(next, 0, 0); return; }
    const qx = (px - b.cx - cur.x) / cur.scale;
    const qy = (py - b.cy - cur.y) / cur.scale;
    const p = clampPan(next, px - b.cx - next * qx, py - b.cy - next * qy);
    setView(next, p.x, p.y);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clampPan]);

  const onTouchStart = (e: React.TouchEvent) => {
    // 도구 버튼·이동 버튼 위 손가락은 동작으로 받지 않는다(두 번 누르면 확대가 같이 걸린다).
    if ((e.target as HTMLElement).closest('button')) { gestureRef.current = null; return; }
    const cur = viewRef.current;
    if (e.touches.length >= 2) {
      const [a, b] = [e.touches[0], e.touches[1]];
      const box = baseBox();
      gestureRef.current = {
        mode: 'pinch',
        dist: Math.max(1, Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)),
        scale: cur.scale, tx: cur.x, ty: cur.y,
        mx: (a.clientX + b.clientX) / 2, my: (a.clientY + b.clientY) / 2,
        cx: box?.cx ?? window.innerWidth / 2, cy: box?.cy ?? window.innerHeight / 2,
      };
      lastTapRef.current = null;
      setGesturing(true);
      return;
    }
    const t = e.touches[0];
    if (cur.scale > 1.01) {
      gestureRef.current = { mode: 'pan', sx: t.clientX, sy: t.clientY, tx: cur.x, ty: cur.y, moved: false };
      setGesturing(true);
    } else {
      gestureRef.current = { mode: 'swipe', sx: t.clientX, sy: t.clientY };
    }
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const g = gestureRef.current;
    if (!g) return;
    if (g.mode === 'pinch' && e.touches.length >= 2) {
      const [a, b] = [e.touches[0], e.touches[1]];
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const mx = (a.clientX + b.clientX) / 2, my = (a.clientY + b.clientY) / 2;
      // 손가락 사이 아래의 그림 지점(시작 때)이 지금 손가락 사이에 오도록. 손가락을 함께 옮기면 이동도 된다.
      const s = Math.max(0.5, Math.min(g.scale * (dist / g.dist), 6));
      const qx = (g.mx - g.cx - g.tx) / g.scale;
      const qy = (g.my - g.cy - g.ty) / g.scale;
      setView(s, mx - g.cx - s * qx, my - g.cy - s * qy);
      return;
    }
    if (g.mode === 'pan' && e.touches.length === 1) {
      const t = e.touches[0];
      const dx = t.clientX - g.sx, dy = t.clientY - g.sy;
      if (Math.abs(dx) + Math.abs(dy) > 4) g.moved = true;
      const p = clampPan(viewRef.current.scale, g.tx + dx, g.ty + dy);
      setView(viewRef.current.scale, p.x, p.y);
    }
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const g = gestureRef.current;
    if (!g) return;
    if (g.mode === 'pinch') {
      // 한 손가락이 남으면 그 손가락으로 이어서 이동한다.
      if (e.touches.length === 1 && viewRef.current.scale > 1.01) {
        const t = e.touches[0];
        gestureRef.current = { mode: 'pan', sx: t.clientX, sy: t.clientY, tx: viewRef.current.x, ty: viewRef.current.y, moved: true };
        return;
      }
      if (e.touches.length > 0) return;
      gestureRef.current = null;
      setGesturing(false);
      const { scale: s, x, y } = viewRef.current;
      if (s <= 1.01) setView(1, 0, 0);
      else { const p = clampPan(s, x, y); setView(s, p.x, p.y); }
      return;
    }
    if (e.touches.length > 0) return;
    gestureRef.current = null;
    setGesturing(false);
    const t = e.changedTouches[0];
    const sx = g.sx, sy = g.sy;
    const dx = t.clientX - sx, dy = t.clientY - sy;
    const isTap = Math.abs(dx) < 10 && Math.abs(dy) < 10;
    // 두 손가락에서 넘어온 이동(moved)은 탭으로 세지 않는다 — 다음 탭과 묶여 엉뚱한 두 번 탭이 된다.
    if (isTap && !(g.mode === 'pan' && g.moved) && (e.target as HTMLElement).tagName === 'IMG') {
      const now = Date.now();
      const last = lastTapRef.current;
      if (last && now - last.t < 300 && Math.hypot(t.clientX - last.x, t.clientY - last.y) < 30) {
        lastTapRef.current = null;
        if (viewRef.current.scale > 1.01) setView(1, 0, 0);
        else zoomAt(2.5, t.clientX, t.clientY);
        return;
      }
      lastTapRef.current = { t: now, x: t.clientX, y: t.clientY };
    }
    if (g.mode === 'pan') {
      // 두 손가락 중 하나가 먼저 떨어지면 여기로 넘어온다 — 그때 확대 끝의 위치를 아직 안 묶었다.
      const { scale: s, x, y } = viewRef.current;
      if (s <= 1.01) setView(1, 0, 0);
      else { const p = clampPan(s, x, y); setView(s, p.x, p.y); }
      return;
    }
    // 세로 80px 이상 swipe-down 이고 가로 이동보다 크면 닫기
    if (dy > 80 && Math.abs(dy) > Math.abs(dx)) {
      onClose();
      return;
    }
    // 가로 50px 이상 swipe 면 prev/next (갤러리)
    if (hasGallery && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
      if (dx > 0) prev(); else next();
    }
  };

  // 마우스 wheel zoom
  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const delta = e.deltaY > 0 ? -0.15 : 0.15;
    zoomAt(viewRef.current.scale + delta, e.clientX, e.clientY);
  };

  // 마우스 drag pan (zoom > 1 일 때만)
  const onMouseDown = (e: React.MouseEvent) => {
    if (scale <= 1.01) return;
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { startX: e.clientX, startY: e.clientY, baseX: translate.x, baseY: translate.y };
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setTranslate(clampPan(scale, dragRef.current.baseX + dx, dragRef.current.baseY + dy));
  };
  const onMouseUp = () => { dragRef.current = null; };

  // 다운로드 — fetch + blob (cross-origin · auth 토큰 자동 적용 안 됨, 같은 도메인 가정)
  const handleDownload = useCallback(async () => {
    const current = normalized?.[safeIdx];
    if (!current) return;
    try {
      // filename 추출: alt > URL 의 마지막 segment > 'image'
      const urlPath = new URL(current.src, window.location.origin).pathname;
      const lastSeg = urlPath.split('/').filter(Boolean).pop() || '';
      const filename = current.alt || (lastSeg && lastSeg.includes('.') ? lastSeg : `${lastSeg || 'image'}.png`);
      if (/^(blob|data):/i.test(current.src)) {
        // 이미 메모리에 있는 이미지 — 받을 것이 없다(진행 표시 불필요)
        const r = await fetch(current.src);
        await downloadBlob(await r.blob(), filename);
        return;
      }
      // 받는 일은 다운로드 매니저 한 곳 — 우측 하단 트레이에 %·MB·[취소] 가 보인다(이미지 보기 위에 뜬다).
      //   실패는 아래 새 탭 폴백이 처리하므로 트레이에는 남기지 않는다(quietError).
      const { startDownload } = await import('../../services/downloadManager');
      await startDownload({ url: current.src, filename, auth: false, quietError: true });
    } catch {
      // 실패 fallback — direct anchor (브라우저가 view 처리할 수 있음)
      const a = document.createElement('a');
      a.href = current!.src;
      a.download = current!.alt || 'image';
      a.target = '_blank';
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normalized, safeIdx]);

  if (!normalized) return null;

  const current = normalized[safeIdx];
  // 확대하면 원본으로 자동 승격 — 확대는 "자세히 보고 싶다" 는 뜻이라 리사이즈본으로는 뭉갠다.
  //   원본은 다 받은 뒤에 바꿔 끼운다(fullReady) — 받는 중에 바꾸면 손가락 아래 그림이 사라져 확대가 끊긴다.
  const shownSrc = fullReady && fullReady === current.fullSrc ? current.fullSrc : current.src;

  const node = (
    <Backdrop
      role="dialog" aria-modal="true"
      aria-label={current.alt || 'image preview'}
      onClick={(e) => { if (!dragRef.current && (e.target === e.currentTarget)) onClose(); }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onWheel={onWheel}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
    >
      {/* N+30 — 통합 Toolbar: zoom out / 백분율(reset) / zoom in / download / close */}
      <Toolbar onClick={(e) => e.stopPropagation()}>
        <ToolBtn type="button" onClick={zoomOut} aria-label="Zoom out" title="Zoom out (-)">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="7"/><line x1="8" y1="11" x2="14" y2="11"/>
          </svg>
        </ToolBtn>
        <ToolBtn type="button" onClick={zoomReset} aria-label="Reset zoom" title="Reset (0)">
          <PctLabel>{Math.round(scale * 100)}%</PctLabel>
        </ToolBtn>
        <ToolBtn type="button" onClick={zoomIn} aria-label="Zoom in" title="Zoom in (+)">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="7"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>
          </svg>
        </ToolBtn>
        <ToolBtn type="button" onClick={onDownload || handleDownload} aria-label="Download" title="Download" data-testid="lightbox-download">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
        </ToolBtn>
        <ToolBtn type="button" onClick={onClose} aria-label="Close" title="Close (Esc)">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </ToolBtn>
      </Toolbar>

      {hasGallery && (
        <>
          <NavBtn $side="left" type="button" onClick={(e) => { e.stopPropagation(); prev(); }} aria-label="Previous">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </NavBtn>
          <NavBtn $side="right" type="button" onClick={(e) => { e.stopPropagation(); next(); }} aria-label="Next">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </NavBtn>
          <IndexBadge>{safeIdx + 1} / {normalized.length}</IndexBadge>
        </>
      )}

      {current.fullSrc && current.fullSrc !== current.src && (
        <FullBtn type="button" data-testid="lightbox-full"
          onClick={(e) => { e.stopPropagation(); setShowFull(true); }}
          disabled={showFull || scale > 1.01}>
          {showFull || scale > 1.01
            ? (t('lightbox.original', { defaultValue: '원본' }) as string)
            : (t('lightbox.viewOriginal', { defaultValue: '원본 보기' }) as string)}
        </FullBtn>
      )}

      <Img
        ref={imgRef}
        key={safeIdx}
        src={shownSrc}
        data-testid="lightbox-image"
        alt={current.alt || ''}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={onMouseDown}
        $zoomed={scale > 1.01}
        style={{
          transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
          transition: (gesturing || dragRef.current) ? 'none' : 'transform 0.12s ease-out',
        }}
      />
    </Backdrop>
  );
  return typeof document !== 'undefined' ? createPortal(node, document.body) : node;
};

export default ImageLightbox;

// ─── useImageLightbox hook ────────────────────────────────────────────────
// 가장 권장되는 사용 패턴. 사이트별 useState 보일러플레이트 제거.
//
// const { open, lightbox } = useImageLightbox();
// onClick={() => open(allImagesInGroup, clickedIndex)}
// return (<>{...}{lightbox}</>);
export function useImageLightbox() {
  const [state, setState] = useState<{ items: LightboxItem[]; index: number } | null>(null);

  const open = useCallback((items: LightboxItem[], index = 0) => {
    if (!items || items.length === 0) return;
    setState({ items, index });
  }, []);
  const close = useCallback(() => setState(null), []);

  const lightbox = state
    ? <ImageLightbox items={state.items} initialIndex={state.index} onClose={close} />
    : null;

  return { open, close, lightbox };
}

// ─── LightboxWrapper — Tiptap 본문 등 자식 img 자동 위임 ───────────────────
interface WrapperProps { children: React.ReactNode; className?: string; }

export const LightboxWrapper: React.FC<WrapperProps> = ({ children, className }) => {
  const [src, setSrc] = useState<string | null>(null);
  const [alt, setAlt] = useState<string>('');
  const rootRef = useRef<HTMLDivElement>(null);

  const handler = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target && target.tagName === 'IMG') {
      const img = target as HTMLImageElement;
      // editable 영역 (Tiptap 편집 중) 에선 lightbox 안 띄움 — ProseMirror 의 selection 우선
      const editable = img.closest('.ProseMirror[contenteditable="true"]');
      if (editable) return;
      e.preventDefault();
      e.stopPropagation();
      setSrc(img.src);
      setAlt(img.alt || '');
    }
  }, []);

  return (
    <>
      <Wrap ref={rootRef} onClick={handler} className={className}>{children}</Wrap>
      <ImageLightbox src={src} alt={alt} onClose={() => setSrc(null)} />
    </>
  );
};

const Wrap = styled.div`
  /* 자식 img 에 클릭 시그널 — 편집 모드 아닌 곳만 */
  & .ProseMirror:not([contenteditable="true"]) img,
  & img:not(.ProseMirror img) {
    cursor: zoom-in;
  }
`;

const Backdrop = styled.div`
  position: fixed; inset: 0; z-index: 99999;
  background: rgba(0, 0, 0, 0.92);
  display: flex; align-items: center; justify-content: center;
  padding: 24px;
  animation: pq-lb-in 0.15s ease-out;
  touch-action: none;
  @keyframes pq-lb-in { from { opacity: 0; } to { opacity: 1; } }
`;
const Img = styled.img<{ $zoomed?: boolean }>`
  max-width: 100%; max-height: 100%;
  object-fit: contain;
  cursor: ${p => p.$zoomed ? 'grab' : 'zoom-in'};
  &:active { cursor: ${p => p.$zoomed ? 'grabbing' : 'zoom-in'}; }
  border-radius: 4px;
  box-shadow: 0 10px 40px rgba(0,0,0,0.4);
  transform-origin: center center;
  user-select: none;
  -webkit-user-drag: none;
`;

// N+30 — 통합 Toolbar (zoom + download + close 한 group)
const Toolbar = styled.div`
  position: absolute;
  top: 16px;
  right: 16px;
  display: flex;
  gap: 6px;
  background: rgba(0,0,0,0.35);
  border-radius: 999px;
  padding: 4px;
  z-index: 2;
  backdrop-filter: blur(8px);
  @media (max-width: 640px) {
    top: max(12px, var(--pq-safe-top, 0px));
    right: 12px;
    gap: 4px;
  }
`;
const ToolBtn = styled.button`
  width: 36px; height: 36px;
  background: transparent; color: #fff; border: 0; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer;
  transition: background 0.12s;
  font-size: 0.75rem; font-weight: 600;
  padding: 0;
  &:hover { background: rgba(255,255,255,0.18); }
  &:focus-visible { outline: 2px solid rgba(255,255,255,0.5); outline-offset: 1px; }
  @media (max-width: 640px) {
    width: 40px; height: 40px;
  }
`;
const PctLabel = styled.span`
  font-variant-numeric: tabular-nums;
  font-size: 0.6875rem;
  letter-spacing: -0.2px;
  min-width: 30px;
  text-align: center;
`;
const NavBtn = styled.button<{ $side: 'left' | 'right' }>`
  position: absolute;
  top: 50%; transform: translateY(-50%);
  ${p => p.$side === 'left' ? 'left: 16px;' : 'right: 16px;'}
  width: 44px; height: 44px;
  background: rgba(255,255,255,0.12); color: #fff; border: 0; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer;
  transition: background 0.12s;
  z-index: 2;
  &:hover { background: rgba(255,255,255,0.22); }
  @media (max-width: 640px) {
    /* 폰에서는 아래쪽 가운데 좌우 배치 — 한 손 엄지 닿기 좋게 */
    top: auto;
    bottom: max(16px, var(--pq-safe-bottom, 0px));
    transform: none;
    ${p => p.$side === 'left' ? 'left: 24px;' : 'right: 24px;'}
    width: 48px; height: 48px;
  }
`;
/* 원본 보기 — 닫기·이동 버튼과 겹치지 않게 좌하단. 안전영역을 침범하지 않는다. */
const FullBtn = styled.button`
  position:fixed;left:16px;bottom:calc(16px + env(safe-area-inset-bottom,0px));z-index:2;
  padding:7px 12px;border:1px solid rgba(255,255,255,0.35);border-radius:999px;
  background:rgba(15,23,42,0.62);color:#fff;font-size:0.75rem;font-weight:600;cursor:pointer;
  backdrop-filter:blur(4px);
  &:hover:not(:disabled){background:rgba(15,23,42,0.82);}
  &:disabled{opacity:0.55;cursor:default;}
  @media (hover: none), (max-width: 640px) { min-height: 40px; padding: 0 14px; }
`;
const IndexBadge = styled.div`
  position: absolute;
  top: 16px; left: 50%; transform: translateX(-50%);
  padding: 6px 12px;
  background: rgba(0,0,0,0.55);
  color: #fff;
  font-size: 0.8125rem;
  font-weight: 600;
  border-radius: 999px;
  z-index: 2;
  @media (max-width: 640px) {
    top: max(16px, var(--pq-safe-top, 0px));
  }
`;
