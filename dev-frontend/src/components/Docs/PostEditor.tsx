// Tiptap 기반 리치텍스트 에디터 — 문서 편집용
// 툴바: Bold/Italic/Strike · H1~H3 · List · Link · Code · Quote · Image
// 이미지: 툴바 버튼 / 드래그앤드롭 / 클립보드 붙여넣기 지원
import React, { useCallback, useEffect, useRef } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useEditor, EditorContent } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { createLowlight, common } from 'lowlight';
import { apiFetch } from '../../contexts/AuthContext';
import { LightboxWrapper } from '../Common/ImageLightbox';
import { codeBlockNodeView } from '../Common/CodeBlockNodeView';

// 사이클 N+16 — 노션 스타일 코드 블록. lowlight + common 언어팩 (30개+: js/ts/python/go/rust/sql/bash 등).
const lowlight = createLowlight(common);
const PqCodeBlock = CodeBlockLowlight.configure({ lowlight, defaultLanguage: 'plaintext' })
  .extend({ addNodeView: codeBlockNodeView });

// Image extension 확장 — width attribute (사이즈 조정용, 사이클 N+9)
const ResizableImage = Image.extend({
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
});

interface Props {
  value: unknown | null;         // Tiptap JSON
  onChange: (json: unknown) => void;
  placeholder?: string;
  editable?: boolean;
  businessId?: number;           // 사이클 N+9 — 이미지 업로드 시 File 테이블 등록용
  borderless?: boolean;          // 사이클 N+9 — 공유 미리보기 등에서 외곽 박스 제거 (이중 박스 회피)
  compact?: boolean;             // 사이클 N+17 — 메모 popup 같은 좁은 컨테이너 용. toolbar 한 줄 + 가로 스크롤 + min-height 축소.
}

async function uploadEditorImage(file: File, businessId?: number): Promise<string | null> {
  const fd = new FormData();
  fd.append('file', file);
  if (businessId) fd.append('business_id', String(businessId));
  const r = await apiFetch('/api/posts/editor-image', { method: 'POST', body: fd });
  const j = await r.json();
  if (!j.success) return null;
  return j.data.url as string;
}

