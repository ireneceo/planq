// 랜딩 공개 페이지의 제목·설명·대표 주소를 화면 이동에 맞춰 바꾼다 (2026-09-21).
//   정본은 public/seo-pages.json — 운영의 검색용 HTML(dev-backend/services/seoArtifacts.js)도 같은 파일로 만든다.
//   첫 로드는 그 HTML 이 이미 맞는 머리를 갖고 오고, 이 훅은 **사이트 안에서 옮겨 다닐 때**를 맞춘다
//   (안 그러면 /features 로 이동해도 제목이 홈 것으로 남는다 — Google 은 자바스크립트 실행 후의 값도 본다).
//   ★ 워크스페이스(그룹웨어) 화면은 대상이 아니다 — LandingLayout 안에서만 부른다.
//   목록에 없는 주소(인사이트 글 등)는 손대지 않는다 — 그 화면이 스스로 정한다(BlogPostPage).
import { useEffect } from 'react';

interface SeoPage { path: string; title: { ko: string; en: string }; description: { ko: string; en: string } }
interface SeoConfig { origin: string; pages: SeoPage[] }

let cache: Promise<SeoConfig | null> | null = null;
const load = () => {
  if (!cache) cache = fetch('/seo-pages.json').then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return cache;
};
const norm = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') : p);

function setMeta(sel: string, attr: 'name' | 'property', key: string, value: string) {
  let el = document.head.querySelector(sel) as HTMLMetaElement | null;
  if (!el) { el = document.createElement('meta'); el.setAttribute(attr, key); document.head.appendChild(el); }
  el.content = value;
}

export function useSeoHead(pathname: string, lang: string) {
  useEffect(() => {
    let alive = true;
    load().then((cfg) => {
      if (!alive || !cfg) return;
      const page = cfg.pages.find((p) => norm(p.path) === norm(pathname));
      if (!page) return;
      const l = lang.startsWith('en') ? 'en' : 'ko';
      const url = cfg.origin + page.path;
      document.title = page.title[l];
      setMeta('meta[name="description"]', 'name', 'description', page.description[l]);
      setMeta('meta[property="og:title"]', 'property', 'og:title', page.title[l]);
      setMeta('meta[property="og:description"]', 'property', 'og:description', page.description[l]);
      setMeta('meta[property="og:url"]', 'property', 'og:url', url);
      let link = document.head.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
      if (!link) { link = document.createElement('link'); link.rel = 'canonical'; document.head.appendChild(link); }
      link.href = url;
    });
    return () => { alive = false; };
  }, [pathname, lang]);
}
