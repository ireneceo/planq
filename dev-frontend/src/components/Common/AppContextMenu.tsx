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
// ★ 전역 컴포넌트는 **두 렌더 트리**에 모두 올라가야 한다(memory `feedback_two_render_trees_global_mount`).
//   App 루트 한 곳에 두어 탭 모드·미러 모드 양쪽에서 돈다.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { tabStore } from '../../stores/tabStore';
import { useTabState } from '../../hooks/useTabStore';

type MenuItem = {
  key: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
  /** 위에 구분선 */
  sep?: boolean;
};

type Target =
  | { kind: 'link'; path: string; absolute: string }
  | { kind: 'tab'; tabId: string; path: string; absolute: string }
  /** 화면이 직접 선언한 동작 — `data-pq-context="키,키"` 를 단 요소 위에서 (2026-09-16) */
  | { kind: 'custom'; el: HTMLElement; actions: string[] }
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

const AppContextMenu: React.FC = () => {
  const { t } = useTranslation('common');
  const { tabs, mirror } = useTabState();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [items, setItems] = useState<MenuItem[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);

  const buildItems = useCallback((target: Exclude<Target, null>): MenuItem[] => {
    const out: MenuItem[] = [];
    const canGoBack = window.history.length > 1;

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
      setItems(next);
      // 화면 밖으로 나가면 뒤집는다
      const x = e.clientX + MENU_W > window.innerWidth ? Math.max(8, e.clientX - MENU_W) : e.clientX;
      const h = next.length * 34 + 12;
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
    // 스크롤·리사이즈하면 좌표가 거짓이 된다 — 닫는다
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('blur', close);
    };
  }, [open, close]);

  if (!open) return null;
  return (
    <Menu
      ref={ref}
      role="menu"
      data-testid="app-context-menu"
      style={{ left: pos.x, top: pos.y }}
      onContextMenu={(e) => e.preventDefault()}
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
            {it.label}
          </Item>
        </React.Fragment>
      ))}
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
  display: block;
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
