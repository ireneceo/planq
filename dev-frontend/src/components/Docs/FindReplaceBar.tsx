// 문서 편집기 찾기·바꾸기 막대 — 툴바 바로 아래(같이 따라 붙는다).
//   ⌘/Ctrl+F 찾기 · ⌘⇧H / Ctrl+H 바꾸기 · Enter 다음 · ⇧Enter 이전 · Esc 닫기.
// 동작은 editorFindReplace.ts 한 곳 — 이 파일은 입력과 표시만 한다.
import React, { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import type { Editor } from '@tiptap/core';
import { useEscapeStack } from '../../hooks/useEscapeStack';
import {
  getFindState, setFindQuery, clearFind, stepFind, replaceCurrent, replaceAll,
} from './editorFindReplace';

interface Props {
  editor: Editor;
  showReplace: boolean;
  onToggleReplace: () => void;
  initialQuery: string;
  focusSignal: number;      // 열린 상태에서 ⌘F 를 다시 누르면 검색칸으로 포커스
  onClose: () => void;
}

const FindReplaceBar: React.FC<Props> = ({ editor, showReplace, onToggleReplace, initialQuery, focusSignal, onClose }) => {
  const { t } = useTranslation('qdocs');
  const [query, setQuery] = useState(initialQuery);
  const [replacement, setReplacement] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [, force] = useState(0);
  const [done, setDone] = useState<number | null>(null);   // 방금 바꾼 수 — 다음 입력 때 지운다
  const findRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);

  useEscapeStack(true, onClose);

  // 결과 수는 문서가 바뀔 때마다 달라진다(본문을 고치거나 실행 취소) — 에디터 갱신마다 다시 그린다
  useEffect(() => {
    const h = () => force((n) => n + 1);
    editor.on('transaction', h);
    return () => { editor.off('transaction', h); };
  }, [editor]);

  // 닫히면 칠한 자리를 지운다
  useEffect(() => () => clearFind(editor), [editor]);

  useEffect(() => {
    if (initialQuery) setQuery(initialQuery);
    const el = findRef.current;
    if (el) { el.focus(); el.select(); }
  }, [focusSignal, initialQuery]);

  useEffect(() => {
    if (showReplace) replaceRef.current?.focus();
  }, [showReplace]);

  useEffect(() => {
    setFindQuery(editor, query, caseSensitive, !!query);
  }, [editor, query, caseSensitive]);

  const st = getFindState(editor);
  const total = st.matches.length;
  const pos = total ? st.current + 1 : 0;

  const onFindKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;   // 한글 조합 중 Enter 는 확정이다
    if (e.key === 'Enter') { e.preventDefault(); stepFind(editor, e.shiftKey ? -1 : 1); }
  };
  const doReplace = () => { setDone(replaceCurrent(editor, replacement)); };
  const doReplaceAll = () => { setDone(replaceAll(editor, replacement)); };
  const onReplaceKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Enter') { e.preventDefault(); if (e.metaKey || e.ctrlKey) doReplaceAll(); else doReplace(); }
  };

  const countLabel = !query
    ? ''
    : total
      ? t('editor.find.count', { defaultValue: '{{pos}}/{{total}}', pos, total })
      : t('editor.find.none', { defaultValue: '결과 없음' });

  return (
    <Bar data-testid="editor-find-bar" role="search" aria-label={t('editor.find.aria', { defaultValue: '찾기 및 바꾸기' }) as string}>
      <Row>
        <ToggleBtn type="button" $open={showReplace} onClick={onToggleReplace}
          aria-expanded={showReplace}
          title={t('editor.find.toggleReplace', { defaultValue: '바꾸기 열기/닫기' }) as string}
          aria-label={t('editor.find.toggleReplace', { defaultValue: '바꾸기 열기/닫기' }) as string}>
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M3 2l4 3-4 3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </ToggleBtn>
        <Field>
          <Input ref={findRef} data-testid="editor-find-input" value={query}
            onChange={(e) => { setQuery(e.target.value); setDone(null); }}
            onKeyDown={onFindKey}
            placeholder={t('editor.find.placeholder', { defaultValue: '문서에서 찾기' }) as string}
            aria-label={t('editor.find.placeholder', { defaultValue: '문서에서 찾기' }) as string} />
          <Count data-testid="editor-find-count" $empty={!!query && !total}>{countLabel}</Count>
        </Field>
        <IconBtn type="button" $active={caseSensitive} aria-pressed={caseSensitive}
          onClick={() => setCaseSensitive((v) => !v)}
          title={t('editor.find.caseSensitive', { defaultValue: '대소문자 구분' }) as string}
          aria-label={t('editor.find.caseSensitive', { defaultValue: '대소문자 구분' }) as string}>Aa</IconBtn>
        <IconBtn type="button" disabled={!total} onClick={() => stepFind(editor, -1)}
          title={t('editor.find.prev', { defaultValue: '이전 (Shift+Enter)' }) as string}
          aria-label={t('editor.find.prevAria', { defaultValue: '이전 결과' }) as string}>
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 7.5L6 4.5l3 3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </IconBtn>
        <IconBtn type="button" disabled={!total} onClick={() => stepFind(editor, 1)}
          title={t('editor.find.next', { defaultValue: '다음 (Enter)' }) as string}
          aria-label={t('editor.find.nextAria', { defaultValue: '다음 결과' }) as string}>
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5L6 7.5l3-3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </IconBtn>
        <IconBtn type="button" data-testid="editor-find-close" onClick={onClose}
          title={t('editor.find.close', { defaultValue: '닫기 (Esc)' }) as string}
          aria-label={t('editor.find.closeAria', { defaultValue: '찾기 닫기' }) as string}>
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
        </IconBtn>
      </Row>
      {showReplace && (
        <Row>
          <Spacer />
          <Field>
            <Input ref={replaceRef} data-testid="editor-replace-input" value={replacement}
              onChange={(e) => { setReplacement(e.target.value); setDone(null); }}
              onKeyDown={onReplaceKey}
              placeholder={t('editor.find.replacePlaceholder', { defaultValue: '바꿀 내용' }) as string}
              aria-label={t('editor.find.replacePlaceholder', { defaultValue: '바꿀 내용' }) as string} />
          </Field>
          <TextBtn type="button" data-testid="editor-replace-one" disabled={!total} onClick={doReplace}
            title={t('editor.find.replaceHint', { defaultValue: '지금 결과 바꾸기 (Enter)' }) as string}>
            {t('editor.find.replace', { defaultValue: '바꾸기' })}
          </TextBtn>
          <TextBtn type="button" data-testid="editor-replace-all" disabled={!total} onClick={doReplaceAll}
            title={t('editor.find.replaceAllHint', { defaultValue: '모두 바꾸기 — 실행 취소(⌘Z) 한 번으로 되돌릴 수 있어요' }) as string}>
            {total
              ? t('editor.find.replaceAllN', { defaultValue: '모두 바꾸기 ({{n}})', n: total })
              : t('editor.find.replaceAll', { defaultValue: '모두 바꾸기' })}
          </TextBtn>
        </Row>
      )}
      {done !== null && done > 0 && (
        <Note data-testid="editor-replace-done" role="status">
          {t('editor.find.replaced', { defaultValue: '{{n}}곳 바꿨어요 · 실행 취소(⌘Z)로 되돌릴 수 있어요', n: done })}
        </Note>
      )}
    </Bar>
  );
};

