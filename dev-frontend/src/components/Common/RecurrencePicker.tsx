// 공통 반복 설정 컴포넌트 — Q Calendar / (향후) Q Task 가 공유.
//
// 외부 인터페이스:
//   value:       현재 RRULE 문자열 (null = 반복 없음)
//   onChange:    (rrule: string | null) => void
//   anchorDate:  YYYY-MM-DD — 반복의 첫 occurrence (요일/일자 추출 기준).
//                Q Calendar=startDate / Q Task=due_date.
//   disabled?:   필수 필드 (anchorDate) 미입력 등으로 비활성
//
// 내부:
//   - 저장된 RRULE 을 parseRRule 로 폼 상태로 역직렬화 (편집 UX).
//   - preset 6종: daily / weekly / biweekly / monthly / yearly / custom
//   - custom 선택 시 inline-expand 로 every N + 단위 입력 (모달 X — 같은 영역 펼침)
//   - 종료 조건 3종: never / count(N회) / until(특정 날짜)
//   - anchor 변경 시 자동 재빌드 (요일·일자 정보 갱신)
//
// 30년차 안정성 원칙:
//   - anchor 없으면 비활성 + 안내 (반복 첫 시점이 정의 안 되면 RRULE 의미 없음)
//   - 모든 RRULE 빌더는 utils/recurrence.ts 단일 출처 — 이 컴포넌트는 UI 만
//   - 유효성 가드: every >= 1, count >= 1, until > anchorDate 권장 (UI 만 — 백엔드 fallback OK)

