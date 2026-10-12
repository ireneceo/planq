// 설문 응답 — /public/survey/:token (로그인 불필요). 설계 docs/SURVEY_DESIGN.md(#460) · docs/SURVEY_V2_DESIGN.md §8.5
//
// 열쇠 두 종류 — 공개 링크(누구나·여러 번)와 개인 열쇠(받는 사람 1명·1회). 서버가 가른다(밖에서는 구별 못 한다).
// ★ 이 화면은 질문지를 읽고 응답을 쓸 뿐이다 — 남의 응답을 보는 길은 없다(서버에도 없다).
// ★ 양식 본체는 components/Docs/Survey/SurveyForm — 관리 화면 미리보기와 같은 것.
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PublicPageShell, { PublicCenter, PublicBtn } from '../../components/Layout/PublicPageShell';
import SurveyForm from '../../components/Docs/Survey/SurveyForm';
import type { SurveyQuestionnaire } from '../../services/qtable';

const PublicSurveyPage = () => {
  const { t } = useTranslation('qtable');
  const { token } = useParams<{ token: string }>();
  const [sv, setSv] = useState<SurveyQuestionnaire | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'notfound' | 'closed' | 'answered' | 'done' | 'error'>('loading');
  const [formKey, setFormKey] = useState(0);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const r = await fetch(`/api/survey/${encodeURIComponent(token || '')}`, { credentials: 'omit' });
      if (r.status === 404) { setState('notfound'); return; }
      if (r.status === 410) {
        const j = await r.json().catch(() => ({}));
        setState(j.message === 'already_responded' ? 'answered' : 'closed'); return;
      }
      const j = await r.json();
      if (!j.success) { setState('error'); return; }
      setSv(j.data); setState('ready');
    } catch { setState('error'); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  const submit = async (answers: Record<string, unknown>, honey: string): Promise<string | null> => {
    try {
      const r = await fetch(`/api/survey/${encodeURIComponent(token || '')}/responses`, {
        method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers, website: honey }),
      });
      if (r.status === 410) {
        const j = await r.json().catch(() => ({}));
        setState(j.message === 'already_responded' ? 'answered' : 'closed'); return null;
      }
      if (r.status === 404) { setState('notfound'); return null; }
      if (r.status === 429) return 'too_many';
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.success) return String(j.message || 'generic');
      setState('done');
      return null;
    } catch {
      return 'network';
    }
  };

  const center = (testId: string, title: string, hint?: string, extra?: React.ReactNode) => (
    <PublicPageShell layout="card" width="sm" center>
      <PublicCenter data-testid={testId}>
        <strong>{title}</strong>
        {hint && <span>{hint}</span>}
        {extra}
      </PublicCenter>
    </PublicPageShell>
  );

  if (state === 'loading') return <PublicPageShell layout="card" width="md" center><PublicCenter>{t('survey.public.loading', '불러오는 중…')}</PublicCenter></PublicPageShell>;
  if (state === 'answered') return center('survey-answered', t('survey.public.alreadyResponded', '이미 응답하셨어요. 감사합니다.'));
  if (state === 'closed') return center('survey-closed', t('survey.public.closed', '응답을 받지 않는 설문이에요'), t('survey.public.closedHint', '마감되었거나 응답 수가 다 찼어요.'));
  if (state === 'done') {
    return center('survey-done', t('survey.public.done', '응답이 전달되었습니다. 감사합니다.'), sv?.thanks || undefined,
      // 개인 링크는 한 번만 — «하나 더 보내기» 를 두지 않는다
      sv && !sv.personal ? (
        <PublicBtn type="button" onClick={() => { setFormKey((k) => k + 1); setState('ready'); }}>
          {t('survey.public.again', '응답 하나 더 보내기')}
        </PublicBtn>
      ) : undefined);
  }
  if (state === 'notfound' || state === 'error' || !sv) {
    return center('survey-notfound', t('survey.public.notFound', '설문을 찾을 수 없어요'), t('survey.public.notFoundHint', '링크가 바뀌었거나 설문이 닫혔을 수 있어요. 보낸 분께 확인해 주세요.'));
  }
  return (
    <PublicPageShell layout="card" width="md" workspace={{ name: sv.workspace_name || null, logo_url: null }}>
      <SurveyForm key={formKey} survey={sv} onSubmit={submit} />
    </PublicPageShell>
  );
};

export default PublicSurveyPage;
