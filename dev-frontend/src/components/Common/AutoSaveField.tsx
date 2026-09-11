import React, { useState, useRef, useEffect, useCallback, useImperativeHandle, forwardRef } from 'react';
import styled, { keyframes, css } from 'styled-components';
import { onFlushPendingSaves } from '../../services/pendingSaves';

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
  const wrapRef = useRef<HTMLDivElement>(null);

  // ★ 나갈 때 확정 저장 (docs/DRAFT_PERSISTENCE_DESIGN.md D-C3, 2026-09-11)
  //   여태는 언마운트 cleanup 이 **타이머만 지웠다** — 입력하고 debounce(최대 2초) 안에 드로어를 닫거나
  //   대상을 바꾸거나 로그아웃하면 그 입력은 서버에 안 갔는데 화면도 사라졌다.
  //   pending = 입력 뒤 아직 저장을 시작하지 않음 · inflight = 저장 중.
  //   ★ 저장은 한 번에 하나다 — 동시에 두 PUT 이 나가면 옛 값이 나중에 착지할 수 있다.
  const pendingRef = useRef(false);
  const inflightRef = useRef<Promise<void> | null>(null);

  // 대기·저장 중에는 원격 재부팅·새 빌드 리로드가 기다린다(utils/reloadSafety 가 이 속성을 본다)
  const markDirty = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    if (pendingRef.current || inflightRef.current) el.setAttribute('data-form-dirty', '1');
    else el.removeAttribute('data-form-dirty');
  }, []);

  const clearTimers = useCallback(() => {
    if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null; }
    if (fadeRef.current) clearTimeout(fadeRef.current);
    if (resetRef.current) clearTimeout(resetRef.current);
  }, []);

  const effectiveDebounce = debounceMs !== 2000 ? debounceMs
    : (type === 'toggle' || type === 'select' || type === 'list' || type === 'image') ? 300 : debounceMs;

  const fadeTo = useCallback((ms: number) => {
    fadeRef.current = setTimeout(() => {
      if (!mountedRef.current) return;
      setFading(true);
      resetRef.current = setTimeout(() => { if (mountedRef.current) { setStatus('idle'); setFading(false); } }, 300);
    }, ms);
  }, []);

  const runSave = useCallback((): Promise<void> => {
    // 저장 중이면 새로 쏘지 않는다 — 끝난 뒤 아래 finally 가 남은 입력을 이어 보낸다
    if (inflightRef.current) return inflightRef.current;
    pendingRef.current = false;
    if (mountedRef.current) setStatus('saving');
    const tracked = (async () => {
      try {
        await saveRef.current();
        if (!mountedRef.current) return;
        setStatus('saved');
        fadeTo(2000);
      } catch (e) {
        // 화면이 없으면 뱃지를 띄울 곳도 없다 — 조용히 삼키지 않고 남긴다
        if (!mountedRef.current) { console.warn('[AutoSaveField] 나가며 저장 실패', e); return; }
        setStatus('error');
        fadeTo(4000);
      }
    })().finally(() => {
      inflightRef.current = null;
      markDirty();
      // 저장 중에 들어온 입력 — 그 debounce 가 이미 터졌거나(여기서 대기) 언마운트로 지워졌으면 지금 보낸다.
      //   아직 타이머가 살아 있으면 타이머에 맡긴다. 언마운트된 뒤에도 보낸다(마지막 입력이 서버에 가야 한다).
      if (pendingRef.current && !debounceRef.current) void runSave();
    });
    inflightRef.current = tracked;
    markDirty();
    return tracked;
  }, [fadeTo, markDirty]);

  const triggerSave = useCallback(() => {
    clearTimers();
    setFading(false);
    pendingRef.current = true;
    markDirty();
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      if (!mountedRef.current) return;
      void runSave();
    }, effectiveDebounce);
  }, [effectiveDebounce, clearTimers, markDirty, runSave]);

  // 남은 저장을 끝까지 보낸다 — 대기분은 즉시, 저장 중이면 끝나기를 기다렸다가 이어진 저장까지
  const flushNow = useCallback(async () => {
    if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null; }
    for (let i = 0; i < 3 && (pendingRef.current || inflightRef.current); i += 1) {
      if (inflightRef.current) await inflightRef.current;
      else await runSave();
    }
  }, [runSave]);

  useImperativeHandle(ref, () => ({ triggerSave }), [triggerSave]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearTimers();
      // ★ 언마운트 = 드로어 닫기·대상 전환(key)·탭 닫기. 대기 중이면 지금 보낸다.
      //   저장 중이면 새로 쏘지 않는다 — 완료 finally 가 mountedRef 와 무관하게 이어 보낸다.
      if (pendingRef.current && !inflightRef.current) void runSave();
    };
  }, [clearTimers, runSave]);

  useEffect(() => {
    // 새로고침·주소 이동·창 닫기에는 언마운트 cleanup 이 오지 않는다 — 완주 보장은 없지만 시도한다
    const onPageHide = () => {
      if (!pendingRef.current || inflightRef.current) return;
      if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null; }
      void runSave();
    };
    window.addEventListener('pagehide', onPageHide);
    // 로그아웃·워크스페이스 전환·원격 재부팅 직전(services/pendingSaves) — 보낼 것이 있을 때만 등록
    const off = onFlushPendingSaves((waitUntil) => {
      if (pendingRef.current || inflightRef.current) waitUntil(flushNow());
    });
    return () => { window.removeEventListener('pagehide', onPageHide); off(); };
  }, [runSave, flushNow]);

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
    <Wrapper ref={wrapRef} $type={type} style={style} onClick={type === 'toggle' ? triggerSave : undefined}>
      {enhancedChildren}
      {status !== 'idle' && <Badge $fading={fading}>{icon}</Badge>}
    </Wrapper>
  );
});

AutoSaveField.displayName = 'AutoSaveField';
export default AutoSaveField;
