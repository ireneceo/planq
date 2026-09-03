// 게스트 답글 알림 신청 (#259 A안) — `/g/:token` 화면 안의 한 줄
//
// ★ 이 화면의 목표는 여전히 **가볍게 쓰게 하는 것**이다. 등록은 선택이고, 닫으면 다시 안 뜬다.
//   "알림 받으려면 가입하세요" 로 읽히면 안 된다 — 그것이 Irene 이 말한 불편이다.
//
// ★ 자기 등록을 만지는 수단은 **personal 토큰 하나**다(서버가 그것만 받는다).
//   확인 직후 딱 한 번 응답으로 오고, 그 뒤로는 알림 메일 안에만 있다. 이 브라우저는
//   그것을 localStorage 에 둔다 — 지우면 메일 링크로 들어와서 만지면 된다.
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';

type Props = {
  token: string;
  /** 만료·회수를 화면 전체에 알리는 통로 — 여기서 404 를 받으면 페이지가 만료 화면으로 간다. */
  onGone: () => void;
};

type MeState = {
  registered: boolean;
  verified?: boolean;
  unsubscribed?: boolean;
  email?: string | null;
  name?: string | null;
};

export default function GuestNotifySection({ token, onGone }: Props) {
  const { t, i18n } = useTranslation('guest');
  const savedKey = `guest:notify:${token}`;
  const hiddenKey = `guest:notifyHidden:${token}`;

  const [saved, setSaved] = useState<string>(() => {
    try { return localStorage.getItem(savedKey) || ''; } catch { return ''; }
  });
  const [me, setMe] = useState<MeState | null>(null);
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState<boolean>(() => {
    try { return localStorage.getItem(hiddenKey) === '1'; } catch { return false; }
  });
  const [step, setStep] = useState<'form' | 'code' | 'done'>('form');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [consent, setConsent] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  /** 내 등록 상태 — 현재 토큰(메일로 들어온 경우) 먼저, 없으면 저장해 둔 개인 토큰으로. */
  const loadMe = useCallback(async () => {
    const tryOne = async (tk: string): Promise<MeState | null> => {
      try {
        const r = await fetch(`/api/guest/${tk}/notify/me`);
        if (!r.ok) return null;
        const j = await r.json();
        return j?.success && j.data?.registered ? (j.data as MeState) : null;
      } catch { return null; }
    };
    const mine = (await tryOne(token)) || (saved ? await tryOne(saved) : null);
    if (mine) setMe(mine);
  }, [token, saved]);

  useEffect(() => { loadMe(); }, [loadMe]);

  // 메일의 "알림 그만 받기" 는 이 화면으로 데려올 뿐이다 — 끄는 것은 아래 버튼(POST).
  //   ★ GET 한 번으로 꺼지면 안 된다: 메일 스캐너가 링크를 미리 연다.
  const [unsubAsked] = useState(() => new URLSearchParams(window.location.search).get('unsub') === '1');

  /** 자기 등록을 만질 수 있는 토큰 — 없으면 손댈 수 없다. */
  const ownToken = me ? (saved || token) : '';

  const request = async () => {
    if (busy) return;
    setErr(null);
    if (!name.trim()) { setErr(t('notify.errName', { defaultValue: '이름을 입력해 주세요.' }) as string); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setErr(t('notify.errEmail', { defaultValue: '이메일 주소를 확인해 주세요.' }) as string); return; }
    if (!consent) { setErr(t('notify.errConsent', { defaultValue: '동의가 필요해요.' }) as string); return; }
    setBusy(true);
    try {
      const r = await fetch(`/api/guest/${token}/notify/request`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(), email: email.trim(), consent: true,
          locale: (i18n.language || 'ko').slice(0, 2),
        }),
      });
      if (r.status === 404) { onGone(); return; }
      if (r.status === 429) { setErr(t('notify.errTooMany', { defaultValue: '요청이 너무 잦아요. 잠시 후 다시 시도해 주세요.' }) as string); return; }
      if (!r.ok) { setErr(t('notify.errFailed', { defaultValue: '처리하지 못했어요. 잠시 후 다시 시도해 주세요.' }) as string); return; }
      setStep('code');
    } catch {
      setErr(t('notify.errFailed', { defaultValue: '처리하지 못했어요. 잠시 후 다시 시도해 주세요.' }) as string);
    } finally { setBusy(false); }
  };

  const verify = async () => {
    if (busy) return;
    setErr(null);
    setBusy(true);
    try {
      const r = await fetch(`/api/guest/${token}/notify/verify`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), code: code.trim() }),
      });
      if (r.status === 404) { onGone(); return; }
      if (r.status === 429) { setErr(t('notify.errLocked', { defaultValue: '시도가 많아 잠시 잠겼어요. 30분 뒤에 다시 해주세요.' }) as string); return; }
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.success) {
        // ★ 남은 횟수를 서버가 알려주지 않는다(알려주면 그것도 열거 신호다). 그러니
        //   "남은 시도 회" 처럼 빈 자리가 남는 문구를 쓰지 않는다.
        setErr(t('notify.errCodePlain', { defaultValue: '코드가 맞지 않아요.' }) as string);
        return;
      }
      // ★ 원문 토큰은 **여기 한 번**만 온다. 재확인이면 null 이므로 옛 값을 지우지 않는다.
      const pt = j.data?.personal_token;
      if (pt) { setSaved(pt); try { localStorage.setItem(savedKey, pt); } catch { /* 시크릿 창 */ } }
      setMe({ registered: true, verified: true, unsubscribed: false, email: j.data?.email, name: j.data?.name });
      setStep('done');
    } catch {
      setErr(t('notify.errFailed', { defaultValue: '처리하지 못했어요. 잠시 후 다시 시도해 주세요.' }) as string);
    } finally { setBusy(false); }
  };

  const setSubscribed = async (on: boolean) => {
    if (busy || !ownToken) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/guest/${ownToken}/notify/unsubscribe`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ on }),
      });
      if (r.ok) setMe((p) => (p ? { ...p, unsubscribed: !on } : p));
    } catch { /* 버튼이 그대로 남아 다시 누를 수 있다 */ }
    finally { setBusy(false); }
  };

  const removeMe = async () => {
    if (busy || !ownToken) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/guest/${ownToken}/notify`, { method: 'DELETE' });
      if (r.ok) {
        setMe(null); setSaved(''); setStep('form'); setConfirmDelete(false);
        try { localStorage.removeItem(savedKey); } catch { /* 시크릿 창 */ }
      }
    } catch { /* 위와 같다 */ }
    finally { setBusy(false); }
  };

  // ── 이미 등록한 사람 ──────────────────────────────────────────────────────
  if (me?.registered) {
    return (
      <Wrap data-testid="guest-notify-status">
        <Line>
          {me.unsubscribed
            ? t('notify.off', { defaultValue: '답글 알림 꺼짐' })
            : t('notify.on', { email: me.email || '', defaultValue: '답글 알림 켜짐' })}
        </Line>
        {/* 메일의 '알림 그만 받기' 로 들어온 자리 — 여기서 끄라고 말해 준다.
            전에는 등록 안내문(notify.lead)을 띄워서, 끄러 온 사람에게 신청을 권했다. */}
        {unsubAsked && !me.unsubscribed && (
          <Line style={{ color: '#0F766E' }}>
            {t('notify.unsubHint', { defaultValue: '아래 “알림 끄기” 를 누르면 더 이상 메일을 보내지 않습니다.' })}
          </Line>
        )}
        <Row>
          {me.unsubscribed ? (
            <Btn type="button" onClick={() => setSubscribed(true)} disabled={busy} data-testid="guest-notify-resub">
              {t('notify.resubscribe', { defaultValue: '알림 다시 받기' })}
            </Btn>
          ) : (
            <Btn type="button" $ghost onClick={() => setSubscribed(false)} disabled={busy} data-testid="guest-notify-unsub">
              {t('notify.unsubscribe', { defaultValue: '알림 끄기' })}
            </Btn>
          )}
          {confirmDelete ? (
            <>
              <Small>{t('notify.removeAsk', { defaultValue: '이름과 이메일을 지울까요? 알림도 함께 꺼집니다.' })}</Small>
              <Btn type="button" $danger onClick={removeMe} disabled={busy} data-testid="guest-notify-remove-confirm">
                {t('notify.remove', { defaultValue: '등록한 정보 지우기' })}
              </Btn>
            </>
          ) : (
            <Btn type="button" $ghost onClick={() => setConfirmDelete(true)} disabled={busy} data-testid="guest-notify-remove">
              {t('notify.remove', { defaultValue: '등록한 정보 지우기' })}
            </Btn>
          )}
        </Row>
      </Wrap>
    );
  }

  if (hidden) return null;

  // ── 아직 등록 안 한 사람 ──────────────────────────────────────────────────
  return (
    <Wrap data-testid="guest-notify">
      {!open ? (
        <Row>
          <Line>{t('notify.cta', { defaultValue: '답글 오면 알려드릴까요?' })}</Line>
          <Btn type="button" onClick={() => setOpen(true)} data-testid="guest-notify-open">
            {t('notify.submit', { defaultValue: '알림 신청' })}
          </Btn>
          <Close type="button" aria-label={t('notify.cancel', { defaultValue: '닫기' }) as string}
            onClick={() => { setHidden(true); try { localStorage.setItem(hiddenKey, '1'); } catch { /* 시크릿 창 */ } }}>
            ×
          </Close>
        </Row>
      ) : step === 'code' ? (
        <>
          <Line>{t('notify.codeSent', { email: email.trim(), defaultValue: '인증 코드를 보냈어요.' })}</Line>
          <Row>
            <Input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder={t('notify.codePh', { defaultValue: '인증 코드 6자리' }) as string}
              inputMode="numeric" data-testid="guest-notify-code" />
            <Btn type="button" onClick={verify} disabled={busy || code.length < 4} data-testid="guest-notify-verify">
              {t('notify.verify', { defaultValue: '확인' })}
            </Btn>
            <Btn type="button" $ghost onClick={request} disabled={busy}>
              {t('notify.resend', { defaultValue: '코드 다시 받기' })}
            </Btn>
          </Row>
          {err && <ErrLine>{err}</ErrLine>}
        </>
      ) : (
        <>
          <Line>{t('notify.lead', { defaultValue: '이름과 이메일을 남기시면 답글이 올 때 메일로 알려드려요.' })}</Line>
          <Row>
            <Input value={name} onChange={(e) => setName(e.target.value.slice(0, 30))}
              placeholder={t('notify.namePh', { defaultValue: '이름' }) as string}
              data-testid="guest-notify-name" />
            <Input value={email} onChange={(e) => setEmail(e.target.value.slice(0, 200))}
              placeholder={t('notify.emailPh', { defaultValue: '이메일' }) as string}
              inputMode="email" data-testid="guest-notify-email" />
          </Row>
          <ConsentRow>
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)}
              id="guest-notify-consent" data-testid="guest-notify-consent" />
            <label htmlFor="guest-notify-consent">
              {t('notify.consent', { defaultValue: '개인정보 수집·이용에 동의합니다' })}
            </label>
            <a href="/privacy" target="_blank" rel="noopener noreferrer">
              {t('notify.consentLink', { defaultValue: '처리방침 보기' })}
            </a>
          </ConsentRow>
          <Row>
            <Btn type="button" onClick={request} disabled={busy} data-testid="guest-notify-submit">
              {t('notify.submit', { defaultValue: '알림 신청' })}
            </Btn>
            <Btn type="button" $ghost onClick={() => setOpen(false)}>
              {t('notify.cancel', { defaultValue: '닫기' })}
            </Btn>
          </Row>
          {err && <ErrLine>{err}</ErrLine>}
        </>
      )}
    </Wrap>
  );
}

