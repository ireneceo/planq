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
  | 'leave'          // 휴가 승인 대기 (승인권자에게만 — routes/dashboard.collectLeaveApprovals)
  | 'signature' | 'payment_notify' | 'tax_invoice'
  | 'invoice_draft'  // 발행 대기 정기 청구서 초안 (owner/admin)
  | 'sale'           // Q sale — 답 안 한 문의·미확인 자동기록·다음 할 일 없음·계정 요청 (담당자 귀속)
  | 'planq_subscription';  // PlanQ 플랫폼 → 워크스페이스 구독 청구 (owner 만)

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
  | 'issue_tax'
  | 'issue'
  | 'candidate_other'
  | 'sign_rejected'
  // #239 — 받은 문서 확인 요청. 업무 승인 verb(confirm)와 뜻이 달라 갈라 둔다.
  | 'doc_confirm'
  // #239 — 외부인이 문서에 의견을 남김. 거절이 아니다.
  | 'doc_commented'
  // Q sale (사이클 1b) — 각각 무엇을 해야 하는지가 동사에 있다
  | 'sale_first_reply'      // 답 안 한 문의 — 첫 응답을 보낸다
  | 'sale_unreviewed'       // 자동으로 쌓인 기록을 확인한다
  | 'sale_next_action'      // 다음 할 일이 없다 — 정한다
  | 'sale_account_request'; // 게스트가 계정을 요청했다 — 초대를 보낸다

export interface TodoWorkspace {
  business_id: number;
  brand_name: string;
  role: 'owner' | 'member' | 'client' | 'admin';
}

export interface TodoItem {
  /** 단계 표시 — 외부컨펌이면 'external_review'. 할 일(verb)·리스트업 조건은 바꾸지 않는다(services/reviewStage). */
  stage?: 'external_review' | null;
  id: string;                    // 타입 접두어 포함: "task-42", "event-7", "invite-12", "mention-103"
  type: TodoType;
  priority: TodoPriority;
  verb: TodoVerb;                // i18n 키의 verb 파트
  // #239 서명 항목의 요청 종류. 라벨은 verb 가 만들지만, 화면이 더 갈라야 할 때의 근거값.
  kind?: 'sign' | 'confirm';
  subject: string;               // 액션 대상: "워프로랩 3월 로고 시안 A안"
  context?: string;              // 추가 설명: "요청: Acme, 3시간 전"
  dueAt?: string | null;         // ISO string
  createdAt?: string | null;     // ISO string — 알림 발생 시점 (사용자: 어느날 알림인지 표시)
  amount?: number;               // 청구서/견적용
  currency?: 'KRW' | 'USD' | 'EUR';
  actor?: { name: string; avatarUrl?: string };
  link?: string;                 // 페이지 이동용
  // 우측 드로어용 — 종류마다 다른 여는 방식을 만들지 않는다(업무·일정·영업이 같은 계약을 쓴다).
  //   'client'  : 등록된 고객 → ClientPanel
  //   'inquiry' : 아직 고객이 아닌 문의 → ClientPanel 의 inquiry 분기(받는 쪽 미구현, ref 로 다시 집는다)
  drawer?: {
    kind: 'task' | 'event' | 'client' | 'inquiry';
    /** ★ 문의는 `${source}:${id}` 꼴 **문자열**이다(업무·일정은 숫자). 받는 쪽에서 좁혀 쓴다 */
    id: number | string;
    ref?: { kind: string; id: number; conversation_id?: number };
    /** 상담(미등록 문의) 패널이 그릴 값 — 서버가 통째로 싣는다.
     *  받는 쪽이 다시 조회하면 같은 문의가 두 화면에서 다르게 보일 자리가 생긴다. */
    inquiry?: {
      who: string | null;
      email: string | null;
      company: { name: string; estimated: boolean } | null;
      title: string | null;
      preview: string | null;
      at: string | null;
      needs_reply: boolean;
      source: string;
      open_path: string;
      meta?: Record<string, unknown>;
    };
  };
  inline?: 'invite';             // Accept/Decline 인라인 버튼 활성화
  workspace?: TodoWorkspace;     // cross-workspace 모드 시 부착
  // task_candidate 전용 — 인박스 inline 등록/반려 모달용 (사이클 N+26)
  candidate_id?: number;
  conversation_id?: number | null;
  guessed_assignee?: { id: number; name: string } | null;
}

export interface TodoResponse {
  items: TodoItem[];
  counts: Record<TodoPriority, number>;
  total: number;
  /** 목록에 담긴 수 (종류별 상한 적용 후). total 과 다를 수 있다. */
  shown?: number;
  /** 상한 때문에 목록에서 빠진 수 — 화면이 "외 N건" 을 말해야 한다. */
  hidden?: number;
  taskCount?: number;  // Q Task 메뉴 뱃지 — 받은 요청·수정 요청·내가 컨펌·보낸 요청 (확인 필요 total 의 부분집합)
  billCount?: number;  // Q Bill 메뉴 뱃지 — 청구 관련 액션 대기 건수
  mailReplyCount?: number;  // Q mail 메뉴 뱃지 — 답변 필요 메일 (확인 필요 total 에는 합산 안 함)
  saleCount?: number;  // Q sale 메뉴 뱃지 — 내게 귀속된 영업 확인 항목 (확인 필요 total 의 부분집합)
  workspaces?: TodoWorkspace[];
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
