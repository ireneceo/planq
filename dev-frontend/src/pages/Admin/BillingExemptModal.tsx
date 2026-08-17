// 결제 면제 설정 모달 (운영 #275) — platform_admin 전용.
//
// 내부 워크스페이스·테스터 고객은 구독료를 청구하지 않는다. 면제를 켜면 서버가
// ①구독 정상화(past_due/grace → active) ②잔여 미결제 청구 취소 를 한 트랜잭션으로 처리하고,
// 이후 결제는 매출로 집계되지 않는다.
//
// 자동저장(AutoSaveField) 규칙의 명시 예외 — 재무 설정이라 실수 토글이 곧 과금 정지다.
// 그래서 명시 저장 버튼을 쓴다. 스타일은 adminModalKit 정본 재사용(ad-hoc styled 금지).
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import CalendarPicker from '../../components/Common/CalendarPicker';
import { useEscapeStack } from '../../hooks/useEscapeStack';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { adminUpdateBillingExempt, type AdminBusinessDetail, type BillingExemptKind } from '../../services/admin';
import type { PlanCode } from '../../services/plan';
import {
  ModalOverlay, Dialog, DTitle, DBody, DDesc, DFooter, DError, FSpacer,
  Field, FLabel, FHelp, PlanOptions, PlanOption,
  DateTrigger, DatePH, TextArea, PrimaryBtn, SecondaryBtn,
} from './adminModalKit';

const KINDS: BillingExemptKind[] = ['internal', 'tester', 'partner'];

interface Props {
  detail: AdminBusinessDetail;
  planCodes: PlanCode[];
  /** 플랜 뱃지 렌더러 — 부모의 PLAN_COLOR 규격을 그대로 쓰기 위해 주입받는다. */
  renderPlanBadge: (code: PlanCode) => React.ReactNode;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}

/** ISO → yyyy-mm-dd (CalendarPicker 입력 형식).
 *  ★ toISOString() 은 UTC 로 변환하므로 KST 자정에 저장된 값이 하루 전으로 프리필된다.
 *    로컬 날짜 그대로 뽑는다. */
function dateToInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function BillingExemptModal({ detail, planCodes, renderPlanBadge, onClose, onSaved }: Props) {
  const { t } = useTranslation('admin');
  const [exempt, setExempt] = useState(!!detail.billing_exempt);
  const [kind, setKind] = useState<BillingExemptKind>((detail.billing_exempt_kind as BillingExemptKind) || 'internal');
  const [plan, setPlan] = useState<PlanCode | ''>(detail.billing_exempt_plan || '');
  const [until, setUntil] = useState(dateToInput(detail.billing_exempt_until));
  const [note, setNote] = useState(detail.billing_exempt_note || '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const untilAnchorRef = useRef<HTMLButtonElement>(null);
  const [untilPickerOpen, setUntilPickerOpen] = useState(false);

  // CLAUDE.md 드로어·모달 접근성 3훅 (배경 스크롤 잠금 · 중첩 안전한 Esc · Tab 순회+복귀)
  const dialogRef = useRef<HTMLDivElement>(null);
  useBodyScrollLock(true);
  useEscapeStack(true, onClose);
  useFocusTrap(dialogRef, true);

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await adminUpdateBillingExempt(detail.id, {
        exempt,
        kind: exempt ? kind : null,
        plan: exempt ? (plan || null) : null,
        until: exempt ? (until || null) : null,
        note: exempt ? (note || null) : null,
      });
      await onSaved();
      onClose();
    } catch (e) {
      setSubmitting(false);
      setError((e as Error).message);
    }
  };

  return (
    <ModalOverlay onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <Dialog ref={dialogRef} role="dialog" aria-modal="true" aria-label={t('modal.exempt.title') as string}>
        <DTitle>{t('modal.exempt.title')}</DTitle>
        <DBody>
          <DDesc>{t('modal.exempt.desc')}</DDesc>

          <Field>
            <FLabel>{t('modal.exempt.toggle')}</FLabel>
            <PlanOptions role="radiogroup">
              <PlanOption
                type="button" role="radio"
                aria-checked={!exempt} $active={!exempt}
                onClick={() => { setExempt(false); setError(null); }}
              >{t('modal.exempt.off')}</PlanOption>
              <PlanOption
                type="button" role="radio"
                aria-checked={exempt} $active={exempt}
                onClick={() => { setExempt(true); setError(null); }}
              >{t('modal.exempt.on')}</PlanOption>
            </PlanOptions>
          </Field>

          {exempt && (
            <>
              <Field>
                <FLabel>{t('modal.exempt.kind')}</FLabel>
                <PlanOptions role="radiogroup">
                  {KINDS.map(k => (
                    <PlanOption
                      key={k} type="button" role="radio"
                      aria-checked={kind === k} $active={kind === k}
                      onClick={() => { setKind(k); setError(null); }}
                    >{t(`exemptKind.${k}`)}</PlanOption>
                  ))}
                </PlanOptions>
              </Field>

              <Field>
                <FLabel>{t('modal.exempt.plan')}</FLabel>
                <PlanOptions role="radiogroup">
                  <PlanOption
                    type="button" role="radio"
                    aria-checked={plan === ''} $active={plan === ''}
                    onClick={() => { setPlan(''); setError(null); }}
                  >{t('modal.exempt.planKeep')}</PlanOption>
                  {planCodes.map(code => (
                    <PlanOption
                      key={code} type="button" role="radio"
                      aria-checked={plan === code} $active={plan === code}
                      onClick={() => { setPlan(code); setError(null); }}
                    >{renderPlanBadge(code)}</PlanOption>
                  ))}
                </PlanOptions>
              </Field>

              <Field>
                <FLabel>{t('modal.exempt.until')}</FLabel>
                <DateTrigger ref={untilAnchorRef} type="button" onClick={() => setUntilPickerOpen(v => !v)}>
                  {until || <DatePH>{t('modal.datePlaceholder') as string}</DatePH>}
                </DateTrigger>
                {untilPickerOpen && (
                  <CalendarPicker
                    isOpen anchorRef={untilAnchorRef}
                    singleMode
                    startDate={until}
                    endDate={until}
                    onRangeSelect={(sel) => { setUntil(sel || ''); setError(null); }}
                    onClose={() => setUntilPickerOpen(false)}
                  />
                )}
                <FHelp>{t('modal.exempt.untilHelp')}</FHelp>
              </Field>

              <Field>
                <FLabel>{t('modal.exempt.note')}</FLabel>
                <TextArea
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  placeholder={t('modal.exempt.notePlaceholder') as string}
                  rows={2}
                />
              </Field>
            </>
          )}

          {error && <DError>{error}</DError>}
        </DBody>
        <DFooter>
          <FSpacer />
          <SecondaryBtn type="button" disabled={submitting} onClick={onClose}>
            {t('actions.cancel')}
          </SecondaryBtn>
          <PrimaryBtn type="button" disabled={submitting} onClick={submit}>
            {submitting ? t('actions.saving') : t('actions.save')}
          </PrimaryBtn>
        </DFooter>
      </Dialog>
    </ModalOverlay>
  );
}
