// Q Task 팝아웃 열기 버튼 — 확인 필요·Q Task 리스트 공용 (Irene 2026-08-24).
//
//   여태 팝아웃 진입로는 우하단 도크 하나뿐이었다. 정작 업무를 보는 화면(확인 필요·Q Task)에는
//   여는 길이 없어, 옆에 띄워 두고 쓰려면 매번 도크를 펼쳐야 했다.
//
// ★ 여는 규칙(창 자리·계단·이미 열린 창 재사용)은 `utils/pinHost.openPopout` 단일 진입점에 있다.
//   여기서 window.open 을 직접 부르면 자리 규칙이 두 벌이 된다.
// ★ 모바일은 별도 창이 의미 없다 — 버튼을 내지 않는다(도크와 같은 판단).
import React from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { openPopout } from '../../utils/pinHost';

const OpenTaskPopoutButton: React.FC<{ className?: string }> = ({ className }) => {
  const { t } = useTranslation('qtask');
  const label = t('popout.openBtn', { defaultValue: '오늘 내 업무' }) as string;
  const hint = t('popout.openBtnHint', { defaultValue: '오늘·이번 주 내 업무를 별도 창으로 — 창 안의 핀을 누르면 항상 위로 고정됩니다' }) as string;
  return (
    <Btn type="button" className={className} data-testid="open-task-popout"
      onClick={() => openPopout('qtask')} title={hint} aria-label={hint}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
        <polyline points="15 3 21 3 21 9" />
        <line x1="10" y1="14" x2="21" y2="3" />
      </svg>
      {label}
    </Btn>
  );
};

export default OpenTaskPopoutButton;

const Btn = styled.button`
  display: inline-flex; align-items: center; gap: 5px;
  height: 30px; padding: 0 10px; flex-shrink: 0;
  background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 6px;
  font-size: 0.75rem; font-weight: 600; color: #64748B; cursor: pointer; font-family: inherit;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
  &:hover { background: #F8FAFC; border-color: #CBD5E1; color: #0F172A; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 2px; }
  /* 모바일은 별도 창이 의미 없다 */
  @media (max-width: 768px) { display: none; }
`;
