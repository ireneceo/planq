import { buildLiveSocketUrl } from './qnote';
import { apiFetch } from '../contexts/AuthContext';
import { createCaptureSource } from './audio';
import type { CaptureMode, AudioCaptureSource } from './audio';
import { PCMStreamer } from './audio/PCMStreamer';
import { WavRecorder } from './audio/recordToWav';
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

export interface LiveSelfMatchedEvent {
  type: 'self_matched';
  speaker_id: number;
  deepgram_speaker_id: number;
  similarity: number;
}

export interface LiveSelfMatchFailedEvent {
  type: 'self_match_failed';
  reason: string;
  similarity?: number;
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
  | LiveSelfMatchedEvent
  | LiveSelfMatchFailedEvent
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
  private selfVoiceRecorder: WavRecorder | null = null;
  private selfVoiceTimer: number | null = null;
  private selfVoiceUploaded = false;
  // dg_speaker_id 관찰 — 마이크 캡처 창 동안 등장한 ID 집계
  private dgSpeakerObservation = new Map<number, number>();
  private readonly opts: LiveSessionOptions;
  private stopped = false;

  constructor(opts: LiveSessionOptions) {
    this.opts = opts;
  }

  async start(): Promise<void> {
    this.capture = createCaptureSource(this.opts.captureMode);
    const stream = await this.capture.start();

    // 웹 화상회의 모드: 마이크 전용 스트림을 동시 캡처 → 10초 누적 후 서버로 업로드
    // (믹스된 메인 스트림은 Deepgram 으로만 가고, 본인 식별은 깨끗한 마이크 샘플로)
    if (this.capture instanceof WebConferenceCapture) {
      const micOnly = this.capture.getMicOnlyStream();
      if (micOnly) {
        this.scheduleSelfVoiceUpload(micOnly).catch((e) =>
          console.warn('self voice upload setup failed:', e)
        );
      }
    }

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
        // 본인 매칭 힌트 수집: 첫 10초 동안 finalized 이벤트의 dg_speaker_id 카운트
        if (
          !this.selfVoiceUploaded &&
          parsed.type === 'finalized' &&
          typeof parsed.deepgram_speaker_id === 'number'
        ) {
          const id = parsed.deepgram_speaker_id;
          this.dgSpeakerObservation.set(id, (this.dgSpeakerObservation.get(id) || 0) + 1);
        }
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

  /**
   * 마이크 전용 스트림에서 10초를 수집해 /self-voice-sample 에 업로드.
   * 세션당 1회만 실행. WavRecorder 는 별도 AudioContext 를 사용하므로
   * 메인 PCMStreamer 와 경합 없이 병렬 동작.
   */
  private async scheduleSelfVoiceUpload(micOnly: MediaStream): Promise<void> {
    if (this.selfVoiceUploaded) return;
    const rec = new WavRecorder();
    await rec.startFromExistingStream(micOnly);
    this.selfVoiceRecorder = rec;

    this.selfVoiceTimer = window.setTimeout(async () => {
      if (this.selfVoiceUploaded || !this.selfVoiceRecorder) return;
      try {
        const wav = await this.selfVoiceRecorder.stop();
        this.selfVoiceRecorder = null;
        this.selfVoiceUploaded = true;
        // 관찰된 dg_speaker_id 중 가장 많이 등장한 하나를 힌트로 전달
        let dgHint: number | null = null;
        let maxCount = 0;
        this.dgSpeakerObservation.forEach((cnt, id) => {
          if (cnt > maxCount) { maxCount = cnt; dgHint = id; }
        });
        const form = new FormData();
        form.append('file', wav, 'self-voice.wav');
        if (dgHint !== null) form.append('dg_speaker_hint', String(dgHint));
        const res = await apiFetch(
          `/qnote/api/sessions/${this.opts.sessionId}/self-voice-sample`,
          { method: 'POST', body: form }
        );
        if (res.ok) {
          const data = await res.json();
          if (data?.success) {
            if (data.data.matched) {
              this.opts.onEvent({
                type: 'self_matched',
                speaker_id: data.data.speaker_id,
                deepgram_speaker_id: data.data.dg_speaker_id,
                similarity: data.data.similarity,
              });
            } else {
              // 매칭 실패 — 사용자가 원인 파악 가능하도록 명시 피드백
              const sim = data.data.similarity ?? 0;
              const reason = sim < (data.data.threshold || 0.68)
                ? `유사도 ${sim.toFixed(2)} (임계값 ${data.data.threshold}) — 프로필에서 다른 언어 등록을 추가해보세요`
                : `대상 화자를 찾지 못했습니다 — 10초 이상 말씀해주시거나 회의 종료 후 수동 지정 가능`;
              this.opts.onEvent({
                type: 'self_match_failed',
                reason,
                similarity: sim,
              });
            }
          }
        } else {
          const errData = await res.json().catch(() => null);
          this.opts.onEvent({
            type: 'self_match_failed',
            reason: errData?.detail || errData?.message || `HTTP ${res.status}`,
          });
        }
      } catch (e) {
        console.warn('self voice upload failed:', e);
        this.opts.onEvent({
          type: 'self_match_failed',
          reason: e instanceof Error ? e.message : '네트워크 오류',
        });
      }
    }, 10000) as unknown as number;
  }

  stop(): void {
    this.stopped = true;
    if (this.selfVoiceTimer) { clearTimeout(this.selfVoiceTimer); this.selfVoiceTimer = null; }
    if (this.selfVoiceRecorder) {
      this.selfVoiceRecorder.stop().catch(() => {});
      this.selfVoiceRecorder = null;
    }
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
