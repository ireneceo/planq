// 알림 소리 — NotificationToaster 에서 나눔(동작 그대로). 첫 사용자 동작에 AudioContext 를 열고, mp3 → 실패 시 합성 차임.
// mp3 음원 우선, 실패 시 Web Audio 합성 fallback. 음원은 public/sounds/notification.mp3 (없으면 합성 사용).
const PING_MP3 = '/sounds/notification.mp3';

// 짧은 ping 사운드 — Web Audio API. 외부 mp3 파일 의존성 X.
//
// Chrome autoplay 정책: AudioContext 는 사용자 gesture 안에서 만들어야 작동. socket 이벤트는
// gesture 가 아님 → 이벤트 시점에 ctx 새로 만들면 suspended 채로 영구히 무음.
//
// 해결:
//   1) 페이지 첫 user-gesture (click/keydown/touchstart) 시점에 단일 AudioContext 생성 + resume.
//   2) 이후 ping 은 그 ctx 를 재사용 — Chrome 한도(동시 6개) 초과 위험 제거 + suspended race 제거.
//   3) Safari/iOS 도 같은 정책. webkit prefix 폴백 유지.
type WindowWithWebkit = Window & { webkitAudioContext?: typeof AudioContext };
let unlockedCtx: AudioContext | null = null;
let unlockTried = false;
export function ensureUnlock() {
  if (unlockTried) return;
  unlockTried = true;
  const tryUnlock = () => {
    try {
      const Ctx = window.AudioContext || (window as WindowWithWebkit).webkitAudioContext;
      if (!Ctx) return;
      if (!unlockedCtx) unlockedCtx = new Ctx();
      // 이 ensureUnlock 자체가 user gesture handler 안에서 호출됨 → resume 가 정상 처리됨
      if (unlockedCtx.state === 'suspended') {
        unlockedCtx.resume().catch(() => null);
      }
    } catch { /* silent */ }
  };
  // gesture 종류 어떤 거든 한 번이면 됨 — 핸들러 자체에서 unlock 시도
  const handler = () => {
    tryUnlock();
    window.removeEventListener('click', handler);
    window.removeEventListener('keydown', handler);
    window.removeEventListener('touchstart', handler);
  };
  window.addEventListener('click', handler, { once: true });
  window.addEventListener('keydown', handler, { once: true });
  window.addEventListener('touchstart', handler, { once: true });
}

// mp3 캐시 — null = 미시도, HTMLAudioElement = 사용 가능, mp3Failed=true 면 합성으로 영구 전환
let mp3El: HTMLAudioElement | null = null;
let mp3Failed = false;
// debounce — 200ms 이내 중복 ping skip (짧은 간격에 여러 알림 도착 시 사운드 중첩 방지)
let lastPingAt = 0;

export function playPing() {
  const now = Date.now();
  if (now - lastPingAt < 200) return;
  lastPingAt = now;
  if (!mp3Failed) {
    if (!mp3El) {
      try {
        const a = new Audio(PING_MP3);
        a.volume = 0.7;
        a.preload = 'auto';
        mp3El = a;
      } catch { mp3Failed = true; }
    }
    const el = mp3El;
    if (el && !mp3Failed) {
      try {
        el.currentTime = 0;
        const p = el.play();
        if (p && typeof p.then === 'function') {
          p.then(() => { /* OK */ }).catch(() => {
            // 404 / 자동재생 차단 / 디코딩 실패 — 합성으로 영구 전환
            mp3Failed = true;
            playSynth();
          });
        }
        return;
      } catch { mp3Failed = true; }
    }
  }
  playSynth();
}

// Web Audio 합성 — 부드러운 2음 차임 (C5 523Hz + E5 659Hz, major third).
// 옛 버전(G5 784Hz + D6 1174Hz, gain 0.45, lowpass 없음)은 맥북 스피커가 고역을 날카롭게
// 재생해 "귀아픔" 호소(운영). 모바일은 고역 roll-off 라 원래 부드러웠음.
// → 저역대(<700Hz)로 낮춤 + lowpass 2kHz 로 날카로운 고역 제거 + 볼륨 0.45→0.16 으로 톤다운.
function playSynth() {
  try {
    if (!unlockedCtx || unlockedCtx.state === 'closed') {
      const Ctx = window.AudioContext || (window as WindowWithWebkit).webkitAudioContext;
      if (!Ctx) return;
      unlockedCtx = new Ctx();
    }
    const ctx = unlockedCtx;
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => null);
      return;
    }
    const now = ctx.currentTime;

    // lowpass — 날카로운 고역 차단 (귀 통증의 핵심 원인). 2kHz 위 부드럽게 감쇠.
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2000, now);
    lp.Q.setValueAtTime(0.7, now);

    const master = ctx.createGain();
    lp.connect(master);
    master.connect(ctx.destination);
    master.gain.setValueAtTime(0, now);
    master.gain.linearRampToValueAtTime(0.16, now + 0.02);   // 0.45 → 0.16 (부드럽게)
    master.gain.exponentialRampToValueAtTime(0.001, now + 0.6);

    // Fundamental — C5 (따뜻한 중역)
    const osc1 = ctx.createOscillator();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(523.25, now);
    osc1.connect(lp);
    osc1.start(now);
    osc1.stop(now + 0.65);

    // 화음 — E5 (장3도 위), 50ms 늦게 + 낮은 게인 → 날카롭지 않은 따뜻한 차임
    const osc2 = ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(659.25, now + 0.05);
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.35, now);
    osc2.connect(g2); g2.connect(lp);
    osc2.start(now + 0.05);
    osc2.stop(now + 0.65);
  } catch { /* silent */ }
}
