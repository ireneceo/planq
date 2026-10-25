// 우리 솔루션용 우클릭 메뉴 (2026-09-15)
//
// > Irene: *"모든 메뉴나 링크들 우측버튼 누르면 새탭으로 열기, 그리고 탭에서 오른쪽 버튼 누르면
// >   복사하기도 있고 그래야 하는 거 아니야? 뒤로 가기 등등도 우측 버튼을 마우스 눌렀을 때 나와야
// >   하는 기능들 중 우리 솔루션용으로 커스터마이징 해서 적용 못 시켜? 사소한게 다 불편하네.
// >   같은 탭 열어두고 싶어도 안되고."*
//
// 계약
//  · **우리가 아는 대상 위에서만** 브라우저 메뉴를 가로챈다(링크·탭). 그 외에는 손대지 않는다 —
//    본문 텍스트·입력칸에서 복사/붙여넣기/맞춤법 같은 브라우저 기능을 빼앗으면 그게 더 불편하다.
//  · 글자를 선택한 상태면 항상 브라우저 메뉴다(사용자가 원하는 건 그 선택의 복사다).
//  · 입력칸(input·textarea·contenteditable)도 항상 브라우저 메뉴.
//  · 미러 모드(모바일·단일 탭)에서는 탭 개념이 없으므로 "새 탭" 항목을 내지 않는다.
//
//  · ★ 2026-10-25 — **편집기(TipTap) 안은 예외로 우리 메뉴를 띄운다.**
//    Irene: *"드래그해서 하이퍼링크 넣게 하는 우측 기능들 없는데 우리 솔루션 자체의 우측기능들을 구성해서
//    여기저기 우측 기능 사용하게 못할까?"* — 편집기 위 우클릭 = 링크 넣기·고치기·열기·빼기 + 잘라내기·복사·붙여넣기·모두 선택.
//    편집기는 `.ProseMirror` 요소에 TipTap 이 실어 둔 `dom.editor` 로 찾는다 — 문서·업무 설명·메모 등 TipTap 편집기 전부에 같이 먹는다.
//    브라우저 메뉴(맞춤법 등)는 **Shift+우클릭**으로 그대로 쓸 수 있다(메뉴 아래 안내). 터치 길게 누르기는 손대지 않는다(폰의 선택 손잡이·붙여넣기).
//
// ★ 전역 컴포넌트는 **두 렌더 트리**에 모두 올라가야 한다(memory `feedback_two_render_trees_global_mount`).
//   App 루트 한 곳에 두어 탭 모드·미러 모드 양쪽에서 돈다.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { tabStore } from '../../stores/tabStore';
import { useTabState } from '../../hooks/useTabStore';
import type { Editor } from '@tiptap/core';

type MenuItem = {
  key: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
  /** 위에 구분선 */
  sep?: boolean;
  /** 오른쪽 회색 단축키 안내 */
  hint?: string;
};

/** 편집기 링크 입력 칸 — 우클릭 «링크 넣기» 와 도구줄 🔗 이 같은 칸을 쓴다 */
type LinkForm = { editor: Editor; value: string; hadLink: boolean };

/** 도구줄 🔗 등에서 링크 입력 칸을 연다 — 위치는 지금 커서(선택) 아래 */
export function openEditorLinkForm(editor: Editor) {
  let x = 0; let y = 0;
  try {
    const c = editor.view.coordsAtPos(editor.state.selection.from);
    x = c.left; y = c.bottom + 4;
  } catch { /* 좌표를 못 구하면 화면 왼쪽 위 */ }
  window.dispatchEvent(new CustomEvent('pq:editor-link', { detail: { editor, x, y } }));
}

/** 링크 주소 다듬기 — «www.x.com»·«x.com/a» 처럼 앞이 빠진 주소는 https:// 를 붙인다 */
function normalizeHref(raw: string): string {
  const v = raw.trim();
  if (!v) return '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(v) || v.startsWith('/') || v.startsWith('#')) return v;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return `mailto:${v}`;
  return `https://${v}`;
}

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const keyHint = (k: string) => (IS_MAC ? `⌘${k}` : `Ctrl+${k}`);

