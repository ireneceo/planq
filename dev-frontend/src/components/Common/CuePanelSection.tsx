// components/Common/CuePanelSection.tsx — 채팅·메일 우측 패널에서 쓰는 Cue 대화 섹션 (#227).
//
// Q helper 드로어와 **같은 코어**를 쓴다 (hooks/useCueChat + CueTurnList).
// 여기 있는 것은 껍데기뿐이다 — 입력줄, 빈 상태 문구, 대화 캐시.
//
// ★ 대화 캐시가 왜 필요한가:
//   메일 우측 패널(MailContextPanel)은 접으면 **언마운트된다**. 캐시가 없으면 패널을
//   접었다 펴는 것만으로 Cue 와 나눈 대화가 통째로 사라진다 — 사용자에겐 "지워졌다" 로 보인다.
//   대화방/스레드별로 모듈 스코프에 담아 둔다(탭을 옮겼다 돌아와도 이어진다).
//
// ★ 딥링크는 **새 탭**으로 연다. 드로어처럼 현재 탭을 덮으면 보던 채팅·메일을 잃는다
//   (CLAUDE.md 「하던 일 위에 얹히는 진입점은 새 탭」).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { useCueChat, cueActionDeepLink, type CueTurn } from '../../hooks/useCueChat';
import CueTurnList from './CueTurnList';
import { tabStore } from '../../stores/tabStore';
import { isEnterAction } from '../../utils/imeKey';

// 대화방/스레드별 대화 캐시 — 언마운트를 견딘다. 세션 동안만 산다(새로고침하면 초기화).
const turnCache = new Map<string, CueTurn[]>();
const MAX_CACHE_KEYS = 30;

const Wrap = styled.div`
  display: flex; flex-direction: column; gap: 8px;
`;
const Empty = styled.div`
  font-size: 0.75rem; color: #94a3b8; line-height: 1.5;
`;
const InputRow = styled.div`
  display: flex; gap: 6px; align-items: flex-end;
`;
const TextArea = styled.textarea`
  flex: 1; min-width: 0;
  border: 1px solid #e2e8f0; border-radius: 8px;
  padding: 8px 10px; font-size: 0.8125rem; line-height: 1.45;
  resize: none; max-height: 120px; font-family: inherit; color: #0f172a;
  &:focus { outline: none; border-color: #F43F5E; }
  &::placeholder { color: #cbd5e1; }
`;
const SendBtn = styled.button`
  flex-shrink: 0; height: 36px; padding: 0 12px;
  border: none; border-radius: 8px;
  background: #F43F5E; color: #fff;
  font-size: 0.75rem; font-weight: 600; cursor: pointer;
  &:disabled { background: #fda4af; cursor: not-allowed; }
  &:focus-visible { outline: 2px solid rgba(244,63,94,0.4); outline-offset: 1px; }
`;
const Scroll = styled.div`
  max-height: 320px; overflow-y: auto;
`;

interface Props {
  /** 캐시 키의 축 — 'qtalk' | 'qmail' 등 표면 이름 */
  surface: string;
  /** 보고 있는 대상 id (대화방·스레드). 바뀌면 대화도 그 대상의 것으로 바뀐다. */
  subjectId: number | null;
  /**
   * 서버가 컨텍스트를 읽는 근거. **URL 에 기대지 않는다.**
   *   Q Talk 은 대화방을 골라도 URL 을 쓰지 않는다(읽기만 한다 — QTalkPage.tsx:305 실측).
   *   그래서 `useChromeLocation` 을 그대로 넘기면 `?conv=` 가 영원히 안 실려 이 기능이
   *   조용히 죽는다. 표면이 자기가 보고 있는 것을 **직접** 말한다.
   */
  contextParam?: { key: 'conv' | 'thread'; id: number | null };
  /** 화면 경로 (path 기반 컨텍스트용 — 프로젝트 상세 등) */
  location: { pathname: string; search?: string };
  /** 빈 상태 안내 문구 */
  placeholder?: string;
  testId?: string;
}

