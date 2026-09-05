// 결과물 회차 이력 (#271 · #307)
//
// 왜 필요한가: 결과물은 `tasks.body` **한 칸**이라 다시 제출하면 이전 것이 덮인다. 그래서
// 사람들이 결과물을 댓글에 붙여 왔고, 무엇이 최신인지·무엇이 반려된 버전인지 알 수 없었다.
// 백엔드는 2026-08-22 에 회차 박제를 시작했는데(확인 요청 = 버전) 화면이 없어 사용자에게는
// 아무것도 달라지지 않은 것으로 보였다. 이 컴포넌트가 그 데이터를 꺼내 보여준다.
//
// 설계 결정:
//   - 목록은 본문을 받지 않는다(회차가 쌓이면 응답이 수 MB). 회차를 펼칠 때만 단건 조회
//   - #271 이전 회차는 스냅샷이 없다 → `has_body` 로 구분해 "고장" 처럼 보이지 않게 한다
//   - 되돌리기는 비파괴적 — 서버가 되돌리기 직전 상태를 먼저 박제한 뒤 덮는다
import React, { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../contexts/AuthContext';
import { sanitizeRichText } from '../../utils/sanitizeHtml';
import { markdownToHtml } from '../../utils/markdownPaste';

type Outcome = 'approved' | 'revision' | 'pending';

interface Version {
  id: number;
  round: number;
  note: string | null;
  attachment_ids: number[];
  has_body: boolean;
  body_len: number;
  outcome: Outcome;
  outcome_note: string | null;
  submitted_at: string;
  submitter: { id: number; name: string } | null;
}

interface Props {
  taskId: number;
  /** 결과물 편집 권한자만 되돌리기 가능 */
  canRestore: boolean;
  /** 되돌린 뒤 상세를 다시 읽어오게 한다 */
  onRestored: () => void;
  /**
   * 목록을 읽을 때마다 **지금까지의 마지막 회차 번호**를 알린다(없으면 0).
   * 입력란 위의 "v{n} 로 남습니다" 안내가 이 값을 써야 목록과 어긋나지 않는다 —
   * `review_round`(컨펌 라운드 수)는 되돌리기 백업 회차를 세지 않아 값이 갈린다.
   */
  onRoundsLoaded?: (lastRound: number) => void;
  /**
   * 이 값이 바뀌면 목록을 **다시 읽는다.** 확인 요청·취소 같은 워크플로 액션은 회차를 늘리는데,
   * 드로어를 닫지 않으면 목록이 그대로라 화면이 옛 번호를 말했다
   * (Fable 3차 게이트 2026-09-05: 제출→취소 뒤 "v3 로 남습니다" 인데 실제로는 v4 가 됐다).
   * 호출부가 상태·회차를 담은 문자열을 넘긴다.
   */
  reloadKey?: string;
}

const DeliverableHistory: React.FC<Props> = ({ taskId, canRestore, onRestored, onRoundsLoaded, reloadKey }) => {
  const { t } = useTranslation('qtask');
  const [open, setOpen] = useState(false);
  const [versions, setVersions] = useState<Version[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [bodyCache, setBodyCache] = useState<Record<number, string>>({});
  const [busyId, setBusyId] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    // ★ 못 읽었으면 **모른다고 알린다.** 실패 분기가 조용하면 드로어가 직전 회차 번호를
    //   그대로 들고 있어, 그 사이 늘어난 회차를 모른 채 "v2 로 남습니다" 라고 말한다
    //   (Fable 4차 게이트 2026-09-05 실측: 실제로는 v3 이 됐다).
    //   -1 = 모름 → 호출부는 번호 없는 문구로 떨어진다.
    const fail = (code: string) => { setErr(code); onRoundsLoaded?.(-1); };
    try {
      const r = await apiFetch(`/api/tasks/${taskId}/deliverable-versions`);
      // apiFetch 는 throw 하지 않는다 — res.ok 를 직접 봐야 실패가 조용히 성공으로 안 보인다
      if (!r.ok) { fail('load_failed'); return; }
      const j = await r.json();
      if (!j?.success) { fail('load_failed'); return; }
      const list: Version[] = j.data?.versions || [];
      setVersions(list);
      onRoundsLoaded?.(list.length ? Math.max(...list.map((v) => v.round)) : 0);
    } catch { fail('load_failed'); } finally { setLoading(false); }
  }, [taskId, onRoundsLoaded]);

  // ★ 2026-09-04 — 펼쳐야만 읽던 것을 **마운트 시** 읽는다.
  //   Irene: "결과물이 버전별로 어떻게 되는 건지 전혀 모르겠어. 이미 저장되어 있는데 어쩌라는 거야?"
  //   접힌 상태에서는 회차 번호도 규칙도 안 보였다 — 규칙 설명이 접힌 본문 **안**에 있었기 때문이다.
  //   목록은 본문을 싣지 않아 가볍다(설계 주석 참조). 상태를 먼저 보여주고 상세는 펼칠 때 읽는다.
  //   워크플로 액션(확인 요청·취소·승인) 뒤에도 다시 읽는다 — 그 액션들이 회차를 늘린다.
  //   ★ 이펙트를 **하나로** 둔다. 둘로 나눴더니 마운트마다 같은 목록을 두 번 읽었다.
  useEffect(() => { load(); }, [load, reloadKey]);
  // 업무가 바뀌면 접고 비운다 — 옛 업무의 회차가 잠깐 보이는 것을 막는다
  useEffect(() => { setOpen(false); setExpanded(null); setBodyCache({}); setVersions([]); }, [taskId]);

  const toggleBody = useCallback(async (v: Version) => {
    if (expanded === v.id) { setExpanded(null); return; }
    setExpanded(v.id);
    if (bodyCache[v.id] !== undefined || !v.has_body) return;
    const r = await apiFetch(`/api/tasks/${taskId}/deliverable-versions/${v.id}`);
    if (!r.ok) return;
    const j = await r.json();
    if (j?.success) setBodyCache(prev => ({ ...prev, [v.id]: j.data.body || '' }));
  }, [expanded, bodyCache, taskId]);

  const restore = useCallback(async (v: Version) => {
    setBusyId(v.id); setErr(null);
    try {
      const r = await apiFetch(`/api/tasks/${taskId}/deliverable-versions/${v.id}/restore`, { method: 'POST' });
      if (!r.ok) { setErr('restore_failed'); return; }
      const j = await r.json();
      if (!j?.success) { setErr('restore_failed'); return; }
      await load();
      onRestored();
    } catch { setErr('restore_failed'); } finally { setBusyId(null); }
  }, [taskId, load, onRestored]);

  const outcomeLabel = (o: Outcome) =>
    o === 'approved' ? t('deliv.approved', '승인됨')
      : o === 'revision' ? t('deliv.revision', '수정요청')
        : t('deliv.pending', '검토 대기');

  const last = versions[0] || null;   // 목록은 최신순

  return (
    <Wrap>
      {/* ★ 2026-09-05 — "다음에 무엇이 되는가" 는 **입력란 위 한 줄**로 옮겼다.
          같은 말을 여기서 또 하니 위아래가 같은 내용을 두 번 말하는 꼴이었고,
          Irene 에게는 "입력란에 있는 게 왜 또 아래에 버전으로 있느냐" 로 읽혔다.
          여기는 **지나간 것만** 다룬다. 아직 아무것도 없으면 접는 버튼도 내지 않는다. */}
      {versions.length === 0 ? (
        (!loading && !err) ? <Muted>{t('deliv.emptyShort', '아직 제출한 버전이 없습니다.')}</Muted> : null
      ) : (
        <Toggle type="button" onClick={() => setOpen(v => !v)} aria-expanded={open}>
          <Caret $open={open} aria-hidden="true">▸</Caret>
          {t('deliv.pastTitle', '지난 버전')}
          <RoundPill>{versions.length}</RoundPill>
          {last && <LastHint>{t('deliv.lastHint', '최근 v{{n}} · {{outcome}}', { n: last.round, outcome: outcomeLabel(last.outcome) })}</LastHint>}
        </Toggle>
      )}

      {/* ★ 오류는 **접혀 있어도** 보여야 한다. 펼친 사람만 볼 수 있게 두면, 목록을 못 읽은 것과
          "회차가 없는 것" 이 화면에서 구별되지 않는다. */}
      {err && !open && <ErrLine>{t(`deliv.err.${err}`, t('deliv.err.generic', '이력을 불러오지 못했습니다'))}</ErrLine>}

      {open && (
        <Body>
          {loading && <Muted>{t('deliv.loading', '불러오는 중…')}</Muted>}
          {err && <ErrLine>{t(`deliv.err.${err}`, t('deliv.err.generic', '이력을 불러오지 못했습니다'))}</ErrLine>}

          {versions.map(v => (
            <Row key={v.id}>
              <RowHead type="button" onClick={() => toggleBody(v)} aria-expanded={expanded === v.id}>
                <VLabel>v{v.round}</VLabel>
                <Badge $o={v.outcome}>{outcomeLabel(v.outcome)}</Badge>
                <Who>{v.submitter?.name || '—'}</Who>
                <When>{new Date(v.submitted_at).toLocaleString()}</When>
              </RowHead>

              {v.note && <NoteBlock text={v.note} />}
              {v.outcome === 'revision' && v.outcome_note && (
                <NoteBlock text={v.outcome_note} label={t('deliv.revisionNote', '수정요청') as string} tone="revision" />
              )}

              {expanded === v.id && (
                <Preview>
                  {!v.has_body
                    ? <Muted>{t('deliv.noSnapshot', '이 회차는 결과물 박제 기능이 생기기 전이라 본문이 없습니다.')}</Muted>
                    : bodyCache[v.id] === undefined
                      ? <Muted>{t('deliv.loading', '불러오는 중…')}</Muted>
                      : <Rendered dangerouslySetInnerHTML={{ __html: sanitizeRichText(bodyCache[v.id]) }} />}
                  {/* 쓰기 상태일 때만 낸다. 읽기 상태(컨펌 중·완료)에서는 서버가 막고(body_locked),
                      무엇보다 닫힌 결과물이 조용히 바뀌는 문이 되어선 안 된다. */}
                  {canRestore && v.has_body && (
                    <>
                      <RestoreBtn type="button" disabled={busyId === v.id} onClick={() => restore(v)}>
                        {busyId === v.id
                          ? t('deliv.restoring', '불러오는 중…')
                          : t('deliv.restore', '이 버전 내용 불러오기')}
                      </RestoreBtn>
                      <Muted>{t('deliv.restoreHint', '지금 쓰던 내용은 한 벌 보관된 뒤 이 버전으로 바뀝니다.')}</Muted>
                    </>
                  )}
                </Preview>
              )}
            </Row>
          ))}
        </Body>
      )}
    </Wrap>
  );
};

