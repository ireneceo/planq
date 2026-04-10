import { buildLiveSocketUrl } from './qnote';
import { createCaptureSource } from './audio';
import type { CaptureMode, AudioCaptureSource } from './audio';
import { PCMStreamer } from './audio/PCMStreamer';

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
  translation: string;
  is_question: boolean;
  detected_language?: string;
}

export interface LiveFinalizedEvent {
  type: 'finalized';
  utterance_id: number;
  transcript: string;
  language?: string;
  deepgram_speaker_id?: number | null;
  speaker_id?: number | null;
  start?: number;
  end?: number;
}

export interface LiveReadyEvent {
  type: 'ready';
  language: string;
}

export interface LiveErrorEvent {
  type: 'error';
  message: string;
}

export type LiveEvent =
  | LiveTranscriptEvent
  | LiveFinalizedEvent
  | LiveEnrichmentEvent
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
 *   1. User gesture → AudioCaptureSource.start() grabs the MediaStream.
 *   2. WebSocket /qnote/ws/live?session_id=&token= opens.
 *   3. PCMStreamer pipes 16 kHz mono Int16 chunks as binary frames.
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
    });
  }

  stop(): void {
    this.stopped = true;
    try {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ action: 'stop' }));
      }
    } catch { /* ignore */ }
    try { this.pcm?.stop(); } catch { /* ignore */ }
    try { this.capture?.stop(); } catch { /* ignore */ }
    try { this.ws?.close(); } catch { /* ignore */ }
    this.pcm = null;
    this.capture = null;
    this.ws = null;
  }
}
