// 초안 저장소 — React 없는 한 곳. docs/DRAFT_PERSISTENCE_DESIGN.md D-C1 · D-C5
//
// 형식 `{ v: 2, value, editedAt, cleared?, base? }` — editedAt 은 **마지막 편집 시각**(쓴 시각이 아니다).
// 쓰기는 같은 문서에 `planq:draft-written` 이벤트를 낸다(storage 이벤트는 자기 문서에 오지 않는다 —
// keep-alive 탭끼리는 이 이벤트로만 서로를 안다).
import { DRAFT_KINDS, DEFAULT_DRAFT_TTL_MS, draftKindSpec } from '../hooks/draftKinds';

export interface DraftRecord<T = unknown> {
  v: 2;
  value: T;
  editedAt: number;
  cleared?: boolean;
  base?: string;
  /** 사람이 알아볼 이름(예: 업무 제목) — 로그아웃 확인창이 목록으로 보여준다 */
  label?: string;
  /** 서버에 보내려면 반복 업무 적용 범위를 먼저 골라야 한다 — 로그아웃 전에 확인한다(LeaveDecisionGuard) */
  series?: boolean;
}

export const DRAFT_PREFIX = 'planq:draft:';
export const DRAFT_OWNER_KEY = 'planq:draft:owner';
export const DRAFT_EVENT = 'planq:draft-written';
export const DRAFT_SUPPRESS_EVENT = 'planq:drafts-suppressed';
const LEGACY_MEETING_KEY = 'qnote_meeting_draft_v1';
const LEGACY_FORWARD_PREFIX = 'qmail-fwd-';

// ─── 정지 스위치 — 로그아웃 뒤·다른 사용자로 바뀐 탭에서 옛 사람 초안을 다시 쓰지 않게 ───
let suppressed = false;
export const isDraftsSuppressed = (): boolean => suppressed;
export function setDraftsSuppressed(v: boolean): void {
  if (suppressed === v) return;
  suppressed = v;
  try { window.dispatchEvent(new Event(DRAFT_SUPPRESS_EVENT)); } catch { /* noop */ }
}

const safe = (s: unknown) => String(s ?? '').replace(/:/g, '_');

/** 키 한 곳 — 셋 중 하나라도 없으면 null(=보존 안 함) */
export function draftStorageKey(kind: string, userId: unknown, bizId: unknown, entityId: unknown): string | null {
  if (!draftKindSpec(kind)) return null;
  const uid = String(userId ?? '').trim();
  const biz = String(bizId ?? '').trim();
  const ent = String(entityId ?? '').trim();
  if (!uid || uid === '0' || !biz || biz === '0' || !ent) return null;
  return `${DRAFT_PREFIX}${kind}:${safe(uid)}:${safe(biz)}:${safe(ent)}`;
}

/** `planq:draft:{kind}:{uid}:{biz}:{entity}` 에서 kind·uid·biz·entity (옛 키는 biz·entity 가 비어 있을 수 있다) */
export function parseDraftKey(key: string): { kind: string; uid: string; biz: string; entity: string } | null {
  if (!key.startsWith(DRAFT_PREFIX) || key === DRAFT_OWNER_KEY) return null;
  const parts = key.slice(DRAFT_PREFIX.length).split(':');
  if (parts.length < 2) return null;
  return { kind: parts[0], uid: parts[1], biz: parts[2] ?? '', entity: parts.slice(3).join(':') };
}

/** 로그아웃을 멈추게 하는 초안 — **판정 한 곳**. AuthContext(멈춤)와 LeaveDecisionGuard(목록)가 같이 부른다.
 *  두 곳이 조건을 따로 적으면 어긋나는 순간 로그아웃이 창 없이 조용히 멈춘다(Fable 2026-09-11 지적). */
export function listLeaveBlockers(userId: unknown): Array<{ key: string; biz: string; taskId: number; record: DraftRecord<string> }> {
  return listDraftRecords<string>(['task-description'], userId)
    .filter((d) => d.record.series === true && typeof d.record.value === 'string' && Number(d.entity) > 0)
    .map((d) => ({ key: d.key, biz: d.biz, taskId: Number(d.entity), record: d.record }));
}

