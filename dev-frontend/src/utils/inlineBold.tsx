// 도움말·인사이트·새 소식 본문의 **굵게** 표시만 해석한다 (2026-09-22).
//   시드 글(dev-backend/seed-wiki-content.js)은 강조를 `<strong>…</strong>` 로 적는데, 세 화면
//   (WikiArticlePage · BlogPostPage · WhatsNewPage)이 본문을 글자 그대로 그려 태그가 화면에 보였다.
//   HTML 을 통째로 넣지 않는다 — `<strong>` 과 `**…**` 두 표기만 골라 React 요소로 만든다(주입 불가).
import React from 'react';

const RE = /<strong>([\s\S]*?)<\/strong>|\*\*([^*]+)\*\*/g;

export function renderInlineBold(text: string): React.ReactNode {
  if (!text || (text.indexOf('<strong>') < 0 && text.indexOf('**') < 0)) return text;
  const out: React.ReactNode[] = [];
  let last = 0; let m: RegExpExecArray | null; let k = 0;
  RE.lastIndex = 0;
  while ((m = RE.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(<strong key={k++}>{m[1] ?? m[2]}</strong>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
