import { apiFetch } from '../contexts/AuthContext';

/**
 * Q Talk API client — 실데이터 기반. Mock 아님.
 * 백엔드: /opt/planq/dev-backend/routes/projects.js (+ 후속 라우트)
 */

// ─────────────────────────────────────────────
// 공통 타입
// ─────────────────────────────────────────────
export type ProjectStatus = 'active' | 'paused' | 'closed';
export type ChannelType = 'customer' | 'internal' | 'group';

export interface ApiProjectMember {
  id: number;
  user_id: number;
  role: string;
  role_order: number;
  User?: { id: number; name: string; email: string };
}

export interface ApiProjectClient {
  id: number;
  project_id: number;
  client_id: number | null;
  contact_user_id: number | null;
  contact_name: string | null;
  contact_email: string | null;
  invited_at: string;
}

export interface ApiProject {
  id: number;
  business_id: number;
  name: string;
  description: string | null;
  client_company: string | null;
  status: ProjectStatus;
  start_date: string | null;
  end_date: string | null;
  default_assignee_user_id: number | null;
  owner_user_id: number;
  color: string | null;
  created_at: string;
  updated_at: string;
  Business?: { id: number; brand_name: string | null; name: string; slug: string };
  projectMembers?: ApiProjectMember[];
  projectClients?: ApiProjectClient[];
  my_role_in_project?: 'owner' | 'member' | 'client';
}

// ─────────────────────────────────────────────
// 응답 헬퍼
// ─────────────────────────────────────────────
async function handle<T>(res: Response): Promise<T> {
  let body: { success: boolean; data?: T; message?: string } | null = null;
  try { body = await res.json(); } catch { throw new Error(`HTTP ${res.status}`); }
  if (!res.ok || !body?.success) {
    throw new Error(body?.message || `HTTP ${res.status}`);
  }
  return body.data as T;
}

// ─────────────────────────────────────────────
// Projects
// ─────────────────────────────────────────────
export interface CreateProjectInput {
  business_id: number;
  name: string;
  description?: string;
  client_company?: string;
  start_date?: string;
  end_date?: string;
  color?: string;
  members: Array<{ user_id: number; role: string; is_default: boolean }>;
  clients: Array<{ name: string; email?: string }>;
}

