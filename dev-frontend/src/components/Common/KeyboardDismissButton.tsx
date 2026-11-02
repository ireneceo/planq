// 키보드 내리기 버튼 — 앱(아이폰·아이패드·안드로이드) 화면 키보드가 떠 있을 때만 보인다 (2026-11-02).
// Irene: "모바일이랑 태블릿앱에서 키보드 내리는 버튼이 키보드에 안나오는데 이거 중요해"
//
// 왜 웹 쪽 버튼인가:
//  · 아이폰 앱은 키보드 위 ▲ ▼ ✓ 줄(폼 액세서리 바)을 2026-09-11 Irene 지시로 걷었다(AppDelegate.swift) —
//    «채팅 내용을 더 못 보게 한다». 그 줄의 ✓ 가 아이폰 키보드를 내리는 유일한 단추였다(아이폰 키보드에는 내리기 키가 없다).
//    그 줄을 되살리면 가림이 돌아오므로, 한 줄 전체 대신 **작은 단추 하나**만 둔다.
//  · 안드로이드는 기기·키보드·내비게이션 설정(제스처)에 따라 내리기 단추가 없다.
//  · 앱은 웹 주소를 그대로 띄우므로(capacitor.config server.url) 이 단추는 스토어 새 빌드 없이 바로 들어간다.
//
// 판정: 앱 안 ∧ body[data-keyboard-up](main.tsx 키보드 판정 단일 원천 — 하드웨어 키보드는 안 켜진다)
//       ∧ 포커스가 글자를 치는 칸(input·textarea·contenteditable).
// 자리: 칸이 짧고 다 보이면 그 칸 바로 위 오른쪽(채팅 입력줄의 보내기 단추를 덮지 않게) ·
//       긴 편집기면 보이는 화면 오른쪽 아래(키보드 바로 위).
// 누르면 포커스를 놓는다(blur) → OS 가 키보드를 내린다. pointerdown 기본 동작을 막아 누르는 순간 포커스가 옮겨 가지 않게 한다.
import { useCallback, useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';

const NON_TEXT_INPUT = new Set(['button', 'checkbox', 'radio', 'range', 'color', 'file', 'submit', 'reset', 'image', 'hidden']);

function editableTarget(): HTMLElement | null {
  const ae = document.activeElement as HTMLElement | null;
  if (!ae || ae === document.body) return null;
  if (ae instanceof HTMLInputElement) {
    if (NON_TEXT_INPUT.has(ae.type) || ae.readOnly || ae.disabled) return null;
    return ae;
  }
  if (ae instanceof HTMLTextAreaElement) return ae.readOnly || ae.disabled ? null : ae;
  if (ae.isContentEditable) return ae;
  return null;
}

const SIZE = 36;
const GAP = 6;

interface Pos { top: number }

export default function KeyboardDismissButton() {
  const { t } = useTranslation('common');
  const [pos, setPos] = useState<Pos | null>(null);
  const raf = useRef(0);

  const measure = useCallback(() => {
    raf.current = 0;
    const el = editableTarget();
    const up = document.body.getAttribute('data-keyboard-up') === '1';
    const vv = window.visualViewport;
    if (!el || !up || !vv) { setPos(null); return; }
    // position:fixed 는 layout viewport 기준이다 — 보이는 칸 = [offsetTop, offsetTop + height].
    const visTop = vv.offsetTop;
    const visBottom = vv.offsetTop + vv.height;
    // 칸을 감싼 테두리 상자(채팅 입력줄의 둥근 틀 등)까지 올라가 그 위에 선다 — 칸 자신의 위에 서면 틀을 덮는다.
    //   조금 큰 조상(높이 +60 이내)만 따라간다(4단계까지).
    const own = el.getBoundingClientRect();
    let r = own;
    let p = el.parentElement;
    for (let i = 0; i < 4 && p; i++, p = p.parentElement) {
      const pr = p.getBoundingClientRect();
      if (pr.height > own.height + 60 || pr.top > r.top) break;
      r = pr;
    }
    let top = visBottom - SIZE - 8;
    const shortAndVisible = r.height < vv.height * 0.4 && r.top - SIZE - GAP >= visTop + 8 && r.bottom <= visBottom + 2;
    if (shortAndVisible) top = r.top - SIZE - GAP;
    top = Math.round(Math.max(visTop + 8, top));
    setPos((p) => (p && p.top === top ? p : { top }));
  }, []);

  const schedule = useCallback(() => {
    if (raf.current) return;
    raf.current = requestAnimationFrame(measure);
  }, [measure]);

  useEffect(() => {
    const vv = window.visualViewport;
    const onFocusChange = () => { window.setTimeout(schedule, 0); };
    document.addEventListener('focusin', onFocusChange, true);
    document.addEventListener('focusout', onFocusChange, true);
    // 입력하면서 칸이 자라면(여러 줄 채팅) 자리를 다시 본다
    document.addEventListener('input', schedule, true);
    vv?.addEventListener('resize', schedule);
    vv?.addEventListener('scroll', schedule);
    const mo = new MutationObserver(schedule);
    mo.observe(document.body, { attributes: true, attributeFilter: ['data-keyboard-up'] });
    schedule();
    return () => {
      document.removeEventListener('focusin', onFocusChange, true);
      document.removeEventListener('focusout', onFocusChange, true);
      document.removeEventListener('input', schedule, true);
      vv?.removeEventListener('resize', schedule);
      vv?.removeEventListener('scroll', schedule);
      mo.disconnect();
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [schedule]);

  if (!pos) return null;
  return (
    <Btn
      type="button"
      data-pq-keyboard-dismiss=""
      aria-label={t('keyboard.hide', '키보드 내리기')}
      title={t('keyboard.hide', '키보드 내리기')}
      style={{ top: pos.top }}
      onPointerDown={(e) => e.preventDefault()}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        const el = editableTarget();
        el?.blur();
        setPos(null);
      }}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="3" width="18" height="11" rx="2" />
        <path d="M7 7h.01M11 7h.01M15 7h.01M7 10.5h10" />
        <path d="M8 18l4 3 4-3" />
      </svg>
    </Btn>
  );
}

const Btn = styled.button`
  position: fixed;
  right: calc(8px + env(safe-area-inset-right, 0px));
  width: ${SIZE}px;
  height: ${SIZE}px;
  z-index: 2147483000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border-radius: 50%;
  border: 1px solid #CBD5E1;
  background: rgba(255, 255, 255, 0.96);
  color: #334155;
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.18);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
  &:active { background: #F1F5F9; }
`;
