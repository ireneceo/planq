/**
 * 마이크 녹음 → 16kHz mono PCM16 WAV Blob 생성.
 *
 * 브라우저 호환성을 위해 AudioContext + ScriptProcessorNode 로 직접 캡처.
 * MediaRecorder(opus/webm) 대신 직접 PCM 누적 → 서버에서 ffmpeg 불필요.
 */

const TARGET_RATE = 16000;
const BUFFER_SIZE = 4096;

export class WavRecorder {
  private ctx: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private stream: MediaStream | null = null;
  private samples: Float32Array[] = [];
  private active = false;
  private onLevel?: (level: number) => void;

  async start(onLevel?: (level: number) => void): Promise<void> {
    this.onLevel = onLevel;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('이 브라우저는 마이크 녹음을 지원하지 않습니다');
    }
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
    });
    await this._wire();
  }

  /** 이미 존재하는 MediaStream 으로 녹음 시작 (소유권 없음 — 외부에서 관리). */
  async startFromExistingStream(stream: MediaStream, onLevel?: (level: number) => void): Promise<void> {
    this.onLevel = onLevel;
    // 외부 스트림 — stop() 에서 track 정리하지 않도록 null 유지
    this.stream = null;
    await this._wire(stream);
  }

  private async _wire(externalStream?: MediaStream): Promise<void> {
    const stream = externalStream || this.stream;
    if (!stream) throw new Error('no stream');

    const AC: typeof AudioContext =
      (window as unknown as { AudioContext: typeof AudioContext }).AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AC();
    const sourceRate = this.ctx.sampleRate;
    const ratio = sourceRate / TARGET_RATE;

    this.source = this.ctx.createMediaStreamSource(stream);
    this.processor = this.ctx.createScriptProcessor(BUFFER_SIZE, 1, 1);

    this.processor.onaudioprocess = (e: AudioProcessingEvent) => {
      if (!this.active) return;
      const input = e.inputBuffer.getChannelData(0);
      // 레벨 미터
      if (this.onLevel) {
        let max = 0;
        for (let i = 0; i < input.length; i++) {
          const v = Math.abs(input[i]);
          if (v > max) max = v;
        }
        this.onLevel(max);
      }
      // 다운샘플 (linear decimation)
      const outLen = Math.floor(input.length / ratio);
      const out = new Float32Array(outLen);
      for (let i = 0; i < outLen; i++) {
        out[i] = input[Math.floor(i * ratio)];
      }
      this.samples.push(out);
    };

    this.source.connect(this.processor);
    const mute = this.ctx.createGain();
    mute.gain.value = 0;
    this.processor.connect(mute);
    mute.connect(this.ctx.destination);

    this.active = true;
  }

  async stop(): Promise<Blob> {
    this.active = false;
    try { this.processor?.disconnect(); } catch { /* ignore */ }
    try { this.source?.disconnect(); } catch { /* ignore */ }
    try { this.ctx?.close(); } catch { /* ignore */ }
    this.stream?.getTracks().forEach((t) => t.stop());

    const totalSamples = this.samples.reduce((s, a) => s + a.length, 0);
    const merged = new Float32Array(totalSamples);
    let offset = 0;
    for (const chunk of this.samples) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    this.samples = [];

    return buildWavBlob(merged, TARGET_RATE);
  }

  getSampleCount(): number {
    return this.samples.reduce((s, a) => s + a.length, 0);
  }

  getSeconds(): number {
    return this.getSampleCount() / TARGET_RATE;
  }
}

/** Float32 [-1,1] → 16-bit PCM WAV Blob. */
export function buildWavBlob(samples: Float32Array, sampleRate: number): Blob {
  const numSamples = samples.length;
  const dataBytes = numSamples * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);           // PCM chunk size
  view.setUint16(20, 1, true);            // PCM format
  view.setUint16(22, 1, true);            // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true);            // block align
  view.setUint16(34, 16, true);           // bits per sample
  writeString(36, 'data');
  view.setUint32(40, dataBytes, true);

  let pos = 44;
  for (let i = 0; i < numSamples; i++) {
    let s = Math.max(-1, Math.min(1, samples[i]));
    s = s < 0 ? s * 0x8000 : s * 0x7fff;
    view.setInt16(pos, s, true);
    pos += 2;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}
