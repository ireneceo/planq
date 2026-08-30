// 근태 화면 공용 타입·스타일 (#208) — AttendancePage 가 800줄을 넘어 쪼갠 것.
//   화면 하나를 세 파일이 나눠 쓰므로 **타입과 표 스타일은 여기 한 벌**만 둔다.
import styled from 'styled-components';

export interface LeaveRequestRow {
  id: number; user_id: number; leave_type: 'paid' | 'unpaid';
  unit: 'full_day' | 'half_day' | 'hours';
  start_date: string; end_date: string; half_kind: 'am' | 'pm' | null; hours: number | null;
  days_charged: number; reason: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'canceled';
  decide_note: string | null;
}
export interface Balance { year: number; granted: number; used: number; pending: number; remaining: number }
export interface PresenceRow { user_id: number; state: string | null; on_leave_today: boolean }
export interface StatRow {
  user_id: number; department_id: number | null;
  work_days: number; work_hours: number; break_hours: number; overtime_hours: number;
  avg_clock_in: string | null; avg_clock_out: string | null;
  auto_closed_count: number; leave_used_paid: number; leave_used_unpaid: number;
}
export interface AttendanceEventRow {
  id: number; kind: 'clock_in' | 'break_start' | 'break_end' | 'clock_out';
  at: string; source: string; actor_user_id: number; fix_reason: string | null;
  superseded_at: string | null;
}

export function hhmm(iso: string | null): string {
  if (!iso) return '–';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
export function unitKey(u: 'full_day' | 'half_day' | 'hours'): string {
  return u === 'full_day' ? 'fullDay' : u === 'half_day' ? 'halfDay' : 'hours';
}
export function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}
// datetime-local 입력은 로컬 시각 문자열을 받는다. ISO 를 그대로 넣으면 값이 비거나 UTC 로 보인다.
export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export const Section = styled.section` margin-bottom: 24px; `;
export const SectionTitle = styled.h3` margin: 0 0 10px; font-size: 0.875rem; font-weight: 700; color: #0F172A; `;
export const Empty = styled.div` padding: 28px; text-align: center; color: #94A3B8; font-size: 0.8125rem; `;
export const TableWrap = styled.div` overflow-x: auto; border: 1px solid #E2E8F0; border-radius: 10px; background: #fff; `;
export const Table = styled.table` width: 100%; border-collapse: collapse; font-size: 0.8125rem; `;
export const Th = styled.th`
  text-align: left; padding: 10px 12px; background: #F8FAFC;
  font-size: 0.6875rem; font-weight: 700; color: #64748B; white-space: nowrap;
  border-bottom: 1px solid #E2E8F0;
`;
export const Td = styled.td` padding: 10px 12px; border-bottom: 1px solid #F1F5F9; color: #334155; white-space: nowrap; `;
export const Muted = styled.span` color: #94A3B8; `;
export const Badge = styled.span<{ $tone: 'warn' | 'info' }>`
  display: inline-block; padding: 2px 7px; border-radius: 999px; margin-right: 4px;
  font-size: 0.6875rem; font-weight: 600;
  background: ${p => (p.$tone === 'warn' ? '#FEF3C7' : '#E0F2FE')};
  color: ${p => (p.$tone === 'warn' ? '#92400E' : '#075985')};
`;
export const List = styled.div` display: flex; flex-direction: column; gap: 8px; `;
export const Row = styled.div`
  display: flex; align-items: center; gap: 10px; padding: 12px 14px;
  background: #fff; border: 1px solid #E2E8F0; border-radius: 10px;
`;
export const RowMain = styled.div` flex: 1; min-width: 0; `;
export const RowTitle = styled.div` font-size: 0.8125rem; font-weight: 600; color: #0F172A; `;
export const RowMeta = styled.div` font-size: 0.75rem; color: #64748B; margin-top: 2px; `;
export const Hint = styled.div` margin-top: 6px; font-size: 0.6875rem; color: #94A3B8; `;
export const Field = styled.div` margin-bottom: 14px; `;
export const FieldLabel = styled.label` display: block; margin-bottom: 6px; font-size: 0.75rem; font-weight: 600; color: #475569; `;
const inputCss = `
  width: 100%; padding: 10px 12px; border: 1px solid #CBD5E1; border-radius: 8px;
  font-size: 0.875rem; color: #0F172A; background: #fff;
  &:focus { outline: none; border-color: #F43F5E; box-shadow: 0 0 0 3px rgba(244,63,94,0.12); }
`;
export const NumInput = styled.input`${inputCss}`;
export const TextInput = styled.input`${inputCss}`;
export const TextArea = styled.textarea`${inputCss} resize: vertical;`;
export const ErrorBar = styled.div`
  padding: 10px 12px; margin-bottom: 12px;
  background: #FEE2E2; border: 1px solid #FECACA; border-radius: 8px;
  font-size: 0.75rem; color: #991B1B;
`;
