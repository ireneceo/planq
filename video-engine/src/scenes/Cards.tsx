import React from 'react';
import { AbsoluteFill, Img, OffthreadVideo, Sequence, interpolate, spring, staticFile, useVideoConfig } from 'remotion';

const asset = (src: string) => (/^(https?:|data:)/.test(src) ? src : staticFile(src));
import type { Aspect, ChapterScene, ConvergeScene, FootageScene, PhotoScene, KineticScene, LogoScene, MontageScene, PointsScene, StatScene, Template, TitleScene } from '../types';
import { FONT } from '../theme';
import { Pill, clamp01, easeInOut, easeOut, lerp, splitWords, useT } from '../fx/common';
import { Captions } from '../fx/Captions';

const useS = (aspect: Aspect) => { const { width } = useVideoConfig(); return aspect === 'portrait' ? width / 1080 : width / 1920; };

// 강조 표기(*…*)를 색으로 — 줄 단위 등장
const Rich: React.FC<{ text: string; tpl: Template }> = ({ text, tpl }) => (
  <>{splitWords(text).map((w, i) => <span key={i} style={{ color: w.em ? tpl.palette.accent : undefined }}>{w.w}{' '}</span>)}</>
);

export const TitleView: React.FC<{ sc: TitleScene; tpl: Template; aspect: Aspect }> = ({ sc, tpl, aspect }) => {
  const t = useT(); const s = useS(aspect); const { fps } = useVideoConfig();
  const portrait = aspect === 'portrait';
  const fs = (portrait ? 86 : 104) * s;
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', textAlign: 'center', fontFamily: FONT, color: '#fff', gap: 40 * s, padding: portrait ? 60 * s : 0 }}>
      {sc.kicker && <div style={{ opacity: easeOut(clamp01(t / 0.5)), transform: `translateY(${(1 - easeOut(clamp01(t / 0.5))) * 24}px)` }}><Pill tpl={tpl} size={28 * s}>{sc.kicker}</Pill></div>}
      <div style={{ fontWeight: 900, fontSize: fs, lineHeight: 1.16, letterSpacing: '-0.04em' }}>
        {sc.lines.map((ln, i) => {
          const sp = spring({ frame: Math.round((t - 0.3 - i * 0.32) * fps), fps, config: { damping: 15, stiffness: 120 } });
          return <div key={i} style={{ opacity: sp, transform: `translateY(${(1 - sp) * 50}px)`, filter: `blur(${(1 - sp) * 8}px)` }}><Rich text={ln} tpl={tpl} /></div>;
        })}
      </div>
      {sc.sub && <div style={{ opacity: easeOut(clamp01((t - 0.5 - sc.lines.length * 0.32) / 0.6)), fontWeight: 600, fontSize: 40 * s, color: 'rgba(255,255,255,.82)', whiteSpace: 'pre-line' }}><Rich text={sc.sub} tpl={tpl} /></div>}
      {sc.captions && <Captions caps={sc.captions} tpl={tpl} aspect={aspect} />}
    </AbsoluteFill>
  );
};

