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
import CalendarPicker from '../Common/CalendarPicker';
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
  font-size: 0.8125rem; font-family: inherit; color: #0F172A;
  background: #FFFFFF;
  &::placeholder { color: #94A3B8; }
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.12); }
`;
/* 입력이 주인공이라 셀렉터는 좁게 둔다. 고정폭 대신 상한만 걸어 좁은 팝아웃에서도 줄어든다. */
// ★ 2026-09-08 (Irene: "태그선택이랑 프로젝트 선택 영역이 너무 좁아. 조금만 길이가 나오게 하고
//   고정 좀 해. 둘 다 같게. … 태그를 입력하면 갑자기 태그선택란이 줄어들어. 왜 고정 안되고 줄어들어?")
//   `flex: 0 1 auto` 였다 — 기준이 **내용**이고 줄어들 수도 있어서, react-select 에 글자를 치면
//   입력 폭이 바뀌며 칸이 같이 흔들렸다. 고르는 칸은 흔들릴 이유가 없다.
//   → 고정 폭 하나로 못 박는다. 태그·프로젝트·마감일 **세 컨트롤이 같은 폭**이라
//     보기 기준을 바꿔도 줄이 튀지 않는다. 폭은 176 — 120 은 여전히 좁다는 신고를 받아 넓혔다
//     (프로젝트 이름·태그 이름이 잘리지 않고, 기간 '09/09 ~ 09/12' 가 한 줄에 들어간다).
const OPT_W = 176;
const OptWrap = styled.div`
  flex: 0 0 ${OPT_W}px;
  width: ${OPT_W}px;
`;
// Q task 리스트의 기간 트리거와 같은 톤 — 팝아웃만 다른 모양이 되지 않게.
const DateTrigger = styled.button<{ $empty?: boolean }>`
  width: 100%; height: 34px; padding: 0 10px;
  border: 1px solid #E2E8F0; border-radius: 8px; background: #FFFFFF;
  font-size: 0.8125rem; font-family: inherit; font-weight: 500;
  color: ${(p) => (p.$empty ? '#94A3B8' : '#0F172A')};
  text-align: left; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  &:hover { border-color: #CBD5E1; }
  &:focus-visible { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.12); }
`;
const fmtMd = (v: string) => (v ? v.slice(5).replace('-', '/') : '');
const AddBtn = styled.button`
  flex-shrink: 0; height: 34px; padding: 0 12px;
  border: 1px solid #99F6E4; border-radius: 8px;
  background: #F0FDFA; color: #0F766E;
  font-size: 0.8125rem; font-weight: 700; font-family: inherit;
  cursor: pointer;
  &:hover:not(:disabled) { background: #CCFBF1; }
  &:disabled { opacity: 0.5; cursor: default; }
  &:focus-visible { outline: 2px solid rgba(15,118,110,0.5); outline-offset: 2px; }
`;
const Err = styled.div`
  padding: 6px 12px 0;
  font-size: 0.75rem; color: #DC2626;
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
  /** ★ 2026-09-08 (Irene: "태그선택에서 태그 없으면 추가되게 하면 안돼?")
   *  주면 입력창에서 바로 만들 수 있게 된다. 안 주면 종전대로 고르기만 한다. */
  onCreate?: (name: string) => void;
  createLabel?: (name: string) => string;
}

/** ★ 2026-09-08 (Irene: "마감일별에는 마감날짜 넣게 해주고 캘린더. 필터별로 맞춰서 나오게 해줘.")
 *  보기 기준이 '마감일별' 이면 고를 것이 목록이 아니라 **날짜**다. 셀렉트로는 표현할 수 없어
 *  별도 모양으로 받는다. 네이티브 date 입력은 쓰지 않는다(저장소 표준 = SingleDateField). */
