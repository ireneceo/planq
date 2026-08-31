// 정기업무 시리즈 편집 범위 선택 (2026-08-25)
//
// 반복업무는 부모 1건 + 회차별 행이고, 회차는 생성 시점에 부모 내용을 복사한다.
// 그래서 내용을 고쳐도 이미 만들어진 회차는 그대로였다(Irene: "왜 모두 안 바뀌어?").
// Q 캘린더 반복 일정은 이미 같은 선택을 묻는다 — 업무만 규칙이 갈라져 있었다. 여기서 맞춘다.
//
// 선택값은 백엔드 PUT 의 series_scope 로 그대로 넘어간다.
import React from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useEscapeStack } from '../../hooks/useEscapeStack';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';

export type SeriesScope = 'single' | 'future' | 'all';

interface Props {
  open: boolean;
  onPick: (scope: SeriesScope) => void;
  onClose: () => void;
  /** 무엇을 고치는 중인가.
   *  'content'  — 제목·설명·담당자 등 시리즈가 공유하는 내용 (이 회차만 / 이후 / 전체 셋 다 성립)
   *  'recurrence' — 반복 주기 그 자체. "이 회차만 다른 주기" 는 성립하지 않고(한 번짜리엔 주기가 없다),
   *                 이미 지나간 회차의 날짜도 뒤로 옮길 수 없다. 그래서 **성립하는 것만** 묻는다 —
   *                 뜻이 없는 선택지를 띄워 놓고 눌러도 아무 일이 없게 두지 않는다. */
  variant?: 'content' | 'recurrence';
}

const SeriesScopeDialog: React.FC<Props> = ({ open, onPick, onClose, variant = 'content' }) => {
  const { t } = useTranslation('qtask');
  useBodyScrollLock(open);
  useEscapeStack(open, onClose);
  if (!open) return null;
  const isRecur = variant === 'recurrence';
  return (
    <Backdrop role="dialog" aria-modal="true" aria-label={(isRecur ? t('series.recurTitle', '반복 설정 변경') : t('series.title', '반복 업무 수정')) as string} onClick={onClose}>
      <Card onClick={(e) => e.stopPropagation()}>
        <Title>{isRecur ? t('series.recurTitle', '반복 설정 변경') : t('series.title', '반복 업무 수정')}</Title>
        <Desc>{isRecur
          ? t('series.recurDesc', '이 반복은 시리즈 전체가 함께 씁니다. 새 주기를 어디부터 적용할까요?')
          : t('series.desc', '이 업무는 반복됩니다. 어디까지 반영할까요?')}</Desc>
        {!isRecur && (
          <Opt type="button" onClick={() => onPick('single')}>
            <OptName>{t('series.single', '이 회차만')}</OptName>
            <OptHint>{t('series.singleHint', '다른 회차는 그대로 둡니다')}</OptHint>
          </Opt>
        )}
        <Opt type="button" onClick={() => onPick('future')}>
          <OptName>{isRecur ? t('series.recurFuture', '이 회차 이후') : t('series.future', '이 회차 이후 모두')}</OptName>
          <OptHint>{isRecur
            ? t('series.recurFutureHint', '이 회차부터 새 주기로 다시 잡습니다. 지난 회차는 그대로 둡니다')
            : t('series.futureHint', '지난 회차는 기록으로 남깁니다')}</OptHint>
        </Opt>
        <Opt type="button" onClick={() => onPick('all')}>
          <OptName>{isRecur ? t('series.recurAll', '앞으로 전부') : t('series.all', '전체 회차')}</OptName>
          <OptHint>{isRecur
            ? t('series.recurAllHint', '오늘 이후의 아직 시작 안 한 회차를 모두 새 주기로 다시 잡습니다')
            : t('series.allHint', '지난 회차까지 같은 내용으로 맞춥니다')}</OptHint>
        </Opt>
        <Cancel type="button" onClick={onClose}>{t('series.cancel', '취소')}</Cancel>
      </Card>
    </Backdrop>
  );
};

export default SeriesScopeDialog;

const Backdrop = styled.div`
  position: fixed; inset: 0; z-index: 1100;
  background: rgba(15, 23, 42, 0.35);
  display: flex; align-items: center; justify-content: center;
  padding: 20px;
`;
const Card = styled.div`
  width: 100%; max-width: 360px;
  background: #fff; border-radius: 14px; padding: 18px;
  box-shadow: 0 20px 50px rgba(15, 23, 42, 0.2);
  display: flex; flex-direction: column; gap: 8px;
  @media (max-width: 640px) { max-width: 100%; }
`;
const Title = styled.h2`margin: 0; font-size: 0.9375rem; font-weight: 700; color: #0F172A;`;
const Desc = styled.p`margin: 0 0 6px; font-size: 0.78125rem; color: #64748B; line-height: 1.5;`;
const Opt = styled.button`
  display: flex; flex-direction: column; align-items: flex-start; gap: 2px;
  width: 100%; padding: 11px 12px; min-height: 44px;
  background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 10px;
  cursor: pointer; text-align: left;
  &:hover { background: #F0FDFA; border-color: #99F6E4; }
`;
const OptName = styled.span`font-size: 0.84375rem; font-weight: 600; color: #0F172A;`;
const OptHint = styled.span`font-size: 0.71875rem; color: #94A3B8;`;
const Cancel = styled.button`
  align-self: flex-end; margin-top: 4px;
  padding: 8px 12px; min-height: 36px;
  background: none; border: none; color: #64748B; font-size: 0.78125rem; cursor: pointer;
  &:hover { color: #0F172A; }
`;
