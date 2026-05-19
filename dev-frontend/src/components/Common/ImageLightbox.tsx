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
import styled from 'styled-components';
import { createPortal } from 'react-dom';

export interface LightboxItem {
  src: string;
  alt?: string;
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
}

const ImageLightbox: React.FC<Props> = ({ items, initialIndex = 0, src, alt, onClose }) => {
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
  const pinchRef = useRef<{ baseDist: number; baseScale: number } | null>(null);

  // 이미지 변경 시 zoom/pan 초기화
  useEffect(() => { setScale(1); setTranslate({ x: 0, y: 0 }); }, [idx, items, src]);

  const clampScale = (s: number) => Math.max(0.5, Math.min(s, 6));
  const zoomIn = useCallback(() => setScale(s => clampScale(s + 0.25)), []);
  const zoomOut = useCallback(() => setScale(s => clampScale(s - 0.25)), []);
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

  // Esc / ← / → / + / - / 0 + body scroll lock
  useEffect(() => {
    if (!normalized) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') prev();
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

  // 모바일 swipe-down 닫기 + 2-finger pinch zoom
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      // pinch 시작
      const [a, b] = [e.touches[0], e.touches[1]];
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      pinchRef.current = { baseDist: dist, baseScale: scale };
      return;
    }
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && pinchRef.current) {
      const [a, b] = [e.touches[0], e.touches[1]];
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const ratio = dist / pinchRef.current.baseDist;
      setScale(clampScale(pinchRef.current.baseScale * ratio));
    }
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (pinchRef.current) {
      pinchRef.current = null;
      return;
    }
    const start = touchStart.current;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    touchStart.current = null;
    // zoom > 1 시 swipe 닫기/이동 차단 (pan 영역)
    if (scale > 1.01) return;
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
    setScale(s => clampScale(s + delta));
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
    setTranslate({ x: dragRef.current.baseX + dx, y: dragRef.current.baseY + dy });
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
      const r = await fetch(current.src, { credentials: 'include' });
      if (!r.ok) throw new Error(`download failed ${r.status}`);
      const blob = await r.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objUrl), 100);
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
        <ToolBtn type="button" onClick={handleDownload} aria-label="Download" title="Download">
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

      <Img
        key={current.src}
        src={current.src}
        alt={current.alt || ''}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={onMouseDown}
        $zoomed={scale > 1.01}
        style={{
          transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
          transition: dragRef.current ? 'none' : 'transform 0.12s ease-out',
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
    top: max(12px, env(safe-area-inset-top));
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
  font-size: 12px; font-weight: 600;
  padding: 0;
  &:hover { background: rgba(255,255,255,0.18); }
  &:focus-visible { outline: 2px solid rgba(255,255,255,0.5); outline-offset: 1px; }
  @media (max-width: 640px) {
    width: 40px; height: 40px;
  }
`;
const PctLabel = styled.span`
  font-variant-numeric: tabular-nums;
  font-size: 11px;
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
    bottom: max(16px, env(safe-area-inset-bottom));
    transform: none;
    ${p => p.$side === 'left' ? 'left: 24px;' : 'right: 24px;'}
    width: 48px; height: 48px;
  }
`;
const IndexBadge = styled.div`
  position: absolute;
  top: 16px; left: 50%; transform: translateX(-50%);
  padding: 6px 12px;
  background: rgba(0,0,0,0.55);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  border-radius: 999px;
  z-index: 2;
  @media (max-width: 640px) {
    top: max(16px, env(safe-area-inset-top));
  }
`;
