// 차트 블록 — 문서 안의 막대·선·영역·원 그래프 (2026-11-16, docs/DOC_CHART_BLOCK_DESIGN.md)
//
// Irene: *"문서에 html로 작성하는 기능도 넣을까? 그래프들 못 넣어서 답답해"* → HTML 대신 «데이터만 저장하는 차트 블록».
//
// 계약:
//   · 저장은 attrs.chart 하나(숫자·글자뿐, normalizeChart 를 지난 값). 실행 코드 없음.
//   · 그림은 `<img src="data:image/svg+xml;base64,…">` — 그림으로 연 SVG 는 스크립트·외부 주소를 실행·로드하지 않는다.
//     정화기(sanitizeHtml)의 허용 목록을 넓히지 않는다(img·data:image/·width:% 는 원래 허용).
//   · 그림 함수는 서버와 같은 파일(chartData → dev-backend/utils/chartSvg.js). 서버 pdfTemplates 도 같은 HTML 을 낸다.
//   · renderHTML 의 data-pq-chart 는 HTML → 노드로 되읽을 때만 쓴다(AI 고쳐쓰기 base_html 왕복·문서 간 복사).
//     보기 화면 정화기가 그 속성을 지워도 그림은 남는다.
import { Node, mergeAttributes } from '@tiptap/core';
import { css } from 'styled-components';
import { normalizeChart, chartDataUri, chartSummary, type ChartData } from './chartData';

export interface ChartBlockOptions {
  /** 편집기에서 [차트 고치기] 를 누르면 — 창을 여는 쪽(PostEditor)이 준다. 없으면 버튼을 그리지 않는다(읽기 전용) */
  onEdit?: (pos: number, chart: ChartData) => void;
  labels: { edit: string };
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    pqChart: {
      insertChart: (chart: unknown) => ReturnType;
      insertChartAt: (pos: number, chart: unknown) => ReturnType;
      updateChartAt: (pos: number, chart: unknown) => ReturnType;
    };
  }
}

const readAttr = (el: HTMLElement): ChartData | null => {
  try { return normalizeChart(JSON.parse(el.getAttribute('data-pq-chart') || 'null')); } catch { return null; }
};

export const ChartBlock = Node.create<ChartBlockOptions>({
  name: 'pqChart',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addOptions() { return { onEdit: undefined, labels: { edit: 'Edit chart' } }; },

  addAttributes() {
    return {
      chart: {
        default: null,
        parseHTML: (el: HTMLElement) => readAttr(el),
        renderHTML: () => ({}),   // 아래 renderHTML 이 직접 싣는다
      },
    };
  },

  parseHTML() { return [{ tag: 'div[data-pq-chart]' }]; },

  renderHTML({ node, HTMLAttributes }) {
    const c = normalizeChart(node.attrs.chart);
    return ['div', mergeAttributes(HTMLAttributes, { class: 'pq-chart', 'data-pq-chart': JSON.stringify(c) }),
      ['img', { src: chartDataUri(c), alt: chartSummary(c), style: 'width:100%' }]];
  },

  addCommands() {
    return {
      insertChart: (chart) => ({ commands }) => commands.insertContent({ type: this.name, attrs: { chart: normalizeChart(chart) } }),
      insertChartAt: (pos, chart) => ({ commands }) => commands.insertContentAt(pos, { type: this.name, attrs: { chart: normalizeChart(chart) } }),
      updateChartAt: (pos, chart) => ({ tr, dispatch }) => {
        const n = tr.doc.nodeAt(pos);
        if (!n || n.type.name !== this.name) return false;
        if (dispatch) tr.setNodeMarkup(pos, undefined, { ...n.attrs, chart: normalizeChart(chart) });
        return true;
      },
    };
  },

  addNodeView() {
    return ({ node, getPos }) => {
      let current = node;
      const dom = document.createElement('div');
      dom.className = 'pq-chart pq-chart-edit';
      dom.setAttribute('data-testid', 'doc-chart-block');
      const img = document.createElement('img');
      img.draggable = false;
      img.style.width = '100%';
      dom.appendChild(img);
      const paint = () => {
        const c = normalizeChart(current.attrs.chart);
        img.src = chartDataUri(c);
        img.alt = chartSummary(c);
      };
      paint();
      const onEdit = this.options.onEdit;
      if (onEdit) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pq-chart-edit-btn';
        btn.setAttribute('data-testid', 'doc-chart-edit');
        btn.textContent = this.options.labels.edit;
        btn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
        btn.addEventListener('click', (e) => {
          e.preventDefault(); e.stopPropagation();
          const pos = typeof getPos === 'function' ? getPos() : undefined;
          if (typeof pos === 'number') onEdit(pos, normalizeChart(current.attrs.chart));
        });
        dom.appendChild(btn);
        // 두 번 눌러도 고치기 — 손에 익은 동작
        dom.addEventListener('dblclick', () => {
          const pos = typeof getPos === 'function' ? getPos() : undefined;
          if (typeof pos === 'number') onEdit(pos, normalizeChart(current.attrs.chart));
        });
      }
      return {
        dom,
        update: (n) => {
          if (n.type.name !== 'pqChart') return false;
          current = n;
          paint();
          return true;
        },
        selectNode: () => dom.classList.add('ProseMirror-selectednode'),
        deselectNode: () => dom.classList.remove('ProseMirror-selectednode'),
        stopEvent: (e) => (e.target as HTMLElement | null)?.closest?.('.pq-chart-edit-btn') != null,
        ignoreMutation: () => true,
      };
    };
  },
});

/** 편집기에서만 — 선택 테두리·[차트 고치기] 버튼 */
//   보기 모양(테두리·폭)은 styles/pqTableCss 의 .pq-chart — 편집기·보기 화면이 같은 조각을 붙인다.
export const chartBlockCss = css`
  & .pq-chart-edit { position: relative; }
  /* 선택 테두리·끌기 손은 편집할 때만 — 읽기 전용 편집기도 첫 블록을 선택 상태로 잡아 테두리가 보였다(실측) */
  & .ProseMirror[contenteditable='true'] .pq-chart-edit { cursor: grab; }
  & .ProseMirror[contenteditable='true'] .pq-chart-edit.ProseMirror-selectednode { outline: 2px solid #0D9488; outline-offset: 2px; }
  & .pq-chart-edit-btn {
    position: absolute; top: 8px; right: 8px; line-height: 1.2;
    height: 32px; padding: 0 12px; border-radius: 6px; border: 1px solid #CBD5E1;
    background: #fff; color: #0F172A; font-size: 0.75rem; font-weight: 700; cursor: pointer;
    box-shadow: 0 2px 6px rgba(15,23,42,0.12); opacity: 0; transition: opacity 0.15s;
  }
  & .pq-chart-edit:hover .pq-chart-edit-btn,
  & .pq-chart-edit.ProseMirror-selectednode .pq-chart-edit-btn,
  & .pq-chart-edit-btn:focus-visible { opacity: 1; }
  @media (hover: none) { & .pq-chart-edit-btn { opacity: 1; } }
`;
