// 시작 안내 체크리스트 — 대시보드 최상단 + 설정 최상단 (**같은 컴포넌트 한 벌**).
//
// 왜 (Irene 2026-09-08: "신규 고객이 들어와서 전반적으로 잘 이해할 수 있게 안내하는 거
//   처음 접속 시 있어?") — 실측 답은 "없다" 였다. 가입하면 곧장 /dashboard 로 떨어지고
//   좌측 메뉴 12개가 이름만 나열될 뿐 무엇부터 하라는 말이 한 줄도 없었다.
// 확장 (2026-10-04, docs/AI_AGENT_M3_DESIGN.md §3.3 D3 — Irene: "처음 연결해야 하는 것들 순서대로 안내 …
//   설정 최상단 … 아무리 잘 만들어도 제대로 안내 안 되면 사람들은 몰라.")
//   - 두 묶음: 워크스페이스(owner/admin) · 나(모든 멤버). 서버가 묶음과 자격을 정한다.
//   - 배너는 만들지 않는다 — 두 모양이 되면 갈라진다. 대시보드와 설정이 이 컴포넌트를 같이 쓴다(variant).
//   - 옛 이름은 components/Dashboard/OnboardingCard — 이름만 옮겼다.
//
// 원칙 셋:
//   ① 체크는 **사용자가 하지 않는다.** 실제 데이터로 서버가 판정한다(services/onboarding.js).
//      사용자가 누르는 체크박스는 곧 거짓말이 된다 — 고객을 지워도 완료로 남는다.
//   ② 묶음이 다 차면 **스스로 사라진다.** 안 할 사람을 위해 닫기도 둔다(그 의사만 서버에 저장한다).
//      접기는 보는 사람의 편의라 브라우저에만 둔다.
//   ③ 각 줄은 "왜 하는지" 한 줄 + 바로 가는 버튼. 사용법은 **이미 있는** Q위키 글로 보낸다(askCue) —
//      글이 없는 단계에는 '사용법' 을 달지 않는다(없는 문을 안내하지 않는다).
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { apiFetch } from '../../contexts/AuthContext';
import { useVisibilityRefresh } from '../../hooks/useVisibilityRefresh';
import { askCue } from '../../utils/cueAsk';
import { CONTROL } from '../../theme/tokens';
import { mediaPhone } from '../../theme/breakpoints';
import ActionButton from '../Common/ActionButton';

interface Step { key: string; done: boolean }
interface Group { scope: 'workspace' | 'me'; dismissed: boolean; done_count: number; total: number; steps: Step[] }
interface OnboardingState { groups?: Group[] }

type ActionKind = 'open' | 'connect' | 'turnOn' | 'installGuide';

/** 각 단계가 어디로 가는지 · 버튼 글자 · Q위키 글이 있는지. 서버는 key 와 done 만 말한다.
 *  ★ 위키 검색어는 여기 적지 않는다 — 그 글의 제목은 언어마다 다르다
 *    (help_articles.title_ko '고객 초대하기' / title_en 'Invite a client').
 *    코드에 한 언어를 박으면 반대 언어 사용자는 검색이 빗나간다. i18n 사전(`wikiQuery`)에서 꺼낸다.
 *  ★ hasWiki 는 seed-wiki-content.js 에 **실제로 있는 글**만: invite-client · start-conversation ·
 *    create-task · connect-mail · google-calendar-meet · connect-chatgpt-claude.
 *    알림 켜기·앱 설치는 글이 없다 → 사용법 없음. */
const STEP_META: Record<string, { go?: string; act?: 'push' | 'wiki'; action: ActionKind; hasWiki?: boolean }> = {
  invite_client: { go: '/business/clients', action: 'open', hasWiki: true },
  start_conversation: { go: '/talk', action: 'open', hasWiki: true },
  create_task: { go: '/tasks', action: 'open', hasWiki: true },
  // 메일 계정 연결은 회사 메일함 화면이다(위키 connect-mail 의 linked_route 와 같은 곳).
  connect_mail: { go: '/business/settings/mail-accounts', action: 'connect', hasWiki: true },
  // 알림은 이동이 아니라 **권한 요청**이다. 배너가 쓰는 것과 같은 함수를 부른다.
  enable_notifications: { act: 'push', action: 'turnOn' },
  // 개인 캘린더 연결은 '내 외부 연동' 화면이다(사이드바 내 계정 > 내 외부 연동).
  connect_calendar: { go: '/profile/integrations', action: 'connect', hasWiki: true },
  // 앱 설치 안내는 '내 알림' 화면의 설치 섹션(PwaInstallSection)이 상시 진입점이다.
  install_app: { go: '/business/settings/notifications', action: 'installGuide' },
  // AI 앱 연결 — '내 외부 연동' 의 «연결된 AI 앱» 칸으로 보낸다(2026-10-04). 거기에 주소 복사 + ChatGPT·Claude 의
  //   연결 화면을 바로 여는 버튼 + 순서가 있다. 위키만 열면 사용자가 ChatGPT 메뉴를 직접 찾아야 했다(Irene 이 실제로 막혔다).
  connect_ai_app: { go: '/profile/integrations?focus=ai', action: 'connect', hasWiki: true },
};