export async function createProject(input: CreateProjectInput): Promise<ApiProject> {
  const res = await apiFetch('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return handle<ApiProject>(res);
}

export async function listProjects(businessId: number, status?: ProjectStatus): Promise<ApiProject[]> {
  const qs = new URLSearchParams({ business_id: String(businessId) });
  if (status) qs.set('status', status);
  const res = await apiFetch(`/api/projects?${qs.toString()}`);
  return handle<ApiProject[]>(res);
}

export async function getProject(id: number): Promise<ApiProject> {
  const res = await apiFetch(`/api/projects/${id}`);
  return handle<ApiProject>(res);
}

export async function updateProject(id: number, patch: Partial<Pick<ApiProject, 'name' | 'description' | 'client_company' | 'start_date' | 'end_date' | 'status' | 'default_assignee_user_id' | 'color'>>): Promise<ApiProject> {
  const res = await apiFetch(`/api/projects/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  return handle<ApiProject>(res);
}

export async function closeProject(id: number): Promise<{ id: number; status: string }> {
  const res = await apiFetch(`/api/projects/${id}`, { method: 'DELETE' });
  return handle(res);
}

// ─────────────────────────────────────────────
// Workspace 멤버 (프로젝트 생성 모달에서 사용)
// ─────────────────────────────────────────────
export interface WorkspaceMemberRow {
  id: number;
  business_id: number;
  user_id: number;
  role: 'owner' | 'member' | 'ai';
  user: { id: number; name: string; email: string };
}

export async function listBusinessMembers(businessId: number): Promise<WorkspaceMemberRow[]> {
  const res = await apiFetch(`/api/businesses/${businessId}/members`);
  return handle<WorkspaceMemberRow[]>(res);
}

export async function updateProjectMembers(
  id: number,
  members: Array<{ user_id: number; role: string }>
): Promise<ApiProject> {
  const res = await apiFetch(`/api/projects/${id}/members`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ members }),
  });
  return handle<ApiProject>(res);
}

// ─────────────────────────────────────────────
// 읽기 전용 엔드포인트 (청크 2~5 완료 전 UI 가 데이터 표시용으로 사용)
// ─────────────────────────────────────────────
export interface ApiConversation {
  id: number;
  business_id: number;
  project_id: number | null;
  channel_type: 'customer' | 'internal' | 'group';
  display_name: string | null;
  title: string | null;
  status: string;
  auto_extract_enabled: boolean;
  cue_enabled: boolean;
  last_extracted_message_id: number | null;
  created_at: string;
}

export interface ApiMessage {
  id: number;
  conversation_id: number;
  sender_id: number;
  content: string;
  kind: 'text' | 'system' | 'card';
  is_ai: boolean;
  is_internal: boolean;
  reply_to_message_id: number | null;
  ai_draft_approved: boolean | null;
  ai_mode_used?: string;
  ai_confidence?: number;
  ai_source?: string;
  is_edited?: boolean;
  createdAt: string;
  updatedAt: string;
  sender?: { id: number; name: string; email: string };
}

export interface ApiTask {
  id: number;
  project_id: number | null;
  business_id: number;
  title: string;
  assigned_to: number | null;
  status: string;
  due_date: string | null;
  recurrence: string | null;
  createdAt: string;
}

export interface ApiNote {
  id: number;
  project_id: number;
  author_user_id: number;
  visibility: 'personal' | 'internal';
  body: string;
  createdAt: string;
  updatedAt: string;
  author?: { id: number; name: string };
}

export interface ApiIssue {
  id: number;
  project_id: number;
  body: string;
  author_user_id: number;
  createdAt: string;
  updatedAt: string;
  author?: { id: number; name: string };
}

export interface ApiTaskCandidate {
  id: number;
  project_id: number;
  conversation_id: number | null;
  title: string;
  description: string | null;
  guessed_role: string | null;
  guessed_assignee_user_id: number | null;
  guessed_due_date: string | null;
  similar_task_id: number | null;
  status: 'pending' | 'registered' | 'merged' | 'rejected';
  extracted_at: string;
  guessedAssignee?: { id: number; name: string };
}

export async function listProjectConversations(projectId: number): Promise<ApiConversation[]> {
  const res = await apiFetch(`/api/projects/${projectId}/conversations`);
  return handle<ApiConversation[]>(res);
}

export async function listConversationMessages(conversationId: number): Promise<ApiMessage[]> {
  const res = await apiFetch(`/api/projects/conversations/${conversationId}/messages`);
  return handle<ApiMessage[]>(res);
}

export async function listProjectTasks(projectId: number): Promise<ApiTask[]> {
  const res = await apiFetch(`/api/projects/${projectId}/tasks`);
  return handle<ApiTask[]>(res);
}

export async function listProjectNotes(projectId: number): Promise<ApiNote[]> {
  const res = await apiFetch(`/api/projects/${projectId}/notes`);
  return handle<ApiNote[]>(res);
}

export async function listProjectIssues(projectId: number): Promise<ApiIssue[]> {
  const res = await apiFetch(`/api/projects/${projectId}/issues`);
  return handle<ApiIssue[]>(res);
}

export async function listProjectCandidates(projectId: number): Promise<ApiTaskCandidate[]> {
  const res = await apiFetch(`/api/projects/${projectId}/task-candidates`);
  return handle<ApiTaskCandidate[]>(res);
}

// ─────────────────────────────────────────────
// 쓰기 엔드포인트 — 청크 2: 메시지 전송 + 채널 설정
// ─────────────────────────────────────────────
export async function sendMessage(conversationId: number, content: string, replyTo?: number): Promise<ApiMessage> {
  const res = await apiFetch(`/api/projects/conversations/${conversationId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, reply_to_message_id: replyTo || null }),
  });
  return handle<ApiMessage>(res);
}

