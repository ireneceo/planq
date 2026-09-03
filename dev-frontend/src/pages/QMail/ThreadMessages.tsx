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
import MailMessageBody from './MailMessageBody';
import AddressMenu from '../../components/Mail/AddressMenu';   // #261 주소 클릭 메뉴
import { buildMailSrcDoc, type QuoteFoldLabels } from './mailSrcDoc';
import { openMailWindow } from './openMailWindow';
import {
  MessageCard, MessageHeader, MessageFrom, MessageTo, MsgHeaderRight, MsgCollapsedPreview, MsgChevron,
  MessageTime, MsgForwardBtn, DeliveryChip, MessageBodyText,
  TransBar, TransSelect, TransBtn, TransLoading, TransErr, TransBody,
} from './MailPage.styles';
import { isEnterAction } from '../../utils/imeKey';

interface MsgTransState { text?: string; lang?: string; showing: boolean; loading: boolean; error?: boolean }


interface Props {
  messages: Message[];
  threadId: number;
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
  guessLangFromText: (t?: string | null) => string;
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
    messages, threadId, accountEmail, subject, myUserId, businessId, expandedMsgIds, toggleMsg,
    frameH, msgCidData, msgTrans, setMsgTrans,
    translateMsg, cancelTranslate, startForward, foldLabels, toAddrList, formatTimeAgo, t,
    transLangByMsg, setTransLangByMsg, guessLangFromText, pickTranslateTarget, uiLang,
  } = p;
  // 운영 #260 — 좁은 패널에서 읽기 답답한 메일을 화면 전체로 펼쳐 읽는다.
  const [fullMsgId, setFullMsgId] = React.useState<number | null>(null);
  const fullMsg = messages.find((x) => x.id === fullMsgId) || null;
  return (
    <>
      {messages.map((m) => {
        const open = expandedMsgIds.has(m.id);
        return (
        <MessageCard
          key={m.id}
          $outbound={m.direction === 'outbound'}
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
            $clickable
            onClick={() => toggleMsg(m.id)}
          >
            <MessageFrom
              role="button"
              tabIndex={0}
              aria-expanded={open}
              onKeyDown={(e) => { if (isEnterAction(e) || e.key === ' ') { e.preventDefault(); toggleMsg(m.id); } }}
            >
              {/* 운영 #220 — 팀 주소는 여러 사람이 함께 쓴다. 전부 "나" 로 보이면 누가 답했는지 알 수 없다.
                  내가 보낸 것만 "나", 다른 팀원이 보냈으면 그 사람 표시명을 적는다(워크스페이스 프로필 우선).
                  옛 데이터처럼 발신자 기록이 없으면 종전대로 "나". */}
              {m.direction === 'outbound'
                ? `${(m.sent_by_user_id && myUserId && m.sent_by_user_id !== myUserId && m.sent_by_name)
                    ? m.sent_by_name
                    : (t('me', { defaultValue: '나' }) as string)} <${accountEmail}>`
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
                  {t('detail.toAddr', { defaultValue: '받은 주소' }) as string}: {toAddrList(m.to_emails).join(', ')}
                </MessageTo>
              )}
            </MessageFrom>
            <MsgHeaderRight>
              {/* #272 — "접힌상태랑 아닌 상태 구별 안되고 글자가 잘리는 것처럼 보여버려".
                  아이콘 하나로 상태를 말한다(Gmail 관례). aria-expanded 는 위 MessageFrom 이 이미 갖고 있어
                  여기서는 장식으로 두고 스크린리더에는 숨긴다 — 같은 상태를 두 번 읽지 않게. */}
              <MsgChevron $open={open} aria-hidden="true">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9" /></svg>
              </MsgChevron>
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
              <MsgForwardBtn type="button" onClick={(e) => {
                e.stopPropagation();
                const sub = m.direction === 'outbound'
                  ? `${(m.sent_by_user_id && myUserId && m.sent_by_user_id !== myUserId && m.sent_by_name) ? m.sent_by_name : (t('me', { defaultValue: '나' }) as string)} <${accountEmail}>`
                  : `${m.from_name || ''} <${m.from_email || ''}>`;
                const opened = openMailWindow({
                  title: subject || '',
                  subtitle: sub,
                  srcDoc: m.body_html ? buildMailSrcDoc(m.id, m.body_html, msgCidData[m.id], foldLabels) : undefined,
                  text: m.body_text,
                });
                if (!opened) setFullMsgId(m.id);
              }}
                title={t('detail.fullView', { defaultValue: '전체 화면으로 보기' }) as string}
                aria-label={t('detail.fullView', { defaultValue: '전체 화면으로 보기' }) as string}>
                {t('detail.fullViewShort', { defaultValue: '전체보기' }) as string}
              </MsgForwardBtn>
              {/* ★ 2026-08-24 (Irene 지시) — 전달 기능 **일시 차단**.
                  원문 HTML 을 리치 에디터에 통과시키는 구조라 표·인라인 스타일이 재해석되어
                  레이아웃이 깨지고(라운드 박스) cid: 이미지가 유실된다. 서버가 원문을 그대로
                  이어붙이는 경로(include_original)를 넣었으나 **실사용으로 검증되지 않았다**
                  (신고 시점까지 실제 발송 0건 — 요청이 서버에 도달하지 않았다).
                  "엉망인 기능을 고객이 보면 안 된다" — 오픈 전까지 진입을 막고 Fable 이 설계·검증한다.
                  되살릴 때: 이 블록의 FORWARD_ENABLED 를 true 로. 근거는 FABLE_VERIFY_QUEUE §5. */}
              {FORWARD_ENABLED && (
                <MsgForwardBtn type="button" onClick={(e) => { e.stopPropagation(); startForward(m); }}
                  title={t('forward.button', { defaultValue: '전달' }) as string}
                  aria-label={t('forward.button', { defaultValue: '전달' }) as string}>
                  {t('forward.button', { defaultValue: '전달' }) as string}
                </MsgForwardBtn>
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
            <MessageBodyText>{m.body_text || '(no content)'}</MessageBodyText>
          )}
          {/* #184 — 번역하기 / 원본 보기 토글 (언어 선택). 답장 원문 언어는 #153에서 처리됨. */}
          <TransBar>
            <TransSelect value={transLangByMsg[m.id] ?? pickTranslateTarget(guessLangFromText(m.body_text), uiLang)}
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
                  const target = transLangByMsg[m.id] ?? pickTranslateTarget(guessLangFromText(m.body_text), uiLang);
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
          </TransBar>
          {msgTrans[m.id]?.showing && msgTrans[m.id]?.text && (
            <TransBody>{msgTrans[m.id]!.text}</TransBody>
          )}
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
            ? `${(fullMsg.sent_by_user_id && myUserId && fullMsg.sent_by_user_id !== myUserId && fullMsg.sent_by_name) ? fullMsg.sent_by_name : (t('me', { defaultValue: '나' }) as string)} <${accountEmail}>`
            : `${fullMsg.from_name || ''} <${fullMsg.from_email || ''}>`)
          : undefined}
        srcDoc={fullMsg && fullMsg.body_html ? buildMailSrcDoc(fullMsg.id, fullMsg.body_html, msgCidData[fullMsg.id], foldLabels) : undefined}
        text={fullMsg ? fullMsg.body_text : null}
      />
    </>
  );
}