type Target =
  | { kind: 'link'; path: string; absolute: string }
  | { kind: 'tab'; tabId: string; path: string; absolute: string }
  /** 화면이 직접 선언한 동작 — `data-pq-context="키,키"` 를 단 요소 위에서 (2026-09-16) */
  | { kind: 'custom'; el: HTMLElement; actions: string[] }
  /** 편집 중인 TipTap 편집기 위 (2026-10-25) */
  | { kind: 'editor'; editor: Editor }
  | null;

const MENU_W = 216;

/** 내부 링크인가 — 외부 링크·mailto·새 창 링크는 브라우저에게 맡긴다. */
function internalPathOf(a: HTMLAnchorElement): string | null {
  const href = a.getAttribute('href') || '';
  if (!href || href.startsWith('#')) return null;
  if (/^(mailto:|tel:|blob:|data:)/i.test(href)) return null;
  try {
    const u = new URL(a.href, window.location.origin);
    if (u.origin !== window.location.origin) return null;
    return u.pathname + u.search;
  } catch { return null; }
}

function resolveTarget(e: MouseEvent): Target {
  const el = e.target as HTMLElement | null;
  if (!el) return null;

  // 편집기 — Shift+우클릭은 브라우저 메뉴, 터치 길게 누르기도 브라우저(폰 선택 손잡이·붙여넣기)
  const pm = el.closest<HTMLElement>('.ProseMirror');
  const pmEditor = pm ? (pm as HTMLElement & { editor?: Editor }).editor : undefined;
  if (pmEditor && pmEditor.isEditable && !pmEditor.isDestroyed) {
    const touch = (e as PointerEvent).pointerType === 'touch'
      || !!(e as MouseEvent & { sourceCapabilities?: { firesTouchEvents?: boolean } }).sourceCapabilities?.firesTouchEvents;
    if (e.shiftKey || touch) return null;
    return { kind: 'editor', editor: pmEditor };
  }

  // 입력 중이거나 글자를 고른 상태 — 브라우저 메뉴가 맞다
  const editable = el.closest('input, textarea, select, [contenteditable="true"]');
  if (editable) return null;
  const sel = window.getSelection();
  if (sel && !sel.isCollapsed && sel.toString().trim()) return null;

  const chip = el.closest<HTMLElement>('[data-ctx-tab-id]');
  if (chip) {
    const tabId = chip.getAttribute('data-ctx-tab-id') || '';
    const path = chip.getAttribute('data-ctx-tab-path') || '';
    return { kind: 'tab', tabId, path, absolute: window.location.origin + path };
  }

  // ★ 2026-09-16 — 화면이 자기 행에 붙인 동작. 메일 목록 행처럼 **행 자체가 <button>** 이라
  //   안에 메뉴 버튼을 넣을 수 없는 자리를 위한 문이다(중첩 button 은 유효하지 않은 HTML).
  //   메뉴 껍데기는 여기 하나뿐이다 — 화면마다 다시 그리면 갈라진다.
  const custom = el.closest<HTMLElement>('[data-pq-context]');
  if (custom) {
    const actions = (custom.getAttribute('data-pq-context') || '').split(',').map((x) => x.trim()).filter(Boolean);
    if (actions.length) return { kind: 'custom', el: custom, actions };
  }

  const a = el.closest<HTMLAnchorElement>('a[href]');
  if (a) {
    if (a.target === '_blank') return null;   // 이미 새 창 링크면 브라우저에게
    const path = internalPathOf(a);
    if (path) return { kind: 'link', path, absolute: window.location.origin + path };
  }
  return null;
}

async function copyText(text: string) {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return; }
  } catch { /* 폴백으로 내려간다 */ }
  // 구형·비보안 컨텍스트 폴백
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); } catch { /* 실패는 조용히 — 알림창을 띄우지 않는다 */ }
  document.body.removeChild(ta);
}

/** 링크 열기 — 우리 주소는 새 탭(탭 모드) · 바깥 주소는 새 창 */
function openHref(href: string, mirror: boolean) {
  try {
    const u = new URL(href, window.location.origin);
    if (u.origin === window.location.origin && !mirror) {
      tabStore.newTab(u.pathname + u.search + u.hash);
      return;
    }
    window.open(u.href, '_blank', 'noopener,noreferrer');
  } catch { /* 깨진 주소 — 열 것이 없다 */ }
}

