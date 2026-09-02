// 업무 중요도 칩 (#353 ⑤) — **공용 하나.** 목록·팝아웃·프로젝트 목록이 같은 것을 쓴다.
//   각자 styled 를 다시 선언하면 반드시 갈라진다(memory feedback_copied_component_drifts_extract_shell).
//
// ★ 버튼이 아니라 **텍스트 칩**이다 — 누르는 것이 아니므로 "액션 버튼 3톤" 규칙의 대상이 아니고,
//   상태 색을 배경에 칠하지 않는다(글자·테두리에만). UI_DESIGN_GUIDE 1.7 과 충돌하지 않는다.
//
// ★ **높음·긴급만 그린다.** 보통·낮음까지 그리면 목록의 거의 모든 행에 칩이 붙어
//   "중요하다" 는 신호가 아니라 배경 소음이 된다. 미지정도 안 그린다(운영 옛 업무 전부 미지정).
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';

export type PriorityLevel = 'low' | 'normal' | 'high' | 'urgent' | null | undefined;

const Chip = styled.span<{ $urgent: boolean }>`
  display: inline-flex; align-items: center;
  padding: 1px 6px; border-radius: 4px;
  font-size: 0.6875rem; font-weight: 700; line-height: 1.5;
  white-space: nowrap;
  color: ${p => (p.$urgent ? '#F43F5E' : '#B45309')};
  border: 1px solid ${p => (p.$urgent ? '#FECDD3' : '#FDE68A')};
  background: ${p => (p.$urgent ? '#FFF1F2' : '#FFFBEB')};
`;

export default function ImportanceChip({ level }: { level: PriorityLevel }) {
  const { t } = useTranslation('qtask');
  if (level !== 'high' && level !== 'urgent') return null;
  return (
    <Chip $urgent={level === 'urgent'} title={t('importance.label', { defaultValue: '중요도' }) as string}>
      {t(`importance.${level}`, { defaultValue: level === 'urgent' ? '긴급' : '높음' }) as string}
    </Chip>
  );
}
