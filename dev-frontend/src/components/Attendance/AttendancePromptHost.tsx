// «출근하셨어요?» · «어제 퇴근 맞나요?» 묻는 창 — 메인 창에 **한 번만** 붙는다(MainLayout).
//   설계: docs/ATTENDANCE_CHECKIN_PROMPT_DESIGN.md §3.3 · §4.1
//
// 출퇴근 위젯은 사이드바·모바일 카드·근태 페이지에 여러 벌 그려지므로 여기에 두면 창이 겹친다 — 그래서 따로 한 곳.
// 묻는 조건은 서버(GET /today 의 prompt·close_check)가 정한다. 화면은 값이 있을 때만 그리고, 답은 서버에 남는다
//   (폰에서 답하면 컴퓨터에서 또 묻지 않는다 — 다른 기기는 attendance:fix_updated 로 다시 읽어 창을 닫는다).
// 답을 안 해도 아무것도 막지 않는다 — 닫기(×·바깥)는 «아직이에요» 와 같다.
import React, { useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { attendanceTrackedHere } from '../../utils/workspaceModules';
import { isPopoutWindow } from '../../utils/popout';
import { useAttendance } from '../../hooks/useAttendance';
import StandardModal from '../Common/StandardModal';
import ActionButton from '../Common/ActionButton';

function hhmm(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
/** 기준 날짜(그 ISO 의 로컬 날짜) + HH:MM → ISO */
function atOnDayOf(baseIso: string, value: string): string | null {
  const [h, m] = value.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  const d = new Date(baseIso);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}
/** YYYY-MM-DD → M/D */
function md(ymd: string): string {
  const [, m, d] = ymd.split('-').map(Number);
  return `${m}/${d}`;
}

const AttendancePromptHost: React.FC = () => {
  const { t } = useTranslation('attendance');
  const { user } = useAuth();
  const staff = !!user && user.business_role !== 'client';
  const bizId = (staff && attendanceTrackedHere(user) && !isPopoutWindow()) ? Number(user!.business_id) : null;   // «출퇴근 안 함» 이면 묻지 않는다
  const a = useAttendance(bizId);

  const [inEdit, setInEdit] = useState<string | null>(null);     // 출근 시각 고치기 칸(HH:MM)
  const [outEdit, setOutEdit] = useState<string | null>(null);   // 어제 퇴근 고치기 칸
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentPending, setSentPending] = useState(false);

  // 열어 둔 채로 묻는 시간이 되는 탭 — 묻는 시간대(근무 시작 2시간 전~끝) 밖에서 연 탭은 첫 읽기에서 prompt 가 없고,
  //   그 뒤 다시 읽을 계기(탭 복귀·소켓)가 없으면 시간대에 들어와도 영영 안 물었다. 보이는 동안 5분마다 한 번 다시 읽는다
  //   (출근 기록이 있으면 안 읽는다 — 오늘은 더 물을 것이 없다).
  const { reload, state: dayState } = a;
  useEffect(() => {
    if (!bizId || dayState) return undefined;
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void reload();
    }, 5 * 60 * 1000);
    return () => window.clearInterval(id);
  }, [bizId, dayState, reload]);

  if (!bizId || a.loading) return null;
  const prompt = a.prompt;
  const close = a.closeCheck;
  const open = !!(prompt || close);
  if (!open) return null;

  const proposed = prompt?.proposed_at || null;
  // 처음 들어온 지 5분 안이면 «지금» 으로 묻는다
  const justNow = !!proposed && Date.now() - new Date(proposed).getTime() < 5 * 60 * 1000;

  const run = async (fn: () => Promise<{ error?: string; ok?: boolean; pending?: boolean } | null | void>) => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const r = await fn();
      if (r && 'error' in r && r.error) setError(t(`prompt.err.${r.error}`, { defaultValue: t('prompt.err.generic') as string }) as string);
      else if (r && 'pending' in r && r.pending) setSentPending(true);
    } finally { setBusy(false); }
  };

  const later = () => { void a.answerPrompt('later'); };
  const notToday = () => { void a.answerPrompt('not_today'); };

  return (
    <StandardModal
      open={open}
      onClose={later}
      title={(prompt ? t('prompt.title') : t('prompt.closeTitle')) as string}
      size="sm"
      footer={(
        <Footer>
          {prompt && <TextBtn type="button" onClick={notToday} disabled={busy} data-testid="attn-prompt-not-today">{t('prompt.notToday')}</TextBtn>}
          <span style={{ flex: 1 }} />
          <ActionButton tone="secondary" size="sm" onClick={later} disabled={busy} data-testid="attn-prompt-later">{t('prompt.later')}</ActionButton>
        </Footer>
      )}
    >
      {close && (
        <Section data-testid="attn-close-check">
          <Line>{t('prompt.closeLine', { date: md(close.work_date), time: hhmm(close.clock_out_at) })}</Line>
          {outEdit === null ? (
            <Row>
              <ActionButton tone="secondary" size="sm" disabled={busy} onClick={() => setOutEdit(hhmm(close.clock_out_at))} data-testid="attn-close-edit">
                {t('prompt.editTime')}
              </ActionButton>
              <ActionButton tone="primary" size="sm" loading={busy} onClick={() => run(() => a.answerClose(close.day_id))} data-testid="attn-close-ok">
                {t('prompt.closeOk')}
              </ActionButton>
            </Row>
          ) : (
            <Row>
              <TimeInput type="time" value={outEdit} onChange={(e) => setOutEdit(e.target.value)} aria-label={t('my.out') as string} />
              <ActionButton tone="primary" size="sm" loading={busy} disabled={!outEdit}
                onClick={() => run(async () => {
                  const at = close.clock_out_at ? atOnDayOf(close.clock_out_at, outEdit || '') : null;
                  return at ? a.answerClose(close.day_id, at) : null;
                })}
                data-testid="attn-close-save">
                {t('prompt.save')}
              </ActionButton>
            </Row>
          )}
        </Section>
      )}
      {prompt && (
        <Section>
          <Line>
            {justNow
              ? t('prompt.bodyNow', { time: hhmm(proposed) })
              : t('prompt.body', { time: hhmm(proposed) })}
          </Line>
          {/* 답 버튼은 윗칸(퇴근 확인)과 같은 줄 모양 — 바닥 줄에는 «오늘은 안 해요»·«아직이에요» 만 */}
          {inEdit === null ? (
            <Row>
              <ActionButton tone="secondary" size="sm" onClick={() => setInEdit(hhmm(proposed) || hhmm(new Date().toISOString()))} disabled={busy} data-testid="attn-prompt-edit">
                {t('prompt.editTime')}
              </ActionButton>
              <ActionButton tone="primary" size="sm" loading={busy} onClick={() => run(() => a.clockInObserved())} data-testid="attn-prompt-ok">
                {justNow ? t('prompt.okNow') : t('prompt.okFrom', { time: hhmm(proposed) })}
              </ActionButton>
            </Row>
          ) : (
            <Row>
              <Label htmlFor="attn-prompt-time">{t('prompt.startAt')}</Label>
              <TimeInput id="attn-prompt-time" type="time" value={inEdit} onChange={(e) => setInEdit(e.target.value)} data-testid="attn-prompt-time" />
              <ActionButton tone="primary" size="sm" loading={busy} disabled={!inEdit}
                onClick={() => run(async () => {
                  const at = atOnDayOf(new Date().toISOString(), inEdit || '');
                  return at ? a.clockInAt(at) : null;
                })}
                data-testid="attn-prompt-save">
                {t('prompt.saveFrom', { time: inEdit })}
              </ActionButton>
            </Row>
          )}
          {inEdit !== null && <Hint>{a.fixApproval ? t('prompt.hintApproval') : t('prompt.hintEdit')}</Hint>}
        </Section>
      )}
      {sentPending && <Hint>{t('prompt.sentPending')}</Hint>}
      {error && <Err role="alert">{error}</Err>}
    </StandardModal>
  );
};

