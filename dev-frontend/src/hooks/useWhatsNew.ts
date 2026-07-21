// #194 제품 공지/체인지로그 — 인앱 "새 소식" 데이터 훅.
//   콘텐츠 원천: /api/whats-new (help_articles.blog_category='updates').
//   미읽음 워터마크: users.whats_new_seen_at (POST /seen 으로 갱신 → badge 소거).
//   push fan-out 없음 (설계) — mount + focus/visibility 복귀 시 폴링으로 갱신.
import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch, useAuth } from '../contexts/AuthContext';

// 본문 블록 — 백엔드가 요청 언어의 body_{lang} 배열을 내려줌 (블록마다 text_{lang}).
export interface WhatsNewBlock {
  type: 'heading' | 'text' | 'step' | 'image' | 'callout';
  text_ko?: string;
  text_en?: string;
  caption_ko?: string;
  caption_en?: string;
  file_id?: number;
}
export interface WhatsNewItem {
  slug: string;
  title: string;
  summary: string | null;
  body: WhatsNewBlock[] | null;
  published_at: string;
  is_new: boolean;
}

export function useWhatsNew() {
  const { user } = useAuth();
  const { i18n } = useTranslation();
  const lang = (i18n.language || 'ko').slice(0, 2) === 'en' ? 'en' : 'ko';

  const [items, setItems] = useState<WhatsNewItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!user) { setItems([]); setUnreadCount(0); return; }
    setLoading(true);
    try {
      const r = await apiFetch(`/api/whats-new?lang=${lang}`);
      const j = await r.json();
      if (j.success) {
        setItems(j.data?.items || []);
        setUnreadCount(Number(j.data?.unread_count) || 0);
      }
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [user?.id, lang]);

  useEffect(() => {
    if (!user) { setItems([]); setUnreadCount(0); return; }
    refresh();
    const onVisibility = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', refresh);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', refresh);
    };
  }, [user?.id, refresh]);

  // 패널 열람 → 워터마크 갱신 (badge 소거). 실패해도 로컬 상태는 정리.
  const markSeen = useCallback(async () => {
    setUnreadCount(0);
    setItems(prev => prev.map(it => ({ ...it, is_new: false })));
    try { await apiFetch('/api/whats-new/seen', { method: 'POST' }); }
    catch { /* silent — 다음 refresh 에서 정합 */ }
  }, []);

  return { items, unreadCount, loading, refresh, markSeen };
}
