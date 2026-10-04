// AI 앱 연결(ChatGPT·Claude) — 워크스페이스 메일 스위치 (#439 M3-a, 설계 docs/AI_AGENT_M3_DESIGN.md §3.1·§11).
//
//   메일에는 제3자(고객) 개인정보가 들어 있다 — 멤버 한 사람이 자기 AI 앱으로 고객 메일을 보내는 것은 사업자의 결정이어야 한다.
//   켜 둠이 기본(§12-①). 끄면 동의 화면의 «메일 읽기» 체크박스가 비활성이 되고, 이미 받은 연결도 다음 호출부터 메일을 못 읽는다
//   (판정은 서버 services/agent_oauth/grants.workspaceMailAllowed 한 함수 — 동의 화면과 매 호출이 같이 쓴다).
//   저장은 PUT /api/businesses/:id/settings { ai_agent: { mail } } — permissions JSON 의 다른 키는 서버가 보존한다.
//   토글은 AutoSaveField 계약: 누르면 화면만(flip) · 래퍼가 저장(persist, ref 로 뒤집힌 뒤 값을 읽는다).
import React, { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../contexts/AuthContext';
import AutoSaveField from '../../components/Common/AutoSaveField';
import { Switch, SwitchKnob } from '../../components/Common/switchShell';

const AiAgentPolicySection: React.FC<{ businessId: number }> = ({ businessId }) => {
  const { t } = useTranslation('settings');
  const [on, setOn] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const onRef = useRef(true);
  onRef.current = on;

  useEffect(() => {
    let dead = false;
    setLoaded(false);
    (async () => {
      try {
        const r = await apiFetch(`/api/businesses/${businessId}/permissions`);
        const j = await r.json();
        if (!dead && j.success) setOn(j.data?.permissions?.ai_agent?.mail !== false);
      } catch { /* 기본값(켜 둠) 유지 */ }
      if (!dead) setLoaded(true);
    })();
    return () => { dead = true; };
  }, [businessId]);

  const persist = async () => {
    const next = onRef.current;
    const r = await apiFetch(`/api/businesses/${businessId}/settings`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ai_agent: { mail: next } }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.success) {
      setOn(!next);   // 화면이 서버와 다른 값을 보여주면 안 된다
      throw new Error(j.message || 'save_failed');   // 래퍼가 ! 뱃지를 띄우려면 던져야 한다
    }
  };

  return (
    <Wrap data-testid="ai-agent-policy">
      <Title>{t('aiAgent.title')}</Title>
      <Row>
        <Text>
          <Label id="ai-agent-mail-label">{t('aiAgent.allowMail')}</Label>
          <Desc>{t('aiAgent.allowMailHelp')}</Desc>
        </Text>
        <AutoSaveField key={`ai-agent-mail-${businessId}`} type="toggle" onSave={persist}>
          <Switch
            type="button"
            role="switch"
            aria-checked={on}
            aria-labelledby="ai-agent-mail-label"
            data-testid="ai-agent-mail-switch"
            $on={on}
            disabled={!loaded}
            onClick={() => setOn((v) => !v)}
          >
            <SwitchKnob $on={on} />
          </Switch>
        </AutoSaveField>
      </Row>
    </Wrap>
  );
};

export default AiAgentPolicySection;

const Wrap = styled.div`display: flex; flex-direction: column; gap: 12px; max-width: 720px; margin-top: 28px; padding-top: 24px; border-top: 1px solid #e2e8f0;`;
const Title = styled.h3`font-size: 1rem; font-weight: 700; color: #0f172a; margin: 0;`;
const Row = styled.div`display: flex; align-items: flex-start; gap: 16px; justify-content: space-between;`;
const Text = styled.div`display: flex; flex-direction: column; gap: 4px; min-width: 0;`;
const Label = styled.div`font-size: 0.875rem; font-weight: 600; color: #0f172a;`;
const Desc = styled.p`font-size: 0.8125rem; color: #64748b; margin: 0; line-height: 1.5;`;
