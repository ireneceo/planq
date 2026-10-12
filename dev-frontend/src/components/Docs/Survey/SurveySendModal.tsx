// 설문 보내기 모달 — 받는 사람 고르기 → (같은 창 2단계) 보낼 주소 전부 확인 → 보내기. 설계 docs/SURVEY_V2_DESIGN.md §5.1
//
// ★ 외부 발송은 확인을 받는다 — 확인 단계에 **보낼 주소 전부**를 적는다(«정말?» 만 묻지 않는다, CLAUDE.md).
//   팝업 위 팝업을 띄우지 않고 같은 모달 안에서 단계를 바꾼다.
// ★ 이메일 없는 고객은 고를 수 없게 회색 + «이메일 없음 — 보낼 수 없어요» (눌리게 두고 서버가 400 을 내면 «아무 일도 안 일어남» 이 된다).
// ★ 이달 남은 발송 수를 보내기 전에 보여 준다(요금제 월 한도 — 받는 사람 1명 = 1건).
import { useEffect, useMemo, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import StandardModal from '../../Common/StandardModal';
import ActionButton from '../../Common/ActionButton';
import PlanQSelect, { type PlanQSelectOption } from '../../Common/PlanQSelect';
import SingleDateField from '../../Common/SingleDateField';
import { fetchSurveyCandidates, sendSurveyIssue, type SurveyCandidate, type SurveyIssueView, type SurveyQuota } from '../../../services/qtable';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

interface Props {
  open: boolean;
  onClose: () => void;
  recordId: number;
  surveyTitle: string;
  workspaceName?: string;
  onSent: (issue: SurveyIssueView) => void;
}

const SurveySendModal: React.FC<Props> = ({ open, onClose, recordId, surveyTitle, onSent }) => {
  const { t } = useTranslation('qdocs');
  const [clients, setClients] = useState<SurveyCandidate[]>([]);
  const [projects, setProjects] = useState<{ id: number; name: string }[]>([]);
  const [quota, setQuota] = useState<SurveyQuota | null>(null);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [emails, setEmails] = useState<string[]>([]);
  const [emailDraft, setEmailDraft] = useState('');
  const [q, setQ] = useState('');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [closesDay, setClosesDay] = useState('');
  const [step, setStep] = useState<'pick' | 'confirm'>('pick');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loadErr, setLoadErr] = useState(false);

  // 열 때마다 처음 상태로
  useEffect(() => {
    if (!open) return;
    setPicked(new Set()); setEmails([]); setEmailDraft(''); setQ(''); setProjectId(null);
    setTitle(''); setMessage(''); setStep('pick'); setErr(null);
    setClosesDay(isoDay(new Date(Date.now() + 14 * 86400000)));
  }, [open]);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    fetchSurveyCandidates(recordId, projectId).then((r) => {
      if (!alive) return;
      setClients(r.clients); setProjects(r.projects); setQuota(r.quota); setLoadErr(false);
      // 프로젝트를 고르면 그 프로젝트 고객(이메일 있는 사람)을 채운다
      if (projectId) setPicked(new Set(r.clients.filter((c) => c.email).map((c) => c.id)));
    }).catch(() => { if (alive) setLoadErr(true); });
    return () => { alive = false; };
  }, [open, recordId, projectId]);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? clients.filter((c) => `${c.name} ${c.company || ''} ${c.email || ''}`.toLowerCase().includes(s)) : clients;
  }, [clients, q]);

  // 받는 주소 — 고른 고객 + 직접 적은 주소(겹치면 하나)
  const recipients = useMemo(() => {
    const out: { key: string; name: string | null; email: string }[] = []; const seen = new Set<string>();
    for (const c of clients) if (picked.has(c.id) && c.email && !seen.has(c.email.toLowerCase())) { seen.add(c.email.toLowerCase()); out.push({ key: `c${c.id}`, name: c.name, email: c.email }); }
    for (const e of emails) if (!seen.has(e.toLowerCase())) { seen.add(e.toLowerCase()); out.push({ key: `e${e}`, name: null, email: e }); }
    return out;
  }, [clients, picked, emails]);
  const n = recipients.length;
  const overQuota = quota?.remaining != null && n > quota.remaining;

  const addEmail = () => {
    const parts = emailDraft.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
    const bad = parts.filter((x) => !EMAIL_RE.test(x));
    if (bad.length) { setErr(t('survey.invalidEmail', { defaultValue: '이메일 형식이 아니에요: {{v}}', v: bad[0] }) as string); return; }
    setEmails((prev) => [...prev, ...parts.filter((x) => !prev.includes(x))]); setEmailDraft(''); setErr(null);
  };
  const toggle = (c: SurveyCandidate) => {
    if (!c.email) return;
    setPicked((prev) => { const nx = new Set(prev); if (nx.has(c.id)) nx.delete(c.id); else nx.add(c.id); return nx; });
  };

  const errText = (code: string, data?: { limit?: number | null; current?: number | null }) => {
    switch (code) {
      case 'quota_exceeded': return t('survey.quotaExceeded', { defaultValue: '이달 설문 발송 한도({{limit}}건)를 넘어요. 이번 달 {{current}}건을 보냈어요.', limit: data?.limit ?? '-', current: data?.current ?? '-' }) as string;
      case 'client_no_email': return t('survey.err.client_no_email', '이메일이 없는 고객이 섞여 있어요.') as string;
      case 'security_level_blocks': return t('survey.err.security', '보안등급이 «일반» 이 아닌 문서는 밖으로 보낼 수 없어요.') as string;
      case 'not_published': return t('survey.err.not_published', '임시저장 상태의 설문은 보낼 수 없어요. 먼저 저장하세요.') as string;
      case 'too_many_recipients': return t('survey.err.too_many', '한 번에 500명까지 보낼 수 있어요.') as string;
      default: return t('survey.err.generic', '보내지 못했어요. 잠시 후 다시 시도해 주세요.') as string;
    }
  };

  const doSend = async () => {
    if (busy || !n) return;
    setBusy(true); setErr(null);
    try {
      const r = await sendSurveyIssue(recordId, {
        client_ids: [...picked].filter((id) => clients.find((c) => c.id === id)?.email),
        emails,
        title: title.trim() || undefined,
        message: message.trim() || undefined,
        closes_at: closesDay ? new Date(`${closesDay}T23:59:59`).toISOString() : null,
      });
      onSent(r.issue);
      onClose();
    } catch (e) {
      const ex = e as Error & { data?: { message?: string; limit?: number; current?: number } };
      setErr(errText(ex.data?.message || ex.message, ex.data));
      setStep('pick');
    } finally { setBusy(false); }
  };

  const projOpts: PlanQSelectOption[] = projects.map((p) => ({ value: String(p.id), label: p.name }));
  const footer = step === 'pick' ? (
    <>
      <ActionButton tone="secondary" size="md" onClick={onClose}>{t('survey.cancel', '취소')}</ActionButton>
      <ActionButton tone="primary" size="md" disabled={!n || overQuota} onClick={() => setStep('confirm')} data-testid="survey-send-next">
        {t('survey.sendN', { defaultValue: '보내기 · {{n}}명', n }) as string}
      </ActionButton>
    </>
  ) : (
    <>
      <ActionButton tone="secondary" size="md" onClick={() => setStep('pick')} disabled={busy}>{t('survey.back', '뒤로')}</ActionButton>
      <ActionButton tone="primary" size="md" loading={busy} onClick={doSend} data-testid="survey-send-confirm">
        {t('survey.sendN', { defaultValue: '보내기 · {{n}}명', n }) as string}
      </ActionButton>
    </>
  );

  return (
    <StandardModal open={open} onClose={onClose} size="md" title={step === 'pick' ? (t('survey.sendTitle', '설문 보내기') as string) : (t('survey.sendConfirmTitle', '다음 주소로 설문을 보낼까요?') as string)} footer={footer}>
      {step === 'confirm' ? (
        <div data-testid="survey-send-confirm-step">
          <Lead>{t('survey.sendConfirmMsg', '받는 사람은 로그인 없이 이 설문에 한 번 응답할 수 있어요. 링크는 받는 사람마다 따로 만들어져요.')}</Lead>
          <AddrList data-testid="survey-send-addresses">
            {recipients.map((r) => <li key={r.key}>{r.name ? <><b>{r.name}</b> · </> : null}{r.email}</li>)}
          </AddrList>
          <Meta>{t('survey.confirmSubject', { defaultValue: '메일 제목: {{v}}', v: title.trim() || surveyTitle }) as string}</Meta>
          {closesDay && <Meta>{t('survey.confirmCloses', { defaultValue: '응답 마감: {{v}}', v: closesDay }) as string}</Meta>}
        </div>
      ) : (
        <>
          {loadErr && <Err role="alert">{t('survey.candidatesFailed', '고객 목록을 불러오지 못했어요.')}</Err>}
          {err && <Err role="alert">{err}</Err>}
          {quota && quota.remaining != null && (
            <QuotaLine $over={!!overQuota} data-testid="survey-quota">{t('survey.quotaLeft', { defaultValue: '이달 남은 발송 {{left}}건 (한도 {{limit}}건)', left: quota.remaining, limit: quota.limit }) as string}</QuotaLine>
          )}
          <Label>{t('survey.recipients', '받는 사람')}</Label>
          <Row>
            <Grow><SearchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('survey.searchClient', '고객 이름·회사·이메일로 찾기') as string} aria-label={t('survey.searchClient', '고객 이름·회사·이메일로 찾기') as string} /></Grow>
            <ProjBox>
              <PlanQSelect size="sm" isClearable isSearchable options={projOpts} placeholder={t('survey.pickProject', '프로젝트 고객으로 채우기') as string}
                value={projOpts.find((o) => o.value === String(projectId)) || null}
                onChange={(o) => setProjectId((o as PlanQSelectOption | null)?.value ? Number((o as PlanQSelectOption).value) : null)} />
            </ProjBox>
          </Row>
          <ClientList data-testid="survey-send-clients">
            {shown.length === 0 && <Empty>{t('survey.noClients', '고객이 없어요. 아래에 이메일을 직접 적을 수 있어요.')}</Empty>}
            {shown.map((c) => (
              <ClientRow key={c.id} $disabled={!c.email}>
                <input type="checkbox" checked={picked.has(c.id)} disabled={!c.email} onChange={() => toggle(c)} aria-label={c.name} />
                <span className="nm">{c.name}{c.company && c.company !== c.name ? <small> · {c.company}</small> : null}</span>
                <span className="em">{c.email || t('survey.noEmail', '이메일 없음 — 보낼 수 없어요')}</span>
              </ClientRow>
            ))}
          </ClientList>
          <Label>{t('survey.addEmail', '이메일 직접 추가')}</Label>
          <Row>
            <Grow><SearchInput value={emailDraft} onChange={(e) => setEmailDraft(e.target.value)} placeholder="name@company.com"
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); addEmail(); } }} aria-label={t('survey.addEmail', '이메일 직접 추가') as string} /></Grow>
            <ActionButton tone="secondary" size="sm" onClick={addEmail} disabled={!emailDraft.trim()}>{t('survey.add', '추가')}</ActionButton>
          </Row>
          {emails.length > 0 && (
            <Chips>{emails.map((e) => <EmailChip key={e}>{e}<button type="button" aria-label={t('survey.remove', '빼기') as string} onClick={() => setEmails((p) => p.filter((x) => x !== e))}>×</button></EmailChip>)}</Chips>
          )}
          <Label>{t('survey.mailSubject', '메일 제목')}</Label>
          {/* autosave-exempt · draft-exempt: 보내기 모달의 일회성 입력 — 저장이 아니라 이번 발송의 값이다 */}
          <SearchInput value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder={surveyTitle} />
          <Label>{t('survey.mailMessage', '짧은 메시지 (선택)')}</Label>
          {/* draft-exempt: 발송 모달 일회성 입력 */}
          <Area rows={3} maxLength={500} value={message} onChange={(e) => setMessage(e.target.value)} placeholder={t('survey.mailMessagePh', '예: 이번 프로젝트는 어떠셨나요? 3분만 들려주세요.') as string} />
          <Label>{t('survey.closesAt', '응답 마감')}</Label>
          <DateBox><SingleDateField value={closesDay} onChange={(d) => setClosesDay(d || '')} /></DateBox>
        </>
      )}
    </StandardModal>
  );
};

