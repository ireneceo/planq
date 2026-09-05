// 일정 알림 설정의 **말과 값**을 한곳에서 정한다.
//
// 왜 모았나: 등록 모달과 상세 드로어가 각자 목록을 들고 있어 서로 다른 말을 했다.
//   드로어는 저장된 값을 그대로 "{{count}}분 전" 에 넣어 **"1440분 전"** 이라고 표시했고
//   (모달은 같은 값을 "1일 전 (오전 9시)" 이라 부른다), 모달에만 있는 2880·1 은
//   드로어 목록에 없어 고르면 사라졌다(Fable 게이트 2026-09-05).
//
// 종일 일정은 기준이 **시작일 09:00**(서버 services/calendarReminderCron.reminderTimeFor).
//   그래서 하루 안쪽 설정은 "1분 전" 이 아니라 "당일 아침" 이다 — 서버 humanizeLead 와 같은 말.
import type { TFunction } from 'i18next';

/** "알림 없음" 을 셀렉트 값으로 표현하기 위한 센티널. 서버로는 null 로 보낸다. */
export const REMINDER_NONE = -1;

/** 종일은 09:00 기준이라 이 값보다 작은 설정은 전부 "당일 아침" 한 가지 뜻이다. */
const ALL_DAY_MORNING_MAX = 1440;

/** 기본 제시 값 — 순서가 곧 화면 순서다. */
export const reminderPresets = (allDay: boolean): number[] =>
  (allDay ? [1440, 2880, 1] : [1440, 60, 30, 10]);

/** 이 설정을 사람 말로. 서버 알림 본문(humanizeLead)과 같은 뜻이어야 한다. */
export function reminderLabel(minutes: number, allDay: boolean, t: TFunction): string {
  if (minutes === REMINDER_NONE) return t('form.reminderNone', { defaultValue: '알림 없음' }) as string;
  if (allDay) {
    if (minutes < ALL_DAY_MORNING_MAX) return t('form.reminderSameDay', { defaultValue: '당일 아침 (오전 9시)' }) as string;
    const d = Math.round(minutes / 1440);
    return t('form.reminderDaysMorning', { count: d, defaultValue: '{{count}}일 전 (오전 9시)' }) as string;
  }
  if (minutes % 1440 === 0) return t('form.reminderDays', { count: minutes / 1440, defaultValue: '{{count}}일 전' }) as string;
  if (minutes % 60 === 0) return t('form.reminderHours', { count: minutes / 60, defaultValue: '{{count}}시간 전' }) as string;
  return t('form.reminderMinutes', { count: minutes, defaultValue: '{{count}}분 전' }) as string;
}

/**
 * 셀렉트 목록. **지금 저장된 값이 목록에 없으면 그 값도 넣는다** —
 * 안 그러면 옛 일정(예: 15분 전)을 열었을 때 고른 것이 빈칸으로 보이고,
 * 사용자가 건드리지도 않은 설정이 저장 시 바뀐다.
 */
export function reminderOptions(
  allDay: boolean, current: number | null, t: TFunction,
): { value: number; label: string }[] {
  const values = [...reminderPresets(allDay)];
  if (current != null && current !== REMINDER_NONE && !values.includes(current)) values.unshift(current);
  return [
    ...values.map((v) => ({ value: v, label: reminderLabel(v, allDay, t) })),
    { value: REMINDER_NONE, label: reminderLabel(REMINDER_NONE, allDay, t) },
  ];
}
