// 업무 템플릿 항목 — 서버 task_template_items 와 같은 모양 (2026-10-29, docs/TASK_TEMPLATE_DETAIL_DESIGN.md).
//   start_offset_days === null 이면 «날짜 없음»(기간도 null). 0 = 첫날, duration 0 = 시작일에 마감.
export interface TemplateActionItem { kind: string; label: string; note?: string | null; }

export interface TemplateItem {
  id: number;
  order_index: number;
  title: string;
  description?: string | null;
  body?: string | null;
  start_offset_days: number | null;
  duration_days: number | null;
  estimated_hours: number | null;
  role_hint: string | null;
  priority?: string | null;
  /** 추진과제(그룹) 이름 — 적용하면 같은 이름 그룹에 넣는다(없으면 만든다). */
  workstream_title?: string | null;
  is_milestone?: boolean;
  category?: string | null;
  vlevel?: string | null;
  security_level?: string | null;
  recurrence_rule?: string | null;
  tag_names?: string[] | null;
  action_items?: TemplateActionItem[] | null;
  depends_on_indexes?: number[] | null;
}

/** 서버 /apply dry_run 이 돌려주는 계산된 일정(한 벌 — 서버 templateApply.scheduleItems). */
export interface ScheduleRow {
  order_index: number;
  start_offset_days: number | null;
  duration_days: number | null;
  start_date: string | null;
  due_date: string | null;
}

export const hasDate = (it: { start_offset_days: number | null | undefined }) =>
  it.start_offset_days !== null && it.start_offset_days !== undefined;

/** 두 날짜(YYYY-MM-DD) 사이 일수 */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

/** 저장 직전 — 가장 이른 시작을 0(첫날)으로 맞춘다(간격은 그대로). */
export function normalizeOffsets<T extends { start_offset_days: number | null }>(items: T[]): T[] {
  const starts = items.filter(hasDate).map(it => it.start_offset_days as number);
  const min = starts.length ? Math.min(...starts) : 0;
  if (min === 0) return items;
  return items.map(it => (hasDate(it) ? { ...it, start_offset_days: (it.start_offset_days as number) - min } : it));
}
