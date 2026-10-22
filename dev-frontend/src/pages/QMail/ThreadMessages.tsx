// #262 M2 — 스레드 상세의 메시지 목록. MailPage.tsx 에서 절출 (god-file 래칫).
//
// 스레드를 열면 **최신 메시지**가 펼쳐진 채 맨 위에서 시작하고, 과거 메시지는 헤더 한 줄로 접힌다
// (Irene: "내가 보낸 메일이 최신인데 가장 아래에 붙어버려서").
//
// ★ 2R-1 — `messages` 는 **최신이 위(내림차순)** 로 정렬돼 들어온다. 서버 API 는 오름차순 그대로다
//   (답장 인용 원본·references 체인이 오름차순 전제). 뒤집는 것은 화면 표시뿐이고, 그래서
//   "맨 위로" 가 항상 정답이라 스크롤 앵커 계산 자체가 없다 (Irene: "최신이 위여야 하는데").
//   접기 상태는 부모가 쥔다 — 스레드 전환 초기화가 부모의 detail 로드와 같은 phase 여야 하므로.
import React from 'react';
import type { TFunction } from 'i18next';
// 타입 정본은 MailPage — type-only import 라 런타임 순환이 생기지 않는다
import type { Message, toAddrList as ToAddrList } from './MailPage';
import MailBodyFullscreen from './MailBodyFullscreen';

// 전달 기능 스위치 — 2026-08-24 차단(원문이 리치 에디터를 통과해 표·이미지가 깨졌다) →
//   2026-08-27 Fable 설계 게이트 통과 후 해제. 원문은 서버가 무가공으로 이어붙이고(에디터 미통과),
//   본문에 박힌 data:URI 이미지는 발송 직전 진짜 CID 첨부로 변환된다(services/emailSend.js).
//   서버에도 킬스위치가 따로 있다(QMAIL_FORWARD_ENABLED) — 되돌릴 땐 서버 쪽이 정본이다.
const FORWARD_ENABLED = true;
import MessageAttachments from './MessageAttachments';
import MailBriefPanel, { type MailBrief } from './MailBriefPanel';
import VisuallyHidden from '../../components/Common/VisuallyHidden';
import { apiFetch } from '../../contexts/AuthContext';
import { renderTextWithLinks as linkify } from '../../utils/linkify';
import { copyMailBody, useMailBodySelectionScope } from './useMailBodyCopy';
import MailMessageBody from './MailMessageBody';
import AddressMenu from '../../components/Mail/AddressMenu';   // #261 주소 클릭 메뉴
import { buildMailSrcDoc, type QuoteFoldLabels } from './mailSrcDoc';
import { openMailWindow } from './openMailWindow';
import {
  MessageCard, MessageHeader, MessageFrom, MessageTo, MsgHeaderRight, MsgCollapsedPreview, MsgChevron,
  MessageTime, MsgIconBtn, DeliveryChip, MessageBodyText,
  TransBar, TransSelect, TransBtn, TransLoading, TransErr, TransBody, TransHead,
} from './MailPage.styles';
import { isEnterAction } from '../../utils/imeKey';

interface MsgTransState { text?: string; lang?: string; showing: boolean; loading: boolean; error?: boolean }


interface Props {
  messages: Message[];
  threadId: number;
  /** 사칭 격리본 — 평문 본문도 링크를 걸지 않는다(HTML 은 서버가 이미 href 를 뗐다). docs/MAIL_IMPERSONATION_DESIGN.md §3 */
  linksDisabled?: boolean;
  accountEmail: string;
  /** #260 — 전체 화면 읽기 헤더에 쓸 스레드 제목 */
  subject?: string;
  /** #220 — 로그인한 본인 user id. 팀메일에서 "나" vs 팀원 이름을 가르는 기준. */
  myUserId: number | null;
  businessId: number;
  expandedMsgIds: ReadonlySet<number>;
  toggleMsg: (id: number) => void;
  frameH: Record<number, number>;
  msgCidData: Record<number, Record<string, string>>;
  msgTrans: Record<number, MsgTransState>;
  setMsgTrans: React.Dispatch<React.SetStateAction<Record<number, MsgTransState>>>;
  translateMsg: (msgId: number, threadId: number, targetLang?: string) => void;
  transLangByMsg: Record<number, string>;
  setTransLangByMsg: React.Dispatch<React.SetStateAction<Record<number, string>>>;
  guessLangFromText: (t?: string | null, html?: string | null) => string;
  pickTranslateTarget: (source: string, ui: string) => string;
  uiLang: string;
  cancelTranslate: (msgId: number) => void;
  startForward: (m: Message) => void;
  /** 인용 접기 토글 문구 (iframe 안이라 t() 를 쓸 수 없어 문자열로 넘긴다) */
  foldLabels: QuoteFoldLabels;
  toAddrList: typeof ToAddrList;
  formatTimeAgo: (v: string) => string;
  /** #261 — 주소 클릭 메뉴 동작. 상위(MailPage)가 실제 행동을 소유한다. */
  addressActions?: {
    onViewMail: (email: string) => void;
    onCompose: (email: string) => void;
    onSaveClient: (email: string, name?: string | null) => void;
    onBlock: (email: string) => void;
  };
  t: TFunction;
}

