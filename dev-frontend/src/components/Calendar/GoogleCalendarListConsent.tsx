// 구글 «캘린더 목록 보기» 권한을 한 번 더 묻는 버튼 — 한 벌 (2026-10-12, Fable 2단계 판정 1·7).
//
//   이 권한(calendar.calendarlist.readonly)은 평소 [캘린더 연결] 에서 묻지 않는다(점진적 동의 — 구글 앱 심사 전이라
//   묻는 순간 «확인되지 않은 앱» 경고와 신규 사용자 100명 한도에 걸린다). 그래서 **누른 사람에게만** 묻는다.
//   쓰는 곳 두 군데 — 내 외부 연동 › 구글 캘린더(올릴 캘린더 고르기) · Q calendar 의 Google 칩(보기/가리기).
//   두 곳이 각자 연결 흐름을 짜면 한쪽만 고쳐진다 — 이 버튼 하나를 같이 쓴다.
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import { apiFetch } from '../../contexts/AuthContext';
import { startAuthPopup } from '../../services/oauth';
import { isNativeApp } from '../../services/native';
import { useOauthPopupDone } from '../../hooks/useOauthPopupDone';

export default function GoogleCalendarListConsent({ businessId, onDone, 'data-testid': testId }: {
  businessId: number | null | undefined; onDone?: () => void; 'data-testid'?: string;
}) {
  const { t } = useTranslation('profile');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  // 완료 — 웹 팝업 신호 세 길 + 네이티브 앱 복귀(hooks/useOauthPopupDone, 내 외부 연동 화면과 같은 훅). 누른 동안만 듣는다.
  useOauthPopupDone({
    enabled: busy,
    types: ['personal:connected'],
    onDone: (p) => {
      setBusy(false);
      if (p.ok) doneRef.current?.();
      else setErr(t('integrations.connectFailed2', { defaultValue: '연결에 실패했어요. 다시 시도해 주세요.' }) as string);
    },
    onDismiss: () => setBusy(false),
  });

  const start = async () => {
    if (!businessId || busy) return;
    setErr(null);
    setBusy(true);
    try {
      const r = await apiFetch('/api/me/oauth/google/initiate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'google_calendar', business_id: businessId, client: isNativeApp() ? 'native' : 'web', extra: 'calendar_list' }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.success || !j.data?.auth_url) throw new Error('initiate_failed');
      const popup = await startAuthPopup(j.data.auth_url, 'planq-personal-oauth', 'width=520,height=660');
      if (!isNativeApp() && !popup) {
        setBusy(false);
        setErr(t('integrations.popupBlocked', { defaultValue: '팝업이 차단되었어요. 브라우저에서 팝업을 허용해 주세요.' }) as string);
      }
    } catch {
      setBusy(false);
      setErr(t('integrations.connectFailed2', { defaultValue: '연결에 실패했어요. 다시 시도해 주세요.' }) as string);
    }
  };

  return (
    <>
      <LinkBtn type="button" onClick={start} disabled={busy || !businessId} data-testid={testId}>
        {t('integrations.calendarListLoad', { defaultValue: '구글 캘린더 목록 불러오기' }) as string}
      </LinkBtn>
      {err && <Err role="alert">{err}</Err>}
    </>
  );
}

const LinkBtn = styled.button`
  all:unset;cursor:pointer;font-size:0.75rem;font-weight:600;color:#0F766E;
  &:hover{text-decoration:underline;} &:disabled{opacity:0.5;cursor:default;}
  &:focus-visible{outline:2px solid #14B8A6;outline-offset:2px;border-radius:4px;}
`;
const Err = styled.span`font-size:0.75rem;color:#DC2626;`;
