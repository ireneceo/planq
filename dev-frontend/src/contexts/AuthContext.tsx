import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import type { ReactNode } from 'react';
import i18n from '../i18n';
import { isNativeApp, nativePlatform } from '../services/native';
import { clearPageCache } from '../lib/pageCache';

// ⑥ 멀티탭 P1 선행(Fable BLOCKER #1) — AuthProvider 는 라우터 조상 위에 놓이므로 react-router 훅을
//   쓰면 안 된다(트리 스왑 후 첫 렌더 크래시). 세션 종료(로그아웃·토큰만료) 이동은 window.location 로.
//   풀 이동이 오히려 메모리 상태를 깨끗이 비워 안전. 현재 단일탭에서도 동작 동일(무회귀).
const goLogin = () => { if (window.location.pathname !== '/login') window.location.assign('/login'); };

export type UserRole = 'platform_admin' | 'business_owner' | 'business_member' | 'client';

export type LanguageSkillLevel = 1 | 2 | 3 | 4 | 5 | 6;
export interface LanguageLevelBlock {
  reading?: LanguageSkillLevel;
  speaking?: LanguageSkillLevel;
  listening?: LanguageSkillLevel;
  writing?: LanguageSkillLevel;
}
export type LanguageLevels = Record<string, LanguageLevelBlock>;
export type ExpertiseLevel = 'layman' | 'practitioner' | 'expert';
export type AnswerLength = 'short' | 'medium' | 'long';

export interface WorkspaceMembership {
  business_id: number;
  brand_name: string;
  brand_logo_url?: string | null;
  slug: string;
  plan: string;
  role: 'owner' | 'member' | 'client' | 'ai';
  is_active: boolean;
}

export interface User {
  id: string;
  email: string;
  username?: string | null;
  name: string;
  // 다국어 이름 (사이클 F) — viewer 의 i18n 언어 기준으로 displayName 헬퍼가 표시 이름 결정
  name_localized?: Record<string, string> | null;
  // 워크스페이스 컨텍스트 표시명 (현재 active business 의 BusinessMember.name 또는 Client.name)
  // 계정 (name) vs 워크스페이스 (display_name) 분리. 사이드바·헤더·UserChip 모두 워크스페이스 표시명 우선.
  display_name?: string | null;
  display_name_localized?: Record<string, string> | null;
  platform_role: string;
  business_id?: number | null;
  business_name?: string | null;
  business_role?: string | null;
  workspaces?: WorkspaceMembership[];
  language?: string | null;
  // Q note 답변 생성용 프로필
  bio?: string | null;
  expertise?: string | null;
  organization?: string | null;
  job_title?: string | null;
  language_levels?: LanguageLevels | null;
  expertise_level?: ExpertiseLevel | null;
  answer_style_default?: string | null;
  answer_length_default?: AnswerLength | null;
  // 타임존 (개인)
  timezone?: string | null;
  reference_timezones?: string[] | null;
  // active workspace 의 타임존 (표시 전용 — 워크스페이스 수정 API 로만 변경)
  workspace_timezone?: string | null;
  workspace_reference_timezones?: string[] | null;
  // 약관 동의 시점·버전 (재동의 모달 트리거용)
  terms_accepted_at?: string | null;
  terms_version?: string | null;
  privacy_accepted_at?: string | null;
  privacy_version?: string | null;
  // 이메일 인증 시각
  email_verified_at?: string | null;
  // 플랫폼 정보 (announcement + 현재 약관 버전) — /me 응답이 같이 줌
  platform?: {
    announcement_text: string | null;
    announcement_text_en?: string | null;
    announcement_dismissible: boolean;
    announcement_severity: 'info' | 'warn' | 'critical';
    current_terms_version: string;
    current_privacy_version: string;
  } | null;
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string, remember?: boolean) => Promise<boolean>;
  register: (name: string, email: string, password: string, businessName: string, opts?: { terms_accepted?: boolean; privacy_accepted?: boolean; invite_token?: string }) => Promise<boolean>;
  logout: () => void;
  updateUser: (userData: Partial<User>) => void;
  refreshUser: () => Promise<void>;
  hasRole: (...roles: string[]) => boolean;
  switchWorkspace: (businessId: number) => Promise<boolean>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

// Access token은 메모리에만 저장 (XSS 안전)
let accessToken: string | null = null;

