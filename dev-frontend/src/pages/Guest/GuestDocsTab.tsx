// 무로그인 열람 — **문서 탭** (설계 docs/PROJECT_EXTERNAL_VIEW_DESIGN.md §8 2차)
//
// 축이 둘이고 역할이 다르다(서버 routes/guest_project.js 와 같은 규약):
//   `vlevel`         = 필터 — L1(개인)은 **행 자체가 없다.** 로그인해도 고객은 못 보므로
//                      "로그인하면 볼 수 있어요" 라고 하면 그 문장이 거짓이 된다.
//   `security_level` = 잠금 — general 열림 / internal 자리는 보이고 잠김 /
//                      confidential 은 제목도 안 나가고 **건수만**.
//
// ★ 잠긴 줄은 "안 눌린다" 가 아니라 **왜 잠겼는지 말하는 시트**를 띄운다. 눌러도 아무 일 없는
//   줄은 사용자에게 고장으로 보인다(memory feedback_rules_must_be_explained_briefly).
// ★ 본문은 편집기를 띄우지 않고 headless 변환 + 정화만 한다(utils/postContentHtml).
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import { postContentToSafeHtml } from '../../utils/postContentHtml';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { useEscapeStack } from '../../hooks/useEscapeStack';
import { useFocusTrap } from '../../hooks/useFocusTrap';

type DocRow = {
  id: number; title: string; category: string | null;
  updated_at: string | null; locked: boolean; author_name: string | null;
};
type DocDetail = {
  id: number; title: string; category: string | null;
  updated_at: string | null; author_name: string | null; content: unknown;
};

type Props = { token: string; onGone: () => void };

export default function GuestDocsTab({ token, onGone }: Props) {
  const { t } = useTranslation('guest');
  const [rows, setRows] = useState<DocRow[] | null>(null);
  const [lockedCount, setLockedCount] = useState(0);
  const [err, setErr] = useState(false);
  const [openDoc, setOpenDoc] = useState<DocDetail | null>(null);
  const [openBusy, setOpenBusy] = useState<number | null>(null);
  const [lockedNotice, setLockedNotice] = useState(false);

  // ★ 시트는 모달이다 — CLAUDE.md "드로어 접근성" 3훅 필수.
  //   없으면 Esc 를 눌러도 안 닫히고 포커스가 시트 밖에 남는다(Fable 게이트 2026-09-05 실측).
  //   무인증 화면이라 키보드만 쓰는 사람에게 빠져나갈 길이 더더욱 있어야 한다.
  const noticeRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<HTMLDivElement>(null);
  const anySheet = lockedNotice || !!openDoc;
  useBodyScrollLock(anySheet);
  useEscapeStack(lockedNotice, () => setLockedNotice(false));
  useEscapeStack(!!openDoc, () => setOpenDoc(null));
  useFocusTrap(noticeRef, lockedNotice);
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
    if (row.locked) { setLockedNotice(true); return; }
    setOpenBusy(row.id);
    try {
      const r = await fetch(`/api/guest/${token}/posts/${row.id}`);
      if (r.status === 404 || r.status === 410) { onGone(); return; }
      if (!r.ok) { setErr(true); return; }
      const j = await r.json();
      if (j?.success) setOpenDoc(j.data as DocDetail);
      else setErr(true);
    } catch { setErr(true); } finally { setOpenBusy(null); }
  }, [token, onGone]);

  const fmt = (s: string | null) => {
    if (!s) return '';
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString();
  };

  return (
    <Scroll data-testid="guest-docs">
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
          <List>
            {rows.map((d) => (
              <Row key={d.id} type="button" onClick={() => void open(d)}
                $locked={d.locked} data-testid={`guest-doc-${d.id}`}
                aria-label={d.locked
                  ? (t('docs.lockedAria', { defaultValue: '{{title}} — 잠긴 문서', title: d.title }) as string)
                  : d.title}>
                <RowMain>
                  <RowTitle>
                    {d.locked && <Lock aria-hidden>🔒</Lock>}
                    {d.title}
                  </RowTitle>
                  <RowMeta>
                    {d.category && <span>{d.category}</span>}
                    {/* 잠긴 문서는 작성자도 알리지 않는다 — 서버가 이미 null 로 준다. */}
                    {d.author_name && <span>{d.author_name}</span>}
                    {d.updated_at && <span>{fmt(d.updated_at)}</span>}
                  </RowMeta>
                </RowMain>
                {openBusy === d.id && <RowBusy>{t('loading', { defaultValue: '불러오는 중…' })}</RowBusy>}
              </Row>
            ))}
          </List>
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

      {/* 잠긴 줄 안내 — 규칙을 설명하지 않고 **지금 상태와 다음 행동**만 말한다. */}
      {lockedNotice && (
        <Sheet role="dialog" aria-modal="true" aria-label={t('docs.lockedTitle', { defaultValue: '열 수 없는 문서' }) as string}
          onClick={() => setLockedNotice(false)}>
          <SheetBox ref={noticeRef} onClick={(e) => e.stopPropagation()}>
            <SheetTitle>{t('docs.lockedTitle', { defaultValue: '열 수 없는 문서' })}</SheetTitle>
            <SheetBody>{t('docs.lockedBody', { defaultValue: '이 문서는 담당자만 볼 수 있게 되어 있어요. 필요하시면 대화 탭에서 담당자에게 요청해 주세요.' })}</SheetBody>
            <SheetBtn type="button" onClick={() => setLockedNotice(false)}>{t('close', { defaultValue: '닫기' })}</SheetBtn>
          </SheetBox>
        </Sheet>
      )}

      {openDoc && (
        <Sheet role="dialog" aria-modal="true" aria-label={openDoc.title} onClick={() => setOpenDoc(null)}>
          <DocBox ref={docRef} onClick={(e) => e.stopPropagation()}>
            <DocHead>
              <DocTitle>{openDoc.title}</DocTitle>
              <DocMeta>
                {openDoc.author_name && <span>{openDoc.author_name}</span>}
                {openDoc.updated_at && <span>{fmt(openDoc.updated_at)}</span>}
              </DocMeta>
              <CloseBtn type="button" onClick={() => setOpenDoc(null)}
                aria-label={t('close', { defaultValue: '닫기' }) as string}>×</CloseBtn>
            </DocHead>
            <DocBody
              // 정화를 지난 HTML 만 넣는다(utils/postContentHtml).
              dangerouslySetInnerHTML={{ __html: postContentToSafeHtml(openDoc.content) }} />
          </DocBox>
        </Sheet>
      )}
    </Scroll>
  );
}

