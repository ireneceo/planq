// N+88 — Q Note 요약 → Q docs 문서 저장.
// 요약(key_points + full)을 TipTap doc 으로 빌드해 createPost 로 저장. 사적 기본(L1).
import { createPost } from '../services/posts';
import type { PostDetail } from '../services/posts';

interface SummaryDocLabels {
  keyPoints: string;  // "핵심 요점" (i18n 경유 — 호출부에서 t() 로 전달)
  full: string;       // "전체 요약"
}

type TiptapNode = { type: string; attrs?: Record<string, unknown>; content?: TiptapNode[]; text?: string };

export function buildSummaryDoc(keyPoints: string[], full: string, labels: SummaryDocLabels): TiptapNode {
  const content: TiptapNode[] = [];
  if (keyPoints.length > 0) {
    content.push({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: labels.keyPoints }] });
    content.push({
      type: 'bulletList',
      content: keyPoints.map((p) => ({
        type: 'listItem',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: p }] }],
      })),
    });
  }
  if (full) {
    content.push({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: labels.full }] });
    full.split('\n').map((l) => l.trim()).filter(Boolean).forEach((line) => {
      content.push({ type: 'paragraph', content: [{ type: 'text', text: line }] });
    });
  }
  if (content.length === 0) content.push({ type: 'paragraph' });
  return { type: 'doc', content };
}

export async function saveSummaryAsDoc(opts: {
  businessId: number;
  title: string;
  keyPoints: string[];
  full: string;
  labels: SummaryDocLabels;
}): Promise<PostDetail> {
  const doc = buildSummaryDoc(opts.keyPoints, opts.full, opts.labels);
  // 사적 기본 — Q Note 출력은 본인 것 (design §3 "사적 기본 유지")
  return createPost({
    business_id: opts.businessId,
    title: opts.title.slice(0, 200),
    content_json: doc as unknown as Parameters<typeof createPost>[0]['content_json'],
    vlevel: 'L1',
  });
}