const LastHint = styled.span`
  font-size:0.75rem;font-weight:500;color:#94A3B8;
`;
const Wrap = styled.div`margin-top:10px;`;
const Toggle = styled.button`
  display:inline-flex;align-items:center;gap:6px;height:2.25rem;padding:0 10px;
  background:transparent;border:none;border-radius:8px;cursor:pointer;
  font-size:0.8125rem;font-weight:700;color:#475569;
  &:hover{background:#F1F5F9;}
  &:focus-visible{outline:2px solid #0D9488;outline-offset:2px;}
`;
const Caret = styled.span<{ $open: boolean }>`
  display:inline-block;transition:transform .15s;font-size:0.75rem;
  transform:rotate(${p => (p.$open ? '90deg' : '0deg')});
`;
const RoundPill = styled.span`
  padding:1px 8px;background:#CCFBF1;color:#0F766E;border-radius:999px;
  font-size:0.75rem;font-weight:700;
`;
const Body = styled.div`
  display:flex;flex-direction:column;gap:8px;margin-top:6px;padding:10px 12px;
  background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;
`;
const Muted = styled.div`font-size:0.78125rem;color:#64748B;`;
const ErrLine = styled.div`font-size:0.78125rem;color:#DC2626;`;
const Row = styled.div`
  display:flex;flex-direction:column;gap:4px;padding:8px 0;
  border-top:1px solid #E2E8F0;
  &:first-of-type{border-top:none;}
`;
const RowHead = styled.button`
  display:flex;align-items:center;gap:8px;flex-wrap:wrap;width:100%;
  padding:2px 0;background:transparent;border:none;cursor:pointer;text-align:left;
  &:focus-visible{outline:2px solid #0D9488;outline-offset:2px;}
`;
const VLabel = styled.span`font-size:0.8125rem;font-weight:800;color:#0F172A;`;
const Badge = styled.span<{ $o: Outcome }>`
  padding:1px 8px;border-radius:999px;font-size:0.75rem;font-weight:700;
  background:${p => (p.$o === 'approved' ? '#DCFCE7' : p.$o === 'revision' ? '#FEE2E2' : '#F1F5F9')};
  color:${p => (p.$o === 'approved' ? '#166534' : p.$o === 'revision' ? '#B91C1C' : '#64748B')};
`;
/**
 * 메모·수정요청 사유 — **쓴 그대로 읽히게** 그린다.
 *
 *   Irene 2026-09-05: "업무결과물에 이렇게 표시되는게 뭐야? 엉망인데?"
 *   운영 실측(수정요청 사유 53건): 최대 **2,378자** · **줄바꿈 포함 22건(42%)**.
 *   그런데 `<div>` 기본값(white-space: normal)이라 **줄바꿈이 전부 사라져** 한 덩어리가 됐고,
 *   접지도 않아 이력 한 줄이 화면을 다 먹었다. 목록 표시로 쓸 수 없는 상태였다.
 *
 *   ① 마크다운으로 쓴 사람이 많다(`###`·`*`·`>`) — 파일 미리보기와 **같은 파이프라인**으로
 *      렌더한다(marked → sanitize). 마크다운이 아니면 문단 그대로 나온다.
 *   ② 길면 접는다. 규칙을 설명하지 않고 **지금 상태와 다음 동작**만 버튼에 쓴다.
 */
