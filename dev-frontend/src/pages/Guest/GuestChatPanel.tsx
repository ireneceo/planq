// 게스트 채팅 — **대화 화면과 프로젝트 페이지의 대화 탭이 같이 쓴다.**
//
//   docs/PROJECT_EXTERNAL_VIEW_DESIGN.md 1차. 두 화면이 각자 채팅을 구현하면 반드시 갈라진다
//   (이 저장소가 반복해서 데인 지점 — memory feedback_copied_component_drifts_extract_shell).
//   이름 묻기·엔터 규칙·카드 열기·전송 실패 문구가 한 곳에 있어야 한다.
//
// ★ 폴링은 `active` 일 때만 돈다. 프로젝트 페이지에서 다른 탭에 있는 동안 5초마다 요청하면
//   무인증 표면에 쓸데없는 부하가 걸린다. 탭으로 돌아오면 즉시 1회 다시 읽는다.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import { isEnterAction } from '../../utils/imeKey';

export type GuestCard = {
  card_type: string | null;
  title: string | null;
  note: string | null;
  // 왜 못 여는지까지 서버가 계산해 내려준다 — 화면이 조용히 기본값으로 떨어지지 않게.
  state: 'ok' | 'share_revoked' | 'share_expired' | 'not_available' | 'security_blocked' | 'unsupported';
};
export type GuestMsg = {
  id: number; content: string; created_at: string; is_mine: boolean; sender_name: string | null;
  kind?: string; card?: GuestCard | null;
};

type Props = {
  token: string;
  canWrite: boolean;
  /** 이 패널이 화면에 보이는가 — 폴링을 여기에만 건다 */
  active?: boolean;
  /** 링크가 죽었을 때(404) 부모가 만료 화면으로 바꾸게 */
  onGone: () => void;
};

