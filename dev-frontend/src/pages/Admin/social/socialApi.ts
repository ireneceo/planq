// 플랫폼 관리자 > SNS 발송 — 서버 dev-backend/routes/admin_social.js 와 주고받는 모양 한 벌.
//   설계 docs/SNS_PUBLISH_DESIGN.md (단계 1: 외부 발송 없음).
import { apiFetch } from '../../../contexts/AuthContext';

export type SocialProvider = 'linkedin' | 'facebook' | 'instagram' | 'threads' | 'naver' | 'kakao' | 'youtube';
export type SocialStatus = 'draft' | 'approved' | 'scheduled' | 'sending' | 'sent' | 'failed' | 'canceled';

export interface SocialChannel { provider: SocialProvider; mode: 'auto' | 'semi'; max_chars: number }
export interface SocialAccount {
  id: number; provider: SocialProvider; display_name: string | null; status: string;
  token_expires_at: string | null; token_set: boolean;
}
export interface SocialArticleRow {
  id: number; slug: string; title_ko: string; summary_ko: string | null; blog_category: string | null;
  published_at: string | null; og_image_url: string | null; post_counts: Partial<Record<SocialStatus, number>>;
}
export interface SocialMedia { index: number; w: number; h: number; template: string; has_jpg: boolean }
export interface SocialPost {
  id: number; article_id: number; provider: SocialProvider; mode: 'auto' | 'semi' | null; angle: number; kind: string;
  body: string | null; first_comment: string | null; link_url: string | null; media: SocialMedia[];
  status: SocialStatus; approved_at: string | null; sent_at: string | null; external_url: string | null;
}

export const SOCIAL_API = '/api/admin/social';

/** 실패는 던진다 — 코드(message)를 화면이 i18n 으로 바꾼다. 429 는 rate 로. */
export async function socialCall<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await apiFetch(path, init);
  const j = await r.json().catch(() => null);
  if (r.status === 429) throw new Error('rate');
  if (!r.ok || !j?.success) throw new Error(j?.message || `http_${r.status}`);
  return j.data as T;
}

export const jsonInit = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
});

export const mediaPath = (postId: number, idx: number, opts: { jpg?: boolean; download?: boolean } = {}) => {
  const q = new URLSearchParams();
  if (opts.jpg) q.set('format', 'jpg');
  if (opts.download) q.set('download', '1');
  const s = q.toString();
  return `/api/admin/social/posts/${postId}/media/${idx}${s ? `?${s}` : ''}`;
};

/** 관리자 전용 이미지(인증 헤더가 필요해 <img src> 로 못 연다) → blob 주소 */
export async function fetchBlobUrl(path: string): Promise<string> {
  const r = await apiFetch(path);
  if (!r.ok) throw new Error(`http_${r.status}`);
  return URL.createObjectURL(await r.blob());
}

export async function downloadMedia(postId: number, idx: number, fileName: string) {
  const url = await fetchBlobUrl(mediaPath(postId, idx, { jpg: true, download: true }));
  const a = document.createElement('a');
  a.href = url; a.download = fileName;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
