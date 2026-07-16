// SourceHint — 데이터 출처/계산 근거 표시 공통 컴포넌트.
//   자동 집계(B) 수치 옆 ⓘ: hover/focus 시 "무엇으로·언제 기준으로 계산됐는지" 툴팁.
//   AI 생성(C) 필드엔 AutoGenBadge ("✨ 자동 생성").
//   목적: 유저가 "이 값이 자동 계산인지 / 내가 입력한 건지 / AI 생성인지" 한눈에 인지.
import { useId, useState } from 'react';
import styled from 'styled-components';

interface SourceHintProps {
  /** 툴팁 본문 — 호출처에서 t() 로 현지화한 문자열 전달 (계산식·기간 등) */
  text: string;
  /** 툴팁 위치 (기본 bottom) */
  placement?: 'top' | 'bottom';
}

// ⓘ + 계산근거 툴팁 (hover · focus · 모바일 tap)
export function SourceHint({ text, placement = 'bottom' }: SourceHintProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <HintWrap
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <HintBtn
        type="button"
        aria-label={text}
        aria-describedby={open ? id : undefined}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
      </HintBtn>
      {open && <Tip id={id} role="tooltip" $placement={placement}>{text}</Tip>}
    </HintWrap>
  );
}

// AI 생성 / 자동 생성 필드 배지
export function AutoGenBadge({ label }: { label: string }) {
  return <GenBadge>✨ {label}</GenBadge>;
}

// provenance(생성 경로) 배지 — "Cue로 추가됨" 등. ✨(AI 생성) 시맨틱과 구분:
//   Cue 생성물은 사람이 확인 카드를 눌러 만든 것(actor=사용자)이라 AI 생성 배지와 혼용 금지.
//   중립 회색 톤 · 아이콘 없이 텍스트만.
export function ProvenanceBadge({ label }: { label: string }) {
  return <ProvBadge>{label}</ProvBadge>;
}

const HintWrap = styled.span`position:relative;display:inline-flex;align-items:center;`;
const HintBtn = styled.button`
  display:inline-flex;align-items:center;justify-content:center;
  width:16px;height:16px;padding:0;margin:0;border:none;background:none;
  color:#94A3B8;cursor:help;border-radius:50%;
  &:hover{color:#0F766E;}
  &:focus-visible{outline:2px solid #14B8A6;outline-offset:1px;}
`;
const Tip = styled.span<{ $placement: 'top' | 'bottom' }>`
  position:absolute;z-index:50;left:50%;transform:translateX(-50%);
  ${(p) => (p.$placement === 'top' ? 'bottom:calc(100% + 6px);' : 'top:calc(100% + 6px);')}
  min-width:140px;max-width:240px;width:max-content;
  background:#0F172A;color:#fff;font-size:11px;font-weight:500;line-height:1.5;
  padding:7px 10px;border-radius:8px;box-shadow:0 4px 12px rgba(15,23,42,0.18);
  white-space:normal;text-align:left;pointer-events:none;
`;
const GenBadge = styled.span`
  display:inline-flex;align-items:center;gap:3px;
  font-size:10px;font-weight:700;color:#0F766E;background:#F0FDFA;
  border-radius:999px;padding:2px 8px;white-space:nowrap;
`;
// 중립 회색 provenance 배지 (AI 생성 배지와 색으로 구분)
const ProvBadge = styled.span`
  display:inline-flex;align-items:center;
  font-size:10px;font-weight:600;color:#64748B;background:#F1F5F9;
  border-radius:999px;padding:2px 8px;white-space:nowrap;
`;

export default SourceHint;
