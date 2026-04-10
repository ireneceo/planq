/**
 * PCMStreamer — MediaStream → PCM16 16kHz mono Int16Array chunks.
 *
 * Uses a ScriptProcessorNode for maximum browser compatibility
 * (AudioWorklet requires a separate module file). Output chunks are
 * ~40 ms each (640 samples at 16 kHz) for low-latency streaming to
 * Deepgram via /ws/live.
 *
 * Downsampling: linear decimation from source rate (typically 48 kHz)
 * to 16 kHz, mono (channel 0 only).
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

  async start(stream: MediaStream, onChunk: (pcm: Int16Array) => void): Promise<void> {
    const AC: typeof AudioContext =
      (window as unknown as { AudioContext: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
        .AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) throw new Error('AudioContext not supported');

    this.ctx = new AC();
    const sourceRate = this.ctx.sampleRate;
    const ratio = sourceRate / TARGET_RATE;

    this.source = this.ctx.createMediaStreamSource(stream);
    this.processor = this.ctx.createScriptProcessor(BUFFER_SIZE, 1, 1);

    this.processor.onaudioprocess = (e: AudioProcessingEvent) => {
      if (!this.active) return;
      const input = e.inputBuffer.getChannelData(0);
      const outLen = Math.floor(input.length / ratio);
      const out = new Int16Array(outLen);
      for (let i = 0; i < outLen; i++) {
        const sample = input[Math.floor(i * ratio)];
        const clamped = Math.max(-1, Math.min(1, sample));
        out[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
      }
      onChunk(out);
    };

    this.source.connect(this.processor);
    // ScriptProcessorNode requires destination connection to tick, but we
    // don't want to hear our own audio back — route through a muted gain.
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
