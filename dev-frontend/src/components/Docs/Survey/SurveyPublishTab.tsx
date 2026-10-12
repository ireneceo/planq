// 설문 «발행» 탭 — 공개 링크 · 회차(보낸 기록) · 보내기. 설계 docs/SURVEY_V2_DESIGN.md §8.2
//   옛 «설문으로 받기» 서랍(SurveyDrawer)의 공개 링크 부분을 여기로 옮겼다(그 서랍은 지웠다).
// ★ 개인 링크는 보여 주지 않는다 — 담당자가 쥐면 «고객인 척 응답» 이 된다. 할 수 있는 것은 [다시 보내기]·[회수]뿐(§5.2).
// ★ 다시 보내기도 외부 발송이다 — 확인창에 받는 주소를 적는다.
// ★ 자동 규칙은 Phase 2(별도 작업) — 여기에 빈 칸을 미리 그리지 않는다.
import { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import ActionButton from '../../Common/ActionButton';
import ConfirmDialog from '../../Common/ConfirmDialog';
import { fetchSurvey, saveSurvey, fetchSurveyIssues, resendSurveyIssue, revokeSurveyRecipient, type SurveyView, type SurveyIssueView, type SurveyQuota, type SurveyRecipientView } from '../../../services/qtable';
import { onSocket } from '../../../services/socket';
import { formatDay, formatDayTime } from '../../../utils/dateFormat';

interface Props {
  recordId: number;
  onSend: () => void;
  onPreview: () => void;
  reloadKey?: number;
}

const SurveyPublishTab: React.FC<Props> = ({ recordId, onSend, onPreview, reloadKey }) => {
  const { t } = useTranslation('qdocs');
  const [view, setView] = useState<SurveyView | null>(null);
  const [issues, setIssues] = useState<SurveyIssueView[] | null>(null);
  const [quota, setQuota] = useState<SurveyQuota | null>(null);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const [resendAsk, setResendAsk] = useState<{ issue: SurveyIssueView; list: SurveyRecipientView[] } | null>(null);
  const [revokeAsk, setRevokeAsk] = useState<{ issue: SurveyIssueView; r: SurveyRecipientView } | null>(null);
  const [denied, setDenied] = useState(false);

  const load = useCallback(async () => {
    try {
      const v = await fetchSurvey(recordId);
      if (!v) { setDenied(true); return; }
      setView(v);
      const r = await fetchSurveyIssues(recordId);
      setIssues(r.issues); setQuota(r.quota);
    } catch { setErr(t('survey.loadFailed', '발행 정보를 불러오지 못했어요.') as string); }
  }, [recordId, t]);
  useEffect(() => { load(); }, [load, reloadKey]);
  useEffect(() => onSocket<{ id: number }>('record:row', (p) => { if (p?.id === recordId) load(); }), [recordId, load]);

  const setEnabled = async (on: boolean) => {
    if (busy) return;
    setBusy(true); setErr(null);
    try { const v = await saveSurvey(recordId, { enabled: on }); setView((prev) => (prev ? { ...prev, ...v } : v)); }
    catch (e) {
      setErr((e as Error).message === 'security_level_blocks'
        ? t('survey.err.security', '보안등급이 «일반» 이 아닌 문서는 밖으로 보낼 수 없어요.') as string
        : t('survey.err.generic', '저장하지 못했어요. 잠시 후 다시 시도해 주세요.') as string);
    } finally { setBusy(false); }
  };
  const url = view?.path ? `${window.location.origin}${view.path}` : '';
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* 링크 글자를 직접 고를 수 있다 */ }
  };

  const replaceIssue = (iss: SurveyIssueView) => setIssues((prev) => (prev || []).map((x) => (x.id === iss.id ? iss : x)));
  const doResend = async () => {
    const ask = resendAsk; setResendAsk(null);
    if (!ask) return;
    setBusy(true); setErr(null);
    try { const r = await resendSurveyIssue(recordId, ask.issue.id, ask.list.map((x) => x.id)); replaceIssue(r.issue); }
    catch { setErr(t('survey.err.generic', '보내지 못했어요. 잠시 후 다시 시도해 주세요.') as string); }
    finally { setBusy(false); }
  };
  const doRevoke = async () => {
    const ask = revokeAsk; setRevokeAsk(null);
    if (!ask) return;
    try { const r = await revokeSurveyRecipient(recordId, ask.r.id); replaceIssue(r.issue); }
    catch { setErr(t('survey.err.generic', '저장하지 못했어요. 잠시 후 다시 시도해 주세요.') as string); }
  };

  if (denied) return <Empty>{t('survey.publishDenied', '이 설문을 보내거나 링크를 관리할 권한이 없어요.')}</Empty>;
  if (!view) return <Empty>{err || t('loading', '불러오는 중...')}</Empty>;

  const statusLabel = (r: SurveyRecipientView) => {
    if (r.revoked) return t('survey.rstatus.revoked', '회수됨');
    if (r.status === 'responded') return t('survey.rstatus.responded', '응답함');
    if (r.status === 'failed') return t('survey.rstatus.failed', '보내기 실패');
    if (r.opened_at) return t('survey.rstatus.opened', '열어 봄');
    if (r.status === 'sent') return t('survey.rstatus.sent', '보냄');
    return t('survey.rstatus.queued', '보내는 중');
  };
  const missingOf = (iss: SurveyIssueView) => iss.recipients.filter((r) => !r.revoked && (r.status === 'sent' || r.status === 'failed'));
  const closed = (iss: SurveyIssueView) => !!iss.closes_at && new Date(iss.closes_at).getTime() <= Date.now();

  return (
    <Wrap data-testid="survey-publish">
      {err && <Err role="alert">{err}</Err>}
      {view.blocked && <Warn>{t('survey.err.security', '보안등급이 «일반» 이 아닌 문서는 밖으로 보낼 수 없어요.')}</Warn>}

      <Section>
        <SecHead><SecTitle>{t('survey.publicLink', '공개 링크')}</SecTitle></SecHead>
        <Hint>{t('survey.publicLinkHint', '누구나 로그인 없이, 여러 번 응답할 수 있어요. 누가 답했는지는 남지 않아요.')}</Hint>
        {view.enabled ? (
          <>
            <LinkBox data-testid="survey-link">{url}</LinkBox>
            <Row>
              {/* autosave-exempt: 링크 복사·열기·닫기는 행위 버튼이다 */}
              <ActionButton tone="primary" size="sm" onClick={copy} data-testid="survey-copy">{copied ? t('survey.copied', '복사됨') : t('survey.copy', '링크 복사')}</ActionButton>
              <ActionButton tone="secondary" size="sm" onClick={() => window.open(url, '_blank', 'noopener')}>{t('survey.openLink', '응답 화면 열기')}</ActionButton>
              <ActionButton tone="danger" size="sm" onClick={() => setConfirmOff(true)} disabled={busy}>{t('survey.closeLink', '링크 닫기')}</ActionButton>
            </Row>
          </>
        ) : (
          <Row>
            <ActionButton tone="secondary" size="sm" onClick={() => setEnabled(true)} loading={busy} disabled={!!view.blocked} data-testid="survey-open-link">{t('survey.openPublicLink', '공개 링크 만들기')}</ActionButton>
            <ActionButton tone="secondary" size="sm" onClick={onPreview}>{t('survey.preview', '응답 화면 미리보기')}</ActionButton>
          </Row>
        )}
      </Section>

      <Section>
        <SecHead>
          <SecTitle>{t('survey.rounds', '회차')}</SecTitle>
          <ActionButton tone="primary" size="sm" onClick={onSend} disabled={!!view.blocked} data-testid="survey-send-open">{t('survey.send', '보내기')}</ActionButton>
        </SecHead>
        <Hint>{t('survey.roundsHint', '고객에게 메일로 보내면 받는 사람마다 한 번만 응답할 수 있는 링크가 가요. 누가 열고 답했는지 여기서 봐요.')}</Hint>
        {quota && quota.remaining != null && <Hint>{t('survey.quotaLeft', { defaultValue: '이달 남은 발송 {{left}}건 (한도 {{limit}}건)', left: quota.remaining, limit: quota.limit }) as string}</Hint>}
        {issues && issues.length === 0 && <Empty data-testid="survey-no-rounds">{t('survey.noRounds', '아직 보낸 회차가 없어요.')}</Empty>}
        {(issues || []).map((iss) => {
          const isOpen = open.has(iss.id);
          const miss = missingOf(iss);
          return (
            <Round key={iss.id} data-testid={`survey-round-${iss.id}`}>
              <RoundHead type="button" aria-expanded={isOpen} onClick={() => setOpen((p) => { const n = new Set(p); if (n.has(iss.id)) n.delete(iss.id); else n.add(iss.id); return n; })}>
                <RoundMain>
                  <b>{formatDay(new Date(iss.sent_at || iss.created_at))}</b>
                  <span>{iss.origin === 'rule' ? t('survey.round.rule', '자동 규칙') : t('survey.round.manual', '수동')} · {t('survey.peopleN', { defaultValue: '{{n}}명', n: iss.counts.total }) as string}</span>
                </RoundMain>
                <RoundStats>
                  <span>{t('survey.round.sent', { defaultValue: '보냄 {{n}}', n: iss.counts.sent }) as string}</span>
                  <span>{t('survey.round.opened', { defaultValue: '열람 {{n}}', n: iss.counts.opened }) as string}</span>
                  <strong>{t('survey.round.rate', { defaultValue: '응답 {{n}} ({{pct}}%)', n: iss.counts.responded, pct: iss.rate ?? 0 }) as string}</strong>
                  {iss.counts.failed > 0 && <FailTag>{t('survey.round.failed', { defaultValue: '실패 {{n}}', n: iss.counts.failed }) as string}</FailTag>}
                  {iss.closes_at && <span>{closed(iss) ? t('survey.round.closed', '마감됨') : t('survey.round.closes', { defaultValue: '마감 {{d}}', d: formatDay(new Date(iss.closes_at)) })}</span>}
                </RoundStats>
              </RoundHead>
              {isOpen && (
                <RoundBody>
                  {miss.length > 0 && !closed(iss) && (
                    <ActionButton tone="secondary" size="sm" onClick={() => setResendAsk({ issue: iss, list: miss })} disabled={busy} data-testid={`survey-resend-missing-${iss.id}`}>
                      {t('survey.resendMissing', { defaultValue: '다시 보내기 (미응답 {{n}})', n: miss.length }) as string}
                    </ActionButton>
                  )}
                  <RList>
                    {iss.recipients.map((r) => (
                      <RRow key={r.id}>
                        <RWho><b>{r.display_name || r.email}</b>{r.display_name && <small>{r.email}</small>}</RWho>
                        <RState $tone={r.status === 'responded' ? 'good' : r.status === 'failed' ? 'bad' : r.revoked ? 'mute' : undefined}>{statusLabel(r)}</RState>
                        <RTime>{r.responded_at ? formatDayTime(new Date(r.responded_at)) : r.opened_at ? formatDayTime(new Date(r.opened_at)) : r.sent_at ? formatDayTime(new Date(r.sent_at)) : ''}</RTime>
                        <RActs>
                          {!r.revoked && (r.status === 'sent' || r.status === 'failed') && !closed(iss) && (
                            <LinkBtn type="button" onClick={() => setResendAsk({ issue: iss, list: [r] })}>{t('survey.resend', '다시 보내기')}</LinkBtn>
                          )}
                          {!r.revoked && r.status !== 'responded' && (
                            <LinkBtn type="button" $danger onClick={() => setRevokeAsk({ issue: iss, r })}>{t('survey.revoke', '회수')}</LinkBtn>
                          )}
                        </RActs>
                      </RRow>
                    ))}
                  </RList>
                </RoundBody>
              )}
            </Round>
          );
        })}
      </Section>

      <ConfirmDialog
        isOpen={confirmOff}
        onClose={() => setConfirmOff(false)}
        onConfirm={() => { setConfirmOff(false); setEnabled(false); }}
        title={t('survey.closeLinkTitle', '공개 링크를 닫을까요?') as string}
        message={t('survey.closeLinkMsg', '지금 링크로는 더 이상 응답을 받지 않아요. 다시 만들면 새 링크가 생겨요. 메일로 보낸 개인 링크와 받은 응답은 그대로예요.') as string}
        confirmText={t('survey.closeLink', '링크 닫기') as string}
        cancelText={t('survey.cancel', '취소') as string}
        variant="danger"
      />
      <ConfirmDialog
        isOpen={!!resendAsk}
        onClose={() => setResendAsk(null)}
        onConfirm={doResend}
        title={t('survey.resendTitle', '다음 주소로 다시 보낼까요?') as string}
        message={resendAsk ? resendAsk.list.map((r) => (r.display_name ? `${r.display_name} · ${r.email}` : r.email)).join('\n') : ''}
        confirmText={t('survey.resendN', { defaultValue: '다시 보내기 · {{n}}명', n: resendAsk?.list.length || 0 }) as string}
        cancelText={t('survey.cancel', '취소') as string}
        variant="info"
      />
      <ConfirmDialog
        isOpen={!!revokeAsk}
        onClose={() => setRevokeAsk(null)}
        onConfirm={doRevoke}
        title={t('survey.revokeTitle', '이 사람의 링크를 회수할까요?') as string}
        message={revokeAsk ? t('survey.revokeMsg', { defaultValue: '{{who}} 에게 보낸 링크로는 더 이상 응답할 수 없어요.', who: revokeAsk.r.display_name || revokeAsk.r.email }) as string : ''}
        confirmText={t('survey.revoke', '회수') as string}
        cancelText={t('survey.cancel', '취소') as string}
        variant="danger"
      />
    </Wrap>
  );
};

