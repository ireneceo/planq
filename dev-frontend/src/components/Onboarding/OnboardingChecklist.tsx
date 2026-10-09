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
// 팀 적응 단계 (2026-10-09, docs/TEAM_ADOPTION_STAGES_DESIGN.md — Irene: "팀이 적응하는데 필요한 단계별 안내 …
//   워크스페이스에도 적응단계 안내하면서 하나 하나 사용하게"). 서버가 `stages` 를 주면 «워크스페이스» 묶음 자리에
//   다섯 단계를 그린다 — **지금 단계 하나만** 펼치고, 점을 누르면 다른 단계를 들여다본다(잠그지 않는다).
//   지금 단계·완료는 서버가 core 줄로 정한다. 화면은 그 값을 그대로 쓴다(따로 세지 않는다).
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
interface StageStep { key: string; stage: number; core: boolean; done: boolean | null }
interface Stages { current: number | null; stage_count: number; steps: StageStep[]; dismissed: boolean }
interface OnboardingState { groups?: Group[]; stages?: Stages }

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
  // ── 팀 적응 단계 줄 (2026-10-09). 위키 글은 seed-wiki-content.js 에 실제로 있는 것만 hasWiki.
  invite_team: { go: '/business/members', action: 'open', hasWiki: true },
  request_task: { go: '/tasks', action: 'open', hasWiki: true },
  project_task: { go: '/projects', action: 'open', hasWiki: true },
  // «말로·AI 로 등록» — AI 로 업무추가 창을 바로 연다(`?ai=1`). 말로 추가(우측 아래)·ChatGPT 연결은 «왜» 줄과 사용법이 안내한다.
  ai_task: { go: '/tasks?ai=1', action: 'open', hasWiki: true },
  team_chat: { go: '/talk', action: 'open', hasWiki: true },
  create_event: { go: '/calendar', action: 'open', hasWiki: true },
  record_meeting: { go: '/notes', action: 'open', hasWiki: true },
  upload_file: { go: '/files', action: 'open', hasWiki: true },
  create_document: { go: '/docs', action: 'open', hasWiki: true },
  client_chat: { go: '/talk', action: 'open', hasWiki: true },
  issue_invoice: { go: '/bills', action: 'open', hasWiki: true },
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
  // 들여다보는 단계 — null 이면 서버가 정한 «지금 단계». 보는 사람의 편의라 저장하지 않는다.
  const [picked, setPicked] = useState<number | null>(null);

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
      if (r.ok) setState((s) => (s ? {
        ...s,
        groups: (s.groups || []).map((g) => ({ ...g, dismissed: true })),
        stages: s.stages ? { ...s.stages, dismissed: true } : s.stages,
      } : s));
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
  const stages = state.stages;
  // 단계가 오면 «워크스페이스» 묶음(고객 초대 → 대화 → 업무 → 메일)은 단계가 대신한다 — 같은 줄을 두 번 시키지 않는다.
  const showStages = !!stages && !stages.dismissed && stages.current !== null && stages.steps.length > 0;
  const groups = state.groups
    .filter((g) => !(stages && g.scope === 'workspace'))
    .filter((g) => !g.dismissed)
    .map((g) => ({ ...g, steps: bannerUp ? g.steps.filter((s) => s.key !== 'enable_notifications') : g.steps }))
    // 다 한 묶음은 조용히 사라진다
    .filter((g) => g.steps.length > 0 && g.steps.some((s) => !s.done));
  if (!showStages && groups.length === 0) return null;

  // 단계 하나가 끝났나 = 그 단계의 core 줄이 모두 «안 끝남(false)» 이 아니다(null = 확인 못 함은 막지 않는다 — 서버와 같은 규칙).
  const stageNos = stages ? Array.from({ length: stages.stage_count }, (_, i) => i + 1) : [];
  const stageDone = (n: number) => !!stages && !stages.steps.some((s) => s.stage === n && s.core && s.done === false);
  const viewStage = showStages ? (picked ?? (stages as Stages).current as number) : null;
  const stageSteps = showStages ? (stages as Stages).steps.filter((s) => s.stage === viewStage) : [];

  const total = groups.reduce((n, g) => n + g.steps.length, 0);
  const done = groups.reduce((n, g) => n + g.steps.filter((s) => s.done).length, 0);

  const renderStep = (key: string, isDone: boolean, optional = false) => {
    const meta = STEP_META[key];
    return (
      <Item key={key} data-testid={`onboarding-step-${key}`} data-done={isDone ? '1' : '0'}>
        <Mark $done={isDone} aria-hidden="true">{isDone ? '✓' : ''}</Mark>
        <Texts>
          <Label $done={isDone}>
            {t(`onboarding.step.${key}.label`, key)}
            {optional && <OptTag>{t('onboarding.optional', '선택')}</OptTag>}
          </Label>
          {!isDone && <Why>{t(`onboarding.step.${key}.why`, '')}</Why>}
        </Texts>
        {!isDone && meta && (
          <Actions>
            <ActionButton tone="secondary" size="sm" onClick={() => void runStep(key)}
              data-testid={`onboarding-go-${key}`}>
              {t(`onboarding.action.${meta.action}`, meta.action)}
            </ActionButton>
            {meta.hasWiki && (
              <ActionButton tone="secondary" size="sm" onClick={() => openWiki(key)}
                data-testid={`onboarding-wiki-${key}`}>
                {t('onboarding.howto', '사용법')}
              </ActionButton>
            )}
          </Actions>
        )}
      </Item>
    );
  };

  return (
    <Card
      role="region"
      aria-label={(showStages ? t('onboarding.stagesTitle', '팀 적응 단계') : t('onboarding.title', '업무 효율 높이기')) as string}
      data-testid="onboarding-checklist"
      data-variant={variant}
    >
      <Head>
        <Title>{showStages ? t('onboarding.stagesTitle', '팀 적응 단계') : t('onboarding.title', '업무 효율 높이기')}</Title>
        {/* 진행 수는 줄이 아니라 **단계** 수다 — 줄 합산(3/17)은 이미 쓰는 팀에게 낙담 숫자다(Fable 2026-10-09). */}
        <Progress data-testid="onboarding-progress">
          {showStages
            ? t('onboarding.stageProgress', '{{done}}/{{total}}단계', { done: stageNos.filter(stageDone).length, total: stageNos.length })
            : t('onboarding.progress', '{{done}}/{{total}}', { done, total })}
        </Progress>
        <Spacer />
        <TextBtn type="button" onClick={toggleCollapsed} aria-expanded={!collapsed} data-testid="onboarding-collapse">
          {collapsed ? t('onboarding.expand', '펼치기') : t('onboarding.collapse', '접기')}
        </TextBtn>
        <TextBtn type="button" onClick={dismiss} disabled={busy} data-testid="onboarding-dismiss">
          {t('onboarding.dismiss', '다시 보지 않기')}
        </TextBtn>
      </Head>
      {!collapsed && showStages && viewStage !== null && (
        <GroupBlock data-testid="onboarding-stages" data-current={String((stages as Stages).current)} data-view={String(viewStage)}>
          <Dots role="tablist" aria-label={t('onboarding.stagesTitle', '팀 적응 단계') as string}>
            {stageNos.map((n) => {
              const isDone = stageDone(n);
              const isCurrent = n === (stages as Stages).current;
              return (
                <Dot key={n} type="button" role="tab" aria-selected={n === viewStage}
                  $view={n === viewStage} $done={isDone} $current={isCurrent}
                  aria-label={t('onboarding.stageAria', '{{n}}단계 {{name}}', { n, name: t(`onboarding.stage.${n}.name`, '') }) as string}
                  data-testid={`onboarding-stage-dot-${n}`}
                  onClick={() => setPicked(n === (stages as Stages).current ? null : n)}>
                  {isDone ? '✓' : n}
                </Dot>
              );
            })}
          </Dots>
          {/* 선택 단계 이름은 보이는 글자로 — title 은 터치 기기에서 안 뜬다. */}
          <StageHead>
            <StageName data-testid="onboarding-stage-name">
              {t('onboarding.stageLabel', '{{n}}단계 · {{name}}', { n: viewStage, name: t(`onboarding.stage.${viewStage}.name`, '') })}
              {viewStage === (stages as Stages).current && <NowTag>{t('onboarding.now', '지금')}</NowTag>}
            </StageName>
            <TextBtn type="button" onClick={() => askCue(t('onboarding.stagesWikiQuery', '팀이 PlanQ 에 적응하는 5단계') as string, 'wiki')}
              data-testid="onboarding-stages-guide">
              {t('onboarding.stagesGuide', '단계 안내 글')}
            </TextBtn>
          </StageHead>
          <StageWhy>{t(`onboarding.stage.${viewStage}.why`, '')}</StageWhy>
          {stageSteps.map((s) => renderStep(s.key, s.done === true, !s.core))}
        </GroupBlock>
      )}
      {!collapsed && groups.map((g) => (
        <GroupBlock key={g.scope} data-testid={`onboarding-group-${g.scope}`}>
          <GroupLabel>
            {g.scope === 'workspace' ? t('onboarding.groupWorkspace', '워크스페이스') : t('onboarding.groupMe', '나')}
          </GroupLabel>
          {g.steps.map((s) => renderStep(s.key, s.done))}
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
const OptTag = styled.span`
  margin-left: 6px; padding: 1px 6px; border-radius: 999px; vertical-align: 1px;
  background: #F1F5F9; color: #64748B; font-size: 0.625rem; font-weight: 700;
  text-decoration: none; display: inline-block;
`;
// 단계 점 — 컨트롤이라 터치 높이를 지킨다(폰 40). 줄이 넘치면 가로로 흘린다(감기지 않게).
const Dots = styled.div`
  display: flex; gap: 6px; padding: 6px 0; overflow-x: auto; scrollbar-width: none;
  &::-webkit-scrollbar { display: none; }
`;
const Dot = styled.button<{ $view: boolean; $done: boolean; $current: boolean }>`
  flex-shrink: 0; width: ${CONTROL.sm}px; height: ${CONTROL.sm}px; border-radius: 999px;
  ${mediaPhone} { width: 40px; height: 40px; }
  display: inline-flex; align-items: center; justify-content: center;
  font-family: inherit; font-size: 0.8125rem; font-weight: 700; cursor: pointer;
  border: 1px solid ${(p) => (p.$view ? '#14B8A6' : p.$done ? '#99F6E4' : '#E2E8F0')};
  background: ${(p) => (p.$done ? '#F0FDFA' : p.$view ? '#FFFFFF' : '#FFFFFF')};
  color: ${(p) => (p.$done ? '#0F766E' : p.$view || p.$current ? '#0F172A' : '#94A3B8')};
  box-shadow: ${(p) => (p.$view ? '0 0 0 2px rgba(20,184,166,0.25)' : 'none')};
  &:focus-visible { outline: 2px solid rgba(15,118,110,0.5); outline-offset: 2px; }
`;
const StageHead = styled.div`display: flex; align-items: center; gap: 8px; border-top: 1px solid #F1F5F9; padding-top: 6px;`;
const StageName = styled.h3`
  margin: 0; flex: 1 1 auto; min-width: 0;
  font-size: 0.8125rem; font-weight: 700; color: #0F172A;
`;
const NowTag = styled.span`
  margin-left: 6px; padding: 1px 6px; border-radius: 999px; vertical-align: 1px;
  background: #F0FDFA; color: #0F766E; font-size: 0.625rem; font-weight: 700; display: inline-block;
`;
const StageWhy = styled.p`margin: 0 0 4px; font-size: 0.75rem; color: #64748B; line-height: 1.5;`;
const TextBtn = styled.button`
  flex-shrink: 0; height: ${CONTROL.sm}px; padding: 0 8px;
  border: none; background: transparent; color: #64748B;
  font-size: 0.75rem; font-weight: 600; font-family: inherit; cursor: pointer;
  &:hover { color: #0F172A; text-decoration: underline; }
  &:disabled { opacity: 0.5; cursor: default; }
  &:focus-visible { outline: 2px solid rgba(15,118,110,0.5); outline-offset: 2px; }
`;

export default OnboardingChecklist;