export default function GuestChatPanel({ token, canWrite, active = true, onGone }: Props) {
  const { t } = useTranslation('guest');
  const [msgs, setMsgs] = useState<GuestMsg[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // 이름 — **고객이 직접 정한다.** 저장은 이 브라우저에만. 서버는 매 전송에 실려 온 값을
  //   그 메시지에 박제할 뿐이라, 나중에 이름을 바꿔도 과거 글은 안 바뀐다.
  const nameKey = `guest:name:${token || ''}`;
  const [name, setName] = useState<string>(() => {
    try { return localStorage.getItem(nameKey) || ''; } catch { return ''; }
  });
  const [askName, setAskName] = useState(false);
  // ★ "건너뛰었다" 를 기억한다. 안 그러면 건너뛰기 → 보내기 에서 이름줄이 다시 열리고
  //   글은 안 나간다(실측 2026-09-02: DB 에 메시지 0건).
  const [nameSkipped, setNameSkipped] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const m = await fetch(`/api/guest/${token}/messages`);
      if (m.status === 404) { onGone(); return; }
      if (!m.ok) return;                        // 폴링 실패는 조용히 — 다음 주기에 회복된다
      const mj = await m.json();
      if (mj.success) setMsgs(mj.data || []);
    } catch { /* 위와 같다 */ }
  }, [token, onGone]);

  // 보일 때 1회 + 5초 폴링(보이는 동안만). 소켓은 2단계다(게스트 소켓은 파생 비밀·룸 설계가 따로 필요).
  useEffect(() => {
    if (!active) return;
    void load();
    const id = setInterval(() => { void load(); }, 5000);
    return () => clearInterval(id);
  }, [active, load]);
  useEffect(() => { if (active) bottomRef.current?.scrollIntoView({ block: 'end' }); }, [msgs.length, active]);

  const cardKindLabel = (k: string | null) => {
    switch (k) {
      case 'invoice': return t('card.invoice', { defaultValue: '청구서' });
      case 'post': return t('card.post', { defaultValue: '문서' });
      case 'task': return t('card.task', { defaultValue: '업무' });
      case 'file': return t('card.file', { defaultValue: '파일' });
      case 'kb_document': return t('card.kb', { defaultValue: '자료' });
      case 'calendar_event': return t('card.event', { defaultValue: '일정' });
      // 모르는 종류를 "자료" 로 뭉뚱그리지 않는다 — 그러면 새 카드가 생겨도 아무도 모른다.
      default: return t('card.other', { defaultValue: '첨부' });
    }
  };
  const cardWhy = (state: GuestCard['state'], kind: string | null) => {
    // 서명은 "담당자에게 문의" 가 **틀린 안내**다 — 서명자는 이미 메일로 OTP 링크를 받았다.
    if (kind === 'signature_request') return t('card.whySignature', { defaultValue: '이메일로 받은 서명 링크에서 진행해 주세요.' });
    switch (state) {
      case 'share_revoked': return t('card.whyRevoked', { defaultValue: '공유가 해제되었습니다. 담당자에게 다시 요청해 주세요.' });
      case 'share_expired': return t('card.whyExpired', { defaultValue: '공유 기간이 지났습니다. 담당자에게 다시 요청해 주세요.' });
      case 'security_blocked': return t('card.whyBlocked', { defaultValue: '외부 공유가 제한된 자료입니다.' });
      case 'unsupported': return t('card.whyUnsupported', { defaultValue: '이 링크에서는 열 수 없습니다. 담당자에게 문의해 주세요.' });
      default: return t('card.whyGone', { defaultValue: '지금은 열 수 없습니다. 담당자에게 문의해 주세요.' });
    }
  };

  /**
   * 실제 전송. 이름을 **인자로 받는다** — 이름줄에서 방금 정한 값은 state 에 아직 반영되지
   *   않았으므로(같은 이벤트 안), `name` 을 읽으면 옛 값이 간다.
   */
  const sendWith = async (effectiveName: string) => {
    const body = draft.trim();
    if (!body || sending || !token) return;
    setSending(true); setErr(null);
    try {
      const r = await fetch(`/api/guest/${token}/messages`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: body, guest_name: effectiveName || undefined }),
      });
      if (r.status === 404) { onGone(); return; }
      if (!r.ok) {
        const j = await r.json().catch(() => ({} as { message?: string }));
        if ((j as { message?: string })?.message === 'name_reserved') {
          // 우리 쪽 사람으로 보이는 이름은 서버가 거절한다. 그 사실을 숨기지 않는다.
          setErr(t('nameReserved', { defaultValue: '그 이름은 쓸 수 없습니다. 다른 이름으로 바꿔 주세요.' }) as string);
          setAskName(true); setNameDraft(effectiveName);
          return;
        }
        setErr(t('sendFailed', { defaultValue: '보내지 못했습니다. 잠시 후 다시 시도해 주세요.' }) as string);
        return;
      }
      setDraft('');
      await load();
    } catch {
      setErr(t('sendFailed', { defaultValue: '보내지 못했습니다. 잠시 후 다시 시도해 주세요.' }) as string);
    } finally { setSending(false); }
  };

  const saveName = (v: string, thenSend = false) => {
    const n = v.trim().slice(0, 30);
    setName(n);
    if (!n) setNameSkipped(true);   // 빈 값으로 확인 = 건너뛴 것
    try { n ? localStorage.setItem(nameKey, n) : localStorage.removeItem(nameKey); } catch { /* 시크릿 창 */ }
    setAskName(false);
    if (thenSend && draft.trim()) void sendWith(n);
  };

  const send = async () => {
    if (!draft.trim() || sending || !token) return;
    // ★ 이름은 **첫 글을 쓰기 직전**에 한 번만 묻는다. 입장 때 막으면 "가볍게 들어와서 확인" 이
    //   안 된다 — 읽기만 하러 온 사람에게 관문을 세우지 않는다.
    if (!name && !askName && !nameSkipped) { setAskName(true); setNameDraft(''); return; }
    await sendWith(name);
  };

  return (
    <>
      <Body>
        {msgs.length === 0 && <Empty>{t('empty', { defaultValue: '아직 주고받은 메시지가 없습니다.' })}</Empty>}
        {msgs.map((m) => (
          <Row key={m.id} $mine={m.is_mine}>
            <Bubble $mine={m.is_mine}>
              {!m.is_mine && <Who>{m.sender_name || ''}</Who>}
              {m.kind === 'card' && m.card ? (
                m.card.state === 'ok' ? (
                  // 주소는 화면이 모른다 — 서버가 302 로 보낸다(토큰을 응답에 싣지 않는다).
                  <CardLink
                    href={`/api/guest/${token}/cards/${m.id}/open`}
                    target="_blank" rel="noopener noreferrer"
                    data-testid="guest-card-open">
                    <CardKind>{cardKindLabel(m.card.card_type)}</CardKind>
                    <CardTitle>{m.card.title || m.content}</CardTitle>
                    {m.card.note && <CardNote>{m.card.note}</CardNote>}
                    <CardOpen>{t('card.open', { defaultValue: '열어보기' })}</CardOpen>
                  </CardLink>
                ) : (
                  <CardDead>
                    <CardKind>{cardKindLabel(m.card.card_type)}</CardKind>
                    <CardTitle>{m.card.title || m.content}</CardTitle>
                    {/* 왜 못 여는지 한 줄. "안 눌린다" 로 남겨 두지 않는다. */}
                    <CardWhy>{cardWhy(m.card.state, m.card.card_type)}</CardWhy>
                  </CardDead>
                )
              ) : (
                <Text>{m.content}</Text>
              )}
            </Bubble>
          </Row>
        ))}
        <div ref={bottomRef} />
      </Body>
      {canWrite ? (
        <Foot>
          {err && <ErrLine>{err}</ErrLine>}
          {askName ? (
            <NameRow>
              <NameLabel>{t('nameAsk', { defaultValue: '이름을 알려주시면 담당자가 알아보기 쉬워요' })}</NameLabel>
              <NameInput
                data-testid="guest-name-input"
                value={nameDraft} onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) saveName(nameDraft, true); }}
                placeholder={t('namePh', { defaultValue: '이름 (선택)' }) as string}
                maxLength={30} autoFocus />
              <NameBtn data-testid="guest-name-ok" type="button" onClick={() => saveName(nameDraft, true)}>
                {t('nameOk', { defaultValue: '확인' })}
              </NameBtn>
              <NameSkip data-testid="guest-name-skip" type="button" onClick={() => { setNameSkipped(true); setAskName(false); void sendWith(''); }}>
                {t('nameSkip', { defaultValue: '건너뛰기' })}
              </NameSkip>
            </NameRow>
          ) : name ? (
            <NameShown>
              {t('nameShown', { defaultValue: '{{name}} 으로 표시됩니다', name })}
              <NameEdit type="button" onClick={() => { setAskName(true); setNameDraft(name); }}>
                {t('nameChange', { defaultValue: '바꾸기' })}
              </NameEdit>
              {/* 규칙을 설명하지 않고 결과만 말한다 */}
              <NameNote>{t('nameFromNow', { defaultValue: '바꾼 이름은 이후 메시지부터' })}</NameNote>
            </NameShown>
          ) : null}
          <InputRow>
            <TArea data-testid="guest-input" value={draft} onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                // 멤버 채팅창(ChatPanel)과 **같은 규칙** — 같은 제품에서 엔터가 다르게 동작하면 안 된다.
                //   데스크탑은 Enter 전송 / Shift+Enter 줄바꿈, 터치·좁은 화면은 Enter 가 줄바꿈(#110).
                //   한글 조합 중 Enter 는 **확정**이지 전송이 아니다(utils/imeKey).
                if (isEnterAction(e) && !e.shiftKey) {
                  const enterSends = !window.matchMedia('(hover: none), (max-width: 640px)').matches;
                  if (enterSends) { e.preventDefault(); void send(); }
                }
              }}
              placeholder={t('placeholder', { defaultValue: '메시지를 입력하세요' }) as string}
              rows={1} disabled={sending} />
            <SendBtn data-testid="guest-send" type="button" onClick={send} disabled={sending || !draft.trim()}>
              {t('send', { defaultValue: '보내기' })}
            </SendBtn>
          </InputRow>
          {/* 규칙을 설명하지 않고 **지금 쓰는 법**만 한 줄. 터치 기기에서는 해당이 없어 숨긴다. */}
          <SendHint aria-hidden>{t('sendHint', { defaultValue: 'Enter 로 보내기 · Shift+Enter 줄바꿈' })}</SendHint>
        </Foot>
      ) : (
        <Foot><ReadOnly>{t('readOnly', { defaultValue: '읽기 전용 링크입니다.' })}</ReadOnly></Foot>
      )}
    </>
  );
}

