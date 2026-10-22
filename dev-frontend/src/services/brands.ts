// 브랜드 API — 서버 routes/brands.js. 설계 docs/NAME_CARD_V2_DESIGN.md 결정 1·2
//   워크스페이스 브랜드(/api/businesses/:biz/brands — 쓰기는 대표·관리자) · 개인 브랜드(/api/me/brands — 본인)가 **같은 모양**이라
//   화면은 BrandApi 하나로 둘을 다룬다(BrandForm 이 어느 쪽인지 모른다).
import { apiFetch, apiUpload } from '../contexts/AuthContext';
import { CardApiError, type BrandItem, type BrandLink } from './nameCards';

async function json<T>(r: Response): Promise<T> {
  let j: { success?: boolean; data?: T; message?: string } | null = null;
  try { j = await r.json(); } catch { /* 빈 응답 */ }
  if (!r.ok || !j || !j.success) throw new CardApiError(String(j?.message || 'generic'), r.status);
  return j.data as T;
}
const body = (method: string, data?: unknown): RequestInit => ({
  method, headers: { 'Content-Type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data),
});

export interface BrandPatch {
  name?: string; name_en?: string | null; tagline?: string | null; tagline_en?: string | null; links?: BrandLink[];
}

export interface BrandApi {
  list: () => Promise<BrandItem[]>;
  create: (p: BrandPatch) => Promise<BrandItem>;
  update: (id: number, p: BrandPatch) => Promise<BrandItem>;
  remove: (id: number) => Promise<{ id: number; card_count: number }>;
  uploadLogo: (id: number, file: File) => Promise<BrandItem>;
  removeLogo: (id: number) => Promise<BrandItem>;
  setDefault?: (id: number) => Promise<BrandItem>;
}

function makeApi(base: string, withDefault: boolean): BrandApi {
  return {
    list: async () => json<BrandItem[]>(await apiFetch(base)),
    create: async (p) => json<BrandItem>(await apiFetch(base, body('POST', p))),
    update: async (id, p) => json<BrandItem>(await apiFetch(`${base}/${id}`, body('PUT', p))),
    remove: async (id) => json<{ id: number; card_count: number }>(await apiFetch(`${base}/${id}`, { method: 'DELETE' })),
    uploadLogo: async (id, file) => { const fd = new FormData(); fd.append('file', file); return json<BrandItem>(await apiUpload(`${base}/${id}/logo`, fd)); },
    removeLogo: async (id) => json<BrandItem>(await apiFetch(`${base}/${id}/logo`, { method: 'DELETE' })),
    ...(withDefault ? { setDefault: async (id: number) => json<BrandItem>(await apiFetch(`${base}/${id}/default`, { method: 'POST' })) } : {}),
  };
}

export const workspaceBrandApi = (businessId: number) => makeApi(`/api/businesses/${businessId}/brands`, true);
export const myBrandApi = () => makeApi('/api/me/brands', false);
