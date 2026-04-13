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

  // 명시적 disconnect 를 위해 노드 참조 보관
  private nodes: AudioNode[] = [];
  // tab 트랙 'ended' 리스너 — stop 시 제거해야 stale 인스턴스 이중 호출 방지
  private tabEndedHandler: (() => void) | null = null;
  private tabEndedTrack: MediaStreamTrack | null = null;
  // 재진입 방지 (ended 이벤트 + app stop 이 동시에 stop 호출할 수 있음)
  private stopping = false;

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
    // 품질 개선: 48kHz stereo 요청. 원격 화자 목소리가 약해도 Deepgram 이 잘 인식하도록
    // Web Audio 단에서 gain boost + compressor 적용 (아래 믹싱 단계).
    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          sampleRate: 48000,
          sampleSize: 16,
          channelCount: 2,
        } as MediaTrackConstraints,
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
      // Chrome은 탭 선택 후 해당 탭으로 포커스를 이동시킴 — PlanQ 탭으로 즉시 복귀
      window.focus();
      // 사용자가 공유 중지 누르면 자동 정리 — 리스너 참조 보관 (stop 시 제거)
      this.tabEndedTrack = audioTracks[0];
      this.tabEndedHandler = () => { void this.stop(); };
      this.tabEndedTrack.addEventListener('ended', this.tabEndedHandler);
    } catch (err) {
      // 마이크는 이미 잡았으므로 정리
      this.micStream.getTracks().forEach((t) => t.stop());
      this.micStream = null;
      if (err instanceof Error) throw err;
      throw new Error('탭 공유가 취소되었습니다.');
    }

    // 3) 두 스트림을 Web Audio API 로 스테레오 믹싱 (mic=Left, tab=Right)
    //    Deepgram multichannel 로 채널별 개별 STT → channel 0=나, channel 1=상대
    const AC: typeof AudioContext =
      (window as unknown as { AudioContext: typeof AudioContext }).AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.audioContext = new AC();

    const dest = this.audioContext.createMediaStreamDestination();
    // destination 을 스테레오로 설정
    dest.channelCount = 2;
    dest.channelCountMode = 'explicit';
    dest.channelInterpretation = 'discrete';

    const micSource = this.audioContext.createMediaStreamSource(this.micStream);
    const tabSource = this.audioContext.createMediaStreamSource(this.tabStream);

    // 마이크: 기본 1.0 (이미 에코캔슬/노이즈억제 적용됨)
    const micGain = this.audioContext.createGain();
    micGain.gain.value = 1.0;

    // 탭(상대): 원격 스트림이 시스템 볼륨에 의존하므로 약할 때가 많음.
    //   Compressor 로 동적 범위 압축 → 조용한 부분을 끌어올림
    //   Gain 부스트로 전체 레벨 ~2배
    //   HighShelf 로 고주파 강조 → 자음 명료도 개선
    const tabCompressor = this.audioContext.createDynamicsCompressor();
    tabCompressor.threshold.value = -28;   // -28 dB 부터 압축 시작
    tabCompressor.knee.value = 24;
    tabCompressor.ratio.value = 4;         // 4:1 압축
    tabCompressor.attack.value = 0.003;
    tabCompressor.release.value = 0.1;

    const tabHighShelf = this.audioContext.createBiquadFilter();
    tabHighShelf.type = 'highshelf';
    tabHighShelf.frequency.value = 3000;
    tabHighShelf.gain.value = 3;            // +3dB above 3kHz (자음 명료도)

    const tabGain = this.audioContext.createGain();
    tabGain.gain.value = 2.0;               // 레벨 부스트

    // ChannelMerger: 입력 0 → Left(나), 입력 1 → Right(상대)
    const merger = this.audioContext.createChannelMerger(2);
    micSource.connect(micGain).connect(merger, 0, 0);
    tabSource
      .connect(tabHighShelf)
      .connect(tabCompressor)
      .connect(tabGain)
      .connect(merger, 0, 1);
    merger.connect(dest);

    // stop() 에서 disconnect 하기 위해 노드 참조 저장.
    // 탭 오디오 참조가 micSource/tabSource 외에 남아있으면 Chrome 이 "공유 중"
    // 표시를 끄지 않아 재공유 시 두 번 표시되는 버그의 원인.
    this.nodes = [micSource, tabSource, micGain, tabHighShelf, tabCompressor, tabGain, merger];

    this.mixedStream = dest.stream;

    return this.mixedStream;
  }

  async stop(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;

    // 1) tab 트랙 'ended' 리스너 먼저 제거 — stop 재진입 방지
    if (this.tabEndedTrack && this.tabEndedHandler) {
      try { this.tabEndedTrack.removeEventListener('ended', this.tabEndedHandler); } catch { /* ignore */ }
    }
    this.tabEndedTrack = null;
    this.tabEndedHandler = null;

    // 2) 모든 AudioNode 명시적 disconnect — AudioContext 에 매달린 참조 해제
    for (const node of this.nodes) {
      try { node.disconnect(); } catch { /* ignore */ }
    }
    this.nodes = [];

    // 3) 트랙 정지 — Chrome "공유 중" 배너가 사라지려면 tab 트랙이 stop 되어야 함
    if (this.tabStream) {
      this.tabStream.getTracks().forEach((t) => { try { t.stop(); } catch { /* ignore */ } });
      this.tabStream = null;
    }
    if (this.micStream) {
      this.micStream.getTracks().forEach((t) => { try { t.stop(); } catch { /* ignore */ } });
      this.micStream = null;
    }
    if (this.mixedStream) {
      this.mixedStream.getTracks().forEach((t) => { try { t.stop(); } catch { /* ignore */ } });
      this.mixedStream = null;
    }

    // 4) AudioContext close 는 async — 완료를 기다려야 Chrome 이 소비자 해제를 인식
    if (this.audioContext) {
      const ctx = this.audioContext;
      this.audioContext = null;
      try {
        if (ctx.state !== 'closed') await ctx.close();
      } catch { /* ignore */ }
    }

    this.stopping = false;
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
