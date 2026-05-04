// 인박스 상단 — 디바이스 알림이 꺼져 있을 때 켜기 유도 띠 배너.
//   - status: default-off / granted-off / denied 일 때 표시
//   - unsupported / granted-on 이면 미표시
//   - dismiss 는 sessionStorage (탭 닫으면 다시 표시 — 적극 유도)
//   - 차단(denied) 케이스는 켤 수 없으므로 브라우저 설정 안내만
import { useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { usePushStatus } from '../../hooks/usePushStatus';

const SESSION_DISMISS_KEY = 'pq_push_prompt_dismiss_session';

export default function PushPromptBanner() {
  const { t } = useTranslation('settings');
  const { status, refresh } = usePushStatus();
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try { return sessionStorage.getItem(SESSION_DISMISS_KEY) === '1'; } catch { return false; }
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (dismissed) return null;
  if (status === 'loading' || status === 'unsupported' || status === 'granted-on') return null;

  const dismiss = () => {
    try { sessionStorage.setItem(SESSION_DISMISS_KEY, '1'); } catch { /* */ }
    setDismissed(true);
  };

  const handleEnable = async () => {
    setBusy(true); setErr(null);
    const { subscribe } = await import('../../services/push');
    const r = await subscribe();
    setBusy(false);
    if (r.ok) {
      await refresh();
    } else {
      setErr(t('pushPrompt.errMsg', '알림 켜기 실패: {{r}}', { r: r.reason || '' }) as string);
    }
  };

  const isDenied = status === 'denied';

  return (
    <Banner role="status">
      <BellIcon>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
        </svg>
      </BellIcon>
      <Body>
        <Title>
          {isDenied
            ? t('pushPrompt.deniedTitle', '디바이스 알림이 차단되어 있습니다')
            : t('pushPrompt.title', '디바이스 알림이 꺼져 있어요')}
        </Title>
        <Desc>
          {isDenied
            ? t('pushPrompt.deniedDesc', '브라우저 사이트 설정에서 알림을 "허용" 으로 변경하면 받을 수 있습니다.')
            : t('pushPrompt.desc', 'PlanQ 를 안 보고 있을 때도 새 메시지·업무 알림을 받으려면 켜주세요.')}
        </Desc>
        {err && <Err>{err}</Err>}
      </Body>
      {!isDenied && (
        <CtaBtn type="button" onClick={handleEnable} disabled={busy}>
          {busy ? t('pushPrompt.enabling', '켜는 중…') : t('pushPrompt.enable', '지금 켜기')}
        </CtaBtn>
      )}
      <CloseBtn type="button" onClick={dismiss} aria-label={t('common.close', '닫기') as string}>×</CloseBtn>
    </Banner>
  );
}

const Banner = styled.div`
  display: grid;
  grid-template-columns: 36px 1fr auto auto;
  gap: 12px;
  align-items: center;
  padding: 12px 14px;
  background: #FFF7ED;
  border: 1px solid #FED7AA;
  border-radius: 10px;
  margin-bottom: 16px;
`;
const BellIcon = styled.div`
  width: 36px; height: 36px;
  display: flex; align-items: center; justify-content: center;
  background: #FFEDD5;
  color: #C2410C;
  border-radius: 8px;
`;
const Body = styled.div`min-width: 0; display: flex; flex-direction: column; gap: 2px;`;
const Title = styled.div`font-size: 13px; font-weight: 700; color: #9A3412; line-height: 1.3;`;
const Desc = styled.div`font-size: 12px; color: #7C2D12; line-height: 1.4;`;
const Err = styled.div`font-size: 11px; color: #B91C1C; margin-top: 4px;`;
const CtaBtn = styled.button`
  height: 32px; padding: 0 14px;
  background: #14B8A6; color: #FFFFFF; border: none; border-radius: 8px;
  font-size: 12px; font-weight: 600; cursor: pointer;
  transition: background 0.15s;
  &:hover:not(:disabled) { background: #0D9488; }
  &:disabled { opacity: 0.6; cursor: not-allowed; }
`;
const CloseBtn = styled.button`
  width: 28px; height: 28px;
  background: transparent; border: none; cursor: pointer;
  color: #C2410C; font-size: 18px; line-height: 1;
  display: flex; align-items: center; justify-content: center;
  border-radius: 4px;
  &:hover { background: #FED7AA; }
`;
