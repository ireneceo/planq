// 편집 중 목차 — 툴바의 «목차» 버튼 → 떠 있는 제목 목록 (2026-10-29)
//
// Irene: «편집할 때는 목차가 안나와서 위치 찾아가기가 좀 어려워. 장문의 출판물 같은 것을 만들 때 부족한 면이 있으면 찾아서 보완»
//
// ★ 보기 화면 목차(DocToc)를 그대로 옮기지 않은 이유 두 가지
//   ① DocToc 은 저장된 TipTap JSON 을 읽는다. 편집 중 값은 AI 직후 HTML 문자열일 수 있어 목차가 0개로 사라진다
//      → **편집기 상태(editor.state.doc)가 정본**이다. 형식과 상관없이 지금 화면에 있는 제목을 뽑는다.
//   ② 툴바가 sticky 라 scrollIntoView({block:'start'}) 로 가면 제목이 툴바 뒤에 숨는다
//      → 스크롤 상자를 찾아 **툴바 아래 끝 + 여백** 에 제목을 세운다.
//   그리고 «위치 찾아가기» = 거기서 바로 쓰기 — 커서도 그 제목 끝으로 옮긴다.
// ★ 툴바에 두는 이유: 툴바는 스크롤해도 늘 붙어 있어 긴 문서 어디서든 목차를 연다(문서 맨 위 상자는 스크롤하면 사라진다).
// ★ 목록은 body 로 띄운다(placeFloating) — 툴바는 가로 스크롤(overflow)이라 안에 붙이면 잘린다.
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import type { Editor } from '@tiptap/react';
import { useEscapeStack } from '../../hooks/useEscapeStack';
import { placeFloating, anchorStyle, type AnchorPos } from '../Common/popoverAnchor';

interface OutlineItem { level: number; text: string; pos: number }

/** 최상위 제목만 — 보기 목차(extractHeadings)와 같은 정의(표·인용 안의 제목은 대상이 아니다) */
export function editorHeadings(editor: Editor): OutlineItem[] {
  const out: OutlineItem[] = [];
  editor.state.doc.forEach((node, offset) => {
    if (node.type.name !== 'heading') return;
    const text = node.textContent.trim();
    if (!text) return;
    out.push({ level: Number(node.attrs.level) || 1, text, pos: offset });
  });
  return out;
}

/** 공백 뺀 글자 수 + 읽는 시간(한국어 분당 약 500자 — 대략치라 «약» 을 붙인다) */
function textStats(editor: Editor): { chars: number; minutes: number } {
  const chars = editor.state.doc.textContent.replace(/\s/g, '').length;
  return { chars, minutes: Math.max(1, Math.round(chars / 500)) };
}

function scrollParentOf(el: HTMLElement): HTMLElement | null {
  let p = el.parentElement;
  while (p) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight) return p;
    p = p.parentElement;
  }
  return null;   // 문서(창)가 스크롤한다
}

interface Props { editor: Editor; buttonAs: React.ElementType }

