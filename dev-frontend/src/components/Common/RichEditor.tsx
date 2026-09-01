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
import Underline from '@tiptap/extension-underline';
// 표 (#151) — 여태 RichEditor 에는 표 확장이 없어서 업무 본문·메일·지식에 표를 **넣을 수도 볼 수도** 없었다.
// (문서 에디터 PostEditor 에는 있었다 — 같은 앱인데 화면마다 되고 안 됐다.)
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { handleMarkdownPaste } from '../../utils/markdownPaste';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import { apiFetch } from '../../contexts/AuthContext';
import { SlashCommand } from './SlashCommand';
import SlashCommandList from './SlashCommandList';
import { LightboxWrapper } from './ImageLightbox';
import { plainTextToHtml } from '../../utils/sanitizeHtml';
import { isEnterAction } from '../../utils/imeKey';

// Image extension 확장 — width attribute 지원 (사이클 N+9, 사이즈 조정용).
// HTML 출력: <img src="..." width="33%" /> 등.
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

type Props = {
  value: string;
  onChange: (html: string) => void;
  onBlur?: (html: string) => void;
  placeholder?: string;
  uploadUrl?: string;
  readOnly?: boolean;
  minHeight?: number;
  /** 상단 고정 툴바 노출 (기본 false — 기존 사용처는 렌더 출력이 그대로다).
   *  메일 작성처럼 "다른 메일 서비스만큼은 돼야 하는" 화면에서 켠다. 슬래시 커맨드·버블 메뉴는
   *  그대로 남는다 — 아는 사람은 계속 쓰고, 모르는 사람은 버튼을 본다. */
  toolbar?: boolean;
};

