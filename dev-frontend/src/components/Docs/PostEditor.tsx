// Tiptap 기반 리치텍스트 에디터 — 문서 편집용
// 툴바: Bold/Italic/Strike · H1~H3 · List · Link · Code · Quote · Image
// 이미지: 툴바 버튼 / 드래그앤드롭 / 클립보드 붙여넣기 지원
import React, { useCallback, useEffect, useRef } from 'react';
import styled from 'styled-components';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import { apiFetch } from '../../contexts/AuthContext';

interface Props {
  value: unknown | null;         // Tiptap JSON
  onChange: (json: unknown) => void;
  placeholder?: string;
  editable?: boolean;
}

async function uploadEditorImage(file: File): Promise<string | null> {
  const fd = new FormData();
  fd.append('file', file);
  const r = await apiFetch('/api/posts/editor-image', { method: 'POST', body: fd });
  const j = await r.json();
  if (!j.success) return null;
  return j.data.url as string;
}

const PostEditor: React.FC<Props> = ({ value, onChange, placeholder, editable = true }) => {
  const fileRef = useRef<HTMLInputElement>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        // TipTap v3 StarterKit 가 Link 를 자체 포함 → 별도 Link 와 mark 중복.
        // SK 의 Link 비활성 (콘솔: "Duplicate extension names found: ['link']")
        link: false,
      }),
      Placeholder.configure({ placeholder: placeholder || '본문을 작성하세요…' }),
      Link.configure({ openOnClick: false, HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' } }),
      Image.configure({ inline: false, allowBase64: false, HTMLAttributes: { class: 'editor-image' } }),
    ],
    content: value as any,
    editable,
    onUpdate: ({ editor }) => onChange(editor.getJSON()),
    editorProps: {
      handlePaste: (_view, event) => {
        const items = event.clipboardData?.items;
        if (!items) return false;
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (item.type.startsWith('image/')) {
            const f = item.getAsFile();
            if (f) {
              event.preventDefault();
              uploadEditorImage(f).then(url => {
                if (url && editor) editor.chain().focus().setImage({ src: url }).run();
              });
              return true;
            }
          }
        }
        return false;
      },
      handleDrop: (_view, event) => {
        const files = event.dataTransfer?.files;
        if (!files || files.length === 0) return false;
        const imgs = Array.from(files).filter(f => f.type.startsWith('image/'));
        if (imgs.length === 0) return false;
        event.preventDefault();
        (async () => {
          for (const f of imgs) {
            const url = await uploadEditorImage(f);
            if (url && editor) editor.chain().focus().setImage({ src: url }).run();
          }
        })();
        return true;
      }
    }
  });

  const onPickImage = useCallback(() => fileRef.current?.click(), []);
  const onImageInput = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    for (const f of Array.from(files)) {
      const url = await uploadEditorImage(f);
      if (url && editor) editor.chain().focus().setImage({ src: url }).run();
    }
    e.target.value = '';
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    const current = editor.getJSON();
    if (JSON.stringify(current) !== JSON.stringify(value)) {
      editor.commands.setContent((value as any) || '', { emitUpdate: false });
    }
  }, [value, editor]);

  useEffect(() => {
    if (editor) editor.setEditable(editable);
  }, [editable, editor]);

  if (!editor) return null;

  const isActive = (name: string, attrs?: Record<string, unknown>) => editor.isActive(name, attrs);

  return (
    <Wrap>
      {editable && (
        <Toolbar>
          <Group>
            <ToolBtn type="button" $active={isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} title="굵게">B</ToolBtn>
            <ToolBtn type="button" $active={isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} title="기울임" style={{ fontStyle: 'italic' }}>I</ToolBtn>
            <ToolBtn type="button" $active={isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()} title="취소선" style={{ textDecoration: 'line-through' }}>S</ToolBtn>
            <ToolBtn type="button" $active={isActive('code')} onClick={() => editor.chain().focus().toggleCode().run()} title="인라인 코드" style={{ fontFamily: 'monospace' }}>{'</>'}</ToolBtn>
          </Group>
          <Sep />
          <Group>
            <ToolBtn type="button" $active={isActive('heading', { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} title="제목 1">H1</ToolBtn>
            <ToolBtn type="button" $active={isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title="제목 2">H2</ToolBtn>
            <ToolBtn type="button" $active={isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} title="제목 3">H3</ToolBtn>
          </Group>
          <Sep />
          <Group>
            <ToolBtn type="button" $active={isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()} title="글머리 기호">•</ToolBtn>
            <ToolBtn type="button" $active={isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="번호 매기기">1.</ToolBtn>
            <ToolBtn type="button" $active={isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()} title="인용">❝</ToolBtn>
            <ToolBtn type="button" $active={isActive('codeBlock')} onClick={() => editor.chain().focus().toggleCodeBlock().run()} title="코드 블록" style={{ fontFamily: 'monospace' }}>{ '{ }' }</ToolBtn>
          </Group>
          <Sep />
          <Group>
            <ToolBtn type="button" $active={isActive('link')} onClick={() => {
              const prev = editor.getAttributes('link').href;
              const url = window.prompt('URL (비우면 링크 제거):', prev || '');
              if (url === null) return;
              if (url === '') editor.chain().focus().extendMarkRange('link').unsetLink().run();
              else editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
            }} title="링크">🔗</ToolBtn>
            <ToolBtn type="button" onClick={onPickImage} title="이미지 삽입 (또는 붙여넣기/드래그)" aria-label="이미지 삽입">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                <circle cx="8.5" cy="8.5" r="1.5"/>
                <polyline points="21 15 16 10 5 21"/>
              </svg>
            </ToolBtn>
            <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={onImageInput} />
          </Group>
          <Sep />
          <Group>
            <ToolBtn type="button" onClick={() => editor.chain().focus().undo().run()} title="실행 취소">↶</ToolBtn>
            <ToolBtn type="button" onClick={() => editor.chain().focus().redo().run()} title="다시 실행">↷</ToolBtn>
          </Group>
        </Toolbar>
      )}
      <Body $editable={editable}>
        <EditorContent editor={editor} />
      </Body>
    </Wrap>
  );
};

export default PostEditor;

const Wrap = styled.div`
  background: #fff; border: 1px solid #E2E8F0; border-radius: 12px; overflow: hidden;
  display: flex; flex-direction: column;
  flex-shrink: 0;           /* 부모 flex column 에서 줄어들지 않도록 — height 0 으로 사라지는 문제 방지 */
  min-height: 280px;        /* 본문 영역 최소 280px (Toolbar 40 + Body 240) */
`;
const Toolbar = styled.div`
  display: flex; align-items: center; gap: 2px; padding: 6px 8px;
  background: #F8FAFC; border-bottom: 1px solid #E2E8F0; flex-wrap: wrap;
`;
const Group = styled.div`display: inline-flex; gap: 2px;`;
const Sep = styled.div`width: 1px; height: 18px; background: #E2E8F0; margin: 0 4px;`;
const ToolBtn = styled.button<{ $active?: boolean }>`
  all: unset; cursor: pointer; min-width: 28px; height: 28px; padding: 0 8px;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 700; color: ${p => p.$active ? '#0F766E' : '#475569'};
  background: ${p => p.$active ? '#F0FDFA' : 'transparent'};
  border-radius: 6px;
  &:hover { background: ${p => p.$active ? '#CCFBF1' : '#EEF2F6'}; color: #0F172A; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 2px; }
`;
const Body = styled.div<{ $editable?: boolean }>`
  padding: 16px 20px; min-height: ${p => p.$editable ? '240px' : '80px'};
  .ProseMirror {
    outline: none; font-size: 14px; line-height: 1.7; color: #0F172A;
    > * + * { margin-top: 0.75em; }
    h1 { font-size: 22px; font-weight: 700; color: #0F172A; margin-top: 1.4em; }
    h2 { font-size: 18px; font-weight: 700; color: #0F172A; margin-top: 1.2em; }
    h3 { font-size: 15px; font-weight: 700; color: #334155; margin-top: 1em; }
    p { color: #334155; }
    ul, ol { padding-left: 1.4em; }
    ul li::marker { color: #94A3B8; }
    ol li::marker { color: #94A3B8; font-weight: 600; }
    blockquote { border-left: 3px solid #14B8A6; padding: 4px 12px; background: #F0FDFA; color: #334155; border-radius: 0 6px 6px 0; }
    code { background: #F1F5F9; padding: 2px 6px; border-radius: 4px; font-size: 12px; font-family: 'SFMono-Regular', Menlo, Consolas, monospace; color: #BE185D; }
    pre { background: #0F172A; color: #E2E8F0; padding: 12px 14px; border-radius: 8px; font-size: 12px; overflow-x: auto; }
    pre code { background: transparent; color: inherit; padding: 0; }
    a { color: #0D9488; text-decoration: underline; }
    img.editor-image { max-width: 100%; height: auto; border-radius: 8px; margin: 12px 0; display: block; }
    img.editor-image.ProseMirror-selectednode { outline: 2px solid #14B8A6; outline-offset: 2px; }
    p.is-editor-empty:first-child::before {
      color: #94A3B8; content: attr(data-placeholder);
      float: left; height: 0; pointer-events: none;
    }
  }
`;