export default SurveyPublishTab;

const Wrap = styled.div`display: flex; flex-direction: column; gap: 16px; max-width: 880px;`;
const Section = styled.section`display: flex; flex-direction: column; gap: 8px; border: 1px solid #E2E8F0; border-radius: 12px; background: #FFF; padding: 14px;`;
const SecHead = styled.div`display: flex; align-items: center; justify-content: space-between; gap: 8px;`;
const SecTitle = styled.div`font-size: 0.9375rem; font-weight: 700; color: #0F172A;`;
const Hint = styled.div`font-size: 0.75rem; color: #64748B; line-height: 1.5;`;
const Row = styled.div`display: flex; align-items: center; gap: 8px; flex-wrap: wrap;`;
const LinkBox = styled.div`
  font-size: 0.8125rem; color: #0F172A; background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px;
  padding: 8px 10px; word-break: break-all; user-select: all;
`;
const Round = styled.div`border: 1px solid #F1F5F9; border-radius: 10px; overflow: hidden;`;
const RoundHead = styled.button`
  width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 8px 16px; flex-wrap: wrap;
  padding: 10px 12px; background: #F8FAFC; border: 0; cursor: pointer; text-align: left; min-height: 44px;
  &:hover { background: #F1F5F9; }
`;
const RoundMain = styled.div`display: flex; gap: 10px; align-items: baseline; font-size: 0.8125rem; color: #334155; b { color: #0F172A; }`;
const RoundStats = styled.div`display: flex; gap: 10px; flex-wrap: wrap; font-size: 0.75rem; color: #64748B; strong { color: #0F766E; }`;
const FailTag = styled.span`color: #B91C1C; font-weight: 700;`;
const RoundBody = styled.div`padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; align-items: flex-start;`;
const RList = styled.div`width: 100%; display: flex; flex-direction: column;`;
const RRow = styled.div`
  display: grid; grid-template-columns: minmax(0, 2fr) auto minmax(0, 1fr) auto; gap: 8px; align-items: center;
  min-height: 40px; border-bottom: 1px solid #F1F5F9; font-size: 0.8125rem;
  &:last-child { border-bottom: 0; }
  @media (max-width: 640px) { grid-template-columns: minmax(0, 1fr) auto; padding: 6px 0; }
`;
const RWho = styled.div`min-width: 0; display: flex; flex-direction: column; b { color: #0F172A; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } small { color: #94A3B8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }`;
const RState = styled.span<{ $tone?: 'good' | 'bad' | 'mute' }>`
  font-size: 0.75rem; font-weight: 700; white-space: nowrap;
  color: ${(p) => (p.$tone === 'good' ? '#0F766E' : p.$tone === 'bad' ? '#B91C1C' : p.$tone === 'mute' ? '#94A3B8' : '#475569')};
`;
const RTime = styled.span`font-size: 0.75rem; color: #94A3B8; white-space: nowrap; @media (max-width: 640px) { grid-column: 1; }`;
const RActs = styled.div`display: flex; gap: 4px; justify-content: flex-end;`;
const LinkBtn = styled.button<{ $danger?: boolean }>`
  height: 32px; padding: 0 8px; border: 0; background: transparent; cursor: pointer; border-radius: 6px;
  font-size: 0.75rem; font-weight: 600; color: ${(p) => (p.$danger ? '#B91C1C' : '#0F766E')};
  &:hover { background: ${(p) => (p.$danger ? '#FEF2F2' : '#F0FDFA')}; }
  @media (max-width: 640px) { height: 40px; }
`;
const Empty = styled.div`padding: 20px 12px; text-align: center; font-size: 0.8125rem; color: #94A3B8;`;
const Warn = styled.div`font-size: 0.8125rem; color: #B45309; background: #FFFBEB; border-radius: 8px; padding: 8px 10px;`;
const Err = styled.div`font-size: 0.8125rem; color: #B91C1C; background: #FEF2F2; border-radius: 8px; padding: 8px 10px;`;
