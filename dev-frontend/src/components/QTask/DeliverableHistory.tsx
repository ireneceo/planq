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
}

const DeliverableHistory: React.FC<Props> = ({ taskId, canRestore, onRestored }) => {
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
    try {
      const r = await apiFetch(`/api/tasks/${taskId}/deliverable-versions`);
      // apiFetch 는 throw 하지 않는다 — res.ok 를 직접 봐야 실패가 조용히 성공으로 안 보인다
      if (!r.ok) { setErr('load_failed'); return; }
      const j = await r.json();
      if (!j?.success) { setErr('load_failed'); return; }
      setVersions(j.data?.versions || []);
    } catch { setErr('load_failed'); } finally { setLoading(false); }
  }, [taskId]);

  // ★ 2026-09-04 — 펼쳐야만 읽던 것을 **마운트 시** 읽는다.
  //   Irene: "결과물이 버전별로 어떻게 되는 건지 전혀 모르겠어. 이미 저장되어 있는데 어쩌라는 거야?"
  //   접힌 상태에서는 회차 번호도 규칙도 안 보였다 — 규칙 설명이 접힌 본문 **안**에 있었기 때문이다.
  //   목록은 본문을 싣지 않아 가볍다(설계 주석 참조). 상태를 먼저 보여주고 상세는 펼칠 때 읽는다.
  useEffect(() => { load(); }, [load]);
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
      {/* 상태 한 줄 — 접혀 있어도 보인다. 규칙을 설명하지 않고 **지금 상태와 다음 행동**을 말한다. */}
      <StatusLine>
        {last ? (
          <>
            <strong>{t('deliv.stateRecorded', 'v{{n}} 로 기록됨', { n: last.round })}</strong>
            <Sep aria-hidden="true">·</Sep>
            {outcomeLabel(last.outcome)}
            <Sep aria-hidden="true">·</Sep>
            {t('deliv.stateNext', '확인 요청을 보내면 v{{n}} 로 남습니다', { n: last.round + 1 })}
          </>
        ) : (
          <>
            <strong>{t('deliv.stateNone', '아직 회차로 기록되지 않았습니다')}</strong>
            <Sep aria-hidden="true">·</Sep>
            {t('deliv.stateFirst', '확인 요청을 보내면 v1 로 남습니다')}
          </>
        )}
      </StatusLine>

      <Toggle type="button" onClick={() => setOpen(v => !v)} aria-expanded={open}>
        <Caret $open={open} aria-hidden="true">▸</Caret>
        {t('deliv.title', '결과물 이력')}
        {versions.length ? <RoundPill>{versions.length}</RoundPill> : null}
      </Toggle>

      {open && (
        <Body>
          {loading && <Muted>{t('deliv.loading', '불러오는 중…')}</Muted>}
          {err && <ErrLine>{t(`deliv.err.${err}`, t('deliv.err.generic', '이력을 불러오지 못했습니다'))}</ErrLine>}
          {!loading && !err && versions.length === 0 && (
            <Muted>{t('deliv.empty', '아직 제출된 회차가 없습니다. 확인 요청을 보내면 그 시점 결과물이 여기 남습니다.')}</Muted>
          )}

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
                  {canRestore && v.has_body && (
                    <RestoreBtn type="button" disabled={busyId === v.id} onClick={() => restore(v)}>
                      {busyId === v.id
                        ? t('deliv.restoring', '되돌리는 중…')
                        : t('deliv.restore', '이 회차 내용으로 되돌리기')}
                    </RestoreBtn>
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

const StatusLine = styled.div`
  display: flex; align-items: center; flex-wrap: wrap; gap: 4px;
  margin: 10px 0 6px; font-size: 0.8125rem; line-height: 1.6; color: #475569;
  strong { color: #0F172A; font-weight: 700; }
`;
const Sep = styled.span`color: #CBD5E1;`;
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
  const html = sanitizeRichText(markdownToHtml(text) || '');
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
