import React from 'react';
import { AbsoluteFill, OffthreadVideo, Sequence, useVideoConfig } from 'remotion';
import type { Aspect, CamKey, ScreenScene as S, Template } from '../types';
import { FONT } from '../theme';
import { clamp01, easeInOut, easeOut, lerp, splitWords, useT } from '../fx/common';
import { Captions } from '../fx/Captions';

// 화면 녹화 장면 — 창/휴대폰 테두리 + 카메라(확대·이동) + 커서·클릭 + 스포트라이트 + 빨리 감기 표시.
// 원본은 장치 픽셀(2~3배)이라 확대해도 선명하다. transform scale 대신 실제 픽셀 크기로 배치해 흐려지지 않게 한다.

const TITLE_H = 40; // 창 제목줄(CSS px) — 화면과 같이 확대된다

// 카메라 — 키마다 «그때 실제 위치» 에서 새 목표로 easeSec 동안 옮겨 간다(앞 이동이 덜 끝났어도 튀지 않는다)
type Cam = { cx: number; cy: number; vw: number };
function blend(a: Cam, b: Cam, u: number): Cam {
  return { cx: lerp(a.cx, b.cx, u), cy: lerp(a.cy, b.cy, u), vw: Math.exp(lerp(Math.log(a.vw), Math.log(b.vw), u)) };
}
function camAt(keys: CamKey[], t: number, easeSec: number): Cam | null {
  if (!keys.length) return null;
  let state: Cam = { cx: keys[0].cx, cy: keys[0].cy, vw: keys[0].vw };
  for (let i = 1; i < keys.length; i++) {
    const k = keys[i];
    if (t < k.t) break;
    const next = i + 1 < keys.length ? Math.min(t, keys[i + 1].t) : t;
    state = blend(state, k, easeInOut(clamp01((next - k.t) / easeSec)));
  }
  return state;
}

function cursorAt(sc: S, t: number) {
  const mv = sc.moves;
  if (!mv.length) return null;
  let last = mv[0].from;
  for (const m of mv) {
    if (t < m.t0) break;
    if (t <= m.t1) {
      const u = easeInOut(clamp01((t - m.t0) / Math.max(0.01, m.t1 - m.t0)));
      // 살짝 휘는 경로(사람 손처럼)
      const dx = m.to.x - m.from.x, dy = m.to.y - m.from.y;
      const arc = Math.sin(u * Math.PI) * Math.min(60, Math.hypot(dx, dy) * 0.08);
      const nx = -dy / (Math.hypot(dx, dy) || 1), ny = dx / (Math.hypot(dx, dy) || 1);
      return { x: m.from.x + dx * u + nx * arc, y: m.from.y + dy * u + ny * arc, moving: true };
    }
    last = m.to;
  }
  return { x: last.x, y: last.y, moving: false };
}

