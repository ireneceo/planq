// 일정 분류 고르기 — 칩 + «＋ 분류»(그 자리에서 만들기) + 대표/관리자에게만 ⚙ «분류 관리» (2026-11-27)
//   설계 docs/CALENDAR_CATEGORIES_DESIGN.md §8. 새 일정 창(NewEventModal)과 일정 상세(EventDrawer)가 같이 쓴다.
//   값은 분류 id. 아직 id 가 없는(옛 시드·업무→일정) 값은 fallbackCode 로 그 워크스페이스의 시스템 분류를 고른다.
//   ★ 꺼진 분류는 칩에서 빠진다. 단 «지금 이 일정의 값» 이면 칩으로 보인다(상세) — 다른 값을 고르면 다시 고를 수 없다.
import { useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { isEnterAction } from '../../utils/imeKey';
import CategoryManager from './CategoryManager';
import {
  useCalendarCategories, categoryLabel, CATEGORY_SWATCHES, CATEGORY_NAME_MAX,
  type CalendarCategoryRow, type CalendarCategoryRef,
} from './calendarCategories';

interface Props {
  businessId: number | null | undefined;
  /** 고른 분류 id — null 이면 fallbackCode 의 시스템 분류 */
  value: number | null;
  fallbackCode?: string | null;
  /** 새 일정 창: Cue 가 고른 분류 이름(시스템 code 가 아닐 때) — 이름이 맞는 분류를 먼저 고른다 */
  fallbackName?: string | null;
  /** 상세: 지금 이 일정의 분류(꺼진 것이라도 칩으로 보인다) */
  currentRef?: CalendarCategoryRef | null;
  onChange: (cat: CalendarCategoryRow) => void;
  disabled?: boolean;
  /** 새 일정 창: 값이 없으면 기본(fallbackCode → 업무 → 첫 활성)을 골라 알려 준다 */
  autoResolve?: boolean;
  size?: 'md' | 'sm';
  testId?: string;
}

export default function CategoryPicker({
  businessId, value, fallbackCode, fallbackName, currentRef, onChange, disabled, autoResolve, size = 'md', testId = 'event-category',
}: Props) {
  const { t } = useTranslation('qcalendar');
  const { categories, canManage, loaded, reload, api } = useCalendarCategories(businessId);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [manageOpen, setManageOpen] = useState(false);

  const chips: CalendarCategoryRow[] = [...categories];
  if (currentRef && !chips.some((c) => c.id === currentRef.id)) chips.push(currentRef);
  const selectedId = value ?? (chips.find((c) => c.code === (fallbackCode || '')) || null)?.id ?? currentRef?.id ?? null;

  // 새 일정 창 — 시드 code 가 꺼졌거나 없으면 업무 → 첫 활성으로(서버 기본과 같은 규칙)
  useEffect(() => {
    if (!autoResolve || !loaded || value !== null || !categories.length) return;
    const key = (fallbackName || '').normalize('NFC').trim().toLowerCase();
    const byName = key ? categories.find((c) => categoryLabel(c, t).normalize('NFC').trim().toLowerCase() === key) : null;
    const pick = byName || categories.find((c) => c.code === fallbackCode) || categories.find((c) => c.code === 'work') || categories[0];
    if (pick) onChange(pick);
  }, [autoResolve, loaded, value, categories, fallbackCode, fallbackName, onChange, t]);

  const errText = (code?: string | null) => t(`categories.err.${code || 'generic'}`, { defaultValue: t('categories.err.generic', '저장하지 못했습니다. 다시 시도하세요.') as string }) as string;

  const create = async () => {
    const n = name.trim();
    if (!n || busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await api.create(n, color);
      if (!r.ok) { setErr(errText(r.message)); return; }
      const row = r.data as CalendarCategoryRow;
      setName(''); setColor(null); setAdding(false);
      await reload();
      onChange(row);
    } finally { setBusy(false); }
  };

  return (
    <Wrap data-testid={testId}>
      <Row>
        {chips.map((c) => (
          <Chip
            key={c.id} type="button" $size={size} $active={selectedId === c.id} disabled={disabled}
            data-testid={`${testId}-chip`} data-category-id={c.id}
            onClick={() => { if (!disabled && selectedId !== c.id) onChange(c); }}
          >
            {c.color && <Dot $color={c.color} aria-hidden />}
            {categoryLabel(c, t)}
          </Chip>
        ))}
        {!disabled && !adding && (
          <GhostChip type="button" $size={size} data-testid={`${testId}-add-open`} onClick={() => { setAdding(true); setErr(null); }}>
            ＋ {t('categories.add', '분류')}
          </GhostChip>
        )}
        {!disabled && canManage && (
          <GhostChip type="button" $size={size} data-testid={`${testId}-manage-open`}
            aria-label={t('categories.manage', '분류 관리') as string} title={t('categories.manage', '분류 관리') as string}
            onClick={() => setManageOpen(true)}>
            ⚙ <span className="label">{t('categories.manageShort', '관리')}</span>
          </GhostChip>
        )}
      </Row>
      {adding && (
        <AddBox>
          <AddRow>
            <NameInput
              autoFocus value={name} maxLength={CATEGORY_NAME_MAX} data-testid={`${testId}-add-name`}
              placeholder={t('categories.newPh', '새 분류 이름') as string}
              onChange={(e) => { setName(e.target.value); setErr(null); }}
              onKeyDown={(e) => {
                if (isEnterAction(e)) { e.preventDefault(); e.stopPropagation(); void create(); }
                if (e.key === 'Escape') { e.stopPropagation(); setAdding(false); setName(''); setErr(null); }
              }}
            />
            <SmallBtn type="button" $tone="primary" disabled={busy || !name.trim()} data-testid={`${testId}-add-save`} onClick={() => void create()}>
              {busy ? t('categories.creating', '만드는 중…') : t('categories.create', '만들기')}
            </SmallBtn>
            <SmallBtn type="button" onClick={() => { setAdding(false); setName(''); setErr(null); }}>{t('categories.cancel', '취소')}</SmallBtn>
          </AddRow>
          <Swatches role="radiogroup" aria-label={t('categories.color', '색') as string}>
            {CATEGORY_SWATCHES.map((hex) => (
              <Swatch key={hex} type="button" role="radio" aria-checked={color === hex} $color={hex} $active={color === hex}
                aria-label={hex} onClick={() => setColor(color === hex ? null : hex)} />
            ))}
          </Swatches>
        </AddBox>
      )}
      {err && <ErrText role="alert">{err}</ErrText>}
      {canManage && <CategoryManager open={manageOpen} onClose={() => setManageOpen(false)} businessId={businessId} />}
    </Wrap>
  );
}

const Wrap = styled.div`display: flex; flex-direction: column; gap: 6px; min-width: 0;`;
const Row = styled.div`display: flex; flex-wrap: wrap; gap: 6px;`;
const Chip = styled.button<{ $active: boolean; $size: 'md' | 'sm' }>`
  display: inline-flex; align-items: center; gap: 5px;
  padding: ${({ $size }) => ($size === 'sm' ? '5px 10px' : '6px 12px')}; border-radius: 999px;
  font-size: ${({ $size }) => ($size === 'sm' ? '0.71875rem' : '0.75rem')}; font-weight: 500;
  background: ${({ $active }) => ($active ? '#14B8A6' : '#F1F5F9')};
  color: ${({ $active }) => ($active ? '#fff' : '#475569')};
  border: none; cursor: pointer; max-width: 100%;
  &:hover:not(:disabled) { background: ${({ $active }) => ($active ? '#0D9488' : '#E2E8F0')}; }
  &:disabled { cursor: default; opacity: 0.6; }
`;
const GhostChip = styled.button<{ $size: 'md' | 'sm' }>`
  display: inline-flex; align-items: center; gap: 4px;
  padding: ${({ $size }) => ($size === 'sm' ? '4px 10px' : '5px 12px')}; border-radius: 999px;
  font-size: ${({ $size }) => ($size === 'sm' ? '0.71875rem' : '0.75rem')}; font-weight: 600;
  background: #fff; color: #0F766E; border: 1px dashed #99F6E4; cursor: pointer;
  &:hover { background: #F0FDFA; border-color: #14B8A6; }
`;
const Dot = styled.span<{ $color: string }>`
  width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; background: ${({ $color }) => $color};
  box-shadow: 0 0 0 1px rgba(255,255,255,0.7);
`;
const AddBox = styled.div`
  display: flex; flex-direction: column; gap: 8px; padding: 8px; border: 1px solid #E2E8F0; border-radius: 8px; background: #F8FAFC;
`;
const AddRow = styled.div`display: flex; align-items: center; gap: 6px; min-width: 0;`;
const NameInput = styled.input`
  flex: 1; min-width: 0; height: 32px; padding: 0 10px;
  border: 1px solid #CBD5E1; border-radius: 6px; font-size: 0.8125rem; color: #0F172A; background: #fff;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 2px rgba(20,184,166,0.15); }
`;
const SmallBtn = styled.button<{ $tone?: 'primary' }>`
  flex-shrink: 0; height: 32px; padding: 0 10px; border-radius: 6px; cursor: pointer;
  font-size: 0.75rem; font-weight: 700;
  border: 1px solid ${({ $tone }) => ($tone === 'primary' ? '#14B8A6' : '#E2E8F0')};
  background: ${({ $tone }) => ($tone === 'primary' ? '#14B8A6' : '#fff')};
  color: ${({ $tone }) => ($tone === 'primary' ? '#fff' : '#475569')};
  &:disabled { opacity: 0.5; cursor: default; }
`;
export const Swatches = styled.div`display: flex; flex-wrap: wrap; gap: 2px;`;
export const Swatch = styled.button<{ $color: string; $active: boolean }>`
  /* 누르는 칸 32 · 그리는 원 22 */
  width: 32px; height: 32px; padding: 0; cursor: pointer; border: none; background: transparent;
  position: relative;
  &::before {
    content: ''; position: absolute; inset: 5px; border-radius: 50%; background: ${({ $color }) => $color};
    box-shadow: 0 0 0 2px #fff, 0 0 0 ${({ $active }) => ($active ? '4px #0F172A' : '3px #E2E8F0')};
  }
`;
const ErrText = styled.div`font-size: 0.75rem; color: #DC2626;`;