const COLLAPSE_KEY = 'planq.onboarding.collapsed';
function readCollapsed(): boolean {
  try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; }
}
function writeCollapsed(v: boolean): void {
  try { if (v) localStorage.setItem(COLLAPSE_KEY, '1'); else localStorage.removeItem(COLLAPSE_KEY); } catch { /* 시크릿 모드 등 */ }
}

interface Props {
  businessId: number | null;
  /** 놓이는 자리 — 모양·동작은 같다(두 모양이 되면 갈라진다). 검사·계측용 표식으로만 쓴다. */
  variant?: 'dashboard' | 'settings';
}

const OnboardingChecklist: React.FC<Props> = ({ businessId, variant = 'dashboard' }) => {
  const { t } = useTranslation('dashboard');
  const navigate = useNavigate();
  const [state, setState] = useState<OnboardingState | null>(null);
  const [busy, setBusy] = useState(false);
  const [collapsed, setCollapsed] = useState<boolean>(readCollapsed);

  const load = useCallback(async () => {
    if (!businessId) { setState(null); return; }
    try {
      const r = await apiFetch(`/api/businesses/${businessId}/onboarding`);
      if (!r.ok) return;
      const j = await r.json();
      setState(j.success ? (j.data as OnboardingState | null) : null);
    } catch { /* 안내 카드가 못 뜨는 것으로 화면을 막지 않는다 */ }
  }, [businessId]);

  useEffect(() => { void load(); }, [load]);
  // 다른 탭에서 연결을 마치고 돌아오면 그 줄이 켜져 있어야 한다.
  useVisibilityRefresh(load);

  const toggleCollapsed = () => {
    setCollapsed((v) => { writeCollapsed(!v); return !v; });
  };

  const dismiss = async () => {
    if (!businessId || busy) return;
    setBusy(true);
    try {
      // 'all' = 내가 볼 수 있는 묶음 전부(멤버는 '나' 묶음만 — 서버가 자격을 본다).
      const r = await apiFetch(`/api/businesses/${businessId}/onboarding/dismiss`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dismissed: true, scope: 'all' }),
      });
      if (r.ok) setState((s) => (s ? { ...s, groups: (s.groups || []).map((g) => ({ ...g, dismissed: true })) } : s));
    } finally { setBusy(false); }
  };

  const openWiki = (key: string) => askCue(t(`onboarding.step.${key}.wikiQuery`, '') as string, 'wiki');

  const runStep = async (key: string) => {
    const meta = STEP_META[key];
    if (!meta) return;
    if (meta.act === 'push') {
      const { subscribe } = await import('../../services/push');
      await subscribe().catch(() => null);
      void load();                 // 켜졌으면 이 줄이 바로 체크된다
      return;
    }
    if (meta.act === 'wiki') { openWiki(key); return; }
    if (meta.go) navigate(meta.go);
  };

  if (!state || !Array.isArray(state.groups)) return null;

  // ★ 알림 안내 배너가 이미 떠 있으면 '알림 켜기' 줄은 양보한다 (2026-09-08).
  //   같은 행동을 같은 화면에서 두 번 시킨다. 양보 방향은 저장소의 기존 규칙을 그대로 따른다 —
  //   InstallPromptBanner 가 PushPromptBanner 에게 양보할 때 쓰는 바로 그 플래그다.
  //   배너를 접으면(7일 안 보기) 이 줄이 다시 나온다 — 켜는 길이 사라지지는 않는다.
  const bannerUp = typeof document !== 'undefined' && document.body.dataset.pushPromptVisible === '1';
  const groups = state.groups
    .filter((g) => !g.dismissed)
    .map((g) => ({ ...g, steps: bannerUp ? g.steps.filter((s) => s.key !== 'enable_notifications') : g.steps }))
    // 다 한 묶음은 조용히 사라진다
    .filter((g) => g.steps.length > 0 && g.steps.some((s) => !s.done));
  if (groups.length === 0) return null;

  const total = groups.reduce((n, g) => n + g.steps.length, 0);
  const done = groups.reduce((n, g) => n + g.steps.filter((s) => s.done).length, 0);

  return (
    <Card
      role="region"
      aria-label={t('onboarding.title', '업무 효율 높이기') as string}
      data-testid="onboarding-checklist"
      data-variant={variant}
    >
      <Head>
        <Title>{t('onboarding.title', '업무 효율 높이기')}</Title>
        <Progress>{t('onboarding.progress', '{{done}}/{{total}}', { done, total })}</Progress>
        <Spacer />
        <TextBtn type="button" onClick={toggleCollapsed} aria-expanded={!collapsed} data-testid="onboarding-collapse">
          {collapsed ? t('onboarding.expand', '펼치기') : t('onboarding.collapse', '접기')}
        </TextBtn>
        <TextBtn type="button" onClick={dismiss} disabled={busy} data-testid="onboarding-dismiss">
          {t('onboarding.dismiss', '다시 보지 않기')}
        </TextBtn>
      </Head>
      {!collapsed && groups.map((g) => (
        <GroupBlock key={g.scope} data-testid={`onboarding-group-${g.scope}`}>
          <GroupLabel>
            {g.scope === 'workspace' ? t('onboarding.groupWorkspace', '워크스페이스') : t('onboarding.groupMe', '나')}
          </GroupLabel>
          {g.steps.map((s) => {
            const meta = STEP_META[s.key];
            return (
              <Item key={s.key} data-testid={`onboarding-step-${s.key}`} data-done={s.done ? '1' : '0'}>
                <Mark $done={s.done} aria-hidden="true">{s.done ? '✓' : ''}</Mark>
                <Texts>
                  <Label $done={s.done}>{t(`onboarding.step.${s.key}.label`, s.key)}</Label>
                  {!s.done && <Why>{t(`onboarding.step.${s.key}.why`, '')}</Why>}
                </Texts>
                {!s.done && meta && (
                  <Actions>
                    <ActionButton tone="secondary" size="sm" onClick={() => void runStep(s.key)}
                      data-testid={`onboarding-go-${s.key}`}>
                      {t(`onboarding.action.${meta.action}`, meta.action)}
                    </ActionButton>
                    {meta.hasWiki && (
                      <ActionButton tone="secondary" size="sm" onClick={() => openWiki(s.key)}
                        data-testid={`onboarding-wiki-${s.key}`}>
                        {t('onboarding.howto', '사용법')}
                      </ActionButton>
                    )}
                  </Actions>
                )}
              </Item>
            );
          })}
        </GroupBlock>
      ))}
    </Card>
  );
};

