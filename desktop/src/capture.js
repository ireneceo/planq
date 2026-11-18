// PlanQ 데스크탑 앱 — Q note «온라인 회의» 녹음(시스템 소리) 판정. 2단계 B · docs/DESKTOP_APP_PHASE2.md §1-B · §4-1·2 · §7
//
// 왜 따로 파일인가: 판정만 떼어 두면 Electron 없이 node 로 양성·음성 대조군을 돌릴 수 있다(desktop/test/capture.test.js).
//
// 계약(Fable DESIGN-FIX 1·2):
//   · 원격 껍데기라 planq.kr XSS 하나면 화면·시스템 소리를 조용히 가져갈 수 있다 → 요청은 **메인 창의 최상위 프레임 + 앱 출처 + 사용자 제스처**만.
//   · 영상은 «첫 화면» 이 아니라 **요청한 자기 창**(request.frame) — 다른 프로그램 화면은 절대 넘기지 않는다. 웹은 영상 트랙을 받자마자 끈다.
//   · 소리는 Electron 이 윈도우에서만 시스템 소리(loopback)를 준다(electron.d.ts Streams.audio). 맥·리눅스는 systemAudio=false —
//     웹이 그 모드를 «지원 안 함» 으로 그린다(크롬 PWA 와 같은 탭 공유 길은 맥 앱에 없다).
//   · 확인은 main 의 네이티브 창으로 **매번** 받는다(Fable 은 «첫 회» — 녹음 중 트레이 표시를 main 이 알 길이 없어(트랙 끝을 못 본다)
//     더 엄한 쪽을 골랐다. 크롬도 매번 공유 창을 띄우므로 사용자 수고는 같다).
'use strict';

/** 이 OS 에서 시스템 소리를 줄 수 있는가 — Electron loopback 은 윈도우만 */
function systemAudioSupported(platform) {
  return platform === 'win32';
}

/**
 * getDisplayMedia 요청을 받을지 판정한다. 받으면 { ok: true }, 아니면 { ok: false, reason }.
 * @param {{ platform: string, isMainTopFrame: boolean, sameOrigin: boolean, userGesture: boolean, audioRequested: boolean }} r
 */
function judgeDisplayMedia(r) {
  if (!systemAudioSupported(r && r.platform)) return { ok: false, reason: 'unsupported_os' };
  if (!r.sameOrigin) return { ok: false, reason: 'origin' };
  if (!r.isMainTopFrame) return { ok: false, reason: 'not_main_frame' };
  if (!r.userGesture) return { ok: false, reason: 'no_gesture' };
  if (!r.audioRequested) return { ok: false, reason: 'no_audio' };   // 이 길의 목적은 소리다 — 화면만 원하는 요청은 받지 않는다
  return { ok: true };
}

const CONFIRM_TEXT = {
  ko: {
    buttons: ['녹음 시작', '취소'],
    message: '회의 소리를 녹음할까요?',
    detail: 'Q note 가 이 컴퓨터에서 나는 소리(줌·팀즈·브라우저 회의 상대 목소리)와 마이크를 함께 녹음합니다.\n다른 프로그램 화면은 가져가지 않습니다.',
  },
  en: {
    buttons: ['Start recording', 'Cancel'],
    message: 'Record the meeting audio?',
    detail: 'Q note will record the sound playing on this computer (Zoom, Teams or browser meeting participants) together with your microphone.\nNo other app\'s screen is captured.',
  },
};

module.exports = { systemAudioSupported, judgeDisplayMedia, CONFIRM_TEXT };
