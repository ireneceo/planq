import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import i18n from '../i18n';

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
  register: (name: string, email: string, password: string, businessName: string, opts?: { terms_accepted?: boolean; privacy_accepted?: boolean }) => Promise<boolean>;
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

// 클라이언트 종류 감지 — PWA standalone 이면 'pwa' (모바일 앱), 아니면 'web' (브라우저).
// 백엔드에 전달되어 refresh_token TTL 결정 (pwa=365일 / web=30일 sliding renewal).
// SSR 환경 안전성 — window 미존재 시 'web' 기본.
const detectClientKind = (): 'pwa' | 'web' => {
  if (typeof window === 'undefined') return 'web';
  try {
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
let refreshInflight: Promise<boolean> | null = null;

// Refresh 시도. 동시 호출은 동일 promise 공유.
//   네트워크 blip / 서버 reload 일시 실패 흡수: 첫 호출 실패 + 응답 status 가 0 (네트워크) 또는
//   5xx 면 1.5초 뒤 1회 재시도. 401 (인증 만료) 은 즉시 false (재시도 무의미).
const tryRefresh = (): Promise<boolean> => {
  if (refreshInflight) return refreshInflight;
  refreshInflight = (async () => {
    const callOnce = async (): Promise<{ ok: boolean; networkOrServer: boolean; status?: number }> => {
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
            return { ok: true, networkOrServer: false, status: 200 };
          }
          return { ok: false, networkOrServer: false, status: res.status };
        }
        // 진단: 401 vs 5xx 구분
        if (res.status === 401) {
          console.warn('[auth.refresh] 401 — cookie 가 사라졌거나 refresh token invalid. 자동 logout 진행.');
        } else if (res.status >= 500) {
          console.warn('[auth.refresh] 5xx status=' + res.status + ' — 서버 일시 오류, 재시도.');
        }
        return { ok: false, networkOrServer: res.status >= 500, status: res.status };
      } catch (e) {
        console.warn('[auth.refresh] network error', (e as Error).message);
        return { ok: false, networkOrServer: true };
      }
    };
    const first = await callOnce();
    if (first.ok) return true;
    if (first.networkOrServer) {
      await new Promise((r) => setTimeout(r, 1500));
      const second = await callOnce();
      if (second.ok) return true;
    }
    setAccessToken(null);
    return false;
  })();
  // 끝나면 슬롯 비우기 (다음 만료 사이클에서 새로 시도 가능)
  refreshInflight.finally(() => {
    refreshInflight = null;
  });
  return refreshInflight;
};

// API 호출 헬퍼.
//   1) 능동적 만료 검사: 토큰 만료 30초 이내면 호출 전 refresh
//      (슬립/탭드리프트로 setTimeout 타이머 놓친 케이스 흡수)
//   2) 정상 fetch
//   3) 401 응답 시 (서버가 token_expired/invalid_token 등) refresh 후 재시도
//   4) 단일 in-flight refresh 로 thundering herd 방지
const PROACTIVE_REFRESH_MS = 30 * 1000;

const apiFetch = async (url: string, options: RequestInit = {}): Promise<Response> => {
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

  const response = await fetch(url, {
    ...options,
    headers,
    credentials: 'include', // HttpOnly cookie 전송
  });

  // 401 reactive refresh — 서버가 token_expired/invalid_token 등으로 401 보낸 경우
  if (response.status === 401 && !isAuthEndpoint) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      const retryHeaders = new Headers(options.headers || {});
      retryHeaders.set('Authorization', `Bearer ${accessToken}`);
      return fetch(url, { ...options, headers: retryHeaders, credentials: 'include' });
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

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const navigate = useNavigate();
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
  const scheduleRefresh = useCallback(() => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    // 14분 후 갱신 (15분 만료 기준 1분 전)
    refreshTimerRef.current = setTimeout(async () => {
      const success = await tryRefresh();
      if (success) {
        scheduleRefresh();
      } else {
        setUser(null);
        setAccessToken(null);
        navigate('/login');
      }
    }, 14 * 60 * 1000);
  }, [navigate]);

  // 초기 세션 확인 — refresh token cookie로 복원 시도
  useEffect(() => {
    const checkSession = async () => {
      try {
        // 기존 localStorage 토큰 마이그레이션
        const legacyToken = localStorage.getItem('auth_token');
        if (legacyToken) {
          setAccessToken(legacyToken);
          localStorage.removeItem('auth_token');
        }

        // refresh 시도
        const refreshed = await tryRefresh();
        if (refreshed) {
          const res = await apiFetch('/api/auth/me');
          if (res.ok) {
            const result = await res.json();
            if (result.success && result.data) {
              setUser(normalizeUser(result.data));
              scheduleRefresh();
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
      if (remaining < 60 * 1000) {
        const ok = await tryRefresh();
        if (ok) {
          scheduleRefresh();
        } else {
          // refresh token 도 만료됐다면 강제 로그인
          setUser(null);
          setAccessToken(null);
          if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
          navigate('/login');
        }
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

  const register = async (name: string, email: string, password: string, businessName: string, opts?: { terms_accepted?: boolean; privacy_accepted?: boolean }): Promise<boolean> => {
    const clientKind = detectClientKind();
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Client-Kind': clientKind },
      credentials: 'include',
      body: JSON.stringify({
        email, password, name, business_name: businessName,
        client_kind: clientKind,
        terms_accepted: opts?.terms_accepted ?? false,
        privacy_accepted: opts?.privacy_accepted ?? false,
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
    setUser(null);
    setAccessToken(null);
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    navigate('/login');
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
