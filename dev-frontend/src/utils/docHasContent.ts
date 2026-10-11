// 문서 본문(TipTap JSON)에 **보이는 내용**이 있는가 (2026-10-11)
//   Irene: "표 설명을 원할 때만 나와야 하는 거 아니야? 문서 형식이 표인데 설명문 넣는 에디터 나오니까 좀 이상해"
//   옛 판정은 `JSON.stringify(content).length > 30` 이었다 — 빈 문서도 `{"type":"doc","content":[{"type":"paragraph"}]}`
//   (46자)라 늘 «내용 있음» 이 되어, 표 문서를 편집할 때마다 설명 편집기가 열리고 보기 화면엔 빈 칸이 생겼다.
//   글자(공백 제외)나 그림·표·서명란·구분선 같은 «글자 아닌 내용» 이 하나라도 있으면 참.
const EMPTY_CONTAINERS = new Set(['doc', 'paragraph', 'heading', 'hardBreak']);

export function docHasContent(json: unknown): boolean {
  const walk = (n: unknown): boolean => {
    if (!n || typeof n !== 'object') return false;
    const node = n as { type?: string; text?: string; content?: unknown[] };
    if (node.type === 'text') return !!(node.text && node.text.trim());
    if (node.type && !EMPTY_CONTAINERS.has(node.type)) return true;   // 그림·표·목록·서명란·구분선…
    return Array.isArray(node.content) && node.content.some(walk);
  };
  return walk(json);
}
