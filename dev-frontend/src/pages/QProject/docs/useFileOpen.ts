// 파일을 «연다» + 구글 바로가기 주소를 읽어 둔다 — DocsTab 에서 빼낸 훅.
//
// ★ 2026-09-20 — god-file 래칫이 막아 세워 분리했다(treeIcons·treeStyles·TreeRow·folderDrop 과 같은 이유).
//   여는 문이 **한 곳**이라는 점이 핵심이다: 헤더 [새 탭에서 열기] 와 미리보기 영역 클릭이
//   같은 함수를 부른다. 두 곳이 따로 열면 «버튼은 문서로 가는데 영역은 Drive 로 간다» 가 된다.
import { useCallback, useEffect, useRef, useState } from 'react';
import { isGoogleShortcut, fetchShortcutUrl, type ProjectFile } from '../../../services/files';
import { objectUrlFromApi } from '../../../utils/download';

export function useFileOpen(
  businessId: number,
  preview: ProjectFile | null,
  dl: { start: (url: string, name: string, id?: string) => void },
) {
  const [opening, setOpening] = useState(false);
  const openingRef = useRef(false);
  /**
   * 이 파일을 «연다» — 헤더 버튼과 **미리보기 영역 클릭**이 같은 문을 쓴다.
   *
   * ★ 2026-09-20 (Irene: *"미리보기 영역. 같은 곳 아무 곳이나 클릭해도 바로 열려야지. 이미지나
   *   뭐나. … 구글 문서, 구글프로그램들 각각 열려야지."*) — 여태는 이미지만 눌러서 크게 볼 수
   *   있었고 나머지는 눌러도 아무 일이 없었다. 두 곳이 따로 열면 반드시 갈라진다.
   */
  const openPreviewTarget = useCallback(async (f: ProjectFile, gdocUrl: string | null) => {
    if (openingRef.current) return;
    // 구글 바로가기 → **문서**로. 링크 파일의 Drive 주소를 열면 "No preview available" 이다.
    if (gdocUrl) { window.open(gdocUrl, '_blank', 'noopener,noreferrer'); return; }
    if (f.storage_provider === 'gdrive' && f.external_url) {
      window.open(f.external_url, '_blank', 'noopener,noreferrer'); return;
    }
    if (!f.download_url || f.download_url === '#') return;
    // 인증이 필요한 주소라 링크로 직접 걸면 401 이다 — blob 으로 받아 넘긴다.
    // noopener 를 주면 핸들이 null 이라 넣을 곳이 없어진다(memory feedback_window_open_noopener_null).
    const w = window.open('', '_blank');
    if (!w) { dl.start(f.download_url, f.file_name); return; }   // 팝업이 막히면 내려받기로
    openingRef.current = true; setOpening(true);
    try {
      const url = await objectUrlFromApi(`${f.download_url}${f.download_url.includes('?') ? '&' : '?'}inline=1`);
      w.location.href = url;
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      w.close();
      dl.start(f.download_url, f.file_name);
    } finally { openingRef.current = false; setOpening(false); }
  }, [dl]);

  /* 구글 바로가기(.gdoc 등)는 **문서가 아니라 링크**다. 미리보기를 열 때 한 번 읽어 두고
     [새 탭에서 열기] 와 미리보기 패널이 **같은 주소**를 쓴다(두 곳이 따로 읽으면 갈라진다). */
  const [shortcutUrl, setShortcutUrl] = useState<string | null>(null);
  useEffect(() => {
    setShortcutUrl(null);
    if (!preview || !businessId || !isGoogleShortcut(preview.file_name)) return;
    let alive = true;
    void fetchShortcutUrl(businessId, preview.id).then(u => { if (alive) setShortcutUrl(u); });
    return () => { alive = false; };
  }, [preview, businessId]);


  return { opening, shortcutUrl, openPreviewTarget };
}
