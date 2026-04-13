import { buildLiveSocketUrl } from './qnote';
import { createCaptureSource } from './audio';
import type { CaptureMode, AudioCaptureSource } from './audio';
import { PCMStreamer } from './audio/PCMStreamer';
import { WebConferenceCapture } from './audio/WebConferenceCapture';

export interface LiveTranscriptEvent {
  type: 'transcript';
  transcript: string;
  is_final: boolean;
  language?: string;
  start?: number;
  end?: number;
  confidence?: number;
  deepgram_speaker_id?: number | null;
}

export interface LiveEnrichmentEvent {
  type: 'enrichment';
  utterance_id: number;
  formatted_original?: string;
  translation: string;
  is_question: boolean;
  detected_language?: string;
  out_of_scope?: boolean;
}

export interface LiveFinalizedEvent {
  type: 'finalized';
  utterance_id: number;
  transcript: string;
  language?: string;
  deepgram_speaker_id?: number | null;
  speaker_id?: number | null;
  is_self?: boolean;
  start?: number;
  end?: number;
  channel_index?: number;
}

export interface LiveReadyEvent {
  type: 'ready';
  language: string;
}

export interface LiveErrorEvent {
  type: 'error';
  message: string;
}

export interface LiveAnswerReadyEvent {
  type: 'answer_ready';
  utterance_id: number;
  tier: string;
}

export interface LiveQuickQuestionEvent {
  type: 'quick_question';
  utterance_id: number;
  transcript: string;
}

export type LiveEvent =
  | LiveTranscriptEvent
  | LiveFinalizedEvent
  | LiveEnrichmentEvent
  | LiveQuickQuestionEvent
  | LiveAnswerReadyEvent
  | LiveReadyEvent
  | LiveErrorEvent
  | { type: 'utterance_end' }
  | { type: 'closed' };

export interface LiveSessionOptions {
  sessionId: number;
  captureMode: CaptureMode;
  onEvent: (event: LiveEvent) => void;
}

/**
 * Orchestrates a live Q Note session:
 *   1. User gesture -> AudioCaptureSource.start() grabs the MediaStream.
 *   2. WebSocket /qnote/ws/live?session_id=&token= opens.
 *   3. PCMStreamer pipes PCM chunks as binary frames.
 *      - microphone: mono 16kHz
 *      - web_conference: stereo 16kHz (L=mic=나, R=tab=상대)
 *   4. Server JSON events are forwarded via onEvent.
 */
export class LiveSession {
  private ws: WebSocket | null = null;
  private capture: AudioCaptureSource | null = null;
  private pcm: PCMStreamer | null = null;
  private readonly opts: LiveSessionOptions;
  private stopped = false;

  constructor(opts: LiveSessionOptions) {
    this.opts = opts;
  }

  async start(): Promise<void> {
    this.capture = createCaptureSource(this.opts.captureMode);
    const stream = await this.capture.start();
    const isStereo = this.capture instanceof WebConferenceCapture;

    const url = buildLiveSocketUrl(this.opts.sessionId);
    this.ws = new WebSocket(url);
    this.ws.binaryType = 'arraybuffer';

    await new Promise<void>((resolve, reject) => {
      if (!this.ws) return reject(new Error('WS not initialized'));
      this.ws.onopen = () => resolve();
      this.ws.onerror = () => reject(new Error('WebSocket connection failed'));
    });

    this.ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return;
      try {
        const parsed = JSON.parse(ev.data) as LiveEvent;
        this.opts.onEvent(parsed);
      } catch { /* ignore malformed */ }
    };

    this.ws.onclose = () => {
      if (!this.stopped) this.opts.onEvent({ type: 'closed' });
    };

    this.pcm = new PCMStreamer();
    await this.pcm.start(stream, (chunk) => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        const buf = chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer;
        this.ws.send(buf);
      }
    }, isStereo);
  }

  stop(): void {
    this.stopped = true;
    try {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ action: 'stop' }));
      }
    } catch { /* ignore */ }
    try { this.pcm?.stop(); } catch { /* ignore */ }
    // capture.stop() 은 Promise 가능 (WebConferenceCapture 는 AudioContext close 를 await).
    // 결과를 기다리지 않아도 내부적으로 tab 트랙을 동기적으로 stop 하므로 Chrome "공유 중"
    // 배너는 즉시 사라진다. AudioContext 정리는 백그라운드에서 완결.
    try {
      const result = this.capture?.stop();
      if (result && typeof (result as Promise<void>).then === 'function') {
        (result as Promise<void>).catch(() => { /* ignore */ });
      }
    } catch { /* ignore */ }
    try { this.ws?.close(); } catch { /* ignore */ }
    this.pcm = null;
    this.capture = null;
    this.ws = null;
  }
}