import React, { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import PlanQSelect from './PlanQSelect';
import {
  buildPresetRRule, buildCustomRRule, parseRRule, formatRRuleLabel, emptyRecurState,
  type RecurPreset, type RecurEndType, type RecurCustomUnit, type RecurState,
} from '../../utils/recurrence';

interface Props {
  value: string | null | undefined;
  onChange: (rrule: string | null) => void;
  anchorDate: string | null | undefined; // YYYY-MM-DD
  disabled?: boolean;
}

const RecurrencePicker: React.FC<Props> = ({ value, onChange, anchorDate, disabled }) => {
  const { t } = useTranslation('qtask'); // recur.* 키는 qtask 네임스페이스 (기존 자산 재사용)

  // 저장된 RRULE → 폼 상태로 1회 역직렬화 (key=value 변경 시 재실행)
  const [state, setState] = useState<RecurState>(() => parseRRule(value || null));
  // anchorDate 가 없으면 토글이 켜져있어도 의미 없음 — 사용자에게 안내만 표시
  const noAnchor = !anchorDate;

  // 외부 value 가 바뀌면 (다른 이벤트 선택 등) state 재계산
  const lastValueRef = useRef<string | null | undefined>(value);
  useEffect(() => {
    if (lastValueRef.current === value) return;
    lastValueRef.current = value;
    setState(parseRRule(value || null));
  }, [value]);

  // 폼 → RRULE 직렬화 → onChange.
  // anchor 가 있고 enabled 일 때만 RRULE 생성. 그 외엔 null.
  const buildAndPropagate = (next: RecurState) => {
    if (!next.enabled || !anchorDate) {
      onChange(null);
      return;
    }
    const end = {
      type: next.endType,
      count: next.endCount,
      until: next.endUntil || undefined,
    };
    const rrule = next.preset === 'custom'
      ? buildCustomRRule(next.customEvery, next.customUnit, end)
      : buildPresetRRule(next.preset, anchorDate, end);
    onChange(rrule);
  };

  const update = (patch: Partial<RecurState>) => {
    const next = { ...state, ...patch };
    setState(next);
    buildAndPropagate(next);
  };

  // anchorDate 변경 시 — preset 의 BYDAY/BYMONTHDAY 가 anchor 따라가야 하므로 재빌드
  const lastAnchorRef = useRef<string | null | undefined>(anchorDate);
  useEffect(() => {
    if (lastAnchorRef.current === anchorDate) return;
    lastAnchorRef.current = anchorDate;
    if (state.enabled) buildAndPropagate(state);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorDate]);

  // 미리보기 라벨 — value 가 곧 우리가 빌드한 결과
  const previewLabel = value
    ? formatRRuleLabel(value, anchorDate, t as unknown as TFunction)
    : '';

  const presetOptions: { value: RecurPreset; label: string }[] = [
    { value: 'daily', label: t('recur.presetDaily', '매일') },
    { value: 'weekly', label: t('recur.presetWeekly', { day: '', defaultValue: '매주' }) as string },
    { value: 'biweekly', label: t('recur.presetBiweekly', { day: '', defaultValue: '격주' }) as string },
    { value: 'monthly', label: t('recur.presetMonthly', { day: '', defaultValue: '매월' }) as string },
    { value: 'yearly', label: t('recur.presetYearly', { month: '', day: '', defaultValue: '매년' }) as string },
    { value: 'custom', label: t('recur.presetCustom', '사용자 지정') },
  ];

  const unitOptions: { value: RecurCustomUnit; label: string }[] = [
    { value: 'day', label: t('recur.customUnitDay', '일') },
    { value: 'week', label: t('recur.customUnitWeek', '주') },
    { value: 'month', label: t('recur.customUnitMonth', '개월') },
    { value: 'year', label: t('recur.customUnitYear', '년') },
  ];

  const endOptions: { value: RecurEndType; label: string }[] = [
    { value: 'never', label: t('recur.endTypeNever', '계속 반복') },
    { value: 'count', label: t('recur.endTypeCount', '횟수 후 종료') },
    { value: 'until', label: t('recur.endTypeUntil', '특정 날짜까지') },
  ];

  return (
    <Wrap>
      <ToggleRow>
        <ToggleLabel>
          <input
            type="checkbox"
            checked={state.enabled}
            disabled={disabled || noAnchor}
            onChange={(e) => {
              if (!e.target.checked) {
                const next = emptyRecurState();
                setState(next);
                onChange(null);
              } else {
                update({ enabled: true });
              }
            }}
          />
          <span>{t('recur.toggle', '반복하기')}</span>
        </ToggleLabel>
        {noAnchor && (
          <Hint>{t('recur.needAnchor', '반복하려면 시작 날짜가 필요해요')}</Hint>
        )}
      </ToggleRow>

      {state.enabled && !noAnchor && (
        <>
          <Field>
            <FieldLabel>{t('recur.presetLabel', '반복 주기')}</FieldLabel>
            <PlanQSelect
              size="sm"
              isDisabled={disabled}
              value={presetOptions.find(o => o.value === state.preset) || presetOptions[1]}
              onChange={(v) => {
                const p = (v as { value?: RecurPreset })?.value;
                if (p) update({ preset: p });
              }}
              options={presetOptions}
            />
          </Field>

          {state.preset === 'custom' && (
            <Field>
              <FieldLabel>{t('recur.customEvery', '반복 간격')}</FieldLabel>
              <Inline>
                <NumInput
                  type="number"
                  min={1}
                  max={99}
                  disabled={disabled}
                  value={state.customEvery}
                  onChange={(e) => {
                    const n = Math.max(1, Math.min(99, parseInt(e.target.value || '1', 10) || 1));
                    update({ customEvery: n });
                  }}
                />
                <PlanQSelect
                  size="sm"
                  isDisabled={disabled}
                  value={unitOptions.find(o => o.value === state.customUnit) || unitOptions[1]}
                  onChange={(v) => {
                    const u = (v as { value?: RecurCustomUnit })?.value;
                    if (u) update({ customUnit: u });
                  }}
                  options={unitOptions}
                />
                <EveryHint>{t('recur.everySuffix', '마다')}</EveryHint>
              </Inline>
            </Field>
          )}

          <Field>
            <FieldLabel>{t('recur.endLabel', '종료 조건')}</FieldLabel>
            <PlanQSelect
              size="sm"
              isDisabled={disabled}
              value={endOptions.find(o => o.value === state.endType) || endOptions[0]}
              onChange={(v) => {
                const e = (v as { value?: RecurEndType })?.value;
                if (e) update({ endType: e });
              }}
              options={endOptions}
            />
          </Field>

          {state.endType === 'count' && (
            <Field>
              <FieldLabel>{t('recur.endCountLabel', '반복 횟수')}</FieldLabel>
              <Inline>
                <NumInput
                  type="number"
                  min={1}
                  max={999}
                  disabled={disabled}
                  value={state.endCount}
                  onChange={(e) => {
                    const n = Math.max(1, Math.min(999, parseInt(e.target.value || '1', 10) || 1));
                    update({ endCount: n });
                  }}
                />
                <EveryHint>{t('recur.endCountSuffix', '회 후 종료')}</EveryHint>
              </Inline>
            </Field>
          )}

          {state.endType === 'until' && (
            <Field>
              <FieldLabel>{t('recur.endUntilLabel', '종료 날짜')}</FieldLabel>
              <DateInput
                type="date"
                disabled={disabled}
                value={state.endUntil}
                min={anchorDate || undefined}
                onChange={(e) => update({ endUntil: e.target.value })}
              />
            </Field>
          )}

          {previewLabel && (
            <Preview>
              {t('recur.preview', '미리보기')}: <strong>{previewLabel}</strong>
            </Preview>
          )}
        </>
      )}
    </Wrap>
  );
};

export default RecurrencePicker;

const Wrap = styled.div`
  display: flex; flex-direction: column; gap: 10px;
  padding: 10px 12px;
  background: #F8FAFC;
  border: 1px solid #E2E8F0;
  border-radius: 8px;
`;
const ToggleRow = styled.div`
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
`;
const ToggleLabel = styled.label`
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 13px; font-weight: 600; color: #0F172A; cursor: pointer;
  input { width: 16px; height: 16px; accent-color: #14B8A6; cursor: pointer; }
  input:disabled { cursor: not-allowed; opacity: 0.5; }
`;
const Hint = styled.span`
  font-size: 11px; color: #94A3B8; font-weight: 500;
`;
const Field = styled.div`
  display: flex; flex-direction: column; gap: 4px;
`;
const FieldLabel = styled.label`
  font-size: 11px; font-weight: 600; color: #64748B;
`;
const Inline = styled.div`
  display: flex; align-items: center; gap: 6px;
`;
const NumInput = styled.input`
  width: 60px; padding: 6px 8px;
  border: 1px solid #E2E8F0; border-radius: 6px;
  font-size: 13px; font-weight: 600; color: #0F172A; background: #FFF;
  &:focus { outline: none; border-color: #14B8A6; }
  &:disabled { background: #F1F5F9; color: #94A3B8; cursor: not-allowed; }
`;
const DateInput = styled.input`
  padding: 6px 8px;
  border: 1px solid #E2E8F0; border-radius: 6px;
  font-size: 13px; color: #0F172A; background: #FFF;
  &:focus { outline: none; border-color: #14B8A6; }
  &:disabled { background: #F1F5F9; color: #94A3B8; cursor: not-allowed; }
`;
const EveryHint = styled.span`
  font-size: 12px; color: #64748B; font-weight: 500;
`;
const Preview = styled.div`
  font-size: 12px; color: #475569; padding: 6px 10px;
  background: #FFF; border: 1px dashed #CBD5E1; border-radius: 6px;
  strong { color: #0F766E; font-weight: 700; }
`;