// 클라이언트 종류 감지 — 네이티브 앱이면 'ios'/'android', PWA standalone 이면 'pwa', 아니면 'web'.
// 백엔드에 전달되어 refresh_token TTL 결정 (pwa/ios/android=365일 / web=30일 sliding renewal).
// SSR 환경 안전성 — window 미존재 시 'web' 기본.
const detectClientKind = (): 'pwa' | 'web' | 'ios' | 'android' => {
  if (typeof window === 'undefined') return 'web';
  try {
    // Capacitor 네이티브 앱 우선 판정 (WebView 안에서도 display-mode 가 standalone 일 수 있어 먼저 검사).
    if (isNativeApp()) {
      const p = nativePlatform();
      if (p === 'ios' || p === 'android') return p;
    }
    const standalone =
      window.matchMedia?.('(display-mode: standalone)').matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
    return standalone ? 'pwa' : 'web';
  } catch {
    return 'web';
  }
};

export const getAccessToken = () => accessToken;
// 사칭(impersonate) 모드에서 token swap 할 때만 export. 일반 흐름은 register/login/refresh 가 내부에서 호출.
export const _impersonateSetAccessToken = (token: string | null) => {
  accessToken = token;
};

const setAccessToken = (token: string | null) => {
  accessToken = token;
};

// JWT exp 디코딩 — payload 의 exp (sec) 를 ms 로 변환. 실패 시 null.
//   서명 검증은 서버가 함. 여기서는 만료시각 추출만 (능동 refresh 트리거용).
const decodeJWTExpMs = (token: string): number | null => {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    // base64url → base64
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const payload = JSON.parse(atob(padded));
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
};

// 만료까지 남은 시간 (ms). 토큰 없거나 디코딩 실패 시 0.
const tokenRemainingMs = (): number => {
  if (!accessToken) return 0;
  const exp = decodeJWTExpMs(accessToken);
  if (!exp) return 0;
  return exp - Date.now();
};

// 단일 in-flight refresh promise — parallel 요청이 동시에 401 받아도 refresh 호출은 1회만.
let refreshInflight: Promise<RefreshResult> | null = null;

// #244 — refresh 실패 사유. **세션을 끝낼 수 있는 것은 'unauthorized' 뿐이다.**
//
//   여태는 boolean 만 돌려줘서 호출자가 "인증이 진짜 끝났다"와 "지금 서버에 못 닿았다"를
//   구별할 수 없었고, 세 곳(타이머·visibility·session-expired) 모두 실패면 무조건 로그아웃했다.
//   절전 복귀·오프라인 wake·배포 중 재시작이 일상인 PWA 에서 이 구조는 오탐 로그아웃을 만든다.
//
//   'ratelimited'(429) 를 별도로 두는 이유: 옛 코드의 재시도 조건이 `status >= 500` 이라
//   429 를 포함한 **모든 non-401 4xx 가 즉시 영구 로그아웃**이었다. 공용 IP 사무실에서
//   한 명이 한도를 채우면 옆 사람이 로그아웃되는 실 발화 경로다.
export type RefreshFailReason = 'unauthorized' | 'network' | 'server' | 'ratelimited';
// ok 일 때 서버가 같이 준 user 를 실어 보낸다 — 부팅 왕복을 줄이기 위한 통로.
//   /api/auth/refresh 는 원래부터 user 를 함께 응답했는데 프론트가 token 만 쓰고 버려서
//   부팅 때 /api/auth/me 를 한 번 더 불렀다. 한국↔독일 왕복이 통째로 하나 더 붙는 구간이었다.
type RefreshResult = { ok: true; user?: unknown } | { ok: false; reason: RefreshFailReason; code?: string };

const isTerminal = (r: RefreshResult) => !r.ok && r.reason === 'unauthorized';

// 마지막으로 refresh 가 성공한 시각 — 세션 종결 비콘에 실어 "얼마나 버티다 죽었는지"를 남긴다.
let lastRefreshSuccessAt: string | null = null;

// #244 (D3) — 세션이 끝나는 그 순간의 클라이언트 상태를 서버에 한 줄 남긴다.
//   #244 조사에서 서버 로그만으로는 "쿠키가 사라졌다"까지가 한계였고 무엇이 지웠는지 알 수 없었다.
//   다음 재발 때 원인이 바로 특정되도록 계측한다. keepalive — 곧 페이지가 /login 으로 떠나므로
//   일반 fetch 는 중간에 취소된다. 실패해도 무시(진단이 사용자 흐름을 막으면 안 된다).
const reportSessionEnd = (reason: string, code?: string) => {
  try {
    const standalone =
      window.matchMedia?.('(display-mode: standalone)').matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
    fetch('/api/auth/session-diag', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      keepalive: true,
      body: JSON.stringify({
        reason, code,
        last_success_at: lastRefreshSuccessAt,
        client_kind: detectClientKind(),
        standalone: !!standalone,
      }),
    }).catch(() => { /* noop */ });
  } catch { /* noop */ }
};