const PostEditor: React.FC<Props> = ({ value, onChange, placeholder, editable = true, businessId, borderless = false, compact = false }) => {
  const { t } = useTranslation('qdocs');
  const fileRef = useRef<HTMLInputElement>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        // TipTap v3 StarterKit 가 Link 를 자체 포함 → 별도 Link 와 mark 중복.
        // SK 의 Link 비활성 (콘솔: "Duplicate extension names found: ['link']")
        link: false,
        // 사이클 N+16 — 노션 스타일 코드 블록을 CodeBlockLowlight 로 교체.
        codeBlock: false,
      }),
      PqCodeBlock,
      Placeholder.configure({ placeholder: placeholder || t('editor.placeholder', { defaultValue: '본문을 작성하세요…' }) }),
      Link.configure({ openOnClick: false, HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' } }),
      ResizableImage.configure({ inline: false, allowBase64: false, HTMLAttributes: { class: 'editor-image' } }),
      Table.configure({ resizable: true, HTMLAttributes: { class: 'editor-table' } }),
      TableRow,
      TableHeader,
      TableCell,
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
              uploadEditorImage(f, businessId).then(url => {
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
            const url = await uploadEditorImage(f, businessId);
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

  // N+49 hotfix — wrapper 빈 영역 클릭 시 editor 끝으로 focus. ProseMirror DOM 안 클릭은 자동.
  // 사용자 호소: "빈 노트/문서 에디터 어디 클릭해도 커서 진입 가능"
  const handleWrapperClick = (e: React.MouseEvent) => {
    if (!editable || !editor) return;
    if ((e.target as HTMLElement).closest('.ProseMirror')) return;
    editor.commands.focus('end');
  };

  return (
    <Wrap $borderless={borderless} $compact={compact} onClick={handleWrapperClick}>
      {editable && (
        <Toolbar $compact={compact}>
          <Group>
            <ToolBtn type="button" $active={isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} title={t('editor.bold', { defaultValue: '굵게' })}>B</ToolBtn>
            <ToolBtn type="button" $active={isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} title={t('editor.italic', { defaultValue: '기울임' })} style={{ fontStyle: 'italic' }}>I</ToolBtn>
            <ToolBtn type="button" $active={isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()} title={t('editor.strike', { defaultValue: '취소선' })} style={{ textDecoration: 'line-through' }}>S</ToolBtn>
            <ToolBtn type="button" $active={isActive('code')} onClick={() => editor.chain().focus().toggleCode().run()} title={t('editor.inlineCode', { defaultValue: '인라인 코드' })} style={{ fontFamily: 'monospace' }}>code</ToolBtn>
          </Group>
          <Sep />
          <Group>
            <ToolBtn type="button" $active={isActive('heading', { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} title={t('editor.heading1', { defaultValue: '제목 1' })}>H1</ToolBtn>
            <ToolBtn type="button" $active={isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title={t('editor.heading2', { defaultValue: '제목 2' })}>H2</ToolBtn>
            <ToolBtn type="button" $active={isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} title={t('editor.heading3', { defaultValue: '제목 3' })}>H3</ToolBtn>
          </Group>
          <Sep />
          <Group>
            <ToolBtn type="button" $active={isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()} title={t('editor.bulletList', { defaultValue: '글머리 기호' })}>•</ToolBtn>
            <ToolBtn type="button" $active={isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()} title={t('editor.orderedList', { defaultValue: '번호 매기기' })}>1.</ToolBtn>
            <ToolBtn type="button" $active={isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()} title={t('editor.blockquote', { defaultValue: '인용' })}>❝</ToolBtn>
            <ToolBtn type="button" $active={isActive('codeBlock')} onClick={() => editor.chain().focus().toggleCodeBlock().run()} title={t('editor.codeBlock', { defaultValue: '코드 블록 (syntax 색상 + 복사 버튼)' })} style={{ fontFamily: 'monospace' }}>{ '</>' }</ToolBtn>
          </Group>
          <Sep />
          <Group>
            <ToolBtn type="button" $active={isActive('link')} onClick={() => {
              const prev = editor.getAttributes('link').href;
              const url = window.prompt(t('editor.linkPrompt', { defaultValue: 'URL (비우면 링크 제거):' }), prev || '');
              if (url === null) return;
              if (url === '') editor.chain().focus().extendMarkRange('link').unsetLink().run();
              else editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
            }} title={t('editor.link', { defaultValue: '링크' })}>🔗</ToolBtn>
            <ToolBtn type="button" onClick={onPickImage} title={t('editor.insertImage', { defaultValue: '이미지 삽입 (또는 붙여넣기/드래그)' })} aria-label={t('editor.insertImageAria', { defaultValue: '이미지 삽입' })}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                <circle cx="8.5" cy="8.5" r="1.5"/>
                <polyline points="21 15 16 10 5 21"/>
              </svg>
            </ToolBtn>
            <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={onImageInput} />
            <ToolBtn
              type="button"
              onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
              title={t('editor.insertTable', { defaultValue: '표 삽입 (3x3, 헤더 포함)' })}
              aria-label={t('editor.insertTableAria', { defaultValue: '표 삽입' })}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2"/>
                <line x1="3" y1="9" x2="21" y2="9"/>
                <line x1="3" y1="15" x2="21" y2="15"/>
                <line x1="9" y1="3" x2="9" y2="21"/>
                <line x1="15" y1="3" x2="15" y2="21"/>
              </svg>
            </ToolBtn>
          </Group>
          {isActive('table') && (
            <>
              <Sep />
              <Group>
                <ToolBtn type="button" onClick={() => editor.chain().focus().addColumnBefore().run()} title={t('editor.addColumnBefore', { defaultValue: '왼쪽에 열 추가' })}>⫷ {t('editor.colShort', { defaultValue: '열' })}</ToolBtn>
                <ToolBtn type="button" onClick={() => editor.chain().focus().addColumnAfter().run()} title={t('editor.addColumnAfter', { defaultValue: '오른쪽에 열 추가' })}>{t('editor.colShort', { defaultValue: '열' })} ⫸</ToolBtn>
                <ToolBtn type="button" onClick={() => editor.chain().focus().deleteColumn().run()} title={t('editor.deleteColumn', { defaultValue: '열 삭제' })}>−{t('editor.colShort', { defaultValue: '열' })}</ToolBtn>
                <ToolBtn type="button" onClick={() => editor.chain().focus().addRowBefore().run()} title={t('editor.addRowBefore', { defaultValue: '위에 행 추가' })}>⫶ {t('editor.rowShort', { defaultValue: '행' })}</ToolBtn>
                <ToolBtn type="button" onClick={() => editor.chain().focus().addRowAfter().run()} title={t('editor.addRowAfter', { defaultValue: '아래에 행 추가' })}>{t('editor.rowShort', { defaultValue: '행' })} ⫶</ToolBtn>
                <ToolBtn type="button" onClick={() => editor.chain().focus().deleteRow().run()} title={t('editor.deleteRow', { defaultValue: '행 삭제' })}>−{t('editor.rowShort', { defaultValue: '행' })}</ToolBtn>
                <ToolBtn type="button" onClick={() => editor.chain().focus().deleteTable().run()} title={t('editor.deleteTable', { defaultValue: '표 삭제' })} style={{ color: '#DC2626' }}>{t('editor.tableShort', { defaultValue: '표' })}✕</ToolBtn>
              </Group>
            </>
          )}
          <Sep />
          <Group>
            <ToolBtn type="button" onClick={() => editor.chain().focus().undo().run()} title={t('editor.undo', { defaultValue: '실행 취소' })}>↶</ToolBtn>
            <ToolBtn type="button" onClick={() => editor.chain().focus().redo().run()} title={t('editor.redo', { defaultValue: '다시 실행' })}>↷</ToolBtn>
          </Group>
        </Toolbar>
      )}
      {editable && (
        <BubbleMenu editor={editor} shouldShow={({ editor: ed }) => ed.isActive('image')}>
          <ImgSizeBubble>
            <ImgSizeBtn type="button" $active={editor.getAttributes('image').width === '33%'}
              onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().updateAttributes('image', { width: '33%' }).run(); }}>S</ImgSizeBtn>
            <ImgSizeBtn type="button" $active={editor.getAttributes('image').width === '66%'}
              onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().updateAttributes('image', { width: '66%' }).run(); }}>M</ImgSizeBtn>
            <ImgSizeBtn type="button" $active={!editor.getAttributes('image').width}
              onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().updateAttributes('image', { width: null }).run(); }}>L</ImgSizeBtn>
          </ImgSizeBubble>
        </BubbleMenu>
      )}
      {/* 표 안에 커서가 있을 때 떠오르는 행/열 컨트롤 — 툴바 끝 버튼은 발견이 어려워 추가 (Notion 패턴) */}
      {editable && (
        <BubbleMenu editor={editor} shouldShow={({ editor: ed }) => ed.isActive('table')}>
          <TableBubble>
            <TableBubbleGroup>
              <TableBubbleBtn type="button" title={t('editor.table.addColLeft', '왼쪽에 열 추가') as string}
                onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().addColumnBefore().run(); }}>＋{t('editor.table.colLeft', '열←')}</TableBubbleBtn>
              <TableBubbleBtn type="button" title={t('editor.table.addColRight', '오른쪽에 열 추가') as string}
                onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().addColumnAfter().run(); }}>＋{t('editor.table.colRight', '열→')}</TableBubbleBtn>
              <TableBubbleBtn type="button" title={t('editor.table.addRowAbove', '위에 행 추가') as string}
                onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().addRowBefore().run(); }}>＋{t('editor.table.rowAbove', '행↑')}</TableBubbleBtn>
              <TableBubbleBtn type="button" title={t('editor.table.addRowBelow', '아래에 행 추가') as string}
                onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().addRowAfter().run(); }}>＋{t('editor.table.rowBelow', '행↓')}</TableBubbleBtn>
            </TableBubbleGroup>
            <TableBubbleSep />
            <TableBubbleGroup>
              <TableBubbleBtn type="button" title={t('editor.table.delCol', '열 삭제') as string}
                onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().deleteColumn().run(); }}>−{t('editor.table.col', '열')}</TableBubbleBtn>
              <TableBubbleBtn type="button" title={t('editor.table.delRow', '행 삭제') as string}
                onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().deleteRow().run(); }}>−{t('editor.table.row', '행')}</TableBubbleBtn>
              <TableBubbleBtn type="button" $danger title={t('editor.table.delTable', '표 삭제') as string}
                onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().deleteTable().run(); }}>✕{t('editor.table.table', '표')}</TableBubbleBtn>
            </TableBubbleGroup>
          </TableBubble>
        </BubbleMenu>
      )}
      <Body $editable={editable} $borderless={borderless} $compact={compact}>
        <LightboxWrapper>
          <EditorContent editor={editor} />
        </LightboxWrapper>
      </Body>
    </Wrap>
  );
};

