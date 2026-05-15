// 사이클 N+16 — 노션 스타일 코드 블록 (회색 배경 + 우측 상단 복사 버튼 + 언어 선택).
// CodeBlockLowlight extension 의 NodeView 로 사용. lowlight 가 highlight.js 색상 입혀줌.
import React, { useRef, useState } from 'react';
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

const CodeBlockComponent: React.FC<NodeViewProps> = ({ node, updateAttributes, extension: _e }) => {
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

  return (
    <CodeWrap as={NodeViewWrapper as unknown as React.ElementType} className="pq-code-block">
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
  );
};

export default CodeBlockComponent;
export const codeBlockNodeView = () => ReactNodeViewRenderer(CodeBlockComponent);

const CodeWrap = styled.div`
  position: relative;
  margin: 12px 0;
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
    font-size: 12.5px;
    line-height: 1.6;
  }
  pre code {
    background: transparent !important;
    color: #E2E8F0 !important;
    padding: 0 !important;
    font-family: 'SFMono-Regular', Menlo, Consolas, monospace;
  }
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
  font-size: 11px;
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
  font-size: 11px;
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
  font-size: 11px;
  font-weight: 600;
  font-family: inherit;
  border-radius: 6px;
  cursor: pointer;
  transition: opacity 0.15s, background 0.15s, color 0.15s;
  opacity: 0.65;
  &:hover { opacity: 1; background: rgba(255,255,255,0.1); color: #FFFFFF; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 2px; opacity: 1; }
`;
