// components/Common/FontScaleSection.tsx — 글씨 크기 (2026-08-30)
//
// 기기별 설정이다(localStorage). 폰과 데스크탑은 필요한 크기가 다르므로 계정에 묶지 않는다.
// 값을 바꾸면 즉시 화면 전체가 따라간다 — 미리보기가 따로 필요 없다(이 화면 자체가 미리보기다).
import { useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { FONT_SCALES, getFontScale, setFontScale, type FontScale } from '../../services/fontScale';

// 라벨은 i18n 키로만 — ko/en 은 locales/{ko,en}/profile.json 의 fontScale.* 가 정본이다.
//   (여기에 한국어 폴백 상수를 두면 하드코딩 래칫에 걸린다 — 실제로 걸렸다)
const LABEL_KEY: Record<number, string> = { 1: 'fontScale.normal', 1.15: 'fontScale.large', 1.3: 'fontScale.xlarge' };

export default function FontScaleSection() {
  const { t } = useTranslation('profile');
  const [scale, setScale] = useState<FontScale>(() => getFontScale());

  // 다른 화면(다른 탭 포함)에서 바꾸면 이 화면의 선택 표시도 따라간다.
  useEffect(() => {
    const onLocal = (e: Event) => setScale((e as CustomEvent).detail?.scale ?? getFontScale());
    const onStorage = () => setScale(getFontScale());
    window.addEventListener('planq:font-scale', onLocal);
    window.addEventListener('storage', onStorage);
    return () => { window.removeEventListener('planq:font-scale', onLocal); window.removeEventListener('storage', onStorage); };
  }, []);

  const pick = (s: FontScale) => { setFontScale(s); setScale(s); };

  return (
    <>
      <Row role="radiogroup" aria-label={t('fontScale.sectionTitle') as string}>
        {FONT_SCALES.map((s) => (
          <Choice
            key={s}
            type="button"
            role="radio"
            aria-checked={scale === s}
            $on={scale === s}
            $scale={s}
            onClick={() => pick(s)}
          >
            <Sample $scale={s}>Aa</Sample>
            <ChoiceLabel>{t(LABEL_KEY[s]) as string}</ChoiceLabel>
          </Choice>
        ))}
      </Row>
      <Hint>{t('fontScale.hint') as string}</Hint>
    </>
  );
}

const Row = styled.div`
  display: flex; gap: 8px; flex-wrap: wrap;
`;
const Choice = styled.button<{ $on: boolean; $scale: number }>`
  flex: 1 1 0; min-width: 88px;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;
  padding: 12px 8px; min-height: 72px;
  border-radius: 10px; cursor: pointer;
  background: ${p => (p.$on ? '#F0FDFA' : '#FFFFFF')};
  border: 1px solid ${p => (p.$on ? '#14B8A6' : '#E2E8F0')};
  box-shadow: ${p => (p.$on ? 'inset 0 0 0 1px #14B8A6' : 'none')};
  &:hover { border-color: ${p => (p.$on ? '#14B8A6' : '#CBD5E1')}; }
`;
/* 견본만 배율을 미리 보여준다 — 고르기 전에 결과를 알 수 있게. rem 이라 루트 배율에도 같이 반응한다. */
const Sample = styled.span<{ $scale: number }>`
  font-weight: 700; color: #0F172A; line-height: 1;
  font-size: ${p => (0.875 * p.$scale).toFixed(4)}rem;
`;
const ChoiceLabel = styled.span`
  font-size: 0.75rem; color: #475569; font-weight: 600;
`;
const Hint = styled.div`
  margin-top: 8px; font-size: 0.75rem; color: #94A3B8; line-height: 1.5;
`;
