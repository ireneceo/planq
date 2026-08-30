// 글로벌 통합 검색 모달 — ⌘K / Ctrl+\ 또는 사이드바 검색박스 클릭으로 진입.
// GET /api/search?business_id=X&q=... → 도메인별 결과 (tasks/posts/records/files/...).
// 좌측 카테고리 (필터) + 우측 결과. Notion / Linear / Slack 패턴.
import React, { useEffect, useState, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useChromeNav } from '../../hooks/useChromeNav';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { useEscapeStack } from '../../hooks/useEscapeStack';
import { apiFetch, useAuth } from '../../contexts/AuthContext';
import { visibleNavMenus, SECTION_LABEL_KEY, type NavMenuEntry } from '../../config/navMenus';
import Spinner from './Spinner';
import { askCue } from '../../utils/cueAsk';
import { useCueChat, cueActionDeepLink } from '../../hooks/useCueChat';
import CueTurnList from './CueTurnList';
import { useChromeLocation } from '../../hooks/useChromeNav';
import { tabStore } from '../../stores/tabStore';

interface Props {
  open: boolean;
  onClose: () => void;
  businessId: number;
  // ⑥ 멀티탭 — 결과를 새 탭으로 열기 등 커스텀 네비. 미지정 시 현재 탭 이동(기본).
  onNavigate?: (to: string) => void;
}

// #359 — 'records' 제거. Q record 는 폐지돼 Q docs 의 표로 흡수됐다(App.tsx:122).
//   백엔드도 이제 빈 배열만 낸다 — 같은 항목이 '문서' 와 '레코드' 로 두 번 뜨던 중복을 없앤다.
type Category = 'tasks' | 'posts' | 'files' | 'conversations' | 'knowledge' | 'clients' | 'projects';

interface Hit {
  id: number;
  title: string;       // 표시 라벨
  sub?: string;        // 서브 라벨 (카테고리 등)
  to: string;          // 라우트
  type: Category;
}

interface SearchResult {
  tasks?: Array<{ id: number; title: string; status?: string; project_id?: number | null }>;
  posts?: Array<{ id: number; title: string; category?: string | null; project_id?: number | null }>;
  files?: Array<{ id: number; file_name: string; file_size?: number; mime_type?: string | null }>;
  conversations?: Array<{ id: number; title?: string; display_name?: string; project_id?: number | null }>;
  knowledge?: Array<{ id: number; title: string; category?: string | null; scope?: string }>;
  clients?: Array<{ id: number; display_name?: string; company_name?: string; email?: string }>;
  projects?: Array<{ id: number; name: string; status?: string }>;
}

// 카테고리 라벨 i18n fallback (ko) — 표시는 t('search.cat.<key>') 로
const CAT_LABEL_KO: Record<Category, string> = {
  tasks: '업무', posts: '문서', files: '파일',
  conversations: '대화', knowledge: '지식', clients: '고객', projects: '프로젝트',
};

const CAT_BADGE_COLOR: Record<Category, string> = {
  tasks: '#0EA5E9', posts: '#F43F5E',
  files: '#64748B', conversations: '#14B8A6', knowledge: '#0D9488', clients: '#F59E0B', projects: '#10B981',
};

// #210 — 메뉴 매칭 정규화: 대소문자·공백·중점 무시("q mail" → "qmail", "Q Bill" → "qbill")
const normalize = (s: string) => s.toLowerCase().replace(/[\s·.]/g, '');

