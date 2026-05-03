// displayName — 사이클 F. 사용자 이름을 viewer 의 i18n 언어 기준으로 반환.
// 우선순위:
//   1) user.name_localized[viewerLang] 존재 → 그 값
//   2) user.name (default)
//
// 사용 예:
//   import { displayName } from '../utils/displayName';
//   const { i18n } = useTranslation();
//   <span>{displayName(user, i18n.language)}</span>

export interface NameLocalizable {
  name?: string | null;
  name_localized?: Record<string, string> | null;
  // 워크스페이스 컨텍스트 표시명 (BusinessMember.name 또는 Client.name)
  // 메모 project_account_workspace_profile_split — 계정 vs 워크스페이스 분리.
  display_name?: string | null;
  display_name_localized?: Record<string, string> | null;
}

// 우선순위: display_name_localized[lang] > display_name > name_localized[lang] > name
export function displayName(user: NameLocalizable | null | undefined, viewerLang?: string | null): string {
  if (!user) return '';
  const primary = viewerLang ? String(viewerLang).split('-')[0].toLowerCase() : null;
  // 1) 워크스페이스 표시명 (i18n)
  if (primary && user.display_name_localized) {
    const v = user.display_name_localized[primary];
    if (typeof v === 'string' && v.trim()) return v;
  }
  // 2) 워크스페이스 표시명 (default)
  if (user.display_name && user.display_name.trim()) return user.display_name;
  // 3) 계정 이름 (i18n)
  if (primary && user.name_localized) {
    const v = user.name_localized[primary];
    if (typeof v === 'string' && v.trim()) return v;
  }
  // 4) 계정 이름 fallback
  return user.name || '';
}

// 검색·정렬용 — 모든 언어 이름을 합친 문자열 반환 (검색 매칭 강화)
export function searchableName(user: NameLocalizable | null | undefined): string {
  if (!user) return '';
  const parts: string[] = [];
  if (user.name) parts.push(user.name);
  if (user.name_localized) {
    for (const v of Object.values(user.name_localized)) {
      if (typeof v === 'string' && v.trim()) parts.push(v);
    }
  }
  return parts.join(' ');
}
