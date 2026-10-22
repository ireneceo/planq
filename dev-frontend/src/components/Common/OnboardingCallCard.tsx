// 대시보드 «화상으로 업무 설계·사용 안내 받기» 카드 + 신청 창 (docs/ONBOARDING_CALL_DESIGN.md · Fable 설계 PASS).
//
// ★ 보일지는 서버가 정한다 — /api/plan/:biz/status.onboarding_call (체험 중 ∧ 면제 아님 ∧ 대표·관리자 ∧ 열린 신청 0건).
//   화면이 역할·체험을 스스로 판정하지 않는다(접수 라우트와 같은 함수 services/onboardingCall.availability).
// ★ 결제·유료 전환·가격 이야기를 싣지 않는다(앱 심사 3.1 — 이 카드는 구매 유도가 아니다).
// ★ 시간 확정은 플랫폼 관리자가 메일로 한다 — 여기서 일정이 잡히지 않는다(문구도 그렇게 말한다).
import React, { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { apiFetch, useAuth } from '../../contexts/AuthContext';
import { mapApiError } from '../../utils/apiError';
import CreateDrawer from './CreateDrawer';
import OnboardingCallFields, {
  emptyOnboardingCall, toDetails, hasValidSlot, browserTimezone, type OnboardingCallValue,
} from './OnboardingCallFields';

interface CallStatus { available: boolean; requested_at: string | null }
const DISMISS_KEY = 'planq:onboarding-call-dismissed';

function readDismissed(bizId: number): boolean {
  try { return (localStorage.getItem(DISMISS_KEY) || '').split(',').includes(String(bizId)); } catch { return false; }
}
function writeDismissed(bizId: number) {
  try {
    const cur = (localStorage.getItem(DISMISS_KEY) || '').split(',').filter(Boolean);
    if (!cur.includes(String(bizId))) cur.push(String(bizId));
    localStorage.setItem(DISMISS_KEY, cur.join(','));
  } catch { /* 저장 못 해도 이번 화면에서만 닫힌다 */ }
}

const OnboardingCallCard: React.FC<{ businessId: number | null | undefined }> = ({ businessId }) => {
  const { t, i18n } = useTranslation('common');
  const { t: tErr } = useTranslation('errors');
  const { user } = useAuth();
  const [status, setStatus] = useState<CallStatus | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<OnboardingCallValue>(emptyOnboardingCall);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!businessId) return;
    apiFetch(`/api/plan/${businessId}/status`)
      .then(r => r.json())
      .then(j => { if (j?.success) setStatus(j.data?.onboarding_call || null); })
      .catch(() => {});
  }, [businessId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (businessId) setDismissed(readDismissed(businessId)); }, [businessId]);
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible') load(); };
    window.addEventListener('focus', load);
    document.addEventListener('visibilitychange', onVis);
    return () => { window.removeEventListener('focus', load); document.removeEventListener('visibilitychange', onVis); };
  }, [load]);

  const submit = async () => {
    if (!businessId || submitting) return;
    if (!hasValidSlot(value)) { setErr(t('onboardingCall.errSlot', '희망 시간을 하나 이상 골라 주세요.') as string); return; }
    setSubmitting(true); setErr(null);
    try {
      const r = await apiFetch('/api/inquiries', {
        method: 'POST',
        // apiFetch 는 JSON 헤더를 붙이지 않는다 — 없으면 본문이 비어 400 이다.
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'onboarding_call',
          source: 'app_dashboard',
          business_id: businessId,
          from_name: user?.name || user?.email || '',
          from_email: user?.email || '',
          from_company: user?.business_name || undefined,
          message: note.trim() || undefined,
          details: toDetails(value),
          timezone: browserTimezone(),
          locale: i18n.language,
        }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.success) throw new Error(j?.message || `HTTP ${r.status}`);
      setOpen(false);
      setValue(emptyOnboardingCall()); setNote('');
      load();
    } catch (e) {
      setErr(mapApiError(e, tErr));
    } finally {
      setSubmitting(false);
    }
  };

  if (!status) return null;
  const requested = !!status.requested_at;
  if (!status.available && !requested) return null;
  if (!requested && dismissed) return null;

  return (
    <>
      <Card data-testid="onboarding-call-card" role="complementary">
        <Texts>
          <Title>{requested
            ? t('onboardingCall.card.requestedTitle', '화상 안내 신청을 받았어요')
            : t('onboardingCall.card.title', '화상으로 업무 설계·사용 안내 받기')}</Title>
          <Desc>{requested
            ? t('onboardingCall.card.requestedDesc', '희망 시간을 확인하고 일정과 회의 링크를 메일로 보내 드릴게요.')
            : t('onboardingCall.card.desc', '30분 화상 미팅으로 지금 일하는 방식을 듣고, 이 워크스페이스에 맞게 나누고 쓰는 법을 안내해 드려요.')}</Desc>
        </Texts>
        {!requested && (
          <Actions>
            <OpenBtn type="button" data-testid="onboarding-call-open" onClick={() => { setErr(null); setOpen(true); }}>
              {t('onboardingCall.card.cta', '신청하기')}
            </OpenBtn>
            <CloseBtn type="button" aria-label={t('onboardingCall.card.dismiss', '닫기') as string}
              title={t('onboardingCall.card.dismiss', '닫기') as string}
              onClick={() => { if (businessId) writeDismissed(businessId); setDismissed(true); }}>×</CloseBtn>
          </Actions>
        )}
      </Card>
      {/* autosave-exempt: 제출형 신청서 — 한 번에 보내는 요청이라 칸마다 저장하지 않는다 */}
      <CreateDrawer open={open} onClose={() => setOpen(false)}
        title={t('onboardingCall.drawerTitle', '화상 업무 설계·사용 안내 신청')}
        onSubmit={submit} submitting={submitting} submitDisabled={!hasValidSlot(value)}
        submitLabel={t('onboardingCall.submit', '신청하기')} submitTestId="onboarding-call-submit">
        <Form>
          <Lead>{t('onboardingCall.lead', '희망 시간을 골라 주시면 PlanQ 팀이 확인하고 일정과 회의 링크를 메일로 보내 드려요. 일정은 메일로 확정돼요.')}</Lead>
          <Who>{t('onboardingCall.who', { email: user?.email || '', defaultValue: '안내 메일 받을 주소: {{email}}' })}</Who>
          <OnboardingCallFields value={value} onChange={setValue} idPrefix="app-call" />
          <NoteField>
            <NoteLabel htmlFor="app-call-note">{t('onboardingCall.noteLabel', '더 알려 주실 것 (선택)')}</NoteLabel>
            {/* draft-exempt: 200자 이하 신청 메모 — 신청서 전체를 한 번에 보내는 제출형 창이다 */}
            <NoteArea id="app-call-note" rows={3} maxLength={200} value={note} onChange={e => setNote(e.target.value)} />
          </NoteField>
          {err && <Err role="alert">{err}</Err>}
        </Form>
      </CreateDrawer>
    </>
  );
};

