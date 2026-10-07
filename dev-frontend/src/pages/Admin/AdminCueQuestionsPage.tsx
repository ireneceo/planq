// 플랫폼 관리자 > Cue 질문 분석 (2026-10-07, Fable 판정 B5). 서버: dev-backend/routes/cue_question_admin.js
//   «무엇을 많이 묻는가» — 주제·의도·답변 여부 통계 + 분류 안 된 질문의 가명 원문(워크스페이스가 켠 경우, 30일).
//   ★ 원문은 **텍스트 노드로만** 그린다(저장형 XSS) · 내보내기 없음 · 누가/어느 워크스페이스가 물었는지는 원장에 없다.
//   라벨을 붙이면 그 질문의 주제 통계가 고쳐지고 원문은 지워진다.
import { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import PageShell from '../../components/Layout/PageShell';
import EmptyState from '../../components/Common/EmptyState';
import PlanQSelect, { type PlanQSelectOption } from '../../components/Common/PlanQSelect';
import ActionButton from '../../components/Common/ActionButton';
import { apiFetch } from '../../contexts/AuthContext';
import { useVisibilityRefresh } from '../../hooks/useVisibilityRefresh';

interface Row { key: string; count: number }
interface TopicRow extends Row { answered: number; workspace_days: number }
interface Stats {
  days: number;
  totals: { questions: number; classified: number; answered: number; workspace_days: number; raw_pending: number };
  topics: TopicRow[]; intents: Row[]; modes: Row[]; plans: Row[]; langs: Row[];
  daily: Array<{ date: string; count: number }>;
  topic_options: string[];
}
interface RawRow { id: number; question: string; lang: string | null; created_at: string }

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—');

export default function AdminCueQuestionsPage() {
  const { t } = useTranslation('admin');
  const [days, setDays] = useState(30);
  const [stats, setStats] = useState<Stats | null>(null);
  const [raw, setRaw] = useState<RawRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [pick, setPick] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const [r1, r2] = await Promise.all([
        apiFetch(`/api/admin/cue-questions?days=${days}`),
        apiFetch('/api/admin/cue-questions/raw?limit=200'),
      ]);
      const j1 = await r1.json().catch(() => null);
      const j2 = await r2.json().catch(() => null);
      if (!r1.ok || !j1?.success) { setErr(j1?.message || `HTTP ${r1.status}`); return; }
      setStats(j1.data); setRaw(j2?.success ? j2.data : []); setErr(null);
    } finally { setLoading(false); }
  }, [days]);
  useEffect(() => { setLoading(true); void load(); }, [load]);
  useVisibilityRefresh(() => { void load(); });

  const topicLabel = (k: string) => t(`cueQuestions.topic.${k}`, { defaultValue: k }) as string;
  const keyLabel = (group: string, k: string) => (k ? t(`cueQuestions.${group}.${k}`, { defaultValue: k }) as string : t('cueQuestions.none') as string);
  const dayOptions: PlanQSelectOption[] = [7, 30, 90, 180].map((d) => ({ value: String(d), label: t('cueQuestions.lastDays', { count: d }) as string }));
  const topicOptions: PlanQSelectOption[] = (stats?.topic_options || []).map((k) => ({ value: k, label: topicLabel(k) }));

  // autosave-exempt: 라벨 붙이기·삭제는 누르는 순간 끝나는 액션 버튼이다(입력값을 저장하는 칸이 아니다)
  const act = async (id: number, method: 'PATCH' | 'DELETE') => {
    setBusy(id);
    try {
      const r = await apiFetch(`/api/admin/cue-questions/raw/${id}`, {
        method,
        headers: { 'content-type': 'application/json' },
        ...(method === 'PATCH' ? { body: JSON.stringify({ topic: pick[id] }) } : {}),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.success) { setErr(j?.message || `HTTP ${r.status}`); return; }
      setRaw((prev) => prev.filter((x) => x.id !== id));
      void load();
    } finally { setBusy(null); }
  };

  const max = Math.max(1, ...(stats?.daily || []).map((d) => d.count));
  const tot = stats?.totals;

  return (
    <PageShell
      title={t('cueQuestions.title') as string}
      actions={(
        <SelWrap>
          <PlanQSelect size="sm" isSearchable={false} isClearable={false}
            value={dayOptions.find((o) => o.value === String(days))} options={dayOptions}
            onChange={(o) => setDays(Number((o as PlanQSelectOption)?.value) || 30)} />
        </SelWrap>
      )}
    >
      <Note>{t('cueQuestions.note')}</Note>
      {err && <ErrLine>{err}</ErrLine>}
      {loading && !stats ? (
        <Dim>{t('cueQuestions.loading')}</Dim>
      ) : !stats || !tot || tot.questions === 0 ? (
        <EmptyState title={t('cueQuestions.emptyTitle') as string} description={t('cueQuestions.emptyDesc') as string} />
      ) : (
        <>
          <Stats data-testid="cueq-stats">
            <Stat><StatNum>{tot.questions.toLocaleString()}</StatNum><StatLabel>{t('cueQuestions.questions')}</StatLabel></Stat>
            <Stat><StatNum>{pct(tot.classified, tot.questions)}</StatNum><StatLabel>{t('cueQuestions.classifiedRate')}</StatLabel></Stat>
            <Stat><StatNum>{pct(tot.answered, tot.questions)}</StatNum><StatLabel>{t('cueQuestions.answeredRate')}</StatLabel></Stat>
            <Stat><StatNum>{tot.workspace_days.toLocaleString()}</StatNum><StatLabel>{t('cueQuestions.workspaceDays')}</StatLabel></Stat>
          </Stats>

          <Card data-testid="cueq-topics">
            <CardTitle>{t('cueQuestions.byTopic')}</CardTitle>
            <TopicHead><span>{t('cueQuestions.colTopic')}</span><span>{t('cueQuestions.colCount')}</span><span>{t('cueQuestions.colAnswered')}</span><span>{t('cueQuestions.colWsDays')}</span></TopicHead>
            {stats.topics.map((r) => (
              <TopicRowEl key={r.key}>
                <TKey title={r.key}>{topicLabel(r.key)}</TKey>
                <TNum>{r.count}</TNum>
                <TNum>{pct(r.answered, r.count)}</TNum>
                <TNum>{r.workspace_days}</TNum>
              </TopicRowEl>
            ))}
          </Card>

          <Grid>
            {([['intent', stats.intents], ['mode', stats.modes], ['plan', stats.plans], ['lang', stats.langs]] as const).map(([g, rows]) => (
              <Card key={g}>
                <CardTitle>{t(`cueQuestions.by.${g}`)}</CardTitle>
                <Table>{rows.map((r) => <TRow key={r.key || '__none'}><TKey>{g === 'plan' || g === 'lang' ? (r.key || t('cueQuestions.none')) : keyLabel(g, r.key)}</TKey><TNum>{r.count}</TNum></TRow>)}</Table>
              </Card>
            ))}
          </Grid>

          <Card>
            <CardTitle>{t('cueQuestions.daily')}</CardTitle>
            <Bars>
              {stats.daily.map((d) => (
                <BarRow key={d.date}>
                  <BarDate>{d.date.slice(5)}</BarDate>
                  <BarTrack><BarFill style={{ width: `${Math.round((d.count / max) * 100)}%` }} /></BarTrack>
                  <BarNum>{d.count}</BarNum>
                </BarRow>
              ))}
            </Bars>
          </Card>
        </>
      )}

      <Card data-testid="cueq-raw">
        <CardTitle>{t('cueQuestions.rawTitle', { count: raw.length })}</CardTitle>
        <Note>{t('cueQuestions.rawNote')}</Note>
        {raw.length === 0 ? <Dim>{t('cueQuestions.rawEmpty')}</Dim> : raw.map((r) => (
          <RawItem key={r.id}>
            {/* 텍스트 노드로만 — HTML 로 해석하지 않는다 */}
            <RawText>{r.question}</RawText>
            <RawMeta>{String(r.created_at || '').slice(0, 10)}{r.lang ? ` · ${r.lang}` : ''}</RawMeta>
            <RawActions>
              <RawSel>
                <PlanQSelect size="sm" isSearchable isClearable={false}
                  placeholder={t('cueQuestions.pickTopic') as string}
                  value={topicOptions.find((o) => o.value === pick[r.id]) || null} options={topicOptions}
                  onChange={(o) => setPick((p) => ({ ...p, [r.id]: String((o as PlanQSelectOption)?.value || '') }))} />
              </RawSel>
              <ActionButton tone="primary" size="sm" disabled={!pick[r.id] || busy === r.id} onClick={() => void act(r.id, 'PATCH')}>{t('cueQuestions.label')}</ActionButton>
              <ActionButton tone="secondary" size="sm" disabled={busy === r.id} onClick={() => void act(r.id, 'DELETE')}>{t('cueQuestions.delete')}</ActionButton>
            </RawActions>
          </RawItem>
        ))}
      </Card>
    </PageShell>
  );
}