/** 한 사용자의 특정 종류 초안을 모아 본다 — 키를 손으로 조립하지 않는다(로그아웃 확인창) */
export function listDraftRecords<T = unknown>(kinds: string[], userId: unknown): Array<{ key: string; kind: string; biz: string; entity: string; record: DraftRecord<T> }> {
  const me = String(userId ?? '');
  const out: Array<{ key: string; kind: string; biz: string; entity: string; record: DraftRecord<T> }> = [];
  if (!me) return out;
  for (const k of allKeys()) {
    const p = parseDraftKey(k);
    if (!p || p.uid !== me || !kinds.includes(p.kind)) continue;
    const rec = readDraftRecord<T>(k);
    if (!rec || rec.cleared) continue;
    out.push({ key: k, kind: p.kind, biz: p.biz, entity: p.entity, record: rec });
  }
  return out;
}

function ttlOf(key: string): number {
  const p = parseDraftKey(key);
  return (p && draftKindSpec(p.kind)?.ttlMs) || DEFAULT_DRAFT_TTL_MS;
}

/** 옛 형식 `{ value, savedAt }` 도 읽는다. 만료·깨진 값은 지우고 null. cleared 레코드도 raw 로 돌려준다. */
export function parseDraftRecord<T = unknown>(raw: string | null, key?: string): DraftRecord<T> | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    if (!o || typeof o !== 'object') return null;
    if (o.v === 2 && typeof o.editedAt === 'number') return o as DraftRecord<T>;
    if (typeof o.savedAt === 'number' && 'value' in o) return { v: 2, value: o.value as T, editedAt: o.savedAt };
    return null;
  } catch {
    if (key) { try { localStorage.removeItem(key); } catch { /* noop */ } }
    return null;
  }
}

export function readDraftRecord<T = unknown>(key: string | null): DraftRecord<T> | null {
  if (!key) return null;
  let raw: string | null = null;
  try { raw = localStorage.getItem(key); } catch { return null; }
  const rec = parseDraftRecord<T>(raw, key);
  if (!rec) return null;
  if (Date.now() - rec.editedAt > ttlOf(key)) {
    try { localStorage.removeItem(key); } catch { /* noop */ }
    return null;
  }
  return rec;
}

function emit(key: string, record: DraftRecord | null): void {
  try { window.dispatchEvent(new CustomEvent(DRAFT_EVENT, { detail: { key, record } })); } catch { /* noop */ }
}

function setItemWithSweep(key: string, json: string): boolean {
  try { localStorage.setItem(key, json); return true; } catch {
    // quota — 만료 청소 1회 후 재시도, 그래도 실패면 조용히 포기(입력 자체는 막지 않는다)
    sweepExpiredDrafts();
    try { localStorage.setItem(key, json); return true; } catch { return false; }
  }
}

/** 편집 시각을 박아 쓴다. 빈 문자열도 지우지 않고 툼스톤으로 쓴다(남의 삭제가 내 글을 비우지 않게). */
export function writeDraftRecord<T = unknown>(key: string, value: T, editedAt: number, extra?: { base?: string; label?: string; series?: boolean }): boolean {
  if (suppressed) return false;
  const record: DraftRecord<T> = { v: 2, value, editedAt };
  if (extra && typeof extra.base === 'string') record.base = extra.base;
  if (extra && typeof extra.label === 'string' && extra.label) record.label = extra.label;
  if (extra && extra.series) record.series = true;
  const ok = setItemWithSweep(key, JSON.stringify(record));
  if (ok) emit(key, record as DraftRecord);
  return ok;
}

/** 제출 성공 — cleared 레코드를 알린 뒤 지운다(받는 쪽은 레코드 자체로 판정, 재읽기 금지) */
export function clearDraftRecord(key: string | null): void {
  if (!key) return;
  const record: DraftRecord<string> = { v: 2, value: '', editedAt: Date.now(), cleared: true };
  try { localStorage.setItem(key, JSON.stringify(record)); } catch { /* noop */ }
  emit(key, record);
  try { localStorage.removeItem(key); } catch { /* noop */ }
}