export default function RichEditor({
  value,
  onChange,
  onBlur,
  placeholder,
  uploadUrl,
  readOnly = false,
  minHeight = 180,
  toolbar = false,
}: Props) {
  const { t } = useTranslation('common');
  const effectivePlaceholder = placeholder ?? t('editor.placeholder');
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkValue, setLinkValue] = useState('');
  const currentValueRef = useRef(value);
  const uploadUrlRef = useRef(uploadUrl);
  useEffect(() => { uploadUrlRef.current = uploadUrl; }, [uploadUrl]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: false }),
      // 링크는 editable/readOnly 무관하게 항상 클릭 시 새 탭 — 편집 권한 있어도 본문 링크는 외부 이동 우선.
      // 링크 텍스트 자체 편집은 bubble 메뉴(🔗) 로. 링크 옆 글자에 cursor 두고 selection 만들면 됨.
      Link.configure({ openOnClick: true, autolink: true, HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' } }),
      ResizableImage.configure({ inline: false, allowBase64: false }),
      Placeholder.configure({
        placeholder: ({ node }) => node.type.name === 'paragraph' ? effectivePlaceholder : '',
        includeChildren: false,
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Underline,
      // ★ class 'pq-table' 는 장식이 아니라 **계약**이다.
      //   메일 발송 시 services/emailHtmlInline.js 가 이 클래스가 붙은 표에만 테두리를 인라인으로
      //   심는다(메일 클라이언트는 <style> 을 대부분 버린다). 클래스가 없으면 그 코드가 걸릴
      //   대상이 없어 **조용히 아무 일도 하지 않는다** — 실제로 그 상태였다(2026-08-19 발견).
      //   전달된 남의 표에는 이 클래스가 없으므로 우리가 손대지 않는다는 구분도 이 클래스가 만든다.
      Table.configure({ resizable: true, HTMLAttributes: { class: 'pq-table' } }),
      TableRow,
      TableHeader,
      TableCell,
      SlashCommand.configure({ listComponent: SlashCommandList }),
    ],
    // #219 — 평문 본문(개행만 있는 옛 데이터·문서 이관본)은 그대로 넣으면 한 문단으로 뭉친다.
    content: plainTextToHtml(value),
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
      handlePaste: (view, event) => {
        // 1) 이미지 붙여넣기 — 옛 동작 그대로 (업로드 경로가 있을 때만)
        if (uploadUrlRef.current) {
          const files = Array.from(event.clipboardData?.files || []);
          const images = files.filter(f => f.type.startsWith('image/'));
          if (images.length > 0) {
            event.preventDefault();
            images.forEach(f => uploadAndInsertImage(f));
            return true;
          }
        }
        // 2) 운영 #342 — 노션·워드·웹에서 복사하면 이미지가 클립보드 HTML 안에 data: base64 로 온다.
        //    Image 확장이 allowBase64: false 라 그 <img> 를 통째로 버려서 "그림만 안 붙는" 상태였다.
        //    붙여넣는 순간 우리 스토리지로 올려 URL 로 바꾼다 (base64 를 본문에 박지 않는다).
        //    PostEditor 와 같은 규칙 — 두 에디터가 다르게 동작하면 사용자는 화면마다 다른 제품으로 읽는다.
        if (uploadUrlRef.current) {
          const pastedHtml = event.clipboardData?.getData('text/html') || '';
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
                  const src = await uploadImageForUrl(new File([blob], `pasted-${i + 1}.${ext}`, { type: blob.type }));
                  if (!src) continue;
                  html = html.split(dataUrl).join(src);
                  replaced += 1;
                } catch { /* 이 한 장만 건너뛴다 */ }
              }
              editor?.chain().focus().insertContent(replaced ? html : pastedHtml).run();
            })();
            return true;
          }
        }
        // 3) 마크다운 텍스트 붙여넣기 → 제목·표·목록으로 변환 (#151)
        return handleMarkdownPaste(view, event);
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
    editor.commands.setContent(plainTextToHtml(value), { emitUpdate: false });
    currentValueRef.current = value;
  }, [value, editor]);

  // 업로드만 하고 **URL 을 돌려준다** — 삽입 위치가 다른 호출부(#342 base64 치환)가 재사용한다.
  const uploadImageForUrl = async (file: File): Promise<string | null> => {
    const url = uploadUrlRef.current;
    if (!url) return null;
    try {
      const fd = new FormData();
      fd.append('file', file, file.name);
      const r = await apiFetch(url, { method: 'POST', body: fd });
      // ★ apiFetch 는 throw 하지 않는다 — res.ok 를 봐야 실패를 안다.
      // ★ 운영 #378 — 여기서 조용히 null 만 돌려주는 바람에, Q info 의 업로드 경로가
      //   **백엔드에 없는 주소(404)** 였는데도 아무도 몰랐다. 사용자에게는 "이미지를 넣어도
      //   그냥 안 들어간다" 로만 보였다. 실패는 최소한 흔적을 남긴다.
      if (!r.ok) {
        console.warn('[RichEditor] 이미지 업로드 실패', r.status, url);
        return null;
      }
      const j = await r.json();
      if (!(j.success && j.data?.preview_url)) {
        console.warn('[RichEditor] 업로드는 됐으나 preview_url 이 없다', url, JSON.stringify(j).slice(0, 200));
        return null;
      }
      return String(j.data.preview_url);
    } catch (e) {
      console.warn('[RichEditor] 이미지 업로드 예외', url, (e as Error)?.message);
      return null;
    }
  };

  const uploadAndInsertImage = async (file: File) => {
    if (!editor) return;
    const src = await uploadImageForUrl(file);
    if (src) editor.chain().focus().setImage({ src, alt: file.name }).run();
  };

  // 링크 입력 — window.prompt 는 금지(CLAUDE.md 절대 금지 사항)라 인라인 입력줄로 받는다.
  const openLinkInput = () => {
    if (!editor) return;
    setLinkValue(editor.getAttributes('link').href || '');
    setLinkOpen(true);
  };
  const applyLink = () => {
    if (!editor) return;
    const url = linkValue.trim();
    if (!url) editor.chain().focus().extendMarkRange('link').unsetLink().run();
    else editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
    setLinkOpen(false); setLinkValue('');
  };
  const setLink = openLinkInput;

  // 바깥에서 폭·여백을 조정할 수 있게 안정된 클래스를 준다 (메일 컴포저가 풀 폭으로 되민다).
  if (!editor) return <EditorShell className="pq-rich-editor" $mh={minHeight}><PlainFallback /></EditorShell>;

  // 이미지 사이즈 토글 — editor 가 image 선택 시 BubbleMenu 노출
  const setImageWidth = (w: string | null) => {
    if (!editor) return;
    editor.chain().focus().updateAttributes('image', { width: w }).run();
  };

  // N+49 hotfix — wrapper 빈 영역 클릭 시 editor 끝으로 focus. TipTap 표준 패턴.
  // ProseMirror DOM 안 클릭은 자동 처리 (이미 동작). wrapper padding/min-height 빈 영역만 처리.
  // 사용자 호소: "에디터 빈 곳 클릭해도 첫 번째 줄 커서 진입" — 빈 노트/문서 진입 시 어디 클릭해도 커서 진입.
  const handleWrapperClick = (e: React.MouseEvent) => {
    if (readOnly || !editor) return;
    const targetEl = e.target as HTMLElement;
    if (targetEl.closest('.ProseMirror')) return;
    if (targetEl.closest('button, a, input, select, textarea, [role="button"]')) return;
    // 드래그 선택 직후 커서 뺏지 않음 + 본문 아래 빈 영역 클릭일 때만 끝으로 진입 (맨아래 점프 회귀 fix)
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;
    const pm = (e.currentTarget as HTMLElement).querySelector('.ProseMirror');
    if (pm && e.clientY < pm.getBoundingClientRect().bottom) return;
    editor.commands.focus('end');
  };

  return (
    <EditorShell className="pq-rich-editor" $mh={minHeight} onClick={handleWrapperClick}>
      {/* 상단 고정 툴바 (opt-in). 디자인·동작은 문서 에디터(PostEditor)와 같은 계열로 맞춘다 —
          같은 앱에서 화면마다 다른 편집기처럼 보이지 않게. */}
      {toolbar && !readOnly && (
        <Toolbar>
          <TGroup>
            <ToolBtn type="button" $active={editor.isActive('bold')} title={t('editor.bold', { defaultValue: '굵게' }) as string}
              onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleBold().run(); }}>B</ToolBtn>
            <ToolBtn type="button" $active={editor.isActive('italic')} style={{ fontStyle: 'italic' }} title={t('editor.italic', { defaultValue: '기울임' }) as string}
              onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleItalic().run(); }}>I</ToolBtn>
            <ToolBtn type="button" $active={editor.isActive('underline')} style={{ textDecoration: 'underline' }} title={t('editor.underline', { defaultValue: '밑줄' }) as string}
              onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleUnderline().run(); }}>U</ToolBtn>
            <ToolBtn type="button" $active={editor.isActive('strike')} style={{ textDecoration: 'line-through' }} title={t('editor.strike', { defaultValue: '취소선' }) as string}
              onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleStrike().run(); }}>S</ToolBtn>
          </TGroup>
          <TSep />
          <TGroup>
            <ToolBtn type="button" $active={editor.isActive('heading', { level: 1 })} title={t('editor.heading1', { defaultValue: '제목 1' }) as string}
              onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleHeading({ level: 1 }).run(); }}>H1</ToolBtn>
            <ToolBtn type="button" $active={editor.isActive('heading', { level: 2 })} title={t('editor.heading2', { defaultValue: '제목 2' }) as string}
              onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleHeading({ level: 2 }).run(); }}>H2</ToolBtn>
          </TGroup>
          <TSep />
          <TGroup>
            <ToolBtn type="button" $active={editor.isActive('bulletList')} title={t('editor.bulletList', { defaultValue: '글머리 기호' }) as string}
              onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleBulletList().run(); }}>•</ToolBtn>
            <ToolBtn type="button" $active={editor.isActive('orderedList')} title={t('editor.orderedList', { defaultValue: '번호 매기기' }) as string}
              onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleOrderedList().run(); }}>1.</ToolBtn>
            <ToolBtn type="button" $active={editor.isActive('blockquote')} title={t('editor.blockquote', { defaultValue: '인용' }) as string}
              onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleBlockquote().run(); }}>❝</ToolBtn>
            <ToolBtn type="button" title={t('editor.horizontalRule', { defaultValue: '구분선' }) as string}
              onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().setHorizontalRule().run(); }}>—</ToolBtn>
          </TGroup>
          <TSep />
          <TGroup>
            <ToolBtn type="button" $active={editor.isActive('link')} title={t('editor.link', { defaultValue: '링크' }) as string}
              onMouseDown={(e) => { e.preventDefault(); openLinkInput(); }}>🔗</ToolBtn>
            <ToolBtn type="button" title={t('editor.insertTable', { defaultValue: '표 삽입 (3x3, 헤더 포함)' }) as string}
              aria-label={t('editor.insertTableAria', { defaultValue: '표 삽입' }) as string}
              onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(); }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/>
                <line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/>
              </svg>
            </ToolBtn>
          </TGroup>
          {editor.isActive('table') && (
            <>
              <TSep />
              <TGroup>
                <ToolBtn type="button" title={t('editor.addColumnAfter', { defaultValue: '오른쪽에 열 추가' }) as string}
                  onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().addColumnAfter().run(); }}>+{t('editor.colShort', { defaultValue: '열' }) as string}</ToolBtn>
                <ToolBtn type="button" title={t('editor.deleteColumn', { defaultValue: '열 삭제' }) as string}
                  onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().deleteColumn().run(); }}>−{t('editor.colShort', { defaultValue: '열' }) as string}</ToolBtn>
                <ToolBtn type="button" title={t('editor.addRowAfter', { defaultValue: '아래에 행 추가' }) as string}
                  onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().addRowAfter().run(); }}>+{t('editor.rowShort', { defaultValue: '행' }) as string}</ToolBtn>
                <ToolBtn type="button" title={t('editor.deleteRow', { defaultValue: '행 삭제' }) as string}
                  onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().deleteRow().run(); }}>−{t('editor.rowShort', { defaultValue: '행' }) as string}</ToolBtn>
                <ToolBtn type="button" style={{ color: '#DC2626' }} title={t('editor.deleteTable', { defaultValue: '표 삭제' }) as string}
                  onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().deleteTable().run(); }}>{t('editor.tableShort', { defaultValue: '표' }) as string}✕</ToolBtn>
              </TGroup>
            </>
          )}
          <TSep />
          <TGroup>
            <ToolBtn type="button" title={t('editor.undo', { defaultValue: '실행 취소' }) as string}
              onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().undo().run(); }}>↶</ToolBtn>
            <ToolBtn type="button" title={t('editor.redo', { defaultValue: '다시 실행' }) as string}
              onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().redo().run(); }}>↷</ToolBtn>
          </TGroup>
        </Toolbar>
      )}
      {linkOpen && !readOnly && (
        <LinkBar>
          <LinkInput
            autoFocus
            value={linkValue}
            placeholder={t('editor.linkPh', { defaultValue: 'https://example.com (비우고 적용하면 링크 해제)' }) as string}
            onChange={(e) => setLinkValue(e.target.value)}
            onKeyDown={(e) => {
              if (isEnterAction(e)) { e.preventDefault(); applyLink(); }
              if (e.key === 'Escape') { e.preventDefault(); setLinkOpen(false); }
            }}
          />
          <ToolBtn type="button" onMouseDown={(e) => { e.preventDefault(); applyLink(); }}>
            {t('editor.linkApply', { defaultValue: '적용' }) as string}
          </ToolBtn>
          <ToolBtn type="button" onMouseDown={(e) => { e.preventDefault(); setLinkOpen(false); }}>
            {t('editor.linkCancel', { defaultValue: '취소' }) as string}
          </ToolBtn>
        </LinkBar>
      )}
      {!readOnly && (
        <>
          <BubbleMenu editor={editor} shouldShow={({ editor: ed }) => ed.isActive('image')}>
            <Bubble>
              <BBtn type="button" $active={editor.getAttributes('image').width === '33%'} onMouseDown={e => { e.preventDefault(); setImageWidth('33%'); }}>S</BBtn>
              <BBtn type="button" $active={editor.getAttributes('image').width === '66%'} onMouseDown={e => { e.preventDefault(); setImageWidth('66%'); }}>M</BBtn>
              <BBtn type="button" $active={!editor.getAttributes('image').width || editor.getAttributes('image').width === '100%'} onMouseDown={e => { e.preventDefault(); setImageWidth(null); }}>L</BBtn>
            </Bubble>
          </BubbleMenu>
          <BubbleMenu editor={editor} shouldShow={({ editor: ed }) => !ed.isActive('image') && !ed.state.selection.empty}>
            <Bubble>
              <BBtn type="button" $active={editor.isActive('bold')} onMouseDown={e => { e.preventDefault(); editor.chain().focus().toggleBold().run(); }}>B</BBtn>
              <BBtn type="button" $active={editor.isActive('italic')} style={{ fontStyle: 'italic' }} onMouseDown={e => { e.preventDefault(); editor.chain().focus().toggleItalic().run(); }}>I</BBtn>
              <BBtn type="button" $active={editor.isActive('strike')} style={{ textDecoration: 'line-through' }} onMouseDown={e => { e.preventDefault(); editor.chain().focus().toggleStrike().run(); }}>S</BBtn>
              <BBtn type="button" $active={editor.isActive('code')} onMouseDown={e => { e.preventDefault(); editor.chain().focus().toggleCode().run(); }}>{'</>'}</BBtn>
              <BSep />
              <BBtn type="button" $active={editor.isActive('link')} onMouseDown={e => { e.preventDefault(); setLink(); }}>🔗</BBtn>
            </Bubble>
          </BubbleMenu>
        </>
      )}
      <LightboxWrapper>
        <EditorContent editor={editor} />
      </LightboxWrapper>
      {!readOnly && (
        <Hint>{t('editor.hintPrefix')} <kbd>/</kbd> {t('editor.hintSuffix')}</Hint>
      )}
    </EditorShell>
  );
}

