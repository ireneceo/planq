import React from 'react';
import { spring, useVideoConfig } from 'remotion';
import type { Caption, Template, Aspect } from '../types';
import { FONT } from '../theme';
import { clamp01, easeOut, splitWords, useT } from './common';

// 자막 — 템플릿 스타일 3종
//   pop    : 쇼츠형. 굵고 큰 글자가 단어마다 튀어나오고 강조 단어는 색 상자
//   lower  : 강의형. 아래쪽 반투명 판 위에 단어가 차례로 떠오르고 강조 단어에 밑줄이 그어진다
//   cinema : 브랜드형. 가운데 크게, 단어가 흐림에서 또렷해지며 자간이 좁혀진다
export const Captions: React.FC<{ caps: Caption[]; tpl: Template; aspect: Aspect; zone?: 'auto' | 'top' | 'center' | 'bottom' | 'low' | 'right' }> = ({ caps, tpl, aspect, zone = 'auto' }) => {
  const t = useT();
  const cur = caps.filter((c) => t >= c.at && t < c.at + c.dur);
  return <>{cur.map((c, i) => <One key={c.at + ':' + i} c={c} tpl={tpl} aspect={aspect} zone={zone} />)}</>;
};

const One: React.FC<{ c: Caption; tpl: Template; aspect: Aspect; zone: string }> = ({ c, tpl, aspect, zone }) => {
  const t = useT();
  const { fps, width, height } = useVideoConfig();
  const lt = t - c.at;
  const words = splitWords(c.text);
  const p = tpl.palette;
  const portrait = aspect === 'portrait';
  const S = tpl.captionScale * (portrait ? width / 1080 : width / 1920);
  // 단어 등장 시각 — 녹음 단어 시각이 있으면 그것, 없으면 고르게
  const times = words.map((_, i) => (c.words && c.words[i] ? c.words[i].t : i * tpl.wordStagger));
  const outU = clamp01((lt - (c.dur - 0.28)) / 0.28);
  const style = tpl.caption;

  const base: React.CSSProperties = { position: 'absolute', left: 0, right: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', fontFamily: FONT, pointerEvents: 'none' };
  const z = zone === 'auto' ? (style === 'cinema' ? 'center' : 'bottom') : zone;
  const pos: React.CSSProperties = z === 'top' ? { top: portrait ? height * 0.1 : height * 0.08 }
    : z === 'low' ? { bottom: height * 0.035 }
    : z === 'right' ? { bottom: height * 0.1, left: width * 0.38 }
    : z === 'center' ? { top: 0, bottom: 0, justifyContent: 'center' }
      : { bottom: portrait ? height * 0.13 : height * 0.075 };

  const lines: { w: string; em: boolean; i: number }[][] = [[]];
  words.forEach((w, i) => { lines[lines.length - 1].push({ ...w, i }); if (w.br) lines.push([]); });

  if (style === 'pop') {
    const fs = (portrait ? 84 : 76) * S;
    return (
      <div style={{ ...base, ...pos, gap: fs * 0.12, opacity: 1 - outU, transform: `translateY(${outU * 20}px)` }}>
        {lines.map((ln, li) => (
          <div key={li} style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: `0 ${fs * 0.26}px`, maxWidth: width * 0.9 }}>
            {ln.map(({ w, em, i }) => {
              const s = spring({ frame: Math.round((lt - times[i]) * fps), fps, config: { damping: 11, stiffness: 190, mass: 0.6 } });
              if (lt < times[i]) return <span key={i} style={{ fontSize: fs, opacity: 0 }}>{w}</span>;
              return (
                <span key={i} style={{
                  display: 'inline-block', fontSize: fs, fontWeight: 900, letterSpacing: '-0.035em', lineHeight: 1.18,
                  color: em ? p.highlightText : '#fff',
                  background: em ? p.highlight : 'transparent', padding: em ? `0 ${fs * 0.14}px` : 0, borderRadius: fs * 0.14,
                  transform: `scale(${0.5 + 0.5 * s}) rotate(${em ? (1 - s) * -6 - 1.2 : 0}deg)`, opacity: Math.min(1, s * 1.6),
                  textShadow: em ? 'none' : `0 ${fs * 0.05}px 0 rgba(0,0,0,.35), 0 0 ${fs * 0.4}px rgba(0,0,0,.35)`,
                  WebkitTextStroke: em ? undefined : `${fs * 0.02}px rgba(0,0,0,.25)`,
                  boxShadow: em ? `0 ${fs * 0.1}px ${fs * 0.3}px rgba(0,0,0,.25)` : undefined,
                }}>{w}</span>
              );
            })}
          </div>
        ))}
        {c.sub && <Sub text={c.sub} lt={lt} delay={times[times.length - 1] + 0.2} tpl={tpl} S={S} />}
      </div>
    );
  }

  if (style === 'cinema') {
    const fs = (portrait ? 88 : 92) * S;
    return (
      <div style={{ ...base, ...pos, gap: fs * 0.18, opacity: 1 - outU, filter: `blur(${outU * 10}px)` }}>
        {lines.map((ln, li) => (
          <div key={li} style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: `0 ${fs * 0.24}px`, maxWidth: width * 0.86 }}>
            {ln.map(({ w, em, i }) => {
              const u = easeOut(clamp01((lt - times[i]) / 0.7));
              return (
                <span key={i} style={{
                  display: 'inline-block', fontSize: fs, fontWeight: em ? 800 : 300, lineHeight: 1.2,
                  letterSpacing: `${(1 - u) * 0.25 - 0.03}em`, color: em ? p.accent : '#fff', opacity: u,
                  filter: `blur(${(1 - u) * 14}px)`, transform: `translateY(${(1 - u) * fs * 0.25}px)`,
                  textShadow: '0 4px 40px rgba(0,0,0,.35)',
                }}>{w}</span>
              );
            })}
          </div>
        ))}
        {c.sub && <Sub text={c.sub} lt={lt} delay={times[times.length - 1] + 0.3} tpl={tpl} S={S} plain />}
      </div>
    );
  }

  // lower
  const fs = (portrait ? 62 : 58) * S;
  const inU = easeOut(clamp01(lt / 0.45));
  return (
    <div style={{ ...base, ...pos, gap: fs * 0.28, opacity: (1 - outU) * inU, transform: `translateY(${(1 - inU) * 24 + outU * 14}px)` }}>
      <div style={{
        background: 'rgba(10,32,30,.86)', padding: `${fs * 0.36}px ${fs * 0.72}px ${fs * 0.42}px`, borderRadius: fs * 0.4,
        boxShadow: `0 ${fs * 0.4}px ${fs * 1.2}px rgba(0,0,0,.3), inset 0 0 0 2px ${p.accent}40`, backdropFilter: 'blur(8px)',
        maxWidth: width * 0.88,
      }}>
        {lines.map((ln, li) => (
          <div key={li} style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: `0 ${fs * 0.24}px` }}>
            {ln.map(({ w, em, i }) => {
              const u = easeOut(clamp01((lt - times[i]) / 0.4));
              return (
                <span key={i} style={{
                  position: 'relative', display: 'inline-block', fontSize: fs, fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.3,
                  color: em ? p.accent : '#fff', opacity: u, transform: `translateY(${(1 - u) * fs * 0.4}px)`, filter: `blur(${(1 - u) * 4}px)`,
                }}>
                  {w}
                </span>
              );
            })}
          </div>
        ))}
      </div>
      {c.sub && <Sub text={c.sub} lt={lt} delay={0.5} tpl={tpl} S={S} />}
    </div>
  );
};

const Sub: React.FC<{ text: string; lt: number; delay: number; tpl: Template; S: number; plain?: boolean }> = ({ text, lt, delay, tpl, S, plain }) => {
  const u = easeOut(clamp01((lt - delay) / 0.5));
  const fs = 28 * S * (plain ? 1.15 : 1);
  return (
    <div style={{
      opacity: u, transform: `translateY(${(1 - u) * 14}px)`, fontFamily: FONT, fontWeight: plain ? 500 : 700, fontSize: fs,
      color: plain ? 'rgba(255,255,255,.85)' : tpl.palette.bg1, background: plain ? 'transparent' : 'rgba(255,255,255,.95)',
      padding: plain ? 0 : `${fs * 0.36}px ${fs * 0.8}px`, borderRadius: 999, letterSpacing: plain ? '0.02em' : '-0.01em',
      boxShadow: plain ? 'none' : '0 10px 30px rgba(0,0,0,.18)',
    }}>{text}</div>
  );
};
