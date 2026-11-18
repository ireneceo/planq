// Cue·음성 확인 카드의 도구 인자(create_task · create_event) → 표준 폼(TaskCreateForm · NewEventModal) 첫 값.
//
// 설계: 2026-11-18 Fable 판정 «② 카드는 두고 [자세히 편집] 으로 표준 폼에 값을 실어 연다».
//   카드가 **그 순간 고쳐 둔 params** 를 utils/voiceHandoff 보관함에 맡기고 착지 화면(/tasks·/calendar)이 이 함수로 칸을 채운다.
//   도구 인자가 늘어도 계약은 params 하나 — 폼 칸으로 옮기는 곳은 여기 두 함수뿐이다.
//
// 폼에 칸이 없는 인자(조용히 버리지 않고 여기 목록으로 남긴다):
//   create_task — client_id(폼은 고객이 정해진 화면에서만 붙인다) · workstream_id(그룹 칸은 프로젝트 탭에서만) ·
//                 source(메일·채팅 출처) · completed · priority 는 «긴급»(urgent)만 옮긴다(폼에 우선순위 칸이 없다)
//   create_event — source
import type { TaskCreateInitial } from '../components/QTask/TaskCreateForm';
import type { EventFormSeed } from '../pages/QCalendar/NewEventModal';
import type { EventCategory } from '../pages/QCalendar/types';
import { plainToHtml } from './plainToHtml';
import { toWall } from '../pages/QCalendar/calTz';

type P = Record<string, unknown>;
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : (typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : null));
const nums = (v: unknown): number[] => (Array.isArray(v) ? v.map(num).filter((x): x is number => x != null) : []);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** create_task 인자 → TaskCreateInitial. 칸 하나하나를 **명시값**으로 준다 — 빈 칸도 직전 진입 값이 남지 않게. */
export function taskParamsToInitial(params: P): TaskCreateInitial {
  const desc = str(params.description) || '';
  const due = str(params.due_date);
  const start = str(params.start_date);
  const tags = Array.isArray(params.tag_names) ? params.tag_names.filter((x): x is string => typeof x === 'string') : [];
  return {
    title: str(params.title) || '',
    description: desc ? plainToHtml(desc) : '',
    assigneeId: num(params.assignee_user_id),
    projectId: num(params.project_id),
    startDate: start && DATE_RE.test(start) ? start : '',
    dueDate: due && DATE_RE.test(due) ? due : '',
    asRequest: params.as_request === true,
    reviewerIds: nums(params.reviewer_user_ids),
    watcherIds: nums(params.watcher_user_ids),
    tagNames: tags,
    estimatedHours: num(params.estimated_hours),
    urgent: params.priority === 'urgent',
  };
}

/**
 * 일정 시각 문자열 → 워크스페이스 벽시계 Date. **변환은 여기 한 곳**(parseVoiceWhen 주석의 «Z 섞임» 사고 계열).
 *   - 'YYYY-MM-DD'                 → 그 날 00:00(종일)
 *   - offset·Z 없는 'YYYY-MM-DDTHH:mm[:ss]' → 이미 워크스페이스 벽시계(서버 계약: offset 없으면 사용자 시간대)
 *   - offset·Z 있음                → 그 순간을 워크스페이스 시간대 벽시계로
 */
export function cueWhenToWall(s: string | undefined, tz: string): Date | null {
  if (!s) return null;
  const d = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (d) return new Date(Number(d[1]), Number(d[2]) - 1, Number(d[3]), 0, 0, 0);
  const w = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/);
  if (w) return new Date(Number(w[1]), Number(w[2]) - 1, Number(w[3]), Number(w[4]), Number(w[5]), 0);
  const inst = new Date(s);
  if (Number.isNaN(inst.getTime())) return null;
  return toWall(inst, tz);
}

const CATEGORIES: EventCategory[] = ['meeting', 'work', 'deadline', 'personal', 'other'];

export interface EventFormStart {
  start: Date | null;
  title: string;
  description: string;
  allDay: boolean;
  projectId: number | null;
  seed: EventFormSeed;
}

/** create_event 인자 → NewEventModal 첫 값. */
export function eventParamsToSeed(params: P, tz: string, linkedTaskTitle?: string | null): EventFormStart {
  const allDay = params.all_day === true;
  const start = cueWhenToWall(str(params.start_at), tz);
  const end = cueWhenToWall(str(params.end_at), tz);
  const cat = str(params.category) as EventCategory | undefined;
  const taskId = num(params.task_id);
  const rem = num(params.reminder_minutes);
  return {
    start,
    title: str(params.title) || '',
    description: str(params.description) || '',
    allDay,
    projectId: num(params.project_id),
    seed: {
      end,
      location: str(params.location) || '',
      attendeeUserIds: nums(params.attendee_user_ids),
      attendeeClientIds: nums(params.attendee_client_ids),
      // Cue 는 칸을 비우면 «업무»(work)로 만든다 — 폼 기본(meeting)으로 바뀌면 카드와 다른 일정이 된다
      category: cat && CATEGORIES.includes(cat) ? cat : 'work',
      team: params.visibility === 'team',
      reminderMinutes: rem == null ? undefined : rem,
      createMeeting: params.create_meeting === true,
      meetingUrl: str(params.meeting_url) || '',
      linkedTask: taskId ? { id: taskId, title: linkedTaskTitle || `#${taskId}` } : null,
    },
  };
}
