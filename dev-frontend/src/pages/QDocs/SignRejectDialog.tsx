// 공개 서명 화면 — 받는 쪽 «수정 요청·거절» 창 (2026-10-22, Fable 설계 PASS · docs/SIGNATURE_REVISE_ROUND_DESIGN.md D8)
//   버튼 하나로 열고, 창 안에서 고른다: ○ 수정을 요청합니다(사유 필수, 기본) ○ 서명하지 않겠습니다(사유 선택).
//   서버 POST /api/sign/:token/reject { kind, reason } — 같은 판정(revise 사유 없음 400 reason_required)을 서버도 한다.
//   PublicSignPage 에서 분리(god-file 래칫). 고르기·사유 상태는 여기만 가진다.
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useEscapeStack } from '../../hooks/useEscapeStack';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import {
  InlineSpinner, RejectActions, RejectBackdrop, RejectBtn, RejectChoice, RejectDialog, RejectFieldError, SecondaryBtn, Textarea,
} from './PublicSignPage.styles';

type RejectKind = 'revise' | 'decline';

interface Props {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onSubmit: (kind: RejectKind, reason: string) => void;
}

const SignRejectDialog: React.FC<Props> = ({ open, busy, onClose, onSubmit }) => {
  const { t } = useTranslation('qdocs');
  const [kind, setKind] = useState<RejectKind>('revise');
  const [reason, setReason] = useState('');
  const [fieldErr, setFieldErr] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // 훅은 early return 위 — open 으로 끄고 켠다
  useEscapeStack(open && !busy, onClose);
  useFocusTrap(ref, open);
  useEffect(() => { if (!open) setFieldErr(false); }, [open]);
  if (!open) return null;

  const pick = (k: RejectKind) => { setKind(k); setFieldErr(false); };
  const send = () => {
    if (kind === 'revise' && !reason.trim()) { setFieldErr(true); return; }
    onSubmit(kind, reason.trim());
  };

  return (
    <RejectBackdrop onClick={() => !busy && onClose()}>
      <RejectDialog ref={ref} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true"
        aria-label={t('publicSign.rejectConfirm', '서명하지 않고 보낸 분께 알립니다') as string}>
        <h3>{t('publicSign.rejectConfirm', '서명하지 않고 보낸 분께 알립니다')}</h3>
        <RejectChoice $on={kind === 'revise'} data-testid="sign-reject-kind-revise">
          <input type="radio" name="reject-kind" checked={kind === 'revise'} onChange={() => pick('revise')} />
          <span>{t('publicSign.rejectKindRevise', '수정을 요청합니다 — 보낸 분이 고쳐서 다시 보내 드립니다')}</span>
        </RejectChoice>
        <RejectChoice $on={kind === 'decline'} data-testid="sign-reject-kind-decline">
          <input type="radio" name="reject-kind" checked={kind === 'decline'} onChange={() => pick('decline')} />
          <span>{t('publicSign.rejectKindDecline', '서명하지 않겠습니다')}</span>
        </RejectChoice>
        {/* draft-exempt: 무인증 공개 서명 화면이라 초안 키를 만들 사용자가 없다 — 이 창 안에서 쓰고 보내기와 함께 나간다 */}
        <Textarea
          rows={3}
          data-testid="sign-reject-reason"
          value={reason}
          onChange={(e) => { setReason(e.target.value); if (e.target.value.trim()) setFieldErr(false); }}
          aria-invalid={fieldErr}
          placeholder={(kind === 'revise'
            ? t('publicSign.rejectReasonPhRevise', '어디를 어떻게 고칠지 적어 주세요 (필수)')
            : t('publicSign.rejectReasonPh', '사유 (선택)')) as string}
        />
        {fieldErr && <RejectFieldError role="alert">{t('publicSign.rejectReasonRequired', '고칠 내용을 적어 주세요.')}</RejectFieldError>}
        <p>{t('publicSign.rejectWarn', '보낸 뒤에는 이 요청에서 서명할 수 없습니다. 고친 문서는 새 링크로 다시 옵니다.')}</p>
        <RejectActions>
          <SecondaryBtn type="button" onClick={onClose} disabled={busy}>{t('cancel', '취소')}</SecondaryBtn>
          <RejectBtn type="button" data-testid="sign-reject-submit" onClick={send} disabled={busy}>
            {busy ? <><InlineSpinner />{t('publicSign.rejecting', '보내는 중…')}</> : t('publicSign.rejectFinal', '보내기')}
          </RejectBtn>
        </RejectActions>
      </RejectDialog>
    </RejectBackdrop>
  );
};

export default SignRejectDialog;
