// 답장 «받은 주소» 지킴이 (2026-11-02)
//
// Irene: *"이 메일로 메일받아서 답장을 했는데 왜 메인 메일주소로 가? 워프로랩 <help@wor-pro.com> … 받은 주소로 보내게 해야지."*
//
// 발신 규칙(qmail ⑥ — services/emailSend.resolveSender)은 «받은 주소가 이 메일함의 등록 별칭이면 그 주소» 다.
// 등록 안 된 주소로 받은 메일은 ③ 기본 별칭 → ④ 계정 본주소로 떨어진다. 같은 help@wor-pro.com 메일이
// 두 메일함에 같이 들어오는데 한쪽에만 별칭이 있어, 다른 쪽에서 답하면 **조용히** 본주소로 나갔다.
// 화면은 작은 회색 안내만 띄웠다 → 놓친다.
//
// 그래서: 발신 규칙은 그대로 두고(미등록 주소 자동 발송·자동 등록은 하지 않는다 — 외부 발송 신원 규칙 변경),
//   ① 받은 주소가 아닌 주소로 나갈 때는 **경고색 한 줄**로 «어느 주소로 나가는지» 를 말하고
//   ② [보내기] 를 누르면 한 번 묻는다 — [등록하고 그 주소로 보내기] / [그대로 보내기] / [취소].
// 사용자가 보내는 사람을 직접 골랐으면(fromAliasId !== null) 묻지 않는다 — 고른 것이 답이다.
import { useCallback, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../contexts/AuthContext';
import ConfirmDialog from '../../components/Common/ConfirmDialog';
import HelpDot from '../../components/Common/HelpDot';
import { FromManage } from './MailPage.styles';

type Addr = string | { name?: string; email: string };
type Msg = { direction?: string; to_emails?: Addr[] | null; cc_emails?: Addr[] | null };
type Alias = { id: number; email: string; display_name: string | null; is_default: boolean };

interface Opts {
  businessId: number | null | undefined;
  accountId: number | null | undefined;
  accountEmail: string;
  messages: Msg[] | undefined;
  receivedAt: string;          // MailPage 의 receivedAt (서버와 같은 순서 규칙)
  unknownReceived: boolean;    // 받은 주소가 계정 주소도, 등록 별칭도 아님
  fromAliasId: number | null;  // null = 미지정(서버 자동)
  outgoingFrom: string;        // 서버가 실제로 쓸 주소(미리보기 응답)
  onAdded: (alias: Alias) => void;
}

export function useReceivedAddressGuard(o: Opts) {
  const { t } = useTranslation('qmail');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [askOpen, setAskOpen] = useState(false);
  const pendingSend = useRef<((aliasId?: number) => void) | null>(null);

  // 받은 헤더에 적힌 이름(예: «워프로랩») — 별칭 표시 이름으로 같이 등록한다
  const receivedName = useMemo(() => {
    const last = [...(o.messages || [])].reverse().find((m) => m.direction === 'inbound');
    const hit = [...(last?.to_emails || []), ...(last?.cc_emails || [])]
      .find((x) => typeof x !== 'string' && String(x?.email || '').toLowerCase() === o.receivedAt);
    return hit && typeof hit !== 'string' ? String(hit.name || '').trim() : '';
  }, [o.messages, o.receivedAt]);

  const sendingFrom = (o.outgoingFrom || o.accountEmail || '').toLowerCase();
  // 미지정인데 받은 주소가 미등록 → 서버는 받은 주소가 아닌 곳으로 보낸다
  const willMiss = o.unknownReceived && o.fromAliasId === null && sendingFrom !== o.receivedAt;

  const register = useCallback(async (): Promise<number | null> => {
    if (!o.businessId || !o.accountId || !o.receivedAt) return null;
    setBusy(true); setError(null);
    try {
      const r = await apiFetch(`/api/businesses/${o.businessId}/email-accounts/${o.accountId}/aliases`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: o.receivedAt, ...(receivedName ? { display_name: receivedName } : {}) }),
      });
      const j = await r.json().catch(() => ({}));
      if (j?.success && j.data?.id) { o.onAdded(j.data); return Number(j.data.id); }
      setError(t('reply.receivedGuard.registerFailed', { defaultValue: '보내는 주소에 추가하지 못했어요. 설정 > 메일 계정에서 추가해 주세요.' }) as string);
      return null;
    } catch {
      setError(t('reply.receivedGuard.registerFailed', { defaultValue: '보내는 주소에 추가하지 못했어요. 설정 > 메일 계정에서 추가해 주세요.' }) as string);
      return null;
    } finally { setBusy(false); }
  }, [o, receivedName, t]);

  // [보내기] 앞의 문 — 받은 주소가 아닌 곳으로 나갈 참이면 먼저 묻는다
  const guardSend = useCallback((send: (aliasId?: number) => void) => {
    if (!willMiss) { send(); return; }
    pendingSend.current = send;
    setAskOpen(true);
  }, [willMiss]);

  const closeAsk = () => { setAskOpen(false); pendingSend.current = null; };
  const registerAndSend = async () => {
    const send = pendingSend.current;
    setAskOpen(false);
    const id = await register();
    pendingSend.current = null;
    if (id && send) send(id);   // 등록 실패면 보내지 않는다 — 조용히 본주소로 나가는 것이 이 사고다
  };
  const sendAnyway = () => { const send = pendingSend.current; closeAsk(); if (send) send(); };

  const vars = { addr: o.receivedAt, from: sendingFrom };
  const notice = o.unknownReceived ? (
    willMiss ? (
      <MissRow role="status" data-testid="mail-reply-received-miss">
        <span>{t('reply.receivedGuard.miss', { defaultValue: '{{addr}} 로 온 메일인데, 답장은 {{from}} 에서 나가요.', ...vars }) as string}</span>
        <MissButton type="button" disabled={busy} onClick={() => { void register(); }} data-testid="mail-reply-received-register">
          {t('reply.useReceived', { defaultValue: '보내는 주소에 {{addr}} 추가', addr: o.receivedAt }) as string}
        </MissButton>
        {error && <MissError role="alert">{error}</MissError>}
      </MissRow>
    ) : (
      <>
        <HelpDot>{t('reply.aliasHelpUnregistered', { defaultValue: '고객이 {{addr}} 로 보낸 메일이에요. 이 주소를 보내는 주소에 추가하면 답장도 이 주소에서 나가요.', addr: o.receivedAt }) as string}</HelpDot>
        <FromManage type="button" disabled={busy} onClick={() => { void register(); }}>
          {t('reply.useReceived', { defaultValue: '보내는 주소에 {{addr}} 추가', addr: o.receivedAt }) as string}
        </FromManage>
      </>
    )
  ) : null;

  const dialog = (
    <ConfirmDialog
      isOpen={askOpen}
      onClose={closeAsk}
      onConfirm={() => { void registerAndSend(); }}
      variant="info"
      title={t('reply.receivedGuard.askTitle', { defaultValue: '받은 주소에서 답장할까요?' }) as string}
      message={t('reply.receivedGuard.askMessage', { defaultValue: '고객이 {{addr}} 로 보낸 메일인데, 이 메일 계정의 보내는 주소에는 {{addr}} 가 없어요. 지금 보내면 {{from}} 에서 나갑니다.', ...vars }) as string}
      confirmText={t('reply.receivedGuard.askRegister', { defaultValue: '보내는 주소에 추가하고 {{addr}} 에서 보내기', ...vars }) as string}
      secondaryText={t('reply.receivedGuard.askAnyway', { defaultValue: '{{from}} 에서 보내기', ...vars }) as string}
      onSecondary={sendAnyway}
      cancelText={t('reply.cancel', { defaultValue: '취소' }) as string}
    />
  );

  return { guardSend, notice, willMiss, dialog };
}

// 경고색 한 줄 — 보내는 사람 줄 바로 아래. 상태 알림이라 액션 3톤 밖(버튼은 보조 톤).
const MissRow = styled.div`
  display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px;
  margin-top: 6px; padding: 8px 10px; border-radius: 8px;
  background: #FFFBEB; border: 1px solid #FCD34D; color: #92400E;
  font-size: 0.75rem; line-height: 1.45;
  span { flex: 1 1 220px; min-width: 0; overflow-wrap: anywhere; }
`;
const MissButton = styled.button`
  flex-shrink: 0; min-height: 32px; padding: 0 10px; border-radius: 7px;
  border: 1px solid #FCD34D; background: #FFFFFF; color: #92400E;
  font-size: 0.75rem; font-weight: 600; cursor: pointer;
  &:hover:not(:disabled) { background: #FEF3C7; }
  &:disabled { opacity: 0.6; cursor: default; }
  @media (max-width: 640px) { white-space: normal; overflow-wrap: anywhere; text-align: left; padding: 4px 10px; }
`;
const MissError = styled.span`flex-basis: 100%; color: #B91C1C;`;