// 백오프 상한 — 무한히 촘촘한 재시도로 서버를 두드리지 않되, 복귀는 빠르게.
const BACKOFF_MS = [5_000, 15_000, 60_000];
const BACKOFF_MAX_MS = 5 * 60 * 1000;

// Refresh 시도. 동시 호출은 동일 promise 공유.
//   1회 호출의 결과만 돌려준다 — 재시도 정책은 호출자(세션 유지 루프)가 결정한다.
const tryRefresh = (): Promise<RefreshResult> => {
  if (refreshInflight) return refreshInflight;
  refreshInflight = (async (): Promise<RefreshResult> => {
    try {
      const clientKind = detectClientKind();
      // headers 와 body 양쪽에 client_kind 전달 — CORS 가 헤더 막을 경우 body 가 백업
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Client-Kind': clientKind },
        credentials: 'include',
        body: JSON.stringify({ client_kind: clientKind }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.data?.token) {
          setAccessToken(data.data.token);
          lastRefreshSuccessAt = new Date().toISOString();
          return { ok: true, user: data.data.user };
        }
        // 200 인데 형식이 어긋남 — 서버 이상으로 취급(세션 종결 사유 아님)
        return { ok: false, reason: 'server' };
      }
      if (res.status === 401) {
        // 서버가 준 기계판독 code (no_cookie / jwt_invalid / no_row / stale_reuse / expired)
        let code: string | undefined;
        try { code = (await res.clone().json())?.code; } catch { /* 본문 없음 */ }
        console.warn('[auth.refresh] 401 code=' + (code || 'unknown') + ' — 세션 종료.');
        setAccessToken(null);
        return { ok: false, reason: 'unauthorized', code };
      }
      if (res.status === 429) {
        console.warn('[auth.refresh] 429 rate limited — 세션 유지하고 재시도.');
        return { ok: false, reason: 'ratelimited' };
      }
      console.warn('[auth.refresh] status=' + res.status + ' — 서버 일시 오류, 재시도.');
      return { ok: false, reason: 'server' };
    } catch (e) {
      console.warn('[auth.refresh] network error', (e as Error).message);
      return { ok: false, reason: 'network' };
    }
  })();
  // 끝나면 슬롯 비우기 (다음 만료 사이클에서 새로 시도 가능)
  refreshInflight.finally(() => {
    refreshInflight = null;
  });
  return refreshInflight;
};

// 세션을 지키며 refresh 를 성사시킨다.
//   - 성공 → true
//   - 401 → false (진짜 종료. 호출자가 로그아웃 처리)
//   - 그 외(network/server/429) → 백오프 재시도. `online` 이벤트가 오면 즉시 앞당긴다.
//     retry 상한은 없다 — 끝낼 수 있는 사유는 401 뿐이라는 원칙 그대로.
const refreshWithRetry = async (): Promise<boolean> => {
  let attempt = 0;
  for (;;) {
    const r = await tryRefresh();
    if (r.ok) return true;
    if (isTerminal(r)) {
      reportSessionEnd('refresh_unauthorized', (r as { code?: string }).code);
      return false;
    }
    const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)] ?? BACKOFF_MAX_MS;
    attempt += 1;
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        window.removeEventListener('online', finish);
        resolve();
      };
      const timer = setTimeout(finish, Math.min(delay, BACKOFF_MAX_MS));
      // 네트워크가 돌아오면 백오프를 기다리지 않고 즉시 재시도
      window.addEventListener('online', finish);
    });
  }
};

// API 호출 헬퍼.
//   1) 능동적 만료 검사: 토큰 만료 30초 이내면 호출 전 refresh
//      (슬립/탭드리프트로 setTimeout 타이머 놓친 케이스 흡수)
//   2) 정상 fetch
//   3) 401 응답 시 (서버가 token_expired/invalid_token 등) refresh 후 재시도
//   4) 단일 in-flight refresh 로 thundering herd 방지
const PROACTIVE_REFRESH_MS = 30 * 1000;

