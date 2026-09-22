// 문서 안의 «서명란» 을 읽는다 — 읽는 공식은 여기 한 곳이다 (2026-09-22).
//
// 편집기(다음 칸 번호)·서명 요청 창(칸마다 서명자 배정)·상세 화면이 각자 content_json 을 훑으면
// 조건이 갈라진다(memory feedback_same_value_multiple_formulas). 서버 조립은
// `services/signedDocument.js` 가 **저장된 HTML 속성**으로 하고, 여기는 **편집 문서(JSON)** 를 본다.
export interface DocSignatureField {
  slot: number;
  party: 'us' | 'them';
  label: string | null;
}

type Node = { type?: string; attrs?: Record<string, unknown>; content?: Node[] };

/** content_json(문자열 또는 객체) 안의 서명란을 칸 번호 순으로. 같은 번호가 둘이면 앞엣것만. */
export function readSignatureFields(contentJson: unknown): DocSignatureField[] {
  let doc: Node | null = null;
  try {
    doc = typeof contentJson === 'string' ? JSON.parse(contentJson) : (contentJson as Node);
  } catch { return []; }
  if (!doc || typeof doc !== 'object') return [];

  const out: DocSignatureField[] = [];
  const seen = new Set<number>();
  const walk = (n: Node | null | undefined) => {
    if (!n || typeof n !== 'object') return;
    if (n.type === 'signatureField') {
      const slot = Number(n.attrs?.slot) || 1;
      if (!seen.has(slot)) {
        seen.add(slot);
        out.push({
          slot,
          party: n.attrs?.party === 'us' ? 'us' : 'them',
          label: (n.attrs?.label as string) || null,
        });
      }
    }
    if (Array.isArray(n.content)) n.content.forEach(walk);
  };
  walk(doc);
  return out.sort((a, b) => a.slot - b.slot);
}

/** 다음 칸 번호 — 편집기의 [서명란] 버튼이 쓴다. */
export function nextSlot(fields: DocSignatureField[]): number {
  return fields.reduce((max, f) => Math.max(max, f.slot), 0) + 1;
}
