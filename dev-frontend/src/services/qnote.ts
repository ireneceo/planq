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

export type QNoteCaptureMode = 'microphone' | 'web_conference';

export interface QNoteDetectedQuestion {
  utterance_id: number;
  answer_text: string;
  answer_tier: string | null;
  matched_qa_id: number | null;
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
  capture_mode: QNoteCaptureMode | null;
  utterance_count: number;
  created_at: string;
  updated_at: string;
  utterances?: QNoteUtterance[];
  documents?: QNoteDocument[];
  speakers?: QNoteSpeaker[];
  detected_questions?: QNoteDetectedQuestion[];
  // 답변 수준/스타일 제어
  user_language_levels?: Record<string, { reading?: number; speaking?: number; listening?: number; writing?: number }> | null;
  user_expertise_level?: string | null;
  meeting_answer_style?: string | null;
  meeting_answer_length?: string | null;
  keywords?: string[] | null;
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
  capture_mode?: QNoteCaptureMode;
  user_name?: string;
  user_bio?: string;
  user_expertise?: string;
  user_organization?: string;
  user_job_title?: string;
  // 답변 수준 제어
  user_language_levels?: Record<string, { reading?: number; speaking?: number; listening?: number; writing?: number }>;
  user_expertise_level?: 'layman' | 'practitioner' | 'expert';
  meeting_answer_style?: string;
  meeting_answer_length?: 'short' | 'medium' | 'long';
  // NOTE: keywords 는 서버 측에서 brief/pasted/participants/profile 을 기반으로 자동 추출.
  // 필요 시 수동 override 도 받도록 열어둠.
  keywords?: string[];
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

export async function reassignUtteranceSpeaker(
  sessionId: number,
  utteranceId: number,
  body: { participant_name?: string; is_self?: boolean }
) {
  const res = await apiFetch(`${BASE}/sessions/${sessionId}/utterances/${utteranceId}/reassign-speaker`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return handle<{ utterance_id: number; speaker_id: number }>(res);
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

// ─── Q&A Pairs (답변 찾기) ─────────────────────────────────

export interface QAPair {
  id: number;
  session_id: number;
  source: 'custom' | 'generated';
  category: string | null;
  question_text: string;
  answer_text: string | null;
  answer_translation: string | null;
  answer_sources: string | null;
  parent_id: number | null;
  confidence: string | null;
  is_reviewed: number;
  is_priority: number;
  sort_order: number;
  short_answer?: string | null;
  keywords?: string | null;
  source_filename?: string | null;
  has_embedding?: boolean;
  created_at: string;
  updated_at: string | null;
}

export type AnswerTier = 'priority' | 'custom' | 'session_reuse' | 'generated' | 'rag' | 'general' | 'none';

export interface FindAnswerResult {
  tier: AnswerTier;
  answer: string | null;
  answer_translation: string | null;
  confidence: string | null;
  sources: { chunk_id: number; snippet: string }[];
  matched_qa_id: number | null;
}

export interface CachedAnswerResult {
  answer: string;
  answer_tier: string | null;
  matched_qa_id: number | null;
  sources: { chunk_id: number; snippet: string }[];
}

export async function listQAPairs(sessionId: number, source?: string) {
  const qs = source ? `?source=${source}` : '';
  const res = await apiFetch(`${BASE}/sessions/${sessionId}/qa-pairs${qs}`);
  return handle<QAPair[]>(res);
}

export async function createQAPair(sessionId: number, body: { question_text: string; answer_text?: string; category?: string }) {
  const res = await apiFetch(`${BASE}/sessions/${sessionId}/qa-pairs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return handle<QAPair>(res);
}

export async function updateQAPair(sessionId: number, qaId: number, body: { question_text?: string; answer_text?: string; category?: string }) {
  const res = await apiFetch(`${BASE}/sessions/${sessionId}/qa-pairs/${qaId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return handle<QAPair>(res);
}

export async function deleteQAPair(sessionId: number, qaId: number) {
  const res = await apiFetch(`${BASE}/sessions/${sessionId}/qa-pairs/${qaId}`, { method: 'DELETE' });
  return handle<{ id: number }>(res);
}

export async function uploadQACSV(sessionId: number, file: File) {
  const form = new FormData();
  form.append('file', file);
  const res = await apiFetch(`${BASE}/sessions/${sessionId}/qa-pairs/upload-csv`, {
    method: 'POST',
    body: form,
  });
  return handle<{ inserted: number; updated: number; total: number }>(res);
}

export function getQATemplateUrl(sessionId: number): string {
  return `${BASE}/sessions/${sessionId}/qa-pairs/template`;
}

export async function triggerQAGeneration(sessionId: number) {
  const res = await apiFetch(`${BASE}/sessions/${sessionId}/qa-pairs/generate`, { method: 'POST' });
  return handle<{ message: string }>(res);
}

// ─── Priority Q&A (최우선 답변) ───
export async function createPriorityQA(sessionId: number, body: {
  question_text: string;
  answer_text: string;
  short_answer?: string;
  keywords?: string;
  category?: string;
}) {
  const res = await apiFetch(`${BASE}/sessions/${sessionId}/priority-qa`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return handle<QAPair>(res);
}

export async function deletePriorityQA(sessionId: number, qaId: number) {
  const res = await apiFetch(`${BASE}/sessions/${sessionId}/priority-qa/${qaId}`, { method: 'DELETE' });
  return handle<{ id: number }>(res);
}

// ─── Vocabulary (STT 교정용 어휘 사전) ───
export async function generateKeywords(input: {
  brief?: string;
  pasted_context?: string;
  participants?: { name: string; role?: string | null }[];
  include_user_profile?: boolean;
}) {
  const res = await apiFetch(`${BASE}/sessions/generate-keywords`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return handle<{ keywords: string[] }>(res);
}

export async function refreshSessionVocabulary(sessionId: number) {
  const res = await apiFetch(`${BASE}/sessions/${sessionId}/refresh-vocabulary`, {
    method: 'POST',
  });
  return handle<{ total: number; keywords: string[] }>(res);
}

export interface PriorityQAUploadResult {
  created: number;
  updated: number;
  embedded: number;
  parsed: number;
  source_filename: string;
  errors: string[];
}

/**
 * Priority Q&A 파일 업로드.
 * 지원 포맷: csv, tsv, xlsx, xls, json, txt, md, pdf, docx
 * - 구조화 (csv/xlsx/json): 컬럼명 alias 허용 (question/질문/Q, answer/답변/A, ...)
 * - 비구조화 (txt/md/pdf/docx): 정규식 Q/A 패턴 → fallback LLM 추출
 */
export async function uploadPriorityQAFile(sessionId: number, file: File) {
  const form = new FormData();
  form.append('file', file);
  const res = await apiFetch(`${BASE}/sessions/${sessionId}/priority-qa/upload`, {
    method: 'POST',
    body: form,
  });
  return handle<PriorityQAUploadResult>(res);
}

// 구 API 이름 유지 (호환성)
export const uploadPriorityQACSV = uploadPriorityQAFile;

export async function deletePriorityQAByFile(sessionId: number, filename: string) {
  const qs = `?filename=${encodeURIComponent(filename)}`;
  const res = await apiFetch(`${BASE}/sessions/${sessionId}/priority-qa/by-file${qs}`, {
    method: 'DELETE',
  });
  return handle<{ deleted: number; filename: string }>(res);
}

export function getPriorityQATemplateUrl(): string {
  return `${BASE}/sessions/templates/priority-qa-csv`;
}

/**
 * Priority Q&A CSV 템플릿을 인증 헤더와 함께 다운로드한다.
 * `<a href download>` 는 JWT Authorization 헤더를 붙이지 못해 401 을 받으므로
 * blob 으로 가져와 Object URL 로 임시 anchor 를 클릭하는 방식이 필요하다.
 */
export async function downloadPriorityQATemplate(): Promise<void> {
  const res = await apiFetch(`${BASE}/sessions/templates/priority-qa-csv`);
  if (!res.ok) throw new Error(`템플릿 다운로드 실패: HTTP ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = 'priority_qa_template.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export async function findAnswer(sessionId: number, questionText: string, utteranceId?: number) {
  const res = await apiFetch(`${BASE}/sessions/${sessionId}/find-answer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question_text: questionText, utterance_id: utteranceId }),
  });
  return handle<FindAnswerResult>(res);
}

export async function translateAnswer(sessionId: number, text: string, targetLanguage?: string) {
  const body: { question_text: string; target_language?: string } = { question_text: text };
  if (targetLanguage) body.target_language = targetLanguage;
  const res = await apiFetch(`${BASE}/sessions/${sessionId}/translate-answer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return handle<{ translation: string }>(res);
}

export async function getCachedAnswer(sessionId: number, utteranceId: number) {
  const res = await apiFetch(`${BASE}/sessions/${sessionId}/utterances/${utteranceId}/cached-answer`);
  return handle<CachedAnswerResult>(res);
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