export const ScreenSceneView: React.FC<{ sc: S; tpl: Template; aspect: Aspect; brandMark: string }> = ({ sc, tpl, aspect }) => {
  const t = useT();
  const { width: W, height: H, fps } = useVideoConfig();
  const vp = sc.viewport;
  const mobile = sc.device === 'mobile';
  const portrait = aspect === 'portrait';

  // ── 기본 배치: 창(또는 휴대폰)이 놓일 «틀» ──
  let frame: { x: number; y: number; w: number; h: number };
  if (mobile) {
    const ph = portrait ? (sc.side ? H * 0.62 : H * 0.72) : H * 0.86;
    const pw = ph * (vp.width / vp.height);
    frame = portrait ? { x: (W - pw) / 2, y: sc.side ? H * 0.175 : H * 0.07, w: pw, h: ph } : { x: W * 0.14, y: (H - ph) / 2, w: pw, h: ph };
  } else if (portrait) {
    frame = { x: W * 0.04, y: H * 0.2, w: W * 0.92, h: H * 0.52 };
  } else {
    const fw = W * 0.86; const fh = fw * ((vp.height + TITLE_H) / vp.width);
    frame = { x: (W - fw) / 2, y: (H - fh) / 2 - H * 0.01, w: fw, h: fh };
  }

  // ── 카메라 ──
  const keys = portrait ? sc.cam.portrait : sc.cam.landscape;
  const cam = camAt(keys, t, tpl.camera.easeSec) || { cx: vp.width / 2, cy: vp.height / 2, vw: vp.width };
  const breathe = 1 + 0.012 * Math.sin(t * 0.6); // 정지 화면에서도 아주 살짝 숨쉬기
  let k: number, ox: number, oy: number, chrome = TITLE_H;
  if (mobile) {
    k = frame.w / vp.width; chrome = 0;
    // 휴대폰은 통째로 확대(옆으로 기울이지 않고, 초점 쪽으로 다가간다)
    const z = vp.width / cam.vw;
    const kk = k * z * breathe;
    const fx = frame.x + frame.w / 2, fy = frame.y + frame.h / 2;
    ox = fx - cam.cx * kk; oy = fy - cam.cy * kk;
    if (z <= 1.001) { ox = frame.x + (frame.w - vp.width * kk) / 2; oy = frame.y + (frame.h - vp.height * kk) / 2; }
    k = kk;
  } else if (portrait) {
    k = (frame.w / cam.vw) * breathe;
    let cx = cam.cx, cy = cam.cy;
    const visW = frame.w / k, visH = frame.h / k;
    cx = visW >= vp.width ? vp.width / 2 : Math.min(Math.max(cx, visW / 2), vp.width - visW / 2);
    cy = visH >= vp.height ? vp.height / 2 : Math.min(Math.max(cy, visH / 2), vp.height - visH / 2);
    ox = frame.x + frame.w / 2 - cx * k; oy = frame.y + frame.h / 2 - cy * k;
  } else {
    const k0 = frame.w / vp.width;
    k = (frame.w / cam.vw) * breathe;
    const devW = vp.width * k, devH = (vp.height + TITLE_H) * k;
    const z = k / k0;
    if (z <= 1.02) { ox = (W - devW) / 2; oy = frame.y + (frame.h - (vp.height + TITLE_H) * k0) / 2 - (devH - frame.h) / 2; }
    else {
      // 확대 중엔 화면이 출력 틀을 꽉 채우도록 가장자리를 잡는다
      let px = W / 2 - cam.cx * k, py = H / 2 - (cam.cy + TITLE_H) * k;
      const blend = clamp01((z - 1.02) / 0.25);
      px = Math.min(Math.max(px, W - devW - W * 0.02 * (1 - blend)), W * 0.02 * (1 - blend));
      py = Math.min(Math.max(py, H - devH), 0);
      const cx0 = (W - devW) / 2, cy0 = (H - devH) / 2;
      ox = lerp(cx0, px, blend); oy = lerp(cy0, py, blend);
    }
  }
  const sx = (x: number) => ox + x * k;
  const sy = (y: number) => oy + (y + chrome) * k;

  // ── 영상(구간별 배속) ──
  const video = sc.segments.map((g, i) => (
    <Sequence key={i} from={Math.round(g.at * fps)} durationInFrames={Math.max(1, Math.round(g.dur * fps))} layout="none">
      <OffthreadVideo src={sc.src} startFrom={Math.round(g.src * fps)} playbackRate={g.rate} muted
        style={{ position: 'absolute', left: 0, top: chrome * k, width: vp.width * k, height: vp.height * k, filter: `saturate(${tpl.grade.saturate}) contrast(${tpl.grade.contrast}) brightness(${tpl.grade.brightness})` }} />
    </Sequence>
  ));

  // ── 스포트라이트 ──
  const spot = sc.spots.find((s) => t >= s.t0 && t <= s.t1);
  const spotU = spot ? Math.min(easeOut(clamp01((t - spot.t0) / 0.45)), easeOut(clamp01((spot.t1 - t) / 0.35))) : 0;

  // ── 커서·클릭 ──
  const c = cursorAt(sc, t);
  const press = sc.clicks.find((cl) => t >= cl.t - 0.1 && t <= cl.t + 0.6);
  const curScale = Math.pow(k / (frame.w / vp.width), 0.45) * (W / 1920) * (portrait ? 1.6 : 1.25) * ((tpl.cursorSize || 44) / 30);
  const pressS = press ? 1 - 0.18 * Math.sin(clamp01((t - press.t + 0.1) / 0.25) * Math.PI) : 1;

  const wait = sc.waits.find((w) => t >= w.t0 && t <= w.t1);
  const radius = mobile ? 54 * k : 14 * k;

  const clipCard = portrait && !mobile;
  const devLeft = sx(0), devTop = oy, devW = vp.width * k, devH = (vp.height + chrome) * k;

  const inner = (
    <>
      {/* 그림자 + 테두리 */}
      <div style={{ position: 'absolute', left: devLeft, top: devTop, width: devW, height: devH, borderRadius: radius,
        boxShadow: `0 ${30 * (W / 1920)}px ${90 * (W / 1920)}px rgba(0,0,0,.45), 0 0 0 ${Math.max(1, 1.2 * k)}px rgba(255,255,255,.14)`, background: '#fff', overflow: 'hidden' }}>
        {!mobile && (
          <div style={{ position: 'absolute', left: 0, top: 0, right: 0, height: TITLE_H * k, background: 'linear-gradient(#F4F6F6,#ECEFEF)', borderBottom: `${Math.max(1, k * 0.8)}px solid #DDE3E2`, display: 'flex', alignItems: 'center', gap: 8 * k, paddingLeft: 16 * k }}>
            {['#FF5F57', '#FEBC2E', '#28C840'].map((col) => <span key={col} style={{ width: 12 * k, height: 12 * k, borderRadius: 99, background: col }} />)}
            <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', top: 8 * k, height: 24 * k, width: 420 * k, borderRadius: 8 * k, background: '#fff', boxShadow: `inset 0 0 0 ${k}px #E2E8E7`, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 * k, fontFamily: FONT, fontSize: 12.5 * k, color: '#4B5B59', fontWeight: 600 }}>
              <svg width={11 * k} height={11 * k} viewBox="0 0 24 24"><path fill="#7C8B89" d="M12 1a5 5 0 0 0-5 5v4H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2h-1V6a5 5 0 0 0-5-5Zm-3 9V6a3 3 0 1 1 6 0v4H9Z" /></svg>
              planq.kr
            </div>
          </div>
        )}
        {video}
      </div>
      {mobile && <PhoneShell x={devLeft} y={devTop} w={devW} h={devH} k={k} />}
      {/* 스포트라이트 */}
      {spot && spotU > 0 && (() => {
        // 주변은 어둡게 + 살짝 흐리게(4면 판) — «탁해짐» 이 아니라 «어두워짐» 으로 보이게(Fable A 5번)
        const L = sx(spot.rect.x), T = sy(spot.rect.y), R = L + spot.rect.w * k, B = T + spot.rect.h * k;
        const dim = `rgba(4,20,19,${0.65 * tpl.spotlight * spotU})`;
        const blur = `blur(${(tpl.caption === 'lower' ? 2 : 3) * spotU}px)`;
        const panel = (st: React.CSSProperties, key: string) => <div key={key} style={{ position: 'absolute', background: dim, backdropFilter: blur, WebkitBackdropFilter: blur, ...st }} />;
        return (
          <>
            {/* 판은 기기 화면 안에서만(옆 글·배경은 그대로) */}
            {(() => { const X0 = Math.max(0, devLeft), Y0 = Math.max(0, devTop + chrome * k), X1 = Math.min(W, devLeft + devW), Y1 = Math.min(H, devTop + devH); return (<>
              {panel({ left: X0, top: Y0, width: X1 - X0, height: Math.max(0, Math.min(T, Y1) - Y0) }, 't')}
              {panel({ left: X0, top: Math.max(B, Y0), width: X1 - X0, height: Math.max(0, Y1 - Math.max(B, Y0)) }, 'b')}
              {panel({ left: X0, top: Math.max(T, Y0), width: Math.max(0, Math.min(L, X1) - X0), height: Math.max(0, Math.min(B, Y1) - Math.max(T, Y0)) }, 'l')}
              {panel({ left: Math.max(R, X0), top: Math.max(T, Y0), width: Math.max(0, X1 - Math.max(R, X0)), height: Math.max(0, Math.min(B, Y1) - Math.max(T, Y0)) }, 'r')}
            </>); })()}
            <div style={{ position: 'absolute', left: L, top: T, width: R - L, height: B - T, borderRadius: 10 * k,
              boxShadow: `0 0 0 ${3 * k}px ${tpl.palette.accent}${Math.round(spotU * 240).toString(16).padStart(2, '0')}, 0 0 ${30 * k}px ${tpl.palette.accent}${Math.round(spotU * 120).toString(16).padStart(2, '0')}` }} />
          </>
        );
      })()}
      {/* 클릭 물결 */}
      {sc.clicks.filter((cl) => t >= cl.t && t <= cl.t + 0.7).map((cl, i) => {
        const u = clamp01((t - cl.t) / 0.7);
        const r = lerp(8, 33, easeOut(u)) * curScale; // 지름 약 96px(44px 커서 기준)
        return <div key={i} style={{ position: 'absolute', left: sx(cl.x) - r, top: sy(cl.y) - r, width: r * 2, height: r * 2, borderRadius: 999,
          border: `${4 * curScale}px solid ${tpl.palette.accent}`, background: `${tpl.palette.accent}33`, opacity: 1 - u }} />;
      })}
      {/* 커서(데스크탑) / 손가락 점(휴대폰) */}
      {c && !mobile && (
        <svg style={{ position: 'absolute', left: sx(c.x) - 4 * curScale, top: sy(c.y) - 2 * curScale, width: 30 * curScale, height: 36 * curScale, transform: `scale(${pressS})`, transformOrigin: '4px 2px', filter: 'drop-shadow(0 6px 10px rgba(0,0,0,.35))' }} viewBox="0 0 30 36">
          <path d="M3 2 L3 28 L10 21.5 L14.6 32.5 L19.2 30.6 L14.6 19.8 L24 19.8 Z" fill="#111" stroke="#fff" strokeWidth="2.4" strokeLinejoin="round" />
        </svg>
      )}
      {mobile && press && (
        <div style={{ position: 'absolute', left: sx(press.x) - 34 * curScale, top: sy(press.y) - 34 * curScale, width: 68 * curScale, height: 68 * curScale, borderRadius: 99,
          background: 'rgba(255,255,255,.55)', boxShadow: '0 4px 18px rgba(0,0,0,.3)', opacity: 1 - clamp01((t - press.t) / 0.6) }} />
      )}
    </>
  );

  return (
    <AbsoluteFill>
      {clipCard ? (
        <div style={{ position: 'absolute', left: frame.x, top: frame.y, width: frame.w, height: frame.h, borderRadius: 28 * (W / 1080), overflow: 'hidden',
          boxShadow: '0 30px 80px rgba(0,0,0,.45), 0 0 0 2px rgba(255,255,255,.12)', background: '#fff' }}>
          <div style={{ position: 'absolute', left: -frame.x, top: -frame.y, width: W, height: H }}>{inner}</div>
        </div>
      ) : inner}
      {wait && tpl.speedBadge && <SpeedBadge rate={wait.rate} tpl={tpl} u={Math.min(clamp01((t - wait.t0) / 0.2), clamp01((wait.t1 - t) / 0.2))} />}
      {mobile && !portrait && sc.side && <SideText side={sc.side} tpl={tpl} x={frame.x + frame.w + W * 0.08} />}
      {portrait && sc.side && <TopTitle side={sc.side} tpl={tpl} top={mobile ? H * 0.035 : H * 0.065} />}
      {sc.captions && <Captions caps={sc.captions} tpl={tpl} aspect={aspect} zone={mobile ? (portrait ? 'low' : 'right') : 'auto'} />}
    </AbsoluteFill>
  );
};

