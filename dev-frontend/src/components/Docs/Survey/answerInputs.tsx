// 설문 문항 입력 3종 — 별점(1~5) · 척도(0~10, NPS) · 예/아니오. 설계 docs/SURVEY_V2_DESIGN.md §4·§8.5
//
// 공개 응답 화면 · 질문지 카드 미리보기 · 표 셀 편집기가 **같은 컴포넌트**를 쓴다(세 곳이 따로 그리면 모양이 갈라진다).
// size='lg' = 공개 화면(폰 터치 44px) · 'sm' = 표 셀(행 높이 안).
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';

type Size = 'sm' | 'lg';

export const RatingInput: React.FC<{ value: number | null; onChange?: (v: number | null) => void; size?: Size; readOnly?: boolean; label?: string }> = ({ value, onChange, size = 'lg', readOnly, label }) => {
  const { t } = useTranslation('qtable');
  return (
    <Stars role="radiogroup" aria-label={label} $size={size}>
      {[1, 2, 3, 4, 5].map((n) => {
        const on = value != null && n <= value;
        return (
          <Star key={n} type="button" role="radio" aria-checked={value === n} $on={on} $size={size} disabled={readOnly}
            aria-label={t('survey.answer.starN', { defaultValue: '{{n}}점', n }) as string}
            onClick={() => onChange?.(value === n ? null : n)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8l2.84 5.76 6.36.92-4.6 4.49 1.08 6.33L12 17.31l-5.68 2.99 1.08-6.33-4.6-4.49 6.36-.92z" /></svg>
          </Star>
        );
      })}
    </Stars>
  );
};

export const ScaleInput: React.FC<{ value: number | null; onChange?: (v: number | null) => void; size?: Size; readOnly?: boolean; label?: string; showEnds?: boolean }> = ({ value, onChange, size = 'lg', readOnly, label, showEnds = true }) => {
  const { t } = useTranslation('qtable');
  return (
    <div>
      <Pills role="radiogroup" aria-label={label} $size={size}>
        {Array.from({ length: 11 }, (_, n) => (
          <Pill key={n} type="button" role="radio" aria-checked={value === n} $on={value === n} $size={size} disabled={readOnly}
            onClick={() => onChange?.(value === n ? null : n)}>{n}</Pill>
        ))}
      </Pills>
      {showEnds && size === 'lg' && (
        <Ends><span>{t('survey.public.scaleLow', '전혀 아니다')}</span><span>{t('survey.public.scaleHigh', '매우 그렇다')}</span></Ends>
      )}
    </div>
  );
};

export const YesNoInput: React.FC<{ value: boolean | null; onChange?: (v: boolean | null) => void; size?: Size; readOnly?: boolean; label?: string }> = ({ value, onChange, size = 'lg', readOnly, label }) => {
  const { t } = useTranslation('qtable');
  return (
    <Pair role="radiogroup" aria-label={label}>
      {[true, false].map((b) => (
        <YN key={String(b)} type="button" role="radio" aria-checked={value === b} $on={value === b} $size={size} disabled={readOnly}
          onClick={() => onChange?.(value === b ? null : b)}>
          {b ? t('survey.public.yes', '예') : t('survey.public.no', '아니오')}
        </YN>
      ))}
    </Pair>
  );
};

/** 셀·목록에서 값만 글로 — 별점 «★★★★☆ 4», 척도 «7», 예/아니오 «예». */
export function answerText(type: string, v: unknown, yes: string, no: string): string {
  if (v === undefined || v === null || v === '') return '';
  if (type === 'rating') { const n = Number(v); return Number.isFinite(n) ? `${'★'.repeat(Math.max(0, Math.min(5, n)))}${'☆'.repeat(Math.max(0, 5 - n))} ${n}` : String(v); }
  if (type === 'yesno') return v === true || v === 'true' ? yes : no;
  return String(v);
}

const Stars = styled.div<{ $size: Size }>`display: flex; gap: ${(p) => (p.$size === 'lg' ? '6px' : '0')}; align-items: center;`;
const Star = styled.button<{ $on: boolean; $size: Size }>`
  width: ${(p) => (p.$size === 'lg' ? '44px' : '22px')}; height: ${(p) => (p.$size === 'lg' ? '44px' : '22px')};
  display: inline-flex; align-items: center; justify-content: center; padding: 0; border: 0; background: transparent; cursor: pointer;
  svg { width: ${(p) => (p.$size === 'lg' ? '30px' : '16px')}; height: ${(p) => (p.$size === 'lg' ? '30px' : '16px')};
    fill: ${(p) => (p.$on ? '#F59E0B' : 'transparent')}; stroke: ${(p) => (p.$on ? '#F59E0B' : '#CBD5E1')}; stroke-width: 1.6; stroke-linejoin: round; }
  &:disabled { cursor: default; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 1px; border-radius: 6px; }
`;
const Pills = styled.div<{ $size: Size }>`
  display: flex; flex-wrap: wrap; gap: ${(p) => (p.$size === 'lg' ? '6px' : '2px')};
`;
const Pill = styled.button<{ $on: boolean; $size: Size }>`
  min-width: ${(p) => (p.$size === 'lg' ? '40px' : '22px')}; height: ${(p) => (p.$size === 'lg' ? '40px' : '22px')};
  padding: 0 ${(p) => (p.$size === 'lg' ? '6px' : '2px')}; border-radius: ${(p) => (p.$size === 'lg' ? '10px' : '6px')};
  font-size: ${(p) => (p.$size === 'lg' ? '0.9375rem' : '0.6875rem')}; font-weight: 600; cursor: pointer;
  border: 1px solid ${(p) => (p.$on ? '#14B8A6' : '#E2E8F0')};
  background: ${(p) => (p.$on ? '#14B8A6' : '#FFF')}; color: ${(p) => (p.$on ? '#FFF' : '#334155')};
  &:disabled { cursor: default; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 1px; }
  @media (max-width: 640px) { ${(p) => (p.$size === 'lg' ? 'min-width: 44px; height: 44px;' : '')} }
`;
const Ends = styled.div`display: flex; justify-content: space-between; margin-top: 6px; font-size: 0.75rem; color: #94A3B8;`;
const Pair = styled.div`display: flex; gap: 8px;`;
const YN = styled.button<{ $on: boolean; $size: Size }>`
  min-width: ${(p) => (p.$size === 'lg' ? '96px' : '40px')}; height: ${(p) => (p.$size === 'lg' ? '44px' : '24px')};
  padding: 0 ${(p) => (p.$size === 'lg' ? '16px' : '8px')}; border-radius: 999px; cursor: pointer;
  font-size: ${(p) => (p.$size === 'lg' ? '0.9375rem' : '0.75rem')}; font-weight: 600;
  border: 1px solid ${(p) => (p.$on ? '#14B8A6' : '#E2E8F0')};
  background: ${(p) => (p.$on ? '#F0FDFA' : '#FFF')}; color: ${(p) => (p.$on ? '#0F766E' : '#334155')};
  &:disabled { cursor: default; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 1px; }
`;
