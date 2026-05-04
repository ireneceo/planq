// IntersectionObserver 기반 스크롤 reveal — 화면에 들어올 때 한 번만 보이게.
// 사용:
//   const ref = useReveal<HTMLDivElement>();
//   <div ref={ref} className="reveal">...</div>
// CSS 의 .reveal { opacity: 0; transform: translateY(...); } 와
// .reveal.in { opacity: 1; transform: none; transition: ...; } 를 styled 로 같이 정의.
import { useEffect, useRef } from 'react';

export function useReveal<T extends HTMLElement>(threshold = 0.15, rootMargin = '0px 0px -10% 0px') {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      el?.classList.add('in'); // SSR / 미지원 환경 — 그냥 보임
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('in');
            obs.unobserve(e.target);
          }
        });
      },
      { threshold, rootMargin }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold, rootMargin]);
  return ref;
}
