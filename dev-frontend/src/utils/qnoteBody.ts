// Q Note 메모 body 컬럼 (TEXT) 변환 헬퍼 — 사이클 N+17
// 메모 popup 이 TipTap RichEditor 로 업그레이드되면서 body 컬럼에 JSON.stringify(doc) 저장.
// 기존 plain text body 와 호환 (parse 실패 시 paragraph 1개로 wrap).
// list / dropdown 미리보기 / 자동 제목 추출 모두 이 헬퍼 경유.

export function parseBodyToDoc(raw: string | null | undefined): unknown {
  if (!raw) return { type: 'doc', content: [{ type: 'paragraph' }] };
  const trimmed = raw.trim();
  if (trimmed.startsWith('{') && trimmed.includes('"type"')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && parsed.type === 'doc') return parsed;
    } catch { /* fallback */ }
  }
  // legacy plain text — paragraph 들로 wrap (줄바꿈 보존)
  const lines = raw.split('\n');
  return {
    type: 'doc',
    content: lines.map((l) => l.trim()
      ? { type: 'paragraph', content: [{ type: 'text', text: l }] }
      : { type: 'paragraph' }
    ),
  };
}

// JSON 의 text node 들을 flat 추출 — 자동 제목 / 미리보기 / 검색용
export function extractPlainText(rawOrDoc: string | unknown): string {
  const doc = typeof rawOrDoc === 'string' ? parseBodyToDoc(rawOrDoc) : rawOrDoc;
  if (!doc || typeof doc !== 'object') return '';
  const out: string[] = [];
  const walk = (node: any) => {
    if (!node) return;
    if (typeof node.text === 'string') { out.push(node.text); return; }
    if (Array.isArray(node.content)) {
      node.content.forEach((c: any, i: number) => {
        walk(c);
        if (i < node.content.length - 1 && (
          c?.type === 'paragraph' || c?.type === 'heading' ||
          c?.type === 'codeBlock' || c?.type === 'bulletList' ||
          c?.type === 'orderedList' || c?.type === 'blockquote'
        )) out.push('\n');
      });
    }
  };
  walk(doc);
  return out.join('').replace(/\n{3,}/g, '\n\n');
}

export function deriveTitleFromDoc(rawOrDoc: string | unknown): string {
  const plain = extractPlainText(rawOrDoc);
  const firstLine = plain.split('\n').find((l) => l.trim());
  return (firstLine || '').trim().slice(0, 200) || 'Untitled';
}

export function deriveMemoPreview(rawOrDoc: string | unknown, maxLen = 80): string {
  const plain = extractPlainText(rawOrDoc);
  const compact = plain.split('\n').slice(0, 2).join(' · ').replace(/\s+/g, ' ').trim();
  return compact.slice(0, maxLen);
}

export function isDocEmpty(rawOrDoc: string | unknown): boolean {
  return !extractPlainText(rawOrDoc).trim();
}
