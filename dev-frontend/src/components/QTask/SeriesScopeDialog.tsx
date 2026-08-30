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
}

const SeriesScopeDialog: React.FC<Props> = ({ open, onPick, onClose }) => {
  const { t } = useTranslation('qtask');
  useBodyScrollLock(open);
  useEscapeStack(open, onClose);
  if (!open) return null;
  return (
    <Backdrop role="dialog" aria-modal="true" aria-label={t('series.title', '반복 업무 수정') as string} onClick={onClose}>
      <Card onClick={(e) => e.stopPropagation()}>
        <Title>{t('series.title', '반복 업무 수정')}</Title>
        <Desc>{t('series.desc', '이 업무는 반복됩니다. 어디까지 반영할까요?')}</Desc>
        <Opt type="button" onClick={() => onPick('single')}>
          <OptName>{t('series.single', '이 회차만')}</OptName>
          <OptHint>{t('series.singleHint', '다른 회차는 그대로 둡니다')}</OptHint>
        </Opt>
        <Opt type="button" onClick={() => onPick('future')}>
          <OptName>{t('series.future', '이 회차 이후 모두')}</OptName>
          <OptHint>{t('series.futureHint', '지난 회차는 기록으로 남깁니다')}</OptHint>
        </Opt>
        <Opt type="button" onClick={() => onPick('all')}>
          <OptName>{t('series.all', '전체 회차')}</OptName>
          <OptHint>{t('series.allHint', '지난 회차까지 같은 내용으로 맞춥니다')}</OptHint>
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
