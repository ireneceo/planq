// TipTap 기반 리치 에디터 — Notion 스타일
// - 저장 포맷: HTML
// - / 슬래시 커맨드 블록 추가
// - 선택 시 BubbleMenu (서식)
// - 이미지 업로드: uploadUrl 호출 → { preview_url } 으로 인라인 삽입
import { useEditor, EditorContent } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import { apiFetch } from '../../contexts/AuthContext';
import { SlashCommand } from './SlashCommand';
import SlashCommandList from './SlashCommandList';

type Props = {
  value: string;
  onChange: (html: string) => void;
  onBlur?: (html: string) => void;
  placeholder?: string;
  uploadUrl?: string;
  readOnly?: boolean;
  minHeight?: number;
};

export default function RichEditor({
  value,
  onChange,
  onBlur,
  placeholder,
  uploadUrl,
  readOnly = false,
  minHeight = 180,
}: Props) {
  const { t } = useTranslation('common');
  const effectivePlaceholder = placeholder ?? t('editor.placeholder');
  const currentValueRef = useRef(value);
  const uploadUrlRef = useRef(uploadUrl);
  useEffect(() => { uploadUrlRef.current = uploadUrl; }, [uploadUrl]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: false }),
      Link.configure({ openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noopener noreferrer' } }),
      Image.configure({ inline: false, allowBase64: false }),
      Placeholder.configure({
        placeholder: ({ node }) => node.type.name === 'paragraph' ? effectivePlaceholder : '',
        includeChildren: false,
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      SlashCommand.configure({ listComponent: SlashCommandList }),
    ],
    content: value,
    editable: !readOnly,
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      currentValueRef.current = html;
      onChange(html);
    },
    onBlur: ({ editor }) => {
      onBlur?.(editor.getHTML());
    },
    editorProps: {
      attributes: { class: 'pq-editor-body' },
      handlePaste: (_view, event) => {
        if (!uploadUrlRef.current) return false;
        const files = Array.from(event.clipboardData?.files || []);
        const images = files.filter(f => f.type.startsWith('image/'));
        if (images.length === 0) return false;
        event.preventDefault();
        images.forEach(f => uploadAndInsertImage(f));
        return true;
      },
      handleDrop: (_view, event) => {
        if (!uploadUrlRef.current) return false;
        const dt = (event as DragEvent).dataTransfer;
        if (!dt) return false;
        const files = Array.from(dt.files || []);
        const images = files.filter(f => f.type.startsWith('image/'));
        if (images.length === 0) return false;
        event.preventDefault();
        images.forEach(f => uploadAndInsertImage(f));
        return true;
      },
    },
  });

  useEffect(() => {
    if (!editor) return;
    if (value === currentValueRef.current) return;
    editor.commands.setContent(value || '', { emitUpdate: false });
    currentValueRef.current = value;
  }, [value, editor]);

  const uploadAndInsertImage = async (file: File) => {
    const url = uploadUrlRef.current;
    if (!editor || !url) return;
    try {
      const fd = new FormData();
      fd.append('file', file, file.name);
      const r = await apiFetch(url, { method: 'POST', body: fd });
      const j = await r.json();
      if (j.success && j.data?.preview_url) {
        editor.chain().focus().setImage({ src: j.data.preview_url, alt: file.name }).run();
      }
    } catch { /* silent */ }
  };

  const setLink = () => {
    if (!editor) return;
    const prev = editor.getAttributes('link').href;
    const url = window.prompt(t('editor.linkPrompt'), prev || '');
    if (url === null) return;
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  };

  if (!editor) return <EditorShell $mh={minHeight}><PlainFallback /></EditorShell>;

  return (
    <EditorShell $mh={minHeight}>
      {!readOnly && (
        <BubbleMenu editor={editor}>
          <Bubble>
            <BBtn type="button" $active={editor.isActive('bold')} onMouseDown={e => { e.preventDefault(); editor.chain().focus().toggleBold().run(); }}>B</BBtn>
            <BBtn type="button" $active={editor.isActive('italic')} style={{ fontStyle: 'italic' }} onMouseDown={e => { e.preventDefault(); editor.chain().focus().toggleItalic().run(); }}>I</BBtn>
            <BBtn type="button" $active={editor.isActive('strike')} style={{ textDecoration: 'line-through' }} onMouseDown={e => { e.preventDefault(); editor.chain().focus().toggleStrike().run(); }}>S</BBtn>
            <BBtn type="button" $active={editor.isActive('code')} onMouseDown={e => { e.preventDefault(); editor.chain().focus().toggleCode().run(); }}>{'</>'}</BBtn>
            <BSep />
            <BBtn type="button" $active={editor.isActive('link')} onMouseDown={e => { e.preventDefault(); setLink(); }}>🔗</BBtn>
          </Bubble>
        </BubbleMenu>
      )}
      <EditorContent editor={editor} />
      {!readOnly && (
        <Hint>{t('editor.hintPrefix')} <kbd>/</kbd> {t('editor.hintSuffix')}</Hint>
      )}
    </EditorShell>
  );
}

