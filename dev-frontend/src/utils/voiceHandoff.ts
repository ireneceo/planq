// 음성 캡처('말로 추가') → 착지 화면(업무·일정·메일) 사이의 전달 계약.
//
// 시트 컴포넌트가 아니라 이 유틸에 둔다 — 착지 페이지 3곳이 타입·파서만 쓰는데
// 시트에서 import 하면 녹음 UI 모듈이 그 페이지 청크로 딸려 들어간다.
//
// 전달은 URL 이 아니라 react-router 의 navigate state 로 한다:
//   navigate('/tasks?create=1', { state: { voice: handoff } })
// 여는 트리거만 URL 에 남기고 내용은 남기지 않는다 — 전사문이 주소창·히스토리에 박히면
// "오디오를 저장하지 않는다"(docs/MAIL_ALIAS_AND_VOICE_DESIGN.md §B-5)는 원칙과 어긋난다.
//
// ★ 착지 페이지는 state 를 `setSearchParams(..., { replace: true })` **전에** 읽어야 한다.
//   react-router 의 setSearchParams 는 state 를 넘기지 않아 호출 즉시 location.state 가 비워진다.
//   덕분에 별도의 정리용 navigate 는 필요 없다(넣으면 방금 지운 파라미터가 되살아난다).

export type VoiceKind = 'task' | 'event' | 'memo' | 'mail';

export interface VoiceHandoff {
  kind: VoiceKind;
  /** 전사 원문 */
  text: string;
  title: string;
  detail: string;
  /** 사용자가 말한 이름 그대로 (확정 여부와 무관) */
  assignee_name: string | null;
  /** 서버가 워크스페이스 멤버로 **확정**한 담당자. 정확 일치 실패 시 null. */
  assignee_user_id?: number | null;
  assignee_display_name?: string | null;
  /** 사용자가 말한 시각 표현 원문 */
  when: string | null;
  /** 서버가 워크스페이스 타임존 기준으로 계산한 'YYYY-MM-DDTHH:mm' (offset 없음). 없으면 null. */
  when_start?: string | null;
  when_all_day?: boolean;
  confidence: number;
}

/**
 * 'YYYY-MM-DDTHH:mm' → Date. offset 이 없으므로 브라우저가 **로컬 시각**으로 읽는다.
 * 서버는 워크스페이스 타임존의 벽시계 값을 주고 착지 폼(NewEventModal)도 그 벽시계를
 * 워크스페이스 시간대로 라벨링한다 — 중간에 Z 를 한 번이라도 섞으면 시각이 조용히 어긋난다.
 */
export function parseVoiceWhen(s?: string | null): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
