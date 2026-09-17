// 사이클 N+16 — 노션 스타일 코드 블록 (회색 배경 + 우측 상단 복사 버튼 + 언어 선택).
// CodeBlockLowlight extension 의 NodeView 로 사용. lowlight 가 highlight.js 색상 입혀줌.
import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';

const COMMON_LANGS = [
  'auto', 'plaintext',
  'javascript', 'typescript', 'jsx', 'tsx',
  'python', 'java', 'kotlin', 'swift', 'objectivec',
  'c', 'cpp', 'csharp', 'go', 'rust',
  'ruby', 'php', 'scala',
  'bash', 'shell', 'powershell',
  'html', 'css', 'scss', 'json', 'xml', 'yaml', 'toml', 'markdown',
  'sql', 'graphql',
];

const CodeBlockComponent: React.FC<NodeViewProps> = ({ node, updateAttributes, editor, getPos, extension: _e }) => {
  const { t } = useTranslation('qdocs');
  const language = node.attrs.language || 'auto';
  const [copied, setCopied] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const preRef = useRef<HTMLPreElement>(null);
  const langRootRef = useRef<HTMLDivElement | null>(null);

  // 언어 popover 외부 클릭/Esc 닫기 (button + popover 패턴 — PlanQ 디자인 규약)
  React.useEffect(() => {
    if (!langOpen) return;
    const onDown = (e: MouseEvent) => {
      if (langRootRef.current && !langRootRef.current.contains(e.target as Node)) setLangOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setLangOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [langOpen]);

  const copy = async () => {
    const text = preRef.current?.textContent || '';
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // fallback: textarea + execCommand
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch { /* nope */ }
      document.body.removeChild(ta);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  /**
   * 코드블록 **위/아래에 문단을 끼워 넣는다** (Irene #420, 2026-09-17).
   *
   * ★ 왜 손잡이가 필요한가 — `codeBlock` 은 **텍스트블록**이라 ProseMirror 의 Gapcursor 가
   *   뜨지 않는다(Gapcursor 는 이미지·구분선처럼 «글자가 안 들어가는» 노드 옆에만 선다).
   *   그래서 코드블록이 연달아 있으면 그 **사이에 커서를 놓을 방법이 아예 없었다** —
   *   클릭해도 위아래 코드 안으로 들어간다. 문서 끝은 TrailingNode 가 맡고, 사이는 여기가 맡는다.
   * ★ `contentEditable={false}` 로 둔다. 안 그러면 이 자리가 코드 내용의 일부가 된다.
   */
  const insertParagraph = (where: 'before' | 'after') => {
    if (typeof getPos !== 'function') return;
    const pos = getPos();
    if (typeof pos !== 'number') return;
    const at = where === 'before' ? pos : pos + node.nodeSize;
    editor.chain().focus().insertContentAt(at, { type: 'paragraph' }).setTextSelection(at + 1).run();
  };

  const zone = (where: 'before' | 'after') => (
    <InsertZone
      contentEditable={false}
      role="button"
      tabIndex={-1}
      aria-label={t(where === 'before' ? 'editor.codeInsertAbove' : 'editor.codeInsertBelow',
        { defaultValue: where === 'before' ? '코드 블록 위에 문단 추가' : '코드 블록 아래에 문단 추가' }) as string}
      onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); insertParagraph(where); }}
    ><InsertHint>+</InsertHint></InsertZone>
  );

  return (
    <NodeShell as={NodeViewWrapper as unknown as React.ElementType} className="pq-code-block">
      {zone('before')}
      <CodeWrap>
      <CodeHeader contentEditable={false}>
        <LangRoot ref={langRootRef}>
          <LangBtn type="button" onClick={() => setLangOpen(v => !v)} aria-label="language" aria-haspopup="listbox" aria-expanded={langOpen}>
            {language}
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 4 }}>
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </LangBtn>
          {langOpen && (
            <LangPopover role="listbox">
              {COMMON_LANGS.map(l => (
                <LangOption
                  key={l}
                  $active={l === language}
                  type="button"
                  role="option"
                  aria-selected={l === language}
                  onClick={() => {
                    updateAttributes({ language: l === 'auto' ? null : l });
                    setLangOpen(false);
                  }}
                >
                  {l}
                </LangOption>
              ))}
            </LangPopover>
          )}
        </LangRoot>
        <CopyBtn type="button" onClick={copy} aria-label="copy code">
          {copied ? (
            <>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Copied
            </>
          ) : (
            <>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
              Copy
            </>
          )}
        </CopyBtn>
      </CodeHeader>
      {/* NodeViewContent 의 as prop 타입이 좁아서 'code' 캐스팅. HTML 출력은 <pre><code> 으로 정상 렌더. */}
      <pre ref={preRef}><NodeViewContent as={'code' as 'div'} /></pre>
      </CodeWrap>
      {zone('after')}
    </NodeShell>
  );
};

