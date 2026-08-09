// 평문 → RichEditor(TipTap)/메일 본문이 쓰는 HTML 문자열.
//
// 음성 전사문·공유 텍스트처럼 **평문**을 HTML 값을 기대하는 입력(RichEditor value, 메일 cBody)에
// 그대로 넣으면 두 가지가 깨진다:
//   1. 개행이 전부 사라진다 (HTML 은 \n 을 공백으로 본다)
//   2. 사용자가 말한 `<`, `&`, `"` 가 마크업으로 해석된다
// 그래서 이스케이프 후 문단 단위로 감싼다. 빈 줄은 문단 구분으로만 쓰고 버린다.
export function plainToHtml(text: string): string {
  const s = String(text ?? '').trim();
  if (!s) return '';
  return s
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join('');
}

export function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
