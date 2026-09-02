// 무로그인 게스트 대화 화면 (운영 #259) — `/g/:token`
//
// Irene: "카톡 채팅으로 일하는 고객이 하나도 불편하지 않게 우리 채팅에서 요청을 하게 할 방법."
//   그래서 이 화면의 목표는 **가입 유도가 아니라 바로 쓰게 하는 것**이다.
//   로그인 배너·계정 만들기 권유를 두지 않는다 — 그 자체가 Irene 이 말한 불편이다.
//
// ★ 이 화면은 워크스페이스 chrome 을 하나도 쓰지 않는다(utils/publicSurface 의 '/g/').
//   고객이 보는 것은 "우리 회사와의 대화" 지 "남의 회사 업무도구" 가 아니다.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';

type GuestMsg = { id: number; content: string; created_at: string; is_mine: boolean; sender_name: string | null };
type GuestCtx = {
  guest_name: string; can_write: boolean; client_name: string | null;
  conversation: { id: number; title: string | null };
  project: { name: string; description: string | null; status: string | null; start_date: string | null; end_date: string | null } | null;
};

export default function GuestConversationPage() {
  const { token } = useParams<{ token: string }>();
  const { t } = useTranslation('guest');
  const [ctx, setCtx] = useState<GuestCtx | null>(null);
  const [msgs, setMsgs] = useState<GuestMsg[]>([]);
  const [gone, setGone] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async (first = false) => {
    if (!token) return;
    try {
      if (first) {
        const r = await fetch(`/api/guest/${token}`);
        if (r.status === 404) { setGone(true); return; }
        const j = await r.json();
        if (j.success) setCtx(j.data);
      }
      const m = await fetch(`/api/guest/${token}/messages`);
      if (m.status === 404) { setGone(true); return; }
      const mj = await m.json();
      if (mj.success) setMsgs(mj.data || []);
    } catch { /* 폴링 실패는 조용히 — 다음 주기에 회복된다 */ }
  }, [token]);

  useEffect(() => { load(true); }, [load]);
  // 5초 폴링 — 소켓은 2단계다(게스트 소켓은 파생 비밀 + 룸 제한 설계가 따로 필요).
  useEffect(() => {
    if (gone) return;
    const id = setInterval(() => load(false), 5000);
    return () => clearInterval(id);
  }, [load, gone]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ block: 'end' }); }, [msgs.length]);

  const send = async () => {
    const body = draft.trim();
    if (!body || sending || !token) return;
    setSending(true); setErr(null);
    try {
      const r = await fetch(`/api/guest/${token}/messages`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: body }),
      });
      if (r.status === 404) { setGone(true); return; }
      if (!r.ok) { setErr(t('sendFailed', { defaultValue: '보내지 못했습니다. 잠시 후 다시 시도해 주세요.' }) as string); return; }
      setDraft('');
      await load(false);
    } catch {
      setErr(t('sendFailed', { defaultValue: '보내지 못했습니다. 잠시 후 다시 시도해 주세요.' }) as string);
    } finally { setSending(false); }
  };

  if (gone) {
    return (
      <Center>
        <Card>
          <H1>{t('expired.title', { defaultValue: '링크가 만료되었습니다' })}</H1>
          <P>{t('expired.body', { defaultValue: '오래 사용하지 않아 링크가 닫혔습니다. 담당자가 다음 안내 메일을 보내면 새 링크가 함께 도착합니다.' })}</P>
        </Card>
      </Center>
    );
  }
  if (!ctx) return <Center><P>{t('loading', { defaultValue: '불러오는 중…' })}</P></Center>;

  return (
    <Wrap>
      <Head>
        <Title>{ctx.conversation.title || t('defaultTitle', { defaultValue: '대화' })}</Title>
        {ctx.project && <Sub>{ctx.project.name}</Sub>}
      </Head>
      <Body>
        {msgs.length === 0 && <Empty>{t('empty', { defaultValue: '아직 주고받은 메시지가 없습니다.' })}</Empty>}
        {msgs.map((m) => (
          <Row key={m.id} $mine={m.is_mine}>
            <Bubble $mine={m.is_mine}>
              {!m.is_mine && <Who>{m.sender_name || ''}</Who>}
              <Text>{m.content}</Text>
            </Bubble>
          </Row>
        ))}
        <div ref={bottomRef} />
      </Body>
      {ctx.can_write ? (
        <Foot>
          {err && <ErrLine>{err}</ErrLine>}
          <InputRow>
            <TArea value={draft} onChange={(e) => setDraft(e.target.value)}
              placeholder={t('placeholder', { defaultValue: '메시지를 입력하세요' }) as string}
              rows={2} disabled={sending} />
            <SendBtn type="button" onClick={send} disabled={sending || !draft.trim()}>
              {t('send', { defaultValue: '보내기' })}
            </SendBtn>
          </InputRow>
        </Foot>
      ) : (
        <Foot><ReadOnly>{t('readOnly', { defaultValue: '읽기 전용 링크입니다.' })}</ReadOnly></Foot>
      )}
    </Wrap>
  );
}