export default function ThreadMessages(p: Props) {
  const {
    addressActions,
    messages, threadId, linksDisabled, accountEmail, subject, myUserId, businessId, expandedMsgIds, toggleMsg,
    frameH, msgCidData, msgTrans, setMsgTrans,
    translateMsg, cancelTranslate, startForward, foldLabels, toAddrList, formatTimeAgo, t,
    transLangByMsg, setTransLangByMsg, guessLangFromText, pickTranslateTarget, uiLang,
  } = p;
  // 보낸 메일 머리줄 «누가 <주소>» — 세 자리(머리줄·전체보기 버튼·전체 화면)가 같은 함수를 쓴다.
  //   2026-10-21 신고 «나 <hssong@…> — 내가 보낸 게 아닌데 나라고 나와»: 발신자 기록이 없으면(IMAP 으로 가져온
  //   보낸 메일) 무조건 «나» 였다. 이제 확인된 것만 «나» — 서버가 찾은 멤버(sender_*) → 낙관 카드(sent_by_user_id)
  //   → 헤더 이름 → 주소만. 이름은 워크스페이스 프로필 우선(서버 services/mailSender).
  const outboundSenderLabel = (m: Props['messages'][number]): string => {
    const addr = m.from_email || accountEmail;
    const uid = m.sender_user_id ?? m.sent_by_user_id ?? null;
    const name = uid && myUserId && uid === myUserId
      ? (t('me', { defaultValue: '나' }) as string)
      : (m.sender_name || m.sent_by_name || m.from_name || '');
    return name ? `${name} <${addr}>` : `<${addr}>`;
  };
  // 운영 #260 — 좁은 패널에서 읽기 답답한 메일을 화면 전체로 펼쳐 읽는다.
  const [fullMsgId, setFullMsgId] = React.useState<number | null>(null);
  const fullMsg = messages.find((x) => x.id === fullMsgId) || null;
  // 번역문이 **새로 펼쳐지는 순간**(없음/닫힘 → 보임) 그 머리로 데려간다. 이미 떠 있던 것은 건드리지 않는다
  //   — 다른 메시지 번역·재렌더마다 화면이 튀면 읽던 자리를 잃는다.
  // ★ 2026-10-22 (Irene: *"그럼 이메일 읽는데 방해되잖아. 프로필 선택 언어라면 숨김처리해서 필요할 때만 쓰게 하고
  //   설정된 언어랑 다른 언어일 때만 보이게 하던지 해야지"*) — 번역 줄은 **내 언어가 아닌 메일**에만 펼쳐 둔다.
  //   내 언어 메일은 머리 아이콘 하나로 필요할 때만 연다(같은 줄의 «이 메일 확인» 도 거기서). 연 것은 메시지별로 기억한다.
  // ★ 2026-10-22 2차 (Irene: *"[이 메일 확인]은 번역이 아니잖아 … 그냥 기본적으로 다시 나오게 해줘. 우측 상단 아이콘도 그대로 두고
  //   … 대신 디폴트는 나오게야"*) — 줄(번역·메일 내용 요약)은 **모든 메일에 기본으로 보인다.** 머리 아이콘은 그대로 두고
  //   숨기기/다시 보이기만 한다 → 기억하는 것은 «닫은 것» 이다.
  const [toolsClosedIds, setToolsClosedIds] = React.useState<ReadonlySet<number>>(() => new Set());
  React.useEffect(() => { setToolsClosedIds(new Set()); }, [threadId]);
  const transBoxRefs = React.useRef<Map<number, HTMLElement>>(new Map());
  const transShownRef = React.useRef<Set<number>>(new Set());
  React.useEffect(() => {
    const now = new Set<number>();
    for (const [k, v] of Object.entries(msgTrans || {})) if (v?.showing && v?.text) now.add(Number(k));
    const fresh = [...now].filter((id) => !transShownRef.current.has(id));
    transShownRef.current = now;
    if (fresh.length !== 1) return;   // 스레드 전환 등으로 한꺼번에 생긴 것은 사람이 누른 게 아니다
    const el = transBoxRefs.current.get(fresh[0]);
    // ★ 2026-10-22 — scrollIntoView 는 **바깥 상자까지** 굴려 상세 머리 두 밴드가 117px 위로 밀려 사라졌다(3폭 실측).
    //   번역 줄이 머리 밑으로 오면서 번역문은 대개 이미 보이는 자리에 뜬다 → 메시지 목록 상자만, 보이는 칸 밖일 때만 굴린다.
    if (el) requestAnimationFrame(() => {
      let sc: HTMLElement | null = el.parentElement;
      while (sc && !/(auto|scroll)/.test(getComputedStyle(sc).overflowY)) sc = sc.parentElement;
      if (!sc) return;
      const box = sc.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      if (r.top >= box.top && r.top <= box.bottom - 48) return;   // 머리가 이미 보인다
      sc.scrollTo({ top: sc.scrollTop + (r.top - box.top) - 12, behavior: 'smooth' });
    });
  }, [msgTrans]);
  React.useEffect(() => {
    // 스레드를 바꾸면 «이미 보이던 것» 기준을 새로 잡는다(돌아왔을 때 남아 있는 번역으로 튀지 않게).
    const s2 = new Set<number>();
    for (const [k, v] of Object.entries(msgTrans || {})) if (v?.showing && v?.text) s2.add(Number(k));
    transShownRef.current = s2;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);
  // ⌘A 를 커서가 있는 메일 본문 안으로 한정한다 (본문 밖에서는 손대지 않는다).
  useMailBodySelectionScope();
  // 복사 결과는 **버튼 글자로만** 알린다 — 성공 토스트는 금지(CLAUDE.md).
  const [copiedId, setCopiedId] = React.useState<number | null>(null);
  const [copyFailedId, setCopyFailedId] = React.useState<number | null>(null);

  // ── 메일 브리프 (요약 · 검증 · 지금 어느 순간인가) ──
  //   스레드 단위 값이지만 버튼은 각 메시지의 번역 줄에 둔다 — Irene 이 가리킨 자리가 거기다.
  //   결과는 스레드에 하나만 두고 **어느 메시지에서 열었는지**만 기억한다(같은 스레드를 두 번 요약하지 않는다).
  const [brief, setBrief] = React.useState<MailBrief | null>(null);
  const [briefOpenFor, setBriefOpenFor] = React.useState<number | null>(null);
  const [briefLoading, setBriefLoading] = React.useState(false);
  const [briefError, setBriefError] = React.useState(false);
  const loadBrief = React.useCallback(async (msgId: number) => {
    setBriefLoading(true); setBriefError(false);
    try {
      const r = await apiFetch(`/api/businesses/${businessId}/email-threads/${threadId}/brief`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
      });
      // apiFetch 는 throw 하지 않는다 — 상태를 직접 본다(안 보면 실패가 빈 화면으로 남는다).
      if (!r.ok) { setBriefError(true); return; }
      const j = await r.json();
      if (!j?.data) { setBriefError(true); return; }
      setBrief(j.data as MailBrief);
      setBriefOpenFor(msgId);
    } catch { setBriefError(true); }
    finally { setBriefLoading(false); }
  }, [businessId, threadId]);
  // 스레드가 바뀌면 앞 스레드의 브리프를 들고 있지 않는다 — 다른 메일의 판정이 남으면 그게 오정보다.
  // ★ 2026-09-09 (Irene: "번역하기는 나갔다 들어오면 저장되어 있을 필요 없지 않아? 오히려
  //   요약/확인을 하면 그대로 남아 있어야 하는데 다시 날라가.")
  //   두 기능이 정확히 **뒤바뀌어** 있었다 — 요약은 스레드를 뜨면 버리고(LLM 을 다시 태운다),
  //   번역은 계속 남았다. 요약은 이 세션 동안 스레드별로 들고 있는다.
  //   (ref 라서 렌더에 영향이 없고, 새로고침하면 사라진다 — 서버에 저장하는 것이 아니다.)
  const briefCache = React.useRef<Map<number, { brief: MailBrief; openFor: number | null }>>(new Map());
  React.useEffect(() => {
    setBriefError(false);
    const cached = briefCache.current.get(threadId);
    if (cached) { setBrief(cached.brief); setBriefOpenFor(cached.openFor); return; }
    setBrief(null); setBriefOpenFor(null);
  }, [threadId]);
  // 열고 닫은 상태까지 같이 기억한다 — 열어 뒀는데 닫힌 채 돌아오면 "날아간" 것으로 읽힌다.
  React.useEffect(() => {
    if (brief) briefCache.current.set(threadId, { brief, openFor: briefOpenFor });
  }, [threadId, brief, briefOpenFor]);
  return (
    <>
      {/* ★ 2026-09-09 (Irene: "내용을 위로 접는 아이콘은 왜 있는지 모르겠네.")
          접기는 **여러 통이 쌓인 스레드**에서 과거 메일을 접어 두기 위한 것이다(Gmail 관례).
          한 통뿐인 스레드에서는 접을 상대가 없어 "본문을 숨기는 버튼" 으로만 읽힌다 —
          그 화면에서는 손잡이를 만들지 않는다(헤더 클릭도 끈다). */}
      {messages.map((m) => {
        const open = expandedMsgIds.has(m.id);
        const toolsShown = !toolsClosedIds.has(m.id)
          || !!msgTrans[m.id]?.showing || !!msgTrans[m.id]?.loading || briefOpenFor === m.id;
        const collapsible = messages.length > 1;
        return (
        <MessageCard
          key={m.id}
          $outbound={m.direction === 'outbound'}
          /* 카드 안 순서(번역 줄 → 본문 → 첨부)를 카드 단위로 재는 손잡이 — canary-mail-attach-order */
          data-testid="mail-message-card"
          data-message-id={m.id}
        >
          {/* 헤더 전체가 클릭 대상이지만 role/tabIndex 는 **발신자 영역에만** 둔다 —
              헤더 안에 전달 <button> 이 있어서, 헤더를 role="button" 으로 만들면 인터랙티브 중첩이 된다
              (스크린리더가 버튼 안의 버튼을 온전히 읽지 못한다). */}
          <MessageHeader
            data-testid="mail-message-header"
            /* 하니스가 표시 순서·펼침 대상을 기계적으로 검증하는 근거 (CLAUDE.md 운영 안정성 17) */
            data-message-id={m.id}
            data-direction={m.direction}
            data-expanded={open ? '1' : '0'}
            $clickable={collapsible}
            onClick={collapsible ? () => toggleMsg(m.id) : undefined}
          >
            <MessageFrom
              role={collapsible ? 'button' : undefined}
              tabIndex={collapsible ? 0 : undefined}
              aria-expanded={collapsible ? open : undefined}
              onKeyDown={collapsible ? (e) => { if (isEnterAction(e) || e.key === ' ') { e.preventDefault(); toggleMsg(m.id); } } : undefined}
            >
              {/* 운영 #220 — 팀 주소는 여러 사람이 함께 쓴다. 누가 보냈는지는 outboundSenderLabel 한 곳. */}
              {m.direction === 'outbound'
                ? outboundSenderLabel(m)
                : (
                  // #261 — 발신 주소는 누르면 무엇이든 할 수 있어야 한다(모아보기·복사·새 메일·고객 저장·차단).
                  //   주소 자체가 진입점이 아니면 사람을 기준으로 메일을 되찾을 방법이 없다.
                  <>
                    {m.from_name ? `${m.from_name} ` : ''}
                    {m.from_email && addressActions ? (
                      <>
                        {'<'}
                        <AddressMenu
                          email={m.from_email}
                          name={m.from_name}
                          businessId={businessId}
                          onViewMail={addressActions.onViewMail}
                          onCompose={addressActions.onCompose}
                          onSaveClient={addressActions.onSaveClient}
                          onBlock={addressActions.onBlock}
                        />
                        {'>'}
                      </>
                    ) : `<${m.from_email || ''}>`}
                  </>
                )}
              {/* 어느 주소로 온 메일인지 — 여러 도메인을 한 메일함으로 받으면 이게 없으면 답장 주소를 알 수 없다 */}
              {toAddrList(m.to_emails).length > 0 && (
                <MessageTo>
                  {/* 보낸 메일은 «받은 주소» 가 아니라 받는 사람이다 — 같은 글자를 쓰면 우리가 받은 주소로 읽힌다 */}
                  {(m.direction === 'outbound'
                    ? t('detail.toAddrOut', { defaultValue: '받는 사람' })
                    : t('detail.toAddr', { defaultValue: '받은 주소' })) as string}: {toAddrList(m.to_emails).join(', ')}
                </MessageTo>
              )}
            </MessageFrom>
            <MsgHeaderRight>
              {/* #272 — "접힌상태랑 아닌 상태 구별 안되고 글자가 잘리는 것처럼 보여버려".
                  아이콘 하나로 상태를 말한다(Gmail 관례). aria-expanded 는 위 MessageFrom 이 이미 갖고 있어
                  여기서는 장식으로 두고 스크린리더에는 숨긴다 — 같은 상태를 두 번 읽지 않게. */}
              {collapsible && (
                <MsgChevron $open={open} aria-hidden="true">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9" /></svg>
                </MsgChevron>
              )}
              {/* 발송 상태 — 나간 메일만. 'sent'(정상)는 표시하지 않는다(잡음). 문제 있을 때만 드러낸다. */}
              {m.direction === 'outbound' && m.delivery_status && m.delivery_status !== 'sent' && (
                <DeliveryChip
                  $tone={m.delivery_status === 'sending' ? 'info' : (m.delivery_status === 'suppressed' ? 'warn' : 'err')}
                  title={m.delivery_error || undefined}
                >
                  {t(`delivery.${m.delivery_status}`) as string}
                </DeliveryChip>
              )}
              <MessageTime>{formatTimeAgo(m.sent_at)}</MessageTime>
              {/* 헤더 클릭 = 접기/펼치기라, 안쪽 버튼은 전파를 끊어야 한다 */}
              {/* 운영 #260 — 본문만 화면 전체로. 목록·상세가 좁아 답답하다는 지적. */}
              {/* ★ 2026-08-24 (Irene) — "전체보기는 웹 미리보기처럼 새 창으로 열려야지."
                  앱 안 모달은 아무리 키워도 앱 창을 못 벗어난다. 진짜 창으로 연다.
                  팝업이 차단되면 기존 모달로 폴백해 기능이 죽지 않게 한다. */}
              {/* 내용 복사 — Irene: "복사해서 어디 보내고 싶어도 … 모든 곳이 다 걸리네."
                  HTML 메일이면 서식과 평문을 같이 올린다(문서에 붙이면 서식, 메모장에 붙이면 글자). */}
              {/* 내용 복사 — 겹친 사각형은 "복사" 의 정착된 아이콘이다.
                  ★ 다만 이 버튼만은 **결과를 글자로 말하고 있었다**("복사됨"/"복사 실패").
                    아이콘으로 바꾸면서 그 피드백을 없애면 정확히 Irene 이 반복해 신고한
                    "눌러도 아무 일이 없는 컨트롤" 이 된다 → 글리프를 ✓ / ! 로 바꾸고
                    aria-live 로 읽어 준다. 자리는 안 먹고 결과는 남는다. */}
              {/* 번역·메일 내용 요약 줄을 숨기고/다시 보이는 아이콘 — 기본은 보임(모든 메일). */}
              {open && (
                <MsgIconBtn type="button" data-testid="mail-tools-toggle"
                  $tone={toolsShown ? 'ok' : undefined}
                  aria-expanded={toolsShown}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (toolsShown) {
                      // 닫으면 떠 있던 번역·확인도 같이 닫는다 — 줄만 숨기고 결과가 남으면 다시 줄이 열린다.
                      setMsgTrans(prev => (prev[m.id] ? { ...prev, [m.id]: { ...prev[m.id]!, showing: false } } : prev));
                      if (briefOpenFor === m.id) setBriefOpenFor(null);
                      setToolsClosedIds((prev) => new Set(prev).add(m.id));
                    } else {
                      setToolsClosedIds((prev) => { const n = new Set(prev); n.delete(m.id); return n; });
                    }
                  }}
                  title={t('translate.tools', { defaultValue: '번역 · 메일 내용 요약' }) as string}
                  aria-label={t('translate.tools', { defaultValue: '번역 · 메일 내용 요약' }) as string}>
                  {/* 글자 A + 다른 문자 = 번역의 정착된 아이콘 */}
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="m5 8 6 6" /><path d="m4 14 6-6 2-3" /><path d="M2 5h12" /><path d="M7 2h1" />
                    <path d="m22 22-5-10-5 10" /><path d="M14 18h6" />
                  </svg>
                </MsgIconBtn>
              )}
              <MsgIconBtn type="button"
                data-testid="mail-copy-body"
                $tone={copiedId === m.id ? 'ok' : copyFailedId === m.id ? 'err' : undefined}
                onClick={async (e) => {
                  e.stopPropagation();
                  const ok = await copyMailBody({ html: m.body_html, text: m.body_text });
                  if (ok) { setCopyFailedId(null); setCopiedId(m.id); window.setTimeout(() => setCopiedId((c) => (c === m.id ? null : c)), 2000); }
                  else { setCopiedId(null); setCopyFailedId(m.id); window.setTimeout(() => setCopyFailedId((c) => (c === m.id ? null : c)), 3000); }
                }}
                title={copiedId === m.id
                  ? (t('detail.copied', { defaultValue: '복사됨' }) as string)
                  : copyFailedId === m.id
                    ? (t('detail.copyFailed', { defaultValue: '복사 실패' }) as string)
                    : (t('detail.copyBody', { defaultValue: '내용 복사' }) as string)}
                aria-label={t('detail.copyBody', { defaultValue: '내용 복사' }) as string}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  {copiedId === m.id
                    ? <polyline points="20 6 9 17 4 12" />
                    : copyFailedId === m.id
                      ? <><line x1="12" y1="8" x2="12" y2="13" /><line x1="12" y1="17" x2="12" y2="17" /><circle cx="12" cy="12" r="9" /></>
                      : <><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>}
                </svg>
              </MsgIconBtn>
              {/* 결과는 눈으로도 보이지만 스크린리더에도 들려야 한다 */}
              <VisuallyHidden role="status" aria-live="polite">
                {copiedId === m.id ? (t('detail.copied', { defaultValue: '복사됨' }) as string)
                  : copyFailedId === m.id ? (t('detail.copyFailed', { defaultValue: '복사 실패' }) as string) : ''}
              </VisuallyHidden>
              <MsgIconBtn type="button" data-testid="mail-fullview" onClick={(e) => {
                e.stopPropagation();
                const sub = m.direction === 'outbound'
                  ? outboundSenderLabel(m)
                  : `${m.from_name || ''} <${m.from_email || ''}>`;
                // ★ 2026-10-14 (Irene: "모바일 메일 상세에서 뒤로 가기 화살표가 없어") — 폰·태블릿·앱에서
                //   새 창은 앱 머리줄도 뒤로 버튼도 없는 빈 탭(앱은 사파리)으로 열려 돌아올 길이 없었다.
                //   손가락이 주 포인터이거나 좁은 화면이면 앱 안 전체 화면(‹ 뒤로 있음)으로 연다.
                if (window.matchMedia('(max-width: 1024px), (pointer: coarse)').matches) { setFullMsgId(m.id); return; }
                const opened = openMailWindow({
                  title: subject || '',
                  subtitle: sub,
                  srcDoc: m.body_html ? buildMailSrcDoc(m.id, m.body_html, msgCidData[m.id], foldLabels) : undefined,
                  text: m.body_text,
                  linksDisabled,
                });
                if (!opened) setFullMsgId(m.id);
              }}
                title={t('detail.fullView', { defaultValue: '새 창으로 크게 보기' }) as string}
                aria-label={t('detail.fullView', { defaultValue: '새 창으로 크게 보기' }) as string}>
                {/* 상자 밖 화살표 = "새 창으로 연다" 의 웹 공통 관례.
                    ★ 이 아이콘이 옛 글자보다 **더 정확하다** — 버튼 이름은 "전체 화면으로 보기"
                      였는데 실제 동작은 openMailWindow, 즉 **진짜 새 창**이다(팝업이 막히면 모달 폴백).
                      동작을 그리는 아이콘으로 바꾸면서 문구도 동작에 맞췄다. */}
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M15 3h6v6" /><path d="M10 14 21 3" />
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                </svg>
              </MsgIconBtn>
              {/* ★ 2026-08-24 (Irene 지시) — 전달 기능 **일시 차단**.
                  원문 HTML 을 리치 에디터에 통과시키는 구조라 표·인라인 스타일이 재해석되어
                  레이아웃이 깨지고(라운드 박스) cid: 이미지가 유실된다. 서버가 원문을 그대로
                  이어붙이는 경로(include_original)를 넣었으나 **실사용으로 검증되지 않았다**
                  (신고 시점까지 실제 발송 0건 — 요청이 서버에 도달하지 않았다).
                  "엉망인 기능을 고객이 보면 안 된다" — 오픈 전까지 진입을 막고 Fable 이 설계·검증한다.
                  되살릴 때: 이 블록의 FORWARD_ENABLED 를 true 로. 근거는 FABLE_VERIFY_QUEUE §5. */}
              {FORWARD_ENABLED && (
                <MsgIconBtn type="button" data-testid="mail-forward" onClick={(e) => { e.stopPropagation(); startForward(m); }}
                  title={t('forward.button', { defaultValue: '전달' }) as string}
                  aria-label={t('forward.button', { defaultValue: '전달' }) as string}>
                  {/* 오른쪽으로 꺾이는 화살표 = 전달. Gmail·Outlook·Apple Mail 이 모두 같은 모양을 쓴다 */}
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="15 17 20 12 15 7" /><path d="M4 18v-2a4 4 0 0 1 4-4h12" />
                  </svg>
                </MsgIconBtn>
              )}
            </MsgHeaderRight>
          </MessageHeader>
          {/* 접힌 메시지 — 한 줄 미리보기만. 클릭하면 펼쳐진다. */}
          {!open && (
            <MsgCollapsedPreview onClick={() => toggleMsg(m.id)}>
              {String(m.body_text || '').replace(/\s+/g, ' ').trim().slice(0, 120)
                || (t('detail.noContent', { defaultValue: '(내용 없음)' }) as string)}
            </MsgCollapsedPreview>
          )}
          {open && <>
          {/* ★ 2026-10-22 (Irene: *"이메일에서 번역하기가 딱 방금 받은 내용 아래에 없어서 혼란스럽네 … 여러 번 대화한 경우
              번역버튼 찾아가기 어렵고"*) — Fable 판정 A. 번역 줄(언어·번역·이 메일 확인)은 **메시지 머리 바로 아래**다.
              본문 전체(이전 대화·서명)+첨부 뒤에 있어 최신 받은 메일 머리에서 1,662px(폰 1,932px) 떨어져 있었고,
              다음 메일 머리 바로 위에 붙어 그 메일 것으로 읽혔다. 누르는 자리 = 결과가 뜨는 자리 = 읽기 시작하는 자리.
              카드 순서: 머리 → 번역 줄 → 번역문 → 이 메일 확인 → 본문 → 첨부(카드 끝). 우리가 만든 것은 본문 위,
              받은 것(본문·첨부)은 그 아래. 번역문 머리의 ✕ 는 바로 위 [번역 닫기] 와 같은 동작이라 뗐다. */}
          {toolsShown && (
          <TransBar data-testid="mail-trans-bar">
            <TransSelect value={transLangByMsg[m.id] ?? pickTranslateTarget(guessLangFromText(m.body_text, m.body_html), uiLang)}
              onChange={(e) => setTransLangByMsg((p) => ({ ...p, [m.id]: e.target.value }))}
              aria-label={t('translate.langLabel', { defaultValue: '번역 언어' }) as string}>
              <option value="ko">{t('translate.lang.ko') as string}</option>
              <option value="en">{t('translate.lang.en') as string}</option>
              <option value="ja">{t('translate.lang.ja') as string}</option>
              <option value="zh">{t('translate.lang.zh') as string}</option>
              <option value="es">{t('translate.lang.es') as string}</option>
            </TransSelect>
            {/* #202 — 로딩 중에는 "취소", 번역이 떠 있으면 "번역 닫기", 그 외 "번역하기" 3분기.
                로딩 상태에서 버튼을 죽여두면(옛 동작) 긴 번역에 사용자가 갇힌다.
                ★ 가운데 분기는 "원본 보기" 였다 — 거짓말이었다(Irene 2026-09-03):
                  번역문은 원본을 **대체하지 않고 아래에 덧붙는다**(TransBody). 원본은 사라진 적이 없으니
                  누를 이유가 없는 버튼이었고, 실제 동작은 showing:false = **번역을 닫는 것**이다.
                  memory feedback_new_behavior_makes_copy_lie — 동작이 문구를 뒷받침하는지 같이 본다. */}
            {msgTrans[m.id]?.loading ? (
              <TransBtn type="button" onClick={() => cancelTranslate(m.id)}>
                {t('translate.cancel', { defaultValue: '번역 취소' }) as string}
              </TransBtn>
            ) : msgTrans[m.id]?.showing ? (
              <TransBtn type="button"
                onClick={() => setMsgTrans(prev => ({ ...prev, [m.id]: { ...(prev[m.id] || { loading: false }), showing: false } }))}>
                {t('translate.closeTranslation', { defaultValue: '번역 닫기' }) as string}
              </TransBtn>
            ) : (
              <TransBtn type="button"
                onClick={() => {
                  // 이 메시지의 실효 대상 언어 — 사용자가 고른 값이 없으면 원문에서 추정한 기본값.
                  const target = transLangByMsg[m.id] ?? pickTranslateTarget(guessLangFromText(m.body_text, m.body_html), uiLang);
                  const cached = msgTrans[m.id];
                  if (cached?.text && cached.lang === target) {
                    setMsgTrans(prev => ({ ...prev, [m.id]: { ...cached, showing: true } }));
                  } else { translateMsg(m.id, threadId, target); }
                }}>
                {t('translate.translate', { defaultValue: '번역하기' }) as string}
              </TransBtn>
            )}
            {msgTrans[m.id]?.loading && (
              <TransLoading>{t('translate.loading', { defaultValue: '번역 중…' }) as string}</TransLoading>
            )}
            {msgTrans[m.id]?.error && <TransErr>{t('translate.error', { defaultValue: '번역할 수 없습니다' }) as string}</TransErr>}
            {/* 요약·검증 — 번역과 같은 자리, 같은 방식(누르면 아래에 펼쳐진다).
                Irene 2026-09-08: "번역 옆에 메일 요약 및 검증이 나와서 누르면 번역 처럼 …" */}
            <TransBtn type="button"
              data-testid="mail-brief-open"
              disabled={briefLoading}
              onClick={() => {
                if (briefOpenFor === m.id) { setBriefOpenFor(null); return; }   // 재클릭 토글
                if (brief) { setBriefOpenFor(m.id); return; }                   // 이미 만든 것은 다시 안 만든다
                loadBrief(m.id);
              }}>
              {briefLoading
                ? (t('brief.loading', { defaultValue: '요약 중…' }) as string)
                : briefOpenFor === m.id
                  ? (t('brief.close', { defaultValue: '메일 내용 요약 닫기' }) as string)
                  : (t('brief.open', { defaultValue: '메일 내용 요약' }) as string)}
            </TransBtn>
            {briefError && <TransErr>{t('brief.failed', { defaultValue: '지금은 요약할 수 없어요' }) as string}</TransErr>}
          </TransBar>
          )}
          {/* ★ 2026-10-12 (Irene: *"번역하면 번역한게 올라와서 바로 보이게 해야 하는데 버튼 아래로 생겨서
              생긴걸 모르는 ui야"*) — 번역 버튼은 본문·첨부 **아래**에 있어서, 번역문을 그 밑에 붙이면
              긴 메일에서는 화면 밖에 생겨 «아무 일도 안 일어남» 으로 읽혔다. 번역문은 **본문 위**(읽기 시작하는
              자리)에 두고, 새로 펼쳐지는 순간 그 머리로 스크롤한다(transScrollRef). 원문은 그대로 아래에 남는다.
              (2026-10-22 부터 번역 줄도 위로 올라와 번역문은 그 줄 바로 밑이다.) */}
          {msgTrans[m.id]?.showing && msgTrans[m.id]?.text && (
            <TransBody data-testid="mail-trans-body"
              ref={(el) => { if (el) transBoxRefs.current.set(m.id, el); else transBoxRefs.current.delete(m.id); }}>
              <TransHead>
                <span>{t('translate.resultLabel', {
                  defaultValue: '번역 · {{lang}}',
                  lang: t(`translate.lang.${msgTrans[m.id]!.lang}`, { defaultValue: msgTrans[m.id]!.lang }) as string,
                }) as string}</span>
              </TransHead>
              {msgTrans[m.id]!.text}
            </TransBody>
          )}
          {briefOpenFor === m.id && brief && <MailBriefPanel brief={brief} />}
          {/* 메일 본문은 원본 문서 그대로 보여준다 — 우리 CSS 를 덮어씌우면 가운데 정렬이 풀리고
              배경이 사라지고 여백이 잘린다(메일 템플릿은 <style> + table + body bgcolor 로 짜여 있다).
              sanitizeMailHtml 이 문서를 통째로 정화(script·on* 제거)하고, sandbox iframe
              (allow-scripts 만, same-origin 없음)이 격리한다. 우리가 넣는 스크립트는 높이 보고 한 줄. */}
          {m.body_html ? (
            <MailMessageBody
              id={m.id}
              bodyHtml={m.body_html}
              bodyText={m.body_text}
              cidMap={msgCidData[m.id]}
              measuredH={frameH[m.id]}
              foldLabels={foldLabels}
            />
          ) : (
            <MessageBodyText data-mail-body="1" data-testid="mail-body-block">
              {/* ★ 2026-09-08 — 평문 메일(body_html 없음)은 여태 **URL 이 그냥 글자**였다.
                  운영 실측: message #3517 은 body_html 이 NULL 이고 본문에 초대 링크가 있는데
                  누를 수가 없었다(Irene 신고). HTML 메일에만 링크가 있어서 같은 메일함 안에서
                  규칙이 갈렸다 → 채팅·댓글과 **같은 함수**(utils/linkify)를 쓴다. */}
              {linksDisabled ? (m.body_text || '') : linkify(m.body_text || '')}
            </MessageBodyText>
          )}
          {/* ★ 2026-09-18 (Irene: *"이메일 상세에 첨부파일 위치가 애매해. 내용에 바로 아래 첨부파일
              있어야 할 것 같아. 이전 대화보기가 본문이라면 그 아래에 첨부파일 나와야지.
              번역이랑 메일내용 요약정리 하는 것보다 첨부파일이 아래에 나와야 하지 않아?"*)
              첨부는 **받은 메일에 딸려 온 것**이고 번역·요약은 우리가 덧붙이는 것이다.
              본문 바로 아래 = 카드의 **끝**이다. 「이전 대화보기」는 본문(MailMessageBody) 안에 있으므로 자연히 그 아래가 된다.
              (2026-10-22 Fable A — 번역 줄·번역문·이 메일 확인은 본문 **위**로 갔다. 우리가 만든 것은 본문 위,
              받은 것은 본문·첨부 순으로 그 아래. 첨부 아래에 우리 블록을 다시 두지 않는다 — 카나리 mail-attach-order.) */}
          <MessageAttachments businessId={businessId} attachments={m.attachments} />
          </>}
        </MessageCard>
        );
      })}
      {/* 운영 #260 — 본문 srcDoc 을 그대로 재사용한다(본문을 두 벌 만들지 않는다). */}
      <MailBodyFullscreen
        open={!!fullMsg}
        onClose={() => setFullMsgId(null)}
        title={subject || ''}
        subtitle={fullMsg
          ? (fullMsg.direction === 'outbound'
            ? outboundSenderLabel(fullMsg)
            : `${fullMsg.from_name || ''} <${fullMsg.from_email || ''}>`)
          : undefined}
        srcDoc={fullMsg && fullMsg.body_html ? buildMailSrcDoc(fullMsg.id, fullMsg.body_html, msgCidData[fullMsg.id], foldLabels, { fullscreen: true }) : undefined}
        text={fullMsg ? fullMsg.body_text : null}
        linksDisabled={linksDisabled}
      />
    </>
  );
}
