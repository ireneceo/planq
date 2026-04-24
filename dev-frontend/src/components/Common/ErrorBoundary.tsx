import React from 'react';
import styled from 'styled-components';

interface Props {
  children: React.ReactNode;
  fallback?: (error: Error, reset: () => void) => React.ReactNode;
}

interface State {
  error: Error | null;
  resetKey: number;
}

class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, resetKey: 0 };

  static getDerivedStateFromError(error: Error): State {
    return { error, resetKey: 0 };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // 운영 중 페이지 단위 크래시가 발생하면 콘솔로 남긴다 (Sentry 등은 Phase 7 이후).
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  // resetKey 증가로 하위 트리 실제 remount 를 유도 — state 만 null 로 되돌리면
  // 부모 컴포넌트는 같은 인스턴스라 데이터 fetch 가 다시 트리거되지 않아 또 실패한다.
  reset = () => this.setState(s => ({ error: null, resetKey: s.resetKey + 1 }));

  render() {
    const { error, resetKey } = this.state;
    if (!error) {
      // key 를 매번 바꾸지 않고 reset 된 이후에만 바꿔 불필요 remount 방지.
      return <React.Fragment key={resetKey}>{this.props.children}</React.Fragment>;
    }

    if (this.props.fallback) return this.props.fallback(error, this.reset);

    // i18n 자체가 깨져 이 경계가 촉발되는 시나리오도 있으므로 하드코딩 ko/en 병기.
    const lang = (typeof navigator !== 'undefined' && navigator.language?.startsWith('en')) ? 'en' : 'ko';
    const L = lang === 'en' ? {
      title: 'Something went wrong',
      desc: 'An unexpected error occurred while rendering this page.',
      retry: 'Try again',
      home: 'Back to dashboard',
    } : {
      title: '문제가 발생했습니다',
      desc: '페이지를 표시하는 중 예기치 못한 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
      retry: '다시 시도',
      home: '대시보드로',
    };

    return (
      <Wrap role="alert">
        <Title>{L.title}</Title>
        <Desc>{L.desc}</Desc>
        <Detail>{error.message}</Detail>
        <Row>
          <PrimaryBtn onClick={this.reset}>{L.retry}</PrimaryBtn>
          <SecondaryBtn onClick={() => { window.location.href = '/dashboard'; }}>{L.home}</SecondaryBtn>
        </Row>
      </Wrap>
    );
  }
}

export default ErrorBoundary;

const Wrap = styled.div`
  min-height: 60vh;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 12px; padding: 40px 24px; text-align: center; background: #F8FAFC;
`;
const Title = styled.h1` font-size: 20px; font-weight: 700; color: #0F172A; margin: 0; `;
const Desc = styled.p` font-size: 14px; color: #475569; margin: 0; line-height: 1.6; `;
const Detail = styled.pre`
  margin: 4px 0 8px; padding: 10px 14px; max-width: 560px; width: 100%;
  background: #fff; border: 1px solid #E2E8F0; border-radius: 8px;
  font-family: 'ui-monospace', 'SFMono-Regular', monospace; font-size: 12px; color: #64748B;
  white-space: pre-wrap; word-break: break-word; text-align: left;
`;
const Row = styled.div` display: flex; gap: 8px; margin-top: 8px; `;
const PrimaryBtn = styled.button`
  height: 36px; padding: 0 16px; border-radius: 8px; border: none;
  background: #14B8A6; color: #fff; font-weight: 600; cursor: pointer;
  &:hover { background: #0D9488; }
`;
const SecondaryBtn = styled.button`
  height: 36px; padding: 0 16px; border-radius: 8px;
  background: #fff; color: #0F172A; border: 1px solid #CBD5E1; font-weight: 500; cursor: pointer;
  &:hover { background: #F1F5F9; }
`;
