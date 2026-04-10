import type { AudioCaptureSource, CaptureCapabilities } from './AudioCaptureSource';

/**
 * 마이크 캡처 — getUserMedia 기반.
 * 오프라인 회의, 1:1 미팅 등에서 사용.
 */
export class MicrophoneCapture implements AudioCaptureSource {
  readonly mode = 'microphone' as const;
  private stream: MediaStream | null = null;

  get isActive() {
    return this.stream !== null && this.stream.active;
  }

  async start(): Promise<MediaStream> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('이 브라우저는 마이크 캡처를 지원하지 않습니다.');
    }

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
        sampleRate: 16000,
      },
    });

    return this.stream;
  }

  stop(): void {
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
  }
}

export const microphoneCapability: CaptureCapabilities = {
  mode: 'microphone',
  label: '마이크',
  description: '오프라인 회의, 1:1 카페 미팅, 인터뷰 등에 적합',
  isAvailable: () => !!navigator.mediaDevices?.getUserMedia,
  requiresUserGesture: true,
};
