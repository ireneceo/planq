// pickableMembers — `GET /api/businesses/:id/members` 응답을 «고를 수 있는 사람» 목록으로 바꾸는 단일 정본.
//
// 2026-11-12 20~30명 점검: 선택기 약 25곳이 같은 응답을 제각각 걸렀고 세 갈래가 샜다.
//   ① 초대 대기 행(user_id NULL) — `m.user_id || m.id` 로 멤버 **행 id** 가 사람 id 자리에 들어가
//      다른 사람이 골라질 수 있었다(일정 참석자·문서 공개 대상·Q info). 다른 곳은 «#null»·빈 줄.
//   ② Cue(AI) — 사람 고르는 칸(참석자·공개 대상·책임자)에 섞임.
//   ③ 이름 — 최상위 `m.name`(워크스페이스 표시명이 없으면 비어 있음)만 읽어 빈 줄.
// 새 선택기는 이 함수를 쓴다. Cue 가 담당자가 될 수 있는 곳만 includeAi.
import { displayName, type NameLocalizable } from './displayName';

export interface RawMemberRow {
  id?: number;
  user_id?: number | null;
  role?: string | null;
  name?: string | null;
  removed_at?: string | null;
  user?: (NameLocalizable & { id?: number; email?: string | null; is_ai?: boolean; avatar_url?: string | null }) | null;
  department?: { id: number; name: string; name_en?: string | null } | null;
  team?: { id: number; name: string; name_en?: string | null } | null;
}

export interface PickableMember {
  user_id: number;
  name: string;
  role: string;
  email: string | null;
  is_ai: boolean;
  avatar_url: string | null;
  department: string | null;
  team: string | null;
}

export function isPickableRow(m: RawMemberRow, includeAi = false): boolean {
  if (!m || !m.user_id || m.user_id <= 0) return false; // 초대 대기(아직 사람 없음)
  if (m.removed_at) return false;
  const ai = m.role === 'ai' || !!m.user?.is_ai;
  return includeAi || !ai;
}

export function pickableMembers(
  rows: RawMemberRow[] | null | undefined,
  lang?: string | null,
  opts: { includeAi?: boolean } = {},
): PickableMember[] {
  const en = !!lang && lang.toLowerCase().startsWith('en');
  return (rows || [])
    .filter((m) => isPickableRow(m, !!opts.includeAi))
    .map((m) => ({
      user_id: m.user_id as number,
      name: displayName(m.user, lang) || m.name || m.user?.email || `#${m.user_id}`,
      role: m.role || 'member',
      email: m.user?.email || null,
      is_ai: m.role === 'ai' || !!m.user?.is_ai,
      avatar_url: m.user?.avatar_url || null,
      department: m.department ? ((en && m.department.name_en) || m.department.name) : null,
      team: m.team ? ((en && m.team.name_en) || m.team.name) : null,
    }));
}