const PlainFallback = styled.div`min-height:80px;`;

const EditorShell = styled.div<{ $mh: number }>`
  border:1px solid #E2E8F0;border-radius:10px;background:#FFF;display:flex;flex-direction:column;
  & .pq-editor-body{
    outline:none;padding:14px 16px;min-height:${p => p.$mh}px;font-size:14px;line-height:1.65;color:#0F172A;
  }
  & .pq-editor-body > * + *{margin-top:8px;}
  & .pq-editor-body p{margin:0;}
  & .pq-editor-body p.is-editor-empty:first-child::before{content:attr(data-placeholder);color:#94A3B8;float:left;height:0;pointer-events:none;}
  & .pq-editor-body h1{font-size:24px;font-weight:700;margin:16px 0 4px;line-height:1.2;}
  & .pq-editor-body h2{font-size:19px;font-weight:700;margin:12px 0 4px;line-height:1.3;}
  & .pq-editor-body h3{font-size:16px;font-weight:700;margin:10px 0 4px;line-height:1.4;}
  & .pq-editor-body ul,& .pq-editor-body ol{padding-left:22px;}
  & .pq-editor-body ul[data-type="taskList"]{padding-left:4px;list-style:none;}
  & .pq-editor-body ul[data-type="taskList"] li{display:flex;align-items:flex-start;gap:6px;}
  & .pq-editor-body ul[data-type="taskList"] li > label{margin-top:3px;}
  & .pq-editor-body ul[data-type="taskList"] li > label input{accent-color:#14B8A6;}
  & .pq-editor-body ul[data-type="taskList"] li > div{flex:1;}
  & .pq-editor-body ul[data-type="taskList"] li[data-checked="true"] > div{color:#94A3B8;text-decoration:line-through;}
  & .pq-editor-body blockquote{border-left:3px solid #14B8A6;padding:4px 12px;color:#475569;background:#F0FDFA;border-radius:4px;}
  & .pq-editor-body code{background:#F1F5F9;padding:1px 4px;border-radius:3px;font-family:monospace;font-size:12px;}
  & .pq-editor-body pre{background:#0F172A;color:#E2E8F0;padding:12px 14px;border-radius:8px;overflow-x:auto;font-family:monospace;font-size:12px;line-height:1.5;}
  & .pq-editor-body pre code{background:transparent;color:inherit;padding:0;}
  & .pq-editor-body hr{border:none;border-top:1px solid #E2E8F0;margin:14px 0;}
  & .pq-editor-body img{max-width:100%;border-radius:8px;display:block;margin:4px 0;}
  & .pq-editor-body a{color:#0D9488;text-decoration:underline;text-decoration-color:#99F6E4;text-underline-offset:3px;}
  & .pq-editor-body ::selection{background:#CCFBF1;}
`;

const Hint = styled.div`padding:6px 16px 8px;font-size:11px;color:#94A3B8;border-top:1px solid #F1F5F9;
  kbd{display:inline-block;padding:1px 5px;background:#F1F5F9;border:1px solid #E2E8F0;border-radius:3px;font-size:10px;font-family:monospace;color:#475569;margin:0 2px;}
`;

const Bubble = styled.div`display:inline-flex;align-items:center;gap:2px;padding:3px;background:#0F172A;border-radius:8px;box-shadow:0 4px 12px rgba(15,23,42,0.25);`;
const BBtn = styled.button<{ $active?: boolean }>`
  border:none;background:${p => p.$active ? '#334155' : 'transparent'};
  color:${p => p.$active ? '#FFF' : '#CBD5E1'};
  padding:4px 8px;border-radius:5px;font-size:12px;font-weight:600;cursor:pointer;min-width:24px;
  &:hover{background:#334155;color:#FFF;}
`;
const BSep = styled.div`width:1px;height:16px;background:#334155;margin:0 2px;`;
