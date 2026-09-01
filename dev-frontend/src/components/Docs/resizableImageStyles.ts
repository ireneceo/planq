// 본문 이미지 — 선택 표시 + 끌어서 크기 조절 손잡이 CSS. **단일 원천.**
//
// 운영 #378 (Irene): "그냥 드래그로 넣으면 사이즈 조정도 안되네... 통일해서 맞춰서
//   일반적인 기능으로 해야 해."
//   여태 이 규칙이 PostEditor.tsx 안에만 있어서, 같은 ResizableImage 확장을 써도
//   **Q docs 에서만** 손잡이가 보였다. Q info·Q Task·Q Mail(RichEditor)은 크기 조절이 없었다.
//   여기로 뽑아 두 에디터가 같은 것을 쓴다 — 베껴 두면 반드시 갈라진다.
//
// ★ 실측으로 확정된 세 가지(memory feedback_prosemirror_nodeview_traps) — 건드릴 때 같이 읽을 것:
//   ① 감싼 요소가 전체 폭을 먹으면 손잡이가 이미지가 아니라 **본문 오른쪽 끝**에 붙는다
//      (200px 이미지인데 손잡이 x=1409). 그래서 `width: fit-content`.
//   ② 폭은 **감싼 요소**에 주고 이미지는 `width:100%` 로 채운다 — 안 그러면 37% 가 74px 이 된다.
//   ③ 손잡이는 14px 로 보이되 잡히는 영역은 ::after 로 40px 확보(터치).

/** @param editable 편집 가능일 때만 손잡이·선택 아웃라인을 그린다(보기 모드는 조용히). */
export function resizableImageCss(editable: boolean): string {
  return `
    img.editor-image.ProseMirror-selectednode { outline: ${editable ? '2px solid #14B8A6' : 'none'}; outline-offset: 2px; }
    /* nodeView 가 img 를 div 로 감싼다 — 선택 표시는 감싼 쪽에 붙는다(옛 규칙도 그대로 둔다). */
    .pq-img-wrap { position: relative; display: block; width: fit-content; max-width: 100%; margin: 12px 0; }
    .pq-img-wrap > img.editor-image { margin: 0; }
    .pq-img-wrap.ProseMirror-selectednode > img.editor-image { outline: ${editable ? '2px solid #14B8A6' : 'none'}; outline-offset: 2px; }
    .pq-img-handle { display: none; }
    ${editable ? `
    .pq-img-wrap:hover .pq-img-handle,
    .pq-img-wrap.ProseMirror-selectednode .pq-img-handle {
      /* 정사각형은 aspect-ratio 로 — height 리터럴은 '컨트롤 높이' 래칫에 잡힌다(이건 장식이다). */
      display: block; position: absolute; width: 14px; aspect-ratio: 1;
      right: -7px; bottom: -7px; border-radius: 4px;
      background: #14B8A6; border: 2px solid #fff; box-shadow: 0 1px 3px rgba(0,0,0,.25);
      cursor: nwse-resize; z-index: 2;
    }
    .pq-img-wrap .pq-img-handle::after { content: ''; position: absolute; inset: -13px; }` : ''}
  `;
}
