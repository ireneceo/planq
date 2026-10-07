// Cue 질문 분석 스위치 (2026-10-07, Fable 판정 B5 · docs/IRENE_DECISIONS_2026-10-07.md §5).
//
//   ① «제품 개선을 위한 질문 주제 분석» — 기본 켬(opt-out). 주제·의도만 남고 누가·어느 워크스페이스가 물었는지는 남지 않는다.
//   ② «분류 안 된 질문 원문 30일 보관(가명처리)» — 기본 끔(opt-in). 제품 사용법 질문만, 이름·이메일·전화·금액·링크를 가린 뒤 30일.
//   판정은 서버 services/cueQuestionAnalysis.analysisPrefs 한 함수. 저장은 PUT /api/businesses/:id/settings { cue_analysis: {…} }
//   — 보낸 칸만 바뀌고 permissions JSON 의 다른 키는 서버가 보존한다. 토글은 AutoSaveField 계약(AiAgentPolicySection 과 같은 모양).
import React, { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../contexts/AuthContext';
import AutoSaveField from '../../components/Common/AutoSaveField';
import { Switch, SwitchKnob } from '../../components/Common/switchShell';

type Key = 'topics' | 'raw';

const CueAnalysisPolicySection: React.FC<{ businessId: number }> = ({ businessId }) => {
  const { t } = useTranslation('settings');
  const [prefs, setPrefs] = useState<Record<Key, boolean>>({ topics: true, raw: false });
  const [loaded, setLoaded] = useState(false);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  useEffect(() => {
    let dead = false;
    setLoaded(false);
    (async () => {
      try {
        const r = await apiFetch(`/api/businesses/${businessId}/permissions`);
        const j = await r.json();
        const c = j?.data?.permissions?.cue_analysis;
        if (!dead && j.success && c) setPrefs({ topics: c.topics !== false, raw: c.raw === true });
      } catch { /* 기본값 유지 */ }
      if (!dead) setLoaded(true);
    })();
    return () => { dead = true; };
  }, [businessId]);

  const persist = (key: Key) => async () => {
    const next = prefsRef.current[key];
    const r = await apiFetch(`/api/businesses/${businessId}/settings`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cue_analysis: { [key]: next } }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.success) {
      setPrefs((p) => ({ ...p, [key]: !next }));   // 화면이 서버와 다른 값을 보여주면 안 된다
      throw new Error(j.message || 'save_failed');
    }
  };

  const row = (key: Key, labelKey: string, helpKey: string) => (
    <Row>
      <Text>
        <Label id={`cue-analysis-${key}-label`}>{t(labelKey)}</Label>
        <Desc>{t(helpKey)}</Desc>
      </Text>
      <AutoSaveField key={`cue-analysis-${key}-${businessId}`} type="toggle" onSave={persist(key)}>
        <Switch
          type="button"
          role="switch"
          aria-checked={prefs[key]}
          aria-labelledby={`cue-analysis-${key}-label`}
          data-testid={`cue-analysis-${key}-switch`}
          $on={prefs[key]}
          disabled={!loaded}
          onClick={() => setPrefs((p) => ({ ...p, [key]: !p[key] }))}
        >
          <SwitchKnob $on={prefs[key]} />
        </Switch>
      </AutoSaveField>
    </Row>
  );

  return (
    <Wrap data-testid="cue-analysis-policy">
      <Title>{t('cueAnalysis.title')}</Title>
      {row('topics', 'cueAnalysis.topics', 'cueAnalysis.topicsHelp')}
      {row('raw', 'cueAnalysis.raw', 'cueAnalysis.rawHelp')}
    </Wrap>
  );
};

export default CueAnalysisPolicySection;

const Wrap = styled.div`display: flex; flex-direction: column; gap: 14px; max-width: 720px;`;
const Title = styled.h3`font-size: 1rem; font-weight: 700; color: #0f172a; margin: 0;`;
const Row = styled.div`display: flex; align-items: flex-start; gap: 16px; justify-content: space-between;`;
const Text = styled.div`display: flex; flex-direction: column; gap: 4px; min-width: 0;`;
const Label = styled.div`font-size: 0.875rem; font-weight: 600; color: #0f172a;`;
const Desc = styled.p`font-size: 0.8125rem; color: #64748b; margin: 0; line-height: 1.5;`;