export default function CuePanelSection({ surface, subjectId, location, contextParam, placeholder, testId }: Props) {
  const { t } = useTranslation('common');
  const { t: tErr } = useTranslation('errors');
  const { user } = useAuth();
  const taRef = useRef<HTMLTextAreaElement>(null);
  const cacheKey = `${surface}:${subjectId ?? 'none'}`;
  const [restored, setRestored] = useState(false);

  // 화면이 준 컨텍스트를 search 에 **덧붙여서** 보낸다 — URL 이 갖고 있든 아니든 항상 실린다.
  const effLocation = useMemo(() => {
    if (!contextParam?.id) return location;
    const sp = new URLSearchParams((location.search || '').replace(/^\?/, ''));
    sp.set(contextParam.key, String(contextParam.id));
    return { pathname: location.pathname, search: `?${sp.toString()}` };
  }, [location.pathname, location.search, contextParam?.key, contextParam?.id]);

  const chat = useCueChat({
    isGuest: !user,
    mode: 'workspace',
    location: effLocation,
    tErr: tErr as unknown as (k: string, d?: string) => string,
    translateError: (code: string) => (
      code === 'rate_limit_minute' ? (t('qhelper.rateLimitMinute', '잠깐만요 — 너무 빠르게 묻고 있어요. 1분 후 다시 시도해주세요.') as string)
        : code === 'rate_limit_day' ? (t('qhelper.rateLimitDay', '오늘 안내 횟수를 초과했습니다. 자세한 내용은 문의 남기기 탭으로 알려주세요.') as string)
          : null
    ),
    onAfterSend: () => { if (taRef.current) taRef.current.style.height = ''; },
    // 갱신될 때마다 캐시에 담는다 — 언마운트돼도 살아남는다.
    onTurnsChange: (turns) => {
      turnCache.set(cacheKey, turns);
      while (turnCache.size > MAX_CACHE_KEYS) {
        const oldest = turnCache.keys().next().value;
        if (oldest === undefined) break;
        turnCache.delete(oldest);
      }
    },
  });
  const { setTurns } = chat;

  // 마운트/대상 변경 시 그 대상의 대화를 되살린다.
  //   ★ setTurns 는 onTurnsChange 를 태우므로 여기서 부르면 캐시를 자기 값으로 다시 쓴다(무해).
  useEffect(() => {
    setRestored(false);
    setTurns(turnCache.get(cacheKey) || []);
    setRestored(true);
  }, [cacheKey, setTurns]);

  const onKey = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // ★ 채팅 입력은 Enter 전송 · Shift+Enter 줄바꿈 (Irene 2026-09-03: "채팅솔루션들 모두 엔터가
    //   보내기야 … 이거 모든 입력란에 통일하자"). Q talk · Cue 드로어 · Q note 질문줄 ·
    //   Q task Cue바 · 게스트 채팅이 이미 그렇게 동작하는데 **이 패널만 ⌘+Enter 였다.**
    //   같은 앱에서 어떤 Cue 는 Enter 로 가고 어떤 Cue 는 안 가면 그 자체가 고장으로 느껴진다.
    //   ※ UI_DESIGN_GUIDE 1.8 의 "Enter 단독 저장 금지" 는 **생성·승인 같은 폼 액션** 규칙이다.
    //     되돌릴 수 없는 것(청구서 발행 등)에 적용되는 것이지, 대화 입력에 적용되는 규칙이 아니다.
    //   ※ isEnterAction 은 한글 조합 중 Enter(확정)를 걸러낸다 — 그것 없이 바꾸면 한글 사용자가
    //     마지막 글자를 확정하는 순간 전송된다(utils/imeKey).
    // Enter=보내기 / Shift+Enter=줄바꿈. placeholder 문구도 이 동작을 그대로 말해야 한다
    // (2026-09-03 — 동작은 Enter 인데 안내는 ⌘/Ctrl+Enter 라고 적혀 있었다).
    if (isEnterAction(e) && !e.shiftKey) { e.preventDefault(); chat.submit(); }
  }, [chat]);

  return (
    <Wrap data-testid={testId}>
      {restored && chat.turns.length === 0 && (
        <Empty>{placeholder || (t('cuePanel.empty', '보고 있는 내용을 그대로 물어보세요. 업무·일정 추가도 여기서 됩니다.') as string)}</Empty>
      )}
      {chat.turns.length > 0 && (
        <Scroll>
          <CueTurnList
            turns={chat.turns}
            mode="workspace"
            businessId={user?.business_id ?? null}
            onFeedback={chat.sendAnswerFeedback}
            onActionExecuted={chat.onActionExecuted}
            onActionDismiss={chat.onActionDismiss}
            // ★ 새 탭 — 보던 채팅·메일을 덮지 않는다.
            onOpenResult={(r) => tabStore.openInNewTab(cueActionDeepLink(r))}
          />
        </Scroll>
      )}
      <InputRow>
        <TextArea
          ref={taRef}
          rows={1}
          value={chat.input}
          onChange={(e) => {
            chat.setInput(e.target.value);
            e.target.style.height = ''; e.target.style.height = `${Math.min(120, e.target.scrollHeight)}px`;
          }}
          onKeyDown={onKey}
          placeholder={t('cuePanel.placeholder', 'Cue 에게 물어보기 (Enter 로 보내기 · Shift+Enter 줄바꿈)') as string}
          aria-label={t('cuePanel.aria', 'Cue 에게 물어보기') as string}
        />
        <SendBtn type="button" onClick={() => chat.submit()} disabled={!chat.input.trim() || chat.submitting}>
          {chat.submitting ? (t('cuePanel.sending', '…') as string) : (t('cuePanel.send', '묻기') as string)}
        </SendBtn>
      </InputRow>
    </Wrap>
  );
}
