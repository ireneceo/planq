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
import { isEnterAction } from '../../utils/imeKey';
import styled from 'styled-components';
import GuestNotifySection from './GuestNotifySection';

type GuestCard = {
  card_type: string | null;
  title: string | null;
  note: string | null;
  // 왜 못 여는지까지 서버가 계산해 내려준다 — 화면이 조용히 기본값으로 떨어지지 않게.
  state: 'ok' | 'share_revoked' | 'share_expired' | 'not_available' | 'security_blocked' | 'unsupported';
};
type GuestMsg = {
  id: number; content: string; created_at: string; is_mine: boolean; sender_name: string | null;
  kind?: string; card?: GuestCard | null;
};
type GuestCtx = {
  guest_name: string; can_write: boolean; client_name: string | null; account_requested?: boolean;
  conversation: { id: number; title: string | null };
  project: {
    name: string; description: string | null; status: string | null;
    start_date: string | null; end_date: string | null;
    // 2026-09-02 — 프로젝트 공유 링크. 서버가 화이트리스트로 내려주는 것만 (숫자·라벨).
    stages?: { kind: string; label: string; status: string }[];
    task_summary?: { total: number; completed: number };
    docs?: { title: string | null; category: string | null; updated_at: string | null; url: string }[];
  } | null;
};

