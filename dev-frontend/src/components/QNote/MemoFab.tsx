// MemoFab — Quick Capture FAB + ⌘+Shift+M / Ctrl+Shift+M 글로벌 단축키 (사이클 N+17)
//
// 정책:
//  - 우하단 16px (모바일 동일), 메모 FAB 하나만 brand teal 원형
//  - Cue FAB (Coral) 는 80px 로 위로 이동 (CueHelpDrawer 가 별도 처리)
//  - Q Talk (/talk 및 하위) 페이지에서는 자동 숨김 (CueHelpDrawer 와 동일 FAB_HIDDEN_PATHS 정책)
//  - Client 역할 차단 (Q Note 자체가 client 접근 불가, FAB 도 무의미)
//  - guest (로그인 X) 도 차단
//  - 모달/드로어 열려있는 동안 (body[data-overlay-open=true]) 숨김
//  - 단축키: ⌘+Shift+M (mac) / Ctrl+Shift+M (win) — input/contenteditable focus 중에도 동작 (메모는 어디서나 빠르게)
//
// MemoPopup 의 open state 보유.
import React, { useState, useEffect } from 'react';
import styled from 'styled-components';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import MemoPopup from './MemoPopup';

// /memo/:id 은 메모 팝업이 standalone 모드로 풀스크린 마운트되는 분리 창 — FAB 노출하면 자기 안에 자기 떠서 혼란
// 사이클 N+23: /talk 차단 해제 — 사용자 요청 "Q Talk 에서도 메모 FAB 표시"
const FAB_HIDDEN_PATHS = ['/memo'];

const FabBtn = styled.button`
  position: fixed; right: 20px; bottom: 16px;
  width: 52px; height: 52px;
  display: inline-flex; align-items: center; justify-content: center;
  background: #0F766E;   /* PlanQ teal — VisibilityBadge L2 와 동일 */
  color: #FFFFFF;
  border: none; border-radius: 50%;
  box-shadow: 0 4px 16px rgba(15,118,110,0.30);
  cursor: pointer;
  z-index: 40;
  transition: transform 0.15s, background 0.15s, opacity 0.15s;
  &:hover { background: #115E59; transform: translateY(-1px); }
  &:focus-visible { outline: 2px solid rgba(15,118,110,0.5); outline-offset: 4px; }
  @media (max-width: 640px) {
    right: 16px; bottom: 16px;
    width: 48px; height: 48px;
  }
  body[data-overlay-open="true"] & {
    opacity: 0;
    pointer-events: none;
    visibility: hidden;
  }
`;

const IconNote = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
    <polyline points="14 2 14 8 20 8"/>
    <line x1="9" y1="13" x2="15" y2="13"/>
    <line x1="9" y1="17" x2="13" y2="17"/>
  </svg>
);

const MemoFab: React.FC = () => {
  const { t } = useTranslation('qnote');
  const { user } = useAuth();
  const location = useLocation();
  const [open, setOpen] = useState(false);

  // 권한 — 비즈니스 멤버 (owner/admin/member) 만. client / 로그인 안 한 상태 / 비즈니스 없음 → hide
  // 사이클 N+24: 'admin' role 추가 (N+21 에 신설됐는데 가드 누락 회귀 fix)
  const allowed = !!user?.business_id && ['owner', 'admin', 'member'].includes(user.business_role || '');
  const businessId = user?.business_id ? Number(user.business_id) : 0;
  const pathHidden = FAB_HIDDEN_PATHS.some((p) => location.pathname === p || location.pathname.startsWith(`${p}/`));

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

  const label = t('memoPopup.title') as string;
  // 단축키 안내는 desktop 만 의미 있음. tooltip 으로 표시.
  const shortcutLabel = (typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent))
    ? '⌘+Shift+M'
    : 'Ctrl+Shift+M';

  return (
    <>
      {!pathHidden && (
        <FabBtn
          type="button"
          onClick={() => setOpen(true)}
          aria-label={`${label} (${shortcutLabel})`}
          title={`${label} (${shortcutLabel})`}
        >
          <IconNote />
        </FabBtn>
      )}
      <MemoPopup
        open={open}
        onClose={() => setOpen(false)}
        businessId={businessId}
      />
    </>
  );
};

export default MemoFab;
