// 신규 워크스페이스 시작 안내 — 대시보드 최상단.
//
// 왜 (Irene 2026-09-08: "신규 고객이 들어와서 전반적으로 잘 이해할 수 있게 안내하는 거
//   처음 접속 시 있어?") — 실측 답은 "없다" 였다. 가입하면 곧장 /dashboard 로 떨어지고
//   좌측 메뉴 12개가 이름만 나열될 뿐 무엇부터 하라는 말이 한 줄도 없었다.
//
// 원칙 셋:
//   ① 체크는 **사용자가 하지 않는다.** 실제 데이터(고객·대화·업무·알림 구독)로 서버가 판정한다.
//      사용자가 누르는 체크박스는 곧 거짓말이 된다 — 고객을 지워도 완료로 남는다.
//   ② 네 단계가 다 차면 **스스로 사라진다.** 안 할 사람을 위해 닫기도 둔다(그 의사만 저장한다).
//   ③ 각 줄은 "왜 하는지" 한 줄 + 바로 가는 버튼. 규칙을 설명하지 않고 **다음 행동**을 준다.
//      사용법은 이미 있는 Q위키 글로 보낸다(askCue) — 새로 쓴 안내문을 또 만들지 않는다.
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { apiFetch } from '../../contexts/AuthContext';
import { useVisibilityRefresh } from '../../hooks/useVisibilityRefresh';
import { askCue } from '../../utils/cueAsk';
import { CONTROL } from '../../theme/tokens';

interface Step { key: string; done: boolean }
interface OnboardingState { dismissed: boolean; done_count: number; total: number; steps: Step[] }

/** 각 단계가 어디로 가는지 · Q위키 글이 있는지. 서버는 key 와 done 만 말한다.
 *  ★ 위키 검색어는 여기 적지 않는다 — 그 글의 제목은 언어마다 다르다
 *    (help_articles.title_ko '고객 초대하기' / title_en 'Invite a client').
 *    코드에 한 언어를 박으면 반대 언어 사용자는 검색이 빗나간다. i18n 사전에서 꺼낸다. */
const STEP_META: Record<string, { go?: string; act?: 'push'; hasWiki?: boolean }> = {
  invite_client: { go: '/business/clients', hasWiki: true },
  start_conversation: { go: '/talk', hasWiki: true },
  create_task: { go: '/tasks', hasWiki: true },
  // 알림은 이동이 아니라 **권한 요청**이다. 배너가 쓰는 것과 같은 함수를 부른다.
  // Q위키에 이 주제 글이 아직 없으므로 '사용법' 을 달지 않는다 — 없는 문을 안내하지 않는다.
  enable_notifications: { act: 'push' },
};

const OnboardingCard: React.FC<{ businessId: number | null }> = ({ businessId }) => {
  const { t } = useTranslation('dashboard');
  const navigate = useNavigate();
  const [state, setState] = useState<OnboardingState | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!businessId) { setState(null); return; }
    try {
      const r = await apiFetch(`/api/businesses/${businessId}/onboarding`);
      if (!r.ok) return;
      const j = await r.json();
      setState(j.success ? (j.data as OnboardingState | null) : null);
    } catch { /* 안내 카드가 못 뜨는 것으로 대시보드를 막지 않는다 */ }
  }, [businessId]);

  useEffect(() => { void load(); }, [load]);
  // 다른 탭에서 고객을 만들고 돌아오면 그 줄이 켜져 있어야 한다.
  useVisibilityRefresh(load);

  const dismiss = async () => {
    if (!businessId || busy) return;
    setBusy(true);
    try {
      await apiFetch(`/api/businesses/${businessId}/onboarding/dismiss`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dismissed: true }),
      });
      setState((s) => (s ? { ...s, dismissed: true } : s));
    } finally { setBusy(false); }
  };

  const runStep = async (key: string) => {
    const meta = STEP_META[key];
    if (!meta) return;
    if (meta.act === 'push') {
      const { subscribe } = await import('../../services/push');
      await subscribe().catch(() => null);
      void load();                 // 켜졌으면 이 줄이 바로 체크된다
      return;
    }
    if (meta.go) navigate(meta.go);
  };

  if (!state || state.dismissed) return null;
  if (state.done_count >= state.total) return null;   // 다 했으면 조용히 사라진다

  return (
    <Card role="region" aria-label={t('onboarding.title', '시작하기') as string}>
      <Head>
        <Title>{t('onboarding.title', '시작하기')}</Title>
        <Progress>{t('onboarding.progress', '{{done}}/{{total}}', { done: state.done_count, total: state.total })}</Progress>
        <Spacer />
        <TextBtn type="button" onClick={dismiss} disabled={busy}>
          {t('onboarding.dismiss', '다시 보지 않기')}
        </TextBtn>
      </Head>
      <Sub>{t('onboarding.subtitle', '네 가지만 하면 PlanQ 가 한 바퀴 돕니다.')}</Sub>
      <List>
        {state.steps.map((s) => {
          const meta = STEP_META[s.key];
          return (
            <Item key={s.key} $done={s.done}>
              <Mark $done={s.done} aria-hidden="true">{s.done ? '✓' : ''}</Mark>
              <Texts>
                <Label $done={s.done}>{t(`onboarding.step.${s.key}.label`, s.key)}</Label>
                <Why>{t(`onboarding.step.${s.key}.why`, '')}</Why>
              </Texts>
              {!s.done && meta && (
                <GoBtn type="button" onClick={() => void runStep(s.key)}>
                  {t('onboarding.do', '하기')}
                </GoBtn>
              )}
              {meta?.hasWiki && (
                <TextBtn type="button"
                  onClick={() => askCue(t(`onboarding.step.${s.key}.wikiQuery`, '') as string, 'wiki')}>
                  {t('onboarding.howto', '사용법')}
                </TextBtn>
              )}
            </Item>
          );
        })}
      </List>
    </Card>
  );
};

