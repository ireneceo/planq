// 첨부 «기존 파일 검색» 의 폴더째 넣기(#469 · 설계 docs/FOLDER_SHARE_DESIGN.md §1·§4-5).
//
// 폴더를 고르면 **그 순간 그 폴더(+하위 폴더)의 파일 id 로 풀어** 넣는다 — 첨부는 파일 연결이고,
// 폴더를 «살아 있게» 붙이는 것이 아니다. 풀 재료는 서버가 **보는 사람 기준으로 거른** 파일 목록(all-files)이라
// 내가 못 보는 파일은 애초에 없다. 서버 첨부 라우트가 파일마다 읽기 권한을 다시 본다(공유 규칙 5).
// 순서는 경로·이름 순으로 고정한다 — 상한(100)에 걸릴 때 «앞부분» 이 요청마다 달라지면 안 된다.
import type { FileFolder, ProjectFile } from '../../services/files';

export const FOLDER_ATTACH_MAX = 100;

export interface FolderAttachOption {
  id: number;
  /** 사람이 읽는 경로 — 프로젝트 폴더면 «프로젝트 / 폴더 / 하위» */
  path: string;
  /** 경로·이름 순 파일 id (상한 전 전체) */
  fileIds: number[];
}

const numId = (f: ProjectFile) => Number(String(f.id).replace('direct-', ''));

export function buildFolderAttachOptions(folders: FileFolder[], files: ProjectFile[]): FolderAttachOption[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const pathOf = new Map<number, string>();
  const resolvePath = (id: number, seen = new Set<number>()): string => {
    if (pathOf.has(id)) return pathOf.get(id)!;
    const f = byId.get(id);
    if (!f || seen.has(id)) return '';
    seen.add(id);
    const parent = f.parent_id != null ? resolvePath(f.parent_id, seen) : (f.project_name ? f.project_name : '');
    const p = parent ? `${parent} / ${f.name}` : f.name;
    pathOf.set(id, p);
    return p;
  };
  const kids = new Map<number, number[]>();
  for (const f of folders) if (f.parent_id != null) kids.set(f.parent_id, [...(kids.get(f.parent_id) || []), f.id]);
  const subtree = (id: number): number[] => {
    const out: number[] = [];
    const stack = [id];
    const seen = new Set<number>();
    while (stack.length) {
      const x = stack.pop()!;
      if (seen.has(x)) continue;
      seen.add(x);
      out.push(x);
      stack.push(...(kids.get(x) || []));
    }
    return out;
  };
  const filesByFolder = new Map<number, ProjectFile[]>();
  for (const f of files) {
    if (f.source !== 'direct' || f.folder_id == null) continue;
    filesByFolder.set(f.folder_id, [...(filesByFolder.get(f.folder_id) || []), f]);
  }
  return folders.map((folder) => {
    const rows: Array<{ path: string; name: string; id: number }> = [];
    for (const fid of subtree(folder.id)) {
      for (const f of filesByFolder.get(fid) || []) rows.push({ path: resolvePath(fid), name: f.file_name, id: numId(f) });
    }
    rows.sort((a, b) => a.path.localeCompare(b.path) || a.name.localeCompare(b.name) || a.id - b.id);
    return { id: folder.id, path: resolvePath(folder.id), fileIds: rows.map((r) => r.id).filter(Boolean) };
  }).sort((a, b) => a.path.localeCompare(b.path));
}