// ★ 2026-08-24 운영 사고 — 콘솔이 `net::ERR_INSUFFICIENT_RESOURCES` 로 뒤덮였다.
//   이건 서버 문제가 아니라 **브라우저가 같은 요청을 폭주시켜 자원이 고갈된 것**이다.
//   시작점은 Google Drive 토큰 만료(invalid_grant) → 첨부 라우트 502 → 그 실패를 계속 재시도하는
//   화면 로직이었다. 폭주가 연결 슬롯을 다 먹어 **멀쩡한 요청까지 전부 실패**했고,
//   사용자에게는 "여기저기 Failed to fetch" 로만 보였다(서버는 30ms 로 정상 응답 중이었다).
//
//   어느 화면이 범인이든 **폭주 자체를 여기서 끊는다.** 같은 URL 이 짧은 시간에 반복 실패하면
//   잠시 차단하고, **범인 URL 을 콘솔에 이름으로 남긴다**(다음에 바로 잡을 수 있게).
//   정상 재시도(사용자 조작)는 쿨다운이 지나면 다시 나간다 — 기능을 죽이지 않는다.
const FAIL_WINDOW_MS = 10_000;   // 이 창 안의 반복 실패를 센다
const FAIL_TRIP = 8;             // 8회 연속 실패면 폭주로 본다
const COOLDOWN_MS = 30_000;      // 차단 유지 시간
const failLog = new Map<string, { n: number; first: number; until: number }>();

function circuitKey(url: string): string {
  try { return new URL(url, window.location.origin).pathname; } catch { return url.split('?')[0]; }
}
/** 차단 중이면 true (요청을 내보내지 않는다) */
function circuitOpen(url: string): boolean {
  const e = failLog.get(circuitKey(url));
  return !!e && e.until > Date.now();
}
function noteFailure(url: string): void {
  const key = circuitKey(url);
  const now = Date.now();
  const e = failLog.get(key);
  if (!e || now - e.first > FAIL_WINDOW_MS) { failLog.set(key, { n: 1, first: now, until: 0 }); return; }
  e.n += 1;
  if (e.n >= FAIL_TRIP && e.until <= now) {
    e.until = now + COOLDOWN_MS;
    // ★ 이 한 줄이 다음 사고의 범인을 알려준다 — 어떤 경로가 폭주했는지 이름으로 남는다.
    console.error(`[apiFetch] 요청 폭주 차단: ${key} — ${e.n}회 연속 실패. ${COOLDOWN_MS / 1000}초 대기.`);
  }
}
function noteSuccess(url: string): void { failLog.delete(circuitKey(url)); }

