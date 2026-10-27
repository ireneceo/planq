// 프로젝트 연결(참조) — 문서·파일을 소속 말고 다른 프로젝트에도 건다 (2026-10-27, docs/PROJECT_REFS_DESIGN.md).
//   소속은 그대로(공개 범위 기준). 연결은 보여 주는 자리만 늘린다 — 볼 수 있는 사람은 원본 공개 범위 그대로다.
import { apiFetch } from '../contexts/AuthContext';
import type { PostRow } from './posts';

export type ProjectRefEntity = 'post' | 'file';

export interface ProjectRefChip { project_id: number; name: string; color: string | null; can_unlink: boolean }

export async function fetchEntityRefs(type: ProjectRefEntity, id: number): Promise<ProjectRefChip[]> {
  const r = await apiFetch(`/api/project-refs/${type}/${id}`);
  if (!r.ok) return [];
  const j = await r.json();
  return (j.data || []) as ProjectRefChip[];
}

// 실패는 던진다 — AutoSaveField 가 ! 를 띄운다(삼키면 화면만 바뀐 채 남는다). 서버 코드(message)를 그대로 싣는다.
export async function linkProjectRef(projectId: number, type: ProjectRefEntity, entityId: number): Promise<void> {
  const r = await apiFetch(`/api/projects/${projectId}/refs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entity_type: type, entity_id: entityId }),
  });
  if (!r.ok) {
    const j = await r.json().catch(() => null);
    throw new Error((j && j.message) || `link ${r.status}`);
  }
}

export async function unlinkProjectRef(projectId: number, type: ProjectRefEntity, entityId: number): Promise<void> {
  const r = await apiFetch(`/api/projects/${projectId}/refs/${type}/${entityId}`, { method: 'DELETE' });
  if (!r.ok) throw new Error(`unlink ${r.status}`);
}

// 프로젝트 문서 탭의 «연결됨» 행 — 문서 목록과 같은 모양 + linked: true
export async function fetchLinkedPosts(projectId: number): Promise<PostRow[]> {
  const r = await apiFetch(`/api/projects/${projectId}/refs?type=post`);
  if (!r.ok) return [];
  const j = await r.json();
  return (j.data || []) as PostRow[];
}
