// 상세 화면의 워크스페이스 일치 판정 — docs/WORKSPACE_SCOPE_DESIGN.md Q6 (2026-09-11)
//
// Irene: "테스트 워크스페이스에 여전히 워프로랩 탭이 열려. 빠른 녹음 9/11 03:15 PM … 리스트엔 아무것도 없는데."
//        "모든 페이지가 하나의 워크스페이스로만 연결되어야지."
//
// id 로 여는 상세(Q Note 세션·메모·문서·업무·프로젝트·대화)는 서버가 **그 항목의 워크스페이스** 권한만 본다
// (설계 C3 — 엔티티 라우트는 헤더를 무시한다). 그래서 탭·딥링크·알림으로 다른 워크스페이스 항목이 열리면
// 서버는 정상 200 을 주고 화면은 **지금 워크스페이스 안에 남의 내용**을 그린다. 막는 곳은 화면이다 — 이 한 함수로.
import { apiFetch } from '../contexts/AuthContext';

export function isOtherWorkspace(entityBusinessId: unknown, currentBusinessId: unknown): boolean {
  const e = Number(entityBusinessId);
  const c = Number(currentBusinessId);
  // 둘 중 하나라도 모르면 막지 않는다 — 플랫폼 관리자(무소속)·옛 데이터가 조용히 막히면 안 된다.
  return Number.isFinite(e) && Number.isFinite(c) && e > 0 && c > 0 && e !== c;
}

// 반대 방향 — URL 에 **현재 워크스페이스**를 넣어 부르는 상세(캘린더·메일·Q info·파일·청구서·고객)는
// 다른 워크스페이스 항목에 200 이 아니라 **404** 를 준다. 새지는 않지만 화면은 "찾을 수 없음" 이 되어
// 알림·검색·링크로 들어온 사용자에게 거짓말을 한다. 404 를 받은 화면은 이 함수 **하나**로 묻는다.
// 서버(routes/entity_workspace.js)는 내가 멤버인 워크스페이스일 때만 business_id 하나를 준다.
export type EntityKind = 'event' | 'email_thread' | 'kb_doc' | 'file' | 'invoice' | 'client';

/** 현재 워크스페이스에서 못 연 id 가 **내 다른 워크스페이스** 것이면 그 business_id, 아니면 null. */
export async function findOtherWorkspaceOf(kind: EntityKind, id: number, currentBusinessId: unknown): Promise<number | null> {
  if (!Number.isInteger(id) || id <= 0) return null;
  try {
    const r = await apiFetch(`/api/entity-workspace/${kind}/${id}`);
    if (!r.ok) return null;
    const j = await r.json().catch(() => null);
    const bid = Number(j?.data?.business_id);
    return isOtherWorkspace(bid, currentBusinessId) ? bid : null;
  } catch {
    return null;
  }
}
