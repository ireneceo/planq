// Q mail 목록 한 행 — MailPage.tsx 에서 옮김(동작 그대로). 행 동작(열기·답변 불필요·확인 완료·스팸 …)은 MailPage 가 넘긴다.
import React from 'react';
import { useTranslation } from 'react-i18next';
import HighlightText from '../../components/Common/HighlightText';
import MatchReason from '../../components/Common/MatchReason';
import { waitingDays, type Folder, type Thread } from './mailTypes';
import {
  ThreadItem, ThreadRow1, ThreadSender, ThreadRow1Right, ListClip, ClipIcon, ThreadTime,
  ThreadSubject, UnreadDot, SentTag, PromoteErrTag, ThreadPreview, FollowUpChip,
  ImpersonationBadge, SpamReasonBadge, UncertainBadge, UncertainInline, ReplyNeededBadge,
  InquiryBadge, HoldingBadge, RuleBadge, ReplyRow, HandledBadge, OverdueChip, RowBtn, SendArrow,
  RowLabels, FolderChip, LabelChip,
} from './MailPage.styles';

type RowAction = (e: React.MouseEvent, threadId: number) => void;

interface Props {
  mt: Thread;
  active: boolean;
  handled: boolean;
  promoted: boolean;
  promoteErr: { id: number; key: string } | null;
  folder: Folder;
  qDebounced: string;
  addressMode: string | null;
  dismissingId: number | null;
  onOpen: (id: number) => void;
  dismissReply: RowAction;
  markHandled: RowAction;
  markReplyNeeded: RowAction;
  markReviewRow: RowAction;
  markSpamRow: RowAction;
  labelColor: (name: string) => string;
  formatTimeAgo: (v: string) => string;
}