const PlainFallback = styled.div`min-height:80px;`;

// 툴바 — 문서 에디터(PostEditor)와 같은 계열. 좁은 화면에서는 한 줄 가로 스크롤.
const Toolbar = styled.div`
  display:flex;align-items:center;gap:2px;padding:6px 8px;flex-wrap:wrap;
  background:#F8FAFC;border-bottom:1px solid #E2E8F0;border-radius:10px 10px 0 0;
  /* top 은 스크롤 컨테이너가 --pq-sticky-top 으로 정한다 (PostEditor 주석 참조) */
  position:sticky;top:var(--pq-sticky-top,0px);z-index:5;
  @media (max-width:640px){flex-wrap:nowrap;overflow-x:auto;overflow-y:hidden;padding:4px 6px;}
`;
const TGroup = styled.div`display:inline-flex;gap:2px;`;
const TSep = styled.div`width:1px;height:18px;background:#E2E8F0;margin:0 4px;flex-shrink:0;`;
const ToolBtn = styled.button<{ $active?: boolean }>`
  all:unset;cursor:pointer;min-width:28px;height:28px;padding:0 8px;
  display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;
  font-size:0.75rem;font-weight:700;border-radius:6px;
  color:${p => (p.$active ? '#0F766E' : '#475569')};
  background:${p => (p.$active ? '#F0FDFA' : 'transparent')};
  &:hover{background:${p => (p.$active ? '#CCFBF1' : '#E2E8F0')};color:#0F172A;}
  &:focus-visible{outline:2px solid #14B8A6;outline-offset:1px;}
`;
// 링크 입력줄 — window.prompt 대체 (CLAUDE.md 금지)
const LinkBar = styled.div`
  display:flex;align-items:center;gap:6px;padding:6px 8px;
  background:#FFFFFF;border-bottom:1px solid #E2E8F0;
`;
const LinkInput = styled.input`
  flex:1;min-width:0;height:28px;padding:0 10px;
  border:1px solid #E2E8F0;border-radius:6px;font-size:0.75rem;color:#334155;
  &:focus{outline:none;border-color:#14B8A6;box-shadow:0 0 0 3px rgba(20,184,166,.15);}
`;

