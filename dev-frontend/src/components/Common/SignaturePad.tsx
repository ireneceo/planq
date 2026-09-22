// 서명 캔버스 — 공개 서명 페이지와 앱 안 «보내는 쪽» 서명이 **같은 것**을 쓴다 (2026-09-22).
//
// 왜 빼냈나: 그리기 로직이 PublicSignPage 안에만 있었다. 앱 안 서명을 만들면서 베끼면
//   선 굵기·DPR 보정·«비었는가» 판정이 두 벌이 되고, 한쪽만 고쳐진다
//   (memory feedback_copied_component_drifts_extract_shell).
//
// 계약:
//   · 값은 밖으로 나가지 않는다 — 부모가 `ref.toDataURL()` 로 필요할 때 읽는다.
//   · «비었는가» 는 실제로 획이 그어졌는지로 판정한다(캔버스 픽셀 스캔은 느리고 DPR 에 취약).
//   · 크기 변경(회전·리사이즈)에 다시 잡는다. 다시 잡으면 그림이 지워지므로 그 사실을 부모에게 알린다.
import React, { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import styled from 'styled-components';

export interface SignaturePadHandle {
  /** 그린 것이 없으면 null */
  toDataURL: () => string | null;
  clear: () => void;
  isEmpty: () => boolean;
}

interface Props {
  /** 비었는지 바뀔 때마다 — 부모의 [서명 완료] 버튼 활성화에 쓴다 */
  onEmptyChange?: (empty: boolean) => void;
  height?: number;
  ariaLabel?: string;
}

const SignaturePad = React.forwardRef<SignaturePadHandle, Props>(
  ({ onEmptyChange, height = 160, ariaLabel }, ref) => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
    const drawing = useRef(false);
    const hasInk = useRef(false);
    const [, setEmpty] = useState(true);

    const markEmpty = useCallback((v: boolean) => {
      hasInk.current = !v;
      setEmpty(v);
      onEmptyChange?.(v);
    }, [onEmptyChange]);

    const setup = useCallback(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      // 크기를 다시 잡으면 그림이 지워진다 — 그 사실을 부모에게 알린다(안 알리면
      // «그렸는데 버튼이 켜져 있고 보내면 빈 그림» 이 된다).
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#0F172A';
      ctxRef.current = ctx;
      if (hasInk.current) markEmpty(true);
    }, [markEmpty]);

    useEffect(() => {
      setup();
      const handle = () => setup();
      window.addEventListener('resize', handle);
      return () => window.removeEventListener('resize', handle);
    }, [setup]);

    const getPos = (e: React.MouseEvent | React.TouchEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      if ('touches' in e && e.touches.length > 0) {
        return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
      }
      if ('clientX' in e) return { x: (e as React.MouseEvent).clientX - rect.left, y: (e as React.MouseEvent).clientY - rect.top };
      return { x: 0, y: 0 };
    };

    const start = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      const ctx = ctxRef.current; if (!ctx) return;
      drawing.current = true;
      const p = getPos(e);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
    };
    const move = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
      if (!drawing.current) return;
      e.preventDefault();
      const ctx = ctxRef.current; if (!ctx) return;
      const p = getPos(e);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      if (!hasInk.current) markEmpty(false);
    };
    const end = () => { drawing.current = false; };

    const clear = useCallback(() => {
      const canvas = canvasRef.current;
      const ctx = ctxRef.current;
      if (!canvas || !ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      markEmpty(true);
    }, [markEmpty]);

    useImperativeHandle(ref, () => ({
      toDataURL: () => (hasInk.current && canvasRef.current ? canvasRef.current.toDataURL('image/png') : null),
      clear,
      isEmpty: () => !hasInk.current,
    }), [clear]);

    return (
      <Canvas
        ref={canvasRef}
        $h={height}
        aria-label={ariaLabel}
        onMouseDown={start}
        onMouseMove={move}
        onMouseUp={end}
        onMouseLeave={end}
        onTouchStart={start}
        onTouchMove={move}
        onTouchEnd={end}
      />
    );
  },
);
SignaturePad.displayName = 'SignaturePad';

export default SignaturePad;

const Canvas = styled.canvas<{ $h: number }>`
  width: 100%;
  height: ${p => p.$h}px;
  border: 1px dashed #CBD5E1;
  border-radius: 10px;
  background: #fff;
  touch-action: none;   /* 그리는 중 화면이 따라 스크롤되지 않게 */
  cursor: crosshair;
`;