/** 새 키가 비었고 옛 키의 uid 가 현재 사용자일 때만 옮긴다. uid 가 다르거나 0 이면 지우기만. */
export function migrateLegacyDraft(legacyKey: string | null | undefined, newKey: string | null, currentUserId: unknown): void {
  if (!legacyKey || !newKey || legacyKey === newKey) return;
  let raw: string | null = null;
  try { raw = localStorage.getItem(legacyKey); } catch { return; }
  if (raw == null) return;
  const legacyUid = parseDraftKey(legacyKey)?.uid
    ?? (legacyKey.startsWith(LEGACY_FORWARD_PREFIX) ? legacyKey.slice(LEGACY_FORWARD_PREFIX.length).split('-')[0] : null);
  const sameUser = legacyUid != null && String(legacyUid) === String(currentUserId) && String(legacyUid) !== '0';
  try {
    if (sameUser && localStorage.getItem(newKey) == null) {
      const rec = parseDraftRecord(raw);
      if (rec && !rec.cleared) localStorage.setItem(newKey, JSON.stringify({ v: 2, value: rec.value, editedAt: rec.editedAt }));
    }
    localStorage.removeItem(legacyKey);
  } catch { /* noop */ }
}

function allKeys(): string[] {
  const out: string[] = [];
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k) out.push(k); } } catch { /* noop */ }
  return out;
}

/** 부팅 1회 — kind 별 TTL 지난 초안·툼스톤 삭제 (owner 센티널 제외) */
export function sweepExpiredDrafts(): void {
  const now = Date.now();
  for (const k of allKeys()) {
    if (!k.startsWith(DRAFT_PREFIX) || k === DRAFT_OWNER_KEY) continue;
    let raw: string | null = null;
    try { raw = localStorage.getItem(k); } catch { continue; }
    const rec = parseDraftRecord(raw);
    if (!rec || rec.cleared || now - rec.editedAt > ttlOf(k)) {
      try { localStorage.removeItem(k); } catch { /* noop */ }
    }
  }
}

/** 정체 확정 — 현재 사용자가 아닌 사람의 초안(옛 키 포함)을 지운다. 공용 PC·다른 사람 로그인·세션 만료 경로. */
export function purgeDraftsNotOwnedBy(userId: unknown): void {
  const me = String(userId ?? '');
  for (const k of allKeys()) {
    if (k === DRAFT_OWNER_KEY) continue;
    if (k === LEGACY_MEETING_KEY) { try { localStorage.removeItem(k); } catch { /* noop */ } continue; }
    if (k.startsWith(LEGACY_FORWARD_PREFIX)) {
      const uid = k.slice(LEGACY_FORWARD_PREFIX.length).split('-')[0];
      if (uid !== me) { try { localStorage.removeItem(k); } catch { /* noop */ } }
      continue;
    }
    const p = parseDraftKey(k);
    if (p && p.uid !== me) { try { localStorage.removeItem(k); } catch { /* noop */ } }
  }
}

/** 로그아웃 — 그 사용자의 초안(옛 키 포함) 삭제 */
export function purgeDraftsOf(userId: unknown): void {
  const me = String(userId ?? '');
  if (!me) return;
  for (const k of allKeys()) {
    if (k === DRAFT_OWNER_KEY) continue;
    if (k === LEGACY_MEETING_KEY) { try { localStorage.removeItem(k); } catch { /* noop */ } continue; }
    if (k.startsWith(LEGACY_FORWARD_PREFIX) && k.slice(LEGACY_FORWARD_PREFIX.length).split('-')[0] === me) {
      try { localStorage.removeItem(k); } catch { /* noop */ }
      continue;
    }
    const p = parseDraftKey(k);
    if (p && p.uid === me) { try { localStorage.removeItem(k); } catch { /* noop */ } }
  }
}

export function setDraftOwner(userId: unknown): void {
  try { localStorage.setItem(DRAFT_OWNER_KEY, String(userId ?? '')); } catch { /* noop */ }
}

export function readDraftOwner(): string | null {
  try { return localStorage.getItem(DRAFT_OWNER_KEY); } catch { return null; }
}

// 개발 확인용 — 등록표를 한 곳에서 다시 내보낸다(가드·카나리가 import 없이 대조할 수 있게 목록 문자열)
export const REGISTERED_DRAFT_KINDS = Object.keys(DRAFT_KINDS);
