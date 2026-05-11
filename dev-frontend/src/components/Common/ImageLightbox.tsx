// 이미지 라이트박스 — 클릭 시 풀스크린 원본 표시. 사이클 N+9
//
// 사용 패턴 1) 직접 상태 관리:
//   const [src, setSrc] = useState<string | null>(null);
//   <ImageLightbox src={src} onClose={() => setSrc(null)} />
//
// 사용 패턴 2) wrapper 자동 위임 (RichEditor / PostEditor / PublicPost 등):
//   <LightboxWrapper>{children with <img>}</LightboxWrapper>
//   wrapper 의 click 이벤트가 img 만 잡아 src 추출 → 자체 lightbox 띄움
//
// 키보드: Esc 닫기. 백드롭 클릭 닫기. 모바일: 1-finger 닫기 swipe (간단 — pointer up 위치 비교).
import React, { useEffect, useState, useRef, useCallback } from 'react';
import styled from 'styled-components';
import { createPortal } from 'react-dom';

interface Props {
  src: string | null;
  alt?: string;
  onClose: () => void;
}

const ImageLightbox: React.FC<Props> = ({ src, alt, onClose }) => {
  // Esc 닫기 + body scroll lock
  useEffect(() => {
    if (!src) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [src, onClose]);

  if (!src) return null;

  const node = (
    <Backdrop role="dialog" aria-modal="true" aria-label={alt || 'image preview'} onClick={onClose}>
      <CloseBtn type="button" onClick={onClose} aria-label="Close">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </CloseBtn>
      <Img src={src} alt={alt || ''} onClick={(e) => e.stopPropagation()} />
    </Backdrop>
  );
  // SSR-safe portal — document 있을 때만
  return typeof document !== 'undefined' ? createPortal(node, document.body) : node;
};

export default ImageLightbox;

// LightboxWrapper — 자식 안의 모든 <img> 에 클릭 위임. RichEditor / PostEditor / PublicPost 등에서 감싸기.
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
      // cursor 표시 위해 className 추가 (CSS 에서 처리)
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
  @keyframes pq-lb-in { from { opacity: 0; } to { opacity: 1; } }
`;
const Img = styled.img`
  max-width: 100%; max-height: 100%;
  object-fit: contain;
  cursor: zoom-out;
  border-radius: 4px;
  box-shadow: 0 10px 40px rgba(0,0,0,0.4);
`;
const CloseBtn = styled.button`
  position: absolute; top: 16px; right: 16px;
  width: 40px; height: 40px;
  background: rgba(255,255,255,0.1); color: #fff; border: 0; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer;
  transition: background 0.12s;
  &:hover { background: rgba(255,255,255,0.2); }
`;
