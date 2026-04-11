import type { AudioCaptureSource, CaptureCapabilities } from './AudioCaptureSource';

/**
 * 웹 화상회의 캡처 — 마이크(본인) + 탭 오디오(상대) 믹싱.
 *
 * 배경:
 *   getDisplayMedia({ audio: true }) 단독으로는 "탭이 스피커로 재생하는 소리"만 잡힌다.
 *   본인 목소리는 마이크 → WebRTC encoder → 네트워크 로 직접 흐르므로 탭 오디오 파이프에
 *   재생되지 않아 캡처되지 않는다. 따라서 웹 화상회의 / 온라인 강의 녹음에는
 *   "마이크 + 탭" 동시 캡처 + 믹싱이 유일한 해결책이다.
 *
 * 브라우저 요구사항:
 *   - Chrome 또는 Edge 권장 (getDisplayMedia 탭 오디오 공유 지원)
 *   - 공유 다이얼로그에서 "Chrome 탭" 선택 + "탭 오디오 공유" 체크 필수
 *
 * 구현:
 *   1. getUserMedia 로 마이크 스트림 확보
 *   2. getDisplayMedia 로 탭 스트림 확보 (video track 즉시 stop, audio 만 사용)
 *   3. Web Audio API 로 두 MediaStreamSource → 하나의 MediaStreamDestination 으로 믹싱
 *   4. destination.stream 을 PCMStreamer 에 전달
 */
export class WebConferenceCapture implements AudioCaptureSource {
  readonly mode = 'web_conference' as const;
  private micStream: MediaStream | null = null;
  private tabStream: MediaStream | null = null;
  private mixedStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;

  get isActive() {
    return this.mixedStream !== null && this.mixedStream.active;
  }

  /** 마이크 전용 스트림 — 라이브 본인 매칭 전용 사이드 채널에 사용. */
  getMicOnlyStream(): MediaStream | null {
    return this.micStream;
  }

  async start(): Promise<MediaStream> {
    if (!navigator.mediaDevices?.getUserMedia || !navigator.mediaDevices?.getDisplayMedia) {
      throw new Error('이 브라우저는 웹 화상회의 캡처를 지원하지 않습니다. (Chrome/Edge 권장)');
    }

    // 1) 마이크 — 에코 캔슬은 켠다 (상대방 목소리가 스피커 → 마이크로 되돌아오는 것 제거)
    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
    } catch (err) {
      throw new Error('마이크 권한이 거부되었습니다. 브라우저 설정에서 마이크 접근을 허용해주세요.');
    }

    // 2) 탭 오디오 — 공유 다이얼로그 띄움
    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      const audioTracks = displayStream.getAudioTracks();
      if (audioTracks.length === 0) {
        displayStream.getTracks().forEach((t) => t.stop());
        throw new Error(
          '탭 오디오를 받지 못했습니다. 공유 다이얼로그에서 "탭"을 선택하고 "탭 오디오 공유"를 체크한 뒤 다시 시도해주세요.'
        );
      }
      // 비디오 트랙은 즉시 정리 (오디오만 필요)
      displayStream.getVideoTracks().forEach((t) => t.stop());
      this.tabStream = new MediaStream(audioTracks);
      // 사용자가 공유 중지 누르면 자동 정리
      audioTracks[0].addEventListener('ended', () => this.stop());
    } catch (err) {
      // 마이크는 이미 잡았으므로 정리
      this.micStream.getTracks().forEach((t) => t.stop());
      this.micStream = null;
      if (err instanceof Error) throw err;
      throw new Error('탭 공유가 취소되었습니다.');
    }

    // 3) 두 스트림을 Web Audio API 로 믹싱
    const AC: typeof AudioContext =
      (window as unknown as { AudioContext: typeof AudioContext }).AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.audioContext = new AC();

    const dest = this.audioContext.createMediaStreamDestination();
    const micSource = this.audioContext.createMediaStreamSource(this.micStream);
    const tabSource = this.audioContext.createMediaStreamSource(this.tabStream);

    // 마이크/탭 각각 게인 노드로 분리해 추후 조정 여지 남김 (현재 1.0)
    const micGain = this.audioContext.createGain();
    const tabGain = this.audioContext.createGain();
    micGain.gain.value = 1.0;
    tabGain.gain.value = 1.0;

    micSource.connect(micGain).connect(dest);
    tabSource.connect(tabGain).connect(dest);

    this.mixedStream = dest.stream;

    // 탭 오디오 무음 감지: 3초 동안 탭 트랙에서 신호가 전혀 없으면 경고
    // (사용자가 "탭 오디오 공유" 체크박스를 안 켰거나 상대방이 말하고 있지 않은 경우)
    this.startTabSilenceWatchdog(this.tabStream);

    return this.mixedStream;
  }

  /** 탭 오디오 트랙이 3초간 0 이면 console.warn. 이후 추가 조치는 UI 계층에서. */
  private startTabSilenceWatchdog(tabStream: MediaStream) {
    if (!this.audioContext || !tabStream) return;
    try {
      const analyserCtx = this.audioContext;
      const source = analyserCtx.createMediaStreamSource(tabStream);
      const analyser = analyserCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const startAt = Date.now();
      let peak = 0;
      const check = () => {
        if (!this.audioContext || !this.mixedStream?.active) return;
        analyser.getByteTimeDomainData(data);
        let localPeak = 0;
        for (let i = 0; i < data.length; i++) {
          const v = Math.abs(data[i] - 128);
          if (v > localPeak) localPeak = v;
        }
        if (localPeak > peak) peak = localPeak;
        if (Date.now() - startAt < 3000) {
          setTimeout(check, 200);
        } else {
          if (peak < 2) {
            console.warn(
              '[Q Note] 탭 오디오 신호 없음: 공유 다이얼로그에서 "탭 오디오 공유"를 체크했는지 확인하세요. ' +
              '혹은 상대방이 아직 말하지 않은 상태일 수 있습니다.'
            );
          }
        }
      };
      setTimeout(check, 200);
    } catch {
      /* ignore watchdog errors */
    }
  }

  stop(): void {
    try { this.audioContext?.close(); } catch { /* ignore */ }
    this.audioContext = null;

    if (this.micStream) {
      this.micStream.getTracks().forEach((t) => t.stop());
      this.micStream = null;
    }
    if (this.tabStream) {
      this.tabStream.getTracks().forEach((t) => t.stop());
      this.tabStream = null;
    }
    if (this.mixedStream) {
      this.mixedStream.getTracks().forEach((t) => t.stop());
      this.mixedStream = null;
    }
  }
}

export const webConferenceCapability: CaptureCapabilities = {
  mode: 'web_conference',
  label: '웹 화상회의',
  description: 'Google Meet · MS Teams 웹 · Zoom 웹 · 온라인 강의 — 마이크와 상대방 목소리를 함께 녹음합니다 (Chrome/Edge)',
  isAvailable: () =>
    !!navigator.mediaDevices?.getUserMedia && !!navigator.mediaDevices?.getDisplayMedia,
  requiresUserGesture: true,
};
