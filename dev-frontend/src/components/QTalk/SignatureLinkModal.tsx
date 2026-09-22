// 채팅 카드의 [서명하기] — **본인 이메일로 링크를 받는다** (2026-09-22, 설계 §4).
//
// 왜: 여러 사람이 보는 방에 서명자별 링크(= 그 사람의 열쇠)를 올리지 않는다. 여태 카드에
//   첫 서명자의 토큰 URL 이 실려 있어, 방에 있는 누구나 그 사람 대신 서명 화면에 들어갈 수 있었다.
//
// 열거 방지: 서버는 명단에 없어도 **같은 응답**을 준다. 그래서 이 화면도 "보냈습니다" 하나로만 말한다
//   — "그 주소는 서명자가 아닙니다" 라고 알려 주면 이 창이 명단 조회 창구가 된다.
import React, { useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import StandardModal from '../Common/StandardModal';
import ActionButton from '../Common/ActionButton';

interface Props {
  open: boolean;
  onClose: () => void;
  entityType: 'post' | 'document';
  entityId: number;
  docTitle: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const SignatureLinkModal: React.FC<Props> = ({ open, onClose, entityType, entityId, docTitle }) => {
  const { t } = useTranslation('qtalk');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => { if (busy) return; setEmail(''); setSent(false); setError(null); onClose(); };

  const submit = async () => {
    if (busy || !EMAIL_RE.test(email.trim())) return;
    setBusy(true); setError(null);
    try {
      // 공개(무인증) 라우트 — apiFetch 를 쓰지 않는다. 손님도 이 카드를 본다.
      const r = await fetch('/api/sign/request-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entity_type: entityType, entity_id: entityId, email: email.trim().toLowerCase() }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.success) {
        setError(r.status === 429
          ? (t('signLink.tooMany', { defaultValue: '요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.' }) as string)
          : (t('signLink.failed', { defaultValue: '보내지 못했습니다. 잠시 후 다시 시도해 주세요.' }) as string));
        return;
      }
      setSent(true);
    } catch {
      setError(t('signLink.failed', { defaultValue: '보내지 못했습니다. 잠시 후 다시 시도해 주세요.' }) as string);
    } finally { setBusy(false); }
  };

  return (
    <StandardModal
      open={open}
      onClose={close}
      title={t('signLink.title', { defaultValue: '서명 링크 받기' }) as string}
      size="sm"
      footer={sent ? (
        <ActionButton tone="primary" type="button" onClick={close}>{t('common.close', { defaultValue: '닫기' }) as string}</ActionButton>
      ) : (
        <>
          <ActionButton tone="secondary" type="button" onClick={close} disabled={busy}>
            {t('common.cancel', { defaultValue: '취소' }) as string}
          </ActionButton>
          <ActionButton
            tone="primary" type="button" data-testid="sign-link-send"
            onClick={() => void submit()} loading={busy} disabled={busy || !EMAIL_RE.test(email.trim())}
          >
            {t('signLink.send', { defaultValue: '링크 보내기' }) as string}
          </ActionButton>
        </>
      )}
    >
      <DocLine>{docTitle}</DocLine>
      {sent ? (
        <Sent data-testid="sign-link-sent">
          {t('signLink.sentMsg', { defaultValue: '서명자 명단에 있는 주소라면 방금 링크를 보냈습니다. 메일함을 확인해 주세요.' }) as string}
        </Sent>
      ) : (
        <>
          <Hint>{t('signLink.hint', { defaultValue: '서명 링크는 본인 이메일로만 보냅니다. 서명 요청을 받은 주소를 입력해 주세요.' }) as string}</Hint>
          <Input
            type="email" value={email} autoFocus
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void submit(); }}
            placeholder="email@example.com" autoComplete="email" spellCheck={false}
            disabled={busy}
          />
          {error && <ErrorBar role="alert">{error}</ErrorBar>}
        </>
      )}
    </StandardModal>
  );
};

export default SignatureLinkModal;

const DocLine = styled.div`font-size:0.875rem;font-weight:700;color:#0F172A;margin-bottom:8px;`;
const Hint = styled.div`font-size:0.75rem;color:#64748B;margin-bottom:10px;line-height:1.55;`;
const Input = styled.input`
  width:100%;height:40px;padding:0 12px;border:1px solid #CBD5E1;border-radius:8px;
  font-size:0.875rem;color:#0F172A;
  &:focus { outline:none;border-color:#14B8A6;box-shadow:0 0 0 3px rgba(20,184,166,0.15); }
`;
const Sent = styled.div`
  padding:12px;border-radius:8px;background:#F0FDFA;border:1px solid #99F6E4;
  color:#0F766E;font-size:0.8125rem;line-height:1.6;
`;
const ErrorBar = styled.div`
  margin-top:10px;padding:8px 10px;border-radius:8px;
  background:#FEF2F2;border:1px solid #FECACA;color:#B91C1C;font-size:0.75rem;
`;
