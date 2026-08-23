// RowTags — 리스트 한 행의 태그 표시 + 편집. 메인 리스트(QTaskPage)와 팝아웃(TaskPopoutView) **공용**.
//
//   TagChips 는 보여주기만, TagQuickMenu 는 붙이고 떼기만 한다. 두 화면이 각자 이 둘을 조립하면
//   권한 판정·표시 규칙이 갈린다(TagChips 상단 주석의 "두 화면이 각자 칩을 그리면" 과 같은 이유).
//   여기서 한 벌로 묶어 두 곳이 같은 것을 쓴다.
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
}

const RowTags: React.FC<Props> = ({ taskId, bizId, shownTags, allTags, max, editable, dict, onSaved, onDictAdd }) => (
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
      />
    )}
  </>
);

export default RowTags;