const NoteBlock: React.FC<{ text: string; label?: string; tone?: 'revision' }> = ({ text, label, tone }) => {
  const { t } = useTranslation('qtask');
  const [open, setOpen] = useState(false);
  // 접을 만큼 긴가 — 줄 수와 글자 수 둘 다 본다(한 줄 2,000자짜리도 있다).
  const long = text.length > 220 || text.split('\n').length > 4;
  // ★ `markdownToHtml` 은 **마크다운 신호가 없으면 null 을 돌려준다**(utils/markdownPaste.ts).
  //   `|| ''` 로 받으면 평문 메모·수정요청 사유가 통째로 **빈 칸**이 된다 — 운영 사유 53건 중
  //   대부분이 평문이라 사실상 전부 사라진다(Fable 게이트 2026-09-05 F5 실측).
  //   마크다운이 아니면 **escape 한 평문 + 줄바꿈 보존**으로 그린다. 지우지 않는다.
  const md = markdownToHtml(text);
  const html = md !== null
    ? sanitizeRichText(md)
    : sanitizeRichText(
        text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/\r\n|\r|\n/g, '<br />'),
      );
  return (
    <NoteWrap $tone={tone}>
      {label && <NoteLabel $tone={tone}>{label}</NoteLabel>}
      <NoteBody $clamped={long && !open} dangerouslySetInnerHTML={{ __html: html }} />
      {long && (
        <NoteToggle type="button" onClick={() => setOpen(v => !v)}>
          {open ? t('deliv.noteFold', { defaultValue: '접기' }) as string
                : t('deliv.noteMore', { defaultValue: '더 보기' }) as string}
        </NoteToggle>
      )}
    </NoteWrap>
  );
};

