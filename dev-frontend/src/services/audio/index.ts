export type {
  AudioCaptureSource,
  CaptureMode,
  CaptureCapabilities,
  PCMConverter,
} from './AudioCaptureSource';
export { MicrophoneCapture, microphoneCapability } from './MicrophoneCapture';
export { BrowserTabCapture, browserTabCapability } from './BrowserTabCapture';

import type { CaptureCapabilities, CaptureMode, AudioCaptureSource } from './AudioCaptureSource';
import { MicrophoneCapture, microphoneCapability } from './MicrophoneCapture';
import { BrowserTabCapture, browserTabCapability } from './BrowserTabCapture';

/** 사용 가능한 모든 캡처 모드 (UI 드롭다운/카드 렌더링용) */
export const ALL_CAPTURE_CAPABILITIES: CaptureCapabilities[] = [
  microphoneCapability,
  browserTabCapability,
];

/** 모드별 캡처 인스턴스 생성 (팩토리) */
export function createCaptureSource(mode: CaptureMode): AudioCaptureSource {
  switch (mode) {
    case 'microphone':
      return new MicrophoneCapture();
    case 'browser_tab':
      return new BrowserTabCapture();
    default:
      throw new Error(`Unknown capture mode: ${mode}`);
  }
}