export const ChapterView: React.FC<{ sc: ChapterScene; tpl: Template; aspect: Aspect }> = ({ sc, tpl, aspect }) => {
  const t = useT(); const s = useS(aspect); const { width: W, height: H } = useVideoConfig();
  const portrait = aspect === 'portrait';
  const bar = easeInOut(clamp01(t / 0.6));
  const u = (d: number) => easeOut(clamp01((t - d) / 0.55));
  // 숫자 카운트인(00 → 03, 0.3초)
  const n = parseInt(sc.num, 10) || 0;
  const shown = String(Math.round(n * easeOut(clamp01(t / 0.3)))).padStart(sc.num.length, '0');
  const img = sc.image ? (/^(https?:|data:)/.test(sc.image) ? sc.image : staticFile(sc.image)) : null;
  return (
    <AbsoluteFill style={{ fontFamily: FONT, color: '#fff' }}>
      {img && (
        <div style={{ position: 'absolute', ...(portrait ? { left: 0, right: 0, bottom: 0, height: H * 0.45 } : { right: 0, top: 0, bottom: 0, width: W * 0.45 }), overflow: 'hidden',
          maskImage: portrait ? 'linear-gradient(to top, #000 55%, transparent)' : 'linear-gradient(to left, #000 55%, transparent)', WebkitMaskImage: portrait ? 'linear-gradient(to top, #000 55%, transparent)' : 'linear-gradient(to left, #000 55%, transparent)' }}>
          <Img src={img} style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'blur(6px) brightness(0.6) saturate(1.1)', transform: `scale(${1.08 + t * 0.02})` }} />
        </div>
      )}
      <AbsoluteFill style={{ justifyContent: portrait ? 'flex-start' : 'center', paddingTop: portrait ? H * 0.3 : 0, padding: portrait ? `${H * 0.3}px ${80 * s}px 0` : `0 ${200 * s}px` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 28 * s }}>
          <div style={{ fontWeight: 900, fontSize: 150 * s, color: 'transparent', WebkitTextStroke: `${3 * s}px ${tpl.palette.accent}`, lineHeight: 1, opacity: u(0.05), transform: `translateX(${(1 - u(0.05)) * -40}px)`, fontVariantNumeric: 'tabular-nums' }}>{shown}</div>
          <div style={{ width: 8 * s, height: 150 * s * bar, background: tpl.palette.accent, borderRadius: 8 }} />
          <div>
            <div style={{ fontWeight: 900, fontSize: 84 * s, letterSpacing: '-0.035em', lineHeight: 1.12, opacity: u(0.25), transform: `translateX(${(1 - u(0.25)) * 40}px)` }}>{sc.title}</div>
            {sc.sub && <div style={{ marginTop: 14 * s, fontWeight: 600, fontSize: 36 * s, color: 'rgba(255,255,255,.75)', opacity: u(0.5) }}>{sc.sub}</div>}
          </div>
        </div>
        {sc.total && <div style={{ marginTop: 34 * s, fontWeight: 700, fontSize: 26 * s, letterSpacing: '0.12em', color: 'rgba(255,255,255,.55)', opacity: u(0.6), fontVariantNumeric: 'tabular-nums' }}>{sc.num} / {sc.total}</div>}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const StatView: React.FC<{ sc: StatScene; tpl: Template; aspect: Aspect }> = ({ sc, tpl, aspect }) => {
  const t = useT(); const s = useS(aspect);
  const portrait = aspect === 'portrait';
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', fontFamily: FONT, color: '#fff', gap: 60 * s }}>
      {sc.title && <div style={{ fontWeight: 800, fontSize: 56 * s, letterSpacing: '-0.03em', opacity: easeOut(clamp01(t / 0.5)), textAlign: 'center' }}><Rich text={sc.title} tpl={tpl} /></div>}
      <div style={{ display: 'flex', flexDirection: portrait ? 'column' : 'row', gap: (portrait ? 60 : 110) * s }}>
        {sc.items.map((it, i) => {
          const d = 0.3 + i * 0.35;
          const u = easeOut(clamp01((t - d) / 1.2));
          const v = Math.round(it.value * u);
          return (
            <div key={i} style={{ textAlign: 'center', opacity: clamp01((t - d) / 0.3), transform: `translateY(${(1 - easeOut(clamp01((t - d) / 0.5))) * 30}px)` }}>
              <div style={{ fontWeight: 900, fontSize: 150 * s, letterSpacing: '-0.05em', lineHeight: 1, color: tpl.palette.accent, fontVariantNumeric: 'tabular-nums' }}>
                {it.prefix}{v.toLocaleString('ko-KR')}<span style={{ fontSize: 80 * s }}>{it.suffix}</span>
              </div>
              <div style={{ marginTop: 18 * s, fontWeight: 700, fontSize: 36 * s, color: 'rgba(255,255,255,.85)' }}>{it.label}</div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

export const PointsView: React.FC<{ sc: PointsScene; tpl: Template; aspect: Aspect }> = ({ sc, tpl, aspect }) => {
  const t = useT(); const s = useS(aspect); const { fps } = useVideoConfig();
  const portrait = aspect === 'portrait';
  const cardU = spring({ frame: Math.round(t * fps), fps, config: { damping: 16, stiffness: 120 } });
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', fontFamily: FONT }}>
      <div style={{ width: portrait ? 900 * s : 1180 * s, padding: `${64 * s}px ${72 * s}px`, borderRadius: 40 * s, background: 'rgba(255,255,255,.96)', color: '#0B2B29',
        boxShadow: '0 40px 120px rgba(0,0,0,.4)', transform: `translateY(${(1 - cardU) * 80}px) scale(${lerp(0.94, 1, cardU)})`, opacity: cardU }}>
        <div style={{ fontWeight: 900, fontSize: (portrait ? 60 : 64) * s, letterSpacing: '-0.035em', lineHeight: 1.2, marginBottom: 40 * s }}><Rich text={sc.title} tpl={{ ...tpl, palette: { ...tpl.palette, accent: '#0D9488' } }} /></div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 26 * s }}>
          {sc.points.map((p, i) => {
            const d = 0.5 + i * 0.45;
            const u = easeOut(clamp01((t - d) / 0.5));
            const chk = spring({ frame: Math.round((t - d - 0.15) * fps), fps, config: { damping: 10, stiffness: 200 } });
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 22 * s, opacity: u, transform: `translateX(${(1 - u) * 40}px)`, fontWeight: 700, fontSize: (portrait ? 44 : 42) * s }}>
                <span style={{ flex: 'none', width: 56 * s, height: 56 * s, borderRadius: 18 * s, background: '#14B8A6', display: 'grid', placeItems: 'center', transform: `scale(${chk})` }}>
                  <svg width={32 * s} height={32 * s} viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </span>
                <span><Rich text={p} tpl={{ ...tpl, palette: { ...tpl.palette, accent: '#0D9488' } }} /></span>
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const LogoView: React.FC<{ sc: LogoScene; tpl: Template; aspect: Aspect; logoWhite: string; mark: string }> = ({ sc, tpl, aspect, logoWhite }) => {
  const t = useT(); const s = useS(aspect); const { fps } = useVideoConfig();
  const sp = spring({ frame: Math.round((t - 0.1) * fps), fps, config: { damping: 12, stiffness: 110 } });
  const glow = interpolate(t, [0, 0.6, 2], [0, 1, 0.6], { extrapolateRight: 'clamp' });
  const u = (d: number) => easeOut(clamp01((t - d) / 0.6));
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', fontFamily: FONT, color: '#fff', gap: 46 * s }}>
      <div style={{ position: 'absolute', width: 900 * s, height: 900 * s, borderRadius: 999, background: `radial-gradient(circle, ${tpl.palette.accent}55, transparent 62%)`, opacity: glow, transform: `scale(${lerp(0.6, 1.1, sp)})` }} />
      <Img src={asset(logoWhite)} style={{ height: 150 * s, transform: `scale(${lerp(0.7, 1, sp)})`, opacity: Math.min(1, sp * 1.4), filter: `blur(${(1 - Math.min(1, sp)) * 10}px)` }} />
      <div style={{ fontWeight: 900, fontSize: 76 * s, letterSpacing: '-0.035em', opacity: u(0.7), transform: `translateY(${(1 - u(0.7)) * 26}px)` }}><Rich text={sc.slogan} tpl={tpl} /></div>
      {sc.cta && (
        <div style={{ opacity: u(1.25), transform: `translateY(${(1 - u(1.25)) * 26}px)`, display: 'flex', gap: 16 * s, alignItems: 'center', padding: `${22 * s}px ${44 * s}px`, borderRadius: 999,
          background: '#fff', color: tpl.palette.bg1, fontWeight: 800, fontSize: 38 * s, boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}>
          {sc.cta} <span style={{ fontSize: 42 * s }}>→</span>
        </div>
      )}
    </AbsoluteFill>
  );
};

// 몽타주 — 박자마다 제품 화면이 한 장씩 «툭» 들어온다(살짝 기울어진 3D 카드 + 확대 펀치)
export const MontageView: React.FC<{ sc: MontageScene; tpl: Template; aspect: Aspect }> = ({ sc, tpl, aspect }) => {
  const t = useT(); const s = useS(aspect); const { width: W, height: H } = useVideoConfig();
  const portrait = aspect === 'portrait';
  const beats = sc.beats && sc.beats.length ? sc.beats : sc.images.map((_, i) => i * (sc.dur / sc.images.length));
  let idx = 0; for (let i = 0; i < beats.length; i++) if (t >= beats[i]) idx = i;
  const cw = portrait ? W * 0.86 : W * 0.62;
  return (
    <AbsoluteFill style={{ perspective: 2400 * s }}>
      {sc.images.slice(0, idx + 1).map((img, i) => {
        if (i < idx - 2) return null;
        const lt = t - beats[i];
        const u = easeOut(clamp01(lt / 0.45));
        const depth = idx - i; // 0 = 맨 앞
        const ang = (i % 2 ? -1 : 1) * 8;
        const x = (W - cw) / 2 + (i % 3 - 1) * W * 0.05 * (portrait ? 0.5 : 1);
        const y = (portrait ? H * 0.3 : H * 0.17) + depth * -30 * s;
        return (
          <div key={i} style={{ position: 'absolute', left: x, top: y, width: cw, borderRadius: 22 * s, overflow: 'hidden',
            boxShadow: '0 40px 100px rgba(0,0,0,.5), 0 0 0 2px rgba(255,255,255,.12)',
            // 패럴랙스 — 정지 화면을 «촬영한 것처럼» 천천히 흘러가게(Fable A 8번)
            transform: `translateX(${(i % 2 ? -1 : 1) * lt * 14 * s}px) translateY(${-lt * 8 * s}px) translateZ(${-depth * 260}px) rotateY(${ang * (1 - u * 0.6) + (i % 2 ? 1 : -1) * 2.5 * Math.min(1, lt / 2)}deg) rotateX(${4 * (1 - u)}deg) scale(${lerp(1.18, 1, u) * (1.0 + 0.06 * Math.min(1, lt / 2)) * (1 + 0.04 * Math.max(0, 1 - lt * 2))})`,
            opacity: Math.min(u * 1.5, depth > 1 ? 0.5 : 1), filter: depth ? `brightness(${1 - depth * 0.25}) blur(${depth * 2}px)` : 'none' }}>
            <Img src={asset(img)} style={{ width: '100%', display: 'block' }} />
          </div>
        );
      })}
      {sc.title && <div style={{ position: 'absolute', left: 0, right: 0, top: portrait ? H * 0.1 : H * 0.05, textAlign: 'center', fontFamily: FONT, color: '#fff', fontWeight: 900, fontSize: 70 * s, letterSpacing: '-0.035em', opacity: easeOut(clamp01(t / 0.5)) }}><Rich text={sc.title} tpl={tpl} /></div>}
      {sc.captions && <Captions caps={sc.captions} tpl={tpl} aspect={aspect} />}
    </AbsoluteFill>
  );
};

// 키네틱 타이포 — 박자마다 문장이 바뀌며 크게 «쾅»
export const KineticView: React.FC<{ sc: KineticScene; tpl: Template; aspect: Aspect }> = ({ sc, tpl, aspect }) => {
  const t = useT(); const s = useS(aspect); const { fps } = useVideoConfig();
  let idx = -1; for (let i = 0; i < sc.lines.length; i++) if (t >= sc.lines[i].at) idx = i;
  if (idx < 0) return null;
  const ln = sc.lines[idx];
  const lt = t - ln.at;
  const sp = spring({ frame: Math.round(lt * fps), fps, config: { damping: 9, stiffness: 160, mass: 0.7 } });
  const fs = (sc.big ? 150 : 120) * s * (aspect === 'portrait' ? 0.85 : 1);
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', textAlign: 'center', fontFamily: FONT, padding: `0 ${80 * s}px` }}>
      <div style={{ fontWeight: 900, fontSize: fs, lineHeight: 1.08, letterSpacing: '-0.05em', color: '#fff', whiteSpace: 'pre-line',
        transform: `scale(${lerp(1.35, 1, sp)})`, opacity: Math.min(1, sp * 2), filter: `blur(${Math.max(0, 1 - sp) * 12}px)`, textShadow: '0 10px 60px rgba(0,0,0,.35)' }}>
        <Rich text={ln.text} tpl={tpl} />
      </div>
    </AbsoluteFill>
  );
};

// 흩어진 도구 → 하나로: 채팅·메일·시트 칩이 네 귀퉁이에서 흔들리다 at 초에 가운데 PlanQ 마크로 모인다(Fable A 8번 — 얼굴 없는 시각 은유)
const ICONS: Record<string, string> = {
  chat: 'M4 5h16v10H9l-5 4V5z',
  mail: 'M3 6h18v12H3V6zm0 0l9 7 9-7',
  sheet: 'M4 4h16v16H4V4zm0 5h16M4 14h16M10 4v16',
  file: 'M6 3h8l4 4v14H6V3zm8 0v4h4',
  calendar: 'M4 6h16v14H4V6zm0 4h16M8 3v5M16 3v5',
};
export const ConvergeView: React.FC<{ sc: ConvergeScene; tpl: Template; aspect: Aspect; mark: string }> = ({ sc, tpl, aspect, mark }) => {
  const t = useT(); const s = useS(aspect); const { width: W, height: H, fps } = useVideoConfig();
  const portrait = aspect === 'portrait';
  const pos = [[0.2, 0.25], [0.8, 0.22], [0.22, 0.75], [0.78, 0.78], [0.5, 0.15]];
  const g = spring({ frame: Math.round((t - sc.at) * fps), fps, config: { damping: 14, stiffness: 90 } });
  const markU = spring({ frame: Math.round((t - sc.at - 0.35) * fps), fps, config: { damping: 11, stiffness: 120 } });
  const cx = W / 2, cy = H * (portrait ? 0.45 : 0.46);
  return (
    <AbsoluteFill style={{ fontFamily: FONT }}>
      {sc.chips.map((c, i) => {
        const appear = easeOut(clamp01((t - i * 0.35) / 0.5));
        const [px, py] = pos[i % pos.length];
        const wob = Math.sin(t * 2.2 + i * 1.7) * 14 * s * (1 - g);
        const x = lerp(W * px, cx, g) + wob, y = lerp(H * py, cy, g) + Math.cos(t * 1.8 + i) * 10 * s * (1 - g);
        const size = (portrait ? 1.1 : 1) * s;
        return (
          <div key={i} style={{ position: 'absolute', left: x, top: y, transform: `translate(-50%,-50%) scale(${appear * lerp(1, 0.4, g)}) rotate(${(i % 2 ? 1 : -1) * 6 * (1 - g)}deg)`, opacity: appear * (1 - clamp01((g - 0.7) / 0.3)),
            display: 'flex', alignItems: 'center', gap: 16 * size, padding: `${20 * size}px ${30 * size}px`, borderRadius: 26 * size, background: 'rgba(255,255,255,.95)', color: '#0B2B29',
            boxShadow: '0 24px 60px rgba(0,0,0,.35)', fontWeight: 800, fontSize: 40 * size, whiteSpace: 'nowrap' }}>
            <svg width={44 * size} height={44 * size} viewBox="0 0 24 24"><path d={ICONS[c.icon] || ICONS.chat} fill="none" stroke="#0D9488" strokeWidth="2" strokeLinejoin="round" /></svg>
            {c.label}
          </div>
        );
      })}
      <div style={{ position: 'absolute', left: cx, top: cy, width: 520 * s, height: 520 * s, transform: 'translate(-50%,-50%)', borderRadius: 999, background: `radial-gradient(circle, ${tpl.palette.accent}66, transparent 62%)`, opacity: markU }} />
      <Img src={staticFile(mark)} style={{ position: 'absolute', left: cx, top: cy, height: 200 * s, transform: `translate(-50%,-50%) scale(${lerp(0.3, 1, markU)})`, opacity: Math.min(1, markU * 1.5) }} />
      {sc.line && <div style={{ position: 'absolute', left: 0, right: 0, top: cy + 170 * s, textAlign: 'center', color: '#fff', fontWeight: 800, fontSize: 64 * s, letterSpacing: '-0.03em', opacity: easeOut(clamp01((t - sc.at - 0.8) / 0.5)) }}><Rich text={sc.line} tpl={tpl} /></div>}
    </AbsoluteFill>
  );
};

// 사진 — 화면 가득, 피사체 쪽으로 천천히 다가가는 확대·이동(켄 번즈). 위아래 어둡게 깔아 자막이 읽히게.
export const PhotoView: React.FC<{ sc: PhotoScene; tpl: Template; aspect: Aspect }> = ({ sc, tpl, aspect }) => {
  const t = useT(); const s = useS(aspect); const { width: W, height: H } = useVideoConfig();
  const u = Math.min(1, t / Math.max(1, sc.dur));
  const sub = sc.subject || { x: 0.3, y: 0.3, w: 0.4, h: 0.4 };
  const cx = sub.x + sub.w / 2, cy = sub.y + sub.h / 2;
  const z = lerp(1.04, 1.16, easeInOut(u));
  const ox = (0.5 - cx) * (z - 1) * W * 1.6, oy = (0.5 - cy) * (z - 1) * H * 1.6;
  return (
    <AbsoluteFill style={{ overflow: 'hidden', background: '#000' }}>
      <Img src={asset(sc.src)} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', transform: `translate(${ox}px, ${oy}px) scale(${z})`, filter: `saturate(${tpl.grade.saturate}) contrast(${tpl.grade.contrast})` }} />
      <AbsoluteFill style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,.35), transparent 30%, transparent 55%, rgba(0,0,0,.6))' }} />
      {sc.title && <div style={{ position: 'absolute', left: 0, right: 0, top: H * 0.1, textAlign: 'center', fontFamily: FONT, color: '#fff', fontWeight: 900, fontSize: 72 * s, letterSpacing: '-0.035em', opacity: easeOut(clamp01(t / 0.6)), textShadow: '0 6px 30px rgba(0,0,0,.4)' }}><Rich text={sc.title} tpl={tpl} /></div>}
      {sc.captions && <Captions caps={sc.captions} tpl={tpl} aspect={aspect} />}
    </AbsoluteFill>
  );
};

// 영상 소재 — 쓸 수 있는 구간만 음악 박자 길이로 잘라 차례로(빌더가 cuts 를 정한다)
export const FootageView: React.FC<{ sc: FootageScene; tpl: Template; aspect: Aspect }> = ({ sc, tpl, aspect }) => {
  const t = useT(); const s = useS(aspect); const { fps, height: H } = useVideoConfig();
  let at = 0;
  return (
    <AbsoluteFill style={{ overflow: 'hidden', background: '#000' }}>
      {sc.cuts.map((c, i) => {
        const from = Math.round(at * fps); at += c.dur;
        return (
          // 마지막 컷은 장면 끝까지(박자 맞춤으로 장면이 조금 늘어도 검은 화면이 안 나오게)
          <Sequence key={i} from={from} durationInFrames={i === sc.cuts.length - 1 ? Math.max(1, Math.round(sc.dur * fps) - from) : Math.max(1, Math.round(c.dur * fps))} layout="none">
            <AbsoluteFill style={{ transform: `scale(${1.04 + 0.04 * ((t * fps - from) / Math.max(1, c.dur * fps))})` }}>
              <OffthreadVideo src={asset(c.src)} startFrom={Math.round(c.from * fps)} muted style={{ width: '100%', height: '100%', objectFit: 'cover', filter: `saturate(${tpl.grade.saturate}) contrast(${tpl.grade.contrast})` }} />
            </AbsoluteFill>
          </Sequence>
        );
      })}
      <AbsoluteFill style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,.3), transparent 30%, transparent 55%, rgba(0,0,0,.6))' }} />
      {sc.title && <div style={{ position: 'absolute', left: 0, right: 0, top: H * 0.1, textAlign: 'center', fontFamily: FONT, color: '#fff', fontWeight: 900, fontSize: 72 * s, letterSpacing: '-0.035em', opacity: easeOut(clamp01(t / 0.6)) }}><Rich text={sc.title} tpl={tpl} /></div>}
      {sc.captions && <Captions caps={sc.captions} tpl={tpl} aspect={aspect} />}
    </AbsoluteFill>
  );
};
