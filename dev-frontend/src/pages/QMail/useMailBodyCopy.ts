// 메일 본문만 복사 / 본문만 전체선택 — Q Mail 상세 공용.
//
// Irene 2026-09-08: *"우측 상단 전체보기, 전달 기능 있는 곳에 내용 복사 기능도 넣어줄래?
//   복사해서 어디 보내고 싶어도 내용 안에서 커멘드 에이 눌러서 복사하려고 하면 모든 곳이 다 걸리네.
//   원래 내용부분만 딱 잡혀야 하는 것도 맞는데."*
//
// 두 가지를 같이 고친다. 버튼만 넣으면 ⌘A 는 여전히 화면 전체를 잡고,
// ⌘A 만 고치면 "복사 버튼이 없다" 는 그대로다.
//
// ★ HTML 메일은 본문이 sandbox iframe 안이라 ⌘A 가 이미 그 안으로 한정된다.
//   여기서 다루는 것은 **평문 메일**(페이지에 그대로 그려지는 쪽)과 **복사 버튼**이다.
import React from 'react';

/** HTML 메일 본문 → 붙여넣기 좋은 평문. 태그를 지우되 줄 구조는 살린다. */
function htmlToText(html: string): string {
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

export type CopyState = 'idle' | 'done' | 'failed';

/**
 * 본문 복사. HTML 메일이면 서식과 평문을 **같이** 클립보드에 올린다 —
 * 문서에 붙이면 서식이, 메모장에 붙이면 글자가 나온다.
 */
export async function copyMailBody(body: { html?: string | null; text?: string | null }): Promise<boolean> {
  const plain = body.text && body.text.trim()
    ? body.text
    : (body.html ? htmlToText(body.html) : '');
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

/**
 * ⌘/Ctrl + A 를 **커서가 있는 메일 본문 안으로 한정**한다.
 *
 * ★ 컨테이너의 `onKeyDown` 만으로는 안 된다 — 그 키가 오려면 컨테이너에 **포커스**가 있어야 하는데,
 *   사용자는 본문 글자를 클릭했을 뿐 포커스는 다른 데 있는 경우가 대부분이다(실제로 그래서
 *   "모든 곳이 다 걸린다"). 그래서 document 에서 듣고 **선택 지점이 본문 안인지**로 판정한다.
 *   본문 밖이면 손대지 않는다 — 목록에서 ⌘A 는 종전대로 동작해야 한다.
 *
 * 입력 중(input/textarea/contentEditable)에는 절대 가로채지 않는다.
 */
export function useMailBodySelectionScope() {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.key === 'a' || e.key === 'A')) return;
      if (!(e.metaKey || e.ctrlKey)) return;
      const ae = document.activeElement as HTMLElement | null;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
      const sel = window.getSelection();
      const anchor = sel?.anchorNode || null;
      const from = (anchor && (anchor.nodeType === 1 ? anchor as HTMLElement : anchor.parentElement)) || ae;
      const body = from?.closest?.('[data-mail-body="1"]') as HTMLElement | null;
      if (!body) return;                    // 본문 밖 — 평소대로 둔다
      e.preventDefault();
      const range = document.createRange();
      range.selectNodeContents(body);
      sel!.removeAllRanges();
      sel!.addRange(range);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
}
