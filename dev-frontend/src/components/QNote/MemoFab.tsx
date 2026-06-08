// MemoFab — Quick Capture FAB + ⌘+Shift+M / Ctrl+Shift+M 글로벌 단축키 (사이클 N+17)
//
// 정책:
//  - 우하단 16px (모바일 동일), 메모 FAB 하나만 brand teal 원형
//  - Cue FAB (Coral) 는 80px 로 위로 이동 (CueHelpDrawer 가 별도 처리)
//  - Q Talk (/talk 및 하위) 페이지에서는 자동 숨김 — ChatPanel SendBtn 영역 침범 차단 (N+29)
//  - Client 역할 차단 (Q Note 자체가 client 접근 불가, FAB 도 무의미)
//  - guest (로그인 X) 도 차단
//  - 모달/드로어 열려있는 동안 (body[data-overlay-open=true]) 숨김
//  - 단축키: ⌘+Shift+M (mac) / Ctrl+Shift+M (win) — input/contenteditable focus 중에도 동작 (메모는 어디서나 빠르게)
//
// MemoPopup 의 open state 보유.
import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import MemoPopup from './MemoPopup';

// N+93 — 우하단 메모 FAB 는 RightDock 통합 런처로 흡수. 이 컴포넌트는 이제 팝업 보유 +
// ⌘+Shift+M 글로벌 단축키 + 런처(planq:open-tool) 수신만 담당 (별도 FAB 미렌더).
const MemoFab: React.FC = () => {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);

  // 권한 — 비즈니스 멤버 (owner/admin/member) 만. client / 로그인 안 한 상태 / 비즈니스 없음 → hide
  // 사이클 N+24: 'admin' role 추가 (N+21 에 신설됐는데 가드 누락 회귀 fix)
  const allowed = !!user?.business_id && ['owner', 'admin', 'member'].includes(user.business_role || '');
  const businessId = user?.business_id ? Number(user.business_id) : 0;

  // N+93 — 통합 런처(RightDock)에서 Q Note 선택 시 오픈. (자체 우하단 FAB 는 런처로 흡수)
  useEffect(() => {
    if (!allowed) return;
    const onOpen = (e: Event) => {
      if ((e as CustomEvent).detail?.tool === 'qnote') setOpen(true);
    };
    window.addEventListener('planq:open-tool', onOpen as EventListener);
    return () => window.removeEventListener('planq:open-tool', onOpen as EventListener);
  }, [allowed]);

  // 글로벌 단축키 — ⌘+Shift+M (mac) / Ctrl+Shift+M (win)
  useEffect(() => {
    if (!allowed) return;
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (!e.shiftKey) return;
      // 'M' (KeyM) — e.key 는 OS/IME 따라 'M'/'m'/'µ' 등 변동 → e.code 사용
      if (e.code !== 'KeyM') return;
      e.preventDefault();
      setOpen((x) => !x);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [allowed]);

  if (!allowed) return null;

  // N+93 — 우하단 FAB 는 RightDock 통합 런처로 흡수. 여기서는 팝업 + 단축키 + 런처 이벤트만 담당.
  return (
    <MemoPopup
      open={open}
      onClose={() => setOpen(false)}
      businessId={businessId}
    />
  );
};

export default MemoFab;
