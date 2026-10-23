// utils/clientLabel — 고객의 «관계» 표시 한 벌 (docs/CLIENT_ADD_INVITE_DESIGN.md §1·§5, Fable 2026-10-23)
//   문의 · 추가한 고객 · 초대 중 · 참여 중 — 값은 서버 `access_kind`(services/clientAccess.accessKindOf) 하나다.
//   ★ 화면이 status·user_id 로 스스로 판정하지 않는다. 응답에 access_kind 가 없으면 이름만 보인다.
//   글자는 qsale:access.<kind> — 목록 칩·상세 배지·고객 선택 칸 옵션이 같은 글자를 쓴다.
import type { TFunction } from 'i18next';

export type AccessKind = 'prospect' | 'managed' | 'invited' | 'member';
export const ACCESS_KINDS: AccessKind[] = ['prospect', 'managed', 'invited', 'member'];

/** 칩 색 — 모양·크기는 쓰는 곳이 정한다 */
export const ACCESS_STYLE: Record<AccessKind, { bg: string; fg: string }> = {
  prospect: { bg: '#FAF5FF', fg: '#7E22CE' },
  managed: { bg: '#F1F5F9', fg: '#475569' },
  invited: { bg: '#FEF9C3', fg: '#854D0E' },
  member: { bg: '#DBEAFE', fg: '#1D4ED8' },
};

export function isAccessKind(v: unknown): v is AccessKind {
  return typeof v === 'string' && (ACCESS_KINDS as string[]).includes(v);
}

/** 관계 글자 — 모르는 값이면 null(조용히 다른 글자로 떨어뜨리지 않는다) */
export function accessLabel(kind: unknown, t: TFunction): string | null {
  return isAccessKind(kind) ? (t(`qsale:access.${kind}`) as string) : null;
}

/** 고객 선택 칸 옵션 글자 — «이름 · 추가한 고객» */
export function clientOptionLabel(name: string, c: object | null | undefined, t: TFunction): string {
  const rel = accessLabel((c as { access_kind?: unknown } | null | undefined)?.access_kind, t);
  return rel ? `${name} · ${rel}` : name;
}