const Body = styled.div`flex:1;min-height:0;overflow-y:auto;padding:16px 20px;display:flex;flex-direction:column;gap:8px;`;
const Row = styled.div<{ $mine: boolean }>`display:flex;justify-content:${p => (p.$mine ? 'flex-end' : 'flex-start')};`;
const Bubble = styled.div<{ $mine: boolean }>`
  max-width:min(560px,80%);padding:9px 12px;border-radius:14px;
  background:${p => (p.$mine ? '#14b8a6' : '#fff')};color:${p => (p.$mine ? '#fff' : '#0f172a')};
  border:1px solid ${p => (p.$mine ? '#14b8a6' : '#e2e8f0')};
`;
const Who = styled.div`font-size:0.75rem;font-weight:700;color:#64748b;margin-bottom:2px;`;
const Text = styled.div`font-size:0.875rem;line-height:1.55;white-space:pre-wrap;word-break:break-word;`;
const Empty = styled.div`margin:auto;color:#94a3b8;font-size:0.875rem;`;
const Foot = styled.div`background:#fff;border-top:1px solid #e2e8f0;padding:10px 20px;padding-bottom:calc(10px + env(safe-area-inset-bottom));`;
const InputRow = styled.div`display:flex;gap:8px;align-items:flex-end;`;
const ErrLine = styled.div`font-size:0.75rem;color:#dc2626;margin-bottom:6px;`;
const SendHint = styled.div`
  margin-top:6px;font-size:0.6875rem;color:#94a3b8;
  @media (hover: none), (max-width: 640px) { display:none; }
`;
const NameRow = styled.div`
  display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:8px;
  padding:8px 10px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;
`;
const NameLabel = styled.span`font-size:0.8125rem;color:#475569;flex:1 1 100%;`;
const NameInput = styled.input`
  flex:1 1 160px;min-width:0;height:36px;padding:0 10px;font-size:0.875rem;
  border:1px solid #E2E8F0;border-radius:8px;background:#fff;color:#0F172A;
  &:focus{outline:none;border-color:#14B8A6;}
`;
const NameBtn = styled.button`
  height:36px;padding:0 14px;border:none;border-radius:8px;background:#14B8A6;color:#fff;
  font-size:0.8125rem;font-weight:700;cursor:pointer;
`;
const NameSkip = styled.button`
  height:36px;padding:0 10px;border:none;background:none;color:#64748B;
  font-size:0.8125rem;cursor:pointer;text-decoration:underline;
`;
const NameShown = styled.div`
  display:flex;gap:6px;align-items:center;flex-wrap:wrap;
  margin-bottom:6px;font-size:0.75rem;color:#64748B;
`;
const NameEdit = styled.button`
  border:none;background:none;padding:0;color:#0D9488;font-size:0.75rem;font-weight:700;
  cursor:pointer;text-decoration:underline;
`;
const NameNote = styled.span`color:#94A3B8;`;
const TArea = styled.textarea`
  flex:1;min-height:44px;max-height:120px;resize:none;padding:10px 12px;
  border:1px solid #e2e8f0;border-radius:10px;font-size:0.875rem;font-family:inherit;
  &:focus{outline:none;border-color:#14b8a6;}
`;
const SendBtn = styled.button`
  height:44px;padding:0 16px;border:none;border-radius:10px;background:#14b8a6;color:#fff;
  font-size:0.875rem;font-weight:700;cursor:pointer;
  &:disabled{opacity:.5;cursor:not-allowed;}
`;
const cardBox = `
  display:block;text-decoration:none;border:1px solid #E2E8F0;border-radius:12px;
  padding:10px 12px;background:#FFFFFF;
`;
const CardLink = styled.a`
  ${cardBox}
  &:hover{border-color:#14B8A6;}
`;
const CardDead = styled.div`${cardBox} background:#F8FAFC;`;
const CardKind = styled.div`font-size:0.6875rem;font-weight:700;color:#0D9488;margin-bottom:3px;`;
const CardTitle = styled.div`font-size:0.875rem;font-weight:600;color:#0F172A;line-height:1.4;`;
const CardNote = styled.div`font-size:0.75rem;color:#475569;margin-top:4px;line-height:1.5;`;
const CardOpen = styled.div`font-size:0.75rem;font-weight:700;color:#0D9488;margin-top:8px;`;
const CardWhy = styled.div`font-size:0.75rem;color:#94A3B8;margin-top:6px;line-height:1.5;`;
const ReadOnly = styled.div`color:#64748b;font-size:0.8125rem;text-align:center;`;
