// 설문 응답 — /public/survey/:token (로그인 불필요). 설계 docs/SURVEY_DESIGN.md (#460)
//
// 표 문서의 칸을 위→아래 문항으로 그린다. 제출하면 그 표에 한 줄이 생긴다.
// ★ 이 화면은 질문지를 읽고 응답을 쓸 뿐이다 — 남의 응답을 보는 길은 없다(서버에도 없다).
// ★ 검증 정본은 서버(services/survey.validateAnswers). 화면 검사는 빨리 알려 주기 위한 것뿐이다.
import { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PublicPageShell, { PublicCenter, PublicTitle, PublicBtn } from '../../components/Layout/PublicPageShell';
import SingleDateField from '../../components/Common/SingleDateField';
import PlanQSelect, { type PlanQSelectOption } from '../../components/Common/PlanQSelect';
import { formatPublicDate } from '../../utils/dateFormat';

interface Question {
  id: string; name: string; type: string; options?: string[]; required: boolean; help?: string;
}
interface Survey {
  title: string; intro: string; workspace_name: string; closes_at: string | null; questions: Question[];
}
type Answers = Record<string, unknown>;

const TIMES: PlanQSelectOption[] = (() => {
  const a: PlanQSelectOption[] = [];
  for (let h = 0; h < 24; h += 1) for (const m of ['00', '30']) { const v = `${String(h).padStart(2, '0')}:${m}`; a.push({ value: v, label: v }); }
  return a;
})();

const isEmpty = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

const PublicSurveyPage = () => {
  const { t } = useTranslation('qtable');
  const { token } = useParams<{ token: string }>();
  const [sv, setSv] = useState<Survey | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'notfound' | 'closed' | 'done' | 'error'>('loading');
  const [answers, setAnswers] = useState<Answers>({});
  const [missing, setMissing] = useState<Set<string>>(new Set());
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [honey, setHoney] = useState('');

  const load = useCallback(async () => {
    setState('loading');
    try {
      const r = await fetch(`/api/survey/${encodeURIComponent(token || '')}`, { credentials: 'omit' });
      if (r.status === 404) { setState('notfound'); return; }
      if (r.status === 410) { setState('closed'); return; }
      const j = await r.json();
      if (!j.success) { setState('error'); return; }
      setSv(j.data); setState('ready');
    } catch { setState('error'); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  const set = (id: string, v: unknown) => {
    setAnswers((a) => ({ ...a, [id]: v }));
    setErr(null);   // 고치기 시작하면 지난 안내는 거짓이 된다
    setMissing((m) => { if (!m.has(id)) return m; const n = new Set(m); n.delete(id); return n; });
  };

  const submit = async () => {
    if (!sv || busy) return;
    const miss = new Set(sv.questions.filter((q) => q.required && (q.type === 'checkbox' ? answers[q.id] !== true : isEmpty(answers[q.id]))).map((q) => q.id));
    setMissing(miss);
    if (miss.size) { setErr(t('survey.public.fillRequired', '필수 문항을 채워 주세요.')); return; }
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/survey/${encodeURIComponent(token || '')}/responses`, {
        method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers, website: honey }),
      });
      if (r.status === 410) { setState('closed'); return; }
      if (r.status === 404) { setState('notfound'); return; }
      if (r.status === 429) { setErr(t('survey.public.tooMany', '잠시 후 다시 보내 주세요.')); return; }
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.success) {
        setErr(t(`survey.public.err.${j.message}`, { defaultValue: t('survey.public.errGeneric', '보내지 못했어요. 입력을 확인해 주세요.') as string }) as string);
        return;
      }
      setState('done');
    } catch {
      setErr(t('survey.public.errNetwork', '연결이 불안정해요. 다시 시도해 주세요.'));
    } finally { setBusy(false); }
  };

  if (state === 'loading') return <PublicPageShell layout="card" width="md" center><PublicCenter>{t('survey.public.loading', '불러오는 중…')}</PublicCenter></PublicPageShell>;
  if (state === 'notfound' || state === 'error' || !sv && state !== 'closed' && state !== 'done') {
    return (
      <PublicPageShell layout="card" width="sm" center>
        <PublicCenter data-testid="survey-notfound">
          <strong>{t('survey.public.notFound', '설문을 찾을 수 없어요')}</strong>
          <span>{t('survey.public.notFoundHint', '링크가 바뀌었거나 설문이 닫혔을 수 있어요. 보낸 분께 확인해 주세요.')}</span>
        </PublicCenter>
      </PublicPageShell>
    );
  }
  if (state === 'closed') {
    return (
      <PublicPageShell layout="card" width="sm" center>
        <PublicCenter data-testid="survey-closed">
          <strong>{t('survey.public.closed', '응답을 받지 않는 설문이에요')}</strong>
          <span>{t('survey.public.closedHint', '마감되었거나 응답 수가 다 찼어요.')}</span>
        </PublicCenter>
      </PublicPageShell>
    );
  }
  if (state === 'done') {
    return (
      <PublicPageShell layout="card" width="sm" center>
        <PublicCenter data-testid="survey-done">
          <strong>{t('survey.public.done', '응답이 전달되었습니다. 감사합니다.')}</strong>
          <PublicBtn type="button" onClick={() => { setAnswers({}); setMissing(new Set()); setState('ready'); }}>
            {t('survey.public.again', '응답 하나 더 보내기')}
          </PublicBtn>
        </PublicCenter>
      </PublicPageShell>
    );
  }
  const s = sv as Survey;

  const field = (q: Question) => {
    const v = answers[q.id];
    switch (q.type) {
      case 'longtext':
        // draft-exempt: 무로그인 공개 응답 화면 — 초안 키는 사용자 단위라 쓸 수 없다(누가 쓰는지 모른다)
        return <TextArea rows={4} value={String(v ?? '')} maxLength={5000} onChange={(e) => set(q.id, e.target.value)} aria-label={q.name} />;
      case 'number':
        return <Input inputMode="decimal" value={String(v ?? '')} onChange={(e) => set(q.id, e.target.value)} aria-label={q.name} />;
      case 'date':
        return <SingleDateField value={String(v || '')} onChange={(d) => set(q.id, d || '')} />;
      case 'datetime': {
        const [d, tm] = String(v || '').split('T');
        return (
          <Row>
            <Grow><SingleDateField value={d || ''} onChange={(nd) => set(q.id, nd ? `${nd}T${tm || '09:00'}` : '')} /></Grow>
            <TimeBox><PlanQSelect options={TIMES} value={tm ? { value: tm, label: tm } : null} onChange={(o) => { if (o && d) set(q.id, `${d}T${(o as PlanQSelectOption).value}`); }} /></TimeBox>
          </Row>
        );
      }
      case 'checkbox':
        return (
          <Choice>
            <input type="checkbox" checked={v === true} onChange={(e) => set(q.id, e.target.checked)} />
            <span>{t('survey.public.yes', '예')}</span>
          </Choice>
        );
      case 'select':
        return (
          <Choices role="radiogroup" aria-label={q.name}>
            {(q.options || []).map((o) => (
              <Choice key={o}><input type="radio" name={`q-${q.id}`} checked={v === o} onChange={() => set(q.id, o)} /><span>{o}</span></Choice>
            ))}
          </Choices>
        );
      case 'multi_select': {
        const arr = Array.isArray(v) ? (v as string[]) : [];
        return (
          <Choices aria-label={q.name}>
            {(q.options || []).map((o) => (
              <Choice key={o}>
                <input type="checkbox" checked={arr.includes(o)} onChange={(e) => set(q.id, e.target.checked ? [...arr, o] : arr.filter((x) => x !== o))} />
                <span>{o}</span>
              </Choice>
            ))}
          </Choices>
        );
      }
      case 'email':
        return <Input type="email" inputMode="email" autoComplete="email" value={String(v ?? '')} onChange={(e) => set(q.id, e.target.value)} aria-label={q.name} />;
      case 'phone':
        return <Input type="tel" inputMode="tel" autoComplete="tel" value={String(v ?? '')} onChange={(e) => set(q.id, e.target.value)} aria-label={q.name} />;
      case 'url':
        return <Input type="url" inputMode="url" value={String(v ?? '')} onChange={(e) => set(q.id, e.target.value)} aria-label={q.name} placeholder="https://" />;
      default:
        // draft-exempt: 무로그인 공개 응답 화면 — 초안 키는 사용자 단위라 쓸 수 없다
        return <Input value={String(v ?? '')} maxLength={500} onChange={(e) => set(q.id, e.target.value)} aria-label={q.name} />;
    }
  };

  return (
    <PublicPageShell layout="card" width="md" workspace={{ name: s.workspace_name || null, logo_url: null }}>
      <Card data-testid="survey-form">
        <PublicTitle>{s.title}</PublicTitle>
        {s.intro && <Intro>{s.intro}</Intro>}
        {s.closes_at && <Meta>{t('survey.public.closesAt', { defaultValue: '마감 {{date}}', date: formatPublicDate(s.closes_at) }) as string}</Meta>}
        {s.questions.map((q, i) => (
          <Q key={q.id} $miss={missing.has(q.id)} data-testid={`survey-q-${q.id}`}>
            <QLabel>
              <span>{i + 1}. {q.name}</span>
              {q.required && <Req aria-label={t('survey.public.required', '필수') as string}>*</Req>}
            </QLabel>
            {q.help && <Help>{q.help}</Help>}
            {field(q)}
            {missing.has(q.id) && <MissText>{t('survey.public.requiredMsg', '필수 문항이에요')}</MissText>}
          </Q>
        ))}
        {/* 꿀단지 — 사람에게는 보이지 않는다. 채워지면 서버가 저장하지 않는다 */}
        <Honey aria-hidden="true" tabIndex={-1} autoComplete="off" value={honey} onChange={(e) => setHoney(e.target.value)} name="website" />
        {err && <Err role="alert">{err}</Err>}
        <Submit type="button" $primary onClick={submit} disabled={busy} data-testid="survey-submit">
          {busy ? t('survey.public.sending', '보내는 중…') : t('survey.public.submit', '응답 보내기')}
        </Submit>
        <Notice>{t('survey.public.notice', { defaultValue: '응답은 {{name}}에 전달됩니다.', name: s.workspace_name || 'PlanQ' }) as string}</Notice>
      </Card>
    </PublicPageShell>
  );
};

export default PublicSurveyPage;

// 카드 테두리·배경은 공용 껍데기(layout="card")가 이미 그린다 — 여기서 또 그리면 이중 카드가 된다
const Card = styled.div`display: flex; flex-direction: column; gap: 18px;`;
const Intro = styled.p`margin: -6px 0 0; font-size: 0.9375rem; color: #475569; line-height: 1.65; white-space: pre-wrap;`;
const Meta = styled.div`font-size: 0.8125rem; color: #64748B;`;
const Q = styled.div<{ $miss: boolean }>`
  display: flex; flex-direction: column; gap: 8px;
  padding: 14px; border-radius: 10px; border: 1px solid ${(p) => (p.$miss ? '#FCA5A5' : 'transparent')};
  background: ${(p) => (p.$miss ? '#FEF2F2' : 'transparent')};
  margin: 0 -14px;
`;
const QLabel = styled.label`display: flex; gap: 4px; font-size: 0.9375rem; font-weight: 600; color: #0F172A; line-height: 1.5;`;
const Req = styled.span`color: #DC2626;`;
const Help = styled.div`font-size: 0.8125rem; color: #64748B; margin-top: -4px;`;
const Input = styled.input`
  height: 44px; padding: 0 12px; font-size: 1rem; border: 1px solid #CBD5E1; border-radius: 8px; background: #FFF; width: 100%;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20, 184, 166, 0.15); }
`;
const TextArea = styled.textarea`
  padding: 10px 12px; font-size: 1rem; border: 1px solid #CBD5E1; border-radius: 8px; resize: vertical; width: 100%; font-family: inherit; line-height: 1.6;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20, 184, 166, 0.15); }
`;
const Choices = styled.div`display: flex; flex-direction: column; gap: 6px;`;
const Choice = styled.label`
  display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 0 12px;
  border: 1px solid #E2E8F0; border-radius: 8px; cursor: pointer; font-size: 0.9375rem; color: #1E293B;
  &:has(input:checked) { border-color: #14B8A6; background: #F0FDFA; }
`;
const Row = styled.div`display: flex; gap: 8px; align-items: center;`;
const Grow = styled.div`flex: 1; min-width: 0;`;
const TimeBox = styled.div`width: 120px; flex-shrink: 0;`;
const MissText = styled.div`font-size: 0.8125rem; color: #DC2626;`;
const Err = styled.div`font-size: 0.875rem; color: #B91C1C; background: #FEF2F2; border-radius: 8px; padding: 10px 12px;`;
const Submit = styled(PublicBtn)`justify-content: center; width: 100%; font-size: 1rem;`;
const Notice = styled.div`font-size: 0.75rem; color: #94A3B8; text-align: center;`;
const Honey = styled.input`position: absolute; left: -9999px; width: 1px; height: 1px; opacity: 0;`;
