// 좌측 폴더 트리의 **규격** — 행·아이콘 칸·이름·숫자 알약·겹쳐 뜨는 액션.
//
// ★ 2026-09-20 에 DocsTab.tsx 에서 빼냈다(treeIcons.tsx 와 같은 이유). 그 파일은 god-file
//   래칫에 동결돼 있는데 트리를 손볼 때마다 커진다. 주석을 지워 숫자를 맞추는 것은 문제를
//   미루는 것이라, 규격을 한 파일로 모은다 — Q file 트리와 프로젝트>파일 트리가 **같은 값**을
//   읽는다는 뜻이기도 하다(베끼면 갈라진다).
import styled from 'styled-components';
import type { FileSource } from '../../../services/files';

export const TreeRoot = styled.div`display:flex;flex-direction:column;gap:1px;`;
export const TreeDivider = styled.div`height:1px;background:#F1F5F9;margin:6px 0;`;
export const FolderRow = styled.div<{ $selected?: boolean; $dropOver?: boolean; $actions?: boolean }>`
  display:grid;
  /* 칸 **넷 고정**: [아이콘 18][이름 1fr][숫자][액션 22]. 2026-09-20 —
     여닫는 손잡이는 폴더 아이콘 자체다(화살표 칸을 없앴다: 있으면 전 행이 밀려 «최상단 기준» 이 깨진다).
     ★ 2026-09-20 (Irene: *"새폴더 만드는 버튼 우측 레이아웃 나가버리고, ... 아이콘은 뭐야?
       불필요하게 공간을 잡고 있으면 어떻게 해?"*) — 액션을 **칸으로 두지 않는다.**
       고정폭(22px)이면 글자 붙은 [+ 새 폴더]·36px ⋯ 가 넘쳐 레이아웃이 터지고,
       auto 면 그 행만 숫자가 밀려 열이 갈라진다. 어느 쪽도 답이 아니다.
       → 액션은 **행 오른쪽에 겹쳐** 띄우고(absolute) 평소엔 숨긴다. 그러면 자리를 안 먹고,
         숫자 열은 전 행에서 유지된다(탐색기·VS Code 가 쓰는 방식). */
  position:relative;
  grid-template-columns:18px minmax(0,1fr) auto;
  align-items:center;gap:8px;padding:6px 10px;border-radius:6px;cursor:pointer;min-height:30px;
  background:${p => p.$dropOver ? '#CCFBF1' : (p.$selected ? '#F0FDFA' : 'transparent')};
  color:${p => p.$selected ? '#0F766E' : '#0F172A'};
  /* 끌어온 파일이 여기 떨어진다는 것을 **떨어뜨리기 전에** 알려준다.
     안쪽 그림자로 그린다 — border 를 켜면 행 높이가 2px 튀어 목록이 흔들린다. */
  box-shadow:${p => p.$dropOver ? 'inset 0 0 0 2px #14B8A6' : 'none'};
  &:hover{background:${p => p.$dropOver ? '#CCFBF1' : (p.$selected ? '#F0FDFA' : '#F8FAFC')};}
  /* 행에 마우스를 올리거나 선택하면 겹쳐 둔 액션이 나온다. 선언 순서 때문에 styled 참조 대신
     data 속성으로 고른다(FolderActions 가 아래에 선언된다). */
  &:hover [data-folder-actions], &:focus-within [data-folder-actions]{opacity:1;pointer-events:auto;}
  ${p => (p.$selected ? '[data-folder-actions]{opacity:1;pointer-events:auto;}' : '')}
  /* 액션이 나오는 순간 **숫자는 물러난다.** 겹쳐 띄우는 방식이라 둘이 같은 자리를 쓴다 —
     2026-09-20 (Irene: "+ 버튼 뒤에 회색 라운드가 보여. 파일 수량이 겹치는 거지?") 실측:
     [+] 버튼이 27px 인데 세 자리 숫자 알약은 32px 이라 **왼쪽 5~9px 이 삐져나왔다.**
     그래서 파일이 129개인 프로젝트에서만 보였다(두 자리 이하는 버튼 뒤에 완전히 가려졌다).
     자리를 비우는 게 아니라 opacity 만 내린다 — 칸 폭이 그대로라 열이 흔들리지 않는다.
     액션이 **없는** 행(전체·내 파일·채팅·업무…)은 이 규칙을 받지 않는다. */
  ${p => (p.$actions
    ? '&:hover [data-folder-count], &:focus-within [data-folder-count]{opacity:0;}'
      + (p.$selected ? '[data-folder-count]{opacity:0;}' : '')
    : '')}
  &:focus-visible{outline:2px solid #14B8A6;outline-offset:-2px;}
`;
export const FolderIconWrap = styled.div<{ $selected?: boolean; $sys?: FileSource; $tint?: string }>`
  /* 아이콘 칸은 **고정폭**이다. 아이콘마다 크기가 달라도 이름 시작점이 흔들리지 않게. */
  width:18px;flex-shrink:0;display:flex;align-items:center;justify-content:center;
  /* $tint — 프로젝트 색을 **아이콘 선**에 칠한다(동그라미를 따로 두지 않는다). */
  color:${p => {
    if (p.$tint) return p.$tint;
    if (p.$sys === 'chat') return '#0EA5E9';
    if (p.$sys === 'task') return '#F59E0B';
    if (p.$sys === 'meeting') return '#14B8A6';
    return p.$selected ? '#0D9488' : '#64748B';
  }};
  ${p => (p.$tint ? 'cursor:pointer;border-radius:4px;&:hover{background:rgba(20,184,166,0.12);}' : '')}
`;
export const FolderName = styled.div`
  /* 규격: 목록 항목 — 폰에서 12px 는 읽기 어렵다(tokens LIST_ROW). */
  min-width:0;font-size:0.8125rem;font-weight:600;
  @media (max-width: 640px) { font-size: 0.875rem; }
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
`;
export const FolderCount = styled.span`
  font-size:0.625rem;color:#94A3B8;font-weight:600;
  min-width:22px;padding:1px 6px;background:#F1F5F9;border-radius:999px;
  text-align:center;justify-self:end;transition:opacity .1s;
`;
export const SectionRow = styled.div`
  display:flex;align-items:center;gap:6px;padding:4px 8px;min-height:26px;
`;
export const FolderSectionLabel = styled.div`
  flex:1;font-size:0.6875rem;font-weight:700;color:#94A3B8;
  text-transform:uppercase;letter-spacing:.3px;
`;
export const EmptyHint = styled.div`
  padding:6px 10px;font-size:0.6875rem;color:#94A3B8;line-height:1.5;
`;
/* 행 오른쪽에 **겹쳐** 뜬다 — 칸을 차지하지 않으므로 숫자 열이 흔들리지 않는다.
   평소엔 숨고 행에 마우스를 올리거나 선택했을 때 나온다. $visible 이면 항상 보인다. */
