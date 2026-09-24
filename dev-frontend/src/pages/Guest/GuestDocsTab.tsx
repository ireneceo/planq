// 무로그인 열람 — **문서 탭** (설계 docs/PROJECT_EXTERNAL_VIEW_DESIGN.md §8 2차)
//
// 축이 둘이고 역할이 다르다(서버 routes/guest_project.js 와 같은 규약):
//   `vlevel`         = 필터 — L1(개인)은 **행 자체가 없다.** 로그인해도 고객은 못 보므로
//                      "로그인하면 볼 수 있어요" 라고 하면 그 문장이 거짓이 된다.
//   `security_level` = 잠금 — general 열림 / internal 자리는 보이고 잠김 /
//                      confidential 은 제목도 안 나가고 **건수만**.
//
// ★ 잠긴 카드는 "안 눌린다" 가 아니라 **로그인·계정 요청 시트**(LoginRequiredSheet, 페이지 한 벌)를 띄운다.
//   눌러도 아무 일 없는 카드는 사용자에게 고장으로 보인다(memory feedback_rules_must_be_explained_briefly).
// ★ 2026-09-24 카드형(§D)·필터(§F)·껍데기(§C) — 목록은 Q file 카드와 같은 숫자(guestCards.ts).
// ★ 본문은 편집기를 띄우지 않고 headless 변환 + 정화만 한다(utils/postContentHtml).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import { postContentToSafeHtml } from '../../utils/postContentHtml';
import { postContentTableCss } from '../../styles/postContentView';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { useEscapeStack } from '../../hooks/useEscapeStack';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import PlanQSelect from '../../components/Common/PlanQSelect';
import SearchBox from '../../components/Common/SearchBox';
import { FilterBar, FilterSlot, FilterSearchSlot, axisOption } from '../../components/Common/filterBar';
import { GuestTabPane, Empty, RetryInline, HiddenNote, Lock, Sheet, SheetPortal } from './guestShell';
import { CardGrid, Card, CardName, CardMeta, CardChipRow, CardChip, LockCaption, MetaFixed } from './guestCards';
import { formatPublicDate } from '../../utils/dateFormat';
import type { LoginSheetReason } from './LoginRequiredSheet';

type DocRow = {
  id: number; title: string; category: string | null;
  updated_at: string | null; locked: boolean; author_name: string | null;
};
type DocDetail = {
  id: number; title: string; category: string | null;
  updated_at: string | null; author_name: string | null; content: unknown;
};

type Props = { token: string; onGone: () => void; onNeedLogin: (reason: LoginSheetReason) => void };

