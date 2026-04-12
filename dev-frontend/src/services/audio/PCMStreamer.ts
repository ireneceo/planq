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
          const srcIdx = Math.floor(i * ratio);
          const lSample = Math.max(-1, Math.min(1, left[srcIdx]));
          const rSample = Math.max(-1, Math.min(1, right[srcIdx]));
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
          const sample = input[Math.floor(i * ratio)];
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
