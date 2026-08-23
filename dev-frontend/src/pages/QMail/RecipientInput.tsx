// RecipientInput — 받는 사람 칩 입력 (Irene 2026-08-24).
//
//   "이메일 하나씩 딱딱 등록하는 형태. 콤마를 쓰면 박스 안으로 들어가고, 엔터쳐도 그렇고."
//
// ★ 바깥과 주고받는 값은 **여전히 콤마로 이어 붙인 문자열**이다.
//   `cTo` 를 읽는 곳이 6군데(초안 저장·발송·AI 바·유효성)이고 전부 `split(/[,;\s]+/)` 로 쓴다.
//   타입을 배열로 바꾸면 그 6곳을 다 고쳐야 하고, 한 곳만 놓치면 **주소가 조용히 사라진다**.
//   그래서 겉모습만 칩으로 바꾸고 계약은 건드리지 않는다.
//
// ★ 확정 트리거: 콤마 · 세미콜론 · Enter · 붙여넣기 · 포커스 이탈. 지우기: Backspace(입력칸이 빈 상태)
// ★ 형식이 틀린 주소도 **버리지 않고** 빨간 칩으로 남긴다 — 조용히 사라지는 것이 가장 나쁘다.
import React, { useMemo, useRef, useState } from 'react';
import styled from 'styled-components';

interface Props {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  disabled?: boolean;
  'data-testid'?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const splitAll = (s: string) => s.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);

const RecipientInput: React.FC<Props> = ({ value, onChange, placeholder, disabled, ...rest }) => {
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const chips = useMemo(() => splitAll(value), [value]);

  const commit = (raw: string) => {
    const parts = splitAll(raw);
    if (!parts.length) return;
    // 중복은 넣지 않는다 — 같은 주소가 두 칩으로 보이면 지울 때 어느 쪽인지 알 수 없다.
    const next = [...chips];
    parts.forEach((p) => { if (!next.includes(p)) next.push(p); });
    onChange(next.join(', '));
    setDraft('');
  };

  const removeAt = (i: number) => {
    const next = chips.filter((_, idx) => idx !== i);
    onChange(next.join(', '));
  };

  return (
    <Box $disabled={!!disabled} onClick={() => inputRef.current?.focus()} data-testid={rest['data-testid']}>
      {chips.map((c, i) => (
        <Chip key={`${c}-${i}`} $bad={!EMAIL_RE.test(c)} title={EMAIL_RE.test(c) ? c : `${c} — 형식이 이메일이 아닙니다`}>
          {c}
          <Del type="button" tabIndex={-1} aria-label={`${c} 삭제`}
            onClick={(e) => { e.stopPropagation(); removeAt(i); }}>×</Del>
        </Chip>
      ))}
      <Field
        ref={inputRef}
        value={draft}
        disabled={disabled}
        placeholder={chips.length ? '' : placeholder}
        inputMode="email"
        autoComplete="off"
        onChange={(e) => {
          const v = e.target.value;
          // 콤마·세미콜론을 치는 순간 칩으로 들어간다
          if (/[,;]/.test(v)) { commit(v); return; }
          setDraft(v);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(draft); return; }
          if (e.key === 'Backspace' && !draft && chips.length) { e.preventDefault(); removeAt(chips.length - 1); }
        }}
        onPaste={(e) => {
          const text = e.clipboardData.getData('text');
          if (/[,;\s]/.test(text)) { e.preventDefault(); commit(text); }
        }}
        onBlur={() => commit(draft)}   // 입력하다 다른 칸으로 가도 잃지 않는다
      />
    </Box>
  );
};

export default RecipientInput;

const Box = styled.div<{ $disabled: boolean }>`
  display: flex; flex-wrap: wrap; align-items: center; gap: 4px;
  min-height: 36px; padding: 5px 8px; width: 100%; box-sizing: border-box;
  background: ${(p) => (p.$disabled ? '#F8FAFC' : '#FFFFFF')};
  border: 1px solid #E2E8F0; border-radius: 8px; cursor: text;
  &:focus-within { border-color: #14B8A6; box-shadow: 0 0 0 2px rgba(20,184,166,0.15); }
`;
const Chip = styled.span<{ $bad: boolean }>`
  display: inline-flex; align-items: center; gap: 4px; max-width: 100%;
  padding: 2px 6px 2px 8px; border-radius: 6px;
  font-size: 12px; font-weight: 600; line-height: 18px;
  color: ${(p) => (p.$bad ? '#B91C1C' : '#0F766E')};
  background: ${(p) => (p.$bad ? '#FEE2E2' : '#F0FDFA')};
  border: 1px solid ${(p) => (p.$bad ? '#FCA5A5' : '#99F6E4')};
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
`;
const Del = styled.button`
  flex-shrink: 0; width: 16px; height: 16px; padding: 0;
  display: inline-flex; align-items: center; justify-content: center;
  background: none; border: none; cursor: pointer; font-size: 14px; line-height: 1;
  color: inherit; opacity: 0.65; font-family: inherit;
  &:hover { opacity: 1; }
`;
const Field = styled.input`
  flex: 1; min-width: 140px; height: 24px; padding: 0 2px;
  border: none; outline: none; background: transparent;
  font-size: 13px; color: #0F172A; font-family: inherit;
  &::placeholder { color: #94A3B8; }
`;