const GlobalSearchModal: React.FC<Props> = ({ open, onClose, businessId, onNavigate }) => {
  const { t } = useTranslation('common');
  const { t: tNav } = useTranslation('layout');   // #210 — 메뉴 라벨은 사이드바와 같은 layout ns 키
  const { user } = useAuth();
  const navigate = useChromeNav();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<SearchResult>({});
  const [loading, setLoading] = useState(false);
  // #305 — "검색이랑 상단 탭 열 때 최신글이나 문서 등 이런거 보여주는 거 기본 아니야? 검색 전에."
  //   빈 검색창은 아무것도 못 하는 화면이었다. 열자마자 최근에 손댄 것을 보여준다.
  const [recent, setRecent] = useState<SearchResult>({});

  // #233 — **검색창 안에서** Cue 답변을 텍스트로 본다. 여태는 Cue 창을 열어주고 끝이라
  //   "결과 내용이 텍스트로 나오게" 라는 요구의 절반만 채워져 있었다.
  //   ★ 새 대화 로직을 만들지 않는다 — #227 에서 뽑은 코어(useCueChat + CueTurnList)를 그대로 쓴다.
  const { t: tErr } = useTranslation('errors');
  const chromeLoc = useChromeLocation();
  const cue = useCueChat({
    isGuest: !user,
    mode: 'workspace',
    location: { pathname: chromeLoc.pathname, search: chromeLoc.search },
    tErr: tErr as unknown as (k: string, d?: string) => string,
    translateError: (code: string) => (
      code === 'rate_limit_minute' ? (t('qhelper.rateLimitMinute', '잠깐만요 — 너무 빠르게 묻고 있어요. 1분 후 다시 시도해주세요.') as string)
        : code === 'rate_limit_day' ? (t('qhelper.rateLimitDay', '오늘 안내 횟수를 초과했습니다. 자세한 내용은 문의 남기기 탭으로 알려주세요.') as string)
          : null
    ),
  });
  const { setInput: setCueInput, submit: cueSubmit, setTurns: setCueTurns } = cue;
  // 검색어를 바꾸면 Cue 입력도 따라간다 — 사용자가 친 문장이 곧 질문이다.
  useEffect(() => { setCueInput(query); }, [query, setCueInput]);
  // 모달을 닫으면 대화를 비운다. 다음에 열었을 때 옛 답이 남아 있으면
  //   "왜 내가 안 물은 답이 있지" 가 된다 — 검색창은 매번 새로 시작하는 자리다.
  useEffect(() => { if (!open) setCueTurns([]); }, [open, setCueTurns]);

  useBodyScrollLock(open);
  useEscapeStack(open, onClose);

  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 50); }, [open]);
  useEffect(() => { if (!open) { setQuery(''); setResult({}); } }, [open]);
  useEffect(() => {
    if (!open || !businessId) return;
    let alive = true;
    (async () => {
      const r = await apiFetch(`/api/search/recent?business_id=${businessId}&limit=5`);
      // apiFetch 는 throw 하지 않는다 — res.ok 를 본다. 실패하면 조용히 빈 상태(옛 안내 문구)로 둔다.
      if (!r.ok) return;
      const j = await r.json().catch(() => null);
      if (alive && j?.success) setRecent(j.data || {});
    })();
    return () => { alive = false; };
  }, [open, businessId]);

  // debounce 검색
  // #301 — "글자 하나 하나 넣을 때 바로 바로 검색 결과가 자동으로 되어야" .
  //   ① debounce 250 → 120ms ② **이전 결과를 지우지 않는다**(지우면 글자마다 화면이 비워졌다 채워져
  //   깜빡인다) ③ 늦게 도착한 옛 응답이 새 결과를 덮어쓰지 않게 세대 번호로 차단.
  const reqSeq = useRef(0);
  useEffect(() => {
    if (!query.trim()) { setResult({}); setLoading(false); return; }
    setLoading(true);
    const seq = ++reqSeq.current;
    const timer = setTimeout(async () => {
      const r = await apiFetch(`/api/search?business_id=${businessId}&q=${encodeURIComponent(query)}&limit=8`);
      if (seq !== reqSeq.current) return;        // 더 새로운 요청이 이미 나갔다 — 이 응답은 버린다
      if (!r.ok) { setLoading(false); return; }  // apiFetch 는 throw 하지 않는다
      const j = await r.json().catch(() => null);
      if (seq !== reqSeq.current) return;
      if (j?.success) setResult(j.data || {});
      setLoading(false);
    }, 120);
    return () => clearTimeout(timer);
  }, [query, businessId]);

  // ★ 검색 결과와 '최근 항목' 은 **같은 변환기**를 쓴다. 두 벌로 만들면 한쪽만 링크가 바뀌어
  //   "검색으로 열면 되는데 최근에서 열면 안 되는" 상태가 된다.
  const toHits = React.useCallback((r: SearchResult): Hit[] => {
    const h: Hit[] = [];
    // #206 — status 를 raw 로 내보내면 `on_hold` 같은 snake_case 가 사용자에게 그대로 노출된다.
    (r.tasks || []).forEach(x => h.push({ id: x.id, title: x.title, sub: x.status ? t(`qtask:status.${x.status}.observer`, { defaultValue: x.status }) as string : undefined, to: `/tasks?task=${x.id}`, type: 'tasks' }));
    (r.posts || []).forEach(x => h.push({ id: x.id, title: x.title, sub: x.category || undefined, to: `/docs?post=${x.id}`, type: 'posts' }));
    (r.files || []).forEach(x => h.push({ id: x.id, title: x.file_name, sub: x.mime_type || undefined, to: `/files?file=${x.id}`, type: 'files' }));
    (r.conversations || []).forEach(x => h.push({ id: x.id, title: x.display_name || x.title || `#${x.id}`, to: `/talk?conv=${x.id}`, type: 'conversations' }));
    (r.knowledge || []).forEach(x => h.push({ id: x.id, title: x.title, sub: x.category || undefined, to: `/knowledge?doc=${x.id}`, type: 'knowledge' }));
    (r.clients || []).forEach(x => h.push({ id: x.id, title: x.display_name || x.company_name || `#${x.id}`, sub: x.email || undefined, to: `/business/clients?client=${x.id}`, type: 'clients' }));
    (r.projects || []).forEach(x => h.push({ id: x.id, title: x.name, sub: x.status, to: `/projects/p/${x.id}`, type: 'projects' }));
    return h;
  }, [t]);   // #206 — 상태 라벨 i18n → 언어 전환 시 재계산

  const allHits: Hit[] = useMemo(() => toHits(result), [result, toHits]);
  const recentHits: Hit[] = useMemo(() => toHits(recent), [recent, toHits]);   // #206 — 상태 라벨 i18n 사용 → 언어 전환 시 재계산

  // #210 — 메뉴(페이지) 이동 결과. 검색어가 없으면 전체 메뉴 목록(= '+' 로 새 탭 열 때 메뉴 고르기),
  //         있으면 메뉴 이름·별칭·경로 매칭. 사이드바와 같은 역할 조건(config/navMenus)을 쓴다.
  const menus = useMemo(
    () => visibleNavMenus({ businessRole: user?.business_role, isPlatformAdmin: user?.platform_role === 'platform_admin' }),
    [user?.business_role, user?.platform_role],
  );
  const menuLabel = React.useCallback((m: NavMenuEntry) => tNav(m.labelKey) as string, [tNav]);
  // 검색 동의어는 언어별 콘텐츠 — locales layout `nav.searchAliases.<key>` (쉼표 구분, 없으면 빈 값)
  const menuAliases = React.useCallback(
    (m: NavMenuEntry) => String(tNav(`nav.searchAliases.${m.key}`, { defaultValue: '' })).split(',').filter(Boolean),
    [tNav],
  );
  const menuHits = useMemo(() => {
    const nq = normalize(query.trim());
    if (!nq) return menus;
    return menus.filter((m) => {
      const hay = [menuLabel(m), m.key, m.to, ...menuAliases(m)].map(normalize);
      return hay.some((h) => h.includes(nq));
    }).slice(0, 8);
  }, [menus, query, menuLabel, menuAliases]);

  const goto = (to: string) => { onClose(); (onNavigate || navigate)(to); };

  if (!open) return null;

  // ★ document.body 로 포탈 — 부모의 stacking context 안에 갇히지 않게.
  //   여기를 그냥 제자리에 렌더하면 **부모가 z-index 를 가진 순간 이 모달의 z-index 1100 은
  //   그 부모 안에서만 유효**해진다. 실제로 탭바(TabStrip: position:fixed·z-index 95)가 이 모달을
  //   자식으로 렌더하고 있어서, 탭 + 버튼으로 연 검색창이 앱 사이드바(z 100)·패널 접기 화살표(z 900)
  //   **아래로** 깔렸다(Irene 신고: "화살표 버튼이 검색창 위로 나와"). 사이드바 검색(⌘K)은 같은
  //   컴포넌트인데도 부모가 stacking context 가 아니라 멀쩡했다 — 그래서 한쪽만 이상해 보였다.
  //   집을 옮기지 않고 z-index 만 올리면 다음 부모에서 같은 일이 반복된다.
  const node = (
    <Backdrop onClick={onClose}>
      <Dialog onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={t('search.title', '통합 검색') as string}>
        <SearchHeader>
          <SearchIconSvg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </SearchIconSvg>
          <SearchInput
            ref={inputRef} type="text" value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={t('search.placeholder', '메뉴·업무·문서·파일·고객 모두 검색') as string}
          />
          {loading && <Spinner size={14} color="muted" />}
          <Kbd onClick={onClose}>Esc</Kbd>
        </SearchHeader>

        <Results>
          {/* Cue 진입 (Fable ③) — Irene: "cue 채팅창이 Q help 말고도 어디에 쉽게 들어가야 하지 않아? 검색창처럼."
              ★ 새 단축키·새 표면을 만들지 않는다. CueHelpDrawer 는 이미 전역이고(⌘?/Ctrl+/ · RightDock FAB),
                부족한 것은 **존재가 아니라 발견성**이다. 검색창에 질문형 문장을 친 사용자를 Cue 로
                넘기는 다리 하나면 된다. `cue:ask` 이벤트가 이미 있어 신규 배선이 없다. */}
          {/* ★ 답변이 오는 중에는 이 항목을 내리지 않는다 — 그때 누르면 submitting 가드에 막혀
              **아무 일도 안 일어난다**(Fable 실측: POST +0). 자기치유되는 좁은 창이지만
              "오류 없이 산출물만 0" 계열이라 애초에 누를 수 없게 한다. */}
          {query.trim() && cue.turns.length === 0 && !cue.submitting && (
            <Hit type="button" data-testid="search-ask-cue"
              // ★ 질문을 **인자로** 넘긴다. setInput 후 곧바로 submit() 하면 빈 클로저를 읽어
              //   조용히 아무 일도 안 일어난다(Fable 적발 — 두 번 눌러야 발화했다).
              onClick={() => cueSubmit(query.trim())}>
              <TypeBadge $color="#F43F5E">{t('search.cueBadge') as string}</TypeBadge>
              <HitMain>
                <HitTitle>{t('search.askCue', { q: query.trim() }) as string}</HitTitle>
                <HitSub>{t('search.askCueHint', '여기서 바로 답을 보여드려요') as string}</HitSub>
              </HitMain>
            </Hit>
          )}

          {/* #233 — 답변을 **이 자리에** 텍스트로. 확인 카드(업무·일정 추가)도 그대로 뜬다. */}
          {cue.turns.length > 0 && (
            <CueAnswerBox data-testid="search-cue-answer">
              <CueTurnList
                turns={cue.turns}
                mode="workspace"
                businessId={user?.business_id ?? null}
                onFeedback={cue.sendAnswerFeedback}
                onActionExecuted={cue.onActionExecuted}
                onActionDismiss={cue.onActionDismiss}
                // 만든 것은 **새 탭**으로 — 검색창은 하던 일 위에 얹히는 자리다.
                onOpenResult={(r) => { onClose(); tabStore.openInNewTab(cueActionDeepLink(r)); }}
              />
              <CueFootRow>
                <CueFootBtn type="button" data-testid="search-cue-continue"
                  onClick={() => { const q = cue.turns[cue.turns.length - 1]?.q || query.trim(); onClose(); askCue(q, 'cue'); }}>
                  {t('search.cueContinue', 'Cue 창에서 이어서 묻기') as string} ↗
                </CueFootBtn>
                <CueFootBtn type="button" onClick={() => cue.setTurns([])}>
                  {t('search.cueClear', '지우고 검색으로') as string}
                </CueFootBtn>
              </CueFootRow>
            </CueAnswerBox>
          )}
          {/* #210 — 메뉴 이동. 검색어 없을 때는 전체 메뉴가 그대로 목록이 된다(고르면 그 페이지로) */}
          {menuHits.length > 0 && (
            <>
              <GroupTitle>{t('search.menus', { defaultValue: '메뉴' }) as string}</GroupTitle>
              {menuHits.map(m => (
                <Hit key={`menu-${m.key}`} type="button" data-testid={`gsearch-menu-${m.key}`} onClick={() => goto(m.to)}>
                  <TypeBadge $color="#0F766E">{tNav(SECTION_LABEL_KEY[m.section]) as string}</TypeBadge>
                  <HitMain>
                    <HitTitle>{menuLabel(m)}</HitTitle>
                    <HitSub>{m.to}</HitSub>
                  </HitMain>
                </Hit>
              ))}
            </>
          )}

          {!query.trim() ? (
            /* #305 — 검색 전에도 할 일이 있어야 한다. 최근에 손댄 것을 바로 연다. */
            recentHits.length > 0 ? (
              <>
                <GroupTitle>{t('search.recent', { defaultValue: '최근 항목' }) as string}</GroupTitle>
                {recentHits.map(h => (
                  <Hit key={`recent-${h.type}-${h.id}`} type="button" onClick={() => goto(h.to)}>
                    <TypeBadge $color={CAT_BADGE_COLOR[h.type]}>{t(`search.cat.${h.type}`, { defaultValue: CAT_LABEL_KO[h.type] })}</TypeBadge>
                    <HitMain>
                      <HitTitle>{h.title}</HitTitle>
                      {h.sub && <HitSub>{h.sub}</HitSub>}
                    </HitMain>
                  </Hit>
                ))}
                <FootHint>{t('search.hint', '검색어를 입력하세요. ⌘K 또는 Ctrl+\\ 로도 열 수 있습니다.')}</FootHint>
              </>
            ) : menuHits.length > 0
              ? <FootHint>{t('search.hint', '검색어를 입력하세요. ⌘K 또는 Ctrl+\\ 로도 열 수 있습니다.')}</FootHint>
              : <Hint>{t('search.hint', '검색어를 입력하세요. ⌘K 또는 Ctrl+\\ 로도 열 수 있습니다.')}</Hint>
          ) : allHits.length === 0 ? (
            (loading || menuHits.length === 0) && (
              <Hint>{loading ? t('search.searching', '검색 중...') : t('search.noResults', '결과 없음')}</Hint>
            )
          ) : (
            <>
              <GroupTitle>{t('search.results', { defaultValue: '검색 결과' }) as string}</GroupTitle>
              {allHits.map(h => (
                <Hit key={`${h.type}-${h.id}`} type="button" onClick={() => goto(h.to)}>
                  <TypeBadge $color={CAT_BADGE_COLOR[h.type]}>{t(`search.cat.${h.type}`, { defaultValue: CAT_LABEL_KO[h.type] })}</TypeBadge>
                  <HitMain>
                    <HitTitle>{h.title}</HitTitle>
                    {h.sub && <HitSub>{h.sub}</HitSub>}
                  </HitMain>
                </Hit>
              ))}
            </>
          )}
        </Results>
      </Dialog>
    </Backdrop>
  );

  return typeof document !== 'undefined' ? createPortal(node, document.body) : node;
};