export default function GuestDocsTab({ token, onGone, onNeedLogin }: Props) {
  const { t } = useTranslation('guest');
  const [rows, setRows] = useState<DocRow[] | null>(null);
  const [lockedCount, setLockedCount] = useState(0);
  const [err, setErr] = useState(false);
  const [openDoc, setOpenDoc] = useState<DocDetail | null>(null);
  const [openBusy, setOpenBusy] = useState<number | null>(null);
  // 필터 — **화면 안에서만** 거른다(§F). 서버 인자를 늘리면 무인증 표면의 질의 자유도가 넓어진다.
  //   URL 에도 싣지 않는다 — 공유되는 주소에 검색어가 실리면 안 된다.
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');

  // ★ 읽기 시트는 모달이다 — CLAUDE.md "드로어 접근성" 3훅 필수.
  const docRef = useRef<HTMLDivElement>(null);
  useBodyScrollLock(!!openDoc);
  useEscapeStack(!!openDoc, () => setOpenDoc(null));
  useFocusTrap(docRef, !!openDoc);

  const load = useCallback(async () => {
    setErr(false);
    try {
      const r = await fetch(`/api/guest/${token}/posts`);
      // 링크가 죽으면(회수·만료·킬스위치) 화면 전체가 만료 안내로 가야 한다 — 탭만 비우지 않는다.
      if (r.status === 404 || r.status === 410) { onGone(); return; }
      if (!r.ok) { setErr(true); return; }
      const j = await r.json();
      if (!j?.success) { setErr(true); return; }
      setRows(j.data?.items || []);
      setLockedCount(Number(j.data?.locked_count) || 0);
    } catch { setErr(true); }
  }, [token, onGone]);

  useEffect(() => { void load(); }, [load]);

  const open = useCallback(async (row: DocRow) => {
    // 잠긴 카드는 «왜 잠겼는지 + 다음 행동» 을 말하는 시트 — 눌러도 아무 일 없는 카드는 고장으로 읽힌다.
    if (row.locked) { onNeedLogin('locked-doc'); return; }
    setOpenBusy(row.id);
    try {
      const r = await fetch(`/api/guest/${token}/posts/${row.id}`);
      if (r.status === 404 || r.status === 410) { onGone(); return; }
      if (!r.ok) { setErr(true); return; }
      const j = await r.json();
      if (j?.success) setOpenDoc(j.data as DocDetail);
      else setErr(true);
    } catch { setErr(true); } finally { setOpenBusy(null); }
  }, [token, onGone, onNeedLogin]);

  const catOptions = useMemo(() => {
    const cats = [...new Set((rows || []).map((r) => r.category).filter(Boolean) as string[])].sort();
    return [axisOption(t('filter.category', { defaultValue: '분류' }) as string), ...cats.map((c) => ({ value: c, label: c }))];
  }, [rows, t]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (rows || []).filter((r) => (!cat || r.category === cat) && (!needle || r.title.toLowerCase().includes(needle)));
  }, [rows, q, cat]);

  return (
    <GuestTabPane data-testid="guest-tab-body-docs">
      {err ? (
        <Empty>
          {t('docs.failed', { defaultValue: '문서를 불러오지 못했습니다.' })}{' '}
          <RetryInline type="button" onClick={() => void load()}>{t('retry', { defaultValue: '다시 시도' })}</RetryInline>
        </Empty>
      ) : rows === null ? (
        <Empty>{t('loading', { defaultValue: '불러오는 중…' })}</Empty>
      ) : rows.length === 0 && lockedCount === 0 ? (
        <Empty>{t('docs.empty', { defaultValue: '아직 공유된 문서가 없어요.' })}</Empty>
      ) : (
        <>
          {/* 필터 줄은 목록이 **있을 때만** — 빈 탭의 필터줄은 소음이다. */}
          {rows.length > 0 && (
            <FilterBar data-testid="guest-docs-filter">
              <FilterSearchSlot>
                <SearchBox value={q} onChange={setQ} width="100%"
                  placeholder={t('filter.search', { defaultValue: '제목 검색' }) as string}
                  ariaLabel={t('filter.search', { defaultValue: '제목 검색' }) as string} />
              </FilterSearchSlot>
              {catOptions.length > 1 && (
                <FilterSlot width={140} testId="guest-docs-cat">
                  <PlanQSelect size="sm" isSearchable={false} options={catOptions}
                    aria-label={t('filter.category', { defaultValue: '분류' }) as string}
                    value={catOptions.find((o) => o.value === cat) || catOptions[0]}
                    onChange={(opt: unknown) => setCat(String((opt as { value?: string } | null)?.value ?? ''))} />
                </FilterSlot>
              )}
            </FilterBar>
          )}
          {rows.length > 0 && shown.length === 0 ? (
            <Empty data-testid="guest-docs-nomatch">{t('filter.noMatch', { defaultValue: '조건에 맞는 항목이 없어요.' })}</Empty>
          ) : (
            <CardGrid>
              {shown.map((d) => (
                <Card key={d.id} type="button" onClick={() => void open(d)}
                  $dim={d.locked} data-testid={`guest-doc-${d.id}`}
                  aria-label={d.locked
                    ? (t('docs.lockedAria', { defaultValue: '{{title}} — 잠긴 문서', title: d.title }) as string)
                    : d.title}>
                  <CardChipRow>
                    {d.category && <CardChip>{d.category}</CardChip>}
                  </CardChipRow>
                  <CardName $clamp>
                    {d.locked && <Lock />}
                    <span>{d.title}</span>
                  </CardName>
                  {d.locked ? (
                    <LockCaption>{t('login.lockedCaption', { defaultValue: '로그인하면 볼 수 있어요' })}</LockCaption>
                  ) : (
                    <CardMeta>
                      {d.updated_at && <MetaFixed>{formatPublicDate(d.updated_at)}</MetaFixed>}
                      {/* 작성자는 서버가 정한다(§A) — 멤버면 비어 있고, 고객이면 고객 이름. */}
                      {d.author_name && <span>{d.author_name}</span>}
                      {openBusy === d.id && <span>{t('loading', { defaultValue: '불러오는 중…' })}</span>}
                    </CardMeta>
                  )}
                </Card>
              ))}
            </CardGrid>
          )}
          {/* confidential 은 **제목도 정보다.** 자리를 만들지 않고 건수만 알린다. */}
          {lockedCount > 0 && (
            <HiddenNote data-testid="guest-docs-hidden">
              {t('docs.hiddenCount', {
                defaultValue: '공개할 수 없는 문서 {{count}}건은 표시하지 않았어요.',
                count: lockedCount,
              })}
            </HiddenNote>
          )}
        </>
      )}

      {openDoc && (
        <SheetPortal>
        <Sheet role="dialog" aria-modal="true" aria-label={openDoc.title} onClick={() => setOpenDoc(null)}>
          <DocBox ref={docRef} onClick={(e) => e.stopPropagation()}>
            <DocHead>
              <DocTitle>{openDoc.title}</DocTitle>
              <DocMeta>
                {openDoc.author_name && <span>{openDoc.author_name}</span>}
                {openDoc.updated_at && <span>{formatPublicDate(openDoc.updated_at)}</span>}
              </DocMeta>
              <CloseBtn type="button" onClick={() => setOpenDoc(null)}
                aria-label={t('close', { defaultValue: '닫기' }) as string}>×</CloseBtn>
            </DocHead>
            <DocBody
              // 정화를 지난 HTML 만 넣는다(utils/postContentHtml).
              dangerouslySetInnerHTML={{ __html: postContentToSafeHtml(openDoc.content) }} />
          </DocBox>
        </Sheet>
        </SheetPortal>
      )}
    </GuestTabPane>
  );
}

