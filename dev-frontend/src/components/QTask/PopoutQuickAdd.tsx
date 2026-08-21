// 팝아웃 퀵애드 — #258 "이 팝아웃에서는 업무를 바로 바로 추가할 수 있어야 해. 입력해서."
//   원문 수용 기준: **"메모장 할일목록을 쓰는 사람들이 불편하지 않아야 해."**
//
// 그래서 마찰을 최소로 둔다: 제목 한 줄 + Enter. 저장 버튼도 모달도 없다.
//   ★ 추가 후 입력값만 비우고 **포커스는 유지**한다 — 연속 입력이 메모장 감각의 핵심이다.
//   ★ Enter 단독 저장은 UI_DESIGN_GUIDE §1.8 의 예외다(Fable 설계 게이트 승인).
//     금지의 근거가 "멀티필드 폼에서 조기 제출" 인데 단일 필드에는 그 근거가 성립하지 않는다.
//   ★ 단, 한국어 IME 조합 확정 Enter 가 이중 발화하므로 `isComposing` 가드가 **필수**다.
//
// TaskPopoutView 가 크므로 여기로 절출했다(god-file 래칫).
import React, { useRef, useState } from 'react';
import styled from 'styled-components';
import PlanQSelect from '../Common/PlanQSelect';

const Wrap = styled.form`
  display: flex; gap: 6px; align-items: center;
  padding: 10px 12px 0;
  flex-shrink: 0;
`;
const Input = styled.input`
  flex: 1; min-width: 0; height: 34px;
  padding: 0 10px;
  border: 1px solid #E2E8F0; border-radius: 8px;
  font-size: 13px; font-family: inherit; color: #0F172A;
  background: #FFFFFF;
  &::placeholder { color: #94A3B8; }
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.12); }
  /* 제출 중 표시. disabled 가 아니라 readonly 다 — 아래 submit() 주석의 포커스 유지 이유. */
  &[readonly] { background: #F8FAFC; color: #94A3B8; }
`;
/* 입력이 주인공이라 셀렉터는 좁게 둔다. 고정폭 대신 상한만 걸어 좁은 팝아웃에서도 줄어든다. */
const OptWrap = styled.div`
  flex: 0 1 auto; min-width: 84px; max-width: 40%;
`;
const AddBtn = styled.button`
  flex-shrink: 0; height: 34px; padding: 0 12px;
  border: 1px solid #99F6E4; border-radius: 8px;
  background: #F0FDFA; color: #0F766E;
  font-size: 13px; font-weight: 700; font-family: inherit;
  cursor: pointer;
  &:hover:not(:disabled) { background: #CCFBF1; }
  &:disabled { opacity: 0.5; cursor: default; }
  &:focus-visible { outline: 2px solid rgba(15,118,110,0.5); outline-offset: 2px; }
`;
const Err = styled.div`
  padding: 6px 12px 0;
  font-size: 12px; color: #DC2626;
`;

/** #309 — 지금 보고 있는 기준(태그·프로젝트)에 맞는 선택지. 없으면 안 그린다. */
export interface QuickAddOption {
  /** 선택지 목록. 빈 배열이면 셀렉터를 숨긴다(고를 게 없는데 빈 상자를 두지 않는다). */
  choices: Array<{ value: string; label: string }>;
  value: string;                 // '' = 미지정
  onChange: (v: string) => void;
  /** 미지정 상태의 표시 문구 (예: "태그 없음") */
  placeholder: string;
  ariaLabel: string;
}

export interface PopoutQuickAddProps {
  /** 제목으로 업무를 만든다. 성공하면 true. (기본값 결정은 호출측 = 탭 문맥의 몫) */
  onAdd: (title: string) => Promise<boolean>;
  placeholder: string;
  addLabel: string;
  errorText: string;
  /** #309 — "태그별로 되어 있으면 태그선택을 옵션으로, 프로젝트별이면 프로젝트를".
      보기 기준이 바뀌면 호출측이 다른 option 을 넘긴다. 여기서는 그리기만 한다. */
  option?: QuickAddOption | null;
}

const PopoutQuickAdd: React.FC<PopoutQuickAddProps> = ({ onAdd, placeholder, addLabel, errorText, option }) => {
  const [value, setValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [failed, setFailed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = async () => {
    const title = value.trim();
    if (!title || submitting) return;   // 빈/공백 차단 + 중복 제출 가드
    setSubmitting(true);
    setFailed(false);
    const ok = await onAdd(title);
    setSubmitting(false);
    if (ok) {
      setValue('');
      // 연속 입력 — 값만 비우고 포커스는 그대로 둔다.
      //   ★ 여기서 focus() 가 통하려면 입력이 **그 순간에도 포커스 가능**해야 한다.
      //     제출 중 잠금을 `disabled` 로 걸면 브라우저가 즉시 blur 시키고, 위 setSubmitting(false) 는
      //     아직 re-render 로 flush 되기 전이라 이 focus() 가 **여전히 disabled 인 DOM** 에 닿아 no-op 이 된다
      //     (activeElement=BODY → 이어 친 글자가 허공으로 사라진다). readonly 는 blur 도 없고 포커스도 받는다.
      //   버튼으로 제출한 경우엔 포커스가 버튼에 있다가 버튼이 disabled 로 풀리므로, 이 호출이 입력으로 되돌린다.
      inputRef.current?.focus();
    } else {
      setFailed(true);
    }
  };

  return (
    <>
      <Wrap
        onSubmit={(e) => { e.preventDefault(); void submit(); }}
        data-testid="task-popout-quickadd"
      >
        <Input
          ref={inputRef}
          value={value}
          readOnly={submitting}
          aria-busy={submitting}
          placeholder={placeholder}
          aria-label={placeholder}
          data-testid="task-popout-quickadd-input"
          onChange={(e) => { setValue(e.target.value); if (failed) setFailed(false); }}
          onKeyDown={(e) => {
            // ★ IME 조합 중의 Enter 는 "조합 확정" 이지 제출이 아니다. 이 가드가 없으면
            //   한국어 입력에서 마지막 글자가 확정되는 순간 한 번 더 제출된다.
            if (e.key !== 'Enter') return;
            if (e.nativeEvent.isComposing) return;
            e.preventDefault();
            void submit();
          }}
        />
        {option && option.choices.length > 0 && (
          <OptWrap>
            <PlanQSelect
              size="sm"
              isClearable
              aria-label={option.ariaLabel}
              placeholder={option.placeholder}
              value={option.value
                ? { value: option.value, label: option.choices.find((c) => c.value === option.value)?.label || option.value }
                : null}
              onChange={(v) => option.onChange((v as { value?: string } | null)?.value || '')}
              options={option.choices}
            />
          </OptWrap>
        )}
        <AddBtn type="submit" disabled={submitting || !value.trim()} data-testid="task-popout-quickadd-submit">
          {addLabel}
        </AddBtn>
      </Wrap>
      {failed && <Err role="alert">{errorText}</Err>}
    </>
  );
};

export default PopoutQuickAdd;
