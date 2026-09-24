// 끌어다 놓은 것에서 **폴더 구조까지** 꺼낸다. (2026-09-24 — Irene: *"폴더째로 업로드할 수 없어?"*)
//
// 왜 따로 필요한가: `e.dataTransfer.files` 는 **폴더를 못 준다.** 폴더를 끌어다 놓으면 그 안의
//   파일이 아니라 폴더 자체가 0바이트 항목으로 들어오거나 아예 비어 있다. 안을 보려면
//   `DataTransferItem.webkitGetAsEntry()` 로 트리를 걸어 들어가야 한다.
//   `<input webkitdirectory>` 로 고르는 경로는 반대로 `File.webkitRelativePath` 가 경로를 준다.
//   **두 입구가 다른 모양을 주므로** 여기서 같은 모양(`{ file, relPath }`)으로 맞춘다 —
//   호출부가 두 갈래를 각자 처리하면 반드시 갈라진다.

/** 한 파일과 **그것이 있던 폴더 경로**(`a/b/c.png` 의 `a/b`. 루트면 빈 문자열). */
export interface DroppedFile {
  file: File;
  /** 슬래시로 구분한 상대 폴더 경로. 파일 이름은 포함하지 않는다. */
  dir: string;
}

/** 안전장치 — 악의적/실수로 거대한 트리를 걸어 들어가다 탭이 멈추는 것을 막는다. */
const MAX_FILES = 2000;
const MAX_DEPTH = 12;

function readEntries(reader: any): Promise<any[]> {
  return new Promise((resolve) => {
    reader.readEntries((batch: any[]) => resolve(batch || []), () => resolve([]));
  });
}

function fileOf(entry: any): Promise<File | null> {
  return new Promise((resolve) => {
    try { entry.file((f: File) => resolve(f), () => resolve(null)); }
    catch { resolve(null); }
  });
}

async function walk(entry: any, dir: string, out: DroppedFile[], depth: number): Promise<void> {
  if (!entry || out.length >= MAX_FILES || depth > MAX_DEPTH) return;
  if (entry.isFile) {
    const f = await fileOf(entry);
    // 0바이트 시스템 파일(.DS_Store 등)까지 올릴 이유가 없다 — 사용자가 만든 것이 아니다.
    if (f && !/^(\.DS_Store|Thumbs\.db|desktop\.ini)$/i.test(f.name)) out.push({ file: f, dir });
    return;
  }
  if (!entry.isDirectory) return;
  const reader = entry.createReader();
  // ★ `readEntries` 는 **한 번에 다 주지 않는다**(크롬은 100개씩). 빈 배열이 올 때까지 반복해야
  //   한다 — 한 번만 부르면 101번째부터 조용히 사라진다.
  for (;;) {
    const batch = await readEntries(reader);
    if (!batch.length) break;
    for (const e of batch) {
      await walk(e, dir ? `${dir}/${entry.name}` : entry.name, out, depth + 1);
      if (out.length >= MAX_FILES) return;
    }
  }
}

/**
 * 드롭된 것에서 파일 목록 + 폴더 경로를 꺼낸다.
 *   폴더 지원이 없는 브라우저면 `dataTransfer.files` 로 떨어진다(경로 없이 평평하게).
 */
export async function collectDropped(dt: DataTransfer): Promise<DroppedFile[]> {
  const items = dt.items ? Array.from(dt.items) : [];
  const entries = items
    .map((it: any) => (typeof it.webkitGetAsEntry === 'function' ? it.webkitGetAsEntry() : null))
    .filter(Boolean);

  if (!entries.length) {
    // 폴더를 못 읽는 환경 — 종전대로 평평하게.
    return Array.from(dt.files || []).map((file) => ({ file, dir: '' }));
  }
  const out: DroppedFile[] = [];
  for (const e of entries) {
    await walk(e, '', out, 0);
    if (out.length >= MAX_FILES) break;
  }
  // ★ 항목이 **전부 파일**이면 위 walk 로도 같은 결과지만, entry 읽기가 실패하는 경우가 있다
  //   (사파리 일부). 그때 빈 목록을 돌려주면 «아무 일도 안 일어남» 이 되므로 files 로 되돌린다.
  if (!out.length && dt.files && dt.files.length) {
    return Array.from(dt.files).map((file) => ({ file, dir: '' }));
  }
  return out;
}

/** `<input webkitdirectory>` 가 준 FileList → 같은 모양으로. */
export function fromDirectoryInput(list: FileList | File[]): DroppedFile[] {
  return Array.from(list)
    .filter((f) => !/^(\.DS_Store|Thumbs\.db|desktop\.ini)$/i.test(f.name))
    .map((file) => {
      const rel = (file as any).webkitRelativePath || '';
      const parts = String(rel).split('/');
      parts.pop();                       // 파일 이름 제거
      return { file, dir: parts.join('/') };
    });
}

/**
 * 상한에 닿았는가 — **말없이 자르지 않기 위해서** 있다.
 * ★ 2026-09-24 (Fable 지적 ④) — 처음엔 `DROP_MAX_FILES` 만 export 해 두고 **읽는 곳이 0** 이었다.
 *   주석은 "화면이 말해야 한다" 고 약속했는데 코드는 약속만 하고 있었다
 *   (memory `feedback_produced_link_no_consumer`). 화면이 이 값을 읽어 사용자에게 알린다.
 */
export function wasTruncated(items: DroppedFile[]): boolean {
  return items.length >= MAX_FILES;
}

export const DROP_MAX_FILES = MAX_FILES;
