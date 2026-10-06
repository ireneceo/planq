import React from 'react';
import styled from 'styled-components';
import i18n from '../../i18n';
import { getCrashTrail } from '../../utils/crashTrail';

interface Props {
  children: React.ReactNode;
  fallback?: (error: Error, reset: () => void) => React.ReactNode;
}

interface State {
  error: Error | null;
  resetKey: number;
  silentReload: boolean;
  /** 오류 화면 안의 신고 칸 — idle(닫힘) · open · sending · sent · failed */
  report: 'idle' | 'open' | 'sending' | 'sent' | 'failed';
  reportText: string;
  reportId: number | null;
}

const isChunkLoadError = (error: Error | null | undefined): boolean => {
  if (!error) return false;
  if (error.name === 'ChunkLoadError') return true;
  const msg = String(error.message || '');
  return /Failed to fetch dynamically imported module|Loading chunk \d+ failed|Importing a module script failed/i.test(msg);
};

class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, resetKey: 0, silentReload: false, report: 'idle', reportText: '', reportId: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    // 새 배포 직후 옛 청크 파일이 사라져 lazy import 가 실패하는 케이스 — 사용자에게 에러 화면을
    // 보여주지 않고 silent reload. 60초 가드는 render() 에서 처리 (여기는 pure 해야 함).
    if (isChunkLoadError(error)) {
      return { error, silentReload: true };
    }
    return { error, silentReload: false };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // ★ 2026-09-08 (Irene: "이렇게 에러가 나는 건 우리가 미리 미리 몰라?")
    //   여태 몰랐다 — 크래시는 화면만 갈아 끼우고 서버엔 흔적이 없었다. 사용자가 신고 버튼을
    //   눌러 글을 써 줘야만 알 수 있었고, 안 쓰면 **어느 화면인지조차** 못 물어봤다.
    //
    // ★★ 2026-09-08 (2차) — **이 보고는 여태 한 건도 서버에 닿지 않았다.**
    //   `credentials: 'include'` 만 붙이고 보냈는데 `/api/client-errors` 는 `authenticateToken`
    //   이고 그 미들웨어는 **Authorization 헤더만** 읽는다(쿠키는 refresh 전용) →
    //   전부 `401 no_token`. 실측: 무인증 POST = 401 `no_token`, 운영 로그 `client-crash` **0건**.
    //   "보고를 만들었다" 와 "보고가 도착한다" 는 다르다(memory: feedback_produced_link_no_consumer /
    //   feedback_unwired_guard_is_no_guard). 그래서 **앱과 같은 인증 계약**을 쓴다 —
    //   `apiFetch` 는 능동 refresh → Authorization 부착 → 401 이면 refresh 후 1회 재시도까지 한다.
    //   순환 import 를 만들지 않으려고 동적 import 로 부른다(utils/download.ts 와 같은 패턴).
    //
    //   그리고 **스택을 더 싣는다.** 운영은 minify 라 `#185` 같은 코드만 오면 화면은 알아도
    //   무엇이 죽었는지는 못 짚는다. 소스맵은 배포하지 않지만(빌드 `sourcemap:false` — 웹 루트에
    //   올라가면 소스가 그대로 새어 나간다) **청크 이름이 곧 화면 이름**이다
    //   (`AdminWikiPage-XXXX.js:5:1234`) — error.stack 상위 프레임만 있어도 파일이 특정된다.
    //   실패해도 무시한다 — 보고가 화면을 두 번 죽이면 안 된다.
    try {
      const frames = (v: unknown, n: number, cap: number) => String(v || '')
        .split('\n').map((l) => l.trim()).filter(Boolean).slice(0, n).join(' | ').slice(0, cap);
      const payload = {
        route: typeof window !== 'undefined' ? window.location.pathname + window.location.search : '',
        message: String((error && error.message) || error).slice(0, 300),
        component: frames((info as { componentStack?: string } | undefined)?.componentStack, 10, 600),
        stack: frames(error && error.stack, 6, 600),
        // 무엇을 눌렀을 때 죽었는가 — 경로·컴포넌트만으로는 재현을 못 했다(2026-09-08 세 번 실패).
        trail: getCrashTrail(600),
        build: (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_BUILD_ID || '',
      };
      void (async () => {
        try {
          const { apiFetch } = await import('../../contexts/AuthContext');
          await apiFetch('/api/client-errors', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
        } catch { /* 보고 실패는 무시 — 화면을 두 번 죽이지 않는다 */ }
      })();
    } catch { /* 보고 실패는 무시 */ }

    if (isChunkLoadError(error)) {
      const KEY = 'pq_chunk_reload_at';
      try {
        const last = Number(sessionStorage.getItem(KEY) || '0');
        // 60초 가드 — 단일 chunk 가 영영 missing 인 경우 무한 reload 방지.
        // 박제: 알림 클릭 → 옛 hash chunk fetch 실패 회귀 (사이클 N+12).
        if (Date.now() - last > 60_000) {
          sessionStorage.setItem(KEY, String(Date.now()));
          // SW 캐시까지 같이 비우고 reload — 옛 chunk hash 가 SW Cache 에 박혀있는 케이스 보강.
          (async () => {
            try {
              if ('serviceWorker' in navigator) {
                const reg = await navigator.serviceWorker.getRegistration();
                if (reg) await reg.update().catch(() => null);
              }
            } catch { /* silent */ }
            window.location.reload();
          })();
          return;
        }
      } catch { /* sessionStorage 차단 환경 — fallback UI 표시 */ }
      // 60초 가드에 막혀 reload 안 함 → 일반 에러 화면 보여야 함
      this.setState({ silentReload: false });
    }
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  // resetKey 증가로 하위 트리 실제 remount — state 만 null 로 되돌리면 데이터 fetch 가 재발동 안 함.
  // chunk error 였으면 명시적 reload — 사용자가 "다시 시도" 누른 건 60초 가드 무관하게 통과시킨다.
  // 박제: 알림 클릭 → 옛 청크 hash 404 → reset 만 하면 같은 chunk 다시 fetch → 같은 에러 무한 반복.
  reset = () => {
    const err = this.state.error;
    if (err && isChunkLoadError(err)) {
      try { sessionStorage.removeItem('pq_chunk_reload_at'); } catch { /* silent */ }
      (async () => {
        try {
          if ('serviceWorker' in navigator) {
            const reg = await navigator.serviceWorker.getRegistration();
            if (reg) await reg.update().catch(() => null);
          }
        } catch { /* silent */ }
        window.location.reload();
      })();
      return;
    }
    this.setState(s => ({ error: null, resetKey: s.resetKey + 1, silentReload: false, report: 'idle', reportText: '', reportId: null }));
  };

  // ★ 신고는 **이 화면 안에서** 보낸다 (2026-10-06 Irene: "이 문제 신고 버튼이 작동도 안해").
  //   여태 openFeedback() 이벤트로 Q helper 신고 창을 열었는데, 그 창(CueHelpDrawer)도 이 경계
  //   **안쪽**에 있다 — 최상위 경계가 잡으면 앱 트리 전체가 이 화면으로 바뀌어 신고 창이 같이
  //   사라지고, 이벤트를 받을 쪽이 없어 버튼이 아무 일도 안 했다. 화면이 죽었을 때 살아 있는 것은
  //   이 컴포넌트뿐이므로 여기서 직접 /api/feedback 에 보낸다(Q helper 와 같은 서버 계약).
  submitReport = async () => {
    const { error, reportText, report } = this.state;
    if (!error || report === 'sending') return;
    this.setState({ report: 'sending' });
    const note = reportText.trim();
    const path = typeof window !== 'undefined' ? window.location.pathname + window.location.search : '';
    try {
      const { apiFetch } = await import('../../contexts/AuthContext');
      const res = await apiFetch('/api/feedback', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: 'bug',
          priority: 'normal',
          title: `[render_crash] ${String(error.message || '').slice(0, 50)}`,
          body: `${note ? note + '\n\n' : ''}app · render_crash\n${String(error.message || '').slice(0, 300)}\n${path}`,
          page_url: typeof window !== 'undefined' ? window.location.href : null,
          error_context: { area: 'app', action: 'render_crash', message: String(error.message || '').slice(0, 300), detail: path.slice(0, 200) },
        }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.success) throw new Error('feedback');
      this.setState({ report: 'sent', reportId: j.data?.id ?? null });
    } catch {
      this.setState({ report: 'failed' });
    }
  };

  render() {
    const { error, resetKey, silentReload } = this.state;
    if (!error) {
      // key 를 매번 바꾸지 않고 reset 된 이후에만 바꿔 불필요 remount 방지.
      return <React.Fragment key={resetKey}>{this.props.children}</React.Fragment>;
    }

    // ChunkLoadError → componentDidCatch 가 곧 reload.
    //   ★ 여기서 null 을 돌려주면 그 사이 화면이 **완전히 비어** 보인다. reload 가 즉시 안 되거나
    //     (SW 가 옛 파일을 계속 물고 있는 경우) 사용자에게는 "눌렀는데 아무것도 없다" 로 남는다.
    //     짧은 순간이라도 무슨 일이 일어나는지 말해준다 — 빈 화면은 고장으로 읽힌다.
    if (silentReload) {
      const ko = !(typeof navigator !== 'undefined' && navigator.language?.startsWith('en'));
      return (
        <div role="status" style={{ padding: '40px 20px', textAlign: 'center', color: '#64748B', fontSize: '0.8125rem' }}>
          {ko ? '새 버전을 불러오는 중입니다…' : 'Loading the new version…'}
        </div>
      );
    }

    if (this.props.fallback) return this.props.fallback(error, this.reset);

    // i18n 자체가 깨져 이 경계가 촉발되는 시나리오도 있으므로 하드코딩 ko/en 병기.
    const lang = (typeof navigator !== 'undefined' && navigator.language?.startsWith('en')) ? 'en' : 'ko';
    const L = lang === 'en' ? {
      title: 'Something went wrong',
      desc: 'An unexpected error occurred while rendering this page.',
      retry: 'Try again',
      home: 'Back to dashboard',
      report: 'Report this',
    } : {
      title: '문제가 발생했습니다',
      desc: '페이지를 표시하는 중 예기치 못한 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
      retry: '다시 시도',
      home: '대시보드로',
      report: '이 문제 신고',
    };
    const { report, reportText, reportId } = this.state;
    // 신고 칸 문구 — 여기까지 왔다면 화면은 그려지고 있다. 번역이 안 되면 키 대신 기본값이 나온다.
    const R = (k: string, d: string, o?: Record<string, unknown>) => i18n.t(`common:crashReport.${k}`, { defaultValue: d, ...(o || {}) }) as string;

    return (
      <Wrap role="alert">
        <Title>{L.title}</Title>
        <Desc>{L.desc}</Desc>
        <Detail>{error.message}</Detail>
        <Row>
          <PrimaryBtn onClick={this.reset}>{L.retry}</PrimaryBtn>
          <SecondaryBtn onClick={() => { window.location.href = '/dashboard'; }}>{L.home}</SecondaryBtn>
          {/* ★ 화면이 통째로 죽었을 때야말로 신고 경로가 필요하다. 여기서 신고를 못 하면
              사용자는 대시보드로 돌아가고, 우리는 이 오류를 영영 모른다.
              i18n 이 깨져도 동작해야 하므로 t() 대신 위 하드코딩 ko/en 을 쓴다(이 경계의 규칙). */}
          {report === 'idle' && (
            <SecondaryBtn data-testid="crash-report-open" onClick={() => this.setState({ report: 'open' })}>{L.report}</SecondaryBtn>
          )}
        </Row>
        {report !== 'idle' && (
          <ReportBox data-testid="crash-report-box">
            {report === 'sent' ? (
              <ReportMsg role="status">{R('sent', 'Reported #{{id}} — thank you.', { id: reportId ?? '' })}</ReportMsg>
            ) : (
              <>
                {/* draft-exempt: 화면이 죽은 자리의 신고 칸 — 클래스 경계라 훅을 못 쓰고, 다시 시도하면 트리째 새로 그린다 */}
                <ReportArea
                  value={reportText}
                  placeholder={R('placeholder', 'What were you doing? (optional)')}
                  maxLength={2000}
                  onChange={(e) => this.setState({ reportText: e.target.value })}
                  disabled={report === 'sending'}
                />
                {report === 'failed' && <ReportErr role="alert">{R('failed', 'Could not send. Please try again.')}</ReportErr>}
                <ReportActions>
                  <PrimaryBtn data-testid="crash-report-send" onClick={this.submitReport} disabled={report === 'sending'}>
                    {report === 'sending' ? R('sending', 'Sending…') : R('send', 'Send')}
                  </PrimaryBtn>
                </ReportActions>
              </>
            )}
          </ReportBox>
        )}

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
const Title = styled.h1` font-size: 1.25rem; font-weight: 700; color: #0F172A; margin: 0; `;
const Desc = styled.p` font-size: 0.875rem; color: #475569; margin: 0; line-height: 1.6; `;
const Detail = styled.pre`
  margin: 4px 0 8px; padding: 10px 14px; max-width: 560px; width: 100%;
  background: #fff; border: 1px solid #E2E8F0; border-radius: 8px;
  font-family: 'ui-monospace', 'SFMono-Regular', monospace; font-size: 0.75rem; color: #64748B;
  white-space: pre-wrap; word-break: break-word; text-align: left;
`;
const Row = styled.div` display: flex; gap: 8px; margin-top: 8px; `;
const PrimaryBtn = styled.button`
  height: 36px; padding: 0 16px; border-radius: 8px; border: none;
  background: #14B8A6; color: #fff; font-weight: 600; cursor: pointer;
  &:hover { background: #0D9488; }
`;
const ReportBox = styled.div`
  width: 100%; max-width: 560px; display: flex; flex-direction: column; gap: 8px; margin-top: 4px;
`;
const ReportArea = styled.textarea`
  width: 100%; min-height: 88px; box-sizing: border-box; resize: vertical;
  padding: 10px 12px; border: 1px solid #CBD5E1; border-radius: 8px;
  font: inherit; font-size: 0.875rem; color: #0F172A; background: #fff;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.15); }
`;
const ReportActions = styled.div` display: flex; justify-content: flex-end; `;
const ReportMsg = styled.div` font-size: 0.875rem; color: #0F766E; font-weight: 600; `;
const ReportErr = styled.div` font-size: 0.8125rem; color: #B91C1C; text-align: left; `;
const SecondaryBtn = styled.button`
  height: 36px; padding: 0 16px; border-radius: 8px;
  background: #fff; color: #0F172A; border: 1px solid #CBD5E1; font-weight: 500; cursor: pointer;
  &:hover { background: #F1F5F9; }
`;
