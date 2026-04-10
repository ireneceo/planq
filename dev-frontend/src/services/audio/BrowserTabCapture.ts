import type { AudioCaptureSource, CaptureCapabilities } from './AudioCaptureSource';

/**
 * 브라우저 탭 캡처 — getDisplayMedia 기반.
 *
 * 사용자가 "이 탭 공유 + 탭 오디오 포함" 옵션을 명시 선택해야 함.
 * Chrome/Edge에서만 안정적으로 동작 (Firefox/Safari는 미지원).
 *
 * 화상회의(Google Meet, Zoom 웹, Teams 웹), 강의(YouTube, Coursera) 등에 적합.
 * 디지털 직결 신호라 마이크보다 품질이 더 좋음.
 */
export class BrowserTabCapture implements AudioCaptureSource {
  readonly mode = 'browser_tab' as const;
  private stream: MediaStream | null = null;

  get isActive() {
    return this.stream !== null && this.stream.active;
  }

  async start(): Promise<MediaStream> {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      throw new Error('이 브라우저는 탭 캡처를 지원하지 않습니다. (Chrome/Edge 권장)');
    }

    // 비디오 트랙도 요청해야 일부 브라우저에서 audio가 같이 옴
    // 비디오는 즉시 stop으로 끄고 audio만 사용
    const fullStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });

    // 오디오 트랙이 없으면 사용자가 "오디오 공유" 체크 안 함 → 에러
    const audioTracks = fullStream.getAudioTracks();
    if (audioTracks.length === 0) {
      fullStream.getTracks().forEach((t) => t.stop());
      throw new Error(
        '탭 오디오를 받지 못했습니다. 공유 다이얼로그에서 "탭 오디오 공유"를 체크해주세요.'
      );
    }

    // 비디오 트랙 즉시 정리 (오디오만 필요)
    fullStream.getVideoTracks().forEach((t) => t.stop());

    // 오디오 트랙만 새 스트림으로
    this.stream = new MediaStream(audioTracks);

    // 사용자가 공유 중지 버튼 누르면 자동 정리
    audioTracks[0].addEventListener('ended', () => this.stop());

    return this.stream;
  }

  stop(): void {
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
  }
}

export const browserTabCapability: CaptureCapabilities = {
  mode: 'browser_tab',
  label: '브라우저 탭',
  description: '웹 화상회의(Teams/Meet/Zoom 웹), 온라인 강의 등 — Chrome/Edge에서 사용',
  // Chrome/Edge만 안정적
  isAvailable: () => !!navigator.mediaDevices?.getDisplayMedia,
  requiresUserGesture: true,
};
