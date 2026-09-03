// Tiptap 기반 리치텍스트 에디터 — 문서 편집용
// 툴바: Bold/Italic/Strike · H1~H3 · List · Link · Code · Quote · Image
// 이미지: 툴바 버튼 / 드래그앤드롭 / 클립보드 붙여넣기 지원
import React, { useCallback, useEffect, useRef } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useEditor, EditorContent } from '@tiptap/react';
import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { BubbleMenu } from '@tiptap/react/menus';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Link from '@tiptap/extension-link';
import { ResizableImage } from './ResizableImage';
import { resizableImageCss } from './resizableImageStyles';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import TextAlign from '@tiptap/extension-text-align';
import { handleMarkdownPaste } from '../../utils/markdownPaste';
import { createLowlight, common } from 'lowlight';
import { apiFetch } from '../../contexts/AuthContext';
import { LightboxWrapper } from '../Common/ImageLightbox';
import { codeBlockNodeView } from '../Common/CodeBlockNodeView';

// 사이클 N+16 — 노션 스타일 코드 블록. lowlight + common 언어팩 (30개+: js/ts/python/go/rust/sql/bash 등).
const lowlight = createLowlight(common);

// #363 정렬 버튼 — 아이콘은 텍스트 줄을 형상화한 SVG (이모지 금지 규칙).
const alignIcon = (lines: Array<[number, number]>) => (
  <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden focusable="false">
    {lines.map(([x, w], i) => (
      <rect key={i} x={x} y={2 + i * 3.2} width={w} height="1.6" rx="0.8" fill="currentColor" />
    ))}
  </svg>
);
const ALIGNS = [
  { key: 'left', icon: alignIcon([[2, 12], [2, 8], [2, 12], [2, 6]]) },
  { key: 'center', icon: alignIcon([[2, 12], [4, 8], [2, 12], [5, 6]]) },
  { key: 'right', icon: alignIcon([[2, 12], [6, 8], [2, 12], [8, 6]]) },
] as const;
const PqCodeBlock = CodeBlockLowlight.configure({ lowlight, defaultLanguage: 'plaintext' })
  .extend({ addNodeView: codeBlockNodeView });

interface Props {
  value: unknown | null;         // Tiptap JSON
  onChange: (json: unknown) => void;
  placeholder?: string;
  editable?: boolean;
  businessId?: number;           // 사이클 N+9 — 이미지 업로드 시 File 테이블 등록용
  projectId?: number;            // 운영 #378 — 프로젝트 문서면 그 이미지도 프로젝트 파일이어야 한다
  borderless?: boolean;          // 사이클 N+9 — 공유 미리보기 등에서 외곽 박스 제거 (이중 박스 회피)
  compact?: boolean;             // 사이클 N+17 — 메모 popup 같은 좁은 컨테이너 용. toolbar 한 줄 + 가로 스크롤 + min-height 축소.
}

async function uploadEditorImage(file: File, businessId?: number, projectId?: number): Promise<string | null> {
  const fd = new FormData();
  fd.append('file', file);
  if (businessId) fd.append('business_id', String(businessId));
  // 운영 #378 — 이걸 안 보내면 File 행이 project_id NULL 로 저장돼 '프로젝트 > 파일' 에서 영영 안 보인다.
  if (projectId) fd.append('project_id', String(projectId));
  const r = await apiFetch('/api/posts/editor-image', { method: 'POST', body: fd });
  const j = await r.json();
  if (!j.success) return null;
  return j.data.url as string;
}


// 운영 #311 — "빈 문서에 표를 만들 때 좌우 길이를 모든 표를 고정할 수도 있어야 하는데
//   내용에 따라 가로 길이가 다 다르니까 정돈되지 않아 보일 때가 많아서
//   지금처럼 자유롭게도 되고 고정으로 어떤 위치를 맞출 수도 있어야지."
//
//   TipTap 의 resizable 표는 셀마다 colwidth 를 들고 다닌다. 사용자가 손으로 끌면 그 값이 제각각
//   남아 문서마다·표마다 열 폭이 어긋난다. "고정" = 그 표의 모든 열을 **같은 폭**으로 맞추는 것.
//   자유 조절은 그대로 둔다(끌면 다시 달라진다) — 둘 다 되어야 한다는 것이 요청이다.
//
//   ★ colwidth 는 **행마다** 들어 있다. 첫 행만 고치면 다른 행이 옛 폭을 들고 있어 브라우저가
//     colgroup 을 첫 행 기준으로 잡아도 저장 JSON 이 어긋난 채 남는다 → 전 행을 같이 고친다.
//   ★ colspan 이 걸린 셀은 그 칸 수만큼 곱해 준다. 안 그러면 병합된 표가 찌그러진다.
const EVEN_COL_WIDTH = 160;   // px — 표 하나 안에서 같기만 하면 되는 기준 폭

