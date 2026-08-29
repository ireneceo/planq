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
  | { type: 'closed'; code?: number }
  // 소리가 한 조각도 안 들어옴 — "녹음 중" 인데 아무것도 안 담기는 상태를 사용자에게 알리기 위한 신호.
  | { type: 'no_audio' };

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
  private silenceTimer: number | null = null;
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

    this.ws.onclose = (ev) => {
      // 비용폭탄 C1 — close code 전달 (4030 한도초과 / 4031 비멤버 / 4029 동시녹음 등 UI 안내용).
      if (!this.stopped) this.opts.onEvent({ type: 'closed', code: ev.code });
    };

    this.pcm = new PCMStreamer();
    let sentAny = false;
    await this.pcm.start(stream, (chunk) => {
      sentAny = true;
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        const buf = chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer;
        this.ws.send(buf);
      }
    }, isStereo);

    // ★ 조용한 실패 감시 — 이번 사고(2026-08-29)의 본질은 "오류 없이 아무것도 녹음 안 됨" 이었다.
    //   AudioContext 를 깨우는 것으로 원인은 막았지만, 마이크가 다른 앱에 잡히거나 장치가 바뀌는 등
    //   **소리가 안 들어오는 다른 이유**는 여전히 있을 수 있다. 그때도 사용자가 알아야 한다.
    //   판정은 "오디오 조각이 한 번도 안 왔는가" — 무음 감지가 아니다(조용한 회의를 오탐하지 않게).
    this.silenceTimer = window.setTimeout(() => {
      if (!this.stopped && !sentAny) this.opts.onEvent({ type: 'no_audio' });
    }, 5000);
  }

  /** #241 — 회의 중 번역 설정을 바꿨을 때 서버 캐시를 갱신시킨다.
   *  live.py 는 연결 시 1회만 설정을 읽으므로, 이 신호가 없으면 "켰는데 안 나온다" 가 된다. */
  reloadSettings(): void {
    try {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ action: 'settings:reload' }));
      }
    } catch { /* 녹음이 안 돌고 있으면 무시 — 다음 연결 때 새 설정으로 읽는다 */ }
  }

  stop(): void {
    this.stopped = true;
    try {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ action: 'stop' }));
      }
    } catch { /* ignore */ }
    if (this.silenceTimer) { window.clearTimeout(this.silenceTimer); this.silenceTimer = null; }
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
