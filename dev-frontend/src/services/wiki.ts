// Q위키 (Q Wiki) — 제품 도움말 API 클라이언트.
// 공개+로그인 read. 게스트는 public article 만 (apiFetch 가 토큰 없으면 게스트로 호출).
import { apiFetch } from '../contexts/AuthContext';

export interface WikiBlock {
  type: 'heading' | 'text' | 'step' | 'callout' | 'image';
  text_ko?: string;
  text_en?: string;
  // image 블록
  file_id?: number;
  source?: string;
  caption_ko?: string;
  caption_en?: string;
}

export interface WikiCategory {
  id: number;
  slug: string;
  title: string;
  summary: string | null;
  icon: string | null;
  sort_order: number;
  article_count?: number;
}

export interface WikiArticleSummary {
  id: number;
  slug: string;
  category_id: number;
  title: string;
  summary: string | null;
  visibility: 'public' | 'authenticated';
  linked_route: string | null;
  est_minutes: number | null;
  view_count: number;
  updated_at: string;
  category?: { id: number; slug: string; title: string };
}

export interface WikiArticleDetail extends WikiArticleSummary {
  body: WikiBlock[] | null;
  related: WikiArticleSummary[];
}

async function getJson<T>(url: string): Promise<T> {
  const r = await apiFetch(url);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j?.success === false) {
    const err = new Error(j?.message || `request failed (${r.status})`);
    (err as Error & { status?: number }).status = r.status;
    throw err;
  }
  return j.data as T;
}

const langParam = () => {
  const lng = (localStorage.getItem('i18nextLng') || 'ko').slice(0, 2);
  return lng === 'en' ? 'en' : 'ko';
};

export async function fetchWikiCategories(): Promise<WikiCategory[]> {
  return getJson<WikiCategory[]>(`/api/wiki/categories?lang=${langParam()}`);
}

export async function fetchWikiArticles(params: { category?: string; q?: string; limit?: number; page?: number } = {}): Promise<{ data: WikiArticleSummary[]; total: number }> {
  const sp = new URLSearchParams();
  sp.set('lang', langParam());
  if (params.category) sp.set('category', params.category);
  if (params.q) sp.set('q', params.q);
  if (params.limit) sp.set('limit', String(params.limit));
  if (params.page) sp.set('page', String(params.page));
  const r = await apiFetch(`/api/wiki/articles?${sp.toString()}`);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.message || 'failed');
  return { data: (j.data || []) as WikiArticleSummary[], total: j.pagination?.total ?? (j.data || []).length };
}

export async function fetchWikiArticle(slug: string): Promise<WikiArticleDetail> {
  return getJson<WikiArticleDetail>(`/api/wiki/articles/${encodeURIComponent(slug)}?lang=${langParam()}`);
}

export async function fetchWikiContext(path: string): Promise<WikiArticleSummary[]> {
  return getJson<WikiArticleSummary[]>(`/api/wiki/context?lang=${langParam()}&path=${encodeURIComponent(path)}`);
}