function distributeTableColumnsEvenly(editor: Editor): boolean {
  const { state } = editor;
  const { $from } = state.selection;
  // 커서에서 위로 올라가며 table 노드를 찾는다
  let tablePos = -1;
  let tableNode: ProseMirrorNode | null = null;
  for (let d = $from.depth; d > 0; d -= 1) {
    const n = $from.node(d);
    if (n.type.name === 'table') { tableNode = n; tablePos = $from.before(d); break; }
  }
  if (!tableNode || tablePos < 0) return false;

  const tr = state.tr;
  let changed = false;
  tableNode.forEach((row, rowOffset) => {
    row.forEach((cell, cellOffset) => {
      const span = Number(cell.attrs.colspan) || 1;
      const next = Array.from({ length: span }, () => EVEN_COL_WIDTH);
      const cur = cell.attrs.colwidth as number[] | null;
      if (cur && cur.length === span && cur.every((w, i) => w === next[i])) return;
      // +1: table -> row 진입, +1: row -> cell 진입
      const cellPos = tablePos + 1 + rowOffset + 1 + cellOffset;
      tr.setNodeMarkup(cellPos, undefined, { ...cell.attrs, colwidth: next });
      changed = true;
    });
  });
  if (!changed) return false;
  editor.view.dispatch(tr);
  return true;
}