/** 붙여넣기 — 클립보드를 읽어 편집기의 **붙여넣기 길 그대로**(표·마크다운·이미지 올리기 포함) 넣는다.
 *  읽은 것을 DataTransfer 에 담아 편집기에 paste 이벤트로 보낸다 — 편집기마다 따로 넣는 길을 만들지 않는다. */
async function pasteInto(ed: Editor) {
  ed.view.focus();
  let html = ''; let text = '';
  const files: File[] = [];
  try {
    if (navigator.clipboard.read) {
      for (const it of await navigator.clipboard.read()) {
        for (const type of it.types) {
          const blob = await it.getType(type);
          if (type === 'text/html') html = await blob.text();
          else if (type === 'text/plain') text = await blob.text();
          else if (type.startsWith('image/')) files.push(new File([blob], `image.${type.split('/')[1] || 'png'}`, { type }));
        }
      }
    } else {
      text = await navigator.clipboard.readText();
    }
  } catch {
    try { text = await navigator.clipboard.readText(); } catch { return; /* 브라우저가 막았다 — 메뉴에 단축키 안내가 있다 */ }
  }
  if (!html && !text && !files.length) return;
  try {
    const dt = new DataTransfer();
    if (html) dt.setData('text/html', html);
    if (text) dt.setData('text/plain', text);
    files.forEach((f) => dt.items.add(f));
    const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
    if (ev.clipboardData) { ed.view.dom.dispatchEvent(ev); return; }
  } catch { /* 이 브라우저는 이벤트에 클립보드를 못 싣는다 — 아래 길로 */ }
  if (html) ed.view.pasteHTML(html);
  else if (text) ed.view.pasteText(text);
}

