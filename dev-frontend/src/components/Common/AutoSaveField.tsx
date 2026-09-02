import React, { useState, useRef, useEffect, useCallback, useImperativeHandle, forwardRef } from 'react';
import styled, { keyframes, css } from 'styled-components';

type FieldType = 'input' | 'select' | 'toggle' | 'image' | 'list';
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface AutoSaveHandle {
  triggerSave: () => void;
}

interface AutoSaveFieldProps {
  children: React.ReactNode;
  onSave: () => Promise<void>;
  type?: FieldType;
  debounceMs?: number;
  style?: React.CSSProperties;
}

const fadeIn = keyframes`from { opacity: 0; transform: scale(0.85); } to { opacity: 1; transform: scale(1); }`;
const fadeOut = keyframes`from { opacity: 1; } to { opacity: 0; }`;
const spin = keyframes`to { transform: rotate(360deg); }`;

const Wrapper = styled.div<{ $type?: string }>`
  position: relative;
  ${props => (props.$type === 'input' || props.$type === 'select' || props.$type === 'image') ? 'width: 100%;' : ''}
`;

const badgeBase = css<{ $fading: boolean }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  animation: ${props => props.$fading ? css`${fadeOut} 0.3s ease forwards` : css`${fadeIn} 0.2s ease`};
  pointer-events: none;
  z-index: 2;
`;

const InputBadge = styled.div<{ $fading: boolean }>`${badgeBase} position: absolute; right: 8px; top: 50%; transform: translateY(-50%);`;
const SelectBadge = styled.div<{ $fading: boolean }>`${badgeBase} position: absolute; right: -6px; top: -6px;`;
const ToggleBadge = styled.div<{ $fading: boolean }>`${badgeBase} position: absolute; right: 1px; top: 50%; transform: translateY(-50%);`;
const ImageBadge = styled.div<{ $fading: boolean }>`${badgeBase} position: absolute; right: 12px; bottom: 12px;`;
const ListBadge = styled.div<{ $fading: boolean }>`${badgeBase} position: absolute; right: -8px; top: -8px;`;

const SavedPill = styled.span`
  display: inline-flex; align-items: center; justify-content: center;
  background: #D1FAE5; color: #065F46; border-radius: 50%;
  width: 22px; height: 22px; font-size: 0.8125rem; font-weight: 700;
`;

const Spinner = styled.span`
  display: inline-block; width: 16px; height: 16px;
  border: 2px solid #E6EBF1; border-top-color: #8898AA;
  border-radius: 50%; animation: ${spin} 0.6s linear infinite;
`;

const ErrorPill = styled.span`
  display: inline-flex; align-items: center; justify-content: center;
  background: #EF4444; color: white; border-radius: 50%;
  width: 20px; height: 20px; font-size: 0.75rem; font-weight: 700;
`;

const AutoSaveField = forwardRef<AutoSaveHandle, AutoSaveFieldProps>(({
  children, onSave, type = 'input', debounceMs = 2000, style,
}, ref) => {
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [fading, setFading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const saveRef = useRef(onSave);
  saveRef.current = onSave;

  const clearTimers = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (fadeRef.current) clearTimeout(fadeRef.current);
    if (resetRef.current) clearTimeout(resetRef.current);
  }, []);

  const effectiveDebounce = debounceMs !== 2000 ? debounceMs
    : (type === 'toggle' || type === 'select' || type === 'list' || type === 'image') ? 300 : debounceMs;

  const triggerSave = useCallback(() => {
    clearTimers();
    setFading(false);
    debounceRef.current = setTimeout(async () => {
      if (!mountedRef.current) return;
      setStatus('saving');
      try {
        await saveRef.current();
        if (!mountedRef.current) return;
        setStatus('saved');
        fadeRef.current = setTimeout(() => {
          if (!mountedRef.current) return;
          setFading(true);
          resetRef.current = setTimeout(() => { if (mountedRef.current) { setStatus('idle'); setFading(false); } }, 300);
        }, 2000);
      } catch {
        if (!mountedRef.current) return;
        setStatus('error');
        fadeRef.current = setTimeout(() => {
          if (!mountedRef.current) return;
          setFading(true);
          resetRef.current = setTimeout(() => { if (mountedRef.current) { setStatus('idle'); setFading(false); } }, 300);
        }, 4000);
      }
    }, effectiveDebounce);
  }, [effectiveDebounce, clearTimers]);

  useImperativeHandle(ref, () => ({ triggerSave }), [triggerSave]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; clearTimers(); };
  }, [clearTimers]);

  const enhancedChildren = React.Children.map(children, child => {
    if (!React.isValidElement(child)) return child;
    const orig = (child.props as any).onChange;
    if (typeof orig !== 'function') return child;
    return React.cloneElement(child as React.ReactElement<any>, {
      onChange: (...args: any[]) => { orig(...args); triggerSave(); },
    });
  });

  const icon = status === 'saving' ? <Spinner />
    : status === 'saved' ? <SavedPill>&#x2713;</SavedPill>
    : status === 'error' ? <ErrorPill>!</ErrorPill>
    : null;

  const Badge = type === 'select' ? SelectBadge
    : type === 'toggle' ? ToggleBadge
    : type === 'image' ? ImageBadge
    : type === 'list' ? ListBadge
    : InputBadge;

  return (
    // ★ toggle 은 Wrapper 에서 click 을 받는다 (자식 복제 아님).
    //   토글의 실제 마크업은 `<button onClick>` 이거나 안쪽에 input 을 감싼 `<label>` 이라
    //   **자식에 onChange 가 없다** — 위 enhancedChildren 은 아무것도 감싸지 못하고 그대로 통과했다.
    //   그래서 클릭하면 화면 문구만 바뀌고 서버로는 아무것도 안 갔다. 운영 점검 모드를 포함해
    //   5곳이 그 상태였다(2026-09-02, Fable 실브라우저 실증 — PUT 0건).
    //   click 은 React 트리를 버블링하므로 button·checkbox·안쪽 버튼 무엇이든 여기 닿는다.
    //   키보드도 같다(button 의 Space/Enter, checkbox 의 Space 는 click 을 낸다).
    //   자식 onClick(=set())이 먼저 끝나고 버블링되므로, debounce 가 터질 때 값은 **새 값**이다.
    //   계약: **toggle 래퍼 안에는 저장 대상 컨트롤만 둔다.** 저장과 무관한 클릭 요소가 필요하면
    //   래퍼 밖에 둔다. (헛저장이 나도 같은 값을 다시 보내는 멱등 PUT 이라 데이터는 안 깨진다)
    <Wrapper $type={type} style={style} onClick={type === 'toggle' ? triggerSave : undefined}>
      {enhancedChildren}
      {status !== 'idle' && <Badge $fading={fading}>{icon}</Badge>}
    </Wrapper>
  );
});

AutoSaveField.displayName = 'AutoSaveField';
export default AutoSaveField;
