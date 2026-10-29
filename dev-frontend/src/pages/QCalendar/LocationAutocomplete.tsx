// 일정 «위치» 칸 — 치면 장소 후보가 뜨고 고르면 «이름, 도로명주소» 한 줄로 들어간다
//   (2026-10-29, Irene «구글처럼 일정에 주소검색되서 입력되면 좋겠다» · Fable 설계 D4·D6).
//   새 일정(EventPlaceField) · 업무 일정 상세(EventDrawer) · 개인 일정 상세(PersonalEventDrawer) 세 곳이 같이 쓴다.
//
// 계약:
//   - 자유 입력이 정상 경로다 — 고르지 않아도 친 글자가 그대로 저장된다. 후보가 없으면 목록을 그리지 않는다(«결과 없음» 줄 없음).
//   - 입력칸 모양은 호출부의 것을 그대로(`input` prop) — 새 스타일을 만들지 않는다.
//   - 목록이 열린 동안은 onOpenChange(true) — 상세 화면은 이것으로 AutoSaveField hold 를 걸어 반쪽 입력 저장·알림을 막는다.
//   - 목록 항목은 mousedown preventDefault — 입력칸이 blur 되지 않는다.
//   - 목록이 열린 동안 Enter 는 폼 제출로 흘리지 않는다 · 한글 조합 중 키는 무시 · Esc 는 스택 최상단(목록 먼저).
//   - 서버 키가 없으면(disabled) 이 창이 살아 있는 동안 다시 묻지 않는다 · 잠깐 못 쓰면(degraded) 30초 쉰다. 화면엔 표시 없음.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import FloatingMenu from '../../components/Common/FloatingMenu';
import { useEscapeStack } from '../../hooks/useEscapeStack';
import { isComposingEvent } from '../../utils/imeKey';
import { searchPlaces, type PlaceSuggestion } from '../../services/calendar';
import { Input as FormInput } from './eventFormStyles';

let placesDisabled = false;   // 세 자리가 각각 두드리지 않게 모듈 메모
let placesBackoffUntil = 0;

const MAX_LEN = 200;
export function placeLine(p: PlaceSuggestion): string {
  const addr = p.road_address || p.address;
  const line = !p.name || p.name === addr ? addr : addr ? `${p.name}, ${addr}` : p.name;
  return line.slice(0, MAX_LEN);
}

interface Props {
  value: string;
  onChange: (next: string) => void;
  onOpenChange?: (open: boolean) => void;
  placeholder?: string;
  'aria-label'?: string;
  'data-testid'?: string;
  /** 호출부의 입력칸 styled 컴포넌트(모양 그대로) */
  input?: React.ElementType;
}

const LocationAutocomplete: React.FC<Props> = ({ value, onChange, onOpenChange, placeholder, input, ...rest }) => {
  const { t } = useTranslation('qcalendar');
  const InputEl = input || FormInput;
  const [items, setItems] = useState<PlaceSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(-1);
  const reqSeq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const typedRef = useRef(false);   // 사용자가 이 칸에 친 뒤에만 검색(값이 밖에서 바뀐 것엔 반응 안 함)
  const listId = useRef(`place-ac-${Math.random().toString(36).slice(2, 8)}`).current;

  const showList = open && items.length > 0;
  const openChangeRef = useRef(onOpenChange);
  openChangeRef.current = onOpenChange;
  useEffect(() => { openChangeRef.current?.(showList); }, [showList]);
  // 언마운트 때 hold 를 남기지 않는다
  useEffect(() => () => { openChangeRef.current?.(false); if (timer.current) clearTimeout(timer.current); abortRef.current?.abort(); }, []);

  const close = useCallback(() => { setOpen(false); setHi(-1); }, []);
  useEscapeStack(showList, close);

  useEffect(() => {
    if (!typedRef.current) return;
    if (timer.current) clearTimeout(timer.current);
    const q = value.trim();
    if (placesDisabled || Array.from(q).length < 2 || Date.now() < placesBackoffUntil) {
      reqSeq.current += 1; setItems([]); return;
    }
    timer.current = setTimeout(async () => {
      const seq = ++reqSeq.current;
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      try {
        const r = await searchPlaces(q, ac.signal);
        if (seq !== reqSeq.current) return; // 늦게 온 옛 응답은 버린다
        if (r.disabled) placesDisabled = true;
        if (r.degraded) placesBackoffUntil = Date.now() + 30_000;
        setItems(r.data.slice(0, 7));
        setHi(-1);
      } catch { /* 취소·네트워크 — 평범한 입력칸으로 둔다 */ }
    }, 300);
  }, [value]);

  const pick = (p: PlaceSuggestion) => {
    reqSeq.current += 1;
    typedRef.current = false;
    onChange(placeLine(p));
    setItems([]);
    close();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showList || isComposingEvent(e)) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi(i => Math.min(items.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(i => Math.max(-1, i - 1)); }
    else if (e.key === 'Enter') {
      e.preventDefault(); e.stopPropagation();
      if (hi >= 0 && items[hi]) pick(items[hi]); else close();
    }
  };

  return (
    // 목록의 기준 = 입력칸을 감싼 이 상자(FloatingMenu 는 자기 부모에 붙는다 — 폼 칸 전체에 붙으면 아래 버튼 밑으로 뜬다)
    <Wrap>
      <InputEl
        {...rest}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showList}
        aria-controls={listId}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => { typedRef.current = true; onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={close}
        onKeyDown={onKeyDown}
      />
      {showList && (
        <FloatingMenu matchWidth onDismiss={close} contentKey={items.length}>
          <Menu id={listId} role="listbox" aria-label={t('form.placeSuggestions', '장소 후보') as string} data-testid="event-location-suggestions">
            {items.map((p, i) => (
              <Item key={`${p.id}-${i}`} role="option" aria-selected={i === hi} $active={i === hi}
                data-testid="event-location-suggestion"
                onMouseEnter={() => setHi(i)}
                onMouseDown={(e) => { e.preventDefault(); pick(p); }}>
                <Name>{p.name || p.road_address || p.address}</Name>
                {p.name && (p.road_address || p.address) && <Addr>{p.road_address || p.address}</Addr>}
              </Item>
            ))}
          </Menu>
        </FloatingMenu>
      )}
    </Wrap>
  );
};

export default LocationAutocomplete;

const Wrap = styled.div`position: relative; width: 100%; min-width: 0;`;
// 생김새는 CategoryCombobox 후보 목록과 같은 값
const Menu = styled.div.attrs<{ 'data-popover'?: string }>({ 'data-popover': 'true' })`
  background: #fff; border: 1px solid #E2E8F0; border-radius: 10px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.12);
  padding: 4px; max-height: 280px; overflow-y: auto;
`;
const Item = styled.div<{ $active: boolean }>`
  display: flex; flex-direction: column; gap: 2px;
  padding: 8px 10px; border-radius: 6px; cursor: pointer; min-width: 0;
  background: ${p => p.$active ? '#F0FDFA' : 'transparent'};
  &:hover { background: #F0FDFA; }
`;
const Name = styled.span`font-size: 0.8125rem; font-weight: 600; color: #0F172A; overflow-wrap: anywhere;`;
const Addr = styled.span`font-size: 0.75rem; color: #64748B; overflow-wrap: anywhere;`;