const Wrap = styled.div`
  position:relative;background:#F8FAFC;border-bottom:1px solid #E2E8F0;
  padding:10px 40px 10px 16px;
`;
const Line = styled.div`font-size:0.8125rem;color:#334155;line-height:1.5;`;
const Small = styled.div`font-size:0.75rem;color:#64748B;line-height:1.5;`;
const ErrLine = styled.div`font-size:0.75rem;color:#B91C1C;margin-top:6px;`;
const Row = styled.div`display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:8px;`;
const ConsentRow = styled.div`
  display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:8px;
  font-size:0.75rem;color:#475569;
  a{color:#0D9488;}
  /* 아이콘·체크박스도 rem — px 는 글자 배율을 안 따라가고, 하드코딩 높이 가드에도 걸린다. */
  input{width:1.125rem;height:1.125rem;}
`;
const Input = styled.input`
  flex:0 1 200px;min-width:0;min-height:44px;padding:8px 10px;
  border:1px solid #CBD5E1;border-radius:8px;font-size:1rem;background:#fff;
`;
const Btn = styled.button<{ $ghost?: boolean; $danger?: boolean }>`
  min-height:44px;padding:0 14px;border-radius:8px;font-size:0.8125rem;font-weight:700;cursor:pointer;
  border:${(p) => (p.$ghost ? '1px solid #CBD5E1' : '0')};
  background:${(p) => (p.$danger ? '#DC2626' : p.$ghost ? '#fff' : '#0D9488')};
  color:${(p) => (p.$ghost ? '#475569' : '#fff')};
  &:disabled{background:#cbd5e1;color:#fff;cursor:not-allowed;}
`;
const Close = styled.button`
  position:absolute;top:4px;right:4px;width:36px;height:36px;
  border:0;background:none;color:#64748B;font-size:1.125rem;line-height:1;cursor:pointer;
`;
