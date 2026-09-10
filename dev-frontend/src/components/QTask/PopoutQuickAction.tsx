// 팝아웃 행의 **퀵액션** (완료 체크 / 되돌리기 / 확인요청 신호 / 확인 중)
//   TaskPopoutView 에서 뺐다 — 그 파일이 god-file 선(800줄)을 넘었고, 이 조각은 그 자체로 완결이다.
//   동작·문구·주석은 옮기기 전과 같다(행동 무변경 리팩터).
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { QuickAction } from './popoutQuickAction';
import { Slot, Spin, CheckBtn, CheckIcon, SubmitBtn, SendIcon, WaitDot } from './TaskPopoutView.styles';

interface Props {
  taskId: number;
  qa: QuickAction;
  busy: boolean;
  /** 워크플로 액션 실행 — **이름만** 넘긴다(경로 조립은 호출부).
   *  여기 '/complete' 같은 문자열을 두면 SPA 라우트 링크 검사기가 죽은 링크로 읽는다. */
  onAction: (taskId: number, action: 'complete' | 'revert-status') => void;
  /** 상세 열기 — 확인 요청은 여기서 바로 보내지 않는다(운영 #280) */
  onOpenDetail: (taskId: number) => void;
}

const PopoutQuickAction: React.FC<Props> = ({ taskId, qa, busy, onAction, onOpenDetail }) => {
  const { t } = useTranslation('qtask');
    // 체크/해제는 낙관적으로 이미 뒤집혀 있다 — 스피너로 덮으면 **즉시 반영을 도로 감춘다**.
    //   나머지(제출 등)는 서버 판정을 기다려야 하므로 종전대로 스피너를 보인다.
    if (busy && qa !== 'complete' && qa !== 'uncheck') return <Slot aria-hidden="true"><Spin /></Slot>;
    // 중복 제출 가드 (UI_DESIGN_GUIDE §1.8) — 처리 중엔 다른 행의 퀵액션도 잠근다.
    // 이 행만 잠근다. 옛 전역 잠금은 한 행을 누르면 목록 전체가 굳어 버렸고,
    //   그것이 느리다는 체감의 절반이었다.
    const locked = busy;
    switch (qa) {
      case 'complete':
        return (
          <CheckBtn
            type="button" role="checkbox" aria-checked={false} disabled={locked}
            data-testid="task-popout-check"
            aria-label={t('popout.act.complete', '완료 처리')}
            title={t('popout.act.complete', '완료 처리')}
            onClick={() => onAction(taskId, 'complete')}
          />
        );
      case 'uncheck':
        return (
          <CheckBtn
            type="button" role="checkbox" aria-checked $checked disabled={locked}
            data-testid="task-popout-uncheck"
            aria-label={t('popout.act.uncheck', '완료 되돌리기')}
            title={t('popout.act.uncheck', '완료 되돌리기')}
            onClick={() => onAction(taskId, 'revert-status')}
          ><CheckIcon /></CheckBtn>
        );
      case 'checked_locked':
        return (
          <CheckBtn
            as="span" $checked $locked role="img"
            data-testid="task-popout-check-locked"
            aria-label={t('popout.act.locked', '컨펌으로 완료됨')}
            title={t('popout.act.lockedTip', '컨펌으로 완료됨 — 되돌리기는 상세에서')}
          ><CheckIcon /></CheckBtn>
        );
      case 'submit':
        // ★ 여기서 **바로 보내지 않는다** (운영 #280: "팝아웃 테스크에 나오는 보내는 아이콘은 뭐야?
        //   기존 Q task 리스트에 없는 기능은 따로 추가하기에 통일성이나 혼란이 있어서 조심해야 할 것
        //   같아. 그냥 패널열고 보내면 될 것 같은데").
        //   아이콘은 남긴다 — "이 업무는 확인 요청이 필요하다" 는 **신호**는 목록에서 보여야 한다.
        //   다만 누르면 상세를 열고, 보내는 것은 메인 Q task 와 같은 자리(상세)에서 한다.
        return (
          <SubmitBtn
            type="button" disabled={locked}
            data-testid="task-popout-submit-review"
            aria-label={t('popout.act.needSubmit', '확인 요청이 필요해요 — 눌러서 상세에서 보내기')}
            title={t('popout.act.needSubmit', '확인 요청이 필요해요 — 눌러서 상세에서 보내기')}
            onClick={() => onOpenDetail(taskId)}
          ><SendIcon /></SubmitBtn>
        );
      case 'reviewing':
        return (
          <Slot
            role="img"
            data-testid="task-popout-reviewing"
            aria-label={t('popout.act.reviewing', '확인 중')}
            title={t('popout.act.reviewingTip', '확인 중 — 컨펌자 응답을 기다리는 중입니다')}
          ><WaitDot /></Slot>
        );
      default:
        return <Slot aria-hidden="true" />;
    }
};

export default PopoutQuickAction;