export async function updateConversation(conversationId: number, patch: { display_name?: string; auto_extract_enabled?: boolean }): Promise<ApiConversation> {
  const res = await apiFetch(`/api/projects/conversations/${conversationId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  return handle<ApiConversation>(res);
}

// ─────────────────────────────────────────────
// 청크 4 — 이슈 / 메모 / 업무 쓰기
// ─────────────────────────────────────────────
export async function addIssue(projectId: number, body: string): Promise<ApiIssue> {
  const res = await apiFetch(`/api/projects/${projectId}/issues`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body }),
  });
  return handle<ApiIssue>(res);
}

export async function updateIssue(issueId: number, body: string): Promise<ApiIssue> {
  const res = await apiFetch(`/api/projects/issues/${issueId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body }),
  });
  return handle<ApiIssue>(res);
}

export async function deleteIssue(issueId: number): Promise<{ id: number; deleted: boolean }> {
  const res = await apiFetch(`/api/projects/issues/${issueId}`, { method: 'DELETE' });
  return handle(res);
}

export async function addNote(projectId: number, body: string, visibility: 'personal' | 'internal'): Promise<ApiNote> {
  const res = await apiFetch(`/api/projects/${projectId}/notes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body, visibility }),
  });
  return handle<ApiNote>(res);
}

export async function deleteNote(noteId: number): Promise<{ id: number; deleted: boolean }> {
  const res = await apiFetch(`/api/projects/notes/${noteId}`, { method: 'DELETE' });
  return handle(res);
}

export async function updateTaskStatus(taskId: number, status: string): Promise<ApiTask> {
  const res = await apiFetch(`/api/projects/tasks/${taskId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  return handle<ApiTask>(res);
}

// ─────────────────────────────────────────────
// 청크 3 — 업무 후보 추출 + 등록/병합/거절
// ─────────────────────────────────────────────
export interface ExtractResult {
  candidates: ApiTaskCandidate[];
  message_count: number;
  skipped: boolean;
  reason?: string;
  fallback?: boolean;
}

export interface RegisterResult {
  candidate: ApiTaskCandidate;
  task: ApiTask;
}

export interface MergeResult {
  candidate: ApiTaskCandidate;
  task: ApiTask;
}

export async function extractTaskCandidates(conversationId: number): Promise<ExtractResult> {
  const res = await apiFetch(`/api/projects/conversations/${conversationId}/task-candidates/extract`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  return handle<ExtractResult>(res);
}

export async function registerCandidate(candidateId: number): Promise<RegisterResult> {
  const res = await apiFetch(`/api/projects/task-candidates/${candidateId}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  return handle<RegisterResult>(res);
}

export async function mergeCandidate(candidateId: number, targetTaskId: number): Promise<MergeResult> {
  const res = await apiFetch(`/api/projects/task-candidates/${candidateId}/merge-into/${targetTaskId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  return handle<MergeResult>(res);
}

export async function rejectCandidate(candidateId: number): Promise<ApiTaskCandidate> {
  const res = await apiFetch(`/api/projects/task-candidates/${candidateId}/reject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  return handle<ApiTaskCandidate>(res);
}

// ─────────────────────────────────────────────
// Cue Draft 승인/거절
// ─────────────────────────────────────────────
export async function approveDraft(messageId: number, editedContent?: string): Promise<ApiMessage> {
  const res = await apiFetch(`/api/projects/messages/${messageId}/approve-draft`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ edited_content: editedContent || undefined }),
  });
  return handle<ApiMessage>(res);
}

export async function rejectDraft(messageId: number): Promise<ApiMessage> {
  const res = await apiFetch(`/api/projects/messages/${messageId}/reject-draft`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  return handle<ApiMessage>(res);
}
