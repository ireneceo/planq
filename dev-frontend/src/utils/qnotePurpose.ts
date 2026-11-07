// Q note 시작 창 «목적» — 서버 q-note sessions.purpose 와 같은 값.
//   Irene 2026-11-07: «강의라고 했는데 저장할 때 다시 묻고 어느 고객 상담이냐고 묻는다 — 상담이라고 했을 때만 나와야».
//   [상담 저장](고객·접점 종류를 묻는 창) 은 목적이 «상담» 일 때만 연다. 목적이 없는 노트(옛 노트·녹음 파일 올리기·
//   목적을 안 고른 노트)는 지금처럼 보인다 — 있던 문을 갑자기 없애지 않는다. 다른 목적에서 필요해지면
//   설정(톱니)에서 목적을 «상담» 으로 바꾸면 버튼이 생긴다.
export const QNOTE_PURPOSES = ['meeting', 'consultation', 'lecture', 'interview', 'memo', 'other'] as const;

export function canSaveToSale(session: { purpose?: string | null } | null | undefined): boolean {
  const p = session?.purpose || '';
  return !p || p === 'consultation';
}