export default OnboardingCallCard;

const Card = styled.div`
  display: flex; align-items: center; gap: 16px;
  padding: 14px 18px; margin-bottom: 16px;
  background: #FFFFFF; border: 1px solid #99F6E4; border-radius: 10px;
  @media (max-width: 640px) { flex-direction: column; align-items: flex-start; }
`;
const Texts = styled.div`flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px;`;
const Title = styled.div`font-size: 0.875rem; font-weight: 700; color: #0F172A;`;
const Desc = styled.div`font-size: 0.8125rem; color: #475569; line-height: 1.5;`;
const Actions = styled.div`display: flex; align-items: center; gap: 8px; flex-shrink: 0;`;
const OpenBtn = styled.button`
  height: 36px; padding: 0 16px; border-radius: 8px;
  background: #14B8A6; color: #FFFFFF; border: none;
  font-size: 0.8125rem; font-weight: 600; cursor: pointer;
  &:hover { background: #0D9488; }
  @media (max-width: 640px) { height: 40px; }
`;
const CloseBtn = styled.button`
  width: 36px; height: 36px; border-radius: 8px;
  background: none; border: none; color: #94A3B8; font-size: 1.125rem; cursor: pointer;
  &:hover { color: #475569; background: #F1F5F9; }
  @media (max-width: 640px) { width: 40px; height: 40px; }
`;
const Form = styled.div`display: flex; flex-direction: column; gap: 18px;`;
const Lead = styled.p`margin: 0; font-size: 0.8125rem; color: #475569; line-height: 1.6;`;
const Who = styled.div`font-size: 0.75rem; color: #64748B;`;
const NoteField = styled.div`display: flex; flex-direction: column; gap: 8px;`;
const NoteLabel = styled.label`font-size: 0.8125rem; font-weight: 600; color: #475569;`;
const NoteArea = styled.textarea`
  padding: 10px 12px; font-size: 0.875rem; font-family: inherit; color: #0F172A;
  border: 1px solid #E2E8F0; border-radius: 8px; resize: vertical;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.12); }
  @media (max-width: 640px) { font-size: 1rem; }
`;
const Err = styled.div`font-size: 0.8125rem; color: #B91C1C;`;
