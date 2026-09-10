// 행의 **그룹(워크스트림) 이동** 컨트롤 — 트리거 + 메뉴 한 벌.
//
// ★ 왜 별도 파일인가 (2026-09-10)
//   ① ProjectTaskList 가 god-file 선(800줄)을 넘었다. 이 조각은 그 자체로 완결이다.
//   ② 메뉴를 **body 로 포털**해야 하는 이유가 여기 한 곳에 적혀 있어야 한다 —
//      업무명 셀(TCell $flex2)이 `overflow:hidden` 이라 `top:100%` 로 셀 아래에 뜨는
//      절대배치 메뉴가 통째로 잘렸다. 셀 높이가 24~28px 이니 들어갈 자리가 없다.
//      Irene: "폴더모양과 아래로 된 화살표는 뭐야? 아무리 눌러도 반응이 없는데?"
//      — 메뉴는 열리고 있었다. 한 픽셀도 안 그려졌을 뿐이다.
//      셀을 `overflow:visible` 로 바꾸는 쪽은 제목 말줄임 계약(#236·#249)을 깨므로 쓰지 않는다.
//      같은 셀 안의 TaskRowActionMenu 는 같은 이유로 이미 createPortal 을 쓴다.
//   ③ 트리거는 RowMain(button) **밖 형제**여야 한다 — 안에 넣으면 button-in-button 이라
//      브라우저가 클릭 타깃을 행 열기로 접는다(2026-08-23 실사고).
import React from 'react';
import { createPortal } from 'react-dom';
import { GroupMoveWrap, GroupMoveBtn, GroupMenu, GroupMenuItem, GroupDot } from './ProjectTaskList.styles';

// ★ color 는 **선택이 아니다** — 호출부의 wsColor 가 `color: string | null` 을 요구한다.
//   `color?:` 로 두면 undefined 가 섞여 타입이 어긋난다(2026-09-10 분리 중 실제로 깨뜨렸다).
export interface GroupMoveWorkstream { id: number; title: string; order_index: number; color: string | null }

interface Props {
  taskId: number;
  currentWorkstreamId: number | null;
  workstreams: GroupMoveWorkstream[];
  /** 열려 있는 메뉴의 대상·좌표. 이 행의 것이 아니면 안 그린다. */
  openAt: { taskId: number; top: number; left: number } | null;
  onOpen: (at: { taskId: number; top: number; left: number } | null) => void;
  onAssign: (workstreamId: number | null) => void;
  colorOf: (w: GroupMoveWorkstream, index: number) => string;
  label: string;
  noneLabel: string;
}

const GroupMoveMenu: React.FC<Props> = ({
  taskId, currentWorkstreamId, workstreams, openAt, onOpen, onAssign, colorOf, label, noneLabel,
}) => {
  const mine = openAt?.taskId === taskId ? openAt : null;
  return (
    <GroupMoveWrap>
      <GroupMoveBtn
        data-dropdown
        aria-label={label}
        title={label}
        aria-expanded={!!mine}
        onClick={(e) => {
          e.stopPropagation();
          if (mine) { onOpen(null); return; }
          const r = e.currentTarget.getBoundingClientRect();
          // 포털하면 조상 좌표계를 못 쓴다 — 트리거의 viewport 좌표로 세운다.
          onOpen({ taskId, top: r.bottom + 4, left: r.left });
        }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="6 9 12 15 18 9" /></svg>
      </GroupMoveBtn>
      {mine && createPortal((
        <GroupMenu data-dropdown $floating style={{ top: mine.top, left: mine.left }} onClick={(e) => e.stopPropagation()}>
          {[...workstreams].sort((a, b) => a.order_index - b.order_index).map((w, i) => (
            <GroupMenuItem key={w.id} $active={currentWorkstreamId === w.id} onClick={() => onAssign(w.id)}>
              <GroupDot style={{ background: colorOf(w, i) }} />{w.title}
            </GroupMenuItem>
          ))}
          <GroupMenuItem $active={currentWorkstreamId === null} onClick={() => onAssign(null)}>
            <GroupDot style={{ background: '#CBD5E1' }} />{noneLabel}
          </GroupMenuItem>
        </GroupMenu>
      ), document.body)}
    </GroupMoveWrap>
  );
};

export default GroupMoveMenu;
