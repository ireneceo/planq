// 내 명함 API — 서버 routes/name_cards.js · name_cards_public.js. 설계 docs/BUSINESS_CARD_DESIGN.md
//   ★ 공개 응답(CardView)과 받은 명함 스냅샷은 서버의 같은 함수(cardPublicView) 출력이다 — 화면도 같은 타입·같은 CardFace 로 그린다.
import { apiFetch, apiUpload } from '../contexts/AuthContext';

export interface CardLink { label: string; url: string }

/** 공개로 보이는 명함 내용 (공개 페이지 · 받은 명함 스냅샷 · 내 명함 미리보기 공통) */
export interface CardView {
  name: string;
  name_en: string | null;
  job_title: string | null;
  department: string | null;
  company: string | null;
  intro: string | null;
  mobile: string | null;
  phone: string | null;
  fax: string | null;
  email: string | null;
  website: string | null;
  address: string | null;
  links: CardLink[];
  accent_color: string | null;
  has_photo: boolean;
  photo_ver: number;
  updated_at: string | null;
}

export type ClosedReason = 'not_public' | 'no_name' | 'email_unverified' | 'owner_inactive' | null;

/** 내 명함(주인만) */
export interface MyCard extends CardView {
  id: number;
  label: string;
  source_business_id: number | null;
  is_public: boolean;
  public_token: string;
  sort_order: number;
  link_open: boolean;
  closed_reason: ClosedReason;
  url: string;
}

export interface SavedCard {
  id: number;
  card: CardView;
  has_photo: boolean;
  memo: string;
  saved_at: string;
  updated_at: string;
  source_alive: boolean;
  source_changed: boolean;
}

export interface PrefillSource { business_id: number; name: string }

/** 칸 이름 — PATCH 로 보낼 수 있는 것 */
export type CardField = 'label' | 'name' | 'name_en' | 'job_title' | 'department' | 'company' | 'intro'
  | 'mobile' | 'phone' | 'fax' | 'email' | 'website' | 'address' | 'links' | 'accent_color';

export class CardApiError extends Error {
  code: string;
  status: number;
  constructor(code: string, status: number) { super(code); this.code = code; this.status = status; }
}

async function json<T>(r: Response): Promise<T> {
  let j: { success?: boolean; data?: T; message?: string } | null = null;
  try { j = await r.json(); } catch { /* 빈 응답 */ }
  if (!r.ok || !j || !j.success) throw new CardApiError(String(j?.message || 'generic'), r.status);
  return j.data as T;
}
const body = (method: string, data?: unknown): RequestInit => ({
  method, headers: { 'Content-Type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data),
});

export const listMyCards = async () => json<MyCard[]>(await apiFetch('/api/name-cards'));
export const getMyCard = async (id: number) => json<MyCard>(await apiFetch(`/api/name-cards/${id}`));
export const createCard = async (label: string, sourceBusinessId: number | null) =>
  json<MyCard>(await apiFetch('/api/name-cards', body('POST', { label, source_business_id: sourceBusinessId })));
export const patchCard = async (id: number, patch: Partial<Record<CardField, unknown>> & { is_public?: boolean }) =>
  json<MyCard>(await apiFetch(`/api/name-cards/${id}`, body('PATCH', patch)));
export const deleteCard = async (id: number) => json<{ id: number }>(await apiFetch(`/api/name-cards/${id}`, { method: 'DELETE' }));
export const rotateCardToken = async (id: number) => json<MyCard>(await apiFetch(`/api/name-cards/${id}/rotate-token`, { method: 'POST' }));
export const duplicateCard = async (id: number) => json<MyCard>(await apiFetch(`/api/name-cards/${id}/duplicate`, { method: 'POST' }));
export const reorderCards = async (ids: number[]) => json<{ ids: number[] }>(await apiFetch('/api/name-cards/reorder', body('POST', { ids })));
export const refillCard = async (id: number, businessId: number | null, mode: 'empty' | 'all') =>
  json<MyCard>(await apiFetch(`/api/name-cards/${id}/refill`, body('POST', { business_id: businessId, mode })));
export const listPrefillSources = async () => json<PrefillSource[]>(await apiFetch('/api/name-cards/prefill-sources'));
export const uploadCardPhoto = async (id: number, file: File) => {
  const fd = new FormData();
  fd.append('file', file);
  return json<MyCard>(await apiUpload(`/api/name-cards/${id}/photo`, fd));
};
export const deleteCardPhoto = async (id: number) => json<MyCard>(await apiFetch(`/api/name-cards/${id}/photo`, { method: 'DELETE' }));
export const myCardPhotoUrl = (c: { id: number; has_photo: boolean; photo_ver: number }) =>
  (c.has_photo ? `/api/name-cards/${c.id}/photo?v=${c.photo_ver}` : null);

// 받은 명함
export const listSavedCards = async () => json<SavedCard[]>(await apiFetch('/api/name-cards/saved'));
export const saveCardByToken = async (token: string) => json<SavedCard>(await apiFetch('/api/name-cards/saved', body('POST', { token })));
export const patchSavedMemo = async (id: number, memo: string) => json<SavedCard>(await apiFetch(`/api/name-cards/saved/${id}`, body('PATCH', { memo })));
export const refreshSavedCard = async (id: number) => json<SavedCard>(await apiFetch(`/api/name-cards/saved/${id}/refresh`, { method: 'POST' }));
export const savedOpenLink = async (id: number) => json<{ url: string }>(await apiFetch(`/api/name-cards/saved/${id}/open-link`));
export const deleteSavedCard = async (id: number) => json<{ id: number }>(await apiFetch(`/api/name-cards/saved/${id}`, { method: 'DELETE' }));
export const savedPhotoUrl = (s: { id: number; has_photo: boolean; updated_at?: string }) =>
  (s.has_photo ? `/api/name-cards/saved/${s.id}/photo?v=${encodeURIComponent(s.updated_at || '')}` : null);

/** 받은 명함 .vcf — 인증 헤더가 필요해 받아서 내려받는다 */
export async function downloadSavedVcf(s: SavedCard): Promise<void> {
  const r = await apiFetch(`/api/name-cards/saved/${s.id}/vcf`);
  if (!r.ok) throw new CardApiError('generic', r.status);
  const blob = await r.blob();
  triggerDownload(blob, `${(s.card.name || 'card').replace(/[\\/:*?"<>|]+/g, '')}.vcf`);
}

export function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// 공개(무인증)
export const publicCardUrl = (token: string) => `/api/name-cards/public/${encodeURIComponent(token)}`;
export const publicPhotoUrl = (token: string, v: CardView) => (v.has_photo ? `${publicCardUrl(token)}/photo?v=${v.photo_ver}` : null);
export const publicVcfUrl = (token: string) => `${publicCardUrl(token)}/vcf`;
