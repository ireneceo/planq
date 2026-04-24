// Q Talk UI Mock 데이터
// Irene 승인 후 Task #14 에서 실제 API 로 교체됨. Mock 구조는 실제 API 응답 모양과 동일하게.

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
  role: string; // 프로젝트 역할: '디자인','개발','기획' 등
  avatar_color: string;
  is_default_assignee?: boolean;
}

export interface MockClient {
  user_id: number;
  name: string;
  company: string;
  avatar_color: string;
}

export interface MockMessage {
  id: number;
  conversation_id: number;
  sender_id: number;
  sender_name: string;
  sender_role: 'owner' | 'member' | 'client' | 'cue';
  sender_color: string;
  body: string;
  created_at: string; // ISO
  reply_to_message_id?: number | null;
  is_question?: boolean;
  cue_draft?: {
    body: string;
    confidence: number;
    source?: { title: string; section: string };
    processing_by?: { user_id: number; name: string } | null;
  };
  ai_sources?: { doc_id: number; title: string; section: string; snippet: string }[];
  attachments?: { id: number; file_name: string; file_size: number; mime_type?: string | null }[];
}

export interface MockConversation {
  id: number;
  project_id: number;
  channel_type: ChannelType;
  name: string;
  auto_extract_enabled: boolean;
  last_message?: string;
  unread_count: number;
  last_extracted_message_id?: number | null;
  last_extracted_at?: string | null;
}

export interface MockTaskCandidate {
  id: number;
  project_id: number;
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
  project_id: number;
  title: string;
  assignee_id: number;
  assignee_name: string;
  due_date?: string;
  status: TaskStatus;
  recurrence?: string;
}

export interface MockNote {
  id: number;
  project_id: number;
  author_id: number;
  author_name: string;
  visibility: 'personal' | 'internal';
  body: string;
  created_at: string;
}

