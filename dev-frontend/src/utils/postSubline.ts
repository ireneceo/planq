// 문서 둘째 줄 — «작성자 · 작성일 · 프로젝트» (2026-10-07, Irene 승인).
//   제목이 같은 문서를 고르는 창(첨부·관련 문서·표 첨부)과 통합 검색이 **같은 함수**를 쓴다.
//   화면마다 조합하면 한쪽만 프로젝트가 빠지거나 날짜 형식이 갈라진다.
import { displayName } from './displayName';

type NameLike = Parameters<typeof displayName>[0];
export interface PostSublineSource {
  author?: NameLike;
  created_at?: string | null;
  project?: { name?: string | null } | null;
}

export function postSubline(p: PostSublineSource, fmtDate: (iso: string) => string, lang?: string | null): string {
  return [
    p.author ? displayName(p.author, lang) : '',
    p.created_at ? fmtDate(p.created_at) : '',
    p.project?.name || '',
  ].filter(Boolean).join(' · ');
}