export default AttendancePromptHost;

const Section = styled.div`
  display: flex; flex-direction: column; gap: 10px;
  & + & { margin-top: 16px; padding-top: 16px; border-top: 1px solid #E2E8F0; }
`;
const Line = styled.div`font-size: 0.875rem; color: #0F172A; line-height: 1.6;`;
const Row = styled.div`
  display: flex; gap: 8px; align-items: center; flex-wrap: wrap;
  @media (max-width: 480px) { button, input { min-height: 48px; } }
`;
const Label = styled.label`font-size: 0.75rem; font-weight: 600; color: #475569;`;
const TimeInput = styled.input`
  border: 1px solid #E2E8F0; border-radius: 8px; padding: 8px 10px; min-height: 40px;
  font-size: 0.875rem; font-family: inherit; color: #0F172A; background: #FFFFFF;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.1); }
`;
const Hint = styled.div`font-size: 0.75rem; color: #64748B; line-height: 1.5;`;
const Err = styled.div`font-size: 0.75rem; color: #DC2626; margin-top: 8px;`;
const Footer = styled.div`
  display: flex; gap: 8px; align-items: center; flex-wrap: wrap; width: 100%;
  @media (max-width: 480px) { button { min-height: 48px; } }
`;
const TextBtn = styled.button`
  background: none; border: none; padding: 6px 2px; cursor: pointer;
  font-size: 0.8125rem; color: #64748B; text-decoration: underline;
  &:hover:not(:disabled) { color: #334155; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
