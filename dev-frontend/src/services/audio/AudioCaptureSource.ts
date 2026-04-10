/**
 * AudioCaptureSource — 캡처 소스 추상화 인터페이스
 *
 * 목적: 마이크/브라우저 탭/네이티브(미래) 캡처를 동일 인터페이스로 다루기.
 * 모든 캡처 구현체는 이 인터페이스를 만족해야 함.
 *
 * 미래 확장:
 *   - NativeAudioCapture (Tauri/Electron 데스크톱 앱)
 *   - MobileAudioCapture (Capacitor iOS/Android)
 *
 * 데이터 포맷 (서버와 합의):
 *   - PCM16 (Linear PCM 16-bit signed little-endian)
 *   - 16,000 Hz mono
 *   - WebSocket binary frame으로 전송
 */

export type CaptureMode = 'microphone' | 'browser_tab';

export interface CaptureCapabilities {
  mode: CaptureMode;
  label: string; // UI 표시용 (예: "마이크", "브라우저 탭")
  description: string;
  isAvailable: () => boolean; // 현재 환경에서 사용 가능한지 (브라우저 호환성)
  requiresUserGesture: boolean; // 사용자 클릭 필요 여부
}

export interface AudioCaptureSource {
  /** 캡처 모드 식별자 */
  readonly mode: CaptureMode;

  /**
   * 캡처 시작.
   * - 사용자 권한 요청 (마이크 권한, 탭 공유 다이얼로그 등)
   * - 성공 시 MediaStream 반환
   * - 실패 시 throw (NotAllowedError, NotFoundError, AbortError 등)
   */
  start(): Promise<MediaStream>;

  /** 캡처 중지 + 리소스 정리 */
  stop(): void;

  /** 현재 활성화 여부 */
  readonly isActive: boolean;
}

/**
 * MediaStream을 PCM16 16kHz mono Int16Array로 변환하는 헬퍼.
 * AudioWorklet 또는 ScriptProcessorNode를 사용.
 *
 * 사용처: WebSocket 전송 직전에 이 변환을 거침.
 * 캡처 소스(Mic/Tab)와 무관하게 동일한 후처리.
 */
export interface PCMConverter {
  /** 변환 시작 — 콜백으로 PCM16 청크가 전달됨 */
  start(stream: MediaStream, onChunk: (pcm: Int16Array) => void): Promise<void>;
  stop(): void;
}
