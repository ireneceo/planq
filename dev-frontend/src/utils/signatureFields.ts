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
    // 서명자 = **서명 칸**(item 없음 또는 sign) 기준. 서명일·이름 칸은 그 번호의 서명자에 딸린다(2026-10-05)
    if (n.type === 'signatureField' && (n.attrs?.item === 'date' || n.attrs?.item === 'name') === false) {
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

// ─── 서명자별 항목 수 (2026-10-05) — 요청 창 1단계 목록 · 서버 signatureItemsBySlot 과 같은 공식 ───
export interface SignerItems { slot: number; party: 'us' | 'them'; label: string | null; sign: number; date: boolean; name: boolean }
export function readSignerItems(contentJson: unknown): SignerItems[] {
  let doc: Node | null = null;
  try { doc = typeof contentJson === 'string' ? JSON.parse(contentJson) : (contentJson as Node); } catch { return []; }
  const map = new Map<number, SignerItems>();
  const walk = (n: Node | null | undefined) => {
    if (!n || typeof n !== 'object') return;
    if (n.type === 'signatureField') {
      const slot = Number(n.attrs?.slot) || 1;
      const item = n.attrs?.item === 'date' || n.attrs?.item === 'name' ? n.attrs.item as 'date' | 'name' : 'sign';
      const cur = map.get(slot) || { slot, party: 'them' as const, label: null, sign: 0, date: false, name: false };
      if (item === 'sign') {
        if (cur.sign === 0) { cur.party = n.attrs?.party === 'us' ? 'us' : 'them'; cur.label = (n.attrs?.label as string) || null; }
        cur.sign += 1;
      } else cur[item] = true;
      map.set(slot, cur);
    }
    if (Array.isArray(n.content)) n.content.forEach(walk);
  };
  walk(doc);
  return [...map.values()].sort((a, b) => a.slot - b.slot);
}

// ─── 손으로 적은 자리 → 서명 항목 (2026-10-05, docs/SIGNATURE_ITEMS_DESIGN.md §9) ──────────────
// Irene: *"서명란이 문서에 마음대로 만든 곳에 있는게 의미 없잖아"* — 본문에 «서명: ____» 처럼 적어 둔 자리는
// 아무것도 들어가지 않는다(값은 서명 항목 블록에만 끼워진다 — services/signedDocument.js). 그 자리를 찾아
// **같은 위치**에 항목을 넣는다.
//   «서명: ____» → 서명 칸(새 서명자) · «회사 스탬프:»/«도장:»/«(인)» → 같은 서명자의 서명 칸(이미지)
//   «서명일: ____» → 같은 서명자의 서명일 칸. 이름표 = 바로 위 제목 + 대표자 이름.

export interface ManualSignatureSpot {
  index: number;                      // doc.content 안의 위치(최상위 블록)
  item: 'sign' | 'date';
  slot: number;                       // 서명자 번호(위에서부터 1·2·3…)
  label: string | null;               // 서명자 첫 서명 칸에만 — «가맹본부 · KIM MI JUNG»
  prefix: string;                     // 줄 앞 글자(«서명:» «회사 스탬프:») — 칸 앞에 그대로 남긴다
}

const textOf = (n: Node | null | undefined): string => {
  if (!n) return '';
  if (n.type === 'text') return String((n as { text?: string }).text || '');
  if (n.type === 'hardBreak') return '\n';
  return (n.content || []).map(textOf).join('');
};
const SIGN_LINE = /^\s*((?:서명|서 명|signature|sign)\s*[:：])\s*(?:_{2,}|\(\s*인\s*\)|\(\s*서명\s*\))?\s*$/i;
const STAMP_LINE = /^\s*((?:회사\s*스탬프|스탬프|도장|직인|날인|stamp|seal|company\s*stamp)\s*[:：])\s*(?:_{2,}|\(\s*인\s*\))?\s*$|^\s*\(\s*인\s*\)\s*$/i;
const DATE_LINE = /^\s*((?:서명일|서명\s*일자|일자|date)\s*[:：])\s*(?:[_\s년월일./-]*)$/i;
const SEAL_ONLY = /^\(\s*인\s*\)$/;   // «(인)» 만 있는 줄 — 칸 앞에 글자로 남기지 않는다
const REP_LINE = /(대표자|대표|성명|이름|name|representative)\s*[:：]\s*([^\n]+)/i;

function parseDoc(contentJson: unknown): Node | null {
  try { return typeof contentJson === 'string' ? JSON.parse(contentJson) : (contentJson as Node); } catch { return null; }
}

/** 최상위 문단 중 손으로 적은 서명·스탬프·서명일 자리. 서명 항목이 이미 있는 문서는 대상이 아니다(호출부가 거른다). */
export function findManualSignatureSpots(contentJson: unknown): ManualSignatureSpot[] {
  const doc = parseDoc(contentJson);
  const blocks = (doc && Array.isArray(doc.content)) ? doc.content : [];
  const out: ManualSignatureSpot[] = [];
  let slot = 0;
  blocks.forEach((b, i) => {
    if (b.type !== 'paragraph') return;
    const txt = textOf(b).trim();
    const sm = txt.match(SIGN_LINE);
    if (sm) {
      slot += 1;
      let heading: string | null = null;
      let rep: string | null = null;
      for (let k = i - 1; k >= 0 && k >= i - 6; k -= 1) {
        const p = blocks[k];
        if (!rep && p.type === 'paragraph') { const m = textOf(p).match(REP_LINE); if (m) rep = m[2].split('\n')[0].trim().slice(0, 60); }
        if (p.type === 'heading') { heading = textOf(p).trim().slice(0, 40); break; }
        if (p.type === 'paragraph' && (SIGN_LINE.test(textOf(p).trim()) || STAMP_LINE.test(textOf(p).trim()))) break;
      }
      if (!heading) { for (let k = i - 1; k >= 0; k -= 1) { if (blocks[k].type === 'heading') { heading = textOf(blocks[k]).trim().slice(0, 40); break; } } }
      out.push({ index: i, item: 'sign', slot, label: [heading, rep].filter(Boolean).join(' · ') || null, prefix: sm[1] });
      return;
    }
    if (!slot) return;   // 서명 줄보다 앞의 «일자:» 등은 서명 자리가 아니다
    const st = txt.match(STAMP_LINE);
    if (st) { out.push({ index: i, item: 'sign', slot, label: null, prefix: st[1] || txt }); return; }
    const dt = txt.match(DATE_LINE);
    if (dt) out.push({ index: i, item: 'date', slot, label: null, prefix: dt[1] });
  });
  return out;
}

/** 찾은 자리를 서명 항목으로 바꾼 새 문서. parties[slot] = 그 서명자의 쪽. 줄 앞 글자(«서명:»)는 남긴다. */
export function replaceManualSpots(contentJson: unknown, spots: ManualSignatureSpot[], parties: Record<number, 'us' | 'them'>): Node {
  const doc = parseDoc(contentJson) || { type: 'doc', content: [] };
  const blocks = Array.isArray(doc.content) ? doc.content : [];
  const at = new Map(spots.map((s) => [s.index, s]));
  const next: Node[] = [];
  blocks.forEach((b, i) => {
    const sp = at.get(i);
    if (!sp) { next.push(b); return; }
    const party = parties[sp.slot] || (sp.slot === 1 ? 'us' : 'them');
    if (sp.prefix && !SEAL_ONLY.test(sp.prefix)) next.push({ type: 'paragraph', content: [{ type: 'text', text: sp.prefix } as Node] });
    next.push({ type: 'signatureField', attrs: { slot: sp.slot, party, label: sp.label, item: sp.item } });
  });
  return { ...doc, type: 'doc', content: next };
}

/** 서명자 설정을 문서에 반영 — 이름표는 그 번호의 **첫 서명 칸**에, 쪽은 그 번호의 **모든 칸**에(한 사람의 칸은 같은 쪽). */
export function applySignerSettings(contentJson: unknown, slot: number, patch: { label?: string | null; party?: 'us' | 'them' }): Node {
  const doc = parseDoc(contentJson) || { type: 'doc', content: [] };
  let labeled = false;
  const walk = (n: Node): Node => {
    if (n.type === 'signatureField' && (Number(n.attrs?.slot) || 1) === slot) {
      const attrs = { ...(n.attrs || {}) };
      if (patch.party) attrs.party = patch.party;
      const isSign = !(attrs.item === 'date' || attrs.item === 'name');
      if (patch.label !== undefined && isSign && !labeled) { attrs.label = patch.label || null; labeled = true; }
      return { ...n, attrs };
    }
    return Array.isArray(n.content) ? { ...n, content: n.content.map(walk) } : n;
  };
  return walk(doc);
}