export default SurveySendModal;

const Lead = styled.p`margin: 0 0 10px; font-size: 0.875rem; color: #475569; line-height: 1.6;`;
const AddrList = styled.ul`
  margin: 0; padding: 10px 12px 10px 28px; max-height: 260px; overflow: auto; border: 1px solid #E2E8F0; border-radius: 10px; background: #F8FAFC;
  font-size: 0.875rem; color: #0F172A; display: flex; flex-direction: column; gap: 4px; li { word-break: break-all; }
`;
const Meta = styled.div`margin-top: 8px; font-size: 0.8125rem; color: #64748B;`;
const Label = styled.div`font-size: 0.75rem; font-weight: 700; color: #475569;`;
const Row = styled.div`display: flex; gap: 8px; align-items: center; flex-wrap: wrap;`;
const Grow = styled.div`flex: 1 1 220px; min-width: 0;`;
const ProjBox = styled.div`flex: 1 1 200px; min-width: 0;`;
const SearchInput = styled.input`
  width: 100%; height: 36px; padding: 0 10px; border: 1px solid #E2E8F0; border-radius: 8px; font-size: 0.875rem;
  &:focus { outline: none; border-color: #14B8A6; }
  @media (max-width: 640px) { height: 40px; font-size: 1rem; }
`;
const Area = styled.textarea`
  width: 100%; padding: 8px 10px; border: 1px solid #E2E8F0; border-radius: 8px; font-size: 0.875rem; font-family: inherit; resize: vertical;
  &:focus { outline: none; border-color: #14B8A6; }
  @media (max-width: 640px) { font-size: 1rem; }
`;
const ClientList = styled.div`max-height: 240px; overflow: auto; border: 1px solid #E2E8F0; border-radius: 10px;`;
const ClientRow = styled.label<{ $disabled: boolean }>`
  display: grid; grid-template-columns: auto minmax(0, 1fr) minmax(0, 1fr); gap: 8px; align-items: center;
  min-height: 40px; padding: 4px 12px; border-bottom: 1px solid #F1F5F9; cursor: ${(p) => (p.$disabled ? 'not-allowed' : 'pointer')};
  font-size: 0.8125rem; color: ${(p) => (p.$disabled ? '#94A3B8' : '#0F172A')};
  .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; small { font-weight: 400; color: #94A3B8; } }
  .em { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: ${(p) => (p.$disabled ? '#94A3B8' : '#64748B')}; }
  &:last-child { border-bottom: 0; }
  @media (max-width: 640px) { grid-template-columns: auto minmax(0, 1fr); .em { grid-column: 2; } min-height: 48px; }
`;
const Chips = styled.div`display: flex; flex-wrap: wrap; gap: 6px;`;
const EmailChip = styled.span`
  display: inline-flex; align-items: center; gap: 4px; height: 32px; padding: 0 4px 0 10px; border-radius: 999px; background: #F1F5F9; font-size: 0.8125rem; color: #334155;
  button { width: 28px; aspect-ratio: 1; border: 0; background: transparent; cursor: pointer; color: #64748B; border-radius: 50%; }
`;
const DateBox = styled.div`max-width: 220px;`;
const QuotaLine = styled.div<{ $over: boolean }>`font-size: 0.8125rem; color: ${(p) => (p.$over ? '#B91C1C' : '#64748B')};`;
const Empty = styled.div`padding: 16px; text-align: center; font-size: 0.8125rem; color: #94A3B8;`;
const Err = styled.div`font-size: 0.8125rem; color: #B91C1C; background: #FEF2F2; border-radius: 8px; padding: 8px 10px;`;
