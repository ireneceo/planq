// TipTap SlashCommand extension — Notion 스타일 블록 추가 메뉴
// `/` 입력 시 popup 표시, 화살표/엔터로 선택
import { Extension, type Editor, type Range } from '@tiptap/core';
import Suggestion, { type SuggestionOptions, type SuggestionProps } from '@tiptap/suggestion';
import { ReactRenderer } from '@tiptap/react';

export type SlashItem = {
  title: string;
  description?: string;
  icon?: string;
  command: (props: { editor: Editor; range: Range }) => void;
};

export const SLASH_ITEMS: SlashItem[] = [
  {
    title: '제목 1',
    description: '큰 제목',
    icon: 'H1',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 1 }).run();
    },
  },
  {
    title: '제목 2',
    description: '중간 제목',
    icon: 'H2',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 2 }).run();
    },
  },
  {
    title: '제목 3',
    description: '작은 제목',
    icon: 'H3',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 3 }).run();
    },
  },
  {
    title: '글머리 기호',
    description: '• 항목 목록',
    icon: '•',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleBulletList().run();
    },
  },
  {
    title: '번호 목록',
    description: '1. 번호 목록',
    icon: '1.',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleOrderedList().run();
    },
  },
  {
    title: '체크리스트',
    description: '☐ 체크 가능한 할 일',
    icon: '☐',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleTaskList().run();
    },
  },
  {
    title: '인용',
    description: '인용 블록',
    icon: '❝',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleBlockquote().run();
    },
  },
  {
    title: '코드 블록',
    description: '코드 블록',
    icon: '{ }',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleCodeBlock().run();
    },
  },
  {
    title: '구분선',
    description: '수평 구분선',
    icon: '—',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setHorizontalRule().run();
    },
  },
];

// Popup list component — accepts any React component type (loose)
type SlashOptions = {
  items?: (query: string) => SlashItem[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  listComponent?: any;
};

export const SlashCommand = Extension.create<SlashOptions>({
  name: 'slashCommand',
  addOptions() {
    return {
      items: (query: string) => SLASH_ITEMS.filter(it =>
        it.title.toLowerCase().includes(query.toLowerCase())
      ),
      listComponent: undefined,
    };
  },
  addProseMirrorPlugins() {
    const { items, listComponent } = this.options;
    if (!listComponent) return [];
    const suggestionOptions = {
      editor: this.editor,
      char: '/',
      startOfLine: false,
      items: ({ query }: { query: string }) => items!(query).slice(0, 10),
      command: ({ editor, range, props }: { editor: Editor; range: Range; props: SlashItem }) => {
        props.command({ editor, range });
      },
      render: () => {
        let component: ReactRenderer | null = null;
        let popupEl: HTMLDivElement | null = null;

        const position = (rect: DOMRect | null) => {
          if (!popupEl || !rect) return;
          const pad = 6;
          popupEl.style.position = 'fixed';
          popupEl.style.top = `${rect.bottom + pad}px`;
          popupEl.style.left = `${rect.left}px`;
          popupEl.style.zIndex = '2000';
        };

        return {
          onStart: (props: SuggestionProps<SlashItem>) => {
            component = new ReactRenderer(listComponent, { props, editor: props.editor });
            popupEl = document.createElement('div');
            popupEl.appendChild(component.element!);
            document.body.appendChild(popupEl);
            position(props.clientRect?.() || null);
          },
          onUpdate: (props: SuggestionProps<SlashItem>) => {
            component?.updateProps(props);
            position(props.clientRect?.() || null);
          },
          onKeyDown: (props: { event: KeyboardEvent }) => {
            if (props.event.key === 'Escape') {
              popupEl?.remove();
              component?.destroy();
              return true;
            }
            const ref = component?.ref as { onKeyDown?: (p: { event: KeyboardEvent }) => boolean } | null;
            return ref?.onKeyDown?.(props) ?? false;
          },
          onExit: () => {
            popupEl?.remove();
            component?.destroy();
            popupEl = null;
            component = null;
          },
        };
      },
    } as unknown as SuggestionOptions<SlashItem>;
    return [Suggestion(suggestionOptions)];
  },
});