const AppContextMenu: React.FC = () => {
  const { t } = useTranslation('common');
  const { tabs, mirror } = useTabState();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [items, setItems] = useState<MenuItem[]>([]);
  const [linkForm, setLinkForm] = useState<LinkForm | null>(null);
  const [isEditorMenu, setIsEditorMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const linkInputRef = useRef<HTMLInputElement>(null);

  const close = useCallback(() => { setOpen(false); setLinkForm(null); }, []);

  // 링크 입력 칸 — 우클릭 «링크 넣기» · 도구줄 🔗 (openEditorLinkForm)
  useEffect(() => {
    const onLink = (e: Event) => {
      const { editor, x, y } = (e as CustomEvent<{ editor: Editor; x: number; y: number }>).detail || ({} as never);
      if (!editor || editor.isDestroyed) return;
      const href: string = editor.getAttributes('link').href || '';
      setLinkForm({ editor, value: href, hadLink: !!href });
      const w = 320;
      // 폰은 키보드가 화면을 줄이므로 보이는 영역(visualViewport) 기준으로 가둔다
      const vh = window.visualViewport?.height ?? window.innerHeight;
      setPos({
        x: Math.max(8, Math.min(x, window.innerWidth - w - 8)),
        y: Math.max(8, Math.min(y, vh - 110)),
      });
      setOpen(true);
    };
    window.addEventListener('pq:editor-link', onLink);
    return () => window.removeEventListener('pq:editor-link', onLink);
  }, []);
  useEffect(() => { if (linkForm) setTimeout(() => linkInputRef.current?.focus(), 0); }, [linkForm]);

  const applyLink = useCallback(() => {
    if (!linkForm) return;
    const ed = linkForm.editor;
    const href = normalizeHref(linkForm.value);
    close();
    if (ed.isDestroyed) return;
    if (!href) {
      if (linkForm.hadLink) ed.chain().focus().extendMarkRange('link').unsetLink().run();
      else ed.commands.focus();
      return;
    }
    if (ed.state.selection.empty && !linkForm.hadLink) {
      // 고른 글자가 없으면 주소 자체를 링크 글로 넣는다
      ed.chain().focus().insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] }).run();
      return;
    }
    ed.chain().focus().extendMarkRange('link').setLink({ href }).run();
  }, [linkForm, close]);

  const buildItems = useCallback((target: Exclude<Target, null>): MenuItem[] => {
    const out: MenuItem[] = [];
    const canGoBack = window.history.length > 1;

    if (target.kind === 'editor') {
      const ed = target.editor;
      const empty = ed.state.selection.empty;
      const href: string | undefined = ed.getAttributes('link').href;
      // 링크
      out.push({
        key: 'ed-link',
        label: href
          ? t('ctx.editLink', { defaultValue: '링크 고치기…' }) as string
          : t('ctx.addLink', { defaultValue: '링크 넣기…' }) as string,
        onSelect: () => openEditorLinkForm(ed),
      });
      if (href) {
        out.push({ key: 'ed-link-open', label: t('ctx.openLink', { defaultValue: '링크 열기' }) as string, onSelect: () => openHref(href, mirror) });
        out.push({ key: 'ed-link-copy', label: t('ctx.copyLink', { defaultValue: '링크 복사' }) as string, onSelect: () => copyText(href) });
        out.push({
          key: 'ed-link-remove',
          label: t('ctx.removeLink', { defaultValue: '링크 빼기' }) as string,
          onSelect: () => { ed.chain().focus().extendMarkRange('link').unsetLink().run(); },
        });
      }
      // 클립보드 — execCommand 는 편집기에 포커스·선택이 그대로일 때 ProseMirror 의 복사·잘라내기 길을 탄다
      out.push({
        key: 'ed-cut', sep: true, hint: keyHint('X'), disabled: empty,
        label: t('ctx.cut', { defaultValue: '잘라내기' }) as string,
        onSelect: () => { ed.view.focus(); document.execCommand('cut'); },
      });
      out.push({
        key: 'ed-copy', hint: keyHint('C'), disabled: empty,
        label: t('ctx.copy', { defaultValue: '복사' }) as string,
        onSelect: () => { ed.view.focus(); document.execCommand('copy'); },
      });
      const canRead = !!(navigator.clipboard && (navigator.clipboard.read || navigator.clipboard.readText));
      out.push({
        key: 'ed-paste', hint: keyHint('V'), disabled: !canRead,
        label: t('ctx.paste', { defaultValue: '붙여넣기' }) as string,
        onSelect: () => { void pasteInto(ed); },
      });
      out.push({
        key: 'ed-select-all', hint: keyHint('A'),
        label: t('ctx.selectAll', { defaultValue: '모두 선택' }) as string,
        onSelect: () => { ed.chain().focus().selectAll().run(); },
      });
      return out;
    }

    if (target.kind === 'link') {
      if (!mirror) {
        out.push({
          key: 'open-new',
          label: t('ctx.openInNewTab', { defaultValue: '새 탭에서 열기' }) as string,
          // ★ newTab 은 **중복을 허용**한다(openInNewTab 은 같은 종류 탭이 있으면 그리로 간다).
          //   Irene: "같은 탭 열어두고 싶어도 안되고." — 여기가 그 길이다.
          onSelect: () => tabStore.newTab(target.path),
        });
      }
      out.push({
        key: 'copy-link',
        label: t('ctx.copyLink', { defaultValue: '링크 복사' }) as string,
        onSelect: () => copyText(target.absolute),
      });
    }

    if (target.kind === 'custom') {
      for (const key of target.actions) {
        out.push({
          key: `custom-${key}`,
          // 라벨은 화면이 요소에 실어 보낸다(`data-pq-context-label-<키>`) — 없으면 공통 사전에서 찾는다.
          label: target.el.getAttribute(`data-pq-context-label-${key}`)
            || (t(`ctx.${key}`, { defaultValue: key }) as string),
          // ★ 이벤트는 **그 요소에서** 띄운다(document 가 아니라). 같은 화면이 두 탭에 떠 있어도
          //   자기 트리로만 올라가므로 엉뚱한 탭이 처리하지 않는다.
          onSelect: () => target.el.dispatchEvent(
            new CustomEvent('pq:context-action', { bubbles: true, detail: { action: key } }),
          ),
        });
      }
    }

    if (target.kind === 'tab') {
      if (!mirror) {
        out.push({
          key: 'dup',
          label: t('ctx.duplicateTab', { defaultValue: '이 탭 복제' }) as string,
          onSelect: () => tabStore.newTab(target.path),
        });
      }
      out.push({
        key: 'copy-link',
        label: t('ctx.copyLink', { defaultValue: '링크 복사' }) as string,
        onSelect: () => copyText(target.absolute),
      });
      if (!mirror && tabs.length > 1) {
        out.push({
          key: 'close',
          sep: true,
          label: t('ctx.closeTab', { defaultValue: '탭 닫기' }) as string,
          onSelect: () => tabStore.closeTab(target.tabId),
        });
        out.push({
          key: 'close-others',
          label: t('ctx.closeOthers', { defaultValue: '다른 탭 모두 닫기' }) as string,
          onSelect: () => {
            tabs.filter((x) => x.id !== target.tabId).forEach((x) => tabStore.closeTab(x.id));
          },
        });
      }
    }

    out.push({
      key: 'back',
      sep: true,
      label: t('ctx.back', { defaultValue: '뒤로 가기' }) as string,
      disabled: !canGoBack,
      onSelect: () => window.history.back(),
    });
    out.push({
      key: 'forward',
      label: t('ctx.forward', { defaultValue: '앞으로 가기' }) as string,
      onSelect: () => window.history.forward(),
    });
    return out;
  }, [mirror, t, tabs]);

  useEffect(() => {
    const onCtx = (e: MouseEvent) => {
      const target = resolveTarget(e);
      if (!target) { setOpen(false); return; }   // 우리가 모르는 자리 — 브라우저 메뉴 그대로
      const next = buildItems(target);
      if (!next.length) { setOpen(false); return; }
      e.preventDefault();
      setLinkForm(null);
      setIsEditorMenu(target.kind === 'editor');
      setItems(next);
      // 화면 밖으로 나가면 뒤집는다
      const x = e.clientX + MENU_W > window.innerWidth ? Math.max(8, e.clientX - MENU_W) : e.clientX;
      const h = next.length * 34 + 12 + (target.kind === 'editor' ? 40 : 0);
      const y = e.clientY + h > window.innerHeight ? Math.max(8, e.clientY - h) : e.clientY;
      setPos({ x, y });
      setOpen(true);
    };
    document.addEventListener('contextmenu', onCtx);
    return () => document.removeEventListener('contextmenu', onCtx);
  }, [buildItems]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) close(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    // 스크롤·리사이즈하면 좌표가 거짓이 된다 — 닫는다.
    // 링크 입력 칸은 예외 — 폰에서 칸을 누르면 키보드가 올라오며 resize 가 와서 쓰기도 전에 닫혔다.
    const formOpen = !!linkForm;
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey);
    if (!formOpen) {
      window.addEventListener('scroll', close, true);
      window.addEventListener('resize', close);
      window.addEventListener('blur', close);
    }
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('blur', close);
    };
  }, [open, close, linkForm]);

  if (!open) return null;
  if (linkForm) {
    return (
      <LinkBox
        ref={ref}
        role="dialog"
        aria-label={t('ctx.linkTitle', { defaultValue: '링크' }) as string}
        data-testid="app-ctx-link-form"
        style={{ left: pos.x, top: pos.y }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <LinkInput
          ref={linkInputRef}
          type="url"
          inputMode="url"
          data-testid="app-ctx-link-input"
          value={linkForm.value}
          placeholder={t('ctx.linkPlaceholder', { defaultValue: 'https://… 주소를 넣으세요' }) as string}
          onChange={(e) => setLinkForm({ ...linkForm, value: e.target.value })}
          onKeyDown={(e) => {
            // stopPropagation — 편집기가 모달 안이면 Esc 가 모달까지 닫는다(useEscapeStack 은 document 에서 듣는다)
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); e.stopPropagation(); applyLink(); }
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); const ed = linkForm.editor; close(); if (!ed.isDestroyed) ed.commands.focus(); }
          }}
        />
        <LinkActions>
          {linkForm.hadLink && (
            <LinkBtn
              type="button"
              data-testid="app-ctx-link-remove"
              onClick={() => { const ed = linkForm.editor; close(); if (!ed.isDestroyed) ed.chain().focus().extendMarkRange('link').unsetLink().run(); }}
            >
              {t('ctx.removeLink', { defaultValue: '링크 빼기' })}
            </LinkBtn>
          )}
          <LinkBtn type="button" onClick={() => { const ed = linkForm.editor; close(); if (!ed.isDestroyed) ed.commands.focus(); }}>
            {t('ctx.cancel', { defaultValue: '취소' })}
          </LinkBtn>
          <LinkBtn type="button" $primary data-testid="app-ctx-link-apply" onClick={applyLink}>
            {t('ctx.apply', { defaultValue: '적용' })}
          </LinkBtn>
        </LinkActions>
      </LinkBox>
    );
  }
  return (
    <Menu
      ref={ref}
      role="menu"
      data-testid="app-context-menu"
      style={{ left: pos.x, top: pos.y }}
      onContextMenu={(e) => e.preventDefault()}
      // 편집기 메뉴는 누르는 동안 편집기 포커스·선택을 뺏지 않는다(잘라내기·복사가 그 선택에 걸린다)
      onMouseDown={(e) => { if (isEditorMenu) e.preventDefault(); }}
    >
      {items.map((it) => (
        <React.Fragment key={it.key}>
          {it.sep && <Sep />}
          <Item
            type="button"
            role="menuitem"
            disabled={it.disabled}
            $danger={it.danger}
            data-testid={`app-ctx-${it.key}`}
            onClick={() => { close(); it.onSelect(); }}
          >
            <span>{it.label}</span>
            {it.hint && <Hint>{it.hint}</Hint>}
          </Item>
        </React.Fragment>
      ))}
      {isEditorMenu && (
        <Foot>{t('ctx.browserMenuHint', { defaultValue: '브라우저 메뉴: Shift + 우클릭' })}</Foot>
      )}
    </Menu>
  );
};

