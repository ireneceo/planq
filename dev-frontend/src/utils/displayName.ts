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
}

export function displayName(user: NameLocalizable | null | undefined, viewerLang?: string | null): string {
  if (!user) return '';
  const fallback = user.name || '';
  if (!viewerLang || !user.name_localized) return fallback;
  // i18n 언어 코드는 'ko' 또는 'ko-KR' 같은 형태 — primary subtag 만 추출
  const primary = String(viewerLang).split('-')[0].toLowerCase();
  const localized = user.name_localized[primary];
  return (typeof localized === 'string' && localized.trim()) ? localized : fallback;
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
