// Q mail 화면 공용 형식 — MailPage·ThreadMessages·optimisticOutbound 가 같이 쓴다(MailPage.tsx 에서 옮김, 동작 그대로).
import type { ReadStatus } from './MailReadStatusChip';
import type { SearchMatchInfo } from '../../utils/searchMatch';

export type Folder = 'reply_needed' | 'uncertain' | 'all' | 'sent' | 'marketing' | 'following' | 'spam' | 'archived';

// 메일 계정 (회사 공용 / 개인) — 폴더트리 그룹 (외부 연동 Phase 3)
export interface MailAccount {
  id: number;
  email: string;
  display_name: string | null;
  is_personal: boolean;
  unread: number;
}

// 답변 대기 일수 — 3일 넘으면 목록에서 강조 (고객 문의를 묵히지 않게)
export function waitingDays(iso?: string | null): number {
  if (!iso) return 0;
  const ms = Date.now() - new Date(iso).getTime();
  return ms > 0 ? Math.floor(ms / 86400000) : 0;
}

export interface Thread {
  id: number;
  subject: string | null;
  last_message_preview: string | null;
  last_message_at: string;
  sent_via?: 'planq' | 'other' | null;   // 보낸메일함 행만 — 마지막 보낸 메일이 PlanQ 에서 나갔나(서버 sent_by_user_id)
  last_message_direction?: 'inbound' | 'outbound' | null;  // #186 — 마지막 메시지 방향(받은/보낸 구분)
  // 읽음 추적 대신 쓰는 결정론적 신호 — 보낸 뒤 답이 없거나, 애초에 발송이 안 됐거나.
  //   서버 판정(services/mailFollowUp) 단일 원천. 프론트에서 날짜를 다시 계산하지 말 것.
  follow_up?: { kind: 'awaiting_reply'; days: number } | { kind: 'delivery_problem'; delivery_status: string } | null;
  // #384 — 이 대화의 후속 알림 기간. null=기본(3일) · 0=끔 · N=N일
  follow_up_days?: number | null;
  /** 'provider' = 업체(Gmail·네이버) 스팸함에서 가져온 스레드 — 30일 뒤 자동 삭제, 스팸 해제는 업체 쪽에도 따로 해야 한다 */
  spam_origin?: 'provider' | 'impersonation' | null;
  /** 이 폴더를 정한 기준 id(services/mailCriteriaCatalog) — 스팸 폴더 행의 «왜» */
  triage_criterion?: string | null;
  /** 사칭 판정(services/mailImpersonation.rowView) — 있으면 행에 «사칭 의심» 배지 */
  //   목록은 codes, 상세는 signals(신호별 코드·호스트·코드포인트 — 원문 없음)를 싣는다.
  impersonation?: {
    level: 'warn' | 'quarantine'; codes?: string[]; released?: boolean; known?: boolean;
    signals?: { code: string; level: 'strong' | 'weak'; detail: string }[];
    /** 상세 — «안전한 도메인» 으로 등록할 수 있는 From 유사 도메인(services/mailTrustedDomains.candidateOf) */
    trust_candidate?: { domain: string; like: string } | null;
  } | null;
  status: string;
  reply_needed: boolean;
  reply_needed_at?: string | null;
  /** 'holding' = 임시 답변을 보내고 답변 필요에 남겨 둔 것 (2026-09-10) */
  reply_needed_reason?: string | null;
  /** 답변 필요인데 마지막이 우리 메일(임시 답변)일 때 — 기다리는 **마지막 받은 메일** 미리보기 (#438) */
  reply_preview?: string | null;
  /** 이 스레드가 Q sale 의 «상담» 기준에 드는가 — 서버가 `saleInbox.classifyMailThreads`
   *  **한 함수**로 판정해 내려준다(#421). 판정을 못 했으면 필드가 아예 없다
   *  (false 를 붙이면 "문의가 아니다" 라고 단언하는 것이라 거짓이 된다). */
  is_inquiry?: boolean;
  /** #449 — 수동 모드에서 자동 기준에만 드는 메일(「문의 후보」) */
  is_inquiry_candidate?: boolean;
  rule_id?: number | null;        // 학습 규칙으로 분류된 스레드 (몰래 걸러지지 않도록 화면에 표시)
  is_starred: boolean;
  unread_count: number;
  message_count: number;
  attachment_count?: number;      // #215-I — 열기 전 첨부 유무 인지 (0 = 없음)
  labels: string[];
  // 2026-09-11 — 검색 중일 때만 서버가 채운다: 어디서 맞았나(field) + 행에 안 보이면 주변 문장(snippet).
  //   서버 정본 services/mailSearchMatch.js
  match?: SearchMatchInfo | null;
  //   owner_user_id: 이 스레드가 붙은 계정의 주인. null 이면 워크스페이스 공용, 값이 있으면 개인메일.
  //   본문 인라인 이미지 등급을 계정 목록 조회 없이 정하기 위해 서버가 같이 내려준다(#378 후속).
  account: { id: number; email: string; display_name?: string | null; owner_user_id?: number | null } | null;
  // 상대방(발신자) — 목록의 "보낸 사람" 자리. 내 메일함 이름(account.display_name)이 아니다.
  counterpart?: { name: string | null; email: string | null } | null;
  // 2026-09-15 — 검색은 폴더를 넘는다(서버 searchFolderWhere). 그래서 행이 **자기 자리**를 말한다.
  //   판정 정본은 서버 services/mailFolders.folderOf — 화면이 다시 계산하지 않는다.
  folder?: string | null;
  client: { id: number; display_name?: string; company_name?: string } | null;
  project?: { id: number; name?: string; color?: string } | null;
  uncertain_reason?: string | null;
  triage?: string | null; // human / automated / marketing / spam / unknown (N+83)
}