export default AppContextMenu;

const Menu = styled.div`
  position: fixed;
  z-index: 10000;
  min-width: ${MENU_W}px;
  padding: 6px;
  background: #FFFFFF;
  border: 1px solid #E2E8F0;
  border-radius: 10px;
  box-shadow: 0 12px 28px rgba(15, 23, 42, 0.16);
`;

const Item = styled.button<{ $danger?: boolean }>`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  width: 100%;
  height: 32px;
  padding: 0 10px;
  border: none;
  background: transparent;
  text-align: left;
  font-family: inherit;
  font-size: 0.8125rem;
  color: ${(p) => (p.$danger ? '#B91C1C' : '#0F172A')};
  border-radius: 6px;
  cursor: pointer;
  white-space: nowrap;
  &:hover:not(:disabled) { background: #F1F5F9; }
  &:disabled { color: #94A3B8; cursor: default; }
`;

const Sep = styled.div`
  height: 1px;
  margin: 4px 2px;
  background: #E2E8F0;
`;

const Hint = styled.span`
  color: #94A3B8;
  font-size: 0.75rem;
`;

const Foot = styled.div`
  margin-top: 4px;
  padding: 6px 10px 2px;
  border-top: 1px solid #E2E8F0;
  color: #94A3B8;
  font-size: 0.6875rem;
  white-space: nowrap;
`;

