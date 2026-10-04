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

// ── 라우터 밖에서 넘기기 (2026-10-04) ──
// 시트는 RightDock 소속이고 데스크탑 탭 모드(아이패드 포함)에서는 **라우터 밖**(ChromeOverlays)에 뜬다.
// 거기서 useNavigate 를 부르면 화면이 통째로 죽는다(운영 client-crash 2026-10-04 «useNavigate() may be used
// only in the context of a <Router>», 아이패드 앱 #dock-voice). 그래서 시트는 chrome 이동(tabStore)을 쓰고,
// 내용은 navigate state 대신 여기 한 번만 꺼낼 수 있는 보관함에 둔다 — URL·히스토리에 안 남는 것은 같다.
const HANDOFF_TTL_MS = 30_000;
let pending: { h: VoiceHandoff; at: number } | null = null;

/** 시트가 이동 직전에 맡긴다. */
export function stashVoiceHandoff(h: VoiceHandoff): void { pending = { h, at: Date.now() }; }

/** 착지 화면이 꺼낸다 — 종류가 맞고 30초 안일 때만.
 *  ★ 꺼낸 뒤 2초 동안은 같은 값을 다시 준다 — 착지 effect 는 트리거 파라미터(`create=1`)를 지우기 전에
 *    한 번 더 돌 수 있고, 그때 null 을 받으면 방금 채운 폼을 빈 값으로 덮는다. 그 뒤로는 비운다. */
const REREAD_MS = 2_000;
let taken: { h: VoiceHandoff; at: number } | null = null;
export function takeVoiceHandoff(kind: VoiceKind): VoiceHandoff | null {
  const now = Date.now();
  if (taken && taken.h.kind === kind && now - taken.at <= REREAD_MS) return taken.h;
  const p = pending;
  if (!p || p.h.kind !== kind || now - p.at > HANDOFF_TTL_MS) return null;
  pending = null;
  taken = { h: p.h, at: now };
  return p.h;
}
