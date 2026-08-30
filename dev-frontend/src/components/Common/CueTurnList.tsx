// components/Common/CueTurnList.tsx — Cue 대화 **렌더 단일 원천** (#227).
//
// Q helper 드로어와 채팅·메일 우측 패널이 **같은 것**을 그린다. 표면마다 다시 그리면
// 확인 카드·근거 링크·피드백 버튼이 한쪽에만 붙는 일이 생긴다 — 이 저장소가 여러 번 겪었다.
//
// 동작(상태·API)은 hooks/useCueChat.ts 가 갖는다. 여기는 그리기만 한다.
import { useTranslation } from 'react-i18next';
import CueActionCard from './CueActionCard';
import type { CueTurn } from '../../hooks/useCueChat';
import type { CueActionResult } from './CueActionCard';

interface Props {
  turns: CueTurn[];
  /** 'workspace' 면 Cue(실행 제안 카드 노출), 'qhelper' 면 Q위키(근거 링크 노출) */
  mode: string;
  businessId: number | null;
  onFeedback: (turnIdx: number, feedback: 'helpful' | 'not_helpful') => void;
  onActionExecuted: (turnIdx: number, r: CueActionResult) => void;
  onActionDismiss: (turnIdx: number) => void;
  /** 만든 것을 여는 방법 — 드로어는 이동+닫기, 패널은 새 탭. 표면이 정한다. */
  onOpenResult: (r: CueActionResult) => void;
  /** Q위키 근거 링크 클릭 — 표면마다 여는 방식이 다르다 */
  onOpenSource?: (slug: string) => void;
}

export default function CueTurnList({
  turns, mode, businessId, onFeedback, onActionExecuted, onActionDismiss, onOpenResult, onOpenSource,
}: Props) {
  const { t } = useTranslation('common');
  const { t: tw } = useTranslation('wiki');

  return (
    <>
      {turns.map((tn, i) => (
        <TurnRow key={i}>
          <Q>
            <QuLabel>{t('qhelper.you', '나')}</QuLabel>
            <QText>{tn.q}</QText>
          </Q>
          <A $variant="qhelper">
            <ALabel $variant="qhelper">
              {mode === 'workspace' ? t('qhelper.cueLabel', 'Cue') : t('qhelper.guideLabel', 'Q helper')}
            </ALabel>
            {tn.loading
              ? <Loading>{t('qhelper.thinking', '생각 중…')}</Loading>
              : tn.error
                ? <ErrorText>{tn.error}</ErrorText>
                : <Answer>{tn.a}</Answer>}
            {/* #81 — Cue 실행 제안 확인 카드 (workspace 모드) */}
            {mode === 'workspace' && !tn.loading && !tn.error && tn.proposedAction && tn.actionStatus !== 'dismissed' && (
              tn.actionStatus === 'done' && tn.actionResult ? (
                <>
                  <ActionDone>
                    <span>✓ {t('qhelper.action.done', '추가됐어요')}</span>
                    <ActionOpen type="button" onClick={() => onOpenResult(tn.actionResult!)}>
                      {t('qhelper.action.open', '열기')} ↗
                    </ActionOpen>
                  </ActionDone>
                  {/* #237 — 업무는 만들었지만 '완료' 까지는 못 간 경우. 조용히 넘기면 완료된 줄 안다. */}
                  {tn.actionResult.completed_skipped && (
                    <ActionNote>
                      {tn.actionResult.completed_skipped === 'only_assignee'
                        ? t('qhelper.action.completedSkipAssignee', '담당자가 다른 분이라 완료 처리는 하지 않았어요 — 업무만 추가했습니다')
                        : tn.actionResult.completed_skipped === 'not_ready_for_complete'
                          ? t('qhelper.action.completedSkipReview', '컨펌자가 있는 업무라 완료 처리는 하지 않았어요 — 업무만 추가했습니다')
                          : t('qhelper.action.completedSkipGeneric', '완료 처리는 하지 못했어요 — 업무만 추가했습니다')}
                    </ActionNote>
                  )}
                </>
              ) : (
                <CueActionCard
                  proposal={tn.proposedAction}
                  businessId={businessId}
                  onExecuted={(r) => onActionExecuted(i, r)}
                  onDismiss={() => onActionDismiss(i)}
                />
              )
            )}
            {mode === 'qhelper' && !tn.loading && !tn.error && tn.sources && tn.sources.length > 0 && onOpenSource && (
              <Sources>
                <SourcesLabel>{tw('drawer.sources')}</SourcesLabel>
                {tn.sources.map((s) => (
                  <SourceLink key={s.slug} type="button" onClick={() => onOpenSource(s.slug)}>
                    {s.title}
                  </SourceLink>
                ))}
              </Sources>
            )}
            {/* KNOWLEDGE_LOOP 축2 — 답변 피드백. 미답변·불만족이 위키 초안 제안으로 되먹임 */}
            {!tn.loading && !tn.error && tn.a && tn.logId != null && (
              <FeedbackRow>
                {tn.feedback ? (
                  <FeedbackDone>{t('qhelper.feedbackThanks', '피드백 감사합니다')}</FeedbackDone>
                ) : (
                  <>
                    <FeedbackBtn type="button" onClick={() => onFeedback(i, 'helpful')}>
                      {t('qhelper.feedbackHelpful', '도움됐어요')}
                    </FeedbackBtn>
                    <FeedbackBtn type="button" onClick={() => onFeedback(i, 'not_helpful')}>
                      {t('qhelper.feedbackNotHelpful', '아니요')}
                    </FeedbackBtn>
                  </>
                )}
              </FeedbackRow>
            )}
          </A>
        </TurnRow>
      ))}
    </>
  );
}