export interface MockIssue {
  id: number;
  project_id: number;
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

// ─────────────────────────────────────────────
// 샘플 데이터
// ─────────────────────────────────────────────

const MEMBERS: MockMember[] = [
  { user_id: 15, name: '김오너', role: '기획', avatar_color: '#F43F5E', is_default_assignee: true },
  { user_id: 16, name: '이디자', role: '디자인', avatar_color: '#0D9488' },
  { user_id: 17, name: '박개발', role: '개발', avatar_color: '#7C3AED' },
];

const CLIENT_HONG: MockClient = { user_id: 18, name: '최고객', company: 'Acme Corp', avatar_color: '#F59E0B' };
const CLIENT_LEE: MockClient = { user_id: 19, name: '이대표', company: 'Beta Industries', avatar_color: '#2563EB' };

export const MOCK_PROJECTS: MockProject[] = [
  {
    id: 1,
    name: '브랜드 리뉴얼',
    description: '로고 + 컬러 + 웹사이트 리뉴얼',
    client_company: 'Acme Corp',
    status: 'active',
    start_date: '2026-03-01',
    end_date: '2026-05-31',
    default_assignee_id: 15,
    members: MEMBERS,
    clients: [CLIENT_HONG],
    unread_count: 3,
    has_cue_activity: true,
  },
  {
    id: 2,
    name: '패키지 디자인',
    description: '신제품 패키지 디자인 프로젝트',
    client_company: 'Beta Industries',
    status: 'active',
    start_date: '2026-04-01',
    default_assignee_id: 16,
    members: [MEMBERS[0], MEMBERS[1]],
    clients: [CLIENT_LEE],
    unread_count: 0,
    has_cue_activity: false,
  },
  {
    id: 3,
    name: '내부 툴 개선',
    client_company: '(내부 프로젝트)',
    status: 'paused',
    default_assignee_id: 17,
    members: [MEMBERS[0], MEMBERS[2]],
    clients: [],
    unread_count: 1,
    has_cue_activity: false,
  },
];

export const MOCK_CONVERSATIONS: MockConversation[] = [
  { id: 101, project_id: 1, channel_type: 'internal', name: '내부 논의', auto_extract_enabled: false, last_message: '폰트 확인해봐야 할 듯', unread_count: 1 },
  { id: 102, project_id: 1, channel_type: 'customer', name: 'Acme 과의 소통', auto_extract_enabled: true, last_message: '금요일까지 시안 가능할까요?', unread_count: 2 },
  { id: 201, project_id: 2, channel_type: 'internal', name: '내부 논의', auto_extract_enabled: false, last_message: '컬러 레퍼런스 공유', unread_count: 0 },
  { id: 202, project_id: 2, channel_type: 'customer', name: 'Beta 와의 소통', auto_extract_enabled: true, last_message: '감사합니다', unread_count: 0 },
  { id: 301, project_id: 3, channel_type: 'internal', name: '내부 논의', auto_extract_enabled: false, last_message: '일정 재조정', unread_count: 1 },
];

export const MOCK_MESSAGES: Record<number, MockMessage[]> = {
  102: [
    {
      id: 5001, conversation_id: 102, sender_id: 18, sender_name: '최고객 (Acme)',
      sender_role: 'client', sender_color: '#F59E0B',
      body: '안녕하세요. 로고 리뉴얼 진행 상황이 어떻게 되고 있는지 확인 부탁드려요.',
      created_at: '2026-04-15T09:30:00Z',
    },
    {
      id: 5002, conversation_id: 102, sender_id: 15, sender_name: '김오너',
      sender_role: 'owner', sender_color: '#F43F5E',
      body: '안녕하세요 최 대표님. 현재 1차 시안 3종 작업 중이고 이번 주 금요일까지 전달 드릴 예정입니다.',
      created_at: '2026-04-15T09:32:00Z',
    },
    {
      id: 5003, conversation_id: 102, sender_id: 18, sender_name: '최고객 (Acme)',
      sender_role: 'client', sender_color: '#F59E0B',
      body: '시안은 기존 컬러 방향 유지인가요, 아니면 새로운 방향도 섞이나요?',
      created_at: '2026-04-15T09:35:00Z',
      is_question: true,
      cue_draft: {
        body: '기존 컬러 방향(틸 계열)을 기반으로 하고, 보조색 2종(코랄 / 샌드)을 추가 제안 드릴 예정입니다. 목요일 내부 검토 후 금요일 전달 드리겠습니다.',
        confidence: 0.88,
        source: { title: '브랜드 리뉴얼 제안서 v3', section: '§2.3 컬러 시스템' },
      },
    },
    {
      id: 5004, conversation_id: 102, sender_id: 16, sender_name: '이디자',
      sender_role: 'member', sender_color: '#0D9488',
      body: '참고 이미지도 같이 보내드릴게요. 폰트 선정은 내일 확인 부탁드립니다.',
      created_at: '2026-04-15T10:12:00Z',
    },
    {
      id: 5005, conversation_id: 102, sender_id: 18, sender_name: '최고객 (Acme)',
      sender_role: 'client', sender_color: '#F59E0B',
      body: '금요일까지 시안 가능할까요? 월요일 임원 미팅이 잡혀있어서 조금 빠르면 좋겠는데요.',
      created_at: '2026-04-15T10:42:00Z',
      is_question: true,
      cue_draft: {
        body: '금요일 오후 4시까지 1차 시안 전달 가능합니다. 월요일 미팅에 맞춰 주말 전 피드백 주시면 바로 반영 작업 들어가겠습니다.',
        confidence: 0.91,
        source: { title: '작업 일정 가이드', section: '§1 시안 납기' },
        processing_by: { user_id: 15, name: '김오너' },
      },
    },
  ],
  101: [
    {
      id: 4001, conversation_id: 101, sender_id: 15, sender_name: '김오너',
      sender_role: 'owner', sender_color: '#F43F5E',
      body: '시안 방향 내부 정리 필요. 폰트는 Pretendard 기반으로 볼까?',
      created_at: '2026-04-15T09:00:00Z',
    },
    {
      id: 4002, conversation_id: 101, sender_id: 16, sender_name: '이디자',
      sender_role: 'member', sender_color: '#0D9488',
      body: '네. Pretendard + Noto Serif 조합으로 테스트 해볼게요. 라이선스 확인도 필요할 것 같아요.',
      created_at: '2026-04-15T09:04:00Z',
    },
    {
      id: 4003, conversation_id: 101, sender_id: 15, sender_name: '김오너',
      sender_role: 'owner', sender_color: '#F43F5E',
      body: '폰트 확인해봐야 할 듯',
      created_at: '2026-04-15T10:20:00Z',
    },
  ],
};

export const MOCK_TASKS: MockTask[] = [
  { id: 901, project_id: 1, title: '로고 시안 3종 1차 제안', assignee_id: 16, assignee_name: '이디자', due_date: '2026-04-18', status: 'in_progress' },
  { id: 902, project_id: 1, title: '폰트 라이선스 검토', assignee_id: 16, assignee_name: '이디자', due_date: '2026-04-16', status: 'not_started' },
  { id: 903, project_id: 1, title: '컬러 팔레트 확정', assignee_id: 15, assignee_name: '김오너', due_date: '2026-04-22', status: 'reviewing' },
  { id: 904, project_id: 1, title: '매주 월요일 스탠드업', assignee_id: 15, assignee_name: '김오너', status: 'in_progress', recurrence: 'weekly' },
  { id: 905, project_id: 1, title: '웹사이트 와이어프레임', assignee_id: 17, assignee_name: '박개발', due_date: '2026-05-02', status: 'waiting' },
];

export const MOCK_CANDIDATES: MockTaskCandidate[] = [
  {
    id: 7001, project_id: 1,
    title: '금요일까지 1차 시안 3종 전달',
    description: '고객이 월요일 임원 미팅 때문에 금요일까지 요청. 기존 컬러 방향 유지 + 보조색 2종 제안.',
    source_message_ids: [5005],
    guessed_assignee: { user_id: 16, name: '이디자' },
    guessed_role: '디자인',
    guessed_due_date: '2026-04-18',
    similar_task_id: 901,
    status: 'pending',
  },
  {
    id: 7002, project_id: 1,
    title: '참고 이미지 모음 공유',
    description: '이디자가 참고 이미지 준비해서 전달 예정',
    source_message_ids: [5004],
    guessed_assignee: { user_id: 16, name: '이디자' },
    guessed_role: '디자인',
    status: 'pending',
  },
];

export const MOCK_NOTES: MockNote[] = [
  { id: 8001, project_id: 1, author_id: 15, author_name: '김오너', visibility: 'internal', body: '폰트 라이선스는 Pretendard 무료 확인, Noto Serif OFL 확인 필요', created_at: '2026-04-15T08:30:00Z' },
  { id: 8002, project_id: 1, author_id: 15, author_name: '김오너', visibility: 'personal', body: '월요일 전까지 시안 피드백 반영 일정 계산 — 주말 작업 없이 가능한지 체크', created_at: '2026-04-14T22:10:00Z' },
  { id: 8003, project_id: 1, author_id: 16, author_name: '이디자', visibility: 'internal', body: '컬러 시스템 가이드라인 문서화 필요 — 향후 유지보수 용이성 위해', created_at: '2026-04-14T17:45:00Z' },
  { id: 8004, project_id: 1, author_id: 15, author_name: '김오너', visibility: 'internal', body: '예산 재검토 필요 — 웹사이트 개발 범위 논의', created_at: '2026-04-13T11:20:00Z' },
];

export const MOCK_ISSUES: MockIssue[] = [
  { id: 9001, project_id: 1, body: '로고 시안 3종 금요일 납기, 월요일 임원 미팅 예정', author_name: '김오너', created_at: '2026-04-15T10:45:00Z', updated_at: '2026-04-15T10:45:00Z' },
  { id: 9002, project_id: 1, body: '폰트 라이선스 검토 중 — Noto Serif OFL 확인 필요', author_name: '이디자', created_at: '2026-04-14T14:20:00Z', updated_at: '2026-04-14T14:20:00Z' },
  { id: 9003, project_id: 1, body: '웹사이트 개발 범위 재정의 필요 — 예산 재검토', author_name: '김오너', created_at: '2026-04-13T09:10:00Z', updated_at: '2026-04-13T09:10:00Z' },
  { id: 9004, project_id: 1, body: '컬러 팔레트 A안 vs B안 이견 → 4/18 미팅에서 결정', author_name: '김오너', created_at: '2026-04-11T16:30:00Z', updated_at: '2026-04-12T08:00:00Z' },
];

// 상태 → 한국어 라벨 (Q Talk 우측 패널 기본 뷰). 관점별 섬세 라벨은 utils/taskLabel.ts
export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  not_started: '미진행',
  waiting: '진행대기',
  in_progress: '진행중',
  reviewing: '검토중',
  revision_requested: '수정요청',
  done_feedback: '피드백',
  completed: '완료',
  canceled: '취소',
};

