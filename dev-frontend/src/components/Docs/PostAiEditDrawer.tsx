// 문서 AI 수정 — 지시 → 제안(전후) → 고른 곳만 반영. 설계 docs/DOC_AI_EDIT_DESIGN.md
//
// Irene 2026-10-08: *"소고기 가격 표시된 걸 모두 5링깃으로 바꿔줘 … 전후도 제대로 봐야 하는거"*
//
//   우측 곁패널(DetailDrawer)인 이유 — 문서를 옆에 두고 전후를 대조할 수 있어야 한다.
//   전후 조각(segments)은 서버가 계산해 준다. 화면은 그리기만 한다(같은 비교를 두 벌로 두지 않는다).
//   AI 가 쓴 이유·요약·못 한 것은 **글자로만** 그린다(문서 안 글이 지시처럼 섞여 들어와도 HTML 이 되지 않게).
import React, { useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import DetailDrawer from '../Common/DetailDrawer';
import ActionButton from '../Common/ActionButton';
import { useDraftKey, useDraftText } from '../../hooks/useDraftText';
import { proposePostAiEdit, applyPostAiEdit, type AiEditProposal, type AiEditChange, type AiEditLoc } from '../../services/posts';

interface Props {
  open: boolean;
  onClose: () => void;
  postId: number;
  onApplied: (r: { applied: number; beforeRevisionId: number | null }) => void;
}

const PLACEHOLDER = '￼';

const PostAiEditDrawer: React.FC<Props> = ({ open, onClose, postId, onApplied }) => {
  const { t } = useTranslation('qdocs');
  // 쓰다 만 지시는 남는다(초안 계약 — 비우는 곳은 반영 성공뿐). 문서마다 따로 — 부모가 key 로 인스턴스를 가른다.
  const draft = useDraftText(useDraftKey('post-ai-edit', postId));
  const instruction = draft.text;
  const [busy, setBusy] = useState<'propose' | 'apply' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [proposal, setProposal] = useState<AiEditProposal | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());

  // 다른 문서로 바뀌면 앞 문서의 제안을 들고 있지 않는다(그 제안으로 이 문서를 고치면 안 된다)
  useEffect(() => { setProposal(null); setPicked(new Set()); setErr(null); }, [postId]);

  const errText = (code: string) => {
    const known: Record<string, string> = {
      doc_too_long: t('aiEdit.err.tooLong', '문서가 길어 한 번에 고칠 수 없어요. 문서를 나눠서 시도해 주세요.') as string,
      doc_not_structured: t('aiEdit.err.notStructured', '이 문서는 옛 형식이라 AI 수정을 쓸 수 없어요. 편집에서 한 번 저장한 뒤 다시 시도해 주세요.') as string,
      doc_empty: t('aiEdit.err.empty', '고칠 글이 없는 문서예요.') as string,
      post_locked_by_signature: t('aiEdit.err.signed', '서명 요청이 진행 중이거나 완료된 문서라 고칠 수 없어요.') as string,
      post_edit_forbidden: t('aiEdit.err.forbidden', '이 문서를 고칠 권한이 없어요.') as string,
      stale_edit: t('aiEdit.err.stale', '그 사이 문서가 바뀌었어요. 다시 제안을 받아 주세요.') as string,
      llm_unavailable: t('aiEdit.err.llm', 'AI 가 지금 응답하지 않아요. 잠시 후 다시 시도해 주세요.') as string,
      ai_output_truncated: t('aiEdit.err.truncated', '바꿀 곳이 너무 많아 한 번에 받지 못했어요. 지시를 나눠서 요청해 주세요.') as string,
      ai_output_invalid: t('aiEdit.err.invalid', 'AI 응답을 읽지 못했어요. 다시 시도해 주세요.') as string,
      cue_limit: t('aiEdit.err.quota', '이번 달 Cue 사용량을 다 썼어요. 요금제에서 한도를 늘릴 수 있어요.') as string,
      too_many_requests: t('aiEdit.err.rate', '요청이 너무 잦아요. 1분 뒤 다시 시도해 주세요.') as string,
    };
    return known[code] || (t('aiEdit.err.generic', '처리하지 못했어요. 잠시 후 다시 시도해 주세요.') as string);
  };

  const propose = async () => {
    const ins = instruction.trim();
    if (!ins || busy) return;
    setBusy('propose'); setErr(null);
    try {
      const p = await proposePostAiEdit(postId, ins);
      setProposal(p);
      setPicked(new Set(p.changes.map((c) => c.id)));
    } catch (e) {
      setErr(errText((e as Error).message));
    } finally { setBusy(null); }
  };

  const apply = async () => {
    if (!proposal || busy || picked.size === 0) return;
    setBusy('apply'); setErr(null);
    try {
      const chosen = proposal.changes.filter((c) => picked.has(c.id)).map((c) => ({ id: c.id, before: c.before, after: c.after }));
      const r = await applyPostAiEdit(postId, { base_updated_at: proposal.base_updated_at, changes: chosen, instruction: instruction.trim() });
      onApplied({ applied: r.applied, beforeRevisionId: r.before_revision_id });
      setProposal(null); setPicked(new Set()); draft.clear();
      onClose();
    } catch (e) {
      const code = (e as Error).message;
      setErr(errText(code));
      // 낡은 제안은 더 쓸 수 없다 — 지시는 남기고 결과만 걷는다(다시 제안 받기)
      if (code === 'stale_edit') { setProposal(null); setPicked(new Set()); }
    } finally { setBusy(null); }
  };

  const allPicked = !!proposal && proposal.changes.length > 0 && picked.size === proposal.changes.length;
  const toggleAll = () => {
    if (!proposal) return;
    setPicked(allPicked ? new Set() : new Set(proposal.changes.map((c) => c.id)));
  };
  const toggle = (id: number) => setPicked((prev) => {
    const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n;
  });

  const locText = (loc: AiEditLoc) => {
    if (loc.kind === 'table') {
      const base = t('aiEdit.loc.table', '표 {{table}} · {{row}}행 {{col}}열', { table: loc.table, row: loc.row, col: loc.col }) as string;
      const heads = [loc.row_head, loc.col_head].filter(Boolean).join(' · ');
      return heads ? `${base} (${heads})` : base;
    }
    const kind = loc.kind === 'heading' ? t('aiEdit.loc.heading', '제목') : loc.kind === 'list' ? t('aiEdit.loc.list', '목록') : t('aiEdit.loc.paragraph', '문단');
    return loc.section ? `${kind} · ${loc.section}` : (kind as string);
  };

  return (
    <DetailDrawer open={open} onClose={() => { if (!busy) onClose(); }} ariaLabel={t('aiEdit.title', 'AI로 수정') as string}>
      <DetailDrawer.Header onClose={() => { if (!busy) onClose(); }}>
        <HeadTitle>{t('aiEdit.title', 'AI로 수정')}</HeadTitle>
      </DetailDrawer.Header>
      <DetailDrawer.Body>
        <Field>
          <Label htmlFor="pq-ai-edit-ins">{t('aiEdit.label', '어떻게 고칠까요?')}</Label>
          <Textarea
            id="pq-ai-edit-ins"
            data-testid="post-ai-edit-input"
            value={instruction}
            disabled={busy !== null}
            rows={3}
            maxLength={1000}
            placeholder={t('aiEdit.placeholder', '예: 소고기 가격을 모두 5링깃으로 바꿔줘') as string}
            onChange={draft.bind.onChange}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) { e.preventDefault(); void propose(); }
            }}
          />
          <Hint>{t('aiEdit.hint', '바꿀 곳을 먼저 보여 드려요. 고른 곳만 반영되고, 변경 기록에서 언제든 되돌릴 수 있어요. 글 바꾸기만 할 수 있어요(행·문단 추가·삭제는 편집에서).')}</Hint>
          <Row>
            <ActionButton tone={proposal ? 'secondary' : 'primary'} size="md" data-testid="post-ai-edit-propose"
              loading={busy === 'propose'} disabled={!instruction.trim() || busy !== null} onClick={() => { void propose(); }}>
              {busy === 'propose' ? t('aiEdit.proposing', '찾는 중…') : proposal ? t('aiEdit.repropose', '다시 제안 받기') : t('aiEdit.propose', '바꿀 곳 찾기')}
            </ActionButton>
          </Row>
        </Field>

        {err && <ErrBar role="alert">{err}</ErrBar>}

        {proposal && (
          <Result data-testid="post-ai-edit-result">
            {proposal.summary && <Summary>{proposal.summary}</Summary>}
            {proposal.changes.length === 0 ? (
              <Empty>{t('aiEdit.none', '바꿀 곳을 찾지 못했어요. 지시를 더 구체적으로 적어 보세요.')}</Empty>
            ) : (
              <CountRow>
                <Count>{t('aiEdit.count', '바뀌는 곳 {{n}}곳', { n: proposal.changes.length })}</Count>
                {proposal.changes.length > 1 && (
                  <LinkBtn type="button" data-testid="post-ai-edit-toggle-all" onClick={toggleAll}>
                    {allPicked ? t('aiEdit.unselectAll', '모두 해제') : t('aiEdit.selectAll', '모두 선택')}
                  </LinkBtn>
                )}
              </CountRow>
            )}
            {proposal.changes.map((c) => (
              <ChangeCard key={c.id} $off={!picked.has(c.id)} data-testid="post-ai-edit-change">
                <CardTop>
                  <Check type="checkbox" checked={picked.has(c.id)} onChange={() => toggle(c.id)}
                    aria-label={t('aiEdit.pick', '이 변경 반영') as string} />
                  <Where>{locText(c.loc)}</Where>
                </CardTop>
                <DiffLine aria-label={t('aiEdit.before', '전') as string}>
                  <Side>{t('aiEdit.before', '전')}</Side>
                  <DiffText>{renderSide(c, 'before')}</DiffText>
                </DiffLine>
                <DiffLine aria-label={t('aiEdit.after', '후') as string}>
                  <Side $after>{t('aiEdit.after', '후')}</Side>
                  <DiffText>{renderSide(c, 'after')}</DiffText>
                </DiffLine>
                {c.reason && <Reason>{c.reason}</Reason>}
              </ChangeCard>
            ))}
            {(proposal.not_done.length > 0 || proposal.emptied > 0) && (
              <NotDone>
                <NotDoneHead>{t('aiEdit.notDone', '이건 못 했어요')}</NotDoneHead>
                {proposal.not_done.map((x, i) => <NotDoneItem key={i}>{x}</NotDoneItem>)}
                {proposal.emptied > 0 && <NotDoneItem>{t('aiEdit.emptied', '칸을 통째로 지우는 것은 아직 못 해요({{n}}곳) — 편집에서 지워 주세요.', { n: proposal.emptied })}</NotDoneItem>}
              </NotDone>
            )}
          </Result>
        )}
      </DetailDrawer.Body>
      {proposal && proposal.changes.length > 0 && (
        <DetailDrawer.Footer>
          <ActionButton tone="secondary" size="md" disabled={busy !== null} onClick={onClose}>{t('cancel', '취소')}</ActionButton>
          <ActionButton tone="primary" size="md" data-testid="post-ai-edit-apply"
            loading={busy === 'apply'} disabled={picked.size === 0 || busy !== null} onClick={() => { void apply(); }}>
            {t('aiEdit.apply', '선택한 {{n}}곳 반영', { n: picked.size })}
          </ActionButton>
        </DetailDrawer.Footer>
      )}
    </DetailDrawer>
  );
};

