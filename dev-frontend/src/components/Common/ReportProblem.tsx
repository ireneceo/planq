// 문제 신고 — 오류가 난 자리에서 바로 피드백으로.
//
// 왜 공용 부품인가 (Irene 2026-09-03: "여기 저기 적합한 상황에 나오게"):
//   화면마다 링크를 따로 만들면 문구·크기·동작이 갈라진다. 알림과 새 소식 드롭다운이
//   서로를 베껴 만들어져 전부 달라졌던 것과 같은 모양이다(dropdownShell 로 합친 사례).
//
// 두 가지만 있으면 된다:
//   ReportProblemLink — 어디든 붙이는 작은 링크
//   InlineErrorBar    — 오류 문구 + 다시 시도 + 신고를 한 줄로
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { openFeedback, type FeedbackContext } from '../../utils/feedbackOpen';

interface LinkProps {
  context?: FeedbackContext;
  /** 폼 본문에 미리 채울 문장 (없으면 맥락으로 만든다) */
  prefill?: string;
  label?: string;
  className?: string;
}

export function ReportProblemLink({ context, prefill, label, className }: LinkProps) {
  const { t } = useTranslation('common');
  return (
    <Link
      type="button"
      className={className}
      onClick={() => openFeedback({ context, prefill, category: 'bug' })}
    >
      {label || (t('reportProblem.link', '이 문제 신고') as string)}
    </Link>
  );
}

interface BarProps {
  /** 사용자에게 보일 오류 문구 */
  message: string;
  /** 다시 시도. 없으면 버튼을 안 보인다 — 없는 버튼을 그리면 눌러도 아무 일이 없다. */
  onRetry?: () => void;
  context?: FeedbackContext;
  /** 신고 링크 숨김 (사용자 입력 오류 등, 신고할 것이 아닌 경우) */
  hideReport?: boolean;
  className?: string;
}

/**
 * 오류 줄. 실패를 알리는 곳이면 어디든.
 * ★ role="alert" 만 쓰고 role="dialog" 는 쓰지 않는다 — 검사 하니스가 [aria-modal] 로
 *   모달을 스코핑하는데 배너에 dialog 를 붙이면 스코핑이 오염된다(CLAUDE.md 운영 안정성 17).
 */
export function InlineErrorBar({ message, onRetry, context, hideReport, className }: BarProps) {
  const { t } = useTranslation('common');
  return (
    <Bar role="alert" className={className}>
      <BarText>{message}</BarText>
      <BarActions>
        {onRetry && (
          <BarBtn type="button" onClick={onRetry}>{t('reportProblem.retry', '다시 시도')}</BarBtn>
        )}
        {!hideReport && (
          <ReportProblemLink
            context={context ? { ...context, message: context.message || message } : { message }}
          />
        )}
      </BarActions>
    </Bar>
  );
}

const Link = styled.button`
  all: unset; cursor: pointer;
  font-size: 0.75rem; font-weight: 600; color: #0D9488; text-decoration: underline;
  /* 터치 타겟 — 폰에서 누르기 어려우면 없는 것과 같다 */
  min-height: 36px; display: inline-flex; align-items: center; padding: 0 2px;
  &:hover { color: #0F766E; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 2px; border-radius: 4px; }
`;

const Bar = styled.div`
  display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
  background: #FEF2F2; border: 1px solid #FECACA; border-radius: 8px;
  padding: 8px 12px; margin: 8px 0;
`;
const BarText = styled.div`
  flex: 1 1 0; min-width: 0;
  font-size: 0.8125rem; color: #991B1B; line-height: 1.5;
`;
const BarActions = styled.div`display: inline-flex; align-items: center; gap: 10px; flex-shrink: 0;`;
const BarBtn = styled.button`
  all: unset; cursor: pointer;
  font-size: 0.75rem; font-weight: 700; color: #B91C1C;
  min-height: 36px; display: inline-flex; align-items: center; padding: 0 8px;
  border: 1px solid #FECACA; border-radius: 6px; background: #fff;
  &:hover { background: #FFF1F2; }
  &:focus-visible { outline: 2px solid #F43F5E; outline-offset: 2px; }
`;

export default ReportProblemLink;
