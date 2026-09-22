// 서명란 — 문서 본문 안의 «여기에 서명이 들어간다» 자리 (2026-09-22).
//
// Irene: *"문서에 서명이 어떻게 나오는지 알 수 없어서 서명란을 입력하게 된다고 했는데"*
//   여태 서명은 signature_requests 에만 저장되고 문서·공유 링크·PDF 어디에도 나오지 않았다.
//   서명하는 사람도 자기 서명이 문서의 어디에 들어가는지 알 수 없었다.
//
// 계약 (설계 docs/SIGNATURE_FIELD_DESIGN.md):
//   · 속성은 셋뿐 — slot(칸 번호 1·2…) · label(보이는 이름) · party('us' 보내는 쪽 | 'them' 받는 쪽)
//   · **이름표 기본값은 «보내는 쪽»/«받는 쪽»** (갑·을 아님 — Irene 2026-09-22)
//   · 저장 형태는 `<div data-signature-field data-slot data-party>` — 서버(pdfTemplates.nodeToHtml)와
//     공유 페이지가 **같은 표시**를 그린다. 세 곳이 각자 그리면 반드시 갈라진다.
//   · 서명된 뒤의 이미지·이름·일시는 **문서에 저장하지 않는다.** 문서에는 자리만 있고,
//     값은 signature_requests 에서 와 그려진다(서명본은 고정본 + 서명의 합).
import { Node, mergeAttributes } from '@tiptap/core';

export interface SignatureFieldAttrs {
  slot: number;
  label: string | null;
  party: 'us' | 'them';
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    signatureField: {
      insertSignatureField: (attrs?: Partial<SignatureFieldAttrs>) => ReturnType;
    };
  }
}

export const SIGNATURE_FIELD_TAG = 'div[data-signature-field]';

export interface SignatureFieldOptions {
  /** 화면 문구는 밖에서 준다 — 확장 안에 글자를 박으면 i18n 을 벗어난다(PostEditor 가 t() 로 넘긴다) */
  labels: { us: string; them: string; empty: string };
}

export const SignatureField = Node.create<SignatureFieldOptions>({
  name: 'signatureField',

  addOptions() {
    return { labels: { us: 'Sender', them: 'Recipient', empty: 'Signature' } };
  },
  group: 'block',
  atom: true,         // 안을 편집하지 않는다 — 자리만 잡는 블록
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      slot: {
        default: 1,
        parseHTML: (el: HTMLElement) => Number(el.getAttribute('data-slot') || 1) || 1,
        renderHTML: (attrs: { slot?: number }) => ({ 'data-slot': String(attrs.slot ?? 1) }),
      },
      label: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-label'),
        renderHTML: (attrs: { label?: string | null }) => (attrs.label ? { 'data-label': attrs.label } : {}),
      },
      party: {
        default: 'them',
        parseHTML: (el: HTMLElement) => (el.getAttribute('data-party') === 'us' ? 'us' : 'them'),
        renderHTML: (attrs: { party?: string }) => ({ 'data-party': attrs.party === 'us' ? 'us' : 'them' }),
      },
    };
  },

  parseHTML() {
    return [{ tag: SIGNATURE_FIELD_TAG }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-signature-field': '' })];
  },

  addCommands() {
    return {
      insertSignatureField: (attrs = {}) => ({ commands }) => commands.insertContent({
        type: this.name,
        attrs: { slot: attrs.slot ?? 1, label: attrs.label ?? null, party: attrs.party ?? 'them' },
      }),
    };
  },

  // 편집 중 표시 — 빈 서명란(이름표 + 점선). 서명된 값은 읽기 화면에서 그린다.
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('div');
      dom.className = 'pq-sig-field';
      dom.setAttribute('data-signature-field', '');
      dom.setAttribute('data-slot', String(node.attrs.slot ?? 1));
      dom.setAttribute('data-party', node.attrs.party === 'us' ? 'us' : 'them');
      if (node.attrs.label) dom.setAttribute('data-label', String(node.attrs.label));
      const cap = document.createElement('div');
      cap.className = 'pq-sig-field-label';
      const L = this.options.labels;
      cap.textContent = String(node.attrs.label || (node.attrs.party === 'us' ? L.us : L.them));
      const line = document.createElement('div');
      line.className = 'pq-sig-field-line';
      line.textContent = this.options.labels.empty;
      dom.appendChild(cap);
      dom.appendChild(line);
      return { dom };
    };
  },
});

/**
 * 편집기에 끼울 확장 — 라벨은 화면 언어로 채운다.
 * PostEditor 안에서 `configure` 를 직접 부르지 않는다(라벨 키를 아는 곳이 둘이 되면 갈라진다).
 */
export function signatureFieldExtension(t: (k: string, o?: Record<string, unknown>) => unknown) {
  return SignatureField.configure({
    labels: {
      us: t('editor.sigFieldUs', { defaultValue: '보내는 쪽' }) as string,
      them: t('editor.sigFieldThem', { defaultValue: '받는 쪽' }) as string,
      empty: t('editor.sigFieldEmpty', { defaultValue: '서명란' }) as string,
    },
  });
}

export default SignatureField;
