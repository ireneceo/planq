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

  // Esc / ← / → + body scroll lock
  useEffect(() => {
    if (!normalized) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') prev();
      else if (e.key === 'ArrowRight') next();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [normalized, onClose, prev, next]);

  // 모바일 swipe-down 닫기
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchStart.current;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    touchStart.current = null;
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

  if (!normalized) return null;

  const current = normalized[safeIdx];

  const node = (
    <Backdrop
      role="dialog" aria-modal="true"
      aria-label={current.alt || 'image preview'}
      onClick={onClose}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <CloseBtn type="button" onClick={onClose} aria-label="Close">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </CloseBtn>

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
const Img = styled.img`
  max-width: 100%; max-height: 100%;
  object-fit: contain;
  cursor: zoom-out;
  border-radius: 4px;
  box-shadow: 0 10px 40px rgba(0,0,0,0.4);
  animation: pq-lb-img-in 0.18s ease-out;
  @keyframes pq-lb-img-in { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }
`;
const CloseBtn = styled.button`
  position: absolute; top: 16px; right: 16px;
  width: 40px; height: 40px;
  background: rgba(255,255,255,0.12); color: #fff; border: 0; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer;
  transition: background 0.12s;
  z-index: 2;
  &:hover { background: rgba(255,255,255,0.22); }
  @media (max-width: 640px) {
    top: max(16px, env(safe-area-inset-top));
    right: 12px;
    width: 44px; height: 44px;
  }
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