const SelWrap = styled.div`min-width: 130px;`;
const Note = styled.p`margin: 0 0 14px; font-size: 0.75rem; color: #64748b; line-height: 1.5;`;
const ErrLine = styled.div`margin-bottom: 12px; font-size: 0.8125rem; color: #b91c1c;`;
const Dim = styled.div`padding: 24px 0; text-align: center; color: #94a3b8; font-size: 0.8125rem;`;
const Stats = styled.div`display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 14px;`;
const Stat = styled.div`background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 14px 16px;`;
const StatNum = styled.div`font-size: 1.5rem; font-weight: 700; color: #0f172a; font-variant-numeric: tabular-nums;`;
const StatLabel = styled.div`font-size: 0.75rem; color: #64748b; margin-top: 2px;`;
const Card = styled.div`background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 14px 16px; margin-bottom: 14px; min-width: 0;`;
const CardTitle = styled.div`font-size: 0.8125rem; font-weight: 700; color: #0f172a; margin: 0 0 8px;`;
const Grid = styled.div`display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 14px;`;
const Table = styled.div`display: flex; flex-direction: column;`;
const TRow = styled.div`display: flex; justify-content: space-between; gap: 12px; padding: 6px 0; border-bottom: 1px solid #f1f5f9; font-size: 0.8125rem; &:last-child { border-bottom: none; }`;
const TKey = styled.span`color: #334155; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`;
const TNum = styled.span`color: #0f172a; font-weight: 600; font-variant-numeric: tabular-nums; flex-shrink: 0; text-align: right;`;
const topicCols = 'grid-template-columns: minmax(0, 1fr) 56px 64px 72px;';
const TopicHead = styled.div`display: grid; ${topicCols} gap: 8px; padding: 0 0 6px; font-size: 0.6875rem; color: #94a3b8; border-bottom: 1px solid #e2e8f0; & > span:not(:first-child) { text-align: right; }`;
const TopicRowEl = styled.div`display: grid; ${topicCols} gap: 8px; padding: 6px 0; border-bottom: 1px solid #f1f5f9; font-size: 0.8125rem; &:last-child { border-bottom: none; }`;
const Bars = styled.div`display: flex; flex-direction: column; gap: 4px;`;
const BarRow = styled.div`display: grid; grid-template-columns: 44px minmax(0, 1fr) 40px; align-items: center; gap: 8px; font-size: 0.75rem;`;
const BarDate = styled.span`color: #64748b; font-variant-numeric: tabular-nums;`;
const BarTrack = styled.div`height: 8px; background: #f1f5f9; border-radius: 4px; overflow: hidden;`;
const BarFill = styled.div`height: 100%; background: #14b8a6; border-radius: 4px;`;
const BarNum = styled.span`text-align: right; font-weight: 600; color: #0f172a; font-variant-numeric: tabular-nums;`;
const RawItem = styled.div`display: flex; flex-direction: column; gap: 6px; padding: 10px 0; border-bottom: 1px solid #f1f5f9; &:last-child { border-bottom: none; }`;
const RawText = styled.div`font-size: 0.8125rem; color: #0f172a; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere;`;
const RawMeta = styled.div`font-size: 0.6875rem; color: #94a3b8;`;
const RawActions = styled.div`display: flex; flex-wrap: wrap; align-items: center; gap: 8px;`;
const RawSel = styled.div`flex: 1 1 200px; min-width: 0; max-width: 280px;`;
