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
//
// 주소 추천 (2026-10-15 Irene «받는 사람 주소에 검색이 안돼. 메일 안의 모든 주소들 검색해서 리스트업»)
//   · 후보는 부르는 쪽이 한 번 불러 넘긴다(`suggestions` — 오간 주소 목록 라우트). 키 입력마다 서버를 부르지 않는다.
//   · 목록은 body 로 포털한다 — 작성 본문(ComposeBody)이 스크롤 상자라 안에 두면 잘린다.
//   · 고르는 것은 mousedown(+preventDefault) — 칸의 blur 가 먼저 돌면 치던 조각이 빨간 칩으로 먼저 들어간다.
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import { isEnterAction } from '../../utils/imeKey';
import { findMatches } from '../../utils/searchMatch';
import HighlightText from '../../components/Common/HighlightText';

export interface RecipientSuggestion { email: string; name?: string | null; client?: { id: number; name?: string | null } | null }

interface Props {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** 추천 후보(최근순) — 없으면 추천 목록을 띄우지 않는다 */
  suggestions?: RecipientSuggestion[];
  'data-testid'?: string;
}

const MAX_SHOWN = 8;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const splitAll = (s: string) => s.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);

const RecipientInput: React.FC<Props> = ({ value, onChange, placeholder, disabled, suggestions, ...rest }) => {
  const { t } = useTranslation('qmail');
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const chips = useMemo(() => splitAll(value), [value]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const [rect, setRect] = useState<{ left: number; top: number; width: number; up: boolean; maxH: number } | null>(null);

  const q = draft.trim();
  const matches = useMemo(() => {
    if (!q || !suggestions?.length) return [];
    const taken = new Set(chips.map((c) => c.toLowerCase()));
    return suggestions
      .filter((s) => !taken.has(s.email.toLowerCase()))
      .filter((s) => findMatches(s.email, q).length > 0 || findMatches(s.name || '', q).length > 0)
      .slice(0, MAX_SHOWN);
  }, [q, suggestions, chips]);
  const showMenu = menuOpen && matches.length > 0 && !disabled;
  useEffect(() => { setHi(0); }, [q]);

  // 칸 바로 아래(공간이 모자라면 위)에 편다. 스크롤·키보드로 칸이 움직이면 따라간다(닫지 않는다 —
  //   폰에서 키보드가 올라오며 조상이 스크롤하는 것을 «닫을 이유» 로 읽으면 치는 순간 목록이 사라진다).
  useLayoutEffect(() => {
    if (!showMenu) return;
    const place = () => {
      const r = boxRef.current?.getBoundingClientRect();
      if (!r) return;
      const vv = window.visualViewport;
      const viewBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
      const below = viewBottom - r.bottom - 8;
      const above = r.top - 8;
      const up = below < 160 && above > below;
      setRect({ left: r.left, top: up ? r.top - 4 : r.bottom + 4, width: r.width, up, maxH: Math.max(120, Math.min(320, up ? above : below)) });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    window.visualViewport?.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
      window.visualViewport?.removeEventListener('resize', place);
    };
  }, [showMenu, chips.length]);

  const commit = (raw: string) => {
    const parts = splitAll(raw);
    if (!parts.length) return;
    // 중복은 넣지 않는다 — 같은 주소가 두 칩으로 보이면 지울 때 어느 쪽인지 알 수 없다.
    const next = [...chips];
    parts.forEach((p) => { if (!next.includes(p)) next.push(p); });
    onChange(next.join(', '));
    setDraft('');
  };

  const pick = (sug: RecipientSuggestion) => {
    const next = [...chips];
    if (!next.some((c) => c.toLowerCase() === sug.email.toLowerCase())) next.push(sug.email);
    onChange(next.join(', '));
    setDraft('');
    setMenuOpen(false);
    inputRef.current?.focus();
  };

  const removeAt = (i: number) => {
    const next = chips.filter((_, idx) => idx !== i);
    onChange(next.join(', '));
  };

  return (
    <Box ref={boxRef} $disabled={!!disabled} onClick={() => inputRef.current?.focus()} data-testid={rest['data-testid']}>
      {chips.map((c, i) => (
        <Chip key={`${c}-${i}`} $bad={!EMAIL_RE.test(c)} title={EMAIL_RE.test(c) ? c : (t('compose.badEmail', { addr: c, defaultValue: '{{addr}} — 형식이 이메일이 아닙니다' }) as string)}>
          {c}
          <Del type="button" tabIndex={-1} aria-label={t('compose.removeRecipient', { addr: c, defaultValue: '{{addr}} 삭제' }) as string}
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
        role="combobox"
        aria-expanded={showMenu}
        aria-autocomplete="list"
        onChange={(e) => {
          const v = e.target.value;
          // 콤마·세미콜론을 치는 순간 칩으로 들어간다
          if (/[,;]/.test(v)) { commit(v); return; }
          setDraft(v);
          setMenuOpen(true);
        }}
        onKeyDown={(e) => {
          if (showMenu && e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => (h + 1) % matches.length); return; }
          if (showMenu && e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => (h - 1 + matches.length) % matches.length); return; }
          // Esc 는 추천 목록만 닫는다 — 작성창까지 닫히지 않게 전파를 멈춘다
          if (showMenu && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); setMenuOpen(false); return; }
          if (isEnterAction(e)) {
            e.preventDefault();
            if (showMenu && matches[hi]) pick(matches[hi]); else commit(draft);
            return;
          }
          if (e.key === 'Backspace' && !draft && chips.length) { e.preventDefault(); removeAt(chips.length - 1); }
        }}
        onPaste={(e) => {
          const text = e.clipboardData.getData('text');
          if (/[,;\s]/.test(text)) { e.preventDefault(); commit(text); }
        }}
        onBlur={() => { setMenuOpen(false); commit(draft); }}   // 입력하다 다른 칸으로 가도 잃지 않는다
      />
      {showMenu && rect && createPortal(
        <Menu
          role="listbox"
          data-testid="compose-to-suggest"
          style={{ left: rect.left, width: rect.width, maxHeight: rect.maxH, ...(rect.up ? { bottom: window.innerHeight - rect.top } : { top: rect.top }) }}
        >
          {matches.map((m, i) => (
            <Opt
              key={m.email}
              type="button"
              role="option"
              aria-selected={i === hi}
              $active={i === hi}
              tabIndex={-1}
              onMouseDown={(e) => { e.preventDefault(); pick(m); }}
              onMouseEnter={() => setHi(i)}
            >
              {m.name
                ? <OptName><HighlightText text={m.name} query={q} /></OptName>
                : null}
              <OptMail $solo={!m.name}><HighlightText text={m.email} query={q} /></OptMail>
              {m.client && <OptTag>{t('compose.suggestClient', { defaultValue: '고객' }) as string}</OptTag>}
            </Opt>
          ))}
        </Menu>,
        document.body,
      )}
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
  font-size: 0.75rem; font-weight: 600; line-height: 18px;
  color: ${(p) => (p.$bad ? '#B91C1C' : '#0F766E')};
  background: ${(p) => (p.$bad ? '#FEE2E2' : '#F0FDFA')};
  border: 1px solid ${(p) => (p.$bad ? '#FCA5A5' : '#99F6E4')};
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
`;
const Del = styled.button`
  flex-shrink: 0; width: 16px; height: 16px; padding: 0;
  display: inline-flex; align-items: center; justify-content: center;
  background: none; border: none; cursor: pointer; font-size: 0.875rem; line-height: 1;
  color: inherit; opacity: 0.65; font-family: inherit;
  &:hover { opacity: 1; }
`;
const Field = styled.input`
  flex: 1; min-width: 140px; height: 24px; padding: 0 2px;
  border: none; outline: none; background: transparent;
  font-size: 0.8125rem; color: #0F172A; font-family: inherit;
  &::placeholder { color: #94A3B8; }
`;
// 추천 목록 — PlanQSelect 메뉴와 같은 생김새(흰 바탕·회색 테두리·그림자). 포털이라 z-index 는 모달 위.
const Menu = styled.div`
  position: fixed; z-index: 10000; box-sizing: border-box;
  min-width: 220px; overflow-y: auto; padding: 4px;
  background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 8px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.14);
`;
const Opt = styled.button<{ $active: boolean }>`
  display: flex; align-items: center; gap: 8px; width: 100%; min-height: 36px;
  padding: 6px 10px; border: none; border-radius: 6px; cursor: pointer; text-align: left;
  font-family: inherit; background: ${(p) => (p.$active ? '#F0FDFA' : 'transparent')};
  @media (max-width: 640px) { min-height: 40px; }
`;
const OptName = styled.span`
  flex-shrink: 1; min-width: 0; max-width: 45%;
  font-size: 0.8125rem; font-weight: 600; color: #0F172A;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
`;
const OptMail = styled.span<{ $solo: boolean }>`
  flex: 1; min-width: 0;
  font-size: ${(p) => (p.$solo ? '0.8125rem' : '0.75rem')}; color: ${(p) => (p.$solo ? '#0F172A' : '#64748B')};
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
`;
const OptTag = styled.span`
  flex-shrink: 0; padding: 1px 6px; border-radius: 4px;
  font-size: 0.6875rem; font-weight: 600; color: #0F766E; background: #F0FDFA;
`;