/** 전(지운 것 강조) / 후(넣은 것 강조) 한 줄. 비글자 요소 자리표시는 작은 표식으로. */
function renderSide(c: AiEditChange, side: 'before' | 'after') {
  const keep = side === 'before' ? 'del' : 'ins';
  return c.segments
    .filter((s) => s.t === 'eq' || s.t === keep)
    .map((s, i) => {
      const text = s.s.split(PLACEHOLDER).join('⏎');
      if (s.t === 'eq') return <span key={i}>{text}</span>;
      return side === 'before' ? <Del key={i}>{text}</Del> : <Ins key={i}>{text}</Ins>;
    });
}

export default PostAiEditDrawer;

const HeadTitle = styled.h2`margin: 0; font-size: 1rem; font-weight: 700; color: #0F172A;`;
const Field = styled.div`display: flex; flex-direction: column; gap: 8px;`;
const Label = styled.label`font-size: 0.8125rem; font-weight: 600; color: #334155;`;
const Textarea = styled.textarea`
  width: 100%; box-sizing: border-box; resize: vertical; min-height: 76px;
  padding: 10px 12px; border: 1px solid #CBD5E1; border-radius: 8px;
  font: inherit; font-size: 0.875rem; color: #0F172A; line-height: 1.5;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.18); }
  &:disabled { background: #F8FAFC; color: #64748B; }
  &::placeholder { color: #94A3B8; }
`;
const Hint = styled.p`margin: 0; font-size: 0.75rem; color: #64748B; line-height: 1.5;`;
const Row = styled.div`display: flex; justify-content: flex-end;`;
const ErrBar = styled.div`
  padding: 10px 12px; border-radius: 8px; background: #FEF2F2; color: #B91C1C; font-size: 0.8125rem; line-height: 1.5;
`;
const Result = styled.div`display: flex; flex-direction: column; gap: 10px;`;
const Summary = styled.p`margin: 0; font-size: 0.8125rem; color: #0F172A; line-height: 1.5; font-weight: 600;`;
const CountRow = styled.div`display: flex; align-items: center; justify-content: space-between; gap: 8px;`;
const Count = styled.span`font-size: 0.8125rem; color: #475569; font-weight: 600;`;
const LinkBtn = styled.button`
  border: none; background: none; padding: 0 4px; min-height: 32px; cursor: pointer;
  font-size: 0.8125rem; font-weight: 600; color: #0F766E;
  &:hover { text-decoration: underline; }
  @media (max-width: 640px) { min-height: 40px; }
`;
const Empty = styled.p`margin: 0; padding: 14px; border-radius: 8px; background: #F8FAFC; color: #64748B; font-size: 0.8125rem;`;
const ChangeCard = styled.div<{ $off: boolean }>`
  border: 1px solid ${(p) => (p.$off ? '#E2E8F0' : '#99F6E4')}; border-radius: 10px;
  padding: 10px 12px; display: flex; flex-direction: column; gap: 6px;
  background: #FFFFFF; opacity: ${(p) => (p.$off ? 0.55 : 1)};
`;
const CardTop = styled.label`display: flex; align-items: center; gap: 8px; cursor: pointer; min-width: 0;`;
const Check = styled.input`
  width: 18px; height: 18px; margin: 0; flex-shrink: 0; accent-color: #14B8A6; cursor: pointer;
`;
const Where = styled.span`font-size: 0.75rem; color: #64748B; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`;
const DiffLine = styled.div`display: flex; gap: 8px; align-items: flex-start;`;
const Side = styled.span<{ $after?: boolean }>`
  flex-shrink: 0; width: 22px; font-size: 0.6875rem; font-weight: 700; line-height: 1.6;
  color: ${(p) => (p.$after ? '#0F766E' : '#94A3B8')};
`;
const DiffText = styled.span`font-size: 0.8125rem; color: #334155; line-height: 1.6; word-break: break-word; white-space: pre-wrap;`;
const Del = styled.del`background: #FEE2E2; color: #B91C1C; text-decoration: line-through; border-radius: 3px; padding: 0 2px;`;
const Ins = styled.ins`background: #CCFBF1; color: #0F766E; text-decoration: none; font-weight: 700; border-radius: 3px; padding: 0 2px;`;
const Reason = styled.p`margin: 0; font-size: 0.75rem; color: #64748B; line-height: 1.5;`;
const NotDone = styled.div`padding: 10px 12px; border-radius: 8px; background: #F8FAFC; display: flex; flex-direction: column; gap: 4px;`;
const NotDoneHead = styled.span`font-size: 0.75rem; font-weight: 700; color: #475569;`;
const NotDoneItem = styled.span`font-size: 0.75rem; color: #64748B; line-height: 1.5;`;
