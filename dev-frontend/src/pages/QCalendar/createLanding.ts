// 새 일정 창 «바깥에서 넘겨 온 첫 값» — 퀵메뉴 '+일정'·음성 캡처('말로 추가')·Cue 카드 [자세히 편집] (QCalendarPage 의 `?create=1` 착지).
//   QCalendarPage 가 800줄을 넘지 않게 갈래 판정만 여기로 뺐다(2026-11-18). 값의 주인은 NewEventModal 이다.
import { parseVoiceWhen, type VoiceHandoff } from '../../utils/voiceHandoff';
import { eventParamsToSeed } from '../../utils/cueFormSeed';
import type { EventFormSeed } from './NewEventModal';
import { nextSlot } from './dateUtils';
import { toWall } from './calTz';

export interface CalendarVoiceSeed { title: string; description: string; allDay: boolean; projectId?: number | null; form?: EventFormSeed }

export function calendarCreateLanding(voice: VoiceHandoff | null | undefined, wsTz: string): { start: Date; seed: CalendarVoiceSeed | null; remount: boolean } {
  const now = () => nextSlot(toWall(new Date(), wsTz));
  if (voice?.params) {
    // 카드 [자세히 편집] — 카드가 고친 인자 그대로(시각 변환은 utils/cueFormSeed 한 곳).
    //   열린 창에 또 넘겨 오면 다시 마운트해야 첫 값(useState 초기값)이 바뀐다 → remount
    const f = eventParamsToSeed(voice.params, wsTz, voice.params_task_title);
    return { start: f.start || now(), seed: { title: f.title, description: f.description, allDay: f.allDay, projectId: f.projectId, form: f.seed }, remount: true };
  }
  if (voice) {
    // 음성 시각은 시간대 없는 «말한 그대로»라 이미 벽시계 · 없으면 지금을 벽시계로(calTz)
    const when = parseVoiceWhen(voice.when_start);
    return { start: when || now(), seed: { title: voice.title || voice.text || '', description: voice.detail || '', allDay: voice.when_all_day === true }, remount: false };
  }
  return { start: now(), seed: null, remount: false };
}