const PhoneShell: React.FC<{ x: number; y: number; w: number; h: number; k: number }> = ({ x, y, w, h, k }) => {
  const b = 11 * k; // 테두리 두께
  return (
    <>
      <div style={{ position: 'absolute', left: x - b, top: y - b, width: w + b * 2, height: h + b * 2, borderRadius: 64 * k, border: `${b}px solid #0E1414`,
        boxShadow: `0 0 0 ${1.5 * k}px #3A4544, 0 40px 100px rgba(0,0,0,.5)`, pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', left: x + w / 2 - 62 * k, top: y + 10 * k, width: 124 * k, height: 36 * k, borderRadius: 99, background: '#0B0F0F' }} />
    </>
  );
};

const SpeedBadge: React.FC<{ rate: number; tpl: Template; u: number }> = ({ rate, tpl, u }) => {
  const { width: W } = useVideoConfig();
  const s = W / 1920;
  return (
    <div style={{ position: 'absolute', right: 48 * s, top: 44 * s, opacity: u, transform: `translateY(${(1 - u) * -10}px)`, display: 'flex', alignItems: 'center', gap: 10 * s,
      padding: `${10 * s}px ${20 * s}px`, borderRadius: 999, background: 'rgba(10,32,30,.85)', color: '#fff', fontFamily: FONT, fontWeight: 800, fontSize: 26 * s, boxShadow: `inset 0 0 0 2px ${tpl.palette.accent}66` }}>
      <svg width={26 * s} height={26 * s} viewBox="0 0 24 24"><path fill={tpl.palette.accent} d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z" /></svg>
      {rate.toFixed(1).replace(/\.0$/, '')}×
    </div>
  );
};

const SideText: React.FC<{ side: NonNullable<S['side']>; tpl: Template; x: number }> = ({ side, tpl, x }) => {
  const t = useT();
  const { width: W, height: H } = useVideoConfig();
  const s = W / 1920;
  const u = (d: number) => easeOut(clamp01((t - d) / 0.6));
  return (
    <div style={{ position: 'absolute', left: x, top: H * 0.26, width: W - x - W * 0.07, fontFamily: FONT, color: '#fff' }}>
      {side.kicker && <div style={{ opacity: u(0.2), transform: `translateY(${(1 - u(0.2)) * 20}px)`, color: tpl.palette.accent, fontWeight: 800, fontSize: 30 * s, letterSpacing: '0.02em', marginBottom: 18 * s }}>{side.kicker}</div>}
      <div style={{ opacity: u(0.4), transform: `translateY(${(1 - u(0.4)) * 26}px)`, fontWeight: 900, fontSize: 72 * s, lineHeight: 1.18, letterSpacing: '-0.035em', whiteSpace: 'pre-line' }}><Em text={side.title} color={tpl.palette.accent} /></div>
      <div style={{ marginTop: 40 * s, display: 'flex', flexDirection: 'column', gap: 22 * s }}>
        {(side.points || []).map((p, i) => (
          <div key={i} style={{ opacity: u(1 + i * 0.35), transform: `translateX(${(1 - u(1 + i * 0.35)) * 30}px)`, display: 'flex', gap: 16 * s, alignItems: 'center', fontSize: 34 * s, fontWeight: 600, color: 'rgba(255,255,255,.9)' }}>
            <span style={{ width: 40 * s, height: 40 * s, borderRadius: 12 * s, background: `${tpl.palette.accent}33`, display: 'grid', placeItems: 'center', color: tpl.palette.accent, fontWeight: 900, fontSize: 24 * s }}>✓</span><span><Em text={p} color={tpl.palette.accent} /></span>
          </div>
        ))}
      </div>
    </div>
  );
};

// 세로(쇼츠) 화면 위쪽 큰 제목 — 이 장면이 무엇인지
const TopTitle: React.FC<{ side: NonNullable<S['side']>; tpl: Template; top: number }> = ({ side, tpl, top }) => {
  const t = useT();
  const { width: W } = useVideoConfig();
  const s = W / 1080;
  const u = (d: number) => easeOut(clamp01((t - d) / 0.55));
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, top, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 * s, fontFamily: FONT, textAlign: 'center' }}>
      {side.kicker && <div style={{ opacity: u(0.1), color: tpl.palette.accent, fontWeight: 800, fontSize: 34 * s }}>{side.kicker}</div>}
      <div style={{ opacity: u(0.25), transform: `translateY(${(1 - u(0.25)) * 20}px)`, color: '#fff', fontWeight: 900, fontSize: 66 * s, lineHeight: 1.15, letterSpacing: '-0.035em', whiteSpace: 'pre-line', textShadow: '0 6px 30px rgba(0,0,0,.3)' }}><Em text={side.title} color={tpl.palette.accent} /></div>
    </div>
  );
};

// *강조* 표기 — 줄바꿈 유지
const Em: React.FC<{ text: string; color: string }> = ({ text, color }) => (
  <>{text.split('\n').map((ln, i) => (
    <React.Fragment key={i}>{i > 0 && <br />}{splitWords(ln).map((w, j) => <span key={j} style={{ color: w.em ? color : undefined }}>{w.w}{' '}</span>)}</React.Fragment>
  ))}</>
);