export default function MailThreadRow({
  mt, active, handled, promoted, promoteErr, folder, qDebounced, addressMode, dismissingId,
  onOpen, dismissReply, markHandled, markReplyNeeded, markReviewRow, markSpamRow, labelColor, formatTimeAgo,
}: Props) {
  const { t } = useTranslation('qmail');
  const { t: tSale } = useTranslation('qsale');
  return (
    <ThreadItem
      type="button"
      data-testid="mail-thread-row"
      data-thread-id={mt.id}
      $active={active}
      $unread={mt.unread_count > 0}
      $handled={handled}
      onClick={() => onOpen(mt.id)}
      // ★ 2026-09-16 (Irene: "메일목록에서 … 상담리스트로 보내기 기능이 있어야 할 것 같아.")
      //   행 자체가 <button> 이라 안에 메뉴 버튼을 넣을 수 없다(중첩 button = 유효하지 않은 HTML).
      //   그래서 **우클릭 메뉴 한 곳**(AppContextMenu)에 동작을 선언한다.
      //   이미 고객에 연결된 스레드는 상담이 아니라 그 고객의 이력이므로 내지 않는다.
      {...(mt.client ? {} : {
        'data-pq-context': 'sale-promote',
        'data-pq-context-label-sale-promote': t('actions.promoteToSale', { defaultValue: '상담으로 보내기' }) as string,
        'data-ctx-thread-id': String(mt.id),
      })}
    >
      <ThreadRow1>
        <ThreadSender>
          {/* 보낸 사람 = 실제 발신자(메일 헤더의 이름). 여태 내 메일함 이름
              (account.display_name)을 그려서 PlanQ 알림이 내 계정명으로 보였다.
              연결된 고객 이름도 발신자를 가리면 안 된다 — 고객 연결은 별도 칩으로 표시된다. */}
          {/* #164 — 이름이 없을 땐 전체 이메일 주소 대신 @ 앞 로컬 파트만 축약 표시(리스트 노이즈 감소). */}
          <HighlightText
            query={qDebounced}
            text={mt.counterpart?.name || mt.client?.display_name || mt.client?.company_name
              || (mt.counterpart?.email || mt.account?.email || '').split('@')[0]
              || '(unknown)'}
          />
        </ThreadSender>
        <ThreadRow1Right>
          {/* #215-I — 첨부 유무. 개수는 그리지 않고 aria/title 로만 (좁은 행 — Gmail 관례) */}
          {(mt.attachment_count || 0) > 0 && (
            <ListClip role="img" data-testid="mail-thread-attach"
              aria-label={t('thread.attachments', { count: mt.attachment_count }) as string}
              title={t('thread.attachments', { count: mt.attachment_count }) as string}>
              <ClipIcon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></ClipIcon>
            </ListClip>
          )}
          <ThreadTime>{formatTimeAgo(mt.last_message_at)}</ThreadTime>
        </ThreadRow1Right>
      </ThreadRow1>
      <ThreadSubject $unread={mt.unread_count > 0}>
        {mt.unread_count > 0 && <UnreadDot />}
        {/* #186 — 내가 마지막으로 보낸 스레드는 '보낸' 태그로 받은 메일과 구분.
            ★ #272 — 보낸메일함에서는 숨긴다. 이 폴더는 **메시지 단위**로 정의돼(outbound 가
            1건이라도 있으면 포함) 상대가 답장한 스레드도 들어오는데, 태그는 *마지막* 메시지
            방향을 보므로 같은 폴더 안에서 태그가 붙었다 안 붙었다 했다
            (Irene: "왜 [보낸]이란 표시가 있고 없고 달라?"). 전부 보낸 메일인 폴더라 정보량도 0. */}
        {/* #438 — 답을 기다리는 스레드는 고객 메일을 미리보기로 보여주므로 「보낸」 태그를 달지 않는다
            (태그와 미리보기가 서로 다른 메일을 가리키게 된다). */}
        {folder !== 'sent' && mt.last_message_direction === 'outbound' && !mt.reply_preview && (
          <SentTag>{t('thread.sent', { defaultValue: '보낸' }) as string}</SentTag>
        )}
        {/* 보낸메일함 — PlanQ 에서 보낸 메일은 표시를 단다(Gmail·다른 앱·AI 에서 보낸 것과 가른다). 기준은 서버 sent_via. */}
        {folder === 'sent' && mt.sent_via === 'planq' && (
          <SentTag data-testid="mail-sent-via-planq-tag">{t('sentVia.tag', { defaultValue: 'PlanQ 발송' }) as string}</SentTag>
        )}
        {/* 보냈다는 것은 **행에 조용히** 남긴다 — 성공 토스트는 쓰지 않는다(운영 규칙). */}
        {promoted && (
          <SentTag data-testid="mail-promoted-mark">
            {t('actions.promotedToSale', { defaultValue: '상담으로 보냄' }) as string}
          </SentTag>
        )}
        {promoteErr && promoteErr.id === mt.id && (
          <PromoteErrTag data-testid="mail-promote-error" role="status">
            {tSale(`promoteError.${promoteErr.key}`) as string}
          </PromoteErrTag>
        )}
        <HighlightText text={mt.subject || '(no subject)'} query={qDebounced} />
      </ThreadSubject>
      {(mt.reply_preview || mt.last_message_preview) && (
        <ThreadPreview data-testid="mail-thread-preview">
          <HighlightText text={(mt.reply_preview || mt.last_message_preview) as string} query={qDebounced} />
        </ThreadPreview>
      )}
      {/* 2026-09-11 — 검색은 스레드의 **모든 메시지**(본문·제목·보낸 사람)를 본다. 행에 안 보이는 곳에서
          맞았으면 서버가 준 주변 문장을 한 줄로 보여 "왜 떴는지" 를 알린다(services/mailSearchMatch). */}
      {qDebounced && mt.match?.snippet && (
        <MatchReason field={mt.match.field} snippet={mt.match.snippet} query={qDebounced} />
      )}
      {/* 후속 조치 신호 — "봤나" 대신 "움직여야 하나" 에 답한다. 발송 실패는 별개로 구분. */}
      {mt.follow_up && (
        mt.follow_up.kind === 'delivery_problem' ? (
          <FollowUpChip $tone="err">
            {t(`delivery.${mt.follow_up.delivery_status}`) as string}
          </FollowUpChip>
        ) : (
          <FollowUpChip $tone="warn">
            {t('thread.awaitingReply', { count: mt.follow_up.days }) as string}
          </FollowUpChip>
        )
      )}
      {/* 사칭 의심 — 서버 판정(services/mailImpersonation) 그대로. 격리된 것은 «격리» 까지 말한다. */}
      {mt.impersonation && (
        <ImpersonationBadge data-testid="mail-row-impersonation" title={t('impersonation.rowHint') as string}>
          ⚠ {t(mt.status === 'spam' && mt.spam_origin === 'impersonation' ? 'impersonation.rowQuarantined' : 'impersonation.row') as string}
        </ImpersonationBadge>
      )}
      {/* 스팸 폴더 — 왜 스팸인가(업체 스팸함 / 규칙 / 직접 표시 / 자체 판정). 사칭은 위 배지가 말한다. */}
      {folder === 'spam' && mt.status === 'spam' && mt.spam_origin !== 'impersonation' && (
        <SpamReasonBadge data-testid="mail-row-spam-reason">
          {t(`spamFolder.reason.${mt.spam_origin === 'provider' ? 'provider' : mt.rule_id ? 'rule' : mt.triage_criterion === 'spam_filter' ? 'filter' : 'manual'}`) as string}
        </SpamReasonBadge>
      )}
      {/* 확인 권장 뱃지는 처리 버튼과 같은 줄에 둔다 — 따로 두면 빈 줄이 생기고 행이 길어진다.
          확인 권장 폴더가 아닐 때만 단독 표시(그 폴더에선 아래 처리 줄에 함께 나온다). */}
      {mt.status === 'uncertain' && folder !== 'uncertain' && (
        <UncertainBadge>
          ⚠ {t(`uncertain.${mt.uncertain_reason || 'review'}`, { defaultValue: t('uncertain.review', { defaultValue: '확인 권장' }) }) as string}
        </UncertainBadge>
      )}
      {/* #221 — 답변 필요도 표시한다. 여태 확인 권장만 뱃지가 있어서 다른 탭에서는
          그 메일이 답변 대기 중인지 알 수 없었다. 답변 필요 폴더 안에서는 아래 처리 줄이
          이미 그 맥락을 주므로 중복 표시하지 않는다 (확인 권장 뱃지와 같은 규칙). */}
      {mt.reply_needed && folder !== 'reply_needed' && (
        <ReplyNeededBadge>
          {t('replyNeededBadge', { defaultValue: '답변 필요' }) as string}
        </ReplyNeededBadge>
      )}
      {/* 「문의」 — Q sale 의 상담 기준(`saleInbox.classifyMailThreads`)에 드는 메일.
          ★ 상태를 말하는 **명사**다(누르는 버튼이 아니다). 같은 글자를 상태와 행위에
            같이 쓰지 않는다 — 2026-09-17 에 그 때문에 목록이 "같은 표시가 두 번" 으로 읽혔다.
          ★ 서버가 판정을 못 했으면 필드가 없고, 그때는 **아무 것도 그리지 않는다.** */}
      {mt.is_inquiry === true && (
        <InquiryBadge title={t('inquiryBadgeHint', { defaultValue: 'Q sales 상담 목록에 들어오는 메일입니다' }) as string}>
          {t('inquiryBadge', { defaultValue: '문의' }) as string}
        </InquiryBadge>
      )}
      {/* #449 — 수동 모드에서 자동 기준에만 드는 메일. 상태 명사다(누르는 버튼이 아니다). */}
      {mt.is_inquiry !== true && mt.is_inquiry_candidate === true && (
        <InquiryBadge $candidate data-testid="mail-inquiry-candidate"
          title={t('inquiryBadgeCandidateHint') as string}>
          {t('inquiryBadgeCandidate') as string}
        </InquiryBadge>
      )}
      {/* ★ 2026-09-10 — **임시 답변**으로 남겨둔 것. 목록이 "왜 아직 여기 있는지" 를 말해야 한다.
          이 표시가 없으면 다음 날 그 메일을 보고 답장을 했는지 안 했는지 또 알 수 없다. */}
      {mt.reply_needed && mt.reply_needed_reason === 'holding' && (
        <HoldingBadge title={t('thread.holdingHint', { defaultValue: '임시 답변을 보냈고, 아직 본 답변이 남아 있습니다' }) as string}>
          {t('thread.holding', { defaultValue: '임시답변' }) as string}
        </HoldingBadge>
      )}
      {/* 학습된 규칙으로 자동 분류된 메일임을 밝힌다 — 사용자 모르게 걸러지면 안 된다.
          규칙은 설정 > 메일 계정 > 메일 분류 규칙에서 확인·삭제할 수 있다. */}
      {mt.rule_id && (
        <RuleBadge title={t('rules.appliedHint', { defaultValue: '설정에서 이 규칙을 확인하고 지울 수 있습니다' }) as string}>
          {t('rules.applied', { defaultValue: '규칙으로 자동 분류됨' })}
        </RuleBadge>
      )}
      {/* 답변 필요 폴더 — 오래 방치된 문의를 눈에 띄게 하고, 밖(Gmail 등)에서 이미 답장한
          메일을 사람이 직접 끌 수 있게 한다. 안 그러면 플래그가 영영 안 꺼져 지표가 죽는다. */}
      {folder === 'reply_needed' && handled && (
        <ReplyRow>
          <HandledBadge>{t('actions.handledDone', { defaultValue: '처리됨' }) as string}</HandledBadge>
        </ReplyRow>
      )}
      {folder === 'reply_needed' && !handled && (
        <ReplyRow>
          {waitingDays(mt.reply_needed_at) >= 3 && (
            <OverdueChip>
              {t('reply.waitingDays', {
                defaultValue: '{{n}}일 경과',
                n: waitingDays(mt.reply_needed_at),
              }) as string}
            </OverdueChip>
          )}
          {/* 답장을 보내면 reply_needed 는 서버가 알아서 끈다 (email_threads.js 답장 라우트).
              그래서 여기 남는 문은 하나뿐 — 답하지 않아도 되는 메일을 내리는 문. */}
          <RowBtn
            type="button"
            disabled={dismissingId === mt.id}
            title={t('reply.dismissHint', { defaultValue: '답장하지 않아도 되는 메일입니다. 확인 권장으로 내려갑니다.' }) as string}
            onClick={(e) => dismissReply(e, mt.id)}
          >
            {t('reply.dismiss', { defaultValue: '답변 불필요' }) as string}
          </RowBtn>
        </ReplyRow>
      )}
      {/* 확인 권장 — 판단이 끝난 메일을 여기서 바로 내린다. 못 내리면 이 폴더는 영영 안 줄고
          관리 자산이 아니라 쓰레기통이 된다. 원본은 그대로(전체 탭에 남는다). */}
      {folder === 'uncertain' && handled && (
        <ReplyRow>
          <HandledBadge>{t('actions.handledDone', { defaultValue: '처리됨' }) as string}</HandledBadge>
        </ReplyRow>
      )}
      {folder === 'uncertain' && !handled && (
        <ReplyRow>
          {/* ★ 2026-09-19 (Irene #421: *"이건 확인이 필요하면 확인권장탭으로 가면 되는 건데
              왜 체크가 나와? 이건 필요없는 표시 같은데?"*) — **탭 이름이 이미 그 말을 하고 있다.**
              일반 사유(unclear_intent·review)는 «확인이 필요하다» 는 뜻뿐이라 이 탭에서는
              같은 말을 두 번 하는 것이다. 정보를 더하는 사유(자동업무·청구결제·견적계약)만 남긴다.
              다른 탭에서는 맥락이 없으므로 종전대로 전부 보여준다(위 UncertainBadge). */}
          {mt.status === 'uncertain'
            && !!mt.uncertain_reason
            && !['unclear_intent', 'review'].includes(mt.uncertain_reason) && (
            <UncertainInline>
              ⚠ {t(`uncertain.${mt.uncertain_reason}`, { defaultValue: t('uncertain.review', { defaultValue: '확인권장' }) }) as string}
            </UncertainInline>
          )}
          <RowBtn
            type="button"
            data-testid="mail-row-handled"
            disabled={dismissingId === mt.id}
            onClick={(e) => markHandled(e, mt.id)}
          >
            {t('actions.markHandled', { defaultValue: '확인 완료' }) as string}
          </RowBtn>
          {/* 운영 #314 — 확인 권장에서 "이건 나중에 답해야 한다" 로 올리는 문 */}
          <RowBtn
            type="button"
            data-testid="mail-row-reply-needed"
            disabled={dismissingId === mt.id}
            title={t('actions.markReplyNeededHint', { defaultValue: '이 메일을 «답변 필요» 로 올립니다. 답변 필요 탭에서 이어서 처리할 수 있습니다.' }) as string}
            onClick={(e) => markReplyNeeded(e, mt.id)}
          >
            {t('actions.markReplyNeeded', { defaultValue: '답변 필요로' }) as string}
            {/* 「표시」를 아이콘으로 — 방향형 어미(…로)는 남긴다. 상태 뱃지(빨간 「답변 필요」)와
                글자가 같아지면 목록이 «같은 표시가 두 번» 으로 읽힌다(CLAUDE.md Q mail 계약 ②). */}
            <SendArrow aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="12" x2="19" y2="12" /><polyline points="13 6 19 12 13 18" />
            </SendArrow>
          </RowBtn>
          <RowBtn
            type="button"
            $danger
            disabled={dismissingId === mt.id}
            onClick={(e) => markSpamRow(e, mt.id)}
          >
            {t('actions.markSpam', { defaultValue: '스팸' }) as string}
          </RowBtn>
        </ReplyRow>
      )}
      {/* ★ 2026-09-17 — **버튼 문구는 뱃지와 달라야 한다.**
          Irene: *"전체 메일에 답변필요 표시가 두번 나와. 빨간거 회색."*
          실측(전체 30행): 빨간 `ReplyNeededBadge`(상태 = 이 메일은 답변 대기 중)와
          회색 `RowBtn`(행위 = 눌러서 올려라)이 **글자가 똑같아서** 한 목록에 같은 표시가
          두 번 있는 것으로 읽혔다. 한 행에 둘이 같이 뜨지는 않지만(조건이 배타적),
          목록을 훑는 사람에게는 **행이 아니라 목록 전체가 한 장면**이다.
          → 상태는 명사(「답변 필요」), 행위는 동사를 붙인다(「답변 필요로 표시」).
          회귀: `node scripts/e2e/run.js --suite maillabel`
          운영 #314 — 확인 권장·답변 필요 말고 **어느 탭에서도** 답변 필요로 올릴 수 있어야 한다.
          (전체·자동/마케팅·보관·보낸메일·스팸 …) 이미 답변 필요인 건 다시 올릴 이유가 없다. */}
      {folder !== 'uncertain' && folder !== 'reply_needed' && !mt.reply_needed && !handled && (
        <ReplyRow>
          {/* 2026-10-15 — 자동·마케팅 폴더에서만: «확인 권장으로» (상태 뱃지 «확인 권장» 과 글자가 다르다 — Q mail 계약 ②) */}
          {folder === 'marketing' && (
            <RowBtn
              type="button"
              data-testid="mail-row-review"
              disabled={dismissingId === mt.id}
              title={t('actions.markReviewHint', { defaultValue: '이 메일을 «확인 권장» 으로 올립니다.' }) as string}
              onClick={(e) => markReviewRow(e, mt.id)}
            >
              {t('actions.markReview', { defaultValue: '확인 권장으로' }) as string}
            </RowBtn>
          )}
          <RowBtn
            type="button"
            data-testid="mail-row-reply-needed"
            disabled={dismissingId === mt.id}
            title={t('actions.markReplyNeededHint', { defaultValue: '이 메일을 «답변 필요» 로 올립니다. 답변 필요 탭에서 이어서 처리할 수 있습니다.' }) as string}
            onClick={(e) => markReplyNeeded(e, mt.id)}
          >
            {t('actions.markReplyNeeded', { defaultValue: '답변 필요로' }) as string}
            {/* 「표시」를 아이콘으로 — 방향형 어미(…로)는 남긴다. 상태 뱃지(빨간 「답변 필요」)와
                글자가 같아지면 목록이 «같은 표시가 두 번» 으로 읽힌다(CLAUDE.md Q mail 계약 ②). */}
            <SendArrow aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="12" x2="19" y2="12" /><polyline points="13 6 19 12 13 18" />
            </SendArrow>
          </RowBtn>
        </ReplyRow>
      )}
      {/* 검색은 폴더를 넘으므로, 지금 보고 있는 폴더가 아닌 곳에서 온 결과는 어디 것인지 말한다.
          같은 폴더면 붙이지 않는다 — 모든 행에 같은 칩이 붙으면 읽히지 않는다. */}
      {(mt.labels && mt.labels.length > 0) || ((qDebounced || addressMode) && mt.folder && mt.folder !== folder) ? (
        <RowLabels>
          {/* 주소 보기(«이 주소와 오간 메일», 보관 포함)도 폴더를 넘는다 — 검색과 같이 자리를 말한다 */}
          {(qDebounced || addressMode) && mt.folder && mt.folder !== folder && (
            <FolderChip $color="#64748B">{t(`folders.${mt.folder}`, { defaultValue: mt.folder }) as string}</FolderChip>
          )}
          {(mt.labels || []).map(l => <LabelChip key={l} $color={labelColor(l)}><HighlightText text={l} query={qDebounced} /></LabelChip>)}
        </RowLabels>
      ) : null}
    </ThreadItem>
  );
}
