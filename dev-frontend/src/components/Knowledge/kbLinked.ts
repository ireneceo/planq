// 프로젝트 정보 탭의 «연결됨» Q info — 소속 목록 + 이 프로젝트에 «연결» 한 정보 (2026-11-10, docs/PROJECT_REFS_DESIGN.md)
//   Irene: «Q info 프로젝트 연결이 여러 개 되어야 해». 문서·파일 연결과 같은 계약 — 연결은 보여 주는 자리만 늘린다.
//   연결 행은 서버가 Q info 목록 술어로 거른 것만 온다. 검색어·태그는 소속 목록과 같은 기준으로 여기서 거른다(서버 목록은 q·tag 를 받는다).
import { fetchLinkedKb } from '../../services/projectRefs';
import type { KbDocumentRow } from '../../services/knowledge';

export async function withLinkedKb(
  list: KbDocumentRow[], projectId: number, f: { q?: string; tag?: string | null },
): Promise<KbDocumentRow[]> {
  const linked = await fetchLinkedKb(projectId).catch(() => [] as KbDocumentRow[]);
  const q = (f.q || '').normalize('NFC').trim().toLowerCase();
  const tag = (f.tag || '').toLowerCase();
  const have = new Set(list.map((d) => d.id));
  const extra = linked.filter((d) => !have.has(d.id)
    && (!q || (d.title || '').normalize('NFC').toLowerCase().includes(q))
    && (!tag || (Array.isArray(d.tags) && d.tags.some((x) => String(x).toLowerCase() === tag))));
  return [...list, ...extra];
}