const PostEditor: React.FC<Props> = ({ value, onChange, placeholder, editable = true, businessId, projectId, borderless = false, compact = false }) => {
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
      // #363 — 정렬(좌/가운데/우). 문단과 제목에만 적용한다.
      //   목록·인용·코드블록은 정렬을 걸면 구조가 깨져 보이므로 대상에서 뺀다.
      //   렌더는 style="text-align:..." — 저장 JSON 에 textAlign attr 로 들어간다.
      TextAlign.configure({ types: ['heading', 'paragraph'], defaultAlignment: null }),
      Table.configure({ resizable: true, HTMLAttributes: { class: 'editor-table' } }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: value as any,
    editable,
    onUpdate: ({ editor }) => onChange(editor.getJSON()),
    editorProps: {
      handlePaste: (view, event) => {
        // ★ #337 — 엑셀·구글시트·웹 표를 복사하면 클립보드에 **표(text/html)와 그림(image/png)이 같이** 담긴다.
        //   아래 이미지 분기가 무조건 먼저 돌아서, 표를 붙여넣으면 그림으로 박혀 편집이 불가능해졌다
        //   (운영 신고: "엑셀을 복사해서 붙이면 왜 이미지로 들어가? 표로 들어가야 하는 거 아니야?").
        //   표가 들어있으면 이미지 분기를 건너뛴다 → markdownPaste 가 false 를 돌려주고
        //   ProseMirror 기본 HTML 파서가 <table> 을 진짜 표 노드로 만든다(Table 확장 등록되어 있음).
        //   웹페이지의 이미지 복사(html 에 <img> 만 있는 경우)는 영향 없다 — <table> 이 있을 때만 양보한다.
        // ★ #304 — 코드 블록 안에서는 **어떤 변환도 하지 않는다.**
        //   여태 markdownPaste 가 먼저 돌아서, 붙여넣은 소스의 들여쓰기(4칸)를 마크다운의
        //   "들여쓰기 코드블록" 으로 읽고 조각조각 잘랐다 → 코드박스가 여러 개로 쪼개짐
        //   (운영 신고: "붙이기 한 건 하나의 코드박스에 다 들어가야 하는데 코드박스가 다 나눠져").
        //   false 를 돌려주면 ProseMirror 기본 동작이 줄바꿈을 유지한 채 그대로 넣는다.
        try {
          const { $from } = view.state.selection;
          if ($from.parent.type.name === 'codeBlock') return false;
        } catch { /* 선택 영역을 못 읽으면 아래 기본 경로로 */ }

        const pastedHtml = event.clipboardData?.getData('text/html') || '';
        const hasTable = /<table[\s>]/i.test(pastedHtml);

        // 1) 이미지 붙여넣기 — 옛 동작 그대로 (단, 표가 같이 온 경우는 제외)
        const items = hasTable ? null : event.clipboardData?.items;
        if (items) {
          for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.type.startsWith('image/')) {
              const f = item.getAsFile();
              if (f) {
                event.preventDefault();
                uploadEditorImage(f, businessId, projectId).then(url => {
                  if (url && editor) editor.chain().focus().setImage({ src: url }).run();
                });
                return true;
              }
            }
          }
        }
        // 2) 운영 #342 — "다른 웹이나 편집툴, 노션 같은 곳에서 복사를 하면 이미지는 미리보기 형태로
        //    제대로 안붙어."
        //
        //    원인: 노션·워드·웹페이지는 클립보드 HTML 안에 이미지를 `data:image/...;base64,...` 로
        //    싣는다. 그런데 Image 확장이 `allowBase64: false` 라 그 <img> 를 **통째로 버린다**
        //    → 글은 붙는데 그림만 사라진다.
        //
        //    ★ allowBase64 를 켜는 것은 오답이다. 수 MB 짜리 base64 가 content_json 에 그대로 박혀
        //      문서가 무거워지고, 메일 전달 때 본문이 사라지던 사고(자리표시자 치환)와 같은 계열의
        //      문제를 다시 만든다. **붙여넣는 순간 우리 스토리지로 올려 URL 로 바꾼다.**
        //    ★ 서버가 원격 URL 을 대신 가져오는 방식(외부 이미지 재호스팅)은 여기 넣지 않는다 —
        //      임의 URL fetch 는 SSRF 표면이라 별도 설계가 필요하다. https 원격 이미지는 CSP 가
        //      이미 허용하므로 지금도 그대로 보인다(원본이 사라지면 같이 사라진다는 한계는 남는다).
        const dataImgRe = /<img\b[^>]*?\bsrc\s*=\s*["'](data:image\/[a-zA-Z0-9.+-]+;base64,[^"']+)["'][^>]*>/gi;
        const dataUrls = [...new Set([...pastedHtml.matchAll(dataImgRe)].map((m) => m[1]))];
        if (dataUrls.length) {
          event.preventDefault();
          (async () => {
            let html = pastedHtml;
            let replaced = 0;
            for (const [i, dataUrl] of dataUrls.entries()) {
              try {
                const blob = await (await fetch(dataUrl)).blob();
                const ext = (blob.type.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '');
                const file = new File([blob], `pasted-${i + 1}.${ext}`, { type: blob.type });
                const url = await uploadEditorImage(file, businessId, projectId);
                if (!url) continue;
                // 같은 data URL 이 여러 번 나올 수 있다 — 전부 바꾼다. split/join 은 정규식 이스케이프가 불필요.
                html = html.split(dataUrl).join(url);
                replaced += 1;
              } catch { /* 이 한 장만 건너뛴다 — 나머지는 살린다 */ }
            }
            if (!replaced) {
              // 한 장도 못 올렸으면 종전 동작(그림 없이 글만)으로 떨어진다 — 회귀는 만들지 않는다.
              editor?.chain().focus().insertContent(pastedHtml).run();
              return;
            }
            editor?.chain().focus().insertContent(html).run();
          })();
          return true;
        }

        // 3) 마크다운 텍스트 붙여넣기 → 제목·표·목록으로 변환 (#151)
        return handleMarkdownPaste(view, event);
      },
      handleDrop: (_view, event) => {
        const files = event.dataTransfer?.files;
        if (!files || files.length === 0) return false;
        const imgs = Array.from(files).filter(f => f.type.startsWith('image/'));
        if (imgs.length === 0) return false;
        event.preventDefault();
        (async () => {
          for (const f of imgs) {
            const url = await uploadEditorImage(f, businessId, projectId);
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
      // 운영 #378 — 여기만 businessId 를 안 넘겨 **legacy fallback(파일 저장만, DB 행 없음)** 으로
      //   빠지고 있었다. 툴바의 이미지 넣기 버튼이 가장 일반적인 경로인데, 그 경로로 넣은 이미지는
      //   Q File 어디에도 안 남고 공유·용량 관리도 안 됐다 (memory: 인라인 자료 = File 등록).
      const url = await uploadEditorImage(f, businessId, projectId);
      if (url && editor) editor.chain().focus().setImage({ src: url }).run();
    }
    e.target.value = '';
  }, [editor, businessId, projectId]);

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
    const targetEl = e.target as HTMLElement;
    if (targetEl.closest('.ProseMirror')) return;
    // 툴바·버튼·링크 클릭은 커서 하이재킹 대상 아님
    if (targetEl.closest('button, a, input, select, textarea, [role="button"]')) return;
    // 드래그로 텍스트 선택한 직후엔 커서를 끝으로 뺏지 않는다(선택 유지).
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;
    // 본문 '아래' 빈 영역을 클릭했을 때만 끝으로 진입. 좌우·상단 여백 클릭은 무시.
    //   (여백 클릭이 focus('end') 를 불러 커서가 끝으로 튀며 화면이 맨 아래로 점프하던 회귀 fix — Irene)
    const pm = (e.currentTarget as HTMLElement).querySelector('.ProseMirror');
    if (pm && e.clientY < pm.getBoundingClientRect().bottom) return;
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
          {/* #363 정렬 — 같은 값을 다시 누르면 해제(기본 정렬로 복귀) */}
          <Group>
            {ALIGNS.map(({ key, icon }) => {
              const label = key === 'left'
                ? (t('editor.alignLeft', { defaultValue: '왼쪽 정렬' }) as string)
                : key === 'center'
                  ? (t('editor.alignCenter', { defaultValue: '가운데 정렬' }) as string)
                  : (t('editor.alignRight', { defaultValue: '오른쪽 정렬' }) as string);
              return (
                <ToolBtn
                  key={key}
                  type="button"
                  $active={editor.isActive({ textAlign: key })}
                  onClick={() => {
                    const chain = editor.chain().focus();
                    if (editor.isActive({ textAlign: key })) chain.unsetTextAlign().run();
                    else chain.setTextAlign(key).run();
                  }}
                  title={label}
                  aria-label={label}
                >
                  {icon}
                </ToolBtn>
              );
            })}
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
        <BubbleMenu className="pq-editor-bubble" editor={editor} shouldShow={({ editor: ed }) => ed.isActive('image')}>
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
        <BubbleMenu className="pq-editor-bubble" editor={editor} shouldShow={({ editor: ed }) => ed.isActive('table')}>
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
              {/* 운영 #311 — 열 폭 고정(균등). 자유 조절은 그대로 — 끌면 다시 달라진다. */}
              <TableBubbleBtn type="button" title={t('editor.table.evenColsHint', '모든 열을 같은 너비로 맞춥니다 (드래그로 다시 조절 가능)') as string}
                onMouseDown={(e) => { e.preventDefault(); distributeTableColumnsEvenly(editor); }}>⇹{t('editor.table.evenCols', '열 균등')}</TableBubbleBtn>
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
  /* borderless(문서·메모 풀모드)는 sticky 툴바가 바깥 스크롤 컨테이너에 붙을 수 있게 overflow visible.
     bordered/compact 는 라운드 클리핑·내부 스크롤 위해 hidden 유지. */
  overflow: ${p => p.$borderless ? 'visible' : 'hidden'};
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
  /* 스크롤해도 툴바가 상단에 따라오게 sticky. borderless(풀모드)는 Wrap overflow:visible 라
     바깥 스크롤 컨테이너 상단에 고정 — 문서·메모 편집 중 서식 버튼 항상 접근.
     ★ top 은 스크롤 컨테이너가 정한다(--pq-sticky-top). sticky 는 스크롤 컨테이너의 **콘텐츠 박스**
       상단을 기준으로 멈추므로, 컨테이너에 padding-top 이 있으면 그 높이만큼 아래에 붙는다.
       그 틈이 비어 보이고 본문이 그 사이로 지나가 "안 붙는다"로 읽혔다(Irene). 여백을 가진
       컨테이너가 자기 여백만큼 음수 값을 넘겨 화면 맨 위에 딱 붙인다. */
  position: sticky; top: var(--pq-sticky-top, 0px); z-index: 5;
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
      padding: 0 4px !important; font-size: 0.6875rem !important;
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
  font-size: ${p => p.$compact ? '0.6875rem' : '0.75rem'};
  font-weight: 700; color: ${p => p.$active ? '#0F766E' : '#475569'};
  background: ${p => p.$active ? '#F0FDFA' : 'transparent'};
  border-radius: 6px;
  flex-shrink: 0;
  &:hover { background: ${p => p.$active ? '#CCFBF1' : '#E2E8F0'}; color: #0F172A; }
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
  font-size: 0.6875rem; font-weight: 700; cursor: pointer; min-width: 28px;
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
  font-size: 0.6875rem; font-weight: 700; cursor: pointer; white-space: nowrap;
  &:hover { background: ${p => p.$danger ? '#7F1D1D' : '#334155'}; color: #FFF; }
`;

const Body = styled.div<{ $editable?: boolean; $borderless?: boolean; $compact?: boolean }>`
  /* borderless: 글자(본문)만 좌우 24px 안쪽. 툴바는 Wrap 풀폭(컨테이너 좌우 여백 0)이라 좌우 끝까지 붙는다.
     → sticky 툴바·구분선 풀폭, 글자만 안쪽 여백(Irene). compact(팝업)는 좁으니 자체 최소 여백. */
  padding: ${p => p.$compact ? '8px 12px' : (p.$borderless ? '12px 24px' : '16px 20px')};
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
    font-size: 0.8125rem; margin: 16px 0;
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
  /* ★ 2026-08-27 — **읽기 전용에는 .tableWrapper 가 없다.**
     Tiptap 은 columnResizing 이 붙는 편집 모드에서만 그 래퍼를 만든다. 그래서 읽기 화면에서는
     width:max-content 표가 가둘 곳 없이 그대로 페이지 밖으로 잘려 나갔다
     (운영 신고 2026-08-27 공개 미리보기 — 글 폭 658px 안에서 표가 1839px, 1181px 잘림).
     읽기 화면의 기준은 **페이지 폭**이다: 표 자신이 스크롤 컨테이너가 되고(display:block),
     폭이 남으면 auto 레이아웃이 글을 접어 페이지 안에 맞춘다. 정말 못 맞추는 넓은 표만 그 안에서 스크롤.
     편집 모드는 손대지 않는다 — colgroup 고정폭·칼럼 리사이즈가 그대로 필요하다.
     ⚠️ **이 블록은 반드시 위의 베이스 table 규칙(width:max-content) 뒤에 있어야 한다.** 같은 특정도라 나중 것이 이기는데,
     앞으로 옮기면 베이스의 width:max-content 가 다시 이겨 **조용히 무력화된다**
     (실제로 처음 넣을 때 앞에 두어 실측 0/3 실패했다). */
  ${p => p.$editable ? '' : `
  & table {
    display: block;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    width: 100%;
    max-width: 100%;
    min-width: 0;
    table-layout: auto;
    &::-webkit-scrollbar { height: 8px; }
    &::-webkit-scrollbar-thumb { background: #CBD5E1; border-radius: 4px; }
  }
  /* 칼럼 하한은 편집 화면과 같은 96px — 이보다 좁게 눌러 넣으면 글이 세로로 붕괴한다.
     그래서 칼럼이 많아 다 못 넣는 표는 페이지를 밀지 않고 **표 안에서** 가로 스크롤된다. */
  & table td, & table th { min-width: 96px; word-break: break-word; overflow-wrap: anywhere; }
  `}
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
    outline: none; font-size: 0.875rem; line-height: 1.55; color: #0F172A;
    > * + * { margin-top: 0.5em; }
    h1 { font-size: 1.375rem; font-weight: 700; color: #0F172A; margin-top: 1.2em; line-height: 1.3; }
    h2 { font-size: 1.125rem; font-weight: 700; color: #0F172A; margin-top: 1em; line-height: 1.35; }
    h3 { font-size: 0.9375rem; font-weight: 700; color: #334155; margin-top: 0.8em; line-height: 1.4; }
    p { color: #334155; margin: 0; }
    ul, ol { padding-left: 1.4em; margin: 0; }
    li { margin: 0; }
    li + li { margin-top: 0.2em; }
    li > p { margin: 0; }
    ul li::marker { color: #94A3B8; }
    ol li::marker { color: #94A3B8; font-weight: 600; }
    blockquote { border-left: 3px solid #14B8A6; padding: 4px 12px; background: #F0FDFA; color: #334155; border-radius: 0 6px 6px 0; }
    code { background: #F1F5F9; padding: 2px 6px; border-radius: 4px; font-size: 0.75rem; font-family: 'SFMono-Regular', Menlo, Consolas, monospace; color: #BE185D; }
    /* CodeBlockLowlight node view 가 자체 스타일 가짐 — 옛 pre/code 스타일은 fallback. */
    pre { background: #1E293B; color: #E2E8F0; padding: 12px 14px; border-radius: 8px; font-size: 0.75rem; overflow-x: auto; }
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
    ${p => resizableImageCss(!!p.$editable)}
    p.is-editor-empty:first-child::before {
      color: #94A3B8; content: attr(data-placeholder);
      float: left; height: 0; pointer-events: none;
    }
  }
`;