export interface QuickAddDateOption {
  /** 시작일 · 마감일 — Q task 리스트의 '기간' 과 **같은 캘린더**(CalendarPicker)를 쓴다.
   *  Irene: "마감일 선택은 원래 Q task 기간이랑 같게 캘린더 기간선택 되는 통일된 동일한 캘린더 쓰라고". */
  start: string;
  due: string;
  onChange: (start: string, due: string) => void;
  ariaLabel: string;
  placeholder: string;
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
  /** 마감일별 보기에서 쓰는 날짜 칸. option 과 **동시에 오지 않는다**(보기 기준은 하나다). */
  dateOption?: QuickAddDateOption | null;
}

const PopoutQuickAdd: React.FC<PopoutQuickAddProps> = ({ onAdd, placeholder, addLabel, errorText, option, dateOption }) => {
  const [value, setValue] = useState('');
  const [pending, setPending] = useState(0);        // 서버로 가는 중인 줄 수(입력은 막지 않는다)
  const [failedTitle, setFailedTitle] = useState('');
  const [failed, setFailed] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  const dateAnchor = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // ★ 2026-10-21 (Irene: "엔터 치고 너무 오랫동안 기다려야 입력이 들어가. 신속하게 추가되어야")
  //   예전엔 만들기 → 순서 저장 → 목록 다시 읽기 세 왕복이 **다 끝나야** 칸이 비었다(그동안 readonly).
  //   서버는 각각 수십 ms 인데 운영은 왕복마다 망 지연이 붙어 «한참 기다린다» 가 됐다.
  //   → Enter 순간 칸을 비우고 바로 다음 줄을 칠 수 있게 한다. 실패하면 적은 글을 되돌려 놓는다.
  //   중복 제출 가드는 «빈 칸» 이 대신한다 — 연타한 두 번째 Enter 는 칠 글자가 없다.
  const submit = async () => {
    const title = value.trim();
    if (!title) return;
    setValue('');
    setFailed(false);
    setFailedTitle('');
    setPending((n) => n + 1);
    inputRef.current?.focus();   // 버튼으로 제출했어도 다음 줄은 입력에서 이어 친다
    const ok = await onAdd(title);
    setPending((n) => n - 1);
    if (!ok) {
      // 그사이 다음 줄을 치고 있으면 덮지 않는다 — 무엇이 안 됐는지는 알림 줄에 적는다
      setValue((cur) => (cur ? cur : title));
      setFailedTitle(title);
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
          aria-busy={pending > 0}
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
              creatable={!!option.onCreate}
              onCreateOption={option.onCreate}
              formatCreateLabel={option.createLabel ? (v: string) => option.createLabel!(v) : undefined}
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
        {dateOption && (
          <OptWrap>
            <DateTrigger ref={dateAnchor} type="button" aria-label={dateOption.ariaLabel}
              $empty={!dateOption.start && !dateOption.due}
              onClick={() => setDateOpen((v) => !v)}>
              {dateOption.start || dateOption.due
                ? (dateOption.start && dateOption.due && dateOption.start !== dateOption.due
                  ? `${fmtMd(dateOption.start)} ~ ${fmtMd(dateOption.due)}`
                  : fmtMd(dateOption.due || dateOption.start))
                : dateOption.placeholder}
            </DateTrigger>
            {dateOpen && (
              <CalendarPicker isOpen anchorRef={dateAnchor}
                startDate={dateOption.start || dateOption.due}
                endDate={dateOption.due || dateOption.start}
                onRangeSelect={(a, b) => dateOption.onChange(a || '', b || '')}
                onClose={() => setDateOpen(false)} />
            )}
          </OptWrap>
        )}
        <AddBtn type="submit" disabled={!value.trim()} data-testid="task-popout-quickadd-submit">
          {addLabel}
        </AddBtn>
      </Wrap>
      {failed && <Err role="alert">{errorText}{failedTitle ? ` — ${failedTitle}` : ''}</Err>}
    </>
  );
};

export default PopoutQuickAdd;