const Card = styled.section`
  background: #FFFFFF; border: 1px solid #99F6E4; border-radius: 12px;
  padding: 12px 16px; margin-bottom: 16px;
`;
const Head = styled.div`display: flex; align-items: center; gap: 8px; min-height: ${CONTROL.sm}px;`;
const Spacer = styled.span`margin-left: auto;`;
const Title = styled.h2`margin: 0; font-size: 0.9375rem; font-weight: 700; color: #0F172A;`;
const Progress = styled.span`
  padding: 2px 8px; border-radius: 999px; background: #F0FDFA; color: #0F766E;
  font-size: 0.6875rem; font-weight: 700;
`;
const GroupBlock = styled.div`margin-top: 8px;`;
const GroupLabel = styled.div`
  font-size: 0.6875rem; font-weight: 700; color: #64748B;
  padding: 4px 0; border-bottom: 1px solid #F1F5F9;
`;
// 한 줄 = 36px(버튼 sm 과 같은 높이). 폰에서는 버튼 묶음이 제목 아래로 감긴다.
const Item = styled.div`
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  min-height: ${CONTROL.sm}px; padding: 0;
  border-bottom: 1px solid #F1F5F9;
  ${mediaPhone} { padding: 8px 0; row-gap: 6px; }
  &:last-child { border-bottom: none; }
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
// 데스크탑: 제목과 이유가 한 줄(이유는 넘치면 말줄임). 폰: 이유가 제목 아래로.
const Texts = styled.div`
  flex: 1 1 0; min-width: 0;
  display: flex; align-items: baseline; gap: 12px;
  ${mediaPhone} { flex-direction: column; align-items: flex-start; gap: 1px; flex-basis: calc(100% - 28px); }
`;
const Label = styled.div<{ $done: boolean }>`
  flex-shrink: 0;
  font-size: 0.8125rem; font-weight: 600;
  color: ${(p) => (p.$done ? '#94A3B8' : '#0F172A')};
  text-decoration: ${(p) => (p.$done ? 'line-through' : 'none')};
`;
const Why = styled.div`
  min-width: 0; font-size: 0.75rem; color: #64748B;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  ${mediaPhone} { white-space: normal; }
`;
const Actions = styled.div`
  flex-shrink: 0; display: flex; gap: 6px;
  ${mediaPhone} { margin-left: 28px; }
`;
const TextBtn = styled.button`
  flex-shrink: 0; height: ${CONTROL.sm}px; padding: 0 8px;
  border: none; background: transparent; color: #64748B;
  font-size: 0.75rem; font-weight: 600; font-family: inherit; cursor: pointer;
  &:hover { color: #0F172A; text-decoration: underline; }
  &:disabled { opacity: 0.5; cursor: default; }
  &:focus-visible { outline: 2px solid rgba(15,118,110,0.5); outline-offset: 2px; }
`;

export default OnboardingChecklist;
