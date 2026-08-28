// Q docs 본문 이미지 — width 속성 + **끌어서 크기 조절**.
//   PostEditor.tsx 가 800줄(god-file 래칫)을 넘겨 여기로 뽑았다. 동작은 그대로다.
import Image from '@tiptap/extension-image';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { NodeView } from '@tiptap/pm/view';

// Image extension 확장 — width attribute (사이즈 조정용, 사이클 N+9)
//
// 운영 #378 (Irene): "그냥 드래그로 넣으면 사이즈 조정도 안되네."
//   S/M/L 프리셋은 실제로 작동한다(운영 데이터 33% 14건·66% 12건, 브라우저 카나리로도 실증).
//   빠져 있던 것은 **끌어서 조절** — 사람들이 "사이즈 조정" 이라고 할 때 뜻하는 그것이다.
//   프리셋은 그대로 두고(기존 데이터·버블 메뉴 무변경) 모서리 손잡이를 얹는다.
//
//   ★ 폭은 반드시 **%** 로 저장한다. px 로 두면 좁은 화면·PDF·공유 페이지에서 넘친다.
//     기존 데이터가 전부 % 라 형식도 그대로 이어진다.
const MIN_W = 10;   // 너무 줄여 손잡이를 다시 못 잡는 상태 방지
const MAX_W = 100;

export const ResizableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('width') || el.style.width || null,
        renderHTML: (attrs: { width?: string | null }) => (attrs.width ? { width: attrs.width } : {}),
      },
    };
  },
  addNodeView() {
    return ({ node, editor, getPos }): NodeView => {
      const wrap = document.createElement('div');
      wrap.className = 'pq-img-wrap';
      const img = document.createElement('img');
      img.className = 'editor-image';
      // ★ 폭은 **감싼 요소**에 준다. img 에 직접 주면 퍼센트 기준이 감싼 요소가 되는데,
      //   그 요소는 다시 이미지 크기를 따라가므로 서로를 참조해 계속 쪼그라든다
      //   (실측: 37% 인데 실제 74px). 감싼 요소가 본문 폭의 37% 를 차지하고 이미지가 그걸 채운다.
      //   문서에 저장되는 attrs.width 는 그대로다 — 공유 페이지·PDF 등 에디터 밖 렌더는 무영향.
      const setWidth = (w: string) => {
        if (w) { wrap.style.width = w; img.style.width = '100%'; }
        else { wrap.style.width = ''; img.style.width = ''; }
        img.removeAttribute('width');
      };
      const paint = (n: ProseMirrorNode) => {
        img.src = String(n.attrs.src || '');
        if (n.attrs.alt) img.alt = String(n.attrs.alt); else img.removeAttribute('alt');
        if (n.attrs.title) img.title = String(n.attrs.title); else img.removeAttribute('title');
        setWidth(n.attrs.width ? String(n.attrs.width) : '');
      };
      paint(node);
      wrap.appendChild(img);

      // 읽기 전용에서는 손잡이를 만들지 않는다 — 공유·인쇄 화면에 편집 장치가 보이면 안 된다.
      let handle: HTMLElement | null = null;
      if (editor.isEditable) {
        handle = document.createElement('span');
        handle.className = 'pq-img-handle';
        handle.setAttribute('contenteditable', 'false');
        wrap.appendChild(handle);

        let startX = 0, startPx = 0, basePx = 0, dragging = false;
        const onMove = (e: MouseEvent) => {
          if (!dragging || !basePx) return;
          const next = Math.min(MAX_W, Math.max(MIN_W, ((startPx + (e.clientX - startX)) / basePx) * 100));
          // 끄는 동안엔 화면만 바꾼다 — 매 픽셀마다 문서를 고치면 실행취소 스택이 수천 칸이 된다.
          setWidth(`${Math.round(next)}%`);
        };
        const onUp = () => {
          if (!dragging) return;
          dragging = false;
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          document.body.style.userSelect = '';
          const w = wrap.style.width;
          const pos = typeof getPos === 'function' ? getPos() : null;
          // 놓는 순간 한 번만 기록한다 → 실행취소 한 번으로 되돌아간다.
          if (pos != null && w) {
            editor.chain().command(({ tr }) => {
              tr.setNodeAttribute(pos, 'width', w);
              return true;
            }).run();
          }
        };
        handle.addEventListener('mousedown', (e: MouseEvent) => {
          e.preventDefault();
          e.stopPropagation();
          // 기준 폭 = 편집 영역의 폭. % 는 이것에 대한 비율이다.
          // 기준은 **본문 폭** — 퍼센트가 그것에 대한 비율이기 때문. 감싼 요소로 재면 안 된다.
          basePx = (wrap.parentElement || wrap).getBoundingClientRect().width || img.getBoundingClientRect().width;
          startPx = img.getBoundingClientRect().width;
          startX = e.clientX;
          dragging = true;
          document.body.style.userSelect = 'none';
          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup', onUp);
        });
      }

      return {
        dom: wrap,
        // 프리셋(S/M/L) 로 바뀐 값도 여기로 들어온다 — 두 경로가 같은 화면을 그린다.
        update: (updated: ProseMirrorNode) => {
          if (updated.type.name !== node.type.name) return false;
          paint(updated);
          return true;
        },
        // ★ 이 nodeView 안의 DOM 변경은 **전부** 무시한다. image 는 내용 없는 atom 이라
        //   문서에서 파생될 DOM 이 없다 — 무시가 정석이다.
        //   손잡이만 무시했더니, 끄는 동안 img 의 width 를 바꾸는 것을 ProseMirror 가
        //   "문서와 어긋난 DOM" 으로 보고 **즉시 되돌려** 폭이 1px 도 안 움직였다
        //   (실측: mousedown 은 돌았고 userSelect='none' 인데 width 는 계속 null).
        ignoreMutation: () => true,
        destroy: () => { document.body.style.userSelect = ''; },
      };
    };
  },
});