const Card = styled.section`
  background: #FFFFFF; border: 1px solid #99F6E4; border-radius: 12px;
  padding: 16px 18px; margin-bottom: 16px;
`;
const Head = styled.div`display: flex; align-items: center; gap: 8px;`;
const Spacer = styled.span`margin-left: auto;`;
const Title = styled.h2`margin: 0; font-size: 0.9375rem; font-weight: 700; color: #0F172A;`;
const Progress = styled.span`
  padding: 2px 8px; border-radius: 999px; background: #F0FDFA; color: #0F766E;
  font-size: 0.6875rem; font-weight: 700;
`;
const Sub = styled.p`margin: 4px 0 12px; font-size: 0.75rem; color: #64748B;`;
const List = styled.div`display: flex; flex-direction: column; gap: 6px;`;
const Item = styled.div<{ $done: boolean }>`
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 8px 10px; border-radius: 8px;
  background: ${(p) => (p.$done ? '#F8FAFC' : '#FFFFFF')};
  border: 1px solid ${(p) => (p.$done ? '#F1F5F9' : '#E2E8F0')};
`;
// 완료 표식 — 컨트롤이 아니라 장식이라 컨트롤 높이 토큰(36/40/44)을 쓰지 않는다.
// 정사각형은 aspect-ratio 로 만든다(높이를 따로 적으면 두 값이 갈라진다).
const Mark = styled.span<{ $done: boolean }>`
  flex-shrink: 0; width: 18px; aspect-ratio: 1 / 1; border-radius: 999px;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 0.6875rem; font-weight: 700; color: #FFFFFF;
  background: ${(p) => (p.$done ? '#14B8A6' : 'transparent')};
  border: 1px solid ${(p) => (p.$done ? '#14B8A6' : '#CBD5E1')};
`;
const Texts = styled.div`flex: 1 1 200px; min-width: 0;`;
const Label = styled.div<{ $done: boolean }>`
  font-size: 0.8125rem; font-weight: 600;
  color: ${(p) => (p.$done ? '#94A3B8' : '#0F172A')};
  text-decoration: ${(p) => (p.$done ? 'line-through' : 'none')};
`;
const Why = styled.div`font-size: 0.6875rem; color: #94A3B8; margin-top: 1px;`;
const GoBtn = styled.button`
  flex-shrink: 0; height: ${CONTROL.sm}px; padding: 0 12px;
  border: 1px solid #99F6E4; border-radius: 8px; background: #F0FDFA; color: #0F766E;
  font-size: 0.75rem; font-weight: 700; font-family: inherit; cursor: pointer;
  &:hover { background: #CCFBF1; }
  &:focus-visible { outline: 2px solid rgba(15,118,110,0.5); outline-offset: 2px; }
`;
const TextBtn = styled.button`
  flex-shrink: 0; height: ${CONTROL.sm}px; padding: 0 8px;
  border: none; background: transparent; color: #64748B;
  font-size: 0.75rem; font-weight: 600; font-family: inherit; cursor: pointer;
  &:hover { color: #0F172A; text-decoration: underline; }
  &:disabled { opacity: 0.5; cursor: default; }
  &:focus-visible { outline: 2px solid rgba(15,118,110,0.5); outline-offset: 2px; }
`;

export default OnboardingCard;
