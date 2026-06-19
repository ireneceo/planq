// Q위키 (Q Wiki) Platform Admin API 래퍼 — /api/admin/wiki/*
// 모든 호출 platform_admin 전용 (백엔드 requireRole 이중 가드).
import { apiFetch } from '../contexts/AuthContext';

export interface WikiCategoryAdmin {
  id: number;
  slug: string;
  title_ko: string;
  title_en: string;
  summary_ko: string | null;
  summary_en: string | null;
  icon: string | null;
  sort_order: number;
  article_count: number;
}

// 본문 블록 — body_ko/body_en 은 index 병렬 배열. 에디터는 통합 블록으로 다룬 뒤 저장 시 분리.
export type WikiBlockType = 'text' | 'heading' | 'step' | 'callout' | 'image';
export interface WikiEditBlock {
  type: WikiBlockType;
  text_ko?: string;
  text_en?: string;
  file_id?: number | null;
  caption_ko?: string;
  caption_en?: string;
}

export interface WikiArticleAdmin {
  id: number;
  slug: string;
  category_id: number;
  title_ko: string;
  title_en: string;
  summary_ko: string | null;
  summary_en: string | null;
  body_ko: Array<Record<string, unknown>> | null;
  body_en: Array<Record<string, unknown>> | null;
  visibility: 'public' | 'authenticated';
  linked_route: string | null;
  est_minutes: number | null;
  sort_order: number;
  is_published: boolean;
  category?: { id: number; slug: string; title_ko: string; title_en: string };
}

async function jq<T>(p: Promise<Response>): Promise<T> {
  const res = await p;
  const j = await res.json();
  if (!res.ok || !j.success) throw new Error(j.message || `HTTP ${res.status}`);
  return j.data as T;
}

// ─── 카테고리 ───
export const listWikiCategories = () =>
  jq<WikiCategoryAdmin[]>(apiFetch('/api/admin/wiki/categories'));

export const createWikiCategory = (body: Partial<WikiCategoryAdmin>) =>
  jq<WikiCategoryAdmin>(apiFetch('/api/admin/wiki/categories', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }));

export const updateWikiCategory = (id: number, body: Partial<WikiCategoryAdmin>) =>
  jq<WikiCategoryAdmin>(apiFetch(`/api/admin/wiki/categories/${id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }));

export const deleteWikiCategory = (id: number) =>
  jq<{ id: number }>(apiFetch(`/api/admin/wiki/categories/${id}`, { method: 'DELETE' }));

// ─── article ───
export async function listWikiArticles(opts: { category?: number; q?: string } = {}): Promise<WikiArticleAdmin[]> {
  const sp = new URLSearchParams();
  if (opts.category) sp.set('category', String(opts.category));
  if (opts.q) sp.set('q', opts.q);
  sp.set('limit', '500');
  const res = await apiFetch(`/api/admin/wiki/articles?${sp.toString()}`);
  const j = await res.json();
  if (!res.ok || !j.success) throw new Error(j.message || 'load failed');
  return Array.isArray(j.data) ? j.data : [];
}

export const getWikiArticle = (id: number) =>
  jq<WikiArticleAdmin>(apiFetch(`/api/admin/wiki/articles/${id}`));

export const createWikiArticle = (body: Partial<WikiArticleAdmin>) =>
  jq<WikiArticleAdmin>(apiFetch('/api/admin/wiki/articles', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }));

export const updateWikiArticle = (id: number, body: Partial<WikiArticleAdmin>) =>
  jq<WikiArticleAdmin>(apiFetch(`/api/admin/wiki/articles/${id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }));

export const deleteWikiArticle = (id: number) =>
  jq<{ id: number }>(apiFetch(`/api/admin/wiki/articles/${id}`, { method: 'DELETE' }));

export const captureWikiArticle = (id: number) =>
  jq<{ id: number; status: string }>(apiFetch(`/api/admin/wiki/articles/${id}/capture`, { method: 'POST' }));

export const reembedWiki = (articleId?: number) =>
  jq<{ status: string }>(apiFetch('/api/admin/wiki/reembed', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(articleId ? { article_id: articleId } : {}),
  }));

// ─── body_ko/body_en (병렬 배열) ↔ 통합 블록 변환 ───
export function blocksFromBodies(
  bodyKo: Array<Record<string, unknown>> | null,
  bodyEn: Array<Record<string, unknown>> | null,
): WikiEditBlock[] {
  const ko = Array.isArray(bodyKo) ? bodyKo : [];
  const en = Array.isArray(bodyEn) ? bodyEn : [];
  const n = Math.max(ko.length, en.length);
  const out: WikiEditBlock[] = [];
  for (let i = 0; i < n; i++) {
    const k = (ko[i] || {}) as Record<string, unknown>;
    const e = (en[i] || {}) as Record<string, unknown>;
    const type = (k.type || e.type || 'text') as WikiBlockType;
    out.push({
      type,
      text_ko: (k.text_ko as string) || '',
      text_en: (e.text_en as string) || '',
      file_id: (k.file_id as number) ?? (e.file_id as number) ?? null,
      caption_ko: (k.caption_ko as string) || '',
      caption_en: (e.caption_en as string) || '',
    });
  }
  return out;
}

export function bodiesFromBlocks(blocks: WikiEditBlock[]): {
  body_ko: Array<Record<string, unknown>>;
  body_en: Array<Record<string, unknown>>;
} {
  const body_ko: Array<Record<string, unknown>> = [];
  const body_en: Array<Record<string, unknown>> = [];
  for (const b of blocks) {
    if (b.type === 'image') {
      body_ko.push({ type: 'image', file_id: b.file_id ?? null, caption_ko: b.caption_ko || '' });
      body_en.push({ type: 'image', file_id: b.file_id ?? null, caption_en: b.caption_en || '' });
    } else {
      body_ko.push({ type: b.type, text_ko: b.text_ko || '' });
      body_en.push({ type: b.type, text_en: b.text_en || '' });
    }
  }
  return { body_ko, body_en };
}
