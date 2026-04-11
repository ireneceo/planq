import { apiFetch, getAccessToken } from '../contexts/AuthContext';

const BASE = '/qnote/api';

export interface QNoteParticipant {
  name: string;
  role?: string | null;
}

/**
 * @deprecated sessions.urls 컬럼은 제거되었음. documents 테이블에 source_type='url' 로 통합.
 * 남겨둔 이유: 기존 참조 오류 방지. 새 코드는 QNoteDocument 사용.
 */
export interface QNoteUrlEntry {
  id: string;
  url: string;
  status: 'pending' | 'fetched' | 'failed';
}

export interface QNoteDocument {
  id: number;
  filename: string;
  original_filename: string;
  file_size: number;
  mime_type: string;
  status: 'pending' | 'processing' | 'indexed' | 'failed';
  source_type: 'file' | 'url';
  source_url: string | null;
  title: string | null;
  error_message: string | null;
  chunk_count: number;
  indexed_at: string | null;
  created_at: string;
}

export interface QNoteSpeaker {
  id: number;
  deepgram_speaker_id: number | null;
  participant_name: string | null;
  is_self: number;
}

export interface QNoteUtterance {
  id: number;
  session_id: number;
  original_text: string;
  translated_text: string | null;
  original_language: string | null;
  is_question: number;
  is_final: number;
  start_time: number | null;
  end_time: number | null;
  confidence: number | null;
  speaker_id: number | null;
  created_at: string;
}

export interface QNoteSession {
  id: number;
  business_id: number;
  user_id: number;
  title: string;
  language: string;
  status: string;
  brief: string | null;
  participants: QNoteParticipant[] | null;
  urls: QNoteUrlEntry[] | null;
  meeting_languages: string[] | null;
  translation_language: string | null;
  answer_language: string | null;
  pasted_context: string | null;
  utterance_count: number;
  created_at: string;
  updated_at: string;
  utterances?: QNoteUtterance[];
  documents?: QNoteDocument[];
  speakers?: QNoteSpeaker[];
}

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  message?: string;
  pagination?: { page: number; limit: number; total: number };
}

async function handle<T>(res: Response): Promise<T> {
  let body: ApiEnvelope<T> | null = null;
  try {
    body = await res.json();
  } catch {
    throw new Error(`HTTP ${res.status}`);
  }
  if (!res.ok || !body?.success) {
    throw new Error(body?.message || `HTTP ${res.status}`);
  }
  return body.data as T;
}

export interface CreateSessionPayload {
  business_id: number;
  title?: string;
  brief?: string;
  participants?: QNoteParticipant[];
  meeting_languages?: string[];
  translation_language?: string;
  answer_language?: string;
  pasted_context?: string;
}

export async function listSessions(businessId: number, page = 1, limit = 20) {
  const res = await apiFetch(`${BASE}/sessions?business_id=${businessId}&page=${page}&limit=${limit}`);
  return handle<QNoteSession[]>(res);
}

export async function getSession(sessionId: number) {
  const res = await apiFetch(`${BASE}/sessions/${sessionId}`);
  return handle<QNoteSession>(res);
}

export async function createSession(payload: CreateSessionPayload) {
  const res = await apiFetch(`${BASE}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return handle<QNoteSession>(res);
}

export async function updateSession(sessionId: number, payload: Partial<CreateSessionPayload> & { status?: string }) {
  const res = await apiFetch(`${BASE}/sessions/${sessionId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return handle<QNoteSession>(res);
}

export async function deleteSession(sessionId: number) {
  const res = await apiFetch(`${BASE}/sessions/${sessionId}`, { method: 'DELETE' });
  return handle<{ id: number }>(res);
}

export async function uploadDocument(sessionId: number, file: File) {
  const form = new FormData();
  form.append('file', file);
  const res = await apiFetch(`${BASE}/sessions/${sessionId}/documents`, {
    method: 'POST',
    body: form,
  });
  return handle<QNoteDocument>(res);
}

export async function deleteDocument(sessionId: number, documentId: number) {
  const res = await apiFetch(`${BASE}/sessions/${sessionId}/documents/${documentId}`, {
    method: 'DELETE',
  });
  return handle<{ id: number }>(res);
}

export async function addUrl(sessionId: number, url: string) {
  const res = await apiFetch(`${BASE}/sessions/${sessionId}/urls`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  return handle<QNoteDocument>(res);
}

export async function deleteUrl(sessionId: number, urlId: number) {
  const res = await apiFetch(`${BASE}/sessions/${sessionId}/urls/${urlId}`, {
    method: 'DELETE',
  });
  return handle<{ id: number }>(res);
}

export async function matchSpeaker(
  sessionId: number,
  speakerId: number,
  body: { participant_name?: string; is_self?: boolean }
) {
  const res = await apiFetch(`${BASE}/sessions/${sessionId}/speakers/${speakerId}/match`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return handle<QNoteSpeaker>(res);
}

export async function mergeSpeakers(sessionId: number, fromSpeakerId: number, intoSpeakerId: number) {
  const res = await apiFetch(
    `${BASE}/sessions/${sessionId}/speakers/${fromSpeakerId}/merge-into/${intoSpeakerId}`,
    { method: 'POST' }
  );
  return handle<{ into: number; from: number }>(res);
}

// ─── 음성 핑거프린트 (다국어) ────────────────────────────

export interface VoiceFingerprintLanguage {
  language: string;
  sample_seconds: number | null;
  created_at: string;
  updated_at: string;
}

export interface VoiceFingerprintList {
  registered: boolean;
  count: number;
  languages: VoiceFingerprintLanguage[];
}

export async function getVoiceFingerprints() {
  const res = await apiFetch(`${BASE}/voice-fingerprint`);
  return handle<VoiceFingerprintList>(res);
}

export async function registerVoiceFingerprint(language: string, wavBlob: Blob) {
  const form = new FormData();
  form.append('language', language);
  form.append('file', wavBlob, 'voice.wav');
  const res = await apiFetch(`${BASE}/voice-fingerprint`, {
    method: 'POST',
    body: form,
  });
  return handle<{ language: string; sample_seconds: number }>(res);
}

export async function deleteVoiceFingerprintLanguage(language: string) {
  const res = await apiFetch(`${BASE}/voice-fingerprint/${encodeURIComponent(language)}`, {
    method: 'DELETE',
  });
  return handle<{ language: string; deleted: boolean }>(res);
}

export async function deleteAllVoiceFingerprints() {
  const res = await apiFetch(`${BASE}/voice-fingerprint`, { method: 'DELETE' });
  return handle<{ registered: boolean }>(res);
}

export interface VoiceTestResult {
  similarity: number;
  threshold: number;
  match: boolean;
  best_language: string;
  per_language: { language: string; similarity: number }[];
  message: string;
}

export async function verifyVoiceMatch(wavBlob: Blob) {
  const form = new FormData();
  form.append('file', wavBlob, 'verify.wav');
  const res = await apiFetch(`${BASE}/voice-fingerprint/test`, {
    method: 'POST',
    body: form,
  });
  return handle<VoiceTestResult>(res);
}

/**
 * Build WebSocket URL for /ws/live.
 * Auth via ?token= query (FastAPI ws_authenticate reads this).
 */
export function buildLiveSocketUrl(sessionId: number): string {
  const token = getAccessToken();
  if (!token) throw new Error('Not authenticated');
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/qnote/ws/live?session_id=${sessionId}&token=${encodeURIComponent(token)}`;
}
