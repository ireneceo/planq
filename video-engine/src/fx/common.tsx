import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig, Easing } from 'remotion';
import type { Template } from '../types';
import { FONT } from '../theme';

export const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
export const easeInOut = Easing.bezier(0.65, 0, 0.35, 1);
export const easeOut = Easing.bezier(0.16, 1, 0.3, 1);
export const lerp = (a: number, b: number, u: number) => a + (b - a) * u;

export function useT() {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  return f / fps;
}

// 배경 — 브랜드 색 오로라(천천히 흐르는 큰 빛 3개) + 옅은 격자 + 결(노이즈)
export const Background: React.FC<{ tpl: Template; strong?: boolean }> = ({ tpl, strong }) => {
  const t = useT();
  const { width, height } = useVideoConfig();
  const p = tpl.palette;
  if (tpl.background === 'solid') return <AbsoluteFill style={{ background: p.bg1 }} />;
  const m = Math.max(width, height);
  const blob = (cx: number, cy: number, r: number, c: string, sp: number, ph: number) => {
    const x = cx + Math.sin(t * sp + ph) * m * 0.08, y = cy + Math.cos(t * sp * 0.8 + ph) * m * 0.06;
    return `radial-gradient(${r}px ${r}px at ${x}px ${y}px, ${c}, transparent 70%)`;
  };
  return (
    <AbsoluteFill style={{
      background: [
        blob(width * 0.15, height * 0.1, m * 0.75, `${p.accent}${strong ? '66' : '40'}`, 0.35, 0),
        blob(width * 0.9, height * 0.95, m * 0.8, `${p.bg2}cc`, 0.27, 2),
        blob(width * 0.75, height * 0.15, m * 0.5, `${p.accent}22`, 0.45, 4),
        `linear-gradient(155deg, ${p.bg2} 0%, ${p.bg1} 70%)`,
      ].join(','),
    }}>
      {tpl.background === 'aurora' && (
        <AbsoluteFill style={{
          backgroundImage: `linear-gradient(${p.accent}10 1px, transparent 1px), linear-gradient(90deg, ${p.accent}10 1px, transparent 1px)`,
          backgroundSize: `${Math.round(m / 30)}px ${Math.round(m / 30)}px`,
          backgroundPosition: `${(t * 6) % (m / 30)}px ${(t * 4) % (m / 30)}px`,
          maskImage: 'radial-gradient(ellipse 70% 60% at 50% 45%, #000 20%, transparent 80%)',
          WebkitMaskImage: 'radial-gradient(ellipse 70% 60% at 50% 45%, #000 20%, transparent 80%)',
        }} />
      )}
      <AbsoluteFill style={{ opacity: 0.06, mixBlendMode: 'overlay', backgroundImage: 'url("data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22200%22 height=%22200%22><filter id=%22n%22><feTurbulence type=%22fractalNoise%22 baseFrequency=%220.9%22 numOctaves=%222%22/></filter><rect width=%22200%22 height=%22200%22 filter=%22url(%23n)%22/></svg>")' }} />
    </AbsoluteFill>
  );
};

// «*강조*» 표기를 단어 단위로 쪼갠다 — 강조 단어는 em:true
export function splitWords(text: string) {
  const out: { w: string; em: boolean; br: boolean }[] = [];
  let em = false;
  for (const line of text.split('\n')) {
    const parts = line.split(/(\*)/);
    for (const part of parts) {
      if (part === '*') { em = !em; continue; }
      for (const w of part.split(/\s+/).filter(Boolean)) out.push({ w, em, br: false });
    }
    if (out.length) out[out.length - 1].br = true;
  }
  if (out.length) out[out.length - 1].br = false;
  return out;
}

export const Pill: React.FC<{ children: React.ReactNode; tpl: Template; size: number; style?: React.CSSProperties }> = ({ children, tpl, size, style }) => (
  <div style={{
    display: 'inline-flex', alignItems: 'center', gap: size * 0.45, padding: `${size * 0.45}px ${size * 0.95}px`, borderRadius: 999,
    background: 'rgba(255,255,255,.1)', boxShadow: `inset 0 0 0 ${Math.max(1, size * 0.06)}px ${tpl.palette.accent}66`,
    color: tpl.palette.text, fontFamily: FONT, fontWeight: 700, fontSize: size, letterSpacing: '-0.01em', ...style,
  }}>
    <span style={{ width: size * 0.38, height: size * 0.38, borderRadius: 99, background: tpl.palette.accent, boxShadow: `0 0 0 ${size * 0.2}px ${tpl.palette.accent}44` }} />
    {children}
  </div>
);

// 장면 들어오기 전환 — 들어오는 장면에 건다(나가는 장면은 밑에서 계속 재생된다)
export function enterStyle(kind: Template['transition'], u: number, w: number, h: number): React.CSSProperties {
  if (u >= 1) return {};
  const e = easeInOut(clamp01(u));
  switch (kind) {
    case 'slide': return { transform: `translateX(${(1 - e) * w}px)`, boxShadow: '-40px 0 80px rgba(0,0,0,.35)' };
    case 'zoom': return { opacity: e, transform: `scale(${lerp(1.25, 1, e)})`, filter: `blur(${(1 - e) * 18}px)` };
    case 'wipe': return { clipPath: `inset(0 ${(1 - e) * 100}% 0 0 round 0)` };
    case 'cut': return {};
    default: return { opacity: e };
  }
}

export const Fade: React.FC<{ at: number; dur: number; inS?: number; outS?: number; children: React.ReactNode; style?: React.CSSProperties }> = ({ at, dur, inS = 0.35, outS = 0.3, children, style }) => {
  const t = useT();
  const o = interpolate(t, [at, at + inS, at + dur - outS, at + dur], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  if (t < at || t > at + dur) return null;
  return <div style={{ opacity: o, ...style }}>{children}</div>;
};
