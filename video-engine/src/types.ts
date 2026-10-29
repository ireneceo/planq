// 장면 목록(storyboard) 계약 — 노드 쪽 빌더(build/storyboard.js)가 만들고 Remotion 은 그리기만 한다.
// 시각은 전부 «출력 영상 기준 초»(장면 시작 = 0). 원본 녹화 시각은 빌더가 이미 바꿔 놓는다.

export type Rect = { x: number; y: number; w: number; h: number };
export type Aspect = 'landscape' | 'portrait';

export type CaptionStyle = 'pop' | 'lower' | 'cinema';
export type Caption = {
  text: string;            // *강조* 표기
  at: number; dur: number; // 장면 기준 초
  sub?: string;            // 작은 보조 줄
  words?: { w: string; t: number }[]; // 녹음 기반일 때 단어 시각(장면 기준) — 없으면 고르게 나눈다
};

export type CamKey = { t: number; cx: number; cy: number; vw: number }; // 중심(CSS px)·보이는 폭(CSS px)
export type Move = { t0: number; t1: number; from: { x: number; y: number }; to: { x: number; y: number } };
export type Click = { t: number; x: number; y: number };
export type Spot = { t0: number; t1: number; rect: Rect };
export type Segment = { at: number; src: number; dur: number; rate: number }; // 출력 at 부터 dur 초 동안 원본 src 부터 rate 배속

export type Template = {
  id: string; name: string;
  caption: CaptionStyle;
  captionScale: number;          // 1 = 기본 크기
  wordStagger: number;           // 단어 사이 등장 간격(초)
  transition: 'fade' | 'slide' | 'zoom' | 'wipe' | 'cut' | 'mixed';
  transitionSec: number;
  camera: { maxZoom: number; fill: number; easeSec: number; portraitFill: number };
  spotlight: number;             // 0~1 주변 어둡게
  waitSpeed: number;             // 기다림 구간 배속
  grade: { saturate: number; contrast: number; brightness: number };
  background: 'aurora' | 'mesh' | 'solid';
  palette: { bg1: string; bg2: string; accent: string; text: string; highlight: string; highlightText: string };
  musicVolume: number; duck: number;
  sfx: { click: number; whoosh: number; pop: number };
  chapterCards: boolean;
  speedBadge: boolean;
  beatSync: 'none' | 'beat' | 'downbeat';
  pace: number;                  // 1 = 기본, 클수록 빠르게(유지 시간 짧게)
  cursorSize?: number;           // CSS px 기준 커서 높이(기본 44)
  source?: { kind: 'house' | 'reference'; refs?: string[]; notes?: string };
};

type Base = { id: string; dur: number; transIn?: number; transKind?: Template['transition']; captions?: Caption[]; chapter?: string; exitAt?: number };
export type ScreenScene = Base & {
  kind: 'screen'; device: 'desktop' | 'mobile';
  src: string; viewport: { width: number; height: number; dpr: number };
  segments: Segment[];
  cam: { landscape: CamKey[]; portrait: CamKey[] };
  moves: Move[]; clicks: Click[]; spots: Spot[]; waits: { t0: number; t1: number; rate: number }[];
  side?: { kicker?: string; title: string; points?: string[] }; // 휴대폰 장면을 가로에서 보일 때 옆 글
};
export type TitleScene = Base & { kind: 'title'; kicker?: string; lines: string[]; sub?: string };
export type ChapterScene = Base & { kind: 'chapter'; num: string; title: string; sub?: string; image?: string; total?: string };
export type StatScene = Base & { kind: 'stat'; items: { value: number; prefix?: string; suffix?: string; label: string }[]; title?: string };
export type PointsScene = Base & { kind: 'points'; title: string; points: string[] };
export type LogoScene = Base & { kind: 'logo'; slogan: string; cta?: string; url?: string };
export type MontageScene = Base & { kind: 'montage'; images: string[]; title?: string; beats?: number[] };
export type KineticScene = Base & { kind: 'kinetic'; lines: { text: string; at: number }[]; big?: boolean };
export type ConvergeScene = Base & { kind: 'converge'; chips: { label: string; icon: 'chat' | 'mail' | 'sheet' | 'file' | 'calendar' }[]; at: number; line?: string };
export type Scene = ConvergeScene | ScreenScene | TitleScene | ChapterScene | StatScene | PointsScene | LogoScene | MontageScene | KineticScene;

export type Storyboard = {
  id: string; title: string; mode: 'recording' | 'instruction' | 'brand';
  template: Template;
  fps: number;
  scenes: Scene[];
  music?: { src: string; volume: number; startAt: number; fadeIn: number; fadeOut: number };
  sfx: { t: number; kind: 'click' | 'whoosh' | 'pop' | 'ding' | 'boom'; vol?: number }[];
  voice?: { src: string; volume: number; spans: { t0: number; t1: number }[] };
  brand: { logoWhite: string; logoColor: string; mark: string; url: string };
  aspect?: Aspect;
};
