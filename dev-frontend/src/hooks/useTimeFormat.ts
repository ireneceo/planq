// 컴포넌트에서 쓰는 워크스페이스 tz 바인딩 포맷터.
// 모든 사용자 대면 시각은 이 훅의 결과를 거쳐야 한다.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/AuthContext';
import { detectBrowserTz } from '../utils/timezones';
import {
  formatDate as fmtDate,
  formatTime as fmtTime,
  formatDateTime as fmtDateTime,
  formatTimeAgo as fmtTimeAgo,
} from '../utils/dateFormat';

export function useTimeFormat() {
  const { user } = useAuth();
  const { t, i18n } = useTranslation('common');
  const tz = user?.workspace_timezone || detectBrowserTz();
  const locale = i18n.language?.startsWith('en') ? 'en-US' : 'ko-KR';
  // 포맷터는 모듈 사본(setDatePrefs)을 읽는다 — 설정을 바꾸면 다시 그려지도록 값을 의존성에 싣는다.
  const prefKey = `${user?.date_format || ''}|${user?.time_format || ''}|${user?.week_start || ''}`;

  return useMemo(() => ({
    tz,
    formatDate: (iso: string | Date) => fmtDate(iso, tz, locale),
    formatTime: (iso: string | Date) => fmtTime(iso, tz, locale),
    formatDateTime: (iso: string | Date) => fmtDateTime(iso, tz, locale),
    formatTimeAgo: (iso: string | Date) => fmtTimeAgo(iso, tz, locale, t as unknown as (k: string, o?: Record<string, unknown>) => string),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [tz, locale, t, prefKey]);
}