export default function GuestConversationPage() {
  const { token } = useParams<{ token: string }>();
  const { t } = useTranslation('guest');
  const [ctx, setCtx] = useState<GuestCtx | null>(null);
  const [msgs, setMsgs] = useState<GuestMsg[]>([]);
  const [gone, setGone] = useState(false);
  // 첫 로드가 실패했는가 — 끝나지 않는 스피너 대신 이유와 다시 시도를 보여준다.
  const [loadErr, setLoadErr] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // 이름 — **고객이 직접 정한다.** 멤버는 발급할 때 아무것도 입력하지 않는다.
  //   저장은 이 브라우저에만. 서버는 매 전송에 실려 온 값을 그 메시지에 박제할 뿐
  //   세션 상태를 갖지 않는다 — 그래야 나중에 이름을 바꿔도 과거 글이 안 바뀐다.
  const nameKey = `guest:name:${token || ''}`;
  const [name, setName] = useState<string>(() => {
    try { return localStorage.getItem(nameKey) || ''; } catch { return ''; }
  });
  const [askName, setAskName] = useState(false);   // 이름 줄을 펼칠지
  // ★ "건너뛰었다" 를 기억한다. 안 그러면 건너뛰기 → 보내기 에서 이름줄이 **다시 열리고
  //   글은 안 나간다** (Fable 실브라우저 실측 2026-09-02: DB 에 메시지 0건).
  //   Irene 이 원한 "가볍게 소통" 에서 건너뛴 사람이 정확히 막혔다.
  const [nameSkipped, setNameSkipped] = useState(false);
  // 계정 안내 배너 — 닫으면 이 브라우저에서 다시 안 뜬다. 읽기만 하러 온 사람을 막지 않는다.
  const bannerKey = `guest:banner:${token || ''}`;
  const [bannerHidden, setBannerHidden] = useState<boolean>(() => {
    try { return localStorage.getItem(bannerKey) === '1'; } catch { return false; }
  });
  const [reqEmail, setReqEmail] = useState('');
  const [reqSending, setReqSending] = useState(false);
  const [requested, setRequested] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async (first = false) => {
    if (!token) return;
    // ★ 첫 로드는 조용히 실패하면 안 된다 (2026-09-02, 운영 사고).
    //   전에는 catch 를 통째로 삼켜서, 네트워크가 한 번만 흔들려도 `ctx` 가 null 로 남고
    //   화면이 **영원히 "불러오는 중…"** 이었다. 고객에게는 "고장" 과 구별되지 않는다
    //   (실제로 그렇게 보고됐다: "로딩이래. 이상해. 왜 안되지?").
    //   폴링(첫 로드 아님)은 종전대로 조용히 넘어간다 — 다음 주기에 회복된다.
    try {
      if (first) {
        const r = await fetch(`/api/guest/${token}`);
        if (r.status === 404) { setGone(true); return; }
        if (!r.ok) throw new Error(`ctx ${r.status}`);
        const j = await r.json();
        if (!j.success || !j.data) throw new Error('ctx payload');
        setCtx(j.data);
        setLoadErr(false);
      }
      const m = await fetch(`/api/guest/${token}/messages`);
      if (m.status === 404) { setGone(true); return; }
      if (!m.ok) throw new Error(`messages ${m.status}`);
      const mj = await m.json();
      if (mj.success) setMsgs(mj.data || []);
    } catch {
      if (first) setLoadErr(true);
      /* 폴링 실패는 조용히 — 다음 주기에 회복된다 */
    }
  }, [token]);

  useEffect(() => { load(true); }, [load]);
  // 5초 폴링 — 소켓은 2단계다(게스트 소켓은 파생 비밀 + 룸 제한 설계가 따로 필요).
  useEffect(() => {
    if (gone) return;
    // ctx 를 아직 못 받았으면 폴링이 **첫 로드를 다시 시도**한다 — 사용자가 아무것도
    //   안 해도 네트워크가 돌아오면 저절로 열린다.
    const id = setInterval(() => load(!ctx), 5000);
    return () => clearInterval(id);
  }, [load, gone, ctx]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ block: 'end' }); }, [msgs.length]);

  // 이름을 정하면 **그대로 보낸다.** 쓰던 글을 두고 버튼을 한 번 더 누르게 하지 않는다.
  // ★ 가입 화면으로 보내지 않는다. 초대 토큰 없이 가입하면 **자기 워크스페이스가 새로 생겨**
  //   고객이 빈 화면에 떨어지고 이 대화는 못 본다(Fable 판정). 담당자에게 요청만 보낸다.
  const requestAccount = async () => {
    if (reqSending || !token) return;
    setReqSending(true);
    try {
      const r = await fetch(`/api/guest/${token}/account-request`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: reqEmail.trim() || undefined }),
      });
      if (r.status === 404) { setGone(true); return; }
      if (r.ok) setRequested(true);
    } catch { /* 조용히 실패하지 않게 아래에서 버튼이 그대로 남는다 */ }
    finally { setReqSending(false); }
  };

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

  const saveName = (v: string, thenSend = false) => {
    const n = v.trim().slice(0, 30);
    setName(n);
    if (!n) setNameSkipped(true);   // 빈 값으로 확인 = 건너뛴 것
    try { n ? localStorage.setItem(nameKey, n) : localStorage.removeItem(nameKey); } catch { /* 시크릿 창 */ }
    setAskName(false);
    if (thenSend && draft.trim()) void sendWith(n);
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
      if (r.status === 404) { setGone(true); return; }
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
      await load(false);
    } catch {
      setErr(t('sendFailed', { defaultValue: '보내지 못했습니다. 잠시 후 다시 시도해 주세요.' }) as string);
    } finally { setSending(false); }
  };

  const send = async () => {
    if (!draft.trim() || sending || !token) return;
    // ★ 이름은 **첫 글을 쓰기 직전**에 한 번만 묻는다. 입장 때 막으면
    //   "가볍게 들어와서 확인" 이 안 된다 — 읽기만 하러 온 사람에게 관문을 세우지 않는다.
    //   이미 정했거나 건너뛴 사람에게는 다시 묻지 않는다.
    if (!name && !askName && !nameSkipped) { setAskName(true); setNameDraft(''); return; }
    await sendWith(name);
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
  if (!ctx) {
    // 스피너가 끝나지 않는 것은 사용자에게 고장이다 — 실패했으면 그렇게 말하고 손잡이를 준다.
    if (loadErr) {
      return (
        <Center>
          <Card>
            <P>{t('loadFailed', { defaultValue: '대화를 불러오지 못했습니다. 연결을 확인하고 다시 시도해 주세요.' })}</P>
            <RetryBtn type="button" data-testid="guest-retry"
              onClick={() => { setLoadErr(false); void load(true); }}>
              {t('retry', { defaultValue: '다시 시도' })}
            </RetryBtn>
          </Card>
        </Center>
      );
    }
    return <Center><P>{t('loading', { defaultValue: '불러오는 중…' })}</P></Center>;
  }

  return (
    <Wrap>
      <Head>
        {/* ★ 프로젝트 링크로 들어왔으면 **프로젝트가 주인공**이다 (2026-09-02).
            Irene: "프로젝트 전체를 볼 수 있는 링크 물어본건데 어디 있다는 거야?"
            처음엔 채팅 화면 위에 띠만 얹었더니, 열면 그냥 채팅으로 보였다 —
            사용자에게는 "왜 여기 있는 버튼인지" 알 수 없는 화면이었다. */}
        <Title>{ctx.project ? ctx.project.name : (ctx.conversation.title || t('defaultTitle', { defaultValue: '대화' }))}</Title>
        {ctx.project
          ? <Sub>{[ctx.project.status, period(ctx.project.start_date, ctx.project.end_date)].filter(Boolean).join(' · ') || t('ov.projectSub', { defaultValue: '진행 상황과 문의' })}</Sub>
          : null}
      </Head>
      {/* ── 진행 상황 (2026-09-02) ────────────────────────────────────────────
          Irene: "프로젝트마다도 링크 만들어서 공유할 수 있어? **볼 수 있게?**"
          이름만 보이면 채팅 링크와 다를 게 없다. 서버가 내려준 것만 그린다 —
          업무는 **숫자만**, 문서는 **이미 외부로 공유된 것만**(서버 화이트리스트). */}
      {ctx.project && (
        (
          <Overview data-testid="guest-project-overview">
            {ctx.project.description && <OvDesc>{ctx.project.description}</OvDesc>}
            <OvSection>
              <OvLabel>{t('ov.stages', { defaultValue: '진행 단계' })}</OvLabel>
              {ctx.project.stages?.length ? (
                <StageRow>
                  {ctx.project.stages.map((st, i) => (
                    <StageChip key={i} $state={st.status}>{st.label}</StageChip>
                  ))}
                </StageRow>
              ) : <OvEmpty>{t('ov.stagesEmpty', { defaultValue: '아직 등록된 단계가 없어요.' })}</OvEmpty>}
            </OvSection>
            <OvSection>
              <OvLabel>{t('ov.tasks', { defaultValue: '업무 진행' })}</OvLabel>
              {(ctx.project.task_summary?.total ?? 0) > 0 ? (
                <>
                  <OvValue>
                    {t('ov.taskCount', {
                      defaultValue: '{{done}} / {{total}} 완료',
                      done: ctx.project.task_summary?.completed ?? 0,
                      total: ctx.project.task_summary?.total ?? 0,
                    })}
                  </OvValue>
                  <Bar aria-hidden><BarFill style={{ width: `${Math.round(((ctx.project.task_summary?.completed ?? 0) / Math.max(1, ctx.project.task_summary?.total ?? 1)) * 100)}%` }} /></Bar>
                </>
              ) : <OvEmpty>{t('ov.tasksEmpty', { defaultValue: '아직 등록된 업무가 없어요.' })}</OvEmpty>}
            </OvSection>
            <OvSection>
              <OvLabel>{t('ov.docs', { defaultValue: '공유된 문서' })}</OvLabel>
              {ctx.project.docs?.length ? (
                <DocList>
                  {ctx.project.docs.map((d, i) => (
                    <DocLink key={i} href={d.url} target="_blank" rel="noopener noreferrer">
                      {d.title || t('ov.untitled', { defaultValue: '제목 없음' })}
                    </DocLink>
                  ))}
                </DocList>
              ) : <OvEmpty>{t('ov.docsEmpty', { defaultValue: '공유된 문서가 아직 없어요.' })}</OvEmpty>}
            </OvSection>
            {/* 대화는 프로젝트 화면의 **한 부분**이다 — 아래가 문의 자리라고 말해 준다. */}
            <ChatHint>{t('ov.chatHint', { defaultValue: '아래에서 담당자에게 바로 문의할 수 있어요.' })}</ChatHint>
          </Overview>
        )
      )}
      {/* 답글 알림 신청 (#259 A안) — 등록은 선택이고, 닫으면 이 브라우저에서 다시 안 뜬다. */}
      <GuestNotifySection token={token || ''} onGone={() => setGone(true)} />
      {/* 헤더 아래 1줄 — 고정하지 않는다(본문과 함께 밀려 올라감). */}
      {!bannerHidden && (
        <Banner data-testid="guest-account-banner">
          {requested || ctx.account_requested ? (
            <BannerText>{t('acct.sent', { defaultValue: '요청을 보냈어요. 담당자가 초대 메일을 보내면 계정을 만들 수 있어요.' })}</BannerText>
          ) : (
            <>
              <BannerText>
                {/* ★ 동작을 바꾸면 문구가 거짓말이 된다 — 프로젝트 링크는 이제 진행 상황도 보여준다.
                    "이 대화만 볼 수 있어요" 를 그대로 두면 화면과 어긋난다(2026-09-02). */}
                {ctx.project
                  ? t('acct.leadProject', { defaultValue: '이 링크로는 진행 상황과 이 대화를 볼 수 있어요. 업무 상세·자료까지 보려면 계정이 필요해요.' })
                  : t('acct.lead', { defaultValue: '이 링크로는 이 대화만 볼 수 있어요. 프로젝트·자료까지 보려면 계정이 필요해요.' })}
              </BannerText>
              <BannerRow>
                <BannerInput value={reqEmail} onChange={(e) => setReqEmail(e.target.value)}
                  data-testid="guest-account-email"
                  placeholder={t('acct.emailPh', { defaultValue: '이메일 (선택)' }) as string}
                  maxLength={200} inputMode="email" />
                <BannerBtn type="button" onClick={requestAccount} disabled={reqSending}
                  data-testid="guest-account-request">
                  {t('acct.request', { defaultValue: '계정 요청하기' })}
                </BannerBtn>
              </BannerRow>
            </>
          )}
          <BannerClose type="button" aria-label={t('acct.close', { defaultValue: '닫기' }) as string}
            onClick={() => { setBannerHidden(true); try { localStorage.setItem(bannerKey, '1'); } catch { /* 시크릿 창 */ } }}>
            ×
          </BannerClose>
        </Banner>
      )}
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
      {ctx.can_write ? (
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
                // 멤버 채팅창(ChatPanel)과 **같은 규칙**을 쓴다 — 같은 제품에서 엔터가 다르게
                //   동작하면 안 된다. 데스크탑은 Enter 전송 / Shift+Enter 줄바꿈,
                //   터치·좁은 화면은 Enter 가 줄바꿈(오발송 방지, #110).
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
    </Wrap>
  );
}

const Wrap = styled.div`display:flex;flex-direction:column;height:100dvh;background:#f8fafc;`;
const Head = styled.div`min-height:60px;padding:14px 20px;background:#fff;border-bottom:1px solid #e2e8f0;`;
const Title = styled.div`font-size:1.125rem;font-weight:700;letter-spacing:-0.2px;color:#0f172a;`;
const Sub = styled.div`font-size:0.8125rem;color:#64748b;margin-top:2px;`;
// 기간 한 줄 — 둘 다 없으면 빈 문자열(호출측이 filter 로 떨군다).
function period(a?: string | null, b?: string | null): string {
  const f = (d?: string | null) => (d ? String(d).slice(0, 10) : '');
  if (!a && !b) return '';
  return `${f(a)} ~ ${f(b)}`.trim();
}

const OvDesc = styled.p`margin:0 0 2px;font-size:0.8125rem;color:#475569;line-height:1.55;white-space:pre-wrap;`;
const OvEmpty = styled.div`font-size:0.8125rem;color:#94a3b8;`;
const Bar = styled.div`height:6px;border-radius:999px;background:#F1F5F9;overflow:hidden;`;
const BarFill = styled.div`height:100%;background:#14B8A6;border-radius:999px;`;
const ChatHint = styled.div`font-size:0.75rem;color:#94a3b8;padding-top:2px;border-top:1px dashed #E2E8F0;margin-top:2px;`;

// ── 진행 상황 패널 (프로젝트 공유 링크) ────────────────────────────────────
//   폰 우선. 고정 px 폭을 쓰지 않고, 글자는 rem(앱 전체가 rem 이다).
const Overview = styled.section`
  padding:12px 20px; background:#fff; border-bottom:1px solid #e2e8f0;
  display:flex; flex-direction:column; gap:10px;
`;
const OvSection = styled.div`display:flex; flex-direction:column; gap:6px;`;
const OvLabel = styled.div`font-size:0.6875rem; font-weight:600; color:#94a3b8; letter-spacing:-0.1px;`;
const OvValue = styled.div`font-size:0.8125rem; color:#334155;`;
const StageRow = styled.div`display:flex; flex-wrap:wrap; gap:6px;`;
// 상태 색은 **칩 배경**에만. 버튼 3톤 규칙과 충돌하지 않는다(이건 상태 표시지 액션이 아니다).
const StageChip = styled.span<{ $state: string }>`
  font-size:0.75rem; padding:3px 9px; border-radius:999px; white-space:nowrap;
  background:${(p) => (p.$state === 'completed' ? '#ECFDF5' : p.$state === 'active' ? '#EFF6FF' : '#F1F5F9')};
  color:${(p) => (p.$state === 'completed' ? '#047857' : p.$state === 'active' ? '#1D4ED8' : '#64748b')};
  border:1px solid ${(p) => (p.$state === 'completed' ? '#A7F3D0' : p.$state === 'active' ? '#BFDBFE' : '#E2E8F0')};
`;
const DocList = styled.div`display:flex; flex-direction:column; gap:4px;`;
const DocLink = styled.a`
  font-size:0.8125rem; color:#0F766E; text-decoration:none; word-break:break-all;
  min-height:36px; display:flex; align-items:center;
  &:hover { text-decoration:underline; }
`;
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
/* ★ 좌측 정렬 (2026-09-02). 입력칸이 `flex:1` 이라 넓은 화면에서 가로를 다 먹고
   확인·건너뛰기 버튼이 **화면 오른쪽 끝으로 밀려** 눈에 안 들어왔다
   (Irene: "가로 좌우 풀레이아웃하면 우측 버튼 안보여서 혼란"). 입력칸 폭을 묶고 왼쪽에 모은다. */
const NameRow = styled.div`
  display:flex;gap:6px;align-items:center;flex-wrap:wrap;
  justify-content:flex-start;margin-bottom:8px;
`;
const NameLabel = styled.span`font-size:0.8125rem;color:#475569;flex:1 1 100%;`;
const NameInput = styled.input`
  flex:0 1 220px;min-width:0;padding:8px 10px;border:1px solid #CBD5E1;border-radius:8px;
  font-size:0.875rem;min-height:44px;
`;
const NameBtn = styled.button`
  min-height:44px;padding:0 14px;border:0;border-radius:8px;background:#0F172A;color:#fff;
  font-size:0.8125rem;font-weight:600;cursor:pointer;
`;
const NameSkip = styled.button`
  min-height:44px;padding:0 10px;border:0;background:none;color:#64748B;
  font-size:0.8125rem;cursor:pointer;text-decoration:underline;
`;
const NameShown = styled.div`
  display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:8px;
  font-size:0.75rem;color:#64748B;
`;
const NameEdit = styled.button`
  border:0;background:none;color:#0F172A;font-size:0.75rem;cursor:pointer;text-decoration:underline;padding:0;
`;
const NameNote = styled.span`color:#94A3B8;`;
/* ★ 버튼과 **같은 높이**로 시작한다. rows={2} + padding 이라 입력칸만 60px 가까이 돼
   보내기 버튼(44)과 높이가 어긋나 보였다 (Irene: "입란 높이랑 버튼 높이는 왜 달라?").
   한 줄로 시작해 내용이 늘면 max-height 까지 자란다. */
const TArea = styled.textarea`
  flex:1;height:44px;min-height:44px;max-height:140px;resize:none;padding:10px 12px;
  border:1px solid #cbd5e1;border-radius:8px;font-size:0.875rem;font-family:inherit;line-height:1.5;
  &:focus{outline:none;border-color:#0D9488;box-shadow:0 0 0 3px rgba(13,148,136,0.12);}
`;
const SendBtn = styled.button`
  min-height:44px;padding:0 16px;border-radius:8px;border:none;background:#0D9488;color:#fff;
  font-size:0.875rem;font-weight:700;cursor:pointer;
  &:disabled{background:#cbd5e1;cursor:not-allowed;}
`;
const cardBox = `
  display:block;border:1px solid #e2e8f0;border-radius:10px;padding:10px 12px;background:#fff;
  text-align:left;min-width:180px;
`;
const CardLink = styled.a`
  ${cardBox}
  text-decoration:none;cursor:pointer;
  &:hover{border-color:#0D9488;box-shadow:0 1px 4px rgba(13,148,136,0.12);}
  &:focus-visible{outline:2px solid #0D9488;outline-offset:2px;}
`;
const CardDead = styled.div`${cardBox} background:#F8FAFC;`;
const CardKind = styled.div`font-size:0.6875rem;font-weight:700;color:#0D9488;margin-bottom:3px;`;
const CardTitle = styled.div`font-size:0.875rem;font-weight:600;color:#0F172A;line-height:1.4;`;
const CardNote = styled.div`font-size:0.75rem;color:#475569;margin-top:4px;line-height:1.5;`;
const CardOpen = styled.div`font-size:0.75rem;font-weight:700;color:#0D9488;margin-top:8px;`;
const CardWhy = styled.div`font-size:0.75rem;color:#94A3B8;margin-top:6px;line-height:1.5;`;
const Banner = styled.div`
  position:relative;background:#F0FDFA;border-bottom:1px solid #99F6E4;
  padding:10px 40px 10px 16px;
`;
const BannerText = styled.div`font-size:0.8125rem;color:#0F766E;line-height:1.5;`;
const BannerRow = styled.div`display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:8px;justify-content:flex-start;`;
const BannerInput = styled.input`
  flex:0 1 220px;min-width:0;min-height:44px;padding:8px 10px;
  border:1px solid #99F6E4;border-radius:8px;font-size:0.875rem;background:#fff;
`;
const BannerBtn = styled.button`
  min-height:44px;padding:0 14px;border:0;border-radius:8px;background:#0D9488;color:#fff;
  font-size:0.8125rem;font-weight:700;cursor:pointer;
  &:disabled{background:#cbd5e1;cursor:not-allowed;}
`;
const BannerClose = styled.button`
  /* 아이콘 버튼 최소 36×36 (UI 가이드) — 28 은 토큰 밖이고 손가락으로 못 누른다. */
  position:absolute;top:4px;right:4px;width:36px;height:36px;
  border:0;background:none;color:#0F766E;font-size:1.125rem;line-height:1;cursor:pointer;
`;
const RetryBtn = styled.button`
  margin-top:14px;min-height:44px;padding:0 18px;border:0;border-radius:8px;
  background:#0D9488;color:#fff;font-size:0.875rem;font-weight:700;cursor:pointer;
`;
const ReadOnly = styled.div`color:#64748b;font-size:0.8125rem;text-align:center;`;
const ErrLine = styled.div`color:#F43F5E;font-size:0.8125rem;margin-bottom:6px;`;
const SendHint = styled.div`
  margin-top:6px;font-size:0.6875rem;color:#94A3B8;
  /* 터치 기기는 Enter 가 줄바꿈이라 이 안내가 거짓이 된다 — 숨긴다. */
  @media (hover: none), (max-width: 640px) { display:none; }
`;
const Center = styled.div`display:flex;align-items:center;justify-content:center;height:100dvh;background:#f8fafc;padding:20px;`;
const Card = styled.div`background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:28px;max-width:420px;text-align:center;`;
const H1 = styled.div`font-size:1.125rem;font-weight:700;color:#0f172a;margin-bottom:8px;`;
const P = styled.div`font-size:0.875rem;color:#64748b;line-height:1.6;`;