const EditorOutlineButton: React.FC<Props> = ({ editor, buttonAs: Btn }) => {
  const { t } = useTranslation('qdocs');
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<OutlineItem[]>([]);
  const [current, setCurrent] = useState<number | null>(null);
  const [stats, setStats] = useState({ chars: 0, minutes: 1 });
  const [pos, setPos] = useState<AnchorPos | null>(null);
  const trigRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const headEl = () => trigRef.current?.closest('[data-pq-editor-head]') as HTMLElement | null;

  // 지금 읽는 장 = 툴바 아래 끝을 이미 지난 마지막 제목
  const refresh = useCallback(() => {
    const list = editorHeadings(editor);
    setItems(list);
    setStats(textStats(editor));
    const line = (headEl()?.getBoundingClientRect().bottom ?? 0) + 24;
    let cur: number | null = null;
    for (const h of list) {
      const dom = editor.view.nodeDOM(h.pos) as HTMLElement | null;
      if (dom && dom.getBoundingClientRect().top <= line) cur = h.pos;
    }
    setCurrent(cur);
  }, [editor]);

  const place = () => {
    const r = trigRef.current?.getBoundingClientRect();
    if (!r) return;
    const el = popRef.current;
    setPos(placeFloating(r, { width: el?.offsetWidth || 300, height: el?.scrollHeight || 320 }, { gap: 6 }));
  };
  useLayoutEffect(() => { if (open) { refresh(); place(); } }, [open]);   // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => { if (open) place(); }, [items.length]);   // eslint-disable-line react-hooks/exhaustive-deps
  // 열린 채 제목을 고치면 목록도 바로 바뀐다
  useEffect(() => {
    if (!open) return;
    editor.on('update', refresh);
    return () => { editor.off('update', refresh); };
  }, [open, editor, refresh]);
  useEffect(() => {
    if (!open) return;
    const onMove = () => place();
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => { window.removeEventListener('resize', onMove); window.removeEventListener('scroll', onMove, true); };
  }, [open]);
  useEscapeStack(open, () => setOpen(false));
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const tg = e.target as Node;
      if (!trigRef.current?.contains(tg) && !popRef.current?.contains(tg)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const go = (h: OutlineItem) => {
    const dom = editor.view.nodeDOM(h.pos) as HTMLElement | null;
    // 커서를 그 제목 끝으로 — 편집기 자체 스크롤은 끄고(툴바 뒤로 숨는다) 아래에서 직접 세운다
    editor.chain().setTextSelection(h.pos + 1 + editor.state.doc.nodeAt(h.pos)!.content.size)
      .focus(undefined, { scrollIntoView: false }).run();
    setOpen(false);
    if (!dom) return;
    // 즉시 옮기고 다음 프레임에 한 번 더 맞춘다 — 바깥 상자가 스크롤하는 폭(태블릿)에서는 옮기는 순간
    //   위 밴드가 붙으며 툴바 자리가 바뀌어, 한 번 잰 값으로 부드럽게 굴리면 제목이 툴바 뒤로 32px 들어갔다(실측)
    const align = () => {
      const offset = (headEl()?.getBoundingClientRect().bottom ?? 0) + 12;
      const delta = dom.getBoundingClientRect().top - offset;
      if (Math.abs(delta) < 2) return;
      const box = scrollParentOf(dom);
      if (box) box.scrollBy({ top: delta });
      else window.scrollBy({ top: delta });
    };
    align();
    requestAnimationFrame(() => { align(); requestAnimationFrame(align); });
  };

  return (
    <>
      <Btn
        ref={trigRef} type="button" data-testid="editor-outline" $active={open}
        onMouseDown={(e: React.MouseEvent) => e.preventDefault()}
        onClick={() => setOpen((v) => !v)}
        title={t('editor.outline.open', { defaultValue: '목차 — 제목으로 바로 가기' }) as string}
        aria-label={t('editor.outline.aria', { defaultValue: '목차' }) as string}
        aria-expanded={open}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M4 6h16" /><path d="M8 12h12" /><path d="M8 18h12" /><circle cx="4" cy="12" r="0.6" /><circle cx="4" cy="18" r="0.6" />
        </svg>
        <BtnLabel>{t('editor.outline.label', { defaultValue: '목차' }) as string}</BtnLabel>
      </Btn>
      {open && createPortal(
        <Pop ref={popRef} role="dialog" aria-label={t('editor.outline.aria', { defaultValue: '목차' }) as string}
          data-testid="editor-outline-pop" style={anchorStyle(pos)}>
          <PopHead>
            {t('editor.outline.title', { defaultValue: '목차' }) as string}
            <Count>{items.length}</Count>
          </PopHead>
          {items.length === 0 ? (
            <Empty>{t('editor.outline.empty', { defaultValue: '제목(H1·H2·H3)을 넣으면 여기에 목차가 생깁니다.' }) as string}</Empty>
          ) : (
            <List>
              {items.map((h) => (
                <Row key={h.pos} type="button" $level={h.level} $current={current === h.pos}
                  onMouseDown={(e) => e.preventDefault()} onClick={() => go(h)} title={h.text}>
                  {h.text}
                </Row>
              ))}
            </List>
          )}
          <Foot data-testid="editor-outline-stats">
            {t('editor.outline.stats', { defaultValue: '글자 {{chars}}자 (공백 제외) · 읽는 데 약 {{minutes}}분', chars: stats.chars.toLocaleString(), minutes: stats.minutes }) as string}
          </Foot>
        </Pop>,
        document.body,
      )}
    </>
  );
};

export default EditorOutlineButton;

const BtnLabel = styled.span`
  margin-left: 4px; font-size: 0.75rem;
  @media (max-width: 640px) { display: none; }
`;
const Pop = styled.div`
  position: fixed; z-index: 10000;  /* 글자 서식 팝오버(TextStyleButton)와 같은 층 */
  width: min(320px, calc(100vw - 32px));
  display: flex; flex-direction: column;
  background: #fff; border: 1px solid #E2E8F0; border-radius: 10px;
  box-shadow: 0 10px 28px rgba(15,23,42,0.14);
  overflow: hidden;
`;
const PopHead = styled.div`
  display: flex; align-items: center; gap: 6px;
  padding: 10px 12px 6px; font-size: 0.75rem; font-weight: 700; color: #475569;
`;
const Count = styled.span`
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 1rem; height: 1rem; padding: 0 4px;
  background: #E2E8F0; color: #64748B; border-radius: 8px; font-size: 0.625rem; font-weight: 700;
`;
const List = styled.div`
  display: flex; flex-direction: column; padding: 0 6px 6px;
  overflow-y: auto; min-height: 0; flex: 1;
`;
const Row = styled.button<{ $level: number; $current: boolean }>`
  display: block; width: 100%; text-align: left; flex-shrink: 0;
  padding: 5px 8px 5px ${(p) => 8 + (p.$level - 1) * 14}px;
  background: ${(p) => (p.$current ? '#F0FDFA' : 'transparent')};
  border: none; border-radius: 6px; cursor: pointer;
  font-size: ${(p) => (p.$level === 1 ? 13 : 12) / 16}rem;
  font-weight: ${(p) => (p.$level === 1 ? 600 : 500)};
  color: ${(p) => (p.$current ? '#0F766E' : p.$level === 1 ? '#334155' : '#64748B')};
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  &:hover { background: #E2E8F0; color: #0F172A; }
  @media (max-width: 640px) { padding-top: 9px; padding-bottom: 9px; }
`;
const Empty = styled.p`
  margin: 0; padding: 4px 12px 10px; font-size: 0.75rem; color: #94A3B8;
`;
const Foot = styled.div`
  flex-shrink: 0; padding: 8px 12px;
  border-top: 1px solid #F1F5F9; background: #F8FAFC;
  font-size: 0.6875rem; color: #64748B;
`;