const LinkBox = styled.div`
  position: fixed;
  z-index: 10000;
  width: min(320px, calc(100vw - 16px));
  padding: 10px;
  background: #FFFFFF;
  border: 1px solid #E2E8F0;
  border-radius: 10px;
  box-shadow: 0 12px 28px rgba(15, 23, 42, 0.16);
  box-sizing: border-box;
`;

const LinkInput = styled.input`
  width: 100%;
  height: 36px;
  padding: 0 10px;
  border: 1px solid #CBD5E1;
  border-radius: 8px;
  font-family: inherit;
  font-size: 0.8125rem;
  color: #0F172A;
  box-sizing: border-box;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20, 184, 166, 0.15); }
`;

const LinkActions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 8px;
`;

const LinkBtn = styled.button<{ $primary?: boolean }>`
  height: 32px;
  padding: 0 12px;
  border-radius: 8px;
  font-family: inherit;
  font-size: 0.8125rem;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid ${(p) => (p.$primary ? '#14B8A6' : '#E2E8F0')};
  background: ${(p) => (p.$primary ? '#14B8A6' : '#FFFFFF')};
  color: ${(p) => (p.$primary ? '#FFFFFF' : '#334155')};
  &:hover { background: ${(p) => (p.$primary ? '#0D9488' : '#F8FAFC')}; }
`;