const apiFetch = async (url: string, options: RequestInit = {}): Promise<Response> => {
  // 폭주 차단 중 — 네트워크로 내보내지 않고 즉시 실패 응답을 만든다(호출부는 !r.ok 로 처리).
  if (circuitOpen(url)) {
    return new Response(JSON.stringify({ success: false, message: 'request_throttled' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } });
  }
  const isAuthEndpoint =
    url.includes('/api/auth/refresh') ||
    url.includes('/api/auth/login') ||
    url.includes('/api/auth/register') ||
    url.includes('/api/auth/logout');

  // 능동 refresh — auth 엔드포인트 자신은 스킵
  if (!isAuthEndpoint && accessToken) {
    const remaining = tokenRemainingMs();
    if (remaining > 0 && remaining < PROACTIVE_REFRESH_MS) {
      await tryRefresh();
    }
  }

  const headers = new Headers(options.headers || {});
  if (accessToken && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${accessToken}`);
  }

  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      headers,
      credentials: 'include', // HttpOnly cookie 전송
    });
  } catch (e) {
    noteFailure(url);          // 네트워크 자체 실패(ERR_INSUFFICIENT_RESOURCES 등)도 폭주 신호다
    throw e;
  }
  if (response.ok) noteSuccess(url);
  else if (response.status >= 500) noteFailure(url);   // 5xx 반복 = 서버가 못 주는 것 — 계속 때리지 않는다

  // 401 reactive refresh — 서버가 token_expired/invalid_token 등으로 401 보낸 경우
  if (response.status === 401 && !isAuthEndpoint) {
    const r = await tryRefresh();
    if (r.ok) {
      const retryHeaders = new Headers(options.headers || {});
      retryHeaders.set('Authorization', `Bearer ${accessToken}`);
      return fetch(url, { ...options, headers: retryHeaders, credentials: 'include' });
    }
    // refresh 실패 = 세션이 끝났다. 여기서 응답을 그대로 돌려주면 호출자(예: 확인필요/인박스
    //   fetchTodo)가 백엔드 원문("Access token required")을 화면에 렌더해 사용자가 로그인
    //   화면으로 못 가고 영문 에러에 갇힌다. 전역 신호를 발행해 AuthProvider 가 (로그인 세션이
    //   있었을 때만) 정리 후 /login 으로 이동시킨다. 게스트/공개 표면(user 없음)은 gate 에서 무시.
    //
    // #244 — **발행측 게이트**. 소비자 3곳만 고치면 여기서 우회된다.
    //   장기 네트워크 단절 중 access token 이 만료되면 API 가 401 → 여기 reactive refresh 도
    //   network 실패 → 옛 코드는 그대로 session-expired 를 쏴 로그아웃시켰다.
    //   세션을 끝낼 수 있는 것은 서버가 401 로 "인증이 끝났다"고 말한 경우뿐이다.
    if (isTerminal(r)) {
      reportSessionEnd('api_401_then_refresh_unauthorized', (r as { code?: string }).code);
      try { window.dispatchEvent(new Event('planq:session-expired')); } catch { /* noop */ }
    }
  }

  // 422 plan quota — 글로벌 이벤트로 LimitReachedDialog 띄움. 호출자는 그대로 응답 받음.
  if (response.status === 422) {
    try {
      const j = await response.clone().json();
      if (j?.code && /quota_exceeded|feature_not_in_plan|subscription_inactive/.test(String(j.code))) {
        window.dispatchEvent(new CustomEvent('planq:limit-reached', { detail: j }));
      }
    } catch { /* noop */ }
  }

  return response;
};

// apiFetch를 전역에 노출 (다른 컴포넌트에서 import해서 사용)
export { apiFetch };

// ─── 업로드 게이트웨이 (진행률) ────────────────────────────────────────────────
// ★ fetch 는 **업로드 진행 이벤트를 제공하지 않는다** (ReadableStream 요청 본문은 HTTP/2 전용 +
//   Safari/iOS 미지원). 그래서 파일 업로드만은 XMLHttpRequest 를 쓴다 — `xhr.upload.onprogress`
//   가 유일한 진행률 원천이다. 인증·능동 refresh·401 재시도·폭주 차단은 apiFetch 와 같은 계약을
//   따른다(게이트웨이를 두 벌로 가르지 않는다).
export interface UploadProgress {
  loaded: number;
  total: number;
  /** 0~100. total 을 모르면 -1 */
  pct: number;
}

export interface ApiUploadOptions {
  onProgress?: (p: UploadProgress) => void;
  signal?: AbortSignal;
}

function xhrSend(url: string, body: FormData, token: string | null, opts?: ApiUploadOptions): Promise<Response> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url, true);
    xhr.withCredentials = true;             // HttpOnly refresh 쿠키 — apiFetch 의 credentials:'include' 와 동일
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    if (opts?.onProgress) {
      xhr.upload.onprogress = (e) => {
        opts.onProgress!({
          loaded: e.loaded,
          total: e.lengthComputable ? e.total : 0,
          pct: e.lengthComputable && e.total > 0 ? Math.round((e.loaded / e.total) * 100) : -1,
        });
      };
    }

    const onAbort = () => xhr.abort();
    if (opts?.signal) {
      if (opts.signal.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
      opts.signal.addEventListener('abort', onAbort, { once: true });
    }
    const cleanup = () => { if (opts?.signal) opts.signal.removeEventListener('abort', onAbort); };

    xhr.onload = () => {
      cleanup();
      // 서버 응답을 Response 로 감싸 호출부가 fetch 와 같은 방식으로 읽게 한다.
      const headers = new Headers();
      const ct = xhr.getResponseHeader('Content-Type');
      if (ct) headers.set('Content-Type', ct);
      resolve(new Response(xhr.responseText, { status: xhr.status, headers }));
    };
    xhr.onerror = () => { cleanup(); reject(new TypeError('Network request failed')); };
    xhr.onabort = () => { cleanup(); reject(new DOMException('Aborted', 'AbortError')); };
    xhr.ontimeout = () => { cleanup(); reject(new TypeError('Upload timed out')); };

    xhr.send(body);
  });
}

/**
 * 파일 업로드 — 진행률 콜백 + 취소 지원.
 * apiFetch 와 같은 인증 계약: 능동 refresh → Authorization 부착 → 401 이면 refresh 후 1회 재시도.
 */
const apiUpload = async (url: string, body: FormData, opts?: ApiUploadOptions): Promise<Response> => {
  if (accessToken) {
    const remaining = tokenRemainingMs();
    if (remaining > 0 && remaining < PROACTIVE_REFRESH_MS) await tryRefresh();
  }
  const res = await xhrSend(url, body, accessToken, opts);
  if (res.status === 401) {
    const r = await tryRefresh();
    if (r.ok) return xhrSend(url, body, accessToken, opts);
    if (isTerminal(r)) {
      reportSessionEnd('upload_401_then_refresh_unauthorized', (r as { code?: string }).code);
      try { window.dispatchEvent(new Event('planq:session-expired')); } catch { /* noop */ }
    }
  }
  if (res.status === 422) {
    try {
      const j = await res.clone().json();
      if (j?.code && /quota_exceeded|feature_not_in_plan|subscription_inactive/.test(String(j.code))) {
        window.dispatchEvent(new CustomEvent('planq:limit-reached', { detail: j }));
      }
    } catch { /* noop */ }
  }
  return res;
};

export { apiUpload };

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 유저 데이터 정규화
  const normalizeUser = (apiUser: Record<string, unknown>): User => ({
    id: String(apiUser.id),
    email: apiUser.email as string,
    username: (apiUser.username as string) || null,
    name: (apiUser.name || (apiUser.email as string)?.split('@')[0]) as string,
    name_localized: (apiUser.name_localized as Record<string, string>) || null,
    display_name: (apiUser.display_name as string) || null,
    display_name_localized: (apiUser.display_name_localized as Record<string, string>) || null,
    platform_role: apiUser.platform_role as string,
    business_id: (apiUser.business_id as number) || null,
    business_name: (apiUser.business_name as string) || null,
    business_role: (apiUser.business_role as string) || null,
    workspaces: (apiUser.workspaces as WorkspaceMembership[]) || [],
    language: (apiUser.language as string) || null,
    bio: (apiUser.bio as string) || null,
    expertise: (apiUser.expertise as string) || null,
    organization: (apiUser.organization as string) || null,
    job_title: (apiUser.job_title as string) || null,
    language_levels: (apiUser.language_levels as LanguageLevels) || null,
    expertise_level: (apiUser.expertise_level as ExpertiseLevel) || null,
    answer_style_default: (apiUser.answer_style_default as string) || null,
    answer_length_default: (apiUser.answer_length_default as AnswerLength) || null,
    timezone: (apiUser.timezone as string) || null,
    reference_timezones: (apiUser.reference_timezones as string[]) || null,
    workspace_timezone: (apiUser.workspace_timezone as string) || null,
    terms_accepted_at: (apiUser.terms_accepted_at as string) || null,
    terms_version: (apiUser.terms_version as string) || null,
    privacy_accepted_at: (apiUser.privacy_accepted_at as string) || null,
    privacy_version: (apiUser.privacy_version as string) || null,
    email_verified_at: (apiUser.email_verified_at as string) || null,
    platform: (apiUser.platform as User['platform']) || null,
    workspace_reference_timezones: (apiUser.workspace_reference_timezones as string[]) || null,
  });

  // (이전 getUserRole 은 platform_admin 을 business_role 보다 우선시켜 멀티 롤 체크를 망가뜨렸음.
  //  hasRole 이 두 role 을 독립 검사하는 방식으로 재작성됐으므로 제거.)

  // Access Token 자동 갱신 타이머 (만료 1분 전 갱신)
  //   #244 — 실패해도 곧바로 끝내지 않는다. refreshWithRetry 는 401 을 받을 때만 false 를 돌려주고,
  //   네트워크/서버/429 는 백오프하며 버틴다(네트워크 복귀 시 즉시 재시도). 절전 복귀·배포 중
  //   재시작 같은 일시 장애로 세션이 죽던 경로를 차단.
  const scheduleRefresh = useCallback(() => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    // 14분 후 갱신 (15분 만료 기준 1분 전)
    refreshTimerRef.current = setTimeout(async () => {
      const success = await refreshWithRetry();
      if (success) {
        scheduleRefresh();
      } else {
        setUser(null);
        setAccessToken(null);
        goLogin();
      }
    }, 14 * 60 * 1000);
  }, []);

  // 초기 세션 확인 — refresh token cookie로 복원 시도
  useEffect(() => {
    // #93-ⓐ 팝아웃 재로그인 방지 — 부모 창(window.opener)이 자기 access token getter 를 노출.
    //   window.open 분리 창은 메모리 accessToken 이 비어 있어 부팅 refresh 라운드트립에 의존 →
    //   느린 응답/컨텍스트 어긋남 시 로그인 게이트로 떨어짐. opener 의 in-memory 토큰을 즉시 상속해
    //   round-trip/플래시 제거. 같은 origin 만 접근 가능(cross-origin opener 는 throw → catch).
    (window as unknown as { __pqGetToken?: () => string | null }).__pqGetToken = getAccessToken;

    const checkSession = async () => {
      try {
        // 기존 localStorage 토큰 마이그레이션
        const legacyToken = localStorage.getItem('auth_token');
        if (legacyToken) {
          setAccessToken(legacyToken);
          localStorage.removeItem('auth_token');
        }

        // #93-ⓐ 팝아웃: 부모 창의 in-memory access token 즉시 상속 시도 (refresh 라운드트립 회피)
        let seeded = false;
        try {
          const opener = window.opener as (Window & { __pqGetToken?: () => string | null }) | null;
          const inherited = opener && typeof opener.__pqGetToken === 'function' ? opener.__pqGetToken() : null;
          if (inherited) { setAccessToken(inherited); seeded = true; }
        } catch { /* cross-origin opener — 무시하고 일반 refresh 경로로 */ }

        if (seeded) {
          // 상속 토큰으로 즉시 검증 (만료면 apiFetch 가 401→refresh 자동 복구)
          const meRes = await apiFetch('/api/auth/me');
          if (meRes.ok) {
            const meResult = await meRes.json();
            if (meResult.success && meResult.data) {
              setUser(normalizeUser(meResult.data));
              scheduleRefresh();
              setIsLoading(false);
              return;
            }
          }
        }

        // 일반 경로 (또는 상속 실패) — refresh cookie 로 세션 복원.
        //   부팅은 재시도 루프에 넣지 않는다: 게스트도 여기를 지나가므로(쿠키 없으면 401),
        //   버티게 하면 로그인 화면 진입이 지연된다. 1회 시도 후 실패하면 그대로 게스트로 부팅하고,
        //   세션 유지 책임은 로그인 이후의 scheduleRefresh 가 진다.
        const refreshRes = await tryRefresh();
        if (refreshRes.ok) {
          // refresh 응답에 user 가 실려 있으면 그것으로 부팅을 끝낸다(왕복 1회 절약).
          //   payload 는 /api/auth/me 와 같은 단일 원천(getUserWithBusiness)이 만든다.
          //   폴백을 남겨두는 이유: 옛 백엔드(배포 시차)나 응답 형식 변화로 user 가 없을 때
          //   부팅이 통째로 죽으면 안 되기 때문이다 — 없으면 종전대로 /me 를 부른다.
          const inline = refreshRes.user as Record<string, unknown> | undefined;
          if (inline && typeof inline === 'object' && inline.id) {
            setUser(normalizeUser(inline));
            scheduleRefresh();
          } else {
            const res = await apiFetch('/api/auth/me');
            if (res.ok) {
              const result = await res.json();
              if (result.success && result.data) {
                setUser(normalizeUser(result.data));
                scheduleRefresh();
              }
            }
          }
        }
      } catch { /* ignore */ }
      setIsLoading(false);
    };

    checkSession();

    // 슬립/탭전환 복귀 시 토큰 검사 — setTimeout 드리프트 흡수.
    // visibilitychange 가 fired 됐는데 토큰이 만료되었거나 곧 만료면 즉시 refresh 후 타이머 재예약.
    const onVisibilityChange = async () => {
      if (document.visibilityState !== 'visible') return;
      if (!accessToken) return;
      const remaining = tokenRemainingMs();
      // 60초 이하 남았으면 즉시 refresh (만료 직후 포함). 0 이면 이미 만료.
      //   #244 — 여기가 PWA 절전 복귀의 첫 착지점이다. 복귀 직후엔 네트워크가 아직 안 붙어 있는
      //   경우가 흔해, 1회 실패로 로그아웃시키면 정상 사용자가 죽는다. 401 일 때만 종결.
      if (remaining < 60 * 1000) {
        const ok = await refreshWithRetry();
        if (ok) {
          scheduleRefresh();
        } else {
          // refresh token 도 만료됐다면 강제 로그인
          setUser(null);
          setAccessToken(null);
          if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
          goLogin();
        }
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 세션 만료 전역 신호 — apiFetch 반응형 refresh 실패(refresh 쿠키 만료·무효) 시 발행됨.
  //   로그인 세션이 실제로 있었던 경우에만(user 존재) 정리 후 /login 이동. 게스트/공개 표면
  //   (공유 링크 등 user 없음)은 무시해 오리다이렉트를 막는다. scheduleRefresh/visibility 실패
  //   경로와 동일한 종결 처리(goLogin)로 일관.
  useEffect(() => {
    const onSessionExpired = () => {
      if (!user) return;
      setUser(null);
      setAccessToken(null);
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      goLogin();
    };
    window.addEventListener('planq:session-expired', onSessionExpired);
    return () => window.removeEventListener('planq:session-expired', onSessionExpired);
  }, [user]);

  // remember 기본값 true (기존 동작 호환). false 면 백엔드가 session cookie 설정 → 브라우저
  // 닫으면 refresh_token 사라져 자동 로그아웃. 공용 PC 사용자가 명시적 OFF 시 안전.
  const login = async (email: string, password: string, remember: boolean = true): Promise<boolean> => {
    const clientKind = detectClientKind();
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Client-Kind': clientKind },
      credentials: 'include',
      body: JSON.stringify({ email, password, remember, client_kind: clientKind }),
    });

    if (res.ok) {
      const result = await res.json();
      if (result.success && result.data) {
        setAccessToken(result.data.token);
        setUser(normalizeUser(result.data.user));
        scheduleRefresh();
        return true;
      }
    }

    const errorResult = await res.json().catch(() => null);
    if (errorResult?.message) {
      throw new Error(errorResult.message);
    }
    return false;
  };

  const register = async (name: string, email: string, password: string, businessName: string, opts?: { terms_accepted?: boolean; privacy_accepted?: boolean; invite_token?: string }): Promise<boolean> => {
    const clientKind = detectClientKind();
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Client-Kind': clientKind },
      credentials: 'include',
      body: JSON.stringify({
        email, password, name, business_name: businessName || undefined,
        client_kind: clientKind,
        terms_accepted: opts?.terms_accepted ?? false,
        privacy_accepted: opts?.privacy_accepted ?? false,
        // 초대 가입 — 워크스페이스 생성 skip (초대된 워크스페이스에 고객으로 합류)
        ...(opts?.invite_token ? { invite_token: opts.invite_token } : {}),
      }),
    });

    if (res.ok) {
      const result = await res.json();
      if (result.success && result.data) {
        setAccessToken(result.data.token);
        setUser(normalizeUser(result.data.user));
        scheduleRefresh();
        return true;
      }
    }

    const errorResult = await res.json().catch(() => null);
    if (errorResult?.message) {
      throw new Error(errorResult.message);
    }
    return false;
  };

  const logout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch { /* ignore */ }
    clearPageCache();   // 다음 사용자에게 남의 목록이 한 프레임도 비치지 않게
    setUser(null);
    setAccessToken(null);
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    goLogin();
  };

  const updateUser = (userData: Partial<User>) => {
    if (!user) return;
    setUser({ ...user, ...userData });
  };

  // 서버에서 최신 유저 정보 다시 가져오기 (약관 재동의 등에서 사용)
  const refreshUser = async (): Promise<void> => {
    try {
      const res = await apiFetch('/api/auth/me');
      if (res.ok) {
        const result = await res.json();
        if (result.success && result.data) {
          setUser(normalizeUser(result.data));
        }
      }
    } catch (e) {
      console.error('[refreshUser] failed', e);
    }
  };

  // user.language 가 DB 에 설정돼있으면 화면 언어 자동 적용 (서버 = source of truth).
  // 새 디바이스 로그인 / 다른 브라우저 로그인 시 자동 적용. 사용자가 프로필에서 변경하면
  // PUT /api/users/:id 가 user.language 를 갱신 → 이 effect 가 새 언어로 다시 changeLanguage.
  useEffect(() => {
    if (!user?.language) return;
    const lng = String(user.language).toLowerCase();
    if (lng !== 'ko' && lng !== 'en') return;
    if (i18n.language === lng) return;
    i18n.changeLanguage(lng);  // i18next-browser-languagedetector 가 localStorage 도 자동 갱신
  }, [user?.language]);

  // 멀티 롤 체크: platform_role 과 business_role 은 독립 권한. 하나라도 일치하면 통과.
  // 예: platform_admin + business_owner 겸임자는 둘 중 어느 쪽으로도 체크 가능.
  const hasRole = (...roles: string[]): boolean => {
    if (!user) return false;
    if (user.platform_role === 'platform_admin' && roles.includes('platform_admin')) return true;
    if (user.business_role === 'owner' && roles.includes('business_owner')) return true;
    if (user.business_role === 'member' && roles.includes('business_member')) return true;
    if (user.business_role === 'client' && roles.includes('client')) return true;
    // business_role 이 전혀 없는 유저도 client 로 간주 (하위 호환)
    if (!user.business_role && user.platform_role !== 'platform_admin' && roles.includes('client')) return true;
    return false;
  };

  // 워크스페이스 전환 — 백엔드에 active_business_id 영구 저장 + user 상태 갱신
  const switchWorkspace = async (businessId: number): Promise<boolean> => {
    if (!user) return false;
    if (user.business_id === businessId) return true; // 이미 active
    try {
      const res = await apiFetch('/api/auth/switch-workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: businessId }),
      });
      if (!res.ok) return false;
      const body = await res.json();
      if (!body.success || !body.data) return false;
      clearPageCache();   // 워크스페이스가 바뀌면 앞 워크스페이스 캐시는 전부 무효
      setUser(normalizeUser(body.data));
      return true;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[switchWorkspace] failed', e);
      return false;
    }
  };

  const isAuthenticated = !!user;

  return (
    <AuthContext.Provider value={{ user, isAuthenticated, isLoading, login, register, logout, updateUser, refreshUser, hasRole, switchWorkspace }}>
      {children}
    </AuthContext.Provider>
  );
};

export default AuthContext;
