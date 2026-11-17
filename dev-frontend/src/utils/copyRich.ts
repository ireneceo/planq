// 서식 + 평문을 같이 클립보드에 올린다 — 메일 본문 복사(Q mail)와 편집기 «복사» 버튼(RichEditor)이 같이 쓴다.
//
// 처음엔 pages/QMail/useMailBodyCopy 안에 있었다(2026-09-08). 2026-11-17 Irene
// *"업무 결과물 등에 복사되는 아이콘 나오면 좋겠어. 이런 입력란들 복사버튼들 다 따라다니면 안되나?"*
// 로 편집기 전부에 복사 버튼을 붙이면서 한 곳으로 뺐다 — 두 벌이면 한쪽만 고쳐진다.
//
// 문서에 붙이면 서식이, 메모장·채팅에 붙이면 글자가 나온다.

/** HTML → 붙여넣기 좋은 평문. 태그를 지우되 줄 구조는 살린다. */
export function htmlToPlainText(html: string): string {
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function copyRichContent(body: { html?: string | null; text?: string | null }): Promise<boolean> {
  const plain = body.text && body.text.trim()
    ? body.text
    : (body.html ? htmlToPlainText(body.html) : '');
  if (!plain && !body.html) return false;
  try {
    // ClipboardItem 은 https(또는 localhost) + 사용자 제스처 안에서만 된다. 안 되면 평문으로 물러선다.
    if (body.html && typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([body.html], { type: 'text/html' }),
          'text/plain': new Blob([plain], { type: 'text/plain' }),
        }),
      ]);
      return true;
    }
    await navigator.clipboard.writeText(plain);
    return true;
  } catch {
    // 권한이 없거나 오래된 브라우저 — execCommand 로 마지막 시도.
    try {
      const ta = document.createElement('textarea');
      ta.value = plain;
      ta.style.cssText = 'position:fixed;left:-9999px;top:0;';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch { return false; }
  }
}