export const TASK_STATUS_COLOR: Record<TaskStatus, { bg: string; fg: string }> = {
  not_started: { bg: '#F1F5F9', fg: '#475569' },
  waiting: { bg: '#E0E7FF', fg: '#3730A3' },
  in_progress: { bg: '#CCFBF1', fg: '#0F766E' },
  reviewing: { bg: '#FCE7F3', fg: '#9F1239' },
  revision_requested: { bg: '#FED7AA', fg: '#9A3412' },
  done_feedback: { bg: '#DBEAFE', fg: '#1E40AF' },
  completed: { bg: '#D1FAE5', fg: '#065F46' },
  canceled: { bg: '#F1F5F9', fg: '#94A3B8' },
};

// 알 수 없는 상태(구버전·미래 ENUM)를 위한 fallback — RightPanel 에서 undefined 접근 방지
const TASK_STATUS_FALLBACK = { bg: '#F1F5F9', fg: '#475569' } as const;
export function taskStatusColor(status: string | null | undefined): { bg: string; fg: string } {
  if (!status) return TASK_STATUS_FALLBACK;
  return (TASK_STATUS_COLOR as Record<string, { bg: string; fg: string }>)[status] || TASK_STATUS_FALLBACK;
}
export function taskStatusLabel(status: string | null | undefined): string {
  if (!status) return '';
  return (TASK_STATUS_LABEL as Record<string, string>)[status] || status;
}

// 시각 포맷은 utils/dateFormat.ts + hooks/useTimeFormat 로 이동 (워크스페이스 tz 반영).
