// components/Common/DetailFallback.tsx — 상세를 못 불러왔을 때 **말을 한다** (2026-08-30)
//
// 여태는 아무 말도 하지 않았다. 업무 상세는 실패 시 하드코딩 영문 "Loading..." 에 영원히
// 머물렀고, 메일은 "메일에서 시작해 보세요" 온보딩이 떴다 — 알림을 눌러 들어온 사용자에게
// 그 문구는 거짓말이다. 사용자에게는 전부 "안 열림" 으로 보인다.
//
// data-testid 는 하니스 계약이다 — 휴리스틱으로 재면 검사기가 거짓말한다(실제로 세 번 그랬다).
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import type { DetailStatus } from '../../hooks/useDetailResource';

type Props = {
  status: DetailStatus;
  onRetry?: () => void;
  onBack?: () => void;
};

/** ready·idle 이면 아무것도 그리지 않는다 — 호출부가 그대로 감싸 쓸 수 있게. */
export default function DetailFallback({ status, onRetry, onBack }: Props) {
  const { t } = useTranslation('common');
  if (status === 'ready' || status === 'idle') return null;

  if (status === 'loading') {
    return <Wrap data-testid="detail-fallback-loading"><Dim>{t('detail.loading')}</Dim></Wrap>;
  }

  const kind = status === 'not_found' ? 'notfound' : status === 'forbidden' ? 'forbidden' : 'error';
  return (
    <Wrap data-testid={`detail-fallback-${kind}`} role="status">
      <Title>{t(`detail.${kind}.title`)}</Title>
      <Desc>{t(`detail.${kind}.desc`)}</Desc>
      <Row>
        {status === 'error' && onRetry && (
          <Primary type="button" onClick={onRetry} data-testid="detail-fallback-retry">
            {t('detail.retry')}
          </Primary>
        )}
        {onBack && <Ghost type="button" onClick={onBack}>{t('detail.backToList')}</Ghost>}
      </Row>
    </Wrap>
  );
}

const Wrap = styled.div`
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 8px; padding: 48px 24px; text-align: center; min-height: 180px;
`;
const Dim = styled.div`font-size: 0.8125rem; color: #94A3B8;`;
const Title = styled.div`font-size: 0.9375rem; font-weight: 700; color: #0F172A;`;
const Desc = styled.div`font-size: 0.8125rem; color: #64748B; line-height: 1.6; max-width: 320px;`;
const Row = styled.div`display: flex; gap: 8px; margin-top: 8px;`;
const Primary = styled.button`
  height: 36px; padding: 0 16px; border-radius: 8px; cursor: pointer;
  background: #14B8A6; border: 1px solid #14B8A6; color: #fff;
  font-size: 0.8125rem; font-weight: 700;
  &:hover { background: #0F9C8D; }
`;
const Ghost = styled.button`
  height: 36px; padding: 0 16px; border-radius: 8px; cursor: pointer;
  background: #fff; border: 1px solid #E2E8F0; color: #475569;
  font-size: 0.8125rem; font-weight: 600;
  &:hover { background: #F8FAFC; }
`;