export default PostEditor;

const Wrap = styled.div<{ $borderless?: boolean; $compact?: boolean }>`
  background: ${p => p.$borderless ? 'transparent' : '#fff'};
  border: ${p => p.$borderless ? 'none' : '1px solid #E2E8F0'};
  border-radius: ${p => p.$borderless ? '0' : '12px'};
  overflow: hidden;
  display: flex; flex-direction: column;
  /* 사이클 N+17 — compact 면 popup 안에서 부모 height 100% 채워 사용 (popup 자체가 가변) */
  ${p => p.$compact ? `flex: 1; min-height: 0;` : `
    flex-shrink: 0;
    min-height: ${p.$borderless ? '0' : '280px'};
  `}
`;
const Toolbar = styled.div<{ $compact?: boolean }>`
  display: flex; align-items: center; gap: 2px; padding: 6px 8px;
  background: #F8FAFC; border-bottom: 1px solid #E2E8F0;
  /* 사이클 N+17 — compact (메모 popup) 는 한 줄 강제 + 가로 스크롤. wrap 으로 3줄 차지 회피.
     자식 ToolBtn 강제 축소 + Sep 마진 축소 — 같은 컴포넌트 재사용하면서 compact 모드만 다른 size 적용. */
  ${p => p.$compact ? `
    flex-wrap: nowrap;
    overflow-x: auto;
    overflow-y: hidden;
    padding: 4px 6px;
    gap: 1px;
    scrollbar-width: thin;
    &::-webkit-scrollbar { height: 4px; }
    &::-webkit-scrollbar-thumb { background: #CBD5E1; border-radius: 2px; }
    /* 자식 toolbar 버튼 강제 축소 (모든 인스턴스 prop 안 바꿔도 cascade 로 적용) */
    & > div > button, & > button {
      min-width: 24px !important; height: 24px !important;
      padding: 0 4px !important; font-size: 11px !important;
      flex-shrink: 0;
    }
    & > div { gap: 1px !important; flex-shrink: 0; }
  ` : `flex-wrap: wrap;`}
`;
const Group = styled.div`display: inline-flex; gap: 2px;`;
const Sep = styled.div`width: 1px; height: 18px; background: #E2E8F0; margin: 0 4px;`;
const ToolBtn = styled.button<{ $active?: boolean; $compact?: boolean }>`
  all: unset; cursor: pointer;
  /* 사이클 N+17 — compact 에선 버튼 크기 최소. 더 많은 버튼이 한 줄에 들어감. */
  min-width: ${p => p.$compact ? '24px' : '28px'};
  height: ${p => p.$compact ? '24px' : '28px'};
  padding: ${p => p.$compact ? '0 5px' : '0 8px'};
  display: inline-flex; align-items: center; justify-content: center;
  font-size: ${p => p.$compact ? '11px' : '12px'};
  font-weight: 700; color: ${p => p.$active ? '#0F766E' : '#475569'};
  background: ${p => p.$active ? '#F0FDFA' : 'transparent'};
  border-radius: 6px;
  flex-shrink: 0;
  &:hover { background: ${p => p.$active ? '#CCFBF1' : '#EEF2F6'}; color: #0F172A; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 2px; }
`;
// 이미지 사이즈 BubbleMenu (편집 시 image 선택하면 노출)
const ImgSizeBubble = styled.div`
  display: inline-flex; align-items: center; gap: 2px; padding: 3px;
  background: #0F172A; border-radius: 8px;
  box-shadow: 0 4px 12px rgba(15,23,42,0.25);
`;
const ImgSizeBtn = styled.button<{ $active?: boolean }>`
  border: none;
  background: ${p => p.$active ? '#334155' : 'transparent'};
  color: ${p => p.$active ? '#FFF' : '#CBD5E1'};
  padding: 4px 10px; border-radius: 5px;
  font-size: 11px; font-weight: 700; cursor: pointer; min-width: 28px;
  &:hover { background: #334155; color: #FFF; }
`;
// 표 행/열 플로팅 컨트롤 (표 안 커서일 때 노출)
const TableBubble = styled.div`
  display: inline-flex; align-items: center; gap: 4px; padding: 4px;
  background: #0F172A; border-radius: 8px;
  box-shadow: 0 4px 12px rgba(15,23,42,0.25);
`;
const TableBubbleGroup = styled.div`display: inline-flex; align-items: center; gap: 2px;`;
const TableBubbleSep = styled.div`width: 1px; height: 18px; background: #334155; margin: 0 2px;`;
const TableBubbleBtn = styled.button<{ $danger?: boolean }>`
  border: none; background: transparent;
  color: ${p => p.$danger ? '#FCA5A5' : '#E2E8F0'};
  padding: 4px 8px; border-radius: 5px;
  font-size: 11px; font-weight: 700; cursor: pointer; white-space: nowrap;
  &:hover { background: ${p => p.$danger ? '#7F1D1D' : '#334155'}; color: #FFF; }
`;

const Body = styled.div<{ $editable?: boolean; $borderless?: boolean; $compact?: boolean }>`
  padding: ${p => p.$compact ? '8px 12px' : (p.$borderless ? '0' : '16px 20px')};
  min-height: ${p => p.$compact ? '0' : (p.$editable ? '240px' : '80px')};
  /* compact (메모 popup) — Wrap 이 overflow:hidden + flex:1 이라 Body 가 직접 스크롤 영역이어야 함.
     이게 없으면 본문이 길어질 때 Wrap 에 잘려 스크롤 불가 (메모장 스크롤 안 됨 회귀 fix). */
  ${p => p.$compact ? `flex: 1; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch;` : ''}

  /* ─── 표 (Body 직속 자손 — 편집/보기 모드 무관 적용) ─── */
  /* border-collapse: separate 로 border-radius 작동. 셀은 right/bottom 만, 마지막 행/열 제거. */
  /* 문서 표 기준 (Notion/GitHub) — 컨테이너보다 넓은 표는 '절대 잘리지 않고' 블록 안에서 가로 스크롤.
     .tableWrapper(Tiptap 자동 생성) 가 스크롤 영역. 표는 colgroup 자연폭(width:max-content)을 가지되
     작은 표는 min-width:100% 로 칼럼을 꽉 채움. 옛 width:100% 는 넓은 표를 강제로 끼워맞춰
     resizable colgroup 고정폭과 충돌 → 우측 잘림 회귀의 원인. */
  & .tableWrapper {
    margin: 16px 0;
    max-width: 100%;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    &::-webkit-scrollbar { height: 8px; }
    &::-webkit-scrollbar-thumb { background: #CBD5E1; border-radius: 4px; }
  }
  & .tableWrapper table { margin: 0; }
  & table {
    border-collapse: separate; border-spacing: 0;
    table-layout: fixed;
    width: max-content;
    min-width: 100%;
    max-width: none;
    font-size: 13px; margin: 16px 0;
    border: 1px solid #CBD5E1; border-radius: 10px;
    overflow: hidden;
    background: #fff;
  }
  & table td, & table th {
    border-right: 1px solid #E2E8F0;
    border-bottom: 1px solid #E2E8F0;
    padding: 10px 14px;
    vertical-align: top; min-width: 96px;
    position: relative; box-sizing: border-box;
  }
  & table td:last-child, & table th:last-child { border-right: none; }
  & table tr:last-child td, & table tr:last-child th { border-bottom: none; }
  & table th {
    background: #F8FAFC; color: #0F172A; font-weight: 700;
    text-align: left; letter-spacing: -0.1px;
    border-bottom: 1px solid #CBD5E1;
  }
  /* 첫 행 좌상단·우상단 라운드 (border-radius 가 table 에만 적용되면 셀이 가려서 안 보임) */
  & table tr:first-child th:first-child, & table tr:first-child td:first-child {
    border-top-left-radius: 10px;
  }
  & table tr:first-child th:last-child, & table tr:first-child td:last-child {
    border-top-right-radius: 10px;
  }
  & table tr:last-child td:first-child, & table tr:last-child th:first-child {
    border-bottom-left-radius: 10px;
  }
  & table tr:last-child td:last-child, & table tr:last-child th:last-child {
    border-bottom-right-radius: 10px;
  }
  & table tbody tr:hover td { background: #FAFBFC; }
  & table p { margin: 0 !important; }
  /* 셀 선택 / 리사이즈 핸들 (편집 모드에서만 의미 있음) */
  & table .selectedCell { background: #F0FDFA; }
  & table .selectedCell::after {
    content: ''; position: absolute; inset: 0;
    background: rgba(20,184,166,0.12); pointer-events: none;
    border: 2px solid #14B8A6;
  }
  & table .column-resize-handle {
    position: absolute; right: -2px; top: 0; bottom: 0; width: 4px;
    background: #14B8A6; cursor: col-resize; pointer-events: auto;
    opacity: 0; transition: opacity 0.15s;
  }
  & table:hover .column-resize-handle { opacity: 0.4; }
  & table .column-resize-handle:hover { opacity: 1; }

  .ProseMirror {
    outline: none; font-size: 14px; line-height: 1.55; color: #0F172A;
    > * + * { margin-top: 0.5em; }
    h1 { font-size: 22px; font-weight: 700; color: #0F172A; margin-top: 1.2em; line-height: 1.3; }
    h2 { font-size: 18px; font-weight: 700; color: #0F172A; margin-top: 1em; line-height: 1.35; }
    h3 { font-size: 15px; font-weight: 700; color: #334155; margin-top: 0.8em; line-height: 1.4; }
    p { color: #334155; margin: 0; }
    ul, ol { padding-left: 1.4em; margin: 0; }
    li { margin: 0; }
    li + li { margin-top: 0.2em; }
    li > p { margin: 0; }
    ul li::marker { color: #94A3B8; }
    ol li::marker { color: #94A3B8; font-weight: 600; }
    blockquote { border-left: 3px solid #14B8A6; padding: 4px 12px; background: #F0FDFA; color: #334155; border-radius: 0 6px 6px 0; }
    code { background: #F1F5F9; padding: 2px 6px; border-radius: 4px; font-size: 12px; font-family: 'SFMono-Regular', Menlo, Consolas, monospace; color: #BE185D; }
    /* CodeBlockLowlight node view 가 자체 스타일 가짐 — 옛 pre/code 스타일은 fallback. */
    pre { background: #1E293B; color: #E2E8F0; padding: 12px 14px; border-radius: 8px; font-size: 12px; overflow-x: auto; }
    pre code { background: transparent; color: inherit; padding: 0; font-family: 'SFMono-Regular', Menlo, Consolas, monospace; }

    /* 사이클 N+16 — highlight.js (atom-one-dark 톤) syntax 색상.
       lowlight 가 hljs-* 클래스 입혀줌 → 노션 수준 syntax highlighting. */
    .hljs-comment, .hljs-quote { color: #94A3B8; font-style: italic; }
    .hljs-keyword, .hljs-selector-tag, .hljs-literal, .hljs-section, .hljs-link { color: #C792EA; }
    .hljs-string, .hljs-attr, .hljs-template-tag, .hljs-template-variable, .hljs-addition, .hljs-meta-string { color: #C3E88D; }
    .hljs-number, .hljs-symbol, .hljs-bullet, .hljs-meta { color: #F78C6C; }
    .hljs-title, .hljs-title.function_, .hljs-name { color: #82AAFF; }
    .hljs-variable, .hljs-template-tag { color: #EEFFFF; }
    .hljs-type, .hljs-class .hljs-title, .hljs-built_in, .hljs-builtin-name { color: #FFCB6B; }
    .hljs-attribute, .hljs-selector-attr, .hljs-selector-pseudo, .hljs-property { color: #FFCB6B; }
    .hljs-regexp, .hljs-deletion { color: #FF5370; }
    .hljs-tag, .hljs-selector-class, .hljs-selector-id { color: #F07178; }
    .hljs-emphasis { font-style: italic; }
    .hljs-strong { font-weight: 700; }
    a { color: #0D9488; text-decoration: underline; }
    img.editor-image { max-width: 100%; height: auto; border-radius: 8px; margin: 12px 0; display: block; }
    /* 사이클 N+22: read-only 에서는 selectednode outline 노출 X — 외부 공유 페이지에서 이미지 클릭 시 teal outline 위/아래
       잔상이 "녹색선" 으로 보이던 회귀 차단. 편집 모드만 outline 표시. */
    ${p => p.$editable
      ? `img.editor-image.ProseMirror-selectednode { outline: 2px solid #14B8A6; outline-offset: 2px; }`
      : `img.editor-image.ProseMirror-selectednode { outline: none; }`}
    p.is-editor-empty:first-child::before {
      color: #94A3B8; content: attr(data-placeholder);
      float: left; height: 0; pointer-events: none;
    }
  }
`;