export default CodeBlockComponent;
export const codeBlockNodeView = () => ReactNodeViewRenderer(CodeBlockComponent);

/* NodeViewWrapper 자리. 시각 박스(CodeWrap)와 삽입 띠를 **형제**로 둔다 —
   띠를 박스 **안에** 겹쳐 놓으면 `overflow:hidden` 에 잘리거나 헤더 버튼의 클릭을 먹는다. */
const NodeShell = styled.div`
  position: relative;
  margin: 12px 0;
`;
const CodeWrap = styled.div`
  position: relative;
  background: #1E293B;
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid #334155;
  &:hover button.pq-copy { opacity: 1; }
  pre {
    margin: 0 !important;
    padding: 14px 16px !important;
    background: transparent !important;
    border-radius: 0 !important;
    overflow-x: auto;
    font-size: 0.78125rem;
    line-height: 1.6;
  }
  pre code {
    background: transparent !important;
    color: #E2E8F0 !important;
    padding: 0 !important;
    font-family: 'SFMono-Regular', Menlo, Consolas, monospace;
  }
`;
/* 블록 위/아래의 얇은 띠. 평소엔 안 보이고 hover 할 때만 +가 뜬다.
   ★ 박스 **밖**(형제)에 둔다 — 안에 겹치면 `overflow:hidden` 에 잘리거나
     언어·복사 버튼의 클릭을 가로챈다(memory feedback_clipped_menu_reads_as_dead_button ·
     feedback_overlay_eats_click_false_reason). */
const InsertZone = styled.div`
  height: 12px;
  display: flex; align-items: center; justify-content: center;
  cursor: text;
  opacity: 0;
  transition: opacity 0.12s;
  &:hover { opacity: 1; }
  &:focus-visible { opacity: 1; outline: 2px solid #14B8A6; outline-offset: 2px; }
  /* ★ **터치 기기에는 hover 가 없다** — 그대로 두면 이 손잡이는 폰·태블릿에서 영영 보이지 않고,
     #420("코드기능 사이에 커서가 안 들어간다")을 고쳤는데 **폰에서는 여전히 못 쓰는** 상태가 된다.
     그리고 12px 는 최소 터치 타겟(36px)에 한참 못 미친다.
     그래서 터치에서는 **항상 옅게 보이고** 누를 수 있는 크기로 둔다. */
  @media (hover: none), (pointer: coarse) {
    height: 36px;
    opacity: 0.55;
  }
`;
const InsertHint = styled.span`
  display: inline-flex; align-items: center; justify-content: center;
  width: 18px; height: 14px; border-radius: 4px;
  background: #14B8A6; color: #FFFFFF;
  font-size: 0.625rem; font-weight: 700; line-height: 1;
  user-select: none;
`;
const CodeHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px 6px 12px;
  background: #0F172A;
  border-bottom: 1px solid #334155;
  user-select: none;
`;
const LangRoot = styled.div`
  position: relative;
  display: inline-flex;
  align-items: center;
`;
const LangBtn = styled.button`
  display: inline-flex;
  align-items: center;
  background: transparent;
  border: none;
  color: #94A3B8;
  font-size: 0.6875rem;
  font-family: 'SFMono-Regular', Menlo, Consolas, monospace;
  font-weight: 600;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
  text-transform: lowercase;
  &:hover { color: #E2E8F0; background: rgba(255,255,255,0.05); }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 1px; color: #E2E8F0; }
`;
const LangPopover = styled.div`
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 50;
  background: #0F172A;
  border: 1px solid #334155;
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.4);
  padding: 4px;
  max-height: 280px;
  overflow-y: auto;
  min-width: 140px;
  display: flex;
  flex-direction: column;
  gap: 1px;
`;
const LangOption = styled.button<{ $active?: boolean }>`
  display: block;
  width: 100%;
  text-align: left;
  padding: 5px 10px;
  background: ${p => p.$active ? 'rgba(20,184,166,0.18)' : 'transparent'};
  color: ${p => p.$active ? '#5EEAD4' : '#CBD5E1'};
  border: none;
  border-radius: 5px;
  font-size: 0.6875rem;
  font-family: 'SFMono-Regular', Menlo, Consolas, monospace;
  font-weight: 600;
  cursor: pointer;
  text-transform: lowercase;
  &:hover { background: rgba(255,255,255,0.06); color: #E2E8F0; }
`;
const CopyBtn = styled.button.attrs({ className: 'pq-copy' })`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.08);
  color: #CBD5E1;
  font-size: 0.6875rem;
  font-weight: 600;
  font-family: inherit;
  border-radius: 6px;
  cursor: pointer;
  transition: opacity 0.15s, background 0.15s, color 0.15s;
  opacity: 0.65;
  &:hover { opacity: 1; background: rgba(255,255,255,0.1); color: #FFFFFF; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 2px; opacity: 1; }
`;
