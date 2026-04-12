import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

export type UserRole = 'platform_admin' | 'business_owner' | 'business_member' | 'client';

export interface User {
  id: string;
  email: string;
  name: string;
  platform_role: string;
  business_id?: number | null;
  business_name?: string | null;
  business_role?: string | null;
  language?: string | null;
  // Q Note 답변 생성용 프로필
  bio?: string | null;
  expertise?: string | null;
  organization?: string | null;
  job_title?: string | null;
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<boolean>;
  register: (name: string, email: string, password: string, businessName: string) => Promise<boolean>;
  logout: () => void;
  updateUser: (userData: Partial<User>) => void;
  hasRole: (...roles: string[]) => boolean;
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

export const getAccessToken = () => accessToken;

const setAccessToken = (token: string | null) => {
  accessToken = token;
};

// API 호출 헬퍼 — 자동으로 토큰 주입 + 401 시 refresh 시도
const apiFetch = async (url: string, options: RequestInit = {}): Promise<Response> => {
  const headers = new Headers(options.headers || {});
  if (accessToken && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${accessToken}`);
  }

  const response = await fetch(url, {
    ...options,
    headers,
    credentials: 'include', // HttpOnly cookie 전송
  });

  // 401이면 refresh 시도
  if (response.status === 401 && !url.includes('/api/auth/refresh') && !url.includes('/api/auth/login')) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      // 새 토큰으로 재시도
      const retryHeaders = new Headers(options.headers || {});
      retryHeaders.set('Authorization', `Bearer ${accessToken}`);
      return fetch(url, { ...options, headers: retryHeaders, credentials: 'include' });
    }
  }

  return response;
};

// Refresh 시도
const tryRefresh = async (): Promise<boolean> => {
  try {
    const res = await fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'include',
    });
    if (res.ok) {
      const data = await res.json();
      if (data.success && data.data?.token) {
        setAccessToken(data.data.token);
        return true;
      }
    }
  } catch { /* ignore */ }
  setAccessToken(null);
  return false;
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
    name: (apiUser.name || (apiUser.email as string)?.split('@')[0]) as string,
    platform_role: apiUser.platform_role as string,
    business_id: (apiUser.business_id as number) || null,
    business_name: (apiUser.business_name as string) || null,
    business_role: (apiUser.business_role as string) || null,
    language: (apiUser.language as string) || null,
    bio: (apiUser.bio as string) || null,
    expertise: (apiUser.expertise as string) || null,
    organization: (apiUser.organization as string) || null,
    job_title: (apiUser.job_title as string) || null,
  });

  // UserRole 매핑: platform_role + business_role → 사이드바용 role
  const getUserRole = (u: User): UserRole => {
    if (u.platform_role === 'platform_admin') return 'platform_admin';
    if (u.business_role === 'owner') return 'business_owner';
    if (u.business_role === 'member') return 'business_member';
    return 'client';
  };

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

    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const login = async (email: string, password: string): Promise<boolean> => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password }),
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

  const register = async (name: string, email: string, password: string, businessName: string): Promise<boolean> => {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password, name, business_name: businessName }),
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

  const hasRole = (...roles: string[]): boolean => {
    if (!user) return false;
    const role = getUserRole(user);
    return roles.includes(role);
  };

  const isAuthenticated = !!user;

  return (
    <AuthContext.Provider value={{ user, isAuthenticated, isLoading, login, register, logout, updateUser, hasRole }}>
      {children}
    </AuthContext.Provider>
  );
};

export default AuthContext;
