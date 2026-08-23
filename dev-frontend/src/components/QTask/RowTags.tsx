// RowTags — 리스트 한 행의 태그 표시 + 편집(칩 + 붙이기 메뉴)를 한 벌로 묶는다. 메인 리스트(QTaskPage)용.
//
//   TagChips 는 보여주기만, TagQuickMenu 는 붙이고 떼기만 한다.
//
//   ★ 팝아웃(TaskPopoutView)은 이 조합을 **쓸 수 없다** — 거기선 칩이 행 본문 버튼(RowMain) 안에 있어,
//     같은 자리에 버튼인 메뉴 트리거를 넣으면 button-in-button 이 되어 클릭이 행 열기로 접힌다
//     (실제로 그렇게 넣었다가 팝아웃에서만 태그 버튼이 안 눌렸다 — Irene 2026-08-23).
//     그래서 팝아웃은 칩만 RowMeta 안에 두고 트리거는 RowMain 형제(TagSlot)로 뺀다.
//
//   ★ editable=false 면 칩만 — 권한 없는 사용자에게 눌러도 403 나는 버튼을 내밀지 않는다.
import React from 'react';
import TagChips, { type TaskTagLite } from './TagChips';
import TagQuickMenu from './TagQuickMenu';

interface Props {
  taskId: number;
  bizId: number | null;
  /** 화면에 보여줄 태그(호출측이 이미 걸러 넘긴다 — 필터 중인 태그 제외 등) */
  shownTags: TaskTagLite[] | null | undefined;
  /** 편집 대상이 되는 **실제 전체** 태그. 화면 표시용으로 걸러낸 배열을 넘기면 저장 시 태그가 사라진다. */
  allTags: TaskTagLite[] | null | undefined;
  /** 칩 최대 개수 — 메인 3 / 팝아웃 1 */
  max: number;
  editable: boolean;
  dict: TaskTagLite[];
  onSaved: (tags: TaskTagLite[]) => void;
  onDictAdd: (tag: TaskTagLite) => void;
  /** 사전 관리 열기 — 헤더 버튼 대신 메뉴 안에서 연다 */
  onManage?: () => void;
}

const RowTags: React.FC<Props> = ({ taskId, bizId, shownTags, allTags, max, editable, dict, onSaved, onDictAdd, onManage }) => (
  <>
    <TagChips tags={shownTags} max={max} />
    {editable && (
      <TagQuickMenu
        taskId={taskId}
        bizId={bizId}
        dict={dict}
        value={allTags || []}
        onSaved={onSaved}
        onDictAdd={onDictAdd}
        onManage={onManage}
      />
    )}
  </>
);

export default RowTags;
