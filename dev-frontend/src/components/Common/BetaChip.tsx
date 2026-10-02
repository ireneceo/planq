// BetaChip — 다듬는 중인 메뉴의 「베타」 글자 칩 (#449, Irene 결정 2026-10-02)
//
// ★ 어느 메뉴가 베타인지는 `config/navMenus.ts` 의 `maturity: 'beta'` **한 곳**이 정한다.
//   화면마다 조건을 적으면 사이드바엔 붙고 검색엔 안 붙는 식으로 갈라진다.
// ★ 아이콘이 아니라 글자다 — 아이콘만 두면 뜻을 안 알려주면서 자리를 먹는다.
import React from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { isBetaPath } from '../../config/navMenus';

export const BetaChip: React.FC<{ path: string; className?: string }> = ({ path, className }) => {
  const { t } = useTranslation('layout');
  if (!isBetaPath(path)) return null;
  return (
    <Chip className={className} data-testid="beta-chip" title={t('nav.betaHint') as string}>
      {t('nav.beta') as string}
    </Chip>
  );
};

/** 베타 페이지 머리줄 아래 한 줄 — «베타 — 자동 분류가 틀릴 수 있어요 [피드백 보내기]». */
export const BetaNotice: React.FC<{ path: string; onFeedback: () => void }> = ({ path, onFeedback }) => {
  const { t } = useTranslation('layout');
  if (!isBetaPath(path)) return null;
  return (
    <Notice data-testid="beta-notice" role="note">
      <Chip>{t('nav.beta') as string}</Chip>
      <span>{t('nav.betaNotice') as string}</span>
      <FeedbackBtn type="button" onClick={onFeedback}>{t('nav.betaFeedback') as string}</FeedbackBtn>
    </Notice>
  );
};

const Chip = styled.span`
  display: inline-flex; align-items: center; flex-shrink: 0;
  margin-left: 6px; padding: 0 5px; height: 16px; border-radius: 4px;
  background: #FFF7ED; color: #C2410C; border: 1px solid #FED7AA;
  font-size: 0.625rem; font-weight: 700; letter-spacing: 0.02em; line-height: 1;
`;
const Notice = styled.div`
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
  margin: 0 0 10px; padding: 6px 10px; border-radius: 8px;
  background: #FFFBF5; border: 1px solid #FED7AA; color: #9A3412; font-size: 0.75rem; line-height: 1.4;
  & > ${Chip} { margin-left: 0; }
  & > span:not(${Chip}) { flex: 1 1 200px; min-width: 0; }
`;
const FeedbackBtn = styled.button`
  border: none; background: none; padding: 4px 6px; color: #C2410C; font-weight: 600; font-size: 0.75rem;
  cursor: pointer; border-radius: 6px;
  &:hover { background: #FFEDD5; }
`;
