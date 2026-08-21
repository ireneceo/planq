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
import SingleDateField from './SingleDateField';
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
    // 운영 #347 — 화면이 표현 못 하는 규칙(advanced)은 **원문을 그대로 돌려준다**.
    //   여기서 다시 만들면 BYSETPOS·다중 BYDAY 가 통째로 날아간다(옛 회귀의 정확한 지점).
    if (next.preset === 'advanced') {
      onChange(next.rawRule || null);
      return;
    }
    const rrule = next.preset === 'custom'
      ? buildCustomRRule(next.customEvery, next.customUnit, end)
      : buildPresetRRule(next.preset, anchorDate, end, { nthPos: next.nthPos, nthDay: next.nthDay });
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

  // 운영 #347 — 실제로 많이 쓰는 규칙(평일 매일·분기·매월 n번째 요일)을 화면에서 만들 수 있게 한다.
  //   'advanced' 는 목록에 넣지 않는다 — 사용자가 고르는 값이 아니라, 화면이 표현 못 하는 규칙을
  //   **보존하는 상태**다(아래 안내 뱃지로만 노출).
  const presetOptions: { value: RecurPreset; label: string }[] = [
    { value: 'daily', label: t('recur.presetDaily', '매일') },
    { value: 'weekdays', label: t('recur.weekdays', '평일 매일') },
    { value: 'weekly', label: t('recur.presetWeekly', { day: '', defaultValue: '매주' }) as string },
    { value: 'biweekly', label: t('recur.presetBiweekly', { day: '', defaultValue: '격주' }) as string },
    { value: 'monthly', label: t('recur.presetMonthly', { day: '', defaultValue: '매월' }) as string },
    { value: 'monthlyNthWeekday', label: t('recur.presetMonthlyNth', '매월 n번째 요일') },
    { value: 'monthlyLastWeekday', label: t('recur.monthlyLastWeekday', '매월 마지막 평일') },
    { value: 'quarterly', label: t('recur.quarterly', '분기마다') },
    { value: 'yearly', label: t('recur.presetYearly', { month: '', day: '', defaultValue: '매년' }) as string },
    { value: 'custom', label: t('recur.presetCustom', '사용자 지정') },
  ];

  const nthPosOptions = [1, 2, 3, 4, -1].map((n) => ({
    value: n,
    label: n === -1
      ? (t('recur.nthLast', '마지막') as string)
      : (t('recur.nthN', { n, defaultValue: `${n}번째` }) as string),
  }));
  const nthDayOptions = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'].map((c) => ({
    value: c, label: t(`recur.weekday.${c}`, c) as string,
  }));

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
          {/* 운영 #347 — 화면이 표현하지 못하는 규칙. 규칙은 그대로 살아 있고, 여기서 프리셋을
              **직접 고를 때만** 바뀐다는 사실을 말한다. 여태 이 상태가 조용히 'custom' 으로
              떨어져 다른 필드만 고쳐 저장해도 규칙이 축소됐다. */}
          {state.preset === 'advanced' && (
            <AdvancedNotice>
              <AdvancedBadge>{t('recur.advancedBadge', '사용자 지정 규칙')}</AdvancedBadge>
              <span>{t('recur.advancedHint', '이 반복 규칙은 그대로 유지됩니다. 아래에서 다른 주기를 고르면 그때 바뀝니다.')}</span>
            </AdvancedNotice>
          )}
          <Field>
            <FieldLabel>{t('recur.presetLabel', '반복 주기')}</FieldLabel>
            <PlanQSelect
              size="sm"
              isDisabled={disabled}
              placeholder={state.preset === 'advanced'
                ? (t('recur.advancedBadge', '사용자 지정 규칙') as string)
                : undefined}
              value={presetOptions.find(o => o.value === state.preset) || null}
              onChange={(v) => {
                const p = (v as { value?: RecurPreset })?.value;
                if (p) update({ preset: p });
              }}
              options={presetOptions}
            />
          </Field>

          {/* 운영 #347 — 매월 n번째 X요일 (BYSETPOS). 여태 화면에서 만들 수 없어 API 로만 넣을 수 있었다. */}
          {state.preset === 'monthlyNthWeekday' && (
            <Field>
              <FieldLabel>{t('recur.nthLabel', '몇 번째 무슨 요일')}</FieldLabel>
              <Inline>
                <PlanQSelect
                  size="sm"
                  isDisabled={disabled}
                  value={nthPosOptions.find(o => o.value === state.nthPos) || nthPosOptions[0]}
                  onChange={(v) => {
                    const n = (v as { value?: number })?.value;
                    if (n != null) update({ nthPos: n });
                  }}
                  options={nthPosOptions}
                />
                <PlanQSelect
                  size="sm"
                  isDisabled={disabled}
                  value={nthDayOptions.find(o => o.value === state.nthDay) || nthDayOptions[0]}
                  onChange={(v) => {
                    const d = (v as { value?: string })?.value;
                    if (d) update({ nthDay: d });
                  }}
                  options={nthDayOptions}
                />
              </Inline>
            </Field>
          )}

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
              <SingleDateField
                value={state.endUntil}
                minDate={anchorDate || undefined}
                disabled={disabled}
                onChange={(d) => update({ endUntil: d })}
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
const EveryHint = styled.span`
  font-size: 12px; color: #64748B; font-weight: 500;
`;
const Preview = styled.div`
  font-size: 12px; color: #475569; padding: 6px 10px;
  background: #FFF; border: 1px dashed #CBD5E1; border-radius: 6px;
  strong { color: #0F766E; font-weight: 700; }
`;

const AdvancedNotice = styled.div`
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  margin-bottom: 10px; padding: 8px 10px;
  background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px;
  font-size: 11.5px; line-height: 1.5; color: #64748B;
`;
const AdvancedBadge = styled.span`
  flex-shrink: 0; padding: 2px 7px; border-radius: 999px;
  background: #E2E8F0; color: #475569; font-size: 10.5px; font-weight: 700;
`;