const Scroll = styled.div`flex:1;min-height:0;overflow-y:auto;padding:16px 20px;`;
const Empty = styled.div`font-size:0.8125rem;color:#64748b;padding:12px 0;`;
const RetryInline = styled.button`
  border:none;background:none;padding:0;font-size:0.8125rem;font-weight:700;
  color:#0d9488;cursor:pointer;text-decoration:underline;
`;
const List = styled.div`display:flex;flex-direction:column;gap:8px;`;
const Row = styled.button<{ $locked: boolean }>`
  display:flex;align-items:center;gap:10px;width:100%;
  padding:12px 14px;background:#fff;border:1px solid #e2e8f0;border-radius:10px;
  text-align:left;cursor:pointer;
  opacity:${(p) => (p.$locked ? 0.7 : 1)};
  &:hover{border-color:#cbd5e1;}
  &:focus-visible{outline:2px solid #0d9488;outline-offset:2px;}
`;
const RowMain = styled.div`flex:1 1 0;min-width:0;`;
const RowTitle = styled.div`
  display:flex;align-items:center;gap:6px;
  font-size:0.875rem;font-weight:600;color:#0f172a;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
`;
const Lock = styled.span`font-size:0.75rem;`;
const RowMeta = styled.div`
  display:flex;flex-wrap:wrap;gap:8px;margin-top:3px;
  font-size:0.75rem;color:#64748b;
`;
const RowBusy = styled.span`font-size:0.75rem;color:#94a3b8;flex-shrink:0;`;
const HiddenNote = styled.div`
  margin-top:12px;padding:10px 12px;background:#f1f5f9;border-radius:8px;
  font-size:0.75rem;line-height:1.5;color:#64748b;
`;
const Sheet = styled.div`
  position:fixed;inset:0;z-index:60;display:flex;align-items:flex-end;justify-content:center;
  background:rgba(15,23,42,0.45);
  @media (min-width:641px){align-items:center;}
`;
const SheetBox = styled.div`
  width:100%;max-width:420px;margin:0;padding:20px;
  background:#fff;border-radius:16px 16px 0 0;
  padding-bottom:calc(20px + env(safe-area-inset-bottom));
  @media (min-width:641px){border-radius:16px;margin:0 16px;padding-bottom:20px;}
`;
const SheetTitle = styled.div`font-size:1rem;font-weight:700;color:#0f172a;`;
const SheetBody = styled.div`margin-top:8px;font-size:0.8125rem;line-height:1.6;color:#475569;`;
const SheetBtn = styled.button`
  margin-top:16px;width:100%;height:2.75rem;
  background:#0f172a;color:#fff;border:none;border-radius:10px;
  font-size:0.875rem;font-weight:600;cursor:pointer;
`;
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
  table{width:100%;border-collapse:collapse;}
  td,th{border:1px solid #e2e8f0;padding:5px 7px;}
  h1,h2,h3{margin:14px 0 6px;}
  ul,ol{padding-left:20px;}
`;