const EditorShell = styled.div<{ $mh: number }>`
  border:1px solid #E2E8F0;border-radius:10px;background:#FFF;display:flex;flex-direction:column;
  & .pq-editor-body{
    outline:none;padding:14px 16px;min-height:${p => p.$mh}px;font-size:0.875rem;line-height:1.65;color:#0F172A;
    overflow-wrap:anywhere;word-break:break-word;
  }
  & .pq-editor-body > * + *{margin-top:8px;}
  & .pq-editor-body p{margin:0;}
  & .pq-editor-body p.is-editor-empty:first-child::before{content:attr(data-placeholder);color:#94A3B8;float:left;height:0;pointer-events:none;}
  & .pq-editor-body h1{font-size:1.5rem;font-weight:700;margin:16px 0 4px;line-height:1.2;}
  & .pq-editor-body h2{font-size:1.1875rem;font-weight:700;margin:12px 0 4px;line-height:1.3;}
  & .pq-editor-body h3{font-size:1rem;font-weight:700;margin:10px 0 4px;line-height:1.4;}
  & .pq-editor-body ul,& .pq-editor-body ol{padding-left:22px;}
  & .pq-editor-body ul[data-type="taskList"]{padding-left:4px;list-style:none;}
  & .pq-editor-body ul[data-type="taskList"] li{display:flex;align-items:flex-start;gap:6px;}
  & .pq-editor-body ul[data-type="taskList"] li > label{margin-top:3px;}
  & .pq-editor-body ul[data-type="taskList"] li > label input{accent-color:#14B8A6;}
  & .pq-editor-body ul[data-type="taskList"] li > div{flex:1;}
  & .pq-editor-body ul[data-type="taskList"] li[data-checked="true"] > div{color:#94A3B8;text-decoration:line-through;}
  & .pq-editor-body blockquote{border-left:3px solid #14B8A6;padding:4px 12px;color:#475569;background:#F0FDFA;border-radius:4px;}
  & .pq-editor-body code{background:#F1F5F9;padding:1px 4px;border-radius:3px;font-family:monospace;font-size:0.75rem;}
  & .pq-editor-body pre{background:#0F172A;color:#E2E8F0;padding:12px 14px;border-radius:8px;overflow-x:auto;font-family:monospace;font-size:0.75rem;line-height:1.5;}
  & .pq-editor-body pre code{background:transparent;color:inherit;padding:0;}
  & .pq-editor-body hr{border:none;border-top:1px solid #E2E8F0;margin:14px 0;}
  & .pq-editor-body img{max-width:100%;border-radius:8px;display:block;margin:4px 0;}
  & .pq-editor-body a{color:#0D9488;text-decoration:underline;text-decoration-color:#99F6E4;text-underline-offset:3px;}
  /* 표 (#151) — 문서 에디터(PostEditor)와 같은 시각. 넓은 표는 가로 스크롤로 가둔다(페이지가 밀리지 않게) */
  & .pq-editor-body .tableWrapper{overflow-x:auto;}
  & .pq-editor-body table{
    border-collapse:separate;border-spacing:0;table-layout:fixed;
    width:max-content;min-width:100%;font-size:0.8125rem;margin:16px 0;
    border:1px solid #CBD5E1;border-radius:10px;overflow:hidden;background:#fff;
  }
  & .pq-editor-body table td,& .pq-editor-body table th{
    border-right:1px solid #E2E8F0;border-bottom:1px solid #E2E8F0;
    padding:10px 14px;vertical-align:top;min-width:96px;position:relative;box-sizing:border-box;
  }
  & .pq-editor-body table td:last-child,& .pq-editor-body table th:last-child{border-right:none;}
  & .pq-editor-body table tr:last-child td,& .pq-editor-body table tr:last-child th{border-bottom:none;}
  & .pq-editor-body table th{
    background:#F8FAFC;color:#0F172A;font-weight:700;text-align:left;
    letter-spacing:-0.1px;border-bottom:1px solid #CBD5E1;
  }
  & .pq-editor-body ::selection{background:#CCFBF1;}
`;

const Hint = styled.div`padding:6px 16px 8px;font-size:0.6875rem;color:#94A3B8;border-top:1px solid #F1F5F9;
  kbd{display:inline-block;padding:1px 5px;background:#F1F5F9;border:1px solid #E2E8F0;border-radius:3px;font-size:0.625rem;font-family:monospace;color:#475569;margin:0 2px;}
`;

const Bubble = styled.div`display:inline-flex;align-items:center;gap:2px;padding:3px;background:#0F172A;border-radius:8px;box-shadow:0 4px 12px rgba(15,23,42,0.25);`;
const BBtn = styled.button<{ $active?: boolean }>`
  border:none;background:${p => p.$active ? '#334155' : 'transparent'};
  color:${p => p.$active ? '#FFF' : '#CBD5E1'};
  padding:4px 8px;border-radius:5px;font-size:0.75rem;font-weight:600;cursor:pointer;min-width:24px;
  &:hover{background:#334155;color:#FFF;}
`;
const BSep = styled.div`width:1px;height:16px;background:#334155;margin:0 2px;`;