const Wrap = styled.div`display:flex;flex-direction:column;height:100dvh;background:#f8fafc;`;
const Head = styled.div`min-height:60px;padding:14px 20px;background:#fff;border-bottom:1px solid #e2e8f0;`;
const Title = styled.div`font-size:1.125rem;font-weight:700;letter-spacing:-0.2px;color:#0f172a;`;
const Sub = styled.div`font-size:0.8125rem;color:#64748b;margin-top:2px;`;
const Body = styled.div`flex:1;min-height:0;overflow-y:auto;padding:16px 20px;display:flex;flex-direction:column;gap:8px;`;
const Row = styled.div<{ $mine: boolean }>`display:flex;justify-content:${p => (p.$mine ? 'flex-end' : 'flex-start')};`;
const Bubble = styled.div<{ $mine: boolean }>`
  max-width:min(560px,80%);padding:8px 12px;border-radius:12px;
  background:${p => (p.$mine ? '#0D9488' : '#fff')};color:${p => (p.$mine ? '#fff' : '#0f172a')};
  border:1px solid ${p => (p.$mine ? '#0D9488' : '#e2e8f0')};
`;
const Who = styled.div`font-size:0.75rem;font-weight:700;color:#64748b;margin-bottom:2px;`;
const Text = styled.div`font-size:0.875rem;line-height:1.55;white-space:pre-wrap;word-break:break-word;`;
const Empty = styled.div`margin:auto;color:#94a3b8;font-size:0.875rem;`;
const Foot = styled.div`background:#fff;border-top:1px solid #e2e8f0;padding:10px 20px;padding-bottom:calc(10px + env(safe-area-inset-bottom));`;
const InputRow = styled.div`display:flex;gap:8px;align-items:flex-end;`;
const TArea = styled.textarea`
  flex:1;min-height:44px;max-height:140px;resize:none;padding:9px 12px;
  border:1px solid #cbd5e1;border-radius:8px;font-size:0.875rem;font-family:inherit;line-height:1.5;
  &:focus{outline:none;border-color:#0D9488;box-shadow:0 0 0 3px rgba(13,148,136,0.12);}
`;
const SendBtn = styled.button`
  min-height:44px;padding:0 16px;border-radius:8px;border:none;background:#0D9488;color:#fff;
  font-size:0.875rem;font-weight:700;cursor:pointer;
  &:disabled{background:#cbd5e1;cursor:not-allowed;}
`;
const ReadOnly = styled.div`color:#64748b;font-size:0.8125rem;text-align:center;`;
const ErrLine = styled.div`color:#F43F5E;font-size:0.8125rem;margin-bottom:6px;`;
const Center = styled.div`display:flex;align-items:center;justify-content:center;height:100dvh;background:#f8fafc;padding:20px;`;
const Card = styled.div`background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:28px;max-width:420px;text-align:center;`;
const H1 = styled.div`font-size:1.125rem;font-weight:700;color:#0f172a;margin-bottom:8px;`;
const P = styled.div`font-size:0.875rem;color:#64748b;line-height:1.6;`;
