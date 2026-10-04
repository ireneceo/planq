/**
 * PCMStreamer — MediaStream → PCM16 16kHz Int16Array chunks.
 *
 * Uses a ScriptProcessorNode for maximum browser compatibility.
 * Output chunks are ~40 ms each for low-latency streaming to Deepgram via /ws/live.
 *
 * Mono mode (microphone): 1-channel PCM16 16kHz
 * Stereo mode (web_conference): 2-channel interleaved PCM16 16kHz (L=mic=나, R=tab=상대)
 */

const TARGET_RATE = 16000;
const BUFFER_SIZE = 4096;

/**
 * 원본(44.1·48kHz) → 16kHz 구간 평균. ★ 2026-10-04 — 예전엔 «가장 가까운 한 표본»만 집어(decimation)
 *   8kHz 이상 소리가 낮은 주파수로 접혀 들어갔다(에일리어싱 — 치찰음·잡음이 말소리에 섞인다).
 *   평균은 가장 단순한 저역 통과라 음성 인식 정확도가 오른다. 값의 범위·채널 배치는 그대로다.
 */
function avgAt(src: Float32Array, i: number, ratio: number): number {
  const a = Math.floor(i * ratio);
  const b = Math.max(a + 1, Math.min(src.length, Math.floor((i + 1) * ratio)));
  let sum = 0;
  for (let k = a; k < b; k++) sum += src[k];
  return sum / (b - a);
}

export class PCMStreamer {
  private ctx: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private active = false;

  get isActive() {
    return this.active;
  }

  /**
   * @param stream  MediaStream (mono or stereo)
   * @param onChunk PCM16 chunk callback
   * @param stereo  true → 2-channel interleaved output for Deepgram multichannel
   */
  async start(stream: MediaStream, onChunk: (pcm: Int16Array) => void, stereo = false): Promise<void> {
    const AC: typeof AudioContext =
      (window as unknown as { AudioContext: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
        .AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) throw new Error('AudioContext not supported');

    this.ctx = new AC();
    // ★ 새 AudioContext 는 'suspended' 로 시작할 수 있고, 그 상태에서는
    //   ScriptProcessor 의 onaudioprocess 가 **아예 발화하지 않는다** → 오디오가 한 조각도 안 나간다.
    //   화면은 "녹음 중" 이고 WebSocket 도 열려 있어서 **아무 오류 없이 조용히 아무것도 안 녹음**된다
    //   (운영 실측 2026-08-29: Q Note '바로 녹음' 세션이 Deepgram 까지 붙고 오디오 0건 · 35초 뒤 종료).
    //   제스처 직후면 브라우저가 알아서 깨우지만, 이 경로는 세션 생성·락·WS 연결로 await 이 길어
    //   사용자 활성화 창을 놓치기 쉽다. 그래서 **명시적으로 깨운다.**
    if (this.ctx.state === 'suspended') {
      try { await this.ctx.resume(); } catch { /* 아래에서 상태로 판정한다 */ }
    }
    if (this.ctx.state !== 'running') {
      // 깨우지 못했으면 조용히 빈 녹음을 하지 않는다 — 호출측이 사용자에게 알릴 수 있게 던진다.
      try { this.ctx.close(); } catch { /* ignore */ }
      this.ctx = null;
      throw new Error('audio_context_suspended');
    }
    const sourceRate = this.ctx.sampleRate;
    const ratio = sourceRate / TARGET_RATE;
    const inChannels = stereo ? 2 : 1;

    this.source = this.ctx.createMediaStreamSource(stream);
    this.processor = this.ctx.createScriptProcessor(BUFFER_SIZE, inChannels, inChannels);

    this.processor.onaudioprocess = (e: AudioProcessingEvent) => {
      if (!this.active) return;

      if (stereo) {
        // 2-channel interleaved: [L0, R0, L1, R1, ...]
        const left = e.inputBuffer.getChannelData(0);
        const right = e.inputBuffer.getChannelData(1);
        const outLen = Math.floor(left.length / ratio);
        const out = new Int16Array(outLen * 2);
        for (let i = 0; i < outLen; i++) {
          const lSample = Math.max(-1, Math.min(1, avgAt(left, i, ratio)));
          const rSample = Math.max(-1, Math.min(1, avgAt(right, i, ratio)));
          out[i * 2] = lSample < 0 ? lSample * 0x8000 : lSample * 0x7fff;
          out[i * 2 + 1] = rSample < 0 ? rSample * 0x8000 : rSample * 0x7fff;
        }
        onChunk(out);
      } else {
        // Mono
        const input = e.inputBuffer.getChannelData(0);
        const outLen = Math.floor(input.length / ratio);
        const out = new Int16Array(outLen);
        for (let i = 0; i < outLen; i++) {
          const sample = avgAt(input, i, ratio);
          const clamped = Math.max(-1, Math.min(1, sample));
          out[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
        }
        onChunk(out);
      }
    };

    this.source.connect(this.processor);
    const mute = this.ctx.createGain();
    mute.gain.value = 0;
    this.processor.connect(mute);
    mute.connect(this.ctx.destination);

    this.active = true;
  }

  stop(): void {
    this.active = false;
    try { this.processor?.disconnect(); } catch { /* ignore */ }
    try { this.source?.disconnect(); } catch { /* ignore */ }
    try { this.ctx?.close(); } catch { /* ignore */ }
    this.processor = null;
    this.source = null;
    this.ctx = null;
  }
}
