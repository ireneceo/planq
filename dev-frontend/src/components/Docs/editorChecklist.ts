// 문서·메모 편집기(PostEditor)의 **할 일 목록** — 줄 앞 동그라미를 누르면 체크되고 그 줄에 가운데 줄이 그어진다 (2026-10-05)
//   Irene: "문서작성할 때 할일목록 기능 넣어줘. 메모장도, 아이폰 메모장처럼 … 줄 앞에 체크할 수 있는 동그라미" ·
//          "체크하면 그 문장에 중간에 줄긋기도 해줘."
//   PostEditor 는 Q docs·Q Note 메모·메모 팝업이 함께 쓴다 → 여기 한 곳에 붙이면 셋 다 된다.
//   업무 설명 편집기(RichEditor)는 이미 할 일 목록이 있다(같은 확장 · 같은 저장 모양 taskList/taskItem).
//   ★ 보기 전용(readOnly)에서도 체크는 그대로 보인다. 눌러서 바꾸는 것은 편집 모드에서만 — 보기 화면이 몰래 문서를 고치지 않게.
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';

export const checklistExtensions = [TaskList, TaskItem.configure({ nested: true })];

/* 아이폰 메모처럼 동그라미 — 기본 체크박스 모양을 지우고 원을 그린다. 체크하면 원이 채워지고 글은 회색 + 가운데 줄. */
export const checklistEditorCss = `
  & ul[data-type="taskList"] { list-style: none; padding-left: 2px; margin: 8px 0; }
  & ul[data-type="taskList"] li { display: flex; align-items: flex-start; gap: 8px; margin: 2px 0; }
  & ul[data-type="taskList"] li > label { flex-shrink: 0; margin-top: 3px; user-select: none; }
  & ul[data-type="taskList"] li > label input[type="checkbox"] {
    appearance: none; -webkit-appearance: none; margin: 0; cursor: pointer;
    width: 18px; height: 18px; border-radius: 50%;
    border: 1.5px solid #94A3B8; background: #fff; display: grid; place-content: center;
    transition: background 0.12s, border-color 0.12s;
  }
  & ul[data-type="taskList"] li > label input[type="checkbox"]::after {
    content: ''; width: 5px; height: 9px; margin-top: -2px;
    border: solid #fff; border-width: 0 2px 2px 0; transform: rotate(45deg); opacity: 0;
  }
  & ul[data-type="taskList"] li > label input[type="checkbox"]:checked { background: #14B8A6; border-color: #14B8A6; }
  & ul[data-type="taskList"] li > label input[type="checkbox"]:checked::after { opacity: 1; }
  & ul[data-type="taskList"] li > label input[type="checkbox"]:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(20,184,166,0.3); }
  & ul[data-type="taskList"] li > div { flex: 1; min-width: 0; }
  & ul[data-type="taskList"] li > div > p { margin: 0; }
  & ul[data-type="taskList"] li[data-checked="true"] > div { color: #94A3B8; text-decoration: line-through; }
  @media (max-width: 640px) {
    & ul[data-type="taskList"] li > label input[type="checkbox"] { width: 22px; height: 22px; }
  }
`;
