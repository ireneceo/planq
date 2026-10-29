import React from 'react';
import { AbsoluteFill, Audio, OffthreadVideo, Sequence, interpolate, staticFile, useVideoConfig } from 'remotion';
import type { Aspect, Scene, Storyboard } from './types';
import { loadFonts } from './theme';
import { Background, enterStyle, useT } from './fx/common';
import { ScreenSceneView } from './scenes/ScreenScene';
import { ChapterView, ConvergeView, FootageView, PhotoView, KineticView, LogoView, MontageView, PointsView, StatView, TitleView } from './scenes/Cards';

loadFonts();

// 장면 시작 시각 — 다음 장면은 앞 장면 끝에서 전환 길이만큼 겹쳐 들어온다
export function timeline(sb: Storyboard) {
  let at = 0;
  return sb.scenes.map((sc, i) => {
    const trans = i === 0 ? 0 : (sc.transIn ?? sb.template.transitionSec);
    at = i === 0 ? 0 : at - trans;
    const start = at; at += sc.dur;
    return { sc, start, trans };
  });
}
export function totalSec(sb: Storyboard) { const tl = timeline(sb); const l = tl[tl.length - 1]; return l ? l.start + l.sc.dur : 1; }

const SceneBody: React.FC<{ sc: Scene; sb: Storyboard; aspect: Aspect }> = ({ sc, sb, aspect }) => {
  const tpl = sb.template;
  switch (sc.kind) {
    case 'screen': return <ScreenSceneView sc={sc} tpl={tpl} aspect={aspect} brandMark={sb.brand.mark} />;
    case 'title': return <TitleView sc={sc} tpl={tpl} aspect={aspect} />;
    case 'chapter': return <ChapterView sc={sc} tpl={tpl} aspect={aspect} />;
    case 'stat': return <StatView sc={sc} tpl={tpl} aspect={aspect} />;
    case 'points': return <PointsView sc={sc} tpl={tpl} aspect={aspect} />;
    case 'logo': return <LogoView sc={sc} tpl={tpl} aspect={aspect} logoWhite={sb.brand.logoWhite} mark={sb.brand.mark} />;
    case 'montage': return <MontageView sc={sc} tpl={tpl} aspect={aspect} />;
    case 'kinetic': return <KineticView sc={sc} tpl={tpl} aspect={aspect} />;
    case 'photo': return <PhotoView sc={sc} tpl={tpl} aspect={aspect} />;
    case 'footage': return <FootageView sc={sc} tpl={tpl} aspect={aspect} />;
    case 'converge': return <ConvergeView sc={sc} tpl={tpl} aspect={aspect} mark={sb.brand.mark} />;
    default: return null;
  }
};

// 들어오기 전환 + 나가기: 글자 장면은 다음 장면 전환이 시작되면 글자층을 빨리 지운다(두 글자층이 겹쳐 보이지 않게 — Fable A 4번)
const Enter: React.FC<{ kind: Storyboard['template']['transition']; trans: number; exitAt?: number; textOnly: boolean; children: React.ReactNode }> = ({ kind, trans, exitAt, textOnly, children }) => {
  const t = useT();
  const { width, height } = useVideoConfig();
  const u = trans > 0 ? t / trans : 1;
  const out = textOnly && exitAt != null ? 1 - Math.max(0, Math.min(1, (t - exitAt) / 0.18)) : 1;
  return <AbsoluteFill style={{ ...enterStyle(kind, u, width, height), opacity: (enterStyle(kind, u, width, height).opacity as number ?? 1) * out }}>{children}</AbsoluteFill>;
};

const MIX: Storyboard['template']['transition'][] = ['zoom', 'slide', 'fade', 'wipe'];

export const Video: React.FC<{ sb: Storyboard; aspect: Aspect }> = ({ sb, aspect }) => {
  const { fps, durationInFrames } = useVideoConfig();
  const tl = timeline(sb);
  const tpl = sb.template;
  const total = durationInFrames / fps;
  // 음악 — 들어오고 나가는 페이드 + 목소리 구간에서 낮춤(ducking)
  const musicVol = (f: number) => {
    if (!sb.music) return 0;
    const t = f / fps;
    let v = sb.music.volume * interpolate(t, [0, sb.music.fadeIn, total - sb.music.fadeOut, total], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
    if (sb.voice) {
      const near = sb.voice.spans.some((s) => t >= s.t0 - 0.25 && t <= s.t1 + 0.35);
      if (near) v *= tpl.duck;
    }
    return v;
  };
  return (
    <AbsoluteFill style={{ background: tpl.palette.bg1, wordBreak: 'keep-all' }}>
      <Background tpl={tpl} />
      {tl.map(({ sc, start, trans }, i) => {
        const kind = sc.transKind || (tpl.transition === 'mixed' ? MIX[i % MIX.length] : tpl.transition);
        return (
          <Sequence key={sc.id} from={Math.round(start * fps)} durationInFrames={Math.max(1, Math.round(sc.dur * fps))}>
            <Enter kind={kind} trans={trans} exitAt={sc.exitAt} textOnly={!['screen', 'montage', 'photo', 'footage'].includes(sc.kind)}>
              {sc.kind !== 'screen' && i > 0 && <Background tpl={tpl} strong />}
              <SceneBody sc={sc} sb={sb} aspect={aspect} />
            </Enter>
          </Sequence>
        );
      })}
      {sb.music && <Audio src={sb.music.src.startsWith('http') ? sb.music.src : staticFile(sb.music.src)} startFrom={Math.round(sb.music.startAt * fps)} volume={musicVol} />}
      {sb.voice && <Audio src={sb.voice.src} volume={sb.voice.volume} />}
      {sb.voice && sb.voice.face && <FaceCircle src={sb.voice.face} aspect={aspect} accent={tpl.palette.accent} />}
      {sb.sfx.map((x, i) => (
        <Sequence key={'sfx' + i} from={Math.max(0, Math.round(x.t * fps))} durationInFrames={Math.round(1.5 * fps)}>
          <Audio src={staticFile(`sfx/${x.kind}.wav`)} volume={(x.vol ?? 1) * ((tpl.sfx as Record<string, number>)[x.kind] ?? 0.6)} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

// 얼굴 원 — 녹음과 같은 자르기를 거친 얼굴 영상(소리 없음)을 원 안에. 시각 축이 같아 입 모양이 맞는다.
const FaceCircle: React.FC<{ src: string; aspect: Aspect; accent: string }> = ({ src, aspect, accent }) => {
  const { width: W, height: H, fps } = useVideoConfig();
  const t = useT();
  const portrait = aspect === 'portrait';
  const d = portrait ? W * 0.3 : W * 0.15;
  const u = Math.min(1, t / 0.5);
  const x = portrait ? W - d - W * 0.05 : W - d - W * 0.035;
  const y = portrait ? H * 0.6 : H - d - H * 0.06;
  return (
    <div style={{ position: 'absolute', left: x, top: y, width: d, height: d, borderRadius: 999, overflow: 'hidden', opacity: u, transform: `scale(${0.85 + 0.15 * u})`,
      boxShadow: `0 0 0 ${d * 0.025}px #fff, 0 0 0 ${d * 0.045}px ${accent}, 0 ${d * 0.08}px ${d * 0.3}px rgba(0,0,0,.4)`, background: '#000' }}>
      <OffthreadVideo src={src} muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
    </div>
  );
};
