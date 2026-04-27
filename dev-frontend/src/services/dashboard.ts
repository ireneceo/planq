/**
 * Dashboard To do 서비스 — 실 API `/api/dashboard/todo` 연결.
 * 백엔드 집계: 업무(내 담당/컨펌자/요청자)·캘린더(이번주 이벤트)·초대(멤버/고객).
 * 멘션은 messages.read_at 스키마 미도입으로 Phase 8 이후 확장.
 */
import { apiFetch } from '../contexts/AuthContext';

export type TodoPriority = 'urgent' | 'today' | 'waiting' | 'week';

export type TodoType =
  | 'task' | 'event' | 'invite' | 'mention' | 'email'
  | 'task_candidate' | 'invoice'
  | 'signature' | 'payment_notify' | 'tax_invoice';

export type TodoVerb =
  | 'ack'
  | 'confirm'
  | 'approve'
  | 'review'
  | 'pay'
  | 'revise'
  | 'attend'
  | 'respond'
  | 'accept'
  | 'assign'
  | 'read'
  | 'sign'
  | 'mark_paid'
  | 'issue_tax';

export interface TodoItem {
  id: string;                    // 타입 접두어 포함: "task-42", "event-7", "invite-12", "mention-103"
  type: TodoType;
  priority: TodoPriority;
  verb: TodoVerb;                // i18n 키의 verb 파트
  subject: string;               // 액션 대상: "워프로랩 3월 로고 시안 A안"
  context?: string;              // 추가 설명: "요청: Acme, 3시간 전"
  dueAt?: string | null;         // ISO string
  amount?: number;               // 청구서/견적용
  currency?: 'KRW' | 'USD' | 'EUR';
  actor?: { name: string; avatarUrl?: string };
  link?: string;                 // 페이지 이동용
  drawer?: { kind: 'task' | 'event'; id: number };  // 우측 드로어용
  inline?: 'invite';             // Accept/Decline 인라인 버튼 활성화
}

export interface TodoResponse {
  items: TodoItem[];
  counts: Record<TodoPriority, number>;
  total: number;
}

const PRIORITY_ORDER: TodoPriority[] = ['urgent', 'today', 'waiting', 'week'];

export async function fetchTodo(businessId?: number): Promise<TodoResponse> {
  const qs = businessId ? `?business_id=${businessId}` : '';
  const res = await apiFetch(`/api/dashboard/todo${qs}`);
  const json = await res.json();
  if (!json.success) throw new Error(json.message || 'Failed to fetch todo');
  return json.data as TodoResponse;
}

export function groupByPriority(items: TodoItem[]): Record<TodoPriority, TodoItem[]> {
  const out: Record<TodoPriority, TodoItem[]> = { urgent: [], today: [], waiting: [], week: [] };
  items.forEach(it => { out[it.priority].push(it); });
  return out;
}

export const PRIORITY_LIST = PRIORITY_ORDER;
