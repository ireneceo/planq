// Q Talk 응답 타입 정의 (실 API 응답 모양과 일치).
// Mock 단계의 prefix `Mock*` 는 호환성 위해 유지 — 후속 사이클에서 일괄 rename 예정.

export type ProjectRole = 'owner' | 'member' | 'client';
export type ChannelType = 'customer' | 'internal' | 'group';
export type ProjectStatus = 'active' | 'paused' | 'closed';
// 백엔드 Task ENUM 과 동기 — CLAUDE.md § Q Task 상태 ENUM
export type TaskStatus =
  | 'not_started' | 'waiting' | 'in_progress'
  | 'reviewing' | 'revision_requested' | 'done_feedback'
  | 'completed' | 'canceled';

export interface MockMember {
  user_id: number;
  name: string;
  role: string;
  avatar_color: string;
  is_default_assignee?: boolean;
}

export interface MockClient {
  user_id: number;
  name: string;
  company: string;
  avatar_color: string;
}

export interface PostCardMeta {
  card_type: 'post';
  post_id: number;
  share_token: string;
  share_url: string;
  title: string;
  note: string | null;
}

export interface SignatureCardMeta {
  card_type: 'signature_request';
  entity_type: 'post' | 'document';
  entity_id: number;
  title: string;
  sign_url: string;
  signers: Array<{ email: string; status: string }>;
  note: string | null;
}

// 통합 공유 6차 — 4 entity 카드 (task/file/kb_document/calendar_event)
export interface TaskCardMeta {
  card_type: 'task';
  task_id: number;
  share_token: string;
  share_url: string;
  title: string;
  note: string | null;
  status?: string;
  due_date?: string | null;
  has_password?: boolean;
}

export interface FileCardMeta {
  card_type: 'file';
  file_id: number;
  share_token: string;
  share_url: string;
  title: string;
  note: string | null;
  mime_type?: string | null;
  file_size?: number;
  has_password?: boolean;
}

export interface KbDocCardMeta {
  card_type: 'kb_document';
  kb_id: number;
  share_token: string;
  share_url: string;
  title: string;
  note: string | null;
  source_type?: string | null;
  has_password?: boolean;
}

export interface CalendarEventCardMeta {
  card_type: 'calendar_event';
  event_id: number;
  share_token: string;
  share_url: string;
  title: string;
  note: string | null;
  start_at?: string;
  end_at?: string;
  has_password?: boolean;
}

export interface InvoiceCardMeta {
  card_type: 'invoice';
  invoice_id: number;
  invoice_number: string;
  share_token: string;
  share_url: string;
  title: string;
  total: number;
  currency: string;
  installment_mode?: 'single' | 'split';
  status?: 'sent' | 'partially_paid' | 'paid' | 'overdue' | 'canceled';
  paid_at?: string | null;
  paid_amount?: number;
  last_notify_at?: string | null;
  last_notify_installment_id?: number | null;
  last_notify_label?: string | null;
  note: string | null;
}

export interface MockMessage {
  id: number;
  conversation_id: number;
  sender_id: number;
  sender_name: string;
  sender_role: 'owner' | 'member' | 'client' | 'cue';
  sender_color: string;
  body: string;
  created_at: string;
  reply_to_message_id?: number | null;
  is_question?: boolean;
  cue_draft?: {
    body: string;
    confidence: number;
    source?: { title: string; section: string };
    processing_by?: { user_id: number; name: string } | null;
  };
  ai_sources?: { doc_id: number; title: string; section: string; snippet: string }[];
  is_ai?: boolean;
  cue_rating?: 1 | -1 | null;
  attachments?: { id: number; file_name: string; file_size: number; mime_type?: string | null }[];
  // #138 — 이모지 리액션 (백엔드가 메시지에 동봉)
  reactions?: { id: number; user_id: number; emoji: string }[];
  card?: PostCardMeta | SignatureCardMeta | InvoiceCardMeta | TaskCardMeta | FileCardMeta | KbDocCardMeta | CalendarEventCardMeta | null;
  translations?: Partial<Record<'ko'|'en'|'ja'|'zh'|'es', string>> | null;
  detected_language?: 'ko'|'en'|'ja'|'zh'|'es' | null;
  // 사이클 N+15-C — 읽음 표시. read_by_count = 본인 제외 참여자 중 읽은 수.
  // other_count = 본인 제외 참여자 총수. 1 = 1:1, 2+ = 그룹.
  read_by_count?: number;
  other_count?: number;
  // 사이클 N+16-E — 메시지 수정 / 삭제 / 핀.
  is_edited?: boolean;
  is_deleted?: boolean;
  edited_at?: string | null;
  pinned_at?: string | null;
}

export interface MockConversation {
  id: number;
  project_id: number | null;
  channel_type: ChannelType;
  name: string;
  auto_extract_enabled: boolean;
  last_message?: string;
  last_message_at?: string | null;
  // 사이클 N+15-D — WhatsApp 스타일 채팅 리스트 한 줄 preview
  last_message_preview?: {
    content: string;
    sender_id: number;
    sender_name: string | null;
    is_ai: boolean;
    is_mine?: boolean; // QTalkPage 가 user.id 와 비교해서 채움
  } | null;
  unread_count: number;
  last_extracted_message_id?: number | null;
  last_extracted_at?: string | null;
  // 사용자 본인의 핀(즐겨찾기) 시각. null/undefined = 핀 안 됨.
  my_pinned_at?: string | null;
  my_last_read_at?: string | null;
}

export interface MockTaskCandidate {
  id: number;
  project_id: number | null;
  conversation_id?: number;
  title: string;
  description: string;
  source_message_ids: number[];
  guessed_assignee?: { user_id: number; name: string };
  guessed_role?: string;
  guessed_due_date?: string;
  similar_task_id?: number;
  status: 'pending' | 'registered' | 'merged' | 'rejected';
}

export interface MockTask {
  id: number;
  project_id: number | null;
  conversation_id?: number | null;
  title: string;
  assignee_id: number;
  assignee_name: string;
  due_date?: string;
  status: TaskStatus;
  recurrence?: string;
}

export interface MockNote {
  id: number;
  project_id: number | null;
  conversation_id?: number | null;
  author_id: number;
  author_name: string;
  visibility: 'personal' | 'internal';
  body: string;
  created_at: string;
}

export interface MockIssue {
  id: number;
  project_id: number | null;
  conversation_id?: number | null;
  body: string;
  author_name: string;
  created_at: string;
  updated_at: string;
}

export interface MockProject {
  id: number;
  name: string;
  description?: string;
  client_company: string;
  status: ProjectStatus;
  start_date?: string;
  end_date?: string;
  default_assignee_id: number;
  color?: string | null;
  members: MockMember[];
  clients: MockClient[];
  unread_count: number;
  has_cue_activity: boolean;
}