export default GlobalSearchModal;

// ─── styled ───
const Backdrop = styled.div`
  position: fixed; inset: 0; background: rgba(15,23,42,0.5);
  display: flex; align-items: flex-start; justify-content: center;
  padding-top: 80px; z-index: 1100;
  @media (max-width: 640px) { padding-top: 0; align-items: stretch; }
`;
const Dialog = styled.div`
  width: 100%; max-width: 720px;
  max-height: calc(100vh - 120px);
  display: flex; flex-direction: column;
  background: #FFFFFF; border-radius: 14px;
  box-shadow: 0 24px 48px rgba(15,23,42,0.25);
  overflow: hidden;
  @media (max-width: 640px) {
    max-width: none; max-height: none; border-radius: 0;
    margin-top: 60px; height: calc(100vh - 60px); height: calc(100dvh - 60px);
  }
`;
const SearchHeader = styled.div`
  display: flex; align-items: center; gap: 10px;
  padding: 14px 18px;
  border-bottom: 1px solid #F1F5F9;
  flex-shrink: 0;
`;
const SearchIconSvg = styled.svg`width: 16px; height: 16px; color: #94A3B8; flex-shrink: 0;`;
const SearchInput = styled.input`
  flex: 1; height: 28px;
  border: none; outline: none;
  font-size: 0.9375rem; color: #0F172A; background: transparent;
  &::placeholder { color: #94A3B8; }
`;
const Kbd = styled.button`
  font-size: 0.6875rem; font-weight: 600; font-family: inherit;
  padding: 2px 8px;
  background: #F1F5F9; border: 1px solid #E2E8F0; border-radius: 6px;
  color: #64748B; cursor: pointer;
  &:hover { background: #E2E8F0; }
`;
// #233 — 검색창 안의 Cue 답변 영역. 결과 목록과 섞이지 않게 옅은 바탕으로 구분한다.
const CueAnswerBox = styled.div`
  border: 1px solid #fecdd3;
  background: #fff1f2;
  border-radius: 10px;
  padding: 10px 12px;
  margin-bottom: 6px;
`;
const CueFootRow = styled.div`
  display: flex; gap: 10px; flex-wrap: wrap;
  margin-top: 8px; padding-top: 8px;
  border-top: 1px solid #fecdd3;
`;
const CueFootBtn = styled.button`
  background: none; border: none; padding: 0; cursor: pointer;
  font-size: 0.75rem; font-weight: 600; color: #E11D48;
  &:hover { text-decoration: underline; }
  &:focus-visible { outline: 2px solid rgba(244,63,94,0.4); outline-offset: 2px; }
`;

