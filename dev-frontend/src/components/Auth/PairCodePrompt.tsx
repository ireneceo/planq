// 앱 로그인 마무리 — 브라우저에 뜬 6자리를 입력받는다.
//
// ★ 왜 (2026-09-06 운영, Irene 안드로이드 태블릿): "앱에서 로그인해도 돌아가지 않아."
//   planq:// 스킴도 https App Link 도 앱을 열지 못했다(설치된 앱의 필터/서명 — 서버로는 못 고침).
//   딥링크가 둘 다 실패해도 로그인이 끝나게 하는 **마지막 길**이다.
//
// ★ 왜 하필 사용자가 입력하나: 코드는 **로그인을 마친 그 브라우저 화면에서만** 생겨난다.
//   앱이 비밀을 만들어 보내는 방식(첫 설계)은 계정 탈취가 됐다 — 비밀을 고르는 쪽이 곧
//   공격자가 될 수 있었다. 사람이 자기 화면에서 읽어 자기 앱에 넣는 이 경로는 그 벡터가 없다.
//   (dev-backend/services/oauthPairing.js 머리말)
//
// 노출 조건: 네이티브 앱 + 진행 중인 페어링이 있고 + 아직 로그인되지 않았을 때만.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import { isNativeApp } from '../../services/native';
import { pendingPairId, clearPair, claimWithCode } from '../../services/oauth';
import { useEscapeStack } from '../../hooks/useEscapeStack';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';

const PairCodePrompt: React.FC<{ authed: boolean }> = ({ authed }) => {
  const { t } = useTranslation('auth');
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  // 앱이 앞으로 나올 때마다 진행 중인 흐름이 있는지 본다 (브라우저에서 돌아온 순간).
  useEffect(() => {
    if (!isNativeApp() || authed) return;
    const check = () => setOpen(!!pendingPairId());
    check();
    const onVis = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('planq:oauth-dismissed', check);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('planq:oauth-dismissed', check);
    };
  }, [authed]);

  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);

  const close = useCallback(() => { clearPair(); setOpen(false); setCode(''); setErr(null); }, []);
  // CLAUDE.md 드로어 접근성 — 세 훅은 필수. (2026-09-06 Fable 지적)
  useEscapeStack(open, close);
  useBodyScrollLock(open);
  useFocusTrap(cardRef, open);

  const submit = useCallback(async () => {
    if (busy || code.replace(/\D/g, '').length !== 6) return;
    setBusy(true); setErr(null);
    const r = await claimWithCode(code);
    setBusy(false);
    if (r.ok) { window.location.replace('/inbox'); return; }
    // 사유별로 다르게 말한다 — "틀렸다" 와 "만료됐다" 는 사용자가 할 일이 다르다.
    const msg: Record<string, string> = {
      bad_code: t('pair.errBad', { defaultValue: '코드가 맞지 않습니다. 다시 확인해 주세요.' }) as string,
      not_ready: t('pair.errNotReady', { defaultValue: '아직 로그인이 끝나지 않았습니다.' }) as string,
      too_many_attempts: t('pair.errTooMany', { defaultValue: '시도 횟수를 넘겼습니다. 처음부터 다시 로그인해 주세요.' }) as string,
      expired_or_unknown: t('pair.errExpired', { defaultValue: '코드가 만료됐습니다. 다시 로그인해 주세요.' }) as string,
    };
    setErr(msg[r.reason || ''] || (t('pair.errGeneric', { defaultValue: '로그인을 마치지 못했습니다.' }) as string));
    if (r.reason === 'too_many_attempts' || r.reason === 'expired_or_unknown') setOpen(false);
  }, [busy, code, t]);

  if (!open) return null;
  return (
    <Backdrop role="dialog" aria-modal="true" aria-label={t('pair.title', { defaultValue: '로그인 마무리' }) as string}>
      <Card ref={cardRef}>
        <Title>{t('pair.title', { defaultValue: '로그인 마무리' }) as string}</Title>
        <Desc>{t('pair.desc', { defaultValue: '브라우저 화면에 표시된 6자리 코드를 입력해 주세요.' }) as string}</Desc>
        <CodeInput
          ref={inputRef}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          placeholder="000000"
          aria-label={t('pair.desc', { defaultValue: '브라우저 화면에 표시된 6자리 코드' }) as string}
        />
        {err && <ErrText role="alert">{err}</ErrText>}
        <Primary type="button" disabled={busy || code.length !== 6} onClick={() => void submit()}>
          {busy ? (t('pair.submitting', { defaultValue: '확인 중…' }) as string)
                : (t('pair.submit', { defaultValue: '로그인 완료' }) as string)}
        </Primary>
        <Ghost type="button" onClick={close}>{t('pair.cancel', { defaultValue: '취소' }) as string}</Ghost>
      </Card>
    </Backdrop>
  );
};

export default PairCodePrompt;

const Backdrop = styled.div`
  position: fixed; inset: 0; z-index: 9500;
  background: rgba(15,23,42,0.45);
  display: flex; align-items: center; justify-content: center; padding: 24px;
`;
const Card = styled.div`
  width: 100%; max-width: 340px; background: #fff; border-radius: 14px;
  padding: 22px 20px; text-align: center;
  box-shadow: 0 12px 32px rgba(15,23,42,0.18);
  /* 안전영역은 토큰으로만 — 원시 env() 는 키보드 up override 를 통과해 빈 띠를 만든다
     (memory feedback_safe_area_token_not_raw_env). */
  padding-bottom: calc(22px + var(--pq-safe-bottom, 0px));
`;
const Title = styled.h2`margin: 0 0 6px; font-size: 1.0625rem; font-weight: 700; color: #0F172A;`;
const Desc = styled.p`margin: 0 0 16px; font-size: 0.8125rem; line-height: 1.6; color: #475569;`;
const CodeInput = styled.input`
  width: 100%; box-sizing: border-box; height: 52px;
  border: 1px solid #CBD5E1; border-radius: 10px; background: #F8FAFC;
  font-size: 1.5rem; font-weight: 800; letter-spacing: 8px; text-align: center;
  color: #0F172A; font-variant-numeric: tabular-nums;
  &::placeholder { color: #CBD5E1; letter-spacing: 8px; }
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.15); }
`;
const ErrText = styled.p`margin: 10px 0 0; font-size: 0.75rem; color: #DC2626; line-height: 1.5;`;
const Primary = styled.button`
  width: 100%; height: 44px; margin-top: 14px;
  background: #115E59; color: #fff; border: none; border-radius: 10px;
  font-size: 0.9375rem; font-weight: 600; cursor: pointer;
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
const Ghost = styled.button`
  width: 100%; height: 40px; margin-top: 6px;
  background: none; border: none; color: #64748B;
  font-size: 0.8125rem; cursor: pointer;
`;