const DocBox = styled.div`
  display:flex;flex-direction:column;width:100%;max-width:720px;max-height:88dvh;
  background:#fff;border-radius:16px 16px 0 0;overflow:hidden;
  @media (min-width:641px){border-radius:16px;margin:0 16px;}
`;
const DocHead = styled.div`
  position:relative;padding:16px 48px 12px 20px;border-bottom:1px solid #e2e8f0;flex-shrink:0;
`;
const DocTitle = styled.div`font-size:1rem;font-weight:700;color:#0f172a;`;
const DocMeta = styled.div`display:flex;gap:8px;margin-top:3px;font-size:0.75rem;color:#64748b;`;
const CloseBtn = styled.button`
  position:absolute;top:10px;right:10px;width:2.25rem;height:2.25rem;
  border:none;background:none;font-size:1.375rem;line-height:1;color:#64748b;cursor:pointer;
  &:focus-visible{outline:2px solid #0d9488;outline-offset:2px;}
`;
const DocBody = styled.div`
  flex:1;min-height:0;overflow-y:auto;padding:16px 20px calc(20px + env(safe-area-inset-bottom));
  font-size:0.875rem;line-height:1.7;color:#0f172a;
  img{max-width:100%;height:auto;}
  /* 표 규격은 공용 조각 한 벌 — 각자 쓰면 갈라진다(2026-09-13) */
  ${postContentTableCss}
  td,th{border:1px solid #e2e8f0;padding:5px 7px;}
  h1,h2,h3{margin:14px 0 6px;}
  ul,ol{padding-left:20px;}
`;