const Results = styled.div`
  flex: 1; min-height: 0;
  display: flex; flex-direction: column; gap: 2px;
  padding: 8px;
  overflow-y: auto;
`;
const Hint = styled.div`
  padding: 40px 20px; text-align: center;
  font-size: 0.8125rem; color: #94A3B8;
`;
// #210 — 메뉴 목록이 이미 보일 때의 하단 안내 (큰 여백 없이 한 줄)
const FootHint = styled.div`
  padding: 10px 12px 4px; text-align: center;
  font-size: 0.75rem; color: #CBD5E1;
`;
// #210 — 결과 그룹 헤더 (메뉴 / 검색 결과)
const GroupTitle = styled.div`
  padding: 8px 12px 4px;
  font-size: 0.6875rem; font-weight: 700; letter-spacing: 0.4px;
  color: #94A3B8; text-transform: uppercase;
`;
const Hit = styled.button`
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px;
  background: transparent; border: none; border-radius: 8px;
  text-align: left; cursor: pointer;
  &:hover { background: #F0FDFA; }
  &:focus-visible { outline: 2px solid rgba(20,184,166,0.4); outline-offset: 2px; }
`;
const TypeBadge = styled.span<{ $color: string }>`
  flex-shrink: 0;
  padding: 2px 8px;
  background: ${p => p.$color}1A;
  color: ${p => p.$color};
  border-radius: 4px;
  font-size: 0.625rem; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.3px;
`;
const HitMain = styled.div`flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px;`;
const HitTitle = styled.div`
  font-size: 0.8125rem; color: #0F172A; font-weight: 500;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
`;
const HitSub = styled.div`
  font-size: 0.6875rem; color: #94A3B8;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
`;
