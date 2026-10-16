// config/navPrefs.ts — 사이드바 «메뉴 편집» 값의 모양과 계산 한 곳 (2026-10-16, Irene «권고대로»)
//
// Irene: *"메뉴를 주요메뉴나 자기가 선택한 순서대로 커스텀하고 가려두고 전체보기 기능이 있게 … 원하면 사용하는 거야."*
//   - 편집하는 칸은 «기능»·«개인» 둘. 대시보드·확인 필요(맨 위)와 관리·설정은 고정이다.
//   - 저장은 사람 × 워크스페이스(서버 business_members.nav_prefs — 검증 services/navPrefs.js).
//   - **숨김은 권한이 아니다** — 보기 편의일 뿐, 통합검색·탭 + 에서는 그대로 열린다(visibleNavMenus 는 이 값을 모른다).
//   - 저장 값에 없는 메뉴(새로 생긴 메뉴)는 «보이는 끝» 에 붙는다 — 새 기능이 조용히 숨지 않게.

export type NavPrefSection = 'features' | 'personal';

export interface NavPrefSectionValue { order: string[]; hidden: string[] }

export interface NavPrefs { v: 1; sections: Partial<Record<NavPrefSection, NavPrefSectionValue>> }

/** 보이는 메뉴 키(기본 순서) + 저장 값 → { shown, hidden } (둘 다 저장 순서) */
export function arrangeSection(defaultKeys: string[], pref?: NavPrefSectionValue | null): { all: string[]; shown: string[]; hidden: string[] } {
  const avail = new Set(defaultKeys);
  const order = (pref?.order || []).filter((k) => avail.has(k));
  const seen = new Set(order);
  // 저장 값에 없는 키(새 메뉴)는 기본 순서대로 끝에
  const all = [...order, ...defaultKeys.filter((k) => !seen.has(k))];
  const hiddenSet = new Set((pref?.hidden || []).filter((k) => avail.has(k)));
  return { all, shown: all.filter((k) => !hiddenSet.has(k)), hidden: all.filter((k) => hiddenSet.has(k)) };
}

/** 한 칸의 값을 바꾼 새 prefs. 기본과 같아지면 그 칸을 지운다(모두 지워지면 null = 기본 그대로). */
export function withSection(prefs: NavPrefs | null | undefined, section: NavPrefSection, defaultKeys: string[], next: NavPrefSectionValue | null): NavPrefs | null {
  const sections: NavPrefs['sections'] = { ...(prefs?.sections || {}) };
  const isDefault = !next || (next.hidden.length === 0 && next.order.join(',') === defaultKeys.join(','));
  if (isDefault) delete sections[section];
  else sections[section] = { order: [...next!.order], hidden: [...next!.hidden] };
  return Object.keys(sections).length ? { v: 1, sections } : null;
}
