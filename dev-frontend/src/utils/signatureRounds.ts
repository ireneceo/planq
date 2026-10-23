// 서명 회차 — 닫힌 회차(superseded) 묶음 규칙 한 벌 (2026-10-23)
// 진행 칸의 «이전 회차» 와 서명 받기 창의 «다시 보내기 프리필» 이 같은 함수를 쓴다(묶는 규칙이 두 벌이면 갈라진다).
import type { SignatureRequest } from '../services/posts';

/** 같은 superseded_at = 같은 회차(서버 close-round 가 한 번에 같은 시각으로 닫는다). 최근 회차가 앞 */
export function pastSignatureRounds(list: SignatureRequest[] | null | undefined): [string, SignatureRequest[]][] {
  const m = new Map<string, SignatureRequest[]>();
  for (const sr of list || []) {
    if (sr.status !== 'superseded') continue;
    const k = sr.superseded_at || '';
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(sr);
  }
  return [...m.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
}

/** 지금 회차 행(취소·닫힘 제외) */
export function currentSignatureRows(list: SignatureRequest[] | null | undefined): SignatureRequest[] {
  return (list || []).filter((s) => s.status !== 'canceled' && s.status !== 'superseded');
}

/** 고친 뒤 다시 보낼 때 받는 분을 그대로 채울 회차 — 지금 회차가 비어 있고 닫힌 회차가 있을 때만, 가장 최근 것 */
export function resendSourceRound(list: SignatureRequest[] | null | undefined): SignatureRequest[] | null {
  if (currentSignatureRows(list).length > 0) return null;
  const rounds = pastSignatureRounds(list);
  return rounds.length > 0 ? rounds[0][1] : null;
}