const NoteWrap = styled.div<{ $tone?: 'revision' }>`
  display:flex;flex-direction:column;gap:4px;
  padding:${p => (p.$tone === 'revision' ? '8px 10px' : '2px 0')};
  background:${p => (p.$tone === 'revision' ? '#FEF2F2' : 'transparent')};
  border-radius:8px;
`;
const NoteLabel = styled.div<{ $tone?: 'revision' }>`
  font-size:0.6875rem;font-weight:700;
  color:${p => (p.$tone === 'revision' ? '#B91C1C' : '#94A3B8')};
`;
// 마크다운 결과를 그린다. 접힘은 **줄 수**로 자른다 — 글자 수로 자르면 표·목록이 중간에서 끊긴다.
const NoteBody = styled.div<{ $clamped: boolean }>`
  font-size:0.78125rem;line-height:1.55;color:#475569;
  word-break:break-word;
  ${p => (p.$clamped ? 'display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:4;overflow:hidden;' : '')}
  p{margin:0 0 6px;}
  p:last-child{margin-bottom:0;}
  ul,ol{margin:0 0 6px;padding-left:18px;}
  li{margin:1px 0;}
  h1,h2,h3,h4{font-size:0.8125rem;font-weight:700;color:#334155;margin:8px 0 4px;}
  blockquote{margin:4px 0;padding-left:8px;border-left:2px solid #E2E8F0;color:#64748B;}
  code{background:#F1F5F9;padding:1px 4px;border-radius:4px;}
  table{width:100%;border-collapse:collapse;}
  td,th{border:1px solid #E2E8F0;padding:3px 5px;}
`;
const NoteToggle = styled.button`
  align-self:flex-start;border:none;background:none;padding:0;
  font-size:0.75rem;font-weight:700;color:#0D9488;cursor:pointer;text-decoration:underline;
`;

const Who = styled.span`font-size:0.78125rem;color:#475569;`;
const When = styled.span`font-size:0.75rem;color:#94A3B8;margin-left:auto;`;
const Preview = styled.div`
  display:flex;flex-direction:column;gap:10px;margin-top:4px;padding:10px;
  background:#fff;border:1px solid #E2E8F0;border-radius:8px;
`;
const Rendered = styled.div`
  font-size:0.84375rem;line-height:1.65;color:#0F172A;max-height:40vh;overflow-y:auto;
  img{max-width:100%;height:auto;}
  table{width:100%;border-collapse:collapse;}
  td,th{border:1px solid #E2E8F0;padding:4px 6px;}
`;
const RestoreBtn = styled.button`
  align-self:flex-start;height:2.25rem;padding:0 14px;
  background:#fff;color:#0F172A;border:1px solid #CBD5E1;border-radius:8px;
  font-size:0.78125rem;font-weight:600;cursor:pointer;
  &:hover:not(:disabled){background:#F1F5F9;}
  &:disabled{opacity:.6;cursor:default;}
  &:focus-visible{outline:2px solid #0D9488;outline-offset:2px;}
`;

export default DeliverableHistory;
