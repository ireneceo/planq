// 멤버 소속(부서·팀) 라벨 — D1 조직 후속. 채팅 hover·업무상세·리스트 공통.
// en 이면 name_en fallback name. 부서·팀을 ' · ' 로 연결.
export type OrgUnitLite = { name: string; name_en?: string | null } | null | undefined;

export function orgUnitName(u: OrgUnitLite, lang?: string): string {
  if (!u) return '';
  return (lang?.startsWith('en') && u.name_en) ? u.name_en : u.name;
}

export function affiliationLabel(
  m: { department?: OrgUnitLite; team?: OrgUnitLite } | null | undefined,
  lang?: string,
): string {
  if (!m) return '';
  return [orgUnitName(m.department, lang), orgUnitName(m.team, lang)].filter(Boolean).join(' · ');
}
