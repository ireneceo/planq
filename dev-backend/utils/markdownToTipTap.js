// 마크다운 → TipTap JSON — routes/posts.js 에서 옮겼다(파일 크기 래칫). 동작은 그대로다.
// 단순 변환 — heading/paragraph/bulletList 만
function markdownToTipTap(md) {
  const lines = String(md || '').split('\n');
  const content = [];
  let bullets = null;
  const flushBullets = () => {
    if (bullets && bullets.length) {
      content.push({
        type: 'bulletList',
        content: bullets.map(b => ({
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: b }] }],
        })),
      });
    }
    bullets = null;
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { flushBullets(); continue; }
    const h2 = /^##\s+(.*)$/.exec(line);
    const h3 = /^###\s+(.*)$/.exec(line);
    const h1 = /^#\s+(.*)$/.exec(line);
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (h1 || h2 || h3) {
      flushBullets();
      const txt = (h1 || h2 || h3)[1];
      const lvl = h1 ? 1 : h2 ? 2 : 3;
      content.push({ type: 'heading', attrs: { level: lvl }, content: [{ type: 'text', text: txt }] });
    } else if (bullet) {
      if (!bullets) bullets = [];
      bullets.push(bullet[1]);
    } else {
      flushBullets();
      content.push({ type: 'paragraph', content: [{ type: 'text', text: line }] });
    }
  }
  flushBullets();
  return { type: 'doc', content };
}

module.exports = { markdownToTipTap };