import styled from 'styled-components';

const TurnRow = styled.div`
  margin-bottom: 16px;
  display: flex; flex-direction: column; gap: 6px;
`;
const Q = styled.div`
  display: flex; flex-direction: column; gap: 2px;
  padding: 8px 10px;
  background: #F8FAFC;
  border-radius: 8px;
`;
const QuLabel = styled.span`
  font-size: 0.625rem; font-weight: 700; color: #94A3B8;
  text-transform: uppercase; letter-spacing: 0.4px;
`;
const QText = styled.span`
  font-size: 0.8125rem; color: #0F172A; line-height: 1.55;
  white-space: pre-wrap; word-break: break-word;
`;
const A = styled.div<{ $variant?: 'qhelper' | 'workspace' }>`
  display: flex; flex-direction: column; gap: 4px;
  background: ${p => p.$variant === 'workspace' ? '#FFF1F2' : '#F0FDFA'};
  border-left: 3px solid ${p => p.$variant === 'workspace' ? '#F43F5E' : '#14B8A6'};
  border-radius: 0 8px 8px 0;
  padding: 10px 12px;
`;
const ALabel = styled.span<{ $variant?: 'qhelper' | 'workspace' }>`
  font-size: 0.625rem; font-weight: 700;
  color: ${p => p.$variant === 'workspace' ? '#9F1239' : '#0D9488'};
  text-transform: uppercase; letter-spacing: 0.4px;
`;
const Answer = styled.div`
  font-size: 0.8125rem; color: #0F172A; line-height: 1.55;
  white-space: pre-wrap;
  flex: 1;
`;
const Loading = styled.span`
  font-size: 0.8125rem; color: #64748B; font-style: italic;
`;
const ErrorText = styled.span`
  font-size: 0.8125rem; color: #DC2626;
`;
const ActionDone = styled.div`
  margin-top: 8px; display: flex; align-items: center; gap: 10px;
  font-size: 0.8125rem; color: #0f766e; font-weight: 600;
`;
const ActionOpen = styled.button`
  border: 1px solid #99f6e4; background: #f0fdfa; color: #0f766e;
  border-radius: 8px; padding: 4px 10px; font-size: 0.75rem; font-weight: 700; cursor: pointer;
  &:hover { background: #ccfbf1; }
`;
const ActionNote = styled.div`
  margin-top: 5px; font-size: 0.6875rem; color: #b45309;
  background: #fffbeb; border-radius: 6px; padding: 5px 8px;
`;
const Sources = styled.div`
  margin-top: 8px; padding-top: 8px; border-top: 1px dashed #CCFBF1;
  display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
`;
const SourcesLabel = styled.span`
  font-size: 0.625rem; font-weight: 700; color: #0D9488;
  text-transform: uppercase; letter-spacing: 0.4px;
`;
const SourceLink = styled.button`
  all: unset; cursor: pointer;
  padding: 3px 8px; border-radius: 999px;
  background: #FFFFFF; border: 1px solid #5EEAD4;
  font-size: 0.6875rem; font-weight: 600; color: #0F766E;
  &:hover { background: #F0FDFA; }
`;
const FeedbackRow = styled.div`
  margin-top: 8px; display: flex; align-items: center; gap: 6px;
`;
const FeedbackDone = styled.span`
  font-size: 0.6875rem; color: #94A3B8;
`;
const FeedbackBtn = styled.button`
  all: unset; cursor: pointer;
  padding: 3px 10px; border-radius: 999px;
  background: #FFFFFF; border: 1px solid #E2E8F0;
  font-size: 0.6875rem; font-weight: 600; color: #64748B;
  &:hover { background: #F8FAFC; border-color: #CBD5E1; }
`;