export default FindReplaceBar;

const Bar = styled.div`
  display: flex; flex-direction: column; gap: 4px;
  padding: 6px 8px; background: #fff; border-bottom: 1px solid #E2E8F0;
`;
const Row = styled.div`display: flex; align-items: center; gap: 4px; min-width: 0;`;
const Field = styled.div`
  position: relative; flex: 1 1 auto; min-width: 0; max-width: 360px;
`;
const Input = styled.input`
  width: 100%; box-sizing: border-box; height: 32px;
  padding: 0 72px 0 10px; border: 1px solid #CBD5E1; border-radius: 6px;
  font-size: 0.8125rem; color: #0F172A; background: #fff;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 2px rgba(20,184,166,0.18); }
  @media (max-width: 640px) { font-size: 1rem; height: 36px; }   /* iOS 확대 방지(16px) */
`;
const Count = styled.span<{ $empty?: boolean }>`
  position: absolute; right: 8px; top: 50%; transform: translateY(-50%);
  font-size: 0.6875rem; font-weight: 600; pointer-events: none;
  color: ${(p) => (p.$empty ? '#DC2626' : '#64748B')};
  font-variant-numeric: tabular-nums;
`;
const IconBtn = styled.button<{ $active?: boolean }>`
  all: unset; cursor: pointer; flex-shrink: 0;
  width: 28px; height: 28px; border-radius: 6px;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 0.75rem; font-weight: 700;
  color: ${(p) => (p.$active ? '#0F766E' : '#475569')};
  background: ${(p) => (p.$active ? '#F0FDFA' : 'transparent')};
  &:hover:not(:disabled) { background: #E2E8F0; color: #0F172A; }
  &:disabled { opacity: 0.4; cursor: default; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 2px; }
  @media (max-width: 640px) { width: 36px; height: 36px; }
`;
const ToggleBtn = styled(IconBtn)<{ $open?: boolean }>`
  svg { transition: transform 0.15s; transform: rotate(${(p) => (p.$open ? '90deg' : '0deg')}); }
`;
const Spacer = styled.div`
  width: 28px; flex-shrink: 0;
  @media (max-width: 640px) { width: 36px; }
`;
const TextBtn = styled.button`
  flex-shrink: 0; height: 32px; padding: 0 10px; border-radius: 6px;
  border: 1px solid #CBD5E1; background: #fff; color: #334155;
  font-size: 0.75rem; font-weight: 600; cursor: pointer; white-space: nowrap;
  &:hover:not(:disabled) { background: #F1F5F9; }
  &:disabled { opacity: 0.4; cursor: default; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 2px; }
  @media (max-width: 640px) { height: 36px; }
`;
const Note = styled.div`
  padding-left: 32px; font-size: 0.6875rem; color: #0F766E;
  @media (max-width: 640px) { padding-left: 40px; }
`;