export const FolderActions = styled.div<{ $visible?: boolean }>`
  position:absolute;right:6px;top:50%;transform:translateY(-50%);
  display:flex;gap:4px;align-items:center;flex-shrink:0;
  border-radius:6px;padding-left:4px;
  /* 공용 ⋯ 트리거(36px)를 이 줄에서만 [+] 와 같은 32px 로 맞춘다. 메뉴 자체는 포털이라
     이 선택자에 걸리지 않는다 — 트리거만 잡힌다. */
  button[aria-haspopup]{min-width:32px;width:32px;height:32px;border-radius:8px;}
  @media (max-width: 640px){
    button[aria-haspopup]{min-width:40px;width:40px;height:40px;}
  }
  opacity:${p => (p.$visible ? 1 : 0)};
  pointer-events:${p => (p.$visible ? 'auto' : 'none')};
  transition:opacity .1s;
`;
/* 행 위에 겹쳐 뜨는 액션 버튼 — [+] 와 ⋯ 가 **같은 규격**이어야 한다.
   공용 OverflowMenu 트리거는 36px 이라 30px 짜리 트리 행에서 위아래로 부풀어
   "... 이 이상하게 뜬다" 로 보였다(Irene 2026-09-20). 겹쳐 띄우는 오버레이라
   여기서 크기를 줄여도 **행 높이는 그대로**다. */
export const RowPlusBtn = styled.button`
  width:32px;height:32px;flex-shrink:0;
  display:inline-flex;align-items:center;justify-content:center;
  border:1px solid #E2E8F0;border-radius:8px;background:#fff;
  color:#0F766E;cursor:pointer;padding:0;
  &:hover{background:#F0FDFA;border-color:#14B8A6;}
  &:focus-visible{outline:2px solid #14B8A6;outline-offset:2px;}
  /* ★ 커지는 조건은 **폭**이다. (hover:none) 을 쓰면 터치 노트북·헤드리스에서도 켜지는데
     그 행은 여전히 30px 이라 버튼만 부푼다 — 그리고 검사 하니스가 데스크탑 규격을 영영 못 잰다
     (2026-09-20 실측: 헤드리스는 hover:none 으로 뜨고 CDP 로도 안 뒤집힌다). */
  @media (max-width: 640px){ width:40px;height:40px; }
`;
/* 폴더 만들기 — 글자를 같이 보여준다. 아이콘만 두면 "폴더 관리가 안 되는" 것으로 읽힌다. */
export const FolderNewBtn = styled.button`
  display:inline-flex;align-items:center;gap:4px;flex-shrink:0;
  padding:3px 8px;border:1px solid #E2E8F0;border-radius:999px;background:#fff;
  font-size:0.6875rem;font-weight:700;color:#0F766E;cursor:pointer;
  &:hover{background:#F0FDFA;border-color:#99F6E4;}
  /* 터치 타겟 — 토큰(36/40/44) 안에서. */
  @media (hover: none), (max-width: 640px){ min-height:36px; padding:0 10px; }
`;
export const RenameInput = styled.input`
  flex:1;min-width:0;height:24px;padding:0 6px;
  background:#fff;border:1px solid #14B8A6;border-radius:4px;font-size:0.75rem;color:#0F172A;
  &:focus{outline:none;}
`;