export interface Message {
  id: number;
  direction: 'inbound' | 'outbound';
  from_email: string | null;
  from_name: string | null;
  to_emails: Array<string | { name?: string; email: string }>;   // 백엔드는 [{name,email}] 로 준다
  cc_emails?: Array<string | { name?: string; email: string }> | null;
  subject: string | null;
  body_html: string | null;
  body_text: string | null;
  sent_at: string;
  is_read: boolean;
  // outbound 만 채워진다. 'delivered' 는 DSN 없이는 알 수 없어 서버가 만들지 않는다.
  // 서버 ENUM + 'sending' — 'sending' 은 **화면 전용**(2R-2 낙관 카드)이라 DB 에 저장되지 않는다.
  //   서버 ENUM 에 넣지 않는 이유: 저장된 적 없는 상태가 통계·필터에 섞이면 그 자체가 오염이다.
  delivery_status?: 'pending' | 'sent' | 'delivered' | 'bounced' | 'failed' | 'suppressed' | 'sending' | null;
  // 운영 #220 — 팀메일함에서 이 메일을 실제로 보낸 사람. inbound 면 null.
  sent_by_user_id?: number | null;
  sent_by_name?: string | null;
  // 2026-10-21 — 표시용 «보낸 멤버»(서버 services/mailSender). IMAP 으로 가져온 보낸 메일도 보낸 주소로 멤버를 찾는다. 모르면 null.
  sender_user_id?: number | null;
  sender_name?: string | null;
  sender_source?: 'planq' | 'address' | null;
  delivery_error?: string | null;
  attachments: Array<{ id: number; file_id: number | null; file_name: string; file_size: number; mime_type: string }>;
  // #215-H — 본문이 cid: 로 참조하는 이미지. 본문은 sandbox iframe srcDoc 이라 cid 를 해석할 수 없어
  //   인증 다운로드 → data: URI 치환 재료로 서버가 따로 내려준다.
  // file_id 는 첨부 기반, embedded_index 는 본문에서 떼어낸 base64 이미지 (둘 중 하나만 채워진다)
  inline_images?: Array<{ file_id: number | null; embedded_index?: number; content_id: string | null; mime_type: string; size_bytes: number | null }>;
}

export interface ThreadDetail extends Thread {
  messages: Message[];
  assignee_user_id?: number | null;
  assignee_name?: string | null;
  my_following?: boolean;
  // 2026-10-22 — 누가 읽고 답했나(공용 메일함만) · 답변 업무(services/mailReplyTask)
  read_status?: ReadStatus | null;
  reply_task?: { id: number; status: string; assignee_id: number | null } | null;
}

export interface MailLabel { name: string; color: string }
export interface MailMember { user_id: number; name: string }

// 수신 주소 정규화 — 백엔드는 [{name, email}] 로 준다. 문자열로 다루면 "[object Object]" 가 된다.
export function toAddrList(list: Array<string | { name?: string; email: string }> | undefined | null): string[] {
  if (!Array.isArray(list)) return [];
  return list.map((x) => (typeof x === 'string' ? x : x?.email)).filter(Boolean) as string[];
}
